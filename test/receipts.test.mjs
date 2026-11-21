// Row 3: the receipt ledger. The fixtures follow the payloads Claude Code 2.1.330 sent on a real run:
// a passing Bash call reaches PostToolUse with `tool_response` {stdout, stderr, interrupted, isImage,
// noOutputExpected} and no exit field; a non-zero exit reaches PostToolUseFailure instead, with
// `error: "Exit code <n>\n..."` and `is_interrupt`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { startWorkflowStage } from "../plugins/litclaude/lib/workflow-stage.mjs";
import { editPayload, failingBash, passingBash, receiptHarness, SENTINELS, SID } from "./helpers/receipt-harness.mjs";

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
    assert.match(receipts[0].codeSha, /^[0-9a-f]{64}$/u);
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
    assert.equal(h.receipts()[0].codeSha, null);
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

const preBash = (h, command, extra = {}) => h.run("pre-tool-use", {
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command, description: "run", ...extra },
});

const rewrittenCommand = (h, command, extra = {}) => {
  const result = preBash(h, command, extra);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes("permissionDecision"), false, result.stdout);
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : {};
  return parsed.hookSpecificOutput?.updatedInput?.command ?? null;
};

describe("piped check receipts (gap 2)", () => {
  const activate = (h) => startWorkflowStage(h.project, { sessionId: SID, skill: "lit-loop" });

  it("records exit 1 for a failing npm test | tail, and exit 0 when that check passes", () => {
    const failing = receiptHarness();
    activate(failing);
    const failCommand = rewrittenCommand(failing, "npm test | tail -20");
    assert.ok(failCommand, "a gated piped check is rewritten");
    const failRun = spawnSync("bash", ["-c", failCommand], { cwd: failing.project, encoding: "utf8" });
    assert.equal(failRun.status, 0, failRun.stderr);
    failing.run("post-tool-use", passingBash(failCommand));
    assert.equal(failing.receipts()[0].exit, 1);
    assert.equal(failing.receipts()[0].check, "npm test");
    assert.equal(existsSync(join(failing.dir, "check-rc")), false);

    const passing = receiptHarness();
    activate(passing);
    writeFileSync(join(passing.project, "t.js"), "process.exit(0)\n");
    const passCommand = rewrittenCommand(passing, "npm test | tail -20");
    spawnSync("bash", ["-c", passCommand], { cwd: passing.project, encoding: "utf8" });
    passing.run("post-tool-use", passingBash(passCommand));
    assert.equal(passing.receipts()[0].exit, 0);
    assert.equal(passing.receipts()[0].check, "npm test");
  });

  it("keeps the real exit in $? for npm test; echo, and the receipt matches it", () => {
    const h = receiptHarness();
    activate(h);
    writeFileSync(join(h.project, "t.js"), "process.exit(0)\n");
    const command = rewrittenCommand(h, "npm test; echo \"exit=$?\"");
    const ran = spawnSync("bash", ["-c", command], { cwd: h.project, encoding: "utf8" });
    assert.match(ran.stdout, /exit=0/u);
    h.run("post-tool-use", passingBash(command));
    assert.equal(h.receipts()[0].exit, 0);
    assert.equal(h.receipts()[0].check, "npm test");
  });

  it("leaves a non-check, a background run, pipefail, and an inactive session untouched", () => {
    const h = receiptHarness();
    activate(h);
    assert.equal(rewrittenCommand(h, "ls | tail"), null);
    assert.equal(rewrittenCommand(h, "npm test | tail", { run_in_background: true }), null);
    assert.equal(rewrittenCommand(h, "npm test | tail &"), null);
    assert.equal(rewrittenCommand(h, "set -o pipefail && npm test | tail"), null);
    const idle = receiptHarness();
    assert.equal(rewrittenCommand(idle, "npm test | tail"), null);
  });

  it("does not rewrite when the sessions directory is a symlink", () => {
    const h = receiptHarness();
    const elsewhere = join(h.temp, "elsewhere");
    mkdirSync(join(h.project, ".litclaude"), { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(h.project, ".litclaude", "sessions"));
    activate(h);
    assert.equal(rewrittenCommand(h, "npm test | tail"), null);
  });
});

describe("leading && chain receipts", () => {
  const activate = (h) => startWorkflowStage(h.project, { sessionId: SID, skill: "lit-loop" });

  it("records exit 1 for true && npm test; echo, and the echo still sees 1", () => {
    const h = receiptHarness();
    activate(h);
    const original = "true && npm test; echo \"exit=$?\"";
    const command = rewrittenCommand(h, original);
    assert.equal(command.startsWith("true && { npm test;"), true, command);
    assert.equal(command.endsWith("; echo \"exit=$?\""), true, command);
    const ran = spawnSync("bash", ["-c", command], { cwd: h.project, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /exit=1/u);
    h.run("post-tool-use", passingBash(command));
    assert.equal(h.receipts().length, 1);
    assert.equal(h.receipts()[0].exit, 1);
    assert.equal(h.receipts()[0].check, "npm test");
    assert.equal(existsSync(join(h.dir, "check-rc")), false);
  });

  it("records exit 0 for a passing true && npm test | tail -3", () => {
    const h = receiptHarness();
    activate(h);
    writeFileSync(join(h.project, "t.js"), "process.exit(0)\n");
    const command = rewrittenCommand(h, "true && npm test | tail -3");
    assert.equal(command.startsWith("true && { npm test;"), true, command);
    assert.equal(command.endsWith("| tail -3"), true, command);
    const ran = spawnSync("bash", ["-c", command], { cwd: h.project, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    h.run("post-tool-use", passingBash(command));
    assert.equal(h.receipts().length, 1);
    assert.equal(h.receipts()[0].exit, 0);
    assert.equal(h.receipts()[0].check, "npm test");
    assert.equal(existsSync(join(h.dir, "check-rc")), false);
  });

  it("writes no receipt and no rc file when an earlier && part fails", () => {
    const h = receiptHarness();
    activate(h);
    mkdirSync(h.dir, { recursive: true });
    writeFileSync(join(h.dir, "check-rc"), "0\n");
    const command = rewrittenCommand(h, "false && npm test; echo x");
    assert.equal(existsSync(join(h.dir, "check-rc")), false);
    assert.equal(command.startsWith("false && { npm test;"), true, command);
    assert.equal(command.endsWith("; echo x"), true, command);
    const ran = spawnSync("bash", ["-c", command], { cwd: h.project, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /^x\n$/u);
    assert.equal(existsSync(join(h.dir, "check-rc")), false);
    h.run("post-tool-use", passingBash(command));
    assert.deepEqual(h.receipts(), []);
    assert.equal(existsSync(join(h.dir, "check-rc")), false);
  });

  it("keeps a quoted semicolon in an earlier && part outside the wrap", () => {
    const h = receiptHarness();
    activate(h);
    const original = "sed -i '' 's/=> a + b;/=> 0;/' index.js && cat index.js && npm test; echo \"exit=$?\"";
    const command = rewrittenCommand(h, original);
    const head = "sed -i '' 's/=> a + b;/=> 0;/' index.js && cat index.js && ";
    assert.equal(command.startsWith(`${head}{ npm test;`), true, command);
    assert.equal(command.endsWith("; echo \"exit=$?\""), true, command);
  });

  it("does not rewrite when the check is not the last && element, or || appears before it", () => {
    const h = receiptHarness();
    activate(h);
    assert.equal(rewrittenCommand(h, "npm test && true; echo x"), null);
    assert.equal(rewrittenCommand(h, "a || npm test; echo"), null);
    assert.equal(rewrittenCommand(h, "true || false && npm test; echo x"), null);
    assert.equal(rewrittenCommand(h, "true && npm test | tail -3", { run_in_background: true }), null);
    assert.equal(rewrittenCommand(h, "set -o pipefail && true && npm test | tail -3"), null);
    const idle = receiptHarness();
    assert.equal(rewrittenCommand(idle, "true && npm test; echo x"), null);
  });
});
