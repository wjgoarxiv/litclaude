import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Skills and commands tell the model to run `litclaude-ai <subcommand>`. After a plugin install the
// npm CLI is not on PATH; Claude Code puts the plugin's own bin/ there instead. So the plugin
// ships a `litclaude-ai` of its own, and the start-work gate already classifies that bare name.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(repoRoot, "plugins", "litclaude");
const pluginBin = join(pluginRoot, "bin");
const entry = join(pluginBin, "litclaude-ai");
const hookPath = join(pluginBin, "litclaude-hook.js");
const rootCli = join(repoRoot, "bin", "litclaude-ai.js");

// Every `litclaude-ai <subcommand>` a skill body or command file gives as a command: a code line or
// a code span that starts with it.
const documentedCommands = () => {
  const files = [
    ...readdirSync(join(pluginRoot, "skills")).map((id) => join(pluginRoot, "skills", id, "SKILL.md")),
    ...readdirSync(join(pluginRoot, "commands")).filter((name) => name.endsWith(".md")).map((name) => join(pluginRoot, "commands", name)),
  ].filter((file) => existsSync(file));
  const found = new Map();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(/(?:^|`)litclaude-ai ([a-z][a-z-]*)([^`\n]*)/gmu)) {
      if (!found.has(match[1])) found.set(match[1], { file, command: `litclaude-ai ${match[1]}${match[2]}`.trim() });
    }
  }
  return found;
};

// Only the plugin's bin/ on PATH, as Claude Code gives it, with node beside it.
const pluginPathEnv = (extra = {}) => ({
  ...process.env,
  PATH: [pluginBin, join(process.execPath, "..")].join(delimiter),
  LITCLAUDE_DISABLE_UPDATE_CHECK: "1",
  ...extra,
});

test("the plugin ships an executable litclaude-ai in bin/, in the packed payload", () => {
  assert.ok(existsSync(entry), "plugins/litclaude/bin/litclaude-ai exists");
  assert.ok(statSync(entry).mode & 0o111, "it is executable");
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const packed = JSON.parse(result.stdout)[0].files.find(({ path }) => path === "plugins/litclaude/bin/litclaude-ai");
  assert.ok(packed, "the tarball carries plugins/litclaude/bin/litclaude-ai");
  assert.ok(packed.mode & 0o111, "with its executable bit");
  // It must run from the plugin alone: every relative import stays inside the plugin directory.
  for (const [, specifier] of readFileSync(entry, "utf8").matchAll(/["'](\.\.?\/[^"']+)["']/gu)) {
    const target = join(pluginBin, specifier);
    assert.ok(target.startsWith(`${pluginRoot}/`), `${specifier} stays inside the plugin`);
    assert.ok(existsSync(target), `${specifier} exists in the plugin`);
  }
});

test("every documented litclaude-ai subcommand resolves through the plugin's bin on PATH", () => {
  const documented = documentedCommands();
  assert.ok(documented.has("workflow-stage") && documented.has("start-work") && documented.has("litgoal"), "the scan finds the documented commands");
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-plugin-cli-")));
  try {
    mkdirSync(join(project, ".git"));
    for (const [subcommand, { file }] of documented) {
      const result = spawnSync("litclaude-ai", [subcommand, "--help"], { cwd: project, encoding: "utf8", env: pluginPathEnv() });
      assert.equal(result.error, undefined, `${subcommand} (${file}): ${result.error?.message}`);
      assert.equal(result.status, 0, `${subcommand} (${file}): ${result.stderr}`);
    }
    // lit-crucible's verdict line, exactly as documented, writes the session's workflow stack.
    const crucible = "litclaude-ai workflow-stage main plan --verdict crucible=pass";
    assert.ok(readFileSync(join(pluginRoot, "skills", "lit-crucible", "SKILL.md"), "utf8").includes(`\`${crucible}\``));
    const words = crucible.split(" ");
    const recorded = spawnSync(words[0], words.slice(1), { cwd: project, encoding: "utf8", env: pluginPathEnv() });
    assert.equal(recorded.status, 0, recorded.stderr);
    const stacks = readdirSync(join(project, ".litclaude", "workflow-stack")).filter((name) => name.endsWith(".json"));
    assert.equal(stacks.length, 1, "one session's stack");
    const record = JSON.parse(readFileSync(join(project, ".litclaude", "workflow-stack", stacks[0]), "utf8")).frames.at(-1);
    assert.deepEqual({ family: record.family, stage: record.stage, verdicts: record.verdicts }, { family: "main", stage: "plan", verdicts: { crucible: "pass" } });
    // A command the plugin does not serve names the npm route instead of failing silently.
    const other = spawnSync("litclaude-ai", ["install"], { cwd: project, encoding: "utf8", env: pluginPathEnv() });
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /ask the user to run in their own terminal: npx @litfamily\/litclaude install/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("the start-work gate lets the documented plugin commands through during active work", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-plugin-cli-gate-")));
  try {
    mkdirSync(join(root, "plans"));
    writeFileSync(join(root, "plans", "approved.md"), "# Approved\n\n## TODOs\n\n- [ ] Ship safely\n");
    const init = spawnSync(process.execPath, [rootCli, "start-work", "init", "--plan", "plans/approved.md", "--work-id", "work-1", "--session-id", "session-root",
      "--grant", `read:${root}`, "--grant", `write:${root}`, "--grant", `execute:${root}`, "--idempotency-key", "init-1", "--root", root, "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    let n = 0;
    for (const command of [
      "litclaude-ai workflow-stage main plan --verdict crucible=pass",
      "litclaude-ai start-work status --json",
      "litclaude-ai start-work progress --work-id work-1 --session-id session-root --expected-revision 1 --idempotency-key p-1 --json",
    ]) {
      n += 1;
      const result = spawnSync(process.execPath, [hookPath, "pre-tool-use"], {
        cwd: root,
        encoding: "utf8",
        input: JSON.stringify({ cwd: root, hook_event_name: "pre-tool-use", session_id: "session-root", prompt_id: `p-${n}`, tool_use_id: `t-${n}`, tool_name: "Bash", tool_input: { command } }),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "", `allowed: ${command}`);
    }
    // start-work-next finds the active work from a subdirectory, as the lifecycle stores it at the project root.
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "src"));
    const next = spawnSync("litclaude-ai", ["start-work-next", "--session-id", "session-root", "--json"], { cwd: join(root, "src"), encoding: "utf8", env: pluginPathEnv() });
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).status, "active");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
