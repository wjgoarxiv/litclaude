import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Keyed overlay clips on the stage path (references/stage.md, Clips): frames inside a declared clip
// folder are exempt from the flipbook/count rule, everything else keeps the raster limits.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const engine = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion", "engine");
const serve = await import(join(engine, "node", "stage-serve.mjs"));
const { encodePng } = await import(join(engine, "node", "png.mjs"));
const { scanStage } = serve;
const runtime = await import(join(engine, "node", "runtime.mjs"));
const { findChrome } = await import(join(engine, "node", "chrome.mjs"));
const { TIMBRES } = await import(join(engine, "node", "sound.mjs"));
const { stageTestTreatment, writeTreatment } = await import(join(root, "test", "helpers", "motion-treatment.mjs"));
const fixtures = join(root, "test", "fixtures", "lit-typographic-motion", "stage");

const temps = [];
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const PAGE = "<!doctype html><title>clips</title>";
const frameName = (i) => `frame_${String(i).padStart(4, "0")}.png`;
/** An RGBA frame whose top-left pixel is transparent (a keyed clip); `opaque` makes it solid. */
const rgba = (w, h, { opaque = false, shade = 90 } = {}) => {
  const px = Buffer.alloc(w * h * 4, shade);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  if (!opaque) px[3] = 0;
  return encodePng(px, w, h, 4);
};

/** A stage dir: index.html, clips/<dir>/frame_NNNN.png for each clip, and clips/clips.json. */
function stageWith(clips, { declare = clips, extra = () => {} } = {}) {
  const stage = join(temp("lit-clips-"), "stage");
  mkdirSync(join(stage, "clips"), { recursive: true });
  writeFileSync(join(stage, "index.html"), PAGE);
  for (const c of clips) {
    mkdirSync(join(stage, "clips", c.dir), { recursive: true });
    const png = c.png ?? rgba(c.w ?? 8, c.h ?? 6);
    for (let i = 1; i <= (c.files ?? c.count); i++) writeFileSync(join(stage, "clips", c.dir, frameName(i)), png);
  }
  writeFileSync(join(stage, "clips", "clips.json"), JSON.stringify({ clips: declare.map(({ id, dir, count, fps }) => ({ id, dir, count, fps })) }));
  extra(stage);
  return stage;
}
const codeOf = (fn) => {
  try {
    fn();
    return 0;
  } catch (error) {
    return error.code === undefined ? error : error.code;
  }
};
const A = { id: "boom", dir: "01-boom", count: 12, fps: 30 };
const B = { id: "cat", dir: "10-cat", count: 30, fps: 30, w: 8, h: 6 };

describe("declared clips on the stage path", () => {
  it("a declared clip set is exempt from the flipbook and count rule and is listed in the scan", () => {
    const scan = scanStage(stageWith([A, B]));
    assert.equal(scan.rasters.length, 0, "clip frames are not page rasters");
    assert.deepEqual(scan.clips.map((c) => [c.id, c.count, c.fps, c.width, c.height]), [["boom", 12, 30, 8, 6], ["cat", 30, 30, 8, 6]]);
    assert.ok(scan.clips.every((c) => c.bytes > 0));
  });

  it("an undeclared frame sequence is still a flipbook, also beside a declared clip", () => {
    const stage = stageWith([A], {
      extra: (dir) => {
        mkdirSync(join(dir, "flip"));
        const png = rgba(8, 6);
        for (let i = 1; i <= 12; i++) writeFileSync(join(dir, "flip", frameName(i)), png);
      },
    });
    assert.throws(() => scanStage(stage), /flipbook/u);
  });

  it("a clip folder missing from clips.json is a flipbook, and a stage without clips.json keeps today's limits", () => {
    assert.throws(() => scanStage(stageWith([A], { declare: [] })), /flipbook/u);
    const stage = stageWith([A]);
    rmSync(join(stage, "clips", "clips.json"));
    assert.throws(() => scanStage(stage), /flipbook/u);
  });

  it("cover mode never takes clips", () => {
    assert.throws(() => scanStage(stageWith([A]), { clips: false }), /flipbook/u);
  });

  const refused = [
    ["more frames than a clip may have", { ...A, count: 361 }, /clip "boom".*361 frames/u],
    ["a frame missing from the run", { ...A, files: 11 }, /frame_0012\.png/u],
    ["a stray frame beyond the declared count", { ...A, files: 13 }, /frame_0013\.png/u],
    ["opaque RGB frames (not keyed)", { ...A, png: encodePng(Buffer.alloc(8 * 6 * 3, 90), 8, 6, 3) }, /RGBA/u],
    ["RGBA frames with no transparent pixel", { ...A, png: rgba(8, 6, { opaque: true }) }, /transparen/u],
    ["a frame larger than the overlay cap", { ...A, w: 721, h: 20 }, /clip "boom".*721/u],
    ["frames of mixed sizes", { ...A, count: 12, mixed: true }, /size/u],
    ["a frame rate above 30", { ...A, fps: 60 }, /fps/u],
    ["a folder name that climbs out", { ...A, dir: ".." }, /dir/u],
    ["an id that is not a plain token", { ...A, id: "a b" }, /id/u],
  ];
  for (const [name, clip, message] of refused) {
    it(`refuses ${name} with exit 17`, () => {
      const stage = stageWith([clip.dir === ".." ? { ...clip, dir: "x" } : clip], {
        extra: (dir) => {
          if (clip.dir === "..") writeFileSync(join(dir, "clips", "clips.json"), JSON.stringify({ clips: [{ id: clip.id, dir: "..", count: clip.count, fps: clip.fps }] }));
          if (clip.mixed) writeFileSync(join(dir, "clips", clip.dir, frameName(5)), rgba(9, 6));
        },
      });
      let failure;
      try {
        scanStage(stage);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, "the scan must refuse it");
      assert.equal(failure.code, 17, failure.message);
      assert.match(failure.message, message);
    });
  }

  it("refuses a duplicate id, a malformed clips.json and more than the clip cap", () => {
    assert.throws(() => scanStage(stageWith([A, { ...B, dir: "other", id: "boom" }])), (e) => e.code === 17 && /duplicate.*boom/u.test(e.message));
    const bad = stageWith([A]);
    writeFileSync(join(bad, "clips", "clips.json"), "{ not json");
    assert.throws(() => scanStage(bad), (e) => e.code === 17 && /clips\.json/u.test(e.message));
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, dir: `d${i}`, count: 2, fps: 30 }));
    assert.throws(() => scanStage(stageWith(many)), (e) => e.code === 17 && /at most 12 clips/u.test(e.message));
  });

  it("holds per-clip and total bytes and frames to the caps, which are exported", () => {
    const { scanClips, CLIP_LIMITS } = serve;
    assert.deepEqual(Object.keys(CLIP_LIMITS).sort(), ["bytesPerClip", "bytesTotal", "clips", "fps", "framesPerClip", "framesTotal", "side"]);
    const stage = stageWith([A, B]);
    const run = (limits) => codeOf(() => scanClips(stage, { limits: { ...CLIP_LIMITS, ...limits } }));
    assert.equal(run({}), 0);
    assert.equal(run({ bytesPerClip: 100 }), 17, "per-clip bytes");
    assert.equal(run({ bytesTotal: 100 }), 17, "total bytes");
    assert.equal(run({ framesTotal: 41 }), 17, "total frames");
  });

  it("the page can reach the declared clips at /lit/clips.js and nothing else changes in the router", () => {
    const stage = stageWith([A]);
    const router = serve.stageRouter({ stageDir: stage, faces: [] });
    const answer = router.route(`${serve.STAGE_ORIGIN}/lit/clips.js`);
    assert.equal(answer.kind, "body");
    const sandbox = { window: {} };
    vm.runInNewContext(answer.body, sandbox);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.LitClips)), { boom: { src: "clips/01-boom", count: 12, fps: 30, width: 8, height: 6 } });
    assert.equal(router.route(`${serve.STAGE_ORIGIN}/clips/01-boom/frame_0001.png`).kind, "file");
    const bare = serve.stageRouter({ stageDir: join(temp("lit-noclips-")), faces: [] });
    assert.equal(bare.route(`${serve.STAGE_ORIGIN}/lit/clips.js`).kind, "missing");
  });
});

describe("LitStage.clip picks the frame from film time alone", () => {
  const source = readFileSync(join(engine, "stage", "stage-kit.js"), "utf8");
  /** The kit over a bare window with a tiny DOM: elements remember their children and style. */
  const setup = (clips) => {
    const el = (tag) => {
      const e = { tag, style: {}, children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(c) { this.children.push(c); c.parent = this; }, replaceWith(n) { this.parent.children[this.parent.children.indexOf(this)] = n; n.parent = this.parent; } };
      return e;
    };
    const window = { LitClips: clips };
    const document = { createElement: el };
    vm.runInNewContext(source, { window, document, Intl, Math, Number, String, Array, Object, Error, JSON, parseFloat, parseInt });
    const parent = el("div");
    return { LitStage: window.LitStage, parent };
  };
  const data = { boom: { src: "clips/01-boom", count: 12, fps: 30, width: 520, height: 511 } };
  const box = { x: 10, y: 20, w: 300, h: 300 };
  const shown = (parent) => parent.children[0].children[0]?.src;

  it("maps film time to a 1-based frame: floor((t - start) * fps) + 1", () => {
    const { LitStage, parent } = setup(data);
    const show = LitStage.clip({ parent, id: "boom", box });
    assert.equal(show(1.0, { start: 1.0 }), parent.children[0]);
    assert.match(shown(parent), /clips\/01-boom\/frame_0001\.png$/u);
    show(1.0 + 4 / 30, { start: 1.0 });
    assert.match(shown(parent), /frame_0005\.png$/u);
    show(1.0 + 11 / 30, { start: 1.0 });
    assert.match(shown(parent), /frame_0012\.png$/u);
  });

  it("is hidden before its cue and after its last frame unless it loops or holds", () => {
    const { LitStage, parent } = setup(data);
    const show = LitStage.clip({ parent, id: "boom", box });
    assert.equal(show(0.5, { start: 1.0 }), null, "before the cue");
    assert.equal(parent.children[0].style.display, "none");
    assert.equal(show(1.0 + 12 / 30, { start: 1.0 }), null, "past the last frame");
    show(1.0 + 13 / 30, { start: 1.0, hold: true });
    assert.match(shown(parent), /frame_0012\.png$/u, "hold keeps the last frame");
    show(1.0 + 13 / 30, { start: 1.0, loop: true });
    assert.match(shown(parent), /frame_0002\.png$/u, "loop wraps by frame index");
  });

  it("plays a frame range and gives the same frame for the same t in any order", () => {
    const { LitStage, parent } = setup(data);
    const show = LitStage.clip({ parent, id: "boom", box });
    const opts = { start: 0, from: 4, to: 6 };
    show(2 / 30, opts);
    assert.match(shown(parent), /frame_0006\.png$/u);
    assert.equal(show(3 / 30, opts), null, "past the range");
    show(0, opts);
    assert.match(shown(parent), /frame_0004\.png$/u);
    show(2 / 30, opts);
    assert.match(shown(parent), /frame_0006\.png$/u, "same t, same frame");
  });

  it("keeps one wrapper at the box, so a page can scale it, and refuses an unknown clip or a missing script", () => {
    const { LitStage, parent } = setup(data);
    const show = LitStage.clip({ parent, id: "boom", box });
    show(0, { start: 0 });
    show(0.1, { start: 0 });
    assert.equal(parent.children.length, 1, "one wrapper, never one per frame");
    assert.deepEqual([parent.children[0].style.left, parent.children[0].style.top, parent.children[0].style.width, parent.children[0].style.height], ["10px", "20px", "300px", "300px"]);
    assert.throws(() => LitStage.clip({ parent, id: "nope", box }), /nope/u);
    assert.throws(() => setup(undefined).LitStage.clip({ parent, id: "boom", box }), /clips\.js/u);
  });
});

describe("a declared clip renders on the real stage", () => {
  const WARM = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")]
    .filter(Boolean).find((dir) => runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready);
  const needsRender = (t) => {
    if (!WARM || !findChrome()) {
      t.skip("motion runtime not pre-warmed or Chrome not found");
      return true;
    }
    return false;
  };
  /** Clip "swatch": frame k is a solid (20k, 0, 0) with one transparent corner pixel. */
  const swatchRun = () => {
    const out = join(temp("lit-clip-render-"), "out");
    mkdirSync(out, { recursive: true });
    cpSync(join(fixtures, "clip-overlay"), join(out, "stage"), { recursive: true });
    mkdirSync(join(out, "stage", "clips", "swatch"), { recursive: true });
    for (let k = 1; k <= 8; k++) {
      const px = Buffer.alloc(8 * 6 * 4);
      for (let i = 0; i < px.length; i += 4) px.set([20 * k, 0, 0, 255], i);
      px[3] = 0;
      writeFileSync(join(out, "stage", "clips", "swatch", frameName(k)), encodePng(px, 8, 6, 4));
    }
    writeFileSync(join(out, "stage", "clips", "clips.json"), JSON.stringify({ clips: [{ id: "swatch", dir: "swatch", count: 8, fps: 30 }] }));
    writeTreatment(out, stageTestTreatment(Object.keys(TIMBRES)[0], { fps: 60 }));
    return out;
  };

  it("shows the frame film time picks, hidden before the cue and held after the last frame, the same on a second capture", async (t) => {
    if (needsRender(t)) return;
    const { captureStageFrames } = await import(join(engine, "node", "stage.mjs"));
    const env = { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM };
    const frames = [54, 60, 70, 85, 100];
    const first = await captureStageFrames({ out: swatchRun(), frames, env });
    const second = await captureStageFrames({ out: swatchRun(), frames, env });
    const centre = (rgba) => [...rgba.subarray((450 * 1920 + 800) * 4, (450 * 1920 + 800) * 4 + 3)];
    const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) <= 3);
    assert.ok(near(centre(first.get(54)), [0, 0, 0]), `t = 0.9 s is before the cue: ${centre(first.get(54))}`);
    assert.ok(near(centre(first.get(60)), [20, 0, 0]), `t = 1.0 s is clip frame 1: ${centre(first.get(60))}`);
    assert.ok(near(centre(first.get(70)), [120, 0, 0]), `t = 1 + 5/30 s is clip frame 6: ${centre(first.get(70))}`);
    assert.ok(near(centre(first.get(85)), [160, 0, 0]), `t = 1.417 s, held after the last frame (8) ended at 1.267 s: ${centre(first.get(85))}`);
    assert.ok(near(centre(first.get(100)), [0, 0, 0]), `t = 1.667 s is past the hold: ${centre(first.get(100))}`);
    for (const f of frames) assert.ok(Buffer.from(first.get(f)).equals(Buffer.from(second.get(f))), `frame ${f} is identical in a fresh browser`);
  });

  it("a clip does not slip past the flash audit: a full-frame white/black clip fails MO-C-03 and withholds the film", (t) => {
    if (needsRender(t)) return;
    const out = join(temp("lit-clip-strobe-"), "out");
    mkdirSync(join(out, "stage", "clips", "strobe"), { recursive: true });
    cpSync(join(fixtures, "clip-strobe", "index.html"), join(out, "stage", "index.html"));
    for (let k = 1; k <= 6; k++) {
      const px = Buffer.alloc(8 * 6 * 4, k % 2 ? 255 : 0);
      px[3] = 0;
      for (let i = 7; i < px.length; i += 4) px[i] = 255;
      writeFileSync(join(out, "stage", "clips", "strobe", frameName(k)), encodePng(px, 8, 6, 4));
    }
    writeFileSync(join(out, "stage", "clips", "clips.json"), JSON.stringify({ clips: [{ id: "strobe", dir: "strobe", count: 6, fps: 30 }] }));
    writeTreatment(out, stageTestTreatment(Object.keys(TIMBRES)[0], { fps: 60 }));
    const r = spawnSync(process.execPath, [join(root, "plugins", "litclaude", "skills", "lit-typographic-motion", "scripts", "motion.mjs"), "stage", "--out", out, "--round", "2"], {
      encoding: "utf8", timeout: 600000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM, LITCLAUDE_MOTION_FOREGROUND: "1" },
    });
    assert.equal(r.status, 13, r.stdout + r.stderr);
    assert.match(readFileSync(join(out, "gate-report.txt"), "utf8"), /MO-C-03:\s+FAIL/u);
    assert.equal(existsSync(join(out, "film.mp4")), false, "a flash-audit FAIL withholds the film");
  });
});
