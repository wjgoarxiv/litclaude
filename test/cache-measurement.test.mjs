import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  latestUsageTokensFromText,
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
