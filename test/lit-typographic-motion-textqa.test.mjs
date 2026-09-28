import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function warmRuntime() {
  const candidates = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")].filter(Boolean);
  for (const dir of candidates) if (runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready) return dir;
  return null;
}
const WARM = warmRuntime();
const needsRender = (t) => {
  if (!WARM || !findChrome()) {
    t.skip("needs a pre-warmed motion runtime and Chrome");
    return true;
  }
  return false;
};
const render = (fixture, copy, opts = {}) => {
  const dir = mkdtempSync(join(tmpdir(), `lit-textqa-${fixture}-`));
  temps.push(dir);
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  cpSync(join(fixtures, fixture), join(out, "stage"), { recursive: true });
  writeTreatment(out, stageTestTreatment(TIMBRE, { fps: 30, copy, ...opts }));
  const r = spawnSync(process.execPath, [motion, "stage", "--out", out, "--round", "2"], { encoding: "utf8", timeout: 600000, env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM, LITCLAUDE_MOTION_FOREGROUND: "1" } });
  const report = (() => {
    try {
      return readFileSync(join(out, "gate-report.txt"), "utf8");
    } catch {
      return "";
    }
  })();
  const rule = (id) => new RegExp(`^  ${id}:\\s+(PASS|FAIL|WARN|N/A) — (.*)$`, "mu").exec(report) ?? [null, "missing", ""];
  return { r, out, report, rule };
};

describe("stage DOM text QA (director brief 6g, real replay)", () => {
  it("FAIL: low-contrast copy, copy outside title-safe and copy shown under its reading floor; decor is exempt or a warning", (t) => {
    if (needsRender(t)) return;
    const { r, rule } = render("qa-fail", ["Quiet lanterns wait", "The edge line runs long", "A line gone too soon"]);
    assert.equal(r.status, 13, r.stdout + r.stderr);
    const [, contrast, contrastDetail] = rule("TEXT-CONTRAST");
    assert.equal(contrast, "FAIL");
    assert.match(contrastDetail, /Quiet lanterns wait/u);
    assert.doesNotMatch(contrastDetail, /SHELF 4/u, "decor contrast is never a FAIL");
    const [, safe, safeDetail] = rule("TEXT-TITLE-SAFE");
    assert.equal(safe, "FAIL");
    assert.match(safeDetail, /The edge line runs long/u);
    assert.doesNotMatch(safeDetail, /ROW 12/u, "decor is exempt from title-safe");
    const [, reading, readingDetail] = rule("TEXT-READING");
    assert.equal(reading, "FAIL");
    assert.match(readingDetail, /A line gone too soon/u);
    assert.doesNotMatch(readingDetail, /Quiet lanterns wait|The edge line/u);
  });

  it("FAIL: decor carrying a copy line; WARN: a meta label, unregistered canvas text and a moved-state sample", (t) => {
    if (needsRender(t)) return;
    const { rule, report } = render("qa-warn", ["Lanterns drift home"]);
    assert.equal(rule("TEXT-DECOR")[1], "FAIL", report);
    assert.match(rule("TEXT-DECOR")[2], /carries copy/u);
    assert.equal(rule("TEXT-META-LABEL")[1], "WARN");
    assert.match(rule("TEXT-META-LABEL")[2], /treatment\.json/u);
    assert.equal(rule("TEXT-CANVAS")[1], "WARN");
    assert.equal(rule("TEXT-SAMPLES")[1], "WARN");
    assert.match(rule("TEXT-SAMPLES")[2], /state moved/u);
  });

  it("a copy line that never appears on screen is exit 17, quoting the line", (t) => {
    if (needsRender(t)) return;
    const { r } = render("clock", ["Lanterns drift home", "Harbour bells at dusk"]);
    assert.equal(r.status, 17, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /copy line not on screen: "Harbour bells at dusk"/u);
  });

  it("a clean page passes every text rule and uses only the product's faces", (t) => {
    if (needsRender(t)) return;
    const { r, rule, report } = render("clock", ["Lanterns drift home"]);
    assert.equal(r.status, 0, r.stdout + r.stderr + report);
    for (const id of ["TEXT-COPY-FOUND", "TEXT-CONTRAST", "TEXT-TITLE-SAFE", "TEXT-READING", "TEXT-FONTS", "TEXT-DECOR"]) assert.equal(rule(id)[1], "PASS", `${id}: ${rule(id)[2]}`);
    assert.match(rule("TEXT-CONTRAST")[2], /^[1-9]\d* settled text measurements/u, "contrast was actually measured");
  });

  it("measures contrast on a 9:16 frame too (boxes are frame pixels, not a 1920-wide logical frame)", (t) => {
    if (needsRender(t)) return;
    const { rule, report } = render("portrait", ["Lanterns drift home"], { format: "9:16" });
    assert.equal(rule("TEXT-CONTRAST")[1], "PASS", report);
    assert.match(rule("TEXT-CONTRAST")[2], /^[1-9]\d* settled text measurements/u);
  });
});

describe("text QA judgement (pure)", () => {
  it("the ink mask counts channel differences over 2 levels, and stray ink outside every run is found", async () => {
    const { inkMask, strayInk } = await import(join(engine, "node", "stage-qa.mjs"));
    const a = Buffer.alloc(4 * 4 * 4, 100);
    const b = Buffer.from(a);
    b[(1 * 4 + 1) * 4] = 103;
    b[(3 * 4 + 3) * 4 + 2] = 102;
    const mask = inkMask(a, b, 4, 4);
    assert.equal(mask[1 * 4 + 1], 255);
    assert.equal(mask[3 * 4 + 3], 0, "a 2-level difference is not ink");
    assert.equal(strayInk(mask, 4, 4, [[0, 0, 2, 2]]), 0);
    assert.equal(strayInk(mask, 16, 1, []), 1);
  });
});
