import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { designContract } from "./strict-contract-fixtures.mjs";
import {
  assertCollectionConstraintCorpus,
  readSchemaRuntimeParity,
} from "./schema-runtime-parity.mjs";
import { rootPath, runQuery } from "./uiux-visual-runtime.mjs";

const skillRoot = join(rootPath, "plugins/litclaude/skills/frontend-ui-ux");
const schemaPath = join(skillRoot, "schemas/design-contract-v1alpha1.schema.json");
const validator = join(skillRoot, "scripts/validate-design-contract.mjs");

const ROOT_KEYS = [
  "schema_id", "contract_id", "source_hash", "intent", "direction", "inventory",
  "accessibility", "localization", "performance", "evidence_policy", "omissions",
  "accepted_exceptions",
];

function runContract(path) {
  return spawnSync(process.execPath, [validator, path], {
    cwd: rootPath,
    encoding: "utf8",
    timeout: 5000,
  });
}

function writeContract(dir, name, value) {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

// Exit 1: the bytes parsed, so the caller still receives the machine-readable envelope with
// every defect listed.
function expectInvalid(dir, name, value, code) {
  const result = runContract(writeContract(dir, name, value));
  assert.equal(result.status, 1, `${name} must report a parsed-but-invalid contract: ${result.stderr}`);
  assert.equal(result.stderr, "", `${name} must keep stderr empty on exit 1`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, false, name);
  assert.equal(report.schema, "litfamily.design-contract/v1alpha1");
  assert.ok(report.issues.length > 0, `${name} must populate issues`);
  assert.ok(
    report.issues.some((issue) => issue.code === code),
    `${name} expected ${code} in ${JSON.stringify(report.issues.map((issue) => issue.code))}`,
  );
  return report;
}

// Exit 2: nothing about the input can be trusted, so nothing goes to stdout.
function expectUntrusted(path, code, label) {
  const result = runContract(path);
  assert.equal(result.status, 2, `${label} must fail closed as untrusted input`);
  assert.equal(result.stdout, "", `${label} must not emit a machine-readable envelope`);
  assert.match(result.stderr, new RegExp(code, "u"), label);
}

export async function strictDesignContract(t) {
  const schemaText = readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(schemaText);
  const parity = readSchemaRuntimeParity(rootPath);
  const {
    canonicalDesignContract,
    collectDesignContractIssues,
  } = await import(new URL("../../plugins/litclaude/skills/frontend-ui-ux/scripts/design-contract-rules.mjs", import.meta.url));

  await t.test("schema declares exactly the twelve closed root keys", () => {
    assert.equal(schema.$id, "litfamily.design-contract/v1alpha1");
    assert.equal(schema.properties.schema_id.const, "litfamily.design-contract/v1alpha1");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ROOT_KEYS);
    assert.deepEqual(Object.keys(schema.properties), ROOT_KEYS);
    assertCollectionConstraintCorpus(schema, parity.collection_constraints.design);
  });

  // This is the dataset-free assertion. The contract binds one source hash and one hash per
  // declared reference; it carries no corpus identity, record count, or retrieval obligation.
  await t.test("neither the schema nor the runtime carries a dataset obligation", () => {
    const banned = /dataset|record_count|design[-_]intelligence|corpus|selected_record/iu;
    assert.doesNotMatch(schemaText, banned, "the schema must not name a dataset");
    for (const name of [
      "design-contract-rules.mjs",
      "design-contract-surface-rules.mjs",
      "design-contract-inventory-rules.mjs",
      "design-contract-format.mjs",
      "validate-design-contract.mjs",
    ]) {
      assert.doesNotMatch(
        readFileSync(join(skillRoot, "scripts", name), "utf8"),
        banned,
        `${name} must not bind a dataset`,
      );
    }
    assert.equal(schema.properties.source_hash.$ref, "#/$defs/hash");
    assert.equal(schema.$defs.hash.pattern, "^[0-9a-f]{64}$");
    assert.ok(schema.$defs.reference.required.includes("sha256"));
  });

  await t.test("every closed enum keeps its exact members", () => {
    assert.deepEqual(schema.$defs.state.properties.kind.enum, [
      "loading", "empty", "error", "success", "disabled", "permission", "offline", "ready",
    ]);
    assert.deepEqual(schema.$defs.interaction.properties.input_modes.items.enum, [
      "keyboard", "pointer", "touch", "voice", "switch",
    ]);
    assert.deepEqual(schema.$defs.viewport.properties.category.enum, [
      "compact", "medium", "expanded",
    ]);
    assert.deepEqual(schema.$defs.reference.properties.kind.enum, [
      "user-provided", "repo-local", "generated", "measured",
    ]);
    assert.deepEqual(schema.properties.direction.properties.token_strategy.enum, [
      "reuse", "extend", "create",
    ]);
    assert.deepEqual(schema.properties.evidence_policy.properties.required_channels.items.enum, [
      "tests", "browser", "keyboard", "accessibility-tree", "screen-reader", "performance",
      "localization",
    ]);
  });

  await t.test("accessibility target is one literal string, not a pattern or an enum", () => {
    const target = schema.properties.accessibility.properties.target;
    assert.deepEqual(Object.keys(target), ["const"]);
    assert.equal(target.const, "WCAG 2.2 AA");
    for (const value of ["WCAG 2.2 AAA", "wcag 2.2 aa", "WCAG 2.1 AA", "WCAG 2.2 AA "]) {
      const contract = designContract();
      contract.accessibility.target = value;
      assert.ok(
        collectDesignContractIssues(contract).some(
          (issue) => issue.code === "DESIGN_CONTRACT_ACCESSIBILITY",
        ),
        `${value} must not satisfy the conformance target`,
      );
    }
  });

  await t.test("canonical form sorts keys, preserves array order, and ends with a newline", () => {
    const canonical = canonicalDesignContract({
      b: 1,
      a: [3, 1, 2],
      c: { z: true, y: null },
    });
    assert.equal(canonical, '{"a":[3,1,2],"b":1,"c":{"y":null,"z":true}}\n');
    assert.equal(canonical.endsWith("\n"), true, "every hash in the system depends on this newline");
    assert.equal(canonicalDesignContract(designContract()).at(-1), "\n");
  });

  const dir = mkdtempSync(join(tmpdir(), "litclaude-strict-contract-"));
  try {
    await t.test("accepts one complete finite contract on a single stdout line", () => {
      const result = runContract(writeContract(dir, "valid", designContract()));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.split("\n").filter((line) => line !== "").length, 1);
      assert.deepEqual(JSON.parse(result.stdout), {
        valid: true,
        schema: "litfamily.design-contract/v1alpha1",
        issues: [],
        diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
        evidence_eligible: false,
      });
    });

    await t.test("rejects missing, unknown, and retired root keys", () => {
      for (const key of ROOT_KEYS) {
        const contract = designContract();
        delete contract[key];
        expectInvalid(dir, `missing-${key}`, contract, "DESIGN_CONTRACT_ROOT_KEYS");
      }
      expectInvalid(
        dir,
        "retired-dataset-group",
        designContract({
          dataset: { schema_version: "x", sha256: "a".repeat(64), record_count: 1 },
        }),
        "DESIGN_CONTRACT_ROOT_KEYS",
      );
      expectInvalid(
        dir,
        "unknown-nested-key",
        designContract({ intent: { ...designContract().intent, extra: true } }),
        "DESIGN_CONTRACT_INTENT",
      );
    });

    await t.test("rejects an untyped identifier, a wrong prefix, and a broken grammar", () => {
      expectInvalid(
        dir,
        "contract-id-prefix",
        designContract({ contract_id: "work:operations-dashboard" }),
        "DESIGN_CONTRACT_ID_PREFIX",
      );
      const wrongPrefix = designContract();
      wrongPrefix.inventory.viewports[0].id = "screen:compact";
      expectInvalid(dir, "viewport-prefix", wrongPrefix, "DESIGN_CONTRACT_ID_PREFIX");
      for (const [name, id] of [
        ["uppercase", "route:Dashboard"],
        ["leading-dash", "route:-dashboard"],
        ["no-namespace", "dashboard"],
        ["empty-tail", "route:"],
      ]) {
        const contract = designContract();
        contract.inventory.routes[0].id = id;
        expectInvalid(dir, `route-id-${name}`, contract, "DESIGN_CONTRACT_ID_GRAMMAR");
      }
    });

    await t.test("rejects an uppercase or short hash anywhere it appears", () => {
      expectInvalid(
        dir,
        "source-hash-uppercase",
        designContract({ source_hash: "A".repeat(64) }),
        "DESIGN_CONTRACT_HASH_GRAMMAR",
      );
      const shortHash = designContract();
      shortHash.inventory.references[0].sha256 = "abc";
      expectInvalid(dir, "reference-hash-short", shortHash, "DESIGN_CONTRACT_HASH_GRAMMAR");
      const uppercaseReference = designContract();
      uppercaseReference.inventory.references[0].sha256 = "A".repeat(64);
      expectInvalid(dir, "reference-hash-uppercase", uppercaseReference, "DESIGN_CONTRACT_HASH_GRAMMAR");
    });

    await t.test("enforces every inventory cardinality gate", () => {
      for (const [group, name] of [
        ["routes", "routes"],
        ["regions", "regions"],
        ["components", "components"],
        ["interactions", "interactions"],
      ]) {
        const contract = designContract();
        contract.inventory[group] = [];
        expectInvalid(dir, `empty-${name}`, contract, "DESIGN_CONTRACT_INVENTORY_CARDINALITY");
      }
      const secondary = designContract();
      for (const route of secondary.inventory.routes) route.primary = false;
      expectInvalid(dir, "no-primary-route", secondary, "DESIGN_CONTRACT_INVENTORY_CARDINALITY");
      const uncritical = designContract();
      for (const interaction of uncritical.inventory.interactions) interaction.critical = false;
      expectInvalid(dir, "no-critical-interaction", uncritical, "DESIGN_CONTRACT_INVENTORY_CARDINALITY");
      for (const group of ["states", "viewports", "references"]) {
        const contract = designContract();
        contract.inventory[group] = {};
        expectInvalid(dir, `non-array-${group}`, contract, "DESIGN_CONTRACT_INVENTORY_SHAPE");
      }
    });

    await t.test("resolves every cross-entry reference or fails closed", () => {
      for (const [name, mutate] of [
        ["region-route", (value) => {
          value.inventory.regions[0].route_id = "route:absent";
        }],
        ["interaction-route", (value) => {
          value.inventory.interactions[0].route_id = "route:absent";
        }],
        ["state-route", (value) => {
          value.inventory.states[0].route_id = "route:absent";
        }],
        ["component-region", (value) => {
          value.inventory.components[0].region_id = "region:absent";
        }],
        ["surface-route", (value) => {
          value.inventory.authenticated_surfaces[0].route_id = "route:absent";
        }],
      ]) {
        const contract = designContract();
        mutate(contract);
        expectInvalid(dir, `dangling-${name}`, contract, "DESIGN_CONTRACT_DANGLING_REFERENCE");
      }
    });

    await t.test("couples authenticated routes and safe test accounts in both directions", () => {
      const unprotected = designContract();
      unprotected.inventory.authenticated_surfaces = [];
      expectInvalid(dir, "auth-route-without-surface", unprotected, "DESIGN_CONTRACT_AUTH_COUPLING");

      const publicSurface = designContract();
      publicSurface.inventory.authenticated_surfaces.push({
        route_id: "route:dashboard",
        safe_test_account: true,
      });
      expectInvalid(dir, "public-route-with-surface", publicSurface, "DESIGN_CONTRACT_AUTH_COUPLING");

      for (const unsafe of [false, "true", 1, null]) {
        const contract = designContract();
        contract.inventory.authenticated_surfaces[0].safe_test_account = unsafe;
        expectInvalid(
          dir,
          `unsafe-account-${JSON.stringify(unsafe)}`,
          contract,
          "DESIGN_CONTRACT_AUTH_COUPLING",
        );
      }

      const repeated = designContract();
      repeated.inventory.authenticated_surfaces.push({
        route_id: "route:job-detail",
        safe_test_account: true,
      });
      expectInvalid(dir, "repeated-surface", repeated, "DESIGN_CONTRACT_AUTH_COUPLING");
    });

    await t.test("rejects an identifier declared twice anywhere in the document", () => {
      const duplicateRoute = designContract();
      duplicateRoute.inventory.routes[1].id = duplicateRoute.inventory.routes[0].id;
      expectInvalid(dir, "duplicate-route-id", duplicateRoute, "DESIGN_CONTRACT_ID_COLLISION");

      const shadowedContractId = designContract({
        omissions: [{
          id: "contract:operations-dashboard",
          reason: "The omission reuses the contract identifier.",
          owner: "quality",
        }],
      });
      expectInvalid(dir, "shadowed-contract-id", shadowedContractId, "DESIGN_CONTRACT_ID_COLLISION");
    });

    await t.test("rejects any value outside a closed enum", () => {
      const state = designContract();
      state.inventory.states[0].kind = "pending";
      expectInvalid(dir, "state-kind", state, "DESIGN_CONTRACT_INVENTORY_SHAPE");
      const mode = designContract();
      mode.inventory.interactions[0].input_modes = ["gesture"];
      expectInvalid(dir, "input-mode", mode, "DESIGN_CONTRACT_INVENTORY_SHAPE");
      const duplicateMode = designContract();
      duplicateMode.inventory.interactions[0].input_modes = ["keyboard", "keyboard"];
      expectInvalid(dir, "input-mode-duplicate", duplicateMode, "DESIGN_CONTRACT_INVENTORY_SHAPE");
      const category = designContract();
      category.inventory.viewports[0].category = "wide";
      expectInvalid(dir, "viewport-category", category, "DESIGN_CONTRACT_INVENTORY_SHAPE");
      const referenceKind = designContract();
      referenceKind.inventory.references[0].kind = "screenshot";
      expectInvalid(dir, "reference-kind", referenceKind, "DESIGN_CONTRACT_INVENTORY_SHAPE");
      expectInvalid(
        dir,
        "token-strategy",
        designContract({ direction: { ...designContract().direction, token_strategy: "invent" } }),
        "DESIGN_CONTRACT_DIRECTION",
      );
      expectInvalid(
        dir,
        "evidence-channel",
        designContract({
          evidence_policy: {
            independent_review_required: true,
            required_channels: ["vibes"],
            cleanup_required: true,
          },
        }),
        "DESIGN_CONTRACT_EVIDENCE_POLICY",
      );
    });

    await t.test("accepts every declared state kind including ready", () => {
      for (const kind of [
        "loading", "empty", "error", "success", "disabled", "permission", "offline", "ready",
      ]) {
        const contract = designContract();
        contract.inventory.states = [{ id: "state:only", route_id: "route:dashboard", kind }];
        const result = runContract(writeContract(dir, `state-kind-${kind}`, contract));
        assert.equal(result.status, 0, `${kind} must be a declared state kind: ${result.stderr}`);
      }
    });

    await t.test("requires strict booleans rather than truthy values", () => {
      for (const [path, code, mutate] of [
        ["accessibility.keyboard", "DESIGN_CONTRACT_ACCESSIBILITY", (value) => {
          value.accessibility.keyboard = "yes";
        }],
        ["localization.ime_review", "DESIGN_CONTRACT_LOCALIZATION", (value) => {
          value.localization.ime_review = 1;
        }],
        ["evidence_policy.cleanup_required", "DESIGN_CONTRACT_EVIDENCE_POLICY", (value) => {
          value.evidence_policy.cleanup_required = "true";
        }],
        ["inventory.routes[0].primary", "DESIGN_CONTRACT_INVENTORY_SHAPE", (value) => {
          value.inventory.routes[0].primary = 1;
        }],
      ]) {
        const contract = designContract();
        mutate(contract);
        const report = expectInvalid(
          dir,
          `truthy-${path.replaceAll(/[^a-z]+/gu, "-")}`,
          contract,
          code,
        );
        assert.ok(report.issues.some((issue) => issue.path === path), path);
      }
    });

    await t.test("bounds every numeric budget on both sides", () => {
      for (const [name, mutate, code] of [
        ["zoom-low", (value) => {
          value.accessibility.zoom_percent = 199;
        }, "DESIGN_CONTRACT_ACCESSIBILITY"],
        ["zoom-high", (value) => {
          value.accessibility.zoom_percent = 401;
        }, "DESIGN_CONTRACT_ACCESSIBILITY"],
        ["zoom-fractional", (value) => {
          value.accessibility.zoom_percent = 200.5;
        }, "DESIGN_CONTRACT_ACCESSIBILITY"],
        ["expansion-high", (value) => {
          value.localization.text_expansion_percent = 301;
        }, "DESIGN_CONTRACT_LOCALIZATION"],
        ["lcp-zero", (value) => {
          value.performance.lcp_ms = 0;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["lcp-high", (value) => {
          value.performance.lcp_ms = 60001;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["inp-high", (value) => {
          value.performance.inp_ms = 60001;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["cls-high", (value) => {
          value.performance.cls = 1.01;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["cls-negative", (value) => {
          value.performance.cls = -0.01;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["js-high", (value) => {
          value.performance.initial_js_kb = 1048577;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["css-negative", (value) => {
          value.performance.initial_css_kb = -1;
        }, "DESIGN_CONTRACT_PERFORMANCE"],
        ["viewport-width", (value) => {
          value.inventory.viewports[0].width_px = 7681;
        }, "DESIGN_CONTRACT_INVENTORY_SHAPE"],
        ["viewport-height", (value) => {
          value.inventory.viewports[0].height_px = 239;
        }, "DESIGN_CONTRACT_INVENTORY_SHAPE"],
      ]) {
        const contract = designContract();
        mutate(contract);
        expectInvalid(dir, `bounds-${name}`, contract, code);
      }
    });

    await t.test("keeps direction principles between three and seven unique entries", () => {
      const few = designContract();
      few.direction.principles = few.direction.principles.slice(0, 2);
      expectInvalid(dir, "principles-few", few, "DESIGN_CONTRACT_DIRECTION");
      const many = designContract();
      many.direction.principles = Array.from(
        { length: 8 },
        (_, index) => `Principle ${index} stays operational.`,
      );
      expectInvalid(dir, "principles-many", many, "DESIGN_CONTRACT_DIRECTION");
      const repeated = designContract();
      repeated.direction.principles = [
        repeated.direction.principles[0],
        repeated.direction.principles[0],
        repeated.direction.principles[1],
      ];
      expectInvalid(dir, "principles-repeated", repeated, "DESIGN_CONTRACT_DIRECTION");
      const seven = designContract();
      seven.direction.principles = Array.from(
        { length: 7 },
        (_, index) => `Principle ${index} stays operational.`,
      );
      assert.equal(runContract(writeContract(dir, "principles-seven", seven)).status, 0);
    });

    await t.test("requires at least one audience, task, and quality", () => {
      for (const field of ["audiences", "tasks", "qualities"]) {
        const contract = designContract();
        contract.intent[field] = [];
        expectInvalid(dir, `empty-${field}`, contract, "DESIGN_CONTRACT_INTENT");
        const blank = designContract();
        blank.intent[field] = [" "];
        expectInvalid(dir, `blank-${field}`, blank, "DESIGN_CONTRACT_INTENT");
        const repeated = designContract();
        repeated.intent[field] = ["Same entry", "Same entry"];
        expectInvalid(dir, `repeated-${field}`, repeated, "DESIGN_CONTRACT_INTENT");
      }
    });

    await t.test("accepts only strict UTC instants on scope records", () => {
      for (const [name, expiresAt] of [
        ["offset", "2026-08-01T00:00:00+09:00"],
        ["no-millis", "2026-08-01T00:00:00Z"],
        ["microseconds", "2026-08-01T00:00:00.000000Z"],
        ["lowercase-z", "2026-08-01T00:00:00.000z"],
        ["local", "2026-08-01 00:00:00.000"],
        ["impossible-day", "2026-02-30T00:00:00.000Z"],
      ]) {
        expectInvalid(dir, `timestamp-${name}`, designContract({
          omissions: [{
            id: "omission:screen-reader-pass",
            reason: "The screen-reader pass waits for the shared test account.",
            owner: "quality",
            expires_at: expiresAt,
          }],
        }), "DESIGN_CONTRACT_TIMESTAMP");
      }
      const dated = designContract({
        omissions: [{
          id: "omission:screen-reader-pass",
          reason: "The screen-reader pass waits for the shared test account.",
          owner: "quality",
          expires_at: "2026-08-01T00:00:00.000Z",
        }],
        accepted_exceptions: [{
          id: "exception:reduced-motion",
          reason: "The vendor animation cannot honour reduced motion until the next release.",
          owner: "design",
        }],
      });
      assert.equal(runContract(writeContract(dir, "scope-records", dated)).status, 0);
    });

    await t.test("requires an owner and a reason on every scope record", () => {
      expectInvalid(dir, "omission-owner", designContract({
        omissions: [{ id: "omission:auth", reason: "Not yet reviewed.", owner: "" }],
      }), "DESIGN_CONTRACT_SCOPE_RECORD");
      expectInvalid(dir, "exception-reason", designContract({
        accepted_exceptions: [{ id: "exception:contrast", reason: "", owner: "design" }],
      }), "DESIGN_CONTRACT_SCOPE_RECORD");
      expectInvalid(dir, "omission-id", designContract({
        omissions: [{ id: "Omission", reason: "Not yet reviewed.", owner: "quality" }],
      }), "DESIGN_CONTRACT_ID_GRAMMAR");
    });

    await t.test("reports every defect from one run instead of stopping at the first", () => {
      const contract = designContract({ source_hash: "A".repeat(64) });
      contract.accessibility.zoom_percent = 100;
      contract.performance.cls = 2;
      const report = expectInvalid(dir, "many-defects", contract, "DESIGN_CONTRACT_HASH_GRAMMAR");
      assert.ok(report.issues.length >= 3, JSON.stringify(report.issues));
      for (const code of [
        "DESIGN_CONTRACT_ACCESSIBILITY",
        "DESIGN_CONTRACT_PERFORMANCE",
      ]) assert.ok(report.issues.some((issue) => issue.code === code), code);
    });

    await t.test("rejects duplicate object keys before the parser can silently keep the last", () => {
      const serialized = JSON.stringify(designContract());
      const duplicatePath = join(dir, "duplicate-key.json");
      writeFileSync(duplicatePath, serialized.replace(
        '"zoom_percent":200',
        '"zoom_percent":200,"zoom_percent":100',
      ));
      // The runtime parser would keep 100 and report nothing, so the raw scan has to catch it.
      assert.equal(JSON.parse(readFileSync(duplicatePath, "utf8")).accessibility.zoom_percent, 100);
      expectUntrusted(duplicatePath, "DESIGN_CONTRACT_DUPLICATE_JSON_KEY", "duplicate key");

      const nestedPath = join(dir, "duplicate-nested-key.json");
      writeFileSync(nestedPath, serialized.replace(
        '"id":"route:dashboard"',
        '"id":"route:dashboard","id":"route:dashboard"',
      ));
      expectUntrusted(nestedPath, "DESIGN_CONTRACT_DUPLICATE_JSON_KEY", "duplicate nested key");

      const escapedPath = join(dir, "duplicate-escaped-key.json");
      writeFileSync(escapedPath, serialized.replace(
        '"schema_id"',
        '"\\u0073chema_id":"litfamily.design-contract/v1alpha1","schema_id"',
      ));
      expectUntrusted(escapedPath, "DESIGN_CONTRACT_DUPLICATE_JSON_KEY", "escaped duplicate key");

      // Sibling objects legitimately repeat a key, so the scan keeps one key set per object.
      assert.equal(runContract(writeContract(dir, "sibling-keys", designContract())).status, 0);
    });

    await t.test("fails closed on bytes it cannot trust", () => {
      const utf8Path = join(dir, "invalid-utf8.json");
      writeFileSync(utf8Path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
      expectUntrusted(utf8Path, "DESIGN_CONTRACT_NOT_UTF8", "invalid UTF-8");

      const nulPath = join(dir, "nul.json");
      writeFileSync(nulPath, Buffer.from('{"a":"b"}\0', "utf8"));
      expectUntrusted(nulPath, "DESIGN_CONTRACT_NOT_UTF8", "NUL byte");

      const controlPath = join(dir, "control-character.json");
      writeFileSync(controlPath, Buffer.from([
        0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0x07, 0x22, 0x7d,
      ]));
      expectUntrusted(controlPath, "DESIGN_CONTRACT_UNTRUSTED_JSON", "raw control character");

      const trailingPath = join(dir, "trailing-data.json");
      writeFileSync(trailingPath, `${JSON.stringify(designContract())}\n{"extra":true}\n`);
      expectUntrusted(trailingPath, "DESIGN_CONTRACT_UNTRUSTED_JSON", "trailing data");

      const oversizePath = join(dir, "oversize.json");
      writeFileSync(oversizePath, `{"padding":"${"p".repeat(1024 * 1024 + 1)}"}\n`);
      expectUntrusted(oversizePath, "DESIGN_CONTRACT_OVERSIZE", "oversize input");

      const directoryPath = join(dir, "not-a-file");
      mkdirSync(directoryPath, { recursive: true });
      expectUntrusted(directoryPath, "DESIGN_CONTRACT_UNREADABLE", "directory input");
      expectUntrusted(join(dir, "absent.json"), "DESIGN_CONTRACT_UNREADABLE", "missing input");

      const arrayPath = writeContract(dir, "array-root", []);
      const arrayResult = runContract(arrayPath);
      assert.equal(arrayResult.status, 1, "a parseable non-object still yields the envelope");
      assert.equal(JSON.parse(arrayResult.stdout).issues[0].code, "DESIGN_CONTRACT_NOT_OBJECT");

      const usage = spawnSync(process.execPath, [validator], {
        cwd: rootPath,
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(usage.status, 2);
      assert.equal(usage.stdout, "");
      assert.match(usage.stderr, /INVALID_ARGUMENT/u);
    });

    await t.test("keeps schema and runtime group shapes exact", () => {
      for (const group of parity.group_shapes) {
        const definition = schema.properties[group.property];
        assert.equal(definition.additionalProperties, false, group.property);
        assert.deepEqual(definition.required, group.required, group.property);
        assert.deepEqual(Object.keys(definition.properties), group.required, group.property);
        const contract = designContract();
        contract[group.property].unexpected = true;
        expectInvalid(dir, `parity-${group.property}`, contract, group.runtime_code);
      }
    });

    await t.test("keeps schema and runtime inventory shapes exact", () => {
      for (const [group, definitionName, required] of parity.inventory_shapes) {
        const definition = schema.$defs[definitionName];
        assert.equal(
          schema.properties.inventory.properties[group].items.$ref,
          `#/$defs/${definitionName}`,
          group,
        );
        assert.equal(definition.additionalProperties, false, definitionName);
        assert.deepEqual(definition.required, required, definitionName);
        assert.deepEqual(Object.keys(definition.properties), required, definitionName);
        const contract = designContract();
        contract.inventory[group][0].unexpected = true;
        expectInvalid(
          dir,
          `parity-inventory-${definitionName}`,
          contract,
          "DESIGN_CONTRACT_INVENTORY_SHAPE",
        );
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function strictQueryArguments(t) {
  await t.test("rejects whitespace-only queries", () => {
    const result = runQuery([
      "--query", " \t\n ",
      "--domain", "ux-guidelines",
      "--limit", "1",
      "--json",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /QUERY_EMPTY/u);
  });
  await t.test("rejects fractional and whitespace-padded limits", () => {
    for (const limit of ["1.5", " 2 "]) {
      const result = runQuery([
        "--query", "dashboard",
        "--domain", "ux-guidelines",
        "--limit", limit,
        "--json",
      ]);
      assert.notEqual(result.status, 0, `limit ${JSON.stringify(limit)} must fail`);
      assert.match(result.stderr, /INVALID_ARGUMENT.*--limit/iu);
    }
  });
}
