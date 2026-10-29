import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { requireStateDir, STATE_WRITE_FLAG } from "../project-state-root.mjs";
import { appendLitgoalLedger } from "./ledger.mjs";
import {
  litgoalBriefPath,
  litgoalGoalsPath,
  litgoalLedgerPath,
  litgoalLockDir,
  litgoalSessionArchivePath,
} from "./paths.mjs";
import { readLitgoalState, LitgoalStateError, withLitgoalLock, writeLitgoalState } from "./state.mjs";
import { resetAutoloopState } from "./autoloop.mjs";
import { NativeWorkerError, runNativeWorker } from "./native-worker.mjs";
import { fingerprintInputs, reopenStaleCriteria } from "./freshness.mjs";
import { addUnknown, openCriticalUnknowns, resolveUnknown } from "./unknowns.mjs";

const subcommands = [
  ["create-goals", "Create durable goal records; use --replace for a fresh cycle."],
  ["status", "Print the current litgoal status."],
  ["criteria", "List or update success criteria."],
  ["record-evidence", "Record evidence as JSON."],
  ["checkpoint", "Write a continuation checkpoint."],
  ["steer", "Record a steering decision."],
  ["record-review-blockers", "Record review blockers."],
  ["unknown", "Add, resolve or list unknowns (KK, KU, UK, UU)."],
  ["native-worker", "Launch a separate native /goal worker (dry-run by default)."],
];

const helpText = `Usage: litclaude-ai litgoal <command> [...args]
       litclaude-ai litgoal --help

Commands:
${subcommands.map(([name, description]) => `  ${name.padEnd(22)} ${description}`).join("\n")}
`;

class LitgoalCliError extends Error {
  constructor(message, status = 64) {
    super(message);
    this.name = "LitgoalCliError";
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();

const nonterminalGoalStatuses = new Set(["active", "review_blocked", "blocked", "needs_user_decision"]);
const reservedEvidenceKeys = new Set([
  "attempt",
  "status",
  "recordedAt",
  "createdAt",
  "updatedAt",
  "timestamp",
  "id",
  "evidenceId",
  "criterionId",
  "goalId",
  "sessionId",
  "event",
  "inputs",
]);

const hasFlag = (args, flag) => args.includes(flag);

const optionValue = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return "";
  return value;
};

// Every value given for a repeatable flag, comma lists split: `--inputs a,b --inputs c` -> [a, b, c].
const optionValues = (args, flag) =>
  args.flatMap((arg, index) => (arg === flag && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1].split(",") : []))
    .map((value) => value.trim())
    .filter(Boolean);

const requireOption = (args, flag, label = flag.slice(2)) => {
  const value = optionValue(args, flag);
  if (!value) throw new LitgoalCliError(`missing ${label}`);
  return value;
};

const parseEvidenceJson = (args) => {
  const index = args.indexOf("--json");
  if (index === -1) return {};
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return {};
  try {
    const evidence = JSON.parse(value);
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      throw new LitgoalCliError("litgoal evidence JSON must be an object");
    }
    const reservedKey = Object.keys(evidence).find((key) => reservedEvidenceKeys.has(key));
    if (reservedKey) throw new LitgoalCliError(`reserved evidence key is runtime-owned: ${reservedKey}`);
    return evidence;
  } catch (error) {
    if (error instanceof LitgoalCliError) throw error;
    throw new LitgoalCliError("invalid litgoal JSON");
  }
};

const emit = (io, payload, outputJson) => {
  if (outputJson) {
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  io.stdout.write(`${payload.message ?? JSON.stringify(payload)}\n`);
};

const emitError = (io, error, command, outputJson, status) => {
  const message = error.message || "litgoal runtime error";
  if (outputJson) {
    io.stdout.write(`${JSON.stringify(
      {
        ok: false,
        status: "error",
        command: command ?? null,
        error: {
          name: error.name || "Error",
          message,
          exitCode: status,
        },
      },
      null,
      2,
    )}\n`);
    return;
  }
  io.stderr.write(`${message}\n`);
};

const readState = (cwd) => readLitgoalState(litgoalGoalsPath(cwd), null);

const requireState = (cwd) => {
  const state = readState(cwd);
  if (!state) throw new LitgoalStateError("litgoal state not found");
  return state;
};

// Reopens stale passes and persists them; call inside the litgoal lock.
const persistStaleCriteria = (cwd, state) => {
  const reopened = reopenStaleCriteria(state);
  if (!reopened.length) return state;
  state.updatedAt = nowIso();
  writeLitgoalState(litgoalGoalsPath(cwd), state);
  for (const entry of reopened) appendLedger(cwd, entry);
  return state;
};

const currentStatus = (cwd) => withLitgoalLock(litgoalLockDir(cwd), () => persistStaleCriteria(cwd, requireState(cwd)));

const appendLedger = (cwd, entry) => appendLitgoalLedger(litgoalLedgerPath(cwd), entry);

const defaultCriterion = (brief) => ({
  id: "criterion-1",
  description: "Objective has observable verification evidence.",
  expectedEvidence: `Evidence that "${brief}" is complete.`,
  status: "pending",
  evidence: [],
});

const createGoals = (cwd, args) => {
  const brief = requireOption(args, "--brief", "brief").trim();
  if (!brief) throw new LitgoalCliError("missing brief");
  // Opt-in: `--autoloop` arms the LitClaude Stop hook to keep the session running
  // (a /goal-equivalent loop) until every criterion passes. Default off.
  const autoloop = hasFlag(args, "--autoloop");
  const replace = hasFlag(args, "--replace");
  const sessionId = optionValue(args, "--session-id") || undefined;
  return withLitgoalLock(litgoalLockDir(cwd), () => {
    const existing = readState(cwd);
    const sameSession = existing?.sessionId === sessionId;
    const sameActiveObjective = existing?.status === "active" && existing.objective === brief && sameSession;
    if (existing && nonterminalGoalStatuses.has(existing.status) && !replace && !sameActiveObjective) {
      const qualifier = existing.status === "active" ? "different active objective" : `${existing.status} goal`;
      throw new LitgoalStateError(`${qualifier} exists; use --replace to start a fresh cycle`);
    }
    if (existing?.objective === brief && sameSession && !replace) {
      return { ...existing, message: "The same objective already exists; no changes made." };
    }

    // Drift 6a — session scoping. A goal that is genuinely finished should not block the
    // next session's work, but it must never be silently discarded either: archive it
    // under sessions/<old-session-id>.json first, then open fresh state. Only a
    // TERMINAL goal qualifies; an active one still needs the explicit --replace.
    const terminalStatuses = ["complete", "abandoned"];
    const isFreshSession = Boolean(sessionId) && existing?.sessionId !== sessionId;
    const archivable = existing && isFreshSession && terminalStatuses.includes(existing.status);
    if (archivable) {
      writeLitgoalState(litgoalSessionArchivePath(cwd, existing.sessionId ?? "unknown"), existing);
      appendLedger(cwd, {
        event: "session.archived",
        sessionId: existing.sessionId ?? null,
        objective: existing.objective,
        status: existing.status,
        archivePath: litgoalSessionArchivePath(cwd, existing.sessionId ?? "unknown"),
      });
    }

    const timestamp = nowIso();
    const state = {
      version: 1,
      objective: brief,
      status: "active",
      autoloop,
      ...(sessionId ? { sessionId } : {}),
      criteria: [defaultCriterion(brief)],
      blockers: [],
      steering: [],
      checkpoints: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    requireStateDir(dirname(litgoalBriefPath(cwd)));
    writeFileSync(litgoalBriefPath(cwd), `${brief}\n`, { flag: STATE_WRITE_FLAG });
    writeLitgoalState(litgoalGoalsPath(cwd), state);
    // Fresh autoloop run -> reset the durable iteration counter so prior caps don't carry over.
    if (autoloop) resetAutoloopState(cwd, Date.parse(timestamp) || Date.now());
    appendLedger(cwd, {
      event: "goal.created",
      objective: brief,
      status: state.status,
      autoloop,
      replaced: Boolean(existing && replace),
      criteria: state.criteria.map(({ id, status }) => ({ id, status })),
    });
    return state;
  });
};

const listCriteria = (cwd) => {
  const state = requireState(cwd);
  return { criteria: state.criteria ?? [] };
};

const updateCriterionWithEvidence = (cwd, args) => {
  const evidence = parseEvidenceJson(args);
  return withLitgoalLock(litgoalLockDir(cwd), () => {
    const criterionId = requireOption(args, "--criterion", "criterion");
    const status = optionValue(args, "--status") || "pass";
    if (!["pass", "fail", "blocked"].includes(status)) {
      throw new LitgoalCliError("invalid evidence status");
    }
    const state = requireState(cwd);
    const criterion = state.criteria?.find(({ id }) => id === criterionId);
    if (!criterion) throw new LitgoalStateError("unknown criterion");

    // Drift 6a — --force is reserved for exactly this: touching a goal that already
    // reported completion. Without it a late write would quietly rewrite a finished
    // result, which is the failure mode the flag exists to prevent.
    if (state.status === "complete" && !hasFlag(args, "--force")) {
      throw new LitgoalStateError("goal is already complete; pass --force to record further evidence against it");
    }
    if (state.status === "complete" && status !== "pass") {
      throw new LitgoalStateError("complete goal rejects non-pass evidence; open a new or explicitly reopened goal first");
    }

    const inputs = fingerprintInputs(cwd, [
      ...optionValues(args, "--inputs").map((path) => ({ path, role: "input" })),
      ...optionValues(args, "--reviewed").map((path) => ({ path, role: "reviewed" })),
    ]);

    // Drift 6e — evidence is attempt-scoped and append-only. A retry adds attempt N+1;
    // it never replaces what an earlier attempt recorded.
    const priorEvidence = criterion.evidence ?? [];
    const attempt = priorEvidence.length + 1;
    const record = {
      ...evidence,
      attempt,
      status,
      ...(inputs.length ? { inputs } : {}),
      recordedAt: nowIso(),
    };
    criterion.status = status;
    delete criterion.staleInputs;
    criterion.attempts = attempt;
    criterion.evidence = [...priorEvidence, record];
    state.updatedAt = record.recordedAt;
    writeLitgoalState(litgoalGoalsPath(cwd), state);
    appendLedger(cwd, {
      event: "evidence.recorded",
      criterionId,
      attempt,
      status,
      evidence,
      ...(inputs.length ? { inputs } : {}),
    });
    return { criterion };
  });
};

const checkpoint = (cwd, args) =>
  withLitgoalLock(litgoalLockDir(cwd), () => {
    const state = requireState(cwd);
    const status = optionValue(args, "--status") || "active";
    // Drift 6b — the enum carries the two states the loop could previously not express:
    // review_blocked (a reviewer, not the work, is the blocker) and needs_user_decision
    // (progress is possible but a human has to choose). Collapsing either into "blocked"
    // loses the reason, and the reason is what decides the next action.
    if (!["active", "complete", "blocked", "review_blocked", "needs_user_decision", "abandoned"].includes(status)) {
      throw new LitgoalCliError("invalid checkpoint status");
    }
    if (status === "complete") persistStaleCriteria(cwd, state);
    const criteria = state.criteria ?? [];
    if (status === "complete" && criteria.length === 0) {
      throw new LitgoalStateError("non-empty criteria must pass before completion");
    }
    if (status === "complete" && !criteria.every((criterion) => criterion.status === "pass")) {
      throw new LitgoalStateError("criteria must pass before completion");
    }
    const critical = status === "complete" ? openCriticalUnknowns(state) : [];
    if (critical.length) {
      throw new LitgoalStateError(`open critical unknowns block completion: ${critical.map(({ id }) => id).join(", ")}`);
    }

    const record = {
      status,
      note: optionValue(args, "--note") || "",
      createdAt: nowIso(),
    };
    state.status = status;
    state.checkpoints = [...(state.checkpoints ?? []), record];
    state.updatedAt = record.createdAt;
    writeLitgoalState(litgoalGoalsPath(cwd), state);
    appendLedger(cwd, { event: "checkpoint.recorded", ...record });
    return { status: state.status, checkpoint: record };
  });

const steer = (cwd, args) =>
  withLitgoalLock(litgoalLockDir(cwd), () => {
    const state = requireState(cwd);
    const kind = requireOption(args, "--kind", "kind");
    if (!["scope", "priority", "blocker", "quality", "handoff"].includes(kind)) {
      throw new LitgoalCliError("invalid steering kind");
    }
    // Drift 6d — steering is a structured decision, not a free-text note. A steer without
    // the evidence that motivated it and the rationale for it is unauditable later, so
    // both are required again rather than optional.
    const record = {
      kind,
      note: requireOption(args, "--note", "note"),
      evidence: requireOption(args, "--evidence", "evidence"),
      rationale: requireOption(args, "--rationale", "rationale"),
      createdAt: nowIso(),
    };
    state.steering = [...(state.steering ?? []), record];
    state.updatedAt = record.createdAt;
    writeLitgoalState(litgoalGoalsPath(cwd), state);
    appendLedger(cwd, { event: "steering.recorded", ...record });
    return record;
  });

const recordReviewBlockers = (cwd, args) =>
  withLitgoalLock(litgoalLockDir(cwd), () => {
    const state = requireState(cwd);
    const blocker = optionValue(args, "--blocker") || optionValue(args, "--note") || "review blocker recorded";
    const record = {
      blocker,
      status: optionValue(args, "--status") || "blocked",
      createdAt: nowIso(),
    };
    state.blockers = [...(state.blockers ?? []), record];
    // Drift 6b — this used to append a blocker and leave state.status untouched, so a
    // goal held up by review still read as "active" and nothing downstream could tell.
    // A recorded review blocker now moves the goal into review_blocked, which is
    // deliberately distinct from a plain "blocked".
    state.status = "review_blocked";
    state.updatedAt = record.createdAt;
    writeLitgoalState(litgoalGoalsPath(cwd), state);
    appendLedger(cwd, { event: "review_blocker.recorded", goalStatus: state.status, ...record });
    return { ...record, goalStatus: state.status };
  });

const unknown = (cwd, args) => {
  const [action] = args;
  if (action === "list") return { unknowns: requireState(cwd).unknowns ?? [] };
  if (action !== "add" && action !== "resolve") throw new LitgoalCliError("usage: litgoal unknown add|resolve|list");
  return withLitgoalLock(litgoalLockDir(cwd), () => {
    const state = requireState(cwd);
    const now = nowIso();
    const record = action === "add"
      ? addUnknown(state, {
        kind: (optionValue(args, "--kind") || "").toUpperCase(),
        text: optionValue(args, "--text"),
        source: optionValue(args, "--source"),
        probe: optionValue(args, "--probe"),
        critical: hasFlag(args, "--critical"),
        now,
      })
      : resolveUnknown(state, { id: requireOption(args, "--id", "id"), evidence: optionValue(args, "--evidence"), now });
    state.updatedAt = now;
    writeLitgoalState(litgoalGoalsPath(cwd), state);
    appendLedger(cwd, { event: action === "add" ? "unknown.added" : "unknown.resolved", ...record });
    return { unknown: record };
  });
};

const runCommand = (cwd, command, args) => {
  switch (command) {
    case "create-goals":
      return createGoals(cwd, args);
    case "status":
      return currentStatus(cwd);
    case "criteria":
      return listCriteria(cwd);
    case "record-evidence":
      return updateCriterionWithEvidence(cwd, args);
    case "checkpoint":
      return checkpoint(cwd, args);
    case "steer":
      return steer(cwd, args);
    case "record-review-blockers":
      return recordReviewBlockers(cwd, args);
    case "unknown":
      return unknown(cwd, args);
    case "native-worker":
      return runNativeWorker(args, { cwd });
    default:
      throw new LitgoalCliError(`Unknown litgoal command: ${command}`);
  }
};

export const runLitgoalCli = (argv, io = { stdout: process.stdout, stderr: process.stderr }, cwd = process.cwd()) => {
  const [command, ...rest] = argv;
  const outputJson = hasFlag(rest, "--json");

  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText);
    return 0;
  }

  if (!subcommands.some(([name]) => name === command)) {
    const error = new LitgoalCliError(`Unknown litgoal command: ${command}`);
    emitError(io, error, command, outputJson, error.status);
    return error.status;
  }

  try {
    const result = runCommand(cwd, command, rest);
    emit(io, result, outputJson);
    if (result?.status === "failed") return result.exitCode || 1;
    return 0;
  } catch (error) {
    if (error instanceof LitgoalCliError || error instanceof LitgoalStateError || error instanceof NativeWorkerError) {
      emitError(io, error, command, outputJson, error.status);
      return error.status;
    }
    emitError(io, { name: "LitgoalRuntimeError", message: "litgoal runtime error" }, command, outputJson, 1);
    return 1;
  }
};
