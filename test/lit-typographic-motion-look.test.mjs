import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stageTestTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skillRoot, "engine");
const motion = join(skillRoot, "scripts", "motion.mjs");
const { TIMBRES } = await import(join(engine, "node", "sound.mjs"));
const { encodePng } = await import(join(engine, "node", "png.mjs"));
const { lookCommand } = await import(join(engine, "node", "look.mjs"));
const { evaluateDone } = await import(join(engine, "node", "done.mjs"));
const { resolveViewed } = await import(join(engine, "node", "pipeline.mjs"));
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
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const png = (v) => encodePng(Buffer.alloc(8 * 8 * 3, v), 8, 8, 3);

/**
 * A synthetic finished run: treatment, a stills set (stills-only or full), and optionally the
 * manifest and gate report of a full render. Mirrors what the renderers write, without Chrome.
 */
function writeStillsSet(out, { round, stillsOnly, seed = 1 }) {
  mkdirSync(join(out, "stills"), { recursive: true });
  const files = [];
  const put = (name, kind, extra) => {
    const bytes = png(seed + files.length);
    writeFileSync(join(out, "stills", name), bytes);
    files.push({ file: `stills/${name}`, sha256: sha256(bytes), kind, ...extra });
  };
  put("beat-01.png", "beat", { beat: 0, frames: [20] });
  put("beat-02.png", "beat", { beat: 1, frames: [60] });
  put("beat-03.png", "beat", { beat: 2, frames: [100] });
  put("strip-01.png", "strip", { cut: 0, frames: [34, 40, 46] });
  put("strip-02.png", "strip", { cut: 1, frames: [74, 80, 86] });
  put("sheet.png", "sheet", { frames: [0, 119] });
  if (!stillsOnly) {
    const poster = png(200 + seed);
    writeFileSync(join(out, "poster.png"), poster);
    files.push({ file: "poster.png", sha256: sha256(poster), kind: "poster", frames: [60] });
  }
  writeFileSync(join(out, "stills", "index.json"), `${JSON.stringify({ schema: "litclaude.motion-stills/v1", path: "stage", round, stillsOnly, width: 1920, height: 1080, fps: 30, frameCount: 120, files }, null, 2)}\n`);
  return files.map((f) => f.file);
}
function finishRender(out, { pass = true } = {}) {
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ path: "stage", treatmentSha256: sha256(readFileSync(join(out, "treatment.json"))) }));
  writeFileSync(join(out, "gate-report.txt"), `lit-typographic-motion — stage render report\n\nQA gate: ${pass ? "PASS" : "FAIL"}\n`);
}
const ANSWERS = [
  { q: 1, verdict: "yes", by: "blind", sentence: "Neighbours who garden and want to borrow seeds.", frame: "stills/sheet.png", observed: "The sheet shows the packet moving from shelf to soil across the row." },
  { q: 2, verdict: "yes", frame: "stills/beat-01.png", observed: "Beat one shows the closed packet on the lending shelf with its stamp." },
  { q: 3, verdict: "yes", frame: "stills/strip-01.png", observed: "The strip shows a match cut from the shelf edge to the tote seam." },
  { q: 4, verdict: "no", frame: "stills/beat-02.png", observed: "Only the two copy lines are on screen, set large over the soil drawing." },
  { q: 5, verdict: "yes", frame: "stills/beat-03.png", observed: "The loop closes into the mark and holds on the last beat still." },
  { q: 6, verdict: "yes", frame: "stills/strip-02.png", observed: "The hit cue sits on the cut frame shown in the middle of the strip." },
  { q: 7, verdict: "none", frame: "stills/sheet.png", observed: "Shelf, soil, harvest and return all appear across the twelve frames." },
  { q: 8, verdict: "no", frame: "stills/beat-02.png", observed: "Every stem and furrow in the soil drawing belongs to the growing step." },
  { q: 9, verdict: "no", frame: "stills/beat-01.png", observed: "The copy names borrowing seeds and repaying with harvest, nothing generic." },
];
function answersFile(dir, extra = {}) {
  const file = join(dir, `answers-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ viewed: ["stills/sheet.png", "stills/beat-01.png", "stills/beat-02.png", "stills/beat-03.png", "stills/strip-01.png", "stills/strip-02.png"], answers: ANSWERS, ...extra }));
  return file;
}
function newRun() {
  const dir = temp("lit-look-");
  const out = join(dir, "out");
  writeTreatment(out, stageTestTreatment(TIMBRE, { fps: 30 }));
  mkdirSync(join(out, ".run"), { recursive: true });
  writeFileSync(join(out, ".run", "treatment.first.json"), readFileSync(join(out, "treatment.json")));
  return { dir, out };
}
/** Round 1 on a stills-only set, then a full render and round 2 on it: the full receipt. */
function fullReceipt() {
  const run = newRun();
  writeStillsSet(run.out, { round: 1, stillsOnly: true });
  lookCommand({ out: run.out, round: 1, answersFile: answersFile(run.dir, { weakestBeat: 1, change: "Slowed the soil wipe so the stems read before the cut." }) });
  writeStillsSet(run.out, { round: 2, stillsOnly: false, seed: 9 });
  finishRender(run.out);
  lookCommand({ out: run.out, round: 2, answersFile: answersFile(run.dir, { viewed: ["poster.png", "stills/sheet.png", "stills/beat-01.png", "stills/beat-02.png", "stills/beat-03.png", "stills/strip-01.png", "stills/strip-02.png"] }) });
  return run;
}
const refused = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error.message;
  }
};

describe("look rounds (director brief 9)", () => {
  it("refuses a frame outside the latest stills set, a bare yes or no, a missing question and a round 1 without a change", () => {
    const { dir, out } = newRun();
    writeStillsSet(out, { round: 1, stillsOnly: true });
    assert.match(refused(() => lookCommand({ out, round: 1, answersFile: answersFile(dir, { weakestBeat: 1, change: "Slowed the soil wipe down a lot.", viewed: ["stills/beat-09.png"] }) })), /not in the latest stills set/u);
    const bare = ANSWERS.map((a) => (a.q === 2 ? { ...a, observed: "yes" } : a));
    assert.match(refused(() => lookCommand({ out, round: 1, answersFile: answersFile(dir, { weakestBeat: 1, change: "Slowed the soil wipe down a lot.", answers: bare }) })), /question 2: observed/u);
    assert.match(refused(() => lookCommand({ out, round: 1, answersFile: answersFile(dir, { weakestBeat: 1, change: "Slowed the soil wipe down a lot.", answers: ANSWERS.slice(1) }) })), /questions 1 are not answered/u);
    assert.match(refused(() => lookCommand({ out, round: 1, answersFile: answersFile(dir) })), /weakest beat/u);
    const ok = lookCommand({ out, round: 1, answersFile: answersFile(dir, { weakestBeat: 1, change: "Slowed the soil wipe so the stems read." }) });
    assert.equal(ok.record.viewed.length, 6);
    assert.equal(ok.record.frames.length, 6);
    assert.ok(ok.record.frames.every((f) => /^[0-9a-f]{64}$/u.test(f.sha256)));
  });

  it("round 1 must look at a stills-only render; rounds only move forward", () => {
    const { dir, out } = newRun();
    writeStillsSet(out, { round: 1, stillsOnly: false });
    assert.match(refused(() => lookCommand({ out, round: 1, answersFile: answersFile(dir, { weakestBeat: 1, change: "Slowed the soil wipe down a lot." }) })), /always a stills round/u);
  });
});

describe("done-check (director brief 9)", () => {
  it("a full receipt is done", () => {
    const { out } = fullReceipt();
    const done = evaluateDone({ out });
    assert.equal(done.status, "DONE", done.reasons.join("; "));
    assert.deepEqual(done.downgraded, []);
  });

  it("gate PASS without a look is not done; one round is not done; a last round on an old manifest is not done", () => {
    const a = newRun();
    writeStillsSet(a.out, { round: 2, stillsOnly: false });
    finishRender(a.out);
    assert.match(evaluateDone({ out: a.out }).reasons.join(" "), /look\.json is missing/u);
    const b = newRun();
    writeStillsSet(b.out, { round: 1, stillsOnly: true });
    lookCommand({ out: b.out, round: 1, answersFile: answersFile(b.dir, { weakestBeat: 1, change: "Slowed the soil wipe so the stems read." }) });
    writeStillsSet(b.out, { round: 2, stillsOnly: false, seed: 4 });
    finishRender(b.out);
    assert.match(evaluateDone({ out: b.out }).reasons.join(" "), /only one look round/u);
    const c = fullReceipt();
    writeStillsSet(c.out, { round: 3, stillsOnly: false, seed: 30 });
    finishRender(c.out);
    assert.match(evaluateDone({ out: c.out }).reasons.join(" "), /before the final render/u);
  });

  it("frames listed as viewed must have been opened with the image tool when the host exposes tool events", () => {
    const { out } = fullReceipt();
    const opened = new Set(["poster.png", "stills/sheet.png", "stills/beat-01.png"].map((f) => join(out, f)));
    const done = evaluateDone({ out, viewedFiles: opened });
    assert.equal(done.status, "NOT_DONE");
    assert.match(done.reasons.join(" "), /never opened with the image tool: stills\/beat-02\.png/u);
  });

  it("records a downgrade: a shorter film, fewer subject beats, sound switched off, stage switched to type", () => {
    const { out } = fullReceipt();
    const first = JSON.parse(readFileSync(join(out, ".run", "treatment.first.json"), "utf8"));
    first.durationSec = 12;
    first.beats = [{ ...first.beats[0], t1: 4 }, { ...first.beats[1], t0: 4, t1: 8 }, { ...first.beats[2], t0: 8, t1: 12 }];
    first.visualDevices = [{ kind: "shape", role: "subject", beats: [0, 1, 2] }, { kind: "icon", role: "support", beats: [2] }];
    first.sound = { mode: "generated", plan: "A pulse.", palette: { timbre: TIMBRE, key: "C", mode: "major", tempo: 100 } };
    writeFileSync(join(out, ".run", "treatment.first.json"), JSON.stringify(first));
    const final = JSON.parse(readFileSync(join(out, "treatment.json"), "utf8"));
    final.visualDevices = [{ kind: "shape", role: "subject", beats: [0, 1] }, { kind: "icon", role: "support", beats: [2] }];
    writeFileSync(join(out, "treatment.json"), JSON.stringify(final));
    finishRender(out);
    const done = evaluateDone({ out });
    assert.equal(done.status, "DONE", done.reasons.join("; "));
    assert.equal(done.downgraded.length, 3, done.downgraded.join("; "));
    assert.match(done.downgraded.join(" "), /shortened from 12 s to 4 s/u);
    assert.match(done.downgraded.join(" "), /fewer beats/u);
    assert.match(done.downgraded.join(" "), /switched to none without a user request/u);
  });

  it("with no image tool reachable the film ends DONE_UNVIEWED", () => {
    const { dir, out } = newRun();
    writeStillsSet(out, { round: 1, stillsOnly: true });
    lookCommand({ out, round: 1, answersFile: answersFile(dir, { weakestBeat: 1, change: "Slowed the soil wipe so the stems read." }) });
    writeStillsSet(out, { round: 2, stillsOnly: false, seed: 5 });
    finishRender(out);
    const r = lookCommand({ out, round: 2, blocked: "no-vision-tool" });
    assert.match(r.message, /nobody viewed the frames/u);
    assert.equal(evaluateDone({ out }).status, "DONE_UNVIEWED");
  });

  it("viewed counts survive a gate re-run: the report takes them from look.json", () => {
    const { out } = fullReceipt();
    writeFileSync(join(out, "gate-report.txt"), "QA gate: PASS\nframes actually viewed this run: 0 (from look.json)\n");
    assert.equal(resolveViewed(out, 0), 7);
  });

  it("the look subcommand is a CLI surface with its own refusal exit", () => {
    const { dir, out } = newRun();
    writeStillsSet(out, { round: 1, stillsOnly: true });
    const r = spawnSync(process.execPath, [motion, "look", "--out", out, "--round", "1", "--answers", answersFile(dir)], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /LOOK_REFUSED: round 1 must name the weakest beat/u);
  });
});

describe("the Stop hook holds a film until it is done (LitClaude done-check surface)", () => {
  const hook = (event, input, cwd) => {
    const r = spawnSync(process.execPath, [hookPath, event], { cwd, encoding: "utf8", input: JSON.stringify({ cwd, ...input }), env: { ...process.env, NO_COLOR: "1" } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : {};
  };
  const cmd = (sub, out) => `node "${join(skillRoot, "scripts", "motion.mjs")}" ${sub} --out "${out}" --round 2`;
  const transcript = (project, files) => {
    const file = join(project, "transcript.jsonl");
    writeFileSync(file, files.map((f) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: f } }] } })).join("\n"));
    return file;
  };

  it("gate PASS with no look.json blocks on the first Stop with a named reason", () => {
    const project = temp("lit-stop-");
    writeFileSync(join(project, "package.json"), "{}");
    const out = join(project, "motion-film");
    writeTreatment(out, stageTestTreatment(TIMBRE, { fps: 30 }));
    writeStillsSet(out, { round: 2, stillsOnly: false });
    finishRender(out);
    const session = "stop-look";
    hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "produce a motion graphics piece about ocean currents lit", session_id: session }, project);
    hook("post-tool-use", { hook_event_name: "PostToolUse", session_id: session, tool_name: "Bash", tool_input: { command: cmd("stage", out) }, tool_response: { stdout: "OK: gate PASS\nexit 0 OK\n" } }, project);
    const stop = hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: transcript(project, []) }, project);
    assert.equal(stop.decision, "block");
    assert.match(stop.reason, /look\.json is missing/u);
  });

  it("a full receipt with every frame opened by Read passes; one unopened frame blocks", () => {
    const project = temp("lit-stop-done-");
    writeFileSync(join(project, "package.json"), "{}");
    const { out } = fullReceipt();
    const session = "stop-done";
    const files = ["poster.png", "stills/sheet.png", "stills/beat-01.png", "stills/beat-02.png", "stills/beat-03.png", "stills/strip-01.png", "stills/strip-02.png"].map((f) => join(out, f));
    hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "produce a motion graphics piece about ocean currents lit", session_id: session }, project);
    hook("post-tool-use", { hook_event_name: "PostToolUse", session_id: session, tool_name: "Bash", tool_input: { command: cmd("look", out) }, tool_response: { stdout: "LOOK round 2\nexit 0 OK\n" } }, project);
    const blocked = hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: transcript(project, files.slice(1)) }, project);
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason, /never opened with the image tool: poster\.png/u);
    assert.deepEqual(hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: transcript(project, files) }, project), {});
  });

  it("after the reminders run out, the hook tells the model to say the film is not done and why, once", () => {
    const project = temp("lit-stop-cap-");
    writeFileSync(join(project, "package.json"), "{}");
    const session = "stop-cap";
    hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "produce a motion graphics piece about ocean currents lit", session_id: session }, project);
    const t = transcript(project, []);
    assert.equal(hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: t }, project).decision, "block");
    assert.equal(hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: t }, project).decision, "block");
    const last = hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: t }, project);
    assert.equal(last.decision, "block");
    assert.match(last.reason, /say in the reply, in plain words, that the film is not done and why/u);
    assert.deepEqual(hook("stop", { hook_event_name: "Stop", session_id: session, transcript_path: t }, project), {});
  });
});
