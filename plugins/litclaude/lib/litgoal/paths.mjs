import { join } from "node:path";

import { resolveProjectStateRoot } from "../project-state-root.mjs";

export const litgoalStateDir = (cwd = resolveProjectStateRoot()) => join(resolveProjectStateRoot(cwd), ".litclaude", "litgoal");
export const litgoalBriefPath = (cwd = resolveProjectStateRoot()) => join(litgoalStateDir(cwd), "brief.md");
export const litgoalGoalsPath = (cwd = resolveProjectStateRoot()) => join(litgoalStateDir(cwd), "goals.json");
export const litgoalLedgerPath = (cwd = resolveProjectStateRoot()) => join(litgoalStateDir(cwd), "ledger.jsonl");
export const litgoalLockDir = (cwd = resolveProjectStateRoot()) => join(litgoalStateDir(cwd), ".lock");
export const litgoalSessionsDir = (cwd = resolveProjectStateRoot()) => join(litgoalStateDir(cwd), "sessions");
// Where a completed goal is preserved when a fresh session opens new state (drift 6a).
// The session id is filename-sanitized because it arrives from the host.
export const litgoalSessionArchivePath = (cwd = resolveProjectStateRoot(), sessionId = "unknown") =>
  join(litgoalSessionsDir(cwd), `${String(sessionId).replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64) || "unknown"}.json`);
