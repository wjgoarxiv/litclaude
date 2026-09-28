import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { pathIdentity } from "../plugins/litclaude/lib/secure-path-read.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const temps = [];

const makeTemp = (prefix = "litclaude-inode-") => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temps.push(path);
  return path;
};

const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};

const sameSizeReplacement = (path, original, replacement) => {
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(replacement), "simulation needs equal-size records");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, original);
  const originalStat = lstatSync(path);
  const replacementPath = `${path}.replacement`;
  writeFileSync(replacementPath, replacement);
  chmodSync(replacementPath, originalStat.mode & 0o777);
  utimesSync(replacementPath, originalStat.atime, originalStat.mtime);
  return { replacementPath, originalStat };
};

const reusePreload = (directory) => {
  const path = join(directory, "reuse-preload.mjs");
  writeFileSync(path, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const realLstat = fs.lstatSync;
const realOpen = fs.openSync;
const realFstat = fs.fstatSync;
const realClose = fs.closeSync;
let swapped = false;
let targetFd;
let pinned;
const target = process.env.LITCLAUDE_SWAP_TARGET;
const held = process.env.LITCLAUDE_SWAP_HELD;
const replacement = process.env.LITCLAUDE_SWAP_REPLACEMENT;
const same = (value) => String(value) === target;
const forgeReuse = (stat) => {
  if (!pinned) return stat;
  Object.assign(stat, {
    dev: pinned.dev,
    ino: pinned.ino,
    mode: pinned.mode,
    nlink: pinned.nlink,
    size: pinned.size,
    mtimeMs: pinned.mtimeMs,
    // Linux filesystems such as overlayfs may expose a constant/epoch birthtime.
    // Preserve the captured value so this seam does not accidentally rely on
    // APFS's recreation-specific birthtime.
    birthtimeMs: pinned.birthtimeMs,
  });
  return stat;
};
fs.lstatSync = function patchedLstat(pathValue, ...args) {
  const stat = realLstat.call(this, pathValue, ...args);
  return swapped && same(pathValue) ? forgeReuse(stat) : stat;
};
fs.openSync = function patchedOpen(pathValue, ...args) {
  if (!swapped && same(pathValue)) {
    pinned = realLstat.call(this, pathValue, { throwIfNoEntry: false });
    fs.renameSync(pathValue, held);
    fs.renameSync(replacement, pathValue);
    swapped = true;
    if (process.env.LITCLAUDE_SWAP_MARKER) fs.writeFileSync(process.env.LITCLAUDE_SWAP_MARKER, String(pathValue));
  }
  const fd = realOpen.call(this, pathValue, ...args);
  if (swapped && same(pathValue) && targetFd === undefined) targetFd = fd;
  return fd;
};
fs.fstatSync = function patchedFstat(fd, ...args) {
  const stat = realFstat.call(this, fd, ...args);
  return swapped && fd === targetFd ? forgeReuse(stat) : stat;
};
fs.closeSync = function patchedClose(fd, ...args) {
  if (fd === targetFd) targetFd = undefined;
  return realClose.call(this, fd, ...args);
};
syncBuiltinESMExports();
`);
  return path;
};

const replacementRacePreload = (directory) => {
  const path = join(directory, "replacement-race-preload.mjs");
  writeFileSync(path, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const realRename = fs.renameSync;
const realRemove = fs.rmSync;
const realUnlink = fs.unlinkSync;
let swapped = false;
const target = process.env.LITCLAUDE_SWAP_TARGET;
const held = process.env.LITCLAUDE_SWAP_HELD;
const replacement = process.env.LITCLAUDE_SWAP_REPLACEMENT;
const marker = process.env.LITCLAUDE_SWAP_MARKER;
const swap = (source) => {
  if (!swapped && String(source) === target) {
    realRename.call(fs, source, held);
    realRename.call(fs, replacement, source);
    swapped = true;
    if (marker) fs.writeFileSync(marker, String(source));
  }
};
fs.renameSync = function patchedRename(source, destination, ...args) {
  swap.call(this, source);
  return realRename.call(this, source, destination, ...args);
};
fs.rmSync = function patchedRm(source, ...args) {
  swap.call(this, source);
  return realRemove.call(this, source, ...args);
};
fs.unlinkSync = function patchedUnlink(source, ...args) {
  swap.call(this, source);
  return realUnlink.call(this, source, ...args);
};
syncBuiltinESMExports();
`);
  return path;
};

const parentReusePreload = (directory) => {
  const path = join(directory, "parent-preload.mjs");
  writeFileSync(path, `
import fs from "node:fs/promises";
import syncFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const realLstat = fs.lstat;
let count = 0;
let swapped = false;
let pinned;
const target = process.env.LITCLAUDE_SWAP_TARGET;
const held = process.env.LITCLAUDE_SWAP_HELD;
const replacement = process.env.LITCLAUDE_SWAP_REPLACEMENT;
const marker = process.env.LITCLAUDE_SWAP_MARKER;
const forge = (stat) => {
  if (!pinned) return stat;
  Object.assign(stat, {
    dev: pinned.dev,
    ino: pinned.ino,
    mode: pinned.mode,
    nlink: pinned.nlink,
    size: pinned.size,
    mtimeMs: pinned.mtimeMs,
    // Model Linux's non-distinguishing birthtime fallback for directory pins.
    birthtimeMs: pinned.birthtimeMs,
  });
  return stat;
};
fs.lstat = async function patchedLstat(pathValue, ...args) {
  const stat = await realLstat.call(this, pathValue, ...args);
  if (String(pathValue) !== target) return stat;
  count += 1;
  if (!swapped && count === 2) {
    pinned = stat;
    await fs.rename(pathValue, held);
    await fs.rename(replacement, pathValue);
    swapped = true;
    if (marker) await syncFs.promises.writeFile(marker, String(pathValue));
    return pinned;
  }
  return swapped ? forge(stat) : stat;
};
syncBuiltinESMExports();
`);
  return path;
};

const runChild = (source, args, env, preload) => spawnSync(
  process.execPath,
  ["--input-type=module", "-e", source, ...args],
  {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    },
  },
);

const readChild = (modulePath, expression, args, swap) => {
  const preload = reusePreload(dirname(swap.target));
  return runChild(
    `import * as api from ${JSON.stringify(pathToFileURL(modulePath).href)};
const value = await (${expression});
if (value !== undefined) process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));`,
    args,
    {
      LITCLAUDE_SWAP_TARGET: swap.target,
      LITCLAUDE_SWAP_HELD: swap.held,
      LITCLAUDE_SWAP_REPLACEMENT: swap.replacement,
      LITCLAUDE_SWAP_MARKER: `${swap.target}.swap-marker`,
    },
    preload,
  );
};

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop(), { recursive: true, force: true });
});
describe("simulated Linux inode reuse — bounded reads", () => {
  it("rejects an owner record replacement before stale-lock decisions", () => {
    const root = makeTemp();
    const lock = join(root, "lock");
    mkdirSync(lock);
    const original = JSON.stringify({ nonce: "safe-owner", pid: 999999, acquired_at_ms: 0 }) + "\n";
    const replacement = JSON.stringify({ nonce: "evil-owner", pid: 999999, acquired_at_ms: 0 }) + "\n";
    const { replacementPath } = sameSizeReplacement(join(lock, "owner.json"), original, replacement);
    const result = readChild(
      join(repoRoot, "plugins/litclaude/lib/owner-lock.mjs"),
      "api.readOwnerLock(process.argv[1])",
      [lock],
      { target: join(lock, "owner.json"), held: join(root, "owner.held"), replacement: replacementPath },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "null", `replacement owner must be rejected: ${result.stdout}`);
  });

  it("does not delete a replaced stale-lock directory during takeover", () => {
    const root = makeTemp();
    const lock = join(root, "lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ nonce: "stale-owner", pid: 999999, acquired_at_ms: 0 }) + "\n", { mode: 0o600 });
    const replacement = join(root, "lock.replacement");
    mkdirSync(replacement);
    writeFileSync(join(replacement, "owner.json"), JSON.stringify({ nonce: "live-owner", pid: process.pid, acquired_at_ms: 0 }) + "\n", { mode: 0o600 });
    const result = runChild(
      `import { acquireOwnerLock } from ${JSON.stringify(pathToFileURL(join(repoRoot, "plugins/litclaude/lib/owner-lock.mjs")).href)};
try { acquireOwnerLock(process.argv[1], { timeoutMs: 80, staleMs: 0 }); } catch (error) { process.exitCode = error?.status ?? 1; }`,
      [lock],
      { LITCLAUDE_SWAP_TARGET: lock, LITCLAUDE_SWAP_HELD: join(root, "lock.held"), LITCLAUDE_SWAP_REPLACEMENT: replacement },
      replacementRacePreload(root),
    );
    assert.notEqual(result.status, 0, `takeover unexpectedly accepted a replacement: ${result.stdout}`);
    assert.match(readFileSync(join(lock, "owner.json"), "utf8"), /live-owner/u,
      "the replacement directory must remain available");
  });

  it("rejects a canonical plan replacement before progress parsing", () => {
    const root = makeTemp();
    const plan = join(root, "plans", "work.md");
    const original = "- [ ] 1. safe task\n";
    const replacement = "- [ ] 1. evil task\n";
    const { replacementPath } = sameSizeReplacement(plan, original, replacement);
    const result = readChild(
      join(repoRoot, "plugins/litclaude/lib/start-work-lifecycle.mjs"),
      "api.readPlanProgress(process.argv[1])",
      [plan],
      { target: plan, held: join(root, "plan.held"), replacement: replacementPath },
    );
    assert.notEqual(result.status, 0, `forged plan was accepted: ${result.stdout}`);
  });

  it("rejects a write-parent replacement before scaffold commit", () => {
    const root = makeTemp();
    const parent = join(root, "plans");
    mkdirSync(parent);
    const replacement = join(root, "plans.replacement");
    mkdirSync(replacement);
    const result = runChild(
      `import { writeGuarded } from ${JSON.stringify(pathToFileURL(join(repoRoot, "plugins/litclaude/scripts/scaffold-plan.mjs")).href)};
try { await writeGuarded(process.argv[1], process.argv[2], "safe plan\\n", {}); } catch { process.exitCode = 1; }`,
      [root, join(parent, "work.md")],
      {
        LITCLAUDE_SWAP_TARGET: parent,
        LITCLAUDE_SWAP_HELD: join(root, "plans.held"),
        LITCLAUDE_SWAP_REPLACEMENT: replacement,
        LITCLAUDE_SWAP_MARKER: join(root, "parent.swap-marker"),
      },
      parentReusePreload(root),
    );
    assert.notEqual(result.status, 0, `forged write parent was accepted: ${result.stdout}`);
    assert.equal(existsSync(join(root, "parent.swap-marker")), true, "parent swap seam was not exercised");
  });

  it("rejects a project rule replacement before injection", () => {
    const root = makeTemp();
    write(join(root, "package.json"), "{}\n");
    const rule = join(root, ".claude", "rules", "policy.md");
    const original = "---\nalwaysApply: true\n---\nSAFE BODY\n";
    const replacement = "---\nalwaysApply: true\n---\nEVIL BODY\n";
    const { replacementPath } = sameSizeReplacement(rule, original, replacement);
    const result = readChild(
      join(repoRoot, "plugins/litclaude/lib/rules/engine.mjs"),
      "api.staticRulesBlock({ cwd: process.argv[1], pluginRoot: null, skipUserHome: true })",
      [root],
      { target: rule, held: join(root, "rule.held"), replacement: replacementPath },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /EVIL BODY/u, `forged rule was injected: ${result.stdout}`);
  });

  it("rejects a session-state replacement before JSON validation", () => {
    const root = makeTemp();
    const state = join(root, ".litclaude", "rules", "session-demo.json");
    const original = JSON.stringify({ injected: [], postCompactCount: 0 });
    const replacement = JSON.stringify({ injected: [], postCompactCount: 9 });
    const { replacementPath } = sameSizeReplacement(state, original, replacement);
    const result = readChild(
      join(repoRoot, "plugins/litclaude/lib/rules/session-state.mjs"),
      "api.readSessionState(process.argv[1], \"demo\")",
      [root],
      { target: state, held: join(root, "session.held"), replacement: replacementPath },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { injected: [], postCompactCount: 0 });
  });

  it("rejects a team-state replacement before command routing", () => {
    const root = makeTemp();
    const state = join(root, ".litclaude", "teams", "alpha", "team.json");
    const original = JSON.stringify({ team_id: "alpha", name: "safe", objective: "SAFE", status: "forming", members: [] });
    const replacement = JSON.stringify({ team_id: "alpha", name: "evil", objective: "EVIL", status: "forming", members: [] });
    const { replacementPath } = sameSizeReplacement(state, original, replacement);
    const result = readChild(
      join(repoRoot, "plugins/litclaude/skills/lit-team/scripts/team.mjs"),
      "api.runTeamCli([\"status\", \"--team\", \"alpha\"], { stdout: { write: (v) => process.stdout.write(v) }, stderr: { write: (v) => process.stderr.write(v) } }, process.argv[1])",
      [root],
      { target: state, held: join(root, "team.held"), replacement: replacementPath },
    );
    assert.match(result.stdout, /^65$/u, `team command did not fail closed: ${result.stdout}`);
    assert.doesNotMatch(result.stdout + result.stderr, /EVIL/u);
  });

  it("rejects a knowledge settings replacement before capture decisions", () => {
    const root = makeTemp();
    const settings = join(root, ".litclaude", "knowledge", "settings.json");
    const original = "{\"capture\":true }\n";
    const replacement = "{\"capture\":false}\n";
    const { replacementPath } = sameSizeReplacement(settings, original, replacement);
    const result = readChild(
      join(repoRoot, "plugins/litclaude/lib/wikify-knowledge.mjs"),
      "api.readCaptureSettings(process.argv[1])",
      [root],
      { target: realpathSync(settings), held: join(realpathSync(root), "settings.held"), replacement: realpathSync(replacementPath) },
    );
    assert.ok(existsSync(`${realpathSync(settings)}.swap-marker`), `settings swap seam was not exercised: ${result.stderr}`);
    assert.notEqual(result.status, 0, `forged knowledge settings were accepted: ${result.stdout}`);
  });

});
