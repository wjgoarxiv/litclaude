import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { requireStateDir, STATE_WRITE_FLAG } from "../project-state-root.mjs";

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
  const fd = openSync(tmpPath, "r");
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

const sleepSync = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

export const withLitgoalLock = (lockDir, fn) => {
  requireStateDir(dirname(lockDir));
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir, { recursive: false });
      break;
    } catch (error) {
      if (Date.now() - startedAt > 5000) {
        throw new LitgoalStateError("litgoal state lock timed out");
      }
      sleepSync(20);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
};
