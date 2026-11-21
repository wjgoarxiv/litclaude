// The pure half of the native-goal pipeline (S4) that the LitClaude mod runs: the fixed status lines,
// what the transcript says about goals, and the one step to take at an idle. No Node built-ins, so the
// mods loader can import it; lib/goal-pipeline.mjs re-exports it for the hook and the CLI.
export const GOAL_DIR = ".litclaude/goal";
// Each session keeps its own goal records under `.litclaude/sessions/<id>/goal`; the shared GOAL_DIR
// above is the legacy place, still read when a session has no record of its own.
export const SESSION_STATE_ID = /^[A-Za-z0-9-]{1,80}$/u;
export const sessionGoalDir = (sessionId) => (typeof sessionId === "string" && SESSION_STATE_ID.test(sessionId) ? `.litclaude/sessions/${sessionId}/goal` : null);

// Fixed status lines, one per outcome. The mod and the CLI print these and nothing else.
export const GOAL_STATUS = Object.freeze({
  asked: (cond) => `Approve plan, start work and set goal: /goal ${cond}? (yes / edit / no)`,
  startOnly: "Approve plan and start work? (yes / no)",
  loopAsked: (cond) => `Set goal for this lit-loop: /goal ${cond}? (yes / no)`,
  skipped: (reason) => `No goal set: ${reason}`,
  notStarted: (why) => `No goal set: start-work did not start (${why})`,
  armed: (id) => `LitClaude goal armed [lit:${id}]; it is set when this turn ends.`,
  set: (id) => `LitClaude goal set [lit:${id}]`,
  yours: "Your own goal is active; LitClaude left it alone.",
  notConfirmed: (cond) => `Goal not confirmed. Paste: /goal ${cond}`,
  met: (id) => `Goal met and cleared [lit:${id}]`,
  cleared: (id, why) => `LitClaude goal cleared (${why}) [lit:${id}]`,
});

/**
 * What the transcript says about goals, newest last: the condition of the goal still running (or
 * null), and whether a given condition was met. Reads `goal_status` attachments only.
 */
export const goalStateFromTranscript = (jsonlText) => {
  let active = null;
  const met = new Set();
  let checks = 0;
  for (const line of String(jsonlText ?? "").split("\n")) {
    if (!line.includes('"goal_status"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const status = record?.attachment;
    if (status?.type !== "goal_status" || typeof status.condition !== "string") continue;
    if (status.met === true) {
      met.add(status.condition);
      if (active === status.condition) active = null;
    } else {
      if (active !== status.condition) checks = 0;
      active = status.condition;
      checks += 1;
    }
  }
  return { active, met, checks };
};

/** The transcript file Claude Code keeps for a session. */
export const transcriptPathFor = (configDir, cwd, sessionId) => `${configDir}/projects/${String(cwd).replace(/[^A-Za-z0-9]/gu, "-")}/${sessionId}.jsonl`;

/** The newest assistant text in a transcript, for the `BLOCKED:` check. */
export const lastAssistantText = (jsonlText) => {
  const lines = String(jsonlText ?? "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].includes('"assistant"')) continue;
    try {
      const record = JSON.parse(lines[index]);
      if (record?.type !== "assistant" || record.isSidechain) continue;
      const text = (record.message?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n").trim();
      if (text) return text;
    } catch {
      // A torn line is skipped.
    }
  }
  return "";
};

export const STALL_CHECKS = 12;

/**
 * The mod's decision at an idle, from the records and the transcript alone: arm the goal, confirm or
 * give up on it, or clear it. Pure, so the mod only carries it out.
 */
export const goalStep = ({ intent, owner, clear, transcript, sessionId }) => {
  const state = goalStateFromTranscript(transcript);
  if (intent && !intent.consumedAt && (!intent.sessionId || intent.sessionId === sessionId)) {
    if (state.active && !/\[lit:[0-9a-f]{8}\]$/u.test(state.active)) return { do: "skip-yours", status: GOAL_STATUS.yours };
    return { do: "set", condition: intent.condition, status: GOAL_STATUS.set(intent.id) };
  }
  if (!owner || owner.closed || owner.sessionId !== sessionId) return { do: "none" };
  if (state.met.has(owner.condition)) return { do: "close", why: "met", status: GOAL_STATUS.met(owner.id) };
  if (!owner.confirmed) {
    return state.active === owner.condition
      ? { do: "confirm" }
      : { do: "close", why: "not confirmed", status: GOAL_STATUS.notConfirmed(owner.condition) };
  }
  if (state.active !== owner.condition) return { do: "close", why: "gone", status: null };
  const why = clear && !clear.consumedAt ? clear.why : /^BLOCKED:/mu.test(lastAssistantText(transcript)) ? "BLOCKED" : state.checks >= STALL_CHECKS ? "stalled" : null;
  return why ? { do: "clear", why, status: GOAL_STATUS.cleared(owner.id, why) } : { do: "none" };
};
