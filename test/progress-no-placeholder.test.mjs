// BRIEF-feedback-1038 A: a progress gauge appears only when both of its numbers are real. An unknown
// total never reaches the user as `?/?`, `[???]` or `k/?`; the row says what is known instead (steps,
// time, the last tool) beside an indeterminate pulse, in the terminal card, the SVG card and the brief.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { createTimeline, sampleTimeline, settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel, noteLoopCall } from "../plugins/litclaude/lib/mod/view.mjs";
import { aggregateProgress, gauge, knownFacts, progressOf } from "../plugins/litclaude/lib/rewind/gauge.mjs";
import { renderRewind } from "../plugins/litclaude/lib/rewind/collect.mjs";

const NOW = 10_000_000;
const SID = "11111111-aaaa-bbbb-cccc-000000000001";
// `?/?`, `[???]`, `7/?`, `10+/?`: any question-mark run standing for a number.
const PLACEHOLDER = /\?\/\?|\[\?+\]|\d\+?\/\?|\?\/\d/u;
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const iso = (ms) => new Date(ms).toISOString();
const frame = (skill, family, stage, extra = {}) => ({ skill, family, stage, role: "spine", status: "active", verdicts: {}, at: iso(NOW - 4 * 60_000), ...extra });
const stackOf = (frames) => parseWorkflowStack({ version: 1, sessionId: SID, frames, history: [] }, SID);
const agents = (names) => names.map((name, i) => ({ id: `agent-${i}`, name, type: "executor", status: "running" }));
const activity = (names, ms) => ({ first: Object.fromEntries(names.map((_, i) => [`agent-${i}`, NOW - ms])), last: Object.fromEntries(names.map((_, i) => [`agent-${i}`, NOW - 1000])) });
const draw = (model, columns = 100) => composeBand(model, settledSample(model), { columns, glyphs: "basic", accent: "#5fd7ff" });
const cardText = (card) => card.rows.map(rowText).join("\n");

test("gauge draws only with two real numbers; otherwise it is null", () => {
  assert.equal(gauge(3, 5), "[▉▉▉░░] 3/5");
  assert.equal(gauge(0, 4), "[░░░░] 0/4");
  assert.equal(gauge(2, null), null);
  assert.equal(gauge(null, null), null);
  assert.equal(gauge(null, 4), null, "an unknown count is not drawn as zero");
  assert.equal(gauge(0, 0), null, "an empty list has nothing to measure");
  assert.equal(progressOf(2, null).gauge, null);
  assert.equal(aggregateProgress([progressOf(1, 2), progressOf(2, null)]).gauge, null);
  assert.equal(aggregateProgress([progressOf(1, 2), progressOf(2, 3)]).gauge, "[▉▉▉░░] 3/5");
});

test("knownFacts says what is known in words", () => {
  assert.equal(knownFacts({ steps: 12, elapsedMs: 4 * 60_000, last: "Edit README.md" }), "12 steps · 4m · last: Edit README.md");
  assert.equal(knownFacts({ steps: 1, elapsedMs: 30_000 }), "1 step · 30s");
  assert.equal(knownFacts({ elapsedMs: 4 * 60_000 }), "running 4m");
  assert.equal(knownFacts({ state: "paused", elapsedMs: 12 * 60_000 }), "paused 12m");
  assert.equal(knownFacts({}), "running");
  assert.doesNotMatch(knownFacts({ steps: null, elapsedMs: null, last: null }), PLACEHOLDER);
});

test("terminal card: lanes and tasks with unknown totals draw no ? run, but steps, time and the last tool", () => {
  const names = ["explore", "librarian", "verifier"];
  let lists = {};
  for (let i = 0; i < 12; i += 1) lists = noteLoopCall(lists, "agent-0", { tool: "Read", file_path: "/repo/src/a.mjs" }, {});
  lists = noteLoopCall(lists, "agent-0", { tool: "Edit", file_path: "/repo/README.md" }, {});
  const snapshot = { ...idle(), ignition: { discipline: "lit-loop", at: NOW - 1000 }, workflow: { stack: stackOf([frame("lit-loop", "loop", "RED")]) } };
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(names), activity: activity(names, 4 * 60_000), lists });
  for (const columns of [60, 80, 100, 120]) {
    const text = cardText(draw(model, columns));
    assert.doesNotMatch(text, PLACEHOLDER, `${columns} columns:\n${text}`);
  }
  const text = cardText(draw(model, 120));
  assert.match(text, /explore .*13 steps · 4m · last: Edit README\.md/u);
  assert.match(text, /librarian .*running 4m/u);
  assert.match(text, /lit-loop .*RED/u);
});

test("terminal card: a known total still draws the gauge", () => {
  let lists = noteLoopCall({}, "agent-0", { tool: "TodoWrite", todos: [{ status: "completed" }, { status: "in_progress" }, { status: "pending" }] }, {});
  lists = noteLoopCall(lists, "agent-1", { tool: "Read" }, {});
  const snapshot = { ...idle(), ignition: { discipline: "lit-plan", at: NOW - 1000 } };
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(["executor", "reviewer"]), lists });
  const text = cardText(draw(model));
  assert.match(text, /executor +\[▉░░\] 1\/3 running/u);
  assert.doesNotMatch(text, PLACEHOLDER);
});

test("the unknown-total pulse moves by colour on fixed glyphs while the card animates", () => {
  const snapshot = { ...idle(), ignition: { discipline: "lit-plan", at: NOW - 1000 } };
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(["explore", "verifier"]) });
  const profile = motionProfile("full");
  const timeline = createTimeline(model, 0, profile);
  const rows = [1000, 1300, 1600, 1900].map((t) => composeBand(model, sampleTimeline(timeline, t, profile), { columns: 100, glyphs: "basic", accent: "#5fd7ff" }).rows[4]);
  const pulse = (row) => row.filter(({ text }) => text === "━").map(({ fg }) => fg).join(",");
  assert.ok(rows.every((row) => row.some(({ text }) => text === "━")), "the lane row carries a pulse track");
  assert.equal(new Set(rows.map((row) => rowText(row))).size, 1, "its glyphs stay put");
  assert.ok(new Set(rows.map(pulse)).size >= 2, "its light moves by colour");
});

test("parent's task for a lane: a task the main loop gave the lane by owner counts as the lane's list", () => {
  let lists = noteLoopCall({}, "main", { tool: "TaskCreate" }, { task: { id: "t1" } });
  lists = noteLoopCall(lists, "main", { tool: "TaskCreate" }, { task: { id: "t2" } });
  lists = noteLoopCall(lists, "main", { tool: "TaskUpdate", taskId: "t1", owner: "explore", status: "completed" }, {});
  lists = noteLoopCall(lists, "main", { tool: "TaskUpdate", taskId: "t2", owner: "explore", status: "in_progress" }, {});
  const snapshot = { ...idle(), ignition: { discipline: "lit-plan", at: NOW - 1000 } };
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(["explore", "verifier"]), lists });
  const lane = model.threads.lanes.find(({ name }) => name === "explore");
  assert.deepEqual([lane.done, lane.total], [1, 2]);
  assert.match(cardText(draw(model)), /explore +\[▉░\] 1\/2 running/u);
});

test("SVG card and its alt text: no ? run for unknown totals, the gauge for known ones", () => {
  const names = ["explore", "librarian", "verifier"];
  const lists = noteLoopCall({}, "agent-2", { tool: "TodoWrite", todos: [{ status: "completed" }, { status: "pending" }] }, {});
  const snapshot = { ...idle(), ignition: { discipline: "lit-loop", at: NOW - 1000 }, workflow: { stack: stackOf([frame("lit-loop", "loop", "RED")]) } };
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(names), activity: activity(names, 4 * 60_000), lists, tasks: { b1: { id: "b1", kind: "shell", name: "dev server", at: NOW - 60_000, until: null } } });
  for (const motion of ["full", "off"]) {
    const { source, alt } = composeSvgCard(model, { motion });
    const visible = source.replace(/<[^>]+>/gu, " ");
    assert.doesNotMatch(visible, PLACEHOLDER, visible);
    assert.doesNotMatch(alt, PLACEHOLDER, alt);
    assert.match(visible, /\[▉░\] 1\/2/u);
    assert.match(visible, /running 4m/u);
    assert.match(alt, /librarian running 4m/u);
  }
});

test("the brief's plain rendering never prints a ? run", () => {
  const data = {
    summary: { sessions: 1, waitingOnUser: 0, active: 1 },
    roadmap: { plans: [], plansOmitted: 0, litgoal: [], progress: progressOf(null, null) },
    sessions: [{ id8: "abcd1234", status: "active", title: "pptx lane", progress: progressOf(null, null), done: { tools: { Edit: 3, Bash: 9 }, files: ["deck.md"], commits: [] }, last: iso(NOW), started: iso(NOW - 600_000) }],
    workflows: [{ id8: "abcd1234", skill: "lit-loop", stage: "RED", status: "active", progress: progressOf(2, null) }],
    next: { kind: "none" },
    sources: { transcripts: "ok" },
  };
  assert.doesNotMatch(renderRewind(data, 100), PLACEHOLDER, renderRewind(data, 100));
});
