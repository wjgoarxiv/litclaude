import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The figures family (lit-diagram-drawer, lit-schematic, lit-scientific-visualization and the scientific-visualization
// source it adapts) moved to the `figures` plugin of the wjgoarxiv-skills marketplace. LitClaude keeps a same-name
// stub for each of the three skill ids: the ids, the `lit` routes, the slash command and the exact-bare route still
// work, and they lead to the install line. The lit-diagram-drawer stub keeps the Pretendard variable font and its
// licence, because frontend-ui-ux's design kit copies them by path and hash.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const IDS = ["lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"];
const stubRoot = (id) => join(pluginRoot, "skills", id);
const stub = (id) => readFileSync(join(stubRoot(id), "SKILL.md"), "utf8");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

const hook = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

const ROUTES = [
  ["lit-diagram-drawer", "lit-diagram-drawer draw the request flow of the billing service"],
  ["lit-schematic", "lit-schematic draw a P&ID for a flash drum"],
  ["lit-schematic", "lit P&ID 그려줘 flash drum"],
  ["lit-scientific-visualization", "lit-scientific-visualization"],
  ["lit-scientific-visualization", "/litclaude:lit-scientific-visualization plot the isotherm in data.csv"],
];

describe("the figures skills are same-name stubs for the figures extras plugin", () => {
  for (const id of IDS) {
    it(`${id} says what it did, where it lives now and how to install it`, () => {
      const md = stub(id);
      assert.match(md, new RegExp(`^---\\nname: ${id}\\n`, "u"));
      assert.match(md, /wjgoarxiv-skills/u);
      assert.match(md, /claude plugin marketplace add <path to your wjgoarxiv-skills clone>/u);
      assert.match(md, /not (?:been )?published yet/iu, "says plainly the public marketplace is not published yet");
      assert.match(md, /claude plugin install figures@wjgoarxiv-skills/u);
      assert.match(md, new RegExp(`figures:${id}`, "u"));
      assert.match(md, /after (?:it is )?publi/iu, "says the GitHub form comes after publication");
      assert.doesNotMatch(md, /\/Users\/[a-z]/u, "no private home path");
      assert.doesNotMatch(md, /install lines above/u, "the install lines sit below, in What moved");
      assert.ok(Buffer.byteLength(md) < 9000, `${Buffer.byteLength(md)} bytes`);
    });
  }

  it("each stub is SKILL.md alone, except the Pretendard pair frontend-ui-ux reuses from lit-diagram-drawer", () => {
    const files = (id) => walk(stubRoot(id)).map((f) => relative(stubRoot(id), f)).sort();
    assert.deepEqual(files("lit-diagram-drawer"), ["SKILL.md", "assets/fonts/OFL.txt", "assets/fonts/PretendardVariable.woff2"]);
    assert.deepEqual(files("lit-schematic"), ["SKILL.md"]);
    assert.deepEqual(files("lit-scientific-visualization"), ["SKILL.md"]);
  });

  it("keeps the font bytes the frontend-ui-ux design kit checks by hash", () => {
    const kit = join(pluginRoot, "skills", "frontend-ui-ux", "kit");
    const manifest = JSON.parse(readFileSync(join(kit, "fonts.json"), "utf8"));
    const pretendard = manifest.fonts.find((f) => f.family === "Pretendard");
    for (const f of [pretendard, pretendard.licence]) {
      const sha = createHash("sha256").update(readFileSync(resolve(kit, f.source))).digest("hex");
      assert.equal(sha, f.sha256, f.source);
    }
  });

  it("the scientific-visualization source, its doctor and their doctor lines left with it", () => {
    for (const path of ["vendor/scientific-visualization", "vendor/provenance/045_scientific-visualization.md", "vendor/licenses/045_scientific-visualization-MIT.txt", "bin/litclaude-scientific-visualization-doctor.js"]) {
      assert.equal(existsSync(join(pluginRoot, path)), false, path);
    }
    for (const file of ["scripts/doctor.mjs", "bin/litclaude-ai.js", "plugins/litclaude/lib/bundled-skills-integrity.mjs", "plugins/litclaude/bin/litclaude-hook.js"]) {
      assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /vendor\/scientific-visualization|scientific-visualization-doctor|scientificVisualizationHashes/u, file);
    }
  });

  it("every figures route still reaches its stub and carries the install line", () => {
    for (const [id, prompt] of ROUTES) {
      const context = hook(prompt);
      assert.match(context, new RegExp(`Skill\\(${id}\\)`, "u"), prompt);
      assert.match(context, new RegExp(`name="${id}"`, "u"), prompt);
      assert.match(context, /figures@wjgoarxiv-skills/u, prompt);
      assert.match(context, new RegExp(`figures:${id}`, "u"), prompt);
      assert.match(context, /<path to your wjgoarxiv-skills clone>/u, prompt);
      assert.match(context, /not published yet/u, prompt);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${prompt}: ${Buffer.byteLength(context, "utf8")} bytes`);
    }
  });

  it("a figures context carries no leftover procedure from the old bodies", () => {
    for (const [, prompt] of ROUTES) {
      const context = hook(prompt);
      for (const leftover of ["AskUserQuestion", "SKILL_ROOT", "qa.mjs", "render.mjs", "scaffold.mjs", "rcparams", "Canonical source root", "litclaude-canonical-source", "Office-safe SVG", "matplotlib"]) {
        assert.ok(!context.includes(leftover), `${prompt}: ${leftover}`);
      }
    }
  });

  it("the slash command for lit-scientific-visualization points at the moved skill", () => {
    const command = readFileSync(join(pluginRoot, "commands", "lit-scientific-visualization.md"), "utf8");
    assert.match(command, /figures@wjgoarxiv-skills/u);
    assert.match(command, /\/figures:lit-scientific-visualization/u);
    assert.doesNotMatch(command, /bundled LitClaude scientific visualization capability/u);
  });
});
