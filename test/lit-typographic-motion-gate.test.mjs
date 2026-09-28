import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const M = "../plugins/litclaude/skills/lit-typographic-motion/engine";
const { evaluateGate, evaluatePreflight } = await import(`${M}/core/gate-rules.mjs`);
const { detectSequence, auditRecords } = await import(`${M}/core/flash.mjs`);
const { measureContrast, screenBox } = await import(`${M}/core/contrast.mjs`);
const { passSeed } = await import(`${M}/core/util.mjs`);
const { PRESETS } = await import(`${M}/core/presets.mjs`);
const { promote } = await import(`${M}/node/pipeline.mjs`);

const FPS = 60;
const N = 360; // 6 s
const CELLS = 320 * 180;
const staticFlash = { up: false, down: false, redUp: false, redDown: false, stepArea: 0 };

/** A render log that passes every rule; each fixture below breaks exactly one thing. */
function baseData() {
  const timeline = [
    { id: "title-slam", sceneId: "title-slam", shotIndex: 0, start: 0, end: 3, holdSec: 3, kind: "line", text: "Type in motion", script: "latin", beatSec: 0 },
    { id: "end-card", sceneId: "end-card", shotIndex: 0, start: 3, end: 6, holdSec: 3, kind: "line", text: "끝까지 고맙습니다", script: "hangul", beatSec: 3 },
  ];
  const shots = [{ id: "title-slam", sceneId: "title-slam", shotIndex: 0, a: 0, b: 179 }, { id: "end-card", sceneId: "end-card", shotIndex: 0, a: 180, b: 359 }];
  const passRanges = shots.flatMap((s) => [
    { pass: "swiss-grid", frameStart: s.a, frameEnd: s.b, sceneId: s.sceneId, shotIndex: 0, seed: null, params: { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, showGuides: false }, downgraded: false },
    { pass: "dither", frameStart: s.a, frameEnd: s.b, sceneId: s.sceneId, shotIndex: 0, seed: passSeed(20260926, s.sceneId, 0, "dither"), params: { mode: 1, paletteSize: 0, pixelScale: 1, strength: 0.3 }, downgraded: false },
  ]);
  const shotOf = (f) => (f < 180 ? shots[0] : shots[1]);
  const frames = Array.from({ length: N }, (_, f) => ({
    frame: f, pass: null, artifact: "master", rgbaSha256: "0".repeat(64), inkPx: 40000, luminanceP995: 0.8,
    shot: { id: shotOf(f).id, sceneId: shotOf(f).sceneId, shotIndex: 0 },
    textBoxes: [{ elementId: "t", text: f < 180 ? "Type in motion" : "끝까지", voice: "display", fontFile: f < 180 ? "Archivo-w100-900.ttf" : "Pretendard-Bold.otf", fontSizePx: 120, capHeightPx: 85, weight: 900, fill: "#E9EBE4", bbox: [120, 400, 1200, 540], script: f < 180 ? "latin" : "hangul", trackingEm: f < 180 ? -0.02 : 0, widthPct: 100, alpha: 1 }],
    elements: [{ elementId: "rule", kind: "rule", bbox: [96, 64, 1824, 73] }],
    fills: [{ elementId: "background", color: "#0C0E13", bbox: [0, 0, 1920, 1080] }, ...(f >= 200 && f < 220 ? [{ elementId: "accent", color: "#D9A441", bbox: [120, 700, 152, 732] }] : []), { elementId: "bar", color: "#0F7A82", bbox: [120, 600, 216, 630] }],
    post: { exposure: 1, bloom: 0, bloomThreshold: 0.85, bloomKnee: 0, bloomRadius: 0, halation: 0, ca: 0.8, grain: 0.035, vignette: 0.25, fade: 1, flash: 0, shake: [0, 0], zoom: 1, invert: false },
    flash: { ...staticFlash },
  }));
  const passLines = frames.flatMap((fr) => [
    { frame: fr.frame, pass: "swiss-grid", draws: 1, uniforms: { segments: 16 } },
    { frame: fr.frame, pass: "dither", draws: 1, uniforms: { u_seed: passSeed(20260926, shotOf(fr.frame).sceneId, 0, "dither") } },
  ]);
  return {
    manifest: { schemaVersion: 1, presetId: "swiss-signal", seed: 20260926, fps: FPS, bpm: 100, frameCount: N, resolution: [1920, 1080], scale: 1, samples: 4, shutter: 0.5, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro)", softwareRenderer: false, chromeFlags: ["--use-angle=metal"], previewEncoder: "img2webp", durationSec: 6, passRanges, timeline },
    frames, passLines, masterFlash: frames.map(() => ({ ...staticFlash })), previewFlash: { records: Array.from({ length: 180 }, () => ({ ...staticFlash })), fps: 30 },
    shotEvents: [], exports: { film: { bytes: 9_000_000 }, preview: { bytes: 200_000, kind: "webp" }, poster: { bytes: 300_000 }, reducedMotion: { bytes: 300_000 } },
    probe: { width: 1920, height: 1080, fps: 60, duration: 6, pixFmt: "yuv420p", colorSpace: "bt709", colorRange: "tv", colorTransfer: "bt709", colorPrimaries: "bt709", bytes: 9_000_000 },
    still: { inkPx: 40000 }, contrastSamples: [{ frame: 100, text: "Type in motion", fontSizePx: 120, weight: 900, ratio: 15.9 }, { frame: 250, text: "끝까지", fontSizePx: 120, weight: 700, ratio: 15.9 }],
    determinism: { status: "PASS", samples: 4, shutter: 0.5, frames: [{ frame: 179, sequential: "a", seeked: "a", match: true }] },
    perf: { frames: 120, p50: 18, p95: 24, max: 30 }, coverage: { ok: true, missing: [] }, preset: PRESETS["swiss-signal"], seedOf: passSeed,
    allowedHangulFonts: ["Pretendard-Regular.otf", "Pretendard-Bold.otf"],
  };
}

const status = (result, id) => result.rules.find((r) => r.id === id)?.status;
const failsOnly = (data, id) => {
  const result = evaluateGate(data);
  assert.equal(status(result, id), "FAIL", `${id} should FAIL: ${JSON.stringify(result.rules.find((r) => r.id === id))}`);
  return result;
};
const uniform = (v) => ({ R: new Float32Array(CELLS).fill(v), G: new Float32Array(CELLS).fill(v), B: new Float32Array(CELLS).fill(v) });

describe("lit-typographic-motion QA gate fixtures", () => {
  it("the base render log passes every rule", () => {
    const result = evaluateGate(baseData());
    assert.deepEqual(result.failed, [], JSON.stringify(result.rules.filter((r) => r.status === "FAIL")));
    assert.equal(result.pass, true);
  });

  it("MO-C-01: a frame gap with no pass that drew, or a range with draws 0, fails", () => {
    const d = baseData();
    d.passLines = d.passLines.map((l) => (l.frame === 42 ? { ...l, draws: 0 } : l));
    failsOnly(d, "MO-C-01");
    const e = baseData();
    e.passLines = e.passLines.filter((l) => !(l.frame === 90 && l.pass === "dither"));
    failsOnly(e, "MO-C-01");
    const empty = baseData();
    empty.manifest.passRanges = [];
    failsOnly(empty, "MO-C-01");
  });

  it("MO-C-02: an unlabelled software renderer fails; a labelled one passes", () => {
    const d = baseData();
    d.manifest.renderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)";
    failsOnly(d, "MO-C-02");
    d.manifest.softwareRenderer = true;
    d.manifest.samples = 1;
    assert.equal(status(evaluateGate(d), "MO-C-02"), "PASS");
  });

  it("MO-SH-09: a software renderer without the downgrade fails", () => {
    const d = baseData();
    d.manifest.renderer = "llvmpipe (LLVM 15.0.7, 256 bits)";
    d.manifest.softwareRenderer = true;
    failsOnly(d, "MO-SH-09");
  });

  it("MO-C-03 (i): a full-frame pulse 0.05<->0.55 with 6-frame edges, 4 per second, fails", () => {
    const cells = Array.from({ length: 120 }, (_, f) => {
      const ph = f % 15;
      return uniform(ph < 6 ? 0.05 + 0.5 * (ph / 6) : ph < 12 ? 0.55 - 0.5 * ((ph - 6) / 6) : 0.05);
    });
    const d = baseData();
    d.masterFlash = detectSequence(cells, { loop: false });
    const r = failsOnly(d, "MO-C-03");
    assert.ok(r.flashFail, "a flash FAIL is flagged for withholding");
  });

  it("MO-C-03 (ii): a 700x400 block toggling black/white 4 times a second fails", () => {
    const cells = Array.from({ length: 120 }, (_, f) => {
      const on = Math.floor(f / 7.5) % 2 === 0;
      const R = new Float32Array(CELLS);
      for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) if (on && x * 6 >= 600 && x * 6 < 1300 && y * 6 >= 300 && y * 6 < 700) R[y * 320 + x] = 1;
      return { R, G: R, B: R };
    });
    const d = baseData();
    d.masterFlash = detectSequence(cells, { loop: false });
    failsOnly(d, "MO-C-03");
  });

  it("MO-C-03: four flashes in the final second fail (the non-looping window reaches the end)", () => {
    const cells = Array.from({ length: 180 }, (_, f) => uniform(f >= 120 && (f - 120) % 15 < 7 ? 0.9 : 0.02));
    const records = detectSequence(cells, { loop: false });
    assert.equal(auditRecords(records, 60, { loop: false }).pass, false);
    const d = baseData();
    d.masterFlash = records;
    failsOnly(d, "MO-C-03");
  });

  it("MO-C-03: red flashes are windowed too, and a looping preview wraps its window", () => {
    const red = Array.from({ length: 120 }, (_, f) => {
      const on = f % 15 < 7;
      return { R: new Float32Array(CELLS).fill(on ? 0.6 : 0.02), G: new Float32Array(CELLS).fill(0.01), B: new Float32Array(CELLS).fill(0.01) };
    });
    const records = detectSequence(red, { loop: false });
    assert.ok(auditRecords(records, 60, { loop: false }).red.flashes > 3, "red flashes counted per window");
    const d = baseData();
    d.previewFlash = { records: detectSequence(red.filter((_, i) => i % 2 === 0), { loop: true }), fps: 30 };
    failsOnly(d, "MO-C-03");
  });

  it("MO-SH-04a: a full-frame luminance step in one frame pair fails", () => {
    const d = baseData();
    d.masterFlash[100] = { ...staticFlash, stepArea: 0.9 };
    failsOnly(d, "MO-SH-04a");
  });

  it("MO-C-04 / MO-C-05: a glyph past title-safe or a mark past action-safe fails", () => {
    const d = baseData();
    d.frames[10].textBoxes[0].bbox = [80, 400, 1200, 540];
    failsOnly(d, "MO-C-04");
    const e = baseData();
    e.frames[10].elements[0].bbox = [30, 64, 1824, 73];
    failsOnly(e, "MO-C-05");
  });

  it("MO-C-06 under crt curvature: the box is measured where the curved frame shows it", () => {
    // A bright label under a grey frame line, both drawn through the crt barrel (curvature 0.06).
    const W = 1920, H = 1080, k = 0.06;
    const rgba = Buffer.alloc(W * H * 4);
    const mask = Buffer.alloc(W * H);
    const label = [219, 125, 384, 140];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 5; rgba[i + 3] = 255;
      if (x > 500 || y > 220) continue;
      const u = x / W, v = y / H, dx = u - 0.5, dy = v - 0.5, r2 = dx * dx + dy * dy;
      const cx = (u + dx * r2 * k * 2) * W, cy = (v + dy * r2 * k * 2) * H;
      if (cx >= label[0] && cx <= label[2] && cy >= label[1] && cy <= label[3]) {
        rgba[i] = 57; rgba[i + 1] = 255; rgba[i + 2] = 106; mask[y * W + x] = 255;
      } else if (cy >= 109 && cy <= 111.5 && cx >= 120) {
        rgba[i] = 124; rgba[i + 1] = 139; rgba[i + 2] = 147;
      }
    }
    const logical = measureContrast({ rgba, mask, width: W, height: H, bbox: label, capHeightPx: 16.8 });
    const curved = measureContrast({ rgba, mask, width: W, height: H, bbox: screenBox(label, k), capHeightPx: 16.8 });
    assert.ok(logical.ratio < 4.5, `the flat box catches the frame line: ${logical.ratio}`);
    assert.ok(curved.ratio > 10, `the curved box reads the label against its panel: ${curved.ratio}`);
    assert.deepEqual(screenBox(label, 0), label, "no crt, no change");
  });

  it("MO-C-06: body type under 4.5:1 and large type under 3:1 fail, including a gradient fill", () => {
    const small = baseData();
    small.contrastSamples = [{ frame: 5, text: "caption", fontSizePx: 24, weight: 400, ratio: 4.2 }];
    failsOnly(small, "MO-C-06");
    const large = baseData();
    large.contrastSamples = [{ frame: 5, text: "HEAD", fontSizePx: 96, weight: 900, ratio: 2.7 }];
    failsOnly(large, "MO-C-06");
    // Measured on pixels: grey 24 px text on ink, and a gradient-filled glyph whose dark end sinks into the ground.
    const W = 200;
    const H = 100;
    const rgba = Buffer.alloc(W * H * 4);
    const mask = Buffer.alloc(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const glyph = x >= 50 && x < 150 && y >= 30 && y < 70;
      const v = glyph ? 80 : 20;
      rgba.set([v, v, v, 255], i * 4);
      mask[i] = glyph ? 255 : 0;
    }
    // The frame is 200 px wide, so one pixel is 9.6 logical px; bbox and cap height are logical.
    const logical = (v) => v * (1920 / W);
    const m = measureContrast({ rgba, mask, width: W, height: H, bbox: [50, 30, 150, 70].map(logical), capHeightPx: logical(30), gradient: false });
    assert.ok(m && m.ratio < 3, `grey on ink measures ${m?.ratio}`);
    for (let y = 30; y < 70; y++) for (let x = 50; x < 150; x++) {
      const v = Math.round(20 + ((x - 50) / 100) * 235);
      rgba.set([v, v, v, 255], (y * W + x) * 4);
    }
    const g = measureContrast({ rgba, mask, width: W, height: H, bbox: [50, 30, 150, 70].map(logical), capHeightPx: logical(30), gradient: true });
    assert.ok(g.ratio < 3, `a gradient fill uses its worst percentile: ${g.ratio}`);
  });

  it("MO-C-07/08: a unit held under its reading floor fails; so does 17 cps", () => {
    const d = baseData();
    d.manifest.timeline[1] = { ...d.manifest.timeline[1], end: 3.9, holdSec: 0.9 };
    failsOnly(d, "MO-C-07/08");
    const e = baseData();
    e.manifest.timeline[0] = { ...e.manifest.timeline[0], text: "a b c d e f g h i j k l m n o p", holdSec: 3 };
    failsOnly(e, "MO-C-07/08");
  });

  it("MO-A-15 / MO-A-16: a cut more than a frame off the beat, and a shot under two beats, fail", () => {
    const d = baseData();
    d.manifest.timeline[1] = { ...d.manifest.timeline[1], start: 3.05 };
    failsOnly(d, "MO-A-15");
    const e = baseData();
    e.manifest.timeline[1] = { ...e.manifest.timeline[1], start: 3, end: 3.6, holdSec: 0.6, text: "끝" };
    failsOnly(e, "MO-A-16");
  });

  it("MO-A-13: a reveal step that splits an eojeol fails", () => {
    const d = baseData();
    d.manifest.timeline.push({ id: "end-card/r0", sceneId: "end-card", shotIndex: 0, start: 3, end: 3.5, holdSec: 0.5, kind: "reveal", text: "끝까", script: "hangul", beatSec: 3 });
    failsOnly(d, "MO-A-13");
  });

  it("MO-C-09 / MO-A-25: an rgbaSha256 mismatch fails; a SwiftShader-confirmed hardware mismatch warns", () => {
    const d = baseData();
    d.determinism = { status: "FAIL", samples: 4, shutter: 0.5, frames: [{ frame: 179, sequential: "a", seeked: "b", match: false }] };
    failsOnly(d, "MO-C-09");
    failsOnly(d, "MO-A-25");
    const w = baseData();
    w.determinism = { ...d.determinism, status: "WARN" };
    assert.equal(status(evaluateGate(w), "MO-C-09"), "WARN");
    const none = baseData();
    none.determinism = null;
    failsOnly(none, "MO-C-09");
  });

  it("MO-C-10/11/12: wrong ffprobe tags, resolution, fps or duration fail", () => {
    for (const change of [{ pixFmt: "yuv444p" }, { colorSpace: "smpte170m" }, { colorRange: "pc" }, { colorTransfer: undefined }, { colorPrimaries: "unknown" }, { width: 1280, height: 720 }, { fps: 24 }, { duration: 2.5 }]) {
      const d = baseData();
      d.probe = { ...d.probe, ...change };
      failsOnly(d, "MO-C-10/11/12");
    }
  });

  it("MO-C-13: a preview over 3 MB or a poster over 1 MB fails", () => {
    const d = baseData();
    d.exports.preview.bytes = 3_100_000;
    failsOnly(d, "MO-C-13");
    const e = baseData();
    e.exports.poster.bytes = 1_200_000;
    failsOnly(e, "MO-C-13");
  });

  it("MO-C-14: a missing or unsettled reduced-motion still fails", () => {
    const d = baseData();
    d.still = { inkPx: 20000 };
    failsOnly(d, "MO-C-14");
    const e = baseData();
    e.exports.reducedMotion = null;
    failsOnly(e, "MO-C-14");
  });

  it("MO-C-25: display tracking past -0.04em, or negative tracking on the machine voice, fails", () => {
    const d = baseData();
    d.frames[5].textBoxes[0].trackingEm = -0.06;
    failsOnly(d, "MO-C-25");
    const e = baseData();
    e.frames[5].textBoxes.push({ ...e.frames[5].textBoxes[0], voice: "machine", trackingEm: -0.01, text: "T+00" });
    failsOnly(e, "MO-C-25");
  });

  it("MO-FT-04: tracking or width motion on a Hangul run fails", () => {
    const d = baseData();
    d.frames[200].textBoxes[0].trackingEm = -0.02;
    failsOnly(d, "MO-FT-04");
    const e = baseData();
    e.frames[200].textBoxes[0].widthPct = 125;
    failsOnly(e, "MO-FT-04");
  });

  it("MO-C-26 / MO-C-27: a tight multi-line block and a Latin card outside 60-75ch fail", () => {
    const d = baseData();
    d.frames[5].textBoxes[0] = { ...d.frames[5].textBoxes[0], blockId: "b", lineCount: 2, lineHeight: 1.2, cjk: false };
    failsOnly(d, "MO-C-26");
    const e = baseData();
    e.frames[5].textBoxes[0] = { ...e.frames[5].textBoxes[0], blockId: "p", lineCount: 4, lineHeight: 1.5, cjk: false, paragraph: true, measureCh: 90 };
    failsOnly(e, "MO-C-27");
  });

  it("MO-C-29: a third saturated cluster, the accent in two entries, or on > 10% of frames fails", () => {
    const d = baseData();
    d.frames[30].fills.push({ elementId: "extra", color: "#C0306A", bbox: [300, 300, 400, 400] });
    failsOnly(d, "MO-C-29");
    const e = baseData();
    e.frames[20].fills.push({ elementId: "accent2", color: "#D9A441", bbox: [120, 700, 152, 732] });
    failsOnly(e, "MO-C-29");
    const f = baseData();
    for (let i = 180; i < 260; i++) f.frames[i].fills.push({ elementId: "accent", color: "#D9A441", bbox: [120, 700, 152, 732] });
    failsOnly(f, "MO-C-29");
  });

  it("MO-D-02: p95 over the ceiling fails (hardware 40 ms, software 250 ms)", () => {
    const d = baseData();
    d.perf = { frames: 120, p95: 41 };
    const r = failsOnly(d, "MO-D-02");
    assert.equal(r.flashFail, false, "a perf FAIL alone never withholds the film");
    assert.equal(r.perfOnly, true);
  });

  it("MO-D-03: a long empty near-black run fails", () => {
    const d = baseData();
    for (let f = 20; f < 175; f++) d.frames[f] = { ...d.frames[f], inkPx: 0, luminanceP995: 0.01 };
    failsOnly(d, "MO-D-03");
  });

  it("MO-D-04: a missing glyph fails, before rendering too", () => {
    const d = baseData();
    d.coverage = { ok: false, missing: ['archivo-100-900 lacks "한" (U+D55C)'] };
    failsOnly(d, "MO-D-04");
    const pre = evaluatePreflight({ manifest: d.manifest, coverage: d.coverage });
    assert.equal(pre.pass, false);
    assert.ok(pre.failed.includes("MO-D-04"));
  });

  it("MO-SH-03: three events in one second of one shot fail, across sources", () => {
    const d = baseData();
    d.shotEvents = [{ shotId: "title-slam", sceneId: "title-slam", shotIndex: 0, events: [{ t: 1.0, source: "glitch" }, { t: 1.4, source: "surge" }] }];
    d.frames[100].post = { ...d.frames[100].post, flash: 0.4 };
    failsOnly(d, "MO-SH-03");
  });

  it("MO-A-58: invert off a cut, invert held under two beats, or an out-of-range override fails", () => {
    const d = baseData();
    for (let f = 100; f < 150; f++) d.frames[f].post = { ...d.frames[f].post, invert: true };
    failsOnly(d, "MO-A-58");
    const e = baseData();
    for (let f = 180; f < 200; f++) e.frames[f].post = { ...e.frames[f].post, invert: true };
    failsOnly(e, "MO-A-58");
    const o = baseData();
    o.frames[7].post = { ...o.frames[7].post, grain: 1.5 };
    failsOnly(o, "MO-A-58");
  });

  it("MO-SH-05 / 06 / 07 / 08 / 10 / 11: pass caps", () => {
    const glitch = baseData();
    glitch.manifest.passRanges.push({ pass: "glitch", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "glitch"), params: { hitRatePerSecRealized: 2.4, areaCapPct: 12, maxHitAreaPct: 10 }, downgraded: false });
    failsOnly(glitch, "MO-SH-05");
    const area = baseData();
    area.manifest.passRanges.push({ pass: "glitch", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "glitch"), params: { hitRatePerSecRealized: 1, areaCapPct: 20, maxHitAreaPct: 26 }, downgraded: false });
    failsOnly(area, "MO-SH-05");
    const surge = baseData();
    surge.manifest.passRanges.push({ pass: "tidal-gradient", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "tidal-gradient"), params: { surgeTimes: [0.2, 0.5, 0.9], surgeAttackSec: 0.2, surgeDecaySec: 0.3 }, downgraded: false });
    failsOnly(surge, "MO-SH-06");
    const attack = baseData();
    attack.manifest.passRanges.push({ pass: "tidal-gradient", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "tidal-gradient"), params: { surgeTimes: [0.2], surgeAttackSec: 0.05, surgeDecaySec: 0.3 }, downgraded: false });
    failsOnly(attack, "MO-SH-06");
    const flicker = baseData();
    flicker.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "crt"), params: { persistenceEnabled: false, shotStateful: false }, downgraded: false });
    for (let f = 0; f < 180; f++) flicker.passLines.push({ frame: f, pass: "crt", draws: 1, uniforms: { u_flicker: 1 + 0.05 * Math.sin(f) } });
    failsOnly(flicker, "MO-SH-07");
    const persist = baseData();
    persist.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "crt"), params: { persistenceEnabled: true, shotStateful: false }, downgraded: false });
    for (let f = 0; f < 180; f++) persist.passLines.push({ frame: f, pass: "crt", draws: 1, uniforms: { u_flicker: 1 } });
    failsOnly(persist, "MO-SH-07");
    const dither = baseData();
    dither.passLines = dither.passLines.map((l) => (l.pass === "dither" && l.frame === 60 ? { ...l, uniforms: { u_seed: 7 } } : l));
    failsOnly(dither, "MO-SH-08");
    const guides = baseData();
    guides.manifest.passRanges[0].params.showGuides = true;
    failsOnly(guides, "MO-SH-10");
    const layers = baseData();
    layers.manifest.passRanges.push({ pass: "terminal-ui", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: passSeed(20260926, "title-slam", 0, "terminal-ui"), params: { layers: 3 }, downgraded: false });
    for (let f = 0; f < 180; f++) layers.passLines.push({ frame: f, pass: "terminal-ui", draws: 1, uniforms: {} });
    failsOnly(layers, "MO-SH-11");
  });

  it("MO-SH-01: a pass seed that is not fnv1a32(runSeed:sceneId:shotIndex:pass) fails", () => {
    const d = baseData();
    d.manifest.passRanges[1].seed = 12345;
    failsOnly(d, "MO-SH-01");
  });

  it("MO-A-33: Hangul in a font outside the lit-pptx pair fails", () => {
    const d = baseData();
    d.frames[220].textBoxes[0].fontFile = "SomeOther-Hangul.otf";
    failsOnly(d, "MO-A-33");
  });

  it("MO-A-37..41 / MO-A-41a: a missing export or an incomplete timeline entry fails", () => {
    const d = baseData();
    d.exports.film = null;
    failsOnly(d, "MO-A-37..41");
    const e = baseData();
    delete e.manifest.timeline[0].beatSec;
    failsOnly(e, "MO-A-41a");
  });

  it("an MO-C-03 FAIL leaves no MP4, preview or poster at the deliverable names: only in withheld/", () => {
    const out = mkdtempSync(join(tmpdir(), "lit-motion-withhold-"));
    try {
      const stage = join(out, ".run", "stage");
      mkdirSync(stage, { recursive: true });
      for (const f of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) writeFileSync(join(stage, f), "x");
      const result = promote({ out, gate: { flashFail: true } });
      assert.equal(result.withheld, true);
      for (const f of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) {
        assert.equal(existsSync(join(out, f)), false, `${f} must not be delivered`);
        assert.equal(existsSync(join(out, "withheld", f)), true, `${f} is kept as a diagnostic`);
      }
      // A withheld film is never done: the done-check needs gate PASS (test/lit-typographic-motion-look.test.mjs).
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
