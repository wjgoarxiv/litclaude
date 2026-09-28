// lit-plan persistence gate. UserPromptSubmit records a lit-plan turn at
// `.litclaude/lit-plan/turn.json`; the Stop hook then refuses to end the turn until a
// `plans/*.md` newer than the prompt carries at least one `- [ ] N.` task row. The
// block counter is the loop brake: at most LIT_PLAN_MAX_BLOCKS blocks per session,
// after which the stop passes with a warning. Any unreadable state fails SAFE (allow).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { resolveProjectStateRoot } from "./project-state-root.mjs";
import { findProjectRoot } from "./rules/discovery.mjs";

export const LIT_PLAN_MAX_BLOCKS = 2;
export const LIT_PLAN_BLOCK_REASON = "lit-plan must persist plans/<slug>.md (run scaffold-plan.mjs) before finishing";

// Filesystem mtime granularity can lag the wall clock the hook sampled.
const MTIME_TOLERANCE_MS = 1000;
const TASK_ROW = /^- \[ \] \d+\./mu;

export const litPlanTurnPath = (cwd = resolveProjectStateRoot()) => join(resolveProjectStateRoot(cwd), ".litclaude", "lit-plan", "turn.json");

const readTurn = (cwd) => {
  const path = litPlanTurnPath(cwd);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (
    !parsed
    || typeof parsed !== "object"
    || typeof parsed.sessionId !== "string"
    || !Number.isFinite(parsed.promptAt)
    || !Number.isInteger(parsed.blockCount)
    || parsed.blockCount < 0
  ) {
    throw new Error("invalid lit-plan turn state");
  }
  return parsed;
};

const writeTurn = (cwd, state) => {
  const target = litPlanTurnPath(cwd);
  mkdirSync(join(target, ".."), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, target);
  return state;
};

export const recordLitPlanTurn = (cwd, { sessionId, now = Date.now() }) => {
  let previous = null;
  try {
    previous = readTurn(cwd);
  } catch {
    previous = null;
  }
  const sameSession = previous?.sessionId === sessionId;
  return writeTurn(cwd, {
    sessionId: typeof sessionId === "string" ? sessionId : "",
    promptAt: now,
    blockCount: sameSession ? previous.blockCount : 0,
    warned: false,
  });
};

export const clearLitPlanTurn = (cwd) => {
  rmSync(litPlanTurnPath(cwd), { force: true });
};

const newestPlanAfter = (directory, promptAt) => {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  let newest = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const absolutePath = join(directory, entry.name);
    let stat;
    try {
      stat = statSync(absolutePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < promptAt - MTIME_TOLERANCE_MS) continue;
    if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { absolutePath, name: entry.name, mtimeMs: stat.mtimeMs };
  }
  return newest;
};

const planDirectories = (cwd) => {
  const start = resolve(cwd);
  const projectRoot = findProjectRoot(start) ?? start;
  const directories = [join(start, "plans")];
  if (projectRoot !== start) directories.push(join(projectRoot, "plans"));
  return directories;
};

export const evaluateLitPlanStop = ({ cwd, sessionId, now = Date.now() }) => {
  const turn = readTurn(cwd);
  if (!turn || turn.sessionId !== sessionId) return { action: "allow", why: "no-lit-plan-turn" };

  let newest = null;
  for (const directory of planDirectories(cwd)) {
    const candidate = newestPlanAfter(directory, turn.promptAt);
    if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) newest = candidate;
  }

  let detail;
  if (!newest) {
    detail = "no file under plans/ was written this turn";
  } else {
    let text = "";
    try {
      text = readFileSync(newest.absolutePath, "utf8");
    } catch {
      text = "";
    }
    if (TASK_ROW.test(text)) return { action: "allow", why: "plan-persisted", planPath: newest.absolutePath };
    detail = `plans/${newest.name} has no checkbox task rows (\`- [ ] N.\`)`;
  }

  if (turn.blockCount >= LIT_PLAN_MAX_BLOCKS) {
    if (turn.warned) return { action: "allow", why: "capped" };
    writeTurn(cwd, { ...turn, warned: true });
    return {
      action: "warn",
      why: "capped",
      systemMessage: `LitClaude lit-plan: no persisted plans/<slug>.md with task rows after ${LIT_PLAN_MAX_BLOCKS} blocks (${detail}); allowing the stop. Run scaffold-plan.mjs before /start-work.`,
    };
  }

  writeTurn(cwd, { ...turn, blockCount: turn.blockCount + 1, lastBlockAt: now });
  return { action: "block", reason: `${LIT_PLAN_BLOCK_REASON}: ${detail}` };
};
