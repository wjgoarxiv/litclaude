// The opt-in "check back later" follow-up. lit-loop and litgoal may offer it; only after the user says
// yes does the model call Claude Code's CronCreate with the fixed prompt `lit check-back`. LitClaude
// never schedules anything itself. A CronCreate job lives in the Claude Code session that made it:
// it dies when that session exits (a --resume or --continue brings an unexpired one back).
//
// When the prompt arrives, the UserPromptSubmit hook builds a short report from state LitClaude already
// keeps (start-work progress and parked steps, the litgoal goal, the newest run end in the shown-ledger,
// and a plan that has not changed for two hours). The same words already shown before mean nothing
// changed: the hook ends the prompt with no model turn. New words are recorded in the shown-ledger and
// handed to the model as a report-only turn: this session is marked timer-started, and the PreToolUse
// guard denies every write, Bash call, agent, schedule change and network tool until the user types again.
import { closeSync, lstatSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import { line, MARK_DIR, markPath, SESSION } from "./check-back-mark.mjs";
import { litgoalGoalsPath } from "./litgoal/paths.mjs";
import { readLitgoalState } from "./litgoal/state.mjs";
import { planSnapshot } from "./precompact-snapshot.mjs";
import { prepareStateDir, PROJECT_STATE_DIR, STATE_WRITE_FLAG } from "./project-state-root.mjs";
import { lastRunEnd, recordShown, wasShown } from "./shown-ledger.mjs";

export { checkBackDenial, timerStartedTurn } from "./check-back-mark.mjs";

export const CHECK_BACK_PROMPT = "lit check-back";
const STALE_PLAN_MS = 2 * 60 * 60 * 1000;

/** A whole prompt `lit check-back` (spacing and case aside). */
export const isCheckBackPrompt = (prompt) => typeof prompt === "string"
  && prompt.trim().replace(/\s+/gu, " ").toLowerCase() === CHECK_BACK_PROMPT;

// A long path keeps its end, where the folder that matters is named.
const pathLine = (text, limit) => {
  const flat = line(text, Infinity);
  return flat.length > limit ? `…${flat.slice(-(limit - 1))}` : flat;
};

/**
 * The report text, built only from durable state (no clock values), so the same state gives the same
 * words. `work` is activeStartWorkSummary's answer, `parked` parkedStartWorkSteps' answer.
 */
export const buildCheckBackReport = ({ cwd, stateRoot, work = null, parked = null, now = Date.now() }) => {
  const lines = [];
  let plan = null;
  try {
    plan = planSnapshot({ cwd, activePlanPath: work?.plan ?? null });
  } catch {
    plan = null;
  }
  if (work) lines.push(`start-work ${line(work.workId, 60)} is ${line(work.status, 20)}.`);
  if (plan) {
    lines.push(`Plan ${plan.path}: ${plan.done} of ${plan.total} rows done.${plan.current ? ` Next: ${plan.current}` : " Every row is ticked."}`);
    for (const row of plan.blocked) lines.push(`Blocked row: ${row}`);
    try {
      if (plan.current && now - statSync(resolve(cwd, plan.path)).mtimeMs > STALE_PLAN_MS) lines.push("The plan has not changed for over two hours.");
    } catch {
      // No stale line when the plan cannot be read again.
    }
  }
  const steps = parked?.parked ?? [];
  if (steps.length) {
    lines.push(`Waiting on you: ${steps.slice(0, 3).map(({ action, root }) => `${line(action, 12)} ${pathLine(root, 100)}`).join("; ")}${steps.length > 3 ? ` (+${steps.length - 3} more)` : ""}. Type lit approve or lit cancel.`);
  }
  try {
    const goal = readLitgoalState(litgoalGoalsPath(stateRoot), null);
    if (goal && typeof goal === "object") {
      const criteria = Array.isArray(goal.criteria) ? goal.criteria : [];
      lines.push(`litgoal "${line(goal.objective ?? "", 100)}": ${line(goal.status ?? "unknown", 30)}, ${criteria.filter((c) => c?.status === "pass").length} of ${criteria.length} criteria pass.`);
    }
  } catch {
    // An unreadable goal file is left out.
  }
  const end = lastRunEnd(stateRoot);
  if (end) lines.push(`Last run end: ${line(end.source, 20)} ${line(end.outcome, 10)}.`);
  if (lines.length === 0) lines.push("No start-work, plan or litgoal is in progress here.");
  return lines.map((text) => `- ${text}`).join("\n");
};

/**
 * Handles a `lit check-back` prompt. Returns { silent: true } when nothing changed since the last report
 * (or the report could not be recorded, so it cannot be told apart from a repeat), else { report }. A
 * report marks this session timer-started; the mark is written before the report is returned.
 */
export const takeCheckBack = ({ cwd, stateRoot, sessionId, promptId = null, work = null, parked = null, now = Date.now() }) => {
  const report = buildCheckBackReport({ cwd, stateRoot, work, parked, now });
  const text = `check-back\n${report}`;
  if (wasShown({ stateRoot, text, now })) return { silent: true };
  if (!SESSION.test(String(sessionId)) || !markTimerStarted({ stateRoot, sessionId, promptId, now })) return { silent: true };
  if (!recordShown({ stateRoot, id: "check-back", text, now })) {
    clearTimerStarted({ stateRoot, sessionId });
    return { silent: true };
  }
  return { report };
};

const markTimerStarted = ({ stateRoot, sessionId, promptId, now }) => {
  let fd;
  try {
    if (!prepareStateDir(join(stateRoot, PROJECT_STATE_DIR, MARK_DIR))) return false;
    fd = openSync(markPath(stateRoot, sessionId), STATE_WRITE_FLAG, 0o600);
    writeSync(fd, `${JSON.stringify({ session_id: sessionId, prompt_id: typeof promptId === "string" ? promptId : null, at: now })}\n`);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/** Lifts this session's timer-started mark (any prompt the user types does this). */
export const clearTimerStarted = ({ stateRoot, sessionId }) => {
  try {
    if (!SESSION.test(String(sessionId))) return;
    const path = markPath(stateRoot, sessionId);
    if (lstatSync(path).isFile()) rmSync(path, { force: true });
  } catch {
    // Nothing to lift.
  }
};
