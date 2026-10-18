// The Jev skill hint was removed. These checks fail if any piece of it comes back: a source file
// that names it, its environment switches or its endpoint, a prompt hook that calls out or adds a
// hint line when the old switches are set, or a doctor line about it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins/litclaude/bin/litclaude-hook.js");
const cliPath = join(root, "bin/litclaude-ai.js");
const forbidden = /\bjev\b|LITCLAUDE_JEV|typesafe/iu;
const textExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".sh", ".py", ".yaml", ".yml", ".toml", ".txt"]);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) out.push(path);
  }
  return out;
};

test("no shipped source names the removed skill hint, its switches or its endpoint", () => {
  const files = [...walk(join(root, "plugins")), ...walk(join(root, "bin")), ...walk(join(root, "scripts")), join(root, "package.json")];
  const offenders = files.filter((file) => statSync(file).size < 4 * 1024 * 1024 && forbidden.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((file) => relative(root, file)), []);
  assert.equal(existsSync(join(root, "plugins/litclaude/lib/jev-skill-hint.mjs")), false);
});

test("the prompt hook ignores the old switches: no request, no hint line, no banner", () => {
  const cwd = mkdtempSync(join(tmpdir(), "litclaude-removed-hint-"));
  const log = join(cwd, "fetch-calls.log");
  // Any fetch in the hook process is recorded and refused.
  const tripwire = `data:text/javascript,${encodeURIComponent(`
    import { appendFileSync } from "node:fs";
    globalThis.fetch = async (url) => { appendFileSync(${JSON.stringify(log)}, String(url) + "\\n"); throw new Error("network refused"); };
  `)}`;
  try {
    const result = spawnSync(process.execPath, ["--import", tripwire, hookPath, "user-prompt-submit"], {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "guard-session", cwd, prompt: "이 보고서 초안에서 AI가 쓴 티 나는 표현을 자연스럽게 고쳐줘." }),
      env: {
        ...process.env,
        LITCLAUDE_NO_AUTO_UPDATE: "1",
        LITCLAUDE_NO_UPDATE_CHECK: "1",
        LITCLAUDE_JEV: "1",
        TYPESAFE_API_KEY: "test-key-not-real-0000",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /no workflow activation/u);
    assert.doesNotMatch(result.stdout, /skill hint|Jev|test-key-not-real/iu);
    assert.equal(existsSync(log), false, existsSync(log) ? readFileSync(log, "utf8") : "");
    assert.equal(existsSync(join(cwd, ".litclaude", "jev")), false, "no state folder for the removed hint");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor prints nothing about the removed skill hint", () => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-removed-hint-home-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "doctor", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LITCLAUDE_HOME: home, CLAUDE_HOME: join(home, ".claude"), CLAUDE_CONFIG_DIR: join(home, ".claude"), LITCLAUDE_JEV: "1", TYPESAFE_API_KEY: "test-key-not-real-0000" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY_RUN/u);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /jev|typesafe|test-key-not-real/iu);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
