// Where the session stands in the LIT workflow, for the card's map row and detail line. Pure: the
// mod hands in the state snapshot (state.mjs), the discipline or skill that last lit and the time,
// and gets back the family's stages with the current one marked and what to say about it.
//
// Three families. The main chain runs a request from the interview to review (litgoal and
// autoresearch ride its work stage with criteria or iterations); litresearch has its own waves; a
// lit-loop criterion cycles through its test-first steps. The stage comes from the newest of the
// ignited discipline, a skill this request fired and the stage record (`.litclaude/
// workflow-stage.json`, written by the prompt hook and `litclaude-ai workflow-stage`); without
// any of those, from the durable state that says work is under way. The durable state also fills
// in the detail: interview rounds, the plan draft's status, the work's tasks, research waves.

export const WORKFLOW_FAMILIES = Object.freeze({
  main: Object.freeze(["interview", "plan", "work", "review", "done"]),
  research: Object.freeze(["decompose", "wave", "expand", "verify", "synthesis"]),
  loop: Object.freeze(["PIN", "RED", "GREEN", "VERIFY", "REVIEW", "RECORD"]),
});

// lit-loop writes eight steps; the map shows six, so SURFACE sits on VERIFY and CLEAN on RECORD.
export const STAGE_ALIASES = Object.freeze({ SURFACE: "VERIFY", CLEAN: "RECORD" });
// The review's five lanes as the card names them, in the card's order, and the words that name
// each lane in review-work's own lane titles (`Review lane: scope/diff verification.`) and in
// records written before the card took these names. The first word found in a title wins.
export const REVIEW_LANES = Object.freeze([
  Object.freeze({ id: "goal", words: Object.freeze(["goal", "scope", "diff"]) }),
  Object.freeze({ id: "quality", words: Object.freeze(["quality", "package", "payload"]) }),
  Object.freeze({ id: "security", words: Object.freeze(["security", "provenance"]) }),
  Object.freeze({ id: "qa", words: Object.freeze(["qa", "tests", "evidence"]) }),
  Object.freeze({ id: "context", words: Object.freeze(["context", "surface", "docs", "readiness"]) }),
]);
export const STAGE_UNITS = Object.freeze(["task", "criterion", "iteration", "wave", "round"]);
// `running` is a lane whose reviewer has started and not yet reported.
export const VERDICT_STATES = Object.freeze(["pass", "fail", "pending", "running"]);

/** The card's lane for a lane title or a recorded lane name, or null when none of its words occur. */
export const reviewLaneOf = (title) => {
  const words = String(title ?? "").toLowerCase().split(/[^a-z]+/u).filter(Boolean);
  for (const word of words) {
    const lane = REVIEW_LANES.find((candidate) => candidate.words.includes(word));
    if (lane) return lane.id;
  }
  return null;
};
// A source older than this no longer says where the session is.
export const WORKFLOW_FRESH_MS = 6 * 60 * 60 * 1000;

// Where each discipline enters the map.
export const DISCIPLINE_ENTRY = Object.freeze({
  "deep-interview": { family: "main", stage: "interview" },
  "lit-brainstorm": { family: "main", stage: "interview" },
  "lit-crucible": { family: "main", stage: "plan" },
  "lit-plan": { family: "main", stage: "plan" },
  "start-work": { family: "main", stage: "work" },
  litwork: { family: "main", stage: "work" },
  litgoal: { family: "main", stage: "work" },
  autoresearch: { family: "main", stage: "work" },
  "review-work": { family: "main", stage: "review" },
  litresearch: { family: "research", stage: "decompose" },
  "lit-loop": { family: "loop", stage: "PIN" },
});

export const normalizeStage = (family, stage) => {
  const stages = WORKFLOW_FAMILIES[family];
  if (!stages) return null;
  const raw = String(stage ?? "").trim();
  const named = family === "loop" ? STAGE_ALIASES[raw.toUpperCase()] ?? raw.toUpperCase() : raw.toLowerCase();
  return stages.includes(named) ? named : null;
};

const count = (value) => (Number.isInteger(value) && value >= 0 && value <= 9999 ? value : null);

/**
 * The stage record as the card trusts it: a known family and stage, at most eight verdicts and
 * nothing else. A record names the session that wrote it, or none when `litclaude-ai
 * workflow-stage` could not tell; another session's record is ignored.
 */
export const parseStageRecord = (record, sessionId) => {
  if (!record || typeof record !== "object") return null;
  if (typeof record.sessionId === "string" && record.sessionId !== sessionId) return null;
  const family = typeof record.family === "string" && WORKFLOW_FAMILIES[record.family] ? record.family : null;
  const stage = family ? normalizeStage(family, record.stage) : null;
  const at = typeof record.at === "string" ? Date.parse(record.at) : Number.NaN;
  if (!stage || !Number.isFinite(at)) return null;
  const verdicts = Object.entries(record.verdicts && typeof record.verdicts === "object" ? record.verdicts : {})
    .filter(([name, state]) => /^[a-z][a-z0-9-]{0,23}$/u.test(name) && VERDICT_STATES.includes(state))
    .slice(0, 8);
  return {
    family,
    stage,
    step: typeof record.stage === "string" ? record.stage.trim().slice(0, 24) : stage,
    n: count(record.n),
    total: count(record.total),
    unit: STAGE_UNITS.includes(record.unit) ? record.unit : null,
    done: record.done === true,
    verdicts: Object.fromEntries(verdicts),
    at,
  };
};

const fresh = (source, now) => Boolean(source) && Number.isFinite(source.at) && now - source.at <= WORKFLOW_FRESH_MS;

// The newest of the ignition, the newest current skill and the record that names a stage.
const entryOf = ({ snapshot, skills, now }) => {
  const candidates = [];
  const ignition = snapshot.ignition;
  if (ignition && DISCIPLINE_ENTRY[ignition.discipline]) candidates.push({ ...DISCIPLINE_ENTRY[ignition.discipline], at: ignition.at ?? 0, from: "ignition" });
  const chip = skills.find(({ id, state }) => state === "current" && DISCIPLINE_ENTRY[id]);
  if (chip) candidates.push({ ...DISCIPLINE_ENTRY[chip.id], at: chip.at ?? 0, from: "skill" });
  const record = snapshot.workflow?.record;
  if (fresh(record, now)) candidates.push({ family: record.family, stage: record.stage, at: record.at, from: "record", record });
  // The record is written a moment after the ignition it answers, so a tie goes to the record.
  return candidates.sort((a, b) => b.at - a.at || (a.from === "record" ? -1 : 1))[0] ?? null;
};

// A finished goal ends the map unless a stage record, skill or ignition came after it: that is a
// new request, and the old finish says nothing about it.
const goalFinished = (goal, entry) => goal?.status === "complete" && !(Number.isFinite(goal.completedAt) && Number.isFinite(entry?.at) && entry.at > goal.completedAt);

const goalIsOpen = (goal) => Boolean(goal && ["active", "blocked", "review_blocked", "needs_user_decision"].includes(goal.status));

// Without a discipline or a record, the durable state that says work is under way.
const inferredEntry = (snapshot, now) => {
  const sources = snapshot.workflow ?? {};
  if (snapshot.work || goalIsOpen(snapshot.goal)) return { family: "main", stage: "work" };
  if (snapshot.goal?.status === "complete") return { family: "main", stage: "done" };
  if (fresh(sources.draft, now) && ["drafting", "awaiting-approval"].includes(sources.draft.status)) return { family: "main", stage: "plan" };
  if (fresh(sources.interview, now) && sources.interview.active) return { family: "main", stage: "interview" };
  if (fresh(sources.research, now) && !sources.research.synthesis) return { family: "research", stage: "decompose" };
  return null;
};

const researchStage = (research) => {
  if (!research) return "decompose";
  if (research.synthesis) return "synthesis";
  if (research.verified > 0) return "verify";
  if (research.wave >= 2) return "expand";
  return research.wave >= 1 ? "wave" : "decompose";
};

// The five lanes in the card's order, each with the newest verdict recorded under any of its names.
const laneVerdicts = (recorded) => {
  const states = {};
  for (const [name, state] of Object.entries(recorded)) {
    const lane = reviewLaneOf(name);
    if (lane) states[lane] = state;
  }
  return REVIEW_LANES.map(({ id }) => ({ name: id, state: states[id] ?? "pending" }));
};

// A task or criterion as the card shows it: the plan's Markdown emphasis and code marks dropped.
const plainText = (text) => (typeof text === "string" ? text.replace(/\*\*|__|`/gu, "").trim() || null : null);

const percent = (value) => (Number.isFinite(value) ? Math.round(value <= 1 ? value * 100 : value) : null);

/**
 * The map: `{ family, stages: [{ id, label, state }], current, count, items, verdicts, next }`,
 * or null when nothing places the session on a family's map (the card then keeps its PLAN / WORK /
 * REVIEW track). `state` is done, now or todo; `current` is the index of the stage that is now,
 * or -1 once the family is done. `count` is the current stage's n/m, `items` short facts about
 * it, `verdicts` the review lanes or a crucible verdict, `next` the next task or criterion.
 */
export const buildWorkflow = ({ snapshot, skills = [], completion = null, now }) => {
  const entry = entryOf({ snapshot, skills, now }) ?? inferredEntry(snapshot, now);
  if (!entry) return null;
  const { family } = entry;
  const sources = snapshot.workflow ?? {};
  const record = entry.record ?? (fresh(sources.record, now) && sources.record.family === family ? sources.record : null);
  let stage = entry.stage;
  const items = [];
  let countOf = null;
  let verdicts = null;
  let next = null;

  if (family === "main") {
    const work = snapshot.work;
    const goal = snapshot.goal;
    // A saved plan finishes the plan stage: the map moves on to the work it is ready for.
    const planSaved = stage === "plan" && record?.stage === "plan" && record.done;
    if (planSaved) stage = "work";
    const lanes = record?.stage === "review" ? laneVerdicts(record.verdicts) : null;
    if (completion || goalFinished(goal, entry) || stage === "done") stage = "done";
    else if (stage === "work" && !work && !goalIsOpen(goal) && snapshot.completedWorkIds.length > 0) stage = "review";
    else if (stage === "review" && lanes?.every(({ state }) => state === "pass")) stage = "done";
    if (planSaved && stage === "work" && !work) items.push("plan saved");
    if (stage === "interview" && fresh(sources.interview, now)) {
      const { round, max, ambiguity, threshold } = sources.interview;
      if (round !== null) items.push(max ? `round ${round}/${max}` : `round ${round}`);
      if (percent(ambiguity) !== null) items.push(`ambiguity ${percent(ambiguity)}%${percent(threshold) !== null ? ` → ${percent(threshold)}%` : ""}`);
    }
    if (stage === "plan" && fresh(sources.draft, now)) items.push(sources.draft.status === "awaiting-approval" ? "awaiting approval" : sources.draft.status);
    if (stage === "work") {
      // The hooks count the plan's tasks each time the plan file is edited, ahead of start-work's
      // own progress record; the next task is the boulder's only while the two agree.
      const counted = record?.stage === "work" && record.unit === "task" && record.total ? record : null;
      if (work && (work.total > 0 || counted)) {
        countOf = counted ? { done: Math.min(counted.n ?? 0, counted.total), total: counted.total, unit: "task" } : { done: work.checked, total: work.total, unit: "task" };
        next = countOf.done === work.checked ? plainText(work.nextTask) : null;
        if (work.status === "paused" || work.lastEvent === "work.paused") items.push("paused · approval needed");
      } else if (goalIsOpen(goal) && goal.criteria.length > 0) {
        countOf = { done: goal.criteria.filter(({ status }) => status === "pass").length, total: goal.criteria.length, unit: "criterion" };
        next = plainText(goal.criteria.find(({ status }) => status !== "pass")?.description);
      } else if (record?.stage === "work" && record.total) {
        countOf = { done: Math.min(record.n ?? 0, record.total), total: record.total, unit: record.unit ?? "iteration" };
      }
    }
    if (stage === "review") {
      verdicts = lanes ?? laneVerdicts({});
    } else if (record?.stage === stage && Object.keys(record.verdicts).length > 0) {
      verdicts = Object.entries(record.verdicts).map(([name, state]) => ({ name, state }));
    }
    if (stage === "done") items.push("complete");
  } else if (family === "research") {
    const research = fresh(sources.research, now) ? sources.research : null;
    const filed = researchStage(research);
    const order = WORKFLOW_FAMILIES.research;
    stage = order.indexOf(filed) > order.indexOf(stage) ? filed : stage;
    if (record && order.indexOf(record.stage) > order.indexOf(stage)) stage = record.stage;
    if (research?.digests > 0) items.push(`${research.digests} ${research.digests === 1 ? "digest" : "digests"}`);
    if (research?.verified > 0) items.push(`${research.verified} verified`);
    if (stage === "synthesis") items.push("synthesis written");
  } else if (family === "loop") {
    const goal = snapshot.goal;
    if (record && record.total) {
      countOf = { done: Math.min(record.n ?? 0, record.total), total: record.total, unit: record.unit ?? "criterion" };
    } else if (goalIsOpen(goal) && goal.criteria.length > 0) {
      countOf = { done: goal.criteria.filter(({ status }) => status === "pass").length, total: goal.criteria.length, unit: "criterion" };
      next = goal.criteria.find(({ status }) => status !== "pass")?.description || null;
    }
    if (record && record.step.toUpperCase() !== record.stage) items.push(record.step.toLowerCase());
    if (completion) stage = "RECORD";
  }

  const order = WORKFLOW_FAMILIES[family];
  const finished = family === "main" ? stage === "done" : completion !== null || (family === "loop" && goalFinished(snapshot.goal, entry));
  const current = finished ? -1 : order.indexOf(stage);
  const wave = sources.research?.wave ?? 0;
  const stages = order.map((id, index) => {
    let label = id;
    if (index === current && countOf && family === "main") label = `${id} ${countOf.done}/${countOf.total}`;
    if (family === "research" && id === "wave" && wave > 0) label = `wave ${wave}`;
    return { id, label, state: finished || index < current ? "done" : index === current ? "now" : "todo" };
  });
  return { family, stages, current, count: countOf, items, verdicts, next };
};
