import { micro } from "../bin/litfamily-banner.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../scripts/strip-ansi.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const originalRoot = join(pluginRoot, "vendor", "scientific-visualization");
const adapterPath = join(pluginRoot, "skills", "lit-scientific-visualization", "SKILL.md");
const commandPath = join(pluginRoot, "commands", "lit-scientific-visualization.md");
const doctorPath = join(pluginRoot, "bin", "litclaude-scientific-visualization-doctor.js");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const approvedManifestHash = "5a01a2768a1b29d4820bdc895fb7cb75c329110fd711de8fd07bdeaa1e42b9ab";

const expectedOriginalHashes = new Map([
  ["SKILL.md", "d6084a7e3adf283157820ea20dbe1b46fa22fa1be17b138ab1203be550f4ef68"],
  ["assets/color_palettes.py", "ffea28da930406ecb11bbeaebfc530dfac40b772827a7653f449cb3b0bb35309"],
  ["assets/nature.mplstyle", "6a7343788bf772b7e1bc813d094f7bafa97c1e5544586e7b76002ad8547229b6"],
  ["assets/presentation.mplstyle", "e3ee23f0470d7fb07a0be75cd1210e231becfc2f5267aa404e4186aa077a3339"],
  ["assets/publication.mplstyle", "18447af3bc47310d23fc27255413c23d8bbe3ff441463cc54fcecdfacd205bea"],
  ["evals/evals.json", "366dc61b6e042f08f28bf33f2534feea80219d771b84497ec7094b30263e935b"],
  ["references/color_palettes.md", "0298691c8de8379570488a7b7768663971bc20af1fb05d464c5438d43a21dcfa"],
  ["references/journal_requirements.md", "56fdde590a9d778547dbcb609b77d86f1f31865e803bcecca5d8c4c72b91b3c7"],
  ["references/matplotlib_examples.md", "c99cd4f83e2452773e9580e2fa0984e61433c7a9b57ca0d2562dc400dfe4f83d"],
  ["references/mdanalysis_martini_visualization.md", "abcb3c61f1c3984ba9014d9ae197b726d23c1df844dc90988ecc4d8f0e349bfe"],
  ["references/publication_guidelines.md", "d9f5d0f115872c4c190a11d83432d44635e38ef9f1740db471fcc70f4c91dd2c"],
  ["references/seaborn_for_publications.md", "2da2147ae8974b4b5d16096c1484b982d5d1e5f91113808ebfd12111a0a6597a"],
  ["scripts/figure_export.py", "b22c7708afaf2a1cfa4f821eb9230d4262f1d52948af7f0815855aa9d0960403"],
  ["scripts/style_presets.py", "e9d450bd4ab6b11303b02d5029177c8d49466cc597648d12de0ecdb7620f64c4"],
  ["tests/test_figure_export.py", "b18414369e6721ad93d417914114d71af006248675eb20bb1f4989c48ec9a58e"],
  ["tests/test_style_presets.py", "ff0e190196480848f1fea2398220038771f386ee7967a0ef122b0dfbca3aed46"],
]);

const listFiles = (directory) => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
  .sort();

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = (path) => sha256Bytes(readFileSync(path));

const runHook = (prompt) => spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
  env: { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color" },
  cwd: root,
  encoding: "utf8",
  input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
});

describe("LitClaude scientific-visualization payload", () => {
  it("preserves exactly the 16 approved authored files and aggregate manifest", () => {
    assert.equal(existsSync(originalRoot), true, "vendored scientific source root must exist");
    assert.deepEqual(listFiles(originalRoot), [...expectedOriginalHashes.keys()].sort());

    const records = [];
    for (const [file, expectedHash] of expectedOriginalHashes) {
      const actualHash = sha256File(join(originalRoot, file));
      assert.equal(actualHash, expectedHash, `${file} must preserve its approved SHA-256`);
      records.push(`${actualHash}  scientific-visualization/${file}\n`);
    }
    assert.equal(sha256Bytes(records.join("")), approvedManifestHash);
    assert.equal(listFiles(originalRoot).some((file) => file.endsWith(".pyc") || file.includes("__pycache__")), false);
  });

  it("ships the native adapter, command, doctor, MIT license, and provenance", () => {
    for (const path of [adapterPath, commandPath, doctorPath]) {
      assert.equal(existsSync(path), true, `${path} must exist`);
    }
    const adapter = readFileSync(adapterPath, "utf8");
    const command = readFileSync(commandPath, "utf8");
    const license = readFileSync(join(pluginRoot, "vendor", "licenses", "045_scientific-visualization-MIT.txt"), "utf8");
    const provenance = readFileSync(join(pluginRoot, "vendor", "provenance", "045_scientific-visualization.md"), "utf8");

    assert.match(adapter, /name:\s*lit-scientific-visualization/u);
    assert.match(adapter, /disable-model-invocation:\s*true/u);
    assert.match(adapter, /contract_schema_version:\s*litclaude\.llm-contract\.v1/u);
    assert.match(adapter, /\.\.\/\.\.\/vendor\/scientific-visualization/u);
    assert.match(adapter, /resolve.*relative.*SKILL\.md/isu);
    assert.match(adapter, /DEGRADED/u);
    assert.match(adapter, /source root.*scripts.*assets/isu);
    assert.match(adapter, /insert.*scripts.*assets.*module search path/isu);
    assert.match(adapter, /begin.*exact probe.*🔥 \*\*LIT IGNITED · lit-scientific-visualization\*\* 🔥/isu);
    assert.match(adapter, /hook-routed/u);
    assert.match(adapter, /UserPromptSubmit/u);
    assert.match(adapter, /do not.*install|never.*install/iu);
    assert.match(command, /Skill\(lit-scientific-visualization\)/u);
    assert.match(command, /🔥 \*\*LIT IGNITED · lit-scientific-visualization\*\* 🔥/u);
    assert.match(license, /^MIT License/mu);
    assert.match(provenance, new RegExp(approvedManifestHash, "u"));
    assert.match(provenance, /CP\/SDS/u);
  });

  it("routes only exact bare lit-scientific-visualization with a visible banner and complete canonical source", () => {
    const result = runHook("  LIT-SCIENTIFIC-VISUALIZATION\n");
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const context = payload.hookSpecificOutput.additionalContext;
    const canonicalSkill = readFileSync(join(originalRoot, "SKILL.md"), "utf8").trim();

    assert.match(stripAnsi(payload.systemMessage ?? ""), /🔥 LIT IGNITED · lit-scientific-visualization 🔥/u);
    assert.match(context, /begin your reply with the exact probe line `🔥 \*\*LIT IGNITED · lit-scientific-visualization\*\* 🔥`/iu);
    assert.match(context, /\/litclaude:lit-scientific-visualization/u);
    assert.match(context, /Skill\(lit-scientific-visualization\)/u);
    assert.match(context, new RegExp(`canonical source root.*${originalRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "iu"));
    assert.equal(context.includes(canonicalSkill), true, "exact bare route must inject the complete canonical source body");
    assert.match(context, /never install Python, matplotlib, or optional packages silently/iu);
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
      "/litclaude:lit-scientific-visualization",
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

  it("enrolls the capability in docs and both doctor surfaces", () => {
    for (const file of ["README.md", "README_ko-KR.md", "docs/hooks.md", "docs/workflow-compatibility-audit.md"]) {
      assert.match(readFileSync(join(root, file), "utf8"), /lit-scientific-visualization/u, `${file} must list the skill`);
    }
    for (const file of ["scripts/doctor.mjs", "bin/litclaude-ai.js"]) {
      const source = readFileSync(join(root, file), "utf8");
      assert.match(source, /litclaude-scientific-visualization-doctor\.js/u, `${file} must run the capability doctor`);
      assert.match(source, /canonicalSkillFiles/u, `${file} must consume the shared skill catalog`);
    }
    assert.match(
      readFileSync(join(root, "plugins", "litclaude", "lib", "canonical-skill-catalog.mjs"), "utf8"),
      /"lit-scientific-visualization"/u,
    );
    const capabilityDoctor = readFileSync(doctorPath, "utf8");
    assert.match(capabilityDoctor, /source_root \/ "assets"/u);
    assert.match(capabilityDoctor, /import color_palettes/u);
    assert.match(readFileSync(join(root, "README.md"), "utf8"), /exact bare `lit-scientific-visualization`/u);
    assert.match(readFileSync(join(root, "README_ko-KR.md"), "utf8"), /정확한 bare `lit-scientific-visualization`/u);
    assert.match(readFileSync(join(root, "docs", "hooks.md"), "utf8"), /exact-bare.*`lit-scientific-visualization`/isu);
    assert.match(readFileSync(join(root, "docs", "workflow-compatibility-audit.md"), "utf8"), /exact-bare hook/iu);
  });

  it("packs all adapters, metadata, and the exact authored source payload", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const files = new Set(JSON.parse(result.stdout)[0].files.map(({ path }) => path));
    for (const path of [
      "plugins/litclaude/skills/lit-scientific-visualization/SKILL.md",
      "plugins/litclaude/commands/lit-scientific-visualization.md",
      "plugins/litclaude/bin/litclaude-scientific-visualization-doctor.js",
      "plugins/litclaude/vendor/licenses/045_scientific-visualization-MIT.txt",
      "plugins/litclaude/vendor/provenance/045_scientific-visualization.md",
      ...[...expectedOriginalHashes.keys()].map((file) => `plugins/litclaude/vendor/scientific-visualization/${file}`),
    ]) {
      assert.equal(files.has(path), true, `${path} must be packed`);
    }
    assert.equal([...files].some((file) => /scientific-visualization\/.+(?:__pycache__|\.pyc$)/u.test(file)), false);
  });

  // The immutable source examples save to fixed names (figure1.pdf, figure1.png,
  // multi_panel.pdf) and figures are written through Bash, so the harness
  // read-before-write guard never sees them. The adapter has to carry the rule.
  it("requires explicit output paths and forbids clobbering unrelated figures", () => {
    const adapter = readFileSync(adapterPath, "utf8");
    assert.match(adapter, /explicit output path/iu);
    assert.match(adapter, /(do not|never)[^.]*overwrit/iu);
  });

});
