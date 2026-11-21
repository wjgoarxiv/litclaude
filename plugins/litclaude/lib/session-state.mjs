// Per-session state folders, `.litclaude/sessions/<session id>/`. Records that used to sit in one shared
// file per project (the lit-plan and interface-probe turns, the lit-adhd suggestion marker, the native
// goal records) live here, so two Claude sessions in one project never overwrite each other. Readers
// fall back to the old shared path while a session has no record of its own. SessionStart moves folders
// idle for a week to `.litclaude/archive/sessions/`; nothing here deletes a session folder.
// start-work (`boulder.json` and its ledger) keeps its own leased state and is only read here.
import { lstatSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { SESSION_STATE_ID } from "./mod/goal.mjs";
import { PROJECT_STATE_DIR, prepareStateDir, resolveProjectStateRoot } from "./project-state-root.mjs";
import { livenessPath } from "./session-liveness.mjs";

export const SESSION_ARCHIVE_MAX_AGE_MS = 7 * 24 * 3600_000;
// `litclaude-ai sessions` lists a session last seen within this window and not ended.
export const LIVE_SESSION_MS = 24 * 3600_000;
const ABSENT = new Set(["ENOENT", "ENOTDIR"]);
const NEWEST_DEPTH = 3;

const stateDirOf = (cwd) => join(resolveProjectStateRoot(cwd), PROJECT_STATE_DIR);
const isPlainDirectory = (path) => {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  return Boolean(stats && stats.isDirectory() && !stats.isSymbolicLink());
};
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** The session's folder path without creating it; null for a missing or unsafe session id. */
export const sessionStatePath = (cwd, sessionId) => (typeof sessionId === "string" && SESSION_STATE_ID.test(sessionId)
  ? join(stateDirOf(cwd), "sessions", sessionId)
  : null);

/** The session's folder, created on demand; null for an unsafe id, throws on a symlinked state path. */
export const sessionStateDir = (cwd, sessionId) => {
  const dir = sessionStatePath(cwd, sessionId);
  if (dir === null) return null;
  if (!prepareStateDir(dir)) throw new Error("the LitClaude session state folder is a symlink or not a folder; refusing to write");
  return dir;
};

/** `{ path, text, legacy }` from the new path, else from the legacy path, else null. */
export const readWithLegacyFallback = (newPath, legacyPath) => {
  for (const [path, legacy] of [[newPath, false], [legacyPath, true]]) {
    if (typeof path !== "string") continue;
    try {
      return { path, text: readFileSync(path, "utf8"), legacy };
    } catch (error) {
      if (!ABSENT.has(error?.code)) throw error;
    }
  }
  return null;
};

/** Ends a session's record: its own file, and the legacy shared file only when that session wrote it. */
export const clearSessionRecord = (newPath, legacyPath, sessionId) => {
  if (typeof newPath === "string") rmSync(newPath, { force: true });
  if (typeof legacyPath === "string" && typeof sessionId === "string" && sessionId && readJson(legacyPath)?.sessionId === sessionId) {
    rmSync(legacyPath, { force: true });
  }
};

const newestMtime = (path, depth = 0) => {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats) return 0;
  if (!stats.isDirectory() || stats.isSymbolicLink() || depth >= NEWEST_DEPTH) return stats.mtimeMs;
  return readdirSync(path).reduce((newest, name) => Math.max(newest, newestMtime(join(path, name), depth + 1)), stats.mtimeMs);
};

const livenessAt = (stateRoot, sessionId) => {
  const at = Date.parse(readJson(livenessPath(stateRoot, sessionId))?.at ?? "");
  return Number.isFinite(at) ? at : 0;
};

const sessionFolders = (cwd) => {
  const dir = join(stateDirOf(cwd), "sessions");
  if (!isPlainDirectory(stateDirOf(cwd)) || !isPlainDirectory(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SESSION_STATE_ID.test(entry.name))
    .map((entry) => ({ sessionId: entry.name, path: join(dir, entry.name) }));
};

// The start-work owner per session, read from boulder.json and never written.
const startWorkOwners = (stateRoot) => {
  const boulder = readJson(join(stateRoot, PROJECT_STATE_DIR, "boulder.json"));
  const work = boulder?.works?.[boulder?.active_work_id];
  return typeof work?.active_session_id === "string" ? new Map([[work.active_session_id, boulder.active_work_id]]) : new Map();
};

const goalIdOf = (sessionPath) => {
  const owner = readJson(join(sessionPath, "goal", "owner.json"));
  if (typeof owner?.id === "string" && !owner.closed) return owner.id;
  const intent = readJson(join(sessionPath, "goal", "intent.json"));
  return typeof intent?.id === "string" && !intent.consumedAt ? intent.id : null;
};

// Each session's last liveness record (session-liveness.mjs) as sessionId -> { state, at }.
const livenessRecords = (stateRoot) => {
  const dir = join(stateRoot, PROJECT_STATE_DIR, "liveness");
  if (!isPlainDirectory(join(stateRoot, PROJECT_STATE_DIR)) || !isPlainDirectory(dir)) return new Map();
  const records = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = readJson(join(dir, entry.name));
    const at = Date.parse(record?.at ?? "");
    if (typeof record?.sessionId === "string" && SESSION_STATE_ID.test(record.sessionId) && Number.isFinite(at)) records.set(record.sessionId, { state: record.state, at });
  }
  return records;
};

/**
 * One read-only row per live session, newest first: the sessions with a liveness record or a session
 * folder, less those that ended (SessionEnd, with no folder change after it) or were last seen
 * `maxAgeMs` ago or longer. A session with no folder has `path: null`.
 */
export const listSessions = (cwd, { now = Date.now(), maxAgeMs = LIVE_SESSION_MS } = {}) => {
  const stateRoot = resolveProjectStateRoot(cwd);
  const owners = startWorkOwners(stateRoot);
  const liveness = livenessRecords(stateRoot);
  const folders = new Map(sessionFolders(stateRoot).map(({ sessionId, path }) => [sessionId, path]));
  return [...new Set([...liveness.keys(), ...folders.keys()])].flatMap((sessionId) => {
    const record = liveness.get(sessionId);
    const path = folders.get(sessionId) ?? null;
    const folderAt = path === null ? 0 : newestMtime(path);
    const lastSeenAt = Math.max(record?.at ?? 0, folderAt);
    // A folder that moved after the end belongs to a resumed session.
    if ((record?.state === "ended" && folderAt <= record.at) || now - lastSeenAt >= maxAgeMs) return [];
    return [{ sessionId, path, lastSeenAt, ageMs: Math.max(0, now - lastSeenAt), startWorkId: owners.get(sessionId) ?? null, goalId: path === null ? null : goalIdOf(path) }];
  }).sort((left, right) => right.lastSeenAt - left.lastSeenAt);
};

/** Moves session folders idle for maxAgeMs to `.litclaude/archive/sessions/`; never the `keep` session. */
export const archiveStaleSessions = (cwd, { maxAgeMs = SESSION_ARCHIVE_MAX_AGE_MS, now = Date.now(), keep = null } = {}) => {
  const stateRoot = resolveProjectStateRoot(cwd);
  const archive = join(stateRoot, PROJECT_STATE_DIR, "archive", "sessions");
  const moved = [];
  for (const { sessionId, path } of sessionFolders(stateRoot)) {
    if (sessionId === keep) continue;
    if (now - Math.max(livenessAt(stateRoot, sessionId), newestMtime(path)) < maxAgeMs) continue;
    if (!prepareStateDir(archive)) break;
    const target = lstatSync(join(archive, sessionId), { throwIfNoEntry: false }) ? join(archive, `${sessionId}.${now}`) : join(archive, sessionId);
    try {
      renameSync(path, target);
      moved.push({ sessionId, from: path, to: target });
    } catch {
      // A folder another session is moving or using stays where it is.
    }
  }
  return moved;
};

const formatAge = (ms) => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
};

/** `litclaude-ai sessions`: prints the index and writes nothing. */
export const runSessionsCli = (args = [], cwd = process.cwd(), { stdout = process.stdout, stderr = process.stderr } = {}) => {
  if (args.length > 0) {
    stderr.write("Usage: litclaude-ai sessions\n");
    return 64;
  }
  const rows = listSessions(cwd);
  if (rows.length === 0) {
    stdout.write("No live LitClaude sessions in this project.\n");
    return 0;
  }
  const lines = [["SESSION", "LAST SEEN", "START-WORK", "GOAL"], ...rows.map((row) => [
    row.sessionId.slice(0, 8), `${formatAge(row.ageMs)} ago`, row.startWorkId ?? "-", row.goalId ?? "-",
  ])];
  const widths = lines[0].map((_, column) => Math.max(...lines.map((line) => line[column].length)));
  stdout.write(`${lines.map((line) => line.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n")}\n`);
  return 0;
};
