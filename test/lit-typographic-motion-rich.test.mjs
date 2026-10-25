// lit-typographic-motion, round 3: maximal is the default. A film takes the rich register unless the
// request asks for calm or minimal; rich films plan a dense world (layers, labelled parts, camera
// moves), may use the style's role accents and carry a per-film layered score. The flash audit is the
// same in both registers. The offline Blender rung renders path-traced plates the stage page shows.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stageTreatment, typeTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skill = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skill, "engine");
const motion = join(skill, "scripts", "motion.mjs");
const { validateTreatment, TreatmentError, asksMinimal } = await import(join(engine, "node", "treatment.mjs"));
const { readStyle, STYLE_IDS, styleAccents } = await import(join(engine, "node", "styles.mjs"));
const { judgeText } = await import(join(engine, "node", "stage-qa.mjs"));
const { evaluateStageGate } = await import(join(engine, "node", "stage-gate.mjs"));
const { GATE } = await import(join(engine, "core", "constants.mjs"));
const { contrastRatio, relativeLuminance } = await import(join(engine, "core", "util.mjs"));
const { planScore, buildScore, writeScore, SCORE_GENRES } = await import(join(engine, "node", "score.mjs"));
const { SOUND } = await import(join(engine, "node", "sound.mjs"));
const { findBlender, blenderArgs, BLENDER } = await import(join(engine, "node", "blender.mjs"));
const { scanStage } = await import(join(engine, "node", "stage-serve.mjs"));
const { encodePng } = await import(join(engine, "node", "png.mjs"));

const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
const field = (t) => {
  try {
    validateTreatment(t);
    return null;
  } catch (error) {
    assert.ok(error instanceof TreatmentError, error.stack);
    return error.field;
  }
};
const calm = (t) => ({ ...t, request: `${t.request} 미니멀하게`, register: "minimal" });
const legacyBed = (t) => ({ ...t.sound, mode: "generated", palette: { ...readStyle(t.style).sound } });

describe("the rich register is the default", () => {
  it("a treatment without a register is rich; minimal needs a calm or minimal request, and a calm request is never rich", () => {
    assert.equal(validateTreatment(stageTreatment(null)).register, "rich");
    assert.equal(field(stageTreatment(null, { register: "minimal" })), "register", "minimal is opt-in");
    assert.equal(field(stageTreatment(null, { register: "loud" })), "register");
    const asked = calm(stageTreatment(null));
    assert.equal(field(asked), null);
    assert.equal(field({ ...asked, register: "rich" }), "register", "the request asked for minimal");
    for (const words of ["keep it minimal", "a quiet film", "calm and simple", "잔잔하게", "차분한 톤", "조용하게", "심플하게"]) assert.ok(asksMinimal(words), words);
    for (const words of ["make it rich", "launch film", "가득 채워서"]) assert.equal(asksMinimal(words), false, words);
  });

  it("a rich stage film plans its world: three layers, six labelled parts, camera moves in half the shots", () => {
    const none = stageTreatment(null);
    delete none.world;
    assert.equal(field(none), "world");
    const thin = stageTreatment(null);
    thin.world.layers = thin.world.layers.slice(0, 2);
    assert.equal(field(thin), "world.layers");
    const few = stageTreatment(null);
    few.world.labels = few.world.labels.slice(0, 5);
    assert.equal(field(few), "world.labels");
    const long = stageTreatment(null);
    long.world.labels[0] = "a label that runs on for far too many words";
    assert.equal(field(long), "world.labels[0]");
    const locked = stageTreatment(null);
    locked.world.camera = locked.world.camera.slice(0, 2);
    assert.equal(field(locked), "world.camera", "two moving shots of five is a locked film");
    const still = stageTreatment(null);
    still.world.camera[0].move = "locked";
    assert.equal(field(still), "world.camera[0].move");
    const bare = calm(stageTreatment(null));
    delete bare.world;
    bare.sound = legacyBed(bare);
    assert.equal(field(bare), null, "a minimal film plans no world");
    assert.equal(field(typeTreatment(null)), null, "the type path has no world");
  });

  it("every style names role accents at 3:1 on its ground, and no style bans a second hue any more", () => {
    for (const id of STYLE_IDS) {
      const style = readStyle(id);
      const accents = styleAccents(style);
      assert.ok(accents.length >= 3, `${id}: ${accents.length} accents`);
      for (const a of accents) {
        assert.ok(a.role.trim(), `${id}: an accent names its role`);
        assert.ok(contrastRatio(relativeLuminance(a.color), relativeLuminance(style.palette.ground)) >= 3, `${id} ${a.color}`);
      }
      assert.ok(!style.bans.some((b) => /second signal hue|two signal hues|more than two saturated/iu.test(b)), `${id}: ${style.bans.join("; ")}`);
    }
  });

  it("a rich palette may add the style's accents by role; a minimal one keeps to the core palette", () => {
    const accent = styleAccents(readStyle("paper"))[0];
    const rich = stageTreatment(null);
    rich.palette.push({ color: accent.color, role: accent.role });
    assert.equal(field(rich), null);
    const minimal = calm(stageTreatment(null));
    minimal.sound = legacyBed(minimal);
    minimal.palette.push({ color: accent.color, role: accent.role });
    assert.equal(field(minimal), `palette[${minimal.palette.length - 1}].color`);
  });

  it("rich films score their own music; the style's preset beds are for minimal films", () => {
    const preset = stageTreatment(null);
    preset.sound = legacyBed(preset);
    assert.equal(field(preset), "sound.mode");
    const minimal = calm(stageTreatment(null));
    minimal.sound = legacyBed(minimal);
    assert.equal(field(minimal), null);
    assert.equal(field(stageTreatment(null, { sound: { ...stageTreatment(null).sound, genre: "polka" } })), "sound.genre");
    for (const genre of SCORE_GENRES) assert.equal(field(stageTreatment(null, { sound: { ...stageTreatment(null).sound, genre } })), null, genre);
    const noEvents = stageTreatment(null);
    delete noEvents.sound.events;
    assert.equal(field(noEvents), "sound.events", "a stage score still syncs to on-screen events");
  });
});

// A hand-built text QA sample: every run inked and settled, at a small frame.
const W = 192;
const H = 108;
const run = (id, text, rect, extra = {}) => ({ id, text, rects: [rect], opacity: 1, kind: "dom", fontSizePx: 12, capHeightPx: 9, color: "rgb(29, 27, 24)", family: "Pretendard", ...extra });
const qaInput = (treatment, runs) => {
  const mask = new Uint8Array(W * H).fill(1);
  const rgbaA = new Uint8Array(W * H * 4).fill(255);
  const samples = treatment.beats.map((b, i) => ({ frame: i * 10, beat: i, mid: true, runs, mask, rgbaA, rgbaB: rgbaA, stray: 0, fonts: [] }));
  const timeline = Array.from({ length: 200 }, (_, k) => ({ frame: k, t: k / 10, runs }));
  return { treatment, width: W, height: H, timeline, samples };
};
const rule = (rules, id) => rules.find((x) => x.id === id);

describe("the text QA reads the register", () => {
  const labels = (t) => t.world.labels.map((l, i) => run(`l${i}`, l, [20 + i * 2, 20 + i * 8, 60 + i * 2, 26 + i * 8]));
  it("rich films may carry dense decor text; minimal films keep the 25 % cap", () => {
    const t = validateTreatment(stageTreatment(null));
    const runs = [run("c0", t.copy.lines[0], [20, 70, 120, 80]), run("d0", "0x3f 0x41 0x7e", [20, 20, 120, 30], { decor: true })];
    assert.equal(rule(judgeText(qaInput(t, runs)).rules ?? judgeText(qaInput(t, runs)), "TEXT-DECOR").status, "PASS");
    const m = { ...t, register: "minimal" };
    assert.equal(rule(judgeText(qaInput(m, runs)).rules ?? judgeText(qaInput(m, runs)), "TEXT-DECOR").status, "FAIL");
  });

  it("a rich film shows the labelled parts its world plans, several readable runs per shot", () => {
    const t = validateTreatment(stageTreatment(null));
    const dense = [run("c0", t.copy.lines[0], [20, 90, 120, 98]), ...labels(t)];
    const ok = judgeText(qaInput(t, dense));
    assert.equal(rule(ok.rules ?? ok, "TEXT-LABELS").status, "PASS", JSON.stringify(rule(ok.rules ?? ok, "TEXT-LABELS")));
    const sparse = judgeText(qaInput(t, [run("c0", t.copy.lines[0], [20, 90, 120, 98]), ...labels(t).slice(0, 2)]));
    assert.equal(rule(sparse.rules ?? sparse, "TEXT-LABELS").status, "FAIL");
    const minimal = judgeText(qaInput({ ...t, register: "minimal" }, [run("c0", t.copy.lines[0], [20, 90, 120, 98])]));
    assert.equal(rule(minimal.rules ?? minimal, "TEXT-LABELS").status, "N/A");
  });
});

describe("the flash audit is the same in both registers", () => {
  it("MO-C-03 keeps its thresholds", () => {
    assert.deepEqual(
      { grid: GATE.flashGrid, cell: GATE.flashCellPx, delta: GATE.flashDelta, dark: GATE.flashDarkCeiling, window: GATE.flashWindowCells, area: GATE.flashWindowArea, edge: GATE.flashEdgeFrames, red: [GATE.redRatio, GATE.redScale, GATE.redDelta], perSecond: [GATE.maxFlashesPerSecond, GATE.maxRedFlashesPerSecond] },
      { grid: [320, 180], cell: 6, delta: 0.1, dark: 0.8, window: [107, 60], area: 0.25, edge: 3, red: [0.8, 320, 20], perSecond: [3, 3] },
    );
  });

  it("the stage gate judges flashes without reading the register", () => {
    const masterFlash = Array.from({ length: 120 }, (_, i) => ({ up: i % 12 === 0, down: i % 12 === 6, redUp: false, redDown: false }));
    const base = { masterFlash, exports: {}, frames: [], fps: 60 };
    const a = evaluateStageGate({ ...base, treatment: { register: "rich" } }).rules.find((x) => x.id === "MO-C-03");
    const b = evaluateStageGate({ ...base, treatment: { register: "minimal" } }).rules.find((x) => x.id === "MO-C-03");
    assert.deepEqual(a, b);
  });
});

describe("the per-film score", () => {
  const fps = 60;
  const frames = (t) => Math.round(t.durationSec * fps);
  const cuts = (t) => t.beats.slice(1).map((b) => b.t0);
  const other = () => {
    const t = stageTreatment(null);
    t.request = "도시 정원 공유 앱을 소개하는 영상 만들어줘 lit";
    t.idea = "A balcony planter lights up a whole street of shared gardens, one window at a time.";
    t.story = { ...t.story, beat: 2, turn: "Every dark window on the street lights up with its own planter at once." };
    t.protagonist.acts = t.protagonist.acts.filter((a) => a.beat !== 3).concat({ beat: 2, action: "Lights the first window." });
    return validateTreatment(t);
  };
  const scoreOf = (t) => buildScore({ treatment: t, frameCount: frames(t), fps, cutTimes: cuts(t) });
  const rms = (ch, a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += ch[i] * ch[i];
    return Math.sqrt(s / Math.max(1, b - a));
  };
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

  it("two films get two different scores: key, tempo, progression or arrangement, and never the same bytes", () => {
    const a = validateTreatment(stageTreatment(null));
    const b = other();
    const pa = planScore({ treatment: a, durationSec: a.durationSec, cutTimes: cuts(a) });
    const pb = planScore({ treatment: b, durationSec: b.durationSec, cutTimes: cuts(b) });
    const sig = (p) => JSON.stringify([p.key, p.mode, p.bpm, p.progression, p.sections.map((s) => s.kind)]);
    assert.notEqual(sig(pa), sig(pb));
    const sha = (s) => createHash("sha256").update(Buffer.from(s.left.buffer)).digest("hex");
    assert.notEqual(sha(scoreOf(a)), sha(scoreOf(b)));
    assert.equal(sha(scoreOf(a)), sha(scoreOf(a)), "the same film scores the same bytes");
  });

  it("the arrangement follows the beats: an intro, a build with a riser, and the drop on the turn", () => {
    const t = validateTreatment(stageTreatment(null));
    const p = planScore({ treatment: t, durationSec: t.durationSec, cutTimes: cuts(t) });
    assert.equal(p.sections[0].kind, "intro");
    assert.ok(p.sections.some((s) => s.kind === "build"));
    const drop = p.sections.find((s) => s.kind === "drop");
    assert.equal(drop.t0, t.beats[t.story.beat].t0, "the drop lands on the turn shot");
    assert.ok(p.fx.some((f) => f.kind === "riser" && Math.abs(f.t - drop.t0) < 1e-6), "a riser leads into the drop");
    assert.ok(p.bpm >= 100 && p.bpm <= 140, `${p.bpm} BPM`);
  });

  it("is mixed from at least six audible stems, with the bass ducked under the kick and no clipping", () => {
    const t = validateTreatment(stageTreatment(null));
    const s = scoreOf(t);
    const audible = Object.entries(s.stems).filter(([, st]) => db(rms(st.left, 0, st.left.length)) > -45);
    assert.ok(audible.length >= 6, `${audible.length} audible stems: ${audible.map(([k]) => k).join(", ")}`);
    for (const name of ["kick", "clap", "hats", "bass", "chords", "lead"]) assert.ok(s.stems[name], `stem ${name}`);
    const sr = SOUND.sampleRate;
    const drop = s.plan.sections.find((x) => x.kind === "drop");
    const kicks = s.plan.kicks.filter((k) => k >= drop.t0 && k + 0.25 < drop.t1);
    assert.ok(kicks.length >= 2, "kicks in the drop");
    let near = 0;
    let away = 0;
    for (const k of kicks) {
      const i = Math.round(k * sr);
      near += rms(s.stems.bass.left, i + Math.round(0.005 * sr), i + Math.round(0.035 * sr));
      away += rms(s.stems.bass.left, i + Math.round(0.15 * sr), i + Math.round(0.21 * sr));
    }
    assert.ok(db(away) - db(near) >= 4, `sidechain ${(db(away) - db(near)).toFixed(1)} dB`);
    assert.ok(s.peakDbfs <= SOUND.bedPeakDbfs + 0.05, `peak ${s.peakDbfs}`);
    assert.ok(Math.abs(s.lufs - SOUND.targetLufs) <= 0.5, `${s.lufs} LUFS`);
  });

  it("on-screen events still sound on their own frame", () => {
    const t = validateTreatment(stageTreatment(null));
    const s = scoreOf(t);
    const sr = SOUND.sampleRate;
    for (const e of t.sound.events.filter((x) => x.kind === "tap")) {
      const i = Math.round(e.t * sr);
      const at = rms(s.stems.events.left, i, i + Math.round(0.03 * sr));
      const before = rms(s.stems.events.left, i - Math.round(0.06 * sr), i - Math.round(0.03 * sr));
      assert.ok(db(at) - db(before) >= 12, `tap at ${e.t}`);
    }
    for (const c of s.cues.filter((x) => x.kind === "event")) assert.equal(c.delta, 0);
  });

  it("writes the mix and keeps every stem for the next round", () => {
    const out = temp("lit-score-");
    const t = validateTreatment(stageTreatment(null));
    const summary = writeScore({ treatment: t, frameCount: frames(t), fps, cutTimes: cuts(t), dir: out });
    assert.equal(summary.mode, "score");
    assert.ok(existsSync(join(out, "sound", "score.wav")));
    const stems = readdirSync(join(out, "sound", "stems")).filter((f) => f.endsWith(".wav"));
    assert.ok(stems.length >= 6, stems.join(", "));
    const cues = JSON.parse(readFileSync(join(out, "sound-cues.json"), "utf8"));
    assert.equal(cues.mode, "score");
    assert.ok(cues.stems.every((x) => typeof x.rmsDbfs === "number" && x.file.startsWith("sound/stems/")));
    assert.ok(cues.sidechainDb >= 4);
  });
});

describe("the offline Blender rung", () => {
  const fake = (dir) => {
    // A stand-in Blender: it records its argv and writes the stills or frames the runner would.
    const file = join(dir, "blender");
    writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const at = (k) => argv[argv.indexOf(k) + 1];
const out = at("--out");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "argv.json"), JSON.stringify(argv));
const png = Buffer.from("${encodePng(new Uint8Array(16).fill(200), 2, 2).toString("base64")}", "base64");
const names = argv.includes("--stills") ? at("--stills").split(",").map((_, i) => "still-" + String(i + 1).padStart(2, "0") + ".png")
  : Array.from({ length: Number(at("--frames").split("-")[1]) }, (_, i) => String(i + 1).padStart(6, "0") + ".png");
for (const n of names) fs.writeFileSync(path.join(out, n), png);
fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ blender: "5.1.2", engine: "CYCLES", device: "METAL", samples: Number(at("--samples")), percent: Number(at("--percent")), files: names }));
`);
    chmodSync(file, 0o755);
    return file;
  };
  const env = (extra) => ({ ...process.env, ...extra });
  const rich3d = () => {
    const t = stageTreatment(null);
    t.depth = "3d";
    t.render3d = "blender";
    t.visualDevices[0] = { kind: "depth3d", role: "subject", beats: [0, 1, 2, 3, 4] };
    return t;
  };

  it("a request for high-quality 3D is steered to the Blender rung when Blender is installed", async () => {
    const { asksPathTraced } = await import(join(engine, "node", "treatment.mjs"));
    const { scaffoldCommand } = await import(join(engine, "node", "scaffold.mjs"));
    for (const ask of ["LIT 키를 고퀄리티 3D로 보여줘", "a cinematic 3D launch film", "photoreal render of the box", "Blender로 렌더해줘"]) assert.equal(asksPathTraced(ask), true, ask);
    for (const ask of ["3D로 상자를 돌려줘", "a quick spinning cube"]) assert.equal(asksPathTraced(ask), false, ask);
    const bin = fake(temp("motion-fakeblender-"));
    const scaffoldFor = (request, render3d, extra) => {
      const out = temp("motion-scaffold3d-");
      const t = rich3d();
      t.request = request;
      t.render3d = render3d;
      writeTreatment(out, t);
      return scaffoldCommand({ out, env: env(extra) }).message;
    };
    assert.match(scaffoldFor("LIT 키를 고퀄리티 3D로", "three", { LITCLAUDE_BLENDER: bin }), /BLENDER: .*render3d "blender"/u);
    assert.doesNotMatch(scaffoldFor("LIT 키를 고퀄리티 3D로", "three", { LITCLAUDE_BLENDER: join(bin, "missing") }), /BLENDER:/u, "no Blender, no hint");
    assert.doesNotMatch(scaffoldFor("3D로 상자를 돌려줘", "three", { LITCLAUDE_BLENDER: bin }), /BLENDER:/u, "a plain 3D film stays on the GPU rung");
    assert.match(scaffoldFor("LIT 키를 고퀄리티 3D로", "blender", { LITCLAUDE_BLENDER: bin }), /scene\.py.*LitStage\.plate/u);
  });

  it("passes Cycles a seed inside its signed 32-bit range, whatever the treatment's seed", () => {
    const t = validateTreatment(rich3d());
    for (const seed of [0, 1707, 2147483647, 2147483648, 4294967295]) {
      const args = blenderArgs({ treatment: { ...t, seed }, scene: "s.py", out: "o", quality: "preview" });
      const value = Number(args[args.indexOf("--seed") + 1]);
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 2147483647, `${seed} -> ${value}`);
    }
  });

  it("finds Blender from the override, the macOS app or PATH, and an override that is missing finds none", () => {
    const yes = () => true;
    const no = () => false;
    assert.deepEqual(findBlender({ env: { LITCLAUDE_BLENDER: "/opt/b/blender" }, exists: yes, platform: "darwin" }), { path: "/opt/b/blender", source: "LITCLAUDE_BLENDER" });
    assert.equal(findBlender({ env: { LITCLAUDE_BLENDER: "/opt/b/blender" }, exists: (p) => p === BLENDER.macApp, platform: "darwin" }), null, "an explicit path is never second-guessed");
    assert.deepEqual(findBlender({ env: { PATH: "" }, exists: (p) => p === BLENDER.macApp, platform: "darwin" }), { path: BLENDER.macApp, source: "app" });
    assert.deepEqual(findBlender({ env: { PATH: "/x/bin" }, exists: (p) => p === "/x/bin/blender", platform: "linux" }), { path: "/x/bin/blender", source: "PATH" });
    assert.equal(findBlender({ env: { PATH: "/x/bin" }, exists: no, platform: "darwin" }), null);
  });

  it("builds a headless factory-startup command: preview stills at 50 % and 40 spp, the final sequence at full size", () => {
    const t = validateTreatment(rich3d());
    const preview = blenderArgs({ treatment: t, scene: "/w/stage/scene.py", out: "/w/stage/plate-preview", quality: "preview" });
    assert.deepEqual(preview.slice(0, 4), ["-b", "--factory-startup", "-P", BLENDER.runner]);
    const tail = preview.slice(preview.indexOf("--") + 1);
    const at = (args, k) => args[args.indexOf(k) + 1];
    assert.equal(at(tail, "--scene"), "/w/stage/scene.py");
    assert.equal(at(tail, "--percent"), "50");
    assert.equal(at(tail, "--samples"), "40");
    assert.equal(at(tail, "--device"), "METAL");
    assert.deepEqual(at(tail, "--stills").split(",").map(Number), t.beats.map((b) => +((b.t0 + b.t1) / 2).toFixed(3)));
    const final = blenderArgs({ treatment: t, scene: "/w/stage/scene.py", out: "/w/stage/plate", quality: "final" }).slice(5);
    assert.equal(at(final, "--percent"), "100");
    assert.ok(Number(at(final, "--samples")) >= 128);
    assert.equal(at(final, "--frames"), `1-${Math.round(t.durationSec * BLENDER.plateFps)}`);
    assert.equal(at(final, "--fps"), String(BLENDER.plateFps));
  });

  it("motion.mjs blender renders the preview, then the final plate with a receipt the stage trusts", () => {
    const out = temp("lit-blender-");
    const bin = fake(temp("lit-fakeblender-"));
    writeTreatment(out, rich3d());
    mkdirSync(join(out, "stage"), { recursive: true });
    writeFileSync(join(out, "stage", "scene.py"), "# scene\n");
    writeFileSync(join(out, "stage", "index.html"), "<!doctype html><title>plate</title>");
    const pre = spawnSync(process.execPath, [motion, "blender", "--out", out], { encoding: "utf8", env: env({ LITCLAUDE_BLENDER: bin }) });
    assert.equal(pre.status, 0, pre.stderr + pre.stdout);
    assert.match(pre.stdout, /preview/u);
    assert.ok(existsSync(join(out, "stage", "plate-preview", "still-01.png")));
    const fin = spawnSync(process.execPath, [motion, "blender", "--out", out, "--final"], { encoding: "utf8", env: env({ LITCLAUDE_BLENDER: bin }) });
    assert.equal(fin.status, 0, fin.stderr + fin.stdout);
    const plate = JSON.parse(readFileSync(join(out, "stage", "plate", "plate.json"), "utf8"));
    assert.equal(plate.frames.length, Math.round(16 * BLENDER.plateFps));
    assert.equal(plate.device, "METAL");
    const scan = scanStage(join(out, "stage"));
    assert.equal(scan.rasters.length, 0, "the plate's frames are not counted as page rasters");
    assert.equal(scan.plate.frames.length, plate.frames.length);
  });

  it("an unlisted frame sequence is still a flipbook", () => {
    const stage = temp("lit-flip-");
    writeFileSync(join(stage, "index.html"), "<!doctype html><title>x</title>");
    mkdirSync(join(stage, "plate"));
    const png = encodePng(new Uint8Array(64).fill(90), 4, 4);
    for (let i = 1; i <= 12; i++) writeFileSync(join(stage, "plate", `${String(i).padStart(6, "0")}.png`), png);
    assert.throws(() => scanStage(stage), /flipbook|raster/u);
  });

  it("without Blender the command names the fallback to the GPU rung and renders nothing", () => {
    const out = temp("lit-noblender-");
    writeTreatment(out, rich3d());
    mkdirSync(join(out, "stage"), { recursive: true });
    writeFileSync(join(out, "stage", "scene.py"), "# scene\n");
    const r = spawnSync(process.execPath, [motion, "blender", "--out", out], { encoding: "utf8", env: env({ LITCLAUDE_BLENDER: join(out, "missing-blender") }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FALLBACK/u);
    assert.match(r.stdout, /render3d.*three|GPU rung/u);
    assert.equal(existsSync(join(out, "stage", "plate-preview")), false);
  });

  it("the Blender route is a 3D route", () => {
    const flat = stageTreatment(null);
    flat.render3d = "blender";
    assert.equal(field(flat), "render3d");
    assert.equal(field(stageTreatment(null, { render3d: "cycles" })), "render3d");
    assert.equal(field(rich3d()), null);
  });
});

describe("the completion gate follows a model that works inside the film folder", () => {
  it("records a render run from a subfolder against the turn armed at the workspace, and judges it at Stop", async () => {
    const { evaluateMotionStop, observeMotionTool, recordMotionTurn, motionTurnPath } = await import(join(root, "plugins", "litclaude", "lib", "motion-render-gate.mjs"));
    const ws = temp("motion-turn-");
    const film = join(ws, "motion-film");
    mkdirSync(film, { recursive: true });
    recordMotionTurn(ws, { sessionId: "s1", discipline: "lit-typographic-motion" });
    const input = { session_id: "s1", cwd: film, tool_name: "Bash", tool_input: { command: `node "${motion}" stage --out . --round 1 2>&1 | tail -15` }, tool_response: { stdout: "exit 0 OK" } };
    assert.ok(observeMotionTool(film, { input }), "the run is recorded");
    const turn = JSON.parse(readFileSync(motionTurnPath(ws), "utf8"));
    assert.deepEqual(turn.runs.map((r) => [r.mode, r.out]), [["stage", film]]);
    assert.equal(existsSync(join(film, ".litclaude")), false, "no second state folder inside the film");
    const gate = await evaluateMotionStop({ cwd: film, sessionId: "s1" });
    assert.equal(gate.action, "block");
    assert.doesNotMatch(gate.reason, /no render command ran/u);
  });
});

describe("a rich film fills its frame", () => {
  it("regionFill measures the busy share of each of 4 x 3 regions", async () => {
    const { regionFill, FILL_GRID } = await import(join(engine, "node", "analysis.mjs"));
    assert.deepEqual(FILL_GRID, { cols: 4, rows: 3 });
    const w = 384;
    const h = 216;
    const img = new Uint8Array(w * h * 4).fill(16);
    for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) if ((x >> 1) % 3 === 0) img.fill(220, (y * w + x) * 4, (y * w + x) * 4 + 3);
    const regions = regionFill(img, w, h);
    assert.equal(regions.length, 12);
    assert.deepEqual(regions.map((v) => v > 0.5), [true, true, false, false, true, true, false, false, true, true, false, false]);
  });

  it("RICH-FILL fails a rich film whose shots leave regions of the frame empty, and skips minimal films", () => {
    const t = validateTreatment(stageTreatment(null));
    const runs = [run("c0", t.copy.lines[0], [20, 90, 120, 98])];
    const withRegions = (treatment, regionsFor) => {
      const input = qaInput(treatment, runs);
      input.samples = input.samples.map((s, i) => ({ ...s, regions: regionsFor(i) }));
      return judgeText(input).rules ?? judgeText(input);
    };
    const full = Array(12).fill(0.6);
    const sparse = [0.4, 0.5, 0, 0, 0.6, 0.7, 0.1, 0.05, 0.8, 0.7, 0.1, 0];
    assert.equal(rule(withRegions(t, () => full), "RICH-FILL").status, "PASS");
    assert.equal(rule(withRegions(t, (i) => (i === t.beats.length - 1 ? sparse : full)), "RICH-FILL").status, "PASS", "the end card may breathe");
    const failed = rule(withRegions(t, (i) => (i % 2 ? sparse : full)), "RICH-FILL");
    assert.equal(failed.status, "FAIL");
    assert.match(failed.detail, /empty/u);
    assert.equal(rule(withRegions({ ...t, register: "minimal" }, () => sparse), "RICH-FILL").status, "N/A");
    assert.equal(rule(judgeText(qaInput(t, runs)).rules ?? judgeText(qaInput(t, runs)), "RICH-FILL").status, "N/A", "no region data, no verdict");
  });
});

describe("the score survives the AAC encode", () => {
  // The muxed stream is AAC at 256 kb/s and the audit holds its decoded peak at -0.5 dBFS. A waveshaped
  // limiter left a real film's score at -2.1 dBFS in the WAV and +0.38 dBFS after the encode.
  const decodedPeakDb = (wav) => {
    const m4a = `${wav}.m4a`;
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "256k", m4a]).status, 0);
    const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", m4a, "-f", "s16le", "-acodec", "pcm_s16le", "-"], { maxBuffer: 1 << 28 }).stdout;
    let peak = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    return 20 * Math.log10(peak / 32768);
  };
  it("the round-3 hero film's score stays finite and on loudness in every genre", () => {
    // Its bar grid starts before 0 s, so the first pad bar opens before its section: the filter cutoff
    // went negative and the chords stem diverged to Infinity, leaving the mix at -37 LUFS.
    const base = JSON.parse(readFileSync(join(root, "test", "fixtures", "lit-typographic-motion", "round3-hero-house.treatment.json"), "utf8"));
    for (const genre of SCORE_GENRES) {
      const t = validateTreatment({ ...base, sound: { ...base.sound, genre } });
      const s = buildScore({ treatment: t, frameCount: Math.round(t.durationSec * 30), fps: 30, cutTimes: t.beats.slice(1).map((b) => b.t0) });
      for (const [name, st] of Object.entries(s.stems)) assert.ok(st.left.every(Number.isFinite) && st.right.every(Number.isFinite), `${genre}: stem ${name} is finite`);
      assert.ok(Math.abs(s.lufs - SOUND.targetLufs) <= 0.5, `${genre}: ${s.lufs} LUFS`);
    }
  });

  it("the round-3 hero film's house score decodes under -0.5 dBFS", () => {
    const out = temp("lit-score-aac-");
    const t = validateTreatment(JSON.parse(readFileSync(join(root, "test", "fixtures", "lit-typographic-motion", "round3-hero-house.treatment.json"), "utf8")));
    writeScore({ treatment: t, frameCount: Math.round(t.durationSec * 30), fps: 30, cutTimes: t.beats.slice(1).map((b) => b.t0), dir: out });
    const peak = decodedPeakDb(join(out, "sound", "score.wav"));
    assert.ok(peak <= -0.5 - 0.3, `decoded peak ${peak.toFixed(2)} dBFS`);
  });
  for (const genre of SCORE_GENRES) {
    it(`a ${genre} score decodes under -0.5 dBFS`, () => {
      const out = temp("lit-score-aac-");
      const t = validateTreatment(stageTreatment(null, { sound: { ...stageTreatment(null).sound, genre } }));
      const fps = 30;
      writeScore({ treatment: t, frameCount: Math.round(t.durationSec * fps), fps, cutTimes: t.beats.slice(1).map((b) => b.t0), dir: out });
      const peak = decodedPeakDb(join(out, "sound", "score.wav"));
      assert.ok(peak <= -0.5 - 0.3, `${genre}: decoded peak ${peak.toFixed(2)} dBFS`);
    });
  }
});
