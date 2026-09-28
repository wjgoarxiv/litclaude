import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, "plugins", "litclaude");
const skillRoot = join(pluginRoot, "skills", "lit-typographic-motion");
const guardData = join(root, "test", "fixtures", "lit-typographic-motion", "forbidden-sha256.txt");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function guardSections() {
  const sections = {};
  let current = null;
  for (const line of readFileSync(guardData, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const m = /^\[(.+)\]$/u.exec(line.trim());
    if (m) {
      current = m[1];
      sections[current] = [];
    } else sections[current].push(line.trim());
  }
  return sections;
}
const SECTIONS = guardSections();
const hashOf = (row) => row.split(/\s+/u)[0];
const FORBIDDEN = new Map([...SECTIONS.forbidden, ...SECTIONS["method-only"], ...SECTIONS.hershey].map((row) => [hashOf(row), row.split(/\s+/u)[1]]));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  // statSync follows symlinks (MO-A-49): a linked forbidden file is hashed like any other.
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) return [];
  return st.isDirectory() ? walk(p) : [p];
});

function forbiddenHits(files) {
  const hits = [];
  for (const file of files) {
    const st = statSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size > 32 * 1024 * 1024) continue;
    const h = sha256(readFileSync(file));
    if (FORBIDDEN.has(h)) hits.push(`${file} matches ${FORBIDDEN.get(h)}`);
  }
  return hits;
}

let packDir = null;
function packed() {
  if (packDir) return packDir;
  packDir = mkdtempSync(join(tmpdir(), "lit-motion-pack-"));
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", packDir], { cwd: root, encoding: "utf8", env: { ...process.env, npm_config_cache: join(packDir, ".npm") } });
  assert.equal(pack.status, 0, pack.stderr);
  const tgz = pack.stdout.trim().split("\n").pop();
  const tar = spawnSync("tar", ["-xzf", join(packDir, tgz), "-C", packDir], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  return packDir;
}
after(() => {
  if (packDir) rmSync(packDir, { recursive: true, force: true });
});

const NOTICE_SHA256 = "6734178ad953e5f40585d000c13e4803e670d9e8982b7f6ef0395d47a9eedf30";

describe("lit-typographic-motion forbidden assets (MO-A-49, MO-FT-08)", () => {
  it("the guard data is the spec's 61-row table plus the method-only and Hershey hashes", () => {
    assert.equal(SECTIONS.forbidden.length, 61);
    for (const row of SECTIONS.forbidden) assert.match(row, /^[0-9a-f]{64} {2}\S+$/u);
    assert.deepEqual(SECTIONS["method-only"].map(hashOf), ["70da9c14dedbc4bba92906967f0b4e3cab024855ac740d2e89eb3a90ba983acc", "ac2f817836a14789b2f17e8e834714600621b316862bc855defd9f24785c5e8a"]);
    assert.equal(SECTIONS.hershey.length, 3);
  });

  it("no tracked or new repository file matches a forbidden hash (symlinks followed)", () => {
    const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    const files = listed.stdout.split("\0").filter(Boolean).map((f) => join(root, f)).filter((f) => existsSync(f));
    assert.ok(files.length > 500);
    assert.deepEqual(forbiddenHits(files), []);
  });

  it("the packed tarball contains no forbidden file", () => {
    assert.deepEqual(forbiddenHits(walk(join(packed(), "package"))), []);
  });

  it("a pre-warmed motion cache contains no forbidden file", (t) => {
    const cache = process.env.LITCLAUDE_MOTION_RUNTIME || join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime");
    if (!existsSync(cache)) return t.skip(`no motion cache at ${cache}; run litclaude-ai motion-runtime install to scan one`);
    assert.deepEqual(forbiddenHits(walk(cache)), []);
  });

  it("no timeline scene-id key from the method-only file appears in shipped engine code", () => {
    const files = walk(skillRoot).filter((f) => /\.(mjs|js|json|md|html)$/u.test(f));
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const key of SECTIONS["timeline-scene-ids"]) assert.equal(text.includes(key), false, `${relative(root, file)} contains "${key}"`);
    }
  });

  it("ships no Hershey font, no Galmuri bitmap strike and no DotGothic16", () => {
    const names = walk(skillRoot).map((f) => f.split("/").pop());
    assert.equal(names.some((n) => /hershey|bitmap|dotgothic/iu.test(n)), false);
    const manifest = JSON.parse(readFileSync(join(skillRoot, "fonts", "manifest.json"), "utf8"));
    assert.equal(Object.keys(manifest.fonts).some((k) => /hershey|bitmap|dotgothic/iu.test(k)), false);
  });

  it("vendors no MMS_FA or madmom weights and no aubio or essentia at any tier (MO-A-50)", () => {
    const lock = readFileSync(join(skillRoot, "engine", "audio", "requirements.lock"), "utf8");
    const requirements = lock.split("\n").filter((l) => /^[a-z0-9]/iu.test(l)).map((l) => l.split("==")[0].toLowerCase());
    for (const banned of ["aubio", "essentia", "madmom", "torchaudio"]) assert.equal(requirements.includes(banned), false, banned);
    const models = JSON.parse(readFileSync(join(skillRoot, "engine", "models", "word-timing.json"), "utf8"));
    assert.equal(models.models.some((m) => /mms|madmom/iu.test(m.id)), false);
    for (const m of models.models) assert.ok(models.allowedLicenses.includes(m.license), `${m.id} licence ${m.license}`);
  });
});

describe("lit-typographic-motion credit and notices (MO-A-36, MO-A-48)", () => {
  it("NOTICE is the verbatim MIT notice", () => {
    const bytes = readFileSync(join(skillRoot, "engine", "NOTICE"));
    assert.equal(sha256(bytes), NOTICE_SHA256);
    assert.match(bytes.toString(), /^Portions of this engine are adapted from mexicat\/pdoom-video\n\(https:\/\/github\.com\/mexicat\/pdoom-video\), commit\nca251e3dddda422b364385eb484b5a3593a0990d\.\n\nCopyright \(c\) 2026 Giacomo Magnanini\n/u);
  });

  it("the pack carries the commit, NOTICE, THIRD_PARTY_NOTICES, the EMS OFL text and CREDITS", () => {
    const pkgSkill = join(packed(), "package", "plugins", "litclaude", "skills", "lit-typographic-motion");
    for (const f of ["engine/NOTICE", "engine/THIRD_PARTY_NOTICES", "fonts/stroke/OFL.txt", "fonts/stroke/CREDITS", "engine/package.json", "engine/package-lock.json", "fonts/manifest.json", "scripts/motion.mjs", "scripts/motion-runtime.mjs", "scripts/motion-doctor.mjs"]) {
      assert.ok(existsSync(join(pkgSkill, f)), f);
    }
    assert.match(readFileSync(join(pkgSkill, "engine", "NOTICE"), "utf8"), /ca251e3dddda422b364385eb484b5a3593a0990d/u);
    assert.match(readFileSync(join(pkgSkill, "fonts", "stroke", "OFL.txt"), "utf8"), /SIL Open Font License, Version 1\.1/u);
  });

  it("the one-line credit is on the help surface and in the skill", () => {
    const help = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "--help"], { encoding: "utf8", env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" } });
    assert.match(help.stdout, /Typographic-motion engine adapted from mexicat\/pdoom-video \(MIT, Giacomo Magnanini\), commit `ca251e3`\./u);
    assert.match(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), /mexicat\/pdoom-video \(MIT\), commit `ca251e3`/u);
  });

  it("THIRD_PARTY_NOTICES names every preset font with a licence path that exists (or is fetched with it)", () => {
    const notices = readFileSync(join(skillRoot, "engine", "THIRD_PARTY_NOTICES"), "utf8");
    const manifest = JSON.parse(readFileSync(join(skillRoot, "fonts", "manifest.json"), "utf8"));
    for (const [key, font] of Object.entries(manifest.fonts)) {
      for (const lic of font.licence) {
        if (font.source === "fetch") {
          assert.ok(notices.includes(`<motion cache>/fonts/${lic.file}`), `${key}: ${lic.file} named`);
          assert.match(lic.url, /^https:\/\//u);
          assert.match(lic.sha256, /^[0-9a-f]{64}$/u);
        } else {
          const path = join(skillRoot, "fonts", lic.path);
          assert.ok(existsSync(path), `${key}: ${lic.path} exists`);
          assert.equal(sha256(readFileSync(path)), lic.sha256, `${key}: ${lic.path} hash`);
          const named = lic.path.startsWith("../../lit-pptx/") ? lic.path.replace("../../", "../") : `fonts/${lic.path}`;
          assert.ok(notices.includes(named.replace(/OFL\.txt$/u, "")) || notices.includes(named), `${key}: ${named} named in THIRD_PARTY_NOTICES`);
        }
      }
    }
  });
});

describe("lit-typographic-motion fonts (MO-A-46..48, MO-FT-01..08)", () => {
  const manifest = JSON.parse(readFileSync(join(skillRoot, "fonts", "manifest.json"), "utf8"));
  it("bundled fonts match their recorded sha256, each <= 1 MB, <= 4 MB in total", () => {
    let total = 0;
    for (const [key, font] of Object.entries(manifest.fonts)) {
      if (font.source !== "bundled") continue;
      const bytes = readFileSync(join(skillRoot, "fonts", font.path));
      assert.equal(sha256(bytes), font.sha256, key);
      assert.equal(bytes.length, font.bytes, key);
      assert.ok(bytes.length <= 1_000_000, `${key} ${bytes.length} B`);
      total += bytes.length;
    }
    assert.ok(total <= 4_000_000, `bundled total ${total} B`);
    const onDisk = walk(join(skillRoot, "fonts")).filter((f) => /\.(ttf|otf|svg)$/u.test(f)).map((f) => relative(join(skillRoot, "fonts"), f)).sort();
    const listed = Object.values(manifest.fonts).filter((f) => f.source === "bundled").map((f) => f.path).sort();
    assert.deepEqual(onDisk, listed, "no unlisted font file ships");
  });

  it("Galmuri9 and MesloLGS NF are fetched by pinned URL and hash, never bundled", () => {
    for (const key of ["galmuri9", "meslo-400"]) {
      assert.equal(manifest.fonts[key].source, "fetch");
      assert.match(manifest.fonts[key].url, /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(?:v\d|[0-9a-f]{40})/u, "pinned to a tag or commit");
    }
    assert.equal(manifest.fonts.galmuri9.sha256, "5cb68052ee0a15571747e91c20f145e24b51bb459c6cd58226fafee78d9c0b16");
    assert.equal(manifest.fonts["meslo-400"].sha256, "d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d");
    assert.equal(manifest.fonts["meslo-400"].licence.length, 3, "Apache notice, Apache-2.0 text and the Vera/Arev notices");
  });

  it("the Hangul body is lit-pptx's own Pretendard pair, reused by path and checked against its own hashes", () => {
    for (const key of ["pretendard-400", "pretendard-700"]) {
      const font = manifest.fonts[key];
      assert.equal(font.source, "reuse");
      assert.equal(sha256(readFileSync(resolve(skillRoot, "fonts", font.path))), font.sha256, key);
    }
  });

  it("Archivo instances are the 3 widths x 3 weights made at development time", () => {
    const keys = Object.keys(manifest.fonts).filter((k) => k.startsWith("archivo-")).sort();
    assert.deepEqual(keys, ["archivo-100-400", "archivo-100-700", "archivo-100-900", "archivo-125-400", "archivo-125-700", "archivo-125-900", "archivo-75-400", "archivo-75-700", "archivo-75-900"]);
    for (const k of keys) assert.match(manifest.fonts[k].origin, /0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053/u);
  });
});

const REFERENCES = ["style-bibles.md", "engine-contract.md", "type-craft.md", "craft-loop.md", "runtime.md", "brief-schema.md"];

describe("lit-typographic-motion enrollment and corpus (organic, not just present)", () => {
  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  it("is in the catalog, and every shipped file is hash-pinned for the installer", () => {
    assert.ok(canonicalSkillIds.includes("lit-typographic-motion"));
    for (const file of walk(skillRoot)) {
      const key = relative(pluginRoot, file);
      assert.equal(canonicalSkillResourceManifest.get(key), sha256(readFileSync(file)), `unpinned or stale: ${key}`);
    }
  });

  it("is enrolled in the payload parity inventory", () => {
    const parity = JSON.parse(readFileSync(join(root, "tools", "payload-substance-parity.json"), "utf8"));
    const names = parity.products.p27.skills;
    assert.ok(names.includes("lit-typographic-motion"));
    assert.equal(parity.products.p27.inventory.count, names.length);
    assert.equal(parity.products.p27.inventory.sha256, sha256(JSON.stringify([...names].sort())));
  });

  it("is wired into the hook, the doctors, the installer and the CLI", () => {
    const hookSource = readFileSync(join(pluginRoot, "bin", "litclaude-hook.js"), "utf8");
    assert.match(hookSource, /"lit-typographic-motion": \{ command: "\/litclaude:lit-typographic-motion"/u);
    assert.match(hookSource, /hasMotionVideoIntent\(normalized\)/u);
    assert.match(hookSource, /evaluateMotionStop/u);
    assert.match(readFileSync(join(root, "scripts", "doctor.mjs"), "utf8"), /lit-typographic-motion\/scripts\/motion-doctor\.mjs/u);
    const cli = readFileSync(join(root, "bin", "litclaude-ai.js"), "utf8");
    assert.match(cli, /case "motion-runtime"/u);
    assert.match(cli, /motion-doctor\.mjs/u);
    assert.match(cli, /prewarmMotionRuntime\(\)/u);
    assert.match(readFileSync(join(root, "scripts", "postinstall.mjs"), "utf8"), /litclaude-ai motion-runtime install/u);
  });

  it("SKILL.md is lean, contract-first, and names only helpers and references that exist", () => {
    assert.ok(Buffer.byteLength(skill) <= 12 * 1024, `SKILL.md ${Buffer.byteLength(skill)} B`);
    for (const h of ["## #contract.activation", "## #contract.procedure", "## #contract.hard_stops"]) assert.ok(skill.includes(h), h);
    for (const ref of REFERENCES) assert.ok(skill.includes(`references/${ref}`), ref);
    for (const helper of skill.matchAll(/\$SKILL_ROOT\/(scripts\/[\w.-]+)/gu)) assert.ok(existsSync(join(skillRoot, helper[1])), helper[1]);
    assert.match(skill, /hand with ffmpeg, Python/u);
    assert.match(skill, /ask no questions|Ask no questions/u);
  });

  it("every reference is substantive and carries its required sections", () => {
    const required = {
      "style-bibles.md": ["## Template", "## Auto-pick (MO-B-00)", "## swiss-signal", "## terminalcore", "## tidal"],
      "engine-contract.md": ["## Pipeline", "## Scene API", "## Post chain", "## Look-library passes", "## Software GL"],
      "type-craft.md": ["## Script runs", "## Line breaks", "## Reading time", "## Glyph coverage"],
      "craft-loop.md": ["## One round", "## Stop conditions", "## Gate table", "## Report"],
      "runtime.md": ["## Pre-warm, never first use", "## Exit codes", "## Chrome flags", "## Audio tiers"],
      "brief-schema.md": ["## Two shapes", "## Fields", "## Shots"],
    };
    for (const ref of REFERENCES) {
      const text = readFileSync(join(skillRoot, "references", ref), "utf8");
      assert.ok(text.split(/\s+/u).filter(Boolean).length >= 350, `${ref} is too thin`);
      for (const section of required[ref]) assert.ok(text.includes(section), `${ref}: ${section}`);
    }
  });

  it("every engine module is reachable from an entry point (no orphans)", () => {
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      // A worker entry is reached through new URL("./x.mjs", import.meta.url), not an import.
      for (const m of src.matchAll(/(?:from|import|new URL)\s*\(?\s*["'`]([^"'`]+\.mjs)["'`]/gu)) {
        const spec = m[1].replace(/\$\{[^}]+\}/gu, "");
        if (spec === "/vendor/opentype.mjs") continue;
        const target = spec.startsWith("/") ? join(skillRoot, "engine", spec) : resolve(dirname(file), spec);
        if (existsSync(target)) visit(target);
      }
    };
    for (const entry of ["scripts/motion.mjs", "scripts/motion-runtime.mjs", "scripts/motion-doctor.mjs", "engine/web/boot.mjs"]) visit(join(skillRoot, entry));
    // motion.mjs loads the pipeline dynamically; follow it too.
    visit(join(skillRoot, "engine", "node", "pipeline.mjs"));
    const modules = walk(join(skillRoot, "engine")).filter((f) => f.endsWith(".mjs"));
    const orphans = modules.filter((f) => !seen.has(f)).map((f) => relative(skillRoot, f));
    assert.deepEqual(orphans, []);
  });

  it("the page never reads a clock or an unseeded random in a visual path (MO-A-23)", () => {
    for (const file of walk(join(skillRoot, "engine", "web")).concat(walk(join(skillRoot, "engine", "core")))) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n").filter((l) => /Math\.random|Date\.now|performance\.now|new Date\(/u.test(l));
      // boot.mjs times the MO-D-02 perf run; that measurement is not a visual path.
      const allowed = lines.filter((l) => !(file.endsWith("boot.mjs") && /performance\.now/u.test(l)));
      assert.deepEqual(allowed, [], relative(skillRoot, file));
    }
  });

  it("type is never outlined or haloed: the glyph path fills, only the plotter fonts stroke (MO-A-35)", () => {
    const type = readFileSync(join(skillRoot, "engine", "web", "type.mjs"), "utf8");
    // Canvas2D's own strokeText is the outline API; the plotter-font helpers are separate functions.
    assert.doesNotMatch(type, /\.strokeText\(|shadowBlur\s*=\s*[1-9]|lineWidth/u);
    for (const scene of readdirSync(join(skillRoot, "engine", "web", "scenes"))) {
      assert.doesNotMatch(readFileSync(join(skillRoot, "engine", "web", "scenes", scene), "utf8"), /\.strokeText\(|shadowBlur|shadowColor/u, scene);
    }
  });
});

describe("lit-typographic-motion CLIs launched through a symlinked directory", () => {
  it("every CLI prints its own usage banner, never a silent exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-motion-link-"));
    try {
      const link = join(dir, "linked-scripts");
      symlinkSync(join(skillRoot, "scripts"), link, "dir");
      for (const [script, banner] of [["motion.mjs", /lit-typographic-motion render CLI \(LitClaude\)/u], ["motion-runtime.mjs", /lit-typographic-motion runtime \(LitClaude\)/u], ["motion-doctor.mjs", /lit-typographic-motion doctor \(LitClaude\)/u]]) {
        const r = spawnSync(process.execPath, [join(link, script), "--help"], { encoding: "utf8" });
        assert.equal(r.status, 0, `${script}: ${r.stderr}`);
        assert.match(r.stdout, banner, `${script} printed nothing through the symlink`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lit-typographic-motion Chrome never touches the OS keychain", () => {
  it("every launch, on every ladder rung, carries --use-mock-keychain and --password-store=basic", async () => {
    const { launchArgs, flagLadder } = await import(join(skillRoot, "engine", "node", "chrome.mjs"));
    const ladders = [...flagLadder(), ...flagLadder({ softwareOnly: true })];
    assert.ok(ladders.length >= 2);
    for (const flags of ladders) {
      const args = launchArgs("/tmp/profile", flags);
      assert.ok(args.includes("--use-mock-keychain"), args.join(" "));
      assert.ok(args.includes("--password-store=basic"), args.join(" "));
    }
  });

  it("builds Chrome arguments in exactly one place, so no launch can skip the two flags", () => {
    const sources = [...walk(skillRoot), ...walk(join(root, "test", "fixtures", "lit-typographic-motion")),
      ...readdirSync(join(root, "test")).filter((f) => f.startsWith("lit-typographic-motion-")).map((f) => join(root, "test", f))]
      .filter((f) => /\.(mjs|js|py)$/u.test(f));
    const launching = sources.filter((f) => /["'`]--remote-debugging-pipe["'`]|["'`]--headless["'`]/u.test(readFileSync(f, "utf8")));
    assert.deepEqual(launching.map((f) => relative(root, f)), ["plugins/litclaude/skills/lit-typographic-motion/engine/node/chrome.mjs"]);
  });
});
