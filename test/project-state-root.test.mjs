import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveProjectStateRoot } from "../plugins/litclaude/lib/project-state-root.mjs";
import { writeAutoloopState } from "../plugins/litclaude/lib/litgoal/autoloop.mjs";

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
