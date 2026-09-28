// Per-session record of which rules already reached the model, plus the bounded
// post-compact re-injection allowance.
//
// State is optional and local to the project. Every read and write refuses symlinked
// state components so a hostile checkout cannot redirect hooks outside the workspace.

import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { acquireOwnerLock, OwnerLockError, releaseOwnerLock } from "../owner-lock.mjs";
import { POST_COMPACT_REINJECTION_BUDGET } from "./constants.mjs";
import { pathIdentity, samePathIdentity } from "../secure-path-read.mjs";
import { resolveProjectStateRoot } from "../project-state-root.mjs";

const MAX_TRACKED_KEYS = 500;
const MAX_STATE_BYTES = 256 * 1024;
const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set(["EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EOPNOTSUPP", "EPERM"]);

const safeSessionId = (sessionId) => {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
};

const isSameOrChildPath = (parentPath, childPath) => {
  const rel = relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const emptyState = () => ({ injected: [], postCompactCount: 0 });

const safeStateDirectory = (projectRoot, { create }) => {
  const root = resolveProjectStateRoot(projectRoot);
  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new Error("unsafe project root");
  const realRoot = realpathSync.native(root);
  let current = root;
  for (const component of [".litclaude", "rules"]) {
    current = join(current, component);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT" || !create) throw error;
      mkdirSync(current, { mode: 0o700 });
      stats = lstatSync(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("unsafe state directory");
    if (!isSameOrChildPath(realRoot, realpathSync.native(current))) throw new Error("state directory escaped project");
  }
  return current;
};

const readStateResult = (projectRoot, id) => {
  let directory;
  try {
    directory = safeStateDirectory(projectRoot, { create: false });
  } catch (error) {
    return error?.code === "ENOENT" ? { status: "missing" } : { status: "uncertain" };
  }
  const target = join(directory, `session-${id}.json`);
  let fd;
  try {
    let pathStats;
    try {
      pathStats = lstatSync(target);
    } catch (error) {
      return error?.code === "ENOENT" ? { status: "missing" } : { status: "uncertain" };
    }
    if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.size > MAX_STATE_BYTES) return { status: "uncertain" };
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile()
      || !samePathIdentity(pathIdentity(openedStats), pathIdentity(pathStats))
      || openedStats.size !== pathStats.size
    ) return { status: "uncertain" };
    const parsed = JSON.parse(readFileSync(fd, "utf8"));
    if (
      parsed === null
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || !Array.isArray(parsed.injected)
      || parsed.injected.length > MAX_TRACKED_KEYS
      || parsed.injected.some((key) => typeof key !== "string")
      || !Number.isSafeInteger(parsed.postCompactCount)
      || parsed.postCompactCount < 0
    ) return { status: "uncertain" };
    return { status: "ok", state: { injected: parsed.injected, postCompactCount: parsed.postCompactCount, ...(parsed.ignitionShown === true ? { ignitionShown: true } : {}) } };
  } catch {
    return { status: "uncertain" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

export const readSessionState = (projectRoot, sessionId) => {
  const id = safeSessionId(sessionId);
  if (id === null || typeof projectRoot !== "string") return emptyState();
  const result = readStateResult(projectRoot, id);
  return result.status === "ok" ? result.state : emptyState();
};

export const writeSessionState = (projectRoot, sessionId, state, { fileSystem } = {}) => {
  const id = safeSessionId(sessionId);
  if (id === null || typeof projectRoot !== "string") return false;
  const fs = fileSystem ?? {
    closeSync,
    constants,
    fsyncSync,
    openSync,
    renameSync,
    rmSync,
    writeFileSync,
  };
  let temporary;
  let fd;
  let directoryFd;
  try {
    const directory = safeStateDirectory(projectRoot, { create: true });
    const target = join(directory, `session-${id}.json`);
    try {
      const targetStats = lstatSync(target);
      if (targetStats.isSymbolicLink() || !targetStats.isFile()) return false;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    temporary = join(directory, `.session-${id}.${process.pid}.${Date.now()}.tmp`);
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
    temporary = undefined;
    try {
      directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      fs.fsyncSync(directoryFd);
      fs.closeSync(directoryFd);
      directoryFd = undefined;
    } catch (error) {
      if (directoryFd !== undefined) {
        try { fs.closeSync(directoryFd); } catch { /* Directory sync is best-effort after rename. */ }
        directoryFd = undefined;
      }
      if (!UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error?.code)) throw error;
      // The temporary file was fsynced and atomically renamed. These directory fsync/open
      // errors specifically mean that the operation is unsupported on this filesystem.
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* Preserve the original write failure. */ }
    }
    if (directoryFd !== undefined) {
      try { fs.closeSync(directoryFd); } catch { /* Directory sync is best-effort after rename. */ }
    }
    if (temporary !== undefined) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* The caller still receives a fail-closed result. */ }
    }
  }
};

const acquireSessionLock = (directory, id) => {
  const lockPath = join(directory, `session-${id}.lock`);
  try {
    return { lockPath, owner: acquireOwnerLock(lockPath, { timeoutMs: 500, staleMs: 30_000 }) };
  } catch (error) {
    if (error instanceof OwnerLockError) return null;
    throw error;
  }
};

const releaseSessionLock = ({ lockPath, owner }) => releaseOwnerLock(lockPath, owner);

const mutateSessionState = (projectRoot, sessionId, mutate) => {
  const id = safeSessionId(sessionId);
  if (id === null || typeof projectRoot !== "string") return { persisted: false, previous: emptyState() };
  let directory;
  try {
    directory = safeStateDirectory(projectRoot, { create: true });
  } catch {
    return { persisted: false, previous: emptyState() };
  }
  const lock = acquireSessionLock(directory, id);
  if (lock === null) return { persisted: false, previous: emptyState() };

  let result = { persisted: false, previous: emptyState() };
  try {
    const read = readStateResult(projectRoot, id);
    if (read.status === "uncertain") return result;
    const previous = read.status === "missing" ? emptyState() : read.state;
    const mutation = mutate(previous);
    const next = mutation?.state ?? mutation;
    result = { persisted: writeSessionState(projectRoot, id, next), previous, next, value: mutation?.value };
  } finally {
    if (!releaseSessionLock(lock)) result = { ...result, persisted: false };
  }
  return result;
};

export const recordInjectedKeys = (projectRoot, sessionId, keys) => {
  if (!Array.isArray(keys) || keys.length === 0) return false;
  return claimInjectedKeys(projectRoot, sessionId, keys).persisted;
};

export const claimInjectedKeys = (projectRoot, sessionId, keys) => {
  if (!Array.isArray(keys) || keys.length === 0) return { persisted: false, claimed: [] };
  const requested = [...new Set(keys.filter((key) => typeof key === "string"))];
  const transaction = mutateSessionState(projectRoot, sessionId, (current) => {
    const present = new Set(current.injected);
    const claimed = requested.filter((key) => !present.has(key));
    return {
      state: {
        ...current,
        injected: [...new Set([...current.injected, ...claimed])].slice(-MAX_TRACKED_KEYS),
      },
      value: claimed,
    };
  });
  return { persisted: transaction.persisted, claimed: transaction.persisted ? transaction.value : [] };
};

export const consumePostCompactBudget = (projectRoot, sessionId) => {
  const transaction = mutateSessionState(projectRoot, sessionId, (current) => ({
    ...current,
    injected: [],
    postCompactCount: current.postCompactCount + 1,
  }));
  const nextCount = transaction.next?.postCompactCount ?? transaction.previous.postCompactCount;
  const allowed = nextCount <= POST_COMPACT_REINJECTION_BUDGET;
  return {
    allowed: transaction.persisted && allowed,
    persisted: transaction.persisted,
    used: transaction.persisted ? nextCount : transaction.previous.postCompactCount,
    budget: POST_COMPACT_REINJECTION_BUDGET,
  };
};

/** Stable identity for a rule: which file, and which exact content. */
export const ruleKey = (rule) => `${rule.relativePath}\0${rule.bodyHash}`;

/** Reserve decorative SessionStart output independently of compact rule resets. */
export const claimSessionIgnition = (projectRoot, sessionId) => {
  const transaction = mutateSessionState(projectRoot, sessionId, (current) => ({
    state: { ...current, ignitionShown: true },
    value: current.ignitionShown !== true,
  }));
  return transaction.persisted && transaction.value;
};
