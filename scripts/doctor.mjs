#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalSkillFiles,
  canonicalSkillResourceFiles,
} from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { verifyCanonicalSkillResources } from "../plugins/litclaude/lib/skill-resource-integrity.mjs";
import { verifyCanonicalFrontendCorpus } from "../plugins/litclaude/lib/canonical-frontend-corpus.mjs";
import { verifyCanonicalRuntimeClosures } from "../plugins/litclaude/lib/canonical-runtime-closures.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });

  process.stdout.write(`\n## ${label}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stdout.write(result.stderr);

  if (result.status !== 0) {
    process.stderr.write(`${label} failed with status ${result.status}\n`);
    process.exit(result.status ?? 1);
  }
}

run("CLI dry-run", process.execPath, ["bin/litclaude-ai.js", "--dry-run", "doctor"]);
run("Plugin validation", process.execPath, ["scripts/validate-plugin.mjs"]);
run("Workflow readiness", process.execPath, ["bin/litclaude-ai.js", "workflow-check", "--json"]);
run("LSP doctor", process.execPath, ["plugins/litclaude/bin/litclaude-lsp-doctor.js"]);
run("Scientific visualization capability", process.execPath, ["plugins/litclaude/bin/litclaude-scientific-visualization-doctor.js"]);
// Readiness only: the lit-pptx/lit-docx runtime installs on first use, so "not installed" is not a failure.
run("Office runtime (lit-pptx, lit-docx)", process.execPath, ["plugins/litclaude/lib/office-runtime.mjs", "status"]);
// Readiness only, never fatal: the five lit-typographic-motion probes (Chrome, ffmpeg, WebGL2
// renderer, software-GL warning, pre-warm state with its fix command).
run("Motion runtime (lit-typographic-motion)", process.execPath, ["plugins/litclaude/skills/lit-typographic-motion/scripts/motion-doctor.mjs"]);

for (const file of [
  "plugins/litclaude/lib/litgoal/paths.mjs",
  "plugins/litclaude/lib/litgoal/state.mjs",
  "plugins/litclaude/lib/litgoal/ledger.mjs",
  "plugins/litclaude/lib/litgoal/cli.mjs",
  "plugins/litclaude/lib/start-work-lifecycle.mjs",
  "plugins/litclaude/lib/start-work-cli.mjs",
  "plugins/litclaude/commands/start-work.md",
  "plugins/litclaude/commands/lit-handoff.md",
  "plugins/litclaude/vendor/handoff/SKILL.md",
  "plugins/litclaude/vendor/handoff/evals/evals.json",
  "plugins/litclaude/vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
  "plugins/litclaude/vendor/handoff/templates/HANDOFF.md",
  "plugins/litclaude/commands/lit-scientific-visualization.md",
  "plugins/litclaude/vendor/scientific-visualization/SKILL.md",
  "plugins/litclaude/vendor/scientific-visualization/scripts/style_presets.py",
  "plugins/litclaude/vendor/scientific-visualization/scripts/figure_export.py",
  "plugins/litclaude/vendor/scientific-visualization/assets/color_palettes.py",
  "plugins/litclaude/vendor/provenance/022_handoff.md",
  "plugins/litclaude/vendor/provenance/045_scientific-visualization.md",
  "plugins/litclaude/vendor/licenses/022_handoff-MIT.txt",
  "plugins/litclaude/vendor/licenses/045_scientific-visualization-MIT.txt",
]) {
  if (!existsSync(join(root, file))) {
    process.stderr.write(`Runtime payload missing: ${file}\n`);
    process.exit(1);
  }
}

for (const file of canonicalSkillFiles) {
  const relativePath = `plugins/litclaude/${file}`;
  if (!existsSync(join(root, relativePath))) {
    process.stderr.write(`Runtime payload missing: ${relativePath}\n`);
    process.exit(1);
  }
}
if (!canonicalSkillFiles.every((file) => canonicalSkillResourceFiles.includes(file))) {
  process.stderr.write("SKILL_RESOURCE_INTEGRITY_FAIL canonical resource inventory omits a skill entrypoint\n");
  process.exit(1);
}
process.stdout.write("\nSKILL_CATALOG_PASS\n");
const skillResourceIntegrity = verifyCanonicalSkillResources(join(root, "plugins/litclaude"));
if (skillResourceIntegrity.status !== "PASS") {
  process.stderr.write(`SKILL_RESOURCE_INTEGRITY_FAIL ${JSON.stringify(skillResourceIntegrity.failures)}\n`);
  process.exit(1);
}
process.stdout.write(`SKILL_RESOURCE_INTEGRITY_PASS: ${skillResourceIntegrity.checked} resources\n`);
const canonicalFrontend = verifyCanonicalFrontendCorpus(join(root, "plugins/litclaude"));
if (canonicalFrontend.status !== "PASS") {
  process.stderr.write(`CANONICAL_FRONTEND_CORPUS_FAIL ${JSON.stringify(canonicalFrontend.failures)}\n`);
  process.exit(1);
}
process.stdout.write(`CANONICAL_FRONTEND_CORPUS_PASS: ${canonicalFrontend.checkedFiles} files; ${canonicalFrontend.corpusBytes} corpus bytes\n`);
const runtimeClosures = verifyCanonicalRuntimeClosures(join(root, "plugins/litclaude"));
if (runtimeClosures.status !== "PASS") {
  process.stderr.write(`CANONICAL_RUNTIME_CLOSURES_FAIL ${JSON.stringify(runtimeClosures.failures)}\n`);
  process.exit(1);
}
process.stdout.write(`CANONICAL_RUNTIME_CLOSURES_PASS: ${runtimeClosures.families.map(({ id, checked }) => `${id}=${checked}`).join(" ")}\n`);

process.stdout.write("\nLITGOAL_RUNTIME_PASS\n");
process.stdout.write("START_WORK_LIFECYCLE_PASS: schema-3 bounded-authority runtime enrolled\n");
process.stdout.write("START_WORK_HOST_HOOKS_PASS: PreToolUse, SubagentStart, SubagentStop, SessionEnd, and Stop enrolled\n");
process.stdout.write("BUNDLED_SKILLS_PAYLOAD_PASS\n");
process.stdout.write("\nDOCTOR_PASS\n");
