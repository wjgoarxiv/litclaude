// Windows behaviour without a Windows host: the platform and env are injected into the helpers, so
// these cases run on any OS. What a real cmd.exe and npm.cmd do stays unproven here.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { npmInvocation, quoteForCmd } from "../plugins/litclaude/lib/npm-invocation.mjs";
import { runAutomaticUpdate } from "../plugins/litclaude/lib/automatic-update.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const libRoot = join(root, "plugins", "litclaude", "lib");
const NPM_CLI = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

// The motion engine's own host.mjs, the other copy this loop covered, moved to the video-covers extras plugin.
for (const [label, invocation] of [
  ["lib/npm-invocation.mjs", npmInvocation],
]) {
  describe(`npm on win32 (${label})`, () => {
    it("runs npm-cli.js through this Node when npm_execpath names it, with no shell", () => {
      const plan = invocation(["ci", "--omit=dev"], { platform: "win32", env: { npm_execpath: NPM_CLI }, execPath: "C:\\node\\node.exe" });
      assert.deepEqual(plan, { command: "C:\\node\\node.exe", args: [NPM_CLI, "ci", "--omit=dev"], shell: false });
    });

    it("falls back to npm.cmd through a shell with every argument quoted", () => {
      const plan = invocation(["cache", "add", "C:\\Users\\Jo Doe\\AppData\\Local\\Temp\\a b\\x.tgz", "--cache", "C:\\a b\\"], { platform: "win32", env: {} });
      assert.equal(plan.command, "npm.cmd");
      assert.equal(plan.shell, true);
      assert.deepEqual(plan.args, ["cache", "add", "\"C:\\Users\\Jo Doe\\AppData\\Local\\Temp\\a b\\x.tgz\"", "--cache", "\"C:\\a b\\\\\""]);
    });

    it("ignores an npm_execpath that is not npm's own CLI", () => {
      assert.equal(invocation(["ci"], { platform: "win32", env: { npm_execpath: "C:\\pnpm\\pnpm.cjs" } }).command, "npm.cmd");
    });

    it("keeps POSIX on plain npm with no shell", () => {
      assert.deepEqual(invocation(["ci"], { platform: "darwin", env: { npm_execpath: NPM_CLI } }), { command: "npm", args: ["ci"], shell: false });
    });
  });
}

describe("cmd.exe argument quoting", () => {
  it("refuses an argument cmd.exe would still expand or split inside quotes", () => {
    for (const bad of ["%PATH%", "a\"b", "a\r\nb"]) assert.throws(() => quoteForCmd(bad), /refusing to pass/u);
  });

  it("quotes shell metacharacters and leaves plain words alone", () => {
    assert.equal(quoteForCmd("@litfamily/litclaude@1.2.3"), "@litfamily/litclaude@1.2.3");
    assert.equal(quoteForCmd("a&b|c"), "\"a&b|c\"");
  });

  it("an explicit .cmd override goes through the shell, an .exe does not", () => {
    assert.equal(npmInvocation(["ci"], { command: "C:\\tools\\npm.cmd", platform: "win32", env: {} }).shell, true);
    assert.deepEqual(npmInvocation(["ci"], { command: "C:\\tools\\fake-npm.exe", platform: "win32", env: {} }), { command: "C:\\tools\\fake-npm.exe", args: ["ci"], shell: false });
  });
});

describe("automatic update on win32", () => {
  const GENERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const run = (env) => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-win32-"));
    const litHome = join(home, "lit");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    const invocations = [];
    try {
      mkdirSync(join(litHome, "update-notifier"), { recursive: true });
      writeFileSync(cachePath, `${JSON.stringify({
        schema: 3, packageName: "@litfamily/litclaude", latestVersion: "0.3.41",
        checkedAt: new Date(now - 1_000).toISOString(), attemptedAt: new Date(now - 1_000).toISOString(), generation: GENERATION,
      })}\n`);
      runAutomaticUpdate({
        surface: "session-start", currentVersion: "0.3.40", cachePath, litHome, claudeHome: join(home, "claude"),
        env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: join(home, "claude"), ...env },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now, platform: "win32",
        spawn: (command, args, options) => {
          invocations.push({ command, args, shell: options.shell });
          return { status: 0, stdout: "", stderr: "" };
        },
        verifyInstall: () => true,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
    return invocations;
  };

  it("never spawns npm.cmd without a shell", () => {
    const calls = run({});
    assert.equal(calls.length, 2);
    for (const call of calls) assert.deepEqual([call.command, call.shell], ["npm.cmd", true]);
  });

  it("runs npm-cli.js through Node when npm_execpath names it", () => {
    const calls = run({ npm_execpath: NPM_CLI });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.command, process.execPath);
      assert.equal(call.args[0], NPM_CLI);
      assert.notEqual(call.shell, true);
    }
  });
});

describe("npm-installed CLIs run with no shell on win32", async () => {
  const { shellFreeCommand } = await import("../plugins/litclaude/lib/npm-invocation.mjs");
  const lspShellFree = (await import("../plugins/litclaude/skills/lsp-setup/scripts/verify-lsp.ts")).shellFreeCommand;
  const SHIM = [
    "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0",
    "IF EXIST \"%dp0%\\node.exe\" (", "  SET \"_prog=%dp0%\\node.exe\"", ") ELSE (", "  SET \"_prog=node\"", ")",
    "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\agent-browser\\bin\\agent-browser.js\" %*",
  ].join("\r\n");
  const host = (files) => ({
    platform: "win32",
    env: { Path: "C:\\nope;C:\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    execPath: "C:\\node\\node.exe",
    // Windows paths are case-insensitive, and PATHEXT spells the extensions in capitals.
    exists: (file) => Object.keys(files).some((key) => key.toLowerCase() === file.toLowerCase()),
    read: (file) => files[Object.keys(files).find((key) => key.toLowerCase() === file.toLowerCase())],
  });

  for (const [label, resolve] of [["lib/npm-invocation.mjs", shellFreeCommand], ["lsp-setup verify-lsp.ts", lspShellFree]]) {
    it(`${label}: unwraps an npm .cmd shim to node + its script, finding it through Path and PATHEXT`, () => {
      const files = { "C:\\npm\\agent-browser": "#!/bin/sh", "C:\\npm\\agent-browser.cmd": SHIM };
      assert.deepEqual(resolve("agent-browser", ["--version"], host(files)), {
        command: "C:\\node\\node.exe",
        args: ["C:\\npm\\node_modules\\agent-browser\\bin\\agent-browser.js", "--version"],
      });
    });

    it(`${label}: runs an .exe directly and refuses a .cmd that is not an npm shim`, () => {
      assert.deepEqual(resolve("claude", ["--version"], host({ "C:\\npm\\claude.exe": "" })), { command: "C:\\npm\\claude.EXE", args: ["--version"] });
      assert.throws(() => resolve("tsls", [], host({ "C:\\npm\\tsls.cmd": "@echo off\r\nnode tsls.js %*" })), /not an npm shim/u);
    });

    it(`${label}: leaves POSIX and names not on PATH unchanged`, () => {
      assert.deepEqual(resolve("claude", ["-v"], { platform: "linux" }), { command: "claude", args: ["-v"] });
      assert.deepEqual(resolve("claude", ["-v"], host({})), { command: "claude", args: ["-v"] });
    });
  }

  it("no shipped call site spawns claude, agent-browser or a language server by bare name", () => {
    const sites = [
      "bin/litclaude-ai.js", "scripts/validate-plugin.mjs", "plugins/litclaude/bin/litclaude-lsp-doctor.js",
      "plugins/litclaude/skills/lsp-setup/scripts/verify-lsp.ts",
    ];
    for (const site of sites) {
      const source = readFileSync(join(root, site), "utf8");
      assert.doesNotMatch(source, /spawn(?:Sync)?\(\s*["'](?:claude|agent-browser|typescript-language-server)["']/u, site);
      assert.doesNotMatch(source, /spawn(?:Sync)?\(\s*(?:command|bin)\s*,/u, `${site} spawns a resolved server name directly`);
      assert.match(source, /shellFreeCommand|runAgentBrowser\(/u, `${site} must resolve through shellFreeCommand`);
    }
  });
});

// Windows refuses fsync on a handle opened read-only (EPERM), so a state write that flushes its own file
// must open it "r+". Directory flushes stay best-effort inside try blocks and are not checked here.
const readOnlyFileFsyncs = (source) =>
  [...source.matchAll(/const fd = openSync\([^)]*,\s*"r"\);\s*\n\s*fsyncSync\(fd\)/gu)].length;

describe("state writes flush through a writable handle", () => {
  for (const file of ["litgoal/state.mjs", "litgoal/ledger.mjs", "start-work-lifecycle.mjs"]) {
    it(`lib/${file} never fsyncs a file it opened read-only`, () => {
      assert.equal(readOnlyFileFsyncs(readFileSync(join(libRoot, file), "utf8")), 0);
    });
  }
});
