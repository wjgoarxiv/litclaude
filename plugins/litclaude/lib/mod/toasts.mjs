// The toasts the mod raises when the LIT state really changes: a discipline starts or switches, the
// workflow stage moves, a goal is set or met, a lane starts or finishes. Pure: the mod keeps the last
// status it saw and a gate, and hands each new status in; what comes back is at most one short line
// to show, never more than one per TOAST_GAP_MS. Gate notices (state.mjs gates, the auto-handoff)
// pass through the same gate as `{ kind: "notice", text }`.

import { DISCIPLINE_ENTRY } from "./workflow.mjs";

export const TOAST_GAP_MS = 3000;
// A burst longer than this many lines ends in `+N more`.
const SHOWN = 3;

const cut = (text, cells) => (text.length > cells ? `${text.slice(0, cells - 1)}…` : text);

/**
 * What a toast compares: the discipline (sticky: a prompt or skill that names none keeps the last),
 * the current stage, the goal and the running lanes by id. `discipline` is the one the session last
 * lit, `model` the band model, `snapshot` the state snapshot.
 */
export const statusOf = ({ discipline, model, snapshot }, previous = null) => {
  const flow = model?.workflow;
  const stage = flow && flow.current >= 0 ? flow.stages[flow.current]?.id ?? null : null;
  const goal = snapshot?.goal;
  return {
    discipline: DISCIPLINE_ENTRY[discipline] ? discipline : previous?.discipline ?? null,
    stage: stage && `${flow.family}:${stage}`,
    goal: goal ? { key: goal.createdAt ?? goal.objective, objective: String(goal.objective ?? ""), status: goal.status, passed: goal.criteria.filter(({ status }) => status === "pass").length, total: goal.criteria.length } : null,
    lanes: Object.fromEntries((model?.lanes?.list ?? []).filter(({ id }) => id).map(({ id, name }) => [id, name])),
  };
};

const laneEntries = (ids, names, verb) => {
  if (ids.length === 0) return [];
  return [{ kind: `lane-${verb}`, text: ids.length === 1 ? `lane ${verb === "start" ? "started" : "finished"} · ${names[ids[0]]}` : `${ids.length} lanes ${verb === "start" ? "started" : "finished"}` }];
};

/** The changes from one status to the next, as toast entries; none for the first status seen. */
export const statusChanges = (previous, next) => {
  if (!previous) return [];
  const entries = [];
  if (next.discipline && next.discipline !== previous.discipline) entries.push({ kind: "discipline", from: previous.discipline, to: next.discipline });
  else if (next.stage && next.stage !== previous.stage) entries.push({ kind: "stage", text: `stage · ${next.stage.split(":")[1]}` });
  const goal = next.goal;
  const sameGoal = goal && previous.goal?.key === goal.key;
  if (goal && !sameGoal && goal.status !== "complete") entries.push({ kind: "goal", text: `goal set · ${cut(goal.objective, 40)}` });
  if (goal?.status === "complete" && !(sameGoal && previous.goal.status === "complete")) entries.push({ kind: "goal", text: `goal met · ${goal.passed}/${goal.total}` });
  const started = Object.keys(next.lanes).filter((id) => !(id in previous.lanes));
  const finished = Object.keys(previous.lanes).filter((id) => !(id in next.lanes));
  entries.push(...laneEntries(started, next.lanes, "start"), ...laneEntries(finished, previous.lanes, "finish"));
  return entries;
};

/**
 * One line for the entries that waited: a chain of switches shows its two ends (and nothing when it
 * came back where it started), a stage only its newest, repeats once, past SHOWN lines `+N more`.
 * Null when nothing is left to say.
 */
export const mergeToasts = (entries) => {
  let switched = null;
  let stage = null;
  const lines = [];
  for (const entry of entries) {
    if (entry.kind === "discipline") {
      switched = switched ? { ...switched, to: entry.to } : { from: entry.from, to: entry.to, at: lines.length };
    } else if (entry.kind === "stage") {
      stage = { text: entry.text, at: lines.length };
    } else if (!lines.includes(entry.text)) {
      lines.push(entry.text);
    }
  }
  if (stage) lines.splice(stage.at, 0, stage.text);
  if (switched && switched.from !== switched.to) lines.splice(switched.at, 0, switched.from ? `${switched.from} → ${switched.to}` : `${switched.to} started`);
  if (lines.length === 0) return null;
  const shown = lines.length > SHOWN ? [...lines.slice(0, SHOWN), `+${lines.length - SHOWN} more`] : lines;
  return `🔥 ${shown.join(" · ")}`;
};

/**
 * The rate gate: `{ lastAt, pending }`. Entries join what is pending; once TOAST_GAP_MS has passed
 * since the last toast, all of it shows as one line. Otherwise `waitMs` says how long until it may.
 */
export const gateToast = (gate, entries, now) => {
  const pending = [...gate.pending, ...entries];
  if (pending.length === 0) return { gate, show: null, waitMs: null };
  const waitMs = gate.lastAt + TOAST_GAP_MS - now;
  if (waitMs > 0) return { gate: { ...gate, pending }, show: null, waitMs };
  const show = mergeToasts(pending);
  return { gate: { lastAt: show ? now : gate.lastAt, pending: [] }, show, waitMs: null };
};
