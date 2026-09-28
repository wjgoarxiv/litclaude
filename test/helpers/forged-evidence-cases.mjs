import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseStrictJson } from "../../plugins/litclaude/lib/strict-json.mjs";
import { reviewShapeValid } from "../../plugins/litclaude/skills/visual-qa/scripts/review-rules.mjs";
import {
  designContract,
  reviewReceipt,
  sha256,
  stableJson,
  writeEvidenceFixture,
} from "./strict-contract-fixtures.mjs";
import {
  assertCollectionConstraintCorpus,
  readSchemaRuntimeParity,
} from "./schema-runtime-parity.mjs";
import { runVisualCli } from "./uiux-visual-runtime.mjs";

function runEvidence(fixture) {
  return runVisualCli([
    "validate-evidence",
    fixture.manifestPath,
    "--tier", fixture.manifest.tier,
    "--now", "2026-07-24T12:00:00.000Z",
    "--current-source-hash", fixture.inputs.source_hash,
  ]);
}

function rewrite(fixture) {
  writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`);
}

function expectCode(result, code) {
  assert.notEqual(result.status, 0, `${code} must not exit zero`);
  if (result.stdout.trim() === "") {
    assert.equal(code, "EVIDENCE_SCHEMA_INVALID", result.stderr);
    assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    return;
  }
  const report = JSON.parse(result.stdout);
  assert.notEqual(report.verdict, "PASS");
  assert.ok(report.codes.includes(code), `expected ${code} in ${JSON.stringify(report.codes)}`);
}

function isolatedFixture(prefix, mutate) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const fixture = writeEvidenceFixture(dir);
  mutate?.(fixture);
  rewrite(fixture);
  return { dir, fixture };
}

// Evidence dates an accepted exception with `expiry`; the Design Contract dates the same
// record with `expires_at`. The fixture writes both sides from one input so a mismatch in the
// test is a real defect rather than a naming artefact.
function bindContractExceptions(fixture, exceptions) {
  const accepted = exceptions.map(({ id, owner, reason, expiry }) => ({
    id,
    reason,
    owner,
    expires_at: expiry,
  }));
  const contractBytes = `${JSON.stringify(designContract({ accepted_exceptions: accepted }))}\n`;
  writeFileSync(fixture.contractPath, contractBytes);
  const designContractHash = sha256(contractBytes);
  fixture.manifest.design_contract_hash = designContractHash;
  fixture.inputs.design_contract_hash = designContractHash;
  for (const receipt of fixture.manifest.review_receipts) {
    receipt.input_hashes.design_contract_hash = designContractHash;
  }
  fixtureHashes(fixture.manifest);
}

export async function forgedEvidenceZeroPass(t) {
  await t.test("standalone review invalidates PASS with a blocking P1 finding", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-review-blocking-"));
    const path = join(dir, "review.json");
    try {
      const receipt = reviewReceipt("quality-reviewer", "context:blocking", {
        design_contract_hash: "a".repeat(64),
        source_hash: "b".repeat(64),
        capture_hash: "c".repeat(64),
        artifacts_hash: "d".repeat(64),
      }, {
        findings: [{
          id: "finding:blocking",
          severity: "P1",
          blocking: true,
          message: "The critical route is broken.",
          evidence_ids: ["artifact:capture"],
        }],
      });
      writeFileSync(path, `${JSON.stringify(receipt)}\n`);
      const result = runVisualCli(["validate-review", path]);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "FAIL");
      assert.ok(report.codes.includes("REVIEW_BLOCKING_FINDING"));
      assert.ok(report.codes.includes("REVIEW_RECEIPT_VERDICT_INCOHERENT"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("standalone review rejects the retired REVISE verdict", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-review-revise-"));
    const path = join(dir, "review.json");
    try {
      const receipt = reviewReceipt("quality-reviewer", "context:revise", {
        design_contract_hash: "a".repeat(64),
        source_hash: "b".repeat(64),
        capture_hash: "c".repeat(64),
        artifacts_hash: "d".repeat(64),
      }, { verdict: "REVISE" });
      writeFileSync(path, `${JSON.stringify(receipt)}\n`);
      const result = runVisualCli(["validate-review", path]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /REVIEW_RECEIPT_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("strict JSON rejects reserved keys without weakening ordinary or duplicate parsing", () => {
    assert.deepEqual(
      parseStrictJson('{"ordinary":{"enabled":true},"items":[1,2,3]}'),
      { ordinary: { enabled: true }, items: [1, 2, 3] },
    );
    for (const [label, json] of [
      ["top-level __proto__", '{"__proto__":{"schema_id":"forged"}}'],
      ["nested constructor", '{"ordinary":{"constructor":{"schema_id":"forged"}}}'],
      ["nested prototype", '{"ordinary":{"prototype":{"schema_id":"forged"}}}'],
    ]) {
      assert.throws(
        () => parseStrictJson(json),
        (error) => error?.code === "JSON_RESERVED_KEY",
        label,
      );
    }
    assert.throws(
      () => parseStrictJson('{"ordinary":1,"ordinary":2}'),
      (error) => error?.code === "JSON_DUPLICATE_KEY",
    );
  });

  await t.test("review shape rejects an inherited required field", () => {
    const receipt = reviewReceipt("quality-reviewer", "context:inherited-required", {
      design_contract_hash: "a".repeat(64),
      source_hash: "b".repeat(64),
      capture_hash: "c".repeat(64),
      artifacts_hash: "d".repeat(64),
    });
    const inherited = Object.assign(
      Object.create({ schema_id: receipt.schema_id }),
      receipt,
    );
    delete inherited.schema_id;
    assert.equal("schema_id" in inherited, true);
    assert.equal(Object.hasOwn(inherited, "schema_id"), false);
    assert.equal(reviewShapeValid(inherited), false);
  });

  await t.test("alpha complete source-bound manifest preserves compatibility without top-level PASS", () => {
    const { dir, fixture } = isolatedFixture("litclaude-evidence-valid-");
    try {
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "BLOCKED");
      assert.equal(report.compatibility.validation_verdict, "PASS");
      assert.equal(report.review_count, 2);
      assert.equal(report.artifact_count, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("shared viewport fixture rejects values beyond every schema maximum", () => {
    const parity = readSchemaRuntimeParity(new URL("../../", import.meta.url).pathname);
    for (const [field, value] of [
      ["width", parity.evidence_viewport.width.maximum + 1],
      ["height", parity.evidence_viewport.height.maximum + 1],
      ["scale_factor", parity.evidence_viewport.scale_factor.maximum + 0.1],
    ]) {
      const { dir, fixture } = isolatedFixture("litclaude-evidence-viewport-", ({ manifest }) => {
        manifest.capture_environment.viewport[field] = value;
      });
      try {
        const result = runEvidence(fixture);
        assert.notEqual(result.status, 0, `${field} must fail closed`);
        assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  await t.test("runtime rejects duplicate evidence exception references", () => {
    const { dir, fixture } = isolatedFixture("litclaude-evidence-exception-unique-", ({ manifest }) => {
      manifest.exception_references = ["exception:one", "exception:one"];
    });
    try {
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("runtime rejects malformed optional exception on captured inventory", () => {
    const { dir, fixture } = isolatedFixture(
      "litclaude-evidence-captured-exception-shape-",
      ({ manifest }) => {
        manifest.inventory[0].exception = { unexpected: true };
      },
    );
    try {
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("runtime rejects nested artifact paths it cannot open relative to a stable directory descriptor", () => {
    const { dir, fixture } = isolatedFixture("litclaude-evidence-artifact-in-root-");
    try {
      mkdirSync(join(dir, "nested"));
      writeFileSync(join(dir, "nested", "capture.txt"), readFileSync(fixture.capturePath));
      fixture.manifest.artifacts.find(({ id }) => id === "artifact:capture").path =
        "nested/capture.txt";
      rewrite(fixture);
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("ancestor substitution between check and open cannot validate hash-identical nested bytes", () => {
    const { dir, fixture } = isolatedFixture("litclaude-evidence-ancestor-swap-");
    try {
      const checked = join(dir, "checked");
      const held = join(dir, "checked-before-swap");
      const replacement = join(dir, "replacement");
      const preload = join(dir, "ancestor-swap-preload.mjs");
      mkdirSync(checked);
      mkdirSync(replacement);
      writeFileSync(join(checked, "capture.txt"), readFileSync(fixture.capturePath));
      writeFileSync(join(replacement, "capture.txt"), readFileSync(fixture.capturePath));
      fixture.manifest.artifacts.find(({ id }) => id === "artifact:capture").path = "checked/capture.txt";
      rewrite(fixture);
      writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.lstatSync;
let swapped = false;
fs.lstatSync = function(path, ...args) {
  const stat = original.call(this, path, ...args);
  if (!swapped && path === process.env.LITCLAUDE_CHECKED_ANCESTOR) {
    swapped = true;
    fs.renameSync(path, process.env.LITCLAUDE_HELD_ANCESTOR);
    fs.renameSync(process.env.LITCLAUDE_REPLACEMENT_ANCESTOR, path);
  }
  return stat;
};
syncBuiltinESMExports();
`);
      const result = runVisualCli([
        "validate-evidence", fixture.manifestPath,
        "--tier", fixture.manifest.tier,
        "--now", "2026-07-24T12:00:00.000Z",
        "--current-source-hash", fixture.inputs.source_hash,
      ], { env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        LITCLAUDE_CHECKED_ANCESTOR: checked,
        LITCLAUDE_HELD_ANCESTOR: held,
        LITCLAUDE_REPLACEMENT_ANCESTOR: replacement,
      } });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("rejects a symlinked evidence root even when every artifact remains in target", () => {
    const target = mkdtempSync(join(tmpdir(), "litclaude-evidence-root-target-"));
    const parent = mkdtempSync(join(tmpdir(), "litclaude-evidence-root-alias-"));
    const alias = join(parent, "evidence");
    try {
      const fixture = writeEvidenceFixture(target);
      symlinkSync(target, alias, "dir");
      fixture.manifestPath = join(alias, "evidence.json");
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EVIDENCE_ROOT_INVALID/u);
      assert.equal(result.stdout, "");
    } finally {
      rmSync(parent, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  await t.test("artifact reader uses bounded no-follow descriptor identity reads", () => {
    const source = readFileSync(new URL("../../plugins/litclaude/skills/visual-qa/scripts/evidence-io.mjs", import.meta.url), "utf8");
    for (const token of ["openSync", "O_NOFOLLOW", "fstatSync", "readSync"]) {
      assert.match(source, new RegExp(`\\b${token}\\b`, "u"), `artifact reader must use ${token}`);
    }
    assert.ok(source.indexOf("stat.size > maxBytes") < source.indexOf("Buffer.alloc"), "size must be bounded before allocation");
    assert.match(source, /dev[^\n]*ino|ino[^\n]*dev/u, "path and descriptor identities must be compared");
  });

  for (const [label, setup] of [
    [
      "missing artifact path",
      ({ fixture }) => {
        fixture.manifest.artifacts.find(({ id }) => id === "artifact:capture").path =
          "missing-capture.txt";
      },
    ],
    [
      "broken symlink ancestor",
      ({ dir, fixture }) => {
        symlinkSync("missing-directory", join(dir, "broken"), "dir");
        fixture.manifest.artifacts.find(({ id }) => id === "artifact:capture").path =
          "broken/capture.txt";
      },
    ],
    [
      "symlink ancestor whose target remains in root",
      ({ dir, fixture }) => {
        mkdirSync(join(dir, "stored"));
        writeFileSync(join(dir, "stored", "capture.txt"), readFileSync(fixture.capturePath));
        symlinkSync("stored", join(dir, "alias"), "dir");
        fixture.manifest.artifacts.find(({ id }) => id === "artifact:capture").path =
          "alias/capture.txt";
      },
    ],
    [
      "symlink ancestor escaping to a hash-identical sibling",
      ({ dir, fixture, sibling }) => {
        writeFileSync(join(sibling, "capture.txt"), readFileSync(fixture.capturePath));
        symlinkSync(sibling, join(dir, "escape"), "dir");
        fixture.manifest.artifacts.find(({ id }) => id === "artifact:capture").path =
          "escape/capture.txt";
      },
    ],
  ]) {
    await t.test(`rejects ${label}`, () => {
      const sibling = mkdtempSync(join(tmpdir(), "litclaude-evidence-artifact-sibling-"));
      const { dir, fixture } = isolatedFixture("litclaude-evidence-artifact-boundary-");
      try {
        setup({ dir, fixture, sibling });
        rewrite(fixture);
        expectCode(
          runEvidence(fixture),
          label === "missing artifact path" ? "EVIDENCE_ARTIFACT_MISSING" : "EVIDENCE_SCHEMA_INVALID",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(sibling, { recursive: true, force: true });
      }
    });
  }

  await t.test("runtime requires exception when status accepts one", () => {
    const { dir, fixture } = isolatedFixture(
      "litclaude-evidence-required-exception-",
      ({ manifest }) => {
        manifest.inventory[0].status = "accepted_exception";
      },
    );
    try {
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EVIDENCE_SCHEMA_INVALID/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("runtime accepts a current contract-bound optional exception", () => {
    const exception = {
      id: "exception:captured-context",
      owner: "quality",
      reason: "Capture remains valid under the reviewed temporary context.",
      expiry: "2026-07-24T13:00:00.000Z",
    };
    const { dir, fixture } = isolatedFixture(
      "litclaude-evidence-current-exception-",
      (value) => {
        bindContractExceptions(value, [exception]);
        value.manifest.inventory[0].exception = exception;
        value.manifest.exception_references = [exception.id];
      },
    );
    try {
      const result = runEvidence(fixture);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "BLOCKED");
      assert.equal(report.compatibility.validation_verdict, "PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [label, code, exception, mutate] of [
    [
      "nonfuture optional exception",
      "EXCEPTION_INVALID",
      {
        id: "exception:nonfuture",
        owner: "quality",
        reason: "This exception expires exactly when evidence validation starts.",
        expiry: "2026-07-24T12:00:00.000Z",
      },
      ({ manifest }) => {
        manifest.exception_references = ["exception:nonfuture"];
      },
    ],
    [
      "unreferenced optional exception",
      "EXCEPTION_REFERENCE_INVALID",
      {
        id: "exception:unreferenced",
        owner: "quality",
        reason: "This otherwise valid exception is omitted from the reference list.",
        expiry: "2026-07-24T13:00:00.000Z",
      },
      () => {},
    ],
    [
      "optional exception that differs from its Design Contract record",
      "EXCEPTION_REFERENCE_INVALID",
      {
        id: "exception:mismatched",
        owner: "quality",
        reason: "The Design Contract owns the canonical exception record.",
        expiry: "2026-07-24T13:00:00.000Z",
      },
      ({ manifest }) => {
        manifest.exception_references = ["exception:mismatched"];
        manifest.inventory[0].exception.owner = "different-owner";
      },
    ],
  ]) {
    await t.test(`rejects ${label}`, () => {
      const { dir, fixture } = isolatedFixture(
        "litclaude-evidence-conditional-exception-",
        (value) => {
          bindContractExceptions(value, [exception]);
          value.manifest.inventory[0].exception = { ...exception };
          mutate(value);
        },
      );
      try {
        expectCode(runEvidence(fixture), code);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  for (const [label, code, mutate] of [
    [
      "duplicate finding evidence ids after receipt hashes are recomputed",
      "EVIDENCE_SCHEMA_INVALID",
      ({ manifest }) => {
        manifest.review_receipts[0].findings = [{
          id: "finding:duplicate-evidence",
          severity: "P2",
          blocking: false,
          message: "One artifact must not be counted twice.",
          evidence_ids: ["artifact:capture", "artifact:capture"],
        }];
      },
    ],
    [
      "duplicate reviewed inventory ids after receipt hashes are recomputed",
      "EVIDENCE_SCHEMA_INVALID",
      ({ manifest }) => {
        manifest.review_receipts[0].reviewed_inventory.push(
          manifest.review_receipts[0].reviewed_inventory[0],
        );
      },
    ],
    [
      // The Design Contract declares no terminal-size surface, so the terminal/TUI pairing
      // can no longer be reached through a contract-bound manifest. What is still reachable,
      // and still worth proving, is that mechanical results cannot be padded with repeats.
      "repeated mechanical result identity",
      "MECHANICAL_RESULTS_INCOMPLETE",
      ({ manifest }) => {
        manifest.mechanical_results = [
          manifest.mechanical_results[0],
          { ...manifest.mechanical_results[0] },
        ];
      },
    ],
    [
      "captured reference without image diff mechanics",
      "MECHANICAL_RESULTS_INCOMPLETE",
      ({ manifest }) => {
        // References sit outside the contract-to-evidence inventory comparison, so a manifest
        // may add one; adding it still owes an image-diff result.
        manifest.inventory.push({
          id: "reference:request",
          kind: "reference",
          status: "captured",
          evidence_ids: ["artifact:source"],
        });
        for (const receipt of manifest.review_receipts) {
          receipt.reviewed_inventory = manifest.inventory.map(({ id }) => id);
        }
      },
    ],
    [
      "inventory evidence kind substitution",
      "INVENTORY_EVIDENCE_BINDING_INVALID",
      ({ manifest }) => {
        for (const item of manifest.inventory) item.evidence_ids = ["artifact:source"];
      },
    ],
    [
      "arbitrary self-reported mechanical pass",
      "MECHANICAL_RESULTS_INCOMPLETE",
      ({ manifest }) => {
        manifest.mechanical_results[0] = {
          id: "result:invented", kind: "trust-me", status: "PASS",
          artifact_ids: ["artifact:capture"], metrics: { claimed: true },
        };
      },
    ],
    [
      "nonblocking P0 finding with nonexistent evidence",
      "REVIEW_FINDING_INVALID",
      ({ manifest }) => {
        manifest.review_receipts[0].findings = [{
          id: "finding:critical", severity: "P0", blocking: false,
          message: "Critical defect.", evidence_ids: ["artifact:missing"],
        }];
      },
    ],
    [
      "forged artifact bytes",
      "EVIDENCE_ARTIFACT_HASH_INVALID",
      ({ capturePath }) => writeFileSync(capturePath, "forged\n"),
    ],
    [
      "inventory detached from its Design Contract",
      "EVIDENCE_CONTRACT_INVENTORY_MISMATCH",
      ({ manifest }) => { manifest.inventory[0].id = "route:detached"; },
    ],
    [
      "stale artifact",
      "BLOCKED_EVIDENCE_STALE",
      ({ manifest }) => { manifest.artifacts[1].created_at = "2026-07-24T09:00:00.000Z"; },
    ],
    [
      "one review receipt",
      "EVIDENCE_SCHEMA_INVALID",
      ({ manifest }) => {
        manifest.review_receipts.pop();
        manifest.review_receipt_hashes.pop();
      },
    ],
    [
      "review receipts on the smoke tier",
      "EVIDENCE_SCHEMA_INVALID",
      ({ manifest }) => { manifest.tier = "smoke"; },
    ],
    [
      "shared reviewer context",
      "REVIEW_RECEIPT_INDEPENDENCE_INVALID",
      ({ manifest }) => {
        manifest.review_receipts[1].fresh_context_id =
          manifest.review_receipts[0].fresh_context_id;
      },
    ],
    [
      "mismatched immutable inputs",
      "REVIEW_RECEIPT_INPUT_MISMATCH",
      ({ manifest }) => { manifest.review_receipts[1].input_hashes.capture_hash = "f".repeat(64); },
    ],
    [
      "non-pass reviewer",
      "REVIEW_RECEIPT_NOT_PASS",
      ({ manifest }) => { manifest.review_receipts[0].verdict = "FAIL"; },
    ],
    [
      "peer draft visibility",
      "REVIEW_RECEIPT_INDEPENDENCE_INVALID",
      ({ manifest }) => { manifest.review_receipts[0].peer_draft_received = true; },
    ],
    [
      "reviewer timeout",
      "BLOCKED_REVIEW_TIMEOUT",
      ({ manifest }) => { manifest.review_receipts[0].timeout = true; },
    ],
    [
      "reviewer cancellation",
      "BLOCKED_REVIEW_CANCELLED",
      ({ manifest }) => { manifest.review_receipts[0].cancelled = true; },
    ],
    [
      "blocking reviewer finding",
      "REVIEW_BLOCKING_FINDING",
      ({ manifest }) => {
        manifest.review_receipts[0].findings = [{
          id: "finding:broken-route",
          severity: "P1",
          blocking: true,
          message: "Critical route is broken.",
          evidence_ids: ["artifact:capture"],
        }];
      },
    ],
    [
      "forged review receipt hash",
      "REVIEW_RECEIPT_HASH_INVALID",
      ({ manifest }) => { manifest.review_receipt_hashes[0] = "0".repeat(64); },
    ],
    [
      "incoherent manifest verdict",
      "EVIDENCE_VERDICT_INCOHERENT",
      ({ manifest }) => { manifest.verdict = "FAIL"; },
    ],
  ]) {
    await t.test(`rejects ${label}`, () => {
      const { dir, fixture } = isolatedFixture("litclaude-evidence-forged-", (value) => {
        mutate(value);
        if (code !== "REVIEW_RECEIPT_HASH_INVALID" && code !== "EVIDENCE_VERDICT_INCOHERENT") {
          fixtureHashes(value.manifest);
        }
      });
      try {
        expectCode(runEvidence(fixture), code);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

function fixtureHashes(manifest) {
  manifest.review_receipt_hashes = manifest.review_receipts.map(
    (receipt) => sha256(stableJson(receipt)),
  );
}

export async function strictEvidenceSchemas(t) {
  const { readFileSync } = await import("node:fs");
  const root = new URL("../../plugins/litclaude/skills/visual-qa/schemas/", import.meta.url);
  const skillRoot = new URL("../", root);
  const evidence = JSON.parse(readFileSync(new URL("evidence-manifest-v1alpha1.schema.json", root), "utf8"));
  const review = JSON.parse(readFileSync(new URL("review-receipt-v1alpha1.schema.json", root), "utf8"));
  const skill = [
    readFileSync(new URL("SKILL.md", skillRoot), "utf8"),
    readFileSync(new URL("references/complete-contract.md", skillRoot), "utf8"),
  ].join("\n");
  const parity = readSchemaRuntimeParity(new URL("../../", import.meta.url).pathname);
  await t.test("evidence schema requires zero smoke receipts and exactly two full receipts", () => {
    assert.equal(evidence.additionalProperties, false);
    for (const field of ["design_contract_path", "artifacts", "review_receipts"]) {
      assert.ok(evidence.required.includes(field));
    }
    assert.equal(evidence.properties.review_receipts.minItems, 0);
    assert.equal(evidence.properties.review_receipts.maxItems, 2);
    const smokeBranch = evidence.allOf.find((candidate) =>
      candidate.if?.properties?.tier?.const === "smoke");
    assert.equal(smokeBranch.then.properties.review_receipts.maxItems, 0);
    assert.equal(smokeBranch.then.properties.review_receipt_hashes.maxItems, 0);
    assert.equal(smokeBranch.else.properties.review_receipts.minItems, 2);
    assert.equal(smokeBranch.else.properties.review_receipt_hashes.minItems, 2);
    assert.equal(evidence.properties.inventory.maxItems, 512);
    assertCollectionConstraintCorpus(evidence, parity.collection_constraints.evidence);
  });
  await t.test("review schema fixes independence, timeout, cancellation, and inputs", () => {
    assert.equal(review.additionalProperties, false);
    for (const field of [
      "reviewed_inventory", "confidence", "peer_draft_received", "implementer_context", "cancelled",
    ]) {
      assert.ok(review.required.includes(field));
    }
    assert.deepEqual(
      review.properties.reviewer_capability.enum,
      ["quality-reviewer", "lit-verifier", "oracle-verifier"],
    );
    assert.match(review.properties.reviewer_capability.$comment, /One-release alias/u);
    assert.deepEqual(review.properties.verdict.enum, ["PASS", "FAIL", "BLOCKED"]);
    assert.deepEqual(evidence.properties.verdict.enum, ["PASS", "FAIL", "BLOCKED"]);
    assert.equal(review.properties.findings.maxItems, 256);
    assert.equal(review.properties.findings.items.additionalProperties, false);
    assert.equal(review.properties.findings.items.properties.evidence_ids.minItems, 1);
    assert.deepEqual(evidence.properties.inventory.items.properties.status.enum,
      ["captured", "not_applicable", "accepted_exception", "blocked"]);
    for (const field of [
      "capture_environment", "auth_owner", "accessibility_results",
      "open_findings", "exception_references",
    ]) assert.ok(evidence.required.includes(field), `evidence must require ${field}`);
    assertCollectionConstraintCorpus(review, parity.collection_constraints.review);
  });
  await t.test("skill documents exact receipt fields and truthful replay availability", () => {
    assert.doesNotMatch(skill, /\bREVISE\b/u);
    assert.doesNotMatch(
      skill,
      /valid receipt records[^.]*\b(?:round|dispatch|reviewer assignments?)\b/iu,
    );
    assert.match(skill, /source-checkout-only/iu);
    assert.match(skill, /not available from an installed plugin\/package payload/iu);
    assert.match(skill, /<installed-plugin-root>\/skills\/visual-qa\/scripts\/cli\.mjs tui-check/u);
  });
  await t.test("schema and runtime share the accepted-exception conditional branch", () => {
    const expected = parity.conditional_branches.evidence_inventory_exception;
    const item = evidence.properties.inventory.items;
    const branch = item.allOf.find((candidate) =>
      candidate.if?.properties?.[expected.trigger_property]?.const === expected.trigger_value);
    assert.ok(branch, "inventory schema must declare the accepted-exception branch");
    assert.deepEqual(branch.then.required, [expected.required_property]);
    assert.equal(
      item.properties[expected.required_property].$ref,
      `#/$defs/${expected.definition}`,
    );
    assert.deepEqual(evidence.$defs[expected.definition].required, expected.required_fields);
    assert.equal(
      evidence.$defs[expected.definition].additionalProperties,
      expected.additional_properties,
    );
    for (const field of ["owner", "reason"]) {
      assert.equal(evidence.$defs[expected.definition].properties[field].$ref, "#/$defs/text");
    }
    assert.ok(evidence.$defs[expected.definition].properties.expiry.pattern);
  });
}
