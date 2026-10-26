// The SessionStart nudge toward lit-adhd: when this folder has other Claude Code sessions from the
// last three days, say once a day that `lit adhd` briefs them all on one screen. It looks only at
// this folder's own transcript folder (no scan of other projects) and stats file times, never
// contents, so it stays cheap on every session start. A marker under `.litclaude/adhd/` keeps it
// to one nudge per calendar day per project.
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { projectSlug } from "./transcripts.mjs";

export const RECENT_MS = 3 * 24 * 60 * 60 * 1000;
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
 * Making it records today's date in `<stateRoot>/.litclaude/adhd/suggested.json`.
 */
export const adhdSuggestion = ({ cwd, sessionId, configDir, stateRoot, now = Date.now() }) => {
  const count = recentOthers(join(configDir, "projects", projectSlug(cwd)), sessionId, now);
  if (count === 0) return null;
  const dir = join(stateRoot, ".litclaude", "adhd");
  const marker = join(dir, "suggested.json");
  try {
    if (JSON.parse(readFileSync(marker, "utf8")).day === dayOf(now)) return null;
  } catch {
    // No marker yet, or an unreadable one: suggest and rewrite it.
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(marker, `${JSON.stringify({ day: dayOf(now) })}\n`);
  return `${count} other recent ${count === 1 ? "session" : "sessions"} here · type \`lit adhd\` for a one-screen brief of where each stands`;
};
