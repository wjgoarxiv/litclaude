import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, composeEvidence, revealText, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { TIMINGS, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { advanceTimeline, createTimeline, sampleTimeline, settledSample, timelineBusy } from "../plugins/litclaude/lib/mod/timeline.mjs";
import {
  EMPTY_ACTIVITY,
  STALL_MS,
  buildBandModel,
  buildEvidenceModel,
  detectCompletion,
  diffNotices,
  noteAgentActivity,
  spinnerSuffix,
  stalledLanes,
  trackAgents,
} from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 10_000_000;
const idle = () => ({
  ignition: null,
  work: null,
  completedWorkIds: [],
  goal: null,
  autoloop: null,
  litPlan: null,
  probe: null,
  motion: null,
  handoff: null,
});
const working = (overrides = {}) => ({
  ...idle(),
  ignition: { discipline: "lit-loop", at: NOW - 1000 },
  work: { id: "w1", status: "active", planName: "demo.md", total: 7, checked: 4, nextTask: "5. README 데모 GIF 교체", lanes: [] },
  goal: { objective: "ship it", status: "active", autoloop: true, criteria: [{ id: "C1", description: "tests", status: "pass", attempts: 1, lastAt: NOW - 120_000 }], blockers: [], lastCheckpoint: null, createdAt: 1 },
  autoloop: { blockCount: 3, firstBlockAt: NOW - 18 * 60_000 },
  ...overrides,
});
// The same work under start-work: the map's count is then the plan's tasks, as the progress is.
const startWork = (overrides = {}) => working({ ignition: { discipline: "start-work", at: NOW - 1000 }, ...overrides });
const agent = (id, status = "running", name = id) => ({ id, status, name, type: "general-purpose", description: name });

test("on auto an idle session draws no band; the default always does", () => {
  assert.equal(buildBandModel({ snapshot: idle(), now: NOW, band: "auto" }).visible, false);
  assert.equal(buildBandModel({ snapshot: idle(), now: NOW }).visible, true);
  assert.equal(buildBandModel({ snapshot: working(), now: NOW, band: "off" }).visible, false);
  const ignitedButDone = { ...idle(), ignition: { discipline: "lit-loop", at: NOW } };
  assert.equal(buildBandModel({ snapshot: ignitedButDone, now: NOW, band: "auto", isWorking: false }).visible, false);
  assert.equal(buildBandModel({ snapshot: ignitedButDone, now: NOW, band: "auto", isWorking: true }).visible, true);
  assert.equal(buildBandModel({ snapshot: ignitedButDone, now: NOW, isWorking: false }).idle, true);
});

test("active work shows its phases, progress, next task and autoloop budget", () => {
  const model = buildBandModel({ snapshot: working(), now: NOW, isWorking: true });
  assert.equal(model.visible, true);
  assert.deepEqual(model.phases, { plan: "done", work: "now", review: "todo" });
  assert.deepEqual(model.progress, { done: 4, total: 7, unit: "tasks" });
  assert.equal(model.next, "5. README 데모 GIF 교체");
  assert.deepEqual(model.autoloop, { n: 3, max: 8, leftMs: 12 * 60_000 });
  assert.equal(spinnerSuffix(model), "… · lit-loop · 4/7");
  assert.equal(spinnerSuffix(buildBandModel({ snapshot: idle(), now: NOW })), null);

  const allChecked = buildBandModel({ snapshot: working({ work: { ...working().work, checked: 7 } }), now: NOW });
  assert.deepEqual(allChecked.phases, { plan: "done", work: "done", review: "now" });
});

test("live subagents are counted as lanes in the phase row, and a failed probe is a red warning", () => {
  const agents = [agent("a1", "running", "readme-ko"), agent("a2", "running", "demo-gif"), agent("a3", "completed", "old")];
  const model = buildBandModel({ snapshot: working(), agents, now: NOW });
  assert.equal(model.lanes.count, 2, "finished agents are not lanes");
  assert.match(rowText(composeBand(model, settledSample(model), { columns: 100, glyphs: "basic" }).rows[1]), /●● 2 lanes/u);

  const failedProbe = working({ probe: { editAt: 10, probeAt: null, issue: "a HIGH finding remains", issueAt: 12, paths: ["a.css"], blockCount: 1 } });
  const warned = buildBandModel({ snapshot: failedProbe, now: NOW });
  assert.equal(warned.warnings[0].tone, "red");
  assert.deepEqual(warned.gates.find(({ id }) => id === "probe"), { id: "probe", state: "fail", label: "ui probe failed" });
});

test("a lane quiet past the threshold is stalled, and activity resets the clock", () => {
  let activity = trackAgents(EMPTY_ACTIVITY, [agent("a1")], {}, NOW - STALL_MS - 1000);
  assert.deepEqual(stalledLanes([agent("a1")], activity, NOW).map(({ id }) => id), ["a1"]);
  activity = noteAgentActivity(activity, "a1", NOW - 1000);
  assert.deepEqual(stalledLanes([agent("a1")], activity, NOW), []);
  const changed = trackAgents(trackAgents(EMPTY_ACTIVITY, [agent("a1")], {}, 0), [agent("a1", "idle")], { a1: "running" }, NOW);
  assert.equal(changed.last.a1, NOW, "a status change counts as activity");
  assert.equal(changed.first.a1, 0);
  assert.deepEqual(trackAgents(changed, [], { a1: "idle" }, NOW), { last: {}, first: {} }, "agents that left are forgotten");
  const stalled = buildBandModel({ snapshot: working(), agents: [agent("a1", "running", "demo-gif")], activity: { last: { a1: NOW - 12 * 60_000 }, first: { a1: NOW - 20 * 60_000 } }, now: NOW });
  assert.equal(stalled.warnings[0].subject, "demo-gif");
  assert.equal(stalled.warnings[0].text, "quiet for 12m");
  assert.equal(stalled.lanes.list[0].status, "stalled");
});

test("the context warning starts five points before the auto-handoff percent and stops once it fired", () => {
  const armed = working({ handoff: { percent: 80, firedAt: null, firedAtPercent: null, pending: false } });
  assert.equal(buildBandModel({ snapshot: armed, usage: { context: { percent: 74 } }, now: NOW }).ctxWarning, null);
  assert.deepEqual(buildBandModel({ snapshot: armed, usage: { context: { percent: 76.4 } }, now: NOW }).ctxWarning, { percent: 76, threshold: 80 });
  const fired = working({ handoff: { percent: 80, firedAt: 5, firedAtPercent: 81, pending: true } });
  assert.equal(buildBandModel({ snapshot: fired, usage: { context: { percent: 82 } }, now: NOW }).ctxWarning, null);
});

test("gate notices come from changes only, never from the first look", () => {
  const before = working({ litPlan: { blockCount: 0, warned: false, promptAt: 5 } });
  const after = working({ litPlan: { blockCount: 1, warned: false, promptAt: 5 } });
  assert.deepEqual(diffNotices(null, after), []);
  const [plan] = diffNotices(before, after);
  assert.equal(plan.title, "lit-plan is not saved yet");
  assert.match(plan.detail, /stop 1\/2/u);
  assert.deepEqual(diffNotices(after, after), []);

  const probeFailed = diffNotices(working(), working({ probe: { editAt: 1, probeAt: null, issue: "BLOCKED: no browser", issueAt: 3, paths: [], blockCount: 0 } }));
  assert.equal(probeFailed[0].tone, "red");
  const probePending = diffNotices(working(), working({ probe: { editAt: 1, probeAt: null, issue: null, issueAt: null, paths: [], blockCount: 1 } }));
  assert.equal(probePending[0].title, "interface probe pending");
  const motion = diffNotices(working(), working({ motion: { blockCount: 1, runs: 2, notified: false } }));
  assert.equal(motion[0].title, "motion gate: the film is not done");
  const handoff = diffNotices(working({ handoff: { percent: 80, firedAt: null, firedAtPercent: null, pending: false } }), working({ handoff: { percent: 80, firedAt: 9, firedAtPercent: 81, pending: true } }));
  assert.equal(handoff[0].title, "auto-handoff fired at 81%");
  const ctx = diffNotices(working(), working(), { ctxWarning: null }, { ctxWarning: { percent: 76, threshold: 80 } });
  assert.equal(ctx[0].title, "context 76%");
});

test("the completion moment fires on the last checked task, a completed work, or a met goal", () => {
  const before = working();
  const lastChecked = working({ work: { ...before.work, checked: 7 } });
  assert.deepEqual(detectCompletion(before, lastChecked), { id: "work:w1", detail: "7/7 tasks" });
  assert.equal(detectCompletion(lastChecked, lastChecked), null);
  const completed = { ...working(), work: null, completedWorkIds: ["w1"] };
  assert.equal(detectCompletion(lastChecked, completed).id, "work:w1", "the same id, so it plays once");
  const goalMet = { ...idle(), goal: { ...before.goal, status: "complete" } };
  assert.match(detectCompletion({ ...idle(), goal: before.goal }, goalMet).detail, /goal met · 1\/1 criteria/u);
  assert.equal(detectCompletion(null, completed), null);
});

test("pills pop in 60 ms apart and the band stops animating once everything settles", () => {
  const profile = motionProfile("full");
  const model = buildBandModel({ snapshot: startWork(), now: NOW });
  const timeline = createTimeline(model, 0, profile);
  const at = (t) => sampleTimeline(timeline, t, profile);
  assert.deepEqual(at(0).pills, [0, 0, 0, 0]);
  assert.equal(at(59).pills[1], 0);
  assert.ok(at(61).pills[1] > 0);
  assert.ok(at(100).pills[0] > 1, "ease-out-back carries the first pill past full before it settles");
  assert.equal(at(160).pills[0], 1);
  assert.equal(at(339).rest, 0, "the bar waits for the last pill");
  assert.ok(at(345).rest > 0);
  assert.equal(at(340).fill, 0);
  assert.ok(Math.abs(at(340 + TIMINGS.fill).fill - 4 / 7) < 1e-9);
  assert.equal(timelineBusy(timeline, 340 + TIMINGS.fill - 1, profile), true);
  assert.equal(timelineBusy(timeline, 340 + TIMINGS.fill, profile), false);

  const off = motionProfile("off");
  const still = createTimeline(model, 0, off);
  assert.equal(timelineBusy(still, 0, off), false, "motion off never starts a frame timer");
  assert.deepEqual(sampleTimeline(still, 0, off).pills, [1, 1, 1, 1]);
});

test("a progress change fills ease-in-out and flashes the count; a warning crossfades in 140 ms", () => {
  const profile = motionProfile("full");
  const start = buildBandModel({ snapshot: startWork(), now: NOW });
  let timeline = createTimeline(start, 0, profile);
  const moved = buildBandModel({ snapshot: startWork({ work: { ...working().work, checked: 5 } }), now: NOW });
  timeline = advanceTimeline(timeline, moved, 1000, profile);
  assert.ok(Math.abs(sampleTimeline(timeline, 1000, profile).fill - 4 / 7) < 1e-9);
  assert.ok(Math.abs(sampleTimeline(timeline, 1150, profile).fill - 4.5 / 7) < 1e-9);
  assert.ok(sampleTimeline(timeline, 1200, profile).flash > 0.9);
  assert.ok(Math.abs(sampleTimeline(timeline, 1300, profile).fill - 5 / 7) < 1e-9);
  const glows = [1033, 1066, 1099, 1132, 1165, 1198, 1231, 1264].map((t) => sampleTimeline(timeline, t, profile).fillGlow);
  assert.ok(glows.every((glow, i) => glow > 0 && (i === 0 || glow !== glows[i - 1])), "every fill frame differs in glow");
  assert.equal(sampleTimeline(timeline, 1300, profile).fillGlow, 0);

  const warned = { ...moved, ctxWarning: { percent: 76, threshold: 80 } };
  timeline = advanceTimeline(timeline, warned, 2000, profile);
  assert.equal(sampleTimeline(timeline, 2000, profile).warn, 0);
  assert.equal(sampleTimeline(timeline, 2140, profile).warn, 1);
});

test("a notice slides in from fourteen cells with an overshoot and leaves accelerating", () => {
  const profile = motionProfile("full");
  const base = buildBandModel({ snapshot: working(), now: NOW });
  let timeline = createTimeline(base, 0, profile);
  const notice = { id: "n1", tone: "pink", title: "lit-plan is not saved yet", detail: "stop 1/2" };
  timeline = advanceTimeline(timeline, { ...base, notice }, 1000, profile);
  assert.equal(sampleTimeline(timeline, 1000, profile).notice.offset, 14);
  assert.equal(sampleTimeline(timeline, 1220, profile).notice.offset, 0);
  assert.equal(timelineBusy(timeline, 1219, profile), true);
  assert.equal(timelineBusy(timeline, 1220, profile), false, "a holding notice needs no frames");
  timeline = advanceTimeline(timeline, base, 5000, profile);
  assert.equal(sampleTimeline(timeline, 5000, profile).notice.offset, 0);
  assert.ok(sampleTimeline(timeline, 5100, profile).notice.offset > 5);
  assert.equal(sampleTimeline(timeline, 5150, profile).notice, null);
  const subtle = motionProfile("subtle");
  const soft = advanceTimeline(createTimeline(base, 0, subtle), { ...base, notice }, 1000, subtle);
  const offsets = Array.from({ length: 30 }, (_, i) => sampleTimeline(soft, 1000 + i * 10, subtle).notice.offset);
  assert.ok(offsets.every((offset, i) => i === 0 || offset <= offsets[i - 1]), "subtle never overshoots");
});

test("the progress bar on the detail line is coloured spaces, so every step repaints", () => {
  const model = buildBandModel({ snapshot: startWork(), agents: [agent("a1", "running", "readme-ko")], now: NOW });
  const frame = composeBand(model, settledSample(model), { columns: 100, glyphs: "basic" });
  assert.match(rowText(frame.rows[1]), /^│ interview ✓ ━━ plan ✓ ━━ {2}work 4\/7 {2}━━ review · ── done · +● 1 lane {2}⟳ 3\/8 · 12m │$/u);
  assert.match(rowText(frame.rows[2]), /^│ └ task 4\/7 +░+ · next ▸ 5\. README 데모 GIF 교체 +│$/u);
  const solid = frame.rows[2].slice(frame.rows[2].findIndex(({ text }) => text === "task ")).filter(({ text, bg }) => text === " " && bg);
  assert.ok(solid.length >= 4, "whole cells and the fading head are spaces on their colour");
  assert.equal(solid[0].bg, "#ff2d95");
  const brand = frame.rows[0].find(({ text }) => text === "🔥 LIT");
  assert.equal(brand.bg, "#ff2d95", "the brand in the title is the status line prefix's pink, as a pill");
});

test("Nerd glyphs draw the chip bolt and the branch from the icon font; basic needs none", () => {
  const model = buildBandModel({ snapshot: working(), now: NOW, git: "main", isWorking: true, skills: [{ id: "lit-plan", at: NOW, state: "current" }] });
  const nerd = composeBand(model, settledSample(model), { columns: 100, glyphs: "nerd" }).rows.map(rowText);
  assert.match(nerd[3], /\uf0e7 lit-plan/u);
  assert.match(nerd[4], /\ue0a0 main/u);
  const basic = composeBand(model, settledSample(model), { columns: 100, glyphs: "basic" }).rows.map(rowText);
  assert.match(basic[3], /⚡ lit-plan/u);
  assert.match(basic[4], /git main/u);
});

test("the completion row scatters embers in full motion and stays a quiet line in subtle", () => {
  const model = buildBandModel({ snapshot: working(), now: NOW, completion: { id: "c", detail: "7/7 tasks" } });
  const full = motionProfile("full");
  const timeline = createTimeline(model, 0, full);
  const mid = composeBand(model, sampleTimeline(timeline, 400, full), { columns: 120, glyphs: "basic" });
  const row = rowText(mid.rows[3]);
  assert.match(row.split("COMPLETE")[0], /[.+*]/u, "embers are ASCII sparks");
  assert.match(row, /COMPLETE · 7\/7 tasks +│$/u);
  assert.equal(timelineBusy(timeline, TIMINGS.completion - 1, full), true);
  const subtle = motionProfile("subtle");
  const quiet = composeBand(model, sampleTimeline(createTimeline(model, 0, subtle), 400, subtle), { columns: 120, glyphs: "basic" });
  assert.match(rowText(quiet.rows[3]), /^│ ✦ COMPLETE · 7\/7 tasks +│$/u);
});

test("the shimmer passes over the brand during the finish", () => {
  const model = buildBandModel({ snapshot: working(), now: NOW, completion: { id: "c", detail: "done" } });
  const full = motionProfile("full");
  const timeline = createTimeline(model, 0, full);
  const colors = (t) => composeBand(model, sampleTimeline(timeline, t, full), { columns: 120, glyphs: "nerd" }).rows[0].filter(({ text }) => "LIT".includes(text) && text.length === 1).map(({ bg }) => bg);
  assert.notDeepEqual(colors(200), colors(1000), "letters brighten while the light passes and return after");
});

test("labels pop in character by character and pad while overshooting", () => {
  assert.equal(revealText("PLAN", 0), null);
  assert.equal(revealText("PLAN", 0.5), "PL");
  assert.equal(revealText("PLAN", 1), "PLAN");
  assert.equal(revealText("PLAN", 1.3), "PLAN ");
});

test("the evidence pane shows criteria, blockers, the timeline, lanes and gates", () => {
  const snapshot = working({ goal: { ...working().goal, criteria: [...working().goal.criteria, { id: "C2", description: "real surface check", status: "pending", attempts: 0, lastAt: null }], blockers: ["review: one blocker"] } });
  const evidence = buildEvidenceModel({
    snapshot,
    ledger: [{ event: "evidence.recorded", at: NOW - 60_000, detail: "C1", status: "pass" }],
    agents: [agent("a1", "running", "readme-ko")],
    activity: { last: { a1: NOW - 30_000 }, first: {} },
    now: NOW,
  });
  const goalRows = composeEvidence(evidence, "goal", { columns: 80, glyphs: "basic" }).map(rowText);
  assert.equal(goalRows[0], "goal  ship it  active");
  assert.match(goalRows[2], /^✓ C1  tests +2m ago$/u);
  assert.match(goalRows[3], /^· C2  real surface check +—$/u);
  assert.equal(goalRows[4], "⚑ review: one blocker");
  assert.match(goalRows.at(-1), /^1m ago +evidence\.recorded +C1$/u);
  assert.deepEqual(composeEvidence(evidence, "lanes", { columns: 80 }).map(rowText), ["● readme-ko  general-purpose · running · quiet 30s"]);
  assert.deepEqual(composeEvidence(evidence, "gates", { columns: 80 }).map(rowText), ["plan  demo.md · 4/7", "✓ plan saved"]);
  const withIcons = buildEvidenceModel({ snapshot, now: NOW, icons: "basic glyphs (auto); basic: Symbols Nerd Font not found" });
  assert.equal(rowText(composeEvidence(withIcons, "gates", { columns: 120 }).at(-1)), "icons basic glyphs (auto); basic: Symbols Nerd Font not found");
  for (const tab of ["goal", "lanes", "gates"]) for (const row of composeEvidence(evidence, tab, { columns: 30 })) assert.ok(rowWidth(row) <= 30);
});
