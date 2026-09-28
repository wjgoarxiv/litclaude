import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fnv1a32, passSeed, mulberry32, keys, ease } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/util.mjs";
import { smart, plain, scriptRuns, eojeol, readingFloor, readingCounts, textScript } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/text.mjs";
import { buildTimeline } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/timeline.mjs";
import { pickPreset, PRESETS } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/presets.mjs";
import { POST_FIELDS, SAMPLING } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/constants.mjs";
import { ShotEvents } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/events.mjs";
import { runFontKey } from "../plugins/litclaude/skills/lit-typographic-motion/engine/core/voices.mjs";

// The page modules touch the DOM only when constructed, so Node can import them for their pure
// parts (scale.mjs guards its `location` read).
const { normalizePost } = await import("../plugins/litclaude/skills/lit-typographic-motion/engine/web/post.mjs");
const { Engine } = await import("../plugins/litclaude/skills/lit-typographic-motion/engine/web/engine.mjs");

describe("lit-typographic-motion engine units", () => {
  it("fnv1a32 matches the published FNV-1a 32-bit vectors and the spec's seed formula", () => {
    assert.equal(fnv1a32(""), 0x811c9dc5);
    assert.equal(fnv1a32("a"), 0xe40c292c);
    assert.equal(fnv1a32("foobar"), 0xbf9cf968);
    // The spec's manifest example: dither seeds for title-slam#0 and kinetic-list#0 at run seed 20260926.
    assert.equal(passSeed(20260926, "title-slam", 0, "dither"), 3693088578);
    assert.equal(passSeed(20260926, "kinetic-list", 0, "dither"), 3371724920);
    assert.notEqual(passSeed(1, "s", 0, "glitch"), passSeed(1, "s", 0, "dither"));
  });

  it("mulberry32 is the unsigned 32-bit reference stream", () => {
    const r = mulberry32(1);
    assert.equal(r().toFixed(12), "0.627073940588");
    assert.equal(r().toFixed(12), "0.002735721180");
    assert.equal(r().toFixed(12), "0.527447039960");
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) assert.equal(a(), b());
  });

  it("pins the sub-sample times: t_n + (shutter/fps)((i+0.5)/N - 0.5), clamped at 0 (MO-A-28)", () => {
    const sampleTime = (...args) => Engine.prototype.sampleTime.call({ fps: 60 }, ...args);
    const times = [0, 1, 2, 3].map((i) => sampleTime(60, i, SAMPLING.masterSamples, SAMPLING.masterShutter, 60));
    assert.deepEqual(times.map((t) => +t.toFixed(7)), [0.996875, 0.9989583, 1.0010417, 1.003125]);
    assert.equal(sampleTime(0, 0, 4, 0.5, 60), 0, "clamped at zero before the film starts");
    assert.equal(sampleTime(10, 0, 1, 0.5, 60), 10 / 60, "one sample sits on the frame time");
    assert.equal(sampleTime(12, 1, 4, 0.5, 24), 0.5 + (0.5 / 24) * (1.5 / 4 - 0.5), "the preview fps uses the same pattern");
  });

  it("one reading floor for every kind (MO-C-07/08)", () => {
    assert.equal(readingFloor("새벽마다 조용하게 편지를 씁니다", "line").toFixed(2), (0.2 * 14).toFixed(2), "4 eojeol / 14 syllables floors at 2.8 s");
    assert.equal(readingCounts("새벽마다 조용하게 편지를 씁니다").H, 14);
    assert.equal(readingFloor("Hi", "line"), 0.9, "a short Latin line floors at 0.9 s");
    assert.equal(readingFloor("안녕", "line"), 1.0, "any Hangul line floors at 1.0 s");
    assert.equal(readingFloor("go", "word"), 0.5);
    assert.equal(readingFloor("an unexpectedly long reveal", "reveal"), 0.35);
    const mixed = "LIT 스튜디오 opens tonight";
    assert.equal(+readingFloor(mixed, "line").toFixed(4), +Math.max(1.0, 0.2 * 4 + 3 / 3.3).toFixed(4));
    assert.equal(readingFloor("", "scene"), 0);
  });

  it("breaks Korean only between eojeol, and reveals are whole eojeol", () => {
    assert.deepEqual(eojeol("  밤이 깊어도   불은 켜져 있다 "), ["밤이", "깊어도", "불은", "켜져", "있다"]);
    const { timeline } = buildTimeline({ shots: [{ scene: "karaoke-line", text: "밤이 깊어도 불은 켜져 있다" }] });
    const reveals = timeline.filter((u) => u.kind === "reveal").map((u) => u.text);
    assert.deepEqual(reveals, ["밤이", "깊어도", "불은", "켜져", "있다"]);
  });

  it("splits script runs at the script boundary; digits and punctuation attach to a neighbour (MO-FT-04)", () => {
    assert.deepEqual(scriptRuns("2026년").map((r) => [r.script, r.text]), [["hangul", "2026년"]]);
    assert.deepEqual(scriptRuns("LIT팀").map((r) => [r.script, r.text]), [["latin", "LIT"], ["hangul", "팀"]]);
    assert.deepEqual(scriptRuns("LIT 스튜디오!").map((r) => [r.script, r.text]), [["latin", "LIT "], ["hangul", "스튜디오!"]]);
    assert.deepEqual(scriptRuns("12:30").map((r) => r.script), ["latin"]);
    assert.equal(textScript("Type 움직임"), "mixed");
  });

  it("smart() and plain() round-trip typewriter and typographic punctuation (MO-A-34)", () => {
    assert.equal(smart(`"Wait..." she said, 'cause it's late`), "“Wait…” she said, ’cause it’s late");
    assert.equal(plain(smart(`"Wait..." it's`)), `"Wait..." it's`);
    assert.equal(smart("'90s"), "’90s");
  });

  it("clamps post overrides to the MO-A-58 contract with neutral defaults", () => {
    const p = normalizePost({ bloom: 3, fade: -1, grain: 0.04, invert: 1, shake: [2, "x"], zoom: 0, exposure: -2 });
    assert.equal(p.bloom, 1);
    assert.equal(p.fade, 0);
    assert.equal(p.grain, 0.04);
    assert.equal(p.invert, false, "invert is boolean only; 1 is not true");
    assert.deepEqual(p.shake, [2, 0]);
    assert.ok(p.zoom > 0 && p.exposure > 0, "zoom and exposure stay strictly positive");
    const neutral = normalizePost({});
    for (const [field, rule] of Object.entries(POST_FIELDS)) assert.deepEqual(neutral[field], rule.neutral, field);
  });

  it("auto-picks the preset by whole words, first row wins, explicit style wins (MO-B-00)", () => {
    assert.equal(pickPreset({ text: "터미널 부팅 화면 같은 인트로" }).presetId, "terminalcore");
    assert.equal(pickPreset({ text: "hacker night intro" }).presetId, "terminalcore");
    assert.equal(pickPreset({ text: "잔잔한 새벽 바다" }).presetId, "tidal");
    assert.equal(pickPreset({ text: "a calm opening" }).presetId, "tidal");
    assert.equal(pickPreset({ text: "잔물결 같은 문장" }).presetId, "swiss-signal", "물결 at the tail of a longer word does not match");
    assert.equal(pickPreset({ text: "our workflow and design system status" }).presetId, "swiss-signal", "flow/system/status are not keywords");
    assert.equal(pickPreset({ text: "waves of data" }).presetId, "swiss-signal", "whole words only: waves is not wave");
    assert.equal(pickPreset({ text: "terminal in a calm sea" }).presetId, "terminalcore", "the first table row wins");
    assert.equal(pickPreset({ style: "tidal", text: "terminal" }).presetId, "tidal", "an explicit style always wins");
    assert.throws(() => pickPreset({ style: "neon" }), /unknown preset/u);
  });

  it("keeps each preset's palette and pass order as the bibles define them", () => {
    assert.deepEqual(PRESETS["swiss-signal"].passes, ["swiss-grid", "dither"]);
    assert.deepEqual(PRESETS.terminalcore.passes, ["terminal-ui", "crt", "dither", "glitch"]);
    assert.deepEqual(PRESETS.tidal.passes, ["tidal-gradient", "swiss-grid", "glitch"]);
    assert.equal(PRESETS["swiss-signal"].palette.signal, "#0F7A82");
    assert.equal(PRESETS["swiss-signal"].palette.accent, "#D9A441");
    assert.equal(PRESETS.terminalcore.palette.signal, "#39FF6A");
    assert.equal(PRESETS.tidal.palette.accent, "#E07856");
    assert.equal(PRESETS["swiss-signal"].passParams["swiss-grid"].showGuides, false);
  });

  it("never gives a Hangul run a Latin width instance or a synthetic weight (MO-A-33)", () => {
    const voices = PRESETS["swiss-signal"].voices;
    assert.equal(runFontKey(voices, "display", "hangul", { widthPct: 125 }), "pretendard-700");
    assert.equal(runFontKey(voices, "display", "hangul", { weight: 400 }), "pretendard-400");
    assert.equal(runFontKey(voices, "display", "latin", { widthPct: 75 }), "archivo-75-900");
    assert.equal(runFontKey(voices, "display", "latin", { widthPct: 110 }), "archivo-100-900");
  });

  it("builds a Tier-1 timeline at 1.25 x the floor, snapped forward to the beat, >= 2 beats", () => {
    const { timeline, durationSec } = buildTimeline({ shots: [{ scene: "title-slam", text: "밤" }, { scene: "end-card", text: "끝까지 함께 읽어 주셔서 고맙습니다" }] });
    const shots = timeline.filter((u) => u.kind === "line");
    const beat = 0.6;
    for (const s of shots) {
      assert.ok(Math.abs(s.start / beat - Math.round(s.start / beat)) < 1e-9, `${s.id} starts on a beat`);
      assert.ok(s.holdSec >= 2 * beat - 1e-9, `${s.id} holds two beats`);
      assert.ok(s.holdSec >= 1.25 * readingFloor(s.text, s.kind) - 1e-9, `${s.id} holds 1.25 x its floor`);
    }
    assert.ok(durationSec >= 3, "a delivered film is at least 3 s");
  });

  it("keeps the per-shot event budget at two events in any second (MO-SH-03)", () => {
    const events = new ShotEvents(0, 5);
    assert.equal(events.add(1.0, "glitch"), true);
    assert.equal(events.add(1.5, "surge"), true);
    assert.equal(events.add(1.9, "glitch"), false, "a third event inside one second is refused");
    assert.equal(events.add(2.1, "glitch"), true);
  });

  it("keeps easing to the named set (MO-A-08)", () => {
    assert.equal(keys(0.5, [[0, 0], [1, 10, "linear"]]), 5);
    assert.throws(() => keys(0.5, [[0, 0], [1, 1, "wobble"]]), /unknown ease/u);
    assert.ok(ease.slam(0.5) > 0.8, "slam decelerates hard");
  });

  it("lays out every contact-sheet row in time order, the opening row included", async () => {
    const { cutFrames } = await import("../plugins/litclaude/skills/lit-typographic-motion/engine/node/pipeline.mjs");
    const rows = cutFrames({ frameCount: 600, fps: 60, shots: [{ start: 0 }, { start: 3 }, { start: 6.5 }] });
    for (const row of rows) assert.deepEqual(row, [...row].sort((a, b) => a - b), `row ${row.join(",")}`);
  });

  it("writes stroke text as curves through the polyline, not as its facets", async () => {
    const { drawStrokeText } = await import("../plugins/litclaude/skills/lit-typographic-motion/engine/web/stroke.mjs");
    const calls = [];
    const ctx = new Proxy({ getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, {
      get: (target, key) => target[key] ?? ((...args) => calls.push([key, ...args])),
      set: () => true,
    });
    const pts = [{ x: 0, y: 0 }, { x: 10, y: -10 }, { x: 20, y: 0 }, { x: 30, y: -10 }];
    const lens = [0, Math.SQRT2 * 10, Math.SQRT2 * 20, Math.SQRT2 * 30];
    const st = { strokes: [pts], lens: [lens], startLen: [0] };
    const { head } = drawStrokeText({ ctx }, st, 1000, 0, 0, { color: "#fff", lineWidth: 4 });
    const kinds = calls.map((c) => c[0]);
    assert.ok(kinds.includes("quadraticCurveTo"), kinds.join(" "));
    assert.deepEqual(calls.filter((c) => c[0] === "lineTo").at(-1).slice(1), [30, -10], "the stroke still ends at its last point");
    assert.deepEqual(head, pts.at(-1));
  });
});
