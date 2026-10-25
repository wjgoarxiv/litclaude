// lit-typographic-motion studio: house styles chosen by rule, shots on one layout grid, the scaffold,
// the board round with its check, the style rules in the gate, the house file and the preview. The
// pure parts run everywhere; the two real renders need Chrome and a pre-warmed runtime.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { stageTreatment, typeTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skillRoot, "engine");
const motion = join(skillRoot, "scripts", "motion.mjs");
const styles = await import(join(engine, "node", "styles.mjs"));
const { validateTreatment, TreatmentError, askedSeconds, cuedGenre } = await import(join(engine, "node", "treatment.mjs"));
const { readHouse, recordHouse, HOUSE_FILE } = await import(join(engine, "node", "house.mjs"));
const { judgeStyle, parseCssColour } = await import(join(engine, "node", "stage-qa.mjs"));
const { evaluateStageGate } = await import(join(engine, "node", "stage-gate.mjs"));
const { boardGrid, boardHtml, addToStills } = await import(join(engine, "node", "board.mjs"));
const { scaffoldHtml, scaffoldCommand, linesPerShot } = await import(join(engine, "node", "scaffold.mjs"));
const { demoTreatment } = await import(join(engine, "node", "gallery.mjs"));
const { stageRouter } = await import(join(engine, "node", "stage-serve.mjs"));
const { PRESETS } = await import(join(engine, "core", "presets.mjs"));
const { evaluateDone } = await import(join(engine, "node", "done.mjs"));
const { checkAssets } = await import(join(engine, "node", "cover-assets.mjs"));
const runtime = await import(join(engine, "node", "runtime.mjs"));
const { findChrome } = await import(join(engine, "node", "chrome.mjs"));

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
const field = (t, opts) => {
  try {
    validateTreatment(t, opts);
    return null;
  } catch (error) {
    assert.ok(error instanceof TreatmentError, error.stack);
    return error.field;
  }
};
const reason = (t, opts) => {
  try {
    validateTreatment(t, opts);
    return "";
  } catch (error) {
    return error.message;
  }
};

describe("house styles are data, valid and shared with the type engine", () => {
  it("every shipped style validates: contrast floors, a descending scale, its bed, its bans", () => {
    const files = readdirSync(join(skillRoot, "styles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/u, "")).sort();
    assert.deepEqual(files, [...styles.STYLE_IDS].sort());
    for (const id of styles.STYLE_IDS) assert.equal(styles.readStyle(id).id, id);
    const broken = JSON.parse(readFileSync(join(skillRoot, "styles", "paper.json"), "utf8"));
    broken.palette.muted = "#D9D2C5";
    assert.throws(() => styles.validateStyle(broken), /muted on ground needs 4\.5:1/u);
  });

  it("the three type-engine styles carry the presets' own palette, so one style means one look on both paths", () => {
    for (const id of ["swiss-signal", "tidal", "terminalcore"]) {
      const style = styles.readStyle(id);
      assert.equal(style.typePreset, id);
      assert.equal(style.palette.ground.toLowerCase(), PRESETS[id].palette.bg.toLowerCase(), id);
    }
    assert.equal(styles.readStyle("swiss-signal").palette.signal.toLowerCase(), PRESETS["swiss-signal"].palette.signal.toLowerCase());
    assert.equal(styles.readStyle("paper").typePreset, null);
  });

  it("every type zone sits inside the central 90 % title-safe area, in both formats", () => {
    for (const format of ["16:9", "9:16"]) {
      for (const [id, z] of Object.entries(styles.LAYOUTS[format])) {
        if (!z.type) continue;
        const [x, y, w, h] = z.type;
        assert.ok(x >= 0.05 && y >= 0.05 && x + w <= 0.95 && y + h <= 0.95, `${format} ${id}`);
      }
    }
  });
});

describe("the style is chosen by rule, the same way every run", () => {
  it("named, then house, then keyword, then the default; the type path never takes paper", () => {
    const pick = (request, extra = {}) => styles.pickStyle({ request, ...extra }).id;
    assert.equal(pick("엘리베이터 호출 순서를 보여주는 설명 영상 만들어줘 lit"), "swiss-signal");
    assert.equal(pick("make a calm wave intro video lit"), "tidal");
    assert.equal(pick("터미널 느낌의 출시 영상 lit"), "terminalcore");
    assert.equal(pick("따뜻한 동네 빵집 영상 lit"), "paper");
    assert.equal(pick("a film in the paper style about tides lit"), "paper", "a named style beats a keyword");
    assert.equal(pick("make a video lit", { house: { style: "tidal" } }), "tidal");
    assert.equal(pick("make a video in the terminalcore style lit", { house: { style: "tidal" } }), "terminalcore");
    assert.equal(pick("따뜻한 키네틱 타이포 영상 lit", { path: "type" }), "swiss-signal");
    for (let i = 0; i < 3; i++) assert.equal(pick("Tidewell, an offline-first notes sync tool"), "swiss-signal", "Tidewell is not the word tide");
  });

  it("the validator refuses any other style and names the rule that chose", () => {
    assert.equal(field(stageTreatment(null)), null);
    assert.equal(field(stageTreatment(null, { style: "tidal" })), "style");
    assert.match(reason(stageTreatment(null, { style: "tidal" })), /a explainer film takes paper; this film takes the paper style/u);
    assert.equal(field(stageTreatment(null, { style: "nope" })), "style");
  });

  it("format, length and genre are rules too", () => {
    assert.equal(field(stageTreatment(null, { format: "9:16" })), "format", "no vertical word, no 9:16");
    const vertical = stageTreatment(null);
    vertical.request = `${vertical.request} 세로 숏폼으로`;
    assert.equal(field(vertical), "format", "a vertical word asks for 9:16");
    assert.equal(askedSeconds("20초짜리 영상"), 20);
    assert.equal(askedSeconds("a 2 min film"), 120);
    assert.equal(cuedGenre("새 앱 출시 티저 영상").genre, "announcement");
    assert.equal(cuedGenre("엘리베이터 원리를 설명하는 영상").genre, "explainer");
    assert.equal(cuedGenre("키네틱 타이포 영상").genre, "type-led");
    assert.equal(cuedGenre("a film about my grandmother"), null);
    assert.equal(field(stageTreatment(null, { genre: "brand-mood" })), "genre", "the request's 어떻게 makes it an explainer");
    const long = stageTreatment(null, { durationSec: 30 });
    long.beats[4].t1 = 30;
    assert.equal(field(long), "durationSec", "an explainer runs 16-24 s unless the user names a length");
  });

  it("the stage palette, faces and bed come from the style", () => {
    const off = stageTreatment(null);
    off.palette[1].color = "#ff00aa";
    assert.equal(field(off), "palette[1].color");
    const noPalette = stageTreatment(null);
    delete noPalette.palette;
    assert.equal(field(noPalette), null, "the stage palette is optional");
    assert.equal(field(stageTreatment(null, { typePlan: { faces: ["VT323"], hierarchy: "One line.", maxWordsOnScreen: 4 } })), "typePlan.faces");
    // A minimal film's generated bed must be one of the style's own.
    const minimalBed = (t) => ({ ...t, request: `${t.request} 미니멀하게`, register: "minimal", sound: { ...t.sound, mode: "generated", palette: { ...styles.readStyle(t.style).sound } } });
    const bed = minimalBed(stageTreatment(null));
    bed.sound.palette.tempo = 120;
    assert.equal(field(bed), "sound.palette");
    const typeBed = minimalBed(typeTreatment(null));
    typeBed.sound.palette.timbre = "soft-keys";
    assert.equal(field(typeBed), "sound.palette");
  });

  it("every stage beat is a shot: layout, hero, a hand-off from the style, the last one ends", () => {
    const cases = [
      [(t) => { t.beats[1].layout = "collage"; }, "beats[1].layout"],
      [(t) => { delete t.beats[2].hero; }, "beats[2].hero"],
      [(t) => { t.beats[0].transition = "dissolve"; }, "beats[0].transition"],
      [(t) => { t.beats[4].transition = "cut"; }, "beats[4].transition"],
      [(t) => { t.beats[0].lines = [7]; }, "beats[0].lines"],
      [(t) => { t.beats[2].layout = "full"; t.beats[2].lines = [1]; }, "beats[2].lines"],
    ];
    for (const [mutate, expected] of cases) {
      const t = stageTreatment(null);
      mutate(t);
      assert.equal(field(t), expected);
    }
    assert.equal(field(typeTreatment(null)), null, "type beats need no shot fields");
  });

  it("preview: true only when the request asks for a preview or storyboard", () => {
    assert.equal(field(stageTreatment(null, { preview: true })), "preview");
    const asked = stageTreatment(null, { preview: true });
    asked.request = `${asked.request} 스토리보드 먼저 보여줘`;
    assert.equal(field(asked), null);
  });
});

describe("the house file keeps the style for the next film", () => {
  it("a passed film writes it; the next film in that folder is held to it unless the request names another", () => {
    const dir = temp("lit-house-");
    const first = join(dir, "motion-first");
    recordHouse(first, { style: "terminalcore", path: "stage", format: "16:9", durationSec: 16 });
    const house = readHouse(join(dir, "motion-second"));
    assert.equal(house.style, "terminalcore");
    assert.equal(house.films.length, 1);
    assert.equal(field(stageTreatment(null), { house }), "style", "the auto-pick yields to the house style");
    const named = stageTreatment(null, { style: "tidal" });
    named.request = `${named.request} in the tidal style`;
    named.beats[2].transition = "wipe";
    named.sound.palette = { timbre: "felt-strings", key: "D", mode: "major", tempo: 84 };
    delete named.palette;
    assert.equal(field(named, { house }), null);
    recordHouse(join(dir, "motion-third"), { style: "tidal", path: "stage", format: "16:9", durationSec: 16 });
    const after3 = JSON.parse(readFileSync(join(dir, HOUSE_FILE), "utf8"));
    assert.equal(after3.style, "terminalcore", "a named film does not move the house style");
    assert.equal(after3.films.length, 2);
  });

  it("loadTreatment reads the house beside the output folder (CLI: exit 16 names the style)", () => {
    const dir = temp("lit-house-cli-");
    writeFileSync(join(dir, HOUSE_FILE), JSON.stringify({ schema: "litclaude.motion-house/v1", style: "tidal", films: [] }));
    const out = join(dir, "motion-film");
    writeTreatment(out, stageTreatment(null));
    const r = spawnSync(process.execPath, [motion, "scaffold", "--out", out], { encoding: "utf8" });
    assert.equal(r.status, 16, r.stdout + r.stderr);
    assert.match(r.stderr, /style: the project's house style is tidal/u);
  });
});

describe("the page gets the style and the timeline", () => {
  it("style.css carries the role classes and sizes; style.js the zones in pixels and the shots", () => {
    const style = styles.readStyle("paper");
    const css = styles.styleCss(style, "9:16");
    assert.match(css, /\.lit-headline \{ font-family: "Pretendard"; font-size: 74px; font-weight: 700;/u);
    assert.match(css, /--lit-signal: #B0452A;/u);
    assert.match(css, /word-break: keep-all;/u, "Korean breaks between eojeol, never inside a word");
    const t = stageTreatment(null);
    const js = styles.styleScript(styles.readStyle("swiss-signal"), "16:9", t);
    const window = {};
    vm.runInNewContext(js, { window, Object, JSON });
    assert.deepEqual(JSON.parse(JSON.stringify(window.LitStyle.zones.split.type)), { x: 154, y: 173, w: 691, h: 734 });
    assert.equal(window.LitTimeline.beats[2].layout, "hero");
  });

  it("the router serves /lit/style.css and /lit/style.js only for a film with a style", () => {
    const dir = temp("lit-route-");
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    const withStyle = stageRouter({ stageDir: dir, faces: [], style: { css: "a{}", js: "1" } });
    assert.equal(withStyle.route("http://lit.stage/lit/style.css").body, "a{}");
    assert.equal(withStyle.route("http://lit.stage/lit/style.js").body, "1");
    assert.equal(stageRouter({ stageDir: dir, faces: [] }).route("http://lit.stage/lit/style.css").kind, "missing");
  });

  it("the kit's shot, zone, place and tokens read them", () => {
    const window = {};
    vm.runInNewContext(styles.styleScript(styles.readStyle("swiss-signal"), "16:9", stageTreatment(null)), { window, Object, JSON });
    vm.runInNewContext(readFileSync(join(engine, "stage", "stage-kit.js"), "utf8"), { window, Intl, Math, Number, String, Array, Object, Error, JSON, WeakMap, parseFloat, parseInt });
    const { LitStage } = window;
    const s = LitStage.shot(4.75);
    assert.equal(s.index, 1);
    assert.equal(s.layout, "split-alt");
    assert.ok(Math.abs(s.p - 0.5) < 1e-9);
    assert.equal(LitStage.shot(16).index, 4, "the end of the film is the last shot");
    assert.equal(s.enter(0, 0.6), 1);
    assert.equal(LitStage.shot(3).enter(0, 0.6), 0);
    assert.deepEqual(JSON.parse(JSON.stringify(LitStage.zone("stage", "type"))), { x: 154, y: 810, w: 1613, h: 194 });
    assert.throws(() => LitStage.zone("full", "type"), /has no type zone/u);
    const el = { style: {} };
    LitStage.place(el, "split", "subject");
    assert.equal(el.style.left, "922px");
    const tk = LitStage.tokens();
    assert.equal(tk.ease.enter(0), 0);
    assert.equal(tk.ease.enter(1), 1);
    assert.ok(Math.abs(tk.spring.panel(5) - 1) < 1e-3, "a spring settles");
    assert.equal(tk.dur.exit, 0.28);
  });
});

describe("the style rules in the gate (pure judge)", () => {
  const W = 1920;
  const H = 1080;
  const mask = Buffer.alloc(W * H, 255);
  const t = stageTreatment(null, { style: "swiss-signal" });
  const copyNorm = t.copy.lines.map((l) => l.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));
  const run = (over) => ({ id: over.id ?? 1, kind: "dom", text: t.copy.lines[0], decor: false, rects: [[200, 300, 700, 380]], opacity: 1, fontSizePx: 76, capHeightPx: 76, gradient: false, color: "rgb(233, 235, 228)", family: "Archivo", ...over });
  const judge = (runs, beat = 0) => judgeStyle({ treatment: t, width: W, height: H, samples: [{ frame: 90, beat, mid: true, runs, mask }], settled: () => true, copyNorm });
  const status = (rules, id) => rules.find((x) => x.id === id).status;

  it("copy on the style and in its zone passes", () => {
    const rules = judge([run({})]);
    for (const id of ["TEXT-OVERLAP", "TEXT-ON-STYLE", "TEXT-ZONE"]) assert.equal(status(rules, id), "PASS", id);
  });

  it("text over text, an off-style colour, face or size, and copy outside its zone each FAIL", () => {
    assert.equal(status(judge([run({}), run({ id: 2, text: t.copy.lines[1], rects: [[300, 320, 800, 400]] })]), "TEXT-OVERLAP"), "FAIL");
    assert.equal(status(judge([run({ color: "rgb(255, 0, 170)" })]), "TEXT-ON-STYLE"), "FAIL");
    assert.equal(status(judge([run({ family: "Helvetica" })]), "TEXT-ON-STYLE"), "FAIL");
    assert.equal(status(judge([run({ fontSizePx: 60 })]), "TEXT-ON-STYLE"), "FAIL");
    assert.equal(status(judge([run({ rects: [[1100, 300, 1600, 380]] })]), "TEXT-ZONE"), "FAIL", "the split shot's copy belongs on the left");
    const full = stageTreatment(null);
    full.beats[0].layout = "full";
    assert.equal(status(judgeStyle({ treatment: full, width: W, height: H, samples: [{ frame: 90, beat: 0, mid: true, runs: [run({})], mask }], settled: () => true, copyNorm }), "TEXT-ZONE"), "FAIL");
  });

  it("non-copy text off the scale is only a warning; decor is exempt", () => {
    assert.equal(status(judge([run({ text: "SHELF 4", fontSizePx: 19 })]), "TEXT-ON-STYLE"), "WARN");
    assert.equal(status(judge([run({ decor: true, fontSizePx: 19, color: "rgb(1, 2, 3)" })]), "TEXT-ON-STYLE"), "PASS");
    assert.deepEqual(parseCssColour("rgba(12, 14, 19, 0.5)"), [12, 14, 19]);
  });

  it("FLAT-FRAME fails a long empty run of any colour, light or dark, and allows a short one at the ends", () => {
    const frames = (spreads) => spreads.map((s, i) => ({ frame: i, luminanceP995: 0.8, luminanceP005: 0.8 - s }));
    const gate = (f) => evaluateStageGate({ masterFlash: [], fps: 10, probe: null, width: W, height: H, treatment: t, exports: {}, frames: f, determinism: null }).rules.find((x) => x.id === "FLAT-FRAME");
    assert.equal(gate(frames([...Array(20).fill(0.5), ...Array(15).fill(0.001), ...Array(20).fill(0.5)])).status, "FAIL", "1.5 s of cream mid-film");
    assert.equal(gate(frames([...Array(15).fill(0.001), ...Array(40).fill(0.5)])).status, "PASS", "a 1.5 s opening fade is within the edge allowance");
    assert.equal(gate(frames(Array(50).fill(0.5))).status, "PASS");
  });
});

describe("the board and the scaffold", () => {
  it("the board grid fills the page without lopsided rows", () => {
    assert.equal(boardGrid(4, 1920, 1080).cols, 2);
    assert.equal(boardGrid(5, 1920, 1080).rows, 2);
    assert.ok(boardGrid(6, 1080, 1920).cols >= 3);
  });

  it("the board page names every shot, its time, layout and hand-off, and outlines its type zone", () => {
    const t = stageTreatment(null);
    const html = boardHtml({ treatment: t, stills: t.beats.map((_, i) => `s${i}.png`), check: { rules: [{ id: "TEXT-ZONE", status: "FAIL" }] } });
    for (const b of t.beats) assert.ok(html.includes(b.hero.replace(/'/gu, "'")), b.hero);
    assert.match(html, /01 {2}· {2}0\.0–3\.0 s {2}· {2}split {2}· {2}→ match/u);
    assert.equal((html.match(/class="zone"/gu) ?? []).length, 5);
    assert.match(html, /layout check: FAIL — TEXT-ZONE/u);
    assert.doesNotMatch(html, /https?:\/\//u);
  });

  it("addToStills lists the board in the stills index and returns the new manifest hash", async () => {
    const out = temp("lit-board-index-");
    mkdirSync(join(out, "stills"), { recursive: true });
    writeFileSync(join(out, "stills", "index.json"), JSON.stringify({ files: [{ file: "stills/sheet.png", kind: "sheet" }] }));
    writeFileSync(join(out, "stills", "board.png"), "png");
    const { createHash } = await import("node:crypto");
    const sha = (b) => createHash("sha256").update(b).digest("hex");
    const h = addToStills(out, { file: "stills/board.png", kind: "board" }, { sha256: sha });
    assert.equal(h, sha(readFileSync(join(out, "stills", "index.json"))));
    assert.ok(JSON.parse(readFileSync(join(out, "stills", "index.json"), "utf8")).files.some((f) => f.kind === "board"));
  });

  it("the scaffold writes one section per shot, every copy line verbatim, the style routes, no URL", () => {
    const t = stageTreatment(null);
    const html = scaffoldHtml(t);
    assert.equal((html.match(/<section class="shot"/gu) ?? []).length, t.beats.length);
    for (const line of t.copy.lines) assert.ok(html.includes(JSON.stringify(line)), line);
    for (const route of ["/lit/fonts.css", "/lit/style.css", "/lit/style.js", "/lit/stage-kit.js"]) assert.ok(html.includes(route), route);
    assert.doesNotMatch(html, /https?:\/\//u);
    assert.equal((html.match(/\(s, svg, t\) => \{\},/gu) ?? []).length, t.beats.length, "one DRAW per shot");
    assert.deepEqual(linesPerShot({ ...t, beats: t.beats.map((b, i) => ({ ...b, layout: i === 2 ? "full" : b.layout })) }).map((l) => l.length), [1, 0, 0, 1, 1]);
  });

  it("scaffold never overwrites a page", () => {
    const out = join(temp("lit-scaffold-"), "out");
    writeTreatment(out, stageTreatment(null));
    assert.equal(scaffoldCommand({ out }).code, 0);
    assert.throws(() => scaffoldCommand({ out }), /never overwrites a page/u);
  });

  it("the gallery's demo treatments are valid in every style and format", () => {
    for (const id of styles.STYLE_IDS) for (const format of ["16:9", "9:16"]) assert.equal(field(demoTreatment(id, format)), null, `${id} ${format}`);
  });
});

describe("done needs the board; a preview is done at the board", () => {
  const fakeBoardRun = (treatment, { checkFail = false } = {}) => {
    const out = join(temp("lit-preview-"), "out");
    writeTreatment(out, treatment);
    mkdirSync(join(out, "stills"), { recursive: true });
    const files = ["board.png", "sheet.png", "beat-01.png"].map((name) => {
      writeFileSync(join(out, "stills", name), name);
      return { file: `stills/${name}`, kind: name.split(/[-.]/u)[0] };
    });
    writeFileSync(join(out, "stills", "index.json"), JSON.stringify({ path: "stage", round: 1, stillsOnly: true, files }));
    writeFileSync(join(out, "stills", "check.json"), JSON.stringify({ rules: [{ id: "TEXT-ZONE", status: checkFail ? "FAIL" : "PASS" }] }));
    return out;
  };
  const preview = () => {
    const t = stageTreatment(null, { preview: true });
    t.request = `${t.request} 스토리보드 먼저`;
    return t;
  };

  it("a preview with no look round is not done; a failed board check is not done", () => {
    assert.equal(evaluateDone({ out: fakeBoardRun(preview()) }).status, "NOT_DONE");
    const failed = evaluateDone({ out: fakeBoardRun(preview(), { checkFail: true }) });
    assert.ok(failed.reasons.some((r) => /board check failed \(TEXT-ZONE\)/u.test(r)), failed.reasons.join("; "));
  });

  it("a preview is done once the board, the sheet and the beats are viewed in a round stamped with them", async () => {
    const out = fakeBoardRun(preview());
    const { readStills } = await import(join(engine, "node", "stills.mjs"));
    const stills = readStills(out);
    writeFileSync(join(out, "look.json"), JSON.stringify({ rounds: [{ round: 1, stillsSha256: stills.sha256, stillsOnly: true, viewed: ["stills/board.png", "stills/sheet.png", "stills/beat-01.png"], answers: [], revise: [] }] }));
    const done = evaluateDone({ out });
    assert.equal(done.status, "DONE", done.reasons.join("; "));
    assert.equal(done.preview, true);
    assert.match(done.labels[0], /storyboard preview .* the film is not rendered yet/u);
  });
});

describe("covers: the painted recipe needs a painting the user supplied", () => {
  it("generated base art no longer satisfies painted-light; the refusal names the recipes to take instead", async () => {
    const out = temp("lit-cover-art-");
    mkdirSync(join(out, "cover", "assets"), { recursive: true });
    writeFileSync(join(out, "cover", "assets", "base.png"), "art");
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update("art").digest("hex");
    writeFileSync(join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "generated", sha256: sha, box: [0.125, 0, 0.75, 1] }] }));
    assert.throws(() => checkAssets({ out, treatment: { recipe: "painted-light" }, rasters: [{ rel: "assets/base.png" }] }), /without one, take hero-3d \(or weight-tide, orbit-loop\)/u);
    writeFileSync(join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "user", sha256: sha, box: [0.125, 0, 0.75, 1] }] }));
    assert.equal(checkAssets({ out, treatment: { recipe: "painted-light" }, rasters: [{ rel: "assets/base.png" }] }).assets.length, 1);
  });
});

// ---- real renders: the board round in real Chrome ----

function warmRuntime() {
  const candidates = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")].filter(Boolean);
  for (const dir of candidates) if (runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready) return dir;
  return null;
}
const WARM = warmRuntime();
const needsRender = (t) => {
  if (!WARM || !findChrome()) {
    t.skip("needs a pre-warmed motion runtime and Chrome");
    return true;
  }
  return false;
};
const cli = (args) => spawnSync(process.execPath, [motion, ...args], { encoding: "utf8", timeout: 600000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM, LITCLAUDE_MOTION_FOREGROUND: "1" } });

describe("the board round on the real stage renderer", () => {
  it("the style gallery: the same demo in every style passes the board check and writes four boards", (t) => {
    if (needsRender(t)) return;
    const out = temp("lit-gallery-");
    const r = cli(["styles", "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const id of styles.STYLE_IDS) {
      assert.match(r.stdout, new RegExp(`${id}: board check PASS`, "u"));
      assert.ok(existsSync(join(out, id, "stills", "board.png")), id);
    }
    assert.ok(existsSync(join(out, "styles.png")));
  });

  it("a page that breaks the style fails the board check (exit 13) before any film is encoded", (t) => {
    if (needsRender(t)) return;
    const out = join(temp("lit-board-fail-"), "out");
    const treatment = demoTreatment("swiss-signal");
    writeTreatment(out, treatment);
    mkdirSync(join(out, "stage"), { recursive: true });
    // Every copy line in a stray colour and size, piled into one corner of the frame.
    writeFileSync(join(out, "stage", "index.html"), `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/lit/fonts.css">
<script src="/lit/stage-kit.js"></script>
<style>html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0C0E13; }
p { position: absolute; left: 1300px; top: 700px; margin: 0; font: 700 60px "Pretendard"; color: #ff4fa3; }</style>
<body>${treatment.copy.lines.map((l, i) => `<p id="l${i}">${l}</p>`).join("")}
<script>
  const lines = [...document.querySelectorAll("p")];
  lines.forEach((el) => LitStage.text(el));
  LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 12, render(t) {
    lines.forEach((el, i) => { el.style.opacity = t >= i * 3 && t < i * 3 + 3 ? "1" : (i === 0 && t >= 3 && t < 9 ? "1" : "0"); });
  } });
</script>
</body>`);
    treatment.fps = 30;
    treatment.request += " at 30 fps";
    writeTreatment(out, treatment);
    const r = cli(["stage", "--out", out, "--round", "1", "--stills-only"]);
    assert.equal(r.status, 13, r.stdout + r.stderr);
    assert.match(r.stdout, /BOARD_CHECK_FAIL/u);
    for (const id of ["TEXT-ON-STYLE", "TEXT-ZONE", "TEXT-OVERLAP"]) assert.match(r.stdout, new RegExp(id, "u"), id);
    assert.ok(existsSync(join(out, "stills", "board.png")), "the board is still drawn, with the verdict on it");
    assert.equal(existsSync(join(out, "film.mp4")), false);
  });
});
