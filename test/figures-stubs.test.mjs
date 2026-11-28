import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The figures family (lit-diagram-drawer, lit-schematic, lit-scientific-visualization and the scientific-visualization
// source it adapts) moved to the `figures` plugin of the wjgoarxiv-skills marketplace. LitClaude keeps a same-name
// stub for each of the three skill ids: the ids, the `lit` routes, the slash command and the exact-bare route still
// work, and they lead to the install line. The Pretendard pair the lit-diagram-drawer stub kept for frontend-ui-ux's
// design kit left when that kit moved with the design family.
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
      assert.match(md, /^claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills$/mu, "installs from the public GitHub marketplace");
      assert.doesNotMatch(md, /not (?:been )?published yet/iu, "no longer calls the public marketplace unpublished");
      assert.match(md, /claude plugin install figures@wjgoarxiv-skills/u);
      assert.match(md, new RegExp(`figures:${id}`, "u"));
      assert.match(md, /Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`\./u, "keeps the local clone as the offline form");
      assert.doesNotMatch(md, /\/Users\/[a-z]/u, "no private home path");
      assert.doesNotMatch(md, /install lines above/u, "the install lines sit below, in What moved");
      assert.ok(Buffer.byteLength(md) < 9000, `${Buffer.byteLength(md)} bytes`);
    });
  }

  it("each stub is SKILL.md alone", () => {
    const files = (id) => walk(stubRoot(id)).map((f) => relative(stubRoot(id), f)).sort();
    assert.deepEqual(files("lit-diagram-drawer"), ["SKILL.md"]);
    assert.deepEqual(files("lit-schematic"), ["SKILL.md"]);
    assert.deepEqual(files("lit-scientific-visualization"), ["SKILL.md"]);
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
      assert.match(context, /claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills/u, prompt);
      assert.doesNotMatch(context, /not published yet|<path to your wjgoarxiv-skills clone>/u, prompt);
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

  // figures 0.1.1 dropped `disable-model-invocation` from the moved skill, so the stub loads it like its two siblings.
  it("the lit-scientific-visualization stub loads the moved skill when the session lists it", () => {
    const md = stub("lit-scientific-visualization");
    const command = readFileSync(join(pluginRoot, "commands", "lit-scientific-visualization.md"), "utf8");
    assert.doesNotMatch(md, /^disable-model-invocation:/mu, "the stub is model-invocable");
    assert.match(md, /moved_to: "figures@wjgoarxiv-skills → Skill\(figures:lit-scientific-visualization\)"/u);
    assert.match(md, /^description: .*Loads Skill\(figures:lit-scientific-visualization\) when installed/mu);
    assert.match(command, /^description: .*Loads Skill\(figures:lit-scientific-visualization\) when installed/mu, "the command shares the stub's name, so its description is the one the host lists");
    for (const [name, text] of [["stub", md], ["command", command]]) {
      assert.match(text, /load\s+`Skill\(figures:lit-scientific-visualization\)`/u, `${name} loads the moved skill`);
      assert.match(text, /claude plugin update figures@wjgoarxiv-skills/u, `${name} names the update for a figures 0.1.0 copy`);
      assert.match(text, /claude plugin install figures@wjgoarxiv-skills/u, `${name} keeps the install line`);
      assert.doesNotMatch(text, /user-invoked only|cannot load it|\| any \| always \|/u, `${name} no longer calls the skill typed-only`);
    }
    assert.doesNotMatch(readFileSync(hookPath, "utf8"), /user-invoked only|sci-vis adapter below|The adapter is disable-model-invocation/u);
  });

  it("the stub, the command page and the hook name the figures 0.1.0 case in the same words", () => {
    const plain = (text) => text.replaceAll("`", "").replace(/\s+/gu, " ");
    const texts = [
      ["stub", plain(stub("lit-scientific-visualization"))],
      ["command", plain(readFileSync(join(pluginRoot, "commands", "lit-scientific-visualization.md"), "utf8"))],
      ["hook", plain(hook("lit-scientific-visualization"))],
    ];
    for (const [name, text] of texts) {
      assert.match(text, /another figures: skill is listed but this one is not, the figures plugin is the 0\.1\.0 copy/u, name);
      assert.match(text, /plot nothing/u, name);
      assert.match(text, /the typed \/figures:lit-scientific-visualization[^.]*runs it meanwhile/u, name);
    }
    assert.doesNotMatch(texts[0][1], /figures:lit-diagram-drawer or figures:lit-schematic/u, "the stub no longer names two siblings for the 0.1.0 case");
  });

  it("the command page checks for a same-name skill folder of the user's own, like the stub", () => {
    const command = readFileSync(join(pluginRoot, "commands", "lit-scientific-visualization.md"), "utf8");
    assert.match(command, /~\/\.claude\/skills\/lit-scientific-visualization/u);
    assert.match(command, /(?<!~\/)\.claude\/skills\/lit-scientific-visualization/u);
    assert.match(command, /competes with `figures:lit-scientific-visualization`/u);
    assert.match(command, /Never move it yourself/u);
  });

  it("the command page prints the banner only when the prompt hook's context asked for it", () => {
    const command = readFileSync(join(pluginRoot, "commands", "lit-scientific-visualization.md"), "utf8");
    const banner = "🔥 **LIT IGNITED · lit-scientific-visualization** 🔥";
    const places = command.split("\n").map((line, index, lines) => ({ line, context: lines.slice(Math.max(0, index - 2), index + 1).join(" ") })).filter(({ line }) => line.includes(banner));
    assert.ok(places.length >= 2, "the banner is still named");
    for (const { line, context } of places) {
      assert.match(context, /prompt hook'?s? context/u, `the banner line depends on the hook's context: ${line}`);
    }
    assert.match(command, /model-made `Skill\(lit-scientific-visualization\)` call[^.]*no banner/u);
  });

  it("both lit-scientific-visualization routes tell Claude to load the moved skill, and keep the fallbacks", () => {
    for (const prompt of ["lit-scientific-visualization", "/litclaude:lit-scientific-visualization plot the isotherm in data.csv"]) {
      const context = hook(prompt);
      assert.ok(context.includes("Begin your reply with the exact probe line `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`"), `${prompt}: the typed route still asks for the banner the command page waits for`);
      assert.match(context, /load Skill\(figures:lit-scientific-visualization\) and follow it for the whole figure/u, prompt);
      assert.match(context, /claude plugin update figures@wjgoarxiv-skills/u, prompt);
      assert.match(context, /claude plugin install figures@wjgoarxiv-skills/u, prompt);
      assert.match(context, /\/figures:lit-scientific-visualization/u, prompt);
      assert.doesNotMatch(context, /user-invoked only|cannot be loaded from here/u, prompt);
    }
  });
});
