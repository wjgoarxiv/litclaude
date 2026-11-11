import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../scripts/strip-ansi.mjs";

// lit-scientific-visualization moved, with the scientific-visualization source and its doctor, to the figures plugin
// of wjgoarxiv-skills. LitClaude keeps the same-name stub, the slash command and the exact-bare route; this file checks
// that both routes still answer with the stub and that everything else stays inert, as before.
const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");

const runHook = (prompt) => spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
  env: { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color" },
  cwd: root,
  encoding: "utf8",
  input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
});

describe("lit-scientific-visualization stub routes", () => {
  it("routes exact bare lit-scientific-visualization with a visible banner to the stub", () => {
    const result = runHook("  LIT-SCIENTIFIC-VISUALIZATION\n");
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const context = payload.hookSpecificOutput.additionalContext;
    assert.match(stripAnsi(payload.systemMessage ?? ""), /🔥 LIT IGNITED · lit-scientific-visualization 🔥/u);
    assert.match(context, /begin your reply with the exact probe line `🔥 \*\*LIT IGNITED · lit-scientific-visualization\*\* 🔥`/iu);
    assert.match(context, /Skill\(lit-scientific-visualization\)/u);
    assert.match(context, /\/figures:lit-scientific-visualization/u);
    assert.match(context, /never install Python packages/iu);
  });

  it("answers the typed slash command with the stub and never echoes its arguments", () => {
    for (const prompt of [
      "/litclaude:lit-scientific-visualization",
      "  /litclaude:lit-scientific-visualization plot the CO2 isotherms in data/iso.csv\nAPI_TOKEN=do-not-echo",
    ]) {
      const result = runHook(prompt);
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      const context = payload.hookSpecificOutput.additionalContext;
      assert.match(stripAnsi(payload.systemMessage ?? ""), /🔥 LIT IGNITED · lit-scientific-visualization 🔥/u, prompt);
      assert.match(context, /figures@wjgoarxiv-skills/u, prompt);
      assert.doesNotMatch(context, /do-not-echo|iso\.csv/u, "the prompt is never echoed");
    }
  });

  it("keeps generic, quoted, fenced, mixed, slash, and near-miss prompts inert", () => {
    for (const prompt of [
      "visualize this dataset",
      "scientific visualization",
      "Please make a publication plot",
      "Please run lit-scientific-visualization",
      "lit-scientific-visualization with this dataset",
      "lit_scientific_visualization",
      "`lit-scientific-visualization`",
      "```text\nlit-scientific-visualization\n```",
      "> lit-scientific-visualization",
      "see /litclaude:lit-scientific-visualization later",
      "/litclaude:lit-scientific-visualizations",
      "lit-scientific-visualization\nAPI_TOKEN=do-not-echo",
    ]) {
      const result = runHook(prompt);
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.systemMessage, undefined, `${prompt} must not activate the exact-bare prompt hook route`);
      assert.match(payload.hookSpecificOutput.additionalContext, /no workflow activation/u);
      assert.doesNotMatch(payload.hookSpecificOutput.additionalContext, /do-not-echo/u);
    }
  });

  it("stays enrolled in the catalog and documented where the routes are", () => {
    for (const file of ["docs/guide.md", "docs/guide_ko-KR.md", "docs/skills.md", "docs/skills_ko-KR.md", "docs/hooks.md", "docs/workflow-compatibility-audit.md"]) {
      assert.match(readFileSync(join(root, file), "utf8"), /lit-scientific-visualization/u, `${file} must list the skill`);
    }
    assert.match(
      readFileSync(join(root, "plugins", "litclaude", "lib", "canonical-skill-catalog.mjs"), "utf8"),
      /"lit-scientific-visualization"/u,
    );
  });

  it("packs the stub and the command, and none of the moved source", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const files = new Set(JSON.parse(result.stdout)[0].files.map(({ path }) => path));
    for (const path of ["plugins/litclaude/skills/lit-scientific-visualization/SKILL.md", "plugins/litclaude/commands/lit-scientific-visualization.md"]) {
      assert.equal(files.has(path), true, `${path} must be packed`);
    }
    assert.equal([...files].some((file) => /vendor\/scientific-visualization\/|045_scientific-visualization|scientific-visualization-doctor/u.test(file)), false);
  });
});
