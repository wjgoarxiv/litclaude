import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rootPath } from "./uiux-visual-runtime.mjs";

const skillRoot = join(rootPath, "plugins/litclaude/skills/frontend-ui-ux");
const importer = join(skillRoot, "scripts/import-design-intelligence.mjs");
const scenarioDriver = join(rootPath, "scripts/qa-uiux-visual-qa-scenarios.mjs");

function runImporter(args) {
  return spawnSync(process.execPath, [importer, ...args], {
    cwd: rootPath,
    encoding: "utf8",
    timeout: 10000,
  });
}

export async function importerCheckContract(t) {
  await t.test("ships exact provenance companion names and root-relative skill paths", () => {
    for (const path of [
      "LICENSE",
      "PROVENANCE.json",
      "SOURCE-MANIFEST.json",
      "THIRD-PARTY-NOTICE.txt",
    ]) assert.equal(existsSync(join(skillRoot, path)), true, `missing ${path}`);
    assert.equal(existsSync(join(skillRoot, "THIRD_PARTY_NOTICES.md")), false);
    const provenance = JSON.parse(readFileSync(join(skillRoot, "PROVENANCE.json"), "utf8"));
    assert.deepEqual(provenance.package_contract.required_companions, [
      "design-intelligence.json",
      "LICENSE",
      "PROVENANCE.json",
      "THIRD-PARTY-NOTICE.txt",
    ]);
    const skill = [
      readFileSync(join(skillRoot, "SKILL.md"), "utf8"),
      readFileSync(join(skillRoot, "references", "complete-contract.md"), "utf8"),
    ].join("\n");
    assert.match(skill, /`PROVENANCE\.json`/u);
    assert.match(skill, /`THIRD-PARTY-NOTICE\.txt`/u);
    assert.doesNotMatch(skill, /data\/(?:PROVENANCE|THIRD)/u);
  });

  await t.test("requires exact --check and emits deterministic machine-readable identity", () => {
    const first = runImporter(["--check"]);
    const second = runImporter(["--check"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    const report = JSON.parse(first.stdout);
    assert.equal(report.schema_id, "litfamily.design-intelligence-import-check/v1");
    assert.equal(report.status, "PASS");
    assert.equal(report.dataset.record_count, 2277);
    assert.equal(report.dataset.sha256,
      "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8");
    assert.deepEqual(report.companions.map((item) => item.path), [
      "LICENSE",
      "PROVENANCE.json",
      "SOURCE-MANIFEST.json",
      "THIRD-PARTY-NOTICE.txt",
    ]);

    for (const args of [[], ["--check", "--unknown"], ["--expect-records", "2277"]]) {
      const invalid = runImporter(args);
      assert.notEqual(invalid.status, 0, `${JSON.stringify(args)} must fail`);
      assert.match(invalid.stderr, /CHECK_MODE_REQUIRED|INVALID_ARGUMENT/u);
    }
  });

  await t.test("detects a tampered packaged companion under an alternate skill root", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-importer-tamper-"));
    try {
      cpSync(skillRoot, dir, { recursive: true });
      writeFileSync(join(dir, "PROVENANCE.json"), "{}\n");
      const result = runImporter(["--check", "--skill-root", dir]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /COMPANION_HASH_MISMATCH.*PROVENANCE\.json/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("rejects alternate empty manifests and accepts only the full replay CLI shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-importer-contract-"));
    try {
      const manifest = join(dir, "empty.json");
      writeFileSync(manifest, '{"schema_version":"litfamily.source-import-manifest/v1","sources":[]}\n');
      const bypass = runImporter([
        "--check", "--source-root", dir, "--expect-records", "2277",
        "--max-bytes", "4194304", "--manifest", manifest,
      ]);
      assert.notEqual(bypass.status, 0);
      assert.match(bypass.stderr, /INVALID_ARGUMENT/u);
      const replay = runImporter([
        "--check", "--source-root", dir, "--expect-records", "2277",
        "--max-bytes", "4194304",
      ]);
      assert.notEqual(replay.status, 0, "empty source root cannot pass");
      assert.doesNotMatch(replay.stderr, /INVALID_ARGUMENT/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

export async function eightScenarioDriver(t) {
  await t.test("tracked driver executes eight adversarial scenarios with zero false PASS", () => {
    assert.equal(existsSync(scenarioDriver), true, "tracked eight-scenario QA driver is missing");
    const result = spawnSync(process.execPath, [
      scenarioDriver,
      "--installed-root", join(rootPath, "plugins", "litclaude"),
      "--fixtures", join(rootPath, "test", "fixtures", "uiux-visual-qa"),
      "--scenario", "all",
      "--json",
    ], {
      cwd: rootPath,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema_version, "litfamily.uiux-visual-qa-driver-result/v1");
    assert.equal(report.scenario_count, 8);
    assert.equal(report.seeded_findings_detected, 8);
    assert.equal(report.false_pass_count, 0);
    assert.ok(report.max_review_rounds <= 2);
    assert.deepEqual(report.results.map((item) => item.id), [
      "public-service-form-ko", "fintech-dashboard", "healthcare-mobile",
      "saas-landing-responsive", "brownfield-design-system", "reference-fidelity",
      "cjk-terminal-dashboard", "missing-capture-auth-review",
    ]);
  });

  await t.test("npm packed paths include the driver and exact nested companions", () => {
    const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: rootPath,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(pack.status, 0, pack.stderr);
    const paths = new Set(JSON.parse(pack.stdout)[0].files.map((item) => item.path));
    for (const path of [
      "scripts/qa-uiux-visual-qa-scenarios.mjs",
      "plugins/litclaude/skills/frontend-ui-ux/PROVENANCE.json",
      "plugins/litclaude/skills/frontend-ui-ux/THIRD-PARTY-NOTICE.txt",
      "plugins/litclaude/skills/frontend-ui-ux/scripts/import-design-intelligence.mjs",
    ]) assert.equal(paths.has(path), true, `packed payload missing ${path}`);
  });
}
