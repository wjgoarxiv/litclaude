import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HASH_C,
  nonPassReport,
  rootPath,
  validateEvidence,
} from "./uiux-visual-runtime.mjs";
import { writeEvidenceFixture } from "./strict-contract-fixtures.mjs";

function fixture(dir, mutate) {
  const value = writeEvidenceFixture(dir);
  mutate?.(value.manifest);
  return value;
}

export async function evidenceContract(t) {
  await t.test("schemas and skill entrypoint expose the canonical evidence contracts", () => {
    const skillRoot = join(rootPath, "plugins", "litclaude", "skills", "visual-qa");
    const skill = [
      readFileSync(join(skillRoot, "SKILL.md"), "utf8"),
      readFileSync(join(skillRoot, "references", "complete-contract.md"), "utf8"),
    ].join("\n");
    const evidencePath = join(skillRoot, "schemas", "evidence-manifest-v1alpha1.schema.json");
    const receiptPath = join(skillRoot, "schemas", "review-receipt-v1alpha1.schema.json");
    assert.equal(existsSync(evidencePath), true);
    assert.equal(existsSync(receiptPath), true);
    const evidenceSchema = JSON.parse(readFileSync(evidencePath, "utf8"));
    const receiptSchema = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(evidenceSchema.$id, "litfamily.evidence-manifest/v1alpha1");
    assert.equal(receiptSchema.$id, "litfamily.review-receipt/v1alpha1");
    for (const field of [
      "schema_id", "tier", "design_contract_hash", "source_revision", "source_hash",
      "capture_id", "capture_hash", "created_at", "maximum_age", "capabilities",
      "inventory", "mechanical_results", "review_receipt_hashes", "cleanup", "verdict",
    ]) {
      assert.ok(evidenceSchema.required?.includes(field), `Evidence Manifest must require ${field}`);
    }
    for (const field of [
      "schema_id", "review_id", "fresh_context_id", "reviewer_capability",
      "input_hashes", "findings", "independence_assertion", "started_at",
      "ended_at", "timeout", "verdict",
    ]) {
      assert.ok(receiptSchema.required?.includes(field), `Review Receipt must require ${field}`);
    }
    assert.match(skill, /litfamily\.evidence-manifest\/v1alpha1/u);
    assert.match(skill, /litfamily\.review-receipt\/v1alpha1/u);
    assert.match(skill, /litfamily\.design-contract\/v1beta2/u);
    assert.match(skill, /litfamily\.design-contract\/v1beta1[\s\S]{0,180}compatibility/u);
  });

  await t.test("capture age beyond maximum_age can never retain PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-stale-age-"));
    try {
      const value = fixture(dir, (manifest) => {
        manifest.created_at = "2026-07-24T09:00:00.000Z";
      });
      const result = validateEvidence(dir, "stale-age", value.manifest);
      assert.equal(nonPassReport(result, "BLOCKED_EVIDENCE_STALE").tier, "full");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("a current source hash mismatch can never retain PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-stale-source-"));
    try {
      const value = fixture(dir);
      nonPassReport(
        validateEvidence(dir, "stale-source", value.manifest, ["--current-source-hash", HASH_C]),
        "BLOCKED_EVIDENCE_STALE",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("smoke requires the critical interaction and both viewport bounds", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-smoke-"));
    try {
      const value = fixture(dir, (manifest) => {
        manifest.tier = "smoke";
        manifest.review_receipts = [];
        manifest.review_receipt_hashes = [];
        manifest.inventory = manifest.inventory.filter((item) => item.kind !== "auth");
        manifest.inventory.push({
          id: "interaction:critical", kind: "interaction", status: "blocked",
          evidence_ids: ["artifact:capture"],
        });
      });
      assert.equal(
        nonPassReport(validateEvidence(dir, "smoke-incomplete", value.manifest), "INVENTORY_INCOMPLETE").tier,
        "smoke",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("alpha smoke preserves no-review compatibility metadata without top-level PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-smoke-no-review-"));
    try {
      const value = fixture(dir, (manifest) => {
        manifest.tier = "smoke";
        manifest.review_receipts = [];
        manifest.review_receipt_hashes = [];
        manifest.inventory = manifest.inventory.filter(({ kind }) =>
          ["route", "interaction", "viewport"].includes(kind));
        manifest.inventory.push({
          id: "interaction:critical", kind: "interaction", status: "captured",
          evidence_ids: ["artifact:capture"],
        });
      });
      const result = validateEvidence(dir, "smoke-no-review", value.manifest);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "BLOCKED");
      assert.equal(report.compatibility.validation_verdict, "PASS");
      assert.equal(report.review_count, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("alpha evidence returns a blocked diagnostic and never a top-level PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-alpha-diagnostic-"));
    try {
      const value = fixture(dir, (manifest) => {
        manifest.tier = "smoke";
        manifest.review_receipts = [];
        manifest.review_receipt_hashes = [];
        manifest.inventory = manifest.inventory.filter(({ kind }) =>
          ["route", "interaction", "viewport"].includes(kind));
        manifest.inventory.push({
          id: "interaction:critical", kind: "interaction", status: "captured",
          evidence_ids: ["artifact:capture"],
        });
      });
      const result = validateEvidence(dir, "alpha-diagnostic", value.manifest);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "BLOCKED");
      assert.ok(report.blocked_codes.includes("BLOCKED_LEGACY_EVIDENCE_SCHEMA"));
      assert.ok(report.diagnostics.includes("LEGACY_SCHEMA_V1ALPHA1"));
      assert.deepEqual(report.compatibility, {
        manifest_verdict: "PASS",
        validation_verdict: "PASS",
        evidence_eligible: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("full schema rejects an accepted exception without owner and expiry", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-full-"));
    try {
      const value = fixture(dir, (manifest) => {
        manifest.inventory[1] = {
          ...manifest.inventory[1],
          status: "accepted_exception",
          exception: {},
        };
      });
      const result = validateEvidence(dir, "full-invalid-exception", value.manifest);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout.trim(), "");
      assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("reference-fidelity rejects dimension mismatch even with a perfect advisory score", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-reference-"));
    try {
      const value = fixture(dir, (manifest) => {
        manifest.tier = "reference-fidelity";
        manifest.inventory.push({
          id: "reference:hero",
          kind: "reference",
          status: "captured",
          evidence_ids: ["artifact:capture"],
        });
        manifest.mechanical_results = [{
          id: "result:image",
          kind: "image-diff",
          status: "PASS",
          artifact_ids: ["artifact:capture"],
          metrics: { dimensionsMatch: false, similarityScore: 100 },
        }];
      });
      const report = nonPassReport(
        validateEvidence(dir, "reference-dimension-mismatch", value.manifest),
        "REFERENCE_FIDELITY_FAILED",
      );
      assert.equal(report.tier, "reference-fidelity");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

export async function blockedCapabilities(t) {
  const skillRoot = join(rootPath, "plugins", "litclaude", "skills", "visual-qa");
  const skill = [
    readFileSync(join(skillRoot, "SKILL.md"), "utf8"),
    readFileSync(join(skillRoot, "references", "complete-contract.md"), "utf8"),
  ].join("\n");
  await t.test("skill declares the exact blocked vocabulary and finite review limits", () => {
    for (const code of [
      "BLOCKED_RENDERER_UNAVAILABLE",
      "BLOCKED_AUTH_UNAVAILABLE",
      "BLOCKED_TEST_ACCOUNT_UNSAFE",
      "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
      "BLOCKED_IMAGE_UNAVAILABLE",
      "BLOCKED_TERMINAL_UNAVAILABLE",
      "BLOCKED_REVIEW_TIMEOUT",
      "BLOCKED_EVIDENCE_STALE",
    ]) {
      assert.match(skill, new RegExp(`\\b${code}\\b`, "u"), `visual-qa must emit exact code ${code}`);
    }
    for (const tier of ["smoke", "full", "reference-fidelity"]) {
      assert.match(skill, new RegExp(`\\b${tier}\\b`, "u"), `visual-qa must define the ${tier} tier`);
    }
    assert.match(skill, /stale[\s\S]{0,160}(?:never|cannot)[\s\S]{0,80}PASS/iu);
    assert.match(skill, /missing[\s\S]{0,160}(?:never|cannot)[\s\S]{0,80}PASS/iu);
    assert.match(skill, /maximum fresh-review rounds?:\s*two/iu);
  });

  for (const [label, capability, code] of [
    ["capture", "capture", "BLOCKED_RENDERER_UNAVAILABLE"],
    ["auth", "auth", "BLOCKED_AUTH_UNAVAILABLE"],
    ["test account", "test_account_safe", "BLOCKED_TEST_ACCOUNT_UNSAFE"],
    ["independent review", "independent_review", "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"],
    // These two were implemented in evidence.mjs:40-41 and documented in SKILL.md, but
    // nothing exercised them — an emitted-but-unproven blocker is indistinguishable from
    // a blocker that silently never fires.
    ["image analysis", "image", "BLOCKED_IMAGE_UNAVAILABLE"],
    ["terminal analysis", "terminal", "BLOCKED_TERMINAL_UNAVAILABLE"],
  ]) {
    await t.test(`missing ${label} emits ${code} and zero PASS`, () => {
      const dir = mkdtempSync(join(tmpdir(), "litclaude-evidence-capability-"));
      try {
        const value = fixture(dir);
        const capabilities = { ...value.manifest.capabilities, [capability]: false };
        const report = nonPassReport(
          validateEvidence(dir, `missing-${capability}`, { ...value.manifest, capabilities }),
          code,
        );
        assert.notEqual(report.verdict, "PASS");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
