// Each session's last hook event as one small record, `.litclaude/liveness/<session>.json`:
// PostToolUse and PostToolUseFailure say `alive`, Stop says `idle`, SessionEnd says `ended`. The LIT
// card reads it to tell running, idle and ended sessions apart, and to find herdr lanes of this
// project by the pane id the hooks ran under. A repeat of the same state is written at most every
// 30 s, so a busy session costs one small write per half minute.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ignitionFileName } from "./mod/state.mjs";
import { requireStateDir, resolveProjectStateRoot, STATE_WRITE_FLAG } from "./project-state-root.mjs";

export const LIVENESS_STATES = Object.freeze(["alive", "idle", "ended"]);
const SAME_STATE_MS = 30_000;
const HERDR_PANE = /^[A-Za-z0-9:_-]{1,32}$/u;

export const livenessPath = (stateRoot, sessionId) => join(stateRoot, ".litclaude", "liveness", ignitionFileName(sessionId));

export const markLiveness = (cwd, sessionId, state, { now = Date.now(), env = process.env } = {}) => {
  if (typeof sessionId !== "string" || !sessionId.trim() || !LIVENESS_STATES.includes(state)) return null;
  const stateRoot = resolveProjectStateRoot(cwd);
  // Only a project that already keeps LitClaude state gets the record; a plain repository stays untouched.
  if (!existsSync(join(stateRoot, ".litclaude"))) return null;
  const path = livenessPath(stateRoot, sessionId);
  try {
    const previous = JSON.parse(readFileSync(path, "utf8"));
    if (previous?.state === state && now - Date.parse(previous.at) < SAME_STATE_MS) return null;
  } catch {
    // No record yet, or an unreadable one: write a fresh record.
  }
  const pane = typeof env.HERDR_PANE_ID === "string" && HERDR_PANE.test(env.HERDR_PANE_ID) ? env.HERDR_PANE_ID : null;
  requireStateDir(join(stateRoot, ".litclaude", "liveness"));
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify({ version: 1, sessionId, state, at: new Date(now).toISOString(), herdrPane: pane })}\n`, { flag: STATE_WRITE_FLAG });
  renameSync(staging, path);
  return path;
};
