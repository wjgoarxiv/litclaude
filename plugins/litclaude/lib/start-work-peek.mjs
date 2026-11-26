// The cheap question before every tool call: can a start-work run apply to this session at all? It
// reads one file at most and imports nothing else of LitClaude, because on a managed PC each module a
// hook opens is scanned first, and the full lifecycle module plus its imports took the hook to its timeout.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// A run is stale once its owning session has ended or the lifecycle has not been written for two hours
// (plans/lit-adhd.md D8): another session may take it over, and it no longer limits other sessions.
export const START_WORK_STALE_MS = 2 * 60 * 60 * 1000;
// Activity is the later of the last ledger event and the last allowed owner tool call.
export const lastActivityMs = (work) => Math.max(Date.parse(work.updated_at) || 0, Date.parse(work.last_tool_at ?? "") || 0);
export const idleMs = (work, now) => Math.max(0, now - (lastActivityMs(work) || now));
export const isStale = (work, now) => Boolean(work.root_session_ended_at) || idleMs(work, now) >= START_WORK_STALE_MS;

/**
 * True only when the lifecycle would answer "allow" for this call without looking at it: no run, a
 * finished run, or another session's stale run, and no cancel notice for this session. Every doubt
 * (a linked root, an unreadable or unknown record) is false, so the full check decides and fails closed.
 */
export const startWorkCannotApply = (root, sessionId, now = Date.now()) => {
  try {
    if (!lstatSync(resolve(root)).isDirectory()) return false;
    const path = join(root, ".litclaude", "boulder.json");
    if (!existsSync(path)) return true;
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (state?.schema_version !== 3 || !Number.isInteger(state.revision) || state.revision < 0) return false;
    if (!state.works || typeof state.works !== "object" || !Array.isArray(state.events)) return false;
    if (typeof sessionId === "string" && state.cancel_notices?.[sessionId]) return false;
    if (!state.active_work_id) return true;
    const work = state.works[state.active_work_id];
    if (!work) return false;
    if (!["active", "paused"].includes(work.status)) return true;
    return (work.root_session_id ?? work.active_session_id) !== sessionId && isStale(work, now);
  } catch {
    return false;
  }
};
