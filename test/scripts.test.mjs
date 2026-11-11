import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

test("package exposes local validation, doctor, QA, and pack scripts", async () => {
  const pkg = await json("package.json");

  // The preloads turn the install-time motion pre-warm off (installer tests stay offline) and drop any automatic handoff settings the developer exported.
  assert.equal(pkg.scripts.test, "node tools/test-tier.mjs fast");
  assert.equal(pkg.scripts["test:heavy"], "node tools/test-tier.mjs heavy");
  assert.equal(pkg.scripts["test:all"], "node tools/test-tier.mjs all");
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

test("lsp-setup verify-lsp resolves a command string plus args from .lsp.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-lsp-config-"));
  const sourcePath = join(dir, "example.ts");
  const configPath = join(dir, ".lsp.json");
  const verifyScript = join(rootPath, "plugins", "litclaude", "skills", "lsp-setup", "scripts", "verify-lsp.ts");
  try {
    writeFileSync(sourcePath, "export const answer: number = 42;\n");
    writeFileSync(configPath, JSON.stringify({
      typescript: {
        command: "litclaude-absent-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
      },
    }));
    const verify = spawnSync(
      process.execPath,
      ["--experimental-strip-types", verifyScript, sourcePath, `--config=${configPath}`, "--timeout=5000"],
      { cwd: rootPath, encoding: "utf8" },
    );
    assert.equal(verify.status, 1, verify.stdout + verify.stderr);
    assert.match(verify.stdout + verify.stderr, /litclaude-absent-language-server/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real-surface matrix exercises the installed resource pins and the pack payload guard", () => {
  const result = spawnSync(process.execPath, [
    join(rootPath, "scripts", "qa-negative-gate-matrix.mjs"),
    "--json",
  ], { cwd: rootPath, encoding: "utf8", timeout: 300_000 });
  assert.equal(result.status, 0, result.stderr);
  const receiptEnd = result.stdout.lastIndexOf("\nNEGATIVE_GATE_MATRIX_PASS");
  assert.notEqual(receiptEnd, -1, result.stdout);
  const report = JSON.parse(result.stdout.slice(0, receiptEnd));
  assert.deepEqual(report.rows.map(({ id, status }) => [id, status]), [
    ["tampered-installed-resource", "PASS"],
    ["restored-installed-resource", "PASS"],
    ["forbidden-package-paths", "PASS"],
  ]);
});

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
  assert.ok(script.includes('shellFreeCommand("claude", args)'));
  assert.ok(script.includes('spawnClaude(["plugin", "validate"'));
});
