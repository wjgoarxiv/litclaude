// The timer-started mark of lib/check-back.mjs and the PreToolUse answer for it, apart from the report
// code so the guard can ask before every tool call without loading that code.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PROJECT_STATE_DIR } from "./project-state-root.mjs";

export const MARK_DIR = "check-back";
// A timer-started turn is report-only until the user types again; a mark this old is ignored anyway.
const MARK_TTL_MS = 15 * 60 * 1000;
// Read-only tools stay allowed in a timer-started turn; every tool a PreToolUse matcher sends here is
// denied otherwise. A tool no matcher names (TodoWrite, for one) never reaches this check.
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "Skill"]);
export const SESSION = /^[A-Za-z0-9._-]{1,128}$/u;

export const line = (text, limit = 160) => {
  const flat = String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

export const markPath = (stateRoot, sessionId) => join(stateRoot, PROJECT_STATE_DIR, MARK_DIR, `session-${sessionId}.json`);

/**
 * Whether this tool call belongs to a timer-started turn. A mark that cannot be read is treated as
 * present while the file exists: the guard fails closed for the session that has one.
 */
export const timerStartedTurn = ({ stateRoot, sessionId, now = Date.now() }) => {
  if (!SESSION.test(String(sessionId))) return false;
  let fd;
  try {
    const path = markPath(stateRoot, sessionId);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (fstatSync(fd).size > 4096) return true;
    const mark = JSON.parse(readFileSync(fd, "utf8"));
    return !Number.isFinite(mark?.at) || now - mark.at < MARK_TTL_MS;
  } catch (error) {
    return error?.code !== "ENOENT";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/** The PreToolUse answer for a timer-started turn: null to let the call go on, else the denial reason. */
export const checkBackDenial = (toolName) => (READ_ONLY_TOOLS.has(toolName)
  ? null
  : `LitClaude check-back: a timer started this turn, and it only reports, so ${line(toolName, 60)} is denied. Tell the user the report in a few lines and end the turn; the user's next message lifts this.`);
