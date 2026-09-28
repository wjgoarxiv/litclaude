// test/legacy-token-scan.test.mjs — T04 legacy-token scanner tests.
//
// Unit-tests the pure matcher helpers and proves the checkout has zero guarded
// term hits with no allowed exceptions.
//
// Self-immunity: any guarded token referenced below is assembled from fragments so this file
// never trips the scanner on itself.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  matchToken,
  scanText,
  runScan,
  loadExternalTerms,
  runExternalTermScan,
  LEGACY_TOKENS,
  DEFAULT_MATCH_MODES,
  LEGACY_TOKEN_IDS,
} from "../tools/scan-legacy-tokens.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCANNER_PATH = fileURLToPath(new URL("../tools/scan-legacy-tokens.mjs", import.meta.url));

// Assembled fragments — no literal guarded token in this source.
const TERM0 = ["o", "m", "o"].join("");
const TERM1 = ["lazy", "claude"].join("");
const TERM2 = ["oh-my-", "open", "agent"].join("");
const TERM3 = ["lazy", "codex"].join("");
const TERM4 = ["sisyphus", "labs"].join("");
const TERM5 = ["code-yeong", "yu"].join("");
const TERM6 = ["github.com/code-yeong", "yu/"].join("");

// ---------------------------------------------------------------------------
// Unit tests — matchToken (bounded)
// ---------------------------------------------------------------------------

test("bounded match: short term 0 false positives are rejected", () => {
  // These must NOT match (word chars on at least one side).
  assert.deepEqual(matchToken("chromosome", TERM0, "bounded"), []);
  assert.deepEqual(matchToken("promo", TERM0, "bounded"), []);
  assert.deepEqual(matchToken("omokit", TERM0, "bounded"), []);
  assert.deepEqual(matchToken("promotion", TERM0, "bounded"), []);
  assert.deepEqual(matchToken("ономика", TERM0, "bounded"), []); // non-ASCII context
});

test("bounded match: short term 0 true positives hit", () => {
  // These MUST match (non-word chars on both sides, or at string edges).
  assert.ok(matchToken(`.${TERM0}/`, TERM0, "bounded").length > 0, "dotted path fixture should match");
  assert.ok(matchToken(TERM0, TERM0, "bounded").length > 0, "standalone fixture should match");
  assert.ok(matchToken(` ${TERM0} `, TERM0, "bounded").length > 0, "space-padded fixture should match");
  assert.ok(matchToken(`${TERM0}-config`, TERM0, "bounded").length > 0, "hyphenated fixture should match");
  assert.ok(matchToken(`/${TERM0}`, TERM0, "bounded").length > 0, "slash-prefixed fixture should match");
});

test("bounded match: short term 1 true positives hit", () => {
  assert.ok(matchToken(TERM1, TERM1, "bounded").length > 0, "standalone should match");
  assert.ok(matchToken(`${TERM1}-ai`, TERM1, "bounded").length > 0, "hyphenated fixture should match");
  assert.ok(matchToken(`/${TERM1}`, TERM1, "bounded").length > 0, "slash-prefixed fixture should match");
});

test("substring match: long unique tokens hit even mid-word", () => {
  for (const tok of [TERM2, TERM3, TERM4]) {
    assert.ok(matchToken(tok, tok, "substring").length > 0, `${tok} should match standalone`);
    assert.ok(matchToken(`x-${tok}-y`, tok, "substring").length > 0, `${tok} should match embedded`);
  }
});

test("bounded match: short term 1 has no spurious substring match inside longer word", () => {
  // Confirm bounded semantics — a word char immediately after blocks the match.
  assert.deepEqual(matchToken(`${TERM1}xyz`, TERM1, "bounded"), []);
  assert.deepEqual(matchToken(`prefix${TERM1}`, TERM1, "bounded"), []);
});

// ---------------------------------------------------------------------------
// Unit tests — tokens that must NEVER be guarded
// ---------------------------------------------------------------------------

test("never-guarded tokens are absent from LEGACY_TOKENS", () => {
  const neverGuard = ["lit", "litwork", "litgoal", "litclaude", "claude"];
  for (const tok of neverGuard) {
    assert.equal(
      LEGACY_TOKENS.includes(tok),
      false,
      `"${tok}" must not appear in LEGACY_TOKENS (D20 / never-guarded set)`,
    );
  }
});

test("now-guarded old vocab tokens ARE present in LEGACY_TOKENS (D20)", () => {
  const nowGuarded = [["u","l","w"].join(""), ["ultra","work"].join(""), ["ultra","goal"].join("")];
  for (const tok of nowGuarded) {
    assert.equal(
      LEGACY_TOKENS.includes(tok),
      true,
      `"${tok}" must appear in LEGACY_TOKENS (D20 policy inversion)`,
    );
  }
});

test("never-guarded tokens produce no hits via scanText", () => {
  const neverGuard = ["lit", "litwork", "litgoal", "litclaude", "claude"];
  const hay = neverGuard.join(" ");
  const hits = scanText("dummy.txt", hay);
  assert.deepEqual(hits, [], `scanText should not flag: ${hay}`);
});

// ---------------------------------------------------------------------------
// Unit tests — LEGACY_TOKENS contents and match modes
// ---------------------------------------------------------------------------

test("LEGACY_TOKENS contains exactly 10 entries", () => {
  assert.equal(LEGACY_TOKENS.length, 10);
});

test("the first two guarded terms use bounded mode", () => {
  assert.equal(DEFAULT_MATCH_MODES[TERM0], "bounded");
  assert.equal(DEFAULT_MATCH_MODES[TERM1], "bounded");
});

test("origin guard terms use substring mode", () => {
  assert.equal(DEFAULT_MATCH_MODES[TERM5], "substring");
  assert.equal(DEFAULT_MATCH_MODES[TERM6], "substring");
});

test("guarded terms have opaque report ids", () => {
  assert.equal(Object.keys(LEGACY_TOKEN_IDS).length, LEGACY_TOKENS.length);
  for (const token of LEGACY_TOKENS) {
    assert.match(LEGACY_TOKEN_IDS[token], /^guard-\d{2}$/u);
    assert.equal(LEGACY_TOKEN_IDS[token].includes(token), false);
  }
});

// ---------------------------------------------------------------------------
// Unit tests — scanText multi-hit and context
// ---------------------------------------------------------------------------

test("scanText returns correct line/column for a bounded hit", () => {
  const text = `line one\n.${TERM0}/dir\nline three`;
  const hits = scanText("test.txt", text);
  const termHits = hits.filter((h) => h.token === TERM0);
  assert.ok(termHits.length > 0, "should find guarded hit");
  assert.equal(termHits[0].line, 2, "hit should be on line 2");
  assert.equal(termHits[0].column, 2, "hit column: offset 1 (0-indexed) + 1 = 2");
});

test("scanText does not flag the never-guarded token set", () => {
  const text = ["lit", "litwork", "litgoal", "litclaude", "claude"].join(" ");
  const hits = scanText("dummy.txt", text);
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------
// CLI integration — the tracked checkout must exit 0
// ---------------------------------------------------------------------------

test("CLI: scanner exits 0 on the guarded-token-clean tree", () => {
  const result = spawnSync(
    process.execPath,
    [SCANNER_PATH, "--repo-root", REPO_ROOT],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(
    result.status,
    0,
    `Expected exit 0 on post-rename tree; got ${result.status}. stderr: ${result.stderr.slice(0, 400)}`,
  );
  assert.match(result.stdout, /snapshot captured-enumerated-files/u);
  assert.match(result.stdout, /sha256 [0-9a-f]{64}/u);
  assert.match(result.stdout, /does not prove the mutable live tree remained clean/u);
});

test("runScan: report is clean with no offenders, no dead entries, no errors", async () => {
  const allowlistPath = fileURLToPath(
    new URL("../tools/legacy-token-allowlist.json", import.meta.url),
  );
  const report = runScan({ repoRoot: REPO_ROOT, allowlistPath });

  assert.equal(report.ok, true, `report.ok must be true on post-rename tree: ${JSON.stringify(report.errors)}`);
  assert.equal(report.offenders.length, 0, "offenders array must be empty");
  assert.equal(report.deadEntries.length, 0, "compatibility allowlist must have no dead entries");
  assert.equal(report.allowlistedHits, 0, "guarded hits must not be exempted");
  assert.equal(report.errors.length, 0, "no schema/git errors");
  assert.equal(report.snapshotScope, "captured-enumerated-files");
  assert.equal(report.snapshotFileCount > 0, true);
  assert.match(report.snapshotDigest, /^[0-9a-f]{64}$/u);
  assert.equal("liveTreeClean" in report, false);
  const replay = runScan({ repoRoot: REPO_ROOT, allowlistPath });
  assert.equal(replay.snapshotDigest, report.snapshotDigest, "unchanged captured bytes must have one deterministic digest");
  assert.equal(replay.snapshotFileCount, report.snapshotFileCount);
});

test("scanner retains captured buffers directly and enforces typed per-file and aggregate limits", () => {
  const source = readFileSync(SCANNER_PATH, "utf8");
  assert.doesNotMatch(source, /contentBase64|toString\("base64"\)|Buffer\.from\(captured/u);

  const perFileRoot = mkdtempSync(join(tmpdir(), "litclaude-scan-file-limit-"));
  const aggregateRoot = mkdtempSync(join(tmpdir(), "litclaude-scan-aggregate-limit-"));
  try {
    for (const fixture of [perFileRoot, aggregateRoot]) {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      writeFileSync(join(fixture, "tools", "legacy-token-allowlist.json"), '{"version":1,"entries":[]}\n');
      spawnSync("git", ["init", "-q"], { cwd: fixture });
    }

    writeFileSync(join(perFileRoot, "oversized.bin"), "");
    truncateSync(join(perFileRoot, "oversized.bin"), 8 * 1024 * 1024 + 1);
    const perFile = runScan({
      repoRoot: perFileRoot,
      allowlistPath: join(perFileRoot, "tools", "legacy-token-allowlist.json"),
    });
    assert.equal(perFile.ok, false);
    assert.ok(perFile.errors.some(({ code }) => code === "LITCLAUDE_SCAN_FILE_TOO_LARGE"), JSON.stringify(perFile.errors));

    for (let index = 0; index < 5; index += 1) {
      const chunk = join(aggregateRoot, `chunk-${index}.bin`);
      writeFileSync(chunk, "");
      truncateSync(chunk, 7 * 1024 * 1024);
    }
    const aggregate = runScan({
      repoRoot: aggregateRoot,
      allowlistPath: join(aggregateRoot, "tools", "legacy-token-allowlist.json"),
    });
    assert.equal(aggregate.ok, false);
    assert.ok(aggregate.errors.some(({ code }) => code === "LITCLAUDE_SCAN_AGGREGATE_TOO_LARGE"), JSON.stringify(aggregate.errors));
  } finally {
    rmSync(perFileRoot, { recursive: true, force: true });
    rmSync(aggregateRoot, { recursive: true, force: true });
  }
});

test("CLI: --help exits 0 and prints usage", () => {
  const result = spawnSync(process.execPath, [SCANNER_PATH, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test("CLI: unknown flag exits 2 (usage error)", () => {
  const result = spawnSync(process.execPath, [SCANNER_PATH, "--unknown-flag"], { encoding: "utf8" });
  assert.equal(result.status, 2);
});

test("external-term scanner reports opaque ids without raw term or context", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-external-scan-repo-"));
  const termRoot = mkdtempSync(join(tmpdir(), "litclaude-external-terms-"));
  const rawTerm = ["fixture", "secret"].join("-");
  const termFile = join(termRoot, "terms.json");
  try {
    spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "probe.txt"), `do not leak ${rawTerm} in reports\n`);
    writeFileSync(termFile, JSON.stringify({
      version: 1,
      terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
    }));

    const terms = loadExternalTerms(termFile);
    assert.deepEqual(terms, [{ id: "term-a", value: rawTerm, matchMode: "substring" }]);

    const report = runExternalTermScan({ repoRoot: dir, termsPath: termFile });
    assert.equal(report.ok, false);
    assert.equal(report.offenders.length, 1);
    assert.equal(report.offenders[0].termId, "term-a");
    assert.equal("token" in report.offenders[0], false);
    assert.equal("context" in report.offenders[0], false);
    assert.equal(JSON.stringify(report).includes(rawTerm), false);

    writeFileSync(join(dir, "docs", "probe.txt"), `do not leak ${rawTerm} in reports!\n`);
    const changed = runExternalTermScan({ repoRoot: dir, termsPath: termFile });
    assert.equal(changed.snapshotFileCount, report.snapshotFileCount);
    assert.notEqual(changed.snapshotDigest, report.snapshotDigest, "changed captured bytes must change the digest");

    const cli = spawnSync(process.execPath, [SCANNER_PATH, "--repo-root", dir, "--external-terms", termFile], {
      encoding: "utf8",
    });
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /docs\/probe\.txt:1:\d+ \[term-a\]/);
    assert.match(cli.stdout, /snapshot captured-enumerated-files, \d+ files, sha256 [0-9a-f]{64}/u);
    assert.equal(cli.stdout.includes(rawTerm), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(termRoot, { recursive: true, force: true });
  }
});

test("external-term scanner covers port residue classes with opaque ids only", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-source-residue-repo-"));
  const termRoot = mkdtempSync(join(tmpdir(), "litclaude-source-residue-terms-"));
  const termFile = join(termRoot, "terms.json");
  const owner = ["epo", "ko77-ai"].join("");
  const repo = ["im-not", "-ai"].join("");
  const commandAlias = ["human", "ize"].join("");
  const redoAlias = [commandAlias, "-redo"].join("");
  const marketplaceAlias = [["human", "ize"].join(""), "-korean"].join("");
  const residueCases = [
    { id: "ext-001", value: owner },
    { id: "ext-002", value: repo },
    { id: "ext-003", value: ["github.com/epo", "ko77-ai/", repo].join("") },
    { id: "ext-004", value: commandAlias },
    { id: "ext-005", value: redoAlias },
    { id: "ext-006", value: marketplaceAlias },
  ];
  try {
    spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    mkdirSync(join(dir, "docs"));
    writeFileSync(
      join(dir, "docs", "probe.txt"),
      residueCases.map((entry) => `candidate ${entry.id}: ${entry.value}`).join("\n"),
    );
    writeFileSync(
      termFile,
      JSON.stringify({
        version: 1,
        terms: residueCases.map((entry) => ({
          id: entry.id,
          value: entry.value,
          matchMode: "substring",
        })),
      }),
    );

    const report = runExternalTermScan({ repoRoot: dir, termsPath: termFile });
    assert.equal(report.ok, false);
    const reportedIds = new Set(report.offenders.map((offender) => offender.termId));
    for (const entry of residueCases) {
      assert.equal(reportedIds.has(entry.id), true);
    }
    for (const offender of report.offenders) {
      assert.deepEqual(Object.keys(offender).sort(), ["column", "line", "mode", "path", "termId"]);
    }

    const apiOutput = JSON.stringify(report);
    for (const entry of residueCases) {
      assert.equal(apiOutput.includes(entry.value), false);
    }

    const cli = spawnSync(
      process.execPath,
      [SCANNER_PATH, "--json", "--repo-root", dir, "--external-terms", termFile],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 1);
    const cliOutput = `${cli.stdout}\n${cli.stderr}`;
    for (const entry of residueCases) {
      assert.equal(cliOutput.includes(entry.value), false);
      assert.match(cliOutput, new RegExp(`"${entry.id}"`));
    }
    const cliReport = JSON.parse(cli.stdout);
    assert.equal(cliReport.ok, false);
    const cliReportedIds = new Set(cliReport.offenders.map((offender) => offender.termId));
    for (const entry of residueCases) {
      assert.equal(cliReportedIds.has(entry.id), true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(termRoot, { recursive: true, force: true });
  }
});
