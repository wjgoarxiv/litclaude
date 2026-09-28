import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const pty = join(root, "test/helpers/installer-pty.py");
const modes = [
  ["CI present-empty", { CI: "" }, true],
  ["NO_COLOR present-empty", { NO_COLOR: "" }, true],
  ["TERM=dumb", { TERM: "dumb" }, false],
  ["non-UTF8 locale", { LC_ALL: "C" }, false],
];
const prompts = [["Color 1-10 or name [cyan]: ", "gold"], ["Style 0-4 [None / keep current]: ", "3"]];

function install({ env = {}, args = ["--yes"], replies = [], blocked = false, stageFailure = false } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "litclaude-terminal-"));
  const claudeHome = join(scratch, "claude");
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (/^LITCLAUDE_/u.test(key) || ["CI", "NO_COLOR", "FORCE_COLOR", "CLAUDE_HOME", "NODE_OPTIONS"].includes(key)) delete childEnv[key];
  }
  Object.assign(childEnv, {
    LC_ALL: "C.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor",
    LITCLAUDE_HOME: join(scratch, "lit"), CLAUDE_CONFIG_DIR: claudeHome,
    LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", NO_UPDATE_NOTIFIER: "1",
  }, env);
  if (blocked) writeFileSync(claudeHome, "not a directory\n");
  try {
    let source = root;
    if (stageFailure) {
      source = join(scratch, "incomplete-candidate");
      mkdirSync(source);
      for (const entry of ["bin", "plugins", "package.json"]) cpSync(join(root, entry), join(source, entry), { recursive: true });
      rmSync(join(source, "plugins/litclaude/bin/litclaude-hook.js"));
    }
    const result = spawnSync("python3", [pty, process.execPath, join(source, "bin/litclaude-ai.js"), "install", ...args], {
      cwd: root, env: childEnv, encoding: "utf8", input: JSON.stringify(replies), timeout: 40_000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const terminal = JSON.parse(result.stdout);
    assert.equal(terminal.timedOut, false, terminal.output);
    assert.equal(terminal.repliesSent, replies.length, terminal.output);
    assert.equal(terminal.exit, blocked || stageFailure ? 1 : 0, terminal.output);
    assert.equal(terminal.cleanup, "child reaped; PTY closed");
    if (blocked || stageFailure) return terminal;
    const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
    const plugin = join(claudeHome, "plugins/cache/litclaude-ai/litclaude", version);
    assert.equal(existsSync(join(plugin, "bin/litclaude-hook.js")), true);
    assert.match(terminal.output, /INSTALL_PASS/u);
    return { ...terminal, settings };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    assert.equal(existsSync(scratch), false);
  }
}

for (const [name, policy, blocks] of modes) {
  it(`actual TTY install obeys no-escape policy for ${name}`, { skip: process.platform === "win32" }, () => {
    for (const explicit of [false, true]) {
      const result = install({
        env: { ...policy, ...(explicit ? { LITCLAUDE_SPINNER: "1", LITCLAUDE_HUD_ACCENT_PROMPT: "1", LITCLAUDE_OUTPUT_STYLE_PROMPT: "1", LITCLAUDE_HUD_ACCENT: "gold", LITCLAUDE_OUTPUT_STYLE: "eli5" } : {}) },
        args: explicit ? ["--yes", "--permission-mode", "balanced"] : ["--yes"],
      });
      assert.doesNotMatch(result.output, /\x1b/u, `${name}; forced=${explicit}`);
      assert.match(result.output, /INSTALL PLAN/u);
      assert.doesNotMatch(result.output, /Choose LitClaude/u);
      assert.equal(/[█▓]/u.test(result.output), blocks);
      if (!blocks) assert.match(result.output, /(?:^|\n)LIT\r?\n/u);
      assert.equal(result.settings.litclaude.permissionMode, explicit ? "balanced" : "safe");
      assert.equal(result.settings.litclaude.hudAccent, explicit ? "gold" : "cyan");
      assert.equal(result.settings.outputStyle, explicit ? "LitClaude — ELI5" : undefined);
    }
    const prompted = install({
      env: { ...policy, LITCLAUDE_SPINNER: "1", LITCLAUDE_HUD_ACCENT_PROMPT: "1", LITCLAUDE_OUTPUT_STYLE_PROMPT: "1" },
      args: [], replies: prompts,
    });
    assert.doesNotMatch(prompted.output, /\x1b/u);
    assert.equal(prompted.settings.litclaude.hudAccent, "gold");
    assert.equal(prompted.settings.outputStyle, "LitClaude — ELI5");
  });
}

for (const mode of ["truecolor", "256"]) {
  it(`actual TTY install preserves ${mode} progress and explicit choices`, { skip: process.platform === "win32" }, () => {
    const env = { COLORTERM: mode === "truecolor" ? "truecolor" : "", LITCLAUDE_SPINNER: "1" };
    const result = install({ env });
    assert.match(result.output, /\x1b\[2K/u);
    const symbolColors = mode === "truecolor"
      ? ["38;2;255;99;55", "38;2;215;247;91", "38;2;242;239;223"]
      : ["38;5;203", "38;5;191", "38;5;230"];
    for (const color of symbolColors) assert.ok(result.output.includes(`\x1b[${color}m`), `missing Ignition symbol color ${color}`);
    if (mode === "256") assert.doesNotMatch(result.output, /\x1b\[38;2;/u);
    assert.match(result.output, /\x1b\[38;5;81m⠋/u);
    assert.match(result.output, /INSTALL RECEIPT/u);
    const prompted = install({ env, args: [], replies: prompts });
    assert.match(prompted.output, /\x1b\[38;5;220m▌\x1b\[0m░░/u);
    assert.match(prompted.output, /\x1b\[0m \| O4\.8 │ ctx/u);
    assert.equal(prompted.settings.litclaude.hudAccent, "gold");
    assert.equal(prompted.settings.outputStyle, "LitClaude — ELI5");
  });
}

it("actual TTY CI presence skips default install questions without --yes", { skip: process.platform === "win32" }, () => {
  const result = install({ env: { CI: "" }, args: [] });
  assert.doesNotMatch(result.output, /\x1b|Choose LitClaude/u);
});

it("actual TTY ownership refusals also obey every no-escape policy", { skip: process.platform === "win32" }, () => {
  for (const [, policy] of modes) {
    const result = install({ env: { ...policy, LITCLAUDE_SPINNER: "1" }, blocked: true });
    assert.doesNotMatch(result.output, /\x1b|INSTALL_PASS/u);
    assert.match(result.output, /INSTALL_OWNERSHIP_CONFLICT/u);
  }
});


it("actual TTY Verify-stage failure retains stopped receipts and every no-escape policy", { skip: process.platform === "win32" }, () => {
  for (const [, policy] of modes) {
    const result = install({ env: { ...policy, LITCLAUDE_SPINNER: "1" }, stageFailure: true });
    assert.doesNotMatch(result.output, /\x1b|INSTALL_PASS/u);
    assert.match(result.output, /INSTALL STOPPED/u);
    assert.match(result.output, /Stage\s+05 \/ 05 · INSTALL VERIFICATION/u);
    assert.match(result.output, /installed plugin is missing bin\/litclaude-hook\.js/u);
    assert.match(result.output, /Exit without reporting success/u);
  }
});
