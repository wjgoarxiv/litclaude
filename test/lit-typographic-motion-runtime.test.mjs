import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fakeNpm, npmGlobalInstallEnv, npmGlobalModeKeys } from "./helpers/fake-npm.mjs";
import { shortTypeTreatment, writeTreatment } from "./helpers/motion-treatment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");
const motion = join(skillRoot, "scripts", "motion.mjs");
const runtimeCli = join(skillRoot, "scripts", "motion-runtime.mjs");
const stubChrome = join(root, "test", "fixtures", "lit-typographic-motion", "stub-chrome-no-webgl2.mjs");
const runtime = await import(join(skillRoot, "engine", "node", "runtime.mjs"));
const { findChrome } = await import(join(skillRoot, "engine", "node", "chrome.mjs"));

const temps = [];
const temp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// A pre-warmed runtime prepared outside the suite (the suite itself never touches the network).
function warmRuntime() {
  const candidates = [process.env.LITCLAUDE_MOTION_RUNTIME, join(process.env.XDG_CACHE_HOME || join(process.env.HOME ?? "", ".cache"), "litclaude", "motion-runtime")].filter(Boolean);
  for (const dir of candidates) {
    if (runtime.runtimeStatus({ env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: dir } }).ready) return dir;
  }
  return null;
}
const WARM = warmRuntime();
const CHROME = findChrome();
const needsRender = (t) => {
  if (!WARM) {
    t.skip("motion runtime not pre-warmed; run: litclaude-ai motion-runtime install (then rerun with LITCLAUDE_MOTION_RUNTIME set)");
    return true;
  }
  if (!CHROME) {
    t.skip("Chrome not found; the render cases need a real Chrome");
    return true;
  }
  return false;
};

const run = (args, env = {}, cwd = root) => spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, timeout: 300000 });
// Every render starts from <out>/treatment.json; these cases render into <dir>/out.
const { TIMBRES } = await import(join(skillRoot, "engine", "node", "sound.mjs"));
const briefFile = (dir, brief) => {
  const file = join(dir, "brief.json");
  writeFileSync(file, JSON.stringify({ schema: "litclaude.motion-brief/v1", ...brief }));
  writeTreatment(join(dir, "out"), shortTypeTreatment(Object.keys(TIMBRES)[0]));
  return file;
};
const SHORT = { shots: [{ scene: "title-slam", text: "Runtime check" }, { scene: "end-card", text: "끝" }] };

describe("lit-typographic-motion runtime and BLOCKED states (MO-A-42..45, MO-A-54)", () => {
  it("status on an empty cache names what is missing and the command that fixes it", () => {
    const empty = temp("lit-motion-empty-");
    const r = run([runtimeCli, "status"], { LITCLAUDE_MOTION_RUNTIME: empty });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /engine deps: missing/u);
    assert.match(r.stdout, /galmuri9 \(missing\)/u);
    assert.match(r.stdout, /meslo-400 \(missing\)/u);
    assert.match(r.stdout, /pre-warm: NOT READY — run litclaude-ai motion-runtime install/u);
    assert.deepEqual(readdirSync(empty), [], "status never installs");
  });

  it("a render with an unwarmed cache exits 14 and names the command, before touching Chrome", () => {
    const dir = temp("lit-motion-14-");
    const r = run([motion, "make", briefFile(dir, SHORT), "--out", join(dir, "out")], { LITCLAUDE_MOTION_RUNTIME: join(dir, "cache"), CHROME_PATH: "/nonexistent/chrome" });
    assert.equal(r.status, 14, r.stdout + r.stderr);
    assert.match(r.stderr, /BLOCKED_DEPS_NOT_PREWARMED: .*litclaude-ai motion-runtime install/u);
  });

  it("a cached font whose sha256 differs exits 15", (t) => {
    if (!WARM) return t.skip("motion runtime not pre-warmed; run: litclaude-ai motion-runtime install");
    const cache = temp("lit-motion-15-");
    cpSync(WARM, cache, { recursive: true });
    writeFileSync(join(cache, "fonts", "MesloLGS-NF-Regular.ttf"), "tampered");
    const dir = temp("lit-motion-15b-");
    // terminalcore sets its machine voice in meslo-400, so the tampered file is one this plan loads.
    const r = run([motion, "make", briefFile(dir, { ...SHORT, style: "terminalcore" }), "--out", join(dir, "out")], { LITCLAUDE_MOTION_RUNTIME: cache, CHROME_PATH: "/nonexistent/chrome" });
    assert.equal(r.status, 15, r.stdout + r.stderr);
    assert.match(r.stderr, /BLOCKED_FONT_FETCH: font meslo-400 is sha256 mismatch/u);
  });

  it("no Chrome exits 10 with the launcher's reason", (t) => {
    if (!WARM) return t.skip("motion runtime not pre-warmed; run: litclaude-ai motion-runtime install");
    const dir = temp("lit-motion-10-");
    const r = run([motion, "make", briefFile(dir, SHORT), "--out", join(dir, "out")], { LITCLAUDE_MOTION_RUNTIME: WARM, CHROME_PATH: join(dir, "no-such-chrome") });
    assert.equal(r.status, 10, r.stdout + r.stderr);
    assert.match(r.stderr, /BLOCKED_NO_CHROME/u);
  });

  it("Chrome running with no WebGL2 on any rung exits 11 with the per-rung reason, even when the browser ignores Browser.close", (t) => {
    if (!WARM) return t.skip("motion runtime not pre-warmed; run: litclaude-ai motion-runtime install");
    const dir = temp("lit-motion-11-");
    const started = Date.now();
    const argvOut = join(dir, "argv.jsonl");
    const r = spawnSync(process.execPath, [motion, "make", briefFile(dir, SHORT), "--out", join(dir, "out")], { cwd: root, encoding: "utf8", env: { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM, CHROME_PATH: stubChrome, STUB_CHROME_LINGER: "1", STUB_CHROME_ARGV_OUT: argvOut }, timeout: 60000 });
    assert.equal(r.status, 11, r.stdout + r.stderr);
    const launches = readFileSync(argvOut, "utf8").split(/(?<=\])(?=\[)/u).map((line) => JSON.parse(line));
    assert.equal(launches.length, 2, "one launch per ladder rung");
    for (const argv of launches) for (const flag of ["--use-mock-keychain", "--password-store=basic"]) assert.ok(argv.includes(flag), `${flag} missing: ${argv.join(" ")}`);
    assert.ok(Date.now() - started < 30000, "the lingering browsers were killed, not waited on");
    assert.match(r.stderr, /BLOCKED_NO_WEBGL2: .*getContext\('webgl2'\) returned null/u);
    assert.doesNotMatch(r.stderr, /BLOCKED_NO_CHROME/u);
  });

  it("an injected EPERM on listen takes the CDP pull of the same readback buffer and still renders", (t) => {
    if (needsRender(t)) return;
    const dir = temp("lit-motion-eperm-");
    const r = run([motion, "make", briefFile(dir, SHORT), "--out", join(dir, "out"), "--stills-only"], { LITCLAUDE_MOTION_RUNTIME: WARM, LITCLAUDE_MOTION_FAULT: "listen-eperm" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /listen failed \(listen EPERM: operation not permitted 127\.0\.0\.1\); using CDP pull/u);
    assert.doesNotMatch(r.stderr, /BLOCKED_NO_CHROME|page failed/u);
    assert.match(r.stdout + r.stderr, /record the round with look --round 1, make the change, then render the film with --round 2 \(no --stills-only\)/u, "the film is the next round");
    // The common stills set: one still per treatment beat (2), one strip per cut (1), the sheet.
    const index = JSON.parse(readFileSync(join(dir, "out", "stills", "index.json"), "utf8"));
    assert.deepEqual(index.files.map((f) => f.kind).sort(), ["beat", "beat", "sheet", "strip"]);
    assert.equal(readdirSync(join(dir, "out", "stills")).filter((f) => f.endsWith(".png")).length, 4);
  });

  it("video without ffmpeg exits 12, while stills and the sheet still render with exit 0", (t) => {
    if (needsRender(t)) return;
    const dir = temp("lit-motion-12-");
    const nodeDir = resolve(process.execPath, "..");
    const noFfmpeg = { LITCLAUDE_MOTION_RUNTIME: WARM, PATH: `${nodeDir}:/usr/bin:/bin`, FFMPEG_PATH: "" };
    const r = run([motion, "make", briefFile(dir, SHORT), "--out", join(dir, "out")], noFfmpeg);
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, /BLOCKED_NO_FFMPEG_FOR_VIDEO/u);
    assert.ok(existsSync(join(dir, "out", "stills", "sheet.png")));
    writeTreatment(join(dir, "out2"), shortTypeTreatment(Object.keys(TIMBRES)[0]));
    const stills = run([motion, "stills", join(dir, "brief.json"), "--out", join(dir, "out2")], noFfmpeg);
    assert.equal(stills.status, 0, stills.stderr);
    const sheet = run([motion, "sheet", join(dir, "brief.json"), "--out", join(dir, "out2")], noFfmpeg);
    assert.equal(sheet.status, 0, sheet.stderr);
  });

  it("an absent audio venv, or one whose pins changed, falls back to Tier 1 with the warning", (t) => {
    if (needsRender(t)) return;
    for (const variant of ["absent", "mismatch"]) {
      const cache = temp(`lit-motion-audio-${variant}-`);
      cpSync(WARM, cache, { recursive: true });
      const env = { ...process.env, LITCLAUDE_MOTION_RUNTIME: cache };
      if (variant === "mismatch") {
        const dir = runtime.audioDir(env);
        mkdirSync(join(dir, "bin"), { recursive: true });
        writeFileSync(join(dir, ".litclaude-ready"), JSON.stringify({ lockSha256: "0".repeat(64), python: "3.0" }));
        assert.equal(runtime.audioStatus(env).state, "mismatch");
      } else assert.equal(runtime.audioStatus(env).state, "absent");
      const dir = temp("lit-motion-audio-run-");
      writeFileSync(join(dir, "beat.wav"), "RIFF");
      const r = run([motion, "make", briefFile(dir, { ...SHORT, audio: "beat.wav" }), "--out", join(dir, "out"), "--stills-only"], { LITCLAUDE_MOTION_RUNTIME: cache });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /warning: audio analysis not prewarmed: run litclaude-ai motion-runtime install --audio/u);
    }
  });

  it("--word-timing with no models exits 14 and names its install command; install states size and pins first", () => {
    const dir = temp("lit-motion-wt-");
    const r = run([motion, "make", briefFile(dir, SHORT), "--out", join(dir, "out"), "--word-timing"], { LITCLAUDE_MOTION_RUNTIME: join(dir, "cache") });
    assert.equal(r.status, 14, r.stdout + r.stderr);
    assert.match(r.stderr, /litclaude-ai motion-runtime install --word-timing/u);
    const plan = run([runtimeCli, "install", "--word-timing"], { LITCLAUDE_MOTION_RUNTIME: join(dir, "cache") });
    assert.equal(plan.status, 14);
    const lines = plan.stdout.split("\n");
    assert.match(lines[0], /^word timing: \d+\.\d+ GB to download \(3 models\):/u);
    assert.match(plan.stdout, /kresnik\/wav2vec2-large-xlsr-korean @ [0-9a-f]{40} — licence apache-2\.0 \(allowed\)/u);
    assert.match(plan.stdout, /nothing was downloaded/u);
    assert.equal(existsSync(join(dir, "cache")), false, "nothing was written");
  });

  it("the pre-warm fetches fonts by pinned hash from a local mirror, and rejects a tampered file", (t) => {
    if (!WARM) return t.skip("motion runtime not pre-warmed; the fixture mirror is built from its verified fonts");
    const mirror = temp("lit-motion-mirror-");
    const manifest = JSON.parse(readFileSync(join(skillRoot, "fonts", "manifest.json"), "utf8"));
    for (const font of Object.values(manifest.fonts).filter((f) => f.source === "fetch")) {
      cpSync(join(WARM, "fonts", font.file), join(mirror, font.sha256));
      for (const lic of font.licence) cpSync(join(WARM, "fonts", lic.file), join(mirror, lic.sha256));
    }
    const cache = temp("lit-motion-mirror-cache-");
    const nodeDirName = basename(runtime.nodeDir({ ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM }));
    cpSync(join(WARM, nodeDirName), join(cache, nodeDirName), { recursive: true });
    const ok = run([runtimeCli, "install"], { LITCLAUDE_MOTION_RUNTIME: cache, LITCLAUDE_MOTION_MIRROR: pathToFileURL(mirror).href });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /MOTION_RUNTIME_INSTALL_PASS/u);
    assert.match(ok.stdout, /pre-warm: ready/u);
    const bad = temp("lit-motion-mirror-bad-");
    cpSync(join(WARM, nodeDirName), join(bad, nodeDirName), { recursive: true });
    writeFileSync(join(mirror, manifest.fonts.galmuri9.sha256), "not the font");
    const tampered = run([runtimeCli, "install"], { LITCLAUDE_MOTION_RUNTIME: bad, LITCLAUDE_MOTION_MIRROR: pathToFileURL(mirror).href });
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /sha256 mismatch/u);
    assert.equal(existsSync(join(bad, "fonts", "Galmuri9.ttf")), false, "a mismatched download is never kept");
  });

  it("an offline product install still succeeds and prints the one receipt line", () => {
    const home = temp("lit-motion-offline-home-");
    const env = {
      HOME: home, LITCLAUDE_HOME: join(home, ".litclaude"), CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDE_HOME: join(home, ".claude"),
      LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_MOTION_PREWARM: "1", LITCLAUDE_MOTION_RUNTIME: join(home, "motion-cache"),
      LITCLAUDE_MOTION_MIRROR: pathToFileURL(join(home, "no-mirror")).href, npm_config_registry: "http://127.0.0.1:9/", npm_config_cache: join(home, ".npm"),
      npm_config_fetch_retries: "0", npm_config_fetch_timeout: "2000",
    };
    const r = run([join(root, "bin", "litclaude-ai.js"), "install", "--yes"], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /INSTALL_PASS/u);
    const receipt = r.stdout.split("\n").filter((l) => l.startsWith("MOTION_RUNTIME:"));
    assert.equal(receipt.length, 1);
    assert.match(receipt[0], /^MOTION_RUNTIME: not pre-warmed \(.+\); run: litclaude-ai motion-runtime install$/u);
  });

  it("the engine's npm ci drops npm's global-install settings inherited from a global postinstall", { skip: process.platform === "win32" ? "POSIX fake npm" : false }, async (t) => {
    const npm = fakeNpm();
    t.after(() => rmSync(npm.dir, { recursive: true, force: true }));
    const env = { ...process.env, ...npmGlobalInstallEnv, PATH: npm.path, LITCLAUDE_MOTION_RUNTIME: temp("lit-motion-npm-env-") };
    delete env.LITCLAUDE_MOTION_MIRROR;
    await assert.rejects(runtime.installNode({ env }), /npm ci exited 1/u);
    const [call] = npm.calls();
    assert.equal(call.args, "ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error");
    assert.deepEqual(npmGlobalModeKeys(call.env), [], "no global mode reaches npm ci");
    assert.ok(call.env.includes("npm_config_registry=http://127.0.0.1:9/"), "registry settings pass through");
    assert.equal(env.npm_config_global, "true", "the caller's env is left alone");
  });

  it("the doctor prints all five probes, naming the fix when the cache is cold", () => {
    const r = run([join(skillRoot, "scripts", "motion-doctor.mjs")], { LITCLAUDE_MOTION_RUNTIME: temp("lit-motion-doctor-") });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split("\n");
    assert.deepEqual(lines.map((l) => l.split(":")[0]), ["MOTION_CHROME", "MOTION_FFMPEG", "MOTION_WEBGL2", "MOTION_SOFTWARE_GL", "MOTION_PREWARM"]);
    assert.match(lines[4], /NOT READY — missing: .*run litclaude-ai motion-runtime install/u);
  });
});

describe("lit-typographic-motion determinism (MO-C-09, MO-A-24/25)", () => {
  it("two independent processes on the SwiftShader rung give byte-identical frames, and a seeked stateful frame equals the sequential one", async (t) => {
    if (needsRender(t)) return;
    const { planFromBrief } = await import(join(skillRoot, "engine", "node", "brief.mjs"));
    const { openSession } = await import(join(skillRoot, "engine", "node", "session.mjs"));
    const { analyzeFrame } = await import(join(skillRoot, "engine", "node", "analysis.mjs"));
    const { planFontKeys } = await import(join(skillRoot, "engine", "node", "coverage.mjs"));
    const plan = planFromBrief({ shots: [{ scene: "signature", text: "determinism" }, { scene: "end-card", text: "끝" }] });
    const fontKeys = planFontKeys(plan);
    const env = { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM };
    const runDir = temp("lit-motion-det-");
    const target = Math.round(plan.shots[0].start * 60) + 30;
    const hashes = async ({ frames, softwareOnly }) => {
      const s = await openSession({ plan, fontKeys, runDir, env, softwareOnly });
      const out = new Map();
      try {
        for (const [from, to] of frames) {
          await s.render({ from, to, fps: 60, samples: 2, shutter: 0.5, tag: "t" }, async (meta, bytes) => {
            out.set(meta.frame, analyzeFrame(bytes, meta.width, meta.height).rgbaSha256);
          });
        }
        return { out, renderer: s.renderer };
      } finally {
        await s.close();
      }
    };
    const a = await hashes({ frames: [[target, target + 1]], softwareOnly: true });
    const b = await hashes({ frames: [[target, target + 1]], softwareOnly: true });
    assert.match(a.renderer, /swiftshader/iu);
    assert.equal(a.out.get(target), b.out.get(target), "same t, same seed, two processes, SwiftShader");
    // Sequential: frames target-20 .. target in order. Seeked: target alone (preroll replay).
    const seq = await hashes({ frames: [[target - 20, target + 1]], softwareOnly: true });
    assert.equal(seq.out.get(target), a.out.get(target), "the seeked stateful frame equals the sequential frame line");
  });

  it("terminalcore draws the same frame whether its window chrome was just drawn or kept from an earlier frame", async (t) => {
    if (needsRender(t)) return;
    const { planFromBrief } = await import(join(skillRoot, "engine", "node", "brief.mjs"));
    const { openSession } = await import(join(skillRoot, "engine", "node", "session.mjs"));
    const { analyzeFrame } = await import(join(skillRoot, "engine", "node", "analysis.mjs"));
    const { planFontKeys } = await import(join(skillRoot, "engine", "node", "coverage.mjs"));
    const plan = planFromBrief({ style: "terminalcore", shots: [{ scene: "title-slam", text: "chrome check" }, { scene: "end-card", text: "done" }] });
    const env = { ...process.env, LITCLAUDE_MOTION_RUNTIME: WARM };
    const hash = async (from, to, frame) => {
      const s = await openSession({ plan, fontKeys: planFontKeys(plan), runDir: temp("lit-motion-chrome-"), env, softwareOnly: true });
      let h = null;
      try {
        await s.render({ from, to, fps: 60, samples: 1, shutter: 0.5, tag: "t" }, async (meta, bytes) => {
          if (meta.frame === frame) h = analyzeFrame(bytes, meta.width, meta.height).rgbaSha256;
        });
      } finally {
        await s.close();
      }
      return h;
    };
    const target = 90;
    const first = await hash(target, target + 1, target);
    const later = await hash(target - 30, target + 1, target);
    assert.ok(first);
    assert.equal(later, first, "the meter-strip re-upload leaves the frame identical to a full chrome draw");
  });

  it("times a stateful shot as the film renders it, not with a preroll replay per sampled frame (MO-D-02)", (t) => {
    if (needsRender(t)) return;
    const dir = temp("lit-motion-perf-");
    const r = run([motion, "perf", briefFile(dir, { shots: [{ scene: "title-slam", text: "Steady" }, { scene: "signature", text: "steady pen" }, { scene: "end-card", text: "끝", hold: 3 }] }), "--out", join(dir, "out")], { LITCLAUDE_MOTION_RUNTIME: WARM });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const perf = JSON.parse(readFileSync(join(dir, "out", ".run", "perf.json"), "utf8"));
    assert.ok(perf.p95 < 3 * perf.p50, `p95 ${perf.p95} ms vs p50 ${perf.p50} ms: sampled frames paid a preroll replay`);
  });
});

describe("lit-typographic-motion packed install (isolated HOME)", () => {
  it("installs from the packed tarball; the skill, engine and runtime command work from the install", () => {
    const work = temp("lit-motion-packed-");
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", work], { cwd: root, encoding: "utf8", env: { ...process.env, npm_config_cache: join(work, ".npm") } });
    assert.equal(pack.status, 0, pack.stderr);
    const tgz = join(work, pack.stdout.trim().split("\n").pop());
    const size = readFileSync(tgz).length;
    assert.ok(size < 64 * 1024 * 1024, `tarball ${size} B`);
    assert.equal(spawnSync("tar", ["-xzf", tgz, "-C", work]).status, 0);
    const pkg = join(work, "package");
    const home = join(work, "home");
    mkdirSync(home);
    const env = { HOME: home, LITCLAUDE_HOME: join(home, ".litclaude"), CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDE_HOME: join(home, ".claude"), LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_MOTION_PREWARM: "0", LITCLAUDE_MOTION_RUNTIME: join(home, "cache") };
    const install = run([join(pkg, "bin", "litclaude-ai.js"), "install", "--yes"], env, home);
    assert.equal(install.status, 0, install.stdout + install.stderr);
    const pluginPath = /Plugin path: (.+)/u.exec(install.stdout)[1].trim();
    const installedSkill = join(pluginPath, "skills", "lit-typographic-motion");
    for (const f of ["SKILL.md", "engine/NOTICE", "engine/package-lock.json", "engine/web/engine.mjs", "fonts/manifest.json", "fonts/stroke/CREDITS"]) assert.ok(existsSync(join(installedSkill, f)), f);
    const help = run([join(installedSkill, "scripts", "motion.mjs"), "--help"], env, home);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /lit-typographic-motion render CLI \(LitClaude\)/u);
    const status = run([join(pkg, "bin", "litclaude-ai.js"), "motion-runtime", "status"], env, home);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /pre-warm: NOT READY — run litclaude-ai motion-runtime install/u);
    const reused = join(pluginPath, "skills", "lit-pptx", "fonts", "pretendard", "Pretendard-Bold.otf");
    assert.equal(createHash("sha256").update(readFileSync(reused)).digest("hex"), "2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7", "the reused Hangul pair ships with the install");
  });
});
