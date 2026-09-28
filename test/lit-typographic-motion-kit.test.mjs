import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const kitPath = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion", "engine", "stage", "stage-kit.js");
const source = readFileSync(kitPath, "utf8");

// The kit is a classic browser script; run it over a bare window with the host's Intl.
const load = () => {
  const window = {};
  vm.runInNewContext(source, { window, Intl, Math, Number, String, Array, Object, Error, JSON, parseFloat, parseInt });
  return window;
};
const { LitStage } = load();
// Values made in the kit's realm carry its prototypes; compare them as plain data.
const plain = (v) => JSON.parse(JSON.stringify(v));
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const anchors = (d) => [...d.matchAll(/[MC]([^MCZ]+)/gu)].map((m) => m[1].trim().split(/\s+/u).map(Number).slice(-2));

describe("lit-typographic-motion stage kit", () => {
  it("stays a small, dependency-free script that never reads a clock, entropy or the network", () => {
    assert.ok(statSync(kitPath).size <= 61_440, `${statSync(kitPath).size} B`);
    for (const banned of [/Math\.random/u, /Date\.now/u, /performance\.now/u, /new Date\(/u, /fetch\(/u, /XMLHttpRequest/u, /import\(/u, /https?:\/\//u]) {
      assert.doesNotMatch(source, banned);
    }
  });

  it("eases hit 0 and 1 at the ends, and cubicBezier matches CSS `ease`", () => {
    for (const [name, fn] of Object.entries(LitStage.ease)) {
      assert.equal(fn(0), 0, name);
      assert.equal(fn(1), 1, name);
    }
    const css = LitStage.cubicBezier(0.25, 0.1, 0.25, 1);
    for (const [x, y] of [[0.25, 0.4094], [0.5, 0.8024], [0.75, 0.9604]]) assert.ok(close(css(x), y), `${x}: ${css(x)}`);
    assert.throws(() => LitStage.cubicBezier(1.2, 0, 0, 1));
  });

  it("the analytic spring starts at 0, settles at 1, and its three damping regimes meet", () => {
    for (const damping of [10, 26, 60]) {
      const p = LitStage.spring({ damping });
      assert.equal(p(0), 0);
      assert.ok(close(p(10), 1, 1e-4), `damping ${damping}`);
    }
    const critical = 2 * Math.sqrt(170);
    for (const t of [0.05, 0.2, 0.5]) {
      const c = LitStage.spring({ damping: critical })(t);
      assert.ok(close(LitStage.spring({ damping: critical - 1e-3 })(t), c), `under ${t}`);
      assert.ok(close(LitStage.spring({ damping: critical + 1e-3 })(t), c), `over ${t}`);
    }
    const settle = LitStage.spring.settle({ damping: 26 });
    assert.ok(settle > 0 && settle < 3, String(settle));
  });

  it("kf interpolates numbers, arrays and colours with per-segment eases, and clamps", () => {
    const keys = [{ t: 0, v: 0 }, { t: 1, v: 10, ease: "inQuad" }, { t: 2, v: 20 }];
    assert.equal(LitStage.kf(-1, keys), 0);
    assert.equal(LitStage.kf(0.5, keys), 5);
    assert.equal(LitStage.kf(1.5, keys), 12.5);
    assert.equal(LitStage.kf(9, keys), 20);
    assert.deepEqual(plain(LitStage.kf(0.5, [{ t: 0, v: [0, 10] }, { t: 1, v: [10, 30] }])), [5, 20]);
    assert.equal(LitStage.kf(1, [{ t: 0, v: "#000" }, { t: 1, v: "#ffffff" }]), "rgb(255, 255, 255)");
    assert.match(LitStage.kf(0.5, [{ t: 0, v: "rgb(0, 0, 0)" }, { t: 1, v: "#fff" }]), /^rgb\(\d+, \d+, \d+\)$/u);
  });

  it("stagger from the centre is symmetric; seq lays segments end to end with overlap", () => {
    const d = [0, 1, 2, 3, 4].map((i) => LitStage.stagger(i, 0.1, { from: "center", count: 5 }));
    assert.deepEqual(d.map((x) => +x.toFixed(6)), [0.2, 0.1, 0, 0.1, 0.2]);
    assert.equal(LitStage.stagger(3, 0.1, { from: "end", count: 4 }), 0);
    const tl = LitStage.seq(["in", 0.6], ["hold", 1.2], ["out", 0.5, -0.2]);
    assert.equal(tl.seg.hold.start, 0.6);
    assert.ok(close(tl.seg.out.start, 1.6));
    assert.ok(close(tl.duration, 2.1));
    assert.equal(tl.p("in", 0.3), 0.5);
    assert.equal(tl.p("hold", 0), 0);
    assert.equal(LitStage.at(5, 1, 2), 1);
  });

  it("rand(seed) repeats for one seed and differs across seeds", () => {
    const a = LitStage.rand(7);
    const b = LitStage.rand(7);
    const c = LitStage.rand(8);
    const sa = Array.from({ length: 5 }, a);
    assert.deepEqual(sa, Array.from({ length: 5 }, b));
    assert.notDeepEqual(sa, Array.from({ length: 5 }, c));
    assert.ok(sa.every((v) => v >= 0 && v < 1));
    const int = LitStage.rand.int(3);
    for (let i = 0; i < 50; i++) assert.ok([1, 2, 3].includes(int(1, 3)));
  });

  it("splitText keeps eojeol whole and never breaks a Hangul syllable", () => {
    assert.deepEqual(plain(LitStage.splitText("늘 같은 자리에서 기다려", { by: "eojeol" })), ["늘", "같은", "자리에서", "기다려"]);
    const g = LitStage.splitText("자리에서 wait", { by: "grapheme" });
    assert.deepEqual(plain(g), ["자", "리", "에", "서", "w", "a", "i", "t"]);
    const decomposed = "각"; // one syllable written as conjoining jamo
    assert.deepEqual(plain(LitStage.splitText(decomposed, { by: "grapheme" })), [decomposed]);
    assert.deepEqual(plain(LitStage.splitText("one\ntwo", { by: "line" })), ["one", "two"]);
  });

  it("morph resamples two single subpaths to matching cubics and reproduces both ends", () => {
    const square = "M0 0 H100 V100 H0 Z";
    const circle = "M50 0 A50 50 0 1 1 49.99 0 Z";
    const fn = LitStage.morph(square, circle, { samples: 32 });
    const start = anchors(fn(0));
    const end = anchors(fn(1));
    assert.equal(start.length, 33);
    assert.equal(end.length, 33);
    fn.from.forEach((s, k) => assert.ok(close(start[k][0], s[0]) && close(start[k][1], s[1]), `from ${k}`));
    fn.to.forEach((s, k) => assert.ok(close(end[k][0], s[0]) && close(end[k][1], s[1]), `to ${k}`));
    assert.match(fn(0.5), /^M[-\d. ]+(C[-\d. ]+)+Z$/u);
    assert.match(LitStage.morph("m10 10 l20 0 q10 10 0 20 t-10 0 c-5 0 -5 -5 -10 -5", "M0 0 S10 10 20 0 L40 0")(0.3), /^M/u);
    assert.throws(() => LitStage.morph("M0 0 L10 0 M20 0 L30 0", square), /multi-subpath paths are unsupported/u);
  });

  it("mixes colour in oklab by default and in sRGB on request", () => {
    const grey = LitStage.mix("#000", "#fff", 0.5);
    const [r, g, b] = grey.match(/\d+/gu).map(Number);
    assert.ok(r === g && g === b && Math.abs(r - 99) <= 1, grey);
    assert.equal(LitStage.mix("#000", "#fff", 0.5, { space: "srgb" }), "rgb(128, 128, 128)");
    assert.equal(LitStage.rgba("#ff0000", 0.5), "rgba(255, 0, 0, 0.5)");
  });

  it("define accepts only the two stage formats, and text() registers canvas text for the frame", () => {
    const window = load();
    const render = () => {};
    assert.throws(() => window.LitStage.define({ width: 1280, height: 720, duration: 5, render }), /1920x1080 or 1080x1920/u);
    assert.throws(() => window.LitStage.define({ width: 1920, height: 1080, fps: 24, duration: 5, render }), /fps/u);
    const land = window.LitStage.define({ width: 1920, height: 1080, duration: 5, render });
    assert.equal(land.fps, 60);
    assert.equal(window.litStage, land);
    window.LitStage.define({ width: 1080, height: 1920, fps: 30, duration: 12, render });
    assert.equal(window.litStage.height, 1920);
    window.LitStage.text({ content: "<one copy line>", x: 10, y: 20, w: 300, h: 60 });
    assert.deepEqual(plain(window.__litStageTexts), [{ content: "<one copy line>", x: 10, y: 20, w: 300, h: 60, decor: false }]);
    const attrs = {};
    const el = { nodeType: 1, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
    window.LitStage.text(el, { decor: true });
    assert.deepEqual(attrs, { "data-lit-text": "1", "data-lit-decor": "1" });
  });
});
