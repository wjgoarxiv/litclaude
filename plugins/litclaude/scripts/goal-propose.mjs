#!/usr/bin/env node
// `node <plugin>/scripts/goal-propose.mjs plans/<slug>.md`: lit-plan runs this once, after the plan is
// written, and adds the line it prints to the approval question. It compiles the plan's `## Done when`
// block into one `/goal` condition, lints it, runs the check once to prove the condition is false
// now, and records the question in `.litclaude/goal/consent.json`. It prints the consent question
// (yes starts the work and arms the goal), or, when no goal can be set for a readable plan, the
// start-only question and the `No goal set: <reason>` line. It never sets a goal or starts work
// itself; only the user's exact `yes` on the next prompt does, through the prompt hook.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { GOAL_DIR, GOAL_STATUS, compileCondition, conditionHash, falsify, lintCondition, parseDoneWhen, startOnlyHash } from "../lib/goal-pipeline.mjs";

const record = (cwd, consent) => {
  const dir = join(cwd, GOAL_DIR);
  mkdirSync(dir, { recursive: true });
  const staging = join(dir, `consent.json.${process.pid}.tmp`);
  writeFileSync(staging, `${JSON.stringify(consent)}\n`);
  renameSync(staging, join(dir, "consent.json"));
};

export const proposeGoal = ({ cwd, planArg, now = Date.now(), timeoutMs, run } = {}) => {
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
  // A readable plan with no settable goal still gets the start question; yes then starts the work only.
  const startOnly = (reason) => {
    const consent = { version: 1, condition: null, hash: startOnlyHash(plan), id: null, plan, reason, askedAt };
    record(cwd, consent);
    return { line: `${GOAL_STATUS.startOnly}\n${GOAL_STATUS.skipped(reason)}`, consent };
  };
  if (/^goal:\s*never\s*$/mu.test(planText)) return startOnly("this plan is marked goal: never");
  const done = parseDoneWhen(planText);
  if (!done.ok) return startOnly(done.reason);
  const built = compileCondition({ plan, check: done.check });
  if (!built.ok) return startOnly(built.reason);
  const lint = lintCondition(built.condition, done.check);
  if (!lint.ok) return startOnly(lint.reasons.join("; "));
  const dry = falsify({ cwd, plan, planText, check: done.check, ...(timeoutMs ? { timeoutMs } : {}), ...(run ? { run } : {}) });
  if (!dry.ok) return startOnly(dry.reason);
  const consent = { version: 1, condition: built.condition, hash: conditionHash(built.condition), id: built.id, plan, askedAt };
  record(cwd, consent);
  return { line: GOAL_STATUS.asked(built.condition), consent };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { line } = proposeGoal({ cwd: process.cwd(), planArg: process.argv[2] });
  process.stdout.write(`${line}\n`);
}
