// The SessionStart nudge toward lit-adhd: when this folder has other Claude Code sessions from the
// last three days, say once a day that `lit adhd` briefs them all on one screen. It looks only at
// this folder's own transcript folder (no scan of other projects) and stats file times, never
// contents, so it stays cheap on every session start. A marker in the session's own folder
// (`.litclaude/sessions/<id>/adhd-suggested.json`; the shared `.litclaude/adhd/suggested.json` is still
// read) keeps it to one nudge per calendar day, and the shown-ledger keeps the same words from coming
// back within a week. A symlinked `.litclaude`, folder or marker (a cloned
// repository can carry one) is never followed: the nudge is then skipped, not written elsewhere.
import { lstatSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { prepareStateDir, STATE_WRITE_FLAG } from "../project-state-root.mjs";
import { sessionStateDir } from "../session-state.mjs";
import { recordShown, wasShown } from "../shown-ledger.mjs";
import { projectSlug } from "./transcripts.mjs";

export const RECENT_MS = 3 * 24 * 60 * 60 * 1000;
const REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 400;

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

const recentOthers = (folder, sessionId, now) => {
  let names;
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".jsonl")).slice(0, SCAN_LIMIT);
  } catch {
    return 0;
  }
  return names.filter((name) => {
    if (name === `${sessionId}.jsonl`) return false;
    try {
      const stat = lstatSync(join(folder, name));
      return stat.isFile() && now - stat.mtimeMs < RECENT_MS;
    } catch {
      return false;
    }
  }).length;
};

/**
 * The one-line suggestion, or null when there is nothing to suggest or it was already made today.
 * Making it records today's date in the session's `adhd-suggested.json` (legacy: `.litclaude/adhd/suggested.json`).
 */
export const adhdSuggestion = ({ cwd, sessionId, configDir, stateRoot, now = Date.now() }) => {
  const count = recentOthers(join(configDir, "projects", projectSlug(cwd)), sessionId, now);
  if (count === 0) return null;
  const legacyDir = join(stateRoot, ".litclaude", "adhd");
  const legacyMarker = join(legacyDir, "suggested.json");
  let sessionDir;
  try {
    sessionDir = sessionStateDir(stateRoot, sessionId);
  } catch {
    return null;
  }
  if (sessionDir === null && !prepareStateDir(legacyDir)) return null;
  const marker = sessionDir === null ? legacyMarker : join(sessionDir, "adhd-suggested.json");
  for (const path of new Set([marker, legacyMarker])) {
    try {
      if (lstatSync(path).isSymbolicLink()) return null;
      if (JSON.parse(readFileSync(path, "utf8")).day === dayOf(now)) return null;
    } catch {
      // No marker yet, or an unreadable one: suggest and rewrite it.
    }
  }
  const text = `${count} other recent ${count === 1 ? "session" : "sessions"} here · type \`lit adhd\` for a one-screen brief of where each stands`;
  // The same words were already shown here within the week: a new day alone is no reason to repeat them.
  if (wasShown({ stateRoot, text, now, ttlMs: REPEAT_MS })) return null;
  const staging = `${marker}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify({ day: dayOf(now) })}\n`, { flag: STATE_WRITE_FLAG });
  renameSync(staging, marker);
  recordShown({ stateRoot, id: "adhd", text, now });
  return text;
};
