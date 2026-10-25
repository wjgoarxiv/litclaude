// plans/lit-adhd.md todo 13 (D7): the rewind look of the LIT card while lit-adhd (or lit-rewind) runs.
import assert from "node:assert/strict";
import test from "node:test";

import { CARD_MAX, composeBand, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { charWidth } from "../plugins/litclaude/lib/mod/layout.mjs";
import { TIMINGS, lookOf, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { effectiveMotion } from "../plugins/litclaude/lib/mod/settings.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { ambientActive, createTimeline, sampleTimeline, timelineBusy } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";
import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";

const NOW = 10_000_000;
const CYAN = "#5fd7ff";
const CARD_BG = "#0d1117";
const snapshotOf = (discipline) => ({
  ignition: { discipline, at: NOW - 1000 },
  work: null,
  completedWorkIds: [],
  goal: null,
  autoloop: null,
  litPlan: null,
  probe: null,
  motion: null,
  handoff: null,
});
const modelOf = (discipline, extra = {}) => buildBandModel({
  snapshot: snapshotOf(discipline),
  usage: { context: { percent: 42 }, rateLimits: [{ kind: "five_hour", percentUsed: 31 }] },
  now: NOW,
  isWorking: true,
  git: "main",
  step: { name: "Bash", at: NOW - 12_000 },
  skills: [{ id: discipline, at: NOW - 100, state: "current" }, { id: "lit-plan", at: NOW - 60_000, state: "recent" }],
  ...extra,
});

// A row as cells: one entry per terminal column, a wide character's second column marked `wide`.
const cellsOf = (row) => row.flatMap(({ text, fg, bg }) => [...text].flatMap((ch) => {
  const cell = { ch, fg: fg ?? null, bg: bg ?? null };
  return charWidth(ch) === 2 ? [cell, { ch: "", fg: cell.fg, bg: cell.bg, wide: true }] : [cell];
}));
const ascii = (ch) => /^[\x20-\x7e]$/u.test(ch);

const frames = (model, profile, { columns = 100, from = 1000, step = 66, count = 60, glyphs = "basic" } = {}) => {
  const timeline = createTimeline(model, 0, profile);
  return Array.from({ length: count }, (_, i) => composeBand(model, sampleTimeline(timeline, from + i * step, profile), { columns, glyphs, accent: CYAN }));
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
// Mean relative luminance of the whole card: a blank cell is its background, a glyph cell is half
// ink and half background (conservative: a box rule covers far less than half its cell).
const meanLum = (frame) => {
  const cells = frame.rows.flatMap(cellsOf).filter(({ wide }) => !wide);
  const sum = cells.reduce((total, { ch, fg, bg }) => {
    const back = relLum(bg ?? CARD_BG);
    return total + (ch.trim() ? 0.5 * back + 0.5 * relLum(fg ?? "#e6edf3") : back);
  }, 0);
  return sum / cells.length;
};
// Swings of ≥ 10 % (of the brighter end) that reverse the previous swing's direction, by frame index.
const opposingSwings = (series) => {
  const swings = [];
  let anchor = series[0];
  let direction = 0;
  series.forEach((value, index) => {
    const change = value - anchor;
    if (Math.abs(change) >= 0.1 * Math.max(value, anchor)) {
      const now = Math.sign(change);
      if (direction !== 0 && now !== direction) swings.push(index);
      direction = now;
      anchor = value;
    } else if (Math.sign(change) === direction && direction !== 0) {
      anchor = value;
    }
  });
  return swings;
};

test("the rewind look is keyed on the ignition discipline lit-adhd or lit-rewind only", () => {
  assert.equal(lookOf("lit-adhd"), "rewind");
  assert.equal(lookOf("lit-rewind"), "rewind");
  for (const other of ["lit-loop", "start-work", "lit-plan", null, undefined, "LIT-ADHD"]) assert.equal(lookOf(other), null, String(other));
  const full = motionProfile("full");
  assert.equal(frames(modelOf("lit-adhd"), full, { count: 1 })[0].look, "rewind");
  assert.equal(frames(modelOf("lit-rewind"), full, { count: 1 })[0].look, "rewind");
  const other = frames(modelOf("lit-loop"), full, { count: 30 });
  for (const frame of other) {
    assert.equal(frame.look, null);
    const sides = frame.rows.slice(1, 4).map((row) => row[0].fg);
    assert.equal(new Set(sides).size, 1, "another discipline keeps its one border colour");
    assert.doesNotMatch(rowText(frame.rows[4]), /</u, "no rewind sweep on another discipline");
  }
  const idleAdhd = buildBandModel({ snapshot: { ...snapshotOf("lit-adhd"), ignition: null }, now: NOW, lastDiscipline: "lit-adhd" });
  assert.equal(frames(idleAdhd, full, { count: 1 })[0].look, null, "an idle card is not psychedelic");
});

test("the rewind look repaints only through ASCII: non-ASCII glyphs stay fixed over 60 frames", () => {
  for (const glyphs of ["basic", "nerd"]) {
    const sampled = frames(modelOf("lit-adhd"), motionProfile("full"), { glyphs, count: 60 });
    let asciiChanges = 0;
    let colourOnly = 0;
    for (let i = 1; i < sampled.length; i += 1) {
      sampled[i].rows.forEach((row, r) => {
        const before = cellsOf(sampled[i - 1].rows[r]);
        const after = cellsOf(row);
        assert.equal(after.length, before.length);
        after.forEach((cell, c) => {
          const old = before[c];
          if (cell.ch !== old.ch) {
            assert.ok(ascii(cell.ch) || ascii(old.ch), `${glyphs} frame ${i} row ${r} col ${c}: "${old.ch}" → "${cell.ch}"`);
            asciiChanges += 1;
          } else if (cell.fg !== old.fg && cell.ch && !ascii(cell.ch)) {
            colourOnly += 1;
          }
        });
      });
    }
    assert.ok(asciiChanges > 0, "sparks and the sweep move through ASCII cells");
    assert.ok(colourOnly > 0, "the rainbow cycles by colour on the fixed border glyphs");
  }
});

test("the rewind look is drawn: rainbow border and rails, sparks in the skills row, a << sweep on the bottom rule", () => {
  const sampled = frames(modelOf("lit-adhd"), motionProfile("full"), { count: 60 });
  const sides = sampled[0].rows.slice(1, 4).map((row) => row[0].fg);
  const top = sampled[0].rows[0].filter(({ text }) => text === "─").map(({ fg }) => fg);
  assert.ok(new Set(top).size >= 6, "the top rule is a gradient, not one colour");
  assert.ok(new Set([...sides, ...top]).size >= 6);
  assert.ok(sampled.some((frame) => /<</u.test(rowText(frame.rows[4]))), "the rewind comet runs on the bottom rule");
  const heads = sampled.map((frame) => rowText(frame.rows[4]).indexOf("<<")).filter((x) => x >= 0);
  assert.ok(heads.length >= 2 && heads.some((x, i) => i > 0 && x < heads[i - 1]), "the sweep travels right to left");
  assert.ok(sampled.every((frame) => !/<</u.test(rowText(frame.rows[0]))), "only the bottom rule carries the sweep");
  const chipsRows = sampled.map((frame) => rowText(frame.rows[3]));
  assert.ok(chipsRows.some((row) => /[.*+'] *│$/u.test(row) || /[.*+']/u.test(row.split("lit-plan")[1] ?? "")), "sparks drift in the spare cells");
  assert.ok(new Set(chipsRows).size >= 3, "the sparks move");
  for (const row of chipsRows) assert.match(row, /lit-adhd.*lit-plan/u, "the chips stay put");
});

test("flash safety: no more than 3 opposing 10 % luminance swings in any 1 s window over 3 s at 60/80/100 columns", () => {
  for (const motion of ["full", "subtle"]) {
    for (const columns of [60, 80, 100]) {
      const series = frames(modelOf("lit-adhd"), motionProfile(motion), { columns, from: 500, step: TIMINGS.frame, count: Math.ceil(3000 / TIMINGS.frame) }).map(meanLum);
      const swings = opposingSwings(series);
      for (const at of swings) {
        const inWindow = swings.filter((other) => other >= at && (other - at) * TIMINGS.frame < 1000).length;
        assert.ok(inWindow <= 3, `${motion} ${columns}: ${inWindow} opposing swings within 1 s from frame ${at}`);
      }
    }
  }
});

test("title, detail and skill names keep a readable colour (≥ 4.5:1) in every rewind frame", () => {
  const model = modelOf("lit-adhd");
  for (const columns of [60, 100]) {
    for (const frame of frames(model, motionProfile("full"), { columns, count: 60 })) {
      const checks = [[0, model.title], [2, "Bash"], [3, "lit-adhd"], [3, "lit-plan"]];
      for (const [r, word] of checks) {
        const cells = cellsOf(frame.rows[r]);
        const at = cells.map(({ ch }) => ch).join("").indexOf(word);
        assert.ok(at >= 0, `row ${r} shows ${word}: ${rowText(frame.rows[r])}`);
        for (const cell of cells.slice(at, at + word.length)) {
          const ratio = contrast(cell.fg, cell.bg ?? CARD_BG);
          assert.ok(ratio >= 4.5, `${word} "${cell.ch}" ${cell.fg} on ${cell.bg ?? CARD_BG}: ${ratio.toFixed(2)}`);
        }
      }
    }
  }
});

test("subtle drifts the hue only; off draws one static rainbow frame", () => {
  const model = modelOf("lit-adhd");
  const subtle = frames(model, motionProfile("subtle"), { count: 60 });
  for (const frame of subtle) {
    assert.doesNotMatch(rowText(frame.rows[4]), /</u, "subtle has no sweep");
    assert.doesNotMatch(rowText(frame.rows[3]).split("lit-plan")[1], /[.*+']/u, "subtle has no sparks");
  }
  const ruleColours = (frame) => frame.rows[0].filter(({ text }) => text === "─").map(({ fg }) => fg).join(",");
  assert.ok(new Set(subtle.map(ruleColours)).size >= 3, "subtle drifts the hue");

  // Without a live step: its clock still ticks each second under motion off, as on every card.
  const still = modelOf("lit-adhd", { step: null });
  const off = motionProfile("off");
  const timeline = createTimeline(still, 0, off);
  assert.equal(ambientActive(timeline, off), false);
  assert.equal(timelineBusy(timeline, 1, off), false, "off starts no frame timer");
  const stills = [1, 700, 5000].map((t) => composeBand(still, sampleTimeline(timeline, t, off), { columns: 100, glyphs: "basic", accent: CYAN }));
  assert.equal(new Set(stills.map((frame) => JSON.stringify(frame.rows))).size, 1, "off is a single static frame");
  assert.ok(new Set(stills[0].rows[0].filter(({ text }) => text === "─").map(({ fg }) => fg)).size >= 6, "off keeps the rainbow border");
  assert.doesNotMatch(rowText(stills[0].rows[4]), /</u);
  assert.doesNotMatch(rowText(stills[0].rows[3]).split("lit-plan")[1], /[.*+']/u);
});

test("Claude Code's prefersReducedMotion forces motion off when the key is set", () => {
  for (const motion of ["full", "subtle", "off"]) {
    assert.equal(effectiveMotion(motion, { prefersReducedMotion: true }), "off");
    assert.equal(effectiveMotion(motion, { prefersReducedMotion: false }), motion);
    assert.equal(effectiveMotion(motion, {}), motion);
    assert.equal(effectiveMotion(motion, null), motion);
  }
});

// Just enough of the mods host to start a session and draw the band, with the given Claude Code settings.
const drawWith = async (hostSettings) => {
  const hooks = [];
  register((event, matcher, hook) => {
    hooks.push(typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook });
    return { catch: () => undefined };
  }, { motion: "full", glyphs: "basic" });
  const timers = [];
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: ({ children }) => ({ kind: "text", text: children }),
    Svg: (props) => ({ kind: "svg", ...props }),
    Client: (props) => ({ kind: "client", ...props }),
  };
  const $ = {
    fs: { stat: async () => null, read: async () => { throw new Error("ENOENT"); } },
    session: { cwd: async () => "/nowhere/project", id: async () => "rewind-session", usage: async () => null, surfaces: async () => ["terminal"] },
    agent: { list: async () => [] },
    clock: { now: async () => NOW, after: (ms, fn) => { timers.push(fn); }, every: () => () => undefined },
    env: { get: async () => undefined },
    settings: { read: async () => hostSettings },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, open: async () => undefined, resolve: () => elements, notify: async () => ({ isSent: false }) },
    audio: { play: async () => undefined },
  };
  const fire = async (event, e, matcher = {}) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const run = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => run(index + 1, next)) : undefined);
    return run(0, e);
  };
  await fire("session.start", {});
  while (timers.length) await timers.shift()();
  const find = (node) => (node?.kind === "client" ? node : (node?.children ?? []).map(find).find(Boolean));
  return find(await fire("ui.render", { surface: "terminal", props: { bodyColumns: 80 } }, { component: "AbovePrompt" }));
};

test("the mod hands the band motion off when Claude Code's prefersReducedMotion is on", async () => {
  assert.equal((await drawWith({ prefersReducedMotion: true })).props.motion, "off");
  assert.equal((await drawWith({ prefersReducedMotion: false })).props.motion, "full");
  assert.equal((await drawWith({})).props.motion, "full");
});

test("the SVG card animates the rainbow hue with SMIL, opens mid-cycle and stays time-independent", () => {
  const model = modelOf("lit-adhd");
  const full = composeSvgCard(model, { motion: "full", accent: CYAN });
  assert.equal(full.source, composeSvgCard(model, { motion: "full", accent: CYAN }).source, "the source does not depend on time");
  assert.ok(full.source.length < 131072);
  assert.match(full.source, /stroke="url\(#lit-rainbow\)"/u);
  assert.match(full.source, /<animate attributeName="stop-color"[^>]*dur="\d+ms" begin="-\d+ms" repeatCount="indefinite"/u);
  const duration = Number(/attributeName="stop-color"[^>]*dur="(\d+)ms"/u.exec(full.source)[1]);
  assert.ok(duration >= 2400, "the hue period is at least 2.4 s");
  const subtle = composeSvgCard(model, { motion: "subtle", accent: CYAN }).source;
  assert.match(subtle, /attributeName="stop-color"/u, "subtle keeps the hue drift");
  const off = composeSvgCard(model, { motion: "off", accent: CYAN }).source;
  assert.match(off, /url\(#lit-rainbow\)/u, "off keeps a static rainbow border");
  assert.doesNotMatch(off, /<animate/u);
  assert.doesNotMatch(composeSvgCard(modelOf("lit-loop"), { motion: "full", accent: CYAN }).source, /lit-rainbow/u, "other disciplines keep their look");
});

test("every rewind row stays exactly the card width from 20 to 200 columns", () => {
  const model = modelOf("lit-adhd");
  for (const motion of ["full", "subtle", "off"]) {
    const profile = motionProfile(motion);
    const timeline = createTimeline(model, 0, profile);
    for (const glyphs of ["basic", "nerd"]) {
      for (let columns = 20; columns <= 200; columns += 1) {
        for (const t of [0, 200, 900, 1700, 2600, 4100]) {
          const frame = composeBand(model, sampleTimeline(timeline, t, profile), { columns, glyphs, accent: CYAN });
          assert.equal(frame.rows.length, 5);
          for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(columns, CARD_MAX), `${motion} ${glyphs} ${columns} t=${t}: "${rowText(row)}"`);
        }
      }
    }
  }
});
