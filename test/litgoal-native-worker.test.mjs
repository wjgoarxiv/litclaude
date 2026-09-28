import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");

const makeCwd = () => mkdtempSync(join(tmpdir(), "litclaude-native-worker-test-"));

const installFakeClaude = (cwd, { exitCode = 0 } = {}) => {
  const binDir = join(cwd, "bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(cwd, "claude-args.jsonl");
  const fake = join(binDir, "claude");
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('FAKE_CLAUDE_OK\\n');
if (${Number(exitCode)} !== 0) process.stderr.write('FAKE_CLAUDE_FAIL\\n');
process.exit(${Number(exitCode)});
`);
  spawnSync("chmod", ["+x", fake]);
  return { binDir, logPath };
};

const runCli = (cwd, args, env = {}) =>
  spawnSync(process.execPath, [binPath, "litgoal", "native-worker", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

const readLog = (logPath) =>
  readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe("litgoal native-worker", () => {
  it("builds a dry-run print worker command without executing claude", () => {
    const cwd = makeCwd();
    try {
      const { binDir, logPath } = installFakeClaude(cwd);
      const result = runCli(cwd, ["--condition", "tests pass", "--json"], {
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
      });

      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "dry-run");
      assert.equal(output.mode, "print");
      assert.deepEqual(output.args, ["-p", "/goal tests pass"]);
      assert.equal(existsSync(logPath), false, "dry-run must not execute fake claude");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("executes print mode only when --execute is explicit", () => {
    const cwd = makeCwd();
    try {
      const { binDir, logPath } = installFakeClaude(cwd);
      const result = runCli(cwd, ["--condition", "tests pass", "--execute", "--json"], {
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
      });

      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "executed");
      assert.equal(output.stdout, "FAKE_CLAUDE_OK\n");
      assert.deepEqual(readLog(logPath).at(-1), ["-p", "/goal tests pass"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("executes bg mode with an explicit worker name", () => {
    const cwd = makeCwd();
    try {
      const { binDir, logPath } = installFakeClaude(cwd);
      const result = runCli(cwd, [
        "--mode",
        "bg",
        "--name",
        "litgoal-worker",
        "--condition",
        "package is verified",
        "--execute",
        "--json",
      ], {
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readLog(logPath).at(-1), [
        "--bg",
        "--name",
        "litgoal-worker",
        "/goal package is verified",
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("propagates a failing claude worker exit status", () => {
    const cwd = makeCwd();
    try {
      const { binDir, logPath } = installFakeClaude(cwd, { exitCode: 42 });
      const result = runCli(cwd, ["--condition", "tests pass", "--execute", "--json"], {
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
      });

      assert.equal(result.status, 42);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "failed");
      assert.equal(output.exitCode, 42);
      assert.match(output.stderr, /FAKE_CLAUDE_FAIL/u);
      assert.deepEqual(readLog(logPath).at(-1), ["-p", "/goal tests pass"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects unsafe input without executing claude", () => {
    const cases = [
      { args: ["--condition", ""], stderr: /missing condition/i },
      { args: ["--condition", "line one\nline two"], stderr: /single line/i },
      { args: ["--condition", "/clear"], stderr: /must not start with a slash command/i },
      { args: ["--condition", "token=abc123"], stderr: /secret-like material/i },
      { args: ["--mode", "bg", "--condition", "tests pass"], stderr: /--name is required/i },
    ];

    for (const testCase of cases) {
      const cwd = makeCwd();
      try {
        const { binDir, logPath } = installFakeClaude(cwd);
        const result = runCli(cwd, [...testCase.args, "--execute", "--json"], {
          PATH: `${binDir}${delimiter}${process.env.PATH}`,
        });

        assert.notEqual(result.status, 0);
        assert.equal(result.stderr, "");
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.command, "native-worker");
        assert.match(report.error.message, testCase.stderr);
        assert.equal(existsSync(logPath), false, "invalid input must not execute fake claude");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });
});
