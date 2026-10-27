// plans/litclaude-1042.md todo 5 (C1): each session's last hook event, kept as one small record so
// the LIT card can tell running, idle and ended sessions apart without guessing from file times.
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ignitionFileName, readLitSnapshot } from "../plugins/litclaude/lib/mod/state.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");

const kindOf = (s) => (s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : "file");
const io = {
  read: async (path) => readFileSync(path, "utf8"),
  stat: async (path) => {
    try {
      const s = lstatSync(path);
      return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs, isLink: s.isSymbolicLink() };
    } catch {
      return null;
    }
  },
  list: async (path) => readdirSync(path).map((name) => {
    const s = lstatSync(join(path, name));
    return { name, kind: kindOf(s), isLink: s.isSymbolicLink(), mtimeMs: s.mtimeMs, size: s.size };
  }),
};

const withProject = (fn) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-liveness-")));
  writeFileSync(join(cwd, "package.json"), "{}\n");
  mkdirSync(join(cwd, ".litclaude"));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};
const run = (event, cwd, sessionId, env = {}) => {
  const input = { cwd, hook_event_name: event, tool_name: "Read", tool_input: { file_path: join(cwd, "package.json") }, tool_response: {}, stop_hook_active: false };
  if (sessionId !== undefined) input.session_id = sessionId;
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: "", HERDR_PANE_ID: "", ...env },
    input: JSON.stringify(input),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const recordPath = (cwd, sessionId) => join(cwd, ".litclaude", "liveness", ignitionFileName(sessionId));
const record = (cwd, sessionId) => JSON.parse(readFileSync(recordPath(cwd, sessionId), "utf8"));
// Moves the record's mtime and `at` back, as if the last write were `seconds` ago.
const age = (cwd, sessionId, seconds) => {
  const path = recordPath(cwd, sessionId);
  const then = new Date(Date.now() - seconds * 1000);
  writeFileSync(path, JSON.stringify({ ...record(cwd, sessionId), at: then.toISOString() }));
  utimesSync(path, then, then);
  return statSync(path).mtimeMs;
};

describe("session liveness from hook events", () => {
  it("moves alive -> idle -> ended on PostToolUse, Stop and SessionEnd", () => withProject((cwd) => {
    run("post-tool-use", cwd, "sess-a");
    assert.deepEqual({ ...record(cwd, "sess-a"), at: null }, { version: 1, sessionId: "sess-a", state: "alive", at: null, herdrPane: null });
    run("stop", cwd, "sess-a");
    assert.equal(record(cwd, "sess-a").state, "idle");
    run("post-tool-use-failure", cwd, "sess-a");
    assert.equal(record(cwd, "sess-a").state, "alive", "a failed tool is activity too");
    run("session-end", cwd, "sess-a");
    assert.equal(record(cwd, "sess-a").state, "ended");
  }));

  it("throttles the same state to one write per 30 s; a change always writes", () => withProject((cwd) => {
    run("post-tool-use", cwd, "sess-b");
    const before = age(cwd, "sess-b", 10);
    run("post-tool-use", cwd, "sess-b");
    assert.equal(statSync(recordPath(cwd, "sess-b")).mtimeMs, before, "10 s old: not rewritten");
    age(cwd, "sess-b", 31);
    run("post-tool-use", cwd, "sess-b");
    assert.ok(Date.now() - Date.parse(record(cwd, "sess-b").at) < 5000, "31 s old: rewritten");
    age(cwd, "sess-b", 5);
    run("stop", cwd, "sess-b");
    assert.equal(record(cwd, "sess-b").state, "idle", "a state change writes at once");
  }));

  it("keeps a well-formed herdr pane id and drops any other", () => withProject((cwd) => {
    run("post-tool-use", cwd, "sess-c", { HERDR_PANE_ID: "w2B:p8K" });
    assert.equal(record(cwd, "sess-c").herdrPane, "w2B:p8K");
    run("stop", cwd, "sess-c", { HERDR_PANE_ID: "w2B p8K; rm -rf /" });
    assert.equal(record(cwd, "sess-c").herdrPane, null);
  }));

  it("writes nothing in a project that keeps no LitClaude state", () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-liveness-plain-")));
    try {
      writeFileSync(join(cwd, "package.json"), "{}\n");
      run("post-tool-use", cwd, "sess-plain");
      run("stop", cwd, "sess-plain");
      assert.equal(existsSync(join(cwd, ".litclaude")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("writes nothing without a session id and only the sanitized name for a hostile one", () => withProject((cwd) => {
    run("post-tool-use", cwd, undefined);
    assert.equal(existsSync(join(cwd, ".litclaude", "liveness")), false, "no session id, no record");
    run("post-tool-use", cwd, "../x");
    assert.equal(existsSync(join(cwd, ".litclaude", "liveness", "__x.json")), true);
    assert.equal(existsSync(join(cwd, ".litclaude", "x.json")), false);
  }));

  it("the card's snapshot reads each session's liveness and attaches it to other-session stacks", async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-liveness-snap-")));
    try {
      mkdirSync(join(cwd, ".git"));
      const env = { LITCLAUDE_HUD_STATE_ROOT: join(cwd, ".hud") };
      const other = "0th3r5e5-aaaa-bbbb-cccc-000000000001";
      const viewer = "v1ewer00-aaaa-bbbb-cccc-000000000002";
      for (const sid of [viewer, other]) {
        spawnSync(process.execPath, [hookPath, "pre-tool-use"], {
          cwd,
          encoding: "utf8",
          env: { ...process.env, ...env },
          input: JSON.stringify({ cwd, session_id: sid, prompt_id: "p", hook_event_name: "pre-tool-use", tool_name: "Skill", tool_input: { skill: "litclaude:review-work" } }),
        });
      }
      run("post-tool-use", cwd, other, { HERDR_PANE_ID: "w2B:p8K" });
      run("stop", cwd, viewer);
      const snapshot = await readLitSnapshot(io, { cwd, sessionId: viewer, env });
      assert.equal(snapshot.workflow.liveness[other].state, "alive");
      assert.equal(snapshot.workflow.liveness[other].herdrPane, "w2B:p8K");
      assert.equal(snapshot.workflow.liveness[viewer].state, "idle");
      const row = snapshot.workflow.others.find((entry) => entry.id8 === "0th3r5e5");
      assert.equal(row?.liveness?.state, "alive");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("an unwritable liveness folder leaves the hook's output unchanged", () => withProject((cwd) => {
    const clean = run("stop", cwd, "sess-d");
    mkdirSync(join(cwd, ".litclaude"), { recursive: true });
    rmSync(join(cwd, ".litclaude", "liveness"), { recursive: true, force: true });
    writeFileSync(join(cwd, ".litclaude", "liveness"), "not a folder");
    assert.equal(run("stop", cwd, "sess-d"), clean);
    assert.equal(run("post-tool-use", cwd, "sess-d"), run("post-tool-use", cwd, "sess-e"));
  }));
});
