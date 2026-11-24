import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { TIMINGS, motionProfile, springKick } from "../plugins/litclaude/lib/mod/motion.mjs";
import { parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { advanceTimeline, createTimeline, sampleTimeline, timelineBusy } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

// The terminal card's polish: a moving sea in the skills row while LitClaude works, a spring kick
// on the current stage when a workflow steps forward, and a dimmer card while idle.

const T0 = 10_000_000;
const ACCENT = "#ff7a3d";

const loopModel = (stage, { isWorking = true, family = "loop", skill = "lit-loop", now = T0 } = {}) => {
  const frame = { skill, family, stage, role: "spine", status: "active", verdicts: {}, at: new Date(T0 - 2000).toISOString(), n: 2, total: 5 };
  const stack = parseWorkflowStack({ version: 1, sessionId: "s", frames: [frame], history: [] }, "s");
  const snapshot = { ignition: { discipline: skill, at: T0 - 1000 }, work: null, completedWorkIds: [], goal: null, workflow: { stack, record: stack.record } };
  return buildBandModel({ snapshot, now, isWorking });
};

const card = (model, timeline, now, profile) => composeBand(model, sampleTimeline(timeline, now, profile), { columns: 76, glyphs: "basic", accent: ACCENT });
// The cells of the skills row (card row 3) after its chip, between the sides.
const skyOf = (band) => rowText(band.rows[3]).slice(2, -2).split("lit-loop").at(-1);
// The current stage's pill fill, read from its first filled cell (its padding, which no light crosses).
const currentPillBg = (band) => band.rows[1].find(({ bg }) => bg)?.bg;

test("full motion moves a sea of ASCII waves through the skills row while LitClaude works", () => {
  const full = motionProfile("full");
  const model = loopModel("GREEN");
  const timeline = createTimeline(model, T0, full);
  const seas = [600, 900, 1200, 1500].map((t) => skyOf(card(model, timeline, T0 + t, full)));
  for (const sea of seas) {
    assert.match(sea, /[~.-]/u, "some wave shows");
    assert.match(sea, /^[ ~.-]*$/u, "every wave is plain ASCII, so a glyph change repaints");
  }
  assert.equal(new Set(seas).size, seas.length, "the sea moves between frames");
});

test("the map row keeps its text while the sea moves", () => {
  const full = motionProfile("full");
  const model = loopModel("GREEN");
  const timeline = createTimeline(model, T0, full);
  const maps = [600, 900, 1200].map((t) => rowText(card(model, timeline, T0 + t, full).rows[1]));
  assert.equal(new Set(maps).size, 1);
});

test("no sea while idle, under subtle motion or with motion off", () => {
  for (const [mode, isWorking] of [["full", false], ["subtle", true], ["off", true]]) {
    const profile = motionProfile(mode);
    const model = loopModel("GREEN", { isWorking });
    const timeline = createTimeline(model, T0, profile);
    const band = card(model, timeline, T0 + 900, profile);
    assert.doesNotMatch(skyOf(band), /[~.-]/u, `${mode} ${isWorking ? "working" : "idle"}`);
  }
});

test("a step inside one workflow kicks the new stage's pill on a damped spring that settles by TIMINGS.kick", () => {
  assert.ok(springKick(0) > 0.9, "the kick starts bright");
  assert.ok(Math.min(...Array.from({ length: 40 }, (_, i) => springKick(i * 10))) < 0, "it overshoots below rest");
  assert.equal(springKick(TIMINGS.kick), 0, "and is still by TIMINGS.kick");

  const full = motionProfile("full");
  let timeline = createTimeline(loopModel("GREEN"), T0, full);
  const verify = loopModel("VERIFY", { now: T0 + 1000 });
  timeline = advanceTimeline(timeline, verify, T0 + 1000, full);
  assert.ok(sampleTimeline(timeline, T0 + 1010, full).kick > 0.8);
  assert.equal(timelineBusy(timeline, T0 + 1000 + TIMINGS.kick - 1, full), true, "the frame timer runs through the kick");
  const kicked = currentPillBg(card(verify, timeline, T0 + 1010, full));
  const settled = currentPillBg(card(verify, timeline, T0 + 1000 + TIMINGS.kick, full));
  assert.notEqual(kicked, settled, "the pill is lit by the kick, then settles");
  assert.equal(sampleTimeline(timeline, T0 + 1000 + TIMINGS.kick, full).kick, 0);
});

test("no kick under subtle motion, and none when the card switches to another workflow", () => {
  const subtle = motionProfile("subtle");
  let timeline = createTimeline(loopModel("GREEN"), T0, subtle);
  timeline = advanceTimeline(timeline, loopModel("VERIFY"), T0 + 1000, subtle);
  assert.equal(sampleTimeline(timeline, T0 + 1010, subtle).kick, 0);

  const full = motionProfile("full");
  let other = createTimeline(loopModel("GREEN"), T0, full);
  other = advanceTimeline(other, loopModel("interview", { family: "plan", skill: "lit-plan" }), T0 + 1000, full);
  assert.equal(sampleTimeline(other, T0 + 1010, full).kick, 0);
});

test("idle, the border and the stages already done sink toward the card", () => {
  const full = motionProfile("full");
  const working = loopModel("GREEN");
  const resting = loopModel("GREEN", { isWorking: false });
  const live = card(working, createTimeline(working, T0, full), T0 + 2000, full);
  const calm = card(resting, createTimeline(resting, T0, full), T0 + 2000, full);
  const brightness = (hex) => hex.slice(1).match(/../gu).reduce((sum, part) => sum + Number.parseInt(part, 16), 0);
  assert.ok(brightness(calm.border) < brightness(live.border) / 2, "the idle border is far dimmer");
  const doneInk = (band) => band.rows[1].find(({ text }) => text.startsWith("PIN"))?.fg;
  assert.ok(brightness(doneInk(calm)) < brightness(doneInk(live)), "a done stage's label dims");
});
