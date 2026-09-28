import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readFileSync,
  readSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const MAX_BOUNDED_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BOUNDED_AGGREGATE_BYTES = 32 * 1024 * 1024;

export const pathIdentity = (stat) => ({
  dev: stat?.dev,
  ino: stat?.ino,
  ctimeMs: stat?.ctimeMs,
  birthtimeMs: stat?.birthtimeMs,
});
export const samePathIdentity = (left, right) => Boolean(left && right)
  && ["dev", "ino", "ctimeMs", "birthtimeMs"].every((field) => Number.isFinite(left[field])
    && Number.isFinite(right[field]) && left[field] === right[field]);
export const directoryIdentity = (stat) => ({
  dev: stat?.dev,
  ino: stat?.ino,
  birthtimeMs: stat?.birthtimeMs,
});
export const sameDirectoryIdentity = (left, right) => Boolean(left && right)
  && ["dev", "ino", "birthtimeMs"].every((field) => Number.isFinite(left[field])
    && Number.isFinite(right[field]) && left[field] === right[field]);

const identity = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  ctimeMs: stat.ctimeMs,
  mtimeMs: stat.mtimeMs,
});
const sameIdentity = (left, right) => left?.dev === right?.dev
  && left?.ino === right?.ino
  && left?.ctimeMs === right?.ctimeMs
  && left?.mtimeMs === right?.mtimeMs;
const sameNode = (left, right) => left?.dev === right?.dev && left?.ino === right?.ino;

function chainPaths(root, directory) {
  const absoluteRoot = resolve(root);
  const absoluteDirectory = resolve(directory);
  const rel = relative(absoluteRoot, absoluteDirectory);
  if (isAbsolute(rel) || rel.split(/[\\/]/u)[0] === "..") return null;
  const paths = [absoluteRoot];
  let current = absoluteRoot;
  for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part);
    paths.push(current);
  }
  return { absoluteRoot, paths };
}

function closeDescriptors(opened) {
  for (const { descriptor } of [...opened].reverse()) {
    try {
      closeSync(descriptor);
    } catch {
      // The operation already fails closed when an opened descriptor cannot be verified.
    }
  }
}

function expectedAncestorMismatch(current, expectedAncestors = []) {
  const byAbsolutePath = new Map(current.map((entry) => [entry.absolutePath, entry]));
  for (const expected of expectedAncestors) {
    if (!expected?.absolutePath || !byAbsolutePath.has(expected.absolutePath)) continue;
    if (!sameIdentity(byAbsolutePath.get(expected.absolutePath), expected)) return true;
  }
  return false;
}

function openDirectoryChain(root, directory, expectedAncestors) {
  const chain = chainPaths(root, directory);
  if (chain === null) return { failure: "ANCESTOR_INVALID", opened: [], snapshots: [] };
  const opened = [];
  try {
    for (const path of chain.paths) {
      const before = lstatSync(path, { throwIfNoEntry: false });
      if (!before?.isDirectory() || before.isSymbolicLink()) throw new Error("ANCESTOR_INVALID");
      const descriptor = openSync(
        path,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
      );
      const stat = fstatSync(descriptor);
      if (!stat.isDirectory() || before.dev !== stat.dev || before.ino !== stat.ino) {
        closeSync(descriptor);
        throw new Error("ANCESTOR_INVALID");
      }
      opened.push({ descriptor, absolutePath: path, snapshot: {
        absolutePath: path,
        path: relative(chain.absoluteRoot, path).replaceAll("\\", "/") || ".",
        ...identity(stat),
      } });
    }
  } catch (error) {
    closeDescriptors(opened);
    return { failure: error?.message === "ANCESTOR_INVALID" ? "ANCESTOR_INVALID" : "UNREADABLE", opened: [], snapshots: [] };
  }
  const snapshots = opened.map(({ snapshot }) => snapshot);
  if (expectedAncestorMismatch(snapshots, expectedAncestors)) {
    closeDescriptors(opened);
    return { failure: "ANCESTOR_CHANGED", opened: [], snapshots: [] };
  }
  return { opened, snapshots };
}

function verifyDirectoryChain(chain, expectedAncestors) {
  try {
    const current = [];
    for (const entry of chain.opened) {
      const opened = fstatSync(entry.descriptor);
      const named = lstatSync(entry.absolutePath, { throwIfNoEntry: false });
      if (!opened.isDirectory()
        || !named?.isDirectory()
        || named.isSymbolicLink()
        || !sameIdentity(opened, entry.snapshot)
        || !sameIdentity(named, entry.snapshot)) return false;
      current.push({ ...entry.snapshot, ...identity(opened) });
    }
    return !expectedAncestorMismatch(current, expectedAncestors);
  } catch {
    return false;
  }
}

export function readDirectoryStable(root, directory, expectedSnapshot) {
  const expectedAncestors = expectedSnapshot?.ancestors ?? [];
  const chain = openDirectoryChain(root, directory, expectedAncestors);
  if (chain.failure) return { failure: chain.failure };
  let handle;
  let entries;
  try {
    handle = opendirSync(directory);
    entries = [];
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      entries.push(entry);
    }
    handle.closeSync();
    handle = undefined;
  } catch {
    try {
      handle?.closeSync();
    } catch {
      // Return the bounded read failure below.
    }
    closeDescriptors(chain.opened);
    return { failure: "UNREADABLE" };
  }
  const stable = verifyDirectoryChain(chain, expectedAncestors);
  closeDescriptors(chain.opened);
  if (!stable) return { failure: "ANCESTOR_CHANGED" };
  return { entries, ancestors: chain.snapshots };
}

function readDescriptorToOpenedSize(descriptor, openedSize) {
  const bytes = Buffer.allocUnsafe(openedSize);
  let offset = 0;
  while (offset < openedSize) {
    const count = readSync(descriptor, bytes, offset, openedSize - offset, null);
    if (count === 0) break;
    offset += count;
  }
  const probe = Buffer.allocUnsafe(1);
  const grewDuringRead = readSync(descriptor, probe, 0, 1, null) !== 0;
  return { bytes: offset === openedSize ? bytes : bytes.subarray(0, offset), grewDuringRead };
}

export function readRegularStable(root, path, expectedSnapshot, options = {}) {
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes >= 0
    ? options.maxBytes
    : undefined;
  const expectedFile = expectedSnapshot?.file
    ?? (expectedSnapshot?.dev !== undefined && expectedSnapshot?.ino !== undefined ? expectedSnapshot : undefined);
  const expectedAncestors = expectedSnapshot?.ancestors ?? [];
  const chain = openDirectoryChain(root, dirname(path), expectedAncestors);
  if (chain.failure) return { failure: chain.failure };
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (!before?.isFile() || before.isSymbolicLink()) {
    closeDescriptors(chain.opened);
    return { failure: "NON_REGULAR" };
  }
  if ((before.mode & 0o444) === 0) {
    closeDescriptors(chain.opened);
    return { failure: "UNREADABLE" };
  }
  if (maxBytes !== undefined && before.size > maxBytes) {
    closeDescriptors(chain.opened);
    return { failure: "FILE_TOO_LARGE" };
  }
  if (expectedFile && (!sameNode(before, expectedFile)
    || (expectedFile.mode !== undefined && (before.mode & 0o777) !== expectedFile.mode))) {
    closeDescriptors(chain.opened);
    return { failure: "FILE_IDENTITY_CHANGED" };
  }

  let descriptor;
  let opened;
  let bytes;
  let readStable = false;
  let fileFailure;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(before, opened)) fileFailure = "FILE_IDENTITY_CHANGED";
    else if (maxBytes !== undefined && opened.size > maxBytes) fileFailure = "FILE_TOO_LARGE";
    else {
      const bounded = maxBytes === undefined
        ? { bytes: readFileSync(descriptor), grewDuringRead: false }
        : readDescriptorToOpenedSize(descriptor, opened.size);
      bytes = bounded.bytes;
      const afterRead = fstatSync(descriptor);
      readStable = !bounded.grewDuringRead && afterRead.isFile() && sameIdentity(opened, afterRead);
    }
  } catch {
    fileFailure = "UNREADABLE";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (fileFailure) {
    closeDescriptors(chain.opened);
    return { failure: fileFailure };
  }
  if (!readStable) {
    closeDescriptors(chain.opened);
    return { failure: "FILE_IDENTITY_CHANGED" };
  }

  const after = lstatSync(path, { throwIfNoEntry: false });
  if (!after?.isFile() || after.isSymbolicLink() || !sameIdentity(opened, after)) {
    closeDescriptors(chain.opened);
    return { failure: "FILE_IDENTITY_CHANGED" };
  }
  if ((after.mode & 0o444) === 0) {
    closeDescriptors(chain.opened);
    return { failure: "UNREADABLE" };
  }
  const expectedSize = expectedSnapshot?.size ?? expectedFile?.size;
  if (expectedSize !== undefined && bytes.length !== expectedSize) {
    closeDescriptors(chain.opened);
    return { failure: "FILE_SIZE_CHANGED" };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSnapshot?.sha256 !== undefined && sha256 !== expectedSnapshot.sha256) {
    closeDescriptors(chain.opened);
    return { failure: "FILE_HASH_CHANGED" };
  }
  const ancestorsStable = verifyDirectoryChain(chain, expectedAncestors);
  closeDescriptors(chain.opened);
  if (!ancestorsStable) return { failure: "ANCESTOR_CHANGED" };
  return {
    bytes,
    stat: opened,
    snapshot: {
      file: { ...identity(opened), size: bytes.length, mode: opened.mode & 0o777 },
      ancestors: chain.snapshots,
      sha256,
      size: bytes.length,
    },
  };
}
