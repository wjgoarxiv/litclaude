import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { litPlanTurnPath, recordLitPlanTurn } from "../plugins/litclaude/lib/lit-plan-persistence.mjs";
import { withLitgoalLock } from "../plugins/litclaude/lib/litgoal/state.mjs";

// The new modules load lazily, so the collision test still reaches its assertion on code without them.
const sessionState = () => import("../plugins/litclaude/lib/session-state.mjs");
const goalFiles = () => import("../plugins/litclaude/lib/goal-files.mjs");

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(repoRoot, "plugins", "litclaude");
const DAY_MS = 24 * 3600_000;
const SID_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SID_B = "bbbbbbbb-2222-4222-8222-222222222222";

const project = (prefix) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), `litclaude-ss-${prefix}-`)));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".litclaude"));
  return root;
};
const filesUnder = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? filesUnder(join(dir, entry.name)).map((name) => `${entry.name}/${name}`)
    : [entry.name]));
};
const age = (path, ms) => {
  const at = (Date.now() - ms) / 1000;
  utimesSync(path, at, at);
};
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

describe("(a) two sessions in one project keep their own records", () => {
  it("interleaved lit-plan turn writes never cross sessions", () => {
    const root = project("plan");
    try {
      let crossed = 0;
      for (let index = 0; index < 20; index += 1) {
        recordLitPlanTurn(root, { sessionId: SID_A, now: 1_000 + index });
        recordLitPlanTurn(root, { sessionId: SID_B, now: 2_000 + index });
        for (const sid of [SID_A, SID_B]) {
          const turn = JSON.parse(readFileSync(litPlanTurnPath(root, sid), "utf8"));
          if (turn.sessionId !== sid) crossed += 1;
        }
      }
      assert.equal(crossed, 0, "cross-session lit-plan turn reads");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("interleaved goal intent writes never cross sessions", async () => {
    const { readGoalFile, writeGoalFile } = await goalFiles();
    const root = project("goal");
    try {
      let crossed = 0;
      for (let index = 0; index < 20; index += 1) {
        assert.equal(writeGoalFile(root, SID_A, "intent.json", { id: `a${index}`, sessionId: SID_A }), true);
        assert.equal(writeGoalFile(root, SID_B, "intent.json", { id: `b${index}`, sessionId: SID_B }), true);
        if (readGoalFile(root, SID_A, "intent.json").id !== `a${index}`) crossed += 1;
        if (readGoalFile(root, SID_B, "intent.json").id !== `b${index}`) crossed += 1;
      }
      assert.equal(crossed, 0, "cross-session goal intent reads");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("(b) legacy shared records stay honoured", () => {
  it("a pre-existing .litclaude/goal/owner.json is still read", async () => {
    const { readGoalFile } = await goalFiles();
    const root = project("legacy");
    try {
      mkdirSync(join(root, ".litclaude", "goal"));
      writeFileSync(join(root, ".litclaude", "goal", "owner.json"), JSON.stringify({ id: "0badc0de", sessionId: SID_A }));
      assert.equal(readGoalFile(root, SID_A, "owner.json")?.id, "0badc0de");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("readWithLegacyFallback prefers the new path and falls back to the old one", async () => {
    const { readWithLegacyFallback } = await sessionState();
    const root = project("fallback");
    try {
      const legacy = join(root, "old.json");
      const fresh = join(root, "new.json");
      assert.equal(readWithLegacyFallback(fresh, legacy), null);
      writeFileSync(legacy, "old");
      assert.deepEqual(readWithLegacyFallback(fresh, legacy), { path: legacy, text: "old", legacy: true });
      writeFileSync(fresh, "new");
      assert.deepEqual(readWithLegacyFallback(fresh, legacy), { path: fresh, text: "new", legacy: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a legacy lit-plan turn of the same session still arms the gate, and a prompt clears it", async () => {
    const { clearLitPlanTurn, evaluateLitPlanStop } = await import("../plugins/litclaude/lib/lit-plan-persistence.mjs");
    const root = project("legacy-plan");
    try {
      mkdirSync(join(root, ".litclaude", "lit-plan"));
      const legacy = join(root, ".litclaude", "lit-plan", "turn.json");
      writeFileSync(legacy, JSON.stringify({ sessionId: SID_A, promptAt: Date.now(), blockCount: 0, warned: false }));
      assert.equal(evaluateLitPlanStop({ cwd: root, sessionId: SID_B }).action, "allow", "another session's legacy turn");
      assert.equal(evaluateLitPlanStop({ cwd: root, sessionId: SID_A }).action, "block");
      clearLitPlanTurn(root, SID_B);
      assert.equal(existsSync(legacy), true, "another session never clears it");
      clearLitPlanTurn(root, SID_A);
      assert.equal(existsSync(legacy), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("(c) the litgoal lock recovers from a dead or missing owner", () => {
  it("a dead-pid owner is taken over within the timeout", () => {
    const root = project("lock-dead");
    try {
      const lockDir = join(root, ".litclaude", "litgoal", ".lock");
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ nonce: "deadbeef", pid: deadPid(), acquired_at_ms: Date.now() - 60_000 }));
      const started = Date.now();
      assert.equal(withLitgoalLock(lockDir, () => "ran"), "ran");
      assert.ok(Date.now() - started < 5_000, "taken over before the timeout");
      assert.equal(existsSync(lockDir), false, "released after the run");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a legacy ownerless empty .lock older than the timeout is moved aside, not deleted", () => {
    const root = project("lock-empty");
    try {
      const litgoal = join(root, ".litclaude", "litgoal");
      const lockDir = join(litgoal, ".lock");
      mkdirSync(lockDir, { recursive: true });
      age(lockDir, 9 * DAY_MS);
      const started = Date.now();
      assert.equal(withLitgoalLock(lockDir, () => "ran"), "ran");
      assert.ok(Date.now() - started < 5_000);
      const aside = readdirSync(litgoal).filter((name) => name.startsWith(".lock.stale."));
      assert.equal(aside.length, 1, "the old lock folder is kept beside the lock");
      assert.equal(lstatSync(join(litgoal, aside[0])).isDirectory(), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a fresh ownerless .lock is not stolen", () => {
    const root = project("lock-fresh");
    try {
      const lockDir = join(root, ".litclaude", "litgoal", ".lock");
      mkdirSync(lockDir, { recursive: true });
      assert.throws(() => withLitgoalLock(lockDir, () => "ran"), { name: "LitgoalStateError", message: /lock timed out/u });
      assert.equal(existsSync(lockDir), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("(d) litclaude-ai sessions is a read-only index", () => {
  const mtimes = (dir) => Object.fromEntries([dir, ...filesUnder(dir).map((name) => join(dir, name))]
    .map((path) => [path, statSync(path).mtimeMs]));

  for (const [name, entry] of [["npm CLI", join(repoRoot, "bin", "litclaude-ai.js")], ["plugin bin", join(plugin, "bin", "litclaude-ai")]]) {
    it(`${name} prints one row per session and writes nothing`, async () => {
      const { sessionStateDir } = await sessionState();
      const root = project(`index-${name.replace(/\W/gu, "")}`);
      try {
        sessionStateDir(root, SID_A);
        sessionStateDir(root, SID_B);
        writeFileSync(join(sessionStateDir(root, SID_B), "marker.json"), "{}");
        mkdirSync(join(root, ".litclaude", "sessions", SID_A, "goal"));
        writeFileSync(join(root, ".litclaude", "sessions", SID_A, "goal", "owner.json"), JSON.stringify({ id: "1234abcd", sessionId: SID_A }));
        const before = mtimes(join(root, ".litclaude"));
        const result = spawnSync(process.execPath, [entry, "sessions"], {
          cwd: root,
          encoding: "utf8",
          env: { PATH: process.env.PATH, HOME: join(root, "home"), NO_COLOR: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", CI: "1" },
        });
        assert.equal(result.status, 0, result.stderr);
        const rows = result.stdout.split("\n").filter((line) => /^(aaaaaaaa|bbbbbbbb)\b/u.test(line));
        assert.equal(rows.length, 2, result.stdout);
        assert.match(rows.find((row) => row.startsWith("aaaaaaaa")), /1234abcd/u);
        assert.deepEqual(mtimes(join(root, ".litclaude")), before, "nothing written");
        assert.equal(existsSync(join(root, "home")), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("listSessions reads the owned start-work id from boulder.json without changing it", async () => {
    const { listSessions, sessionStateDir } = await sessionState();
    const root = project("boulder");
    try {
      sessionStateDir(root, SID_A);
      const boulder = JSON.stringify({ schema_version: 3, active_work_id: "w-1", works: { "w-1": { work_id: "w-1", active_session_id: SID_A } } });
      writeFileSync(join(root, ".litclaude", "boulder.json"), boulder);
      const [row] = listSessions(root);
      assert.equal(row.sessionId, SID_A);
      assert.equal(row.startWorkId, "w-1");
      assert.equal(readFileSync(join(root, ".litclaude", "boulder.json"), "utf8"), boulder);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const writeLiveness = (root, sessionId, state, at) => {
    mkdirSync(join(root, ".litclaude", "liveness"), { recursive: true });
    writeFileSync(join(root, ".litclaude", "liveness", `${sessionId}.json`), JSON.stringify({ version: 1, sessionId, state, at: new Date(at).toISOString(), herdrPane: null }));
  };

  it("lists a live session from its liveness record even with no session folder", async () => {
    // Given a fresh liveness record, no session folder, and boulder.json naming that session's run
    const { listSessions } = await sessionState();
    const root = project("live-only");
    try {
      writeLiveness(root, SID_A, "alive", Date.now() - 60_000);
      writeFileSync(join(root, ".litclaude", "boulder.json"), JSON.stringify({ schema_version: 3, active_work_id: "w-9", works: { "w-9": { work_id: "w-9", active_session_id: SID_A } } }));
      // When the index is read
      const rows = listSessions(root);
      // Then that session is a row with its start-work run, and nothing was created
      assert.deepEqual(rows.map((row) => [row.sessionId, row.startWorkId]), [[SID_A, "w-9"]]);
      assert.equal(existsSync(join(root, ".litclaude", "sessions")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves out sessions that ended or went quiet long ago", async () => {
    // Given an ended session, one whose last word is two days old, one folder with no liveness and old
    // files, and one live session
    const { listSessions, sessionStateDir } = await sessionState();
    const root = project("ended");
    try {
      writeLiveness(root, SID_A, "ended", Date.now() - 60_000);
      age(sessionStateDir(root, SID_A), 2 * 60_000);
      const quiet = "dddddddd-4444-4444-8444-444444444444";
      writeLiveness(root, quiet, "alive", Date.now() - 2 * DAY_MS);
      const orphan = "eeeeeeee-5555-4555-8555-555555555555";
      age(sessionStateDir(root, orphan), 3 * DAY_MS);
      writeLiveness(root, SID_B, "idle", Date.now() - 60_000);
      // When the index is read
      const rows = listSessions(root);
      // Then only the live session is listed
      assert.deepEqual(rows.map((row) => row.sessionId), [SID_B]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("(e) week-old session folders move to the archive", () => {
  const seedOld = (root) => {
    const dir = join(root, ".litclaude", "sessions", SID_A);
    mkdirSync(join(dir, "goal"), { recursive: true });
    writeFileSync(join(dir, "goal", "owner.json"), "{}");
    writeFileSync(join(dir, "lit-plan-turn.json"), "{}");
    for (const path of [join(dir, "goal", "owner.json"), join(dir, "lit-plan-turn.json"), join(dir, "goal"), dir]) age(path, 8 * DAY_MS);
    return dir;
  };

  it("moves the old folder, keeps the fresh one and loses no file", async () => {
    const { archiveStaleSessions, sessionStateDir } = await sessionState();
    const root = project("archive");
    try {
      const old = seedOld(root);
      writeFileSync(join(sessionStateDir(root, SID_B), "x.json"), "{}");
      const before = filesUnder(join(root, ".litclaude")).length;
      const moved = archiveStaleSessions(root, { maxAgeMs: 7 * DAY_MS });
      assert.deepEqual(moved.map(({ sessionId }) => sessionId), [SID_A]);
      assert.equal(existsSync(old), false);
      assert.equal(existsSync(join(root, ".litclaude", "archive", "sessions", SID_A, "goal", "owner.json")), true);
      assert.equal(existsSync(join(root, ".litclaude", "sessions", SID_B, "x.json")), true);
      assert.equal(filesUnder(join(root, ".litclaude")).length, before, "file count unchanged");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("SessionStart archives them", () => {
    const root = project("archive-hook");
    try {
      seedOld(root);
      const result = spawnSync(process.execPath, [join(plugin, "bin", "litclaude-hook.js"), "session-start"], {
        cwd: root,
        encoding: "utf8",
        input: JSON.stringify({ cwd: root, session_id: SID_B, source: "startup" }),
        env: { PATH: process.env.PATH, HOME: join(root, "home"), CLAUDE_CONFIG_DIR: join(root, "claude"), CI: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_HUD_STATE_ROOT: join(root, "hud") },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(join(root, ".litclaude", "sessions", SID_A)), false);
      assert.equal(existsSync(join(root, ".litclaude", "archive", "sessions", SID_A, "lit-plan-turn.json")), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("(f) a symlinked sessions folder is refused", () => {
  it("sessionStateDir throws and nothing lands outside", async () => {
    const { archiveStaleSessions, listSessions, sessionStateDir } = await sessionState();
    const root = project("link");
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-ss-outside-")));
    try {
      symlinkSync(outside, join(root, ".litclaude", "sessions"));
      assert.throws(() => sessionStateDir(root, SID_A), /symlink/u);
      assert.deepEqual(listSessions(root), []);
      assert.deepEqual(archiveStaleSessions(root, { maxAgeMs: 0 }), []);
      assert.throws(() => recordLitPlanTurn(root, { sessionId: SID_A }), /symlink/u);
      assert.deepEqual(readdirSync(outside), [], "nothing written through the link");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("an invalid session id gets no folder", async () => {
    const { sessionStateDir } = await sessionState();
    const root = project("badsid");
    try {
      for (const sid of ["", "../x", "a/b", "x".repeat(81), null]) assert.equal(sessionStateDir(root, sid), null, String(sid));
      assert.equal(existsSync(join(root, ".litclaude", "sessions")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
