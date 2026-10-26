// BRIEF-feedback-1038 C: the rewind look stays on while the user reads the brief. The ignition
// record names lit-adhd until the next prompt, but once the turn ends the card went idle and the
// rainbow vanished, so on the real surface the look showed only while the collector ran. It now
// lingers for REWIND_LINGER_MS after the ignition, with a rainbow REWIND indicator, a hue-cycling
// lit-adhd chip and pill, and sparks in the SVG card too, inside the same flash-safety floor.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { textWidth } from "../plugins/litclaude/lib/mod/layout.mjs";
import { TIMINGS, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { ambientActive, createTimeline, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { REWIND_LINGER_MS, buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 10_000_000;
const CYAN = "#5fd7ff";
const CARD_BG = "#0d1117";
const snapshotOf = (discipline, at) => ({ ignition: discipline ? { discipline, at } : null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
// The card after the brief's turn ended: not working, the lit-adhd chip settled to recent.
const afterTurn = (discipline = "lit-adhd", sinceIgnition = 60_000) => buildBandModel({
  snapshot: snapshotOf(discipline, NOW - sinceIgnition),
  now: NOW,
  isWorking: false,
  lastDiscipline: discipline,
  skills: discipline ? [{ id: discipline, at: NOW - sinceIgnition, state: "recent" }] : [],
});
const frames = (model, motion, { count = 60, step = 66, columns = 100 } = {}) => {
  const profile = motionProfile(motion);
  const timeline = createTimeline(model, 0, profile);
  return { timeline, profile, list: Array.from({ length: count }, (_, i) => composeBand(model, sampleTimeline(timeline, 1000 + i * step, profile), { columns, glyphs: "basic", accent: CYAN })) };
};
const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const relLum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("after the brief's turn ends the card keeps the rewind look and its motion", () => {
  const model = afterTurn();
  assert.equal(model.rewind, true);
  const { timeline, profile, list } = frames(model, "full");
  assert.ok(ambientActive(timeline, profile), "the ambient loop keeps running while the user reads");
  for (const frame of list) assert.equal(frame.look, "rewind");
  assert.ok(list.some((frame) => /<</u.test(rowText(frame.rows[4]))), "the << comet still sweeps");
  assert.ok(new Set(list.map((frame) => frame.rows[1][0].fg)).size >= 3, "the rainbow border keeps turning");
  assert.match(rowText(list[0].rows[0]), /REWIND <</u, "the indicator says REWIND, not idle");
  assert.doesNotMatch(rowText(list[0].rows[0]), / idle /u);
});

test("the REWIND indicator, the title and the lit-adhd chip turn through the rainbow and stay readable", () => {
  const model0 = afterTurn();
  const { list } = frames(model0, "full");
  const indicator = (frame) => frame.rows[0].filter(({ text }) => /^[REWIND<]+$/u.test(text)).map(({ fg }) => fg);
  assert.ok(new Set(indicator(list[0])).size >= 3, "each letter takes its own hue");
  assert.ok(new Set(list.map((frame) => indicator(frame).join())).size >= 3, "and the hues move");
  // The pills are drawn one cell per span, each cell a step round the wheel.
  const cells = (row, word) => {
    const at = row.findIndex((_, i) => row.slice(i, i + word.length).map(({ text }) => text).join("") === word);
    return at === -1 ? [] : row.slice(at, at + word.length);
  };
  const chip = (frame) => cells(frame.rows[3], "lit-adhd");
  const brand = (frame) => cells(frame.rows[0], "LIT");
  assert.ok(new Set(chip(list[0]).map(({ bg }) => bg)).size >= 3, "the lit-adhd chip is a rainbow, not one tint");
  assert.ok(new Set(brand(list[0]).map(({ bg }) => bg)).size >= 3, "so is the LIT pill");
  assert.ok(new Set(list.map((frame) => chip(frame)[0]?.bg)).size >= 3, "the lit-adhd chip's pill cycles its hue");
  assert.ok(new Set(list.map((frame) => brand(frame)[0]?.bg)).size >= 3, "the LIT pill cycles its hue");
  const phaseInk = (frame) => frame.rows[1].find(({ text }) => text.includes("PLAN"))?.fg;
  assert.ok(new Set(list.map(phaseInk)).size >= 3, "the phase labels turn too");
  const withContext = frames({ ...model0, figures: { ...model0.figures, context: 6 } }, "full", { count: 1 }).list;
  const bar = (frame) => frame.rows[4].filter(({ text }) => /^[▰▱]$/u.test(text)).map(({ fg }) => fg);
  assert.ok(new Set(bar(withContext[0])).size >= 3, "the context bar cells take the rainbow, even at 6 %");
  for (const frame of list) {
    for (const { text, fg, bg } of [...chip(frame), ...brand(frame)]) {
      assert.ok(contrast(fg, bg) >= 4.5, `pill ${text} ${fg} on ${bg}`);
    }
    for (const { text, fg, bg } of frame.rows[0].filter(({ text }) => /^[REWIND<]+$/u.test(text))) {
      assert.ok(contrast(fg, bg ?? CARD_BG) >= 4.5, `indicator ${text} ${fg}`);
    }
  }
});

test("every row of the rainbow card closes at the same column, emoji and Nerd Font caps included", () => {
  const base = afterTurn();
  const models = [base, { ...base, figures: { ...base.figures, context: 63 } }, afterTurn("lit-adhd", 1000)];
  for (const glyphs of ["basic", "nerd"]) {
    for (const columns of [60, 100, 120, 160]) {
      for (const model of models) {
        const profile = motionProfile("full");
        const timeline = createTimeline(model, 0, profile);
        for (let i = 0; i < 40; i += 1) {
          const frame = composeBand(model, sampleTimeline(timeline, 1000 + i * 97, profile), { columns, glyphs, accent: CYAN });
          frame.rows.forEach((row, r) => assert.equal(textWidth(rowText(row)), frame.width, `${glyphs} ${columns} cols, frame ${i}, row ${r}: ${rowText(row)}`));
        }
      }
    }
  }
});

test("the look ends: on the next prompt's discipline, after the linger window, and never without an ignition", () => {
  assert.equal(afterTurn("lit-adhd", REWIND_LINGER_MS + 1000).rewind, false);
  assert.equal(frames(afterTurn("lit-adhd", REWIND_LINGER_MS + 1000), "full", { count: 1 }).list[0].look, null);
  assert.equal(afterTurn("lit-loop").rewind, false);
  assert.equal(frames(afterTurn(null), "full", { count: 1 }).list[0].look, null, "an idle card is not psychedelic");
  const lapsed = afterTurn("lit-adhd", REWIND_LINGER_MS + 1000);
  const { timeline, profile } = frames(lapsed, "full", { count: 1 });
  assert.equal(ambientActive(timeline, profile), false, "an idle card starts no frame timer");
  assert.ok(REWIND_LINGER_MS >= 5 * 60_000 && REWIND_LINGER_MS <= 30 * 60_000);
});

test("flash floor while lingering: the border's luminance never swings 10 % three times in a second", () => {
  for (const motion of ["full", "subtle"]) {
    const series = frames(afterTurn(), motion, { count: Math.ceil(3000 / TIMINGS.frame), step: TIMINGS.frame }).list.map((frame) => relLum(frame.rows[1][0].fg));
    let anchor = series[0];
    let direction = 0;
    const swings = [];
    series.forEach((value, index) => {
      const change = value - anchor;
      if (Math.abs(change) >= 0.1 * Math.max(value, anchor)) {
        if (direction !== 0 && Math.sign(change) !== direction) swings.push(index);
        direction = Math.sign(change);
        anchor = value;
      }
    });
    for (const at of swings) assert.ok(swings.filter((o) => o >= at && (o - at) * TIMINGS.frame < 1000).length <= 3, `${motion} from frame ${at}`);
  }
});

test("motion subtle and off: subtle drifts the hue without sparks or comet, off is one still rainbow frame", () => {
  const subtle = frames(afterTurn(), "subtle").list;
  for (const frame of subtle) assert.doesNotMatch(rowText(frame.rows[4]), /</u);
  assert.ok(new Set(subtle.map((frame) => frame.rows[1][0].fg)).size >= 2, "subtle still drifts");
  const off = frames(afterTurn(), "off", { count: 4, step: 900 });
  assert.equal(ambientActive(off.timeline, off.profile), false);
  assert.equal(new Set(off.list.map((frame) => JSON.stringify(frame.rows))).size, 1);
  assert.equal(off.list[0].look, "rewind");
  assert.match(rowText(off.list[0].rows[0]), /REWIND/u);
});

test("SVG card: rainbow border, REWIND pill and drifting sparks after the turn; still under motion off", () => {
  const model = afterTurn();
  const full = composeSvgCard(model, { motion: "full", accent: CYAN });
  assert.match(full.source, /stroke="url\(#lit-rainbow\)"/u);
  assert.match(full.source, />REWIND &lt;&lt;</u);
  assert.ok((full.source.match(/class="lit-spark"/gu) ?? []).length >= 5, "sparks in the skills row");
  assert.match(full.source, /class="lit-spark"[^>]*>[^<]*<\/text>|class="lit-spark"[\s\S]*?<animate/u);
  assert.match(full.alt, /rewind/iu);
  const off = composeSvgCard(model, { motion: "off", accent: CYAN }).source;
  assert.match(off, /url\(#lit-rainbow\)/u);
  assert.match(off, />REWIND &lt;&lt;</u);
  assert.doesNotMatch(off, /<animate/u);
  assert.doesNotMatch(composeSvgCard(afterTurn(null), { motion: "full", accent: CYAN }).source, /lit-rainbow|lit-spark|REWIND/u);
});
