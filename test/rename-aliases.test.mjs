import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { REVIEWERS, reviewShapeValid, validateReviewSet } from "../plugins/litclaude/skills/visual-qa/scripts/review-rules.mjs";
import { reviewReceipt, sha256, stableJson } from "./helpers/strict-contract-fixtures.mjs";
import { schemaAccepts } from "./helpers/schema-runtime-parity.mjs";
import { assertNoWorkflowActivationContext } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const aliases = [
  ["hyperplan", "lit-crucible"],
  ["init-deep", "lit-init"],
  ["git-master", "lit-commit"],
  ["teammode", "lit-team"],
  ["remove-ai-slops", "lit-burnoff"],
  ["ai-slop-remover", "lit-burnoff-file"],
  ["korean-ai-slop-remover", "lit-humanizer"],
  ["lit-korean", "lit-humanizer"],
  ["text-naturalization", "lit-humanizer"],
  ["programming", "lit-code"],
  ["prometheus-planner", "lit-planner", "lit-plan"],
  ["boulder-executor", "lit-executor", "start-work"],
  ["oracle-verifier", "lit-verifier", "review-work"],
  ["dynamic-workflow", "lit-loop"],
];

for (const [oldId, newId, agentSkill] of aliases) {
  test(`alias ${oldId} -> ${newId} injects one deprecation note`, () => {
    const cwd = mkdtempSync(join(tmpdir(), "litclaude-rename-alias-"));
    const note = `Note: \`${oldId}\` was renamed to \`${newId}\`; the old name is removed in the next minor.`;
    const run = (prompt) => {
      const result = spawnSync(process.execPath, [join(plugin, "bin", "litclaude-hook.js"), "user-prompt-submit"], {
        cwd, encoding: "utf8", input: JSON.stringify({ prompt, cwd }),
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : "";
    };
    try {
      for (const prompt of [oldId, `$${oldId} inspect the scoped task`]) {
        const context = run(prompt);
        assert.ok(context.includes(`Skill(${agentSkill ?? newId})`), prompt);
        if (newId === "lit-executor") assert.match(context, /BLOCKED:.*cannot switch/);
        else assert.ok(context.includes(`<litclaude-skill-body name="${agentSkill ?? newId}">`), prompt);
        assert.equal(context.split(note).length - 1, 1, prompt);
        assert.ok(context.split("\n").includes(note), "the note must occupy one line");
        if (agentSkill) assert.ok(context.includes(`litclaude:${newId}`));
      }
      if (["hyperplan", "init-deep", "remove-ai-slops", "ai-slop-remover"].includes(oldId)) {
        const trailing = run(`inspect the scoped task then ${oldId}`);
        assert.ok(trailing.includes(`Skill(${newId})`));
        assert.equal(trailing.split(note).length - 1, 1);
      }
      const current = run(newId);
      assert.ok(current.includes(`Skill(${agentSkill ?? newId})`));
      assert.ok(!current.includes("the old name is removed in the next minor"));
      for (const prompt of [`\`${oldId}\``, `\`\`\`\n${oldId}\n\`\`\``, `/${oldId}`, `/litclaude:${oldId}`, `${oldId}-extra`, `prefix_${oldId}_suffix`]) {
        assertNoWorkflowActivationContext(run(prompt), `inert alias boundary: ${prompt}`);
      }
      if (agentSkill) {
        assert.equal(existsSync(join(plugin, "agents", `${oldId}.md`)), false);
        assert.ok(readFileSync(join(plugin, "agents", `${newId}.md`), "utf8").includes(`name: ${newId}\n`));
      } else if (oldId !== "dynamic-workflow") {
        assert.equal(existsSync(join(plugin, "skills", oldId)), false);
        assert.ok(readFileSync(join(plugin, "skills", newId, "SKILL.md"), "utf8").includes(`name: ${newId}\n`));
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test("old command redirects are hidden and dynamic-workflow has no command file", () => {
  for (const oldId of ["init-deep", "korean-ai-slop-remover", "lit-korean"]) {
    const newId = aliases.find(([id]) => id === oldId)[1];
    const command = readFileSync(join(plugin, "commands", `${oldId}.md`), "utf8");
    assert.match(command, /^user-invocable: false$/m);
    assert.match(command, /^disable-model-invocation: true$/m);
    assert.ok(command.includes(`Skill(${newId})`));
    assert.equal(command.split(`Note: \`${oldId}\` was renamed to \`${newId}\`; the old name is removed in the next minor.`).length - 1, 1);
    assert.equal(command.replace(/^---\n[\s\S]*?\n---\n/u, "").trim().split(/\n\s*\n/).length, 1);
  }
  assert.equal(existsSync(join(plugin, "commands", "dynamic-workflow.md")), false);
});

for (const command of ["install", "update"]) {
  test(`${command} refuses unverified old skill trees and installs renamed payload after explicit backup`, () => {
    const sandbox = mkdtempSync(join(tmpdir(), "litclaude-rename-install-"));
    const claudeHome = join(sandbox, "claude");
    const installed = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", version);
    const userSkill = join(claudeHome, "skills", "programming", "SKILL.md");
    try {
      for (const [oldId] of aliases.slice(0, 8)) {
        const directory = join(installed, "skills", oldId);
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, "SKILL.md"), `name: ${oldId}\nold managed copy\n`);
      }
      mkdirSync(join(claudeHome, "skills", "programming"), { recursive: true });
      writeFileSync(userSkill, "unrelated user-owned skill\n");
      const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome, CLAUDE_HOME: claudeHome, LITCLAUDE_HOME: join(sandbox, "litclaude"), LITCLAUDE_NO_AUTO_UPDATE: "1" };
      const rejected = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), command, "--yes", "--no-auto-update"], { cwd: sandbox, env, encoding: "utf8" });
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /INSTALL_OWNERSHIP_CONFLICT/u);
      for (const [oldId] of aliases.slice(0, 8)) {
        assert.equal(readFileSync(join(installed, "skills", oldId, "SKILL.md"), "utf8"), `name: ${oldId}\nold managed copy\n`);
      }
      assert.equal(existsSync(join(claudeHome, "settings.json")), false);
      const backup = join(sandbox, "user-reviewed-backup");
      renameSync(installed, backup);
      const result = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), command, "--yes", "--no-auto-update"], { cwd: sandbox, env, encoding: "utf8" });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      for (const [oldId, newId] of aliases.slice(0, 8)) {
        assert.equal(existsSync(join(installed, "skills", oldId)), false, oldId);
        assert.equal(readFileSync(join(installed, "skills", newId, "SKILL.md"), "utf8"), readFileSync(join(plugin, "skills", newId, "SKILL.md"), "utf8"));
      }
      assert.equal(readFileSync(userSkill, "utf8"), "unrelated user-owned skill\n");
      const doctor = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "doctor", "--no-auto-update"], { cwd: sandbox, env, encoding: "utf8" });
      assert.equal(doctor.status, 0, `${doctor.stdout}\n${doctor.stderr}`);
      for (const oldId of aliases.slice(0, 8).map(([id]) => id)) assert.ok(!doctor.stdout.includes(oldId), oldId);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
}

test("saved verifier alias receipts preserve hashes and cannot count as independent reviewers", () => {
  const inputs = Object.fromEntries(["design_contract_hash", "source_hash", "capture_hash", "artifacts_hash"].map((key) => [key, "a".repeat(64)]));
  const legacy = reviewReceipt("oracle-verifier", "context:legacy", inputs);
  const current = reviewReceipt("lit-verifier", "context:current", inputs);
  const quality = reviewReceipt("quality-reviewer", "context:quality", inputs);
  const schema = JSON.parse(readFileSync(join(plugin, "skills", "visual-qa", "schemas", "review-receipt-v1alpha1.schema.json"), "utf8"));
  const bytes = stableJson(legacy);
  assert.equal(reviewShapeValid(legacy), true);
  assert.equal(schemaAccepts(schema, legacy), true);
  assert.deepEqual(REVIEWERS, ["quality-reviewer", "lit-verifier"]);
  const validate = (receipts) => validateReviewSet(receipts, receipts.map((receipt) => sha256(stableJson(receipt))), inputs, legacy.reviewed_inventory, new Set(), Date.parse(legacy.ended_at), 3600);
  assert.deepEqual(validate([quality, legacy]), { blocked: [], failures: [] });
  assert.ok(validate([legacy, current]).failures.includes("REVIEW_RECEIPT_INDEPENDENCE_INVALID"));
  assert.equal(stableJson(legacy), bytes, "historical receipt bytes and their hashes must not be rewritten");
  for (const id of ["unknown-reviewer", "__proto__", null, { toString: "inert" }]) {
    const unknown = { ...legacy, reviewer_capability: id };
    assert.equal(reviewShapeValid(unknown), false);
    assert.equal(schemaAccepts(schema, unknown), false);
  }
});
