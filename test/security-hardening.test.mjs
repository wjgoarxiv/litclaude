import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-resources.mjs";
import { acquireOwnerLock, OwnerLockError } from "../plugins/litclaude/lib/owner-lock.mjs";
import { verifyCanonicalSkillResources } from "../plugins/litclaude/lib/skill-resource-integrity.mjs";
import { staticRulesBlock } from "../plugins/litclaude/lib/rules/engine.mjs";
import { ruleKey } from "../plugins/litclaude/lib/rules/session-state.mjs";
import { runTeamCli } from "../plugins/litclaude/skills/lit-team/scripts/team.mjs";

const temps = [];
const pluginRoot = fileURLToPath(new URL("../plugins/litclaude", import.meta.url));
const ownerLockUrl = new URL("../plugins/litclaude/lib/owner-lock.mjs", import.meta.url).href;
const makeTemp = (prefix = "lit-security-") => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temps.push(directory);
  return directory;
};

const write = (root, relativePath, content) => {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
};

const team = (cwd, ...argv) => {
  const stdout = [];
  const stderr = [];
  const code = runTeamCli(
    argv,
    {
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    },
    cwd,
  );
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
};

const exitedProcessId = () => new Promise((resolvePid, reject) => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  child.once("error", reject);
  child.once("close", () => resolvePid(pid));
});

const lockContender = (lockDir, criticalPath) => new Promise((resolveRun) => {
  const source = `
    import { closeSync, openSync, rmSync } from "node:fs";
    import { acquireOwnerLock, releaseOwnerLock } from ${JSON.stringify(ownerLockUrl)};
    const [lockDir, criticalPath] = process.argv.slice(1);
    let owner;
    let criticalFd;
    try {
      owner = acquireOwnerLock(lockDir, { timeoutMs: 2_000, staleMs: 0 });
      criticalFd = openSync(criticalPath, "wx");
      closeSync(criticalFd);
      criticalFd = undefined;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
      rmSync(criticalPath, { force: true });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 42;
    } finally {
      if (criticalFd !== undefined) closeSync(criticalFd);
      if (owner && !releaseOwnerLock(lockDir, owner)) process.exitCode = 43;
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, lockDir, criticalPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => resolveRun({ code, stderr }));
});

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop(), { recursive: true, force: true });
});

describe("rules filesystem boundary hardening", () => {
  const project = () => {
    const root = makeTemp("lit-rules-project-");
    writeFileSync(join(root, "package.json"), "{}\n");
    return root;
  };

  it("rejects escaping file and directory symlinks from project rule roots", () => {
    const parent = makeTemp("lit-rules-siblings-");
    const root = join(parent, "project");
    const sibling = join(parent, "project-evil");
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(root, "package.json"), "{}\n");

    const fileCanary = write(sibling, "file.md", "---\nalwaysApply: true\n---\nPROJECT FILE SYMLINK CANARY");
    symlinkSync(fileCanary, join(root, ".claude", "rules", "escaped.md"), "file");
    write(sibling, "directory/rule.md", "---\nalwaysApply: true\n---\nPROJECT DIRECTORY SYMLINK CANARY");
    mkdirSync(join(root, ".cursor"), { recursive: true });
    symlinkSync(join(sibling, "directory"), join(root, ".cursor", "rules"), "dir");

    const block = staticRulesBlock({ cwd: root, skipUserHome: true, pluginRoot: null });
    assert.doesNotMatch(block, /PROJECT (?:FILE|DIRECTORY) SYMLINK CANARY/u);
  });

  it("rejects escaping file and directory symlinks from user-home rule roots", () => {
    const root = project();
    const home = makeTemp("lit-rules-home-");
    const outside = makeTemp("lit-rules-home-outside-");
    mkdirSync(join(home, ".claude", "rules"), { recursive: true });
    const fileCanary = write(outside, "file.md", "---\nalwaysApply: true\n---\nHOME FILE SYMLINK CANARY");
    symlinkSync(fileCanary, join(home, ".claude", "rules", "escaped.md"), "file");
    write(outside, "directory/rule.md", "---\nalwaysApply: true\n---\nHOME DIRECTORY SYMLINK CANARY");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    symlinkSync(join(outside, "directory"), join(home, ".cursor", "rules"), "dir");

    const block = staticRulesBlock({ cwd: root, homeDir: home, pluginRoot: null });
    assert.doesNotMatch(block, /HOME (?:FILE|DIRECTORY) SYMLINK CANARY/u);
  });

  it("rejects escaping file and directory symlinks from bundled rule roots", () => {
    const root = project();
    const pluginRoot = makeTemp("lit-rules-plugin-");
    const outside = makeTemp("lit-rules-plugin-outside-");
    mkdirSync(join(pluginRoot, "bundled-rules", "nested"), { recursive: true });
    const fileCanary = write(outside, "file.md", "---\nalwaysApply: true\n---\nBUNDLED FILE SYMLINK CANARY");
    symlinkSync(fileCanary, join(pluginRoot, "bundled-rules", "escaped.md"), "file");
    write(outside, "directory/rule.md", "---\nalwaysApply: true\n---\nBUNDLED DIRECTORY SYMLINK CANARY");
    symlinkSync(join(outside, "directory"), join(pluginRoot, "bundled-rules", "nested", "escape"), "dir");

    const block = staticRulesBlock({ cwd: root, skipUserHome: true, pluginRoot });
    assert.doesNotMatch(block, /BUNDLED (?:FILE|DIRECTORY) SYMLINK CANARY/u);
  });

  it("fails closed before emission instead of claiming through a symlinked .litclaude root", () => {
    const root = project();
    const outside = makeTemp("lit-rules-state-outside-");
    const canary = write(outside, "canary.txt", "unchanged\n");
    write(root, ".claude/rules/always.md", "---\nalwaysApply: true\n---\nSAFE BODY");
    symlinkSync(outside, join(root, ".litclaude"), "dir");

    assert.doesNotMatch(staticRulesBlock({ cwd: root, skipUserHome: true, pluginRoot: null, sessionId: "session-1" }), /SAFE BODY/u);
    assert.equal(readFileSync(canary, "utf8"), "unchanged\n");
    assert.equal(existsSync(join(outside, "rules")), false, "state writes must not escape through .litclaude");
  });

  it("keeps source files NUL-free while preserving the runtime rule-key separator", () => {
    const source = readFileSync(new URL("../plugins/litclaude/lib/rules/session-state.mjs", import.meta.url));
    assert.equal(source.includes(0), false, "JavaScript source must spell the separator as an escape sequence");
    assert.equal(ruleKey({ relativePath: "a.md", bodyHash: "hash" }), "a.md\0hash");
  });
});

describe("reusable owner lock crash recovery", () => {
  it("rejects a non-directory owner lock path before acquisition", () => {
    const root = makeTemp("lit-owner-lock-unsafe-type-");
    const lockDir = join(root, "state.lock");
    writeFileSync(lockDir, "not a directory\n");

    assert.throws(
      () => acquireOwnerLock(lockDir, { timeoutMs: 25, staleMs: 0 }),
      (error) => error instanceof OwnerLockError && /owner lock path must be a regular directory/u.test(error.message),
    );
    assert.equal(readFileSync(lockDir, "utf8"), "not a directory\n");
  });

  it("recovers an abandoned stale takeover claim without allowing two owners into the critical section", async () => {
    const root = makeTemp("lit-owner-lock-");
    const lockDir = join(root, "state.lock");
    const criticalPath = join(root, "critical");
    const deadPid = await exitedProcessId();
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({
      nonce: "dead-owner",
      pid: deadPid,
      acquired_at_ms: 0,
    })}\n`);
    const abandonedClaim = `${JSON.stringify({
      owner_nonce: "dead-owner",
      claimant_nonce: "abandoned-claim",
      pid: deadPid,
      acquired_at_ms: 0,
    })}\n`;
    writeFileSync(join(lockDir, ".takeover-dead-owner"), `${deadPid}\n`);
    writeFileSync(join(lockDir, ".takeover-dead-owner.abandoned-claim.json"), abandonedClaim);

    const contenders = await Promise.all([
      lockContender(lockDir, criticalPath),
      lockContender(lockDir, criticalPath),
    ]);
    for (const contender of contenders) assert.equal(contender.code, 0, contender.stderr);
    assert.equal(existsSync(lockDir), false);
    assert.equal(existsSync(criticalPath), false);
  });

  it("leaves an earlier live takeover claimant in place", async () => {
    const root = makeTemp("lit-owner-lock-live-claim-");
    const lockDir = join(root, "state.lock");
    const deadPid = await exitedProcessId();
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "dead-owner", pid: deadPid, acquired_at_ms: 0 })}\n`);
    const claimPath = join(lockDir, ".takeover-dead-owner.zzzz-live-claim.json");
    writeFileSync(claimPath, `${JSON.stringify({
      owner_nonce: "dead-owner",
      claimant_nonce: "zzzz-live-claim",
      pid: process.pid,
      acquired_at_ms: 0,
    })}\n`);

    assert.throws(
      () => acquireOwnerLock(lockDir, { timeoutMs: 25, staleMs: 0 }),
      (error) => error instanceof OwnerLockError && /timed out/u.test(error.message),
    );
    assert.equal(existsSync(claimPath), true);
  });

  it("leaves a dead but young takeover claimant in place", async () => {
    const root = makeTemp("lit-owner-lock-young-claim-");
    const lockDir = join(root, "state.lock");
    const deadPid = await exitedProcessId();
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "dead-owner", pid: deadPid, acquired_at_ms: 0 })}\n`);
    const claimPath = join(lockDir, ".takeover-dead-owner.zzzz-young-claim.json");
    writeFileSync(claimPath, `${JSON.stringify({
      owner_nonce: "dead-owner",
      claimant_nonce: "zzzz-young-claim",
      pid: deadPid,
      acquired_at_ms: Date.now(),
    })}\n`);

    assert.throws(
      () => acquireOwnerLock(lockDir, { timeoutMs: 25, staleMs: 30_000 }),
      (error) => error instanceof OwnerLockError && /timed out/u.test(error.message),
    );
    assert.equal(existsSync(claimPath), true);
  });

  it("uses a monotonic clock for the local lock wait when wall time moves backwards", () => {
    const root = makeTemp("lit-owner-lock-clock-");
    const lockDir = join(root, "state.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({
      nonce: "live-owner",
      pid: process.pid,
      acquired_at_ms: 0,
    })}\n`);
    const source = `
      import { acquireOwnerLock } from ${JSON.stringify(ownerLockUrl)};
      const lockDir = process.argv[1];
      Date.now = () => 0;
      try {
        acquireOwnerLock(lockDir, { timeoutMs: 50, staleMs: 30_000 });
        process.stdout.write(JSON.stringify({ name: "ACQUIRED" }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ name: error?.name, message: error?.message }));
      }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, lockDir], {
      encoding: "utf8",
      timeout: 1_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.name, "OwnerLockError", "the child must return the bounded lock timeout");
    assert.match(output.message, /timed out/u);
  });
});

describe("lit-team filesystem boundary hardening", () => {
  const validTeam = (teamId) => ({
    version: 1,
    team_id: teamId,
    name: "canary",
    objective: "",
    status: "active",
    members: [{ id: "A", focus: "slice", deliverable: "artifact", status: "pending", evidence: null, note: null }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("rejects a raw traversal team id before reading or writing its target", () => {
    const cwd = makeTemp("lit-team-traversal-");
    const outside = join(cwd, "outside-team");
    const statePath = write(cwd, "outside-team/team.json", `${JSON.stringify(validTeam("../../outside-team"), null, 2)}\n`);
    const before = readFileSync(statePath, "utf8");

    const result = team(cwd, "report", "--team", "../../outside-team", "--id", "A", "--evidence", "proof.txt");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /invalid team id/u);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal(existsSync(join(outside, "guide.md")), false);
  });

  it("rejects persisted team_id mismatch without creating the mismatched target", () => {
    const cwd = makeTemp("lit-team-mismatch-");
    assert.equal(team(cwd, "init", "--name", "alpha").code, 0);
    const requested = "alpha-01";
    const statePath = join(cwd, ".litclaude", "teams", requested, "team.json");
    const mismatched = { ...JSON.parse(readFileSync(statePath, "utf8")), team_id: "other-01" };
    writeFileSync(statePath, `${JSON.stringify(mismatched, null, 2)}\n`);
    const before = readFileSync(statePath, "utf8");

    const result = team(cwd, "add-member", "--team", requested, "--id", "A", "--focus", "slice", "--deliverable", "artifact");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /team id mismatch/u);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal(existsSync(join(cwd, ".litclaude", "teams", "other-01")), false);
  });

  it("rejects a symlinked team directory and leaves the outside canary unchanged", () => {
    const cwd = makeTemp("lit-team-symlink-");
    const outside = makeTemp("lit-team-symlink-outside-");
    const teamId = "linked-01";
    const statePath = write(outside, "team.json", `${JSON.stringify(validTeam(teamId), null, 2)}\n`);
    const before = readFileSync(statePath, "utf8");
    mkdirSync(join(cwd, ".litclaude", "teams"), { recursive: true });
    symlinkSync(outside, join(cwd, ".litclaude", "teams", teamId), "dir");

    const result = team(cwd, "report", "--team", teamId, "--id", "A", "--evidence", "proof.txt");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /symlink/u);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal(existsSync(join(outside, "guide.md")), false);
  });

  it("rejects init through a symlinked .litclaude root", () => {
    const cwd = makeTemp("lit-team-root-");
    const outside = makeTemp("lit-team-root-outside-");
    const canary = write(outside, "canary.txt", "unchanged\n");
    symlinkSync(outside, join(cwd, ".litclaude"), "dir");

    const result = team(cwd, "init", "--name", "escape");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /symlink/u);
    assert.equal(readFileSync(canary, "utf8"), "unchanged\n");
    assert.equal(existsSync(join(outside, "teams")), false);
  });
});

describe("installed integrity coverage", () => {
  const tamperedResourceReport = (relativePath) => {
    const fixture = makeTemp("lit-resource-integrity-");
    const fixturePluginRoot = join(fixture, "litclaude");
    cpSync(pluginRoot, fixturePluginRoot, { recursive: true });
    const target = join(fixturePluginRoot, relativePath);
    writeFileSync(target, `${readFileSync(target, "utf8")}\n// isolated tamper\n`);
    return verifyCanonicalSkillResources(fixturePluginRoot);
  };

  it("hash-pins the LitResearch attribution notice", () => {
    assert.equal(canonicalSkillResourceManifest.has("skills/litresearch/ATTRIBUTION.md"), true);
  });

  it("rejects tampering in the browser capability probe runtime", () => {
    const relativePath = "skills/browser-drive/scripts/capability-probe.mjs";
    const report = tamperedResourceReport(relativePath);

    assert.equal(report.status, "FAIL");
    assert.deepEqual(report.failures.map(({ path }) => path), [relativePath]);
    assert.equal(canonicalSkillResourceManifest.has(relativePath), true);
  });

  it("rejects tampering in the shared secret-shape runtime", () => {
    const relativePath = "lib/secret-shapes.mjs";
    assert.equal(canonicalSkillResourceManifest.has(relativePath), true);
    const report = tamperedResourceReport(relativePath);

    assert.equal(report.status, "FAIL");
    assert.deepEqual(report.failures.map(({ path }) => path), [relativePath]);
  });

  it("exercises attribution tamper and deletion in the installed repair probe", () => {
    const source = readFileSync(new URL("../scripts/qa-installed-tamper-repair.mjs", import.meta.url), "utf8");
    assert.match(source, /"skills\/litresearch\/ATTRIBUTION\.md"/u);
  });
});
