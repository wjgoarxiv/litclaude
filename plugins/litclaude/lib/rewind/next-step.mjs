// The one next step a lit-adhd brief offers, chosen by a fixed priority over the collected records
// (plans/lit-adhd.md todo 10), and the small record `go` later reads back (todo 12):
//   1. this session's paused spine frame          -> resume-frame   (`lit continue`)
//   2. a paused start-work boundary               -> approve-boundary (shown only, never automatic)
//   3. an active start-work of this session       -> continue-work
//   4. a single open plan with no work running    -> start-plan     (`/litclaude:start-work <plan>`)
//   5. otherwise                                  -> none

import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ignitionFileName } from "../mod/state.mjs";
import { requireStateDir, STATE_WRITE_FLAG } from "../project-state-root.mjs";

export const chooseNextStep = (data, sessionId) => {
  const ownStack = data.workflows.find((frame) => frame.sessionId === sessionId && frame.role === "spine" && frame.status === "paused");
  if (sessionId && ownStack) {
    return { kind: "resume-frame", target: { skill: ownStack.skill, stage: ownStack.stage, progress: ownStack.progress.gauge }, say: "lit continue" };
  }
  const paused = data.startWork.find((work) => work.status === "paused" && work.pendingBoundary);
  if (paused) {
    return { kind: "approve-boundary", target: { workId: paused.workId, plan: paused.plan, ...paused.pendingBoundary }, say: "lit approve", automatic: false };
  }
  const own = data.startWork.find((work) => work.status === "active" && sessionId && work.sessionId === sessionId);
  if (own) return { kind: "continue-work", target: { workId: own.workId, plan: own.plan }, say: "go" };
  const running = data.startWork.some((work) => ["active", "paused"].includes(work.status));
  const open = data.roadmap.plans.filter((plan) => plan.local && plan.progress.total !== null && plan.progress.done < plan.progress.total);
  if (!running && open.length === 1) {
    return { kind: "start-plan", target: { plan: open[0].plan }, say: "go", command: `/litclaude:start-work ${open[0].plan}` };
  }
  return { kind: "none", target: null };
};

export const nextStepPath = (stateRoot, sessionId) => join(stateRoot, ".litclaude", "adhd", `next-${ignitionFileName(sessionId)}`);

/** Writes `{kind, target, at}` for this session, whole, through a temporary file. */
export const writeNextStep = (stateRoot, sessionId, step, now = new Date()) => {
  const path = nextStepPath(stateRoot, sessionId);
  requireStateDir(dirname(path));
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify({ kind: step.kind, target: step.target, at: now.toISOString() })}\n`, { flag: STATE_WRITE_FLAG });
  renameSync(staging, path);
  return path;
};

// The whole prompt, nothing more: `go`, `lit go`, `ㄱㄱ`, `고` or `진행`, with trailing punctuation.
const GO_PROMPT = /^\s*(?:(?:lit\s+)?go|ㄱㄱ|고|진행)[\s.!?]*$/iu;
export const isGoPrompt = (prompt) => typeof prompt === "string" && prompt.length <= 64 && GO_PROMPT.test(prompt);

export const NEXT_STEP_MAX_AGE_MS = 30 * 60_000;
const KINDS = new Set(["resume-frame", "approve-boundary", "continue-work", "start-plan", "none"]);

/**
 * Reads and deletes this session's next-step record. The session binding is the file name, so
 * another session's record is never opened. Returns `{kind, target}` when the record is whole and
 * at most 30 minutes old, otherwise null; a stale or unreadable record is deleted all the same.
 */
export const takeNextStep = (stateRoot, sessionId, now = Date.now()) => {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const path = nextStepPath(stateRoot, sessionId);
  let text;
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 16_384) return null;
      text = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Nothing to consume.
    }
  }
  try {
    const record = JSON.parse(text);
    const age = now - Date.parse(record.at);
    if (!KINDS.has(record.kind) || !(age >= -60_000 && age <= NEXT_STEP_MAX_AGE_MS)) return null;
    return { kind: record.kind, target: record.target && typeof record.target === "object" ? record.target : null };
  } catch {
    return null;
  }
};
