import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";

// lit-diagram-drawer moved to the figures plugin of wjgoarxiv-skills; its body tests left with it. What stays here is
// the same-name stub's enrollment and its routing boundary (test/figures-stubs.test.mjs covers the stub text).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const skillRoot = join(pluginRoot, "skills", "lit-diagram-drawer");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const skillFiles = walk(skillRoot).map((file) => relative(skillRoot, file).replaceAll("\\", "/"));

const hookSkills = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const activation = context.split("\n\n## Project Instructions\n", 1)[0];
  return { context: activation, skills: [...new Set([...activation.matchAll(/Skill\(([a-z-]+)\)/gu)].map((match) => match[1]))] };
};

describe("lit-diagram-drawer stub enrollment", () => {
  it("is in the skill catalog, the pinned resource trees, and the resource hash manifest", () => {
    assert.ok(canonicalSkillIds.includes("lit-diagram-drawer"));
    assert.match(readFileSync(join(root, "tools", "gen-canonical-skill-resources.mjs"), "utf8"), /"skills\/lit-diagram-drawer",/u);
    for (const file of skillFiles) {
      assert.ok(canonicalSkillResourceManifest.has(`skills/lit-diagram-drawer/${file}`), `unpinned resource ${file}`);
    }
  });

  it("is wired to the prompt hook and documented in both guides, the hook guide, and the changelog", () => {
    const hook = readFileSync(hookPath, "utf8");
    assert.match(hook, /"lit-diagram-drawer": \{ command: "\/litclaude:lit-diagram-drawer"/u);
    assert.match(hook, /"lit-diagram-drawer": "Mode contract: lit-diagram-drawer moved/u);
    for (const doc of ["docs/guide.md", "docs/guide_ko-KR.md", "docs/skills.md", "docs/skills_ko-KR.md", "docs/hooks.md", "CHANGELOG.md"]) {
      assert.match(readFileSync(join(root, doc), "utf8"), /lit-diagram-drawer/u, `${doc} must document the skill`);
    }
  });

  it("frontend-ui-ux still sends standalone diagrams to it", () => {
    assert.match(readFileSync(join(pluginRoot, "skills", "frontend-ui-ux", "SKILL.md"), "utf8"), /`lit-diagram-drawer`/u);
  });
});

describe("lit-diagram-drawer routing boundary", () => {
  it("activates on a leading token or dollar route with the installed SKILL.md path", () => {
    for (const prompt of ["lit-diagram-drawer draw the deployment boundary", "$lit-diagram-drawer 배포 구조를 그려줘"]) {
      const { context, skills } = hookSkills(prompt);
      assert.deepEqual(skills, ["lit-diagram-drawer"], prompt);
      assert.ok(context.includes(JSON.stringify(join(skillRoot, "SKILL.md"))), prompt);
      assert.match(context, /LIT IGNITED · lit-diagram-drawer/u);
    }
  });

  it("stays inert for mentions, quotes, fences, near misses, and the slash route", () => {
    for (const prompt of ["explain what lit-diagram-drawer does", "`lit-diagram-drawer`", "```\nlit-diagram-drawer\n```", "lit-diagram-drawers draw", "/litclaude:lit-diagram-drawer draw it"]) {
      assert.ok(!hookSkills(prompt).skills.includes("lit-diagram-drawer"), prompt);
    }
  });

  it("leaves generic diagram wording, interface design, and measured-data plots with their owners", () => {
    assert.deepEqual(hookSkills("draw a diagram of our deployment").skills, []);
    assert.deepEqual(hookSkills("plot the measured tensile data with error bars").skills, []);
    assert.deepEqual(hookSkills("design a new settings page UI").skills, ["frontend-ui-ux"]);
    assert.deepEqual(hookSkills("lit-scientific-visualization").skills, ["lit-scientific-visualization"]);
  });
});
