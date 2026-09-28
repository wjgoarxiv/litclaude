import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const S = await import(join(root, "plugins", "litclaude", "skills", "lit-typographic-motion", "engine", "node", "sound.mjs"));

const which = (name) => {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const ffmpeg = which("ffmpeg");
const ffprobe = which("ffprobe");
const work = mkdtempSync(join(tmpdir(), "lit-motion-sound-"));
after(() => rmSync(work, { recursive: true, force: true }));

const BEATS = [
  { t0: 0, t1: 3, sound: "pad only" },
  { t0: 3, t1: 6, sound: "a hit on the cut" },
  { t0: 6, t1: 9, sound: "rise into the change" },
  { t0: 9, t1: 12, sound: "cadence to close" },
];
const treatment = (palette = {}, beats = BEATS) => ({
  request: "<one sentence>",
  durationSec: 12,
  beats,
  sound: { mode: "generated", plan: "<plan>", palette: { timbre: "soft-keys", key: "D", mode: "minor", tempo: 96, ...palette } },
});
const sha = (buf) => spawnSync("shasum", ["-a", "256"], { input: buf }).stdout.toString().split(" ")[0];
const ebur128 = (file) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return Number(/I:\s+(-?[\d.]+) LUFS/u.exec(summary)[1]);
};
const sineWav = (file, seconds, amp = 10 ** (-20 / 20)) => {
  const n = seconds * 48000;
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / 48000);
  writeFileSync(file, S.encodeWav({ left, right: left, sampleRate: 48000 }));
  return { left, right: left };
};
const film = (dir, name, audio, seconds) => {
  const out = join(dir, name);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=64x36:r=30:d=${seconds}`];
  if (audio) args.push("-i", audio);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac", "-b:a", "256k");
  args.push(out);
  const r = spawnSync(ffmpeg, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return out;
};

describe("lit-typographic-motion generated sound bed", () => {
  it("is deterministic: two builds give the same WAV bytes", () => {
    const a = S.writeBed({ treatment: treatment(), frameCount: 720, fps: 60, cutTimes: [3, 6, 9], dir: join(work, "a") });
    const b = S.writeBed({ treatment: treatment(), frameCount: 720, fps: 60, cutTimes: [3, 6, 9], dir: join(work, "b") });
    assert.equal(a.sha256, b.sha256);
    assert.equal(sha(readFileSync(a.file)), a.sha256);
    assert.equal(JSON.parse(readFileSync(join(work, "a", "sound-cues.json"), "utf8")).sha256, a.sha256);
  });

  it("has exactly round(frameCount x 48000 / fps) samples at 60 and 30 fps and odd counts", () => {
    for (const [frameCount, fps] of [[720, 60], [361, 30], [7, 60], [601, 60], [241, 30]]) {
      const bed = S.buildBed({ treatment: treatment(), frameCount, fps });
      assert.equal(bed.sampleCount, Math.round((frameCount * 48000) / fps));
      assert.equal(bed.left.length, bed.sampleCount);
      const wav = S.decodeWav(S.encodeWav({ left: bed.left, right: bed.right }));
      assert.equal(wav.channels[0].length, bed.sampleCount);
      assert.equal(wav.sampleRate, 48000);
    }
  });

  it("stays within its limits: peak <= -2 dBFS, -16 LUFS +/- 2, and no silent head", () => {
    for (const timbre of Object.keys(S.TIMBRES)) {
      const bed = S.buildBed({ treatment: treatment({ timbre }), frameCount: 720, fps: 60, cutTimes: [3, 6, 9] });
      assert.ok(bed.peakDbfs <= -2, `${timbre} peak ${bed.peakDbfs}`);
      assert.ok(Math.abs(bed.lufs + 16) <= 2, `${timbre} ${bed.lufs} LUFS`);
      assert.ok(S.rmsRuns([bed.left, bed.right], 48000) <= 1.5, `${timbre} silent head`);
      assert.equal(bed.loudnessMethod, "BS.1770-4");
    }
  });

  it("has at least three timbre palettes that sound different", () => {
    const names = Object.keys(S.TIMBRES);
    assert.ok(names.length >= 3);
    const hashes = new Set(names.map((timbre) => S.writeBed({ treatment: treatment({ timbre }), frameCount: 360, fps: 60, dir: join(work, `t-${timbre}`) }).sha256));
    assert.equal(hashes.size, names.length);
    assert.notEqual(
      S.writeBed({ treatment: treatment({ key: "F#" }), frameCount: 360, fps: 60, dir: join(work, "k1") }).sha256,
      S.writeBed({ treatment: treatment({ key: "Bb", tempo: 128 }), frameCount: 360, fps: 60, dir: join(work, "k2") }).sha256,
    );
  });

  it("rejects an unknown timbre, key, mode or tempo with the field name", () => {
    for (const [palette, field] of [[{ timbre: "<timbre>" }, "sound.palette.timbre"], [{ key: "H" }, "sound.palette.key"], [{ mode: "dorian" }, "sound.palette.mode"], [{ tempo: 300 }, "sound.palette.tempo"]]) {
      assert.throws(() => S.buildBed({ treatment: treatment(palette), frameCount: 60, fps: 60 }), (e) => e instanceof S.SoundError && e.field === field);
    }
  });

  it("puts accents only where a beat asks, and a hit on the cut within one frame", () => {
    const plain = BEATS.map((b) => ({ ...b, sound: "steady pad and pulse" }));
    assert.deepEqual(S.buildBed({ treatment: treatment({}, plain), frameCount: 720, fps: 60, cutTimes: [3, 6, 9] }).cues, []);
    assert.deepEqual(S.cueKindsFor("타격 후 고조, 마무리 종지"), ["hit", "rise", "cadence"]);
    assert.deepEqual(S.cueKindsFor(""), []);
    const cues = S.planCues({ beats: [{ t0: 0, t1: 2.9, sound: "" }, { t0: 2.95, t1: 6, sound: "hit on the cut" }], durationSec: 6, cutTimes: [3] });
    assert.equal(cues.length, 1);
    assert.equal(cues[0].kind, "hit");
    assert.ok(Math.abs(cues[0].t - 3) <= 1 / 60);
    const all = S.buildBed({ treatment: treatment(), frameCount: 720, fps: 60, cutTimes: [3, 6, 9] }).cues;
    assert.deepEqual(all.map((c) => c.kind), ["hit", "rise", "cadence"]);
    assert.equal(all.find((c) => c.kind === "rise").t, 9);
    for (const c of all) assert.ok(Math.abs(c.delta) <= 1 / 60);
  });
});

describe("lit-typographic-motion BS.1770-4 loudness in product code", () => {
  it("matches ffmpeg ebur128 within 0.5 LU on a bed and on a -20 dBFS 1 kHz sine", (t) => {
    if (!ffmpeg) return t.skip("ffmpeg not on PATH");
    const bed = S.writeBed({ treatment: treatment({ timbre: "glass" }), frameCount: 720, fps: 60, cutTimes: [3, 6, 9], dir: join(work, "lufs") });
    assert.ok(Math.abs(bed.lufs - ebur128(bed.file)) <= 0.5, `bed ${bed.lufs} vs ${ebur128(bed.file)}`);
    const sine = join(work, "sine.wav");
    const { left, right } = sineWav(sine, 5);
    const ours = S.integratedLoudness([left, right]);
    assert.ok(Math.abs(ours - ebur128(sine)) <= 0.5, `sine ${ours} vs ${ebur128(sine)}`);
    assert.equal(S.integratedLoudness([new Float32Array(48000), new Float32Array(48000)]), -Infinity);
  });
});

describe("lit-typographic-motion supplied tracks and the muxed-stream gate", () => {
  it("pads a short supplied track to the film and trims a long one, sample-exact, with a fade", (t) => {
    if (!ffmpeg) return t.skip("ffmpeg not on PATH");
    const short = join(work, "short.wav");
    sineWav(short, 2);
    const padded = S.prepareTrack({ ffmpeg, input: short, frameCount: 300, fps: 60, dir: join(work, "pad") });
    assert.equal(padded.action, "padded");
    const p = S.decodeWav(readFileSync(padded.file));
    assert.equal(p.channels[0].length, 5 * 48000);
    assert.equal(p.channels[0][2 * 48000 - 1], 0, "faded to zero at the source's end");
    assert.equal(p.channels[0][4 * 48000], 0, "padded with silence");
    const long = join(work, "long.wav");
    sineWav(long, 9);
    const trimmed = S.prepareTrack({ ffmpeg, input: long, frameCount: 300, fps: 60, dir: join(work, "trim") });
    assert.equal(trimmed.action, "trimmed");
    const tr = S.decodeWav(readFileSync(trimmed.file));
    assert.equal(tr.channels[0].length, 5 * 48000);
    assert.equal(tr.channels[0][5 * 48000 - 1], 0);
    assert.throws(() => S.prepareTrack({ ffmpeg, input: join(work, "missing.wav"), frameCount: 60, fps: 60, dir: work }), (e) => e.field === "sound.file");
    writeFileSync(join(work, "junk.wav"), "not audio");
    assert.throws(() => S.prepareTrack({ ffmpeg, input: join(work, "junk.wav"), frameCount: 60, fps: 60, dir: work }), (e) => e.field === "sound.file");
  });

  it("passes a muxed generated bed, and exits 20 for a missing stream or a silent generated head", (t) => {
    if (!ffmpeg) return t.skip("ffmpeg not on PATH");
    const dir = join(work, "mux");
    const bed = S.writeBed({ treatment: treatment(), frameCount: 150, fps: 30, cutTimes: [3], dir });
    const good = S.auditMuxed({ ffmpeg, ffprobe, film: film(dir, "good.mp4", bed.file, 5), videoDurationSec: 5, mode: "generated" });
    assert.equal(good.exitCode, null, JSON.stringify(good.rules));
    assert.ok(good.rules.every((r) => r.status === "PASS"), JSON.stringify(good.rules));

    const silent = S.auditMuxed({ ffmpeg, ffprobe, film: film(dir, "silent.mp4", null, 5), videoDurationSec: 5, mode: "generated" });
    assert.equal(silent.exitCode, 20);
    assert.equal(silent.rules.find((r) => r.id === "SOUND-STREAM").status, "FAIL");

    const lateL = new Float32Array(5 * 48000);
    for (let i = 2 * 48000; i < lateL.length; i++) lateL[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    const late = join(dir, "late.wav");
    writeFileSync(late, S.encodeWav({ left: lateL, right: lateL }));
    const lateFilm = film(dir, "late.mp4", late, 5);
    const gen = S.auditMuxed({ ffmpeg, ffprobe, film: lateFilm, videoDurationSec: 5, mode: "generated" });
    assert.equal(gen.exitCode, 20);
    assert.equal(gen.rules.find((r) => r.id === "SOUND-HEAD").status, "FAIL");
    const sup = S.auditMuxed({ ffmpeg, ffprobe, film: lateFilm, videoDurationSec: 5, mode: "supplied" });
    assert.equal(sup.exitCode, null);
    assert.equal(sup.rules.find((r) => r.id === "SOUND-HEAD").status, "WARN");

    assert.ok(S.auditMuxed({ ffmpeg, ffprobe, film: lateFilm, videoDurationSec: 5, mode: "none" }).rules.every((r) => r.status === "N/A"));
    const off = S.auditMuxed({ ffmpeg, ffprobe, film: lateFilm, videoDurationSec: 6, mode: "supplied" });
    assert.equal(off.rules.find((r) => r.id === "SOUND-DURATION").status, "FAIL");
  });
});
