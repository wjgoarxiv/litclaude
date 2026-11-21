import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { acquireOwnerLock, OwnerLockError, readOwnerLock, releaseOwnerLock } from "../owner-lock.mjs";
import { requireStateDir, STATE_WRITE_FLAG } from "../project-state-root.mjs";
import { directoryIdentity, sameDirectoryIdentity } from "../secure-path-read.mjs";

export class LitgoalStateError extends Error {
  constructor(message, status = 65) {
    super(message);
    this.name = "LitgoalStateError";
    this.status = status;
  }
}

export const readLitgoalState = (path, fallback = {}) => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new LitgoalStateError("corrupt litgoal state");
  }
};

export const writeLitgoalState = (path, state) => {
  const dir = dirname(path);
  requireStateDir(dir);
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { flag: STATE_WRITE_FLAG });
  // Flush tmp file data to disk before rename so the rename is durable.
  const fd = openSync(tmpPath, "r+");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmpPath, path);
  // Best-effort: fsync the parent directory so the directory entry is durable.
  // Some filesystems (NTFS, FAT, certain network mounts) reject dir fsync with
  // EINVAL/EPERM/EISDIR — swallow those silently.
  try {
    const dfd = openSync(dir, "r");
    fsyncSync(dfd);
    closeSync(dfd);
  } catch {
    // best-effort only; file data is already durable via the tmp fsync above
  }
};

// A lock older than this whose owner is dead, or that has no owner record at all, is recovered.
export const LITGOAL_LOCK_TIMEOUT_MS = 5000;

// Locks taken before the owner-lock switch are bare folders with no owner record, so the owner-lock
// takeover cannot judge them and a crashed run left one that blocked every later litgoal call. An
// ownerless folder past the timeout is moved aside to `.lock.stale.<id>` (kept, not deleted); if the
// rename caught a different folder, it is put back.
const moveOwnerlessLockAside = (lockDir) => {
  const stats = lstatSync(lockDir, { throwIfNoEntry: false });
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) return;
  if (Date.now() - stats.mtimeMs < LITGOAL_LOCK_TIMEOUT_MS || readOwnerLock(lockDir)) return;
  const aside = `${lockDir}.stale.${randomUUID()}`;
  try {
    renameSync(lockDir, aside);
  } catch {
    return;
  }
  const moved = lstatSync(aside, { throwIfNoEntry: false });
  if (moved && sameDirectoryIdentity(directoryIdentity(moved), directoryIdentity(stats)) && !readOwnerLock(aside)) return;
  try {
    if (!existsSync(lockDir)) renameSync(aside, lockDir);
  } catch {
    // The aside folder stays for inspection.
  }
};

export const withLitgoalLock = (lockDir, fn) => {
  requireStateDir(dirname(lockDir));
  moveOwnerlessLockAside(lockDir);
  let owner;
  try {
    owner = acquireOwnerLock(lockDir, { timeoutMs: LITGOAL_LOCK_TIMEOUT_MS, staleMs: LITGOAL_LOCK_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof OwnerLockError) throw new LitgoalStateError(`litgoal ${error.message}`);
    throw error;
  }
  try {
    return fn();
  } finally {
    releaseOwnerLock(lockDir, owner);
  }
};
