// Windows behaviour without a Windows host: the platform and env are injected into the helpers, so
// these cases run on any OS. What a real cmd.exe and npm.cmd do stays unproven here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { npmInvocation, quoteForCmd } from "../plugins/litclaude/lib/npm-invocation.mjs";
import { runAutomaticUpdate } from "../plugins/litclaude/lib/automatic-update.mjs";
import * as motionHost from "../plugins/litclaude/skills/lit-typographic-motion/engine/node/host.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const libRoot = join(root, "plugins", "litclaude", "lib");
const NPM_CLI = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

for (const [label, invocation] of [
  ["lib/npm-invocation.mjs", npmInvocation],
  ["motion engine host.mjs", motionHost.npmInvocation],
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
    assert.throws(() => motionHost.quoteForCmd("%x%"), /refusing to pass/u);
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

describe("which on win32", () => {
  it("drops the \\r of CRLF `where` output and returns the first match", () => {
    const calls = [];
    const spawn = (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: "C:\\ffmpeg\\bin\\ffmpeg.exe\r\nC:\\other\\ffmpeg.exe\r\n" };
    };
    assert.equal(motionHost.which("ffmpeg", {}, { platform: "win32", spawn }), "C:\\ffmpeg\\bin\\ffmpeg.exe");
    assert.deepEqual(calls, [["where", "ffmpeg"]]);
  });

  it("is null when the lookup fails", () => {
    assert.equal(motionHost.which("ffmpeg", {}, { platform: "win32", spawn: () => ({ status: 1, stdout: "" }) }), null);
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

describe("office bootstrap keeps the helper's exit code", () => {
  const reexec = (platform) => spawnSync("python3", ["-B", "-c", [
    "import os, sys",
    `sys.path.insert(0, ${JSON.stringify(libRoot)})`,
    "import office_runtime_bootstrap as b",
    `b._reexec([sys.executable, "-c", "raise SystemExit(3)"], dict(os.environ), ${JSON.stringify(platform)})`,
  ].join("\n")], { encoding: "utf8" });

  it("on Windows it waits for the child and returns 3 when the child exits 3", () => {
    const result = reexec("nt");
    assert.equal(result.status, 3, result.stderr);
  });

  it("on POSIX it replaces the process, so the exit code is the child's too", () => {
    const result = reexec("posix");
    assert.equal(result.status, 3, result.stderr);
  });
});

describe("publisher PDF preflight names a missing class font", () => {
  const scripts = join(root, "plugins", "litclaude", "skills", "lit-docx", "scripts");
  // The converter's runtime imports are stubbed, so this runs on the host Python with no runtime;
  // pandoc, xelatex and kpsewhich are faked so only the font lookup decides.
  const preflight = (documentclass, fonts, fcList) => spawnSync("python3", ["-B", "-c", [
    "import sys, types",
    "boot = types.ModuleType('office_runtime_bootstrap'); boot.ensure_runtime = lambda modules: None",
    "docx = types.ModuleType('convert_md_to_docx')",
    "for name in ('detect_locale', 'fix_dashes', 'fix_ellipsis', 'fix_quotes', 'fix_unit_spacing', 'load_publisher', 'normalize_double_spaces', 'parse_frontmatter'): setattr(docx, name, None)",
    "sys.modules.update(office_runtime_bootstrap=boot, convert_md_to_docx=docx)",
    `sys.path.insert(0, ${JSON.stringify(scripts)})`,
    "import convert_md_to_pdf as m",
    `fonts = set(${JSON.stringify(fonts)})`,
    `m.command_path = lambda name: None if name == 'fc-list' and not ${fcList ? "True" : "False"} else '/bin/' + name`,
    "m.kpsewhich_has = lambda target: not target.endswith('.ttf') or target[:-4] in fonts",
    "m.run_checked = lambda command, workdir=None: types.SimpleNamespace(returncode=0, stdout='')",
    `m.preflight_pdf_compile('korean-generic', {'latex': {'documentclass': ${JSON.stringify(documentclass)}}}, 'ko')`,
    "print('PREFLIGHT_PASS')",
  ].join("\n")], { encoding: "utf8" });

  it("stops korean-generic before XeLaTeX when UnBatang is missing, naming the font and the install", () => {
    const result = preflight("oblivoir", [], true);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /BLOCKED: the oblivoir class of publisher 'korean-generic' needs the UnBatang font/u);
    assert.match(result.stderr, /tlmgr install unfonts-core/u);
  });

  it("passes when the TeX tree has UnBatang, and never checks it for other classes", () => {
    assert.match(preflight("oblivoir", ["UnBatang"], false).stdout, /PREFLIGHT_PASS/u);
    assert.match(preflight("elsarticle", [], false).stdout, /PREFLIGHT_PASS/u);
  });
});

describe("publisher LaTeX templates load what pandoc's body needs", () => {
  const latex = join(root, "plugins", "litclaude", "skills", "lit-docx", "templates", "latex");
  for (const profile of ["acs", "elsevier", "ieee", "korean-generic", "nature"]) {
    it(`${profile}: tables (longtable, array, calc, the none counter), \\tightlist and \\pandocbounded`, () => {
      const tex = readFileSync(join(latex, profile, "template.tex"), "utf8");
      assert.match(tex, /\\usepackage\{longtable,array,calc\}/u);
      assert.match(tex, /\\newcounter\{none\}/u);
      assert.match(tex, /\\providecommand\{\\tightlist\}/u);
      assert.match(tex, /\\providecommand\*\\pandocbounded/u);
    });
  }
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
      "plugins/litclaude/skills/lit-diagram-drawer/scripts/renderer.mjs", "plugins/litclaude/skills/lit-diagram-drawer/scripts/export.mjs",
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

describe("office runtime picks a Python every pinned package has wheels for", async () => {
  const { pickPython } = await import("../plugins/litclaude/lib/office-runtime.mjs");
  const versions = (table) => (command) => table[command]
    ? { command, version: table[command], ...rangeOf(table[command]) }
    : { ok: false, command, detail: "not found" };
  const rangeOf = (version) => {
    const minor = Number(version.split(".")[1]);
    return minor < 10 ? { ok: false, detail: `${version} is older than 3.10` } : minor > 14 ? { ok: false, detail: `${version} is newer than 3.14` } : { ok: true, detail: version };
  };

  it("skips a python3 that is 3.15 and takes the newest supported python3.X on PATH", () => {
    const picked = pickPython({}, versions({ python3: "3.15.0", "python3.15": "3.15.0", "python3.13": "3.13.4" }));
    assert.deepEqual([picked.ok, picked.command, picked.version], [true, "python3.13", "3.13.4"]);
  });

  it("honours LITCLAUDE_OFFICE_PYTHON and never falls back past it", () => {
    const picked = pickPython({ LITCLAUDE_OFFICE_PYTHON: "/opt/py/bin/python3" }, versions({ "/opt/py/bin/python3": "3.15.0", "python3.13": "3.13.4" }));
    assert.equal(picked.ok, false);
    assert.match(picked.detail, /newer than 3\.14/u);
  });

  it("names every interpreter it tried when none fits", () => {
    const picked = pickPython({}, versions({ python3: "3.15.0" }));
    assert.equal(picked.ok, false);
    assert.match(picked.detail, /no supported Python \(3\.10 to 3\.14\).*python3: 3\.15\.0 is newer than 3\.14/u);
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
