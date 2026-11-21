// Row 3: the receipt ledger. The fixtures follow the payloads Claude Code 2.1.330 sent on a real run:
// a passing Bash call reaches PostToolUse with `tool_response` {stdout, stderr, interrupted, isImage,
// noOutputExpected} and no exit field; a non-zero exit reaches PostToolUseFailure instead, with
// `error: "Exit code <n>\n..."` and `is_interrupt`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { editPayload, failingBash, passingBash, receiptHarness, SENTINELS } from "./helpers/receipt-harness.mjs";

const receiptsLib = () => import("../plugins/litclaude/lib/receipts.mjs");

describe("receipt ledger from PostToolUse (row 3)", () => {
  it("records one passing receipt with exit 0 for npm test", () => {
    // Given a git project and a session
    const h = receiptHarness();
    // When PostToolUse reports a passing `npm test`
    const result = h.run("post-tool-use", passingBash("npm test"));
    // Then one receipt with exit 0, the check name, an output hash and a tree hash is written
    assert.equal(result.status, 0, result.stderr);
    const receipts = h.receipts();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].exit, 0);
    assert.equal(receipts[0].check, "npm test");
    assert.match(receipts[0].outputSha256, /^[0-9a-f]{64}$/u);
    assert.match(receipts[0].treeSha, /^[0-9a-f]{64}$/u);
    assert.ok(Number.isFinite(Date.parse(receipts[0].at)));
  });

  it("records a failing receipt from PostToolUseFailure with a non-zero exit", () => {
    const h = receiptHarness();
    h.run("post-tool-use-failure", failingBash("npm test", 3));
    const receipts = h.receipts();
    assert.equal(receipts.length, 1);
    assert.notEqual(receipts[0].exit, 0);
    assert.equal(receipts[0].exit, 3);
  });

  it("records no receipt for a command that is not a check", () => {
    const h = receiptHarness();
    h.run("post-tool-use", passingBash("ls -la"));
    h.run("post-tool-use-failure", failingBash("ls missing"));
    assert.deepEqual(h.receipts(), []);
  });

  it("records no receipt for a background run, which reaches PostToolUse before any result", () => {
    // Given a check started with run_in_background, and one the host reports by background task id
    const h = receiptHarness();
    const background = passingBash("npm test");
    background.tool_input.run_in_background = true;
    const byTaskId = passingBash("npm test");
    byTaskId.tool_response.backgroundTaskId = "bash_1";
    // When PostToolUse reports each start
    h.run("post-tool-use", background);
    h.run("post-tool-use", byTaskId);
    // Then no receipt claims a pass
    assert.deepEqual(h.receipts(), []);
  });

  it("skips the tree hash outside a git repository", () => {
    const h = receiptHarness({ git: false });
    h.run("post-tool-use", passingBash("npm test"));
    assert.equal(h.receipts()[0].treeSha, null);
  });

  it("updates lastCodeEditAt for a code edit and not for a README edit", () => {
    const h = receiptHarness();
    h.run("post-tool-use", editPayload(join(h.project, "README.md"), "Write"));
    h.run("post-tool-use", editPayload(join(h.project, "docs", "guide.js")));
    assert.equal(h.edits(), null);
    h.run("post-tool-use", editPayload(join(h.project, "src", "a.js")));
    assert.ok(Number.isFinite(Date.parse(h.edits()?.lastCodeEditAt)));
  });

  it("stores no prompt, argument or output text", () => {
    const h = receiptHarness();
    h.run("post-tool-use", passingBash("npm test -- --grep SENTINEL_ARG_7f3"));
    h.run("post-tool-use-failure", failingBash("npm test -- SENTINEL_ARG_7f3"));
    h.run("post-tool-use", editPayload(join(h.project, "src", "a.js")));
    const stored = ["receipts.jsonl", "edits.json"].map((name) => readFileSync(join(h.dir, name), "utf8")).join("\n");
    assert.equal(h.receipts().length, 2);
    for (const sentinel of SENTINELS) assert.equal(stored.includes(sentinel), false, sentinel);
  });
});

describe("check command normalisation", () => {
  it("keeps only the command name and script name", async () => {
    const { normalizeCheck } = await receiptsLib();
    const cases = {
      "npm test": "npm test",
      "npm test -- --grep x": "npm test",
      "npm run test:unit -- foo": "npm run test:unit",
      "node --test test/a.test.mjs": "node --test",
      "pytest -k slow tests/": "pytest",
      "cargo test parser": "cargo test",
      "go test ./...": "go test",
      "cd sub && npm test 2>&1": "npm test",
      "CI=1 npm test": "npm test",
      "npm run build": null,
      ls: null,
      "npm test | tail -5": null,
      "npm test; true": null,
      "npm test || true": null,
      "echo npm test": null,
      "npm test &": null,
      "$(npm test)": null,
    };
    for (const [command, expected] of Object.entries(cases)) assert.equal(normalizeCheck(command), expected, command);
  });
});
