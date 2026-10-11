import assert from "node:assert/strict";
import { appendFileSync, closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  latestUsageTokens,
  latestUsageTokensCached,
  latestUsageTokensFromText,
  latestUsageTokensInTail,
  measureProviderCache,
  measureProviderCacheFromText,
  measureRuleDedup,
} from "../plugins/litclaude/lib/cache-measurement.mjs";

const makeTemp = () => mkdtempSync(join(tmpdir(), "litclaude-cache-measurement-"));

test("provider cache measurement aggregates only local transcript usage receipts", () => {
  const transcript = [
    JSON.stringify({ type: "user", message: { content: "DO NOT RETURN THIS PROMPT" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 10,
          output_tokens: 2,
        },
      },
    }),
    JSON.stringify({
      type: "assistant",
      isSidechain: true,
      message: {
        usage: {
          input_tokens: 900,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 900,
          output_tokens: 900,
        },
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 20,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 0,
          output_tokens: 3,
        },
      },
    }),
    "not-json",
  ].join("\n");

  const direct = measureProviderCacheFromText(transcript);
  assert.equal(direct.status, "MEASURED");
  assert.deepEqual(direct.totals, {
    inputTokens: 30,
    cacheReadInputTokens: 40,
    cacheCreationInputTokens: 10,
    outputTokens: 5,
    observedInputTokens: 80,
  });
  assert.equal(direct.cacheHitRate, 50);
  assert.equal(direct.cacheReadRate, 50);
  assert.equal(direct.cacheReuseRate, 80);
  assert.deepEqual(direct.receipt, {
    kind: "local-transcript-usage",
    usageEvents: 2,
    cacheUsageEvents: 2,
  });
  assert.equal(latestUsageTokensFromText(transcript), 30);
  assert.doesNotMatch(JSON.stringify(direct), /DO NOT RETURN THIS PROMPT/u);
  assert.doesNotMatch(JSON.stringify(direct), /900/u);

  const temp = makeTemp();
  try {
    const path = join(temp, "transcript.jsonl");
    writeFileSync(path, transcript);
    assert.deepEqual(measureProviderCache(path), direct);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("provider cache measurement stays UNPROVEN when cache fields are absent", () => {
  const result = measureProviderCacheFromText(
    JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 100, output_tokens: 4 } } }),
  );

  assert.equal(result.status, "UNPROVEN");
  assert.equal(result.reason, "cache-fields-not-exposed");
  assert.equal(result.cacheHitRate, null);
  assert.equal(result.cacheReadRate, null);
  assert.deepEqual(result.totals, {
    inputTokens: 100,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 4,
    observedInputTokens: 100,
  });
});

test("provider cache measurement exposes a capability probe when no transcript is available", () => {
  const result = measureProviderCache();
  assert.equal(result.status, "UNPROVEN");
  assert.equal(result.reason, "transcript-path-not-provided");
  assert.equal(result.cacheHitRate, null);
  assert.equal(result.cacheReadRate, null);
  assert.equal(result.receipt, null);
});

test("provider cache measurement rejects a symlinked transcript without reading it", () => {
  const temp = makeTemp();
  try {
    const target = join(temp, "real.jsonl");
    const link = join(temp, "transcript.jsonl");
    writeFileSync(target, JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 1 } } }));
    symlinkSync(target, link);
    const result = measureProviderCache(link);
    assert.equal(result.status, "UNPROVEN");
    assert.equal(result.reason, "transcript-non-regular");
    assert.equal(result.cacheHitRate, null);
    assert.equal(result.cacheReadRate, null);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("rule dedup measurement reports counts and a numeric duplicate rate without rule text", () => {
  const result = measureRuleDedup([
    { body: " SAME BODY\r\n" },
    { body: "SAME BODY" },
    { body: "SECOND BODY" },
    { body: "   " },
  ]);

  assert.equal(result.status, "MEASURED");
  assert.equal(result.candidateRuleCount, 4);
  assert.equal(result.usableRuleCount, 3);
  assert.equal(result.uniqueRuleCount, 2);
  assert.equal(result.duplicateRuleCount, 1);
  assert.equal(result.dedupRate, 33.33);
  assert.doesNotMatch(JSON.stringify(result), /SAME BODY|SECOND BODY/u);
});

test("rule dedup measurement remains UNPROVEN without usable rules", () => {
  assert.deepEqual(measureRuleDedup([]), {
    status: "UNPROVEN",
    reason: "no-usable-rules",
    candidateRuleCount: 0,
    usableRuleCount: 0,
    uniqueRuleCount: 0,
    duplicateRuleCount: 0,
    dedupRate: null,
  });
  assert.equal(measureRuleDedup(null).reason, "rules-not-provided");
});

// A long session: usage records early on, megabytes of tool output, the latest usage near the end.
const writeLongTranscript = (path, { megabytes, tailUsage = true }) => {
  const usageLine = (input) => `${JSON.stringify({ type: "assistant", message: { usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } })}\n`;
  const filler = `${JSON.stringify({ type: "user", message: { content: "x".repeat(64 * 1024) } })}\n`;
  const fd = openSync(path, "w");
  try {
    writeSync(fd, usageLine(111));
    for (let written = 0; written < megabytes * 1024 * 1024; written += filler.length) writeSync(fd, filler);
    if (tailUsage) writeSync(fd, usageLine(150000));
    writeSync(fd, `${JSON.stringify({ type: "user", message: { content: "latest prompt" } })}\n`);
  } finally {
    closeSync(fd);
  }
};

test("latest usage reads the tail of a transcript larger than the bounded-read limit", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "long.jsonl");
    writeLongTranscript(path, { megabytes: 12 });
    assert.equal(latestUsageTokens(path), 150000);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("latest usage stays unknown when a large transcript has no usage record near its end", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "long.jsonl");
    writeLongTranscript(path, { megabytes: 12, tailUsage: false });
    assert.equal(latestUsageTokens(path), 0, "an old record beyond the tail window must not be reported");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("latest usage refuses a symlinked large transcript", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "long.jsonl");
    writeLongTranscript(path, { megabytes: 12 });
    const link = join(temp, "link.jsonl");
    symlinkSync(path, link);
    assert.equal(latestUsageTokens(link), 0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

const TAIL_WINDOW = 2 * 1024 * 1024;
const usageRecord = (input) => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } });

// 12 MiB of filler, then the latest usage record starting `offsetFromWindow` bytes after the
// start of the 2 MiB tail window (negative: before it), then padding up to the window's end.
const writeWindowFixture = (path, offsetFromWindow, eol = "\n") => {
  const record = `${usageRecord(150000)}${eol}`;
  const padLine = `${JSON.stringify({ type: "user", message: { content: "p".repeat(1000) } })}${eol}`;
  const tailBytes = TAIL_WINDOW - offsetFromWindow;
  let padding = "";
  while (padding.length + padLine.length <= tailBytes - record.length) padding += padLine;
  const lastLineFill = tailBytes - record.length - padding.length;
  const fillerLine = `${JSON.stringify({ type: "user", message: { content: "x".repeat(64 * 1024) } })}${eol}`;
  const head = `${usageRecord(111)}${eol}${fillerLine.repeat(12 * 16)}`;
  writeFileSync(path, `${head}${record}${padding}${"z".repeat(Math.max(0, lastLineFill - eol.length))}${lastLineFill >= eol.length ? eol : ""}`);
};

test("a tail window that starts exactly on a record keeps that record", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "boundary.jsonl");
    writeWindowFixture(path, 0);
    assert.equal(latestUsageTokensInTail(path, TAIL_WINDOW).tokens, 150000);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("a record that straddles the 2 MiB window is found through the 8 MiB read", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "straddle.jsonl");
    writeWindowFixture(path, -100);
    assert.equal(latestUsageTokensInTail(path, TAIL_WINDOW).tokens, 0, "the cut record must not be parsed from the short tail");
    assert.equal(latestUsageTokens(path), 150000);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("latest usage reads a large CRLF transcript", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "crlf.jsonl");
    writeWindowFixture(path, 4096, "\r\n");
    assert.equal(latestUsageTokens(path), 150000);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("the cached reader reuses its answer until the transcript changes", () => {
  const temp = makeTemp();
  try {
    const path = join(temp, "long.jsonl");
    const cachePath = join(temp, "hud", "usage-s1.json");
    writeLongTranscript(path, { megabytes: 12 });
    assert.equal(latestUsageTokensCached(path, cachePath), 150000);
    assert.equal(existsSync(cachePath), true);
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    writeFileSync(cachePath, JSON.stringify({ ...cached, tokens: 42 }));
    assert.equal(latestUsageTokensCached(path, cachePath), 42, "an unchanged transcript is not read again");
    appendFileSync(path, `${usageRecord(160000)}\n`);
    assert.equal(latestUsageTokensCached(path, cachePath), 160000, "a changed transcript is read again");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
