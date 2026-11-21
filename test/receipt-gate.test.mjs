// Row 4: the Stop receipt gate. It speaks only for a session that ran lit-loop, litwork or start-work
// and edited code; `receiptGate` (off | shadow | enforce, default shadow) picks warn or block.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { startWorkflowStage } from "../plugins/litclaude/lib/workflow-stage.mjs";
import { editPayload, passingBash, failingBash, receiptHarness, repoRoot, SID } from "./helpers/receipt-harness.mjs";

const SHADOW_MESSAGE = "LitClaude: code changed after the last passing npm test run; no passing check since.";

const gateHarness = ({ mode, activate = true } = {}) => {
  const h = receiptHarness();
  if (mode) {
    mkdirSync(h.env.LITCLAUDE_HOME, { recursive: true });
    writeFileSync(join(h.env.LITCLAUDE_HOME, "config.json"), `${JSON.stringify({ receiptGate: mode })}\n`);
  }
  if (activate) startWorkflowStage(h.project, { sessionId: SID, skill: "lit-loop" });
  const stop = (extra = {}) => {
    const result = h.run("stop", { hook_event_name: "Stop", stop_hook_active: false, ...extra });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
  };
  const gateLog = () => (existsSync(join(h.dir, "receipt-gate.jsonl"))
    ? readFileSync(join(h.dir, "receipt-gate.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    : []);
  return { ...h, stop, gateLog, editCode: () => h.run("post-tool-use", editPayload(join(h.project, "src", "a.js"))) };
};

describe("Stop receipt gate (row 4)", () => {
  it("(1) shadow by default: warns once and logs a line, never blocks", () => {
    // Given a lit-loop session that edited code and ran no check, with no receiptGate set
    const h = gateHarness();
    h.editCode();
    // When the session stops
    const output = h.stop();
    // Then a warning, no block, and one gate line
    assert.deepEqual(output, { systemMessage: SHADOW_MESSAGE });
    assert.equal(h.gateLog().length, 1);
    assert.equal(h.gateLog()[0].action, "warn");
  });

  it("(2) enforce cap, a safeguard if the host never re-enters: blocks twice for one prompt, then stops the session", () => {
    const h = gateHarness({ mode: "enforce" });
    h.editCode();
    const first = h.stop();
    const second = h.stop();
    const third = h.stop();
    assert.equal(first.decision, "block");
    assert.match(first.reason, /npm test/u);
    // A piped or `;`-chained run leaves no receipt, so the reason asks for the check on its own.
    assert.match(first.reason, /on its own/u);
    assert.equal(second.decision, "block");
    assert.equal(third.continue, false);
    assert.match(third.stopReason, /npm test/u);
  });

  it("(3) a passing receipt newer than the edit is silent", () => {
    const h = gateHarness({ mode: "enforce" });
    h.editCode();
    h.run("post-tool-use", passingBash("npm test"));
    assert.equal(h.stop(), null);
  });

  it("(4) a failing receipt alone still warns", () => {
    const h = gateHarness();
    h.editCode();
    h.run("post-tool-use-failure", failingBash("npm test"));
    assert.deepEqual(h.stop(), { systemMessage: SHADOW_MESSAGE });
  });

  it("(5) doc-only edits are silent", () => {
    const h = gateHarness({ mode: "enforce" });
    h.run("post-tool-use", editPayload(join(h.project, "README.md"), "Write"));
    h.run("post-tool-use", editPayload(join(h.project, "docs", "notes.txt")));
    assert.equal(h.stop(), null);
  });

  it("(2b) enforce, as the host runs it: one block, then the re-entered Stop goes through", () => {
    // Given an enforce session that edited code and ran no check
    const h = gateHarness({ mode: "enforce" });
    h.editCode();
    // When it stops, and the host re-enters Stop with stop_hook_active after the block
    const first = h.stop();
    const reentered = h.stop({ stop_hook_active: true });
    // Then one block for the prompt, and the re-entered Stop is let through
    assert.equal(first.decision, "block");
    assert.equal(reentered, null);
  });

  it("(6) stop_hook_active in enforce does not block", () => {
    const h = gateHarness({ mode: "enforce" });
    h.editCode();
    assert.equal(h.stop({ stop_hook_active: true }), null);
  });

  it("(7) a session that never activated lit-loop, litwork or start-work is silent", () => {
    const h = gateHarness({ mode: "enforce", activate: false });
    h.editCode();
    assert.equal(h.stop(), null);
  });

  it("off mode is silent", () => {
    const h = gateHarness({ mode: "off" });
    h.editCode();
    assert.equal(h.stop(), null);
  });

  it("a project with no detected check and no receipt is silent", () => {
    const h = gateHarness({ mode: "enforce" });
    writeFileSync(join(h.project, "package.json"), "{}\n");
    h.editCode();
    assert.equal(h.stop(), null);
  });

  it("warns when code was written from the shell, and a passing receipt of that tree is silent", () => {
    const h = gateHarness();
    writeFileSync(join(h.project, "src", "a.js"), "export const n = 2;\n");
    assert.deepEqual(h.stop(), { systemMessage: SHADOW_MESSAGE });
    h.run("post-tool-use", passingBash("npm test"));
    assert.equal(h.stop(), null);
  });

  it("stays silent for a doc-only working-tree change", () => {
    const h = gateHarness({ mode: "enforce" });
    mkdirSync(join(h.project, "docs"), { recursive: true });
    writeFileSync(join(h.project, "README.md"), "notes\n");
    writeFileSync(join(h.project, "docs", "a.js"), "export const doc = 1;\n");
    assert.equal(h.stop(), null);
  });

  it("stays silent after a commit of a tree that already passed", () => {
    const h = gateHarness({ mode: "enforce" });
    writeFileSync(join(h.project, "src", "a.js"), "export const n = 3;\n");
    h.run("post-tool-use", passingBash("npm test"));
    assert.equal(h.stop(), null);
    spawnSync("git", ["add", "src/a.js"], { cwd: h.project });
    assert.equal(h.stop(), null);
    const committed = spawnSync("git", ["-c", "user.email=f@x", "-c", "user.name=f", "commit", "-q", "-m", "save"], { cwd: h.project });
    assert.equal(committed.status, 0, committed.stderr?.toString());
    assert.equal(h.stop(), null);
  });

  it("keeps the edit-time rule outside a git repository", () => {
    const h = receiptHarness({ git: false });
    mkdirSync(h.env.LITCLAUDE_HOME, { recursive: true });
    writeFileSync(join(h.env.LITCLAUDE_HOME, "config.json"), `${JSON.stringify({ receiptGate: "shadow" })}\n`);
    startWorkflowStage(h.project, { sessionId: SID, skill: "lit-loop" });
    writeFileSync(join(h.project, "src", "a.js"), "export const n = 4;\n");
    const stop = () => {
      const result = h.run("stop", { hook_event_name: "Stop", stop_hook_active: false });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
    };
    assert.equal(stop(), null);
    h.run("post-tool-use", editPayload(join(h.project, "src", "a.js")));
    assert.deepEqual(stop(), { systemMessage: SHADOW_MESSAGE });
    h.run("post-tool-use", passingBash("npm test"));
    assert.equal(stop(), null);
  });

  it("fails open on unreadable state", () => {
    const h = gateHarness({ mode: "enforce" });
    h.editCode();
    writeFileSync(join(h.dir, "receipts.jsonl"), "{not json\n");
    mkdirSync(join(h.dir, "receipt-gate.jsonl"));
    assert.equal(h.stop(), null);
  });
});

describe("litclaude-ai config receiptGate", () => {
  const cli = (env, ...args) => spawnSync(process.execPath, [join(repoRoot, "bin", "litclaude-ai.js"), "config", ...args], { env, encoding: "utf8" });

  it("lists receiptGate with its default and stores a new value", () => {
    const h = receiptHarness();
    assert.match(cli(h.env).stdout, /receiptGate shadow\s+\(off, shadow, enforce\)/u);
    const set = cli(h.env, "receiptGate", "enforce");
    assert.equal(set.status, 0, set.stderr);
    assert.equal(JSON.parse(readFileSync(join(h.env.LITCLAUDE_HOME, "config.json"), "utf8")).receiptGate, "enforce");
  });

  it("refuses an unknown value", () => {
    const h = receiptHarness();
    assert.equal(cli(h.env, "receiptGate", "loud").status, 64);
  });
});
