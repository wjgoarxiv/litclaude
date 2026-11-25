// One rule for round caps (lib/mod/round.mjs), read by the status line, the card and the installer.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { drawsRoundCaps, findNerdFont, fontFolders, glyphSetting, roundCaps } from "../plugins/litclaude/lib/mod/round.mjs";
import { nerdFontInstalledCached, roundCapsHere, storedGlyphs } from "../plugins/litclaude/lib/round-caps.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const never = () => assert.fail("the fonts were not to be asked");
const file = (name) => ({ name, kind: "file", isLink: false });
const dir = (name) => ({ name, kind: "dir", isLink: false });
const inTmp = async (run) => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-round-"));
  try {
    return await run(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

test("the setting wins, then the terminal, then SSH says no, then an installed Nerd Font", async () => {
  const ask = (env, { font, ...rest } = {}) => roundCaps({ env, hasFont: font === undefined ? never : () => font, ...rest });
  for (const value of ["nerd", "round"]) assert.equal(await ask({ LITCLAUDE_HUD_GLYPHS: value, SSH_CONNECTION: "x" }), true, value);
  assert.equal(await ask({ LITCLAUDE_HUD_GLYPHS: "basic", WT_SESSION: "x" }), false);
  for (const env of [{ WT_SESSION: "x" }, { TERM_PROGRAM: "vscode" }, { TERM_PROGRAM: "WezTerm" }, { TERM_PROGRAM: "ghostty" }, { TERM: "xterm-kitty" }, { KITTY_WINDOW_ID: "1" }]) {
    assert.equal(drawsRoundCaps(env), true, JSON.stringify(env));
    assert.equal(await ask(env), true, JSON.stringify(env));
    assert.equal(await ask({ ...env, SSH_CONNECTION: "x" }), true, "the terminal's own word holds over SSH");
    assert.equal(await ask(env, { setting: "basic" }), false);
  }
  for (const env of [{}, { TERM_PROGRAM: "Apple_Terminal" }, { TERM_PROGRAM: "iTerm.app" }, { TERM_PROGRAM: "tmux", TERM: "tmux-256color" }, { LITCLAUDE_HUD_GLYPHS: "nonsense" }]) {
    assert.equal(drawsRoundCaps(env), false);
    for (const font of [true, false]) assert.equal(await ask(env, { font }), font, JSON.stringify(env));
    assert.equal(await ask({ ...env, SSH_CONNECTION: "x" }), false, "the fonts here are not the ones on screen");
  }
});

test("the variable, then the card's option, then auto", () => {
  assert.equal(glyphSetting({}, "auto"), "auto");
  assert.equal(glyphSetting({}, undefined), "auto");
  assert.equal(glyphSetting(undefined, "nerd"), "nerd");
  assert.equal(glyphSetting({ LITCLAUDE_HUD_GLYPHS: "basic" }, "nerd"), "basic");
  assert.equal(glyphSetting({ LITCLAUDE_HUD_GLYPHS: "" }, "basic"), "basic");
  assert.equal(storedGlyphs({ pluginConfigs: { "other@x": { options: { glyphs: "nerd" } }, "litclaude@anything": { options: { glyphs: "basic" } } } }), "basic");
  for (const settings of [null, {}, { pluginConfigs: {} }, { pluginConfigs: { "litclaude@x": {} } }]) assert.equal(storedGlyphs(settings), undefined);
});

test("a Nerd Font is told by its file name alone, in a bounded look", async () => {
  const found = (tree) => findNerdFont((path) => { if (!(path in tree)) throw new Error("ENOENT"); return tree[path]; }, ["/f"]);
  for (const name of ["JetBrainsMonoNerdFont-Regular.ttf", "SymbolsNerdFontMono-Regular.ttf", "Hack Nerd Font Mono.otf", "HackNFM-Bold.ttf", "CaskaydiaCoveNF-Regular.TTC", "meslo-nerd-font.otf"]) assert.equal(await found({ "/f": [file(name)] }), true, name);
  for (const name of ["Menlo.ttc", "Inter.ttf", "NerdFont-readme.txt", "ConfigNF.ttf.bak", "Infinity.ttf", "SFNSMono.ttf"]) assert.equal(await found({ "/f": [file(name)] }), false, name);
  assert.equal(await found({ "/f": [dir("a")], "/f/a": [dir("b")], "/f/a/b": [file("HackNerdFont.ttf")] }), true);
  assert.equal(await found({ "/f": [dir("a")], "/f/a": [dir("b")], "/f/a/b": [dir("c")], "/f/a/b/c": [file("HackNerdFont.ttf")] }), false, "three levels at most");
  assert.equal(await found({ "/f": [{ name: "HackNerdFont.ttf", kind: "other", isLink: true }] }), true, "a linked font counts");
  assert.equal(await found({ "/f": [{ name: "loop", kind: "dir", isLink: true }], "/f/loop": [file("HackNerdFont.ttf")] }), false, "a linked folder is not followed");
  assert.equal(await found({ "/f": [...Array.from({ length: 4000 }, (_, i) => file(`f${i}.ttf`)), file("HackNerdFont.ttf")] }), false, "4,000 names at most");
  let opened = 0;
  assert.equal(await findNerdFont((path) => { opened += 1; return path === "/f" ? Array.from({ length: 900 }, (_, i) => dir(`d${i}`)) : []; }, ["/f"]), false);
  assert.equal(opened, 200, "200 folders at most");
  for (const list of [async () => null, async () => "text", () => { throw new Error("denied"); }]) assert.equal(await findNerdFont(list, ["/f"]), false);
  assert.deepEqual(fontFolders({}), ["/Library/Fonts", "/usr/local/share/fonts", "/usr/share/fonts"]);
  assert.ok(fontFolders({ LOCALAPPDATA: "C:/u", WINDIR: "C:/Windows" }).includes("C:/u/Microsoft/Windows/Fonts"));
});

test("the status line keeps the font answer for a day, or until a font folder changes", () => inTmp(async (tmp) => {
  const fonts = join(tmp, "data", "fonts");
  mkdirSync(fonts, { recursive: true });
  const env = { HOME: join(tmp, "home"), XDG_DATA_HOME: join(tmp, "data"), LITCLAUDE_HUD_STATE_ROOT: join(tmp, "state") };
  const saved = join(tmp, "state", "nerd-font.json");
  const first = await nerdFontInstalledCached(env, 1000);
  const record = JSON.parse(readFileSync(saved, "utf8"));
  assert.equal(record.found, first);
  writeFileSync(saved, JSON.stringify({ ...record, found: !first }));
  assert.equal(await nerdFontInstalledCached(env, 2000), !first, "the saved answer is used");
  assert.equal(await nerdFontInstalledCached(env, 1000 + 86_400_001), first, "a day later it looks again");
  writeFileSync(saved, "{broken");
  assert.equal(await nerdFontInstalledCached(env, 3000), first);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  writeFileSync(join(fonts, "HackNerdFont-Regular.ttf"), "");
  assert.equal(await nerdFontInstalledCached(env, 4000), true, "a new font is seen at once");
  rmSync(join(tmp, "state"), { recursive: true });
  writeFileSync(join(tmp, "state"), "a file where the folder should be");
  assert.equal(await nerdFontInstalledCached(env, 5000), true, "no place to save it is no reason to fail");
}));

test("the status line draws what the rule says", { skip: process.platform === "win32" }, () => inTmp(async (tmp) => {
  const config = join(tmp, ".claude");
  mkdirSync(config);
  const line = (env, glyphs) => {
    writeFileSync(join(config, "settings.json"), JSON.stringify({ pluginConfigs: { "litclaude@litclaude-ai": { options: { glyphs } } } }));
    const result = spawnSync(process.execPath, [join(root, "plugins/litclaude/bin/litclaude-hud.js")], {
      cwd: tmp, encoding: "utf8",
      input: JSON.stringify({ model: { display_name: "Opus 5.5" }, context_window: { context_window_size: 1000000, used_percentage: 42 } }),
      env: { PATH: process.env.PATH, HOME: tmp, CLAUDE_CONFIG_DIR: config, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "state"), COLORTERM: "truecolor", TERM: "xterm-256color", LITCLAUDE_HUD_TEST_USAGE: "5h=63,1w=31", ...env },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.replace(/\x1b\[[0-9;]*m/gu, "");
  };
  const expected = (env, glyphs) => roundCapsHere({ env: { HOME: tmp, ...env }, settings: { pluginConfigs: { "litclaude@x": { options: { glyphs } } } } });
  for (const [env, glyphs] of [[{ TERM_PROGRAM: "ghostty" }, "auto"], [{ TERM_PROGRAM: "ghostty" }, "basic"], [{ KITTY_WINDOW_ID: "3" }, "auto"], [{ SSH_CONNECTION: "x" }, "auto"], [{ SSH_CONNECTION: "x" }, "nerd"], [{ LITCLAUDE_HUD_GLYPHS: "basic", WT_SESSION: "x" }, "nerd"], [{}, "auto"]]) {
    const round = await expected(env, glyphs);
    const drawn = line(env, glyphs);
    const where = JSON.stringify([env, glyphs]);
    if (round) {
      assert.match(drawn, /\ue0b6[^\ue0b4]*LIT[^\ue0b6]*\ue0b4/u, where);
      assert.doesNotMatch(drawn, /[░▒▓▯]/u, where);
    } else {
      assert.doesNotMatch(drawn, /[\ue0b4\ue0b6]/u, where);
      assert.match(drawn, /░/u, where);
    }
  }
}));

test("a linked font folder and a missing home are no reason to fail", { skip: process.platform === "win32" }, () => inTmp(async (tmp) => {
  mkdirSync(join(tmp, "real"));
  writeFileSync(join(tmp, "real", "HackNerdFont.ttf"), "");
  mkdirSync(join(tmp, "data"));
  symlinkSync(join(tmp, "real"), join(tmp, "data", "fonts"));
  assert.equal(await roundCapsHere({ env: { HOME: join(tmp, "none"), XDG_DATA_HOME: join(tmp, "data") }, settings: null }), true, "the font folder itself may be a link");
  assert.equal(typeof await roundCapsHere({ env: {}, settings: null }), "boolean");
}));
