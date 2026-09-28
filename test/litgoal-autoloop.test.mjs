import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTOLOOP_MAX_BLOCKS,
  AUTOLOOP_MAX_MS,
  evaluateAutoloop,
} from "../plugins/litclaude/lib/litgoal/autoloop.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");

const goal = (over = {}) => ({
  version: 1,
  objective: "ship the thing",
  status: "active",
  autoloop: true,
  criteria: [{ id: "criterion-1", description: "tests pass", status: "pending", evidence: [] }],
  ...over,
});

// --- pure decision function (the safety-critical core) ----------------------

test("evaluateAutoloop: kill switch LITCLAUDE_GOAL_OFF=1 always allows stop", () => {
  const r = evaluateAutoloop({ env: { LITCLAUDE_GOAL_OFF: "1" }, state: goal() });
  assert.equal(r.action, "allow");
});

test("evaluateAutoloop: no goal / non-autoloop goal / completed goal -> allow", () => {
  assert.equal(evaluateAutoloop({ env: {}, state: null }).action, "allow");
  assert.equal(evaluateAutoloop({ env: {}, state: goal({ autoloop: false }) }).action, "allow");
  assert.equal(evaluateAutoloop({ env: {}, state: goal({ status: "complete" }) }).action, "allow");
});

test("evaluateAutoloop: all criteria pass -> allow stop", () => {
  const r = evaluateAutoloop({
    env: {},
    state: goal({ criteria: [{ id: "criterion-1", status: "pass" }] }),
  });
  assert.equal(r.action, "allow");
  assert.equal(r.why, "all-criteria-pass");
});

test("evaluateAutoloop: active autoloop + pending criterion -> block with snapshot", () => {
  const r = evaluateAutoloop({ env: {}, state: goal(), autoloopState: { blockCount: 0, firstBlockAt: 1000 }, now: 2000 });
  assert.equal(r.action, "block");
  assert.equal(r.nextCount, 1);
  assert.match(r.reason, /still active/u);
  assert.match(r.reason, /criterion-1/u);
  assert.match(r.reason, /record-evidence/u);
  assert.match(r.reason, /LITCLAUDE_GOAL_OFF=1/u);
});

test("evaluateAutoloop: block count cap -> hard stop (continue:false)", () => {
  const r = evaluateAutoloop({
    env: {},
    state: goal(),
    autoloopState: { blockCount: AUTOLOOP_MAX_BLOCKS, firstBlockAt: 1000 },
    now: 2000,
  });
  assert.equal(r.action, "cap");
  assert.match(r.stopReason, /safety cap/u);
});

test("evaluateAutoloop: time cap -> hard stop even below block cap", () => {
  const r = evaluateAutoloop({
    env: {},
    state: goal(),
    autoloopState: { blockCount: 1, firstBlockAt: 0 },
    now: AUTOLOOP_MAX_MS + 1,
  });
  assert.equal(r.action, "cap");
});

test("evaluateAutoloop: missing counter starts a fresh window and blocks once", () => {
  const r = evaluateAutoloop({ env: {}, state: goal(), autoloopState: null, now: 5000 });
  assert.equal(r.action, "block");
  assert.equal(r.nextCount, 1);
  assert.equal(r.firstBlockAt, 5000);
});

// --- hook end-to-end (spawned, real stdin/stdout) ---------------------------

const runStopHook = (cwd, env = {}) =>
  spawnSync(process.execPath, [hookPath, "stop"], {
    cwd: root,
    encoding: "utf8",
    input: `${JSON.stringify({ hook_event_name: "Stop", cwd })}\n`,
    env: { ...process.env, ...env },
  });

const seedGoal = (cwd, state) => {
  mkdirSync(join(cwd, ".litclaude", "litgoal"), { recursive: true });
  writeFileSync(join(cwd, ".litclaude", "litgoal", "goals.json"), JSON.stringify(state));
};

test("Stop hook: no litgoal in workspace -> empty output (allows stop)", () => {
  const ws = mkdtempSync(join(tmpdir(), "litgoal-autoloop-"));
  try {
    const r = runStopHook(ws);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("Stop hook: active autoloop goal with pending criterion -> decision:block", () => {
  const ws = mkdtempSync(join(tmpdir(), "litgoal-autoloop-"));
  try {
    seedGoal(ws, goal());
    const r = runStopHook(ws);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, "block");
    assert.match(out.reason, /criterion-1/u);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("Stop hook: kill switch LITCLAUDE_GOAL_OFF=1 -> empty output despite active goal", () => {
  const ws = mkdtempSync(join(tmpdir(), "litgoal-autoloop-"));
  try {
    seedGoal(ws, goal());
    const r = runStopHook(ws, { LITCLAUDE_GOAL_OFF: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("Stop hook: autoloop goal with all criteria pass -> empty output (allows stop)", () => {
  const ws = mkdtempSync(join(tmpdir(), "litgoal-autoloop-"));
  try {
    seedGoal(ws, goal({ criteria: [{ id: "criterion-1", status: "pass" }] }));
    const r = runStopHook(ws);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("Stop hook: non-autoloop goal (default) never blocks", () => {
  const ws = mkdtempSync(join(tmpdir(), "litgoal-autoloop-"));
  try {
    seedGoal(ws, goal({ autoloop: false }));
    const r = runStopHook(ws);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("Stop hook: durable counter increments across blocks then hard-caps", () => {
  const ws = mkdtempSync(join(tmpdir(), "litgoal-autoloop-"));
  try {
    seedGoal(ws, goal());
    let last;
    for (let i = 0; i < AUTOLOOP_MAX_BLOCKS + 2; i += 1) {
      last = runStopHook(ws);
      assert.equal(last.status, 0, last.stderr);
    }
    // After exceeding the cap, the hook must emit a hard stop (continue:false), not block.
    const out = JSON.parse(last.stdout);
    assert.equal(out.continue, false);
    assert.match(out.stopReason, /safety cap/u);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
