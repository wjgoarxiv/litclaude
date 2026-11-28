// Skill-plan turn-end check. A bare-lit prompt whose plan is led by lit-loop and names companions arms the
// record at UserPromptSubmit with the ids the model must load; the Stop hook reads the transcript from that
// prompt on and, when a planned skill was neither loaded with the Skill tool nor skipped with a
// `SKIP <id>: <reason>` line, blocks the stop once with the missing names. It never blocks twice for one
// record, so it cannot loop. A turn that ends on a question to the user passes, and the record then survives
// the next plain prompt without a route (the answer to that question), up to SKILL_PLAN_MAX_AGE_MS; a prompt
// with a route re-arms or clears it, and any other prompt clears it. Anything unreadable allows the stop.
import { closeSync, fstatSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { STATE_WRITE_FLAG } from "./project-state-root.mjs";
import { clearSessionRecord, sessionStateDir, sessionStatePath } from "./session-state.mjs";

export const SKILL_PLAN_MAX_BLOCKS = 1;
export const SKILL_PLAN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// Only the transcript's tail is read; a turn longer than this reads as "nothing loaded" for the skills whose
// calls fell outside it, which at worst costs one extra reminder.
export const TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024;
const TURN_FILE = "skill-plan-turn.json";
const SKILL_ID = /^[a-z][a-z0-9-]{0,63}$/u;

export const skillPlanTurnPath = (cwd, sessionId) => {
  const dir = sessionStatePath(cwd, sessionId);
  return dir === null ? null : join(dir, TURN_FILE);
};

/**
 * The plan entries the model has to load: every companion it can load itself (installed, not user-typed), and
 * only under a lit-loop plan; a workflow lead such as lit-plan decides for itself when a part starts.
 */
export const requiredPlanSkills = (plan) => (plan?.entries?.[0]?.id === "lit-loop" ? plan.entries : []).slice(1)
  .filter((entry) => entry.installed && !entry.userInvoked && SKILL_ID.test(entry.id))
  .map(({ id, plugin }) => ({ id, plugin: plugin ?? null }));

export const recordSkillPlanTurn = (cwd, { sessionId, plan, now = Date.now() }) => {
  const path = skillPlanTurnPath(cwd, sessionId);
  if (path === null) return null;
  const required = requiredPlanSkills(plan);
  if (required.length === 0) {
    clearSessionRecord(path, null, sessionId);
    return null;
  }
  return writeTurn(cwd, { sessionId, promptAt: now, required, blockCount: 0, asked: false });
};

const writeTurn = (cwd, state) => {
  const dir = sessionStateDir(cwd, state.sessionId);
  const tmp = join(dir, `${TURN_FILE}.tmp`);
  writeFileSync(tmp, JSON.stringify(state), { flag: STATE_WRITE_FLAG });
  renameSync(tmp, join(dir, TURN_FILE));
  return state;
};

const readTurn = (cwd, sessionId) => {
  const path = skillPlanTurnPath(cwd, sessionId);
  if (path === null) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const turn = JSON.parse(text);
  if (!turn || turn.sessionId !== sessionId || !Number.isFinite(turn.promptAt) || !Number.isInteger(turn.blockCount) || !Array.isArray(turn.required)) {
    throw new Error("invalid skill-plan turn state");
  }
  return turn;
};

const readTail = (path) => {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    return length < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
};

// A skip line: optional list marker, bold or code marks around SKIP and the id, an optional plugin prefix, then
// a colon or dash and a reason.
const SKIP_LINE = /(?:^|\n)[ \t]*(?:(?:[-*+]|\d{1,3}[.)])[ \t]+)?[`*_]{0,3}SKIP[`*_]{0,3}[ \t]+[`*_]{0,3}(?:[a-z][a-z0-9-]{0,40}:)?([a-z][a-z0-9-]{0,63})[`*_]{0,3}[ \t]*(?::|：|—|–|-)[ \t]*\S/gu;
const endsWithQuestion = (text) => /[?？]\s*(?:[`*_)\]]\s*)*$/u.test(text);

/**
 * Skill names loaded and skill ids skipped in the assistant messages from `promptAt` on, and whether the
 * last assistant text ends on a question to the user.
 */
export const turnSkillActivity = (transcriptText, promptAt) => {
  const loaded = new Set();
  const skipped = new Set();
  let lastText = "";
  for (const line of transcriptText.split("\n")) {
    if (!line.includes("\"assistant\"")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== "assistant") continue;
    const at = Date.parse(record.timestamp);
    if (Number.isFinite(at) && at < promptAt) continue;
    const content = Array.isArray(record.message?.content) ? record.message.content : [];
    for (const part of content) {
      if (part?.type === "tool_use" && part.name === "Skill" && typeof part.input?.skill === "string") loaded.add(part.input.skill.trim().replace(/^\//u, ""));
      if (part?.type === "text" && typeof part.text === "string") {
        for (const match of part.text.matchAll(SKIP_LINE)) skipped.add(match[1]);
        if (part.text.trim()) lastText = part.text;
      }
    }
  }
  return { loaded, skipped, asked: endsWithQuestion(lastText) };
};

const isLoaded = ({ id, plugin }, loaded) => loaded.has(id) || loaded.has(`litclaude:${id}`) || (plugin !== null && loaded.has(`${plugin}:${id}`));

export const evaluateSkillPlanStop = ({ cwd, sessionId, transcriptPath, now = Date.now() }) => {
  const turn = readTurn(cwd, sessionId);
  if (!turn) return { action: "allow", why: "no-plan" };
  if (turn.blockCount >= SKILL_PLAN_MAX_BLOCKS) return { action: "allow", why: "reminded" };
  if (now - turn.promptAt > SKILL_PLAN_MAX_AGE_MS) return { action: "allow", why: "expired" };
  if (typeof transcriptPath !== "string" || !transcriptPath) return { action: "allow", why: "no-transcript" };
  const { loaded, skipped, asked } = turnSkillActivity(readTail(transcriptPath), turn.promptAt);
  const missing = turn.required.filter((entry) => !isLoaded(entry, loaded) && !skipped.has(entry.id));
  if (missing.length === 0) return { action: "allow", why: "settled" };
  if (asked) {
    writeTurn(cwd, { ...turn, asked: true });
    return { action: "allow", why: "asked" };
  }
  writeTurn(cwd, { ...turn, blockCount: turn.blockCount + 1, asked: false });
  const names = missing.map(({ id, plugin }) => (plugin ? `${plugin}:${id}` : id));
  return {
    action: "block",
    missing: names,
    reason: `LitClaude skill plan: ${names.join(", ")} ${names.length === 1 ? "was" : "were"} planned for this request but neither loaded nor skipped. Load ${names.length === 1 ? "it" : "each one"} with the Skill tool and finish ${names.length === 1 ? "its" : "their"} part, or write one line \`SKIP <skill-id>: <reason>\` for a skill that does not fit. This reminder comes once per turn.`,
  };
};

/**
 * A plain prompt with no route: the record stays only when the last turn ended on a question (this prompt is
 * its answer), and that pass is spent; otherwise the plan belonged to a finished turn and is cleared.
 */
export const carrySkillPlanTurn = (cwd, sessionId) => {
  let turn;
  try {
    turn = readTurn(cwd, sessionId);
  } catch {
    turn = null;
  }
  if (turn?.asked === true) return writeTurn(cwd, { ...turn, asked: false });
  clearSkillPlanTurn(cwd, sessionId);
  return null;
};

export const clearSkillPlanTurn = (cwd, sessionId) => {
  const path = skillPlanTurnPath(cwd, sessionId);
  if (path !== null) clearSessionRecord(path, null, sessionId);
};
