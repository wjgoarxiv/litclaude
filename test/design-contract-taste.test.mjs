import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { UiuxContractError } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/errors.mjs";
import {
  DESIGN_SCHEMA,
  DESIGN_SCHEMA_BETA,
  DESIGN_SCHEMA_BETA2,
  designContractReport,
  validateDesignContractValue,
} from "../plugins/litclaude/skills/frontend-ui-ux/scripts/design-contract-rules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = join(ROOT, "plugins/litclaude/skills/frontend-ui-ux");
const SCHEMAS = join(SKILL_ROOT, "schemas");
const BETA2_ID = "litfamily.design-contract/v1beta2";

// A minimal contract that satisfies every closed set, cardinality floor, and referential link
// the runtime rules enforce. The first test asserts this baseline validates, so a later failure
// is unambiguously about taste rather than about a broken fixture.
function baseContract() {
  return {
    schema_id: DESIGN_SCHEMA_BETA,
    contract_id: "contract:taste-fixture",
    source_hash: "a".repeat(64),
    intent: {
      audiences: ["Operators watching the job queue"],
      tasks: ["Retry a failed job without leaving the list"],
      qualities: ["Failure stays legible under load"],
      constraints: [],
      non_goals: [],
    },
    direction: {
      name: "Operational calm",
      principles: ["Show state before chrome", "Never hide a failure", "One primary action per row"],
      token_strategy: "reuse",
      voice: "Plain and factual",
    },
    inventory: {
      routes: [{ id: "route:queue", path: "/queue", primary: true, auth_required: false }],
      regions: [{ id: "region:queue-list", route_id: "route:queue", purpose: "Lists every job" }],
      components: [{ id: "component:job-row", region_id: "region:queue-list", role: "One job summary" }],
      interactions: [{
        id: "interaction:retry",
        route_id: "route:queue",
        critical: true,
        input_modes: ["keyboard", "pointer"],
      }],
      states: [{ id: "state:empty", route_id: "route:queue", kind: "empty" }],
      viewports: [
        { id: "viewport:compact", category: "compact", width_px: 390, height_px: 844 },
        { id: "viewport:expanded", category: "expanded", width_px: 1440, height_px: 900 },
      ],
      references: [],
      authenticated_surfaces: [],
    },
    accessibility: {
      target: "WCAG 2.2 AA",
      keyboard: true,
      screen_reader: true,
      reduced_motion: true,
      forced_colors: true,
      zoom_percent: 200,
    },
    localization: {
      locales: ["ko-KR", "en-US"],
      text_expansion_percent: 30,
      cjk_line_break_review: true,
      font_fallback_review: true,
      ime_review: true,
      rtl_review: false,
    },
    performance: { lcp_ms: 2500, cls: 0.1, inp_ms: 200, initial_js_kb: 180, initial_css_kb: 40 },
    evidence_policy: {
      independent_review_required: true,
      required_channels: ["tests", "browser"],
      cleanup_required: true,
    },
    omissions: [],
    accepted_exceptions: [],
    lane: "brownfield",
    tokens: [{
      id: "token:color-critical",
      category: "color",
      value: "#B3261E",
      usage: "Failure text and the retry affordance",
    }],
    component_behaviors: [{
      component_id: "component:job-row",
      state_ids: ["state:empty"],
      interaction_ids: ["interaction:retry"],
      keyboard_behavior: "Enter activates retry on the focused row",
    }],
    responsive_transformations: [{
      route_id: "route:queue",
      viewport_id: "viewport:compact",
      behavior: "Rows stack and the retry action moves below the summary",
    }],
    motion: {
      policy: "functional",
      reduced_motion_behavior: "The cross-fade becomes an instant swap",
      transitions: [{
        id: "transition:retry-press",
        interaction_id: "interaction:retry",
        duration_ms: 120,
        easing: "ease-out",
      }],
    },
    acceptance_criteria: [{
      id: "criterion:retry-keyboard",
      observable: "A failed job is retried using the keyboard alone",
      verification: "keyboard",
      required: true,
      inventory_ids: ["interaction:retry"],
    }],
  };
}

function beta2Contract(taste) {
  const contract = baseContract();
  contract.schema_id = BETA2_ID;
  if (taste !== undefined) contract.taste = taste;
  return contract;
}

// v1alpha1 predates the six beta-only root keys, so the alpha fixture is the beta one minus them.
const BETA_ONLY_ROOT_KEYS = [
  "lane", "tokens", "component_behaviors", "responsive_transformations", "motion",
  "acceptance_criteria",
];

function alphaContract() {
  const contract = baseContract();
  contract.schema_id = DESIGN_SCHEMA;
  for (const key of BETA_ONLY_ROOT_KEYS) delete contract[key];
  return contract;
}

function issueCodes(report) {
  return report.issues.map(({ code }) => code);
}

describe("design contract taste dials", () => {
  it("validates the v1beta1 baseline fixture, so later failures are about taste alone", () => {
    const report = designContractReport(baseContract());
    assert.deepEqual(report.issues, [], "baseline fixture must be free of issues");
    assert.equal(report.valid, true);
  });

  it("ships a v1beta2 schema whose taste dials are bounded 1 through 10", () => {
    const schema = JSON.parse(readFileSync(join(SCHEMAS, "design-contract-v1beta2.schema.json"), "utf8"));
    assert.equal(schema.$id, BETA2_ID);
    assert.equal(schema.properties.schema_id.const, BETA2_ID);
    assert.equal(schema.additionalProperties, false);
    assert.ok(!schema.required.includes("taste"), "taste must stay optional");
    assert.equal(
      schema.properties.taste.$ref,
      "#/$defs/taste",
      "taste follows the same $defs indirection as every other group in this file",
    );

    const taste = schema.$defs.taste;
    assert.equal(taste.type, "object");
    assert.equal(taste.additionalProperties, false);
    assert.deepEqual([...taste.required].sort(), ["density", "motion", "variance"]);
    for (const dial of ["variance", "motion", "density"]) {
      assert.equal(taste.properties[dial].type, "integer", `${dial} must be an integer`);
      assert.equal(taste.properties[dial].minimum, 1, `${dial} must floor at 1`);
      assert.equal(taste.properties[dial].maximum, 10, `${dial} must cap at 10`);
    }
  });

  it("accepts a v1beta2 contract that omits taste entirely", () => {
    const report = designContractReport(beta2Contract());
    assert.deepEqual(report.issues, []);
    assert.equal(report.valid, true);
  });

  it("accepts a v1beta2 contract carrying in-range dials", () => {
    const report = designContractReport(beta2Contract({ variance: 7, motion: 3, density: 10 }));
    assert.deepEqual(report.issues, []);
    assert.equal(report.valid, true);
  });

  it("rejects a dial above the cap without rejecting the rest of the contract", () => {
    const report = designContractReport(beta2Contract({ variance: 11, motion: 3, density: 5 }));
    assert.equal(report.valid, false);
    assert.deepEqual(issueCodes(report), ["DESIGN_CONTRACT_TASTE"]);
    assert.equal(report.issues[0].path, "taste.variance");
  });

  it("rejects a dial below the floor, a non-integer dial, and a missing dial", () => {
    for (const [taste, path] of [
      [{ variance: 0, motion: 3, density: 5 }, "taste.variance"],
      [{ variance: 5, motion: 2.5, density: 5 }, "taste.motion"],
      [{ variance: 5, motion: 3 }, "taste.density"],
    ]) {
      const report = designContractReport(beta2Contract(taste));
      assert.equal(report.valid, false, `${path} must be rejected`);
      assert.deepEqual(issueCodes(report), ["DESIGN_CONTRACT_TASTE"]);
      assert.equal(report.issues[0].path, path);
    }
  });

  it("rejects an unknown key inside taste", () => {
    const report = designContractReport(beta2Contract({ variance: 5, motion: 3, density: 5, mood: 2 }));
    assert.equal(report.valid, false);
    assert.deepEqual(issueCodes(report), ["DESIGN_CONTRACT_TASTE"]);
  });

  it("validates one fixture per shipped schema version and names each in the report", () => {
    for (const [contract, expected] of [
      [alphaContract(), DESIGN_SCHEMA],
      [baseContract(), DESIGN_SCHEMA_BETA],
      [beta2Contract({ variance: 4, motion: 4, density: 4 }), DESIGN_SCHEMA_BETA2],
    ]) {
      const report = designContractReport(contract);
      assert.deepEqual(report.issues, [], `${expected} fixture must be free of issues`);
      assert.equal(report.valid, true);
      assert.equal(report.schema, expected, "the report must name the version it validated against");
    }
  });

  it("marks only v1alpha1 as legacy and only the beta versions as evidence eligible", () => {
    assert.deepEqual(designContractReport(alphaContract()).diagnostics, ["LEGACY_SCHEMA_V1ALPHA1"]);
    assert.equal(designContractReport(alphaContract()).evidence_eligible, false);
    assert.deepEqual(designContractReport(baseContract()).diagnostics, []);
    assert.equal(designContractReport(baseContract()).evidence_eligible, true);
    assert.equal(designContractReport(beta2Contract()).evidence_eligible, true);
  });

  it("rejects an unknown schema_id with a typed issue instead of crashing", () => {
    const contract = alphaContract();
    contract.schema_id = "litfamily.design-contract/v9weird";
    let report;
    assert.doesNotThrow(() => { report = designContractReport(contract); });
    assert.equal(report.valid, false);
    assert.ok(issueCodes(report).includes("DESIGN_CONTRACT_SCHEMA_ID"));
    assert.equal(report.issues.find(({ code }) => code === "DESIGN_CONTRACT_SCHEMA_ID").path, "schema_id");
  });

  it("throws a typed contract error from the throwing wrapper rather than a bare crash", () => {
    const contract = alphaContract();
    contract.schema_id = "litfamily.design-contract/v9weird";
    assert.throws(
      () => validateDesignContractValue(contract),
      (error) => error instanceof UiuxContractError && error.code === "DESIGN_CONTRACT_SCHEMA_ID",
    );
    assert.doesNotThrow(() => validateDesignContractValue(beta2Contract({ variance: 1, motion: 1, density: 1 })));
  });

  it("keeps the taste reference agreeing with the shipped schema", () => {
    const schema = JSON.parse(readFileSync(join(SCHEMAS, "design-contract-v1beta2.schema.json"), "utf8"));
    const reference = readFileSync(join(SKILL_ROOT, "references/taste-direction.md"), "utf8");
    const { minimum, maximum } = schema.$defs.taste.properties.variance;

    for (const dial of schema.$defs.taste.required) {
      assert.match(reference, new RegExp(`\`${dial}\``, "u"), `the reference must name the ${dial} dial`);
    }
    assert.match(
      reference,
      new RegExp(`${minimum} through ${maximum}`, "u"),
      "the reference must state the same bounds the schema enforces",
    );
    assert.match(reference, /omitting the object/iu, "the reference must say taste is optional");
    assert.match(reference, /declaring all three/iu, "the reference must say a declared taste needs every dial");
    assert.match(reference, /motion\.policy/u, "the reference must relate the dial to the existing motion policy");
  });

  it("routes the taste reference from the skill body and stops calling v1beta1 authoritative", () => {
    const skill = readFileSync(join(SKILL_ROOT, "SKILL.md"), "utf8");
    assert.match(skill, /references\/taste-direction\.md/u, "the skill body must route the reference");
    assert.match(skill, /design-contract-v1beta2\.schema\.json/u, "the skill body must name the current shape");
    assert.doesNotMatch(
      skill,
      /authoritative shape is `schemas\/design-contract-v1beta1\.schema\.json`/u,
      "v1beta1 must no longer be described as the authoritative shape",
    );
  });

  it("refuses taste on the older schema versions, which never declared it", () => {
    const contract = baseContract();
    contract.taste = { variance: 5, motion: 3, density: 5 };
    const report = designContractReport(contract);
    assert.equal(report.valid, false, "v1beta1 must not silently accept a v1beta2-only key");
  });
});
