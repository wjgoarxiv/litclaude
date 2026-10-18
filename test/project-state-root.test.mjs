import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensureStateDirIgnored, resolveProjectStateRoot } from "../plugins/litclaude/lib/project-state-root.mjs";
import { writeAutoloopState } from "../plugins/litclaude/lib/litgoal/autoloop.mjs";
import { recordContextUsage } from "../plugins/litclaude/lib/auto-handoff.mjs";
import { recordInterfaceProbeTurn } from "../plugins/litclaude/lib/interface-probe-gate.mjs";
import { recordLitPlanTurn } from "../plugins/litclaude/lib/lit-plan-persistence.mjs";
import { runLitgoalCli } from "../plugins/litclaude/lib/litgoal/cli.mjs";
import { MOTION_DISCIPLINE, recordMotionTurn } from "../plugins/litclaude/lib/motion-render-gate.mjs";
import { writeSessionState } from "../plugins/litclaude/lib/rules/session-state.mjs";
import { acquireStartWorkLock, releaseStartWorkLock } from "../plugins/litclaude/lib/start-work-lifecycle.mjs";
import { writeCaptureSettings } from "../plugins/litclaude/lib/wikify-knowledge.mjs";
import { runTeamCli } from "../plugins/litclaude/skills/lit-team/scripts/team.mjs";
import { scaffold } from "../plugins/litclaude/scripts/scaffold-plan.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("project state root resolution", () => {
  it("keeps rules-session, litgoal, team, and scaffold state at the outer git root from a nested package cwd", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "litclaude-state-root-"));
    try {
      mkdirSync(join(fixtureRoot, ".git"));
      mkdirSync(join(fixtureRoot, ".litclaude"));
      const nestedCwd = join(fixtureRoot, "packages", "lithermes-installer", "assets", "lithermes-plugin");
      mkdirSync(nestedCwd, { recursive: true });
      const canonicalNestedCwd = realpathSync.native(nestedCwd);
      writeFileSync(join(fixtureRoot, "packages", "lithermes-installer", "package.json"), "{}\n");

      const moduleUrl = (relativePath) => pathToFileURL(join(repoRoot, relativePath)).href;
      const driverPath = join(fixtureRoot, "nested-writers.mjs");
      writeFileSync(driverPath, [
        `import { writeSessionState } from ${JSON.stringify(moduleUrl("plugins/litclaude/lib/rules/session-state.mjs"))};`,
        `import { writeAutoloopState } from ${JSON.stringify(moduleUrl("plugins/litclaude/lib/litgoal/autoloop.mjs"))};`,
        `import { runTeamCli } from ${JSON.stringify(moduleUrl("plugins/litclaude/skills/lit-team/scripts/team.mjs"))};`,
        `import { scaffold } from ${JSON.stringify(moduleUrl("plugins/litclaude/scripts/scaffold-plan.mjs"))};`,
        "const cwd = process.cwd();",
        "const rulesWritten = writeSessionState(cwd, 'rules-session', { injected: [], postCompactCount: 0 });",
        "writeAutoloopState(cwd, { blockCount: 0, firstBlockAt: 1 });",
        "let teamOutput = '';",
        "const teamStatus = runTeamCli(['init', '--name', 'Nested lane'], { stdout: { write: (value) => { teamOutput += value; } }, stderr: { write() {} } }, cwd);",
        "const teamId = JSON.parse(teamOutput).team_id;",
        "const draft = await scaffold(cwd, { slug: 'nested-state-root', intent: 'clear', draftOnly: true });",
        "console.log(JSON.stringify({ cwd, rulesWritten, teamStatus, teamId, draft }));",
      ].join("\n"));

      const result = spawnSync(process.execPath, [driverPath], {
        cwd: nestedCwd,
        encoding: "utf8",
        timeout: 5_000,
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(result.stdout);
      assert.equal(output.cwd, canonicalNestedCwd);
      assert.equal(output.rulesWritten, true);
      assert.equal(output.teamStatus, 0);
      assert.equal(output.teamId, "nested-lane-01");
      assert.equal(output.draft[0].status, "created");
      assert.equal(existsSync(join(fixtureRoot, ".litclaude", "rules", "session-rules-session.json")), true);
      assert.equal(existsSync(join(fixtureRoot, ".litclaude", "litgoal", "autoloop.json")), true);
      assert.equal(existsSync(join(fixtureRoot, ".litclaude", "teams", "nested-lane-01", "team.json")), true);
      assert.equal(existsSync(join(fixtureRoot, ".litclaude", "drafts", "nested-state-root.md")), true);
      assert.equal(existsSync(join(canonicalNestedCwd, ".litclaude")), false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("uses the nearest marker when no git root exists", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "litclaude-state-marker-"));
    try {
      const projectRoot = join(fixtureRoot, "project");
      const nestedCwd = join(projectRoot, "packages", "nested");
      mkdirSync(nestedCwd, { recursive: true });
      writeFileSync(join(projectRoot, "package.json"), "{}\n");

      assert.equal(resolveProjectStateRoot(nestedCwd), projectRoot);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps a marker-less plain directory as its own state root", () => {
    const plainRoot = mkdtempSync(join(tmpdir(), "litclaude-state-plain-"));
    try {
      assert.equal(resolveProjectStateRoot(plainRoot), plainRoot);
      writeAutoloopState(plainRoot, { blockCount: 0, firstBlockAt: 1 });
      assert.equal(existsSync(join(plainRoot, ".litclaude", "litgoal", "autoloop.json")), true);
    } finally {
      rmSync(plainRoot, { recursive: true, force: true });
    }
  });
});

describe("project state folder stays out of the user's commits", () => {
  const quiet = { stdout: { write() {} }, stderr: { write() {} } };
  // Every code path that can create the project's .litclaude folder, keyed by what it writes.
  const writers = {
    "rules session": (root) => writeSessionState(root, "s1", { injected: [], postCompactCount: 0 }),
    "litgoal autoloop": (root) => writeAutoloopState(root, { blockCount: 0, firstBlockAt: 1 }),
    "litgoal cli": (root) => runLitgoalCli(["create-goals", "--brief", "Ship it", "--json"], quiet, root),
    "start-work lock": (root) => releaseStartWorkLock(root, acquireStartWorkLock(root)),
    "motion turn": (root) => recordMotionTurn(root, { sessionId: "s1", discipline: MOTION_DISCIPLINE }),
    "interface-probe turn": (root) => recordInterfaceProbeTurn(root, { sessionId: "s1", discipline: "lit-loop" }),
    "lit-plan turn": (root) => recordLitPlanTurn(root, { sessionId: "s1" }),
    "auto-handoff context": (root) => recordContextUsage({ stateRoot: root, sessionId: "s1", percent: 10, window: 200000 }),
    "wikify settings": (root) => writeCaptureSettings(root, true),
    "lit-team": (root) => runTeamCli(["init", "--name", "Ignore lane"], quiet, root),
    "scaffold-plan draft": (root) => scaffold(root, { slug: "ignore-check", intent: "clear", draftOnly: true }),
  };

  for (const [name, write] of Object.entries(writers)) {
    it(`${name} marks a new .litclaude folder ignored`, async () => {
      const root = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-state-ignore-")));
      try {
        await write(root);
        assert.equal(existsSync(join(root, ".litclaude")), true, `${name} did not create state`);
        assert.match(readFileSync(join(root, ".litclaude", ".gitignore"), "utf8"), /^\*$/mu);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("leaves git status clean without touching the user's ignore files", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-state-git-")));
    const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    try {
      assert.equal(git("init", "-q", ".").status, 0);
      const excludeBefore = readFileSync(join(root, ".git", "info", "exclude"), "utf8");

      writeSessionState(root, "s1", { injected: [], postCompactCount: 0 });
      recordLitPlanTurn(root, { sessionId: "s1" });

      assert.equal(git("status", "--porcelain", "--untracked-files=all").stdout, "");
      assert.equal(existsSync(join(root, ".gitignore")), false, "the project's own .gitignore must not be created");
      assert.equal(readFileSync(join(root, ".git", "info", "exclude"), "utf8"), excludeBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an existing .litclaude/.gitignore as the user wrote it", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-state-keep-")));
    try {
      mkdirSync(join(root, ".litclaude"));
      writeFileSync(join(root, ".litclaude", ".gitignore"), "rules/\n");
      writeSessionState(root, "s1", { injected: [], postCompactCount: 0 });
      assert.equal(readFileSync(join(root, ".litclaude", ".gitignore"), "utf8"), "rules/\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never writes the ignore file through a symlinked state folder", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-state-link-")));
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-state-outside-")));
    try {
      symlinkSync(outside, join(root, ".litclaude"));
      ensureStateDirIgnored(join(root, ".litclaude", "litgoal", "goals.json"));
      assert.equal(existsSync(join(outside, ".gitignore")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
