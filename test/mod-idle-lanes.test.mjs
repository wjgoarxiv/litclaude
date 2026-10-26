// BRIEF-idle-lanes: a teammate the host lists as `idle` has finished its turn and waits for a
// message. It is drawn idle (`-`, dim, what is known of it, no clock), never blocked, and raises no
// `quiet for` warning; a running, pending or waiting agent that goes quiet is still blocked.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { createTimeline, sampleTimeline, settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { STALL_MS, buildBandModel, stalledLanes } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 10_000_000;
const SID = "idle-lanes-0001";
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const entry = (steps, last) => ({ steps, todos: null, tasks: {}, latest: null, last });

// The card the user saw: start-work finished its eight tasks and handed over to review-work, which
// a teammate's skill load paused under a side frame; both teammates finished over an hour ago.
const reported = (status = "idle") => {
  const frames = [
    { skill: "start-work", family: "main", stage: "work", role: "spine", status: "paused", verdicts: {}, at: iso(NOW - 90 * MIN) },
    { skill: "review-work", family: "main", stage: "review", role: "spine", status: "paused", verdicts: {}, at: iso(NOW - 80 * MIN) },
    { skill: "frontend-ui-ux", family: "side", stage: "side", role: "side", status: "active", verdicts: {}, at: iso(NOW - 79 * MIN) },
  ];
  const stack = parseWorkflowStack({ version: 1, sessionId: SID, frames, history: [] }, SID);
  return buildBandModel({
    snapshot: { ...idle(), ignition: { discipline: "start-work", at: NOW - 85 * MIN }, work: { id: "p", total: 8, checked: 8, status: "paused", nextTask: null, lanes: [], awaiting: null }, workflow: { stack, record: stack.record } },
    agents: [{ id: "a", name: "write-review", status }, { id: "b", name: "file-writer", status }],
    activity: { last: { a: NOW - 77 * MIN, b: NOW - 76 * MIN }, first: { a: NOW - 78 * MIN, b: NOW - 76 * MIN } },
    lists: { a: entry(3, "SendMessage"), b: entry(1, "Write task-3-review.md") },
    now: NOW,
  });
};
const draw = (model) => composeBand(model, settledSample(model), { columns: 120, glyphs: "basic", accent: "#5fd7ff" });
const texts = (card) => card.rows.map(rowText);
const rowOf = (card, name) => card.rows.find((row) => rowText(row).includes(` ${name} `));

test("an idle teammate is never stalled, however long it has been quiet", () => {
  const agents = [{ id: "a", name: "write-review", status: "idle" }];
  assert.deepEqual(stalledLanes(agents, { last: { a: NOW - 5 * STALL_MS }, first: {} }, NOW), []);
  const model = reported();
  assert.deepEqual(model.warnings, [], "no `quiet for` warning");
  assert.deepEqual(model.lanes.list.map(({ status }) => status), ["idle", "idle"]);
});

test("the card draws finished idle teammates as idle with what is known, and no clock", () => {
  const card = draw(reported());
  const lines = texts(card);
  assert.match(lines.find((l) => l.includes("write-review")), /- write-review +━{5} idle · 3 steps · last: SendMessage +│$/u);
  assert.match(lines.find((l) => l.includes("file-writer")), /- file-writer +━{5} idle · 1 step · last: Write task-3-review\.md +│$/u);
  assert.ok(!lines.some((l) => /quiet for|wake it|blocked|\s!\s/u.test(l)), lines.join("\n"));
  assert.match(lines[1], /●● 2 lanes +│$/u, "two lanes listed, with no running clock");
  assert.notEqual(card.border, "#ffaf3c", "no amber warning border");
  const glyph = rowOf(card, "write-review").find(({ text }) => text.trim() === "-");
  assert.equal(glyph.fg, rowOf(card, "write-review").find(({ text }) => text.startsWith("idle")).fg, "glyph and word share the dim state colour");
});

test("an idle row's pulse stands still while the card animates (the card's own edges may breathe)", () => {
  const model = reported();
  const profile = motionProfile("full");
  const timeline = createTimeline(model, 0, profile);
  const frames = [3000, 3400, 3800, 4600].map((t) => JSON.stringify(rowOf(composeBand(model, sampleTimeline(timeline, t, profile), { columns: 120, glyphs: "basic" }), "write-review").slice(1, -1)));
  assert.equal(new Set(frames).size, 1);
});

test("a running, pending or waiting agent that goes quiet is still blocked and warned about", () => {
  for (const status of ["running", "pending", "waiting"]) {
    const model = reported(status);
    assert.deepEqual(model.lanes.list.map((lane) => lane.status), ["stalled", "stalled"], status);
    assert.equal(model.warnings[0].text, "quiet for 1h 17m", status);
    const lines = texts(draw(model));
    assert.match(lines.find((l) => l.includes("write-review")), /! write-review +━{5} blocked · 3 steps · 1h 18m · last: SendMessage/u, status);
    assert.match(lines.at(-1), /^╰─ ⚠ write-review quiet for 1h 17m/u, status);
  }
});

// Item 3 of the brief, pinned as right: each stack row draws its own frame. start-work's frame did
// its work stage (8/8) and waits paused for review-work, the spine above it, to hand back; the map
// and the corner follow that spine, which a side frame has paused, so they read `REVIEW ||`.
test("the start-work row keeps its own stage under the review spine the map follows", () => {
  const lines = texts(draw(reported()));
  assert.match(lines[0], /REVIEW \|\| ─╮$/u);
  assert.match(lines[1], /work ✓ ━━ +\|\| review +━━ done/u);
  assert.match(lines.find((l) => l.includes("start-work")), /\| start-work +work +\[▉{8}\] 8\/8 paused/u);
  assert.match(lines.find((l) => l.includes("review-work") && l.includes("└─")), /\| review-work +review +━{5} paused/u);
});
