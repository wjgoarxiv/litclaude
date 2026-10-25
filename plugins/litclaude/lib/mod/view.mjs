// What the LIT band says, decided from a state snapshot (state.mjs), the skills that fired
// (skills.mjs) and what Claude Code reports live (subagents, context and rate-limit usage). Pure: the mod calls these on each refresh and hands the result to the
// band's surface module, which only draws and animates it.

import { AUTOLOOP_LIMITS, GATE_LIMITS } from "./state.mjs";
import { buildWorkflow } from "./workflow.mjs";

export const STALL_MS = 10 * 60 * 1000;
// An agent the host does not list, quiet this long with no call in flight, no longer counts as
// running: a crashed loop or a lost report must not hold the card at work for the rest of the
// session. One the host lists as live stays, however quiet; it is marked stalled instead.
export const AGENT_STALE_MS = 30 * 60 * 1000;
// The context warning starts this many points before the auto-handoff percent.
export const CONTEXT_LEAD = 5;

const LIVE_AGENT = new Set(["running", "pending", "waiting", "idle"]);
const ENDED_AGENT = new Set(["completed", "failed", "killed"]);
const NONTERMINAL_GOAL = new Set(["active", "blocked", "review_blocked", "needs_user_decision"]);
const WORK_DISCIPLINES = new Set(["lit-loop", "litwork", "litgoal", "start-work", "native-workflow"]);

export const formatDuration = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
};

export const formatAgo = (at, now) => (Number.isFinite(at) ? (now - at < 5000 ? "just now" : `${formatDuration(now - at)} ago`) : "—");

// `activity.last` maps an agent id to the last time it was seen doing something (a tool call from its
// loop, a status change, its first appearance) and `activity.first` to when it first appeared. A live
// agent quiet for longer than `thresholdMs` is stalled.
export const EMPTY_ACTIVITY = Object.freeze({ last: {}, first: {} });

// Folds one `$.agent.list()` reading into the activity map: a new agent starts both clocks, a changed
// status counts as activity, and agents that left the list are forgotten.
export const trackAgents = (activity, agents, previousStatus, now) => {
  const last = {};
  const first = {};
  for (const agent of agents) {
    first[agent.id] = activity.first[agent.id] ?? now;
    const changed = previousStatus[agent.id] !== undefined && previousStatus[agent.id] !== agent.status;
    last[agent.id] = activity.last[agent.id] === undefined || changed ? now : activity.last[agent.id];
  }
  return { last, first };
};

export const noteAgentActivity = (activity, agentId, now) =>
  activity.first[agentId] === undefined ? activity : { ...activity, last: { ...activity.last, [agentId]: now } };

// `spawned` maps an agent id to what `agent.spawn` said of it, when it was last seen working and
// how many of its tool calls are in flight. It covers the agents `$.agent.list()` never shows (a
// workflow script's) and the moment before the list catches up; the agent's own `turn.complete`
// ends it.
export const noteSpawn = (spawned, { id, description, type, at }) => ({ ...spawned, [id]: { id, description, type, last: at, calls: 0 } });

// `calls` is +1 as one of the agent's tool calls starts, -1 as it returns, 0 for other activity.
export const noteSpawnActivity = (spawned, id, at, calls = 0) => (spawned[id]
  ? { ...spawned, [id]: { ...spawned[id], last: at, calls: Math.max(0, (spawned[id].calls ?? 0) + calls) } }
  : spawned);

export const noteSpawnEnded = (spawned, id) => Object.fromEntries(Object.entries(spawned).filter(([key]) => key !== id));

// Folds the spawn records into one `$.agent.list()` reading. The list speaks for the agents it shows:
// a record whose agent it lists as ended is dropped. A record it does not show runs until its
// `turn.complete`, or until it has been quiet for AGENT_STALE_MS with no call in flight.
export const mergeSpawned = (listed, spawned, now) => {
  const byId = new Map(listed.map((agent) => [agent.id, agent]));
  const kept = {};
  const unlisted = [];
  for (const record of Object.values(spawned)) {
    const row = byId.get(record.id);
    if (row ? ENDED_AGENT.has(row.status) : now - record.last > AGENT_STALE_MS && !(record.calls > 0)) continue;
    kept[record.id] = record;
    if (!row) unlisted.push({ id: record.id, description: record.description, type: record.type, status: "running" });
  }
  return { agents: [...listed, ...unlisted], spawned: kept };
};

export const stalledLanes = (agents, activity, now, thresholdMs = STALL_MS) =>
  agents
    .filter((agent) => LIVE_AGENT.has(agent.status) && Number.isFinite(activity.last[agent.id]) && now - activity.last[agent.id] > thresholdMs)
    .map((agent) => ({ id: agent.id, name: laneName(agent), quietMs: now - activity.last[agent.id] }));

export const laneName = (agent) => String(agent.name || agent.description || agent.type || "agent").slice(0, 40);

// The card shows at most this many threads; the rest are counted as `+N more`. A deep chain still
// leaves PARALLEL_ROWS for the lanes and tasks under it.
export const THREAD_ROWS = 4;
const PARALLEL_ROWS = 3;
// Another session of this project counts as live while its stack was written this recently.
export const OTHER_SESSION_MS = 15 * 60 * 1000;

const countOrNull = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

// `lists` maps a loop (`main`, or a subagent's id) to what its tool calls say of its progress:
// `steps`, the tool calls it finished; `todos`, the counts of its last TodoWrite; `tasks`, the
// status of each task it created with TaskCreate (TaskUpdate moves them); `latest`, which of the two
// lists it touched last. Only statuses are kept, never a todo's or a task's text.
export const EMPTY_LISTS = Object.freeze({});
const LIST_CAP = 200;
const LOOP_CAP = 40;
const TASK_STATUS = new Set(["pending", "in_progress", "completed"]);

const loopEntry = (lists, loop) => lists[loop] ?? { steps: 0, todos: null, tasks: {}, latest: null };

/**
 * Folds one finished tool call of `loop` into `lists`: every call counts a step, a TodoWrite
 * replaces the loop's todo counts, a TaskCreate adds its task and a TaskUpdate moves the task in
 * whichever loop created it (or in this loop, marked unseen, when its creation was not seen).
 */
export const noteLoopCall = (lists, loop, call, result) => {
  if (typeof loop !== "string" || !loop) return lists;
  const next = { ...lists };
  const entry = { ...loopEntry(lists, loop) };
  entry.steps += 1;
  if (call?.tool === "TodoWrite" && Array.isArray(call.todos)) {
    const todos = call.todos.slice(0, LIST_CAP);
    entry.todos = { done: todos.filter((todo) => todo?.status === "completed").length, total: todos.length };
    entry.latest = "todos";
  } else if (call?.tool === "TaskCreate" && typeof result?.task?.id === "string") {
    entry.tasks = { ...entry.tasks, [result.task.id.slice(0, 64)]: { status: "pending", seen: true } };
    entry.latest = "tasks";
  } else if (call?.tool === "TaskUpdate" && typeof call.taskId === "string" && (TASK_STATUS.has(call.status) || call.status === "deleted")) {
    const id = call.taskId.slice(0, 64);
    const owner = Object.keys(next).find((key) => key !== loop && next[key].tasks?.[id]);
    const target = owner ? { ...next[owner] } : entry;
    const tasks = { ...target.tasks };
    if (call.status === "deleted") delete tasks[id];
    else tasks[id] = { status: call.status, seen: tasks[id]?.seen ?? false };
    target.tasks = Object.fromEntries(Object.entries(tasks).slice(-LIST_CAP));
    target.latest = "tasks";
    if (owner) next[owner] = target;
  }
  next[loop] = entry;
  const loops = Object.keys(next);
  return loops.length > LOOP_CAP ? Object.fromEntries(loops.slice(-LOOP_CAP).map((key) => [key, next[key]])) : next;
};

/**
 * A loop's `{ done, total }` from its list, or null when it keeps none. A task list whose
 * creation was not all seen knows its done count but not its total.
 */
export const listProgress = (entry) => {
  if (!entry) return null;
  const tasks = Object.values(entry.tasks ?? {});
  const fromTasks = tasks.length ? { done: tasks.filter(({ status }) => status === "completed").length, total: tasks.every(({ seen }) => seen) ? tasks.length : null } : null;
  if (entry.latest === "tasks" && fromTasks) return fromTasks;
  return entry.todos ?? fromTasks;
};

// `tasks` maps a background task's id to `{ id, kind, name, at, until }`: a shell a Bash call left
// running (its own `backgroundTaskId`) or a monitor, named by the call's description, never its
// command. `until` is a monitor's deadline. A task ends with its notification, a TaskStop, its
// deadline, or after TASK_STALE_MS when no ending was ever seen.
export const EMPTY_TASKS = Object.freeze({});
export const TASK_STALE_MS = 12 * 60 * 60 * 1000;
const TASK_CAP = 12;
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/u;

export const noteBackgroundTask = (tasks, { id, kind, name, at, until = null }) => {
  if (typeof id !== "string" || !TASK_ID.test(id)) return tasks;
  const label = String(name || kind).replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 40) || kind;
  const next = { ...tasks, [id]: { id, kind, name: label, at, until: Number.isFinite(until) ? until : null } };
  const ids = Object.keys(next);
  return ids.length > TASK_CAP ? Object.fromEntries(ids.slice(-TASK_CAP).map((key) => [key, next[key]])) : next;
};

export const endBackgroundTask = (tasks, id) => (typeof id === "string" && tasks[id] ? Object.fromEntries(Object.entries(tasks).filter(([key]) => key !== id)) : tasks);

// The ids a task notification names as ended. Its text is read for `<task-id>` and `<status>`
// alone and kept nowhere; a notification that still reports a running task ends nothing.
export const endedTaskIds = (text) => {
  const body = String(text ?? "").slice(0, 65_536);
  const ids = [];
  for (const block of body.split(/<\/task-notification>/u)) {
    const id = /<task-id>\s*([A-Za-z0-9_-]{1,64})\s*<\/task-id>/u.exec(block)?.[1];
    const status = /<status>\s*([a-z_]{1,24})\s*<\/status>/u.exec(block)?.[1] ?? "completed";
    if (id && !["running", "pending", "in_progress"].includes(status)) ids.push(id);
  }
  return ids;
};

export const pruneBackgroundTasks = (tasks, now) => {
  const kept = Object.entries(tasks).filter(([, task]) => !(task.until !== null && now > task.until) && !(now - task.at > TASK_STALE_MS));
  return kept.length === Object.keys(tasks).length ? tasks : Object.fromEntries(kept);
};

const goalCount = (goal) => (goalIsOpen(goal) && goal.criteria.length > 0 ? { done: goal.criteria.filter(({ status }) => status === "pass").length, total: goal.criteria.length } : null);
const LOOP_SKILLS = new Set(["lit-loop", "litgoal", "litwork"]);

// A frame's k/n, the first source that knows it: the count the frame recorded, the start-work run
// it drives, the checkboxes of the plan it works from, the open goal's criteria (a loop), and for
// the frame on top the main loop's own todo or task list.
const frameCount = (frame, snapshot, mainList) => {
  const record = frame.record;
  if (countOrNull(record?.total) !== null) return { done: countOrNull(record.n) ?? 0, total: record.total };
  const work = snapshot.work;
  if (work?.total > 0 && (frame.skill === "start-work" || (record?.family === "main" && record.stage === "work"))) return { done: work.checked, total: work.total };
  if (frame.plan?.total > 0) return frame.plan;
  if (LOOP_SKILLS.has(frame.skill) || record?.family === "loop") {
    const goal = goalCount(snapshot.goal);
    if (goal) return goal;
  }
  return mainList ?? { done: countOrNull(record?.n), total: null };
};

const frameThread = (frame, index, snapshot, active, mainList = null) => {
  const { done, total } = frameCount(frame, snapshot, active ? mainList : null);
  return {
    key: `frame-${index}`,
    name: frame.skill ?? frame.record?.family ?? "work",
    stage: frame.record?.step ?? frame.record?.stage ?? null,
    done,
    total,
    state: frame.record?.done ? "done" : frame.status === "paused" ? "paused" : frame.skill === "start-work" && snapshot.work?.status === "paused" ? "blocked" : "running",
    active,
  };
};

// A lane's k/n: its own todo or task list, else the steps it has finished over an unknown total.
const laneCount = (entry) => listProgress(entry) ?? { done: entry?.steps ?? 0, total: null, steps: true };

/**
 * The live threads, or null while there is at most one: `{ chain, lanes, others, laneCount,
 * taskCount, more, reserve }`. `chain` is this session's stack, parent first; `lanes` the subagents
 * or work lanes running under its top frame, then its background tasks (`task` names the kind);
 * `others` the top frame of each other session of this project whose stack moved within
 * OTHER_SESSION_MS. At most THREAD_ROWS are kept (more under a deep chain, see PARALLEL_ROWS): the
 * active frame and its parents first, then lanes and tasks, then other sessions. `reserve` is the card's thread-row count, never below the
 * `threadReserve` the caller carried over, so the card does not shrink while threads are live.
 */
const threadsOf = ({ snapshot, lanes, tasks, lists, now, threadReserve }) => {
  const frames = snapshot.workflow?.stack?.frames ?? [];
  const mainList = listProgress(lists.main);
  const chain = frames.map((frame, index) => frameThread(frame, index, snapshot, index === frames.length - 1, mainList));
  const laneThreads = lanes.map((lane, index) => ({
    key: `lane-${lane.id ?? index}`,
    name: lane.name,
    stage: null,
    ...laneCount(lane.id ? lists[lane.id] : null),
    state: lane.status === "stalled" ? "blocked" : lane.status === "idle" ? "idle" : "running",
    active: false,
  }));
  const taskThreads = tasks.map((task) => ({ key: `task-${task.id}`, name: task.name, stage: task.kind, done: null, total: null, state: "running", active: false, task: task.kind }));
  const parallel = [...laneThreads, ...taskThreads];
  const others = (snapshot.workflow?.others ?? [])
    .filter((other) => Number.isFinite(other.at) && now - other.at <= OTHER_SESSION_MS && other.frames?.length)
    .map((other) => ({ ...frameThread(other.frames.at(-1), 0, {}, false), key: `session-${other.id8}`, session: other.id8 }));
  const total = chain.length + parallel.length + others.length;
  if (total < 2) return null;
  const room = Math.max(PARALLEL_ROWS, THREAD_ROWS - chain.length);
  const keptLanes = parallel.slice(0, room);
  const keptOthers = others.slice(0, Math.max(0, room - keptLanes.length));
  const fork = parallel.length >= 2 ? 1 : 0;
  const needed = chain.length + keptLanes.length + keptOthers.length + fork;
  return {
    chain,
    lanes: keptLanes,
    others: keptOthers,
    laneCount: laneThreads.length,
    taskCount: taskThreads.length,
    more: total - chain.length - keptLanes.length - keptOthers.length,
    reserve: Math.max(needed, Number.isInteger(threadReserve) ? threadReserve : 0),
  };
};

const goalIsOpen = (goal) => Boolean(goal && NONTERMINAL_GOAL.has(goal.status));

const progressOf = (snapshot) => {
  if (snapshot.work && snapshot.work.total > 0) return { done: snapshot.work.checked, total: snapshot.work.total, unit: "tasks" };
  const goal = snapshot.goal;
  if (goalIsOpen(goal) && goal.criteria.length > 0) {
    return { done: goal.criteria.filter(({ status }) => status === "pass").length, total: goal.criteria.length, unit: "criteria" };
  }
  return null;
};

const phasesOf = ({ snapshot, discipline, progress, completing }) => {
  const met = snapshot.goal?.status === "complete";
  const planned = Boolean(snapshot.work) || goalIsOpen(snapshot.goal) || met;
  const allDone = (progress !== null && progress.done >= progress.total) || met;
  const plan = planned || completing ? "done" : discipline === "lit-plan" ? "now" : "todo";
  let work = "todo";
  if (completing || allDone) work = "done";
  else if (progress !== null || WORK_DISCIPLINES.has(discipline)) work = "now";
  let review = "todo";
  if (completing || met) review = "done";
  else if (discipline === "review-work" || allDone) review = "now";
  return { plan, work, review };
};

const gatesOf = (snapshot) => {
  const gates = [];
  if (snapshot.work) gates.push({ id: "plan", state: "ok", label: "plan saved" });
  else if (snapshot.litPlan?.blockCount > 0) gates.push({ id: "plan", state: "fail", label: "plan not saved" });
  else if (snapshot.litPlan) gates.push({ id: "plan", state: "pending", label: "plan pending" });
  const probe = snapshot.probe;
  if (probe?.editAt !== null && probe?.editAt !== undefined) {
    if (probe.probeAt !== null && probe.probeAt >= probe.editAt) gates.push({ id: "probe", state: "ok", label: "ui probe passed" });
    else if (probe.issue && probe.issueAt >= probe.editAt) gates.push({ id: "probe", state: "fail", label: "ui probe failed" });
    else gates.push({ id: "probe", state: "pending", label: "ui probe pending" });
  }
  if (snapshot.motion?.blockCount > 0) gates.push({ id: "motion", state: "pending", label: "motion gate pending" });
  if (snapshot.handoff) {
    gates.push(snapshot.handoff.firedAt !== null
      ? { id: "handoff", state: "ok", label: `handoff written at ${snapshot.handoff.firedAtPercent ?? snapshot.handoff.percent}%` }
      : { id: "handoff", state: "pending", label: `handoff at ${snapshot.handoff.percent}%` });
  }
  return gates;
};

const contextWarningOf = (snapshot, usage) => {
  const percent = usage?.context?.percent;
  const handoff = snapshot.handoff;
  if (!handoff || handoff.firedAt !== null || !Number.isFinite(percent)) return null;
  return percent >= handoff.percent - CONTEXT_LEAD ? { percent: Math.round(percent), threshold: handoff.percent } : null;
};

const goalSummaryOf = (goal) => {
  if (!goal || goal.criteria.length === 0) return null;
  return { status: goal.status, passed: goal.criteria.filter(({ status }) => status === "pass").length, total: goal.criteria.length };
};

// The bottom edge's live figures, as the status line shows them: context fill, the five-hour and
// weekly windows and the Git branch.
const figuresOf = (usage, git) => {
  const context = Number.isFinite(usage?.context?.percent) ? Math.round(usage.context.percent) : null;
  const windows = Array.isArray(usage?.rateLimits) ? usage.rateLimits : [];
  const rates = [["five_hour", "5h"], ["seven_day", "1w"]].flatMap(([kind, label]) => {
    const window = windows.find((entry) => entry.kind === kind);
    return window && Number.isFinite(window.percentUsed) ? [{ label, percent: Math.round(window.percentUsed) }] : [];
  });
  return { context, rates, git: typeof git === "string" && git ? git : null };
};

// The tool the main loop is running, by name only: an MCP tool by its own last segment. Never its
// arguments, its command or the files it touches.
export const stepName = (tool) => {
  const name = String(tool ?? "").trim();
  const mcp = /^mcp__.+__([^_].*)$/u.exec(name);
  return (mcp ? mcp[1] : name).replace(/[^\w .:-]/gu, "").slice(0, 32) || null;
};

/**
 * The band's model. `agents` is `$.agent.list()`, `activity` the per-agent last-seen map, `usage`
 * `$.session.usage()`, `notice` and `completion` whatever the mod is currently playing, `skills`
 * the chips (skills.mjs chipStates), `lastDiscipline` the discipline or skill the session last
 * lit (the idle title), `git` the branch and `step` the live step (`{ name, at }`, the tool the
 * main loop runs and since when). `threadReserve` is the previous model's `threads.reserve`,
 * `lists` the loops' todo and task counts (noteLoopCall) and `tasks` the background tasks
 * (noteBackgroundTask).
 */
export const buildBandModel = ({ snapshot, agents = [], activity = EMPTY_ACTIVITY, usage = null, now, band = "always", isWorking = false, notice = null, completion = null, skills = [], lastDiscipline = null, git = null, step = null, threadReserve = 0, lists = EMPTY_LISTS, tasks = EMPTY_TASKS }) => {
  const discipline = snapshot.ignition?.discipline ?? null;
  const progress = progressOf(snapshot);
  const completing = completion !== null;
  const phases = phasesOf({ snapshot, discipline, progress, completing });
  const liveAgents = agents.filter((agent) => LIVE_AGENT.has(agent.status));
  const boulderLanes = (snapshot.work?.lanes ?? []).filter(({ status }) => status === "active");
  const stalls = stalledLanes(agents, activity, now);
  const stalledIds = new Set(stalls.map(({ id }) => id));
  const lanes = liveAgents.length > 0
    ? liveAgents.slice(0, 6).map((agent) => ({
      id: agent.id,
      name: laneName(agent),
      status: stalledIds.has(agent.id) ? "stalled" : agent.status,
      elapsedMs: Number.isFinite(activity.first[agent.id]) ? now - activity.first[agent.id] : null,
    }))
    : boulderLanes.slice(0, 6).map((lane) => ({ name: lane.type, status: "running", elapsedMs: Number.isFinite(lane.startedAt) ? now - lane.startedAt : null }));
  const goal = snapshot.goal;
  const autoloop = goal?.autoloop && goal.status === "active" && snapshot.autoloop
    ? { n: snapshot.autoloop.blockCount, max: AUTOLOOP_LIMITS.blocks, leftMs: Math.max(0, snapshot.autoloop.firstBlockAt + AUTOLOOP_LIMITS.ms - now) }
    : null;
  const ctxWarning = contextWarningOf(snapshot, usage);
  const warnings = stalls.map(({ name, quietMs }) => ({ tone: "amber", subject: name, text: `quiet for ${formatDuration(quietMs)}`, hint: "wake it? (ctrl+x tab)" }));
  const probe = snapshot.probe;
  if (probe?.issue && probe.issueAt >= (probe.editAt ?? 0)) warnings.push({ tone: "red", subject: "ui probe", text: probe.issue, hint: "interface check failed" });
  const active = Boolean(snapshot.work) || goalIsOpen(goal) || (discipline !== null && isWorking) || liveAgents.length > 0;
  const lit = skills.some(({ state }) => state === "current");
  const workflow = buildWorkflow({ snapshot, skills, completion, now });
  const title = discipline ?? skills.find(({ state }) => state === "current")?.id ?? lastDiscipline;
  const visible = band === "off" ? false : band === "always" || active || lit || notice !== null || completion !== null || warnings.length > 0;
  return {
    visible,
    idle: !active && !lit,
    discipline,
    title: workflow?.paused ? crumbOf(workflow.paused) : title,
    phases,
    progress,
    next: snapshot.work?.nextTask ?? (goalIsOpen(goal) ? goal.criteria.find(({ status }) => status !== "pass")?.description || goal.objective || null : null),
    lanes: { count: lanes.length, list: lanes },
    threads: threadsOf({ snapshot, lanes, tasks: Object.values(pruneBackgroundTasks(tasks, now)), lists, now, threadReserve }),
    autoloop,
    ctxWarning,
    warnings,
    gates: gatesOf(snapshot),
    goal: goalSummaryOf(goal),
    skills: skills.map(({ id, at, state }) => ({ id, at, state })),
    figures: figuresOf(usage, git),
    workflow,
    step: step && isWorking && stepName(step.name) ? { name: stepName(step.name), elapsedMs: Math.max(0, now - step.at) } : null,
    notice,
    completion,
  };
};

// `lit-loop || > lit-brainstorm`, or `lit-loop || > … > lit-brainstorm` with a side between them.
const crumbOf = ({ parent, child, chain }) => `${parent} || > ${chain.length > 1 ? "… > " : ""}${child}`;

/**
 * The spinner's suffix: the ellipsis Claude Code drew, then the discipline and the progress count,
 * or the paused parent and its count while a side runs over it.
 */
export const spinnerSuffix = (model, base = "…") => {
  if (!model?.visible || !model.discipline) return null;
  const paused = model.workflow?.paused;
  if (paused) return `${base} · ${paused.child} (|| ${paused.parent}${paused.count ? ` ${paused.count.done}/${paused.count.total}` : ""})`;
  const count = model.progress ? ` · ${model.progress.done}/${model.progress.total}` : "";
  return `${base} · ${model.discipline}${count}`;
};

/**
 * Gate events worth a notice, found by comparing the previous snapshot with this one. The first
 * snapshot of a session raises nothing: only changes seen while the mod watches are announced.
 */
export const diffNotices = (previous, next, previousModel = null, nextModel = null) => {
  if (!previous) return [];
  const notices = [];
  const plan = next.litPlan;
  if (plan && plan.blockCount > (previous.litPlan?.blockCount ?? 0)) {
    notices.push({ id: `plan:${plan.promptAt}:${plan.blockCount}`, tone: "pink", title: "lit-plan is not saved yet", detail: `save plans/<slug>.md before working · stop ${plan.blockCount}/${GATE_LIMITS.litPlan}` });
  }
  const probe = next.probe;
  if (probe?.issue && probe.issueAt !== null && probe.issueAt !== previous.probe?.issueAt) {
    notices.push({ id: `probe-fail:${probe.issueAt}`, tone: "red", title: "interface probe failed", detail: probe.issue });
  } else if (probe && probe.blockCount > (previous.probe?.blockCount ?? 0)) {
    notices.push({ id: `probe:${probe.editAt}:${probe.blockCount}`, tone: "amber", title: "interface probe pending", detail: `run the interface probe before finishing · stop ${probe.blockCount}/${GATE_LIMITS.probe}` });
  }
  const motion = next.motion;
  if (motion && motion.blockCount > (previous.motion?.blockCount ?? 0)) {
    notices.push({ id: `motion:${motion.blockCount}:${motion.runs}`, tone: "amber", title: "motion gate: the film is not done", detail: `stop ${motion.blockCount}/${GATE_LIMITS.motion}` });
  }
  const handoff = next.handoff;
  if (handoff?.firedAt !== null && handoff?.firedAt !== undefined && handoff.firedAt !== previous.handoff?.firedAt) {
    notices.push({ id: `handoff:${handoff.firedAt}`, tone: "pink", title: `auto-handoff fired at ${handoff.firedAtPercent ?? handoff.percent}%`, detail: "write the handoff, then run /compact" });
  }
  if (nextModel?.ctxWarning && !previousModel?.ctxWarning) {
    const { percent, threshold } = nextModel.ctxWarning;
    notices.push({ id: `ctx:${threshold}:${percent}`, tone: "amber", title: `context ${percent}%`, detail: `auto-handoff is armed at ${threshold}%` });
  }
  return notices;
};

/** A finish worth the completion moment: all tasks checked, a work completed, or a goal met. */
export const detectCompletion = (previous, next) => {
  if (!previous) return null;
  const before = previous.work;
  if (before && before.total > 0) {
    const after = next.work?.id === before.id ? next.work : null;
    const finished = next.completedWorkIds.includes(before.id) || (after !== null && before.checked < before.total && after.checked >= after.total);
    if (finished) return { id: `work:${before.id}`, detail: `${before.total}/${before.total} tasks` };
  }
  const goal = next.goal;
  if (goal?.status === "complete" && previous.goal && previous.goal.status !== "complete") {
    const passed = goal.criteria.filter(({ status }) => status === "pass").length;
    return { id: `goal:${goal.createdAt ?? goal.objective}`, detail: `goal met · ${passed}/${goal.criteria.length} criteria` };
  }
  return null;
};

/** The evidence pane: goal criteria, blockers, the litgoal timeline, lanes and gates. */
export const buildEvidenceModel = ({ snapshot, ledger = [], agents = [], activity = EMPTY_ACTIVITY, now, icons = null }) => {
  const goal = snapshot.goal;
  return {
    goal: goal
      ? {
        objective: goal.objective,
        status: goal.status,
        criteria: goal.criteria.map((criterion) => ({ ...criterion, ago: formatAgo(criterion.lastAt, now) })),
        blockers: goal.blockers,
        reviewBlocked: goal.lastCheckpoint === "review_blocked",
      }
      : null,
    timeline: ledger.map((entry) => ({ ...entry, ago: formatAgo(entry.at, now) })),
    lanes: agents.map((agent) => ({
      name: laneName(agent),
      type: agent.type,
      status: agent.status,
      quiet: Number.isFinite(activity.last[agent.id]) ? formatDuration(now - activity.last[agent.id]) : null,
    })),
    gates: gatesOf(snapshot),
    work: snapshot.work ? { plan: snapshot.work.planName, done: snapshot.work.checked, total: snapshot.work.total, next: snapshot.work.nextTask } : null,
    icons,
  };
};
