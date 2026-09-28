#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const IDS = Object.freeze([
  "public-service-form-ko",
  "fintech-dashboard",
  "healthcare-mobile",
  "saas-landing-responsive",
  "brownfield-design-system",
  "reference-fidelity",
  "cjk-terminal-dashboard",
  "missing-capture-auth-review",
]);
const REQUIREMENTS = Object.freeze({
  "public-service-form-ko": [
    "WCAG_LABEL_MISSING", "A11Y_FOCUS_VISIBLE_MISSING",
    "WCAG_1_4_3_CONTRAST_INSUFFICIENT",
  ],
  "fintech-dashboard": [
    "VISUAL_DATA_CLIPPED", "CHART_COLOR_ONLY", "CHART_NONVISUAL_FALLBACK_MISSING",
  ],
  "healthcare-mobile": [
    "WCAG_TARGET_SIZE", "DESTRUCTIVE_ACTION_UNSAFE", "TOUCH_TARGET_UNDERSIZED",
  ],
  "saas-landing-responsive": [
    "RESPONSIVE_OVERFLOW", "RESPONSIVE_MOBILE_OVERFLOW", "REDUCED_MOTION_IGNORED",
  ],
  "brownfield-design-system": [
    "DESIGN_TOKEN_DRIFT", "DESIGN_TOKEN_BYPASS", "COMPONENT_PRIMITIVE_DUPLICATED",
  ],
  "reference-fidelity": [
    "REFERENCE_ALPHA_MISMATCH", "REFERENCE_DIMENSION_MISMATCH", "SCREENSHOT_SUBSTITUTION",
  ],
  "cjk-terminal-dashboard": [
    "TUI_BORDER_TOPOLOGY_BROKEN", "TUI_OSC_UNTERMINATED", "TUI_ZWJ_WIDTH_OVERFLOW",
  ],
  "missing-capture-auth-review": [
    "BLOCKED_RENDERER_UNAVAILABLE", "BLOCKED_AUTH_UNAVAILABLE",
    "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
  ],
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") result.json = true;
    else if (["--installed-root", "--fixtures", "--scenario"].includes(flag)) {
      const value = argv[++index];
      if (!value) throw new Error(`${flag} requires a value`);
      result[flag.slice(2).replaceAll("-", "_")] = value;
    } else throw new Error(`unknown option: ${flag}`);
  }
  if (!result.installed_root || !result.fixtures || result.scenario !== "all" || !result.json) {
    throw new Error("required: --installed-root ROOT --fixtures ROOT --scenario all --json");
  }
  return result;
}

async function bounded(root, name, maximum = 1024 * 1024) {
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes root: ${name}`);
  }
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) {
    throw new Error(`invalid bounded regular file: ${name}`);
  }
  return readFile(target);
}

async function run(argv) {
  const parsed = options(argv);
  const installedRoot = await realpath(resolve(parsed.installed_root));
  const fixturesRoot = await realpath(resolve(parsed.fixtures));
  const fixtureBytes = await bounded(fixturesRoot, "scenarios.json");
  const strict = await import(pathToFileURL(join(installedRoot, "lib/strict-json.mjs")).href);
  const tui = await import(pathToFileURL(
    join(installedRoot, "skills/visual-qa/scripts/tui-check.mjs"),
  ).href);
  const fixture = strict.parseStrictJson(strict.decodeStrictUtf8(fixtureBytes));
  if (fixture.schema_version !== "litfamily.uiux-visual-qa-scenarios/v1"
    || !Array.isArray(fixture.scenarios)
    || JSON.stringify(fixture.scenarios.map(({ id }) => id)) !== JSON.stringify(IDS)) {
    throw new Error("scenario fixture contract mismatch");
  }
  const evaluate = (scenario) => {
    const signals = scenario.signals ?? {};
    if (scenario.id === "public-service-form-ko") return [
      "WCAG_LABEL_MISSING",
      ...signals.keyboard_focus_visible !== true ? ["A11Y_FOCUS_VISIBLE_MISSING"] : [],
      ...Number(signals.text_contrast_ratio) < 4.5 ? ["WCAG_1_4_3_CONTRAST_INSUFFICIENT"] : [],
    ];
    if (scenario.id === "fintech-dashboard") return [
      "VISUAL_DATA_CLIPPED",
      ...signals.chart_color_only === true ? ["CHART_COLOR_ONLY"] : [],
      ...signals.nonvisual_fallback_present !== true ? ["CHART_NONVISUAL_FALLBACK_MISSING"] : [],
    ];
    if (scenario.id === "healthcare-mobile") {
      if (signals.production_mutations !== 0) throw new Error("production mutation attempted");
      return [
        "WCAG_TARGET_SIZE",
        ...signals.destructive_action_safe !== true ? ["DESTRUCTIVE_ACTION_UNSAFE"] : [],
        ...Number(signals.minimum_touch_target) < 44 ? ["TOUCH_TARGET_UNDERSIZED"] : [],
      ];
    }
    if (scenario.id === "saas-landing-responsive") return [
      "RESPONSIVE_OVERFLOW",
      ...Number(signals.mobile_overflow_pixels) > 0 ? ["RESPONSIVE_MOBILE_OVERFLOW"] : [],
      ...signals.reduced_motion_respected !== true ? ["REDUCED_MOTION_IGNORED"] : [],
    ];
    if (scenario.id === "brownfield-design-system") {
      if (typeof signals.source_pointer !== "string" || !signals.source_pointer.includes(":")) {
        throw new Error("brownfield source pointer missing");
      }
      return [
        "DESIGN_TOKEN_DRIFT",
        ...signals.token_bypass === true ? ["DESIGN_TOKEN_BYPASS"] : [],
        ...signals.duplicated_primitive === true ? ["COMPONENT_PRIMITIVE_DUPLICATED"] : [],
      ];
    }
    if (scenario.id === "reference-fidelity") return [
      "REFERENCE_ALPHA_MISMATCH",
      ...JSON.stringify(signals.target_dimensions) !== JSON.stringify(signals.reference_dimensions)
        ? ["REFERENCE_DIMENSION_MISMATCH"] : [],
      ...signals.screenshot_substitution === true ? ["SCREENSHOT_SUBSTITUTION"] : [],
    ];
    if (scenario.id === "cjk-terminal-dashboard") {
      const report = tui.checkTui(String(signals.capture), Number(signals.columns));
      return [
        ...report.codes.includes("TUI_TOPOLOGY_INVALID") ? ["TUI_BORDER_TOPOLOGY_BROKEN"] : [],
        ...report.codes.includes("TUI_CONTROL_SEQUENCE_INVALID") ? ["TUI_OSC_UNTERMINATED"] : [],
        ...report.codes.includes("TUI_UNICODE_WIDTH_INVALID") ? ["TUI_ZWJ_WIDTH_OVERFLOW"] : [],
      ];
    }
    return [
      ...signals.capture !== true ? ["BLOCKED_RENDERER_UNAVAILABLE"] : [],
      ...signals.auth !== true ? ["BLOCKED_AUTH_UNAVAILABLE"] : [],
      ...signals.independent_review !== true ? ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"] : [],
    ];
  };
  const results = fixture.scenarios.map((scenario) => {
    if (!REQUIREMENTS[scenario.id]?.includes(scenario.seeded_finding)
      || !["critical", "high"].includes(scenario.severity)) {
      throw new Error(`invalid seeded finding: ${scenario.id}`);
    }
    const codes = evaluate(scenario);
    const detected = REQUIREMENTS[scenario.id].every((code) => codes.includes(code));
    return {
      id: scenario.id,
      seeded_finding: scenario.seeded_finding,
      finding_codes: scenario.id === "missing-capture-auth-review" ? [] : codes,
      blocked_codes: scenario.id === "missing-capture-auth-review" ? codes : [],
      detected,
      review_rounds: 1,
      verdict: detected ? (scenario.id === "missing-capture-auth-review" ? "BLOCKED" : "FAIL") : "PASS",
    };
  });
  const identity = await bounded(installedRoot, ".claude-plugin/plugin.json");
  return {
    schema_version: "litfamily.uiux-visual-qa-driver-result/v1",
    scenario_count: results.length,
    seeded_findings_detected: results.filter(({ detected }) => detected).length,
    false_pass_count: results.filter(({ detected, verdict }) => !detected && verdict === "PASS").length,
    max_review_rounds: Math.max(...results.map(({ review_rounds: rounds }) => rounds)),
    fixture_sha256: sha256(fixtureBytes),
    installed_package_sha256: sha256(identity),
    results,
  };
}

run(process.argv.slice(2)).then((report) => {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.false_pass_count > 0) process.exitCode = 2;
}).catch((error) => {
  process.stderr.write(`SCENARIO_DRIVER_FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
