import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { projectSlug } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

// The record's hash is pinned here on purpose: sha256 of the whitespace-normalised text, first 16 hex.
const noticeHash = (text) => createHash("sha256").update(text.replace(/\s+/gu, " ").trim()).digest("hex").slice(0, 16);
const ledgerLib = () => import("../plugins/litclaude/lib/shown-ledger.mjs");

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins/litclaude/bin/litclaude-hook.js");
const cliPath = join(root, "bin/litclaude-ai.js");
const DAY = 24 * 60 * 60 * 1000;
const NUDGE = (count) => `${count} other recent ${count === 1 ? "session" : "sessions"} here · type \`lit adhd\` for a one-screen brief of where each stands`;

const fixture = (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-shown-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = join(base, "project");
  const config = join(base, "claude-config");
  mkdirSync(project, { recursive: true });
  mkdirSync(config, { recursive: true });
  const env = {
    ...process.env,
    HOME: join(base, "home"),
    CLAUDE_CONFIG_DIR: config,
    LITCLAUDE_HOME: join(base, "lit-home"),
    LITCLAUDE_HUD_STATE_ROOT: join(base, "hud"),
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
  delete env.LITCLAUDE_GOAL_OFF;
  return { base, project, config, env };
};

const otherSessions = ({ project, config }, count) => {
  const folder = join(config, "projects", projectSlug(project));
  mkdirSync(folder, { recursive: true });
  for (let n = 1; n <= count; n += 1) writeFileSync(join(folder, `earlier-${n}.jsonl`), "{}\n");
};

const run = (event, { project, env }, input = {}) => spawnSync(process.execPath, [hookPath, event], {
  cwd: project,
  encoding: "utf8",
  input: JSON.stringify({ cwd: project, ...input }),
  env,
  timeout: 20000,
});

let sessionCounter = 0;
const startSession = (f) => {
  sessionCounter += 1;
  const result = run("session-start", f, { hook_event_name: "SessionStart", source: "startup", session_id: `shown-s${sessionCounter}` });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).systemMessage ?? "";
};

const ledgerFile = (project) => join(project, ".litclaude", "shown", "ledger.jsonl");
const ledgerRows = (project) => readFileSync(ledgerFile(project), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
// The next day: the nudge's own once-a-day marker no longer holds it back.
const nextDay = (project) => writeFileSync(join(project, ".litclaude", "adhd", "suggested.json"), `${JSON.stringify({ day: "2000-01-01" })}\n`);

describe("shown ledger: notices", () => {
  it("shows the lit-adhd nudge once while its text is unchanged, also on a later day", (t) => {
    const f = fixture(t);
    otherSessions(f, 1);
    assert.ok(startSession(f).includes(NUDGE(1)), "first session shows it");
    nextDay(f.project);
    assert.ok(!startSession(f).includes("other recent"), "the same text is not shown again");
    nextDay(f.project);
    assert.ok(!startSession(f).includes("other recent"), "nor in a third session");
  });

  it("records a hash and a time for it, never the text", (t) => {
    const f = fixture(t);
    otherSessions(f, 1);
    startSession(f);
    const rows = ledgerRows(f.project).filter((row) => row.kind === "notice");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "adhd");
    assert.equal(rows[0].hash, noticeHash(NUDGE(1)));
    assert.match(rows[0].hash, /^[0-9a-f]{16}$/u);
    assert.ok(Number.isFinite(rows[0].at));
    assert.ok(!readFileSync(ledgerFile(f.project), "utf8").includes("other recent"));
  });

  it("shows it again when the text changes", (t) => {
    const f = fixture(t);
    otherSessions(f, 1);
    startSession(f);
    otherSessions(f, 2);
    nextDay(f.project);
    assert.ok(startSession(f).includes(NUDGE(2)));
  });

  it("shows it again once a week has passed", (t) => {
    const f = fixture(t);
    otherSessions(f, 1);
    mkdirSync(join(f.project, ".litclaude", "shown"), { recursive: true });
    writeFileSync(ledgerFile(f.project), `${JSON.stringify({ kind: "notice", id: "adhd", hash: noticeHash(NUDGE(1)), at: Date.now() - 8 * DAY })}\n`);
    assert.ok(startSession(f).includes(NUDGE(1)));
  });

  it("falls back to today's behaviour when the record is corrupt, and recovers", (t) => {
    const f = fixture(t);
    otherSessions(f, 1);
    mkdirSync(join(f.project, ".litclaude", "shown"), { recursive: true });
    writeFileSync(ledgerFile(f.project), "{not json\n\u0000\u0001garbage");
    assert.ok(startSession(f).includes(NUDGE(1)), "a corrupt record never hides the notice");
    nextDay(f.project);
    assert.ok(!startSession(f).includes("other recent"), "the next good row is honoured");
  });

  it("ignores a symlinked ledger and writes nothing through it", (t) => {
    const f = fixture(t);
    otherSessions(f, 1);
    const elsewhere = join(f.base, "elsewhere.jsonl");
    const row = `${JSON.stringify({ kind: "notice", id: "adhd", hash: noticeHash(NUDGE(1)), at: Date.now() })}\n`;
    writeFileSync(elsewhere, row);
    mkdirSync(join(f.project, ".litclaude", "shown"), { recursive: true });
    symlinkSync(elsewhere, ledgerFile(f.project));
    assert.ok(startSession(f).includes(NUDGE(1)));
    assert.equal(readFileSync(elsewhere, "utf8"), row);
  });

});

describe("shown ledger: library", () => {
  it("answers false for a project with no record or an unusable state root", async (t) => {
    const { wasShown } = await ledgerLib();
    const f = fixture(t);
    assert.equal(wasShown({ stateRoot: f.project, text: "x" }), false);
    assert.equal(wasShown({ stateRoot: join(f.base, "does-not-exist"), text: "x" }), false);
  });

  it("matches text by its normalised form", async (t) => {
    const { recordShown, wasShown } = await ledgerLib();
    const f = fixture(t);
    recordShown({ stateRoot: f.project, id: "n", text: "a  b\n c" });
    assert.equal(wasShown({ stateRoot: f.project, text: "a b c" }), true);
    assert.equal(wasShown({ stateRoot: f.project, text: "a b d" }), false);
  });

  it("records a run end once per source, id and outcome, and refuses an unknown outcome", async (t) => {
    const { recordRunEnd } = await ledgerLib();
    const f = fixture(t);
    assert.equal(recordRunEnd({ stateRoot: f.project, source: "start-work", id: "w1", outcome: "sent" }), true);
    assert.equal(recordRunEnd({ stateRoot: f.project, source: "start-work", id: "w1", outcome: "sent" }), false);
    assert.equal(recordRunEnd({ stateRoot: f.project, source: "start-work", id: "w1", outcome: "waiting" }), true);
    assert.equal(recordRunEnd({ stateRoot: f.project, source: "start-work", id: "w1", outcome: "done" }), false);
    assert.deepEqual(ledgerRows(f.project).map(({ outcome }) => outcome), ["sent", "waiting"]);
  });
});

const writePlan = (project, lines) => {
  mkdirSync(join(project, "plans"), { recursive: true });
  writeFileSync(join(project, "plans", "approved.md"), lines.join("\n"));
};

const cli = (project, args) => spawnSync(process.execPath, [cliPath, "start-work", ...args, "--root", project, "--json"], {
  cwd: project,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" },
});

const initWork = (project) => {
  const result = cli(project, [
    "init", "--plan", "plans/approved.md", "--work-id", "work-1", "--session-id", "session-1",
    "--grant", `read:${project}`, "--grant", `write:${project}`, "--grant", `execute:${project}`, "--grant", `test:${project}`,
    "--idempotency-key", "init-1",
  ]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).state.revision;
};

describe("shown ledger: how a run ended", () => {
  it("start-work complete records sent", (t) => {
    const f = fixture(t);
    writePlan(f.project, ["# Plan", "", "## TODOs", "", "- [x] First", ""]);
    const revision = initWork(f.project);
    const done = cli(f.project, ["complete", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", String(revision), "--idempotency-key", "done-1"]);
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(ledgerRows(f.project).filter((row) => row.kind === "run-end").map(({ source, id, outcome }) => ({ source, id, outcome })), [{ source: "start-work", id: "work-1", outcome: "sent" }]);
  });

  it("a typed lit cancel records nothing-to-send", (t) => {
    const f = fixture(t);
    writePlan(f.project, ["# Plan", "", "## TODOs", "", "- [ ] First", ""]);
    initWork(f.project);
    const cancelled = run("user-prompt-submit", f, { hook_event_name: "UserPromptSubmit", session_id: "session-1", prompt_id: "p-cancel", prompt: "lit cancel" });
    assert.equal(cancelled.status, 0, cancelled.stderr);
    assert.deepEqual(ledgerRows(f.project).filter((row) => row.kind === "run-end").map(({ source, outcome }) => ({ source, outcome })), [{ source: "start-work", outcome: "nothing" }]);
  });

  it("a stop with every open task blocked records waiting, once per report", (t) => {
    const f = fixture(t);
    writePlan(f.project, ["# Plan", "", "## TODOs", "", "- [ ] First", ""]);
    initWork(f.project);
    writePlan(f.project, ["# Plan", "", "## TODOs", "", "- [ ] First BLOCKED: needs a key", ""]);
    const stop = () => run("stop", f, { hook_event_name: "Stop", session_id: "session-1", prompt_id: "p1", stop_hook_active: false });
    assert.match(JSON.parse(stop().stdout).systemMessage, /waiting on you/u);
    assert.equal(stop().stdout, "", "the existing fingerprint keeps the next stop silent");
    assert.deepEqual(ledgerRows(f.project).filter((row) => row.kind === "run-end").map(({ source, outcome }) => ({ source, outcome })), [{ source: "start-work", outcome: "waiting" }]);
  });

  const seedGoal = (project, overrides = {}) => {
    mkdirSync(join(project, ".litclaude", "litgoal"), { recursive: true });
    writeFileSync(join(project, ".litclaude", "litgoal", "goals.json"), `${JSON.stringify({
      version: 1, objective: "ship it", status: "active", autoloop: true,
      criteria: [{ id: "criterion-1", description: "tests pass", status: "pending", evidence: [] }],
      checkpoints: [], createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z", ...overrides,
    })}\n`);
  };
  const stopGoal = (f) => run("stop", f, { hook_event_name: "Stop" });

  it("a litgoal that completes records sent, exactly once across repeated stops", (t) => {
    const f = fixture(t);
    seedGoal(f.project, { criteria: [{ id: "criterion-1", status: "pass" }] });
    stopGoal(f);
    stopGoal(f);
    assert.deepEqual(ledgerRows(f.project).filter((row) => row.kind === "run-end").map(({ source, outcome }) => ({ source, outcome })), [{ source: "litgoal", outcome: "sent" }]);
  });

  it("a litgoal stopped by its safety cap records waiting", (t) => {
    const f = fixture(t);
    seedGoal(f.project);
    mkdirSync(join(f.project, ".litclaude", "litgoal"), { recursive: true });
    writeFileSync(join(f.project, ".litclaude", "litgoal", "autoloop.json"), JSON.stringify({ blockCount: 8, firstBlockAt: Date.now() }));
    stopGoal(f);
    stopGoal(f);
    assert.deepEqual(ledgerRows(f.project).filter((row) => row.kind === "run-end").map(({ source, outcome }) => ({ source, outcome })), [{ source: "litgoal", outcome: "waiting" }]);
  });

  it("a run that ends with no ledger folder to write still behaves as before", (t) => {
    const f = fixture(t);
    seedGoal(f.project, { criteria: [{ id: "criterion-1", status: "pass" }] });
    mkdirSync(join(f.project, ".litclaude"), { recursive: true });
    writeFileSync(join(f.project, ".litclaude", "shown"), "a file where the folder should be");
    const result = stopGoal(f);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "");
    assert.equal(JSON.parse(readFileSync(join(f.project, ".litclaude", "litgoal", "goals.json"), "utf8")).status, "complete");
    assert.equal(existsSync(join(f.project, ".litclaude", "shown", "ledger.jsonl")), false);
  });
});
