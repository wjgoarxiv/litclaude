// LitClaude's Claude Code mod (hooks/hooks.json `modules`). It draws the LIT card above the prompt
// for the whole session (the `band` setting can limit it to active work or turn it off): where the
// session stands in the LIT workflow, the tool the main loop is running and for how long, a chip
// for each LitFamily skill that fires. It adds the discipline and progress to the spinner, raises
// a toast when the LIT status changes (at most one each three seconds) and gate notices, serves /lit-evidence and, when the `notify` option asks, raises a notification
// when LIT work completes or a long LIT turn ends. It is read-only: it reads LitClaude's own state
// files and the Git HEAD through lib/mod/state.mjs, the settings for the status line's accent, and
// the host's live figures, and never writes, spawns, fetches or calls a model. Of a tool call it
// keeps the tool's name and start time, never its arguments, with three exceptions that keep counts
// and names only: the statuses of a TodoWrite or a task-list call (each loop's k/n on the card), and
// the task id and description a background Bash or Monitor call answers (a thread row until its
// notification, which is read for the task's id and status alone).
// Claude Code releases before mods ignore the `modules` key and keep running the settings hooks.
//
// The mods loader only follows `$` into functions declared at the top of this file, so each helper
// below takes `$` and the per-load `live` record explicitly instead of closing over them.

import { composeBand, composeEvidence } from "../lib/mod/frame.mjs";
import { TIMINGS } from "../lib/mod/motion.mjs";
import { renderBand, renderRows } from "../lib/mod/render.mjs";
import { accentFromSettings, effectiveMotion, normalizeModSettings, resolveGlyphs } from "../lib/mod/settings.mjs";
import { composeSvgCard } from "../lib/mod/svg-card.mjs";
import { chipStates, litSkillId, noteSkill } from "../lib/mod/skills.mjs";
import { TOAST_GAP_MS, gateToast, statusChanges, statusOf } from "../lib/mod/toasts.mjs";
import { detectIconFont, readGitBranch, readLedgerTail, readLitSnapshot } from "../lib/mod/state.mjs";
import { settledSample } from "../lib/mod/timeline.mjs";
import {
  EMPTY_ACTIVITY,
  EMPTY_LISTS,
  EMPTY_TASKS,
  buildBandModel,
  buildEvidenceModel,
  detectCompletion,
  diffNotices,
  endBackgroundTask,
  endedTaskIds,
  formatDuration,
  mergeSpawned,
  noteAgentActivity,
  noteBackgroundTask,
  noteLoopCall,
  noteSpawn,
  noteSpawnActivity,
  noteSpawnEnded,
  spinnerSuffix,
  trackAgents,
} from "../lib/mod/view.mjs";

const PANE = "lit-evidence";
const POLL_MS = 2000;
const QUICK_REFRESH_MS = 250;
const TABS = Object.freeze([
  { id: "goal", label: "goal", hotkey: "1" },
  { id: "lanes", label: "lanes", hotkey: "2" },
  { id: "gates", label: "gates", hotkey: "3" },
]);
const NO_SNAPSHOT = Object.freeze({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null, workflow: null });
// A LIT turn at least this long notifies when it ends, under `notify`.
const LONG_TURN_MS = 3 * 60 * 1000;

const createLive = (options) => ({
  band: normalizeModSettings(options).band,
  motion: normalizeModSettings(options).motion,
  drawnOn: {},
  iconFont: { present: false, path: null, note: "basic: not checked yet" },
  env: {},
  snapshot: null,
  model: null,
  agents: [],
  spawned: {},
  usage: null,
  activity: EMPTY_ACTIVITY,
  statusById: {},
  isWorking: false,
  notice: null,
  completion: null,
  status: null,
  toast: { lastAt: Number.NEGATIVE_INFINITY, pending: [] },
  toastWaiting: false,
  exiting: false,
  clientFailed: false,
  refreshing: false,
  quickPending: false,
  paneOpen: false,
  evidenceTab: "goal",
  ledger: [],
  celebrated: new Set(),
  accent: undefined,
  git: null,
  fired: [],
  settledAt: 0,
  ignitionAt: undefined,
  lastDiscipline: null,
  step: null,
  mainToolCalls: 0,
  turnStartedAt: null,
  turnNotified: false,
  lists: EMPTY_LISTS,
  tasks: EMPTY_TASKS,
});

const stateIo = ($) => ({
  stat: (path) => $.fs.stat(path, { resolve: true }),
  read: (path) => $.fs.read(path),
  list: (path) => $.fs.list(path),
});

const noticeEntry = (raised) => ({ kind: "notice", text: `${raised.title}${raised.detail ? ` · ${raised.detail}` : ""}` });

// Every toast passes the gate (toasts.mjs): one now, or the lot as one line once the gap is over.
function raiseToasts($, live, entries, now) {
  const { gate, show, waitMs } = gateToast(live.toast, entries, now);
  live.toast = gate;
  if (show) $.ui.toast(show);
  if (waitMs === null || live.toastWaiting) return;
  live.toastWaiting = true;
  $.clock.after(waitMs, async () => {
    live.toastWaiting = false;
    raiseToasts($, live, [], Math.max(await $.clock.now(), live.toast.lastAt + TOAST_GAP_MS));
  });
}

// The model less what moves with time alone: the step clock, the loop countdown, the lanes' run times.
const stillModel = (model) => model && {
  ...model,
  step: model.step && { name: model.step.name },
  autoloop: model.autoloop && { n: model.autoloop.n, max: model.autoloop.max },
  lanes: { ...model.lanes, list: model.lanes.list.map(({ elapsedMs, ...lane }) => lane) },
};

// What the card would show on each surface still attached. Invalidation redraws every surface at
// once, and the desktop's Svg is loaded afresh with each new source, restarting its animations; so
// while a drawing surface is attached, time alone never redraws: it is compared by its drawing and
// the terminal by the still model (its surface module counts the step clock on by itself). A
// terminal on its own is compared by the whole model, so its countdown and lane times move too.
function drawnKey(live, model) {
  const kinds = new Set(Object.values(live.drawnOn));
  if (kinds.size === 0) return JSON.stringify(model);
  const withSvg = kinds.has("svg");
  return [...kinds].map((kind) => (kind === "svg"
    ? (model?.visible ? composeSvgCard(model, { motion: live.motion, accent: live.accent }).source : "hidden")
    : JSON.stringify(withSvg ? stillModel(model) : model))).join("\n");
}

async function rebuild($, live) {
  const now = await $.clock.now();
  const previous = live.model;
  const next = buildBandModel({
    snapshot: live.snapshot ?? NO_SNAPSHOT,
    agents: live.agents,
    activity: live.activity,
    usage: live.usage,
    now,
    band: live.band,
    isWorking: live.isWorking,
    notice: live.notice,
    completion: live.completion,
    skills: chipStates(live.fired, live.settledAt),
    lastDiscipline: live.lastDiscipline,
    git: live.git,
    step: live.step,
    lists: live.lists,
    tasks: live.tasks,
    // The thread rows stay reserved while threads are live, so the card does not shrink between repaints.
    threadReserve: previous?.threads?.reserve ?? 0,
  });
  live.model = next;
  // The status is compared from the first snapshot on, so what was already there is not announced.
  if (live.snapshot) {
    const status = statusOf({ discipline: live.lastDiscipline, model: next, snapshot: live.snapshot }, live.status);
    const changes = statusChanges(live.status, status);
    live.status = status;
    if (changes.length > 0) raiseToasts($, live, changes, now);
  }
  if (previous?.visible && !next.visible && !live.exiting) {
    // Keep the band mounted while its surface module plays the exit, then let it go.
    live.exiting = true;
    $.clock.after(TIMINGS.exit + 80, () => {
      live.exiting = false;
      $.ui.invalidate("ui.render");
    });
  }
  if (drawnKey(live, previous) !== drawnKey(live, next)) $.ui.invalidate("ui.render");
  return next;
}

function showNotice($, live, raised) {
  live.notice = raised;
  $.clock.after(TIMINGS.noticeHold, () => {
    if (live.notice?.id !== raised.id) return;
    live.notice = null;
    void rebuild($, live);
  });
}

// The opt-in finish notification. No sound file ships yet, so `finish+sound` notifies like `finish`.
function notifyFinish($, options, text) {
  if (normalizeModSettings(options).notify === "off") return;
  $.ui.notify(text, { title: "LitClaude" }).catch(() => undefined);
}

function celebrate($, live, finish, options) {
  if (live.celebrated.has(finish.id)) return;
  live.celebrated.add(finish.id);
  live.completion = finish;
  live.turnNotified = true;
  notifyFinish($, options, `LIT complete · ${finish.detail}`);
  $.clock.after(TIMINGS.completion + 200, () => {
    if (live.completion?.id !== finish.id) return;
    live.completion = null;
    void rebuild($, live);
  });
}

// A firing of a skill or command by name; anything that is not LitClaude's is ignored.
async function noteFiring($, live, name) {
  const id = litSkillId(name);
  if (!id) return;
  live.fired = noteSkill(live.fired, id, await $.clock.now());
  live.lastDiscipline = id;
  await rebuild($, live);
}

// The prompt hook rewrites the ignition record on every prompt; a new record naming a discipline is
// a bare `lit` (or slash) routing, and lights that skill's chip at the time the hook wrote it.
function noteIgnition(live, ignition, now) {
  if (!ignition || ignition.at === live.ignitionAt) return;
  live.ignitionAt = ignition.at;
  live.lastDiscipline = ignition.discipline;
  const id = litSkillId(ignition.discipline);
  if (id) live.fired = noteSkill(live.fired, id, ignition.at ?? now);
}

// What a finished call says of the thread rows: its loop's list counts, a background task it
// started, or one it stopped. A refused or failed call starts nothing.
function noteToolOutcome(live, e, outcome, now) {
  if (!outcome || outcome.deny !== undefined) return;
  const output = outcome.isError ? null : outcome.result;
  live.lists = noteLoopCall(live.lists, typeof e.agentId === "string" ? e.agentId : "main", e, output);
  if (!output || typeof output !== "object") return;
  if (e.tool === "Bash" && typeof output.backgroundTaskId === "string") {
    live.tasks = noteBackgroundTask(live.tasks, { id: output.backgroundTaskId, kind: "shell", name: e.description, at: now });
  } else if (e.tool === "Monitor" && typeof output.taskId === "string") {
    const timeout = Number.isFinite(output.timeoutMs) && output.timeoutMs > 0 ? output.timeoutMs : null;
    live.tasks = noteBackgroundTask(live.tasks, { id: output.taskId, kind: "monitor", name: e.description, at: now, until: output.persistent || timeout === null ? null : now + timeout + 5000 });
  } else if (e.tool === "TaskStop") {
    live.tasks = endBackgroundTask(live.tasks, output.task_id ?? e.task_id ?? e.shell_id);
  }
}

async function refresh($, live, options) {
  if (live.refreshing) return;
  live.refreshing = true;
  try {
    const [cwd, sessionId] = await Promise.all([$.session.cwd(), $.session.id()]);
    const fresh = await readLitSnapshot(stateIo($), { cwd, sessionId, env: live.env });
    live.git = await readGitBranch(stateIo($), cwd).catch(() => live.git);
    const listed = await $.agent.list().catch(() => []);
    live.usage = await $.session.usage().catch(() => live.usage);
    const now = await $.clock.now();
    ({ agents: live.agents, spawned: live.spawned } = mergeSpawned(listed, live.spawned, now));
    live.activity = trackAgents(live.activity, live.agents, live.statusById, now);
    live.statusById = Object.fromEntries(live.agents.map((agent) => [agent.id, agent.status]));
    const before = live.snapshot;
    const previousModel = live.model;
    live.snapshot = fresh;
    noteIgnition(live, fresh.ignition, now);
    const finish = detectCompletion(before, fresh);
    if (finish) celebrate($, live, finish, options);
    const next = await rebuild($, live);
    const raised = diffNotices(before, fresh, previousModel, next);
    if (raised.length > 0) {
      raiseToasts($, live, raised.map(noticeEntry), now);
      showNotice($, live, raised.at(-1));
      await rebuild($, live);
    }
    if (live.paneOpen) live.ledger = await readLedgerTail(stateIo($), fresh.stateRoot);
  } catch {
    // A failed read leaves the last good band in place; the next poll tries again.
  } finally {
    live.refreshing = false;
  }
}

function refreshSoon($, live, options) {
  if (live.quickPending) return;
  live.quickPending = true;
  $.clock.after(QUICK_REFRESH_MS, () => {
    live.quickPending = false;
    void refresh($, live, options);
  });
}

export const register = (on, options) => {
  const live = createLive(options);

  on("session.start", async ($, e, next) => {
    live.env = {
      TMPDIR: await $.env.get("TMPDIR"),
      LITCLAUDE_HUD_STATE_ROOT: await $.env.get("LITCLAUDE_HUD_STATE_ROOT"),
      LITCLAUDE_AUTO_HANDOFF: await $.env.get("LITCLAUDE_AUTO_HANDOFF"),
      LITCLAUDE_AUTO_HANDOFF_PERCENT: await $.env.get("LITCLAUDE_AUTO_HANDOFF_PERCENT"),
    };
    live.iconFont = await detectIconFont(stateIo($), {
      HOME: await $.env.get("HOME"),
      XDG_DATA_HOME: await $.env.get("XDG_DATA_HOME"),
      LOCALAPPDATA: await $.env.get("LOCALAPPDATA"),
    });
    live.settledAt = await $.clock.now();
    const hostSettings = await $.settings.read().catch(() => null);
    live.accent = accentFromSettings(hostSettings, await $.env.get("LITCLAUDE_HUD_ACCENT"));
    live.reducedMotion = hostSettings?.prefersReducedMotion === true;
    live.motion = effectiveMotion(live.motion, hostSettings);
    await $.command.register({ name: PANE, description: "Show LitClaude goal criteria, evidence, lanes and gates in a pane" });
    await refresh($, live, options);
    $.clock.every(POLL_MS, () => {
      void refresh($, live, options);
    });
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    live.isWorking = true;
    live.mainToolCalls = 0;
    live.turnStartedAt = await $.clock.now();
    live.turnNotified = false;
    refreshSoon($, live, options);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    // A subagent's or teammate's turn ends its run, not the main turn the card follows.
    if (typeof e.agentId === "string") {
      live.spawned = noteSpawnEnded(live.spawned, e.agentId);
      refreshSoon($, live, options);
      return next(e);
    }
    live.isWorking = false;
    live.step = null;
    live.mainToolCalls = 0;
    const now = await $.clock.now();
    const took = Number.isFinite(e.durationMs) ? e.durationMs : now - (live.turnStartedAt ?? now);
    const lit = live.model && (live.model.discipline || live.model.workflow || live.model.skills.some(({ state }) => state === "current"));
    if (lit && !live.turnNotified && took >= LONG_TURN_MS) {
      live.turnNotified = true;
      notifyFinish($, options, `LIT turn finished · ${live.model.title ?? "LitClaude"} · ${formatDuration(took)}`);
    }
    // The request is over: its chips dim to the recent list until a skill fires again.
    live.settledAt = now;
    refreshSoon($, live, options);
    return next(e);
  });

  on("session.measure", async ($, e, next) => {
    live.usage = { context: e.context, rateLimits: e.rateLimits };
    if (e.changed.includes("context")) refreshSoon($, live, options);
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    // The card follows the main loop: a skill a subagent loads (a reviewer reading `rules`) neither
    // lights a chip nor retitles the card.
    if (e.tool === "Skill" && typeof e.agentId !== "string") await noteFiring($, live, e.skill);
    // A call in flight keeps its agent alive however long it runs (view.mjs mergeSpawned).
    if (typeof e.agentId === "string") live.spawned = noteSpawnActivity(live.spawned, e.agentId, await $.clock.now(), 1);
    // The live step: the main loop's tool by name and since when, nothing else of the call.
    const step = typeof e.agentId === "string" ? null : { name: e.tool, at: await $.clock.now() };
    if (step) live.mainToolCalls += 1;
    if (step) {
      live.step = step;
      await rebuild($, live);
    }
    let result;
    try {
      result = await next(e);
    } finally {
      if (step && live.step === step) live.step = live.isWorking ? { name: "thinking", at: await $.clock.now() } : null;
      if (typeof e.agentId === "string") {
        const now = await $.clock.now();
        live.activity = noteAgentActivity(live.activity, e.agentId, now);
        live.spawned = noteSpawnActivity(live.spawned, e.agentId, now, -1);
      }
    }
    noteToolOutcome(live, e, result, await $.clock.now());
    refreshSoon($, live, options);
    return result;
  }).catch(($, e, next) => next(e));

  // A background task's notification ends its thread row: its text is read for ids alone.
  on("prompt.submit", async ($, e, next) => {
    if (e.origin?.kind === "task-notification") {
      for (const id of endedTaskIds(e.text)) live.tasks = endBackgroundTask(live.tasks, id);
      refreshSoon($, live, options);
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // A model request on the main loop: the step reads "thinking" until a tool call names itself.
  on("turn.step", async function* ($, e, next) {
    if (typeof e.agentId !== "string" && live.isWorking && live.step?.name !== "thinking") live.step = { name: "thinking", at: await $.clock.now() };
    if (typeof e.agentId === "string") live.spawned = noteSpawnActivity(live.spawned, e.agentId, await $.clock.now());
    return yield* next(e);
  });

  // Every subagent, teammate and workflow agent starts here. A workflow's never shows in
  // `$.agent.list()`, so the card keeps its own record until the agent's turn.complete.
  on("agent.spawn", async ($, e, next) => {
    const result = await next(e);
    if (typeof result?.agentId === "string") {
      live.spawned = noteSpawn(live.spawned, { id: result.agentId, description: e.description, type: e.subagentType, at: await $.clock.now() });
      refreshSoon($, live, options);
    }
    return result;
  }).catch(($, e, next) => next(e));

  // A typed `/litclaude:<name>` and the Skill tool both expand the skill's prompt here; the text
  // passes through untouched. So does a subagent's preloaded skill (an agent's `skills:` list),
  // and the event does not say whose it is: a firing counts only before the main loop's first tool
  // call of the turn (a typed command) or inside its Skill call.
  on("skill.prompt", async ($, e, next) => {
    if (live.mainToolCalls === 0 || live.step?.name === "Skill") await noteFiring($, live, e.skill);
    return next(e);
  }).catch(($, e, next) => next(e));

  // A client left: once no client of its surface remains, that surface stops counting.
  on("session.detach", async ($, e, next) => {
    const result = await next(e);
    const roster = await $.session.surfaces();
    if (!roster.includes(e.surface)) delete live.drawnOn[e.surface];
    return result;
  }).catch(($, e, next) => next(e));

  on("ui.fault", async ($, e, next) => {
    if (e.component === "AbovePrompt") live.clientFailed = true;
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const settings = normalizeModSettings(options);
    const motion = effectiveMotion(settings.motion, { prefersReducedMotion: live.reducedMotion });
    const glyphs = resolveGlyphs(settings.glyphs, e.surface, live.iconFont.present);
    const model = live.model;
    if (!model || settings.band === "off" || e.props.hasSurvey || (!model.visible && !live.exiting)) return next(e);
    const elements = $.ui.resolve(e);
    const columns = Math.max(20, e.props.bodyColumns ?? e.viewport?.columns ?? 80);
    let drawn = null;
    live.drawnOn[e.surface] = e.surface !== "terminal" && elements.Svg ? "svg" : "cells";
    if (e.surface !== "terminal" && elements.Svg) {
      // A desktop or editor draws Text in a proportional font, so the cell-built card comes apart
      // there; those surfaces get the card as one drawing instead.
      if (model.visible) {
        const { source, alt, animated } = composeSvgCard(model, { motion, accent: live.accent });
        drawn = elements.Svg({ source, alt, ...(animated ? { isInteractive: true } : {}) });
      }
    } else if (elements.Client && !live.clientFailed) {
      drawn = elements.Client({ key: "lit-band", module: "./lit-band-client.mjs", props: { model, columns, glyphs, motion, accent: live.accent } });
    } else if (model.visible) {
      drawn = renderBand(elements, composeBand(model, settledSample(model), { columns, glyphs, accent: live.accent }));
    }
    const below = await next(e);
    if (!drawn) return below;
    return below ? elements.Box({ flexDirection: "column", children: [drawn, below] }) : drawn;
  });

  on("ui.render", { component: "Spinner" }, async ($, e, next) => {
    const suffix = spinnerSuffix(live.model, e.props.suffix);
    return suffix ? next({ ...e, props: { ...e.props, suffix } }) : next(e);
  });

  on("command.run", { command: PANE }, async ($) => {
    live.paneOpen = true;
    if (live.snapshot) live.ledger = await readLedgerTail(stateIo($), live.snapshot.stateRoot);
    await $.ui.open({ id: PANE, title: "LIT evidence", focus: true, closeOnEscape: true });
    return {};
  }).catch(() => ({ text: "The LIT evidence pane could not open; LitClaude state is unchanged." }));

  on("ui.close", async ($, e, next) => {
    if (e.id === PANE) live.paneOpen = false;
    return next(e);
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const settings = normalizeModSettings(options);
    const glyphs = resolveGlyphs(settings.glyphs, e.surface, live.iconFont.present);
    const elements = $.ui.resolve(e);
    const columns = Math.max(20, e.props.bodyColumns ?? 60);
    const now = await $.clock.now();
    const evidence = buildEvidenceModel({ snapshot: live.snapshot ?? NO_SNAPSHOT, ledger: live.ledger, agents: live.agents, activity: live.activity, now, icons: `${glyphs} glyphs (${settings.glyphs}); ${live.iconFont.note}` });
    const tabs = TABS.map((tab) => elements.Button({
      key: `tab-${tab.id}`,
      label: tab.label,
      hotkey: tab.hotkey,
      plain: true,
      dimColor: tab.id !== live.evidenceTab,
      onPress: () => {
        live.evidenceTab = tab.id;
        $.ui.invalidate("ui.render");
      },
    }));
    return elements.Box({
      flexDirection: "column",
      children: [
        elements.Box({ flexDirection: "row", gap: 2, children: tabs }),
        ...renderRows(elements, composeEvidence(evidence, live.evidenceTab, { columns, glyphs })),
      ],
    });
  });
};
