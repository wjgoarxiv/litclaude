#!/usr/bin/env node
// `node <plugin>/scripts/goal-propose.mjs plans/<slug>.md`: lit-plan runs this once, after the plan is
// written, and adds the line it prints to the approval question. It compiles the plan's `## Done when`
// block into one `/goal` condition, lints it, runs the check once to prove the condition is false
// now, and records the question in the session's `.litclaude/sessions/<id>/goal/consent.json` (the
// legacy shared `.litclaude/goal/consent.json` without a session id). It prints the consent question
// (yes starts the work and arms the goal). A plan without a `goal: native` line gets the start question
// with the goal as a second answer (`yes goal`), and a plan no goal can be built for gets the
// start-only question and the `No goal set: <reason>` line. It never sets a goal or starts work
// itself; only the user's exact `yes` (or `yes goal`) on the next prompt does, through the prompt hook.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { goalWritePath } from "../lib/goal-files.mjs";
import { GOAL_NEVER, GOAL_OPT_IN, GOAL_STATUS, goalGuideMarkdown, compileLoopCondition, conditionHash, falsify, falsifyLoop, hasOpenRows, lintCondition, planGoal, startOnlyHash } from "../lib/goal-pipeline.mjs";
import { normalizeGoalObjective } from "../lib/native-goal-binding.mjs";
import { charterHash, describeCharter, planCharter } from "../lib/plan-scope-roots.mjs";
import { prepareStateDir, STATE_WRITE_FLAG } from "../lib/project-state-root.mjs";

// A symlinked or non-folder state path throws instead of writing through it.
const record = (cwd, sessionId, consent) => {
  const target = goalWritePath(cwd, sessionId, "consent.json");
  if (!prepareStateDir(dirname(target))) throw new Error("the LitClaude goal state folder is a symlink or not a folder; refusing to write");
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(consent)}\n`, { flag: STATE_WRITE_FLAG });
  renameSync(staging, target);
};

export const proposeGoal = ({ cwd, planArg, sessionId = null, now = Date.now(), timeoutMs, run } = {}) => {
  const planPath = resolve(cwd, String(planArg ?? ""));
  const plan = relative(cwd, planPath);
  if (!planArg || isAbsolute(plan) || plan.startsWith("..") || !/^plans\/[\w.-]+\.md$/u.test(plan)) return { line: GOAL_STATUS.skipped("give the plan as plans/<slug>.md inside this project") };
  let planText;
  try {
    planText = readFileSync(planPath, "utf8");
  } catch {
    return { line: GOAL_STATUS.skipped(`${plan} cannot be read`) };
  }
  const askedAt = new Date(now).toISOString();
  // The run charter rides on the same question: the user's yes grants these scope roots and commits.
  const charter = describeCharter(planCharter(planText, cwd));
  // A readable plan with no settable goal still gets the start question; yes then starts the work only.
  const startOnly = (reason) => {
    const consent = { version: 1, condition: null, hash: startOnlyHash(plan), id: null, plan, reason, askedAt, charter_hash: charterHash(planText) };
    record(cwd, sessionId, consent);
    return { line: `${GOAL_STATUS.startOnly}\n${GOAL_STATUS.skipped(reason)}`, guide: goalGuideMarkdown("startOnly"), consent, charter };
  };
  if (GOAL_NEVER.test(planText)) return startOnly("this plan is marked goal: never");
  const built = planGoal({ plan, planText });
  if (!built.ok) return startOnly(built.reason);
  if (!GOAL_OPT_IN.test(planText)) {
    // No opt-in line: start-work drives the run either way, and `yes goal` adds the goal. Open rows keep
    // the condition false, so offering it runs no check; the hook rebuilds it from the plan before arming.
    if (!hasOpenRows(planText)) return startOnly(`${plan} has no open row`);
    const consent = { version: 1, condition: null, hash: startOnlyHash(plan), id: null, plan, askedAt, charter_hash: charterHash(planText), goal_option: { condition: built.condition, id: built.id } };
    record(cwd, sessionId, consent);
    return { line: `${GOAL_STATUS.startOrGoal}\n${GOAL_STATUS.optional(built.condition)}`, guide: goalGuideMarkdown("startOrGoal"), consent, charter };
  }
  const dry = falsify({ cwd, plan, planText, check: built.check, ...(timeoutMs ? { timeoutMs } : {}), ...(run ? { run } : {}) });
  if (!dry.ok) return startOnly(dry.reason);
  const consent = { version: 1, condition: built.condition, hash: conditionHash(built.condition), id: built.id, plan, askedAt, charter_hash: charterHash(planText) };
  record(cwd, sessionId, consent);
  return { line: GOAL_STATUS.asked(built.condition), guide: goalGuideMarkdown("asked", built.condition), consent, charter };
};

// `goal-propose.mjs --loop --check "<cmd>" <objective...>`: lit-loop's question, once its failing check
// exists. With no settable goal it records nothing and prints only `No goal set: <reason>`.
// The project's own test command, for the question the prompt hook shows; null when there is none.
export const detectCheck = (cwd) => {
  try {
    if (typeof JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))?.scripts?.test === "string") return "npm test";
  } catch {
    // No readable package.json.
  }
  for (const [file, check] of [["pytest.ini", "pytest"], ["pyproject.toml", "pytest"], ["Cargo.toml", "cargo test"], ["go.mod", "go test ./..."]]) {
    if (existsSync(join(cwd, file))) return check;
  }
  return null;
};

// falsifyNow: false skips the dry run (the prompt hook cannot wait on a test run); the objective clause
// still keeps such a goal false until the work is done.
export const proposeLoopGoal = ({ cwd, check, objective, sessionId = null, now = Date.now(), timeoutMs, run, falsifyNow = true } = {}) => {
  const goal = normalizeGoalObjective(String(objective ?? ""));
  const command = String(check ?? "").trim();
  if (!goal) return { line: GOAL_STATUS.skipped("name what the loop should finish") };
  const built = compileLoopCondition({ objective: goal, check: command });
  if (!built.ok) return { line: GOAL_STATUS.skipped(built.reason) };
  const lint = lintCondition(built.condition, command);
  if (!lint.ok) return { line: GOAL_STATUS.skipped(lint.reasons.join("; ")) };
  const dry = falsifyNow ? falsifyLoop({ cwd, check: command, ...(timeoutMs ? { timeoutMs } : {}), ...(run ? { run } : {}) }) : { ok: true };
  if (!dry.ok) return { line: GOAL_STATUS.skipped(dry.reason) };
  const consent = { version: 1, kind: "loop", condition: built.condition, hash: conditionHash(built.condition), id: built.id, plan: null, objective: goal, askedAt: new Date(now).toISOString() };
  record(cwd, sessionId, consent);
  return { line: GOAL_STATUS.loopAsked(built.condition), guide: goalGuideMarkdown("loopAsked", built.condition), consent };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [first, ...rest] = process.argv.slice(2);
  // Claude Code names the session in the Bash tool's environment; without it the shared path is used.
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID || null;
  let line;
  let guide;
  let charter;
  try {
    ({ line, guide, charter } = first === "--loop" && rest[0] === "--check"
      ? proposeLoopGoal({ cwd: process.cwd(), sessionId, check: rest[1], objective: rest.slice(2).join(" ") })
      : proposeGoal({ cwd: process.cwd(), sessionId, planArg: first }));
  } catch (error) {
    line = GOAL_STATUS.skipped(error instanceof Error ? error.message : "the question could not be recorded");
  }
  const head = charter ? `${charter}\n${line}` : line;
  process.stdout.write(guide ? `${head}\n\n${guide}\n` : `${head}\n`);
}
