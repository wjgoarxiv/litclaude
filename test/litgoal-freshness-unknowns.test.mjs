// Evidence freshness (a pass is bound to the SHA-256 of the files it was observed on) and the unknown
// register (KK/KU/UK/UU items that must be closed with evidence), plus the autoloop hand-off when only
// user-answerable questions remain.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateAutoloop } from "../plugins/litclaude/lib/litgoal/autoloop.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");

const makeCwd = () => realpathSync(mkdtempSync(join(tmpdir(), "litclaude-litgoal-fresh-")));
const runCli = (cwd, args) => spawnSync(process.execPath, [binPath, "litgoal", ...args], { cwd, encoding: "utf8", env: { ...process.env } });
const ok = (cwd, args) => {
  const result = runCli(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout.trim().startsWith("{") ? JSON.parse(result.stdout) : result.stdout;
};
const goals = (cwd) => JSON.parse(readFileSync(join(cwd, ".litclaude", "litgoal", "goals.json"), "utf8"));
const ledger = (cwd) => readFileSync(join(cwd, ".litclaude", "litgoal", "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const sha = (text) => createHash("sha256").update(text).digest("hex");
const runStopHook = (cwd) => spawnSync(process.execPath, [hookPath, "stop"], {
  cwd: root,
  encoding: "utf8",
  input: `${JSON.stringify({ hook_event_name: "Stop", cwd })}\n`,
  env: { ...process.env, LITCLAUDE_GOAL_OFF: "" },
});

describe("litgoal evidence freshness", () => {
  it("binds a pass to its inputs' SHA-256 and reopens it when an input changes", () => {
    const cwd = makeCwd();
    try {
      writeFileSync(join(cwd, "report.txt"), "v1\n");
      ok(cwd, ["create-goals", "--brief", "fresh evidence", "--json"]);
      const recorded = ok(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--inputs", "report.txt", "--json", '{"artifact":"report.txt"}']);
      const [input] = recorded.criterion.evidence.at(-1).inputs;
      assert.equal(input.sha256, sha("v1\n"));
      assert.equal(input.path, join(cwd, "report.txt"));

      writeFileSync(join(cwd, "report.txt"), "v2\n");
      const status = ok(cwd, ["status", "--json"]);
      assert.equal(status.criteria[0].status, "stale");
      assert.deepEqual(status.criteria[0].staleInputs.map(({ reason }) => reason), ["changed"]);
      assert.ok(ledger(cwd).some((entry) => entry.event === "evidence.stale" && entry.criterionId === "criterion-1"));

      const complete = runCli(cwd, ["checkpoint", "--status", "complete", "--json"]);
      assert.notEqual(complete.status, 0, "a stale pass must not complete the goal");

      ok(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--inputs", "report.txt", "--json", '{"artifact":"report.txt"}']);
      assert.equal(goals(cwd).criteria[0].status, "pass");
      assert.equal(goals(cwd).criteria[0].staleInputs, undefined);
      ok(cwd, ["checkpoint", "--status", "complete", "--json"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("treats a vanished input as stale and binds review evidence to the reviewed artifact", () => {
    const cwd = makeCwd();
    try {
      writeFileSync(join(cwd, "a.txt"), "a\n");
      writeFileSync(join(cwd, "draft.md"), "draft\n");
      ok(cwd, ["create-goals", "--brief", "reviewed artifact", "--json"]);
      const recorded = ok(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--inputs", "a.txt", "--reviewed", "draft.md", "--json", '{"reviewer":"human"}']);
      assert.deepEqual(recorded.criterion.evidence.at(-1).inputs.map(({ role }) => role), ["input", "reviewed"]);
      unlinkSync(join(cwd, "draft.md"));
      const status = ok(cwd, ["status", "--json"]);
      assert.equal(status.criteria[0].status, "stale");
      assert.deepEqual(status.criteria[0].staleInputs, [{ path: join(cwd, "draft.md"), role: "reviewed", reason: "missing" }]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses an input that is not a regular file and keeps inputs runtime-owned", () => {
    const cwd = makeCwd();
    try {
      ok(cwd, ["create-goals", "--brief", "bad input", "--json"]);
      assert.notEqual(runCli(cwd, ["record-evidence", "--criterion", "criterion-1", "--inputs", "nope.txt", "--json", "{}"]).status, 0);
      assert.notEqual(runCli(cwd, ["record-evidence", "--criterion", "criterion-1", "--json", '{"inputs":[]}']).status, 0);
      assert.equal(goals(cwd).criteria[0].status, "pending");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("litgoal unknown register", () => {
  it("needs a source for KK, a probe for open items and evidence to close", () => {
    const cwd = makeCwd();
    try {
      ok(cwd, ["create-goals", "--brief", "unknowns", "--json"]);
      assert.notEqual(runCli(cwd, ["unknown", "add", "--kind", "KK", "--text", "Node 22 is required"]).status, 0);
      assert.notEqual(runCli(cwd, ["unknown", "add", "--kind", "KU", "--text", "Does CI have ffmpeg?"]).status, 0);
      assert.notEqual(runCli(cwd, ["unknown", "add", "--kind", "XX", "--text", "?", "--probe", "p"]).status, 0);
      const kk = ok(cwd, ["unknown", "add", "--kind", "KK", "--text", "Node 22 is required", "--source", "package.json engines", "--json"]);
      assert.equal(kk.unknown.status, "known");
      const ku = ok(cwd, ["unknown", "add", "--kind", "KU", "--text", "Does CI have ffmpeg?", "--probe", "ffmpeg -version in ci.yml", "--critical", "--json"]);
      assert.equal(ku.unknown.status, "open");
      assert.equal(ku.unknown.critical, true);
      assert.deepEqual(ok(cwd, ["unknown", "list", "--json"]).unknowns.map(({ id }) => id), [kk.unknown.id, ku.unknown.id]);

      assert.equal(runCli(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--json", '{"artifact":"x"}']).status, 0);
      assert.notEqual(runCli(cwd, ["checkpoint", "--status", "complete", "--json"]).status, 0, "an open critical unknown blocks completion");
      assert.notEqual(runCli(cwd, ["unknown", "resolve", "--id", ku.unknown.id]).status, 0, "closing needs evidence");
      const resolved = ok(cwd, ["unknown", "resolve", "--id", ku.unknown.id, "--evidence", "ci.yml installs ffmpeg", "--json"]);
      assert.equal(resolved.unknown.status, "resolved");
      ok(cwd, ["checkpoint", "--status", "complete", "--json"]);
      assert.ok(ledger(cwd).some((entry) => entry.event === "unknown.resolved" && entry.id === ku.unknown.id));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("litgoal autoloop hands a user-only question back", () => {
  const goal = (over = {}) => ({
    version: 1, objective: "ship", status: "active", autoloop: true,
    criteria: [{ id: "c1", status: "pass", description: "done", evidence: [] }],
    unknowns: [], ...over,
  });
  const uk = { id: "unknown-1", kind: "UK", text: "Which licence do you want?", probe: "ask the user", critical: true, status: "open" };

  it("hands off when only open critical UK questions remain, and keeps looping otherwise", () => {
    assert.equal(evaluateAutoloop({ env: {}, state: goal({ unknowns: [uk] }) }).action, "handoff");
    assert.match(evaluateAutoloop({ env: {}, state: goal({ unknowns: [uk] }) }).stopReason, /Which licence do you want\?/u);
    assert.equal(evaluateAutoloop({ env: {}, state: goal({ unknowns: [uk, { ...uk, id: "unknown-2", kind: "KU" }] }) }).action, "block");
    assert.equal(evaluateAutoloop({ env: {}, state: goal({ unknowns: [{ ...uk, critical: false }] }) }).action, "allow");
    assert.equal(evaluateAutoloop({ env: {}, state: goal({ unknowns: [uk], criteria: [{ id: "c1", status: "pending" }] }) }).action, "block");
  });

  it("the Stop hook marks the goal needs_user_decision instead of completing it", () => {
    const cwd = makeCwd();
    try {
      ok(cwd, ["create-goals", "--brief", "handoff", "--autoloop", "--json"]);
      ok(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--json", '{"artifact":"x"}']);
      ok(cwd, ["unknown", "add", "--kind", "UK", "--text", "Which licence do you want?", "--probe", "ask the user", "--critical", "--json"]);
      const hook = runStopHook(cwd);
      assert.equal(hook.status, 0, hook.stderr);
      const output = JSON.parse(hook.stdout.trim().split("\n").at(-1));
      assert.equal(output.continue, false);
      assert.match(output.stopReason, /Which licence do you want\?/u);
      assert.equal(goals(cwd).status, "needs_user_decision");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("the Stop hook reopens a stale pass instead of completing the goal", () => {
    const cwd = makeCwd();
    try {
      writeFileSync(join(cwd, "out.txt"), "1\n");
      ok(cwd, ["create-goals", "--brief", "stale stop", "--autoloop", "--json"]);
      ok(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--inputs", "out.txt", "--json", '{"artifact":"out.txt"}']);
      writeFileSync(join(cwd, "out.txt"), "2\n");
      const hook = runStopHook(cwd);
      assert.equal(hook.status, 0, hook.stderr);
      const output = JSON.parse(hook.stdout.trim().split("\n").at(-1));
      assert.equal(output.decision, "block");
      assert.match(output.reason, /criterion-1 \[stale\]/u);
      assert.equal(goals(cwd).status, "active");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
