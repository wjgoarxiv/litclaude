// The LIT card's stage record, `.litclaude/workflow-stage.json`: where the session stands when the
// state files alone cannot say (a plan just saved, the task count between start-work's own
// progress records, review lanes starting and reporting, lit-loop's step, autoresearch's
// iteration, lit-crucible's verdict). LitClaude's hooks keep it moving from what they already
// see, with no help from the model. The prompt and PreToolUse hooks start it when one of
// STAGE_RECORD_SKILLS starts and clear it for any other discipline; PreToolUse marks a review
// lane running when its reviewer is spawned; PostToolUse moves it when the plan file is saved, a
// task is checked in the active plan, a lit-loop test is written, made to pass, run or recorded,
// or a foreground reviewer reports; SubagentStop takes a background reviewer's verdict.
// `litclaude-ai workflow-stage` stays as the model's optional refinement. The card
// (lib/mod/state.mjs) reads the record back. One small file, written whole, its fields checked
// against the same tables the card draws from (lib/mod/workflow.mjs). The hooks keep only which
// stage, which lane and how many; never a path, a command or a prompt.

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { DISCIPLINE_ENTRY, STAGE_UNITS, VERDICT_STATES, WORKFLOW_FAMILIES, WORKFLOW_FRESH_MS, normalizeStage, reviewLaneOf } from "./mod/workflow.mjs";
import { ensureStateDirIgnored, resolveProjectStateRoot } from "./project-state-root.mjs";
import { readPlanProgress } from "./start-work-lifecycle.mjs";

// The skills whose next move only this record can carry: the plan's save, review lanes, lit-loop
// steps, autoresearch iterations, the crucible verdict. Every other skill's place comes from the
// state files, so its start clears the record instead of writing one.
export const STAGE_RECORD_SKILLS = Object.freeze(["lit-plan", "review-work", "lit-loop", "autoresearch", "lit-crucible"]);
const MAX_VERDICTS = 8;

export class WorkflowStageError extends Error {}

export const workflowStagePath = (cwd) => join(resolveProjectStateRoot(cwd), ".litclaude", "workflow-stage.json");

const readRecord = (path) => {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeRecord = (path, record) => {
  mkdirSync(join(path, ".."), { recursive: true });
  ensureStateDirIgnored(path);
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(record)}\n`);
  renameSync(staging, path);
  return record;
};

/**
 * Starts the record at the skill's first stage. Any other discipline removes it, so a record from
 * an earlier review or loop never outlasts the work that came after it.
 */
export const startWorkflowStage = (cwd, { sessionId, skill, now = new Date() }) => {
  if (!STAGE_RECORD_SKILLS.includes(skill)) {
    rmSync(workflowStagePath(cwd), { force: true });
    return null;
  }
  const { family, stage } = DISCIPLINE_ENTRY[skill];
  return writeRecord(workflowStagePath(cwd), {
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    skill,
    family,
    stage,
    verdicts: {},
    at: now.toISOString(),
  });
};

const countArg = (value, name) => {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 9999) throw new WorkflowStageError(`${name} takes a whole number from 0 to 9999`);
  return number;
};

/**
 * Moves the record to `stage` of `family`. Verdicts given for the same family and stage add to the
 * ones already there, so review lanes report one at a time; the session is the one the hook
 * started the record for.
 */
export const recordWorkflowStage = (cwd, { family, stage, n, total, unit, verdicts = {}, now = new Date() }) => {
  if (!Object.hasOwn(WORKFLOW_FAMILIES, family ?? "")) throw new WorkflowStageError(`unknown family "${family}"; families: ${Object.keys(WORKFLOW_FAMILIES).join(", ")}`);
  const normalized = normalizeStage(family, stage);
  if (!normalized) throw new WorkflowStageError(`unknown ${family} stage "${stage}"; stages: ${WORKFLOW_FAMILIES[family].join(", ")}`);
  if (unit !== undefined && !STAGE_UNITS.includes(unit)) throw new WorkflowStageError(`unit takes one of: ${STAGE_UNITS.join(", ")}`);
  for (const [name, state] of Object.entries(verdicts)) {
    if (!/^[a-z][a-z0-9-]{0,23}$/u.test(name)) throw new WorkflowStageError(`verdict name "${name}" must be lowercase letters, digits and dashes`);
    if (!VERDICT_STATES.includes(state)) throw new WorkflowStageError(`verdict takes one of: ${VERDICT_STATES.join(", ")}`);
  }
  const path = workflowStagePath(cwd);
  const previous = readRecord(path);
  const same = previous?.family === family && normalizeStage(family, previous.stage) === normalized;
  const merged = { ...(same && previous.verdicts && typeof previous.verdicts === "object" ? previous.verdicts : {}), ...verdicts };
  if (Object.keys(merged).length > MAX_VERDICTS) throw new WorkflowStageError(`at most ${MAX_VERDICTS} verdicts per stage`);
  const record = {
    sessionId: typeof previous?.sessionId === "string" ? previous.sessionId : null,
    skill: typeof previous?.skill === "string" ? previous.skill : null,
    family,
    stage: String(stage).trim(),
    verdicts: merged,
    at: now.toISOString(),
  };
  const counted = { n: countArg(n, "--n"), total: countArg(total, "--total") };
  for (const [key, value] of Object.entries(counted)) if (value !== undefined) record[key] = value;
  if (unit !== undefined) record.unit = unit;
  return writeRecord(path, record);
};

// --- The hooks' own moves -------------------------------------------------------------------

// This session's record while it still says where the session is.
const currentRecord = (cwd, sessionId) => {
  const record = readRecord(workflowStagePath(cwd));
  if (!record || record.sessionId !== sessionId || !Object.hasOwn(WORKFLOW_FAMILIES, record.family ?? "")) return null;
  const at = Date.parse(record.at);
  if (!Number.isFinite(at) || Date.now() - at > WORKFLOW_FRESH_MS) return null;
  return { ...record, stage: normalizeStage(record.family, record.stage) };
};

// Writes the session's record at `stage`; verdicts add to those of the same stage.
const moveStage = (cwd, sessionId, previous, { family, stage, n, total, unit, done, verdicts = {} }) => {
  const same = previous?.family === family && previous.stage === stage;
  const record = {
    sessionId,
    skill: typeof previous?.skill === "string" ? previous.skill : null,
    family,
    stage,
    verdicts: { ...(same && previous.verdicts && typeof previous.verdicts === "object" ? previous.verdicts : {}), ...verdicts },
    at: new Date().toISOString(),
  };
  if (Object.keys(record.verdicts).length > MAX_VERDICTS) return previous;
  if (Number.isInteger(n) && Number.isInteger(total)) Object.assign(record, { n, total, unit });
  if (done) record.done = true;
  return writeRecord(workflowStagePath(cwd), record);
};

// review-work titles every lane prompt `Review lane: <lane>.`; the card's lane comes from that title.
const LANE_TITLE = /(?:^|\n)\s*(?:#+\s*)?Review lane:\s*([^\n]{1,120})/iu;
// A lane's report: `verdict: PASS`, with the schema's `PASS | FAIL` placeholder never counted.
const VERDICT_LINE = /(?:^|\n)[\s*_`>-]*verdict[*_`]*\s*:\s*[*_`]*\s*(PASS|FAIL|BLOCKED)\b(?!\s*\|)/iu;
const VERDICT_OF = Object.freeze({ PASS: "pass", FAIL: "fail", BLOCKED: "pending" });

const laneFromTitle = (text) => {
  const match = LANE_TITLE.exec(typeof text === "string" ? text.slice(0, 16_384) : "");
  return match ? reviewLaneOf(match[1]) : null;
};

const verdictFrom = (text) => {
  const match = VERDICT_LINE.exec(typeof text === "string" ? text.slice(0, 65_536) : "");
  return match ? VERDICT_OF[match[1].toUpperCase()] : null;
};

// A tool result's text, however the host shapes it: a string, `{ content: [...] }` or an array.
const resultText = (value, depth = 0) => {
  if (typeof value === "string") return value;
  if (depth > 3 || !value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map((item) => resultText(item, depth + 1)).join("\n");
  return ["text", "content", "result", "output"].map((key) => resultText(value[key], depth + 1)).join("\n");
};

const markLane = (cwd, sessionId, previous, lane, state) => {
  if (!lane) return null;
  const keep = previous?.family === "main" && previous.stage === "review";
  if (keep && previous.verdicts?.[lane] === state) return previous;
  // A reviewer that already reported is not set back to running by a second look.
  if (state === "running" && keep && ["pass", "fail"].includes(previous.verdicts?.[lane])) return previous;
  return moveStage(cwd, sessionId, previous, { family: "main", stage: "review", verdicts: { [lane]: state } });
};

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?)\/|[._-](?:test|spec)\.[A-Za-z0-9]+$/u;
const TEST_RUN = /(?:^|[\s;&|(])(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|bun\s+test|node\s+--test|npx\s+(?:vitest|jest)|vitest|jest|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test|make\s+test)\b/u;
const PLAN_SCAFFOLD = /scaffold-plan\.mjs/u;
const LITGOAL_EVIDENCE = /\blitgoal\s+record-evidence\b/u;

// lit-loop's steps as the hooks see them: a test written, the code that makes it pass, the test
// run, the evidence recorded. Each move happens only from the step before it.
const LOOP_MOVES = Object.freeze([
  Object.freeze({ on: "test-edit", from: Object.freeze(["PIN", "RECORD"]), to: "RED" }),
  Object.freeze({ on: "source-edit", from: Object.freeze(["RED"]), to: "GREEN" }),
  Object.freeze({ on: "test-run", from: Object.freeze(["GREEN"]), to: "VERIFY" }),
  Object.freeze({ on: "evidence", from: Object.freeze(WORKFLOW_FAMILIES.loop), to: "RECORD" }),
]);

const moveLoop = (cwd, sessionId, previous, signal) => {
  if (previous?.family !== "loop") return null;
  const move = LOOP_MOVES.find(({ on, from }) => on === signal && from.includes(previous.stage));
  return move ? moveStage(cwd, sessionId, previous, { family: "loop", stage: move.to }) : null;
};

const realOrResolved = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

// The session's active start-work, read as JSON from boulder.json without the lifecycle lock; the
// lifecycle writes it whole, so a read sees one version or the other.
const activeWork = (lifecycleRoot, sessionId) => {
  try {
    const path = join(lifecycleRoot, ".litclaude", "boulder.json");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
    const state = JSON.parse(readFileSync(path, "utf8"));
    const work = state?.active_work_id ? state.works?.[state.active_work_id] : null;
    if (!work || work.status !== "active" || typeof work.active_plan !== "string") return null;
    const owns = work.active_session_id === sessionId || (Array.isArray(work.session_ids) && work.session_ids.includes(sessionId));
    return owns ? work : null;
  } catch {
    return null;
  }
};

/** PreToolUse: a workflow skill starts the record; a review lane's reviewer marks its lane running. */
export const observeWorkflowPreTool = (cwd, input) => {
  const sessionId = typeof input?.session_id === "string" ? input.session_id : null;
  if (!sessionId) return null;
  if (input.tool_name === "Skill") {
    const skill = String(input.tool_input?.skill ?? "").replace(/^litclaude:/u, "");
    return Object.hasOwn(DISCIPLINE_ENTRY, skill) ? startWorkflowStage(cwd, { sessionId, skill }) : null;
  }
  if (input.tool_name === "Agent" || input.tool_name === "Task") {
    const previous = currentRecord(cwd, sessionId);
    const atReview = previous?.family === "main" && previous.stage === "review";
    const lane = laneFromTitle(input.tool_input?.prompt) ?? (atReview ? reviewLaneOf(input.tool_input?.description) : null);
    return markLane(cwd, sessionId, previous, lane, "running");
  }
  return null;
};

/**
 * PostToolUse: the plan saved, a task checked in the active plan, a lit-loop step, a foreground
 * reviewer's verdict. `filePaths` are the paths the tool wrote (lib/mutated-file-paths.mjs).
 */
export const observeWorkflowPostTool = (cwd, input, { filePaths = [], lifecycleRoot = cwd } = {}) => {
  const sessionId = typeof input?.session_id === "string" ? input.session_id : null;
  if (!sessionId) return null;
  const previous = currentRecord(cwd, sessionId);
  const tool = input.tool_name;
  const planOpen = previous?.family === "main" && previous.stage === "plan" && previous.done !== true;
  if (tool === "Agent" || tool === "Task") {
    const verdict = verdictFrom(resultText(input.tool_response));
    return verdict ? markLane(cwd, sessionId, previous, laneFromTitle(input.tool_input?.prompt), verdict) : null;
  }
  if (tool === "Bash") {
    const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
    if (planOpen && PLAN_SCAFFOLD.test(command) && !/--check\b|--draft-only\b/u.test(command)) {
      return moveStage(cwd, sessionId, previous, { family: "main", stage: "plan", done: true });
    }
    if (LITGOAL_EVIDENCE.test(command)) return moveLoop(cwd, sessionId, previous, "evidence");
    if (TEST_RUN.test(command)) return moveLoop(cwd, sessionId, previous, "test-run");
    return null;
  }
  if (!filePaths.length) return null;
  const root = resolveProjectStateRoot(cwd);
  const work = !previous || previous.family === "main" ? activeWork(lifecycleRoot, sessionId) : null;
  let moved = null;
  for (const path of filePaths.slice(0, 20)) {
    const absolute = realOrResolved(resolve(cwd, path));
    if (work && absolute === realOrResolved(work.active_plan)) {
      const progress = readPlanProgress(work.active_plan);
      if (progress.total > 0) return moveStage(cwd, sessionId, previous, { family: "main", stage: "work", n: progress.checked, total: progress.total, unit: "task" });
    }
    const inProject = relative(realOrResolved(root), absolute).split("\\").join("/");
    if (planOpen && /^plans\/[A-Za-z0-9._-]+\.md$/u.test(inProject)) return moveStage(cwd, sessionId, previous, { family: "main", stage: "plan", done: true });
    if (inProject.startsWith("..") || /^(?:\.litclaude|plans)\//u.test(inProject)) continue;
    moved = moveLoop(cwd, sessionId, moved ?? previous, TEST_PATH.test(inProject) ? "test-edit" : "source-edit") ?? moved;
  }
  return moved;
};

// The prompt a reviewer was given: the first user message in the head of its transcript.
const transcriptPrompt = (path, bytes = 65_536) => {
  if (typeof path !== "string" || !path.endsWith(".jsonl")) return "";
  let fd;
  let head = "";
  try {
    if (!lstatSync(path).isFile()) return "";
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(bytes);
    head = buffer.subarray(0, readSync(fd, buffer, 0, bytes, 0)).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  for (const line of head.split("\n").slice(0, 20)) {
    try {
      const entry = JSON.parse(line);
      const message = entry?.message;
      if (entry?.type === "user" || message?.role === "user") return resultText(message?.content ?? message);
    } catch {
      // A line cut off at the end of the head, or not an entry at all.
    }
  }
  return "";
};

/** SubagentStop: a reviewer's verdict, from its last message, for the lane its prompt named. */
export const observeWorkflowSubagentStop = (cwd, input) => {
  const sessionId = typeof input?.session_id === "string" ? input.session_id : null;
  const verdict = verdictFrom(input?.last_assistant_message);
  if (!sessionId || !verdict) return null;
  const lane = laneFromTitle(transcriptPrompt(input.agent_transcript_path));
  return lane ? markLane(cwd, sessionId, currentRecord(cwd, sessionId), lane, verdict) : null;
};

const USAGE = `Usage: litclaude-ai workflow-stage <family> <stage> [--n N] [--total M] [--unit ${STAGE_UNITS.join("|")}] [--verdict <name>=${VERDICT_STATES.join("|")}]... [--json]
Families and stages: ${Object.entries(WORKFLOW_FAMILIES).map(([family, stages]) => `${family}: ${stages.join(" ")}`).join("; ")}
(lit-loop's SURFACE and CLEAN steps are accepted and shown on VERIFY and RECORD.)`;

/** `litclaude-ai workflow-stage`: returns the exit code. */
export const runWorkflowStageCli = (args, cwd = process.cwd(), out = process.stdout, err = process.stderr) => {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    (args.length === 0 ? err : out).write(`${USAGE}\n`);
    return args.length === 0 ? 64 : 0;
  }
  const [family, stage, ...rest] = args;
  const options = { family, stage };
  const verdicts = [];
  let json = false;
  try {
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      if (flag === "--json") {
        json = true;
        continue;
      }
      const value = rest[index + 1];
      if (value === undefined) throw new WorkflowStageError(`${flag} needs a value`);
      index += 1;
      if (flag === "--n") options.n = value;
      else if (flag === "--total") options.total = value;
      else if (flag === "--unit") options.unit = value;
      else if (flag === "--verdict") verdicts.push(value.split("="));
      else throw new WorkflowStageError(`unknown option ${flag}`);
    }
    const record = recordWorkflowStage(cwd, { ...options, verdicts: Object.fromEntries(verdicts) });
    out.write(json ? `${JSON.stringify({ ok: true, record })}\n` : `WORKFLOW_STAGE: ${record.family} ${record.stage}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof WorkflowStageError)) throw error;
    err.write(`${error.message}\n${USAGE}\n`);
    return 64;
  }
};
