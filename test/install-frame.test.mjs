import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { banner, lockup } from "../bin/litfamily-banner.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const makeHome = () => mkdtempSync(join(tmpdir(), "litclaude-frame-home-"));
const makeClaudeHome = () => mkdtempSync(join(tmpdir(), "litclaude-frame-claude-"));

const runCliWithEnv = (args, env) => {
  const childEnv = { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color", ...env };
  if (!Object.hasOwn(env, "NO_COLOR")) delete childEnv.NO_COLOR;
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
};

const runCliAsTty = (args, env) => {
  const childEnv = { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color", ...env };
  for (const name of ["CI", "NO_UPDATE_NOTIFIER", "LITCLAUDE_NO_UPDATE_CHECK"]) delete childEnv[name];
  const source = `
    import { pathToFileURL } from "node:url";
    const [binPath, ...args] = process.argv.slice(1);
    for (const stream of [process.stdin, process.stdout, process.stderr])
      Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
    process.argv = [process.execPath, binPath, ...args];
    await import(pathToFileURL(binPath).href);
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source, binPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
};

describe("shared LitFamily installer frame", () => {
  it("prints the family banner: Ignition B mark, tagline, stage rows", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_SPINNER: "1",
        NO_COLOR: "1",
      });
      assert.equal(result.status, 0, result.stderr);
      const rule = `  ${"━".repeat(46)}`;
      assert.ok(result.stdout.includes(`${rule}\n`), "46-glyph rule line missing");
      assert.equal(result.stdout.split(`${rule}\n`).length - 1 >= 2, true, "banner needs opening and closing rules");
      const expectedWordmark = lockup(`claude v${packageJson.version}`, banner).map((row) => row.trimEnd()).join("\n");
      assert.ok(result.stdout.includes(expectedWordmark), "Ignition B banner lockup missing");
      assert.doesNotMatch(result.stdout, /🔥  l  i  t  claude/u);
      assert.match(result.stdout, /Claude Code-native workflow distribution\./u);
      assert.match(result.stdout, /╭─ INSTALL PLAN/u);
      assert.match(result.stdout, /│ 01 · Plugin {4,}/u);
      assert.match(result.stdout, /│ 05 · Verify {4,}/u);
      assert.match(result.stdout, /╰─ /u);
      assert.doesNotMatch(result.stdout, /\x1b\[/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("prints Model selection: host-owned in the summary on both render paths", () => {
    for (const extraEnv of [{ LITCLAUDE_SPINNER: "1", NO_COLOR: "1" }, { CI: "1" }]) {
      const home = makeHome();
      const claudeHome = makeClaudeHome();
      try {
        const result = runCliWithEnv(["install"], {
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          ...extraEnv,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Model selection: host-owned/u, JSON.stringify(extraEnv));
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(claudeHome, { recursive: true, force: true });
      }
    }
  });
});

describe("--yes non-interactive install", () => {
  it("skips every prompt on a TTY and keeps today's shipped defaults", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const result = runCliAsTty(["install", "--yes"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_SPINNER: "0",
        LITCLAUDE_NO_AUTO_UPDATE: "1",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /Choose LitClaude HUD brand color/u);
      assert.doesNotMatch(result.stdout, /Choose LitClaude output style/u);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.hudAccent, "cyan", "default HUD accent must be preserved");
      assert.equal(settings.outputStyle, undefined, "--yes must not write an output style");
      assert.equal(settings.litclaude.permissionMode, "safe", "default permission mode must stay safe");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("still honors explicit flags and env routes under --yes", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const result = runCliWithEnv(["install", "--yes", "--permission-mode", "balanced"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "eli5",
        CI: "1",
      });
      assert.equal(result.status, 0, result.stderr);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.permissionMode, "balanced");
      assert.equal(settings.outputStyle, "LitClaude — ELI5");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});

describe("uninstall clears the managed output style", () => {
  it("removes settings.outputStyle and tracking keys when LitClaude wrote them", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const install = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "eli5",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
        CI: "1",
      });
      assert.equal(install.status, 0, install.stderr);
      let settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.outputStyle, "LitClaude — ELI5");

      const uninstall = runCliWithEnv(["uninstall"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        CI: "1",
      });
      assert.equal(uninstall.status, 0, uninstall.stderr);
      settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.outputStyle, undefined, "uninstall must clear the LitClaude-written outputStyle");
      assert.equal(settings.litclaude, undefined, "no LitClaude tracking keys may survive uninstall");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("leaves an externally changed outputStyle untouched while removing tracking keys", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const install = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "eli5",
        CI: "1",
      });
      assert.equal(install.status, 0, install.stderr);
      const settingsPath = join(claudeHome, "settings.json");
      const mid = JSON.parse(readFileSync(settingsPath, "utf8"));
      mid.outputStyle = "My Custom Style";
      writeFileSync(settingsPath, `${JSON.stringify(mid, null, 2)}\n`);

      const uninstall = runCliWithEnv(["uninstall"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        CI: "1",
      });
      assert.equal(uninstall.status, 0, uninstall.stderr);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.equal(settings.outputStyle, "My Custom Style", "external outputStyle must survive uninstall");
      assert.equal(settings.litclaude, undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});
