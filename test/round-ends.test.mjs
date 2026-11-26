// `--round`, `--glyphs` and the ROUND_ENDS line: what the installer says about round ends must match the files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { ICON_FONT, installIconFont, iconFontManifestPath, terminalFontHint } from "../bin/icon-font.mjs";
import { roundEndsLine } from "../bin/round-ends.mjs";
import { glyphSetting, glyphWord, roundCaps } from "../plugins/litclaude/lib/mod/round.mjs";
import { MOD_CHOICES, normalizeModSettings, resolveGlyphs } from "../plugins/litclaude/lib/mod/settings.mjs";
import { iconFontCandidates } from "../plugins/litclaude/lib/mod/state.mjs";
import { nerdFontInstalled } from "../plugins/litclaude/lib/round-caps.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const skip = process.platform === "win32";
const FONT_NAME = "SymbolsNerdFontMono-Regular.ttf";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const zip = (entries) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const body = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(Buffer.byteLength(name), 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(Buffer.byteLength(name), 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, Buffer.from(name), body);
    centrals.push(central, Buffer.from(name));
    offset += local.length + Buffer.byteLength(name) + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};
const FONT = Buffer.from("fixture font ".repeat(40));
const LICENSE = Buffer.from("fixture licence\n");
const ARCHIVE = zip([[FONT_NAME, FONT], ["LICENSE", LICENSE]]);

// The pins are part of the product, so the CLI runs from a copy whose pins name the small fixture archive.
const withCli = (work) => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-round-ends-"));
  try {
    const home = join(dir, "home");
    const source = join(dir, "source");
    mkdirSync(join(home, "tmp"), { recursive: true });
    mkdirSync(source);
    for (const entry of ["bin", "plugins", "package.json"]) cpSync(join(root, entry), join(source, entry), { recursive: true });
    const pins = join(source, "bin/icon-font.mjs");
    let text = readFileSync(pins, "utf8").replace(ICON_FONT.archiveSha256, sha256(ARCHIVE));
    for (const file of ICON_FONT.files) text = text.replace(file.sha256, sha256(file.kind === "font" ? FONT : LICENSE));
    writeFileSync(pins, text);
    writeFileSync(join(dir, "font.zip"), ARCHIVE);
    const env = (extra) => ({
      PATH: "/usr/bin:/bin", HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), LITCLAUDE_HOME: join(home, ".litclaude"), XDG_DATA_HOME: join(home, ".local/share"),
      TMPDIR: join(home, "tmp"), LANG: "en_US.UTF-8", TERM: "xterm-256color", NO_UPDATE_NOTIFIER: "1", LITCLAUDE_NO_AUTO_UPDATE: "1",
      LITCLAUDE_ICON_FONT_SOURCE: join(dir, "font.zip"), ...extra,
    });
    const bin = join(source, "bin/litclaude-ai.js");
    const raw = (args, extra) => spawnSync(process.execPath, [bin, ...args], { cwd: home, encoding: "utf8", timeout: 60_000, env: env(extra) });
    const run = (args, extra) => {
      const result = raw(args, extra);
      assert.equal(result.status, 0, result.stderr);
      return { ...result, ends: result.stdout.split("\n").filter((line) => line.startsWith("ROUND_ENDS:")) };
    };
    const pty = (args, extra, steps = []) => {
      const result = spawnSync("python3", [join(root, "test/helpers/installer-keys.py"), process.execPath, bin, ...args], { cwd: home, env: env(extra), encoding: "utf8", timeout: 60_000, input: JSON.stringify({ size: [100, 40], steps }) });
      assert.equal(result.status, 0, result.stderr);
      const out = JSON.parse(result.stdout);
      assert.equal(out.timedOut, false, out.output);
      assert.equal(out.exit, 0, out.output);
      const lines = out.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, "").replaceAll("\r", "").split("\n");
      return { lines, text: lines.join("\n"), ends: lines.filter((line) => line.startsWith("ROUND_ENDS:")) };
    };
    const fonts = join(home, process.platform === "darwin" ? "Library/Fonts" : ".local/share/fonts");
    const settings = () => JSON.parse(readFileSync(join(home, ".claude/settings.json"), "utf8"));
    const glyphs = () => settings().pluginConfigs["litclaude@litclaude-ai"].options.glyphs;
    return work({ dir, home, source, fonts, raw, run, pty, settings, glyphs, font: join(fonts, FONT_NAME) });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
};
// A Nerd Font in a system-wide folder of this machine counts as "already here", and no test can hide it.
const systemFont = await nerdFontInstalled({ HOME: "/nonexistent", XDG_DATA_HOME: "/nonexistent" });

const base = { env: {}, platform: "darwin", surface: "on", saved: "auto", fontHere: false, tty: false };
const line = (extra) => roundEndsLine({ ...base, ...extra });

test("the line: shown, ready, check or square, each by its own fact", () => {
  assert.equal(line({ saved: "round" }), "ROUND_ENDS: shown");
  assert.equal(line({ saved: "round", env: { SSH_CONNECTION: "x" } }), "ROUND_ENDS: shown", "a saved round holds over SSH");
  for (const env of [{ WT_SESSION: "x" }, { TERM_PROGRAM: "vscode" }, { TERM_PROGRAM: "ghostty" }, { TERM_PROGRAM: "WezTerm" }, { TERM: "xterm-kitty" }, { KITTY_WINDOW_ID: "1" }]) {
    assert.equal(line({ env }), "ROUND_ENDS: ready in a dark full-colour terminal");
    assert.equal(line({ env: { ...env, COLORTERM: "truecolor" }, tty: true }), "ROUND_ENDS: ready");
  }
  assert.match(line({ fontHere: true }), /^ROUND_ENDS: check \(an icon font is here, .*; show your user the test pill .*\)$/u, "an installed font alone is no proof");
  assert.match(line({ fontHere: true, env: { SSH_CONNECTION: "x" } }), /^ROUND_ENDS: square \(SSH; .*--glyphs round.*\)$/u);
  assert.match(line({}), /^ROUND_ENDS: square \(no icon font; npx --yes @litfamily\/litclaude@latest update --yes --round\)$/u);
  assert.match(line({ fontProblem: "HTTP 404" }), /^ROUND_ENDS: square \(font not installed \(HTTP 404\); .*update --yes --round.*\)$/u);
  assert.equal(line({ fontProblem: "a\nb" }).includes("\n"), false, "one line whatever the failure said");
  assert.match(line({ platform: "win32" }), /^ROUND_ENDS: square \(Windows console; .*Windows Terminal.*\)$/u);
  for (const saved of ["square", "basic"]) assert.match(line({ saved, env: { TERM_PROGRAM: "ghostty" } }), /^ROUND_ENDS: square \(choice is square; .*--glyphs auto\)$/u);
  assert.match(line({ surface: "off", saved: "round" }), /^ROUND_ENDS: square \(no surface enabled; .*config band always\)$/u);
  assert.match(line({ surface: "disabled", saved: "round" }), /^ROUND_ENDS: square \(no surface enabled; .*\/plugin.*\)$/u);
});

test("the environment wins over the saved choice, and an unseen explicit choice asks for a look", () => {
  assert.match(line({ saved: "round", env: { LITCLAUDE_HUD_GLYPHS: "square" } }), /choice is square; unset LITCLAUDE_HUD_GLYPHS/u);
  assert.match(line({ saved: "round", env: { LITCLAUDE_HUD_GLYPHS: "auto" } }), /no icon font/u, "auto in the environment undoes a saved round");
  for (const word of ["round", "nerd"]) assert.match(line({ env: { LITCLAUDE_HUD_GLYPHS: word } }), /^ROUND_ENDS: check \(LITCLAUDE_HUD_GLYPHS is /u);
  assert.match(line({ saved: "nerd" }), /^ROUND_ENDS: check \(the saved choice is nerd/u);
  assert.equal(line({ saved: "nerd", env: { TERM_PROGRAM: "ghostty", COLORTERM: "truecolor" }, tty: true }), "ROUND_ENDS: ready");
});

test("colour and ground count only when stdout is a terminal", () => {
  const ghostty = { TERM_PROGRAM: "ghostty", COLORTERM: "truecolor" };
  for (const [env, reason] of [[{ NO_COLOR: "" }, "NO_COLOR"], [{ TERM: "dumb" }, "TERM=dumb"], [{ LITCLAUDE_HUD_APPEARANCE: "light" }, "light ground"], [{ LITCLAUDE_HUD_COLOR_DEPTH: "256" }, "fewer colours than truecolor"]]) {
    assert.ok(line({ env: { ...ghostty, ...env }, tty: true }).startsWith(`ROUND_ENDS: square (${reason}; `), reason);
    assert.ok(line({ env: { ...ghostty, ...env }, saved: "round", tty: true }).startsWith(`ROUND_ENDS: square (${reason}; `), reason);
    assert.equal(line({ env: { ...ghostty, ...env } }), "ROUND_ENDS: ready in a dark full-colour terminal", reason);
  }
});

test("one set of words: environment, saved choice, card option", async () => {
  assert.deepEqual(["auto", "round", "nerd", "square", "basic", "nonsense", undefined].map(glyphWord), ["auto", "round", "nerd", "basic", "basic", null, null]);
  assert.equal(glyphSetting({ LITCLAUDE_HUD_GLYPHS: "auto" }, "round"), "auto");
  assert.equal(glyphSetting({ LITCLAUDE_HUD_GLYPHS: "square" }, "round"), "basic");
  assert.equal(glyphSetting({}, "square"), "basic");
  assert.equal(await roundCaps({ env: { SSH_CONNECTION: "x" }, setting: glyphSetting({}, "round") }), true);
  for (const word of ["auto", "round", "square", "nerd", "basic"]) {
    assert.ok(MOD_CHOICES.glyphs.includes(word));
    assert.equal(normalizeModSettings({ glyphs: word }).glyphs, word);
  }
  assert.equal(resolveGlyphs("round", "terminal", false), "round");
  assert.equal(resolveGlyphs("round", "terminal", true), "nerd", "like the variable's round, the icons come too when the font is here");
  assert.equal(resolveGlyphs("square", "terminal", true, true), "basic");
  assert.equal(resolveGlyphs("round", "desktop", true, true), "basic");
});

test("the docs give the glyphs fix as a command that runs as it stands", () => {
  for (const path of ["README.md", "README_ko-KR.md", "docs/guide.md", "docs/guide_ko-KR.md"]) {
    const text = readFileSync(join(root, path), "utf8");
    assert.doesNotMatch(text, /`update --glyphs/u, path);
    assert.match(text, /`npx --yes @litfamily\/litclaude@latest update --yes --glyphs square`/u, path);
  }
});

test("no hint says a terminal finds the symbols font by itself", () => {
  for (const program of ["Apple_Terminal", "iTerm.app", "vscode", ""]) assert.doesNotMatch(terminalFontHint({ TERM_PROGRAM: program }), /fallback usually|usually finds/u);
  assert.match(terminalFontHint({ TERM_PROGRAM: "Apple_Terminal" }), /no fallback font setting.*full Nerd Font/u);
  for (const path of ["README.md", "README_ko-KR.md", "docs/hooks.md", "docs/guide.md", "docs/guide_ko-KR.md"]) assert.doesNotMatch(readFileSync(join(root, path), "utf8"), /system font fallback/u, path);
});

test("a licence that cannot be written leaves no font behind that uninstall would not know", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-round-partial-"));
  try {
    const litHome = join(dir, ".litclaude");
    const pins = { ...ICON_FONT, archiveSha256: sha256(ARCHIVE), files: ICON_FONT.files.map((file) => ({ ...file, sha256: sha256(file.kind === "font" ? FONT : LICENSE), name: file.kind === "license" ? "missing/LICENSE.txt" : file.name })) };
    assert.throws(() => installIconFont({ archive: ARCHIVE, platform: "darwin", env: {}, home: dir, litHome, pins }));
    const owned = JSON.parse(readFileSync(iconFontManifestPath(litHome), "utf8")).files.map(({ path }) => path);
    assert.deepEqual(owned, [join(dir, "Library/Fonts", FONT_NAME)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--round adds the pinned font when none is here, says check, and uninstall takes it away", { skip }, (t) => withCli(({ home, fonts, font, run }) => {
  if (systemFont) return t.skip("a Nerd Font is installed system-wide here");
  const dry = run(["install", "--dry-run", "--yes", "--round"]);
  assert.ok(dry.stdout.includes(FONT_NAME) && dry.stdout.includes(fonts), dry.stdout);
  assert.equal(existsSync(fonts), false, "a dry run downloads and writes nothing");
  assert.deepEqual(run(["install", "--yes"]).ends, ["ROUND_ENDS: square (no icon font; npx --yes @litfamily/litclaude@latest update --yes --round)"]);
  assert.equal(existsSync(fonts), false, "a plain install adds no font");
  mkdirSync(join(home, "tmp/litclaude-hud"), { recursive: true });
  writeFileSync(join(home, "tmp/litclaude-hud/nerd-font.json"), "{}");
  const added = run(["update", "--yes", "--round"]);
  assert.deepEqual(readFileSync(font), FONT);
  assert.ok(added.stdout.includes(`ICON_FONT_INSTALLED: ${font}`));
  assert.match(added.ends.join("|"), /^ROUND_ENDS: check \([^|]*\)$/u);
  assert.equal(existsSync(join(home, "tmp/litclaude-hud/nerd-font.json")), false, "the kept font answer is dropped");
  const again = run(["install", "--yes", "--round"]);
  assert.match(again.stdout, /ICON_FONT_PRESENT: an icon font is already here; nothing was added/u);
  assert.match(run(["doctor"]).ends.join("|"), /^ROUND_ENDS: check/u);
  const gone = run(["uninstall"]);
  assert.equal(existsSync(font), false);
  assert.match(gone.stdout, /ICON_FONT_NOTE: other products that used this font may now draw square ends/u);
}));

test("--round leaves a font that is already here alone, linked or not", { skip }, () => withCli(({ dir, fonts, font, run }) => {
  mkdirSync(fonts, { recursive: true });
  writeFileSync(join(dir, "own.ttf"), "own");
  symlinkSync(join(dir, "own.ttf"), font);
  const result = run(["install", "--yes", "--round"], { LITCLAUDE_ICON_FONT_SOURCE: "/nonexistent" });
  assert.match(result.stdout, /ICON_FONT_PRESENT: an icon font is already here/u);
  assert.equal(readFileSync(join(dir, "own.ttf"), "utf8"), "own");
  assert.match(result.ends.join("|"), /^ROUND_ENDS: check/u);
  assert.doesNotMatch(run(["uninstall"]).stdout, /ICON_FONT_(?:REMOVED|NOTE)/u);
}));

test("a blocked folder or a bad archive never fails the install, and the line says why", { skip }, (t) => withCli(({ home, dir, run, pty }) => {
  if (systemFont) return t.skip("a Nerd Font is installed system-wide here");
  writeFileSync(join(dir, "bad.zip"), "not the archive");
  const bad = run(["install", "--yes", "--round"], { LITCLAUDE_ICON_FONT_SOURCE: join(dir, "bad.zip") });
  assert.match(bad.stdout, /INSTALL_PASS/u);
  assert.match(bad.ends.join("|"), /^ROUND_ENDS: square \(font not installed \(the archive's SHA-256 is [0-9a-f]{64}, not the pinned .*\); /u);
  const card = pty(["install", "--round"], { COLORTERM: "truecolor", LITCLAUDE_ICON_FONT_SOURCE: join(dir, "bad.zip") }, [["Status-line colour", "\r", 0.4], ["Output style", "\r", 0.4], ["Co-Authored-By line", "\r", 0.4]]);
  assert.match(card.ends.join("|"), /^ROUND_ENDS: square \(font not installed \(the archive/u);
  const parent = join(home, process.platform === "darwin" ? "Library" : ".local");
  rmSync(parent, { recursive: true, force: true });
  writeFileSync(parent, "in the way");
  const blocked = run(["install", "--yes", "--round"]);
  assert.match(blocked.stdout, /INSTALL_PASS/u);
  assert.match(blocked.ends.join("|"), /^ROUND_ENDS: square \(font not installed \(/u);
}));

test("--glyphs saves the choice, a plain update keeps it, and it is the person's: uninstall leaves it", { skip }, () => withCli(({ raw, run, glyphs, settings }) => {
  for (const args of [["--glyphs"], ["--glyphs", "nerd"], ["--glyphs", "wide"]]) {
    const refused = raw(["install", "--dry-run", ...args]);
    assert.equal(refused.status, 64, args.join(" "));
    assert.match(refused.stderr, /--glyphs must be one of auto, round, square/u);
  }
  run(["install", "--yes"]);
  assert.equal(glyphs(), "auto");
  assert.match(run(["update", "--dry-run", "--glyphs", "round"]).stdout, /Would save the glyphs choice: round/u);
  assert.equal(glyphs(), "auto");
  assert.deepEqual(run(["update", "--yes", "--glyphs", "round"]).ends, ["ROUND_ENDS: shown"]);
  for (const args of [["update", "--yes"], ["update", "--yes", "--round"], ["install"]]) assert.deepEqual(run(args).ends, ["ROUND_ENDS: shown"], args.join(" "));
  assert.equal(glyphs(), "round");
  assert.deepEqual(run(["doctor"], { SSH_CONNECTION: "x" }).ends, ["ROUND_ENDS: shown"]);
  assert.match(run(["update", "--yes", "--glyphs", "square"]).ends[0], /choice is square/u);
  assert.equal(glyphs(), "square");
  run(["uninstall"]);
  assert.equal(settings().pluginConfigs["litclaude@litclaude-ai"].options.glyphs, "square");
}));

test("a kept font answer that cannot be dropped never cuts an install short", { skip }, () => withCli(({ home, run, pty }) => {
  mkdirSync(join(home, "tmp/litclaude-hud/nerd-font.json/held"), { recursive: true });
  for (const command of ["install", "update"]) {
    const { stdout, ends } = run([command, "--yes", "--round"]);
    assert.match(stdout, /^INSTALL_PASS/mu);
    assert.match(stdout, /^AGENT_FILE: /mu);
    assert.match(stdout, /^RESTART: /mu);
    assert.equal(ends.length, 1);
  }
  assert.equal(existsSync(join(home, ".claude/CLAUDE.md")), true);
  const card = pty(["update", "--round"], { COLORTERM: "truecolor" }, [["Status-line colour", "\r", 0.4], ["Output style", "\r", 0.4], ["Co-Authored-By line", "\r", 0.4]]);
  assert.match(card.text, /INSTALL_PASS/u);
  assert.equal(card.ends.length, 1);
}));

test("a linked font folder: the dry run and the install both say so, and nothing goes through it", { skip }, (t) => withCli(({ dir, home, fonts, run }) => {
  if (systemFont) return t.skip("a Nerd Font is installed system-wide here");
  mkdirSync(join(dir, "real"));
  mkdirSync(join(fonts, ".."), { recursive: true });
  symlinkSync(join(dir, "real"), fonts);
  assert.match(run(["install", "--dry-run", "--yes", "--round"]).stdout, /Would skip icon font: .* is a link/u);
  assert.match(run(["install", "--dry-run", "--yes", "--icon-font"]).stdout, /Would skip icon font: .* is a link/u);
  const { stdout, ends } = run(["install", "--yes", "--round"]);
  assert.match(stdout, /^INSTALL_PASS/mu);
  assert.match(ends.join("|"), /^ROUND_ENDS: square \(font not installed \(.* is a link.*\); /u);
  assert.equal(existsSync(join(dir, "real", FONT_NAME)), false);
  assert.equal(existsSync(join(home, ".litclaude/icon-font/manifest.json")), false);
}));

test("a relative XDG_DATA_HOME is ignored by the card's font look too", () => {
  assert.deepEqual(iconFontCandidates({ HOME: "/h", XDG_DATA_HOME: "data" }), iconFontCandidates({ HOME: "/h" }));
  assert.ok(iconFontCandidates({ HOME: "/h", XDG_DATA_HOME: "/data" }).includes(`/data/fonts/${FONT_NAME}`));
});

test("the command hooks.json names for tool calls is required: install and doctor fail without it", { skip }, () => withCli(({ home, source, raw, run }) => {
  run(["install", "--yes"]);
  const { installPath } = JSON.parse(readFileSync(join(home, ".claude/plugins/installed_plugins.json"), "utf8")).plugins["litclaude@litclaude-ai"][0];
  rmSync(join(installPath, "bin/litclaude-guard.js"));
  const doctor = raw(["doctor"]);
  assert.notEqual(doctor.status, 0);
  assert.match(doctor.stdout + doctor.stderr, /missing bin\/litclaude-guard\.js/u);
  cpSync(join(source, "plugins/litclaude/bin/litclaude-guard.js"), join(installPath, "bin/litclaude-guard.js"));
  rmSync(join(source, "plugins/litclaude/bin/litclaude-guard.js"));
  const install = raw(["install", "--yes"]);
  assert.notEqual(install.status, 0);
  assert.match(install.stdout + install.stderr, /installed plugin is missing bin\/litclaude-guard\.js/u);
}));

test("no surface: the person's own status line and the card off", { skip }, () => withCli(({ home, run, settings }) => {
  run(["install", "--yes", "--glyphs", "round"]);
  const file = join(home, ".claude/settings.json");
  writeFileSync(file, JSON.stringify({ ...settings(), statusLine: { type: "command", command: "echo mine" } }));
  assert.deepEqual(run(["doctor"]).ends, ["ROUND_ENDS: shown"], "the card is still on");
  run(["config", "band", "off"]);
  assert.match(run(["doctor"]).ends[0], /no surface enabled/u);
}));

test("the saved round reaches the status line, over SSH too, and the environment undoes it", { skip }, () => withCli(({ home, run }) => {
  run(["install", "--yes", "--glyphs", "round"]);
  const draw = (extra) => spawnSync(process.execPath, [join(root, "plugins/litclaude/bin/litclaude-hud.js")], {
    cwd: home, encoding: "utf8", input: JSON.stringify({ model: { display_name: "Opus 5.5" }, context_window: { context_window_size: 1000000, used_percentage: 42 } }),
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), LITCLAUDE_HUD_STATE_ROOT: join(home, "state"), COLORTERM: "truecolor", TERM: "xterm-256color", SSH_CONNECTION: "x", ...extra },
  }).stdout;
  assert.match(draw({}), //u);
  assert.doesNotMatch(draw({ LITCLAUDE_HUD_GLYPHS: "square" }), //u);
  assert.doesNotMatch(draw({ LITCLAUDE_HUD_GLYPHS: "auto" }), //u);
}));

test("at a terminal: --yes --round, the cards and a card update end on one true line", { skip }, (t) => withCli(({ font, pty, glyphs }) => {
  if (systemFont) return t.skip("a Nerd Font is installed system-wide here");
  const colour = { COLORTERM: "truecolor" };
  assert.deepEqual(pty(["install", "--yes"], colour).ends, ["ROUND_ENDS: square (no icon font; npx --yes @litfamily/litclaude@latest update --yes --round)"]);
  const cards = pty(["install", "--round"], colour, [["Status-line colour", "\r", 0.4], ["Output style", "\r", 0.4], ["Co-Authored-By line", "\r", 0.4]]);
  assert.ok(cards.text.includes("LIT 1/3"), "--round answers the icon-font question");
  assert.doesNotMatch(cards.text, /Icon font \[y\/N\]/u);
  assert.equal(existsSync(font), true);
  assert.equal(cards.ends.length, 1);
  assert.match(cards.ends[0], /^ROUND_ENDS: check/u);
  const saved = pty(["update", "--yes", "--glyphs", "round"], colour);
  assert.deepEqual(saved.ends, ["ROUND_ENDS: shown"]);
  assert.deepEqual(pty(["update", "--yes"], colour).ends, ["ROUND_ENDS: shown"]);
  assert.equal(glyphs(), "round");
  assert.match(pty(["update", "--yes"], { NO_COLOR: "1" }).ends[0], /square \(NO_COLOR; /u);
}));
