#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyCanonicalFrontendCorpus } from "../plugins/litclaude/lib/canonical-frontend-corpus.mjs";
import { verifyCanonicalRuntimeClosures } from "../plugins/litclaude/lib/canonical-runtime-closures.mjs";
import { inspectClaudeNativeSurface } from "../tools/check-model-routing.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, "plugins", "litclaude");

const expectedAgentExports = [
  "./agents/lit-planner.md",
  "./agents/lit-executor.md",
  "./agents/lit-verifier.md",
  "./agents/qa-runner.md",
  "./agents/quality-reviewer.md",
  "./agents/librarian-researcher.md",
  "./agents/korean-style-analyzer.md",
  "./agents/korean-prose-editor.md",
  "./agents/meaning-preservation-auditor.md",
  "./agents/native-flow-reviewer.md",
  "./agents/polish-orchestrator.md",
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  await access(path, constants.R_OK);
}

// Skills that ship a reference pack. A reference document nobody can reach from the skill's
// entrypoint is dead payload: it is hash-pinned, installed, and never opened. This gate makes
// that state unshippable by requiring every references/*.md to be named in its own SKILL.md.
const referenceRouterSkills = ["frontend-ui-ux", "visual-qa"];

async function assertReferenceRouters() {
  let routed = 0;
  for (const skillId of referenceRouterSkills) {
    const skillRoot = join(pluginRoot, "skills", skillId);
    const entrypoint = await readFile(join(skillRoot, "SKILL.md"), "utf8");
    const references = (await readdir(join(skillRoot, "references")))
      .filter((name) => name.endsWith(".md"))
      .sort();
    assert.ok(
      references.length > 0,
      `SKILL_REFERENCE_ROUTER_FAIL ${skillId} ships no reference documents`,
    );
    const unrouted = references.filter((name) => !entrypoint.includes(`references/${name}`));
    assert.deepEqual(
      unrouted,
      [],
      `SKILL_REFERENCE_ROUTER_FAIL ${skillId}/SKILL.md does not route ${unrouted.join(", ")}`,
    );
    routed += references.length;
  }
  process.stdout.write(`SKILL_REFERENCE_ROUTER_PASS: ${routed} reference(s) routed\n`);
}

async function main() {
  const manifest = await readJson(join(pluginRoot, ".claude-plugin", "plugin.json"));
  assert.equal(manifest.name, "litclaude");
  assert.equal(manifest.skills, "./skills");
  assert.equal("agents" in manifest, false);
  for (const agentExport of expectedAgentExports) {
    await exists(join(pluginRoot, agentExport.replace(/^\.\//u, "")));
  }
  assert.equal("hooks" in manifest, false);
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.lspServers, "./.lsp.json");

  await exists(join(pluginRoot, ".mcp.json"));
  await exists(join(pluginRoot, ".lsp.json"));
  await exists(join(pluginRoot, "bin", "litclaude-hook.js"));
  await exists(join(pluginRoot, "bin", "litclaude-lsp-doctor.js"));
  await exists(join(pluginRoot, "bin", "litclaude-mcp.js"));
  await exists(join(pluginRoot, "lib", "start-work-lifecycle.mjs"));
  await exists(join(pluginRoot, "lib", "start-work-cli.mjs"));

  const hooks = await readJson(join(pluginRoot, "hooks", "hooks.json"));
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStart", "SubagentStop", "SessionEnd"]) {
    assert.ok(hooks.hooks[event], `missing hook event ${event}`);
  }

  const skills = await readdir(join(pluginRoot, "skills"));
  const agents = await readdir(join(pluginRoot, "agents"));
  assert.ok(skills.length >= 7, "expected at least seven skills");
  assert.ok(agents.length >= expectedAgentExports.length, `expected at least ${expectedAgentExports.length} agents`);

  await assertReferenceRouters();
  const canonicalFrontend = verifyCanonicalFrontendCorpus(pluginRoot);
  assert.equal(canonicalFrontend.status, "PASS", `CANONICAL_FRONTEND_CORPUS_FAIL ${JSON.stringify(canonicalFrontend.failures)}`);
  process.stdout.write(`CANONICAL_FRONTEND_CORPUS_PASS: ${canonicalFrontend.checkedFiles} files\n`);
  const runtimeClosures = verifyCanonicalRuntimeClosures(pluginRoot);
  assert.equal(runtimeClosures.status, "PASS", `CANONICAL_RUNTIME_CLOSURES_FAIL ${JSON.stringify(runtimeClosures.failures)}`);
  process.stdout.write(`CANONICAL_RUNTIME_CLOSURES_PASS: ${runtimeClosures.families.length} families\n`);

  const modelRouting = inspectClaudeNativeSurface(root);
  assert.equal(modelRouting.status, "PASS", `MODEL_ROUTING_GUARD_FAIL ${modelRouting.failures.join(", ")}`);
  process.stdout.write(`MODEL_ROUTING_UNSUPPORTED: ${modelRouting.reason}\n`);

  const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (claude.status === 0) {
    process.stdout.write(`CLAUDE_VERSION: ${claude.stdout.trim() || claude.stderr.trim()}\n`);
    const validation = spawnSync("claude", ["plugin", "validate", "./plugins/litclaude"], {
      cwd: root,
      encoding: "utf8",
    });
    if (validation.stdout) process.stdout.write(validation.stdout);
    if (validation.stderr) process.stdout.write(validation.stderr);
    assert.equal(validation.status, 0, "claude plugin validate must pass");
  } else {
    process.stdout.write("CONTROLLED_SKIP: claude executable unavailable for version probe\n");
  }

  process.stdout.write("VALIDATE_PLUGIN_PASS\n");
}

main().catch((error) => {
  process.stderr.write(`VALIDATE_PLUGIN_FAIL: ${error.message}\n`);
  process.exit(1);
});
