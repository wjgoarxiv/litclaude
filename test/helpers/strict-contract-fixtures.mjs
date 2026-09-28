import { createHash } from "node:crypto";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SHA_A = "a".repeat(64);

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const CONTRACT_INVENTORY = Object.freeze([
  ["route:dashboard", "route"],
  ["route:job-detail", "route"],
  ["region:queue", "region"],
  ["region:job-summary", "region"],
  ["component:retry-button", "component"],
  ["interaction:retry-failed-job", "interaction"],
  ["state:dashboard-error", "state"],
  ["state:dashboard-ready", "state"],
  ["viewport:compact", "viewport"],
  ["viewport:expanded", "viewport"],
]);

export function designContract(overrides = {}) {
  return {
    schema_id: "litfamily.design-contract/v1alpha1",
    contract_id: "contract:operations-dashboard",
    source_hash: SHA_A,
    intent: {
      audiences: ["Operators who recover failed work"],
      tasks: ["Find a failed job and retry it without leaving the keyboard"],
      qualities: ["Recoverable", "Legible under density"],
      constraints: ["Reuse repository-native primitives and reversible test data"],
      non_goals: ["Brand redesign"],
    },
    direction: {
      name: "Calm operations surface",
      principles: [
        "State is legible before it is decorated.",
        "Every failure names the action that recovers it.",
        "Density never removes keyboard access.",
      ],
      token_strategy: "reuse",
      voice: "Direct and operational",
    },
    inventory: {
      routes: [
        { id: "route:dashboard", path: "/dashboard", primary: true, auth_required: false },
        { id: "route:job-detail", path: "/jobs/:id", primary: false, auth_required: true },
      ],
      regions: [
        { id: "region:queue", route_id: "route:dashboard", purpose: "Failed work queue" },
        { id: "region:job-summary", route_id: "route:job-detail", purpose: "Single job summary" },
      ],
      components: [
        { id: "component:retry-button", region_id: "region:queue", role: "button" },
      ],
      interactions: [
        {
          id: "interaction:retry-failed-job",
          route_id: "route:dashboard",
          critical: true,
          input_modes: ["keyboard", "pointer"],
        },
      ],
      states: [
        { id: "state:dashboard-error", route_id: "route:dashboard", kind: "error" },
        { id: "state:dashboard-ready", route_id: "route:dashboard", kind: "ready" },
      ],
      viewports: [
        { id: "viewport:compact", category: "compact", width_px: 320, height_px: 640 },
        { id: "viewport:expanded", category: "expanded", width_px: 1440, height_px: 900 },
      ],
      references: [
        {
          id: "reference:request",
          kind: "user-provided",
          sha256: SHA_A,
          provenance: "user request transcript",
        },
      ],
      authenticated_surfaces: [
        { route_id: "route:job-detail", safe_test_account: true },
      ],
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
    performance: {
      lcp_ms: 2500,
      cls: 0.05,
      inp_ms: 200,
      initial_js_kb: 180,
      initial_css_kb: 40,
    },
    evidence_policy: {
      independent_review_required: true,
      required_channels: ["tests", "keyboard", "accessibility-tree"],
      cleanup_required: true,
    },
    omissions: [],
    accepted_exceptions: [],
    ...overrides,
  };
}

function immutableInputs(contractHash, sourceHash, captureHash, artifactsHash) {
  return {
    design_contract_hash: contractHash,
    source_hash: sourceHash,
    capture_hash: captureHash,
    artifacts_hash: artifactsHash,
  };
}

export function reviewReceipt(reviewer, context, inputs, overrides = {}) {
  return {
    schema_id: "litfamily.review-receipt/v1alpha1",
    review_id: `review:${reviewer}`,
    fresh_context_id: context,
    reviewer_capability: reviewer,
    input_hashes: inputs,
    reviewed_inventory: CONTRACT_INVENTORY.map(([id]) => id),
    confidence: "HIGH",
    findings: [],
    independence_assertion: true,
    peer_draft_received: false,
    implementer_context: false,
    started_at: "2026-07-24T11:40:00.000Z",
    ended_at: "2026-07-24T11:45:00.000Z",
    timeout: false,
    cancelled: false,
    verdict: "PASS",
    ...overrides,
  };
}

export function writeEvidenceFixture(dir, overrides = {}) {
  const contractPath = join(dir, "design-contract.json");
  const sourcePath = join(dir, "source.bin");
  const capturePath = join(dir, "capture.txt");
  const contractBytes = `${JSON.stringify(designContract())}\n`;
  const sourceBytes = "immutable source\n";
  const captureBytes = "┌──┐\n│한│\n└──┘\n";
  writeFileSync(contractPath, contractBytes);
  writeFileSync(sourcePath, sourceBytes);
  writeFileSync(capturePath, captureBytes);
  const contractHash = sha256(contractBytes);
  const sourceHash = sha256(sourceBytes);
  const captureHash = sha256(captureBytes);
  const artifacts = [
    {
      id: "artifact:source",
      kind: "source",
      path: "source.bin",
      sha256: sourceHash,
      created_at: "2026-07-24T11:50:00.000Z",
    },
    {
      id: "artifact:capture",
      kind: "capture",
      path: "capture.txt",
      sha256: captureHash,
      created_at: "2026-07-24T11:50:00.000Z",
    },
  ];
  const artifactsHash = sha256(stableJson(
    artifacts.map(({ id, sha256: hash }) => ({ id, sha256: hash })),
  ));
  const inputs = immutableInputs(contractHash, sourceHash, captureHash, artifactsHash);
  const receipts = [
    reviewReceipt("quality-reviewer", "context:quality", inputs),
    reviewReceipt("lit-verifier", "context:oracle", inputs),
  ];
  const manifest = {
    schema_id: "litfamily.evidence-manifest/v1alpha1",
    tier: "full",
    design_contract_path: "design-contract.json",
    design_contract_hash: contractHash,
    source_revision: "revision:under-test",
    source_hash: sourceHash,
    capture_id: "artifact:capture",
    capture_hash: captureHash,
    created_at: "2026-07-24T11:50:00.000Z",
    maximum_age: 3600,
    capture_environment: {
      backend: "fixture",
      renderer: "terminal-text",
      platform: "test",
      browser_version: "none",
      runtime_version: process.version,
      font_set: ["sans-serif", "monospace"],
      locale: "ko-KR",
      reduced_motion: true,
      settling_policy: "No pending work; deterministic fixture bytes.",
      color_scheme: "light",
      process_owner: "quality",
      viewport: { width: 320, height: 640, scale_factor: 1 },
    },
    auth_owner: "quality",
    capabilities: {
      capture: true,
      auth: true,
      test_account_safe: true,
      independent_review: true,
      image: true,
      terminal: true,
    },
    // Evidence accounts for every Design Contract inventory entry except references, whose
    // identity the contract already binds by hash. Order matches reviewed_inventory.
    inventory: CONTRACT_INVENTORY.map(([id, kind]) => ({
      id,
      kind,
      status: "captured",
      evidence_ids: ["artifact:capture"],
    })),
    artifacts,
    mechanical_results: [{
      id: "result:tui",
      kind: "tui-check",
      status: "PASS",
      artifact_ids: ["artifact:capture"],
      metrics: {
        topology_valid: true,
        control_sequences_valid: true,
        unicode_width_valid: true,
      },
    }],
    accessibility_results: [{
      id: "accessibility:contrast",
      criterion: "1.4.3",
      status: "PASS",
      evidence_ids: ["artifact:capture"],
    }],
    open_findings: [],
    exception_references: [],
    review_receipts: receipts,
    review_receipt_hashes: receipts.map((receipt) => sha256(stableJson(receipt))),
    cleanup: {
      status: "complete",
      resources: [{ id: "resource:test-server", state: "cleaned", receipt: "not-started" }],
    },
    verdict: "PASS",
    ...overrides,
  };
  const manifestPath = join(dir, "evidence.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const materialTime = new Date("2026-07-24T11:50:00.000Z");
  for (const path of [contractPath, sourcePath, capturePath, manifestPath]) {
    utimesSync(path, materialTime, materialTime);
  }
  return { manifest, manifestPath, contractPath, sourcePath, capturePath, inputs };
}
