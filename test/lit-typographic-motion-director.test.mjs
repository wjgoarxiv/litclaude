import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stageTreatment, typeTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const motion = join(skillRoot, "scripts", "motion.mjs");
const engine = join(skillRoot, "engine");

const { validateTreatment, TreatmentError, typeLedCue, normalizeText } = await import(join(engine, "node", "treatment.mjs"));
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

const hook = (event, input, cwd = root) => {
  const r = spawnSync(process.execPath, [hookPath, event], { cwd, encoding: "utf8", input: JSON.stringify({ cwd, ...input }), env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
};
const contextFor = (prompt) => hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt }).hookSpecificOutput?.additionalContext ?? "";
const routed = (context) => /Activate LitClaude Skill\(lit-typographic-motion\)/u.test(context);

// Creation requests that name no film text, across genres (this product's own wording).
const NO_COPY = [
  ["event", "동네 합창단 겨울 음악회를 알리는 영상 만들어줘 lit"],
  ["explainer", "빗물이 어떻게 정원 물탱크로 모이는지 설명하는 영상 만들어줘 lit"],
  ["brand-mood", "create a moody brand video for a small tea roastery lit"],
  ["motion-graphics", "produce a motion graphics piece about ocean currents lit"],
  ["other", "산책로의 사계절을 담은 짧은 영상 제작해줘 lit"],
  ["announcement", "도서관 휴관 일정이 바뀐 것을 안내하는 영상 만들어줘 lit"],
  ["event", "render a short clip for a bakery's tenth anniversary weekend lit"],
];
// Requests led by the words themselves: a quoted span, kinetic type, a lyric video, a title sequence.
const TYPE_LED = [
  "\"바람이 불면 다시 걷자\" 이 문장으로 영상 만들어줘 lit",
  "make a kinetic type video out of this haiku lit",
  "새 앨범 가사 영상 하나 뽑아줘 lit",
  "produce a title sequence for the gallery opening lit",
  "「오늘도 무사히 돌아오기」 문구로 타이포 모션 제작해줘 lit",
  "make a video from the line “light keeps its own hours” lit",
];

// Every Wave 1 premise and mandate string that framed a film as type-only.
const RETIRED = [
  "the request asks for a kinetic-typography film",
  "kinetic-typography film",
  "with the bundled deterministic engine only",
  "not this skill's deliverable",
  "The engine is the required path",
  "Keep the user's words; shorten only to fit",
  "keep the user's words, output directory",
  "pick the preset with the auto-pick table",
  "Gate PASS: done",
  "Only a gate result counts",
  "HTML film is not a deliverable",
  "only the engine",
  "smallest set",
  "three strong shots",
  "lines cost length",
];

describe("lit-typographic-motion director route (real hook)", () => {
  it("routes no-copy creation requests in six or more genres to the skill with the neutral film context", () => {
    assert.ok(new Set(NO_COPY.map(([genre]) => genre)).size >= 6);
    for (const [, prompt] of NO_COPY) {
      const context = contextFor(prompt);
      assert.ok(routed(context), prompt);
      assert.match(context, /this is a film request/iu, prompt);
      assert.match(context, /treatment\.json/u, prompt);
      assert.doesNotMatch(context, /type-led cue found/u, `no cue for a no-copy request: ${prompt}`);
      for (const retired of RETIRED) assert.ok(!context.includes(retired), `${prompt}: ${retired}`);
    }
  });

  it("raises the type-led hint for kinetic type, lyric, title-sequence and quoted-words requests, and only then", () => {
    for (const prompt of TYPE_LED) {
      const context = contextFor(prompt);
      assert.ok(routed(context), prompt);
      assert.match(context, /type-led cue found: \S/u, prompt);
      assert.ok(typeLedCue(prompt), `the validator agrees: ${prompt}`);
    }
    for (const [, prompt] of NO_COPY) assert.equal(typeLedCue(prompt), null, prompt);
    // A single quoted word is not film text.
    assert.equal(typeLedCue("make a video about the word \"bloom\" lit"), null);
  });

  it("the film context is neutral: path rule, commands, no path asserted, prose within 700 bytes", () => {
    const context = contextFor("produce a motion graphics piece about ocean currents lit");
    const film = /<litclaude-film-context>\n([\s\S]*?)\n<\/litclaude-film-context>/u.exec(context);
    assert.ok(film, "the film context block is present");
    assert.ok(Buffer.byteLength(film[1], "utf8") <= 700, `${Buffer.byteLength(film[1], "utf8")} bytes of prose`);
    assert.match(film[1], /type path/u);
    assert.match(film[1], /stage path/u);
    assert.match(film[1], /9:16/u);
    assert.match(film[1], /[Hh]and-encoded films are not the deliverable/u);
    assert.doesNotMatch(film[1], /(?:film|request) (?:is|takes) the (?:type|stage) path/u, "the context never asserts which path applies");
    const cli = JSON.stringify(join(skillRoot, "scripts", "motion.mjs"));
    assert.equal(context.split(cli).length - 1, 1, "the installed script is named exactly once");
    for (const sub of ["stage", "make", "sound", "look", "gate"]) assert.match(context, new RegExp(`\\n\\$M ${sub}\\b`, "u"), sub);
    assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${Buffer.byteLength(context, "utf8")} bytes`);
    assert.match(context, /ask no questions/u);
  });

  it("no retired premise or mandate string is left on any shipped surface", () => {
    const surfaces = [
      join(root, "plugins", "litclaude", "bin", "litclaude-hook.js"),
      join(root, "plugins", "litclaude", "lib", "motion-render-gate.mjs"),
      join(root, "docs", "hooks.md"),
      join(root, "CHANGELOG.md"),
      join(skillRoot, "SKILL.md"),
      ...readdirSync(join(skillRoot, "references")).map((f) => join(skillRoot, "references", f)),
      join(skillRoot, "scripts", "motion.mjs"),
    ];
    for (const file of surfaces) {
      const text = readFileSync(file, "utf8");
      for (const retired of RETIRED) assert.ok(!text.includes(retired), `${file.slice(root.length + 1)}: ${retired}`);
    }
  });

  it("SKILL.md is a film director: treatment first, stage for films that show things, type for words alone", () => {
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    const description = /^description: (.*)$/mu.exec(skill)[1];
    assert.match(description, /director/iu);
    assert.match(description, /treatment/iu);
    assert.match(description, /stage/iu);
    // LitClaude skills are contract-first with no H1 (test/skills.test.mjs); the identity line opens the body.
    const identity = skill.slice(skill.indexOf("```\n", skill.indexOf("```yaml")) + 4).trim().split("\n")[0];
    assert.match(identity, /film director/u, "the identity line names the director");
    const procedure = skill.slice(skill.indexOf("## #contract.procedure"));
    const firstStep = /\n1\. ([^\n]*)/u.exec(procedure)[1];
    assert.match(firstStep, /references\/treatment\.md/u);
    assert.doesNotMatch(firstStep, /references\/(?!treatment\.md)/u, "the first step loads treatment.md only");
  });
});

describe("treatment validator (exit 16 with the field)", () => {
  const field = (treatment) => {
    try {
      validateTreatment(treatment);
      return null;
    } catch (error) {
      assert.ok(error instanceof TreatmentError, error.stack);
      return error.field;
    }
  };

  it("accepts the two valid treatments", () => {
    assert.equal(field(stageTreatment(TIMBRE)), null);
    assert.equal(field(typeTreatment(TIMBRE)), null);
  });

  it("names every missing field", () => {
    for (const key of ["request", "genre", "path", "pathReason", "idea", "audience", "channel", "format", "durationSec", "beats", "subject", "visualDevices", "typePlan", "palette", "sound", "copy", "ambition"]) {
      const t = stageTreatment(TIMBRE);
      delete t[key];
      assert.equal(field(t), key, key);
    }
    const t = stageTreatment(TIMBRE);
    delete t.inventions;
    assert.equal(field(t), "inventions");
  });

  it("rejects placeholder values", () => {
    assert.equal(field(stageTreatment(TIMBRE, { idea: "<one sentence>" })), "idea");
    const t = stageTreatment(TIMBRE);
    t.beats[2].onScreen = "<what is on screen>";
    assert.equal(field(t), "beats[2].onScreen");
    assert.equal(field(stageTreatment(TIMBRE, { durationSec: "<4–90>" })), "durationSec");
  });

  it("rejects a treatment copied from the shipped example (copiedExample)", async () => {
    const { shippedExamples } = await import(join(engine, "node", "treatment.mjs"));
    const example = shippedExamples()[0];
    assert.ok(example, "treatment.md ships a placeholder example");
    const t = stageTreatment(TIMBRE);
    const leaves = [["idea"], ["audience"], ["channel"], ["ambition"]];
    for (const [key] of leaves) t[key] = String(example[key]).replace(/[<>]/gu, "");
    t.beats.forEach((beat, i) => {
      const source = example.beats[i % example.beats.length];
      for (const k of ["purpose", "onScreen", "motion", "sound"]) beat[k] = String(source[k]).replace(/[<>]/gu, "");
    });
    assert.equal(field(t), "copiedExample");
  });

  it("rejects an idea or invented copy that restates the request", () => {
    assert.equal(field(stageTreatment(TIMBRE, { idea: "씨앗 도서관이 어떻게 운영되는지 보여 준다." })), "idea");
    const t = stageTreatment(TIMBRE);
    t.copy.lines = ["씨앗 도서관이 어떻게 운영되는지"];
    assert.equal(field(t), "copy.lines[0]");
  });

  it("rejects a user copy line that is not in the request", () => {
    const t = typeTreatment(TIMBRE);
    t.copy.lines = ["물은 낮은 곳으로 흘러", "바다는 결국 하늘이 된다"];
    assert.equal(field(t), "copy.lines[1]");
  });

  it("rejects a stage film with no subject device, or only texture kinds", () => {
    const noSubject = stageTreatment(TIMBRE);
    noSubject.visualDevices = noSubject.visualDevices.map((d) => (d.role === "subject" ? { ...d, role: "support" } : d));
    assert.equal(field(noSubject), "visualDevices");
    const texture = stageTreatment(TIMBRE);
    texture.visualDevices = [{ kind: "gradient", role: "texture", beats: [0, 1, 2, 3, 4] }, { kind: "particles", role: "texture", beats: [0, 1, 2, 3, 4] }];
    assert.equal(field(texture), "visualDevices");
    const shortSubject = stageTreatment(TIMBRE);
    shortSubject.visualDevices[0].beats = [0];
    assert.equal(field(shortSubject), "visualDevices", "the subject must cover half the film");
    const textureAsSubject = stageTreatment(TIMBRE);
    textureAsSubject.visualDevices[0] = { kind: "grid", role: "subject", beats: [0, 1, 2, 3, 4] };
    assert.equal(field(textureAsSubject), "visualDevices[0].role");
  });

  it("rejects the type path with no user copy and no cue, and the type path at 9:16", () => {
    const noCue = stageTreatment(TIMBRE, { path: "type", visualDevices: [] });
    assert.equal(field(noCue), "path");
    const portrait = typeTreatment(TIMBRE, { format: "9:16", formatReason: "A vertical story post." });
    assert.equal(field(portrait), "path");
  });

  it("rejects too few beats for the genre, a beat under 1.2 s, gaps and the announcement floor", () => {
    const few = stageTreatment(TIMBRE);
    few.beats = [{ ...few.beats[0], t1: 8 }, { ...few.beats[4], t0: 8 }, ];
    few.visualDevices = few.visualDevices.map((d) => ({ ...d, beats: d.beats.filter((b) => b < 2) }));
    assert.equal(field(few), "beats");
    const short = stageTreatment(TIMBRE);
    short.beats[1].t1 = 4;
    short.beats[2].t0 = 4;
    assert.equal(field(short), "beats[1]");
    const gap = stageTreatment(TIMBRE);
    gap.beats[2].t0 = 7;
    assert.equal(field(gap), "beats[2]");
    const brief = stageTreatment(TIMBRE, { genre: "announcement", durationSec: 8 });
    brief.beats = [0, 1.6, 3.2, 4.8, 6.4].map((t0, i) => ({ ...stageTreatment(TIMBRE).beats[i], t0, t1: i === 4 ? 8 : t0 + 1.6 }));
    assert.equal(field(brief), "durationSec", "announcement films have a 10 s floor unless the user asked for a length");
  });

  it("requires inventions to list the invented subject's name", () => {
    const t = stageTreatment(TIMBRE, { inventions: ["the repay-with-harvest rule"] });
    assert.equal(field(t), "inventions");
  });

  it("allows silence only when the user asked for it or the channel plays muted", () => {
    const silent = stageTreatment(TIMBRE, { sound: { mode: "none", plan: "No sound." } });
    assert.equal(field(silent), "sound.mode");
    const muted = stageTreatment(TIMBRE, { channel: "A muted autoplay loop on a station display.", sound: { mode: "none", plan: "No sound." } });
    assert.equal(field(muted), null);
  });

  it("normalizes with NFC, lowercase, no whitespace or punctuation", () => {
    assert.equal(normalizeText(" Hello,  World! 안녕 "), "helloworld안녕");
  });
});

describe("type path fixes (RC4, RC6, RC8)", () => {
  it("honours durationSec by scaling holds up, never below the reading floor", async () => {
    const { planFromBrief } = await import(join(engine, "node", "brief.mjs"));
    const brief = { shots: [{ scene: "title-slam", text: "물은 낮은 곳으로 흘러" }, { scene: "end-card", text: "결국 바다가 된다" }] };
    const natural = planFromBrief(brief);
    assert.ok(natural.durationSec < 10, `natural length ${natural.durationSec}`);
    const plan = planFromBrief(brief, { targetSec: 20 });
    assert.ok(plan.durationSec >= 20 - 0.05 && plan.durationSec <= 21, `${plan.durationSec}`);
    const floored = planFromBrief({ lines: ["하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열", "열하나 열둘 열셋 열넷 열다섯 열여섯 열일곱", "끝"] }, { targetSec: 4 });
    assert.ok(floored.durationSec > 4, "the reading floor wins over a short target");
    assert.ok(floored.warnings.some((w) => /longer than the treatment/u.test(w)), "and the plan says so");
  });

  it("lines only: the last line is the end card, so a two-line quote ends on its second clause", async () => {
    const { planFromBrief } = await import(join(engine, "node", "brief.mjs"));
    const scenes = (lines, title) => planFromBrief({ title, lines }).shots.map((s) => `${s.scene}:${s.text}`);
    assert.deepEqual(scenes(["첫 줄", "마지막 줄"]), ["title-slam:첫 줄", "end-card:마지막 줄"]);
    assert.deepEqual(scenes(["첫 줄", "가운데 두 줄", "마지막 줄"]), ["title-slam:첫 줄", "karaoke-line:가운데 두 줄", "end-card:마지막 줄"]);
    assert.deepEqual(scenes(["한 줄뿐"]), ["title-slam:한 줄뿐", "end-card:한 줄뿐"]);
  });

  it("never prints the brief title as an on-screen label unless it is the film's own name", async () => {
    const { planFromBrief } = await import(join(engine, "node", "brief.mjs"));
    assert.equal(planFromBrief({ title: "working title", lines: ["첫 줄", "끝"] }).label, "");
    assert.equal(planFromBrief({ title: "working title", label: "HARBOR", lines: ["첫 줄", "끝"] }).label, "HARBOR");
  });

  it("refuses an unrequested 01 / NN index on screen", async () => {
    const { planFromBrief } = await import(join(engine, "node", "brief.mjs"));
    const brief = { shots: [{ scene: "title-slam", text: "첫 장면", sub: "01 / 03" }, { scene: "end-card", text: "끝" }] };
    assert.throws(() => planFromBrief(brief, { treatment: typeTreatment(TIMBRE) }), (e) => e.field === "typePlan.index");
    const asked = typeTreatment(TIMBRE);
    asked.typePlan.index = true;
    assert.ok(planFromBrief(brief, { treatment: asked }).durationSec > 0);
  });

  it("labels an agent-chosen preset as the agent default", async () => {
    const { pickPreset } = await import(join(engine, "core", "presets.mjs"));
    assert.equal(pickPreset({ style: "tidal", text: "x", request: "잔잔한 문장으로 영상 만들어줘 lit" }).reason, "agent default");
    assert.equal(pickPreset({ style: "tidal", text: "x", request: "tidal 스타일로 영상 만들어줘 lit" }).reason, "user-specified");
    assert.match(pickPreset({ text: "잔잔한 새벽 바다", request: "" }).reason, /^agent default/u);
  });

  it("keeps the viewed count through a gate re-run", async () => {
    const { viewedCount } = await import(join(engine, "node", "look.mjs"));
    const dir = temp("lit-motion-viewed-");
    writeFileSync(join(dir, "look.json"), JSON.stringify({ rounds: [{ round: 1, viewed: ["a.png", "b.png"] }, { round: 2, viewed: ["a.png", "c.png", "d.png"] }] }));
    assert.equal(viewedCount(dir), 3, "the latest round's viewed frames");
    assert.equal(viewedCount(temp("lit-motion-viewed-empty-")), 0);
  });
});

describe("the treatment gates every render (CLI)", () => {
  const run = (args) => spawnSync(process.execPath, [motion, ...args], { encoding: "utf8", env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: join(tmpdir(), "lit-motion-no-runtime"), CHROME_PATH: "/nonexistent/chrome" }, timeout: 60000 });

  it("a missing treatment exits 16 on both paths, before the runtime or Chrome is touched", () => {
    const dir = temp("lit-motion-cli-");
    const brief = join(dir, "brief.json");
    writeFileSync(brief, JSON.stringify({ lines: ["첫 줄", "끝"] }));
    for (const args of [["make", brief, "--out", join(dir, "out")], ["make", brief, "--out", join(dir, "out"), "--stills-only"], ["stage", "--out", join(dir, "out")], ["stage", "--out", join(dir, "out"), "--stills-only"]]) {
      const r = run(args);
      assert.equal(r.status, 16, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /exit 16 BLOCKED_TREATMENT_INVALID/u);
      assert.match(r.stderr, /treatment\.json/u);
    }
  });

  it("a stage treatment given to the type renderer, or a type treatment given to the stage renderer, exits 16 on path", () => {
    const dir = temp("lit-motion-cli-path-");
    const out = join(dir, "out");
    writeTreatment(out, stageTreatment(TIMBRE));
    const brief = join(dir, "brief.json");
    writeFileSync(brief, JSON.stringify({ lines: ["첫 줄", "끝"] }));
    const r = run(["make", brief, "--out", out]);
    assert.equal(r.status, 16, r.stdout + r.stderr);
    assert.match(r.stderr, /\bpath\b/u);
    writeTreatment(out, typeTreatment(TIMBRE));
    const s = run(["stage", "--out", out]);
    assert.equal(s.status, 16, s.stdout + s.stderr);
    assert.match(s.stderr, /\bpath\b/u);
    assert.ok(existsSync(join(out, "treatment.json")));
  });
});
