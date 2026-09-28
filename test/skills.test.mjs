import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { designContract, reviewReceipt, sha256, stableJson } from "./helpers/strict-contract-fixtures.mjs";
import { boundedFixturePng } from "./helpers/uiux-visual-runtime.mjs";
import { schemaAccepts } from "./helpers/schema-runtime-parity.mjs";
import {
  collectDesignContractIssues,
  designContractReport,
} from "../plugins/litclaude/skills/frontend-ui-ux/scripts/design-contract-rules.mjs";
import { designContractShapeValid } from "../plugins/litclaude/skills/visual-qa/scripts/design-contract-shape.mjs";
import { validateEvidence } from "../plugins/litclaude/skills/visual-qa/scripts/evidence.mjs";
import { evidenceShapeValid } from "../plugins/litclaude/skills/visual-qa/scripts/evidence-shape.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillsRoot = join(root, "plugins", "litclaude", "skills");
const topLevelSkillCorpusWordFloor = 41_270;
const contractHeadings = [
  "## #contract.activation",
  "## #contract.inputs",
  "## #contract.mode_matrix",
  "## #contract.procedure",
  "## #contract.outputs",
  "## #contract.evidence",
  "## #contract.hard_stops",
  "## #contract.anti_patterns",
];
const expectedSkills = [
  "lit-burnoff-file",
  "autoconference",
  "autoresearch",
  "browser-drive",
  "comment-checker",
  "debugging",
  "deep-interview",
  "frontend-ui-ux",
  "readme-studio",
  "lit-commit",
  "lit-crucible",
  "lit-diagram-drawer",
  "lit-docx",
  "lit-init",
  "lsp",
  "lsp-setup",
  "lit-code",
  "refactor",
  "lit-burnoff",
  "review-work",
  "rules",
  "start-work",
  "structural-search",
  "lit-team",
  "litgoal",
  "litresearch",
  "litwork",
  "lit-loop",
  "lit-plan",
  "lit-pptx",
  "lit-recap",
  "lit-typographic-motion",
  "lit-comprehend",
  "lit-handoff",
  "lit-humanizer",
  "lit-scientific-visualization",
  "visual-qa",
  "wikify",
];
const bannedPatterns = [/spawn_agent/u, /apply_patch/u, new RegExp(`codex-${"ultra"}${"work"}`, "u"), /Codex Harness/u];

const bodyWithoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n?/u, "");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const uiuxSkillCorpus = (skillName) => [
  readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8"),
  readFileSync(join(skillsRoot, skillName, "references", "complete-contract.md"), "utf8"),
].join("\n");

const assertLlmContract = (text, label) => {
  const body = bodyWithoutFrontmatter(text).trimStart();
  assert.ok(body.startsWith("## #contract.activation"), `${label} should be contract-first after frontmatter`);

  let previousIndex = -1;
  for (const heading of contractHeadings) {
    const index = text.indexOf(heading);
    assert.notEqual(index, -1, `${label} missing ${heading}`);
    assert.ok(index > previousIndex, `${label} should keep ${heading} in schema order`);
    previousIndex = index;
  }

  assert.match(
    text,
    /```yaml\n[\s\S]*?contract_schema_version:\s*litclaude\.llm-contract\.v1[\s\S]*?artifact_type:\s*skill[\s\S]*?```/u,
    `${label} should expose the stable skill contract schema as fenced yaml`,
  );
  assert.match(text, /^\|[^\n]+\|\n\|[-:| ]+\|/mu, `${label} should contain a markdown contract table`);
  assert.match(text, /PASS|FAIL|BLOCKED/u, `${label} should declare machine-readable verdict terms`);
};

const betaDesignContract = (overrides = {}) => ({
  ...designContract(),
  schema_id: "litfamily.design-contract/v1beta1",
  lane: "brownfield",
  tokens: [{ id: "token:action", category: "color", value: "accent-600", usage: "Primary action" }],
  component_behaviors: [{
    component_id: "component:retry-button",
    state_ids: ["state:dashboard-error", "state:dashboard-ready"],
    interaction_ids: ["interaction:retry-failed-job"],
    keyboard_behavior: "Enter retries the selected failed job",
  }],
  responsive_transformations: [{
    route_id: "route:dashboard",
    viewport_id: "viewport:compact",
    behavior: "Queue metadata stacks below the job label",
  }],
  motion: {
    policy: "functional",
    reduced_motion_behavior: "Replace movement with an immediate state change",
    transitions: [{
      id: "transition:retry",
      interaction_id: "interaction:retry-failed-job",
      duration_ms: 160,
      easing: "ease-out",
    }],
  },
  acceptance_criteria: [{
    id: "criterion:retry",
    observable: "Keyboard retry changes the failed job to ready",
    verification: "browser",
    required: true,
    inventory_ids: ["component:retry-button", "interaction:retry-failed-job", "state:dashboard-ready"],
  }],
  ...overrides,
});

const beta2DesignContract = (overrides = {}) => betaDesignContract({
  schema_id: "litfamily.design-contract/v1beta2",
  taste: { variance: 5, motion: 3, density: 7 },
  ...overrides,
});

function betaContractWithReferences(field, count) {
  const kind = field === "state_ids" ? "state" : "interaction";
  const entries = Array.from({ length: count }, (_, index) => kind === "state"
    ? { id: `state:generated-${index}`, route_id: "route:dashboard", kind: "ready" }
    : {
      id: `interaction:generated-${index}`,
      route_id: "route:dashboard",
      critical: index === 0,
      input_modes: ["keyboard"],
    });
  const contract = betaDesignContract();
  contract.inventory[kind === "state" ? "states" : "interactions"] = entries;
  contract.component_behaviors[0][field] = entries.map(({ id }) => id);
  if (field === "state_ids") {
    contract.component_behaviors[0].interaction_ids = ["interaction:retry-failed-job"];
    contract.acceptance_criteria[0].inventory_ids = [
      "component:retry-button", "interaction:retry-failed-job", entries[0].id,
    ];
  } else {
    contract.component_behaviors[0].state_ids = ["state:dashboard-ready"];
    contract.motion.transitions[0].interaction_id = entries[0].id;
    contract.acceptance_criteria[0].inventory_ids = [
      "component:retry-button", entries[0].id, "state:dashboard-ready",
    ];
  }
  return contract;
}

function writeBetaEvidenceFixture(dir, overrides = {}) {
  const contract = betaDesignContract();
  const contractBytes = `${JSON.stringify(contract)}\n`;
  const sourceBytes = Buffer.from("beta source bytes\n");
  const captureBytes = boundedFixturePng(320, 640);
  const expandedCaptureBytes = boundedFixturePng(1440, 900);
  writeFileSync(join(dir, "design-contract.json"), contractBytes);
  writeFileSync(join(dir, "source.bin"), sourceBytes);
  writeFileSync(join(dir, "capture.png"), captureBytes);
  writeFileSync(join(dir, "capture-expanded.png"), expandedCaptureBytes);
  const sourceHash = sha256(sourceBytes);
  const captureHash = sha256(captureBytes);
  const expandedCaptureHash = sha256(expandedCaptureBytes);
  const manifest = {
    schema_id: "litfamily.evidence-manifest/v1beta1",
    tier: "smoke",
    design_contract_path: "design-contract.json",
    design_contract_hash: sha256(contractBytes),
    source_revision: "revision:beta",
    source_hash: sourceHash,
    capture_id: "artifact:capture",
    capture_hash: captureHash,
    created_at: "2026-07-24T11:50:00.000Z",
    maximum_age: 3600,
    capture_environment: {
      backend: "fixture",
      renderer: "fixture-renderer",
      platform: "test",
      browser_version: "fixture",
      runtime_version: process.version,
      font_set: ["fixture-sans"],
      locale: "ko-KR",
      reduced_motion: true,
      settling_policy: "deterministic fixture",
      color_scheme: "light",
      process_owner: "fixture-owner",
      viewport: { width: 320, height: 640, scale_factor: 1 },
    },
    auth_owner: "fixture-owner",
    capabilities: {
      capture: true,
      auth: true,
      test_account_safe: true,
      independent_review: false,
      image: true,
      terminal: true,
    },
    inventory: [
      { id: "route:dashboard", kind: "route", status: "captured", evidence_ids: ["artifact:capture"] },
      { id: "interaction:retry-failed-job", kind: "interaction", status: "captured", evidence_ids: ["artifact:capture"] },
      { id: "state:dashboard-error", kind: "state", status: "captured", evidence_ids: ["artifact:capture"] },
      { id: "viewport:compact", kind: "viewport", status: "captured", evidence_ids: ["artifact:capture"] },
      { id: "viewport:expanded", kind: "viewport", status: "captured", evidence_ids: ["artifact:capture-expanded"] },
    ],
    artifacts: [
      { id: "artifact:source", kind: "source", path: "source.bin", sha256: sourceHash, created_at: "2026-07-24T11:50:00.000Z" },
      { id: "artifact:capture", kind: "capture", path: "capture.png", sha256: captureHash, created_at: "2026-07-24T11:50:00.000Z" },
      { id: "artifact:capture-expanded", kind: "capture", path: "capture-expanded.png", sha256: expandedCaptureHash, created_at: "2026-07-24T11:50:00.000Z" },
    ],
    mechanical_results: [{
      id: "result:image",
      kind: "image-diff",
      status: "PASS",
      artifact_ids: ["artifact:capture", "artifact:capture-expanded"],
      metrics: { dimensionsMatch: true },
    }],
    review_receipts: [],
    review_receipt_hashes: [],
    accessibility_results: [{
      id: "accessibility:contrast",
      criterion: "1.4.3",
      status: "PASS",
      evidence_ids: ["artifact:capture"],
    }],
    open_findings: [],
    exception_references: [],
    cleanup: { status: "complete", resources: [] },
    verdict: "PASS",
    ...overrides,
  };
  const manifestPath = join(dir, "evidence.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const materialTime = new Date("2026-07-24T11:50:00.000Z");
  for (const name of ["design-contract.json", "source.bin", "capture.png", "capture-expanded.png", "evidence.json"]) {
    utimesSync(join(dir, name), materialTime, materialTime);
  }
  return { captureBytes, contract, manifest, manifestPath };
}

describe("Claude skills", () => {
  it("characterization.uiux-visualqa-current-discovery", () => {
    for (const skillName of ["frontend-ui-ux", "visual-qa"]) {
      const path = join(skillsRoot, skillName, "SKILL.md");
      const detailPath = join(skillsRoot, skillName, "references", "complete-contract.md");
      assert.equal(existsSync(path), true, `${skillName} remains a canonical Skill-discovery entrypoint`);
      assert.match(readFileSync(path, "utf8"), new RegExp(`^name:\\s*${skillName}$`, "mu"));
      assert.ok(
        Buffer.byteLength(readFileSync(detailPath, "utf8"), "utf8") >= 15_000,
        `${skillName} must preserve its dense detailed contract behind the lazy entrypoint`,
      );
    }

    const visualRuntime = join(skillsRoot, "visual-qa", "scripts", "cli.ts");
    assert.equal(existsSync(visualRuntime), true, "the characterized TypeScript visual advisory runtime remains present");
  });

  it("uiux.design-contract-v1alpha1", () => {
    const skill = uiuxSkillCorpus("frontend-ui-ux");
    const schemaPath = join(skillsRoot, "frontend-ui-ux", "schemas", "design-contract-v1alpha1.schema.json");

    assert.equal(
      existsSync(schemaPath),
      true,
      "frontend-ui-ux is missing its machine-readable v1alpha1 Design Contract schema",
    );
    const schema = readJson(schemaPath);
    assert.equal(schema.$id, "litfamily.design-contract/v1alpha1");
    assert.equal(schema.additionalProperties, false, "the canonical contract must reject unknown top-level fields");
    assert.deepEqual(schema.required, [
      "schema_id",
      "contract_id",
      "source_hash",
      "intent",
      "direction",
      "inventory",
      "accessibility",
      "localization",
      "performance",
      "evidence_policy",
      "omissions",
      "accepted_exceptions",
    ], "the Design Contract has exactly twelve required root keys");
    assert.equal(
      Object.hasOwn(schema.properties, "dataset"),
      false,
      "the Design Contract must not bind a dataset",
    );
    assert.match(skill, /litfamily\.design-contract\/v1alpha1/u);
    assert.match(skill, /canonical JSON/iu);
    assert.match(skill, /finite inventory/iu);
    assert.match(skill, /1 MiB/u);
  });

  it("uiux.design-contract-v1beta1 executable parity and alpha legacy disposition", () => {
    const schemaPath = join(skillsRoot, "frontend-ui-ux", "schemas", "design-contract-v1beta1.schema.json");
    assert.equal(existsSync(schemaPath), true);
    const schema = readJson(schemaPath);
    assert.equal(schema.$id, "litfamily.design-contract/v1beta1");
    for (const field of ["lane", "tokens", "component_behaviors", "responsive_transformations", "motion", "acceptance_criteria"]) {
      assert.ok(schema.required.includes(field), `beta schema must require ${field}`);
    }

    const valid = betaDesignContract();
    assert.deepEqual(collectDesignContractIssues(valid), []);
    assert.deepEqual(designContractReport(valid), {
      valid: true,
      schema: "litfamily.design-contract/v1beta1",
      issues: [],
      diagnostics: [],
      evidence_eligible: true,
    });

    const dangling = betaDesignContract();
    dangling.component_behaviors[0].component_id = "component:missing";
    assert.match(collectDesignContractIssues(dangling).map((issue) => issue.message).join("\n"), /component:missing.*declared component/iu);

    assert.deepEqual(designContractReport(designContract()), {
      valid: true,
      schema: "litfamily.design-contract/v1alpha1",
      issues: [],
      diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
      evidence_eligible: false,
    });
  });

  it("visualqa accepts canonical v1beta2 and keeps explicit v1beta1 compatibility", () => {
    const compatibilitySchemaPath = join(skillsRoot, "visual-qa", "schemas", "design-contract-v1beta1.schema.json");
    assert.equal(existsSync(compatibilitySchemaPath), true, "visual-qa must ship the v1beta1 compatibility schema");
    const compatibilitySchema = readJson(compatibilitySchemaPath);
    assert.equal(compatibilitySchema.$id, "litfamily.design-contract/v1beta1");

    const schemaPath = join(skillsRoot, "visual-qa", "schemas", "design-contract-v1beta2.schema.json");
    assert.equal(existsSync(schemaPath), true, "visual-qa must ship the canonical v1beta2 schema");
    const schema = readJson(schemaPath);
    assert.equal(schema.$id, "litfamily.design-contract/v1beta2");
    assert.equal(schema.properties.schema_id.const, "litfamily.design-contract/v1beta2");
    assert.equal(schema.properties.taste.$ref, "#/$defs/taste");
    assert.equal(schema.required.includes("taste"), false, "taste remains optional in v1beta2");

    assert.equal(schemaAccepts(compatibilitySchema, betaDesignContract()), true);
    assert.equal(schemaAccepts(schema, beta2DesignContract()), true);
    assert.equal(schemaAccepts(schema, beta2DesignContract({ taste: { variance: 11, motion: 3, density: 7 } })), false);
    assert.equal(designContractShapeValid(beta2DesignContract()), true);
    assert.equal(designContractShapeValid(betaDesignContract()), true);
    assert.equal(
      designContractShapeValid(betaDesignContract({ taste: { variance: 5, motion: 3, density: 7 } })),
      false,
      "v1beta1 must not silently accept the v1beta2-only taste key",
    );
  });

  it("visualqa accepts v1beta2 when optional taste is absent and keeps the shape closed", () => {
    const withoutTaste = beta2DesignContract();
    delete withoutTaste.taste;
    assert.equal(designContractShapeValid(withoutTaste), true, "taste must remain optional");

    assert.equal(
      designContractShapeValid(beta2DesignContract({ unreviewed: true })),
      false,
      "unknown v1beta2 fields must remain rejected",
    );
    assert.equal(
      designContractShapeValid(beta2DesignContract({ taste: { variance: 11, motion: 3, density: 7 } })),
      false,
      "out-of-range taste must remain rejected",
    );
  });

  it("uiux beta authoring and evidence validators enforce the same bounds and global IDs", () => {
    const oversized = betaDesignContract({
      tokens: Array.from({ length: 257 }, (_, index) => ({
        id: `token:item-${index}`,
        category: "other",
        value: "value",
        usage: "usage",
      })),
    });
    assert.ok(collectDesignContractIssues(oversized).length > 0, "authoring must enforce the 256-token beta bound");
    assert.equal(designContractShapeValid(oversized), false, "evidence must enforce the same beta bound");

    const collision = betaDesignContract({
      omissions: [{ id: "token:action", reason: "Deferred token migration", owner: "design" }],
    });
    assert.ok(
      collectDesignContractIssues(collision).some(({ code }) => code === "DESIGN_CONTRACT_ID_COLLISION"),
      "authoring must detect a beta ID colliding with a base scope record",
    );
    assert.equal(designContractShapeValid(collision), false, "evidence must detect the same global collision");
  });

  it("uiux beta authoring and evidence validators share 64/65 reference limits", () => {
    for (const field of ["state_ids", "interaction_ids"]) {
      const boundary = betaContractWithReferences(field, 64);
      assert.deepEqual(collectDesignContractIssues(boundary), [], `${field} authoring must accept 64 references`);
      assert.equal(designContractShapeValid(boundary), true, `${field} evidence must accept 64 references`);

      const oversized = betaContractWithReferences(field, 65);
      assert.ok(
        collectDesignContractIssues(oversized).some(({ path }) => path === `component_behaviors[0].${field}`),
        `${field} authoring must reject 65 references`,
      );
      assert.equal(designContractShapeValid(oversized), false, `${field} evidence must reject 65 references`);
    }
  });

  it("uiux beta requires at least narrow and wide viewport declarations", () => {
    const schema = readJson(join(skillsRoot, "frontend-ui-ux", "schemas", "design-contract-v1beta1.schema.json"));
    assert.equal(schema.$defs.inventory.properties.viewports.minItems, 2);

    const oneViewport = betaDesignContract();
    oneViewport.inventory.viewports = [oneViewport.inventory.viewports[0]];
    assert.ok(
      collectDesignContractIssues(oneViewport).some(({ path }) => path === "inventory.viewports"),
      "authoring must reject a beta contract without both viewport bounds",
    );
    assert.equal(designContractShapeValid(oneViewport), false, "evidence must reject the same beta viewport shape");
  });

  it("published beta design schema and both runtimes agree on accepted and rejected witnesses", () => {
    const schema = readJson(join(skillsRoot, "frontend-ui-ux", "schemas", "design-contract-v1beta1.schema.json"));
    const astral512 = "😀".repeat(512);
    const astral513 = "😀".repeat(513);
    assert.equal(Buffer.byteLength(astral512, "utf8"), 2048, "UTF-8 byte budgets remain separate from schema code-point counts");
    const witnesses = [
      ["valid", betaDesignContract(), true],
      ["empty base audience", (() => { const value = betaDesignContract(); value.intent.audiences = []; return value; })(), false],
      ["unknown base direction field", (() => { const value = betaDesignContract(); value.direction.unreviewed = true; return value; })(), false],
      ["route missing a base field", (() => { const value = betaDesignContract(); delete value.inventory.routes[0].primary; return value; })(), false],
      ["astral text at 512 code points", (() => { const value = betaDesignContract(); value.direction.name = astral512; return value; })(), true],
      ["astral text at 513 code points", (() => { const value = betaDesignContract(); value.direction.name = astral513; return value; })(), false],
      ["astral beta-extension text at 512 code points", (() => { const value = betaDesignContract(); value.tokens[0].value = astral512; return value; })(), true],
      ["astral beta-extension text at 513 code points", (() => { const value = betaDesignContract(); value.tokens[0].value = astral513; return value; })(), false],
    ];
    for (const [label, witness, accepted] of witnesses) {
      assert.deepEqual({
        publishedSchema: schemaAccepts(schema, witness),
        authoringRuntime: collectDesignContractIssues(witness).length === 0,
        evidenceRuntime: designContractShapeValid(witness),
      }, {
        publishedSchema: accepted,
        authoringRuntime: accepted,
        evidenceRuntime: accepted,
      }, label);
    }
  });

  it("published beta evidence schema and runtime agree on grouped and bounded text witnesses", () => {
    const schema = readJson(join(skillsRoot, "visual-qa", "schemas", "evidence-manifest-v1beta1.schema.json"));
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-parity-"));
    const base = writeBetaEvidenceFixture(dir).manifest;
    const astral512 = "😀".repeat(512);
    const astral513 = "😀".repeat(513);
    const witnesses = [
      ["valid", base, true],
      ["inventory missing status", (() => { const value = structuredClone(base); delete value.inventory[0].status; return value; })(), false],
      ["result missing metrics", (() => { const value = structuredClone(base); delete value.mechanical_results[0].metrics; return value; })(), false],
      ["cleanup missing resources", (() => { const value = structuredClone(base); delete value.cleanup.resources; return value; })(), false],
      ["cleanup unknown field", (() => { const value = structuredClone(base); value.cleanup.note = "self attested"; return value; })(), false],
      ["one-line text at 512", (() => { const value = structuredClone(base); value.auth_owner = "x".repeat(512); return value; })(), true],
      ["one-line text at 513", (() => { const value = structuredClone(base); value.auth_owner = "x".repeat(513); return value; })(), false],
      ["multiline text", (() => { const value = structuredClone(base); value.auth_owner = "owner\nforged"; return value; })(), false],
      ["astral text at 512 code points", (() => { const value = structuredClone(base); value.auth_owner = astral512; return value; })(), true],
      ["astral text at 513 code points", (() => { const value = structuredClone(base); value.auth_owner = astral513; return value; })(), false],
    ];
    try {
      for (const [label, witness, accepted] of witnesses) {
        assert.deepEqual({
          publishedSchema: schemaAccepts(schema, witness),
          runtimeShape: evidenceShapeValid(witness),
        }, {
          publishedSchema: accepted,
          runtimeShape: accepted,
        }, label);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa.evidence-manifest-v1beta1 binds material PNG evidence and honest blockers", () => {
    const schemaPath = join(skillsRoot, "visual-qa", "schemas", "evidence-manifest-v1beta1.schema.json");
    assert.equal(existsSync(schemaPath), true);
    assert.equal(readJson(schemaPath).$id, "litfamily.evidence-manifest/v1beta1");

    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-evidence-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      const valid = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
        currentSourceRevision: fixture.manifest.source_revision,
      });
      assert.equal(valid.verdict, "BLOCKED");
      assert.equal(valid.evidence_eligible, false);
      assert.ok(valid.blocked_codes.includes("BLOCKED_EVIDENCE_FRESHNESS_UNPROVEN"));
      assert.ok(valid.blocked_codes.includes("BLOCKED_EVIDENCE_ROOT_UNPROVEN"));

      const missing = structuredClone(fixture.manifest);
      missing.artifacts[1].path = "missing.png";
      missing.verdict = "FAIL";
      writeFileSync(fixture.manifestPath, `${JSON.stringify(missing)}\n`);
      assert.notEqual(validateEvidence(fixture.manifestPath, {
        tier: "smoke", now: "2026-07-24T12:00:00.000Z",
      }).verdict, "PASS");

      const notPng = structuredClone(fixture.manifest);
      const textBytes = Buffer.from("not a png");
      writeFileSync(join(dir, "capture.png"), textBytes);
      notPng.capture_hash = sha256(textBytes);
      notPng.artifacts[1].sha256 = notPng.capture_hash;
      notPng.verdict = "FAIL";
      writeFileSync(fixture.manifestPath, `${JSON.stringify(notPng)}\n`);
      const invalidImage = validateEvidence(fixture.manifestPath, {
        tier: "smoke", now: "2026-07-24T12:00:00.000Z",
      });
      assert.ok(invalidImage.codes.includes("EVIDENCE_CAPTURE_INVALID"));
      assert.notEqual(invalidImage.verdict, "PASS");

      writeFileSync(join(dir, "capture.png"), fixture.captureBytes);
      const unavailable = structuredClone(fixture.manifest);
      unavailable.capabilities.capture = false;
      unavailable.verdict = "BLOCKED";
      writeFileSync(fixture.manifestPath, `${JSON.stringify(unavailable)}\n`);
      const renderer = validateEvidence(fixture.manifestPath, {
        tier: "smoke", now: "2026-07-24T12:00:00.000Z",
      });
      assert.ok(renderer.blocked_codes.includes("BLOCKED_RENDERER_UNAVAILABLE"));

      const selfAttested = structuredClone(fixture.manifest);
      selfAttested.tier = "full";
      selfAttested.capabilities.independent_review = true;
      const inputs = {
        design_contract_hash: selfAttested.design_contract_hash,
        source_hash: selfAttested.source_hash,
        capture_hash: selfAttested.capture_hash,
        artifacts_hash: sha256(stableJson(
          selfAttested.artifacts.map(({ id, sha256: hash }) => ({ id, sha256: hash })),
        )),
      };
      const reviewedInventory = selfAttested.inventory.map(({ id }) => id);
      selfAttested.review_receipts = [
        reviewReceipt("quality-reviewer", "context:quality-beta", inputs, { reviewed_inventory: reviewedInventory }),
        reviewReceipt("lit-verifier", "context:oracle-beta", inputs, { reviewed_inventory: reviewedInventory }),
      ];
      selfAttested.review_receipt_hashes = selfAttested.review_receipts.map((receipt) =>
        sha256(stableJson(receipt)));
      selfAttested.verdict = "BLOCKED";
      writeFileSync(fixture.manifestPath, `${JSON.stringify(selfAttested)}\n`);
      const provenance = validateEvidence(fixture.manifestPath, {
        tier: "full", now: "2026-07-24T12:00:00.000Z",
      });
      assert.ok(provenance.blocked_codes.includes("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"));
      assert.notEqual(provenance.verdict, "PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa beta freshness is material and requires current source revision evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-material-freshness-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      const old = new Date("2026-07-20T12:00:00.000Z");
      for (const name of ["design-contract.json", "source.bin", "capture.png", "capture-expanded.png", "evidence.json"]) {
        utimesSync(join(dir, name), old, old);
      }
      const stale = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
        currentSourceRevision: fixture.manifest.source_revision,
      });
      assert.equal(stale.verdict, "BLOCKED");
      assert.ok(stale.blocked_codes.includes("BLOCKED_EVIDENCE_STALE"));

      const unproved = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
      });
      assert.equal(unproved.verdict, "BLOCKED");
      assert.ok(unproved.blocked_codes.includes("BLOCKED_EVIDENCE_FRESHNESS_UNPROVEN"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa copied old bytes cannot self-prove freshness by touching pathname times", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-touched-copy-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      const touched = new Date("2026-07-24T11:59:59.000Z");
      for (const name of ["design-contract.json", "source.bin", "capture.png", "capture-expanded.png", "evidence.json"]) {
        utimesSync(join(dir, name), touched, touched);
      }
      const report = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
        currentSourceRevision: fixture.manifest.source_revision,
      });
      assert.equal(report.verdict, "BLOCKED");
      assert.equal(report.evidence_eligible, false);
      assert.ok(report.blocked_codes.includes("BLOCKED_EVIDENCE_FRESHNESS_UNPROVEN"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa root substitution after pathname validation cannot produce PASS", () => {
    const parent = mkdtempSync(join(tmpdir(), "litclaude-beta-root-swap-"));
    const checked = join(parent, "checked");
    const held = join(parent, "checked-before-swap");
    const replacement = join(parent, "replacement");
    const preload = join(parent, "root-swap-preload.mjs");
    mkdirSync(checked);
    mkdirSync(replacement);
    try {
      const fixture = writeBetaEvidenceFixture(checked);
      writeBetaEvidenceFixture(replacement);
      writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.lstatSync;
let swapped = false;
fs.lstatSync = function(path, ...args) {
  const stat = original.call(this, path, ...args);
  if (!swapped && path === process.env.LITCLAUDE_CHECKED_ROOT) {
    swapped = true;
    fs.renameSync(path, process.env.LITCLAUDE_HELD_ROOT);
    fs.renameSync(process.env.LITCLAUDE_REPLACEMENT_ROOT, path);
  }
  return stat;
};
syncBuiltinESMExports();
`);
      const cli = join(skillsRoot, "visual-qa", "scripts", "cli.mjs");
      const result = spawnSync(process.execPath, [
        cli, "validate-evidence", fixture.manifestPath,
        "--tier", "smoke",
        "--now", "2026-07-24T12:00:00.000Z",
        "--current-source-hash", fixture.manifest.source_hash,
        "--current-source-revision", fixture.manifest.source_revision,
      ], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          LITCLAUDE_CHECKED_ROOT: checked,
          LITCLAUDE_HELD_ROOT: held,
          LITCLAUDE_REPLACEMENT_ROOT: replacement,
        },
      });
      assert.notEqual(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "BLOCKED");
      assert.ok(report.blocked_codes.includes("BLOCKED_EVIDENCE_ROOT_UNPROVEN"));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("visualqa beta evidence rejects an alpha design contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-alpha-contract-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      const alphaBytes = `${JSON.stringify(designContract())}\n`;
      writeFileSync(join(dir, "design-contract.json"), alphaBytes);
      fixture.manifest.design_contract_hash = sha256(alphaBytes);
      writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`);

      const report = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
      });
      assert.notEqual(report.verdict, "PASS");
      assert.equal(report.evidence_eligible, false);
      assert.ok(report.codes.includes("EVIDENCE_CONTRACT_SCHEMA_LEGACY"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa validates a v1beta2 contract through the evidence CLI path", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta2-evidence-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      const contractBytes = `${JSON.stringify(beta2DesignContract())}\n`;
      writeFileSync(join(dir, "design-contract.json"), contractBytes);
      fixture.manifest.design_contract_hash = sha256(contractBytes);
      writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`);

      const cli = join(skillsRoot, "visual-qa", "scripts", "cli.mjs");
      const result = spawnSync(process.execPath, [
        cli, "validate-evidence", fixture.manifestPath,
        "--tier", "smoke",
        "--now", "2026-07-24T12:00:00.000Z",
        "--current-source-hash", fixture.manifest.source_hash,
        "--current-source-revision", fixture.manifest.source_revision,
      ], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 2, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "BLOCKED");
      assert.equal(report.codes.includes("EVIDENCE_CONTRACT_INVALID"), false);
      assert.equal(report.codes.includes("EVIDENCE_CONTRACT_SCHEMA_LEGACY"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa smoke evidence rejects inventory not declared by the beta contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-undeclared-inventory-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      fixture.manifest.inventory[0].id = "route:undeclared";
      writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`);
      const report = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
      });
      assert.notEqual(report.verdict, "PASS");
      assert.equal(report.evidence_eligible, false);
      assert.ok(report.codes.includes("EVIDENCE_CONTRACT_INVENTORY_MISMATCH"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa smoke evidence requires a declared negative or empty state when applicable", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-smoke-negative-state-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      fixture.manifest.inventory = fixture.manifest.inventory.filter(({ kind }) => kind !== "state");
      writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`);
      const report = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
        currentSourceRevision: fixture.manifest.source_revision,
      });
      assert.notEqual(report.verdict, "PASS");
      assert.ok(report.codes.includes("INVENTORY_INCOMPLETE"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visualqa smoke evidence cannot reuse one PNG for incompatible contract viewports", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-beta-viewport-binding-"));
    try {
      const fixture = writeBetaEvidenceFixture(dir);
      fixture.manifest.inventory.find(({ id }) => id === "viewport:expanded").evidence_ids = ["artifact:capture"];
      writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest)}\n`);
      const report = validateEvidence(fixture.manifestPath, {
        tier: "smoke",
        now: "2026-07-24T12:00:00.000Z",
        currentSourceHash: fixture.manifest.source_hash,
      });
      assert.notEqual(report.verdict, "PASS");
      assert.equal(report.evidence_eligible, false);
      assert.ok(report.codes.includes("EVIDENCE_VIEWPORT_BINDING_INVALID"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uiux lazy docs describe beta authority, blockers, and generated integrity boundaries", () => {
    const frontendDetail = readFileSync(join(skillsRoot, "frontend-ui-ux", "references", "complete-contract.md"), "utf8");
    const lanes = readFileSync(join(skillsRoot, "frontend-ui-ux", "references", "operating-lanes.md"), "utf8");
    const visualDetail = readFileSync(join(skillsRoot, "visual-qa", "references", "complete-contract.md"), "utf8");
    const koreanReadme = readFileSync(join(root, "README_ko-KR.md"), "utf8");

    for (const text of [visualDetail, koreanReadme]) {
      assert.match(text, /litfamily\.design-contract\/v1beta2/u);
      assert.match(text, /litfamily\.design-contract\/v1beta1[\s\S]{0,180}compatibility/u);
    }
    assert.match(lanes, /authoritative[\s\S]{0,120}litfamily\.design-contract\/v1beta2/u);
    assert.match(lanes, /litfamily\.design-contract\/v1beta1[\s\S]{0,120}compatibility/u);
    assert.match(frontendDetail, /authoritative[\s\S]{0,120}litfamily\.design-contract\/v1beta2/u);
    assert.match(frontendDetail, /litfamily\.design-contract\/v1beta1[\s\S]{0,120}compatibility/u);
    assert.doesNotMatch(frontendDetail, /(?:authoritative shape|authoritative schema)[^\n]*litfamily\.design-contract\/v1beta1/u);
    assert.match(frontendDetail, /LEGACY_SCHEMA_V1ALPHA1/u);
    assert.match(frontendDetail, /evidence_eligible[^\n]*false/iu);
    assert.match(lanes, /lane[^\n]*machine-checkable/iu);
    assert.match(visualDetail, /EVIDENCE_CONTRACT_SCHEMA_LEGACY/u);
    assert.match(visualDetail, /EVIDENCE_VIEWPORT_BINDING_INVALID/u);
    assert.match(frontendDetail, /viewports[^\n]*2\.\.32/iu);
    assert.match(koreanReadme, /4096[^\n]*(?:byte|바이트)/iu);
    for (const text of [frontendDetail, visualDetail, koreanReadme]) {
      assert.doesNotMatch(text, /\b\d+ resources?\b|\d+-resource boundary/iu);
    }
    assert.match(frontendDetail, /CANONICAL_FRONTEND_CORPUS_PASS/u);
    assert.match(frontendDetail, /generated\s+resource manifest/iu);
    assert.match(visualDetail, /generated\s+resource manifest/iu);
    assert.match(frontendDetail, /PostToolUse[\s\S]{0,240}advisory[\s\S]{0,240}does not[\s\S]{0,80}inject either skill body/iu);
    assert.match(visualDetail, /prompt activation[\s\S]{0,180}synthetic bounded hook pointer/iu);
    assert.match(visualDetail, /not (?:the )?exact `?SKILL\.md`? body/iu);
    assert.match(visualDetail, /PostToolUse[\s\S]{0,240}advisory[\s\S]{0,160}does not inject this complete contract/iu);
    assert.match(visualDetail, /self-attested[^.]*receipts[^.]*cannot establish[^.]*provenance/iu);
    assert.match(visualDetail, /full[^.]*reference-fidelity[^.]*BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE/iu);
    assert.match(visualDetail, /--current-source-hash[\s\S]{0,180}--current-source-revision/u);
    assert.match(visualDetail, /public JSON[^.]*cannot[^.]*capture provenance/iu);
    assert.match(visualDetail, /BLOCKED_EVIDENCE_ROOT_UNPROVEN/u);
    assert.match(visualDetail, /smoke[\s\S]{0,180}negative or empty state/iu);
    assert.match(koreanReadme, /synthetic bounded hook pointer/iu);
  });

  it("uiux evidence review keeps optional narrative checks advisory", () => {
    const evidenceReview = readFileSync(
      join(skillsRoot, "frontend-ui-ux", "references", "evidence-review.md"),
      "utf8",
    );

    assert.match(
      evidenceReview,
      /Optional narrative check/u,
      "G13_GUIDANCE_PRESENT: evidence-review.md must name the optional narrative check",
    );
    assert.match(
      evidenceReview,
      /implied narrative or progression[\s\S]*?semantic feel[\s\S]*?not schema fields/u,
      "G13_OPTIONAL_ADVISORY_QUESTIONS: evidence-review.md must keep narrative questions advisory",
    );
    assert.match(
      evidenceReview,
      /does not assign a rendered verdict[\s\S]*?visual-qa owns rendered evidence and verdicts/u,
      "G13_PRESERVES_EXISTING_CONTRACT: visual-qa must own rendered evidence and verdicts",
    );
  });

  it("uiux.lane-vocabulary-is-coherent", () => {
    // SKILL.md's mode_matrix and operating-lanes.md used to be two non-isomorphic
    // five-way taxonomies (greenfield/reference-led vs new-build/reference-fidelity),
    // and the router had no lane column while the procedure told the reader to open
    // "the rows the router marks for the mode". All three must agree.
    const skillRoot = join(skillsRoot, "frontend-ui-ux");
    const skill = uiuxSkillCorpus("frontend-ui-ux");
    const lanesDoc = readFileSync(join(skillRoot, "references", "operating-lanes.md"), "utf8");
    const LANES = ["new-build", "brownfield", "redesign", "reference-fidelity", "design-system"];

    for (const lane of LANES) {
      assert.match(skill, new RegExp(`\`${lane}\``, "u"), `SKILL.md mode_matrix must name ${lane}`);
      assert.match(lanesDoc, new RegExp(`\`${lane}\``, "u"), `operating-lanes.md must name ${lane}`);
    }
    for (const retired of ["greenfield", "reference-led"]) {
      assert.doesNotMatch(skill, new RegExp(retired, "u"), `${retired} is a retired synonym`);
      assert.doesNotMatch(lanesDoc, new RegExp(retired, "u"), `${retired} is a retired synonym`);
    }

    // `degraded` stays, but only as an explicitly labelled overlay, not a sixth lane.
    assert.match(skill, /`degraded` \(overlay\)/u);
    assert.match(skill, /not a sixth lane/u);

    // The router must actually carry the lane column the procedure refers to.
    assert.match(skill, /\| Reference \| Lanes \| Open it to answer \|/u);
    const routerRows = skill.split("\n").filter((line) => /^\| `references\//u.test(line));
    // 18 since the craft-floor and slop-register references joined the router (2026-09-27).
    assert.equal(routerRows.length, 18, "every shipped reference needs a router row");
    assert.ok(
      routerRows.some((row) => row.startsWith("| `references/motion-guide.md` | all |")),
      "the motion guide must be reachable from the lane router",
    );
    assert.match(skill, /examples\/phase-3-readme-ab\/<case>\/\{before\.md,after\.md,before\.png,after\.png\}/u);
    for (const row of routerRows) {
      const lanes = row.split("|")[2].trim();
      if (lanes === "all") continue;
      for (const [, name] of lanes.matchAll(/`([a-z-]+)`/gu)) {
        assert.ok(LANES.includes(name), `router row names unknown lane ${name}`);
      }
    }

    // Beta records the lane in the artifact; alpha remains closed and migration-only.
    assert.match(lanesDoc, /required, machine-checkable `lane` field/iu);
    assert.match(lanesDoc, /validator rejects a missing lane/iu);
    assert.match(lanesDoc, /LEGACY_SCHEMA_V1ALPHA1/u);
    assert.match(lanesDoc, /review package/u);
    const schema = readJson(join(skillRoot, "schemas", "design-contract-v1alpha1.schema.json"));
    assert.equal(schema.additionalProperties, false);
    assert.equal(Object.hasOwn(schema.properties, "lane"), false, "alpha remains closed for migration diagnostics");
  });

  it("litresearch.phase-3b-and-attribution-move-together", () => {
    // The licence coupling is the point of this test. The repo was self-consistent while
    // NEITHER was present; shipping the gate without the notice is an MIT violation, and
    // shipping the notice without the gate leaves a dead credit. Either both or neither.
    const skillPath = join(skillsRoot, "litresearch", "SKILL.md");
    const attributionPath = join(skillsRoot, "litresearch", "ATTRIBUTION.md");
    const skill = readFileSync(skillPath, "utf8");
    const hasGate = /## Phase 3b/u.test(skill);
    const hasAttribution = existsSync(attributionPath);

    assert.equal(
      hasGate,
      hasAttribution,
      hasGate
        ? "Phase 3b ships without ATTRIBUTION.md — that is a licence violation"
        : "ATTRIBUTION.md ships without Phase 3b — remove the notice or restore the gate",
    );

    if (!hasGate) return;

    // The gate's four load-bearing conditions.
    assert.match(skill, /2 independent source domains/u);
    assert.match(skill, /2 independent observation groups/u);
    assert.match(skill, /counter-search/u);
    assert.match(skill, /primary source/iu);
    assert.match(skill, /Unresolved/u);
    assert.match(skill, /Refuted/u);
    assert.match(skill, /claim-graph\.md/u);
    // Root-owned: subagents return message text, never write the graph.
    assert.match(skill, /read-only.*never by writing a file|never by writing a file/isu);
    // The gate must point at its own notice.
    assert.match(skill, /ATTRIBUTION\.md/u);

    // The notice must carry the credit, the source, and the licence text itself.
    const attribution = readFileSync(attributionPath, "utf8");
    assert.match(attribution, /fivetaku/u);
    assert.match(attribution, /insane-research/u);
    assert.match(attribution, /github\.com\/fivetaku\/insane-research/u);
    assert.match(attribution, /MIT License/u);
    assert.match(attribution, /Copyright \(c\) 2026 fivetaku/u);
    assert.match(attribution, /permission notice shall be included/u);
    assert.match(attribution, /THE SOFTWARE IS PROVIDED "AS IS"/u);
    // It must be honest that only an idea was adapted, with no vendored code.
    assert.match(attribution, /no third-party source code is vendored/iu);

    // The deliberate-non-port list must no longer imply the gate was dropped.
    assert.match(skill, /Phase 3b claim-graph gate is \*\*not\*\* on this list/u);
  });

  it("ships every MVP skill with Claude-compatible frontmatter", () => {
    for (const skillName of expectedSkills) {
      const path = join(skillsRoot, skillName, "SKILL.md");
      assert.equal(existsSync(path), true, `${skillName} must have SKILL.md`);

      const text = readFileSync(path, "utf8");
      assert.match(text, /^---\n[\s\S]*description:/u, `${skillName} must declare a description`);
      assert.match(text, new RegExp(`name:\\s*${skillName}`, "u"), `${skillName} must declare its name`);
    }
  });

  it("does not contain incompatible tool instructions", () => {
    for (const skillName of expectedSkills) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      for (const pattern of bannedPatterns) {
        assert.equal(pattern.test(text), false, `${skillName} contains banned pattern ${pattern}`);
      }
    }
  });

  it("ships a substantive LitClaude skill corpus instead of short placeholders", () => {
    let totalLines = 0;

    for (const skillName of expectedSkills) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      const lines = text.trim().split(/\r?\n/u).length;
      totalLines += lines;

      assert.ok(lines >= 30, `${skillName} should carry substantive guidance, got ${lines} lines`);
      assert.match(text, /## /u, `${skillName} should be structured with actionable sections`);
      assert.match(text, /Claude Code|LitClaude|Manual QA|TDD|diagnostics|workflow|evidence|rules|review|refactor|comments/iu, `${skillName} should be adapted to Claude/LitClaude execution`);
    }

    assert.ok(totalLines >= 1000, `LitClaude skills should be richly developed, got only ${totalLines} total lines`);
  });

  it("uses the stable LLM contract schema in every plugin skill entrypoint", () => {
    for (const skillName of expectedSkills) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      assertLlmContract(text, `Skill(${skillName})`);
    }
  });

  it("keeps the top-level skill word corpus above the reference floor", () => {
    const skillFiles = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(skillsRoot, entry.name, "SKILL.md"))
      .filter((path) => existsSync(path));

    const totalWords = skillFiles.reduce((total, path) => {
      const words = readFileSync(path, "utf8").trim().split(/\s+/u).filter(Boolean).length;
      return total + words;
    }, 0);

    assert.ok(
      totalWords >= topLevelSkillCorpusWordFloor,
      `LitClaude top-level SKILL.md corpus should have at least ${topLevelSkillCorpusWordFloor} whitespace-token words, got ${totalWords}`,
    );
  });

  it("ships auxiliary reference packs and original skill aliases", () => {
    const programmingReferenceFiles = [
      "references/typescript/README.md",
      "references/python/README.md",
      "references/rust/README.md",
      "references/go/README.md",
      "scripts/typescript/check-no-excuse-rules.ts",
      "scripts/python/check-no-excuse-rules.py",
      "scripts/rust/check-no-excuse-rules.py",
      "scripts/go/check-no-excuse-rules.sh",
    ];
    const debuggingReferenceFiles = [
      "references/methodology/00-setup.md",
      "references/methodology/02-investigate.md",
      "references/methodology/04-oracle-triple.md",
      "references/methodology/08-qa.md",
      "references/runtimes/node.md",
      "references/runtimes/python.md",
      "references/tools/playwright-cli.md",
    ];

    for (const relativePath of programmingReferenceFiles) {
      assert.equal(existsSync(join(skillsRoot, "lit-code", relativePath)), true, `missing programming ${relativePath}`);
    }
    for (const relativePath of debuggingReferenceFiles) {
      assert.equal(existsSync(join(skillsRoot, "debugging", relativePath)), true, `missing debugging ${relativePath}`);
    }

    const alias = readFileSync(join(skillsRoot, "lit-burnoff-file", "SKILL.md"), "utf8");
    assert.match(alias, /name:\s*lit-burnoff-file/u);
    assert.match(alias, /SINGLE file/u);
  });

  it("keeps visual QA browser backends explicit, bounded, and cleanup-safe", () => {
    const visualQa = uiuxSkillCorpus("visual-qa");

    assert.match(visualQa, /project(?:'s|-local) Playwright.*first/isu);
    assert.match(visualQa, /explicitly user-enabled Claude Chrome capability/iu);
    assert.match(visualQa, /callable in\s+the current session/iu);
    assert.match(visualQa, /session binding/iu);
    assert.match(visualQa, /verified PID, port, and\s+command ownership/iu);
    assert.match(visualQa, /no cookie or profile sharing/iu);
    assert.match(visualQa, /No dependency install or\s+host config mutation is allowed/iu);
    assert.match(visualQa, /metrics are advisory unless hardened/iu);
    assert.match(visualQa, /BLOCKED.*timeout.*cleanup receipt/isu);
  });

  it("preserves the core workflow disciplines in Claude-native wording", () => {
    const programming = readFileSync(join(skillsRoot, "lit-code", "SKILL.md"), "utf8");
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");
    const refactor = readFileSync(join(skillsRoot, "refactor", "SKILL.md"), "utf8");
    const litgoalSkill = readFileSync(join(skillsRoot, "litgoal", "SKILL.md"), "utf8");
    const rules = readFileSync(join(skillsRoot, "rules", "SKILL.md"), "utf8");

    assert.match(programming, /Parse, don't validate/u);
    assert.match(programming, /TDD DISCIPLINE/u);
    assert.match(programming, /250.*LOC/u);
    assert.match(programming, /BUILD-DECISION GATE/u);
    assert.match(programming, /does this need to exist at all/iu);
    assert.match(reviewWork, /Findings first/u);
    assert.match(reviewWork, /Manual QA/u);
    assert.match(refactor, /characterization/i);
    assert.match(refactor, /behavior-preserving/i);
    assert.match(litgoalSkill, /success criteria/i);
    assert.match(litgoalSkill, /ledger/i);
    assert.match(litgoalSkill, /Manual-QA channels/u);
    assert.match(rules, /lit search/u);
    assert.match(rules, /lit query/u);
  });

  it("requires review-work to orchestrate five evidence lanes with aggregation", () => {
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");

    for (const lane of [
      /scope\/diff verification/i,
      /tests\/evidence execution/i,
      /package\/payload and code quality/i,
      /security\/provenance/i,
      /real-surface\/docs readiness/i,
    ]) {
      assert.match(reviewWork, lane, `review-work should define lane ${lane}`);
    }

    assert.match(reviewWork, /5-lane|five-lane/i);
    assert.match(reviewWork, /verdict table/i);
    assert.match(reviewWork, /aggregation rules?/i);
    assert.match(reviewWork, /launch prompts?/i);
    assert.match(reviewWork, /local-only readiness mining/i);
    assert.match(reviewWork, /external connector opt-in/i);
    assert.match(reviewWork, /PASS|FAIL|BLOCKED/u);
  });

  it("requires litgoal to define durable runtime file contracts", () => {
    const litgoalText = readFileSync(join(skillsRoot, "litgoal", "SKILL.md"), "utf8");

    for (const contract of [
      /plugins\/litclaude\/lib\/litgoal\//u,
      /\.litclaude\/litgoal\/brief\.md/u,
      /\.litclaude\/litgoal\/goals\.json/u,
      /\.litclaude\/litgoal\/ledger\.jsonl/u,
      /atomic/i,
      /lock-safe|concurrent/i,
      /quality gate/i,
      /checkpoint/i,
      /steer/i,
    ]) {
      assert.match(litgoalText, contract, `litgoal should document ${contract}`);
    }
  });

  it("ships Claude-native goal integration in lit skills", () => {
    for (const skillName of ["lit-loop", "lit-plan", "start-work", "litgoal"]) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      assert.match(text, /get_goal/u, `${skillName} should inspect native goal state when available`);
      assert.match(text, /create_goal/u, `${skillName} should create native goal state when available`);
      assert.match(text, /update_goal/u, `${skillName} should defer goal completion until verification passes`);
      assert.match(text, /\/goal/u, `${skillName} should mention Claude Code's native goal surface`);
      assert.match(text, /goal tools are unavailable|goal tools are not exposed|not expose model-facing goal tools/iu, `${skillName} should define a no-goal-tool fallback`);
      assert.match(text, /BLOCKED:/u, `${skillName} should report degraded mode explicitly`);
      assert.match(text, /degraded mode|degraded-mode/i, `${skillName} should name degraded mode`);
      assert.match(text, /without\s+explicit replacement/i, `${skillName} should avoid goal clobbering`);
      assert.match(text, /claude -p "\/goal/u, `${skillName} should document native non-interactive goal surface`);
      if (skillName !== "litgoal") {
        assert.match(text, /Dynamic workflow/u, `${skillName} should guide Claude Code Dynamic workflows`);
        assert.match(text, /Dynamic worktree/u, `${skillName} should guide worktree isolation`);
        assert.match(text, /call `Workflow`|call the `Workflow` tool/u, `${skillName} should call Workflow when Claude Code exposes it`);
        assert.match(text, /EnterWorktree/u, `${skillName} should mention the model-facing worktree tool when exposed`);
        assert.match(text, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1|native agent teams/i, `${skillName} should gate native team mode`);
        assert.match(text, /claude --worktree/u, `${skillName} should give an actionable Dynamic worktree launch path`);
        assert.match(text, /--tmux/u, `${skillName} should mention the tmux native workflow path`);
      }
      assert.doesNotMatch(text, /auto-?type\s+\/goal/iu, `${skillName} must not claim LitClaude types /goal`);
      assert.doesNotMatch(text, /send\s+\/goal/iu, `${skillName} must not tell Claude to send /goal text`);
    }
  });

  it("requires lit execution skills to preserve strict evidence discipline", () => {
    for (const skillName of ["lit-loop", "lit-plan", "start-work"]) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      for (const contract of [
        /Bootstrap/u,
        /PIN/u,
        /RED/u,
        /GREEN/u,
        /SURFACE/u,
        /Manual-QA/u,
        /cleanup receipt/u,
        /reviewer/i,
        /Stop rules/u,
        /stale state/i,
        /dirty worktree/i,
        /resume/i,
        /bounded/i,
        /commit\/push/i,
        /publish/i,
      ]) {
        assert.match(text, contract, `${skillName} should document strict lit contract ${contract}`);
      }
    }
  });

  it("pins the latest prompt and mode contract across lit workflow skills", () => {
    const litLoop = readFileSync(join(skillsRoot, "lit-loop", "SKILL.md"), "utf8");
    const litPlan = readFileSync(join(skillsRoot, "lit-plan", "SKILL.md"), "utf8");
    const startWork = readFileSync(join(skillsRoot, "start-work", "SKILL.md"), "utf8");
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");
    const litresearch = readFileSync(join(skillsRoot, "litresearch", "SKILL.md"), "utf8");
    const litgoal = readFileSync(join(skillsRoot, "litgoal", "SKILL.md"), "utf8");

    assert.match(litLoop, /durable, evidence-driven execution loop/i);
    assert.match(litLoop, /tests are necessary but not\s+sufficient/i);
    assert.match(litLoop, /dirty worktree/i);
    assert.match(litLoop, /prompt injection/i);
    assert.match(litLoop, /repeated interruptions/i);

    assert.match(litPlan, /planning-only/i);
    assert.match(litPlan, /must not implement/i);
    assert.match(litPlan, /must not edit files/i);
    assert.match(litPlan, /Do not call[\s\S]*start-work\s+tool/i);
    assert.match(litPlan, /\/start-work/u);

    assert.match(startWork, /approved plan/i);
    assert.match(startWork, /execution-only/i);
    assert.match(startWork, /do not redesign/i);
    assert.match(startWork, /DoneClaim/u);

    assert.match(reviewWork, /scope\/diff/i);
    assert.match(reviewWork, /tests\/evidence/i);
    assert.match(reviewWork, /package\/payload/i);
    assert.match(reviewWork, /security\/provenance/i);
    assert.match(reviewWork, /real-surface\/docs/i);

    assert.match(litresearch, /material findings[\s\S]*internal journal/i);
    assert.match(litresearch, /verified facts/i);
    assert.match(litresearch, /hypotheses/i);
    assert.match(litresearch, /decision-changing uncertainty once/i);
    assert.match(litresearch, /artifact_genre: client_deliverable[\s\S]*limitations_channel: reply/i);
    assert.match(litresearch, /validator-first/i);
    assert.match(litresearch, /route trace/i);
    assert.match(litresearch, /public API|public feed/i);
    assert.match(litresearch, /SSRF/i);
    assert.match(litresearch, /A\/B/i);
    assert.match(litresearch, /FetchAttempt/u);
    assert.match(litresearch, /FetchVerdict/u);
    assert.match(litresearch, /HTTP 200 is not enough/u);
    assert.match(litresearch, /claim\/source\/confidence\/uncertainty/i);
    assert.match(litresearch, /untried routes/i);
    assert.match(litresearch, /read-only/i);
    assert.match(litresearch, /transcript-only/i);
    assert.match(litresearch, /ask before writing/i);
    assert.match(litresearch, /host-dependent/i);
    assert.match(litresearch, /guaranteed runtime surface/i);
    assert.match(litresearch, /agent-level guidance/i);
    assert.match(litresearch, /names an item without explaining it[\s\S]{0,240}live lead on every tier/i);
    assert.match(litresearch, /uncertainty line is for a gap you tried to close and could not/i);

    assert.match(litgoal, /one outcome-shaped objective/i);
    assert.match(litgoal, /checkable criteria/i);
    assert.match(litgoal, /scenario/i);
    assert.match(litgoal, /observable evidence/i);
  });

  it("hardens orchestration skills with a Claude subagent assignment contract", () => {
    for (const skillName of ["lit-loop", "lit-plan", "start-work", "review-work"]) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      for (const contract of [
        /TASK:/u,
        /DELIVERABLE/u,
        /SCOPE/u,
        /VERIFY/u,
        /background/i,
        /short wait/i,
        /timeout/i,
        /missing deliverable/i,
        /BLOCKED:/u,
        /fallback/i,
        /reviewer role/i,
        /not a generic worker/i,
      ]) {
        assert.match(text, contract, `${skillName} should document subagent reliability contract ${contract}`);
      }
    }
  });

  it("keeps litresearch command aligned with read-only and host-boundary safeguards", () => {
    const command = readFileSync(new URL("../plugins/litclaude/commands/litresearch.md", import.meta.url), "utf8");

    assert.match(command, /read-only/i);
    assert.match(command, /transcript-only/i);
    assert.match(command, /ask before writing/i);
    assert.match(command, /host-dependent/i);
    assert.match(command, /guaranteed runtime surface/i);
    assert.match(command, /Keep exact files inspected[\s\S]*internal evidence packet/i);
    assert.match(command, /decision-changing uncertainty once/i);
    assert.match(command, /internal synthesis[\s\S]*reader-facing answer/i);
  });

  it("requires LitResearch scientific records, root ownership, coverage, and deliberate non-ports", () => {
    const skill = readFileSync(join(skillsRoot, "litresearch", "SKILL.md"), "utf8");
    const command = readFileSync(new URL("../plugins/litclaude/commands/litresearch.md", import.meta.url), "utf8");

    for (const [surface, text] of [["skill", skill], ["command", command]]) {
      assert.match(text, /root-owned|main session owns/iu, `${surface} should keep the research journal root-owned`);
      assert.match(text, /sequential fallback/iu, `${surface} should define a root sequential fallback`);
      assert.match(text, /stable claim ID/iu, `${surface} should require stable claim identifiers`);
      for (const edge of ["supports", "contradicts", "depends_on", "duplicates"]) {
        assert.match(text, new RegExp(`\\b${edge}\\b`, "u"), `${surface} should define the ${edge} evidence edge`);
      }
      assert.match(text, /DOI normalization/iu, `${surface} should normalize DOI identities`);
      assert.match(text, /deduplicat/iu, `${surface} should deduplicate scientific records`);
      assert.match(text, /%PDF/u, `${surface} should require PDF byte proof`);
      for (const state of ["metadata", "acquisition", "conversion", "review"]) {
        assert.match(text, new RegExp(`\\b${state}\\b`, "iu"), `${surface} should keep ${state} state explicit`);
      }
      assert.match(text, /needs_review/u, `${surface} should retain deterministic-output review debt`);
      assert.match(text, /routeCoverageComplete/u, `${surface} should distinguish route exhaustion from access failure`);
      assert.match(text, /Deliberate non-port contract/iu, `${surface} should name the intentional compatibility boundary`);
      assert.match(text, /client or TLS identity/iu, `${surface} should refuse identity mutation`);
      assert.match(text, /proxy rotation/iu, `${surface} should refuse proxy rotation`);
      assert.match(text, /credential replay/iu, `${surface} should refuse credential replay`);
      assert.match(text, /cross-package runtime/iu, `${surface} should preserve package independence`);
    }
  });

  it("requires lit-plan and review surfaces to enforce minimum-first planning", () => {
    const litPlan = readFileSync(join(skillsRoot, "lit-plan", "SKILL.md"), "utf8");
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");
    const qualityReviewer = readFileSync(join(root, "plugins", "litclaude", "agents", "quality-reviewer.md"), "utf8");

    assert.match(litPlan, /minimum-first/i);
    assert.match(litPlan, /reuse existing code/i);
    assert.match(litPlan, /single-task or few-task/i);
    assert.doesNotMatch(litPlan, /fewer than 3 means under-splitting/i);

    for (const text of [reviewWork, qualityReviewer]) {
      assert.match(text, /minimum-first/i);
      assert.match(text, /avoidable custom code/i);
      assert.match(text, /unnecessary helpers?|unnecessary helper/i);
      assert.match(text, /external-source/i);
    }
  });

});


describe("design-production enrollment", () => {
  it("enrolls README Studio with pinned executable and template closure", async () => {
    const { canonicalSkillIds, canonicalSkillResourceFiles } = await import("../plugins/litclaude/lib/canonical-skill-catalog.mjs");
    assert.ok(canonicalSkillIds.includes("readme-studio"), "README Studio must be discoverable by the installed catalog");
    const body = readFileSync(join(skillsRoot, "readme-studio", "SKILL.md"), "utf8");
    assertLlmContract(body, "readme-studio");
    assert.match(body, /^name: readme-studio$/mu);
    for (const leaf of ["scripts/validate-readme-facts.mjs", "templates/typography/shape-text-to-svg.mjs", "templates/typography/package-lock.json", "templates/remotion-cover/package-lock.json", "templates/remotion-cover/src/index.tsx", "templates/hyperframes-cover/index.motion.json"]) {
      assert.ok(canonicalSkillResourceFiles.includes(`skills/readme-studio/${leaf}`), `uninstalled resource: ${leaf}`);
    }
  });
});


describe("design-production canonical validation", () => {
  it("exposes the installed validator and refuses inferred lookalike contracts", () => {
    const skill = readFileSync(join(skillsRoot, "frontend-ui-ux/SKILL.md"), "utf8");
    assert.match(skill, /scripts\/validate-design-contract\.mjs/u);
    const dir = mkdtempSync(join(tmpdir(), "canonical-contract-"));
    try {
      const input = join(dir, "inferred.json");
      writeFileSync(input, JSON.stringify({schema: "litfamily.design-contract/v1beta2", schema_validated: true}));
      const result = spawnSync(process.execPath, [join(skillsRoot, "frontend-ui-ux/scripts/validate-design-contract.mjs"), input], {encoding: "utf8"});
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.valid, false);
      assert.equal(report.evidence_eligible, false);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
});
