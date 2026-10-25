// The LIT card's workflow map follows the session's workflow stack
// (`.litclaude/workflow-stack/<session>.json`, lib/workflow-stack.mjs): where the session stands
// when the state files alone cannot say (a plan just saved, the task count between start-work's own
// progress records, review lanes starting and reporting, lit-loop's step, autoresearch's
// iteration, lit-crucible's verdict), and which work is paused under an interjected discipline.
// LitClaude's hooks keep it moving from what they already see, with no help from the model. The
// prompt and PreToolUse hooks push a frame when a discipline starts (a read-only one changes
// nothing); PreToolUse marks a review lane running when its reviewer is spawned; PostToolUse moves
// the top frame when the plan file is saved, a task is checked in the active plan, a lit-loop test
// is written (with Write or Edit or through the shell), made to pass, run or recorded, or a
// foreground reviewer reports; SubagentStop takes a background reviewer's verdict, which reaches the
// review frame even while a side frame is on top. `litclaude-ai workflow-stage` stays as the
// model's optional refinement. The card (lib/mod/state.mjs) reads the stack back. The hooks keep
// only which stage, which lane and how many; never a path, a command or a prompt.

import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { DISCIPLINE_ENTRY, STAGE_UNITS, VERDICT_STATES, WORKFLOW_FAMILIES, WORKFLOW_FRESH_MS, normalizeStage, reviewLaneOf } from "./mod/workflow.mjs";
import { resolveProjectStateRoot } from "./project-state-root.mjs";
import { appendLitgoalLedger } from "./litgoal/ledger.mjs";
import { litgoalGoalsPath, litgoalLedgerPath } from "./litgoal/paths.mjs";
import { readLitgoalState } from "./litgoal/state.mjs";
import { readPlanProgress } from "./start-work-lifecycle.mjs";
import { applyStackEvent, readStack, stackPath, writeStack } from "./workflow-stack.mjs";

const MAX_VERDICTS = 8;
// A prompt's plan, kept on the frame so asking for the same skill on another plan starts over.
const PROMPT_PLAN = /(?:^|[\s(`'"])(plans\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.md)(?=$|[\s)`'".,;:])/u;

export class WorkflowStageError extends Error {}

export const planRefOf = (prompt) => {
  const plan = PROMPT_PLAN.exec(typeof prompt === "string" ? prompt.slice(0, 16_384) : "")?.[1];
  return plan ? { plan } : undefined;
};

// A frame as the hooks' moves read it: a known family and stage, fresh, with the session's id.
const frameRecord = (frame, sessionId) => {
  if (!frame || !Object.hasOwn(WORKFLOW_FAMILIES, frame.family ?? "")) return null;
  const at = Date.parse(frame.at);
  if (!Number.isFinite(at) || Date.now() - at > WORKFLOW_FRESH_MS) return null;
  return { ...frame, sessionId, stage: normalizeStage(frame.family, frame.stage) };
};

// A pause, a side frame closed and a resume are part of the goal's story, so while a litgoal goal is
// open they go into its ledger: the skill, its stage and its count, never a prompt or a path.
const LEDGER_EVENTS = Object.freeze({ paused: "workflow.paused", resumed: "workflow.resumed", "side.done": "workflow.side.done" });
const OPEN_GOAL = new Set(["active", "review_blocked", "blocked", "needs_user_decision"]);

const logStackTransitions = (cwd, transitions) => {
  const logged = transitions.filter(({ type, skill }) => LEDGER_EVENTS[type] && skill);
  if (!logged.length) return;
  try {
    if (!OPEN_GOAL.has(readLitgoalState(litgoalGoalsPath(cwd), null)?.status)) return;
    for (const { type, skill, stage, n, total } of logged) appendLitgoalLedger(litgoalLedgerPath(cwd), { event: LEDGER_EVENTS[type], skill, stage, n, total });
  } catch {
    // An unreadable goal or ledger never stops the stack from moving.
  }
};

const applyAndWrite = (cwd, sessionId, event, now = new Date()) => {
  const { stack, transitions } = applyStackEvent(readStack(cwd, sessionId), event, now);
  writeStack(cwd, sessionId, stack);
  logStackTransitions(cwd, transitions);
  return { stack, transitions };
};

/**
 * Pushes, resumes or restarts the skill's frame on the session's stack. Returns the transitions
 * (`paused`, `resumed`, `side.done`, ...) so the caller can log them.
 */
export const startWorkflowStage = (cwd, { sessionId, skill, ref, restart = false, now = new Date() }) => {
  if (typeof sessionId !== "string" || !sessionId || typeof skill !== "string") return [];
  return applyAndWrite(cwd, sessionId, { type: "start", skill, ref, restart }, now).transitions;
};

/** `lit continue` on a side frame: closes it and resumes the paused spine (plans/lit-adhd.md D1). */
export const continueWorkflowStack = (cwd, { sessionId, now = new Date() }) => {
  if (typeof sessionId !== "string" || !sessionId) return { stack: null, transitions: [] };
  const result = applyStackEvent(readStack(cwd, sessionId), { type: "continue" }, now);
  if (!result.transitions.length) return result;
  writeStack(cwd, sessionId, result.stack);
  logStackTransitions(cwd, result.transitions);
  return result;
};

const countArg = (value, name) => {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 9999) throw new WorkflowStageError(`${name} takes a whole number from 0 to 9999`);
  return number;
};

/**
 * The session `litclaude-ai workflow-stage` writes for: `--session`, else the host's session id,
 * else the project's most recently written stack whose top frame is active and fresh, else
 * `unknown-session` (which the card also reads).
 */
export const resolveStageSession = (cwd, { session, env = process.env, now = Date.now() } = {}) => {
  if (typeof session === "string" && session.trim()) return session.trim();
  const host = env.CLAUDE_CODE_SESSION_ID;
  if (typeof host === "string" && host.trim()) return host.trim();
  const dir = join(stackPath(cwd, "x"), "..");
  let newest = null;
  try {
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".json")).slice(0, 200)) {
      const stat = lstatSync(join(dir, name));
      if (!stat.isFile() || now - stat.mtimeMs > WORKFLOW_FRESH_MS || (newest && newest.at >= stat.mtimeMs)) continue;
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (parsed?.frames?.at?.(-1)?.status === "active" && typeof parsed.sessionId === "string" && parsed.sessionId) newest = { id: parsed.sessionId, at: stat.mtimeMs };
    }
  } catch {
    // No stack directory yet.
  }
  return newest?.id ?? "unknown-session";
};

/**
 * The model's refinement: moves the session's top frame to `stage` of `family`, or opens a frame
 * when the stack is empty. Verdicts given for the same family and stage add to the ones already there.
 */
export const recordWorkflowStage = (cwd, { sessionId, family, stage, n, total, unit, verdicts = {}, now = new Date() }) => {
  if (!Object.hasOwn(WORKFLOW_FAMILIES, family ?? "")) throw new WorkflowStageError(`unknown family "${family}"; families: ${Object.keys(WORKFLOW_FAMILIES).join(", ")}`);
  if (!normalizeStage(family, stage)) throw new WorkflowStageError(`unknown ${family} stage "${stage}"; stages: ${WORKFLOW_FAMILIES[family].join(", ")}`);
  if (unit !== undefined && !STAGE_UNITS.includes(unit)) throw new WorkflowStageError(`unit takes one of: ${STAGE_UNITS.join(", ")}`);
  for (const [name, state] of Object.entries(verdicts)) {
    if (!/^[a-z][a-z0-9-]{0,23}$/u.test(name)) throw new WorkflowStageError(`verdict name "${name}" must be lowercase letters, digits and dashes`);
    if (!VERDICT_STATES.includes(state)) throw new WorkflowStageError(`verdict takes one of: ${VERDICT_STATES.join(", ")}`);
  }
  const session = resolveStageSession(cwd, { session: sessionId, now: now.getTime() });
  const top = readStack(cwd, session).frames.at(-1);
  const same = top?.family === family && normalizeStage(family, top.stage) === normalizeStage(family, stage);
  if (Object.keys({ ...(same ? top.verdicts ?? {} : {}), ...verdicts }).length > MAX_VERDICTS) throw new WorkflowStageError(`at most ${MAX_VERDICTS} verdicts per stage`);
  const event = { type: "record", family, stage: String(stage).trim(), n: countArg(n, "--n"), total: countArg(total, "--total"), unit, verdicts };
  const { stack } = applyAndWrite(cwd, session, event, now);
  return { sessionId: session, ...stack.frames.at(-1) };
};

// --- The hooks' own moves -------------------------------------------------------------------

// This session's top frame while it still says where the session is.
const currentRecord = (cwd, sessionId) => frameRecord(readStack(cwd, sessionId).frames.at(-1), sessionId);

// The session's nearest frame at `stage` of `family`, paused or not: where a background reviewer's
// verdict or a checked plan task belongs while a side frame is on top.
const nearestRecord = (cwd, sessionId, family, stage) => frameRecord(readStack(cwd, sessionId).frames.findLast((frame) => frame.family === family && normalizeStage(family, frame.stage) === stage), sessionId);

// Moves the session's top frame (or, with `nearest`, the nearest frame at that stage) and returns
// it; on an empty stack the move opens a frame, as the single record did.
const moveStage = (cwd, sessionId, fields, { nearest = false } = {}) => {
  const stack = readStack(cwd, sessionId);
  const event = stack.frames.length ? { type: "move", ...fields, scope: nearest ? "nearest" : "top" } : { type: "record", ...fields };
  const next = applyAndWrite(cwd, sessionId, event).stack;
  const frame = nearest ? next.frames.findLast((candidate) => candidate.family === fields.family && candidate.stage === fields.stage) : next.frames.at(-1);
  return frameRecord(frame, sessionId);
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

const markLane = (cwd, sessionId, top, lane, state) => {
  if (!lane) return null;
  const previous = top?.family === "main" && top.stage === "review" ? top : nearestRecord(cwd, sessionId, "main", "review") ?? top;
  const keep = previous?.family === "main" && previous.stage === "review";
  if (keep && previous.verdicts?.[lane] === state) return previous;
  // A reviewer that already reported is not set back to running by a second look.
  if (state === "running" && keep && ["pass", "fail"].includes(previous.verdicts?.[lane])) return previous;
  return moveStage(cwd, sessionId, { family: "main", stage: "review", verdicts: { [lane]: state } }, { nearest: keep });
};

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?)\/|[._-](?:test|spec)\.[A-Za-z0-9]+$/u;
const TEST_RUN = /(?:^|[\s;&|(])(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|bun\s+test|node\s+--test|npx\s+(?:vitest|jest)|vitest|jest|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test|make\s+test)\b/u;
const PLAN_SCAFFOLD = /scaffold-plan\.mjs/u;
const LITGOAL_EVIDENCE = /\blitgoal\s+record-evidence\b/u;

// lit-loop's steps as the hooks see them: a test written (or a failing run while the criterion is
// pinned), the code that makes it pass, the test run, the evidence recorded. Each move happens only
// from the step before it.
const LOOP_MOVES = Object.freeze([
  Object.freeze({ on: "test-edit", from: Object.freeze(["PIN", "RECORD"]), to: "RED" }),
  Object.freeze({ on: "test-fail", from: Object.freeze(["PIN"]), to: "RED" }),
  Object.freeze({ on: "source-edit", from: Object.freeze(["RED"]), to: "GREEN" }),
  Object.freeze({ on: "test-run", from: Object.freeze(["GREEN"]), to: "VERIFY" }),
  Object.freeze({ on: "evidence", from: Object.freeze(WORKFLOW_FAMILIES.loop), to: "RECORD" }),
]);

const moveLoop = (cwd, sessionId, previous, signal) => {
  if (previous?.family !== "loop") return null;
  const move = LOOP_MOVES.find(({ on, from }) => on === signal && from.includes(previous.stage));
  return move ? moveStage(cwd, sessionId, { family: "loop", stage: move.to }) : null;
};

// A test run's report of at least one failure: TAP (`not ok 2`, `# fail 1`) or a runner's summary
// (`1 failed`, `2 failing`).
const TEST_FAILED = /^\s*not ok \d|^# fail [1-9]|\b[1-9]\d* (?:failed|failing)\b/mu;
const shellOutput = (response) => (typeof response === "string" ? response
  : [response?.stdout, response?.stderr, resultText(response)].filter((text) => typeof text === "string").join("\n")).slice(0, 65_536);

// A heredoc's body is data, so the command is read without it; the line that opens it stays.
const withoutHeredocBodies = (command) => {
  const opener = /<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/u;
  let rest = command;
  let kept = "";
  for (let match = opener.exec(rest); match; match = opener.exec(rest)) {
    const lineEnd = rest.indexOf("\n", match.index);
    if (lineEnd < 0) break;
    kept += rest.slice(0, lineEnd + 1);
    const body = rest.slice(lineEnd + 1);
    const close = new RegExp(`^[\\t ]*${match[2]}[\\t ]*$`, "mu").exec(body);
    rest = close ? body.slice(close.index + close[0].length) : "";
  }
  return kept + rest;
};

/**
 * The files a shell command may write: `>` and `>>` targets, `tee` arguments and the files of an
 * in-place `sed`. Words are read with their quotes and heredoc bodies are skipped; the caller keeps
 * only targets that exist as files in the project, so a stray word never moves the map.
 */
export const shellWriteTargets = (command) => {
  const text = withoutHeredocBodies(typeof command === "string" ? command.slice(0, 65_536) : "");
  const segments = [[]];
  const targets = [];
  let word = null;
  let quote = null;
  let next = "word";
  const push = () => {
    if (word === null) return;
    if (next === "target") targets.push(word);
    else if (next === "word") segments.at(-1).push(word);
    next = "word";
    word = null;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      word ??= "";
    } else if (char === ">") {
      if (/^(?:\d|&)?$/u.test(word ?? "")) word = null;
      push();
      if (text[index + 1] === ">") index += 1;
      // `>&2` duplicates a descriptor; it names no file.
      next = text[index + 1] === "&" ? "skip" : "target";
      if (next === "skip") index += 1;
    } else if (char === "<") {
      push();
      next = "skip";
    } else if (/\s/u.test(char) || ";|&()".includes(char)) {
      push();
      if (!/[ \t]/u.test(char)) segments.push([]);
    } else {
      word = (word ?? "") + char;
    }
  }
  push();
  for (const words of segments) {
    const args = words.filter((item) => !/^\w+=/u.test(item));
    const [name, ...rest] = args;
    const files = rest.filter((item) => item && !item.startsWith("-"));
    if (name === "tee") targets.push(...files);
    if (name === "sed" && rest.some((item) => /^-[A-Za-z]*i|^--in-place/u.test(item))) targets.push(...files);
  }
  return targets.filter((target) => target && target !== "/dev/null");
};

// A shell write counts as code only for a source file; a log or report the command writes is not the fix.
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|lua|sh|zig|ex|exs|dart|scala)$/u;

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
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
 * With `failed` (PostToolUseFailure) only a Bash command's lit-loop moves count: its writes, and its
 * test run as a failing one, which never verifies.
 */
export const observeWorkflowPostTool = (cwd, input, { filePaths = [], lifecycleRoot = cwd, failed = false } = {}) => {
  const sessionId = typeof input?.session_id === "string" ? input.session_id : null;
  if (!sessionId) return null;
  if (failed && (input.tool_name !== "Bash" || input.is_interrupt === true)) return null;
  const previous = currentRecord(cwd, sessionId);
  const tool = input.tool_name;
  const planOpen = previous?.family === "main" && previous.stage === "plan" && previous.done !== true;
  if (tool === "Agent" || tool === "Task") {
    const verdict = verdictFrom(resultText(input.tool_response));
    return verdict ? markLane(cwd, sessionId, previous, laneFromTitle(input.tool_input?.prompt), verdict) : null;
  }
  if (tool === "Bash") {
    const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
    if (!failed && planOpen && PLAN_SCAFFOLD.test(command) && !/--check\b|--draft-only\b/u.test(command)) {
      return moveStage(cwd, sessionId, { family: "main", stage: "plan", done: true, ref: { plan: inProject } });
    }
    if (!failed && LITGOAL_EVIDENCE.test(command)) return moveLoop(cwd, sessionId, previous, "evidence");
    // Files the command wrote move the loop as a Write or Edit would; then its test run, where a
    // failing run while the criterion is pinned counts as the test that fails first.
    let current = previous;
    let moved = null;
    const step = (signal) => {
      const record = moveLoop(cwd, sessionId, current, signal);
      if (record) current = moved = record;
    };
    if (previous?.family === "loop") {
      const root = realOrResolved(resolveProjectStateRoot(cwd));
      for (const target of shellWriteTargets(command).slice(0, 20)) {
        const absolute = realOrResolved(resolve(cwd, target));
        const inProject = relative(root, absolute).split("\\").join("/");
        if (!isFile(absolute) || inProject.startsWith("..") || /^(?:\.litclaude|plans)\//u.test(inProject)) continue;
        if (TEST_PATH.test(inProject)) step("test-edit");
        else if (SOURCE_FILE.test(inProject)) step("source-edit");
      }
    }
    if (TEST_RUN.test(command)) {
      if (failed) step("test-fail");
      else step(current?.stage === "PIN" && TEST_FAILED.test(shellOutput(input.tool_response)) ? "test-fail" : "test-run");
    }
    return moved;
  }
  if (!filePaths.length) return null;
  const root = resolveProjectStateRoot(cwd);
  const workFrame = previous?.family === "main" ? previous : nearestRecord(cwd, sessionId, "main", "work");
  const work = !previous || workFrame ? activeWork(lifecycleRoot, sessionId) : null;
  let moved = null;
  for (const path of filePaths.slice(0, 20)) {
    const absolute = realOrResolved(resolve(cwd, path));
    if (work && absolute === realOrResolved(work.active_plan)) {
      const progress = readPlanProgress(work.active_plan);
      const nearest = workFrame !== previous && workFrame?.stage === "work";
      if (progress.total > 0) return moveStage(cwd, sessionId, { family: "main", stage: "work", n: progress.checked, total: progress.total, unit: "task" }, { nearest });
    }
    const inProject = relative(realOrResolved(root), absolute).split("\\").join("/");
    if (planOpen && /^plans\/[A-Za-z0-9._-]+\.md$/u.test(inProject)) return moveStage(cwd, sessionId, { family: "main", stage: "plan", done: true, ref: { plan: inProject } });
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

const USAGE = `Usage: litclaude-ai workflow-stage <family> <stage> [--n N] [--total M] [--unit ${STAGE_UNITS.join("|")}] [--verdict <name>=${VERDICT_STATES.join("|")}]... [--session <id>] [--json]
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
      else if (flag === "--session") options.sessionId = value;
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
