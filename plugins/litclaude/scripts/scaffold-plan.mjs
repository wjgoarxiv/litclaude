#!/usr/bin/env node
// scaffold-plan.mjs — generate the lit-plan draft + plan skeleton deterministically.
//
// Node builtins only, so it runs identically on macOS, Linux, and Windows with no
// install step and no POSIX-shell precondition.
//
// Usage:
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-plan.mjs" <slug>
//        [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-plan.mjs" --check <plan.md>
//
// RESUME-SAFE: run it ONCE at plan generation. A plain re-run over an artifact this
// script already produced is a NO-OP success — it never overwrites appended todos — so
// a model resuming after compaction cannot crash the turn or clobber the plan.
// Destructive overwrite is reserved behind --reset, and --reset refuses to discard a
// hand-edited file unless --force is also passed.
//
// WRITE BOUNDARY: lit-plan is planning-only, so this script self-guards its own writes
// to exactly two roots and refuses anything else:
//   .litclaude/drafts/  — machine state, git-ignored, carries the resume-gating status:
//   plans/              — the human-reviewed artifact
// Both are symlink- and realpath-hardened: a symlinked path component, a symlinked
// target, or a real path that escapes the workspace is refused rather than followed.

import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";
import { lstat, link, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePlanTaskRows, planLinesOutsideFences } from "../lib/plan-task-rows.mjs";
import { resolveProjectStateRoot } from "../lib/project-state-root.mjs";
import { readRegularStable, samePathIdentity } from "../lib/secure-path-read.mjs";

/** Canonical plan section headers, in order. */
export const PLAN_SECTION_HEADERS = [
  "## TL;DR (For humans)",
  "## Scope",
  "## Verification strategy",
  "## Execution strategy",
  "## Todos",
  "## Final verification wave",
  "## Commit strategy",
  "## Success criteria",
];

export const FINAL_VERIFICATION_ITEMS = [
  "F1. Plan compliance audit",
  "F2. Code quality review",
  "F3. Real Manual-QA",
  "F4. Scope fidelity",
];

export const PLAN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const MAX_PLAN_BYTES = 256 * 1024;
const DRAFT_ROOT = ".litclaude";
const PLAN_ROOT = "plans";

export const isValidPlanSlug = (slug) =>
  typeof slug === "string" && slug.length > 0 && slug.length <= 80 && PLAN_SLUG_PATTERN.test(slug);

// Column-zero row grammar. start-work's readPlanProgress parses with
// /^- \[([ xX])\]\s+(.+?)\s*$/ — anchored at column zero and fence-aware — so an
// indented row is invisible to it. These two patterns are the machine-checkable subset.
export const IMPLEMENTATION_ROW = /^- \[[ xX]\] (\d+)\. .+$/u;
export const FINAL_VERIFIER_ROW = /^- \[[ xX]\] F(\d+)\. .+$/u;
const INDENTED_ROW = /^[ \t]+- \[[ xX]\] (?:\d+|F\d+)\. /u;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  let slug;
  let checkPath;
  let intent = "unspecified";
  let force = false;
  let reset = false;
  let draftOnly = false;
  let reviewRequired = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--clear") intent = "clear";
    else if (arg === "--unclear") intent = "unclear";
    else if (arg === "--reset") reset = true;
    else if (arg === "--force") force = true;
    else if (arg === "--draft-only") draftOnly = true;
    else if (arg === "--review-required") reviewRequired = true;
    else if (arg === "--check") {
      checkPath = rest[index + 1];
      index += 1;
      if (!checkPath) throw new Error("usage: scaffold-plan.mjs --check <plan.md>");
    } else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
    else if (slug === undefined) slug = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }

  if (checkPath) return { mode: "check", checkPath };
  if (!slug) {
    throw new Error(
      "usage: scaffold-plan.mjs <slug> [--clear|--unclear] [--draft-only] [--review-required] [--reset [--force]]",
    );
  }
  if (!isValidPlanSlug(slug)) {
    throw new Error(`invalid slug "${slug}" — use lowercase letters, digits, and hyphens only`);
  }
  return { mode: "scaffold", slug, intent, reset, force, draftOnly, reviewRequired };
}

/** Confine a write to `.litclaude/drafts/` or `plans/`, `.md` only. */
export function resolveSafePlanPath(cwd, relPath) {
  const workspaceRoot = resolveProjectStateRoot(cwd);
  const resolved = resolve(workspaceRoot, relPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`refused: path escapes the workspace root: ${relPath}`);
  }
  const normalized = rel.replaceAll("\\", "/");
  const inDraftRoot = normalized.startsWith(`${DRAFT_ROOT}/`);
  const inPlanRoot = normalized.startsWith(`${PLAN_ROOT}/`);
  if (!inDraftRoot && !inPlanRoot) {
    throw new Error(`refused: lit-plan may only write under ${DRAFT_ROOT}/ or ${PLAN_ROOT}/: ${relPath}`);
  }
  if (!resolved.toLowerCase().endsWith(".md")) {
    throw new Error(`refused: lit-plan may only write .md files: ${relPath}`);
  }
  return resolved;
}

function assertContainedPath(parent, child, message) {
  const rel = relative(parent, child);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(message);
}

/** mkdir -p that refuses to traverse or create a symlinked component. */
async function mkdirWithoutSymlinks(dir, stopAt) {
  if (dir === stopAt) return;
  const parent = dirname(dir);
  if (parent === dir || relative(stopAt, dir).startsWith("..") || isAbsolute(relative(stopAt, dir))) {
    throw new Error(`refused: path escapes the workspace root: ${dir}`);
  }
  await mkdirWithoutSymlinks(parent, stopAt);
  const stat = await lstat(dir).catch((error) => {
    if (error && error.code === "ENOENT") return null;
    throw error;
  });
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
    if (!stat.isDirectory()) throw new Error(`refused: path component is not a directory: ${dir}`);
    return;
  }
  try {
    await mkdir(dir);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const raced = await lstat(dir).catch((statError) => {
      if (statError?.code === "ENOENT") return null;
      throw statError;
    });
    if (!raced) throw error;
    if (raced.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
    if (!raced.isDirectory()) throw new Error(`refused: path component is not a directory: ${dir}`);
  }
}

const directoryOpenFlags = constants.O_RDONLY
  | (constants.O_DIRECTORY ?? 0)
  | (constants.O_NOFOLLOW ?? 0);

const closeWriteParentState = async (parentState) => {
  if (!parentState || parentState.closed) return;
  parentState.closed = true;
  const descriptors = [...new Set([
    parentState.workspacePin?.descriptor,
    parentState.parentPin?.descriptor,
  ].filter((descriptor) => descriptor !== undefined))];
  for (const descriptor of descriptors) {
    try { closeSync(descriptor); } catch { /* Best-effort descriptor cleanup. */ }
  }
};

const openDirectoryPin = (path, expected, label) => {
  let descriptor;
  try {
    descriptor = openSync(path, directoryOpenFlags);
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory() || !samePathIdentity(opened, expected)) {
      throw new Error(`refused: ${label} changed while it was opened: ${path}`);
    }
    return { path, descriptor };
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Best-effort descriptor cleanup. */ }
    }
    throw error;
  }
};

const isPathPresent = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const pinOrReportExistingLock = (path, expected, label, lockPath) => {
  try {
    return openDirectoryPin(path, expected, label);
  } catch (error) {
    // A competing scaffold may create the lock between our preflight lstat and
    // descriptor open, legitimately changing the directory ctime. Report the
    // same lock outcome as acquireWriteLock instead of denying that writer.
    if (isPathPresent(lockPath)) throw new Error(`refused: write lock exists: ${lockPath}`);
    throw error;
  }
};

const inspectWorkspaceDirectory = (cwd) => {
  const workspaceRoot = resolve(cwd);
  let workspaceStat;
  try {
    workspaceStat = lstatSync(workspaceRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    workspaceStat = null;
  }
  if (!workspaceStat) throw new Error(`refused: workspace root does not exist: ${workspaceRoot}`);
  if (workspaceStat.isSymbolicLink()) throw new Error(`refused: workspace root is a symlink: ${workspaceRoot}`);
  if (!workspaceStat.isDirectory()) throw new Error(`refused: workspace root is not a directory: ${workspaceRoot}`);
  return { workspaceRoot, workspaceStat };
};

// A directory that was actually REPLACED (rename-over, or unlink+recreate that
// reuses the freed inode number — dev/ino/birthtime can all coincide with the
// original on Linux; see test/inode-reuse.test.mjs) leaves an already-opened
// descriptor pinned to the old, now-unlinked inode. That inode's ctime is frozen
// at replacement time, so a descriptor-based read never converges with a fresh
// pathname-based read of the replacement. A brief sibling create/unlink INSIDE an
// otherwise-untouched directory (a different scaffold slug sharing
// `.litclaude/drafts/`, for example) also advances that directory's ctime and can
// land in the gap between the two reads, but it settles within microseconds since
// the directory itself was never replaced. Re-sampling a bounded number of times
// lets that transient churn resolve without weakening the replacement check: a
// genuine replacement's mismatch never resolves and still fails closed once the
// attempts are exhausted.
const DIRECTORY_PIN_SETTLE_ATTEMPTS = 5;

const assertDirectoryPin = async (pin, label) => {
  if (pin?.descriptor === undefined || pin.parentState?.closed) throw new Error(`refused: ${label} pin is closed`);
  const openedBefore = fstatSync(pin.descriptor);
  const named = await lstat(pin.path);
  const openedAfter = fstatSync(pin.descriptor);
  const namedAfter = await lstat(pin.path);
  let openedFinal;
  let namedFinal;
  let settled = false;
  for (let attempt = 0; attempt < DIRECTORY_PIN_SETTLE_ATTEMPTS && !settled; attempt += 1) {
    openedFinal = fstatSync(pin.descriptor);
    namedFinal = await lstat(pin.path);
    settled = samePathIdentity(openedFinal, namedFinal);
  }
  // Accept the "before" pair only when the descriptor still names the same
  // directory and the settled sample agrees with the pathname; a replacement
  // after open leaves the two samples disagreeing and remains fail-closed.
  const stable = openedBefore.isDirectory()
    && openedAfter.isDirectory()
    && openedFinal.isDirectory()
    && named.isDirectory()
    && namedAfter.isDirectory()
    && !named.isSymbolicLink()
    && !namedAfter.isSymbolicLink()
    && settled
    && (samePathIdentity(openedBefore, named)
      || (openedBefore.dev === openedFinal.dev && openedBefore.ino === openedFinal.ino));
  if (!stable) {
    if (pin.parentState?.lockPath && isPathPresent(pin.parentState.lockPath)) {
      throw new Error(`refused: write lock exists: ${pin.parentState.lockPath}`);
    }
    throw new Error(`refused: ${label} changed during write: ${pin.path}`);
  }
};

async function assertSafeWriteParent(cwd, target) {
  const { workspaceRoot, workspaceStat } = inspectWorkspaceDirectory(cwd);
  const pins = [];
  const lockPath = target.endsWith(".pair.lock") ? target : `${target}.litclaude-lock`;
  let workspacePin;
  try {
    // Pin immediately after lstat: another process may create a child while an async
    // stat/realpath is pending, and that legitimate ctime update must not look like a
    // replacement of the workspace itself.
    workspacePin = pinOrReportExistingLock(workspaceRoot, workspaceStat, "workspace root", lockPath);
    pins.push(workspacePin);
    const parent = dirname(target);
    assertContainedPath(workspaceRoot, parent, `refused: path escapes the workspace root: ${target}`);
    let parentStat;
    try {
      parentStat = lstatSync(parent);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      parentStat = null;
    }
    let parentPin;
    if (parentStat) {
      if (parentStat.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${parent}`);
      if (!parentStat.isDirectory()) throw new Error(`refused: path component is not a directory: ${parent}`);
      parentPin = parent === workspaceRoot
        ? workspacePin
        : pinOrReportExistingLock(parent, parentStat, "write parent", lockPath);
      if (parentPin !== workspacePin) pins.push(parentPin);
    }
    await mkdirWithoutSymlinks(parent, workspaceRoot);
    if (!parentStat) {
      parentStat = lstatSync(parent);
      if (parentStat.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${parent}`);
      if (!parentStat.isDirectory()) throw new Error(`refused: path component is not a directory: ${parent}`);
      parentPin = pinOrReportExistingLock(parent, parentStat, "write parent", lockPath);
      pins.push(parentPin);
    }
    const workspaceReal = await realpath(workspaceRoot);
    const parentReal = await realpath(parent);
    assertContainedPath(
      workspaceReal,
      parentReal,
      `refused: path escapes the workspace root through symlinks: ${target}`,
    );
    const state = {
      workspaceRoot,
      workspaceReal,
      workspaceStat,
      parent,
      parentStat,
      lockPath,
      workspacePin,
      parentPin,
      closed: false,
    };
    workspacePin.parentState = state;
    parentPin.parentState = state;
    return state;
  } catch (error) {
    for (const pin of [...pins].reverse()) {
      try { closeSync(pin.descriptor); } catch { /* Best-effort descriptor cleanup. */ }
    }
    throw error;
  }
}

async function assertStableWriteParent(parentState) {
  await assertDirectoryPin(parentState.workspacePin, "workspace root");
  if (parentState.parentPin !== parentState.workspacePin) {
    await assertDirectoryPin(parentState.parentPin, "write parent");
  }
  const parentReal = await realpath(parentState.parent);
  assertContainedPath(
    parentState.workspaceReal,
    parentReal,
    `refused: write parent escaped the workspace through symlinks: ${parentState.parent}`,
  );
}

const sameFileIdentity = samePathIdentity;
const sameFileContentIdentity = (left, right) => left
  && right
  && Number.isFinite(left.dev) && Number.isFinite(right.dev)
  && Number.isFinite(left.ino) && Number.isFinite(right.ino)
  && Number.isFinite(left.birthtimeMs) && Number.isFinite(right.birthtimeMs)
  && left.dev === right.dev
  && left.ino === right.ino
  && left.birthtimeMs === right.birthtimeMs;

const sameFileSnapshot = (left, right) => sameFileIdentity(left, right)
  && left.size === right.size
  && left.mtimeMs === right.mtimeMs
  && left.ctimeMs === right.ctimeMs
  && left.birthtimeMs === right.birthtimeMs;

const sameFileContentSnapshot = (left, right) => sameFileContentIdentity(left, right)
  && left.size === right.size
  && left.mtimeMs === right.mtimeMs;

const readExistingTarget = async (target) => {
  let handle;
  try {
    const pathStat = await lstat(target).catch((error) => {
      if (error && error.code === "ENOENT") return null;
      throw error;
    });
    if (!pathStat) return null;
    if (pathStat.isSymbolicLink()) throw new Error(`refused: target is a symlink: ${target}`);
    if (!pathStat.isFile()) throw new Error(`refused: target is not a regular file: ${target}`);

    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(target, constants.O_RDONLY | noFollow);
    const openedStat = await handle.stat();
    if (!sameFileSnapshot(pathStat, openedStat)) {
      throw new Error(`refused: target changed during read: ${target}`);
    }
    const text = await handle.readFile("utf8");
    const finalStat = await handle.stat();
    if (!sameFileSnapshot(openedStat, finalStat)) {
      throw new Error(`refused: target changed during read: ${target}`);
    }
    return { text, stat: finalStat };
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
};

const createInterruptionContext = () => {
  let interruptedBy;
  const onSignal = (signal) => {
    interruptedBy ??= signal;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return {
    throwIfInterrupted() {
      if (interruptedBy) throw new Error(`write interrupted by ${interruptedBy}`);
    },
    dispose() {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
  };
};

const appendCleanupReceipts = (error, receipts) => {
  if (!receipts.length) return error;
  const targetError = error instanceof Error ? error : new Error(String(error));
  targetError.cleanupReceipt = [...(targetError.cleanupReceipt ?? []), ...receipts];
  const residue = receipts.filter((receipt) => receipt.residue);
  if (residue.length) {
    const paths = residue.map((receipt) => receipt.target).join(", ");
    targetError.message = `${targetError.message}; cleanup residue: ${paths}`;
  }
  return targetError;
};

const cleanupReceipt = (target, status, residue, reason) => ({
  target,
  status,
  residue,
  ...(reason ? { reason } : {}),
});

const cleanupCreatedFile = async ({ target, stat, content, parentState }) => {
  const residue = (reason) => cleanupReceipt(target, "residue", true, reason);
  try {
    if (parentState) await assertStableWriteParent(parentState);
    if (!stat) {
      const current = await lstat(target).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      return current ? residue("created identity was not captured") : cleanupReceipt(target, "absent", false);
    }
    const current = await readExistingTarget(target);
    if (!current) return cleanupReceipt(target, "absent", false);
    if (!sameFileContentSnapshot(current.stat, stat) || current.text !== content) {
      return residue("target changed before cleanup");
    }
    if (parentState) await assertStableWriteParent(parentState);
    await unlink(target);
    if (parentState) await assertStableWriteParent(parentState);
    const after = await readExistingTarget(target);
    return after ? residue("target remained after cleanup") : cleanupReceipt(target, "removed", false);
  } catch (error) {
    return residue(error?.message ?? "cleanup verification failed");
  }
};

// A lock is a short-lived ownership record.  Release it by moving the verified
// record out of the shared pathname before deleting it.  A legitimate next
// writer may acquire that pathname immediately; its new record is not cleanup
// residue belonging to the writer that just released the lock.
const cleanupCreatedLock = async ({ target, stat, content, parentState }) => {
  const residue = (reason) => cleanupReceipt(target, "residue", true, reason);
  const quarantine = `${target}.remove.${randomUUID()}`;
  try {
    if (parentState) await assertStableWriteParent(parentState);
    const current = await readExistingTarget(target);
    if (!current) return cleanupReceipt(target, "absent", false);
    if (!sameFileSnapshot(current.stat, stat) || current.text !== content) {
      return residue("lock changed before cleanup");
    }
    if (parentState) await assertStableWriteParent(parentState);
    await rename(target, quarantine);
    const moved = await readExistingTarget(quarantine);
    // Renaming the owned lock into quarantine legitimately updates its ctime;
    // retain the inode/birthtime, size, mtime, and bytes binding across that
    // ownership-preserving move.
    if (!moved || !sameFileContentSnapshot(moved.stat, stat) || moved.text !== content) {
      throw new Error("lock identity changed after quarantine");
    }
    await unlink(quarantine);
    const leftover = await lstat(quarantine).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (leftover) return residue("lock quarantine remained after cleanup");
    return cleanupReceipt(target, "removed", false);
  } catch (error) {
    try {
      const targetStat = await lstat(target).catch((statError) => {
        if (statError?.code === "ENOENT") return null;
        throw statError;
      });
      const quarantineStat = await lstat(quarantine).catch((statError) => {
        if (statError?.code === "ENOENT") return null;
        throw statError;
      });
      if (!targetStat && quarantineStat) await rename(quarantine, target);
    } catch {
      // Leave uncertain quarantine state visible to the caller.
    }
    return residue(error?.message ?? "lock cleanup verification failed");
  }
};

const assertTargetUnchanged = async (target, expected, parentState) => {
  if (parentState) await assertStableWriteParent(parentState);
  const current = await readExistingTarget(target);
  if (expected === null) {
    if (current) throw new Error(`refused: target appeared during write: ${target}`);
  } else if (!current || current.text !== expected.text || !sameFileSnapshot(current.stat, expected.stat)) {
    throw new Error(`refused: target changed during write: ${target}`);
  }
  if (parentState) await assertStableWriteParent(parentState);
};

const acquireWriteLock = async (lockPath, parentState) => {
  const content = `${process.pid}:${randomUUID()}\n`;
  let handle;
  let stat;
  try {
    await assertStableWriteParent(parentState);
    handle = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    stat = await lstat(lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`refused: lock is not a regular file: ${lockPath}`);
    await assertStableWriteParent(parentState);
    return { target: lockPath, stat, content, parentState, cleanupMode: "lock" };
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`refused: write lock exists: ${lockPath}`);
    if (stat) {
      const receipt = await cleanupCreatedFile({ target: lockPath, stat, content, parentState });
      throw appendCleanupReceipts(error, [receipt]);
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
};

const writeAtomically = async (target, content, expected, interruption, parentState, beforeCommit) => {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  let temporaryStat;
  let committedStat;
  let committed = false;
  let failure;
  let result;
  try {
    interruption.throwIfInterrupted();
    await assertStableWriteParent(parentState);
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    temporaryStat = await lstat(temporary);
    if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile()) {
      throw new Error(`refused: temporary target is not a regular file: ${temporary}`);
    }
    interruption.throwIfInterrupted();
    await assertStableWriteParent(parentState);
    await assertTargetUnchanged(target, expected, parentState);
    await beforeCommit?.();
    await assertStableWriteParent(parentState);
    await assertTargetUnchanged(target, expected, parentState);
    if (expected === null) {
      // link() is the create-safe commit: it never replaces a target that appeared
      // after the preflight read. rename() is reserved for an existing target.
      await link(temporary, target);
    } else {
      await rename(temporary, target);
    }
    committed = true;
    committedStat = await lstat(target);
    if (committedStat.isSymbolicLink() || !committedStat.isFile()) {
      throw new Error(`refused: committed target is not a regular file: ${target}`);
    }
    await assertStableWriteParent(parentState);
    const final = await readExistingTarget(target);
    if (!final || final.text !== content || !sameFileSnapshot(final.stat, committedStat)) {
      throw new Error(`refused: committed target changed during write: ${target}`);
    }
    result = final.stat;
  } catch (error) {
    failure = error;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        failure ??= error;
      }
    }
    const temporaryReceipt = await cleanupCreatedFile({
      target: temporary,
      stat: temporaryStat,
      content,
      parentState,
    });
    if (temporaryReceipt.residue) {
      failure ??= new Error(`refused: temporary cleanup left residue: ${temporary}`);
      failure = appendCleanupReceipts(failure, [temporaryReceipt]);
    }
  }
  if (failure) {
    if (committed && expected === null && committedStat) {
      failure.committedEntry = { target, stat: committedStat, content, parentState };
    }
    throw failure;
  }
  return result;
};

/** A file this script previously emitted — makes a plain re-run a safe no-op. */
export function isScaffoldArtifact(content) {
  const isPlan = content.includes("## TL;DR (For humans)") && content.includes("## Final verification wave");
  const isDraft = content.includes("# Draft:") && content.includes("## Approval gate");
  return isPlan || isDraft;
}

const buildReviewState = (slug, reviewRequired) => reviewRequired
  ? `review_required: true
plan_path: ${PLAN_ROOT}/${slug}.md
plan_sha256: null
review_round_id: null
pending-action: write and dual-review ${PLAN_ROOT}/${slug}.md
review:
  plan_reviewer:
    status: pending
    agent: litclaude:quality-reviewer
    target: ${PLAN_ROOT}/${slug}.md
    round_id: null
    plan_sha256: null
    result: null
  independent:
    status: pending
    agent: litclaude:lit-verifier
    target: ${PLAN_ROOT}/${slug}.md
    round_id: null
    plan_sha256: null
    result: null`
  : `review_required: false
pending-action: write ${PLAN_ROOT}/${slug}.md`;

export function buildDraft(slug, intent, { reviewRequired = false } = {}) {
  const assumptionsNote =
    intent === "unclear"
      ? "Intent is UNCLEAR: research resolves ambiguity, defaults are adopted (not asked), and each one is surfaced in the plan's human TL;DR so the user can veto it."
      : "Record any default you adopt instead of asking, so the user can veto it at the gate.";
  const reviewState = buildReviewState(slug, reviewRequired);

  return `---
slug: ${slug}
status: drafting
intent: ${intent}
${reviewState}
approach: <fill: the approach you intend to plan>
---

# Draft: ${slug}

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- ${assumptionsNote} -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited — path:lines)

## Decisions (with rationale)

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: drafting
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
`;
}

export function buildPlanSkeleton(slug, intent) {
  const decisionsLine =
    intent === "unclear"
      ? "**Decisions I made for you:** <fill last — the best-practice defaults you adopted; the user vetoes any here>"
      : "**Decisions to sanity-check:** <fill last — the few choices worth a human glance>";

  return `# ${slug} — Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave or agent names. -->

**What you'll get:** <fill last — deliverables in human terms, 1-2 sentences>

**Why this approach:** <fill last — the one or two load-bearing decisions and why>

**What it will NOT do:** <fill last — 1-3 plain lines mirroring Must NOT have>

**Effort:** <Quick | Short | Medium | Large | XL>
**Risk:** <Low | Medium | High> — <one-line driver>
${decisionsLine}

Your next move: <fill — e.g. approve, or ask for a high-accuracy review>. Full execution detail follows below.

---

> TL;DR (machine): <1 line — effort, risk, deliverables>

## Scope
### Must have
### Must NOT have (guardrails, anti-slop, scope boundaries)

## Verification strategy
> Zero human intervention — every verification step is agent-executed.
- Test decision: <TDD | tests-after | none> + framework
- Manual-QA channel per criterion: <HTTP | tmux | browser | computer use>
- Evidence: .litclaude/evidence/<slug>/task-<N>.<ext>; record criteria and blockers in the litgoal ledger

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final wave) means you under-split.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |

## Todos
> Implementation + Test = ONE todo. Never separate them.
> Rows start at column zero as \`- [ ] N. <title>\`; start-work cannot see an indented row.
<!-- APPEND TASK BATCHES BELOW THIS LINE — never rewrite the headers above. -->
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (the executor has NO interview context — be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence .litclaude/evidence/${slug}/task-1.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface the results and wait for the user's explicit okay before declaring the work complete.
${FINAL_VERIFICATION_ITEMS.map((item) => `- [ ] ${item}`).join("\n")}

## Commit strategy

## Success criteria
`;
}

const armReviewRequirement = (content, slug) => {
  if (/^review_required: true$/mu.test(content)) return content;
  const disarmed = buildReviewState(slug, false);
  if (!content.includes(disarmed)) {
    throw new Error("refused: existing draft review state is not recognized; preserve it and arm review manually");
  }
  return content.replace(disarmed, buildReviewState(slug, true));
};

/** Resume-safe write. Plain re-run over our own artifact is a no-op success. */
export async function writeGuarded(
  cwd,
  relPath,
  content,
  {
    reset = false,
    force = false,
    updateExisting,
    interruption,
    onCreated,
    beforeCommit,
    lockEntry,
    retainParentState = false,
    onParentState,
  } = {},
) {
  cwd = resolveProjectStateRoot(cwd);
  const target = resolveSafePlanPath(cwd, relPath);
  const ownInterruption = interruption ?? createInterruptionContext();
  let parentState;
  let localLock;
  let result;
  let failure;
  try {
    parentState = await assertSafeWriteParent(cwd, target);
    onParentState?.(parentState);
    await assertStableWriteParent(parentState);
    localLock = lockEntry ?? await acquireWriteLock(`${target}.litclaude-lock`, parentState);
    await assertStableWriteParent(parentState);

    const existingSnapshot = await readExistingTarget(target);
    const existing = existingSnapshot?.text ?? null;
    if (existing !== null && existing.trim() !== "") {
      if (!reset) {
        if (isScaffoldArtifact(existing)) {
          const updated = typeof updateExisting === "function" ? updateExisting(existing) : existing;
          if (updated !== existing) {
            await writeAtomically(target, updated, existingSnapshot, ownInterruption, parentState, beforeCommit);
            result = { relPath, status: "updated" };
          } else {
            result = { relPath, status: "exists" };
          }
        } else {
          throw new Error(`refused: ${relPath} exists and is not a scaffold artifact (pass --reset to overwrite)`);
        }
      } else if (existing.trim() !== content.trim() && !force) {
        throw new Error(`refused: ${relPath} has edits that differ from a fresh skeleton; pass --reset --force to discard them`);
      }
    }

    if (result === undefined) {
      const stat = await writeAtomically(target, content, existingSnapshot, ownInterruption, parentState, beforeCommit);
      if (existingSnapshot === null) {
        const createdEntry = { target, stat, content, parentState };
        try {
          ownInterruption.throwIfInterrupted();
          onCreated?.(createdEntry);
        } catch (error) {
          const receipt = await cleanupCreatedFile(createdEntry);
          failure = appendCleanupReceipts(error, [receipt]);
        }
      }
      if (!failure) result = { relPath, status: existing ? "reset" : "created" };
    }
  } catch (error) {
    failure = appendCleanupReceipts(error, []);
    if (error?.committedEntry) {
      const receipt = await cleanupCreatedFile(error.committedEntry);
      failure = appendCleanupReceipts(failure, [receipt]);
    }
  }

  if (localLock && !lockEntry) {
    const cleanup = localLock.cleanupMode === "lock" ? cleanupCreatedLock : cleanupCreatedFile;
    const receipt = await cleanup(localLock);
    if (receipt.residue) {
      failure ??= new Error(`refused: write lock cleanup left residue: ${localLock.target}`);
      failure = appendCleanupReceipts(failure, [receipt]);
    }
  }
  if (!retainParentState) await closeWriteParentState(parentState);
  if (!interruption) ownInterruption.dispose();
  if (failure) throw failure;
  return result;
}

export async function scaffold(cwd, { slug, intent, reset = false, force = false, draftOnly = false, reviewRequired = false }) {
  cwd = resolveProjectStateRoot(cwd);
  const interruption = createInterruptionContext();
  const created = [];
  const parentStates = new Set();
  let pairLock;
  let results;
  let failure;
  try {
    const draftRel = join(DRAFT_ROOT, "drafts", `${slug}.md`);
    const draftTarget = resolveSafePlanPath(cwd, draftRel);
    const pairLockPath = join(dirname(draftTarget), `${slug}.pair.lock`);
    const { workspaceRoot } = inspectWorkspaceDirectory(cwd);
    assertContainedPath(workspaceRoot, dirname(pairLockPath), `refused: path escapes the workspace root: ${pairLockPath}`);
    // Finish the symlink-safe directory setup before taking ctime-sensitive pins;
    // concurrent scaffolders then contend only on the atomic pair lock.
    await mkdirWithoutSymlinks(dirname(pairLockPath), workspaceRoot);
    const pairParentState = await assertSafeWriteParent(cwd, pairLockPath);
    parentStates.add(pairParentState);
    pairLock = await acquireWriteLock(pairLockPath, pairParentState);

    const draft = await writeGuarded(cwd, draftRel, buildDraft(slug, intent, { reviewRequired }), {
      reset,
      force,
      interruption,
      lockEntry: pairLock,
      onCreated: (entry) => created.push(entry),
      onParentState: (state) => parentStates.add(state),
      retainParentState: true,
      updateExisting: reviewRequired ? (existing) => armReviewRequirement(existing, slug) : undefined,
    });
    if (draftOnly) {
      results = [draft];
    } else {
      const planRel = join(PLAN_ROOT, `${slug}.md`);
      const plan = await writeGuarded(cwd, planRel, buildPlanSkeleton(slug, intent), {
        reset,
        force,
        interruption,
        lockEntry: pairLock,
        onCreated: (entry) => created.push(entry),
        onParentState: (state) => parentStates.add(state),
        retainParentState: true,
      });
      interruption.throwIfInterrupted();
      results = [draft, plan];
    }
  } catch (error) {
    failure = error;
  }

  if (failure) {
    const receipts = await Promise.all(created.map((entry) => cleanupCreatedFile(entry)));
    failure = appendCleanupReceipts(failure, receipts);
  }
  if (pairLock) {
    const receipt = await cleanupCreatedLock(pairLock);
    if (receipt.residue) {
      failure ??= new Error(`refused: paired-write lock cleanup left residue: ${pairLock.target}`);
      failure = appendCleanupReceipts(failure, [receipt]);
    }
  }
  for (const parentState of parentStates) await closeWriteParentState(parentState);
  interruption.dispose();
  if (failure) throw failure;
  return results;
}

/**
 * Pre-handoff structural self-check. Structure only — rows are expected to be
 * UNCHECKED at this point. `scripts/audit-plan-checkboxes.mjs` is the different,
 * post-completion audit that requires them checked.
 */
export function checkPlanStructure(text) {
  const problems = [];
  const lines = text.split(/\r?\n/u);
  const visibleLines = planLinesOutsideFences(text);
  const taskRows = parsePlanTaskRows(text);

  let searchFrom = -1;
  for (const header of PLAN_SECTION_HEADERS) {
    const heading = visibleLines.find(({ line }) => line.trimEnd() === header);
    if (!heading) problems.push(`missing section: ${header}`);
    else if (heading.index < searchFrom) problems.push(`section out of order: ${header}`);
    else searchFrom = heading.index;
  }

  const implementationRows = taskRows.filter(({ line }) => IMPLEMENTATION_ROW.test(line));
  const finalRows = taskRows.filter(({ line }) => FINAL_VERIFIER_ROW.test(line));
  if (implementationRows.length === 0) {
    problems.push("no implementation rows: expected at least one column-zero `- [ ] N. <title>`");
  }
  if (finalRows.length === 0) {
    problems.push("no final-verifier rows: expected column-zero `- [ ] F<number>. <title>`");
  }

  for (const { line } of visibleLines) {
    if (INDENTED_ROW.test(line)) {
      problems.push(`indented task row is invisible to start-work: ${line.trim()}`);
    }
  }

  const numbers = implementationRows.map(({ line }) => Number(IMPLEMENTATION_ROW.exec(line)[1]));
  const duplicates = numbers.filter((value, index) => numbers.indexOf(value) !== index);
  if (duplicates.length > 0) problems.push(`duplicate todo numbers: ${[...new Set(duplicates)].join(", ")}`);

  // Each implementation row owns the block up to the next row of either kind.
  const rowIndexes = taskRows.filter(({ line }) => IMPLEMENTATION_ROW.test(line) || FINAL_VERIFIER_ROW.test(line));
  for (let position = 0; position < rowIndexes.length; position += 1) {
    const { line, index } = rowIndexes[position];
    if (!IMPLEMENTATION_ROW.test(line)) continue;
    const end = rowIndexes[position + 1]?.index ?? lines.length;
    const block = visibleLines
      .filter(({ index: lineIndex }) => lineIndex >= index && lineIndex < end)
      .map(({ line: visibleLine }) => visibleLine)
      .join("\n");
    for (const [label, pattern] of [
      ["What to do", /What to do/u],
      ["References", /References/u],
      ["Acceptance criteria", /Acceptance criteria/u],
      ["QA scenarios", /QA scenarios/u],
      ["Commit", /Commit:/u],
    ]) {
      if (!pattern.test(block)) problems.push(`${line.trim()} — missing "${label}"`);
    }
  }

  if (/<fill\b/u.test(text)) {
    problems.push("unfilled <fill ...> placeholders remain — the plan is not decision-complete");
  }

  return { ok: problems.length === 0, problems };
}

async function runCheck(checkPath, cwd) {
  cwd = resolveProjectStateRoot(cwd);
  const target = resolveSafePlanPath(cwd, checkPath);
  const read = readRegularStable(resolve(cwd), target, undefined, { maxBytes: MAX_PLAN_BYTES });
  if (read.failure) {
    throw new Error(`refused: --check cannot safely read ${checkPath}: ${read.failure}`);
  }
  const text = read.bytes.toString("utf8");
  const { ok, problems } = checkPlanStructure(text);
  if (ok) {
    process.stdout.write(`PLAN_STRUCTURE_PASS: ${checkPath}\n`);
    return 0;
  }
  process.stderr.write(`PLAN_STRUCTURE_FAIL: ${checkPath}\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  return 1;
}

export async function runScaffoldPlanCli(argv = process.argv, cwd = resolveProjectStateRoot()) {
  cwd = resolveProjectStateRoot(cwd);
  const parsed = parseArgs(argv);
  if (parsed.mode === "check") {
    return runCheck(parsed.checkPath, cwd);
  }

  const results = await scaffold(cwd, parsed);
  for (const result of results) process.stdout.write(`${result.status}: ${result.relPath}\n`);

  const created = results.some((result) => result.status !== "exists");
  process.stdout.write(
    parsed.draftOnly
      ? "next: record intent, findings, decisions, review state, and the approval gate in the draft; create the plan only after approval.\n"
      : created
        ? 'next: record findings/decisions in the draft, then APPEND task batches into the "## Todos" region of the plan; fill "## TL;DR (For humans)" LAST, then run --check.\n'
        : 'skeleton already present — left untouched. APPEND task batches into the "## Todos" region; the human "## TL;DR (For humans)" stays on top.\n',
  );
  return 0;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = await runScaffoldPlanCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
