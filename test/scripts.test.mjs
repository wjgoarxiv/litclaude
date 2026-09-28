import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { noNetworkNoWrite, retrievalDeterministic } from "./helpers/uiux-contract-cases.mjs";
import { forgedEvidenceZeroPass, strictEvidenceSchemas } from "./helpers/forged-evidence-cases.mjs";
import { eightScenarioDriver, importerCheckContract } from "./helpers/importer-scenario-cases.mjs";
import { pngStructureAndMetrics, tuiTopologyAndControls } from "./helpers/png-tui-hardening-cases.mjs";
import { strictDesignContract, strictQueryArguments } from "./helpers/strict-design-contract-cases.mjs";
import { blockedCapabilities, evidenceContract } from "./helpers/visual-evidence-cases.mjs";
import { pngResourceBounds, tuiUnicodeOsc } from "./helpers/visual-media-cases.mjs";
import {
  designContract as realSurfaceDesignContract,
  writeEvidenceBundle,
} from "../scripts/qa-real-surface-lib.mjs";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

test("package exposes local validation, doctor, QA, and pack scripts", async () => {
  const pkg = await json("package.json");

  // The preload turns the install-time motion pre-warm off, so installer tests stay offline.
  assert.equal(pkg.scripts.test, "node --test --test-concurrency=1 --import ./test/helpers/motion-offline-prewarm.mjs test/*.test.mjs");
  assert.equal(pkg.scripts.postinstall, "node scripts/postinstall.mjs");
  assert.equal(pkg.scripts["validate:plugin"], "node scripts/validate-plugin.mjs");
  assert.equal(pkg.scripts.doctor, "node scripts/doctor.mjs");
  assert.equal(pkg.scripts["qa:tmux"], "bash scripts/qa-claude-plugin-smoke.sh");
  assert.equal(pkg.scripts["qa:portable"], "bash scripts/qa-portable-install.sh");
  assert.equal(pkg.scripts["pack:dry-run"], "npm pack --dry-run");
});

test("local validation and smoke harness files exist", async () => {
  const files = [
    "scripts/validate-plugin.mjs",
    "scripts/doctor.mjs",
    "scripts/postinstall.mjs",
    "scripts/audit-plan-checkboxes.mjs",
    "scripts/qa-claude-plugin-smoke.sh",
    "scripts/qa-portable-install.sh",
  ];
  for (const file of files) await access(new URL(file, root));
});

test("portable QA derives the expected hook inventory from the shipped manifest", () => {
  const source = readFileSync(join(rootPath, "scripts", "qa-portable-install.sh"), "utf8");

  assert.match(source, /HOOK_EVENT_COUNT/u);
  assert.match(source, /Object\.keys\(manifest\.hooks/u);
  assert.equal(source.includes("Hooks ($HOOK_EVENT_COUNT)"), true);
  assert.equal(source.includes("Hooks (9)"), false);
});

test("doctor includes the orchestration capability diagnostic", () => {
  const source = readFileSync(join(rootPath, "scripts", "doctor.mjs"), "utf8");
  assert.match(source, /Workflow readiness/u);
  assert.match(source, /workflow-check/u);
});

test("source and installed doctors share the exact canonical skill catalog", async () => {
  const catalogUrl = new URL("plugins/litclaude/lib/canonical-skill-catalog.mjs", root);
  assert.equal(existsSync(catalogUrl), true, "canonical skill catalog module must exist");
  const { canonicalSkillFiles, canonicalSkillIds } = await import(catalogUrl);
  const skillIds = readdirSync(join(rootPath, "plugins", "litclaude", "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(canonicalSkillIds, skillIds);
  assert.deepEqual(canonicalSkillFiles, skillIds.map((skillId) => `skills/${skillId}/SKILL.md`));
  for (const relativePath of ["scripts/doctor.mjs", "bin/litclaude-ai.js"]) {
    const source = readFileSync(join(rootPath, relativePath), "utf8");
    assert.match(source, /canonicalSkillFiles/u, `${relativePath} must consume the shared catalog`);
  }
});

test("lsp-setup scripts provide non-mutating advisory probes", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-lsp-probe-"));
  const sourcePath = join(dir, "example.ts");
  const unknownPath = join(dir, "notes.txt");
  const missingConfigPath = join(dir, "missing.lsp.json");
  const detectScript = join(rootPath, "plugins", "litclaude", "skills", "lsp-setup", "scripts", "detect-lsp.ts");
  const verifyScript = join(rootPath, "plugins", "litclaude", "skills", "lsp-setup", "scripts", "verify-lsp.ts");

  try {
    writeFileSync(sourcePath, "export const answer: number = 42;\n");
    writeFileSync(unknownPath, "not a configured LSP source file\n");
    const detect = spawnSync(
      process.execPath,
      ["--experimental-strip-types", detectScript, dir, "--json", `--config=${missingConfigPath}`],
      { cwd: rootPath, encoding: "utf8" },
    );
    assert.equal(detect.status, 0, detect.stderr);
    const report = JSON.parse(detect.stdout);
    assert.equal(report.root, dir);
    assert.equal(report.config.exists, false);
    assert.equal(report.results.some((entry) => entry.server.language === "typescript"), true);
    assert.equal(readFileSync(sourcePath, "utf8"), "export const answer: number = 42;\n");
    assert.equal(existsSync(missingConfigPath), false, "detect-lsp must not create a config file");

    const verify = spawnSync(process.execPath, ["--experimental-strip-types", verifyScript, unknownPath], {
      cwd: rootPath,
      encoding: "utf8",
    });
    assert.equal(verify.status, 3, verify.stdout + verify.stderr);
    assert.match(verify.stderr, /SKIP .*no language server known/u);
    assert.equal(readFileSync(unknownPath, "utf8"), "not a configured LSP source file\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("visual-qa CLI provides a non-mutating TUI advisory probe", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-visual-probe-"));
  const capturePath = join(dir, "capture.txt");
  const visualCli = join(rootPath, "plugins", "litclaude", "skills", "visual-qa", "scripts", "cli.ts");
  try {
    writeFileSync(capturePath, "┌──┐\n│한│\n└──┘\n");
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", visualCli, "tui-check", capturePath, "--cols", "4"],
      { cwd: rootPath, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.command, "tui-check");
    assert.equal(report.maxWidth, 4);
    assert.deepEqual(report.overflowLines, []);
    assert.deepEqual(report.wideCharColumns, [1]);
    assert.equal(readFileSync(capturePath, "utf8"), "┌──┐\n│한│\n└──┘\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uiux.retrieval-deterministic", retrievalDeterministic);
test("uiux.no-network-no-write", noNetworkNoWrite);
test("visualqa.evidence-v1alpha1", evidenceContract);
test("visualqa.blocked-capabilities", blockedCapabilities);
test("visualqa.png-resource-bounds", pngResourceBounds);
test("real-surface valid fixtures use beta contracts and material PNG evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-real-surface-beta-"));
  try {
    const contract = realSurfaceDesignContract();
    assert.equal(contract.schema_id, "litfamily.design-contract/v1beta2");
    const bundle = writeEvidenceBundle(dir, { tier: "smoke" });
    assert.equal(bundle.manifest.schema_id, "litfamily.evidence-manifest/v1beta1");
    const captures = bundle.manifest.artifacts.filter(({ kind }) => kind === "capture");
    assert.ok(captures.length >= 2);
    for (const artifact of captures) {
      assert.match(artifact.path, /\.png$/u);
      assert.deepEqual(readFileSync(join(dir, artifact.path)).subarray(0, 8),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("real-surface missing-capture row removes the artifact and requires the exact missing code", () => {
  const result = spawnSync(process.execPath, [
    join(rootPath, "scripts", "qa-negative-gate-matrix.mjs"),
    "--json",
  ], { cwd: rootPath, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr);
  const receiptEnd = result.stdout.lastIndexOf("\nNEGATIVE_GATE_MATRIX_PASS");
  assert.notEqual(receiptEnd, -1, result.stdout);
  const report = JSON.parse(result.stdout.slice(0, receiptEnd));
  const row = report.rows.find(({ id }) => id === "missing-capture");
  assert.equal(row.status, "PASS");
  assert.equal(row.expected, "EVIDENCE_ARTIFACT_MISSING");
  assert.equal(row.observed, "EVIDENCE_ARTIFACT_MISSING");
  assert.match(row.detail, /EVIDENCE_ARTIFACT_MISSING/u);
});
test("visualqa.tui-unicode-osc", tuiUnicodeOsc);
test("uiux.strict-contract-boundary", strictDesignContract);
test("uiux.strict-query-arguments", strictQueryArguments);
test("visualqa.strict-evidence-schemas", strictEvidenceSchemas);
test("visualqa.forged-evidence-zero-pass", forgedEvidenceZeroPass);
test("visualqa.png-structure-metrics", pngStructureAndMetrics);
test("visualqa.tui-topology-controls", tuiTopologyAndControls);
test("uiux.importer-check-contract", importerCheckContract);
test("integration.uiux-visual-eight-scenarios", eightScenarioDriver);

test("plan checkbox audit accepts valid plans without hard-coded task counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-plan-audit-"));
  const plan = join(dir, "small-plan.md");
  try {
    writeFileSync(
      plan,
      `# Small Plan

## TODOs

- [x] 1. Complete one implementation task

  **References**:
  - Pattern: \`package.json\`

  **Acceptance Criteria**:
  - [ ] Nested unchecked acceptance criteria must not count as top-level work.

  **QA Scenarios**:
  \`\`\`text
  Scenario: done
  \`\`\`

  **Commit**: YES | Message: \`test(plan): example\` | Files: \`test/example.test.mjs\`

## Final Verification Wave

- [x] F1. Review Gate
  - Commands:
    - \`npm test\`
  - Pass: \`STATUS:0\`

- [x] F2. Tool Review Gate
  - Tool: \`codex-litwork-reviewer\`
  - Input: full diff and evidence.
  - Pass: unconditional approval.
`,
    );
    const result = spawnSync(process.execPath, ["scripts/audit-plan-checkboxes.mjs", plan], {
      cwd: rootPath,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PLAN_AUDIT_PASS: 3 checked items complete/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("postinstall skips safely when disabled", () => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-postinstall-home-"));
  const claudeHome = mkdtempSync(join(tmpdir(), "litclaude-postinstall-claude-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/postinstall.mjs"], {
      cwd: rootPath,
      encoding: "utf8",
      env: {
        ...process.env,
        LITCLAUDE_AUTO_INSTALL: "0",
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /postinstall skipped: disabled by environment/u);
    assert.equal(existsSync(join(claudeHome, "settings.json")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  }
});

test("postinstall can force isolated LitClaude plugin and HUD setup", () => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-postinstall-home-"));
  const claudeHome = mkdtempSync(join(tmpdir(), "litclaude-postinstall-claude-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/postinstall.mjs"], {
      cwd: rootPath,
      encoding: "utf8",
      env: {
        ...process.env,
        LITCLAUDE_AUTO_INSTALL: "1",
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /INSTALL_PASS/u);
    const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
    assert.equal(settings.statusLine.type, "command");
    assert.match(settings.statusLine.command, /litclaude-hud\.js/u);
    assert.equal(settings.litclaude.statusLineManaged, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  }
});

test("plugin validator delegates to the real Claude validator when available", async () => {
  const script = await readFile(new URL("scripts/validate-plugin.mjs", root), "utf8");
  assert.ok(script.includes('"claude", ["plugin", "validate"'));
});
