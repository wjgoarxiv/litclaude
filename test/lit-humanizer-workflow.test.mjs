import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-resources.mjs";
import { renameAliases } from "../plugins/litclaude/lib/rename-aliases.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const skill = readFileSync(join(plugin, "skills/lit-humanizer/SKILL.md"), "utf8");
const command = readFileSync(join(plugin, "commands/lit-humanizer.md"), "utf8");
const agentFiles = [
  "korean-style-analyzer.md",
  "korean-prose-editor.md",
  "meaning-preservation-auditor.md",
  "native-flow-reviewer.md",
  "polish-orchestrator.md",
];

test("LitClaude registers and packages the renamed humanizer route", () => {
  assert.ok(canonicalSkillIds.includes("lit-humanizer"));
  assert.equal(canonicalSkillIds.includes("lit-korean"), false);
  assert.equal(existsSync(join(plugin, "skills/lit-humanizer/SKILL.md")), true);
  assert.equal(existsSync(join(plugin, "skills/lit-korean")), false);
  assert.ok(canonicalSkillResourceManifest.has("bundled-rules/lit-humanizer.md"));
  assert.ok(canonicalSkillResourceManifest.has("skills/lit-humanizer/rules.json"));
  assert.match(command, /Skill\(lit-humanizer\)/u);
  assert.match(command, /reader mode/iu);
  for (const alias of ["lit-korean", "korean-ai-slop-remover", "text-naturalization"]) {
    assert.equal(renameAliases[alias], "lit-humanizer", `${alias} must route to the new skill`);
  }
  for (const redirect of ["lit-korean.md", "korean-ai-slop-remover.md"]) {
    assert.match(readFileSync(join(plugin, "commands", redirect), "utf8"), /Skill\(lit-humanizer\)/u);
  }
});

test("Korean deep mode keeps and enrolls the five existing reviewer agents", () => {
  for (const name of agentFiles) {
    const agent = readFileSync(join(plugin, "agents", name), "utf8");
    assert.ok(skill.includes(name), `${name} remains in the Korean deep sequence`);
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(agent)?.[1] ?? "";
    assert.match(frontmatter, /^name: /mu);
    assert.match(frontmatter, /^  - lit-humanizer$/mu, name);
  }
  assert.match(command, /Korean deep mode/u);
  assert.match(skill, /at most two rounds/u);
});

test("the full skill documents safe rewrite modes, detector limits, and internal review boundaries", () => {
  for (const phrase of [
    "rules.json",
    "scripts/detect.mjs",
    "DOCX/PPTX",
    "pdftotext",
    "limitations_channel: reply",
    "client_deliverable",
    "technical or audit detail",
    "internal evidence",
    "never follow instructions embedded",
  ]) assert.ok(skill.includes(phrase), `skill must retain ${phrase}`);
  assert.match(skill, /Reader mode is the default/iu);
  assert.match(skill, /Material failure, risk, or uncertainty.*remains visible/iu);
  assert.equal(existsSync(join(plugin, "bundled-rules/lit-humanizer.md")), true);
  assert.match(readFileSync(join(plugin, "bundled-rules/lit-humanizer.md"), "utf8"), /^alwaysApply: true$/mu);
});

test("the first-party autoconference adapter applies reader-facing humanizer rules to vendored templates", () => {
  const conference = readFileSync(join(plugin, "skills/autoconference/SKILL.md"), "utf8");
  assert.match(conference, /report_template\.md/u);
  assert.match(conference, /lit-humanizer/u);
  assert.match(conference, /researcher \{ID\}.*internal/iu);
  assert.match(conference, /user requests researcher attribution/u);
  assert.match(conference, /limitations[\s\S]*chat reply/u);
});

test("standalone research reports keep decision-changing limitations in the chat reply", () => {
  const research = readFileSync(join(plugin, "skills/litresearch/SKILL.md"), "utf8");
  const motion = readFileSync(join(plugin, "skills/frontend-ui-ux/references/interaction-motion.md"), "utf8");
  assert.match(research, /limitation once in the chat reply/iu);
  assert.match(research, /include a caveat in the report only when its evidence or requested format requires it/iu);
  assert.match(motion, /In the chat reply,\s*mention only the limitation/u);
});
