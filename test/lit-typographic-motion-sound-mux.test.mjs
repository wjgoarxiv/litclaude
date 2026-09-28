import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { shortTypeTreatment, stageTestTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skillRoot, "engine");
const motion = join(skillRoot, "scripts", "motion.mjs");
const runtime = await import(join(engine, "node", "runtime.mjs"));
const { findChrome } = await import(join(engine, "node", "chrome.mjs"));
const { TIMBRES, encodeWav } = await import(join(engine, "node", "sound.mjs"));
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
const FFPROBE = spawnSync("ffprobe", ["-version"]).status === 0;
const needsRender = (t) => {
  if (!WARM || !findChrome() || !FFPROBE) {
    t.skip("needs a pre-warmed motion runtime, Chrome and ffmpeg/ffprobe");
    return true;
  }
  return false;
};
const cli = (args, env = {}) => spawnSync(process.execPath, [motion, ...args], {
  encoding: "utf8", timeout: 600000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM ?? join(tmpdir(), "lit-no-runtime"), LITCLAUDE_MOTION_FOREGROUND: "1", ...env },
});
const streams = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,duration,bit_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(r.stdout);
};
const sine = (seconds, hz = 440) => {
  const n = Math.round(seconds * 48000);
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000);
  return encodeWav({ left, right: left, sampleRate: 48000 });
};
const BRIEF = { schema: "litclaude.motion-brief/v1", shots: [{ scene: "title-slam", text: "물은 낮은 곳으로 흘러" }, { scene: "end-card", text: "결국 바다가 된다" }] };

/** A type-path run: brief, treatment (4 s), and an optional supplied track in the output dir. */
function typeRun({ sound, track = null }) {
  const dir = temp("lit-sound-mux-");
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(dir, "brief.json"), JSON.stringify(BRIEF));
  if (track) writeFileSync(join(out, "track.wav"), track);
  writeTreatment(out, { ...shortTypeTreatment(TIMBRE), sound });
  return { brief: join(dir, "brief.json"), out };
}

describe("sound reaches the film on both paths (director brief 7)", () => {
  it("a supplied WAV is muxed on the type path while the audio-analysis tier is absent", (t) => {
    if (needsRender(t)) return;
    const { brief, out } = typeRun({ sound: { mode: "supplied", plan: "The user's own track.", file: "track.wav" }, track: sine(6) });
    const r = cli(["make", brief, "--out", out, "--round", "2"]);
    assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
    const film = existsSync(join(out, "film.mp4")) ? join(out, "film.mp4") : join(out, "withheld", "film.mp4");
    const info = streams(film);
    const audio = info.streams.find((s) => s.codec_type === "audio");
    assert.ok(audio, "an audio stream is in the film");
    assert.equal(audio.codec_name, "aac");
    const video = info.streams.find((s) => s.codec_type === "video");
    assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) <= 0.1, `audio ${audio.duration} vs video ${video.duration}`);
  });

  it("a supplied track shorter than the film is padded, never truncating the video", (t) => {
    if (needsRender(t)) return;
    const { brief, out } = typeRun({ sound: { mode: "supplied", plan: "The user's own short track.", file: "track.wav" }, track: sine(1.5) });
    const r = cli(["make", brief, "--out", out, "--round", "2"]);
    assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    const film = existsSync(join(out, "film.mp4")) ? join(out, "film.mp4") : join(out, "withheld", "film.mp4");
    const info = streams(film);
    const video = info.streams.find((s) => s.codec_type === "video");
    const audio = info.streams.find((s) => s.codec_type === "audio");
    assert.ok(Math.abs(Number(video.duration) - manifest.durationSec) <= 0.05, `video ${video.duration} vs ${manifest.durationSec}`);
    assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) <= 0.1, `audio ${audio.duration}`);
  });

  it("the generated bed is the type path's track by default, and the gate reports the sound rules", (t) => {
    if (needsRender(t)) return;
    const { brief, out } = typeRun({ sound: shortTypeTreatment(TIMBRE).sound });
    const r = cli(["make", brief, "--out", out, "--round", "2"]);
    assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
    const report = readFileSync(join(out, "gate-report.txt"), "utf8");
    for (const id of ["SOUND-STREAM", "SOUND-DURATION", "SOUND-PEAK", "SOUND-HEAD"]) assert.match(report, new RegExp(`${id}:\\s+PASS`, "u"), id);
    assert.ok(existsSync(join(out, "sound-cues.json")));
  });

  it("the stage path muxes the generated bed as AAC at 256k", (t) => {
    if (needsRender(t)) return;
    const out = join(temp("lit-sound-stage-"), "out");
    mkdirSync(out, { recursive: true });
    cpSync(join(root, "test", "fixtures", "lit-typographic-motion", "stage", "clock"), join(out, "stage"), { recursive: true });
    const treatment = stageTestTreatment(TIMBRE, { fps: 30, sound: { mode: "generated", plan: "Pulse with a hit on each cut.", palette: { timbre: TIMBRE, key: "C", mode: "major", tempo: 100 } } });
    treatment.channel = "A wall panel played with sound.";
    writeTreatment(out, treatment);
    const r = cli(["stage", "--out", out, "--round", "2"]);
    assert.ok([0, 13].includes(r.status), r.stdout + r.stderr);
    const info = streams(existsSync(join(out, "film.mp4")) ? join(out, "film.mp4") : join(out, "withheld", "film.mp4"));
    const audio = info.streams.find((s) => s.codec_type === "audio");
    assert.equal(audio?.codec_name, "aac");
    assert.ok(Math.abs(Number(audio.bit_rate) - 256000) <= 16000, `bit rate ${audio.bit_rate}`);
  });

  it("the sound subcommand builds the bed and its cues from the treatment, and says so for other modes", () => {
    const out = join(temp("lit-sound-cli-"), "out");
    writeTreatment(out, shortTypeTreatment(TIMBRE));
    const r = cli(["sound", "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /SOUND: generated bed/u);
    assert.ok(existsSync(join(out, "sound", "bed.wav")) && existsSync(join(out, "sound-cues.json")));
    const cues = JSON.parse(readFileSync(join(out, "sound-cues.json"), "utf8"));
    assert.ok(cues.cues.every((c) => "target" in c && "delta" in c));
    writeTreatment(out, { ...shortTypeTreatment(TIMBRE), channel: "A muted loop.", sound: { mode: "none", plan: "Silent." } });
    assert.match(cli(["sound", "--out", out]).stdout, /mode none; nothing to generate/u);
  });
});
