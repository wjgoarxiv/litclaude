import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { WORDMARK, findClearSpot, markInk, markLogoBox } from "../plugins/litclaude/lib/mark.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skills = join(root, "plugins", "litclaude", "skills");
const work = () => mkdtempSync(join(tmpdir(), "litclaude-mark-visible-"));
const envFor = (dir, mode) => ({ ...process.env, LITCLAUDE_HOME: join(dir, "lit-home"), LITCLAUDE_MARK: mode });
const node = (dir, mode, args) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: envFor(dir, mode), timeout: 600_000 });
const onPath = (name) => !spawnSync(name, ["-version"], { encoding: "utf8" }).error;

describe("the shared wordmark", () => {
  it("names the approved text and takes its ink from the ground", () => {
    assert.equal(WORDMARK.text, "made with LitClaude");
    assert.deepEqual(markInk([255, 255, 255]), [71, 71, 71]);
    assert.deepEqual(markInk([10, 12, 20]), [186, 187, 189]);
  });

  it("reads the ground under a clear spot even when the inset is fractional", () => {
    const width = 400, height = 200, channels = 4;
    const pixels = new Uint8Array(width * height * channels);
    for (let o = 0; o < pixels.length; o += 4) pixels.set([10, 12, 20, 255], o);
    const spot = findClearSpot({ width, height, channels, pixels }, { boxW: 60.5, boxH: 13.3, inset: 12.5 });
    assert.deepEqual(spot.ground, [10, 12, 20]);
    assert.deepEqual(spot.ink, markInk([10, 12, 20]));
  });

  it("treats quiet ground stripes as clear but refuses a spot that would cover drawn type", () => {
    const width = 400, height = 200, channels = 4;
    const pixels = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(Math.floor(x / 20) % 2 ? [26, 38, 51, 255] : [12, 17, 24, 255], (y * width + x) * 4);
    const image = { width, height, channels, pixels };
    assert.ok(findClearSpot(image, { boxW: 60, boxH: 14, inset: 10 }));
    for (let y = 150; y < height; y++) for (let x = 0; x < width; x += 3) pixels.set([240, 240, 240, 255], (y * width + x) * 4);
    assert.equal(findClearSpot(image, { boxW: 60, boxH: 14, inset: 10 }), null);
  });

  it("puts the flame logo left of the text, centred on its x-height band", () => {
    const box = markLogoBox({ x: 100, y: 50, fontSize: 10, textWidth: 60 });
    assert.equal(box.size, WORDMARK.logoScale * 10);
    assert.equal(box.x, 100 - 60 - WORDMARK.logoGap * 10 - box.size);
    assert.equal(box.y, 50 - 3.6 - box.size / 2);
  });
});

// The lit-diagram-drawer and lit-schematic marks moved with those skills to the figures extras plugin.
describe("lit-typographic-motion cover: a static corner mark on every frame", () => {
  const motion = join(skills, "lit-typographic-motion", "scripts", "motion.mjs");
  const engine = join(skills, "lit-typographic-motion", "engine");
  it("on draws it outside the title box and the cover still reaches PASS+TARGET; meta draws none", async (t) => {
    const runtime = await import(join(engine, "node", "runtime.mjs"));
    const { findChrome } = await import(join(engine, "node", "chrome.mjs"));
    const { coverTreatment } = await import("./helpers/motion-treatment.mjs");
    const warm = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")]
      .filter(Boolean).find((dir) => runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready);
    if (!warm || !findChrome()) return t.skip("motion runtime or Chrome not available");
    if (!(onPath("img2webp") && onPath("dwebp")) && !onPath("gifski")) return t.skip("no cover encoder (libwebp or gifski) on PATH");
    const dir = work();
    try {
      const posters = {};
      for (const mode of ["on", "meta"]) {
        const out = join(dir, mode);
        mkdirSync(out, { recursive: true });
        cpSync(join(root, "test", "fixtures", "lit-typographic-motion", "cover", "good"), join(out, "cover"), { recursive: true });
        const treatment = coverTreatment();
        writeFileSync(join(out, "treatment.json"), `${JSON.stringify(treatment, null, 2)}\n`);
        const r = spawnSync(process.execPath, [motion, "cover", "--out", out, "--round", "1"], { encoding: "utf8", timeout: 600_000, env: { ...envFor(dir, mode), LITCLAUDE_MOTION_RUNTIME: warm, LITCLAUDE_MOTION_FOREGROUND: "1" } });
        assert.equal(r.status, 0, `${mode}: ${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /^COVER gate --strict: PASS\+TARGET$/mu, mode);
        const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
        posters[mode] = readFileSync(join(out, "poster.png"));
        if (mode === "on") {
          assert.equal(manifest.mark?.text, "made with LitClaude");
          const [pw, ph] = manifest.page;
          const [tx, ty, tw, th] = treatment.title.box;
          const m = manifest.mark;
          const overlaps = m.x < (tx + tw) * pw && m.x + m.w > tx * pw && m.y < (ty + th) * ph && m.y + m.fontSize * 1.4 > ty * ph;
          assert.ok(!overlaps, "the mark stays out of the title box");
          assert.ok(m.y > 0.72 * ph - 1, "the mark sits in the bottom quarter");
        } else assert.equal(manifest.mark, null);
      }
      assert.ok(!posters.on.equals(posters.meta), "the poster shows the mark in on");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("lit-typographic-motion films: a silent end card after the last beat", () => {
  const motion = join(skills, "lit-typographic-motion", "scripts", "motion.mjs");
  const engine = join(skills, "lit-typographic-motion", "engine");
  const setup = async (t) => {
    const runtime = await import(join(engine, "node", "runtime.mjs"));
    const { findChrome } = await import(join(engine, "node", "chrome.mjs"));
    const warm = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")]
      .filter(Boolean).find((dir) => runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready);
    if (!warm || !findChrome() || spawnSync("ffprobe", ["-version"]).status !== 0) { t.skip("needs a warm motion runtime, Chrome and ffprobe"); return null; }
    return warm;
  };
  const cli = (warm, dir, mode, args) => spawnSync(process.execPath, [motion, ...args], { encoding: "utf8", timeout: 600_000, env: { ...envFor(dir, mode), LITCLAUDE_MOTION_RUNTIME: warm, LITCLAUDE_MOTION_FOREGROUND: "1" } });
  const duration = (file, kind) => Number(spawnSync("ffprobe", ["-v", "error", "-select_streams", kind === "audio" ? "a:0" : "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim());
  const lastFrameSpread = (file) => {
    const raw = spawnSync("ffmpeg", ["-v", "error", "-sseof", "-0.1", "-i", file, "-frames:v", "1", "-vf", "scale=480:-2,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 }).stdout;
    let lo = 255, hi = 0;
    for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo;
  };
  // The type report writes "ID name: detail — STATUS" for some rules and the stage report "ID: STATUS — detail".
  const rule = (report, id) => {
    const line = report.split("\n").find((l) => l.trim().startsWith(`${id}:`) || l.trim().startsWith(`${id} `));
    return line ? /\b(PASS|FAIL|WARN|N\/A)\b/u.exec(line)?.[1] : undefined;
  };
  const film = (out) => (existsSync(join(out, "film.mp4")) ? join(out, "film.mp4") : join(out, "withheld", "film.mp4"));

  it("type path: on appends the card through the flash audit and END-CARD; off renders the film alone", async (t) => {
    const warm = await setup(t);
    if (!warm) return;
    const { shortTypeTreatment, writeTreatment } = await import("./helpers/motion-treatment.mjs");
    const { TIMBRES } = await import(join(engine, "node", "sound.mjs"));
    const dir = work();
    try {
      for (const mode of ["on", "off"]) {
        const out = join(dir, mode, "out");
        mkdirSync(out, { recursive: true });
        writeFileSync(join(dir, mode, "brief.json"), JSON.stringify({ schema: "litclaude.motion-brief/v1", shots: [{ scene: "title-slam", text: "물은 낮은 곳으로 흘러" }, { scene: "end-card", text: "결국 바다가 된다" }] }));
        writeTreatment(out, shortTypeTreatment(Object.keys(TIMBRES)[0]));
        const r = cli(warm, dir, mode, ["make", join(dir, mode, "brief.json"), "--out", out, "--round", "2"]);
        assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
        const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
        const report = readFileSync(join(out, "gate-report.txt"), "utf8");
        for (const id of ["MO-C-03", "MO-SH-04a", "SOUND-DURATION"]) assert.equal(rule(report, id), "PASS", `${mode} ${id}`);
        const video = duration(film(out), "video");
        assert.ok(Math.abs(video - manifest.durationSec) <= 0.05, `${mode}: video ${video} vs manifest ${manifest.durationSec}`);
        assert.ok(Math.abs(duration(film(out), "audio") - video) <= 0.1, `${mode}: audio follows the video`);
        if (mode === "on") {
          assert.deepEqual(manifest.endCard, { frames: Math.round(0.5 * manifest.fps), fade: manifest.endCard.fade, sec: manifest.endCard.frames / manifest.fps });
          assert.equal(rule(report, "END-CARD"), "PASS");
          assert.ok(lastFrameSpread(film(out)) > 40, "the last frame carries the wordmark");
        } else {
          assert.equal(manifest.endCard, null);
          assert.equal(rule(report, "END-CARD"), undefined);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("stage path: on keeps MO-C-12 on the film's own length and passes END-CARD; off renders the film alone", async (t) => {
    const warm = await setup(t);
    if (!warm) return;
    const { stageTestTreatment, writeTreatment } = await import("./helpers/motion-treatment.mjs");
    const { TIMBRES } = await import(join(engine, "node", "sound.mjs"));
    const dir = work();
    try {
      for (const mode of ["on", "off"]) {
        const out = join(dir, mode, "out");
        mkdirSync(out, { recursive: true });
        cpSync(join(root, "test", "fixtures", "lit-typographic-motion", "stage", "clock"), join(out, "stage"), { recursive: true });
        writeTreatment(out, stageTestTreatment(Object.keys(TIMBRES)[0], { fps: 30 }));
        const r = cli(warm, dir, mode, ["stage", "--out", out, "--round", "2"]);
        assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
        const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
        const report = readFileSync(join(out, "gate-report.txt"), "utf8");
        for (const id of ["MO-C-03", "MO-C-12", "DEAD-AIR", "FLAT-FRAME"]) assert.equal(rule(report, id), "PASS", `${mode} ${id}`);
        assert.equal(manifest.frameCount, 120, "the frame count stays the film's own");
        const video = duration(film(out), "video");
        assert.ok(Math.abs(video - manifest.durationSec) <= 0.05, `${mode}: video ${video} vs manifest ${manifest.durationSec}`);
        if (mode === "on") {
          assert.equal(manifest.endCard.frames, 15);
          assert.match(report, /MO-C-12:\s+PASS — [\d.]+ s \(\+0\.50 s end card\)/u);
          assert.equal(rule(report, "END-CARD"), "PASS");
          assert.ok(lastFrameSpread(film(out)) > 40, "the last frame carries the wordmark");
        } else {
          assert.equal(manifest.endCard, null);
          assert.equal(rule(report, "END-CARD"), undefined);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
