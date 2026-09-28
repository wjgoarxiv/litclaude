import { micro } from "../bin/litfamily-banner.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { findOffenders } from "../tools/check-pack-payload.mjs";
import { stripAnsi } from "../scripts/strip-ansi.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const originalRoot = join(pluginRoot, "vendor", "handoff");
const adapterPath = join(pluginRoot, "skills", "lit-handoff", "SKILL.md");
const commandPath = join(pluginRoot, "commands", "lit-handoff.md");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");

const expectedOriginalHashes = new Map([
  ["SKILL.md", "e5bbd253dfa5b5baa9739dfaebc458003daab43cb27c4a407423da1e7a31dec6"],
  ["evals/evals.json", "0a70f0d149e59641100c7dcf8b9f2f1c0ceae57b98518e165f08088f2c2484da"],
  ["examples/HANDOFF-example-generic-auth-refactor.md", "43c767e573ac8c8900832d2b7a92ee1e83fd2d3d794fe2c82ecef87e5737f2a3"],
  ["templates/HANDOFF.md", "2a795a06e7bb81a57e6675ae70ed26db0dbfdb792c01f0a60f96f02cbef49fbd"],
]);

const listFiles = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
  .sort();

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const runHook = (prompt) => spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
  env: { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color" },
  cwd: root,
  encoding: "utf8",
  input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
});

const readHookPayload = (prompt) => {
  const result = runHook(prompt);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

describe("LitClaude handoff skill payload", () => {
  it("preserves exactly the four approved source files byte-for-byte", () => {
    assert.equal(existsSync(originalRoot), true, "vendored original root must exist");
    assert.deepEqual(listFiles(originalRoot), [...expectedOriginalHashes.keys()].sort());
    for (const [file, expectedHash] of expectedOriginalHashes) {
      assert.equal(sha256(join(originalRoot, file)), expectedHash, `${file} must preserve its approved SHA-256`);
    }
  });

  it("ships a Claude-native adapter, command, MIT license, and immutable provenance", () => {
    for (const path of [adapterPath, commandPath]) assert.equal(existsSync(path), true, `${path} must exist`);
    const adapter = readFileSync(adapterPath, "utf8");
    const command = readFileSync(commandPath, "utf8");
    const license = readFileSync(join(pluginRoot, "vendor", "licenses", "022_handoff-MIT.txt"), "utf8");
    const provenance = readFileSync(join(pluginRoot, "vendor", "provenance", "022_handoff.md"), "utf8");

    assert.match(adapter, /name:\s*lit-handoff/u);
    assert.match(adapter, /disable-model-invocation:\s*true/u);
    assert.match(adapter, /contract_schema_version:\s*litclaude\.llm-contract\.v1/u);
    assert.match(adapter, /\.\.\/\.\.\/vendor\//u);
    assert.match(adapter, /the vendored handoff reference/u);
    assert.doesNotMatch(adapter, /022_handoff/u, "model-facing adapter text must not name the legacy skill id");
    assert.match(adapter, /resolve.*relative.*SKILL\.md/isu);
    assert.match(adapter, /DEGRADED/u);
    assert.match(adapter, /templates\/HANDOFF\.md/u);
    assert.match(adapter, /🔥 \*\*LIT IGNITED · lit-handoff\*\* 🔥/u);
    assert.match(adapter, /redact|redaction/iu);
    assert.match(command, /Skill\(lit-handoff\)/u);
    assert.match(command, /🔥 \*\*LIT IGNITED · lit-handoff\*\* 🔥/u);
    assert.match(license, /^MIT License/mu);
    assert.match(provenance, /235ed3af614a7becaee6ef1d1a18e5c4b13994f4/u);
    for (const hash of expectedOriginalHashes.values()) assert.match(provenance, new RegExp(hash, "u"));
  });

  it("routes only exact bare handoff and injects the complete canonical source", () => {
    const parsed = readHookPayload("  handoff\n");
    const context = parsed.hookSpecificOutput.additionalContext;
    const originalSkillPath = join(originalRoot, "SKILL.md");
    assert.equal(existsSync(originalSkillPath), true, "canonical source skill must exist before hook injection");
    const originalSkill = readFileSync(originalSkillPath, "utf8").trim();

    assert.match(stripAnsi(parsed.systemMessage ?? ""), /🔥 LIT IGNITED · lit-handoff 🔥/u);
    assert.match(context, /begin your reply with the exact probe line `🔥 \*\*LIT IGNITED · lit-handoff\*\* 🔥`/iu);
    assert.match(context, /\/litclaude:lit-handoff/u);
    assert.match(context, /Skill\(lit-handoff\)/u);
    assert.match(context, new RegExp(`canonical source root.*${originalRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "iu"));
    assert.equal(context.includes(originalSkill), true, "bare handoff must inject the complete canonical source body");
  });

  it("keeps mentions, compound prompts, slash commands, and secret-bearing text inert", () => {
    for (const prompt of [
      "Please explain the handoff workflow.",
      "handoff && rm -rf /",
      "`handoff`",
      "`note`\nhandoff",
      "```text\nnote\n```\nhandoff",
      "handoff\n```text\nnote\n```",
      "/litclaude:lit-handoff",
      "handoff\nAPI_TOKEN=do-not-echo",
    ]) {
      const parsed = readHookPayload(prompt);
      assert.equal(parsed.systemMessage, undefined, `${prompt} must not activate the exact-bare route`);
      assert.match(parsed.hookSpecificOutput.additionalContext, /no workflow activation/u);
      assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /do-not-echo/u);
    }
  });

  it("enrolls handoff in docs and doctor checks", () => {
    for (const file of ["README.md", "README_ko-KR.md", "docs/hooks.md", "docs/workflow-compatibility-audit.md"]) {
      assert.match(readFileSync(join(root, file), "utf8"), /lit-handoff/u, `${file} must list lit-handoff`);
    }
    const doctor = readFileSync(join(root, "scripts", "doctor.mjs"), "utf8");
    const catalog = readFileSync(join(root, "plugins", "litclaude", "lib", "canonical-skill-catalog.mjs"), "utf8");
    assert.match(doctor, /canonicalSkillFiles/u);
    assert.match(catalog, /"lit-handoff"/u);
    for (const file of [
      "vendor/handoff/SKILL.md",
      "vendor/handoff/evals/evals.json",
      "vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
      "vendor/handoff/templates/HANDOFF.md",
    ]) {
      assert.match(doctor, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
  });

  it("packs the adapter, command, provenance, license, and all four originals", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const files = new Set(JSON.parse(result.stdout)[0].files.map(({ path }) => path));
    for (const path of [
      "plugins/litclaude/skills/lit-handoff/SKILL.md",
      "plugins/litclaude/commands/lit-handoff.md",
      "plugins/litclaude/vendor/licenses/022_handoff-MIT.txt",
      "plugins/litclaude/vendor/provenance/022_handoff.md",
      ...[...expectedOriginalHashes.keys()].map((file) => `plugins/litclaude/vendor/handoff/${file}`),
    ]) {
      assert.equal(files.has(path), true, `${path} must be packed`);
    }
  });

  it("allows only the two canonical HANDOFF-named payload files", () => {
    const canonical = [
      "plugins/litclaude/vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
      "plugins/litclaude/vendor/handoff/templates/HANDOFF.md",
    ];
    assert.deepEqual(findOffenders(canonical), []);

    const denied = findOffenders([...canonical, "plugins/litclaude/vendor/rogue/HANDOFF.md"]);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].filePath, "plugins/litclaude/vendor/rogue/HANDOFF.md");
  });
});
