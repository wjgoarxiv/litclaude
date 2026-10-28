// plans/invite-pilot.md todo 5b: the richer club look. A gold → rose → violet ring around all four
// borders, a slow gold glint along the top border under full motion (one pass at most every three
// seconds, still otherwise), `CLUB ✦` as a filled gradient pill, sparkles at the title's corners and
// a quiet `invited by @<id>` chip on the idle card.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { CLUB_GOLD } from "../plugins/litclaude/lib/mod/looks.mjs";
import { TIMINGS, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { readInvited } from "../plugins/litclaude/lib/mod/state.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { createTimeline, glintWait, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 30_000_000;
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const usage = { context: { percent: 42 }, rateLimits: [{ kind: "five_hour", percentUsed: 31 }] };
const model = (extra = {}) => buildBandModel({ snapshot: idle(), now: NOW, usage, git: "feat/invite", ...extra });
const club = (extra = {}) => model({ club: true, invitedBy: "octocat", ...extra });
const draw = (m, motion = "full", t = 0, opts = {}) => {
  const profile = motionProfile(motion);
  return composeBand(m, sampleTimeline(createTimeline(m, 0, profile), t, profile), { columns: 100, glyphs: "basic", accent: "#5fd7ff", ...opts });
};
const sideColors = (frame) => frame.rows.slice(1, -1).map((row) => [row[0].fg, row.at(-1).fg]);

test("the ring runs gold → rose → violet around all four borders", () => {
  const frame = draw(club(), "off");
  assert.equal(frame.rows[0][0].fg, CLUB_GOLD, "the top-left corner starts gold");
  const sides = sideColors(frame);
  for (const [left, right] of sides) assert.notEqual(left, right, "the two sides wear different colours");
  assert.ok(new Set(sides.map(([, right]) => right)).size >= 2, "the right side changes colour down the card");
  const bottom = frame.rows.at(-1).filter(({ text }) => text === "─");
  assert.ok(new Set(bottom.map(({ fg }) => fg)).size >= 6, "the bottom rule is graded, not one colour");
});

// The first pass starts at TIMINGS.clubGlintRest and lasts TIMINGS.clubGlint; the next starts one
// TIMINGS.clubGlintPeriod later. Frames are compared once the card's entrance (under 400 ms) is over.
test("full motion glints along the top border only, at most once every three seconds", () => {
  const m = club();
  const still = draw(m, "off");
  // The light hides behind the title's pills for a moment, so a pass is a run of lit frames with
  // gaps shorter than a second.
  const starts = [];
  let last = -Infinity;
  for (let t = 500; t <= 10_000; t += 33) {
    const frame = draw(m, "full", t);
    assert.deepEqual(frame.rows.slice(1), still.rows.slice(1), `only the top row moves (${t} ms)`);
    if (JSON.stringify(frame.rows[0]) === JSON.stringify(still.rows[0])) continue;
    if (t - last > 1000) starts.push(t);
    last = t;
  }
  assert.ok(starts.length >= 2, "the glint passes");
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 3000, `passes ${starts[i - 1]} and ${starts[i]} ms are three seconds apart`);
  assert.ok(TIMINGS.clubGlintPeriod >= 3000);
});

test("subtle and off motion keep the ring still", () => {
  const m = club();
  const still = JSON.stringify(draw(m, "off").rows);
  for (const motion of ["subtle", "off"]) {
    for (const t of [500, 900, 1800, 2700, 4500, 6000]) assert.equal(JSON.stringify(draw(m, motion, t).rows), still, `${motion} ${t}`);
  }
});

test("glintWait: a frame timer only while a glint passes, the rest until the next one", () => {
  const m = club({ band: "always" });
  const full = motionProfile("full");
  const timeline = createTimeline(m, 0, full);
  assert.equal(glintWait(timeline, 0, full), TIMINGS.clubGlintRest);
  assert.equal(glintWait(timeline, TIMINGS.clubGlintRest + 10, full), TIMINGS.ambientFrame);
  assert.equal(glintWait(timeline, TIMINGS.clubGlintRest + TIMINGS.clubGlint + 100, full), TIMINGS.clubGlintPeriod - TIMINGS.clubGlint - 100);
  assert.equal(glintWait(createTimeline(m, 0, motionProfile("subtle")), 0, motionProfile("subtle")), null);
  assert.equal(glintWait(createTimeline(model(), 0, full), 0, full), null, "no club, no glint");
});

test("CLUB ✦ is a filled gold-gradient pill under dark ink", () => {
  const top = draw(club(), "off").rows[0];
  // The pill is drawn a cell at a time so each cell takes its own fill; the brand pill is one span.
  const label = top.filter(({ text, bg }) => bg && [...text].length === 1 && /^[CLUB✦]$/u.test(text));
  assert.equal(label.map(({ text }) => text).join(""), "CLUB✦");
  for (const { fg } of label) assert.equal(fg, "#0b0f14");
  assert.ok(new Set(label.map(({ bg }) => bg)).size >= 3, "the fill is graded");
  assert.equal(label[0].bg, CLUB_GOLD);
});

test("sparkles stand at the title's corners", () => {
  const club100 = rowText(draw(club(), "off").rows[0]);
  assert.match(club100, /✧ .*LIT.* · ready ✦ /u);
  assert.doesNotMatch(rowText(draw(model(), "off").rows[0]), /✧/u);
});

test("the idle club card carries a quiet invited-by chip", () => {
  const chips = rowText(draw(club(), "off").rows.at(-2));
  assert.match(chips, /invited by @octocat/u);
  assert.match(rowText(draw(club(), "off", 0, { columns: 60 }).rows.at(-2)), /invited by @octocat|type lit <task>/u);
  assert.doesNotMatch(rowText(draw(model(), "off").rows.at(-2)), /invited by/u);
  assert.equal(club({ completion: { id: "goal:x", detail: "goal met" } }).invitedBy, null, "only the club look shows it");
  assert.equal(model().invitedBy, null);
});

test("the svg card wears the ring, the gradient pill, the sparkles, the chip and the glint", () => {
  const full = composeSvgCard(club()).source;
  assert.match(full, /lit-club-pill/u);
  assert.match(full, /invited by/u);
  assert.match(full, /@octocat/u);
  assert.match(full, /✧/u);
  assert.match(full, /lit-club-glint/u);
  assert.doesNotMatch(composeSvgCard(club(), { motion: "off" }).source, /lit-club-glint/u);
  assert.doesNotMatch(composeSvgCard(club(), { motion: "subtle" }).source, /lit-club-glint/u);
  assert.doesNotMatch(composeSvgCard(model()).source, /invited by|lit-club/u);
});

test("readInvited gives the inviter's id, or null", async () => {
  const io = (files) => ({
    stat: async (path) => {
      if (Object.hasOwn(files, path)) return { kind: "file", size: files[path].length, isLink: false, realPath: path };
      if (Object.keys(files).some((name) => name.startsWith(`${path}/`))) return { kind: "directory", size: 0, isLink: false, realPath: path };
      return null;
    },
    read: async (path) => files[path],
  });
  const record = JSON.stringify({ version: 1, invitedBy: "octocat", at: "2026-10-28T00:00:00.000Z" });
  assert.equal(await readInvited(io({ "/u/.litclaude/invite.json": record }), { HOME: "/u" }), "octocat");
  assert.equal(await readInvited(io({}), { HOME: "/u" }), null);
});
