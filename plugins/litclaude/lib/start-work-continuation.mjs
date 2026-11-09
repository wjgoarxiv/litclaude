import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readPlanProgress } from "./start-work-lifecycle.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const normalizeSessionId = (sessionId) => {
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  return sessionId;
};

const activeWork = (state, sessionId) => {
  if (!state || typeof state !== "object" || !state.works || typeof state.works !== "object") return null;
  const active = typeof state.active_work_id === "string" ? state.works[state.active_work_id] : undefined;
  const normalizedSession = normalizeSessionId(sessionId);
  if (active?.status === "active") {
    if (state.schema_version === 3) {
      return normalizedSession && active.active_session_id === normalizedSession && active.session_ids?.includes(normalizedSession)
        ? active
        : null;
    }
    return active;
  }

  if (state.schema_version === 3) return null;
  if (!normalizedSession) return null;
  return Object.values(state.works).find((work) =>
    work?.status === "active" && Array.isArray(work.session_ids) && work.session_ids.includes(normalizedSession),
  ) ?? null;
};

const planTitle = (text) => {
  const match = /^#\s+(.+?)\s*$/mu.exec(text);
  return match?.[1] ?? "";
};

const sanitizePath = (path) => path.replaceAll("\\", "/");

const renderDirective = ({ planPath, ledgerPath, nextTask, worktreePath, planName, title }) => {
  const lines = [
    "LitClaude start-work continuation is active.",
    `Plan: ${sanitizePath(planPath)}`,
    `Ledger: ${sanitizePath(ledgerPath)}`,
    `Next top-level task: ${nextTask}`,
    "Before edits: reread the plan, ledger, Boulder state, and git status; continue with PIN -> RED -> GREEN -> VERIFY -> SURFACE -> REVIEW -> CLEAN -> RECORD.",
  ];
  if (worktreePath) lines.splice(3, 0, `Worktree: ${sanitizePath(worktreePath)}`);
  if (title) lines.splice(2, 0, `Title: ${title}`);
  if (planName) lines.splice(1, 0, `Work: ${planName}`);
  return lines.join("\n");
};

export const createStartWorkContinuation = (root, options = {}) => {
  const boulderPath = join(root, ".litclaude", "boulder.json");
  if (!existsSync(boulderPath)) return null;

  let state;
  try {
    state = readJson(boulderPath);
  } catch {
    return null;
  }

  const work = activeWork(state, options.sessionId);
  if (!work || typeof work.active_plan !== "string") return null;

  const planPath = resolve(root, work.active_plan);
  if (!existsSync(planPath)) return null;
  const planText = readFileSync(planPath, "utf8");
  const nextTask = readPlanProgress(planPath).next_task;
  if (!nextTask) return null;

  const ledgerPath = join(root, ".litclaude", "start-work", "ledger.jsonl");
  return renderDirective({
    planPath: work.active_plan,
    ledgerPath: existsSync(ledgerPath) ? ".litclaude/start-work/ledger.jsonl" : ".litclaude/start-work/ledger.jsonl",
    nextTask,
    worktreePath: typeof work.worktree_path === "string" ? work.worktree_path : "",
    planName: typeof work.plan_name === "string" ? work.plan_name : basename(planPath),
    title: planTitle(planText),
  });
};

export const runStartWorkContinuationCli = (defaultRoot, args, io = { stdout: process.stdout, stderr: process.stderr }) => {
  const outputJson = args.includes("--json");
  const rootIndex = args.indexOf("--root");
  const sessionIndex = args.indexOf("--session-id");
  const root = rootIndex >= 0 && typeof args[rootIndex + 1] === "string" ? resolve(args[rootIndex + 1]) : defaultRoot;
  const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : undefined;
  const directive = createStartWorkContinuation(root, { sessionId });

  if (outputJson) {
    io.stdout.write(`${JSON.stringify({ status: directive ? "active" : "idle", directive }, null, 2)}\n`);
  } else if (directive) {
    io.stdout.write(`${directive}\n`);
  } else {
    io.stdout.write("START_WORK_CONTINUATION_IDLE\n");
  }
  return 0;
};
