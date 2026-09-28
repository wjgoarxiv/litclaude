// Durable iteration counter for the litgoal Stop-hook autoloop (the /goal-equivalent
// completion loop). The counter is the PRIMARY safety brake: the Stop hook blocks
// stopping only while it can durably increment this counter under the cap. If the
// counter cannot be read or written, the hook fails SAFE (allows stopping) rather
// than risk a runaway loop. State lives at `.litclaude/litgoal/autoloop.json`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendLitgoalLedger } from "./ledger.mjs";
import { litgoalGoalsPath, litgoalLedgerPath, litgoalLockDir, litgoalStateDir } from "./paths.mjs";
import { readLitgoalState, withLitgoalLock, writeLitgoalState } from "./state.mjs";

export const litgoalAutoloopPath = (cwd = process.cwd()) => join(litgoalStateDir(cwd), "autoloop.json");

// Default safety caps for the autoloop. Exposed for tests and the hook.
export const AUTOLOOP_MAX_BLOCKS = 8;
export const AUTOLOOP_MAX_MS = 30 * 60 * 1000;

export const readAutoloopState = (cwd = process.cwd()) => {
  const path = litgoalAutoloopPath(cwd);
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("corrupt autoloop state");
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || !Number.isInteger(parsed.blockCount)
    || parsed.blockCount < 0
    || !Number.isFinite(parsed.firstBlockAt)
    || parsed.firstBlockAt < 0
  ) {
    throw new Error("invalid autoloop state");
  }
  return parsed;
};

export const writeAutoloopState = (cwd, state) => {
  const dir = litgoalStateDir(cwd);
  mkdirSync(dir, { recursive: true });
  const target = litgoalAutoloopPath(cwd);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, target);
  return state;
};

// Reset the counter when a fresh autoloop goal is bound.
export const resetAutoloopState = (cwd, now = Date.now()) =>
  writeAutoloopState(cwd, { blockCount: 0, firstBlockAt: now });

export const completeAutoloopGoal = (cwd = process.cwd()) =>
  withLitgoalLock(litgoalLockDir(cwd), () => {
    const state = readLitgoalState(litgoalGoalsPath(cwd), null);
    if (!state) return { completed: false };

    let checkpoint = state.checkpoints?.find(({ generatedBy }) => generatedBy === "stop-hook-autoloop");
    const criteria = Array.isArray(state.criteria) ? state.criteria : [];
    const canComplete = state.status === "active"
      && state.autoloop === true
      && criteria.length > 0
      && criteria.every((criterion) => criterion?.status === "pass");
    if (!checkpoint && !canComplete) return { completed: false };

    if (!checkpoint) {
      const createdAt = new Date().toISOString();
      checkpoint = {
        status: "complete",
        note: "Autoloop completed after all success criteria passed.",
        createdAt,
        generatedBy: "stop-hook-autoloop",
        completionId: `stop-hook-autoloop:${state.createdAt ?? createdAt}`,
      };
      state.status = "complete";
      state.autoloop = false;
      state.checkpoints = [...(state.checkpoints ?? []), checkpoint];
      state.updatedAt = createdAt;
      writeLitgoalState(litgoalGoalsPath(cwd), state);
    }

    const ledgerPath = litgoalLedgerPath(cwd);
    const entries = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
    if (!entries.some((entry) => entry.event === "goal.completed" && entry.completionId === checkpoint.completionId)) {
      appendLitgoalLedger(ledgerPath, {
        event: "goal.completed",
        status: "complete",
        generatedBy: checkpoint.generatedBy,
        completionId: checkpoint.completionId,
      });
    }
    return { completed: true, checkpoint };
  });

// Pure decision function for the Stop hook — kept side-effect-free so it is unit
// testable without touching the filesystem or the process. Returns one of:
//   { action: "allow" }                          -> let the session stop
//   { action: "cap",   stopReason }              -> hard stop (continue:false)
//   { action: "block", reason, nextCount }       -> block stopping; caller persists nextCount
export const evaluateAutoloop = ({ env = {}, state, autoloopState, now = Date.now() } = {}) => {
  if (env.LITCLAUDE_GOAL_OFF === "1") return { action: "allow", why: "kill-switch" };
  if (!state || state.status !== "active" || state.autoloop !== true) {
    return { action: "allow", why: "no-active-autoloop-goal" };
  }
  const criteria = Array.isArray(state.criteria) ? state.criteria : [];
  const remaining = criteria.length === 0
    ? [{ id: "criteria-required", status: "missing", description: "no success criteria are defined" }]
    : criteria.filter((c) => !c || c.status !== "pass");
  if (criteria.length > 0 && remaining.length === 0) return { action: "allow", why: "all-criteria-pass" };

  const auto = autoloopState && typeof autoloopState === "object"
    ? autoloopState
    : { blockCount: 0, firstBlockAt: now };
  const blockCount = Number.isFinite(auto.blockCount) ? auto.blockCount : 0;
  const firstBlockAt = Number.isFinite(auto.firstBlockAt) ? auto.firstBlockAt : now;
  const elapsedMs = now - firstBlockAt;
  if (blockCount >= AUTOLOOP_MAX_BLOCKS || elapsedMs > AUTOLOOP_MAX_MS) {
    return {
      action: "cap",
      stopReason:
        `LitClaude autoloop safety cap reached (${blockCount} blocks / ${Math.round(elapsedMs / 1000)}s); ` +
        `goal left active. Escape: set LITCLAUDE_GOAL_OFF=1, or run ` +
        `'litclaude-ai litgoal checkpoint --status blocked'.`,
    };
  }

  const nextCount = blockCount + 1;
  const list = remaining
    .map((c) => c
      ? `  - ${c.id} [${c.status}]: ${c.description ?? c.scenario ?? ""}`
      : "  - criterion-invalid [missing]: invalid criterion")
    .join("\n");
  const reason =
    `LitClaude litgoal still active: "${state.objective}". ${remaining.length} criterion(s) not yet pass:\n${list}\n` +
    `Advance each: litclaude-ai litgoal record-evidence --criterion <id> --status pass --json '{"artifact":"..."}'. ` +
    `Autoloop block ${nextCount}/${AUTOLOOP_MAX_BLOCKS}. Escape: litclaude-ai litgoal checkpoint --status blocked, or LITCLAUDE_GOAL_OFF=1.`;
  return { action: "block", reason, nextCount, firstBlockAt };
};
