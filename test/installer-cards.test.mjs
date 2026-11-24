// The real installer at a real terminal (a pty), in a throwaway home: the cards an interactive install draws.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const skip = process.platform === "win32";
const strip = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, "");
const COLOUR = "Status-line colour";
const STYLE = "Output style";
const FONT = "Icon font [y/N]";
const CREDIT = "Co-Authored-By line [Y/n]";
const BLOCK = "LitFamily block [Y/n]";

const session = (steps, { env = {}, size = [80, 40], prepare = () => {}, source = () => root } = {}) => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-cards-"));
  try {
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) {
      if (/^LITCLAUDE_/u.test(key) || ["CI", "NO_COLOR", "FORCE_COLOR", "CLAUDE_HOME", "NODE_OPTIONS", "XDG_DATA_HOME", "XDG_CACHE_HOME"].includes(key)) delete childEnv[key];
    }
    Object.assign(childEnv, {
      HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), LITCLAUDE_HOME: join(home, ".litclaude"),
      LC_ALL: "C.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor",
      LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", NO_UPDATE_NOTIFIER: "1",
    }, env);
    prepare(home);
    const result = spawnSync("python3", [join(root, "test/helpers/installer-keys.py"), process.execPath, join(source(home), "bin/litclaude-ai.js"), "install"], {
      cwd: home, env: childEnv, encoding: "utf8", timeout: 60_000,
      input: JSON.stringify({ size, steps: steps.map(([text, keys, pause = 0]) => [text, keys, pause]) }),
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const run = JSON.parse(result.stdout);
    assert.equal(run.timedOut, false, strip(run.output));
    assert.equal(run.steps, steps.length, strip(run.output));
    assert.equal(run.cooked, true, "the terminal is back in cooked mode with echo");
    assert.equal(run.output.lastIndexOf("\x1b[?25h") >= run.output.lastIndexOf("\x1b[?25l"), true, "the cursor is shown again");
    const read = (path) => (existsSync(join(home, path)) ? readFileSync(join(home, path), "utf8") : null);
    return {
      exit: run.exit,
      text: strip(run.output).replaceAll("\r", ""),
      settings: JSON.parse(read(".claude/settings.json") ?? "null"),
      config: JSON.parse(read(".litclaude/config.json") ?? "{}"),
      claudeMd: read(".claude/CLAUDE.md"),
      installed: existsSync(join(home, ".claude/plugins/cache/litclaude-ai/litclaude", version)),
      fonts: existsSync(join(home, process.platform === "darwin" ? "Library/Fonts" : ".local/share/fonts")),
    };
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
};

test("Enter all the way stores today's defaults and ends on the summary", { skip }, () => {
  const run = session([[COLOUR, "\r"], [STYLE, "\r"], [FONT, "\r"], [CREDIT, "\r"], [BLOCK, "\r"]]);
  assert.equal(run.exit, 0, run.text);
  assert.equal(run.settings.litclaude.hudAccent, "cyan");
  assert.equal(run.settings.outputStyle, undefined);
  assert.equal(run.settings.attribution, undefined);
  assert.deepEqual(run.config, { attribution: "keep" });
  assert.match(run.claudeMd, /LitFamily/u);
  assert.equal(run.fonts, false, "the icon font stays off by default");
  for (const step of [1, 2, 3, 4, 5]) assert.ok(run.text.includes(`LIT ${step}/5`), `LIT ${step}/5`);
  for (const fact of [`LitClaude ${version} is installed`, "litclaude@litclaude-ai", "~/.litclaude/marketplaces/litclaude-ai", "LitClaude status line, cyan", "Permissions", "motion full", "host-owned", "Desktop app", "launch with: claude", "claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills"]) assert.ok(run.text.includes(fact), fact);
  assert.match(run.text, /\nINSTALL_PASS: LitClaude \S+ installed\n/u);
  assert.doesNotMatch(run.text, /Choose LitClaude|INSTALL_STEP|Color 1-10/u);
});

test("arrows, digits and letters store what they chose", { skip }, () => {
  const run = session([[COLOUR, "\x1b[B\x1b[B"], ["teal", "\r"], [STYLE, "3"], ["ELI5", "\r"], [FONT, "n"], [CREDIT, "n"], [BLOCK, "n"]], { size: [110, 50] });
  assert.equal(run.exit, 0, run.text);
  assert.equal(run.settings.litclaude.hudAccent, "teal");
  assert.equal(run.settings.outputStyle, "LitClaude — ELI5");
  assert.deepEqual(run.settings.attribution.commit, "");
  assert.deepEqual(run.config, { attribution: "off", agentFile: "off" });
  assert.equal(run.claudeMd, null);
});

test("Ctrl+C at any question before the install leaves nothing behind", { skip }, () => {
  const before = [[COLOUR, "\r"], [STYLE, "\r"]];
  for (const steps of [[[COLOUR, "\x03"]], [...before.slice(0, 1), [STYLE, "\x03"]], [...before, [FONT, "\x03"]], [[COLOUR, "\x04"]]]) {
    const run = session(steps);
    assert.equal(run.exit, 1);
    assert.match(run.text, /Aborted with Ctrl\+[CD]\n$/u);
    assert.deepEqual([run.installed, run.settings, run.claudeMd], [false, null, null]);
  }
});

test("Ctrl+C at a late question still reports the install that is already done", { skip }, () => {
  const run = session([[COLOUR, "\r"], [STYLE, "\r"], [FONT, "\r"], [CREDIT, "\x03"]]);
  assert.equal(run.exit, 1);
  assert.equal(run.installed, true);
  assert.deepEqual([run.config, run.claudeMd], [{}, null]);
  assert.match(run.text, /Co-Authored-By +not answered; left as it was/u);
  assert.match(run.text, /CLAUDE\.md +not answered; left as it was/u);
  assert.match(run.text, /INSTALL_PASS/u);
  assert.match(run.text, /Aborted with Ctrl\+C\n$/u);
});

test("the Enter people press after y or n does not answer the next question", { skip }, () => {
  const run = session([[COLOUR, "\r"], [STYLE, "\r"], [FONT, "n\r"], [CREDIT, "n", 0.1], ["off", "\r", 0.6], [BLOCK, "n"]]);
  assert.equal(run.exit, 0, run.text);
  assert.deepEqual(run.config, { attribution: "off", agentFile: "off" });
});

test("questions already settled are not asked, and the count says so", { skip }, () => {
  const run = session([[COLOUR, "\r"], [STYLE, "\r"], [FONT, "\r"]], {
    prepare: (home) => {
      mkdirSync(join(home, ".litclaude"));
      writeFileSync(join(home, ".litclaude/config.json"), `${JSON.stringify({ attribution: "keep", agentFile: "off" })}\n`);
    },
  });
  assert.equal(run.exit, 0, run.text);
  assert.ok(run.text.includes("LIT 3/3"));
  assert.match(run.text, /CLAUDE\.md +off/u);
});

test("warnings reach the summary whole", { skip }, () => {
  const run = session([[COLOUR, "\r"], [STYLE, "1"], ["ASD", "\r"], [FONT, "y"]], {
    size: [110, 50],
    env: { LITCLAUDE_ICON_FONT_SOURCE: "/dev/null" },
    prepare: (home) => {
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, "notes.md"), "mine\n");
      symlinkSync(join(home, "notes.md"), join(home, ".claude/CLAUDE.md"));
      writeFileSync(join(home, ".claude/settings.json"), `${JSON.stringify({ outputStyle: "Mine", attribution: { commit: "mine" }, litclaude: { attributionPrior: null } })}\n`);
      mkdirSync(join(home, ".litclaude"));
      writeFileSync(join(home, ".litclaude/config.json"), `${JSON.stringify({ attribution: "off" })}\n`);
    },
  });
  assert.equal(run.exit, 0, run.text);
  const said = run.text.replace(/[│\s]+/gu, " ");
  assert.match(said, /! Output style outputStyle was changed outside LitClaude \(currently "Mine"\)/u);
  assert.doesNotMatch(said, /✓ Output style LitClaude/u, "a style that was not applied is not reported as installed");
  assert.match(said, /! Icon font \/dev\/null is not a regular file/u);
  assert.match(said, /Co-Authored-By off; your own attribution setting in settings\.json was left as it is/u);
  assert.match(said, /! CLAUDE\.md symlink .*CLAUDE\.md; left as it is/u);
  assert.equal(run.fonts, false);
  assert.equal(run.settings.outputStyle, "Mine");
});

test("a failed stage says where and why, and reports no success", { skip }, () => {
  const run = session([[COLOUR, "\r"], [STYLE, "\r"], [FONT, "\r"]], {
    source: (home) => {
      const source = join(home, "incomplete");
      mkdirSync(source);
      for (const entry of ["bin", "plugins", "package.json"]) cpSync(join(root, entry), join(source, entry), { recursive: true });
      rmSync(join(source, "plugins/litclaude/bin/litclaude-hook.js"));
      return source;
    },
  });
  assert.equal(run.exit, 1);
  assert.doesNotMatch(run.text, /INSTALL_PASS|is installed/u);
  const said = run.text.replace(/[│\s]+/gu, " ");
  assert.match(said, /INSTALL STOPPED.*Stage 05 \/ 05 · INSTALL VERIFICATION.*installed plugin is missing bin\/litclaude-hook\.js.*Exit without reporting success/u);
});

test("NO_COLOR draws the cards without colour, and a C locale draws them in ASCII", { skip }, () => {
  const steps = [[COLOUR, "\r"], [STYLE, "\r"], [FONT, "n"], [CREDIT, "y"], [BLOCK, "n"]];
  const plain = session(steps, { env: { NO_COLOR: "1" } });
  assert.equal(plain.exit, 0, plain.text);
  assert.match(plain.text, /╭─\[LIT 1\/5\] Status-line colour/u);
  const ascii = session(steps, { env: { LC_ALL: "C" } });
  assert.equal(ascii.exit, 0, ascii.text);
  assert.match(ascii.text, /\+- LIT 1\/5 +Status-line colour -+\+/u);
  assert.deepEqual([...new Set(ascii.text.match(/[^\x09\x0a\x0d\x20-\x7e]/gu) ?? [])], []);
});
