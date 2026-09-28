import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginManifestPath = join(root, "plugins", "litclaude", ".claude-plugin", "plugin.json");
const packagePath = join(root, "package.json");
const contractHeadings = [
  "## #contract.activation",
  "## #contract.inputs",
  "## #contract.mode_matrix",
  "## #contract.procedure",
  "## #contract.outputs",
  "## #contract.evidence",
  "## #contract.hard_stops",
  "## #contract.anti_patterns",
];

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

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const bodyWithoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n?/u, "");

const assertLlmCommandContract = (text, label) => {
  const body = bodyWithoutFrontmatter(text).trimStart();
  assert.ok(body.startsWith("## #contract.activation"), `${label} should be contract-first after frontmatter`);

  let previousIndex = -1;
  for (const heading of contractHeadings) {
    const index = text.indexOf(heading);
    assert.notEqual(index, -1, `${label} missing ${heading}`);
    assert.ok(index > previousIndex, `${label} should keep ${heading} in schema order`);
    previousIndex = index;
  }

  assert.match(
    text,
    /```yaml\n[\s\S]*?contract_schema_version:\s*litclaude\.llm-contract\.v1[\s\S]*?artifact_type:\s*command[\s\S]*?```/u,
    `${label} should expose the stable command contract schema as fenced yaml`,
  );
  assert.match(text, /^\|[^\n]+\|\n\|[-:| ]+\|/mu, `${label} should contain a markdown contract table`);
  assert.match(text, /Claude Code/u, `${label} should be expressed in Claude Code vocabulary`);
};

describe("Claude plugin manifest", () => {
  it("aligns package and plugin manifests to the v1.0.12 release", () => {
    const manifest = readJson(pluginManifestPath);
    const packageJson = readJson(packagePath);

    assert.equal(packageJson.version, "1.0.12");
    assert.equal(manifest.version, "1.0.12");
    assert.equal(manifest.version, packageJson.version);
    assert.doesNotMatch(packageJson.description, /source-origin|port/i);
    assert.doesNotMatch(manifest.description, /source-origin|port/i);
  });

  it("uses the Claude plugin layout and exports all MVP components", () => {
    assert.equal(existsSync(pluginManifestPath), true, "Claude plugin manifest must exist");

    const manifest = readJson(pluginManifestPath);
    const packageJson = readJson(packagePath);

    assert.equal(manifest.name, "litclaude");
    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.defaultEnabled, true);
    assert.equal(manifest.skills, "./skills");
    assert.equal("agents" in manifest, false, "Claude discovers plugin agents from agents/ without an agents manifest field");
    for (const agentExport of expectedAgentExports) {
      assert.equal(existsSync(join(root, "plugins", "litclaude", agentExport.replace(/^\.\//u, ""))), true, `${agentExport} should be shipped for Claude agent discovery`);
    }
    assert.equal("hooks" in manifest, false);
    assert.equal(manifest.mcpServers, "./.mcp.json");
    assert.equal(manifest.lspServers, "./.lsp.json");
    assert.equal("bin" in manifest, false);
    assert.equal("category" in manifest, false);

    const commandsPath = join(root, "plugins", "litclaude", "commands");
    assert.equal(existsSync(commandsPath), true, "Claude should discover LitClaude slash commands from commands/");
    assert.deepEqual(readdirSync(commandsPath).sort(), [
      "autoconference.md",
      "autoresearch.md",
      "deep-interview.md",
      "init-deep.md",
      "korean-ai-slop-remover.md",
      "lit-comprehend.md",
      "lit-handoff.md",
      "lit-humanizer.md",
      "lit-init.md",
      "lit-korean.md",
      "lit-loop.md",
      "lit-plan.md",
      "lit-recap.md",
      "lit-scientific-visualization.md",
      "litgoal.md",
      "litresearch.md",
      "review-work.md",
      "start-work.md",
      "wikify.md",
    ]);
    for (const command of ["autoconference.md", "autoresearch.md", "lit-comprehend.md", "deep-interview.md", "lit-init.md", "review-work.md", "start-work.md", "litgoal.md", "litresearch.md", "lit-loop.md", "lit-plan.md", "lit-recap.md", "lit-humanizer.md", "lit-handoff.md", "lit-scientific-visualization.md", "wikify.md"]) {
      const commandText = readFileSync(join(commandsPath, command), "utf8");
      assert.match(commandText, /^---\n[\s\S]*description:/u, `${command} should have command frontmatter`);
      assertLlmCommandContract(commandText, command);
      assert.match(commandText, /goal tools are unavailable|Dynamic workflow|claude --worktree|execution-ready spec|ambiguity|5-lane|ledger|subagent delegation|Korean prose polish|AGENTS\.md|continuation packet|publication-ready figure|bounded (?:loop|conference)|local inert-source operations/iu);
      assert.doesNotMatch(commandText, /\$ARGUMENTS/u, `${command} should not render broken empty argument placeholders`);
    }

    const reviewWork = readFileSync(join(commandsPath, "review-work.md"), "utf8");
    assert.match(
      reviewWork,
      /scope\/diff verification[\s\S]*lit-verifier[\s\S]*tests\/evidence execution[\s\S]*qa-runner[\s\S]*package\/payload and code quality review[\s\S]*quality-reviewer[\s\S]*security\/provenance review[\s\S]*quality-reviewer[\s\S]*real-surface\/docs readiness[\s\S]*librarian-researcher/iu,
      "review-work should map all 5 lanes to shipped agents",
    );
    const litgoal = readFileSync(join(commandsPath, "litgoal.md"), "utf8");
    assert.match(litgoal, /\blitgoal\b[\s\S]*\bledger\b[\s\S]*\bcheckpoint\b/iu);
    const dynamicWorkflow = readFileSync(join(commandsPath, "lit-loop.md"), "utf8");
    assert.match(dynamicWorkflow, /get_goal[\s\S]*create_goal[\s\S]*Workflow[\s\S]*lit-planner[\s\S]*lit-executor[\s\S]*qa-runner/iu);
    assert.doesNotMatch(`${reviewWork}\n${litgoal}\n${dynamicWorkflow}`, /\bTODO\b|placeholder|TBD|<insert|broken empty argument/iu);
  });

  it("exposes only the native LitClaude plugin through the legacy marketplace identity", () => {
    const marketplace = readJson(join(root, ".claude-plugin", "marketplace.json"));
    assert.equal(marketplace.name, "litclaude-ai");
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, "litclaude");
    assert.equal(marketplace.plugins[0].source, "./plugins/litclaude");
    assert.equal(readJson(join(root, marketplace.plugins[0].source, ".claude-plugin/plugin.json")).name, "litclaude");
  });

	it("keeps the standalone planner unable to delegate recursively", () => {
		const planner = readFileSync(join(root, "plugins", "litclaude", "agents", "lit-planner.md"), "utf8");
		const frontmatter = planner.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
		assert.match(frontmatter, /permissionMode:\s*plan/u);
		assert.doesNotMatch(frontmatter, /^tools:.*\bAgent\b/mu);
	});
});
