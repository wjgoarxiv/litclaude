import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  detectIconFont,
  iconFontCandidates,
  ignitionFileName,
  normalizePath,
  parseAutoHandoff,
  parseBoulder,
  parseGoals,
  readGuardedJson,
  readLedgerTail,
  readLitSnapshot,
  resolveLifecycleRoot,
  resolveStateRoot,
} from "../plugins/litclaude/lib/mod/state.mjs";

// The mod backs `io` with $.fs.stat(path, { resolve: true }) and $.fs.read; this is the same contract
// over the real filesystem, so links, sizes and resolved paths behave as they will in a session.
const realIo = () => {
  const reads = [];
  return {
    reads,
    stat: async (path) => {
      let link;
      try {
        link = lstatSync(path);
      } catch {
        return null;
      }
      let realPath;
      let kind = "other";
      let size = link.size;
      try {
        realPath = realpathSync(path);
        const target = lstatSync(realPath);
        kind = target.isFile() ? "file" : target.isDirectory() ? "dir" : "other";
        size = target.size;
      } catch {
        realPath = undefined;
      }
      return { kind, size, mtimeMs: link.mtimeMs, isLink: link.isSymbolicLink(), realPath };
    },
    read: async (path) => {
      reads.push(path);
      return readFileSync(path, "utf8");
    },
  };
};

const writeJson = (path, value) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

const fixture = () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-mod-state-")));
  const project = join(tmp, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(project, "packages", "app"), { recursive: true });
  writeFileSync(join(project, "packages", "app", "package.json"), "{}");
  return { tmp, project, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
};

const boulder = (sessionId, overrides = {}) => ({
  schema_version: 3,
  revision: 4,
  active_work_id: "w1",
  works: {
    w1: {
      work_id: "w1",
      status: "active",
      plan_name: "2026-10-10-demo.md",
      root_session_id: sessionId,
      active_session_id: sessionId,
      session_ids: [sessionId],
      progress: { total: 7, checked: 4, unchecked: 3, next_task: "5. README 데모 GIF 교체" },
      lanes: {
        a1: { agent_id: "a1", agent_type: "readme-ko", status: "active", started_at: "2026-10-10T01:00:00.000Z" },
      },
      ...overrides,
    },
  },
  history: [],
  events: [],
});

test("the state root is the outermost Git root, even from a nested package", async () => {
  const { project, cleanup } = fixture();
  try {
    const io = realIo();
    assert.equal(await resolveStateRoot(io, join(project, "packages", "app")), normalizePath(project));
  } finally {
    cleanup();
  }
});

test("without Git the nearest project marker is the root, else the working directory", async () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-mod-root-")));
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    writeFileSync(join(tmp, "a", "pyproject.toml"), "");
    const io = realIo();
    assert.equal(await resolveStateRoot(io, join(tmp, "a", "b")), normalizePath(join(tmp, "a")));
    const io2 = { stat: async () => null, read: async () => "" };
    assert.equal(await resolveStateRoot(io2, "/x/y"), "/x/y");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the lifecycle root follows a linked worktree to the main checkout's boulder.json", async () => {
  const { tmp, project, cleanup } = fixture();
  try {
    writeJson(join(project, ".litclaude", "boulder.json"), boulder("s1"));
    const linked = join(tmp, "linked");
    mkdirSync(linked);
    mkdirSync(join(project, ".git", "worktrees", "linked"), { recursive: true });
    writeFileSync(join(linked, ".git"), `gitdir: ${join(project, ".git", "worktrees", "linked")}\n`);
    const io = realIo();
    assert.equal(await resolveLifecycleRoot(io, linked, linked, "s1"), normalizePath(project), "the run's own session follows it");
    assert.equal(await resolveLifecycleRoot(io, linked, linked, "s2"), linked, "another session in a sibling worktree keeps its own state");
    writeJson(join(project, ".litclaude", "boulder.json"), boulder("s1", { effective_worktree_root: realpathSync(linked) }));
    assert.equal(await resolveLifecycleRoot(io, linked, linked, "s2"), normalizePath(project), "a run working in that worktree governs it");
    assert.equal(await resolveLifecycleRoot(io, join(project, "packages"), "fallback"), normalizePath(project));
    const lone = join(tmp, "lone");
    mkdirSync(lone);
    assert.equal(await resolveLifecycleRoot(io, lone, "fallback"), "fallback");
  } finally {
    cleanup();
  }
});

test("guarded reads refuse links, oversized files and anything that resolves elsewhere", async () => {
  const { tmp, project, cleanup } = fixture();
  try {
    const io = realIo();
    writeJson(join(project, ".litclaude", "litgoal", "goals.json"), { status: "active" });
    assert.deepEqual(await readGuardedJson(io, project, ".litclaude/litgoal/goals.json", 1024), { status: "active" });
    assert.equal(await readGuardedJson(io, project, ".litclaude/litgoal/goals.json", 4), null, "over the cap");

    writeJson(join(tmp, "outside.json"), { status: "stolen" });
    symlinkSync(join(tmp, "outside.json"), join(project, ".litclaude", "linked.json"));
    assert.equal(await readGuardedJson(io, project, ".litclaude/linked.json", 1024), null, "a linked file");

    const other = join(tmp, "other");
    writeJson(join(other, ".litclaude", "litgoal", "goals.json"), { status: "active" });
    const second = join(tmp, "second");
    mkdirSync(second);
    symlinkSync(join(other, ".litclaude"), join(second, ".litclaude"));
    assert.equal(await readGuardedJson(io, second, ".litclaude/litgoal/goals.json", 1024), null, "a linked state folder");

    writeFileSync(join(project, ".litclaude", "broken.json"), "{not json");
    assert.equal(await readGuardedJson(io, project, ".litclaude/broken.json", 1024), null);
    writeFileSync(join(project, ".litclaude", "array.json"), "[1]");
    assert.equal(await readGuardedJson(io, project, ".litclaude/array.json", 1024), null);
    assert.equal(io.reads.some((path) => path.includes("linked")), false, "a refused file is never opened");
  } finally {
    cleanup();
  }
});

test("the snapshot reads every LitClaude state file for this session and nothing for another", async () => {
  const { tmp, project, cleanup } = fixture();
  try {
    const sessionId = "abc-123";
    const hud = join(tmp, "hud");
    writeJson(join(hud, ignitionFileName(sessionId)), { sessionId, discipline: "lit-loop", at: "2026-10-10T01:02:03.000Z" });
    writeJson(join(project, ".litclaude", "boulder.json"), boulder(sessionId));
    writeJson(join(project, ".litclaude", "litgoal", "goals.json"), {
      objective: "HUD를 짧게 만들기",
      status: "active",
      autoloop: true,
      sessionId,
      criteria: [
        { id: "C1", description: "tests", status: "pass", evidence: [{ attempt: 1, recordedAt: "2026-10-10T01:05:00.000Z" }] },
        { id: "C2", description: "real surface", status: "pending", evidence: [] },
      ],
      blockers: ["review: one blocker"],
      checkpoints: [],
    });
    writeJson(join(project, ".litclaude", "litgoal", "autoloop.json"), { blockCount: 3, firstBlockAt: 1000 });
    writeJson(join(project, ".litclaude", "lit-plan", "turn.json"), { sessionId, promptAt: 5, blockCount: 1, warned: false });
    writeJson(join(project, ".litclaude", "interface-probe", "turn.json"), { sessionId, editAt: 10, probeAt: null, issue: "a HIGH finding remains", issueAt: 12, paths: ["a.css"], blockCount: 1 });
    writeJson(join(project, ".litclaude", "motion", "turn.json"), { sessionId: "someone-else", runs: [], blockCount: 2 });
    writeJson(join(project, ".litclaude", "auto-handoff", "settings.json"), { enabled: true, percent: 80 });
    writeJson(join(project, ".litclaude", "auto-handoff", `session-${sessionId}.json`), { armed: false, pending: true, firedAt: 99, firedAtPercent: 81 });

    const snapshot = await readLitSnapshot(realIo(), { cwd: join(project, "packages", "app"), sessionId, env: { LITCLAUDE_HUD_STATE_ROOT: hud } });
    assert.deepEqual(snapshot.ignition, { discipline: "lit-loop", at: Date.parse("2026-10-10T01:02:03.000Z") });
    assert.equal(snapshot.work.total, 7);
    assert.equal(snapshot.work.checked, 4);
    assert.equal(snapshot.work.nextTask, "5. README 데모 GIF 교체");
    assert.equal(snapshot.work.lanes[0].type, "readme-ko");
    assert.equal(snapshot.goal.objective, "HUD를 짧게 만들기");
    assert.deepEqual(snapshot.goal.criteria.map(({ id, status, attempts }) => [id, status, attempts]), [["C1", "pass", 1], ["C2", "pending", 0]]);
    assert.deepEqual(snapshot.goal.blockers, ["review: one blocker"]);
    assert.deepEqual(snapshot.autoloop, { blockCount: 3, firstBlockAt: 1000 });
    assert.equal(snapshot.litPlan.blockCount, 1);
    assert.equal(snapshot.probe.issue, "a HIGH finding remains");
    assert.equal(snapshot.motion, null, "another session's motion turn is not ours");
    assert.deepEqual(snapshot.handoff, { percent: 80, firedAt: 99, firedAtPercent: 81, pending: true });

    const stranger = await readLitSnapshot(realIo(), { cwd: project, sessionId: "other", env: { LITCLAUDE_HUD_STATE_ROOT: hud } });
    assert.equal(stranger.work, null);
    assert.equal(stranger.goal, null, "a goal bound to another session stays out of this band");
    assert.equal(stranger.ignition, null);
    assert.equal(stranger.litPlan, null);
  } finally {
    cleanup();
  }
});

test("a completed work is listed so the band can celebrate it once", () => {
  const state = boulder("s1", { status: "completed" });
  state.active_work_id = null;
  assert.deepEqual(parseBoulder(state, "s1"), { work: null, completed: ["w1"] });
  assert.deepEqual(parseBoulder(state, "s2"), { work: null, completed: [] });
  assert.deepEqual(parseBoulder({ junk: true }, "s1"), { work: null, completed: [] });
});

test("goal parsing tolerates junk and keeps known criterion statuses only", () => {
  const goal = parseGoals({ status: "active", criteria: [{ status: "weird" }, null], objective: 5 }, "s");
  assert.equal(goal.objective, "");
  assert.deepEqual(goal.criteria.map(({ status }) => status), ["pending", "pending"]);
  assert.equal(parseGoals(null, "s"), null);
});

test("auto-handoff follows the environment over the saved setting", () => {
  assert.equal(parseAutoHandoff({ enabled: true, percent: 80 }, null, { LITCLAUDE_AUTO_HANDOFF: "0" }), null);
  assert.equal(parseAutoHandoff({ enabled: false, percent: 80 }, null, { LITCLAUDE_AUTO_HANDOFF: "1" }).percent, 80);
  assert.equal(parseAutoHandoff({ enabled: true, percent: 80 }, null, { LITCLAUDE_AUTO_HANDOFF_PERCENT: "70" }).percent, 70);
  assert.equal(parseAutoHandoff({ enabled: true, percent: 120 }, null, {}), null);
  assert.equal(parseAutoHandoff({ enabled: true }, null, {}), null);
});

test("the ledger tail is newest first and skips torn lines", async () => {
  const { project, cleanup } = fixture();
  try {
    const lines = [
      { timestamp: "2026-10-10T01:00:00.000Z", event: "goal.created", objective: "x" },
      { timestamp: "2026-10-10T01:10:00.000Z", event: "evidence.recorded", criterionId: "C1", status: "pass" },
    ].map((entry) => JSON.stringify(entry));
    mkdirSync(join(project, ".litclaude", "litgoal"), { recursive: true });
    writeFileSync(join(project, ".litclaude", "litgoal", "ledger.jsonl"), `${lines.join("\n")}\n{"torn`);
    const tail = await readLedgerTail(realIo(), project, 5);
    assert.deepEqual(tail.map(({ event, detail }) => [event, detail]), [["evidence.recorded", "C1"], ["goal.created", "x"]]);
  } finally {
    cleanup();
  }
});

test("the icon font is looked for in each per-user font folder, read-only", async () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-mod-font-")));
  try {
    const env = { HOME: join(tmp, "home"), XDG_DATA_HOME: join(tmp, "data"), LOCALAPPDATA: join(tmp, "local") };
    const candidates = iconFontCandidates(env);
    assert.ok(candidates.includes(normalizePath(join(tmp, "home", "Library", "Fonts", "SymbolsNerdFontMono-Regular.ttf"))));
    assert.ok(candidates.includes(normalizePath(join(tmp, "data", "fonts", "SymbolsNerdFont-Regular.ttf"))));
    assert.ok(candidates.includes(normalizePath(join(tmp, "local", "Microsoft", "Windows", "Fonts", "SymbolsNerdFontMono-Regular.ttf"))));
    assert.ok(iconFontCandidates({ HOME: "/h" }).includes("/h/.local/share/fonts/SymbolsNerdFontMono-Regular.ttf"));

    const io = realIo();
    const absent = await detectIconFont(io, env);
    assert.equal(absent.present, false);
    assert.match(absent.note, /basic: Symbols Nerd Font not found/u);
    mkdirSync(join(tmp, "data", "fonts"), { recursive: true });
    writeFileSync(join(tmp, "data", "fonts", "SymbolsNerdFontMono-Regular.ttf"), "font");
    const found = await detectIconFont(io, env);
    assert.equal(found.present, true);
    assert.equal(found.path, normalizePath(join(tmp, "data", "fonts", "SymbolsNerdFontMono-Regular.ttf")));
    assert.equal(io.reads.length, 0, "detection only stats; it never reads the font");

    const unreadable = await detectIconFont({ stat: async () => { throw new Error("EACCES: denied"); }, read: async () => "" }, env);
    assert.equal(unreadable.present, false);
    assert.match(unreadable.note, /basic: the font folders could not be checked/u);
    assert.match((await detectIconFont(io, {})).note, /basic: no home folder to look in/u);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
