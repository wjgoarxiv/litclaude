import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { parseMotionCommand } from "../plugins/litclaude/lib/motion-render-gate.mjs";
import { bumpStillsRound, coverAnswers, fakeCoverRun as fakeCoverRunIn } from "./helpers/motion-cover.mjs";
import { coverTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const engine = join(skillRoot, "engine");
const motion = join(skillRoot, "scripts", "motion.mjs");
const fixtures = join(root, "test", "fixtures", "lit-typographic-motion", "cover");
const { COVER, EXIT } = await import(join(engine, "core", "constants.mjs"));
const { validateCoverTreatment } = await import(join(engine, "node", "cover-treatment.mjs"));
const { validateTreatment } = await import(join(engine, "node", "treatment.mjs"));
const { motionMetrics, resample, gifTiming, coverGate, formatCoverReport } = await import(join(engine, "node", "cover-gate.mjs"));
const { decodeWebp, parseWebp } = await import(join(engine, "node", "webp.mjs"));
const { img2webpArgs, frameAt, loopTimes } = await import(join(engine, "node", "cover.mjs"));
const { lanczosResize, lumaGrid } = await import(join(engine, "node", "cover-image.mjs"));
const { encodePng } = await import(join(engine, "node", "png.mjs"));
const { lookCommand } = await import(join(engine, "node", "look.mjs"));
const { evaluateDone } = await import(join(engine, "node", "done.mjs"));
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

describe("cover treatment (exit 16 names the field)", () => {
  it("accepts a cover treatment and derives the page, cover size and frame count", () => {
    const t = validateCoverTreatment(coverTreatment());
    assert.deepEqual(t.page, [1200, 600]);
    assert.deepEqual(t.out, [1000, 500]);
    assert.equal(t.frames, 96);
    assert.equal(t.encode.q, COVER.encode.q);
    assert.deepEqual(validateCoverTreatment(coverTreatment({ aspect: "3:2" })).out, [960, 640]);
  });

  it("refuses film fields, sound, invented taglines and out-of-range loops", () => {
    const bad = [
      [{ beats: [] }, "beats"], [{ copy: { source: "invented", lines: ["x"] } }, "copy"], [{ sound: { mode: "generated" } }, "sound"],
      [{ loopSec: 5 }, "loopSec"], [{ loopSec: 13 }, "loopSec"], [{ fps: 60 }, "fps"], [{ aspect: "16:9" }, "aspect"],
      [{ motto: { text: "Ship it before lunch", source: "user" } }, "motto.text"], [{ motto: { text: "Ship it", source: "project" } }, "motto.from"],
      [{ idea: "An animated cover for the top of the LOOPTEST readme." }, "idea"], [{ recipe: "slides" }, "recipe"],
      [{ title: { box: [0.5, 0.5, 0.6, 0.2], kind: "live" } }, "title.box"], [{ title: { box: [0.1, 0.1, 0.2, 0.2], kind: "drawn" } }, "title.kind"],
      [{ layers: { slow: "Bars drift.", mid: "A dot laps." } }, "layers.beat"],
    ];
    for (const [over, field] of bad) assert.throws(() => validateCoverTreatment(coverTreatment(over)), (e) => e.field === field, JSON.stringify(over));
    assert.equal(validateCoverTreatment(coverTreatment({ motto: { text: "Keep it lit", source: "project", from: "README.md" } })).motto.text, "Keep it lit");
  });

  it("a film render refuses a cover treatment and says how to render it", () => {
    assert.throws(() => validateTreatment(coverTreatment()), (e) => e.field === "mode" && /motion\.mjs cover/u.test(e.message));
  });
});

describe("loop kit and the cover init script", () => {
  const kit = readFileSync(join(engine, "stage", "loop-kit.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(kit, sandbox);
  const L = sandbox.LitLoop;

  it("every helper closes the loop: loop noise at t = 1 equals t = 0, events wrap", () => {
    const noise = L.makeNoise(5);
    for (const off of [0, 1.7, 9.3]) assert.ok(Math.abs(L.loopNoise(noise, 0, off) - L.loopNoise(noise, 1, off)) < 1e-9);
    assert.ok(Math.abs(L.swell(0) - L.swell(1)) < 1e-12);
    assert.equal(L.cdist(0.98, 0.02).toFixed(6), "0.040000");
    assert.equal(L.window(0.05, 0.9, 0.2).toFixed(6), "0.750000");
    assert.equal(L.window(0.5, 0.9, 0.2), -1);
    assert.equal(L.steps(0.5, 2), 0.5);
    const a = L.rng(42);
    const b = L.rng(42);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
    assert.equal(L.cubicPulse(0, 0.1, 0.2), 0);
    assert.equal(L.cubicPulse(0.3, 0.1, 0.3), 1);
  });

  it("the kit itself reads no clock and no unseeded entropy", () => {
    assert.doesNotMatch(kit.replace(/^\s*\/\/.*$/gmu, ""), /Math\.random\(|Date\.now\(|performance\.now\(|requestAnimationFrame\(/u);
  });

  it("the init script makes every clock and entropy source throw and records the call", () => {
    const init = readFileSync(join(engine, "stage", "cover-init.js"), "utf8");
    class Performance { now() { return 1; } }
    const ctx = { Math: Object.create(Math), Date, Performance, performance: new Performance(), crypto: { getRandomValues: () => 1 }, document: { documentElement: null, addEventListener() {} } };
    ctx.window = ctx;
    vm.runInNewContext(init, ctx);
    assert.throws(() => ctx.Math.random(), /Math\.random is forbidden/u);
    assert.throws(() => ctx.window.Date.now(), /Date\.now is forbidden/u);
    assert.throws(() => new ctx.window.Date(), /Date is forbidden/u);
    assert.equal(new ctx.window.Date(0).getTime(), 0, "a fixed date is still fine");
    assert.throws(() => ctx.performance.now(), /performance\.now is forbidden/u);
    assert.throws(() => ctx.window.requestAnimationFrame(() => {}), /requestAnimationFrame is forbidden/u);
    assert.throws(() => ctx.crypto.getRandomValues(), /getRandomValues is forbidden/u);
    assert.deepEqual(Array.from(ctx.__litCoverMisuse()), ["Math.random", "Date.now", "Date", "performance.now", "requestAnimationFrame", "crypto.getRandomValues"]);
  });
});

describe("cover gate metrics (fixed grid, the loop as a ring)", () => {
  const frame = (v, n = 16) => Float32Array.from({ length: n }, (_, i) => v + (i % 2));

  it("a still loop is all still: nothing moves, the longest still run is the whole loop", () => {
    const m = motionMetrics({ lumas: Array.from({ length: 96 }, () => frame(10)), delays: Array(96).fill(63) });
    assert.equal(m.movingFrac, 0);
    assert.ok(Math.abs(m.longestStillSec - 96 * 0.063) < 1e-9);
  });

  it("a steady drift is all moving with a seam like its neighbours; a reset is a seam spike", () => {
    // A travelling wave: every pixel changes on every step, and frame 95 leads into frame 0.
    const drift = Array.from({ length: 96 }, (_, i) => Float32Array.from({ length: 16 }, (_, k) => 100 + 60 * Math.sin(2 * Math.PI * (i / 96 + k / 16))));
    const m = motionMetrics({ lumas: drift, delays: Array(96).fill(63) });
    assert.equal(m.movingFrac, 1);
    assert.ok(m.seamLocal > 0.5 && m.seamLocal < 1.5, String(m.seamLocal));
    const sweep = Array.from({ length: 96 }, (_, i) => frame(i));
    const r = motionMetrics({ lumas: sweep, delays: Array(96).fill(63) });
    assert.ok(r.seamLocal > 50, String(r.seamLocal));
  });

  it("merged frames are resampled on the time grid, so a long frame reads as a hold", () => {
    const grid = resample(["a", "b", "c"], [100, 300, 100], 50);
    assert.deepEqual(grid, ["a", "a", "b", "b", "b", "b", "b", "b", "c", "c"]);
    const lumas = [frame(0), frame(80), frame(160)];
    const m = motionMetrics({ lumas, delays: [1000, 3000, 1000] });
    assert.ok(m.longestStillSec >= 2.9, String(m.longestStillSec));
  });

  it("the GIF fallback reads per-frame delays and the loop count from the container", () => {
    const head = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([4, 0, 4, 0, 0, 0, 0])]);
    const loop = Buffer.concat([Buffer.from([0x21, 0xff, 0x0b]), Buffer.from("NETSCAPE2.0", "latin1"), Buffer.from([3, 1, 0, 0, 0])]);
    const frameBytes = (cs) => Buffer.from([0x21, 0xf9, 4, 0, cs & 255, cs >> 8, 0, 0, 0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0x80, 0, 0, 0, 255, 255, 255, 2, 2, 0x4c, 0x01, 0]);
    const gif = Buffer.concat([head, loop, frameBytes(6), frameBytes(7), Buffer.from([0x3b])]);
    assert.deepEqual(gifTiming(gif), { delays: [60, 70], loop: 0, width: 4, height: 4 });
  });

  it("the report names every gate and the strict verdict", () => {
    const text = formatCoverReport({ pass: true, target: false, width: 1000, height: 500, format: "webp", sourceFrames: 128, sourceDurationSec: 8.064, bytes: 2_400_000, loop: 0, stepMs: 63, gates: { G1: { pass: true, target: false, bytes: 2_400_000 }, G2: { pass: true, target: true, medianD: 0.002 } } }, { strict: true });
    assert.match(text, /^COVER gate --strict: PASS\(floor\)$/mu);
    assert.match(text, /G1 pass\(floor\) bytes=2400000/u);
  });
});

describe("decoding the encoded cover (img2webp + dwebp)", () => {
  const tools = findImg2webp() && findDwebp();
  it("decodes every frame, its duration and the loop count, composited like a browser", (t) => {
    if (!tools) return t.skip("libwebp tools (img2webp, dwebp) not found");
    const dir = temp("lit-cover-webp-");
    const W = 64;
    const H = 32;
    const files = [];
    for (let i = 0; i < 6; i++) {
      const rgb = Buffer.alloc(W * H * 3, 20);
      for (let y = 8; y < 24; y++) for (let x = i * 8; x < i * 8 + 12; x++) rgb.fill(230, (y * W + x) * 3, (y * W + x) * 3 + 3);
      const f = join(dir, `f${i}.png`);
      writeFileSync(f, encodePng(rgb, W, H, 3));
      files.push(f);
    }
    const out = join(dir, "c.webp");
    const r = spawnSync(findImg2webp(), img2webpArgs({ files, fps: 16, encode: { q: 90, edgeQ: 97, edgeFrames: 2, method: 4 }, out }), { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const parsed = parseWebp(readFileSync(out));
    assert.equal(parsed.loop, 0);
    assert.deepEqual([parsed.width, parsed.height], [W, H]);
    const seen = [];
    const info = decodeWebp(out, { onFrame: (i, rgba) => {
      // The bright block's left edge moves 8 px per frame.
      const row = 16 * W * 4;
      let left = -1;
      for (let x = 0; x < W; x++) if (rgba[row + x * 4] > 128) { left = x; break; }
      seen.push(left);
    } });
    assert.equal(info.frames, 6);
    assert.deepEqual(info.durations, Array(6).fill(63));
    assert.deepEqual(seen, [0, 8, 16, 24, 32, 40]);
  });

  it("img2webp gets frame 0 and the last edge frames at the edge quality, each frame 63 ms at 16 fps", () => {
    const args = img2webpArgs({ files: ["a", "b", "c", "d"], fps: 16, encode: { q: 80, edgeQ: 97, edgeFrames: 1, method: 4 }, out: "o.webp" });
    assert.deepEqual(args.slice(0, 7), ["-loop", "0", "-lossy", "-q", "80", "-m", "4"]);
    const perFrame = [];
    for (let i = 7; i < args.length - 2; i += 5) perFrame.push(args.slice(i, i + 5).join(" "));
    assert.deepEqual(perFrame, ["-d 63 -q 97 a", "-d 63 -q 80 b", "-d 63 -q 80 c", "-d 63 -q 97 d"]);
    assert.doesNotMatch(args.join(" "), /-kmin|-kmax|mp4/u);
    assert.deepEqual(loopTimes(4), [[0, 0], [1, 0.25], [2, 0.5], [3, 0.75]]);
    assert.equal(frameAt([63, 126, 63], 100), 1);
  });

  it("the 2x capture is downsampled with Lanczos and the luma grid is about 300 px wide", () => {
    const src = Buffer.alloc(40 * 20 * 4, 255);
    const out = lanczosResize(src, 40, 20, 20, 10);
    assert.equal(out.length, 20 * 10 * 4);
    assert.ok(out.every((v) => v === 255));
    const g = lumaGrid(Buffer.alloc(1000 * 500 * 4), 1000, 500);
    assert.deepEqual([g.w, g.h], [333, 166]);
  });
});

const fakeCoverRun = (opts) => fakeCoverRunIn(temp("lit-cover-done-"), opts);

describe("cover look rounds and the cover done-check", () => {
  it("a cover round takes the eight cover questions, needs no stills-only round 1 and no weakest beat", () => {
    const out = fakeCoverRun();
    const file = join(out, "answers.json");
    writeFileSync(file, JSON.stringify(coverAnswers()));
    const r = lookCommand({ out, round: 1, answersFile: file });
    assert.equal(r.code, 0);
    assert.equal(r.record.mode, "cover");
    assert.deepEqual(r.record.revise, []);
    const nine = coverAnswers();
    nine.answers.push({ q: 9, verdict: "yes", frame: "stills/sheet.png", observed: "A ninth answer about the sheet that a cover does not ask for." });
    writeFileSync(file, JSON.stringify(nine));
    assert.throws(() => lookCommand({ out, round: 1, answersFile: file }), /unknown question 9/u);
  });

  it("damage, a slide read or a named designer change asks for another round", () => {
    const out = fakeCoverRun();
    const file = join(out, "answers.json");
    const doc = coverAnswers();
    doc.answers[6].verdict = "yes";
    doc.answers[7].verdict = "named";
    doc.answers[1].verdict = "no";
    writeFileSync(file, JSON.stringify(doc));
    assert.deepEqual(lookCommand({ out, round: 1, answersFile: file }).record.revise, [2, 7, 8]);
  });

  it("done needs TARGET on the last render and two rounds that viewed the sheet, poster and seam", () => {
    const out = fakeCoverRun();
    assert.equal(evaluateDone({ out }).status, "NOT_DONE");
    const file = join(out, "answers.json");
    writeFileSync(file, JSON.stringify(coverAnswers()));
    lookCommand({ out, round: 1, answersFile: file });
    assert.match(evaluateDone({ out }).reasons.join(" "), /only one look round/u);
    bumpStillsRound(out, 2);
    lookCommand({ out, round: 2, answersFile: file });
    const viewed = new Set(["sheet", "poster", "seam"].map((n) => join(out, "stills", `${n}.png`)));
    assert.equal(evaluateDone({ out, viewedFiles: viewed }).status, "DONE");
    writeFileSync(join(out, "gate-report.txt"), "COVER gate --strict: PASS(floor)\n");
    assert.match(evaluateDone({ out }).reasons.join(" "), /did not reach every TARGET gate/u);
  });

  it("a last round that skipped the seam pair is not done", () => {
    const out = fakeCoverRun();
    const file = join(out, "answers.json");
    writeFileSync(file, JSON.stringify(coverAnswers()));
    lookCommand({ out, round: 1, answersFile: file });
    bumpStillsRound(out, 2);
    writeFileSync(file, JSON.stringify(coverAnswers({ viewed: ["stills/sheet.png", "stills/poster.png"] })));
    lookCommand({ out, round: 2, answersFile: file });
    assert.match(evaluateDone({ out }).reasons.join(" "), /did not view stills\/seam\.png/u);
  });
});

describe("the Stop hook follows cover renders", () => {
  it("parses cover and cover-gate runs; only a render names the output directory", () => {
    assert.deepEqual(parseMotionCommand(`node "${motion}" cover --out motion-x --round 2`, "/w"), { mode: "cover", brief: null, out: "/w/motion-x", round: 2, stillsOnly: false });
    assert.equal(parseMotionCommand(`node "${motion}" cover-gate motion-x/cover.webp --strict`, "/w").out, null);
  });

  it("the hook names the cover command, and a missing cover encoder is a blocked exit", () => {
    const hook = readFileSync(join(root, "plugins", "litclaude", "bin", "litclaude-hook.js"), "utf8");
    assert.match(hook, /\n\$M cover --out <dir> --round <N>/u);
    assert.match(hook, /references\/cover\.md/u);
    assert.equal(EXIT.BLOCKED_NO_COVER_ENCODER, 21);
    assert.match(readFileSync(join(root, "plugins", "litclaude", "lib", "motion-render-gate.mjs"), "utf8"), /BLOCKED_EXITS = new Set\(\[10, 11, 12, 14, 15, 21/u);
  });
});

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
  const out = join(temp(`lit-cover-${fixture}-`), "out");
  mkdirSync(out, { recursive: true });
  cpSync(join(fixtures, fixture), join(out, "cover"), { recursive: true });
  writeFileSync(join(out, "treatment.json"), `${JSON.stringify(coverTreatment(over), null, 2)}\n`);
  return out;
}

describe("cover renders (real Chrome, img2webp and the decoded-file gate)", () => {
  it("GREEN: a loop with three speed layers reaches every TARGET gate on the decoded file", (t) => {
    if (needsRender(t)) return;
    const out = coverRun("good");
    const r = cli(["cover", "--out", out, "--round", "1"]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^COVER gate --strict: PASS\+TARGET$/mu);
    for (const f of ["cover.webp", "poster.png", "manifest.json", "gate-report.txt", "stills/sheet.png", "stills/seam.png", "stills/poster.png", "stills/frame-11.png", "stills/index.json"]) assert.ok(existsSync(join(out, f)), f);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.equal(manifest.mode, "cover");
    assert.equal(manifest.gate.gates.G0.identical, 96);
    assert.ok(manifest.gate.gates.G5.min >= 4.5);
    assert.equal(manifest.gate.gates.FLASH.pass, true);
    assert.equal(parseWebp(readFileSync(join(out, "cover.webp"))).loop, 0);
    const gate = cli(["cover-gate", join(out, "cover.webp"), "--strict"]);
    assert.equal(gate.status, 0, gate.stdout);
  });

  it("a page that reads Math.random is exit 18 naming the call; a page without renderFrame is exit 17", (t) => {
    if (needsRender(t)) return;
    const random = cli(["cover", "--out", coverRun("random"), "--round", "1"]);
    assert.equal(random.status, EXIT.STAGE_NONDETERMINISTIC, random.stdout + random.stderr);
    assert.match(random.stderr, /STAGE_NONDETERMINISTIC: the cover page called Math\.random/u);
    const none = cli(["cover", "--out", coverRun("no-render"), "--round", "1"]);
    assert.equal(none.status, EXIT.STAGE_CONTRACT_ERROR, none.stdout + none.stderr);
    assert.match(none.stderr, /defines no window\.renderFrame/u);
  });

  it("a film treatment cannot be rendered as a cover (exit 16)", (t) => {
    if (needsRender(t)) return;
    const out = coverRun("good");
    writeFileSync(join(out, "treatment.json"), JSON.stringify({ ...coverTreatment(), mode: undefined }));
    const r = cli(["cover", "--out", out]);
    assert.equal(r.status, EXIT.BLOCKED_TREATMENT_INVALID, r.stdout + r.stderr);
    assert.match(r.stderr, /mode: this treatment is a film/u);
  });
});

describe("the strict gate fails a cover over 2 MiB", () => {
  it("G1 passes the floor and misses TARGET between 2 and 3 MiB; --strict exits 13", (t) => {
    if (!(findImg2webp() && findDwebp())) return t.skip("libwebp tools not found");
    const dir = temp("lit-cover-heavy-");
    const W = 320;
    const H = 160;
    const files = [];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed >>> 24;
    };
    // Fresh noise every frame, 6 s at 16 fps: the bytes climb with quality past 2 MiB, under 3 MiB.
    for (let i = 0; i < 96; i++) {
      const rgb = Buffer.alloc(W * H * 3);
      for (let p = 0; p < rgb.length; p += 3) rgb[p] = rgb[p + 1] = rgb[p + 2] = rnd();
      const f = join(dir, `f${String(i).padStart(3, "0")}.png`);
      writeFileSync(f, encodePng(rgb, W, H, 3, { level: 1 }));
      files.push(f);
    }
    let picked = null;
    for (const q of [30, 40, 50, 60, 70]) {
      const out = join(dir, `q${q}.webp`);
      spawnSync(findImg2webp(), img2webpArgs({ files, fps: 16, encode: { q, edgeQ: q, edgeFrames: 0, method: 0 }, out }));
      const bytes = readFileSync(out).length;
      if (bytes > COVER.targetBytes && bytes <= COVER.maxBytes) {
        picked = out;
        break;
      }
    }
    if (!picked) return t.skip("could not land a noise cover between 2 and 3 MiB on this libwebp");
    const r = coverGate(picked);
    assert.equal(r.gates.G1.pass, true);
    assert.equal(r.gates.G1.target, false);
    assert.equal(r.target, false);
    const strict = cli(["cover-gate", picked, "--strict"]);
    assert.equal(strict.status, EXIT.GATE_FAIL_QA, strict.stdout);
    assert.match(strict.stdout, /G1 pass\(floor\)/u);
    assert.equal(r.pass, true, "every other gate passes the floor");
    assert.equal(cli(["cover-gate", picked]).status, 0, "without --strict the floor alone decides");
  });
});
