#!/usr/bin/env node
// Cover recipe regression QA (needs Chrome, img2webp and dwebp; not part of the unit suite).
// Re-renders every shipped cover recipe through the real cover renderer (`motion.mjs cover`, every
// gate on the decoded file) and fails when a recipe leaves the row it shipped with:
// median d and moving share outside +-15 %, seamLocal outside the cover TARGET, or more than 2 MiB.
// `--negatives` also renders the shipped slide-like negatives and every regression a recipe declares
// (`regressions` in its expected.json). Each of those declares `mustFail` ("G2.floor", "G1.target"):
// it passes only when the render completed and gated the decoded file, every declared gate failed,
// and no undeclared FLOOR gate among G1-G4 failed. A crash, a missing declaration or a failure on
// the wrong gate is a QA failure, never a caught defect. `--feather N` runs only the painted
// recipe's declared `feather-N` regression.
//
//   node scripts/qa-cover-recipes.mjs [--out <dir>] [--only painted-light,weight-tide] [--negatives] [--feather N]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const skill = path.join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const motion = path.join(skill, "scripts", "motion.mjs");
const { COVER, EXIT } = await import(path.join(skill, "engine", "core", "constants.mjs"));
const FLOOR_GATES = ["G1", "G2", "G3", "G4"];

/**
 * Verdict of one negative or regression case: { ok, why }. It is proven only when the render
 * completed and gated the decoded file (exit 0 or 13 with a manifest), every declared gate failed at
 * its tier, and no undeclared FLOOR gate among G1-G4 failed.
 */
export function judgeCase(mustFail, { status, manifest }) {
  if (!Array.isArray(mustFail) || !mustFail.length) return { ok: false, why: "it declares no gate it must fail (mustFail)" };
  const gates = manifest?.gate?.gates;
  if (!gates || ![EXIT.OK, EXIT.GATE_FAIL_QA].includes(status)) return { ok: false, why: `the render did not complete and gate the decoded file (exit ${status})` };
  for (const id of mustFail) {
    const [gate, tier] = id.split(".");
    if (!gates[gate]) return { ok: false, why: `${gate} was not measured` };
    if ((tier === "target" ? gates[gate].target : gates[gate].pass) !== false) return { ok: false, why: `${id} did not fail` };
  }
  const extra = FLOOR_GATES.filter((g) => gates[g]?.pass === false && !mustFail.includes(`${g}.floor`));
  if (extra.length) return { ok: false, why: `it also fails ${extra.map((g) => `${g}.floor`).join(", ")}, which it does not declare` };
  return { ok: true, why: `fails ${mustFail.join(", ")} as declared` };
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function render(outRoot, name, dir, treatment, { assets = null, patch = null } = {}) {
  const out = path.join(outRoot, name);
  mkdirSync(path.join(out, "cover"), { recursive: true });
  cpSync(path.join(dir, "index.html"), path.join(out, "cover", "index.html"));
  if (patch) writeFileSync(path.join(out, "cover", "index.html"), patch(readFileSync(path.join(out, "cover", "index.html"), "utf8")));
  if (assets) {
    mkdirSync(path.join(out, "cover", "assets"), { recursive: true });
    // The recipe's panel ranges are calibrated to this five-panel painting, not to the README illustration.
    const base = path.join(root, "test", "fixtures", "lit-typographic-motion", "cover", "painted-light-five-panel.png");
    cpSync(base, path.join(out, "cover", "assets", "base.png"));
    writeFileSync(path.join(out, "assets.json"), JSON.stringify({ assets: assets.map((a) => ({ ...a, sha256: sha256(readFileSync(path.join(out, a.path))) })) }, null, 2));
  }
  writeFileSync(path.join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
  const r = spawnSync(process.execPath, [motion, "cover", "--out", out, "--round", "1", "--foreground"], { encoding: "utf8", env: process.env, timeout: 1200000 });
  return { out, status: r.status, stdout: r.stdout, stderr: r.stderr, manifest: readJson(path.join(out, "manifest.json")) };
}

const within = (value, expected, share) => Math.abs(value - expected) <= share * expected;
const fmt = (x) => (typeof x === "number" ? +x.toPrecision(4) : x);
const lastLine = (r) => (r.stderr || r.stdout || "").trim().split("\n").pop();

function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i < 0 ? null : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
  };
  const outRoot = path.resolve(opt("out") ?? mkdtempSync(path.join(tmpdir(), "lit-cover-qa-")));
  const feather = opt("feather");
  const only = feather ? [] : opt("only") ? String(opt("only")).split(",") : ["hero-3d", "painted-light", "weight-tide", "orbit-loop"];
  const rows = [];
  let failed = 0;

  for (const name of only) {
    const dir = path.join(skill, "recipes", name);
    const expected = readJson(path.join(dir, "expected.json"));
    if (!expected?.row) {
      failed += 1;
      rows.push(["FAIL", name, `no expected row in recipes/${name}/expected.json`]);
      continue;
    }
    const r = render(outRoot, name, dir, expected.treatment, { assets: expected.assets ?? null });
    if (!r.manifest) {
      failed += 1;
      rows.push(["NO RENDER", name, `exit ${r.status}: ${lastLine(r)}`]);
      continue;
    }
    const g = r.manifest.gate;
    const e = expected.row;
    const checks = [
      ["medianD", within(g.medianD, e.medianD, 0.15)],
      ["moving", within(g.movingFrac, e.movingFrac, 0.15)],
      ["seamLocal", g.seamLocal >= COVER.target.seamLo && g.seamLocal <= COVER.target.seamLocal],
      ["bytes", r.manifest.bytes <= COVER.targetBytes],
      ["gate", r.status === 0],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([k]) => k);
    if (bad.length) failed += 1;
    rows.push([bad.length ? `FAIL ${bad.join(",")}` : "PASS", name, `median d ${fmt(g.medianD)} (row ${e.medianD}) | moving ${fmt(g.movingFrac)} | still ${fmt(g.longestStillSec)} s | spike ${fmt(g.spike)} | seamLocal ${fmt(g.seamLocal)} | ${r.manifest.bytes} B | exit ${r.status}`]);
  }

  const cases = [];
  if (argv.includes("--negatives")) {
    for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) cases.push({ kind: "negative", name });
    for (const recipe of ["hero-3d", "painted-light", "weight-tide", "orbit-loop"]) {
      for (const id of Object.keys(readJson(path.join(skill, "recipes", recipe, "expected.json"))?.regressions ?? {})) cases.push({ kind: "regression", recipe, id });
    }
  }
  if (feather) cases.push({ kind: "regression", recipe: "painted-light", id: `feather-${feather}` });

  for (const c of cases) {
    const label = c.kind === "negative" ? `negative ${c.name}` : `regression ${c.recipe} ${c.id}`;
    let mustFail;
    let r;
    if (c.kind === "negative") {
      const dir = path.join(skill, "recipes", "negatives", c.name);
      const expected = readJson(path.join(dir, "expected.json"));
      if (!expected) {
        failed += 1;
        rows.push(["FAIL", label, `not proven: recipes/negatives/${c.name}/expected.json is missing`]);
        continue;
      }
      mustFail = expected.mustFail;
      const treatment = {
        mode: "cover", request: "A shipped negative rendered by the cover recipe QA.", idea: "A slide-like page that the decoded-file gate has to fail.",
        recipe: "own", recipeReason: "A regression negative, never a recipe.", hero: "The title card.", beat: "The card swaps once per loop.", brandWord: "LITCLAUDE", aspect: "2:1",
        layers: { slow: "None by design.", mid: "None by design.", beat: "Card or text changes." },
        system: { rule: "Text states on a timeline.", copies: "One per card.", offset: "None." },
        title: { box: [0.05, 0.3, 0.9, 0.3], kind: "live" }, ambition: "It must keep failing its named gates.",
        ...expected.treatment,
      };
      r = render(outRoot, `negative-${c.name}`, dir, treatment);
    } else {
      const dir = path.join(skill, "recipes", c.recipe);
      const expected = readJson(path.join(dir, "expected.json"));
      const reg = expected?.regressions?.[c.id];
      if (!reg) {
        failed += 1;
        rows.push(["FAIL", label, `not proven: ${c.recipe}/expected.json declares no regression ${c.id}`]);
        continue;
      }
      const html = readFileSync(path.join(dir, "index.html"), "utf8");
      if (!html.includes(reg.patch.find)) {
        failed += 1;
        rows.push(["FAIL", label, `not proven: the page no longer contains "${reg.patch.find}"`]);
        continue;
      }
      mustFail = reg.mustFail;
      r = render(outRoot, `${c.recipe}-${c.id}`, dir, expected.treatment, { assets: expected.assets ?? null, patch: (s) => s.replace(reg.patch.find, reg.patch.replace) });
    }
    const v = judgeCase(mustFail, r);
    if (!v.ok) failed += 1;
    const gates = r.manifest?.gate?.gates ?? {};
    const failing = Object.entries(gates).flatMap(([k, x]) => (x.pass === false ? [`${k}.floor`] : x.target === false ? [`${k}.target`] : []));
    const detail = r.manifest ? `; failing ${failing.join(",") || "none"}; ${r.manifest.bytes} B; exit ${r.status}` : `: ${lastLine(r)}`;
    rows.push([v.ok ? "PASS (fails as declared)" : "FAIL", label, `${v.ok ? "" : "not proven: "}${v.why} (declared ${(mustFail ?? []).join(",") || "none"})${detail}`]);
  }

  for (const [verdict, name, detail] of rows) process.stdout.write(`${verdict.padEnd(24)} ${name.padEnd(36)} ${detail}\n`);
  process.stdout.write(`cover recipe QA: ${failed ? `${failed} FAIL` : "all PASS"}; renders in ${outRoot}\n`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
