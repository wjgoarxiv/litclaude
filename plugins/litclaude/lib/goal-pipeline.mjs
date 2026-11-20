// The native-goal pipeline (S4): a plan's `## Done when` block becomes one checkable Claude Code
// `/goal` condition, asked for once at plan approval and set by the LitClaude mod only after an exact
// `yes`. Everything here is plain data in and out; the files live under `<project>/.litclaude/goal/`:
//
//   consent.json  written by `goal-propose` with the condition, its hash and the plan   (asked)
//   intent.json   written by the prompt hook when the user typed exactly `yes`          (armed)
//   owner.json    written by the mod after `/goal <cond>` ran                           (set by lit)
//   clear.json    written by the prompt hook on `lit cancel`                             (clear asked)
//
// The mod clears only a goal whose condition matches owner.json; a goal the user set by hand is never
// touched. Host facts (Claude Code 2.1.326): `/goal <cond>` prints `Goal set: <cond>`, the transcript
// records `{"type":"goal_status","met":false,"sentinel":true,"condition":…}` and, once met,
// `{"type":"goal_status","met":true,…}`; a met goal clears itself; `/goal clear` clears early.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { GOAL_DIR, GOAL_STATUS } from "./mod/goal.mjs";
import { parsePlanTaskRows } from "./plan-task-rows.mjs";

export { GOAL_DIR, GOAL_STATUS, STALL_CHECKS, goalStateFromTranscript, goalStep, lastAssistantText, transcriptPathFor } from "./mod/goal.mjs";

export const GOAL_MAX_CHARS = 500;
export const CONSENT_TTL_MS = 30 * 60 * 1000;
export const FALSIFY_TIMEOUT_MS = 120_000;

const JUDGMENT_WORDS = [
  /\bworks?\b/iu, /\bworking\b/iu, /\blooks? (?:good|fine|right|nice|great)\b/iu, /\bseems?\b/iu, /\bproperly\b/iu,
  /\bcorrectly\b/iu, /\bclean(?:ly)?\b/iu, /\bnicely\b/iu, /\bshould (?:work|pass)\b/iu, /\bas expected\b/iu, /\bgood enough\b/iu,
  /잘\s*(?:동작|작동|돌아|돼|된다|되면)/u, /괜찮/u, /깔끔/u, /제대로/u, /문제\s*없/u, /완벽/u,
];
// A success that is only an outward action proves nothing about the work and cannot be undone.
const OUTWARD_ONLY = /^\s*(?:git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|gh\s+(?:release|pr\s+merge)|git\s+tag)\b/iu;
// Test runners the falsifier may run. Anything else is refused before it runs.
const CHECK_ALLOWLIST = [
  /^npm (?:test|run [\w:.-]+)(?: --[\w-]+)*$/u,
  /^node --test(?: [\w./-]+)*$/u,
  /^node [\w./-]+\.m?js(?: [\w./=-]+)*$/u,
  /^(?:pnpm|yarn) (?:test|run [\w:.-]+)$/u,
  /^(?:pytest|python3? -m pytest)(?: [\w./:-]+)*$/u,
  /^cargo test(?: [\w-]+)*$/u,
  /^go test(?: [\w./-]+)*$/u,
  /^make (?:test|check|verify)$/u,
  /^(?:bash|sh) scripts\/[\w./-]+\.sh$/u,
];

export const conditionHash = (condition) => createHash("sha256").update(String(condition)).digest("hex").slice(0, 16);
export const goalId = (plan, check) => createHash("sha256").update(`${plan}\u0000${check}`).digest("hex").slice(0, 8);

/** The `## Done when` block: `check: \`<command>\`` on its own line, at most one. */
export const parseDoneWhen = (planText) => {
  const lines = String(planText ?? "").split(/\r?\n/u);
  const start = lines.findIndex((line) => /^##\s+Done when\s*$/iu.test(line));
  if (start === -1) return { ok: false, reason: "the plan has no `## Done when` block" };
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/u.test(line)) break;
    const match = /^\s*(?:[-*]\s+)?check:\s*`([^`\n]+)`\s*$/u.exec(line);
    if (match) return { ok: true, check: match[1].trim() };
  }
  return { ok: false, reason: "the `## Done when` block names no `check:` command" };
};

/** `Every row in plans/<f>.md is ticked and \`<cmd>\` exits 0 [lit:<id>]`, or why it cannot be built. */
export const compileCondition = ({ plan, check }) => {
  const id = goalId(plan, check);
  const condition = `Every row in ${plan} is ticked and \`${check}\` exits 0 [lit:${id}]`;
  if (condition.length > GOAL_MAX_CHARS) return { ok: false, reason: `the condition is over ${GOAL_MAX_CHARS} characters; point the check at one script` };
  return { ok: true, condition, id };
};

/** A lit-loop's condition: its check exits 0 and its objective is done. No plan, so no rows. */
export const compileLoopCondition = ({ objective, check }) => {
  const id = goalId(`loop\u0000${objective}`, check);
  const condition = `\`${check}\` exits 0 and this is done: ${objective} [lit:${id}]`;
  if (condition.length > GOAL_MAX_CHARS) return { ok: false, reason: `the condition is over ${GOAL_MAX_CHARS} characters; shorten the objective` };
  return { ok: true, condition, id };
};

/** Rejects judgment words, outward-only success and conditions over the cap. */
export const lintCondition = (condition, check) => {
  const reasons = [];
  if (String(condition).length > GOAL_MAX_CHARS) reasons.push(`over ${GOAL_MAX_CHARS} characters`);
  const words = JUDGMENT_WORDS.filter((pattern) => pattern.test(String(check))).map((pattern) => String(check).match(pattern)[0]);
  if (words.length) reasons.push(`judgment words cannot be checked (${words.join(", ")})`);
  if (OUTWARD_ONLY.test(String(check))) reasons.push("a push, publish or release is not a check of the work");
  if (!CHECK_ALLOWLIST.some((pattern) => pattern.test(String(check)))) reasons.push(`\`${check}\` is not an allowlisted test command`);
  return { ok: reasons.length === 0, reasons };
};

/**
 * The dry run: the condition must be false right now, or the goal would be met on its first check.
 * Runs the allowlisted check once, time-boxed, with no shell. Unticked rows already make it false,
 * but the check still runs once so an unrunnable or hanging command is caught before it is a goal.
 */
export const falsify = ({ cwd, plan, planText, check, timeoutMs = FALSIFY_TIMEOUT_MS, run = spawnSync }) => {
  const rows = parsePlanTaskRows(planText);
  const open = rows.filter((row) => !row.checked).length;
  const [cmd, ...args] = check.split(/\s+/u);
  const result = run(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "ignore", "ignore"], shell: false });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") return { ok: false, reason: `\`${check}\` did not finish within ${Math.round(timeoutMs / 1000)} s` };
  // A check script the plan itself creates is missing until the work runs: that is false now, not broken.
  const plannedScript = ["bash", "sh"].includes(cmd) && args.length === 1 && String(planText).includes(args[0]);
  if (result.error || (result.status === 127 && !plannedScript)) return { ok: false, reason: `\`${check}\` cannot run here` };
  if (result.status === 0 && open === 0) return { ok: false, reason: `the goal is already true (${plan} is all ticked and \`${check}\` exits 0)` };
  return { ok: true, open, exit: result.status };
};

/** A lit-loop has no unticked rows to keep its goal false, so its check must fail right now. */
export const falsifyLoop = ({ cwd, check, timeoutMs = FALSIFY_TIMEOUT_MS, run = spawnSync }) => {
  const [cmd, ...args] = check.split(/\s+/u);
  const result = run(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "ignore", "ignore"], shell: false });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") return { ok: false, reason: `\`${check}\` did not finish within ${Math.round(timeoutMs / 1000)} s` };
  if (result.error || result.status === 127) return { ok: false, reason: `\`${check}\` cannot run here` };
  if (result.status === 0) return { ok: false, reason: `\`${check}\` already passes, so the goal would be met at once; write the failing test first` };
  return { ok: true, exit: result.status };
};

/** `yes` (exactly, any case) arms; `edit` and `no` are answers too; anything else is no answer. */
export const consentAnswer = (prompt) => {
  const text = String(prompt ?? "").trim().toLowerCase();
  return ["yes", "edit", "no"].includes(text) ? text : null;
};

/** The consent record is fresh and is the one the user is answering. */
export const consentIsLive = (consent, now) => Boolean(consent
  && (consent.kind === "loop"
    ? consent.plan === null && typeof consent.condition === "string" && consent.hash === conditionHash(consent.condition)
    : typeof consent.plan === "string"
      && (typeof consent.condition === "string" ? consent.hash === conditionHash(consent.condition) : consent.condition === null && consent.hash === startOnlyHash(consent.plan)))
  && Number.isFinite(Date.parse(consent.askedAt)) && now - Date.parse(consent.askedAt) <= CONSENT_TTL_MS);

/** The hash a start-only question (no goal could be set) binds: the plan it would start. */
export const startOnlyHash = (plan) => conditionHash(`start\u0000${plan}`);

