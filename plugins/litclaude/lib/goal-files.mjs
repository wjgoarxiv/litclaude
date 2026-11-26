// The native-goal records the prompt hook and goal-propose keep beside the session's cwd: consent (the
// question asked), intent (a yes the mod turns into /goal), owner (the goal the mod set) and clear (a
// request to clear it). Each session writes `.litclaude/sessions/<id>/goal/<name>`; a read falls back to
// the legacy shared `.litclaude/goal/<name>`, so a record written before the move is still honoured.
// A missing or unsafe session id keeps the legacy path for reads and writes alike.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { GOAL_DIR, sessionGoalDir } from "./mod/goal.mjs";
import { prepareStateDir, STATE_WRITE_FLAG } from "./project-state-root.mjs";
import { readWithLegacyFallback, sessionStateDir, sessionStatePath } from "./session-state.mjs";

const legacyGoalPath = (cwd, name) => join(cwd, GOAL_DIR, name);
const sessionGoalPath = (cwd, sessionId, name) => {
  const dir = sessionGoalDir(sessionId);
  return dir === null ? null : join(cwd, dir, name);
};

/** Where this session writes the record. */
export const goalWritePath = (cwd, sessionId, name) => sessionGoalPath(cwd, sessionId, name) ?? legacyGoalPath(cwd, name);

const goalRecord = (cwd, sessionId, name) => {
  try {
    const found = readWithLegacyFallback(sessionGoalPath(cwd, sessionId, name), legacyGoalPath(cwd, name));
    return found ? { path: found.path, value: JSON.parse(found.text) } : null;
  } catch {
    return null;
  }
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

export const readGoalFile = (cwd, sessionId, name) => goalRecord(cwd, sessionId, name)?.value ?? null;

const writeAt = (target, value) => {
  try {
    if (!prepareStateDir(dirname(target))) return false;
    writeFileSync(target, `${JSON.stringify(value)}\n`, { flag: STATE_WRITE_FLAG });
    return true;
  } catch {
    return false;
  }
};

export const writeGoalFile = (cwd, sessionId, name, value) => writeAt(goalWritePath(cwd, sessionId, name), value);

/** Removes the record a read would return: the session's own, else the legacy one. */
export const dropGoalFile = (cwd, sessionId, name) => {
  const found = goalRecord(cwd, sessionId, name);
  try {
    if (found) rmSync(found.path, { force: true });
  } catch {
    // Nothing to drop.
  }
};

// `lit cancel` may come from any session of the project, so the clear request lands beside every goal
// owner LitClaude recorded here: each session's and the legacy shared one.
export const requestGoalClear = (cwd, why) => {
  if (!cwd) return false;
  const dirs = [join(cwd, GOAL_DIR)];
  try {
    for (const name of readdirSync(join(cwd, ".litclaude", "sessions"))) {
      const dir = sessionGoalDir(name);
      if (dir !== null) dirs.push(join(cwd, dir));
    }
  } catch {
    // No session folders yet.
  }
  // A goal armed or asked but not yet set dies with the cancel too, so the mod never sets it later.
  let dropped = false;
  for (const dir of dirs) {
    for (const name of ["intent.json", "consent.json"]) {
      try {
        if (readJson(join(dir, name))) { rmSync(join(dir, name), { force: true }); dropped = true; }
      } catch {
        // Nothing to drop.
      }
    }
  }
  const owned = dirs.filter((dir) => readJson(join(dir, "owner.json")));
  return owned.map((dir) => writeAt(join(dir, "clear.json"), { version: 1, why, at: new Date().toISOString() })).some(Boolean) || dropped;
};

/** Arms a goal: writes intent.json and drops a clear request left over from an earlier goal. */
export const armGoal = (cwd, sessionId, intent) => {
  dropGoalFile(cwd, sessionId, "clear.json");
  return writeGoalFile(cwd, sessionId, "intent.json", intent);
};

// A lit run's goal question is asked once per session: `sessions/<id>/goal-asked.json` records when it
// was shown, and a later run asks again only after a goal LitClaude set has closed since then.
const GOAL_ASKED_FILE = "goal-asked.json";

/** Records that this session was shown the goal question; false when it cannot be recorded. */
export const markGoalAsked = (cwd, sessionId, now = new Date()) => {
  try {
    const dir = sessionStateDir(cwd, sessionId);
    if (dir === null) return false;
    writeFileSync(join(dir, GOAL_ASKED_FILE), `${JSON.stringify({ version: 1, askedAt: now.toISOString() })}\n`, { flag: STATE_WRITE_FLAG });
    return true;
  } catch {
    return false;
  }
};

/** True when this session was shown the question and no goal closed after that (a closed owner with no time counts as after). */
export const goalAskedSinceClose = (cwd, sessionId, owner) => {
  const path = sessionStatePath(cwd, sessionId);
  const askedAt = path === null ? Number.NaN : Date.parse(readJson(join(path, GOAL_ASKED_FILE))?.askedAt ?? "");
  if (!Number.isFinite(askedAt)) return false;
  if (!owner?.closed) return true;
  const closedAt = Date.parse(owner.closedAt ?? "");
  return Number.isFinite(closedAt) && closedAt < askedAt;
};
