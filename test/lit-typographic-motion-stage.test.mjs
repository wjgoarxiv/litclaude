import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stageTestTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skillRoot, "engine");
const motion = join(skillRoot, "scripts", "motion.mjs");
const fixtures = join(root, "test", "fixtures", "lit-typographic-motion", "stage");
const runtime = await import(join(engine, "node", "runtime.mjs"));
const { findChrome } = await import(join(engine, "node", "chrome.mjs"));
const { TIMBRES } = await import(join(engine, "node", "sound.mjs"));
const TIMBRE = Object.keys(TIMBRES)[0];

const temps = [];
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function warmRuntime() {
  const candidates = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")].filter(Boolean);
  for (const dir of candidates) if (runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready) return dir;
  return null;
}
const WARM = warmRuntime();
const CHROME = findChrome();
const needsRender = (t) => {
  if (!WARM) {
    t.skip("motion runtime not pre-warmed; run: litclaude-ai motion-runtime install");
    return true;
  }
  if (!CHROME) {
    t.skip("Chrome not found");
    return true;
  }
  return false;
};

/** A run directory with the fixture page as its stage and a short stage treatment. */
function stageRun(fixture, opts = {}) {
  const out = join(temp(`lit-stage-${fixture}-`), "out");
  mkdirSync(out, { recursive: true });
  cpSync(join(fixtures, fixture), join(out, "stage"), { recursive: true });
  writeTreatment(out, stageTestTreatment(TIMBRE, opts));
  return out;
}
const cli = (args, env = {}) => spawnSync(process.execPath, [motion, ...args], {
  encoding: "utf8", timeout: 600000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM ?? join(tmpdir(), "lit-no-runtime"), LITCLAUDE_MOTION_FOREGROUND: "1", ...env },
});

describe("stage launch, serving and the static scan", () => {
  it("the stage launch carries the whole flag set and the keychain flags", async () => {
    const { launchArgs, stageFlags } = await import(join(engine, "node", "chrome.mjs"));
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
      const args = launchArgs("/tmp/p", stageFlags({ width: w, height: h }));
      for (const flag of ["--use-mock-keychain", "--password-store=basic", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-rasterization", "--disable-partial-raster",
        "--run-all-compositor-stages-before-draw", "--disable-checker-imaging", "--disable-new-content-rendering-timeout", "--disable-threaded-animation",
        "--disable-threaded-scrolling", "--disable-image-animation-resync", "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio",
        "--force-device-scale-factor=1", `--window-size=${w},${h}`, "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings",
        "--metrics-recording-only", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE lit.stage"]) {
        assert.ok(args.includes(flag), `${w}x${h}: ${flag}`);
      }
      assert.ok(!args.some((a) => a.startsWith("--deterministic-mode") || /metal|--use-gl=/u.test(a)), "no GPU rung and no headless-shell-only flag");
    }
  });

  it("the DevTools pipe reads each chunk once and keeps a multi-byte character split across chunks whole", async () => {
    const { Pipe } = await import(join(engine, "node", "chrome.mjs"));
    const { EventEmitter } = await import("node:events");
    const streams = [null, null, null, new EventEmitter(), new EventEmitter()];
    streams[3].write = () => true;
    const child = Object.assign(new EventEmitter(), { stdio: streams });
    const pipe = new Pipe(child);
    const got = [];
    pipe.on("Test.event", (params) => got.push(params.text));
    const message = Buffer.from(`${JSON.stringify({ method: "Test.event", params: { text: "가나다 slow" } })}\0`);
    const cut = message.indexOf(Buffer.from("나")) + 1;
    streams[4].emit("data", message.subarray(0, cut));
    streams[4].emit("data", Buffer.concat([message.subarray(cut), message]));
    assert.deepEqual(got, ["가나다 slow", "가나다 slow"]);
  });

  it("serves only the stage dir, the kit, the fonts CSS and the faces; refuses every other origin", async () => {
    const { stageRouter, STAGE_ORIGIN } = await import(join(engine, "node", "stage-serve.mjs"));
    const dir = temp("lit-stage-router-");
    const stage = join(dir, "stage");
    mkdirSync(stage);
    writeFileSync(join(stage, "index.html"), "<!doctype html>");
    writeFileSync(join(dir, "secret.txt"), "outside");
    symlinkSync(join(dir, "secret.txt"), join(stage, "leak.svg"));
    const router = stageRouter({ stageDir: stage, faces: [] });
    assert.equal(router.route(`${STAGE_ORIGIN}/index.html`).kind, "file");
    assert.equal(router.route(`${STAGE_ORIGIN}/lit/stage-kit.js`).kind, "file");
    assert.equal(router.route(`${STAGE_ORIGIN}/lit/fonts.css`).kind, "body");
    assert.equal(router.route(`${STAGE_ORIGIN}/leak.svg`).kind, "missing", "a symlink out of the stage dir is never served");
    assert.equal(router.route(`${STAGE_ORIGIN}/%2E%2E/secret.txt`).kind, "missing", "no traversal");
    assert.equal(router.route("https://cdn.example.test/lib.js").kind, "blocked");
    assert.equal(router.route("http://localhost/x").kind, "blocked");
    assert.equal(router.refused.length, 2);
  });

  it("the static scan: an escaping symlink, a forbidden element, an animated raster or a flipbook is exit 17; a URL, preconnect or socket is exit 19", async () => {
    const { scanStage } = await import(join(engine, "node", "stage-serve.mjs"));
    const { encodePng } = await import(join(engine, "node", "png.mjs"));
    const scan = (files, extra = () => {}) => {
      const dir = temp("lit-stage-scan-");
      const stage = join(dir, "stage");
      mkdirSync(stage);
      writeFileSync(join(stage, "index.html"), files["index.html"] ?? "<!doctype html><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
      for (const [name, body] of Object.entries(files)) if (name !== "index.html") writeFileSync(join(stage, name), body);
      extra(dir, stage);
      try {
        scanStage(stage);
        return 0;
      } catch (error) {
        return error.code;
      }
    };
    assert.equal(scan({}), 0, "the SVG namespace is not a URL");
    assert.equal(scan({ "index.html": "<video src=\"a.mp4\"></video>" }), 17);
    assert.equal(scan({ "a.js": "document.createElement('audio')" }), 17);
    assert.equal(scan({ "a.js": "const c = new AudioContext();" }), 17);
    assert.equal(scan({ "index.html": "<img src=\"https://example.test/x.png\">" }), 19);
    assert.equal(scan({ "index.html": "<img src=\"//example.test/x.png\">" }), 19);
    assert.equal(scan({ "a.css": "body { background: url(//example.test/x.png); }" }), 19);
    assert.equal(scan({ "index.html": "<link rel=\"preconnect\" href=\"/x\">" }), 19);
    assert.equal(scan({ "a.js": "const s = new WebSocket(address);" }), 19);
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([4, 0, 4, 0, 0, 0, 0]),
      ...[0, 1].map(() => Buffer.from([0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0, 2, 2, 0x44, 0x01, 0])), Buffer.from([0x3b])]);
    assert.equal(scan({ "a.gif": gif }), 17, "an animated GIF");
    const png = encodePng(Buffer.alloc(4 * 4 * 3, 90), 4, 4, 3);
    const flip = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.png`, png]));
    assert.equal(scan(flip), 17, "ten same-size rasters are a flipbook");
    assert.equal(scan(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}.png`, png]))), 0);
    assert.equal(scan({}, (dir, stage) => {
      writeFileSync(join(dir, "outside.png"), png);
      symlinkSync(join(dir, "outside.png"), join(stage, "in.png"));
    }), 17, "a symlink that escapes the stage dir");
  });

  it("a decoded capture of the wrong size is exit 17", async () => {
    const { analyzeChecked, FramePool } = await import(join(engine, "node", "stage-capture.mjs"));
    const { encodePng } = await import(join(engine, "node", "png.mjs"));
    const pool = new FramePool(1);
    try {
      await assert.rejects(analyzeChecked(pool, encodePng(Buffer.alloc(8 * 8 * 3), 8, 8, 3), 1920, 1080), (e) => e.code === 17 && /8x8/u.test(e.message));
    } finally {
      await pool.close();
    }
  });
});

describe("stage renders (real Chrome, virtual clock)", () => {
  it("GREEN: a clock-only page renders a 16:9 film whose determinism samples match a fresh replay", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("clock", { fps: 30 });
    const r = cli(["stage", "--out", out, "--round", "2"]);
    assert.notEqual(r.status, 18, r.stdout + r.stderr);
    assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
    const det = JSON.parse(readFileSync(join(out, ".run", "determinism.json"), "utf8"));
    assert.equal(det.status, "PASS");
    assert.ok(det.frames.length >= 8 && det.frames.length <= 16, `${det.frames.length} samples`);
    assert.ok(det.frames.some((f) => f.frame === 0) && det.frames.some((f) => f.frame === 119), "frame 0 and the last frame");
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.deepEqual([manifest.width, manifest.height, manifest.frameCount], [1920, 1080, 120]);
    assert.ok(manifest.timing.frameP50Ms > 0 && manifest.timing.frameP95Ms >= manifest.timing.frameP50Ms);
  });

  it("GREEN: blur, backdrop-filter, blend modes, shadows, an SVG blur, a canvas shadow and a WebGL shader are deterministic", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("effects", { fps: 30 });
    const r = cli(["stage", "--out", out, "--round", "2"]);
    assert.notEqual(r.status, 18, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, ".run", "determinism.json"), "utf8")).status, "PASS");
    assert.equal(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).usesWebGL, true);
  });

  it("GREEN: copy rising word by word (opacity and a translate on each word) matches a fresh replay", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("text-rise", { fps: 60, copy: ["Lanterns drift home", "Harbour bells at dusk"] });
    const r = cli(["stage", "--out", out, "--round", "2"]);
    assert.notEqual(r.status, 18, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, ".run", "determinism.json"), "utf8")).status, "PASS");
  });

  it("GREEN: a group that starts to fade while its glow breathes matches a replay that captured every frame as the master did", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("lamp-fade", { fps: 60 });
    const r = cli(["stage", "--out", out, "--round", "2"]);
    assert.notEqual(r.status, 18, r.stdout + r.stderr);
    const det = JSON.parse(readFileSync(join(out, ".run", "determinism.json"), "utf8"));
    assert.ok(det.frames.some((f) => f.frame === 120), "frame 120 (6 frames into the fade) is sampled");
    assert.equal(det.status, "PASS");
  });

  for (const [fixture, source] of [["red-timeorigin", "performance.timeOrigin"], ["red-crypto", "crypto.getRandomValues"]]) {
    it(`RED: a page painting ${source} exits 18 naming the frame and the region`, (t) => {
      if (needsRender(t)) return;
      const out = stageRun(fixture, { fps: 30 });
      const r = cli(["stage", "--out", out, "--round", "2"]);
      assert.equal(r.status, 18, r.stdout + r.stderr);
      assert.match(r.stdout, /STAGE_NONDETERMINISTIC: frame \d+ differs .*region \d+,\d+ \d+x\d+/u);
    });
  }

  it("a CSS transition started at t = 2 s shows the expected colour at t = 2.1 s", async (t) => {
    if (needsRender(t)) return;
    const { captureStageFrames } = await import(join(engine, "node", "stage.mjs"));
    const out = stageRun("transition");
    const frames = await captureStageFrames({ out, frames: [119, 120, 126, 180], env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM } });
    const px = (f) => [...frames.get(f).subarray((300 * 1920 + 300) * 4, (300 * 1920 + 300) * 4 + 3)];
    assert.deepEqual(px(119), [0, 0, 255]);
    const [r, g, b] = px(126);
    assert.ok(Math.abs(r - 25.5) <= 3 && g <= 2 && Math.abs(b - 229.5) <= 3, `t=2.1 s is 10 % into the transition: ${[r, g, b]}`);
    assert.deepEqual(px(180), [255, 0, 0], "finished at t = 3 s");
  });

  it("a WAAPI finished.then chain visibly continues", async (t) => {
    if (needsRender(t)) return;
    const { captureStageFrames } = await import(join(engine, "node", "stage.mjs"));
    const out = stageRun("waapi-chain");
    const frames = await captureStageFrames({ out, frames: [60, 150], env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM } });
    const leftEdge = (rgba) => {
      for (let x = 0; x < 1920; x++) if (rgba[(550 * 1920 + x) * 4 + 1] > 200 && rgba[(550 * 1920 + x) * 4] < 60) return x;
      return -1;
    };
    assert.ok(Math.abs(leftEdge(frames.get(60)) - 500) <= 16, `t = 1 s: the chained animation is halfway (${leftEdge(frames.get(60))})`);
    assert.equal(leftEdge(frames.get(150)), 900, "t = 2.5 s: finished and held");
  });

  it("a 1080x1920 kit film: ffprobe reports the portrait size and the flash grid and title-safe box are portrait", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("portrait", { format: "9:16", fps: 30 });
    const r = cli(["stage", "--out", out, "--round", "2"]);
    assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(existsSync(join(out, "film.mp4")) ? out : join(out, "withheld"), "film.mp4")], { encoding: "utf8" });
    assert.equal(probe.stdout.trim(), "1080,1920");
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.geometry.flashGrid, [180, 320]);
    assert.deepEqual(manifest.geometry.flashWindow, [60, 107]);
    assert.deepEqual(manifest.geometry.titleSafe, [54, 96, 1026, 1824]);
    assert.ok([960, 720, 540].includes(manifest.preview.rung.width), "the preview rung is keyed on the long edge");
  });

  it("stills-only writes the beat stills, one strip per cut, the sheet and the index, and no film", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("clock", { fps: 30 });
    const r = cli(["stage", "--out", out, "--round", "1", "--stills-only"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /record the round with look --round 1, make the change, then render the film with --round 2 \(no --stills-only\)/u, "the film is the next round");
    const index = JSON.parse(readFileSync(join(out, "stills", "index.json"), "utf8"));
    assert.equal(index.stillsOnly, true);
    assert.deepEqual(index.files.map((f) => f.kind).sort(), ["beat", "beat", "beat", "sheet", "strip", "strip"]);
    for (const f of index.files) assert.ok(existsSync(join(out, f.file)), f.file);
    assert.ok(!existsSync(join(out, "film.mp4")));
  });

  it("runtime violations: a computed AudioContext is exit 17, a computed request to another origin and a socket are exit 19", (t) => {
    if (needsRender(t)) return;
    const page = (body) => `<!doctype html><html><head><script src="/lit/stage-kit.js"></script></head><body><h1 id="c">Lanterns drift home</h1><script>
      LitStage.text(document.getElementById("c"));
      LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4, render(t) { if (t > 0.5 && !window.done) { window.done = true; ${body} } } });
    </script></body></html>`;
    for (const [body, code, pattern] of [
      ["try { new window['Audio' + 'Context'](); } catch {}", 17, /AudioContext/u],
      ["fetch(['ht', 'tp:', '//', 'example.test/x'].join('')).catch(() => {});", 19, /example\.test/u],
      ["try { new window['Web' + 'Socket']('w' + 's://example.test'); } catch {}", 19, /WebSocket/u],
      ["document.body.appendChild(document.createElement(['vid', 'eo'].join('')));", 17, /<video>/u],
    ]) {
      const out = join(temp("lit-stage-violation-"), "out");
      mkdirSync(join(out, "stage"), { recursive: true });
      writeFileSync(join(out, "stage", "index.html"), page(body));
      writeTreatment(out, stageTestTreatment(TIMBRE, { fps: 30 }));
      const r = cli(["stage", "--out", out, "--round", "1", "--stills-only"]);
      assert.equal(r.status, code, `${body}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr + r.stdout, pattern);
    }
  });

  it("a page that never defines the stage, or defines the wrong format, is exit 17", (t) => {
    if (needsRender(t)) return;
    for (const [html, opts, pattern] of [
      ["<!doctype html><h1>Lanterns drift home</h1>", {}, /never called LitStage\.define/u],
      [readFileSync(join(fixtures, "clock", "index.html"), "utf8"), { format: "9:16" }, /1920x1080, the 9:16 format is 1080x1920/u],
    ]) {
      const out = join(temp("lit-stage-contract-"), "out");
      mkdirSync(join(out, "stage"), { recursive: true });
      writeFileSync(join(out, "stage", "index.html"), html);
      writeTreatment(out, stageTestTreatment(TIMBRE, { fps: 30, ...opts }));
      const r = cli(["stage", "--out", out, "--round", "1", "--stills-only"]);
      assert.equal(r.status, 17, r.stdout + r.stderr);
      assert.match(r.stderr, pattern);
    }
  });

  it("failure paths: no Chrome is exit 10; no ffmpeg writes the stills and sheet, then exit 12", (t) => {
    if (needsRender(t)) return;
    const out = stageRun("clock", { fps: 30 });
    assert.equal(cli(["stage", "--out", out, "--round", "1", "--stills-only"], { CHROME_PATH: join(out, "no-chrome") }).status, 10);
    const nodeDir = resolve(process.execPath, "..");
    const r = cli(["stage", "--out", out, "--round", "2"], { PATH: `${nodeDir}:/usr/bin:/bin`, FFMPEG_PATH: "" });
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.ok(existsSync(join(out, "stills", "sheet.png")));
  });
});
