// The floor every LIT card look stands on (plans/mod-skill-looks.md): no more than three large-area
// luminance flips in any second, a card exactly its width at every size in both glyph sets, dark
// ink at 4.5:1 or better on every filled cell, a still card with motion off, and no colour at all
// under NO_COLOR. Each look in the registry is drawn the way view.mjs selects it.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand } from "../plugins/litclaude/lib/mod/frame.mjs";
import { charWidth } from "../plugins/litclaude/lib/mod/layout.mjs";
import { LOOKS } from "../plugins/litclaude/lib/mod/looks.mjs";
import { motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { createTimeline, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 20_000_000;
const SID = "looks-safety-01";
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const usage = { context: { percent: 42 }, rateLimits: [{ kind: "five_hour", percentUsed: 31 }] };
const reviewing = () => {
  const stack = parseWorkflowStack({ version: 1, sessionId: SID, frames: [{ skill: "review-work", family: "main", stage: "review", role: "spine", status: "active", verdicts: { goal: "pass", qa: "running", security: "fail" }, at: new Date(NOW - 2000).toISOString() }], history: [] }, SID);
  return { ...idle(), ignition: { discipline: "review-work", at: NOW - 1000 }, workflow: { stack, record: stack.record } };
};
const skills = [{ id: "lit-adhd", at: NOW - 3000, state: "current" }, { id: "lit-plan", at: NOW - 90_000, state: "recent" }];
const MODELS = {
  rewind: () => buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-adhd", at: NOW - 1000 } }, now: NOW, isWorking: true, usage, skills, git: "fix/1041" }),
  review: () => buildBandModel({ snapshot: reviewing(), now: NOW, isWorking: true, usage, git: "fix/1041" }),
  turn: () => buildBandModel({ snapshot: idle(), now: NOW, usage, waiting: { reason: "question" }, git: "fix/1041" }),
  done: () => buildBandModel({ snapshot: idle(), now: NOW, usage, completion: { id: "goal:x", detail: "goal met · 3/3 criteria" }, git: "fix/1041" }),
  club: () => buildBandModel({ snapshot: idle(), now: NOW, usage, club: true, invitedBy: "octocat", skills: [{ id: "lit-plan", at: NOW - 90_000, state: "recent" }], git: "fix/1041" }),
};

const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// One entry per cell: the brighter of the glyph (blank cells have none) and the fill it stands on.
const CARD_BG = "#0d1117";
const cells = (frame) => frame.rows.flatMap((row) => row.flatMap((part) => [...part.text].flatMap((ch) => {
  const ink = ch.trim() && part.fg ? lum(part.fg) : 0;
  return Array.from({ length: charWidth(ch) }, () => Math.max(ink, lum(part.bg ?? CARD_BG)));
})));
const draw = (model, motion, t, opts = {}) => {
  const profile = motionProfile(motion);
  return composeBand(model, sampleTimeline(createTimeline(model, 0, profile), t, profile), { columns: 100, glyphs: "basic", accent: "#5fd7ff", ...opts });
};

test("every look in the registry is drawn, and only by its own model", () => {
  for (const look of Object.keys(LOOKS)) {
    const model = MODELS[look]();
    assert.equal(model.look, look);
    assert.equal(draw(model, "full", 1000).look, look);
  }
});

test("flash floor: no look flips a quarter of the card's luminance more than three times in any second", () => {
  for (const look of Object.keys(LOOKS)) {
    const model = MODELS[look]();
    const profile = motionProfile("full");
    const timeline = createTimeline(model, 0, profile);
    const series = [];
    for (let t = 0; t <= 6000; t += 33) series.push(cells(composeBand(model, sampleTimeline(timeline, t, profile), { columns: 100, glyphs: "basic", accent: "#5fd7ff" })));
    const large = series.slice(1).map((frame, i) => {
      const before = series[i];
      const flipped = frame.filter((v, k) => Math.abs(v - (before[k] ?? 0)) >= 0.1).length;
      return flipped / frame.length >= 0.25;
    });
    for (let start = 0; start + 30 <= large.length; start += 1) {
      const count = large.slice(start, start + 30).filter(Boolean).length;
      assert.ok(count <= 3, `${look}: ${count} large flips in the second from ${start * 33} ms`);
    }
  }
});

test("width: each look keeps every row at the card's width at 60, 100, 120 and 160 columns in both glyph sets", () => {
  for (const look of Object.keys(LOOKS)) {
    const model = MODELS[look]();
    for (const columns of [60, 100, 120, 160]) {
      for (const glyphs of ["basic", "nerd"]) {
        for (const t of [0, 400, 1300, 2500]) {
          const frame = draw(model, "full", t, { columns, glyphs });
          for (const row of frame.rows) assert.equal(row.reduce((sum, part) => sum + [...part.text].reduce((w, ch) => w + charWidth(ch), 0), 0), frame.width, `${look} ${columns} ${glyphs} ${t}`);
        }
      }
    }
  }
});

test("contrast: dark ink on every light cell of every look reads at 4.5:1 or better", () => {
  for (const look of Object.keys(LOOKS)) {
    const model = MODELS[look]();
    for (const t of [0, 300, 700, 1200, 2400, 3700]) {
      for (const part of draw(model, "full", t).rows.flat()) {
        if (!part.fg || !part.bg || !part.text.trim()) continue;
        assert.ok(contrast(part.fg, part.bg) >= 4.5, `${look} at ${t} ms: "${part.text}" ${part.fg} on ${part.bg}`);
      }
    }
  }
});

test("motion off and reduced motion: every look draws one still frame", () => {
  for (const look of Object.keys(LOOKS)) {
    const model = MODELS[look]();
    const frames = [0, 500, 1700, 4000].map((t) => JSON.stringify(draw(model, "off", t).rows));
    assert.equal(new Set(frames).size, 1, look);
  }
});

test("NO_COLOR: every look draws its labels with no colour on any cell", () => {
  for (const look of Object.keys(LOOKS)) {
    const model = MODELS[look]();
    const plain = draw(model, "off", 0, { color: false });
    const colored = draw(model, "off", 0);
    assert.equal(plain.border, null);
    for (const part of plain.rows.flat()) assert.ok(!("fg" in part) && !("bg" in part), `${look}: ${JSON.stringify(part)}`);
    assert.deepEqual(plain.rows.map((row) => row.map(({ text }) => text).join("")), colored.rows.map((row) => row.map(({ text }) => text).join("")), look);
  }
});
