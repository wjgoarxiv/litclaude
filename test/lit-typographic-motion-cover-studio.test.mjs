import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateMotionStop, observeMotionTool, recordMotionTurn } from "../plugins/litclaude/lib/motion-render-gate.mjs";
import { bumpStillsRound, coverAnswers, fakeCoverRun } from "./helpers/motion-cover.mjs";
import { coverTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skillRoot, "engine");
const motion = join(skillRoot, "scripts", "motion.mjs");
const fixtures = join(root, "test", "fixtures", "lit-typographic-motion", "cover");
const { COVER, EXIT } = await import(join(engine, "core", "constants.mjs"));
const { decodePng, encodePng } = await import(join(engine, "node", "png.mjs"));
const { lookCommand } = await import(join(engine, "node", "look.mjs"));
const { evaluateDone } = await import(join(engine, "node", "done.mjs"));
const { glyphHeights, coverGate } = await import(join(engine, "node", "cover-gate.mjs"));
const { artCheck } = await import(join(engine, "node", "cover-assets.mjs"));
const { encodeCover, loopTimes } = await import(join(engine, "node", "cover.mjs"));
const { CoverBrowser, CoverPool, capturePass } = await import(join(engine, "node", "cover-capture.mjs"));
const { validateCoverTreatment } = await import(join(engine, "node", "cover-treatment.mjs"));
const { stageFonts } = await import(join(engine, "node", "stage-serve.mjs"));
const runtime = await import(join(engine, "node", "runtime.mjs"));
const { findChrome } = await import(join(engine, "node", "chrome.mjs"));
const { findImg2webp } = await import(join(engine, "node", "encode.mjs"));
const { findDwebp } = await import(join(engine, "node", "webp.mjs"));

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

function warmRuntime() {
  const candidates = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")].filter(Boolean);
  for (const dir of candidates) if (runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready) return dir;
  return null;
}
const WARM = warmRuntime();
const needsRender = (t) => {
  if (!WARM) return t.skip("motion runtime not pre-warmed; run: litclaude-ai motion-runtime install") ?? true;
  if (!findChrome()) return t.skip("Chrome not found") ?? true;
  if (!(findImg2webp() && findDwebp())) return t.skip("libwebp tools not found") ?? true;
  return false;
};
const cli = (args, env = {}) => spawnSync(process.execPath, [motion, ...args], {
  encoding: "utf8", timeout: 600000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM ?? join(tmpdir(), "lit-no-runtime"), LITCLAUDE_MOTION_FOREGROUND: "1", ...env },
});
function coverRun(fixture, over = {}) {
  const out = join(temp(`lit-studio-${fixture}-`), "out");
  mkdirSync(out, { recursive: true });
  cpSync(join(fixtures, fixture), join(out, "cover"), { recursive: true });
  writeFileSync(join(out, "treatment.json"), `${JSON.stringify(coverTreatment(over), null, 2)}\n`);
  return out;
}
const answersFile = (out, doc) => {
  const file = join(out, "answers.json");
  writeFileSync(file, JSON.stringify(doc));
  return file;
};
const defect = (over = {}) => ({
  t: 1.2, region: [340, 10, 330, 50], frame: "stills/sheet.png",
  observed: "The glint turns the Y of the painted title into a solid red block on the second tile.",
  cause: "Colour-dodge blend saturates the coloured letters.", fix: "Run the glint in overlay blend.", ...over,
});

describe("TODO 1: cover defects carry a time, a region and a frame from the current stills (C001)", () => {
  it("records up to three well-formed defects with the round", () => {
    const out = fakeCoverRun(temp("lit-defects-"));
    const r = lookCommand({ out, round: 1, answersFile: answersFile(out, coverAnswers({ defects: [defect()] })) });
    assert.equal(r.record.defects.length, 1);
    assert.deepEqual(r.record.defects[0].region, [340, 10, 330, 50]);
    assert.equal(r.record.defects[0].t, 1.2);
  });

  it("refuses a defect with no time, a time outside the loop, a frame outside the stills set, a region off the cover, or a fourth defect", () => {
    const bad = [
      [{ t: undefined }, /defect 1: t must be the loop time in seconds/u],
      [{ t: 9 }, /defect 1: t must be the loop time in seconds \(0 to 6\.048\)/u],
      [{ frame: "stills/beat-01.png" }, /defect 1: frame "stills\/beat-01\.png" is not in the latest stills set/u],
      [{ region: [900, 400, 300, 200] }, /defect 1: region must be \[x, y, w, h\] inside the 1000x500 cover/u],
      [{ observed: "red" }, /defect 1: observed must be at least one sentence/u],
      [{ fix: "" }, /defect 1: cause and fix/u],
    ];
    for (const [over, message] of bad) {
      const out = fakeCoverRun(temp("lit-defects-bad-"));
      assert.throws(() => lookCommand({ out, round: 1, answersFile: answersFile(out, coverAnswers({ defects: [defect(over)] })) }), message, JSON.stringify(over));
    }
    const out = fakeCoverRun(temp("lit-defects-four-"));
    assert.throws(() => lookCommand({ out, round: 1, answersFile: answersFile(out, coverAnswers({ defects: [defect(), defect({ t: 2 }), defect({ t: 3 }), defect({ t: 4 })] })) }), /at most 3 defects per round/u);
  });

  it("a film round may not carry cover defects", () => {
    const out = fakeCoverRun(temp("lit-defects-film-"));
    const index = JSON.parse(readFileSync(join(out, "stills", "index.json"), "utf8"));
    writeFileSync(join(out, "stills", "index.json"), JSON.stringify({ ...index, mode: undefined, path: "stage", stillsOnly: true }));
    assert.throws(() => lookCommand({ out, round: 1, answersFile: answersFile(out, { ...coverAnswers({ defects: [defect()] }), weakestBeat: 0 }) }), /defects are a cover-mode record/u);
  });
});

describe("TODO 3: cover assets come from a checked list (C007, C008, C009)", () => {
  const painted = (over = {}) => coverTreatment({ recipe: "painted-light", recipeReason: "The painting carries the picture; the page relights it.", title: { box: [0.35, 0.03, 0.31, 0.09], kind: "painted" }, ...over });
  const art = () => {
    const W = 96;
    const H = 64;
    const rgb = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.fill(((x * 7) ^ (y * 13)) & 255, (y * W + x) * 3, (y * W + x) * 3 + 3);
    return { W, H, png: encodePng(rgb, W, H, 3) };
  };
  const paintedRun = ({ assets, writeArt = true, extra = null }) => {
    const out = join(temp("lit-assets-"), "out");
    mkdirSync(join(out, "cover", "assets"), { recursive: true });
    cpSync(join(fixtures, "good", "index.html"), join(out, "cover", "index.html"));
    const a = art();
    if (writeArt) writeFileSync(join(out, "cover", "assets", "base.png"), a.png);
    if (extra) writeFileSync(join(out, "cover", "assets", extra), a.png);
    writeFileSync(join(out, "treatment.json"), JSON.stringify(painted()));
    if (assets !== undefined) writeFileSync(join(out, "assets.json"), JSON.stringify(assets(sha256(a.png))));
    return out;
  };
  const listed = (hash) => ({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "user", sha256: hash, box: [0.125, 0, 0.75, 1] }] });

  it("C007: a listed asset that is missing is BLOCKED_ASSET_MISSING (exit 22) and no frame is written", () => {
    const out = paintedRun({ assets: listed, writeArt: false });
    const r = cli(["cover", "--out", out, "--round", "1"]);
    assert.equal(r.status, EXIT.BLOCKED_ASSET_MISSING, r.stdout + r.stderr);
    assert.match(r.stderr, /BLOCKED_ASSET_MISSING: cover\/assets\/base\.png is listed in assets\.json and missing; supply it, never draw a stand-in/u);
    assert.equal(existsSync(join(out, ".run", "cover", "frames")), false);
    assert.equal(existsSync(join(out, "cover.webp")), false);
  });

  it("the painted recipe without a listed base art is blocked; an unlisted raster or a changed file stops the run", () => {
    const none = paintedRun({ assets: undefined });
    const r = cli(["cover", "--out", none, "--round", "1"]);
    assert.equal(r.status, EXIT.BLOCKED_ASSET_MISSING, r.stderr);
    assert.match(r.stderr, /the painted-light recipe needs its base art listed in assets\.json/u);
    const unlisted = paintedRun({ assets: listed, extra: "logo.png" });
    const u = cli(["cover", "--out", unlisted, "--round", "1"]);
    assert.equal(u.status, EXIT.STAGE_CONTRACT_ERROR, u.stderr);
    assert.match(u.stderr, /cover\/assets\/logo\.png is a raster the page can load but assets\.json does not list/u);
    const changed = paintedRun({ assets: () => listed("0".repeat(64)) });
    const c = cli(["cover", "--out", changed, "--round", "1"]);
    assert.equal(c.status, EXIT.STAGE_CONTRACT_ERROR, c.stderr);
    assert.match(c.stderr, /cover\/assets\/base\.png does not match its sha256 in assets\.json/u);
  });

  it("C008: frame 0 must show the base art: SSIM of its check box against the source scaled into it", () => {
    const a = art();
    const W = 200;
    const H = 100;
    const box = [50, 10, 96, 64];
    const frame = Buffer.alloc(W * H * 4, 255);
    const src = Buffer.alloc(a.W * a.H * 4);
    for (let y = 0; y < a.H; y++) for (let x = 0; x < a.W; x++) {
      const v = ((x * 7) ^ (y * 13)) & 255;
      src.fill(v, (y * a.W + x) * 4, (y * a.W + x) * 4 + 3);
      src[(y * a.W + x) * 4 + 3] = 255;
      frame.fill(v, ((box[1] + y) * W + box[0] + x) * 4, ((box[1] + y) * W + box[0] + x) * 4 + 3);
    }
    const ok = artCheck({ frame0: frame, width: W, height: H, art: { rgba: src, width: a.W, height: a.H }, box: [box[0] / W, box[1] / H, box[2] / W, box[3] / H] });
    assert.ok(ok.pass && ok.ssim > 0.99, JSON.stringify(ok));
    const flat = Buffer.alloc(W * H * 4, 40);
    const bad = artCheck({ frame0: flat, width: W, height: H, art: { rgba: src, width: a.W, height: a.H }, box: [box[0] / W, box[1] / H, box[2] / W, box[3] / H] });
    assert.equal(bad.pass, false);
    assert.ok(bad.ssim < COVER.artSsim, String(bad.ssim));
  });

  it("C009: a generated base art is labelled in the finished-cover notice", async () => {
    const cwd = temp("lit-assets-stop-");
    const out = fakeCoverRun(join(cwd, "motion-cover"), { treatment: coverTreatment() });
    writeFileSync(join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "generated", sha256: "a".repeat(64), box: [0.125, 0, 0.75, 1] }] }));
    lookCommand({ out, round: 1, answersFile: answersFile(out, coverAnswers()) });
    bumpStillsRound(out, 2);
    lookCommand({ out, round: 2, answersFile: answersFile(out, coverAnswers()) });
    assert.deepEqual(evaluateDone({ out }).labels, ["the base art cover/assets/base.png is generated, not supplied: label it as generated in the reply"]);
    recordMotionTurn(cwd, { sessionId: "s1", discipline: "lit-typographic-motion" });
    observeMotionTool(cwd, { input: { session_id: "s1", cwd, tool_name: "Bash", tool_input: { command: `node "${motion}" cover --out ${out} --round 2` }, tool_response: { stdout: "exit 0 OK" } } });
    const transcript = join(cwd, "transcript.jsonl");
    writeFileSync(transcript, ["sheet", "poster", "seam"].map((n) => JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read", input: { file_path: join(out, "stills", `${n}.png`) } }] } })).join("\n"));
    const stop = await evaluateMotionStop({ cwd, sessionId: "s1", transcriptPath: transcript });
    assert.equal(stop.action, "block");
    assert.match(stop.reason, /is generated, not supplied: label it as generated in the reply/u);
  });
});

describe("TODO 5: the seek-order tolerance is the rasterizer's one level, nothing more", () => {
  it("a frame one level off passes, two levels off does not", async () => {
    const { maxLevelDiff, SEEK_LEVELS, seekOrder } = await import(join(engine, "node", "cover.mjs"));
    const dir = temp("lit-seek-");
    const frame = (v) => {
      const f = join(dir, `f${v}.png`);
      writeFileSync(f, encodePng(Buffer.alloc(16 * 8 * 3, v), 16, 8, 3));
      return f;
    };
    assert.equal(SEEK_LEVELS, 1);
    assert.equal(maxLevelDiff(frame(100), frame(101)), 1);
    assert.equal(maxLevelDiff(frame(100), frame(102)), 2);
    const order = seekOrder(96, 20261020);
    assert.equal(new Set(order).size, 16);
    assert.deepEqual(order, seekOrder(96, 20261020), "the shuffle is seeded");
    assert.notDeepEqual(order, [...order].sort((a, b) => a - b), "the order is not sequential");
  });
});

describe("the Stop hook speaks cover mode", () => {
  it("an unfinished cover turn points at references/cover.md, not the film loop", async () => {
    const cwd = temp("lit-cover-stop-");
    const out = fakeCoverRun(join(cwd, "motion-cover"));
    recordMotionTurn(cwd, { sessionId: "s2", discipline: "lit-typographic-motion" });
    observeMotionTool(cwd, { input: { session_id: "s2", cwd, tool_name: "Bash", tool_input: { command: `node "${motion}" cover --out ${out} --round 1` }, tool_response: { stdout: "exit 0 OK" } } });
    const stop = await evaluateMotionStop({ cwd, sessionId: "s2" });
    assert.equal(stop.action, "block");
    assert.match(stop.reason, /^lit-typographic-motion \(cover mode\) is not done: .*references\/cover\.md/u);
  });
});

/** Mask frames at the cover size: white letters `glyphPx` tall in the title box, on black. */
function masks(dir, { glyphPx, count = 4, width = 1000, height = 500 }) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let g = 0; g < 6; g++) {
      for (let y = 100; y < 100 + glyphPx; y++) for (let x = 120 + g * (glyphPx + 8); x < 120 + g * (glyphPx + 8) + Math.max(3, Math.round(glyphPx * 0.6)); x++) rgb.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
    writeFileSync(join(dir, `m${String(i).padStart(4, "0")}.png`), encodePng(rgb, width, height, 3));
  }
  return dir;
}

describe("TODO 4: G6, a glyph-height floor at the README display width (C010)", () => {
  const box = [0.1, 0.15, 0.8, 0.3];
  it("letters 13 px tall on a 1000 px cover are 10.8 px at 830 px: G6 fails", () => {
    const g = glyphHeights({ masksDir: masks(join(temp("lit-g6-small-"), "m"), { glyphPx: 13 }), box, displayWidth: 830 });
    assert.ok(Math.abs(g.capPx - 13 * 0.83) < 0.6, JSON.stringify(g));
    assert.equal(g.pass, false);
  });

  it("letters 60 px tall pass; a title painted into declared base art is exempt but still measured", () => {
    const dir = masks(join(temp("lit-g6-big-"), "m"), { glyphPx: 60 });
    const g = glyphHeights({ masksDir: dir, box, displayWidth: 830 });
    assert.equal(g.pass, true);
    assert.ok(g.capPx >= COVER.minGlyphPx);
    const exempt = glyphHeights({ masksDir: masks(join(temp("lit-g6-ex-"), "m"), { glyphPx: 13 }), box, displayWidth: 830, exempt: "painted into the base art cover/assets/base.png" });
    assert.equal(exempt.pass, null);
    assert.match(exempt.reason, /painted into the base art/u);
  });

  it("the gate carries G6 beside G5, never instead of it", () => {
    const report = readFileSync(join(engine, "node", "cover-gate.mjs"), "utf8");
    assert.match(report, /g\.G5 = /u);
    assert.match(report, /g\.G6 = /u);
  });
});

describe("TODO 6: each recipe keeps its page and an expected gate row", () => {
  it("every recipe has expected.json with the six numbers, inside TARGET and at most 2 MiB", () => {
    for (const name of ["painted-light", "weight-tide", "orbit-loop"]) {
      const row = JSON.parse(readFileSync(join(skillRoot, "recipes", name, "expected.json"), "utf8"));
      for (const k of ["medianD", "movingFrac", "longestStillSec", "spike", "seamLocal", "bytes"]) assert.equal(typeof row.row[k], "number", `${name}.${k}`);
      assert.ok(row.row.bytes <= COVER.targetBytes, name);
      assert.ok(row.row.seamLocal <= COVER.target.seamLocal && row.row.seamLocal >= COVER.target.seamLo, name);
      assert.doesNotThrow(() => validateCoverTreatment(row.treatment), name);
      assert.ok(existsSync(join(skillRoot, "recipes", name, "index.html")), name);
    }
    assert.equal(readdirSync(join(skillRoot, "recipes"), { recursive: true }).some((f) => /\.(webp|gif|mp4)$/u.test(String(f))), false, "no encoded cover ships");
  });

  it("the painted-light base is its own five-panel copy, not the README illustration", () => {
    const base = readFileSync(join(root, "test", "fixtures", "lit-typographic-motion", "cover", "painted-light-five-panel.png"));
    assert.equal(createHash("sha256").update(base).digest("hex"), "955ccd875bd0da509ba850b76a83ac7aa76f2ecc5c019bcb2d04043e8d46179e");
    assert.deepEqual([base.readUInt32BE(16), base.readUInt32BE(20)], [1536, 1024]);
    const page = readFileSync(join(skillRoot, "recipes", "painted-light", "index.html"), "utf8");
    const bays = /bays: (\[\[[^\n]*?\]\]),/u.exec(page)[1];
    assert.equal(JSON.parse(bays).length, 5, "the recipe's panel ranges describe the five-panel painting");
    const qa = readFileSync(join(root, "scripts", "qa-cover-recipes.mjs"), "utf8");
    assert.match(qa, /painted-light-five-panel\.png/u);
    assert.doesNotMatch(qa, /docs.{1,6}assets.{1,6}litfamily-machines/u, "the recipe QA must not follow the README illustration");
  });

  it("the recipe QA script is wired as npm run qa:cover-recipes", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts["qa:cover-recipes"], "node scripts/qa-cover-recipes.mjs");
    assert.ok(existsSync(join(root, "scripts", "qa-cover-recipes.mjs")));
  });
});

describe("the cover recipe QA proves a negative only by the gates it declares", () => {
  const qa = (args) => spawnSync(process.execPath, [join(root, "scripts", "qa-cover-recipes.mjs"), "--out", temp("lit-cover-qa-"), ...args], {
    encoding: "utf8", timeout: 120000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: join(tmpdir(), "lit-no-runtime"), LITCLAUDE_MOTION_PREWARM: "0" },
  });

  it("a crashed render never counts as a caught regression or negative", () => {
    const r = qa(["--feather", "150"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^FAIL +regression painted-light feather-150 +not proven: the render did not complete and gate the decoded file \(exit 14\)/mu);
    const n = qa(["--negatives"]);
    assert.equal(n.status, 1, n.stdout + n.stderr);
    for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) assert.match(n.stdout, new RegExp(`^FAIL +negative ${name} +not proven: the render did not complete`, "mu"));
    assert.match(n.stdout, /^FAIL +regression painted-light feather-150 +not proven/mu);
  });

  it("a regression nobody declared is a QA failure, not a caught defect", () => {
    const r = qa(["--feather", "200"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^FAIL +regression painted-light feather-200 +not proven: painted-light\/expected\.json declares no regression feather-200/mu);
  });

  it("the verdict needs a gated render and every declared gate failing; an undeclared FLOOR failure is not enough", async () => {
    const { judgeCase } = await import(join(root, "scripts", "qa-cover-recipes.mjs"));
    const gates = (over) => ({ G1: { pass: true, target: true }, G2: { pass: true, target: true }, G3: { pass: true, target: true }, G4: { pass: true, target: true }, ...over });
    const run = (status, g) => ({ status, manifest: g ? { gate: { gates: g } } : null });
    assert.equal(judgeCase(["G1.target"], run(14, null)).ok, false);
    assert.match(judgeCase(["G1.target"], run(14, null)).why, /did not complete/u);
    assert.equal(judgeCase(["G1.target"], run(1, gates({ G1: { pass: true, target: false } }))).ok, false, "a crash exit with a stale manifest");
    assert.match(judgeCase(["G1.target"], run(13, gates({ G4: { pass: true, target: false } }))).why, /G1\.target did not fail/u);
    assert.equal(judgeCase(["G1.target"], run(13, gates({ G1: { pass: true, target: false }, G4: { pass: true, target: false } }))).ok, true);
    assert.match(judgeCase(["G1.target"], run(13, gates({ G1: { pass: true, target: false }, G3: { pass: false, target: false } }))).why, /G3\.floor, which it does not declare/u);
    assert.equal(judgeCase(["G2.floor", "G3.floor"], run(13, gates({ G2: { pass: false, target: false } }))).ok, false);
    assert.equal(judgeCase(["G2.floor", "G3.floor"], run(13, gates({ G2: { pass: false, target: false }, G3: { pass: false, target: false } }))).ok, true);
    assert.match(judgeCase(["G5.floor"], run(13, gates({}))).why, /G5 was not measured/u);
    assert.match(judgeCase([], run(13, gates({}))).why, /declares no gate/u);
    assert.match(judgeCase(undefined, run(13, gates({}))).why, /declares no gate/u);
  });

  it("every negative and regression declares the gates it must fail", () => {
    for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
      const doc = JSON.parse(readFileSync(join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8"));
      assert.ok(doc.mustFail.length && doc.mustFail.every((id) => /^G[0-6]\.(floor|target)$/u.test(id)), name);
    }
    const reg = JSON.parse(readFileSync(join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).regressions["feather-150"];
    assert.deepEqual(reg.mustFail, ["G1.target"]);
    assert.match(reg.defect, /look review/u);
  });
});

/** Capture the master pass only, encode and gate the decoded file (the negatives and recipe rows). */
async function quickGate(stageDir, treatment) {
  const t = validateCoverTreatment(treatment);
  const work = temp("lit-quick-");
  const dir = join(work, "frames");
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM };
  const pool = new CoverPool();
  const browser = await CoverBrowser.open({ stageDir, faces: stageFonts(env), width: t.page[0], height: t.page[1], scale: COVER.captureScale, profileDir: join(work, "chrome"), env });
  try {
    await capturePass({ browser, pool, times: loopTimes(t.frames), dir, prefix: "f", width: t.out[0], height: t.out[1] });
  } finally {
    await browser.close();
    await pool.close();
  }
  const files = readdirSync(dir).sort().map((f) => join(dir, f));
  const { file } = encodeCover({ files, fps: t.fps, encode: t.encode, out: work, env });
  return coverGate(file, { env });
}

describe("TODO 7: the shipped slide-like negatives keep failing, the recipes keep passing (C016, C017)", () => {
  const negatives = join(skillRoot, "recipes", "negatives");
  for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
    it(`${name} fails exactly on its named gates`, async (t) => {
      if (needsRender(t)) return;
      const expected = JSON.parse(readFileSync(join(negatives, name, "expected.json"), "utf8"));
      const r = await quickGate(join(negatives, name), coverTreatment(expected.treatment));
      const failed = Object.entries(r.gates).filter(([, v]) => v.pass === false).map(([k]) => k).sort();
      assert.deepEqual(failed, expected.mustFail.map((id) => id.replace(/\.floor$/u, "")), JSON.stringify(Object.fromEntries(Object.entries(r.gates).map(([k, v]) => [k, v.pass]))));
    });
  }
  for (const name of ["weight-tide", "orbit-loop"]) {
    it(`${name} still reaches TARGET`, async (t) => {
      if (needsRender(t)) return;
      const expected = JSON.parse(readFileSync(join(skillRoot, "recipes", name, "expected.json"), "utf8"));
      const r = await quickGate(join(skillRoot, "recipes", name), expected.treatment);
      assert.equal(r.target, true, JSON.stringify({ medianD: r.medianD, seamLocal: r.seamLocal, bytes: r.bytes }));
    });
  }
});

describe("TODO 1 and 5 on real renders", () => {
  it("C002: a window render writes a sheet whose frames all lie inside [t0 - 0.5, t1 + 0.5] and never touches the delivered stills", (t) => {
    if (needsRender(t)) return;
    const out = coverRun("good");
    const r = cli(["cover", "--out", out, "--round", "1", "--window", "2.0,2.5"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const dir = join(out, "windows", "round-1", "2.000-2.500");
    const doc = JSON.parse(readFileSync(join(dir, "window.json"), "utf8"));
    assert.ok(doc.frames.length >= 8);
    for (const f of doc.frames) assert.ok(f.t >= 1.5 - 1e-9 && f.t <= 3.0 + 1e-9, String(f.t));
    assert.ok(existsSync(join(dir, "sheet.png")));
    assert.equal(existsSync(join(out, "stills")), false);
    assert.equal(existsSync(join(out, "gate-report.txt")), false);
    assert.match(r.stdout, /a window render never counts as done/u);
  });

  it("C013: a page that keeps state between frames fails the seek-order check, naming the frame time (exit 18)", (t) => {
    if (needsRender(t)) return;
    const r = cli(["cover", "--out", coverRun("trails"), "--round", "1"]);
    assert.equal(r.status, EXIT.STAGE_NONDETERMINISTIC, r.stdout + r.stderr);
    assert.match(r.stderr, /STAGE_NONDETERMINISTIC: frame \d+ \(t = \d\.\d{3} s\) differs when sought out of order/u);
  });

  it("C012: the test cover passes the seek-order check and the report says so", (t) => {
    if (needsRender(t)) return;
    const out = coverRun("good");
    const r = cli(["cover", "--out", out, "--round", "1"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(out, "gate-report.txt"), "utf8"), /^ {2}SEEK pass sampled=16 identical=16/mu);
    assert.match(readFileSync(join(out, "gate-report.txt"), "utf8"), /^ {2}G6 pass capPx=/mu);
  });
});

describe("the painted recipe lets any machine be the hero", () => {
  // A seven-bay painting as a flat grey plate: every lit pixel reads 128, every dimmed one less.
  const SEVEN = [[13, 217], [231, 435], [449, 653], [667, 872], [886, 1090], [1104, 1308], [1322, 1526]];
  const ANCHORS = {
    0: [{ cx: 68, cy: 385, rx: 20, ry: 7, k: 0 }, { cx: 97, cy: 373, rx: 16, ry: 7, k: 1 }, { cx: 61, cy: 689, rx: 32, ry: 32, k: 2 }],
    3: [{ cx: 720, cy: 350, rx: 16, ry: 16, k: 0 }, { cx: 712, cy: 436, rx: 8, ry: 14, k: 1 }, { cx: 694, cy: 680, rx: 16, ry: 28, k: 2 }],
  };
  const SCALE = 0.5859375;
  function heroStage(hero, lights) {
    const dir = temp("lit-hero-");
    const html = readFileSync(join(skillRoot, "recipes", "painted-light", "index.html"), "utf8");
    const art = { src: "assets/base.png", width: 1536, height: 1024, bays: SEVEN, top: 148, bottom: 945, hero, title: { box: [455, 32, 635, 88], gain: 1, maskLevel: 60 }, lights, flare: { cx: 902, cy: 987, rx: 60, ry: 22 } };
    const page = html.replace(/^const ART = \{[\s\S]*?^\};$/mu, `const ART = ${JSON.stringify(art)};`);
    assert.notEqual(page, html, "the recipe keeps one `const ART = { ... };` block");
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "index.html"), page);
    writeFileSync(join(dir, "assets", "base.png"), encodePng(Buffer.alloc(1536 * 1024 * 3, 128), 1536, 1024, 3));
    return dir;
  }
  const open = (stageDir) => {
    const env = { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM };
    return CoverBrowser.open({ stageDir, faces: stageFonts(env), width: 1200, height: 600, scale: COVER.captureScale, profileDir: join(temp("lit-hero-chrome-"), "p"), env });
  };
  /** Mean luminance of one bay (inset 40 art px) in a device-scale capture of the 1200x600 page. */
  const bayLuma = (png, [x0, x1]) => {
    const { width, channels, pixels } = decodePng(png);
    const s = width / 1200;
    const X0 = Math.round((150 + (x0 + 40) * SCALE) * s), X1 = Math.round((150 + (x1 - 40) * SCALE) * s);
    const Y0 = Math.round((148 + 40) * SCALE * s), Y1 = Math.round((945 - 40) * SCALE * s);
    let sum = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const o = (y * width + x) * channels;
      sum += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
    }
    return sum / ((X1 - X0) * (Y1 - Y0));
  };

  it("a middle hero (bay 3 of 7) stays as bright as the source at frame 0 while a sleeping bay is dimmed", async (t) => {
    if (needsRender(t)) return;
    const browser = await open(heroStage(3, ANCHORS));
    try {
      await browser.frame(0);
      const png = await browser.capture();
      const hero = bayLuma(png, SEVEN[3]), sleeper = bayLuma(png, SEVEN[5]);
      assert.ok(hero >= 0.95 * 128, `hero bay luminance ${hero.toFixed(1)} against source 128`);
      assert.ok(sleeper < 0.6 * 128, `sleeping bay luminance ${sleeper.toFixed(1)} should sit under the dim pool`);
    } finally {
      await browser.close();
    }
  });

  it("the beat lights glow on the hero's own anchors, never on another machine", async (t) => {
    if (needsRender(t)) return;
    for (const hero of [0, 3]) {
      const browser = await open(heroStage(hero, ANCHORS));
      try {
        const halos = await browser.evaluate('[...document.querySelectorAll("#halos ellipse")].map((e) => [+e.getAttribute("cx"), +e.getAttribute("cy")])');
        assert.deepEqual(halos, ANCHORS[hero].map((l) => [l.cx, l.cy]), `hero ${hero}`);
        for (const [cx] of halos) assert.ok(cx >= SEVEN[hero][0] && cx <= SEVEN[hero][1], `hero ${hero}: halo at x ${cx} lies outside its bay`);
      } finally {
        await browser.close();
      }
    }
  });

  it("a hero declared with no lights (an empty list) runs without beat lights", async (t) => {
    if (needsRender(t)) return;
    const browser = await open(heroStage(5, { ...ANCHORS, 5: [] }));
    try {
      assert.equal(await browser.evaluate('document.querySelectorAll("#halos ellipse").length'), 0);
      await browser.frame(0.25);
    } finally {
      await browser.close();
    }
  });

  it("a hero with no light entry stops the page with a message naming the bay, instead of borrowing another machine's lights", async (t) => {
    if (needsRender(t)) return;
    const started = Date.now();
    await assert.rejects(open(heroStage(5, ANCHORS)), /STAGE_CONTRACT_ERROR: .*first page error: Error: ART\.lights has no entry for the hero bay 5/u);
    // The page reported the error at once; the render must not sit out the 60 s ready wait first.
    assert.ok(Date.now() - started < 20000, `the contract error took ${Date.now() - started} ms to surface`);
  });
});
