// The pure half of the native-goal pipeline (S4) that the LitClaude mod runs: the fixed status lines,
// what the transcript says about goals, and the one step to take at an idle. No Node built-ins, so the
// mods loader can import it; lib/goal-pipeline.mjs re-exports it for the hook and the CLI.
export const GOAL_DIR = ".litclaude/goal";
// Each session keeps its own goal records under `.litclaude/sessions/<id>/goal`; the shared GOAL_DIR
// above is the legacy place, still read when a session has no record of its own.
export const SESSION_STATE_ID = /^[A-Za-z0-9-]{1,80}$/u;
export const sessionGoalDir = (sessionId) => (typeof sessionId === "string" && SESSION_STATE_ID.test(sessionId) ? `.litclaude/sessions/${sessionId}/goal` : null);

// The answers each goal question takes and what each one does. The question's `(yes / …)` tail and
// the answer guide shown under it are both built from these lists, so the two cannot drift apart.
export const GOAL_ANSWERS = Object.freeze({
  asked: [["yes", "starts the work now and sets this goal when this reply ends"], ["edit", "change the goal's check first"], ["no", "nothing starts"]],
  startOnly: [["yes", "starts the work now, with no goal"], ["no", "nothing starts"]],
  startOrGoal: [["yes", "starts the work now, with no goal"], ["yes goal", "starts the work now and sets the goal above when this reply ends"], ["no", "nothing starts"]],
  loopAsked: [["yes", "set this goal when this turn ends"], ["no", "keep working without a goal"]],
});
const GUIDE_TITLES = Object.freeze({ asked: "approve plan · start work · set goal", startOnly: "approve plan · start work", startOrGoal: "approve plan · start work", loopAsked: "set goal for this lit-loop" });
// The closing line of a guide; an answer of two words is not "the word".
const guideClose = (kind) => (GOAL_ANSWERS[kind].some(([word]) => word.includes(" ")) ? "Type the answer alone." : "Type the word alone.");
const answerTail = (kind) => `(${GOAL_ANSWERS[kind].map(([word]) => word).join(" / ")})`;

/** The guide for plain terminal text (hook systemMessage): aligned lines, no Markdown. */
export const goalGuidePlain = (kind) => {
  const width = Math.max(...GOAL_ANSWERS[kind].map(([word]) => word.length));
  return [...GOAL_ANSWERS[kind].map(([word, does]) => `  ${word.padEnd(width)}  → ${does}`), `  ${guideClose(kind)}`].join("\n");
};

/** The guide for a model-written reply: a quoted Markdown table the model renders under the question. */
export const goalGuideMarkdown = (kind, cond = null) => [
  `**▶ Answer: ${GUIDE_TITLES[kind]}**`,
  ...(cond ? ["", `Goal: \`\` /goal ${cond} \`\``] : []),
  "",
  "| Type | What happens |",
  "|---|---|",
  ...GOAL_ANSWERS[kind].map(([word, does]) => `| **\`${word}\`** | ${does[0].toUpperCase()}${does.slice(1)} |`),
  "",
  guideClose(kind),
].map((line) => (line ? `> ${line}` : ">")).join("\n");

// Fixed status lines, one per outcome. The mod and the CLI print these and nothing else.
export const GOAL_STATUS = Object.freeze({
  asked: (cond) => `Approve plan, start work and set goal: /goal ${cond}? ${answerTail("asked")}`,
  startOnly: `Approve plan and start work? ${answerTail("startOnly")}`,
  startOrGoal: `Approve plan and start work? ${answerTail("startOrGoal")}`,
  optional: (cond) => `Optional goal, set only by \`yes goal\`: /goal ${cond}`,
  loopAsked: (cond) => `Set goal for this lit-loop: /goal ${cond}? ${answerTail("loopAsked")}`,
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
      // The host records a `/goal clear` as `met:true, sentinel:true`: the goal ended, it was not met.
      if (status.sentinel !== true) met.add(status.condition);
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
  // A clear request older than this goal was meant for an earlier one.
  const freshClear = clear && !clear.consumedAt && !(Date.parse(clear.at) < Date.parse(owner.setAt));
  const why = freshClear ? clear.why : /^BLOCKED:/mu.test(lastAssistantText(transcript)) ? "BLOCKED" : state.checks >= STALL_CHECKS ? "stalled" : null;
  return why ? { do: "clear", why, status: GOAL_STATUS.cleared(owner.id, why) } : { do: "none" };
};
