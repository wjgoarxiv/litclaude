// LitClaude's Claude Code mod (hooks/hooks.json `modules`). It draws the LIT band above the prompt
// while LitClaude work is active, adds the discipline and progress to the spinner, raises gate
// notices, and serves /lit-evidence. It is read-only: it reads LitClaude's own state files through
// lib/mod/state.mjs and the host's live figures, and never writes, spawns, fetches or calls a model.
// Claude Code releases before mods ignore the `modules` key and keep running the settings hooks.
//
// The mods loader only follows `$` into functions declared at the top of this file, so each helper
// below takes `$` and the per-load `live` record explicitly instead of closing over them.

import { composeBand, composeEvidence } from "../lib/mod/frame.mjs";
import { TIMINGS } from "../lib/mod/motion.mjs";
import { renderBand, renderRows } from "../lib/mod/render.mjs";
import { normalizeModSettings, resolveGlyphs } from "../lib/mod/settings.mjs";
import { detectIconFont, readLedgerTail, readLitSnapshot } from "../lib/mod/state.mjs";
import { settledSample } from "../lib/mod/timeline.mjs";
import {
  EMPTY_ACTIVITY,
  buildBandModel,
  buildEvidenceModel,
  detectCompletion,
  diffNotices,
  noteAgentActivity,
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
const NO_SNAPSHOT = Object.freeze({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });

const createLive = (options) => ({
  band: normalizeModSettings(options).band,
  iconFont: { present: false, path: null, note: "basic: not checked yet" },
  env: {},
  snapshot: null,
  model: null,
  agents: [],
  usage: null,
  activity: EMPTY_ACTIVITY,
  statusById: {},
  isWorking: false,
  notice: null,
  completion: null,
  exiting: false,
  clientFailed: false,
  refreshing: false,
  quickPending: false,
  paneOpen: false,
  evidenceTab: "goal",
  ledger: [],
  celebrated: new Set(),
});

const stateIo = ($) => ({
  stat: (path) => $.fs.stat(path, { resolve: true }),
  read: (path) => $.fs.read(path),
});

const toastText = (raised) => `🔥 ${raised.title}${raised.detail ? ` · ${raised.detail}` : ""}`;

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
  });
  live.model = next;
  if (previous?.visible && !next.visible && !live.exiting) {
    // Keep the band mounted while its surface module plays the exit, then let it go.
    live.exiting = true;
    $.clock.after(TIMINGS.exit + 80, () => {
      live.exiting = false;
      $.ui.invalidate("ui.render");
    });
  }
  if (JSON.stringify(previous) !== JSON.stringify(next)) $.ui.invalidate("ui.render");
  return next;
}

function showNotice($, live, raised) {
  live.notice = raised;
  $.ui.toast(toastText(raised));
  $.clock.after(TIMINGS.noticeHold, () => {
    if (live.notice?.id !== raised.id) return;
    live.notice = null;
    void rebuild($, live);
  });
}

function celebrate($, live, finish) {
  if (live.celebrated.has(finish.id)) return;
  live.celebrated.add(finish.id);
  live.completion = finish;
  $.clock.after(TIMINGS.completion + 200, () => {
    if (live.completion?.id !== finish.id) return;
    live.completion = null;
    void rebuild($, live);
  });
}

async function refresh($, live) {
  if (live.refreshing) return;
  live.refreshing = true;
  try {
    const [cwd, sessionId] = await Promise.all([$.session.cwd(), $.session.id()]);
    const fresh = await readLitSnapshot(stateIo($), { cwd, sessionId, env: live.env });
    live.agents = await $.agent.list().catch(() => []);
    live.usage = await $.session.usage().catch(() => live.usage);
    const now = await $.clock.now();
    live.activity = trackAgents(live.activity, live.agents, live.statusById, now);
    live.statusById = Object.fromEntries(live.agents.map((agent) => [agent.id, agent.status]));
    const before = live.snapshot;
    const previousModel = live.model;
    live.snapshot = fresh;
    const finish = detectCompletion(before, fresh);
    if (finish) celebrate($, live, finish);
    const next = await rebuild($, live);
    const raised = diffNotices(before, fresh, previousModel, next);
    if (raised.length > 0) {
      for (const extra of raised.slice(0, -1)) $.ui.toast(toastText(extra));
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

function refreshSoon($, live) {
  if (live.quickPending) return;
  live.quickPending = true;
  $.clock.after(QUICK_REFRESH_MS, () => {
    live.quickPending = false;
    void refresh($, live);
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
    await $.command.register({ name: PANE, description: "Show LitClaude goal criteria, evidence, lanes and gates in a pane" });
    await refresh($, live);
    $.clock.every(POLL_MS, () => {
      void refresh($, live);
    });
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    live.isWorking = true;
    refreshSoon($, live);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    live.isWorking = false;
    refreshSoon($, live);
    return next(e);
  });

  on("session.measure", async ($, e, next) => {
    live.usage = { context: e.context, rateLimits: e.rateLimits };
    if (e.changed.includes("context")) refreshSoon($, live);
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    const result = await next(e);
    if (typeof e.agentId === "string") live.activity = noteAgentActivity(live.activity, e.agentId, await $.clock.now());
    refreshSoon($, live);
    return result;
  }).catch(($, e, next) => next(e));

  on("ui.fault", async ($, e, next) => {
    if (e.component === "AbovePrompt") live.clientFailed = true;
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const settings = normalizeModSettings(options);
    const glyphs = resolveGlyphs(settings.glyphs, e.surface, live.iconFont.present);
    const model = live.model;
    if (!model || settings.band === "off" || e.props.hasSurvey || (!model.visible && !live.exiting)) return next(e);
    const elements = $.ui.resolve(e);
    const columns = Math.max(20, e.props.bodyColumns ?? e.viewport?.columns ?? 80);
    let drawn = null;
    if (elements.Client && !live.clientFailed) {
      drawn = elements.Client({ key: "lit-band", module: "./lit-band-client.mjs", props: { model, columns, glyphs, motion: settings.motion } });
    } else if (model.visible) {
      drawn = renderBand(elements, composeBand(model, settledSample(model), { columns, glyphs }));
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
