import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { probeBrowserDriver } from "../plugins/litclaude/skills/browser-drive/scripts/capability-probe.mjs";
import { decideExit } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/interface-probe.mjs";
import { EXIT, LIMITS, MATRIX, RULES } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/interface-probe-rules.mjs";
import { STATIC_RULES, staticProbe } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/interface-probe-static.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = join(root, "plugins/litclaude/skills/frontend-ui-ux");
const probe = join(skillRoot, "scripts/interface-probe.mjs");
const fixtures = join(root, "test/fixtures/interface-probe");
const temporaryRoots = [];
after(() => { for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true }); });
const scratch = () => {
  const path = mkdtempSync(join(tmpdir(), "litclaude-interface-probe-test-"));
  temporaryRoots.push(path);
  return path;
};

const runProbe = (target, args = [], env = process.env) => {
  const out = scratch();
  const run = spawnSync(process.execPath, [probe, target, "--out", out, ...args], { encoding: "utf8", env, timeout: 300_000 });
  return { ...run, report: JSON.parse(readFileSync(join(out, "findings.json"), "utf8")) };
};

const FINDING_KEYS = new Set(["rule", "severity", "tier", "viewport", "selector", "value", "threshold", "note"]);
const MANIFEST_KEYS = ["url", "viewports_run", "browser_version", "zoom_emulation", "not_verified", "screenshots", "exit_code", "blocked_reason"];
const VIEWPORTS = new Set([...MATRIX.map(({ id }) => id), "static"]);
const assertShape = (report) => {
  assert.deepEqual(Object.keys(report).sort(), ["findings", "manifest"], "C.4: the root holds manifest and findings only");
  assert.deepEqual(Object.keys(report.manifest).sort(), [...MANIFEST_KEYS].sort());
  assert.ok(report.manifest.url === null || typeof report.manifest.url === "string");
  assert.ok(report.manifest.browser_version === null || typeof report.manifest.browser_version === "string");
  for (const finding of report.findings) {
    assert.ok(VIEWPORTS.has(finding.viewport), `viewport ${finding.viewport}`);
    for (const key of Object.keys(finding)) assert.ok(FINDING_KEYS.has(key), `unexpected finding key ${key}`);
    assert.match(finding.rule, /^(CF|RS|SLOP)-\d{3}$/u);
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(finding.severity));
    assert.ok(["measured", "derived", "not_verified"].includes(finding.tier));
    assert.ok("value" in finding && "threshold" in finding);
  }
  for (const entry of report.manifest.not_verified) assert.ok(entry.rule && entry.reason);
};

const driver = probeBrowserDriver();
const browserSkip = ["available", "beyond-verified"].includes(driver.status)
  ? false
  : `agent-browser is not usable here (${driver.blocker}); rendered fixtures need a real browser`;

describe("interface probe: forbidden reference files (MD-016)", () => {
  const table = join(fixtures, "forbidden-reference-sha256.txt");
  const listed = () => readFileSync(table, "utf8")
    .split("\n")
    .filter((line) => /^[0-9a-f]{64} {2}\S/u.test(line))
    .map((line) => ({ sha: line.slice(0, 64), path: line.slice(66) }));
  const matches = (paths, entries) => {
    const forbidden = new Map(entries.map(({ sha, path }) => [sha, path]));
    return paths.flatMap((path) => {
      const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
      return forbidden.has(sha) ? [`${path} matches ${forbidden.get(sha)}`] : [];
    });
  };
  // The pack listing is the one file walk this repository already trusts for what it publishes.
  const packedFiles = () => {
    const pack = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    assert.equal(pack.status, 0, pack.stderr);
    return JSON.parse(pack.stdout)[0].files.map(({ path }) => path);
  };

  it("carries the full reference hash table and fails closed without it", () => {
    const entries = listed();
    assert.equal(entries.length, 111, "54 impeccable skill files plus 57 jakubkrehel/skills files");
    assert.equal(new Set(entries.map(({ sha }) => sha)).size, entries.length);
    assert.equal(entries.filter(({ path }) => path.startsWith("impeccable/skill/")).length, 54);
    assert.equal(entries.filter(({ path }) => path.startsWith("krehel/skills/")).length, 57);
    assert.throws(() => readFileSync(join(fixtures, "missing-table.txt"), "utf8"), /ENOENT/u);
  });

  it("detects a file whose bytes match a listed hash", () => {
    const dir = scratch();
    const file = join(dir, "copied.md");
    writeFileSync(file, "stand-in bytes for a copied reference file\n");
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
    assert.equal(matches([file], [...listed(), { sha, path: "stand-in" }]).length, 1);
    assert.equal(matches([file], listed()).length, 0);
  });

  it("publishes no file byte-identical to a reference file", () => {
    const files = packedFiles();
    assert.ok(files.some((file) => file.startsWith("plugins/litclaude/skills/frontend-ui-ux/")), "the pack listing must cover the skill");
    assert.deepEqual(matches(files.map((file) => join(root, file)), listed()), []);
  });
});

describe("interface probe: credits (MD-015)", () => {
  it("names each studied source with its author, licence and upstream commit", () => {
    const notice = readFileSync(join(skillRoot, "ATTRIBUTION.md"), "utf8");
    for (const anchors of [
      ["pbakaus/impeccable", "Paul Bakaus", "Apache", "9d715cc"],
      ["jakubkrehel/skills", "Jakub Krehel", "MIT", "267330e"],
      ["ibelick/ui-skills", "Julien Thibeaut", "MIT"],
    ]) {
      for (const anchor of anchors) assert.ok(notice.includes(anchor), `credit anchor ${anchor}`);
    }
  });
});

describe("interface probe: rule table", () => {
  it("keeps every rule complete, the matrix at the spec viewports, and limits as data", () => {
    for (const [id, rule] of Object.entries(RULES)) {
      assert.match(id, /^(CF|RS|SLOP)-\d{3}$/u);
      assert.ok(["HIGH", "MEDIUM", "LOW"].includes(rule.severity), `${id} severity`);
      assert.ok(["measured", "derived"].includes(rule.tier), `${id} tier`);
      assert.ok(rule.fix.length > 20, `${id} needs a fix`);
    }
    assert.deepEqual(MATRIX.map(({ id }) => id), ["320", "390", "768", "1440", "390-dark", "390-reduced-motion", "1440-zoom200"]);
    const zoom = MATRIX.find(({ id }) => id === "1440-zoom200");
    assert.equal(zoom.width * zoom.scale, 1440);
    assert.deepEqual(MATRIX.filter(({ touch }) => touch).map(({ id }) => id), ["320", "390", "768", "390-dark", "390-reduced-motion", "1440-zoom200"], "touch-primary means width ≤ 768, the zoom row included");
    assert.equal(RULES["RS-006"].threshold.tolerancePx, 8);
    assert.equal(LIMITS.settleMs, 1200);
  });

  it("follows the Delta 1 severity ladder", () => {
    const slopHigh = Object.entries(RULES).filter(([id, rule]) => id.startsWith("SLOP-") && rule.severity === "HIGH").map(([id]) => id);
    assert.deepEqual(slopHigh, ["SLOP-057", "SLOP-058", "SLOP-059"], "only broken images, dead links and typeless submits are HIGH");
    for (const id of ["SLOP-010", "SLOP-029", "SLOP-036", "SLOP-037", "SLOP-040"]) assert.equal(RULES[id].severity, "MEDIUM", id);
    assert.notEqual(RULES["CF-503"].severity, "HIGH");
    assert.notEqual(RULES["CF-503"].threshold.declaredSeverity, "HIGH");
    assert.equal(RULES["CF-404"].severity, "LOW");
    assert.equal("RS-001" in RULES, false, "RS-001 is run completeness, never a finding");
    assert.deepEqual([RULES["CF-101"].threshold.latinMaxCh, RULES["CF-101"].threshold.cjkMaxCh], [90, 60]);
    assert.deepEqual([RULES["CF-103"].threshold.latinMin, RULES["CF-103"].threshold.cjkMin], [1.4, 1.5]);
    assert.deepEqual([RULES["SLOP-008"].threshold.hueMin, RULES["SLOP-008"].threshold.hueMax], [260, 310]);
    for (const id of ["SLOP-011", "SLOP-016", "SLOP-030", "SLOP-037", "SLOP-041", "SLOP-043", "SLOP-045", "SLOP-046", "SLOP-051", "SLOP-053"]) {
      assert.ok(RULES[id].judgment, `${id} needs a reviewer's verdict before it counts`);
    }
  });

  it("decides exit codes by C.5", () => {
    const all = MATRIX.map(({ id }) => id);
    const high = (tier) => [{ rule: "CF-201", severity: "HIGH", tier }];
    assert.deepEqual(decideExit({ findings: [], viewportsRun: all, blockedReason: null }), { exitCode: EXIT.clean, blockedReason: null });
    assert.equal(decideExit({ findings: high("measured"), viewportsRun: all, blockedReason: null }).exitCode, EXIT.high);
    assert.equal(decideExit({ findings: high("not_verified"), viewportsRun: all, blockedReason: null }).exitCode, EXIT.clean, "a not_verified HIGH never sets exit 1");
    assert.deepEqual(decideExit({ findings: [], viewportsRun: ["390"], blockedReason: null }), { exitCode: EXIT.blocked, blockedReason: "matrix incomplete (320, 768, 1440, 390-dark, 390-reduced-motion, 1440-zoom200)" });
    assert.equal(decideExit({ findings: high("derived"), viewportsRun: ["390"], blockedReason: null }).exitCode, EXIT.high, "a HIGH wins over an incomplete matrix");
    assert.equal(decideExit({ findings: high("measured"), viewportsRun: [], blockedReason: "browser unavailable" }).exitCode, EXIT.blocked);
  });

  it("keeps the in-page module free of imports, network calls and literal thresholds", () => {
    const source = readFileSync(join(skillRoot, "scripts/interface-probe-page.mjs"), "utf8");
    assert.doesNotMatch(source, /^\s*import\b/mu);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/u);
    assert.doesNotMatch(source, /\.(?:click|submit|requestSubmit|dispatchEvent)\(/u, "MD-011: the probe activates nothing");
    for (const literal of ["4.5", "0.95", "44", "1.35", "250", "768"]) {
      assert.doesNotMatch(source, new RegExp(`[^\\w.]${literal.replace(".", "\\.")}[^\\w.]`, "u"), `threshold ${literal} belongs in the rule table`);
    }
  });
});

describe("interface probe: static fallback", () => {
  it("reports the planted static rules in the sloppy fixture and nothing in the clean one", () => {
    const sloppy = staticProbe(join(fixtures, "sloppy"));
    const rules = new Set(sloppy.findings.map(({ rule }) => rule));
    for (const rule of ["SLOP-058", "SLOP-057", "SLOP-009", "SLOP-008", "CF-503", "CF-507", "CF-406", "SLOP-060", "SLOP-040"]) {
      assert.ok(rules.has(rule), `${rule} must be found statically`);
    }
    assert.ok(sloppy.findings.every(({ viewport, tier, selector }) => viewport === "static" && tier === "measured" && /:\d+$/u.test(selector)), "a literal source match keeps its own tier and a file:line");
    assert.ok(sloppy.notVerified.some(({ rule, reason }) => rule === "SLOP-016" && reason.startsWith("judgment: ")), "a font match is a judgment candidate, not a finding");
    assert.deepEqual(staticProbe(join(fixtures, "clean")).findings, []);
  });

  it("lists every rendered rule as not verified", () => {
    const { notVerified } = staticProbe(join(fixtures, "clean"));
    const listed = new Set(notVerified.map(({ rule }) => rule));
    for (const rule of Object.keys(RULES).filter((id) => !STATIC_RULES.includes(id))) assert.ok(listed.has(rule), `${rule} must be listed`);
  });

  it("reads component sources, not only HTML", () => {
    const dir = scratch();
    writeFileSync(join(dir, "Panel.jsx"), [
      "export const Panel = () => (",
      "  <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ scale: 1 }}>",
      "    <a href={\"#\"}>More</a>",
      "    <a href=\"#details\">Details</a>",
      "  </motion.div>",
      ");",
    ].join("\n"));
    const { findings } = staticProbe(dir);
    assert.deepEqual(findings.map(({ rule, selector }) => `${rule} ${selector}`).sort(), [
      "CF-503 Panel.jsx:2",
      "SLOP-058 Panel.jsx:3",
    ]);
  });
});

describe("interface probe: started through a symlinked directory", () => {
  it("behaves exactly as when started by its real path", () => {
    const dir = scratch();
    symlinkSync(skillRoot, join(dir, "linked-skill"));
    const run = (script) => spawnSync(process.execPath, [script, "--no-such-flag"], { encoding: "utf8" });
    const real = run(probe);
    const linked = run(join(dir, "linked-skill", "scripts", "interface-probe.mjs"));
    assert.equal(real.status, EXIT.blocked);
    assert.match(real.stdout, /^BLOCKED: unknown argument --no-such-flag$/mu);
    assert.equal(linked.status, real.status, "a symlinked start must not exit 0 silently");
    assert.equal(linked.stdout, real.stdout);
  });
});

describe("interface probe: blocked runs", () => {
  it("prints BLOCKED: browser unavailable and exits 2 when agent-browser is not on PATH", () => {
    const run = runProbe(join(fixtures, "sloppy"), [], { ...process.env, PATH: "/usr/bin:/bin" });
    assert.equal(run.status, EXIT.blocked, run.stderr);
    assert.match(run.stdout, /^BLOCKED: browser unavailable$/mu);
    assertShape(run.report);
    assert.equal(run.report.manifest.exit_code, EXIT.blocked);
    assert.deepEqual(run.report.manifest.viewports_run, []);
    assert.ok(run.report.findings.some(({ rule, viewport }) => rule === "SLOP-058" && viewport === "static"), "static findings still reach the report");
    assert.equal(run.report.manifest.browser_version, null);
    assert.ok(run.report.manifest.not_verified.some(({ rule }) => rule === "CF-201"));
  });

  it("never reports a static-only run as a pass", () => {
    const run = runProbe(join(fixtures, "clean"), ["--static"]);
    assert.equal(run.status, EXIT.blocked);
    assert.equal(run.report.findings.length, 0);
    assert.match(run.report.manifest.blocked_reason, /static run/u);
  });

  it("blocks with no entry page found when a directory has no page", () => {
    const dir = scratch();
    mkdirSync(join(dir, "src"));
    const run = runProbe(dir);
    assert.equal(run.status, EXIT.blocked);
    assert.match(run.stdout, /^BLOCKED: no entry page found$/mu);
  });
});

describe("interface probe: rendered fixtures", { skip: browserSkip }, () => {
  it("flags the sloppy page on the rules it plants, at every matrix viewport", () => {
    const run = runProbe(join(fixtures, "sloppy"));
    assert.equal(run.status, EXIT.high, run.stdout + run.stderr);
    assertShape(run.report);
    assert.deepEqual(run.report.manifest.viewports_run, MATRIX.map(({ id }) => id), "RS-001: every width ran");
    const hit = (rule, viewport) => run.report.findings.some((finding) => finding.rule === rule && (!viewport || finding.viewport === viewport));
    for (const rule of ["RS-007", "RS-008", "CF-101", "CF-103", "CF-105", "CF-107", "CF-201", "CF-202", "CF-204", "CF-401", "CF-404", "CF-503", "CF-701", "CF-702", "CF-704", "CF-806",
      "SLOP-008", "SLOP-009", "SLOP-040", "SLOP-057", "SLOP-058", "SLOP-059", "SLOP-060"]) {
      assert.ok(hit(rule), `${rule} must be flagged`);
    }
    assert.ok(hit("CF-506", "1440"), "a real hover reads the slow list-row transition");
    const judged = (rule) => run.report.manifest.not_verified.some((entry) => entry.rule === rule && entry.reason.startsWith("judgment: "));
    for (const rule of ["SLOP-016", "SLOP-053"]) {
      assert.ok(judged(rule), `${rule} is a judgment candidate`);
      assert.equal(hit(rule), false, `${rule} is never a finding by itself`);
    }
    assert.ok(run.report.findings.every((finding) => !finding.rule.startsWith("SLOP-") || finding.severity !== "HIGH" || ["SLOP-057", "SLOP-058", "SLOP-059"].includes(finding.rule)));
    assert.ok(run.report.findings.filter(({ rule }) => rule === "CF-202").some(({ severity }) => severity === "HIGH"), "focus that changes nothing is HIGH");
    for (const viewport of ["320", "390", "768"]) assert.ok(hit("RS-006", viewport), `RS-006 at ${viewport}`);
    assert.equal(hit("RS-006", "1440"), false, "the 1200px row fits a 1440px viewport");
    assert.ok(hit("RS-004", "1440-zoom200"), "the zoom pass reports its overflow as RS-004");
    assert.ok(hit("RS-002", "390-dark"), "the page has no dark path");
    assert.ok(hit("RS-003", "390-reduced-motion"), "the page ignores reduced motion");
    assert.equal(hit("RS-007") && run.report.findings.some((f) => f.rule === "RS-007" && /overlap/u.test(f.value)), false, "clipped text must not count as overlapping text");
    assert.equal(run.report.manifest.screenshots.length, MATRIX.length);
    assert.equal(run.report.manifest.zoom_emulation, "viewport-halved");
  });

  it("passes the clean page with no HIGH finding at any viewport", () => {
    const run = runProbe(join(fixtures, "clean"));
    assert.equal(run.status, EXIT.clean, run.stdout + run.stderr);
    assertShape(run.report);
    assert.deepEqual(run.report.findings.filter(({ severity }) => severity === "HIGH"), []);
    assert.match(run.stdout, /\| Severity \| Rule \| Where \| Measured \| Fix \|/u);
    assert.match(run.stdout, /Verdict: Approve \(0 HIGH\)/u);
    assert.deepEqual(run.report.manifest.viewports_run, MATRIX.map(({ id }) => id));
    assert.equal(run.report.findings.some(({ rule }) => rule === "CF-202"), false, "a declared :focus-visible ring passes");
  });

  it("blocks a run that skipped matrix rows when nothing HIGH was found", () => {
    const run = runProbe(join(fixtures, "clean"), ["--viewports", "390"]);
    assert.equal(run.status, EXIT.blocked, run.stdout + run.stderr);
    assert.match(run.stdout, /^BLOCKED: matrix incomplete \(320, 768, 1440, 390-dark, 390-reduced-motion, 1440-zoom200\)$/mu);
    assertShape(run.report);
  });
});
