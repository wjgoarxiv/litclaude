import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runTeamCli } from "../plugins/litclaude/skills/lit-team/scripts/team.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const teamPath = join(root, "plugins", "litclaude", "skills", "lit-team", "scripts", "team.mjs");

const temps = [];
const makeCwd = () => {
  const dir = mkdtempSync(join(tmpdir(), "litteam-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
});

const team = (cwd, ...argv) => {
  const out = [];
  const err = [];
  const io = { stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) } };
  const code = runTeamCli(argv, io, cwd);
  return { code, stdout: out.join(""), stderr: err.join(""), json: () => JSON.parse(out.join("")) };
};

const teamProcess = (cwd, ...argv) => new Promise((resolveRun) => {
  const child = spawn(process.execPath, [teamPath, ...argv], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => resolveRun({ code, stdout, stderr }));
});

const seed = (cwd) => {
  assert.equal(team(cwd, "init", "--name", "parser fix").code, 0);
  return "parser-fix-01";
};

describe("lit-team packet — mechanical rules", () => {
  it("init creates the packet under the git-ignored product state dir", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    for (const rel of ["team.json", "guide.md", "artifacts"]) {
      assert.equal(existsSync(join(cwd, ".litclaude", "teams", id, rel)), true, `missing ${rel}`);
    }
  });

  it("probes the next unused suffix instead of overwriting an existing hole collision", () => {
    const cwd = makeCwd();
    const first = seed(cwd);
    assert.equal(first, "parser-fix-01");
    const canaryDir = join(cwd, ".litclaude", "teams", "parser-fix-03");
    mkdirSync(canaryDir, { recursive: true });
    const canaryPath = join(canaryDir, "team.json");
    writeFileSync(canaryPath, "DO NOT OVERWRITE\n");

    const second = team(cwd, "init", "--name", "parser fix");
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.json().team_id, "parser-fix-02");
    assert.equal(readFileSync(canaryPath, "utf8"), "DO NOT OVERWRITE\n");

    const third = team(cwd, "init", "--name", "parser fix");
    assert.equal(third.code, 0, third.stderr);
    assert.equal(third.json().team_id, "parser-fix-04");
    assert.equal(readFileSync(canaryPath, "utf8"), "DO NOT OVERWRITE\n", "re-init must preserve every prior team state");
  });

  it("stays `forming` with one member and needs two before a brief is issued", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    assert.equal(team(cwd, "add-member", "--team", id, "--id", "A", "--focus", "lexer", "--deliverable", "lexer tests").json().status, "forming");

    const early = team(cwd, "prompt", "--team", id, "--id", "A");
    assert.notEqual(early.code, 0, "one member is not a team");
    assert.match(early.stderr, /at least 2 are required/u);

    assert.equal(team(cwd, "add-member", "--team", id, "--id", "B", "--focus", "parser", "--deliverable", "parser tests").json().status, "active");
    assert.equal(team(cwd, "prompt", "--team", id, "--id", "A").code, 0);
  });

  it("rejects an overlapping slice by name, case-insensitively", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    team(cwd, "add-member", "--team", id, "--id", "A", "--focus", "parser", "--deliverable", "x");
    const clash = team(cwd, "add-member", "--team", id, "--id", "B", "--focus", "PARSER", "--deliverable", "y");
    assert.notEqual(clash.code, 0, "two members on one slice is one worker plus overhead");
    assert.match(clash.stderr, /overlaps member A/u);
  });

  it("refuses a report with no evidence path", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    team(cwd, "add-member", "--team", id, "--id", "A", "--focus", "lexer", "--deliverable", "x");
    team(cwd, "add-member", "--team", id, "--id", "B", "--focus", "parser", "--deliverable", "y");
    const ackOnly = team(cwd, "report", "--team", id, "--id", "A");
    assert.notEqual(ackOnly.code, 0, "an acknowledgement is not a report");
    assert.match(ackOnly.stderr, /missing evidence/u);
  });

  it("refuses to archive while a member is neither reported nor blocked, and names who", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    team(cwd, "add-member", "--team", id, "--id", "A", "--focus", "lexer", "--deliverable", "x");
    team(cwd, "add-member", "--team", id, "--id", "B", "--focus", "parser", "--deliverable", "y");

    const early = team(cwd, "archive", "--team", id);
    assert.notEqual(early.code, 0);
    assert.match(early.stderr, /A, B have not reported or blocked/u);

    team(cwd, "report", "--team", id, "--id", "A", "--evidence", "evidence/a.txt");
    team(cwd, "block", "--team", id, "--id", "B", "--reason", "needs a decision");

    const status = team(cwd, "status", "--team", id).json();
    assert.equal(status.done, true);
    assert.equal(status.cleanup_required, true, "an unarchived team is still an open cleanup item");

    assert.equal(team(cwd, "archive", "--team", id).json().status, "archived");
    assert.equal(team(cwd, "status", "--team", id).json().cleanup_required, false);
  });

  it("emits a brief carrying the assignment contract and the other members' slices", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    team(cwd, "add-member", "--team", id, "--id", "A", "--focus", "lexer", "--deliverable", "lexer tests");
    team(cwd, "add-member", "--team", id, "--id", "B", "--focus", "parser", "--deliverable", "parser tests");
    const { message } = team(cwd, "prompt", "--team", id, "--id", "A").json();
    for (const marker of ["TASK:", "DELIVERABLE:", "SCOPE:", "VERIFY:", "STOP WHEN:", "WORKING:", "BLOCKED:"]) {
      assert.ok(message.includes(marker), `brief must carry ${marker}`);
    }
    assert.match(message, /B owns "parser"/u, "the child must know what not to touch");
  });

  it("rewrites guide.md on every mutation so a member never reads stale state", () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    const guide = () => readFileSync(join(cwd, ".litclaude", "teams", id, "guide.md"), "utf8");
    team(cwd, "add-member", "--team", id, "--id", "A", "--focus", "lexer", "--deliverable", "x");
    assert.match(guide(), /lexer/u);
    team(cwd, "add-member", "--team", id, "--id", "B", "--focus", "parser", "--deliverable", "y");
    assert.match(guide(), /parser/u);
  });

  it("serializes twelve successful concurrent real-CLI reports without losing a member", async () => {
    const cwd = makeCwd();
    const id = seed(cwd);
    const memberIds = Array.from({ length: 12 }, (_, index) => `M${index + 1}`);
    for (const [index, memberId] of memberIds.entries()) {
      const added = team(
        cwd,
        "add-member", "--team", id,
        "--id", memberId,
        "--focus", `slice-${index + 1}`,
        "--deliverable", `artifact-${index + 1}`,
      );
      assert.equal(added.code, 0, added.stderr);
    }

    const reports = await Promise.all(memberIds.map((memberId) => teamProcess(
      cwd,
      "report", "--team", id,
      "--id", memberId,
      "--evidence", `evidence/${memberId}.txt`,
    )));
    for (const report of reports) assert.equal(report.code, 0, report.stderr);

    const final = team(cwd, "status", "--team", id).json();
    assert.deepEqual(final.members.map(({ id: memberId }) => memberId), memberIds);
    assert.deepEqual(final.members.map(({ status }) => status), memberIds.map(() => "reported"));
    assert.deepEqual(final.outstanding, []);
    assert.equal(existsSync(join(cwd, ".litclaude", "teams", id, ".lock")), false);
  });

  it("never throws on unknown teams, unknown members, or corrupt state", () => {
    const cwd = makeCwd();
    assert.equal(team(cwd, "status", "--team", "nope").code, 65);
    const id = seed(cwd);
    assert.equal(team(cwd, "report", "--team", id, "--id", "Z", "--evidence", "x").code, 65);
    writeFileSync(join(cwd, ".litclaude", "teams", id, "team.json"), "{ not json");
    assert.equal(team(cwd, "status", "--team", id).code, 65);
  });
});

describe("lit-team route", () => {
  const routeFor = (prompt) => {
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
    });
    assert.equal(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    return {
      body: /<litclaude-skill-body name="([a-z-]+)">/u.exec(context)?.[1] ?? null,
      context,
    };
  };

  it("routes the documented team triggers to the lit-team body, not a generic one", () => {
    // These were documented in docs/hooks.md and tested, but skillId fell back to lit-loop,
    // so the advertised route injected lit-loop's body — the litwork defect, repeated.
    for (const prompt of ["lit team mode", "lit teammates", "lit team review this implementation"]) {
      assert.equal(routeFor(prompt).body, "lit-team", `${prompt} must inject the lit-team body`);
    }
  });

  it("answers its own name and the dollar shorthand", () => {
    assert.equal(routeFor("lit-team").body, "lit-team");
    assert.equal(routeFor("$lit-team").body, "lit-team");
  });

  it("is not an anywhere-token", () => {
    assert.equal(routeFor("plain lit-team discussion").body, null);
  });

  it("does not hijack the other lit routes", () => {
    assert.equal(routeFor("lit plan the migration").body, "lit-plan");
    assert.equal(routeFor("litwork ship it").body, "litwork");
  });
});
