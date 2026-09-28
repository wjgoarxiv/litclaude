import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { buildBlockRegistry } from "../plugins/litclaude/skills/lit-diagram-drawer/scripts/block-registry.mjs";
import { checkBrief, parseBrief } from "../plugins/litclaude/skills/lit-diagram-drawer/scripts/brief-contract.mjs";
import { analyzeFile } from "../plugins/litclaude/skills/lit-diagram-drawer/scripts/diagram-metrics.mjs";
import { officeCssUrlsAreSafe, officeHrefRefsAreSafe } from "../plugins/litclaude/skills/lit-diagram-drawer/scripts/office-safety.mjs";
import { versionAtLeast } from "../plugins/litclaude/skills/lit-diagram-drawer/scripts/renderer.mjs";
import { visualQuality } from "../plugins/litclaude/skills/lit-diagram-drawer/scripts/visual-quality.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const skillRoot = join(pluginRoot, "skills", "lit-diagram-drawer");
const scripts = join(skillRoot, "scripts");
const foilRoot = join(root, "test", "fixtures", "lit-diagram-drawer", "foils");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const catalog = JSON.parse(readFileSync(join(skillRoot, "references", "type-catalog.json"), "utf8"));
const examples = readdirSync(join(skillRoot, "examples"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const skillFiles = walk(skillRoot).map((file) => relative(skillRoot, file).replaceAll("\\", "/"));
const runScript = (name, args, options = {}) =>
  spawnSync(process.execPath, [join(scripts, name), ...args], { encoding: "utf8", ...options });
const typeOf = (file) => readFileSync(file, "utf8").match(/data-type="([a-z0-9-]+)"/u)?.[1];

const withoutRenderer = () => {
  const bin = mkdtempSync(join(tmpdir(), "lit-diagram-path-"));
  symlinkSync(process.execPath, join(bin, "node"));
  return { bin, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } };
};

const hookSkills = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const activation = context.split("\n\n## Project Instructions\n", 1)[0];
  return { context: activation, skills: [...new Set([...activation.matchAll(/Skill\(([a-z-]+)\)/gu)].map((match) => match[1]))] };
};

describe("lit-diagram-drawer enrollment", () => {
  it("is in the skill catalog, the pinned resource trees, and the resource hash manifest", () => {
    assert.ok(canonicalSkillIds.includes("lit-diagram-drawer"));
    assert.match(readFileSync(join(root, "tools", "gen-canonical-skill-resources.mjs"), "utf8"), /"skills\/lit-diagram-drawer",/u);
    for (const file of skillFiles) {
      assert.ok(canonicalSkillResourceManifest.has(`skills/lit-diagram-drawer/${file}`), `unpinned resource ${file}`);
    }
  });

  it("is wired to the prompt hook and documented in both READMEs, the hook guide, and the changelog", () => {
    const hook = readFileSync(hookPath, "utf8");
    assert.match(hook, /"lit-diagram-drawer": \{ command: "\/litclaude:lit-diagram-drawer"/u);
    assert.match(hook, /"lit-diagram-drawer": "Mode contract: lit-diagram-drawer/u);
    for (const doc of ["README.md", "README_ko-KR.md", "docs/hooks.md", "CHANGELOG.md"]) {
      assert.match(readFileSync(join(root, doc), "utf8"), /lit-diagram-drawer/u, `${doc} must document the skill`);
    }
  });

  it("points to its neighbours and they point back", () => {
    const body = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    assert.match(body, /frontend-ui-ux/u);
    assert.match(body, /lit-scientific-visualization/u);
    for (const neighbour of ["frontend-ui-ux", "lit-scientific-visualization"]) {
      assert.match(readFileSync(join(pluginRoot, "skills", neighbour, "SKILL.md"), "utf8"), /`lit-diagram-drawer`/u, neighbour);
    }
  });
});

describe("lit-diagram-drawer payload closure", () => {
  it("resolves every resource path its SKILL.md names", () => {
    const body = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    const named = [...body.matchAll(/`((?:references|scripts|assets)\/[A-Za-z0-9._/-]+)`/gu)].map((match) => match[1]);
    const inFences = [...body.matchAll(/\$SKILL_ROOT\/((?:scripts)\/[A-Za-z0-9._-]+)/gu)].map((match) => match[1]);
    assert.ok(named.length > 20 && inFences.length >= 6);
    for (const path of [...named, ...inFences]) assert.ok(existsSync(join(skillRoot, path)), `SKILL.md names missing ${path}`);
  });

  it("carries a guide and three templates for all 61 catalog types", () => {
    assert.equal(catalog.entries.length, 61);
    const coverage = runScript("verify-coverage.mjs", ["--self-test"]);
    assert.equal(coverage.status, 0, coverage.stderr);
    assert.match(coverage.stdout, /COVERAGE_PASS core=41 gallery=61 variants=183 references=61/u);
  });

  it("ships the font, its licence, third-party licences, and the notice", () => {
    for (const file of ["assets/fonts/PretendardVariable.woff2", "assets/fonts/OFL.txt", "assets/fonts/provenance.json", "NOTICE",
      "assets/licenses/diagram-design-MIT.txt", "assets/licenses/tabler-MIT.txt", "assets/licenses/simple-icons-CC0.md",
      "assets/licenses/log-z-MIT.txt", "assets/licenses/devicon-MIT.txt"]) {
      assert.ok(skillFiles.includes(file), file);
    }
  });

  it("excludes previews, evaluation material, Office QA, generators, and foils", () => {
    for (const file of skillFiles) {
      assert.doesNotMatch(file, /\.(?:png|py|pyc)$|(?:^|\/)ab\/|office-proof|build-(?:assets|gallery|pairs)|constructed-naive-foil|REPORT\.md|PORTING\.md/u, file);
    }
  });

  it("never points into the umbrella tree, a reference checkout, or a sibling product", () => {
    const forbidden = /plans\/|_refs\/|lit-diagram-canonical|lit-humanizer-canonical|\.worktrees|27_LITFAMILY|28_PRIVATE|31_litcodex|32_litopencode|33_litgrok|ab-taskpack/u;
    for (const file of skillFiles.filter((path) => /\.(?:md|mjs|json|html|txt)$|NOTICE$/u.test(path))) {
      assert.doesNotMatch(readFileSync(join(skillRoot, file), "utf8"), forbidden, file);
    }
  });

  it("packs the runtime files and none of the excluded material", () => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const packed = JSON.parse(result.stdout)[0].files.map((file) => file.path);
    const diagram = packed.filter((path) => path.startsWith("plugins/litclaude/skills/lit-diagram-drawer/"));
    assert.equal(diagram.length, skillFiles.length, "every skill file and nothing else is packed");
    assert.ok(!packed.some((path) => path.startsWith("test/")), "fixtures and foils stay out of the package");
  });
});

describe("lit-diagram-drawer verifiers on packaged content", () => {
  it("passes every template and worked example", () => {
    const result = runScript("verify-all.mjs", []);
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.deepEqual([report.templates, report.afterExamples, report.failures.length], [183, 8, 0]);
  });

  it("passes the shared, type, and brief checks on each worked example", () => {
    assert.equal(examples.length, 8);
    for (const name of examples) {
      const after = join(skillRoot, "examples", name, "after.html");
      const diagram = runScript("verify-diagram.mjs", [after]);
      assert.equal(diagram.status, 0, `${name}: ${diagram.stderr}`);
      const type = runScript("verify-type.mjs", [`--type=${typeOf(after)}`, after]);
      assert.equal(type.status, 0, `${name}: ${type.stderr}`);
      const brief = runScript("verify-brief.mjs", [join(skillRoot, "examples", name, "brief.md"), after]);
      assert.equal(brief.status, 0, `${name}: ${brief.stdout}`);
    }
    assert.equal(runScript("verify-brief.mjs", []).status, 0);
  });

  it("rejects every naive foil for its expected reasons", () => {
    const foils = readdirSync(foilRoot).filter((name) => name.endsWith(".html"));
    assert.equal(foils.length, 8);
    for (const foil of foils) {
      const result = runScript("verify-diagram.mjs", [join(foilRoot, foil)]);
      assert.equal(result.status, 1, foil);
      for (const reason of ["VISUAL PROCESS_TEXT", "A11Y_TITLE_DESC_ROLE_LINK", "TEXT_OVERLAP", "CONTRAST", "HUMANIZER_BLOCK", "PRETENDARD_FONT_NOT_LOADED_FROM_LOCAL_ASSET"]) {
        assert.match(result.stderr, new RegExp(`- ${reason}`, "u"), `${foil} must fail ${reason}`);
      }
    }
  });

  it("keeps motion static-first on every template", () => {
    for (const entry of catalog.entries) {
      for (const variant of ["light", "dark", "full"]) {
        const result = runScript("verify-motion.mjs", [join(skillRoot, "assets", "examples", `type-${entry.id}-${variant}.html`)]);
        assert.equal(result.status, 0, `${entry.id}-${variant}: ${result.stderr}`);
      }
    }
  });
});

describe("lit-diagram-drawer visible-text check", () => {
  const svg = (label) => `<main data-type="flowchart" data-variant="light"><svg viewBox="0 0 400 200" role="img" aria-labelledby="t d"><title id="t">Flow</title><desc id="d">Two steps</desc><rect width="400" height="200" fill="#ffffff"/><text x="200" y="100" text-anchor="middle" font-size="16" fill="#202a33">${label}</text></svg></main>`;

  it("uses the lit-humanizer detector shipped in this plugin", () => {
    const source = readFileSync(join(scripts, "diagram-metrics.mjs"), "utf8");
    assert.match(source, /from '\.\.\/\.\.\/lit-humanizer\/scripts\/core\.mjs'/u);
    assert.match(source, /'\.\.\/lit-humanizer\/rules\.json'/u);
  });

  it("fails a block-tier label and passes a plain one", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-diagram-text-"));
    try {
      writeFileSync(join(dir, "blocked.html"), svg("I hope this helps"));
      writeFileSync(join(dir, "plain.html"), svg("Order service"));
      const blocked = runScript("check-visible-text.mjs", [join(dir, "blocked.html")]);
      assert.equal(blocked.status, 1);
      assert.ok(JSON.parse(blocked.stdout).block >= 1);
      assert.equal(analyzeFile(join(dir, "plain.html")).humanizer.summary.block, 0);
      assert.equal(runScript("check-visible-text.mjs", [join(dir, "plain.html")]).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lit-diagram-drawer visual-quality rules", () => {
  const svg = (texts, shapes = "") => `<svg viewBox="0 0 1080 640"><title>Fixture</title><rect width="1080" height="640" fill="#ffffff"/>${shapes}${texts}</svg>`;
  const text = (label, x, y, size = 16, role = "", edgeFor = "") =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}"${role ? ` data-role="${role}"` : ""}${edgeFor ? ` data-edge-for="${edgeFor}"` : ""}>${label}</text>`;
  const issues = (source, options = {}) => visualQuality(source, options).issues;
  const has = (list, prefix) => list.some((issue) => issue.startsWith(prefix));
  const routedNodes = '<rect x="50" y="100" width="100" height="80" data-node-id="A"/><rect x="300" y="100" width="100" height="80" data-node-id="B"/>';

  it("rejects process labels and a missing visible title", () => {
    assert.ok(has(issues(svg(text("LITFAMILY / ARCHITECTURE", 500, 90, 12))), "PROCESS_TEXT"));
    assert.ok(has(issues(svg(text("서비스", 500, 285, 17, "node")), { enforceCanvas: true }), "TITLE_ROLE_MISSING"));
  });

  it("accepts a clean, well-sized connector example", () => {
    const clean = svg(text("예약 요청", 540, 100, 30, "title") + text("서비스", 115, 195, 17, "node") + text("전달", 500, 472, 14, "edge", "A|B") + text("저장소", 965, 495, 17, "node"),
      '<rect x="40" y="150" width="150" height="80" data-node-id="A"/><rect x="890" y="450" width="150" height="80" data-node-id="B"/><path d="M190 190 V490 H890" data-from="A" data-to="B" data-label="전달"/>');
    assert.deepEqual(issues(clean, { enforceCanvas: true }), []);
  });

  it("rejects labels on lines, routes through nodes, tight gaps, small text, and sparse fill", () => {
    const nodes = '<rect x="40" y="240" width="150" height="80" data-node-id="A"/><rect x="400" y="240" width="150" height="80" data-node-id="B"/><rect x="198" y="255" width="34" height="50" data-node-id="C"/>';
    const found = issues(svg(text("전달", 295, 282, 14, "edge", "A|B") + text("제목", 540, 90, 22, "title") + text("노드", 115, 285, 12, "node"),
      `${nodes}<path d="M190 280 H400" data-from="A" data-to="B" data-label="전달"/>`), { enforceCanvas: true });
    for (const prefix of ["EDGE_TEXT_COLLISION", "ROUTE_THROUGH_NODE", "NODE_GAP", "FONT_FLOOR", "CONTENT_FILL"]) assert.ok(has(found, prefix), prefix);
  });

  it("craft floor: groups sit at least twice as far apart as their members (OF-201)", () => {
    const outline = (id, x) => `<rect x="${x}" y="100" width="420" height="200" fill="none" stroke="#748084" data-group-id="${id}"/>`;
    const node = (id, x) => `<rect x="${x}" y="160" width="120" height="80" data-node-id="${id}"/>`;
    const tight = outline("left", 20) + outline("right", 460) + node("A", 40) + node("B", 300) + node("C", 480) + node("D", 740);
    assert.ok(has(issues(svg("", tight)), "CLUSTER_GAP_RATIO"), "members 140px apart, groups 60px apart");
    const grouped = outline("left", 20) + outline("right", 560) + node("A", 40) + node("B", 180) + node("C", 580) + node("D", 720);
    assert.equal(has(issues(svg("", grouped)), "CLUSTER_GAP_RATIO"), false);
    assert.equal(has(issues(svg("", node("A", 40) + node("B", 300))), "CLUSTER_GAP_RATIO"), false, "a flat diagram has no groups to compare");
  });

  it("craft floor: node fills keep to one or two accent families (OF-202)", () => {
    const filled = (fills) => fills.map((fill, index) => `<rect x="${40 + index * 200}" y="200" width="150" height="80" fill="${fill}" data-node-id="N${index}"/>`).join("");
    const four = visualQuality(svg("", filled(["#d62828", "#2a9d8f", "#7b2cbf", "#f4a261"])));
    assert.ok(has(four.issues, "ACCENT_COUNT"));
    const three = visualQuality(svg("", filled(["#d62828", "#2a9d8f", "#7b2cbf"])));
    assert.equal(has(three.issues, "ACCENT_COUNT"), false);
    assert.ok(has(three.advisories, "ACCENT_COUNT"), "three families is an advisory");
    const two = visualQuality(svg("", filled(["#1f6f4a", "#d62828", "#f4f4f2", "#ffffff"])));
    assert.equal(has([...two.issues, ...two.advisories], "ACCENT_COUNT"), false, "neutrals are not accents");
  });

  it("craft floor: Latin labels use sentence case, as an advisory (OF-203)", () => {
    const labelled = (label) => visualQuality(svg(text(label, 115, 195, 17, "node"), '<rect x="20" y="150" width="400" height="80" data-node-id="A"/>'));
    const title = labelled("Review Of The Payment Flow");
    assert.ok(has(title.advisories, "LABEL_CASE"));
    assert.equal(has(title.issues, "LABEL_CASE"), false, "sentence case is advisory, never a failure");
    assert.equal(has(labelled("Review of the payment flow").advisories, "LABEL_CASE"), false);
    assert.equal(has(labelled("Payment Gateway Service").advisories, "LABEL_CASE"), false, "a proper-noun component name is not Title-Case prose");
  });

  it("craft floor: a node label fits inside its own box (OF-204)", () => {
    const node = '<rect x="40" y="150" width="120" height="80" data-node-id="A"/>';
    assert.ok(has(issues(svg(text("A very long node label that spills", 100, 195, 17, "node"), node)), "LABEL_OVERFLOW"));
    assert.equal(has(issues(svg(text("짧은 이름", 100, 195, 17, "node"), node)), "LABEL_OVERFLOW"), false);
  });

  it("binds each edge label to its own route within 24px", () => {
    const found = visualQuality(svg(text("전달", 280, 250, 14, "edge", "A|B"),
      '<rect x="40" y="240" width="150" height="80" data-node-id="A"/><rect x="400" y="240" width="150" height="80" data-node-id="B"/><path d="M190 280 H400" data-from="A" data-to="B" data-label="전달"/><path d="M260 250 H400" data-from="A" data-to="B" data-label="다른 경로"/>'), {});
    assert.ok(has(found.issues, "EDGE_LABEL_NEAREST_PATH"));
    assert.equal(found.edgeLabelMaxAnchorDistance, 24);
  });

  it("keeps boundary labels readable and off the outline", () => {
    const faint = text("경계", 295, 160, 12, "boundary").replace('font-size="12"', 'font-size="12" fill="#c9d1d5"');
    const found = issues(svg(faint + text("제목", 540, 90, 30, "title"), '<rect x="300" y="150" width="500" height="350" fill="none" stroke="#748084" data-trust-boundary="경계"/>'), { enforceCanvas: true });
    for (const prefix of ["OUTLINE_TEXT_COLLISION", "BOUNDARY_FONT_FLOOR", "BOUNDARY_CONTRAST_FLOOR"]) assert.ok(has(found, prefix), prefix);
    assert.ok(has(issues('<svg viewBox="0 0 1080 640"><rect x="300" y="150" width="500" height="350" fill="none" stroke="#748084" data-trust-boundary="zone"/><path d="M100 151 H450" data-from="A" data-to="B"/></svg>'), "ROUTE_ALONG_BOUNDARY"));
  });

  it("keeps arrowheads outside their target", () => {
    const arrow = (end) => `<svg viewBox="0 0 1080 640"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto"><path d="M0 0 L0 7 L9 3.5 z"/></marker></defs><rect x="40" y="240" width="150" height="80" data-node-id="A"/><rect x="400" y="240" width="150" height="80" data-node-id="B"/><path d="M190 280 H${end}" stroke-width="3" marker-end="url(#arrow)" data-from="A" data-to="B"/></svg>`;
    assert.deepEqual(issues(arrow(396)), []);
    assert.ok(has(issues(arrow(394)), "ARROWHEAD_TIP_MISSED_TARGET"));
    assert.ok(has(issues(arrow(400)), "ARROWHEAD_TARGET_OVERLAP"));
    const tiny = '<svg viewBox="0 0 1080 640"><defs><marker id="tiny" markerWidth="7" markerHeight="6" refX="6" refY="3" markerUnits="userSpaceOnUse"><path d="M0 0 L0 6 L6 3 z"/></marker></defs><path d="M10 30 H100" stroke-width="2" marker-end="url(#tiny)" data-from="A" data-to="B"/></svg>';
    assert.ok(has(issues(tiny), "ARROWHEAD_SIZE_FLOOR"));
  });

  it("keeps edge labels off node boxes", () => {
    const found = issues(svg(text("ok", 396, 245, 14, "edge", "A|B"), '<rect x="40" y="220" width="150" height="80" data-node-id="A"/><rect x="400" y="240" width="150" height="80" data-node-id="B"/><path d="M190 250 H400" data-from="A" data-to="B" data-label="ok"/>'));
    assert.ok(has(found, "EDGE_LABEL_NODE_COLLISION ok overlaps B"));
  });

  it("requires every declared decision outcome on an outgoing edge", () => {
    const decision = (edges) => `<svg viewBox="0 0 1080 640"><rect x="100" y="100" width="160" height="80" data-node-id="검증 통과?" data-node-type="decision" data-outcomes="예|아니오"/><rect x="500" y="100" width="160" height="80" data-node-id="승인"/><rect x="500" y="300" width="160" height="80" data-node-id="변경 제출"/>${edges}</svg>`;
    const yes = '<path d="M260 140 H500" data-from="검증 통과?" data-to="승인" data-label="예"/>';
    assert.ok(has(issues(decision(yes)), "DECISION_OUTCOME_MISSING 검증 통과? 아니오"));
    assert.ok(!has(issues(decision(`${yes}<path d="M180 180 V340 H500" data-from="검증 통과?" data-to="변경 제출" data-label="아니오"/>`)), "DECISION_"));
  });

  it("rejects crossing routes, including opposite edges of one node pair", () => {
    const pair = '<rect x="40" y="240" width="100" height="120" data-node-id="A"/><rect x="400" y="240" width="100" height="120" data-node-id="B"/>';
    assert.ok(has(issues(svg("", `${pair}<path d="M140 300 H400" fill="none" data-from="A" data-to="B"/><path d="M400 340 H280 V260 H140" fill="none" data-from="B" data-to="A"/>`)), "ROUTE_CROSSING A->B / B->A"));
    assert.ok(!has(issues(svg("", `${pair}<path d="M140 300 H400" fill="none" data-from="A" data-to="B"/><path d="M400 340 H140" fill="none" data-from="B" data-to="A"/>`)), "ROUTE_CROSSING"));
  });

  it("rejects detours, bent neighbours, excess bends, shared segments, and double heads", () => {
    assert.ok(has(issues(svg("", `${routedNodes}<path d="M150 140 V80 H300 V140" data-from="A" data-to="B"/>`)), "ROUTE_DETOUR A->B"));
    assert.ok(has(issues(svg("", `${routedNodes}<path d="M150 140 V80 H300 V140" data-from="A" data-to="B"/>`)), "ROUTE_ALIGNED_PATH A->B"));
    assert.ok(!issues(svg("", `${routedNodes}<path d="M150 140 H296" data-from="A" data-to="B"/>`)).some((issue) => /^ROUTE_(?:DETOUR|BENDS|ALIGNED_PATH)/u.test(issue)));
    assert.ok(has(issues(svg("", `${routedNodes}<path d="M150 140 V80 H210 V200 H250 V70 H300 V140" data-from="A" data-to="B"/>`)), "ROUTE_BENDS A->B"));
    const crossing = '<rect x="300" y="100" width="400" height="400" data-trust-boundary="internal"/><rect x="50" y="220" width="100" height="80" data-node-id="A"/><rect x="600" y="150" width="100" height="80" data-node-id="B"/>';
    assert.ok(!has(issues(svg("", `${crossing}<path d="M150 260 V220 H500 V190 H596" data-from="A" data-to="B"/>`)), "ROUTE_BENDS A->B"));
    assert.ok(has(issues(svg("", `${crossing}<path d="M150 260 V220 H250 V320 H450 V190 H596" data-from="A" data-to="B"/>`)), "ROUTE_BENDS A->B"));
    const stacked = '<rect x="120" y="20" width="60" height="60" data-node-id="A"/><rect x="120" y="200" width="60" height="60" data-node-id="B"/><rect x="120" y="100" width="60" height="40" data-node-id="C"/><rect x="120" y="180" width="60" height="40" data-node-id="D"/>';
    assert.ok(has(issues(svg("", `${stacked}<path d="M150 80 V200" data-from="A" data-to="B"/><path d="M150 140 V180" data-from="C" data-to="D"/>`)), "ROUTE_COLLINEAR_OVERLAP"));
    assert.ok(has(issues(svg("", `${routedNodes}<path d="M150 140 H300" marker-start="url(#arrow)" marker-end="url(#arrow)" data-from="A" data-to="B"/>`)), "ROUTE_OPPOSED_HEADS A->B"));
  });
});

describe("lit-diagram-drawer sequence, brief, registry, and Office guards", () => {
  const base = '<main data-type="sequence-oauth" data-variant="light"><svg id="diagram-sequence-oauth-light" viewBox="0 0 400 240"><rect x="60" y="60" width="80" height="48" data-node-id="A"/><rect x="160" y="60" width="80" height="48" data-node-id="Mid"/><rect x="260" y="60" width="80" height="48" data-node-id="B"/><path d="M100 140 H300" data-from="A" data-to="B"/><path d="M300 180 H100" data-from="B" data-to="A"/></svg></main>';
  const lifelines = '<line x1="100" y1="108" x2="100" y2="180" stroke-dasharray="5 5" data-lifeline-for="A"/><line x1="200" y1="108" x2="200" y2="180" stroke-dasharray="5 5" data-lifeline-for="Mid"/><line x1="300" y1="108" x2="300" y2="180" stroke-dasharray="5 5" data-lifeline-for="B"/>';
  const verifySequence = (source) => {
    const dir = mkdtempSync(join(tmpdir(), "lit-diagram-sequence-"));
    try {
      const file = join(dir, "fixture.html");
      writeFileSync(file, source);
      return { result: runScript("verify-type.mjs", ["--type=sequence-oauth", file]), crossings: analyzeFile(file).arrowCrossings };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("requires ordered messages on participant lifelines", () => {
    assert.match(verifySequence(base).result.stderr, /SEQUENCE_LIFELINE_MISSING/u);
    const valid = verifySequence(base.replace("</svg>", `${lifelines}</svg>`));
    assert.equal(valid.result.status, 0, valid.result.stderr);
    assert.equal(valid.crossings, 0);
    const swapped = base
      .replace('<path d="M100 140 H300" data-from="A" data-to="B"/><path d="M300 180 H100" data-from="B" data-to="A"/>', '<path d="M100 180 H300" data-from="A" data-to="B"/><path d="M300 140 H100" data-from="B" data-to="A"/>')
      .replace("</svg>", `${lifelines}</svg>`);
    assert.match(verifySequence(swapped).result.stderr, /SEQUENCE_MESSAGE_ORDER/u);
  });

  it("matches brief nodes, labels, direction, Korean wording, and boundary membership exactly", () => {
    const brief = "- 소스 participates in the labeled relationships below.\n- 대상 participates in the labeled relationships below.\n- 소스 → 대상 (전달)";
    const good = '<svg><text>소스</text><text>대상</text><path data-from="소스" data-to="대상" data-label="전달"/><text data-edge-for="소스|대상">전달</text></svg>';
    assert.deepEqual(checkBrief(good, parseBrief(brief)), { language: "ko", nodes: 2, relationships: 1, missingNodes: [], missingLabels: [], missingEdges: [], unpairedLabels: [], languageMismatches: [], boundaryMembership: { declared: false, boundaryCount: 0, issues: [] } });
    assert.equal(checkBrief(good.replace('data-from="소스" data-to="대상"', 'data-from="대상" data-to="소스"'), brief).missingEdges.length, 1);
    assert.equal(checkBrief(good.replace(">전달</text>", ">전달됨</text>"), brief).missingLabels.length, 1);
    assert.ok(checkBrief(good.replace("<text>대상</text>", "<text>대상 build</text>"), brief).languageMismatches.some((item) => item.terms.includes("build")));
    const membership = parseBrief(["- 모바일 앱 participates in the labeled relationships below.", "- API 게이트웨이 participates in the labeled relationships below.",
      "- 작업 소비자 participates in the labeled relationships below.", "- Trust boundary internal nodes: API 게이트웨이; 작업 소비자", "- Trust boundary external nodes: 모바일 앱"].join("\n"));
    const placed = (workerX) => `<svg><rect x="195" y="155" width="710" height="408" data-trust-boundary="internal"/><rect x="40" y="304" width="144" height="64" data-node-id="모바일 앱"/><rect x="280" y="304" width="144" height="64" data-node-id="API 게이트웨이"/><rect x="${workerX}" y="304" width="144" height="64" data-node-id="작업 소비자"/></svg>`;
    assert.ok(checkBrief(placed(910), membership).boundaryMembership.issues.includes("BOUNDARY_NODE_NOT_INTERNAL name=작업 소비자"));
    assert.deepEqual(checkBrief(placed(740), membership).boundaryMembership.issues, []);
    assert.equal(parseBrief("# Release map\n- Package participates in the labeled relationships below.\n- Build → Package (ready)").language, "en");
  });

  it("projects a block registry and rejects broken hierarchies", () => {
    const registry = buildBlockRegistry('<svg><rect data-block-id="root" data-block-name="Request &amp; policy"/><rect data-block-id="child" data-block-parent="root" data-block-name="Audit"/></svg>', "diagram.html");
    assert.deepEqual(registry.blocks.map((block) => block.id), ["root", "child"]);
    assert.equal(registry.blocks[0].name, "Request & policy");
    for (const [fragment, code] of [["", "REGISTRY_BLOCKS_MISSING"], ['<rect data-block-id="x"/><rect data-block-id="x"/>', "REGISTRY_DUPLICATE_ID"],
      ['<rect data-block-id="x" data-block-parent="y"/><rect data-block-id="y" data-block-parent="x"/>', "REGISTRY_CYCLE"], ['<rect data-block-id="x"/><rect data-block-id="y"/>', "REGISTRY_ROOT_COUNT"]]) {
      assert.throws(() => buildBlockRegistry(`<svg>${fragment}</svg>`, "bad.html"), new RegExp(code, "u"));
    }
  });

  it("allows only local fragment references in Office-safe SVG", () => {
    assert.equal(officeCssUrlsAreSafe('<svg><path fill="url(#arrow-main)"/></svg>'), true);
    assert.equal(officeCssUrlsAreSafe('<svg><path fill="url(&#35;arrow-main)"/></svg>'), true);
    for (const value of ["file:///tmp/payload.svg", "//example.invalid/payload.svg", "https://example.invalid/payload.svg", "../payload.svg", "data:image/svg+xml;base64,AAAA"]) {
      assert.equal(officeCssUrlsAreSafe(`<svg><style>.x{fill:url("${value}")}</style></svg>`), false, value);
    }
    assert.equal(officeCssUrlsAreSafe("<svg><style>.x{fill:u&#114;l(file:///tmp/a)}</style></svg>"), false);
    assert.equal(officeCssUrlsAreSafe("<svg><style>@font-face{font-family:Pretendard;src:local(Arial)}</style></svg>"), false);
    assert.equal(officeHrefRefsAreSafe('<svg><use href="#local-symbol"/></svg>'), true);
    assert.equal(officeHrefRefsAreSafe('<svg><image href="&#102;ile:///tmp/a.svg"/></svg>'), false);
    assert.equal(officeHrefRefsAreSafe('<svg xml:base="https://example.invalid/a.svg"><use href="#local-symbol"/></svg>'), false);
  });
});

describe("lit-diagram-drawer doctor and export without a renderer", () => {
  it("compares renderer versions against the 0.38.1 floor", () => {
    assert.equal(versionAtLeast([0, 38, 1], [0, 38, 1]), true);
    assert.equal(versionAtLeast([0, 39, 0], [0, 38, 1]), true);
    assert.equal(versionAtLeast([1, 0, 0], [0, 38, 1]), true);
    assert.equal(versionAtLeast([0, 38, 0], [0, 38, 1]), false);
  });

  it("export stops before writing and prints user-run setup steps", () => {
    const { bin, env } = withoutRenderer();
    const out = join(bin, "exports");
    try {
      const result = runScript("export.mjs", ["--input", join(skillRoot, "examples", "07-deployment-boundary", "after.html"), "--out", out, "--scale", "2"], { env });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /RENDERER_REQUIRED/u);
      assert.match(result.stderr, /never installs software/u);
      assert.match(result.stderr, /npm install -g agent-browser@latest/u);
      assert.match(result.stderr, /agent-browser install/u);
      assert.equal(existsSync(out), false);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("export rejects unsafe Office input before any renderer check", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-diagram-office-"));
    try {
      for (const [name, svg] of [["css-import", '<svg viewBox="0 0 10 10"><style>&#64;import "file:///tmp/a.css";</style></svg>'],
        ["xml-base", '<svg viewBox="0 0 10 10" xml:base="https://example.invalid/"><use href="#local-symbol"/></svg>']]) {
        const input = join(dir, `${name}.svg`);
        writeFileSync(input, svg);
        const result = runScript("export.mjs", ["--input", input, "--out", join(dir, `${name}-out`), "--scale", "1", "--office-safe"]);
        assert.equal(result.status, 2, name);
        assert.equal(existsSync(join(dir, `${name}-out`)), false, name);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doctor keeps authoring usable, marks export unavailable, and never installs", () => {
    const { bin, env } = withoutRenderer();
    try {
      const result = runScript("doctor.mjs", ["--out", bin], { env });
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.authoring, true);
      assert.equal(report.export, false);
      assert.ok(report.userSetup.some((step) => step.startsWith("npm install -g agent-browser")));
      assert.equal(report.checks.find((check) => check.name.startsWith("agent-browser")).status, "missing");
      assert.match(result.stderr, /Diagram authoring and every non-rendering check still work/u);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("doctor fails clearly when the output directory is not writable", () => {
    const { bin, env } = withoutRenderer();
    const locked = join(bin, "locked");
    try {
      spawnSync("mkdir", [locked]);
      chmodSync(locked, 0o500);
      const result = runScript("doctor.mjs", ["--out", locked], { env });
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).checks.find((check) => check.name === "output write access").status, "fail");
    } finally {
      chmodSync(locked, 0o700);
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("lit-diagram-drawer routing boundary", () => {
  it("activates on a leading token or dollar route with the installed SKILL.md path", () => {
    for (const prompt of ["lit-diagram-drawer draw the deployment boundary", "$lit-diagram-drawer 배포 구조를 그려줘"]) {
      const { context, skills } = hookSkills(prompt);
      assert.deepEqual(skills, ["lit-diagram-drawer"], prompt);
      assert.ok(context.includes(JSON.stringify(join(skillRoot, "SKILL.md"))), prompt);
      assert.match(context, /LIT IGNITED · lit-diagram-drawer/u);
    }
  });

  it("stays inert for mentions, quotes, fences, near misses, and the slash route", () => {
    for (const prompt of ["explain what lit-diagram-drawer does", "`lit-diagram-drawer`", "```\nlit-diagram-drawer\n```", "lit-diagram-drawers draw", "/litclaude:lit-diagram-drawer draw it"]) {
      assert.ok(!hookSkills(prompt).skills.includes("lit-diagram-drawer"), prompt);
    }
  });

  it("leaves generic diagram wording, interface design, and measured-data plots with their owners", () => {
    assert.deepEqual(hookSkills("draw a diagram of our deployment").skills, []);
    assert.deepEqual(hookSkills("plot the measured tensile data with error bars").skills, []);
    assert.deepEqual(hookSkills("design a new settings page UI").skills, ["frontend-ui-ux"]);
    assert.deepEqual(hookSkills("lit-scientific-visualization").skills, ["lit-scientific-visualization"]);
  });
});
