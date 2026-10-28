// Read-only view of LitClaude's own state (and the Git HEAD it works on) for the LIT band. Nothing here writes, spawns, fetches or
// follows a link: every read goes through an injected `io` ({ stat, read }) that the mod backs with
// `$.fs.stat(path, { resolve: true })` and `$.fs.read`, and the tests back with a map. A file is read
// only when it is a regular file, under its size cap, not itself a link, and lands exactly where its
// spelled path says once every link is resolved, so a symlinked `.litclaude` or state file is skipped.
//
// The workflow map's sources are read the same way: the newest deep-interview state, the newest
// lit-plan draft, the newest litresearch session folder and the stage record. A folder is listed
// through `io.list` when the host offers it; without it the map falls back to the other sources.
//
// The two roots mirror the hook: `.litclaude` sits at the outermost Git root (project-state-root.mjs),
// while boulder.json is found the way `lifecycleRootFor` in bin/litclaude-hook.js finds it, walking up
// from the working directory and across a linked Git worktree to its main checkout.

import { parsePlanTaskRows } from "../plan-task-rows.mjs";
import { parseStageRecord } from "./workflow.mjs";

export const STATE_CAPS = Object.freeze({
  boulder: 2 * 1024 * 1024,
  goals: 512 * 1024,
  ledger: 512 * 1024,
  small: 64 * 1024,
  gitMarker: 4096,
});

// Mirrors PROJECT_MARKERS in rules/constants.mjs, the fallback when no Git root exists.
const PROJECT_MARKERS = Object.freeze([".git", "pnpm-workspace.yaml", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", ".venv"]);
export const AUTOLOOP_LIMITS = Object.freeze({ blocks: 8, ms: 30 * 60 * 1000 });
export const GATE_LIMITS = Object.freeze({ litPlan: 2, probe: 2, motion: 2 });

const splitPath = (path) => String(path).replaceAll("\\", "/").split("/").filter((part, index) => part !== "" || index === 0);

export const normalizePath = (path) => {
  const parts = [];
  const raw = String(path).replaceAll("\\", "/");
  const absolute = raw.startsWith("/");
  const drive = /^[A-Za-z]:/u.exec(raw)?.[0] ?? "";
  for (const part of raw.slice(drive.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${drive}${absolute || drive ? "/" : ""}${parts.join("/")}`;
};

export const joinPath = (...parts) => normalizePath(parts.filter((part) => part !== "").join("/"));

export const parentOf = (path) => {
  const normalized = normalizePath(path);
  const cut = normalized.lastIndexOf("/");
  if (cut <= 0) return normalized.slice(0, cut + 1) || normalized;
  const parent = normalized.slice(0, cut);
  return /^[A-Za-z]:$/u.test(parent) ? `${parent}/` : parent;
};

const isAbsolute = (path) => /^(?:[A-Za-z]:)?[\\/]/u.test(String(path));
export const resolvePath = (base, path) => (isAbsolute(path) ? normalizePath(path) : joinPath(base, path));

const ancestors = (start) => {
  const list = [];
  let current = normalizePath(start);
  for (;;) {
    list.push(current);
    const parent = parentOf(current);
    if (parent === current) return list;
    current = parent;
  }
};

const statOf = async (io, path) => {
  try {
    return (await io.stat(path)) ?? null;
  } catch {
    return null;
  }
};

export const resolveStateRoot = async (io, cwd) => {
  const chain = ancestors(cwd);
  let outermostGit = null;
  for (const directory of chain) if (await statOf(io, joinPath(directory, ".git"))) outermostGit = directory;
  if (outermostGit) return outermostGit;
  for (const directory of chain) {
    for (const marker of PROJECT_MARKERS) if (await statOf(io, joinPath(directory, marker))) return directory;
  }
  return normalizePath(cwd);
};

// The main checkout's run reaches a linked worktree only when the run's worktree covers cwd or the
// session is one of the run's; a sibling worktree reads its own state (the hook's rule, mirrored).
const governsLinkedCwd = async (io, mainRoot, cwd, sessionId) => {
  const state = await readGuardedJson(io, mainRoot, joinPath(".litclaude", "boulder.json"), STATE_CAPS.boulder);
  const work = state?.active_work_id ? state.works?.[state.active_work_id] : null;
  if (!work || !["active", "paused"].includes(work.status)) return true;
  if (typeof sessionId === "string" && Array.isArray(work.session_ids) && work.session_ids.includes(sessionId)) return true;
  const scope = splitPath(normalizePath(String(work.effective_worktree_root ?? work.worktree_path ?? mainRoot)).normalize("NFC"));
  const here = splitPath(normalizePath((await statOf(io, cwd))?.realPath ?? cwd).normalize("NFC"));
  return scope.every((part, index) => here[index] === part);
};

export const resolveLifecycleRoot = async (io, cwd, stateRoot, sessionId = null) => {
  for (const directory of ancestors(cwd)) {
    if (await statOf(io, joinPath(directory, ".litclaude", "boulder.json"))) return directory;
    const marker = joinPath(directory, ".git");
    const stat = await statOf(io, marker);
    if (stat?.kind === "file" && !stat.isLink && stat.size <= STATE_CAPS.gitMarker) {
      let text = "";
      try {
        text = await io.read(marker);
      } catch {
        text = "";
      }
      const match = /^gitdir:\s*(.+?)\s*$/mu.exec(text);
      if (match) {
        const worktreesDir = parentOf(resolvePath(directory, match[1]));
        if (splitPath(worktreesDir).at(-1) === "worktrees") {
          const mainRoot = parentOf(parentOf(worktreesDir));
          if (await statOf(io, joinPath(mainRoot, ".litclaude", "boulder.json")) && await governsLinkedCwd(io, mainRoot, cwd, sessionId)) return mainRoot;
        }
      }
    }
  }
  return stateRoot;
};

// One guarded read. `root` is the directory the file must stay under; the comparison is made on
// resolved paths so a link anywhere between the root and the file shows up as a mismatch.
export const readGuarded = async (io, root, relative, cap) => {
  const path = joinPath(root, relative);
  const stat = await statOf(io, path);
  if (!stat || stat.isLink || stat.kind !== "file" || !(stat.size <= cap)) return null;
  if (stat.realPath !== undefined) {
    const rootStat = await statOf(io, root);
    const realRoot = rootStat?.realPath;
    if (realRoot === undefined || normalizePath(stat.realPath) !== joinPath(realRoot, relative)) return null;
  }
  try {
    const text = await io.read(path);
    return typeof text === "string" && text.length <= cap ? text : null;
  } catch {
    return null;
  }
};

export const readGuardedJson = async (io, root, relative, cap) => {
  const text = await readGuarded(io, root, relative, cap);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

const str = (value, max = 400) => (typeof value === "string" && value.length > 0 ? value.slice(0, max) : null);
const int = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const num = (value) => (Number.isFinite(value) ? value : null);
const time = (value) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// Per-session file names, spelled as hud-ignition.mjs (ignition) and auto-handoff.mjs (session) do.
export const ignitionFileName = (sessionId) => {
  const raw = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "unknown-session";
  return `${raw.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_")}.json`;
};
const handoffSessionId = (sessionId) => (typeof sessionId === "string" ? sessionId.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64) : "");

export const ignitionRoot = (env) => {
  const override = env?.LITCLAUDE_HUD_STATE_ROOT?.trim();
  if (override) return normalizePath(override);
  return joinPath(env?.TMPDIR?.trim() || "/tmp", "litclaude-hud");
};

export const parseIgnition = (record, sessionId) => {
  if (!record || (record.sessionId !== null && record.sessionId !== sessionId)) return null;
  const discipline = str(record.discipline, 80);
  return discipline ? { discipline, at: time(record.at) } : null;
};

const workBelongs = (work, sessionId) =>
  work.root_session_id === sessionId
  || work.active_session_id === sessionId
  || (Array.isArray(work.session_ids) && work.session_ids.includes(sessionId));

const laneList = (lanes) => Object.values(lanes && typeof lanes === "object" ? lanes : {})
  .filter((lane) => lane && typeof lane === "object")
  .map((lane) => ({
    id: str(lane.agent_id, 120) ?? "lane",
    type: str(lane.agent_type, 80) ?? "agent",
    status: str(lane.status, 40) ?? "unknown",
    startedAt: time(lane.started_at),
  }))
  .slice(0, 32);

export const parseBoulder = (state, sessionId) => {
  if (!state || !state.works || typeof state.works !== "object") return { work: null, completed: [] };
  const completed = Object.values(state.works)
    .filter((work) => work && work.status === "completed" && workBelongs(work, sessionId))
    .map((work) => str(work.work_id, 120))
    .filter(Boolean);
  const active = state.active_work_id ? state.works[state.active_work_id] : null;
  if (!active || !["active", "paused"].includes(active.status) || !workBelongs(active, sessionId)) return { work: null, completed };
  const progress = active.progress && typeof active.progress === "object" ? active.progress : {};
  const total = int(progress.total);
  return {
    work: {
      id: str(active.work_id, 120) ?? String(state.active_work_id),
      status: active.status,
      planName: str(active.plan_name, 200),
      total,
      checked: Math.min(int(progress.checked), total),
      nextTask: str(progress.next_task, 400),
      lanes: laneList(active.lanes),
      lastEvent: str(Array.isArray(active.events) ? active.events.at(-1)?.event : null, 60),
      // A paused work waits at a typed boundary (start-work-lifecycle) until the user answers it.
      awaiting: active.status === "paused" ? str(active.pending_boundary?.boundary_id, 120) : null,
    },
    completed,
  };
};

const CRITERION_STATUSES = new Set(["pass", "fail", "blocked", "pending"]);

export const parseGoals = (state, sessionId) => {
  if (!state || typeof state.status !== "string") return null;
  if (typeof state.sessionId === "string" && state.sessionId !== sessionId) return null;
  const criteria = (Array.isArray(state.criteria) ? state.criteria : []).slice(0, 40).map((criterion, index) => {
    const evidence = Array.isArray(criterion?.evidence) ? criterion.evidence : [];
    const status = CRITERION_STATUSES.has(criterion?.status) ? criterion.status : "pending";
    return {
      id: str(criterion?.id, 80) ?? `criterion-${index + 1}`,
      description: str(criterion?.description, 300) ?? "",
      status,
      attempts: evidence.length,
      lastAt: time(evidence.at(-1)?.recordedAt),
    };
  });
  return {
    objective: str(state.objective, 400) ?? "",
    status: state.status,
    autoloop: state.autoloop === true,
    criteria,
    blockers: (Array.isArray(state.blockers) ? state.blockers : []).slice(0, 10)
      .map((blocker) => str(typeof blocker === "string" ? blocker : blocker?.note ?? blocker?.description, 300))
      .filter(Boolean),
    lastCheckpoint: str(Array.isArray(state.checkpoints) ? state.checkpoints.at(-1)?.status : null, 40),
    createdAt: time(state.createdAt),
    // When the goal was finished: its last `complete` checkpoint, else its last update.
    completedAt: state.status === "complete"
      ? time((Array.isArray(state.checkpoints) ? state.checkpoints : []).findLast((entry) => entry?.status === "complete")?.createdAt) ?? time(state.updatedAt)
      : null,
  };
};

export const parseAutoloop = (state) => {
  if (!state || !Number.isInteger(state.blockCount) || state.blockCount < 0 || !Number.isFinite(state.firstBlockAt)) return null;
  return { blockCount: state.blockCount, firstBlockAt: state.firstBlockAt };
};

const forSession = (state, sessionId) => (state && state.sessionId === sessionId ? state : null);

export const parseLitPlanTurn = (state, sessionId) => {
  const turn = forSession(state, sessionId);
  return turn ? { blockCount: int(turn.blockCount), warned: turn.warned === true, promptAt: num(turn.promptAt) } : null;
};

export const parseProbeTurn = (state, sessionId) => {
  const turn = forSession(state, sessionId);
  if (!turn) return null;
  return {
    editAt: num(turn.editAt),
    probeAt: num(turn.probeAt),
    issue: str(turn.issue, 160),
    issueAt: num(turn.issueAt),
    paths: (Array.isArray(turn.paths) ? turn.paths : []).map((path) => str(path, 200)).filter(Boolean).slice(0, 5),
    blockCount: int(turn.blockCount),
  };
};

export const parseMotionTurn = (state, sessionId) => {
  const turn = forSession(state, sessionId);
  return turn ? { blockCount: int(turn.blockCount), runs: Array.isArray(turn.runs) ? turn.runs.length : 0, notified: turn.notified === true } : null;
};

const percentOf = (raw) => {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^(?:[1-9]\d?)$/u.test(text.trim())) return null;
  return Number(text.trim());
};

// The environment wins over the saved choice, as resolveAutoHandoff in auto-handoff.mjs decides.
export const parseAutoHandoff = (settings, session, env) => {
  const flag = env?.LITCLAUDE_AUTO_HANDOFF;
  const enabled = flag !== undefined ? flag === "1" : settings?.enabled === true;
  const percent = percentOf(env?.LITCLAUDE_AUTO_HANDOFF_PERCENT !== undefined ? env.LITCLAUDE_AUTO_HANDOFF_PERCENT : settings?.percent ?? null);
  if (!enabled || percent === null) return null;
  return {
    percent,
    firedAt: num(session?.firedAt),
    firedAtPercent: num(session?.firedAtPercent),
    pending: session?.pending === true,
  };
};

const listOf = async (io, path) => {
  if (typeof io.list !== "function") return [];
  try {
    const entries = await io.list(path);
    return Array.isArray(entries) ? entries.slice(0, 400) : [];
  } catch {
    return [];
  }
};

const newestFile = (entries, pattern) => entries
  .filter((entry) => entry?.kind === "file" && !entry.isLink && pattern.test(entry.name))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;

export const parseInterviewState = (state, at) => {
  const inner = state?.state && typeof state.state === "object" ? state.state : null;
  if (!inner) return null;
  return {
    active: state.active === true,
    round: Array.isArray(inner.rounds) ? inner.rounds.length : null,
    max: Number.isInteger(inner.max_rounds) && inner.max_rounds > 0 ? inner.max_rounds : null,
    ambiguity: num(inner.current_ambiguity),
    threshold: num(inner.threshold),
    at,
  };
};

// The draft's resume gate: the last `status:` line wins, as the approval gate sits below the header.
export const parseDraftStatus = (text, slug, at) => {
  const statuses = [...String(text).matchAll(/^status:\s*([a-z-]+)\s*$/gmu)].map((match) => match[1]);
  return statuses.length ? { slug, status: statuses.at(-1), at } : null;
};

export const summarizeResearchFiles = (entries, slug) => {
  const files = entries.filter((entry) => entry?.kind === "file" && !entry.isLink);
  const waves = files.map(({ name }) => /^wave-(\d{1,3})-.*\.md$/u.exec(name)).filter(Boolean).map((match) => Number(match[1]));
  return {
    slug,
    wave: waves.length ? Math.max(...waves) : 0,
    digests: waves.length,
    verified: files.filter(({ name }) => /^verify-.*\.md$/u.test(name)).length,
    synthesis: files.some(({ name }) => name === "SYNTHESIS.md"),
    at: files.reduce((latest, { mtimeMs }) => Math.max(latest, Number.isFinite(mtimeMs) ? mtimeMs : 0), 0) || null,
  };
};

const FRAME_SKILL = /^[a-z][a-z0-9-]{0,40}$/u;
// The plan a frame works from, as lib/workflow-stack.mjs keeps it: a project-relative `plans/<name>.md`.
const FRAME_PLAN = /^plans\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.md$/u;

/**
 * The session's workflow stack (lib/workflow-stack.mjs) as the card trusts it: at most three frames,
 * each with its skill, role, status and stage record, and the frame whose map the card draws, which
 * is the nearest paused spine while a side frame is on top and the top frame otherwise. The owner's
 * record carries the top frame's time, so a side frame keeps the paused map fresh.
 */
export const parseWorkflowStack = (stack, sessionId) => {
  if (!stack || typeof stack !== "object" || !Array.isArray(stack.frames) || !stack.frames.length || stack.frames.length > 3) return null;
  const frames = stack.frames.map((frame) => ({
    skill: typeof frame?.skill === "string" && FRAME_SKILL.test(frame.skill) ? frame.skill : null,
    role: frame?.role === "side" ? "side" : "spine",
    status: frame?.status === "paused" ? "paused" : "active",
    record: parseStageRecord({ ...frame, sessionId: undefined }, sessionId),
    at: typeof frame?.at === "string" ? Date.parse(frame.at) : Number.NaN,
    planRef: typeof frame?.ref?.plan === "string" && FRAME_PLAN.test(frame.ref.plan) && !frame.ref.plan.includes("..") ? frame.ref.plan : null,
    plan: null,
  }));
  const top = frames.at(-1);
  const owner = top.role === "side" ? frames.findLast(({ role }) => role === "spine") ?? top : top;
  const record = owner.record && Number.isFinite(top.at) ? { ...owner.record, at: Math.max(owner.record.at, top.at), stacked: true } : null;
  return { frames, owner: frames.indexOf(owner), record };
};

/** A plan's `{ done, total }` by the start-work checkbox grammar, or null when it has no task rows. */
export const countPlanTasks = (text) => {
  const rows = parsePlanTaskRows(String(text ?? ""));
  return rows.length ? { done: rows.filter(({ checked }) => checked).length, total: rows.length } : null;
};

// Each frame that names a plan gets that plan's checkbox counts, read once per plan under the cap,
// and `planAt`, the plan file's last change (when a finished plan's row was checked off).
const withPlanCounts = async (io, stateRoot, frames) => {
  const refs = [...new Set(frames.map(({ planRef }) => planRef).filter(Boolean))];
  const read = new Map(await Promise.all(refs.map(async (ref) => [ref, {
    counts: countPlanTasks(await readGuarded(io, stateRoot, ref, STATE_CAPS.goals)),
    at: num((await statOf(io, joinPath(stateRoot, ref)))?.mtimeMs),
  }])));
  for (const frame of frames) {
    frame.plan = frame.planRef ? read.get(frame.planRef)?.counts ?? null : null;
    frame.planAt = frame.planRef ? read.get(frame.planRef)?.at ?? null : null;
  }
  return frames;
};

const OTHER_STACKS = 6;

// The stacks other sessions of this project keep beside this one's, newest first and at most
// OTHER_STACKS: `{ id8, at, ended, frames }` each, `at` being the file's mtime and `ended` set once
// SessionEnd marked it. Links, this session's own file and the unknown-session file are skipped;
// whether one is still live is the view's call.
const readOtherStacks = async (io, stateRoot, sessionId) => {
  const own = new Set([ignitionFileName(sessionId), ignitionFileName(null)]);
  const files = (await listOf(io, joinPath(stateRoot, ".litclaude", "workflow-stack")))
    .filter((entry) => entry?.kind === "file" && !entry.isLink && /^[A-Za-z0-9._-]+\.json$/u.test(entry.name) && !own.has(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, OTHER_STACKS);
  const read = await Promise.all(files.map(async (entry) => {
    const raw = await readGuardedJson(io, stateRoot, joinPath(".litclaude", "workflow-stack", entry.name), STATE_CAPS.small);
    const id = typeof raw?.sessionId === "string" ? raw.sessionId : null;
    const parsed = id ? parseWorkflowStack(raw, id) : null;
    if (parsed) await withPlanCounts(io, stateRoot, parsed.frames.slice(-1));
    return parsed ? { sessionId: id, id8: id.replace(/[^A-Za-z0-9]/gu, "").slice(0, 8), at: entry.mtimeMs, ended: typeof raw.endedAt === "string", frames: parsed.frames } : null;
  }));
  return read.filter(Boolean);
};

const LIVENESS_FILES = 12;
const LIVENESS_STATES = new Set(["alive", "idle", "ended"]);

// The newest liveness records the hooks wrote (session-liveness.mjs), keyed by full session id:
// `{ state, at, herdrPane }`. Links and malformed records are skipped.
const readLiveness = async (io, stateRoot) => {
  const files = (await listOf(io, joinPath(stateRoot, ".litclaude", "liveness")))
    .filter((entry) => entry?.kind === "file" && !entry.isLink && /^[A-Za-z0-9._-]+\.json$/u.test(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, LIVENESS_FILES);
  const records = await Promise.all(files.map((entry) => readGuardedJson(io, stateRoot, joinPath(".litclaude", "liveness", entry.name), STATE_CAPS.small)));
  const liveness = {};
  for (const record of records) {
    const id = str(record?.sessionId, 160);
    if (!id || !LIVENESS_STATES.has(record.state) || time(record.at) === null || Object.hasOwn(liveness, id)) continue;
    const pane = typeof record.herdrPane === "string" && /^[A-Za-z0-9:_-]{1,32}$/u.test(record.herdrPane) ? record.herdrPane : null;
    liveness[id] = { state: record.state, at: time(record.at), herdrPane: pane };
  }
  return liveness;
};

const readWorkflowSources = async (io, stateRoot, sessionId) => {
  const dir = (name) => joinPath(stateRoot, ".litclaude", name);
  const [interviews, drafts, researches, ownStack, unknownStack] = await Promise.all([
    listOf(io, dir("deep-interview")),
    listOf(io, dir("drafts")),
    listOf(io, dir("litresearch")),
    readGuardedJson(io, stateRoot, joinPath(".litclaude", "workflow-stack", ignitionFileName(sessionId)), STATE_CAPS.small),
    readGuardedJson(io, stateRoot, joinPath(".litclaude", "workflow-stack", ignitionFileName(null)), STATE_CAPS.small),
  ]);
  const stack = parseWorkflowStack(ownStack, sessionId) ?? parseWorkflowStack(unknownStack, sessionId);
  if (stack) {
    await withPlanCounts(io, stateRoot, stack.frames);
    if (stack.record) stack.record.plan = stack.frames[stack.owner].plan;
  }
  const [stacks, liveness] = await Promise.all([readOtherStacks(io, stateRoot, sessionId), readLiveness(io, stateRoot)]);
  const others = stacks.map((other) => ({ ...other, liveness: liveness[other.sessionId] ?? null }));
  // A record written before the stack existed, read only while this session has no stack.
  const legacy = stack ? null : await readGuardedJson(io, stateRoot, ".litclaude/workflow-stage.json", STATE_CAPS.small);
  const interviewFile = newestFile(interviews, /^[A-Za-z0-9._-]+-state\.json$/u);
  const draftFile = newestFile(drafts, /^[A-Za-z0-9._-]+\.md$/u);
  let research = null;
  const sessions = researches.filter((entry) => entry?.kind === "dir" && !entry.isLink && /^[A-Za-z0-9._-]+$/u.test(entry.name)).slice(0, 30);
  if (sessions.length) {
    const stamped = await Promise.all(sessions.map(async ({ name }) => ({ name, at: (await statOf(io, joinPath(dir("litresearch"), name)))?.mtimeMs ?? 0 })));
    const newest = stamped.sort((a, b) => b.at - a.at)[0];
    research = summarizeResearchFiles(await listOf(io, joinPath(dir("litresearch"), newest.name)), newest.name);
  }
  const [interview, draft] = await Promise.all([
    interviewFile ? readGuardedJson(io, stateRoot, `.litclaude/deep-interview/${interviewFile.name}`, STATE_CAPS.small) : null,
    draftFile ? readGuarded(io, stateRoot, `.litclaude/drafts/${draftFile.name}`, STATE_CAPS.goals) : null,
  ]);
  return {
    record: stack?.record ?? parseStageRecord(legacy, sessionId),
    stack,
    others,
    liveness,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    interview: interview ? parseInterviewState(interview, interviewFile.mtimeMs) : null,
    draft: draft === null ? null : parseDraftStatus(draft, draftFile.name.replace(/\.md$/u, ""), draftFile.mtimeMs),
    research,
  };
};

export const readLitSnapshot = async (io, { cwd, sessionId, env = {} }) => {
  const stateRoot = await resolveStateRoot(io, cwd);
  const lifecycleRoot = await resolveLifecycleRoot(io, cwd, stateRoot, sessionId);
  const state = (relative, cap = STATE_CAPS.small) => readGuardedJson(io, stateRoot, joinPath(".litclaude", relative), cap);
  const handoffId = handoffSessionId(sessionId);
  const [ignition, boulder, goals, autoloop, litPlan, probe, motion, handoffSettings, handoffSession] = await Promise.all([
    readGuardedJson(io, ignitionRoot(env), ignitionFileName(sessionId), STATE_CAPS.small),
    readGuardedJson(io, lifecycleRoot, joinPath(".litclaude", "boulder.json"), STATE_CAPS.boulder),
    state("litgoal/goals.json", STATE_CAPS.goals),
    state("litgoal/autoloop.json"),
    state("lit-plan/turn.json"),
    state("interface-probe/turn.json"),
    state("motion/turn.json"),
    state("auto-handoff/settings.json"),
    handoffId ? state(`auto-handoff/session-${handoffId}.json`) : null,
  ]);
  const { work, completed } = parseBoulder(boulder, sessionId);
  const workflow = await readWorkflowSources(io, stateRoot, sessionId);
  return {
    stateRoot,
    lifecycleRoot,
    ignition: parseIgnition(ignition, sessionId),
    work,
    completedWorkIds: completed,
    goal: parseGoals(goals, sessionId),
    autoloop: parseAutoloop(autoloop),
    litPlan: parseLitPlanTurn(litPlan, sessionId),
    probe: parseProbeTurn(probe, sessionId),
    motion: parseMotionTurn(motion, sessionId),
    handoff: parseAutoHandoff(handoffSettings, handoffSession, env),
    workflow,
  };
};

// Where `lit invite` keeps its record (lib/invite.mjs inviteHome): LITCLAUDE_HOME, else ~/.litclaude.
export const inviteRoot = (env) => {
  // Untrimmed, like lib/invite.mjs and resolveHome, so the card reads the file the CLI wrote.
  const home = env?.LITCLAUDE_HOME;
  if (home) return normalizePath(home);
  return env?.HOME?.trim() ? joinPath(env.HOME.trim(), ".litclaude") : null;
};
// lib/invite.mjs's id rule; the band cannot import that module, which writes.
const INVITE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;

/** The recorded inviter's id from a real, well-formed invite.json under inviteRoot (read guarded), or null. */
export const readInvited = async (io, env) => {
  const root = inviteRoot(env);
  if (!root) return null;
  const record = await readGuardedJson(io, root, "invite.json", 4096);
  return record?.version === 1 && typeof record.invitedBy === "string" && INVITE_ID.test(record.invitedBy) ? record.invitedBy : null;
};

/**
 * The LitClaude version Claude Code installed, from its `installed_plugins.json` record: the
 * `litclaude@…` entry, user scope first. Anything unreadable or malformed gives null.
 */
export const installedVersionOf = (record) => {
  const plugins = record?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return null;
  const entries = Object.entries(plugins)
    .filter(([key, list]) => key.startsWith("litclaude@") && Array.isArray(list))
    .flatMap(([, list]) => list)
    .filter((entry) => entry && typeof entry === "object" && typeof entry.version === "string");
  return str((entries.find(({ scope }) => scope === "user") ?? entries[0])?.version, 40);
};

const readJsonAt = async (io, path, cap) => {
  if (typeof path !== "string" || !path) return null;
  try {
    const text = await readSmall(io, path, cap);
    const value = text === null ? null : JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/** `{ loaded, installed }`: this plugin's own manifest version and the one installed, or null each. */
export const readPluginVersions = async (io, { pluginJson, installedFile }) => {
  const [plugin, installed] = await Promise.all([readJsonAt(io, pluginJson, STATE_CAPS.small), readJsonAt(io, installedFile, STATE_CAPS.goals)]);
  return { loaded: str(plugin?.version, 40), installed: installedVersionOf(installed) };
};

const readSmall = async (io, path, cap) => {
  const stat = await statOf(io, path);
  if (!stat || stat.kind !== "file" || !(stat.size <= cap)) return null;
  try {
    const text = await io.read(path);
    return typeof text === "string" && text.length <= cap ? text : null;
  } catch {
    return null;
  }
};

/**
 * The branch the working directory is on, for the card's bottom edge: the nearest `.git` above
 * `cwd`, followed through a linked worktree's `gitdir:` file, and its HEAD read as text. A
 * detached HEAD gives the short commit; anything unreadable gives null.
 */
export const readGitBranch = async (io, cwd) => {
  for (const directory of ancestors(cwd)) {
    const marker = joinPath(directory, ".git");
    const stat = await statOf(io, marker);
    if (!stat) continue;
    let gitDir = marker;
    if (stat.kind === "file") {
      const pointer = await readSmall(io, marker, STATE_CAPS.gitMarker);
      const match = pointer === null ? null : /^gitdir:\s*(.+?)\s*$/mu.exec(pointer);
      if (!match) return null;
      gitDir = resolvePath(directory, match[1]);
    }
    const head = (await readSmall(io, joinPath(gitDir, "HEAD"), STATE_CAPS.gitMarker))?.trim();
    if (!head) return null;
    const ref = /^ref:\s*refs\/heads\/(.+)$/u.exec(head);
    if (ref) return ref[1].slice(0, 120);
    return /^[0-9a-f]{7,64}$/u.test(head) ? head.slice(0, 7) : null;
  }
  return null;
};

// The icon font the installer's opt-in step writes (bin/icon-font.mjs), or the proportional
// symbols font a person installed some other way, in each per-user font folder.
const ICON_FONT_NAMES = Object.freeze(["SymbolsNerdFontMono-Regular.ttf", "SymbolsNerdFont-Regular.ttf"]);

export const iconFontCandidates = (env) => {
  const home = env?.HOME?.trim();
  const folders = [];
  if (home) folders.push(joinPath(home, "Library", "Fonts"));
  const data = env?.XDG_DATA_HOME?.trim() || (home ? joinPath(home, ".local", "share") : "");
  if (data) folders.push(joinPath(data, "fonts"));
  const local = env?.LOCALAPPDATA?.trim();
  if (local) folders.push(joinPath(local, "Microsoft", "Windows", "Fonts"));
  return folders.flatMap((folder) => ICON_FONT_NAMES.map((name) => joinPath(folder, name)));
};

/**
 * Whether the icon font is installed, by stat alone (the font is never read). `note` says what
 * the band decided and why, for the evidence pane; a folder that cannot be checked counts as no
 * font, so the band falls back to basic glyphs rather than drawing boxes.
 */
export const detectIconFont = async (io, env) => {
  const candidates = iconFontCandidates(env);
  if (candidates.length === 0) return { present: false, path: null, note: "basic: no home folder to look in for the icon font" };
  let unreadable = false;
  for (const path of candidates) {
    try {
      const stat = await io.stat(path);
      if (stat?.kind === "file") return { present: true, path, note: `nerd: Symbols Nerd Font found at ${path}` };
    } catch (error) {
      if (!/ENOENT|no such file|not found/iu.test(String(error?.message ?? error))) unreadable = true;
    }
  }
  return unreadable
    ? { present: false, path: null, note: "basic: the font folders could not be checked from the band" }
    : { present: false, path: null, note: "basic: Symbols Nerd Font not found (litclaude-ai install --icon-font)" };
};

// The litgoal ledger's newest entries for the evidence pane, newest first. Lines that are not JSON
// objects are skipped; the file is read only under its cap.
// A workflow stack event's place: `lit-loop RED 1/4`.
const stackDetail = (entry) => {
  if (!String(entry.event ?? "").startsWith("workflow.") || typeof entry.skill !== "string") return null;
  const count = Number.isInteger(entry.n) && Number.isInteger(entry.total) ? ` ${entry.n}/${entry.total}` : "";
  return `${entry.skill}${typeof entry.stage === "string" ? ` ${entry.stage}${count}` : ""}`;
};

export const readLedgerTail = async (io, stateRoot, limit = 8) => {
  const text = await readGuarded(io, stateRoot, ".litclaude/litgoal/ledger.jsonl", STATE_CAPS.ledger);
  if (text === null) return [];
  const entries = [];
  for (const line of text.split("\n").reverse()) {
    if (entries.length >= limit) break;
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      entries.push({
        event: str(entry.event, 60) ?? "event",
        at: time(entry.timestamp),
        detail: str(entry.criterionId ?? entry.note ?? entry.objective ?? stackDetail(entry) ?? entry.status, 120) ?? "",
        status: str(entry.status, 40),
      });
    } catch {
      // A torn final line from a concurrent append; the next refresh reads it whole.
    }
  }
  return entries;
};
