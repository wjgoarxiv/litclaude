// frontend-ui-ux house styles, kit and design lock. The kit is only useful if a run cannot drift
// out of it unnoticed, so these tests pin both halves: what design-lock.mjs writes, and what the
// interface probe reports when a page leaves the lock.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { probeBrowserDriver } from "../plugins/litclaude/skills/browser-drive/scripts/capability-probe.mjs";
import { COLOR_ROLES, DEFAULT_STYLE_BY_FAMILY, FAMILIES, densityForBrief, LOCK_FILE, MOMENT_KINDS, MOMENT_SCALE_BY_FAMILY, initLock, kitStyles, lockRecord, setMoment, styleForBrief, tokensCss, validateStyle } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/design-lock.mjs";
import { LOOK_RUBRIC, findLock, renderTable } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/interface-probe.mjs";
import { RULES } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/interface-probe-rules.mjs";
import { staticProbe } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/interface-probe-static.mjs";
import { pixelSvg } from "../plugins/litclaude/skills/frontend-ui-ux/scripts/pixel-art.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillRoot = join(root, "plugins/litclaude/skills/frontend-ui-ux");
const kit = join(skillRoot, "kit");
const probe = join(skillRoot, "scripts/interface-probe.mjs");
const temporaryRoots = [];
after(() => { for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true }); });
const scratch = () => {
  const path = mkdtempSync(join(tmpdir(), "litclaude-design-lock-test-"));
  temporaryRoots.push(path);
  return path;
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("frontend-ui-ux kit: house styles", () => {
  it("ships exactly the five documented styles, each valid and with field-notes keeping the authored profile", () => {
    const styles = kitStyles();
    assert.deepEqual(styles.map((style) => style.id), ["computational-brutalism", "field-notes", "graphite", "meadow", "neo-brutalism"]);
    for (const style of styles) assert.deepEqual(validateStyle(style), [], style.id);
    const profile = JSON.parse(readFileSync(join(skillRoot, "references/default-editorial-pixel.json"), "utf8"));
    const fieldNotes = styles.find((style) => style.id === "field-notes");
    assert.equal(fieldNotes.color.light.canvas, profile.palette.paper);
    assert.equal(fieldNotes.color.light.ink, profile.palette.ink);
    assert.equal(fieldNotes.color.light.accent, profile.palette.accent);
    assert.equal(fieldNotes.color.light.support, profile.palette.mist);
    assert.equal(fieldNotes.color.light["accent-2"], profile.palette.accent_2);
    assert.equal(profile.density.default, "rich");
    assert.equal(fieldNotes.accent_art, "pixel");
    assert.ok(fieldNotes.type.display_px.max <= profile.type.display_desktop_px[1] && fieldNotes.type.display_px.min >= profile.type.display_mobile_px[0]);
  });

  it("keeps every text and control pair above its WCAG floor in both themes", () => {
    const pairs = [["ink", "canvas", 4.5], ["ink-2", "canvas", 4.5], ["ink-3", "canvas", 4.5], ["ink-3", "surface", 4.5], ["ink-3", "sunken", 4.5], ["ink-2", "sunken", 4.5],
      ["on-accent", "accent", 4.5], ["on-accent", "accent-hover", 4.5], ["accent-ink", "canvas", 4.5], ["accent-ink", "surface", 4.5], ["accent-ink", "accent-wash", 4.5],
      ["support-ink", "support", 4.5], ["positive", "positive-wash", 4.5], ["warning", "warning-wash", 4.5], ["negative", "negative-wash", 4.5], ["info", "info-wash", 4.5],
      ["positive", "surface", 4.5], ["warning", "surface", 4.5], ["negative", "surface", 4.5], ["info", "surface", 4.5], ["control", "surface", 3], ["control", "canvas", 3], ["focus", "canvas", 3]];
    for (const style of kitStyles()) {
      for (const theme of ["light", "dark"]) {
        for (const [fg, bg, floor] of pairs) {
          const ratio = contrast(style.color[theme][fg], style.color[theme][bg]);
          assert.ok(ratio >= floor, `${style.id} ${theme} ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under ${floor}:1`);
        }
        if (style.shape.panel_head === "inverse") assert.ok(contrast(style.color[theme].canvas, style.color[theme].ink) >= 4.5, `${style.id} ${theme} inverse panel head`);
      }
    }
  });

  it("gives each brutalist register its own signature: flat, square and mono versus outlined, offset and loud", () => {
    const comp = kitStyles().find((style) => style.id === "computational-brutalism");
    const neo = kitStyles().find((style) => style.id === "neo-brutalism");
    assert.deepEqual(Object.values(comp.radius_px), [0, 0, 0, 0, 0]);
    assert.equal(comp.shape.elevation, "flat");
    assert.equal(comp.shadow.raised, "none");
    assert.equal(comp.fonts.text, "JetBrains Mono");
    assert.equal(comp.shape.meta_case, "uppercase");
    assert.equal(neo.shape.elevation, "offset");
    assert.equal(neo.shape.surface_line, "ink");
    assert.ok(Math.min(neo.shape.border_px.surface, neo.shape.border_px.control) >= RULES["CF-403"].threshold.registerBorderPx, "outlines thick enough for the CF-403 register proxy too");
    assert.match(neo.shadow.raised, /^\d+px \d+px 0 0 var\(--c-ink\)$/u, "zero-blur ink offset");
    const neoTokens = tokensCss(neo, []);
    assert.match(neoTokens, /--shadow-control: 3px 3px 0 0 var\(--c-ink\);/u);
    assert.match(neoTokens, /--press: translate\(3px, 3px\);/u);
    assert.match(neoTokens, /--control-edge: var\(--c-ink\);/u);
    const compTokens = tokensCss(comp, []);
    assert.match(compTokens, /--font-meta: var\(--font-mono\);/u);
    assert.match(compTokens, /--canvas-pattern: linear-gradient/u);
    assert.match(compTokens, /--shadow-control: none;/u);
    assert.equal(lockRecord(neo, "landing").elevation, "offset");
    assert.equal(lockRecord(comp, "workspace").elevation, "flat");
    // Round 2: computational brutalism shows its structure (plotting grid with major lines, inverse
    // panel heads, coordinate-marked sections, mono headings at real size); neo-brutalism is more
    // than a recolour (accent panel heads, heavier display type).
    assert.equal(comp.shape.canvas_pattern, "plot");
    assert.equal(comp.shape.heading_font, "mono");
    assert.equal(comp.shape.panel_head, "inverse");
    assert.equal(comp.shape.section_marks, "coord");
    assert.ok(comp.shape.border_px.rule >= 3 && comp.shape.border_px.surface >= 2, "raw structure: heavy rules and frames");
    assert.match(compTokens, /--font-heading: var\(--font-mono\);/u);
    assert.match(compTokens, /--panel-head-bg: var\(--c-ink\);/u);
    assert.match(compTokens, /--section-marks: block;/u);
    assert.match(compTokens, /--canvas-pattern-size: 32px 32px, 32px 32px, 160px 160px, 160px 160px;/u);
    assert.equal(neo.shape.panel_head, "accent");
    assert.ok(neo.type.weights.display >= 900, "chunky display type");
    assert.match(neoTokens, /--panel-head-bg: var\(--c-accent\);/u);
    assert.notDeepEqual({ ...comp.shape, border_px: null }, { ...neo.shape, border_px: null });
    for (const style of [comp, neo]) {
      assert.match(style.use_when[0], /^opt-in only/u);
      assert.ok(style.forbid.length >= 4 && style.signature.length >= 4, style.id);
    }
  });

  it("keeps the soft styles in a calm lock rendering as before: thin line outlines, no control shadow, scale press", () => {
    for (const id of ["field-notes", "graphite", "meadow"]) {
      const tokens = tokensCss(kitStyles().find((style) => style.id === id), [], "calm");
      for (const line of ["--bw-surface: 1px;", "--bw-control: 1px;", "--bw-rule: 1px;", "--c-frame: var(--c-line);", "--control-edge: initial;", "--shadow-control: none;", "--press: scale(0.96);", "--meta-case: none;", "--canvas-pattern: none;", "--font-heading: var(--font-display);", "--panel-head-bg: transparent;", "--section-marks: none;"]) assert.ok(tokens.includes(line), `${id}: ${line}`);
    }
  });

  it("rejects an elevation grammar that contradicts itself", () => {
    const broken = structuredClone(kitStyles().find((style) => style.id === "neo-brutalism"));
    broken.shape.offset_px.surface = 0;
    assert.ok(validateStyle(broken).some((issue) => issue.includes("offset elevation needs offset_px")));
    const flat = structuredClone(kitStyles().find((style) => style.id === "computational-brutalism"));
    flat.shape.press = "shift";
    flat.shape.border_px.rule = 9;
    const issues = validateStyle(flat);
    assert.ok(issues.some((issue) => issue.includes("press shift")));
    assert.ok(issues.some((issue) => issue.includes("shape.border_px.rule")));
  });

  it("rejects a style that leaves a role, scale step or radius undecided", () => {
    const broken = structuredClone(kitStyles()[0]);
    delete broken.color.dark.accent;
    broken.space_px.push(10);
    delete broken.radius_px.md;
    const issues = validateStyle(broken);
    assert.ok(issues.some((issue) => issue.includes("color.dark.accent")));
    assert.ok(issues.some((issue) => issue.includes("space_px")));
    assert.ok(issues.some((issue) => issue.includes("radius_px.md")));
  });
});

describe("frontend-ui-ux kit: components and starters", () => {
  const css = readFileSync(join(kit, "components.css"), "utf8");
  const tokens = tokensCss(kitStyles()[0], [{ family: "Pretendard", file: "a.woff2", weight: "45 920" }]);

  it("never names a literal colour, so a style switch reaches every component", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
    assert.doesNotMatch(withoutComments, /#[0-9a-f]{3,8}\b/iu);
    assert.doesNotMatch(withoutComments, /\b(?:rgb|rgba|hsl|hsla|oklch)\(/iu);
  });

  it("reads only custom properties that tokens.css or the sheet itself defines", () => {
    const defined = new Set([...`${tokens}\n${css}`.matchAll(/(--[a-z0-9-]+)\s*:/gu)].map((match) => match[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gu)].map((match) => match[1]));
    const optional = new Set(["--container", "--stack-gap", "--cluster-gap", "--grid-gap", "--cols", "--panel-pad", "--cell-y", "--status-ink", "--meter", "--swatch", "--scroll-max"]);
    for (const name of used) assert.ok(defined.has(name) || optional.has(name), `${name} is read but never defined`);
    for (const role of COLOR_ROLES) assert.match(tokens, new RegExp(`--c-${role}:`, "u"));
  });

  it("gives every family a starter whose ui-* classes all exist in the sheet", () => {
    const defined = new Set([...css.matchAll(/\.(ui-[a-z0-9_-]+)/gu)].map((match) => match[1]));
    assert.deepEqual(readdirSync(join(kit, "layouts")).sort(), Object.keys(FAMILIES).map((family) => `${family}.html`).sort());
    for (const family of Object.keys(FAMILIES)) {
      const html = readFileSync(join(kit, "layouts", `${family}.html`), "utf8");
      for (const [, list] of html.matchAll(/class="([^"]+)"/gu)) {
        for (const name of list.split(/\s+/u).filter((value) => value.startsWith("ui-"))) assert.ok(defined.has(name), `${family}.html uses .${name}, which components.css never defines`);
      }
      assert.match(html, /href="ui\/tokens\.css"[\s\S]*href="ui\/components\.css"/u, `${family}.html links tokens before components`);
      assert.match(html, new RegExp(RULES["DS-006"].threshold.pattern, "u"), `${family}.html marks its slots so DS-006 can find leftovers`);
    }
  });

  it("documents every kit class family in house-styles.md", () => {
    const doc = readFileSync(join(skillRoot, "references/house-styles.md"), "utf8");
    for (const name of ["ui-display", "ui-btn", "ui-field", "ui-table-wrap", "ui-stat-row", "ui-plans", "ui-app", "ui-settings", "ui-savebar", "UI.bars", "ui-pixel", "ui-coord", "ui-ruler", "ui-frame", "ui-scan", "ui-readout", "ui-sticker", "ui-panel--accent", "ui-setpiece", "ui-bignum", "ui-hero--stage"]) assert.ok(doc.includes(name), name);
    for (const id of ["DS-001", "DS-002", "DS-003", "DS-004", "DS-005", "DS-006", "DS-007", "DS-008"]) assert.ok(doc.includes(id), id);
    for (const name of ["ui-coord", "ui-ruler", "ui-frame", "ui-scan", "ui-readout", "ui-sticker", "ui-panel--accent", "ui-panel--support"]) assert.ok(css.includes(`.${name}`), `components.css defines .${name}`);
    for (const style of kitStyles()) assert.ok(doc.includes(`\`${style.id}\``), style.id);
  });
});

describe("frontend-ui-ux kit: design-lock.mjs", () => {
  it("writes the lock, tokens, sheet, script, fonts and the starter into the project", () => {
    const dir = scratch();
    const result = initLock({ styleId: "graphite", family: "workspace", dir, scaffold: true });
    assert.equal(result.scaffolded, "index.html");
    const lock = JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8"));
    assert.equal(lock.schema_id, "litfamily.design-lock/v1");
    assert.equal(lock.style, "graphite");
    assert.equal(lock.family, "workspace");
    assert.deepEqual(lock.fonts, ["Pretendard", "JetBrains Mono"]);
    assert.ok(lock.radius_px.includes(0));
    for (const file of ["ui/tokens.css", "ui/components.css", "ui/ui.js", "ui/fonts/PretendardVariable.woff2", "ui/fonts/JetBrainsMono-wght-latin.woff2", "ui/fonts/Pretendard-OFL.txt", "ui/fonts/JetBrainsMono-OFL.txt", "index.html"]) {
      assert.ok(existsSync(join(dir, file)), file);
    }
    const tokens = readFileSync(join(dir, "ui/tokens.css"), "utf8");
    assert.match(tokens, /--ui-lock: "graphite";/u);
    assert.match(tokens, /@media \(prefers-color-scheme: dark\)/u);
    assert.match(tokens, /:root\[data-theme="dark"\]/u);
    assert.equal(readFileSync(join(dir, "index.html"), "utf8"), readFileSync(join(kit, "layouts/workspace.html"), "utf8"));
  });

  it("applies the decided family defaults when no style is named", () => {
    // User decision 2026-10-25: read-once pages keep field-notes, work surfaces use graphite,
    // meadow is never a default.
    assert.deepEqual(DEFAULT_STYLE_BY_FAMILY, { landing: "field-notes", workspace: "graphite", settings: "graphite" });
    for (const [family, style] of Object.entries(DEFAULT_STYLE_BY_FAMILY)) {
      const dir = scratch();
      initLock({ family, dir });
      assert.equal(JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8")).style, style, family);
    }
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    assert.match(skill, /read-once page \(landing, docs, report\) locks `field-notes`/u);
    assert.match(skill, /dashboards, settings, forms and admin or data-dense screens lock `graphite`/u);
    assert.match(readFileSync(join(skillRoot, "references/house-styles.md"), "utf8"), /`meadow` is never a default/u);
    assert.match(kitStyles().find((style) => style.id === "meadow").use_when[0], /^opt-in only/u);
  });

  it("picks a brutalist register only when the request names it, and an explicit --style still wins", () => {
    const pick = (text) => styleForBrief(text)?.id ?? null;
    assert.equal(pick("Build a brutalist landing page for a compiler"), "computational-brutalism");
    assert.equal(pick("레트로퓨처 느낌의 관제 대시보드"), "computational-brutalism");
    assert.equal(pick("브루탈리즘 스타일 설정 화면"), "computational-brutalism");
    assert.equal(pick("a retro-futurist CRT console"), "computational-brutalism");
    assert.equal(pick("neo-brutalism pricing page"), "neo-brutalism");
    assert.equal(pick("Make it neo brutalist, bold outlines"), "neo-brutalism");
    assert.equal(pick("네오브루탈리즘 랜딩 페이지"), "neo-brutalism");
    for (const text of ["Build a settings page for a team workspace", "a dashboard for cold-chain trucks", "explain the SCRT process", "brutally honest copy"]) assert.equal(pick(text), null, text);
    assert.equal(initLock({ family: "workspace", dir: scratch(), brief: "브루탈리즘 대시보드" }).style.id, "computational-brutalism");
    assert.equal(initLock({ family: "landing", dir: scratch(), brief: "neo-brutalist launch page" }).style.id, "neo-brutalism");
    assert.equal(initLock({ family: "landing", dir: scratch(), brief: "a launch page" }).style.id, "field-notes", "no keyword keeps the family default");
    assert.equal(initLock({ family: "landing", dir: scratch(), styleId: "graphite", brief: "brutalist launch page" }).style.id, "graphite");
    const match = spawnSync(process.execPath, [join(skillRoot, "scripts/design-lock.mjs"), "match", "neo-brutalism 온보딩"], { encoding: "utf8" });
    assert.equal(match.status, 0, match.stderr);
    assert.match(match.stdout, /^neo-brutalism \(keyword/u);
  });

  it("keeps an existing page and refuses a silent style switch", () => {
    const dir = scratch();
    writeFileSync(join(dir, "index.html"), "<p>mine</p>");
    assert.equal(initLock({ styleId: "field-notes", family: "landing", dir, scaffold: true }).scaffolded, "kept existing index.html");
    assert.equal(readFileSync(join(dir, "index.html"), "utf8"), "<p>mine</p>");
    assert.throws(() => initLock({ styleId: "meadow", family: "landing", dir }), /already locks "field-notes"/u);
    assert.equal(initLock({ styleId: "meadow", family: "landing", dir, force: true }).style.id, "meadow");
  });

  it("locks a brand style from a file but never under a kit id", () => {
    const dir = scratch();
    const brand = structuredClone(kitStyles()[1]);
    writeFileSync(join(dir, "kit-id.json"), JSON.stringify(brand));
    assert.throws(() => initLock({ from: join(dir, "kit-id.json"), family: "landing", dir }), /reuses a kit style id/u);
    brand.id = "acme";
    brand.color.light.accent = "#0a7d32";
    writeFileSync(join(dir, "acme.json"), JSON.stringify(brand));
    initLock({ from: join(dir, "acme.json"), family: "landing", dir: join(dir, "site") });
    assert.equal(JSON.parse(readFileSync(join(dir, "site", LOCK_FILE), "utf8")).colors.light.accent, "#0a7d32");
  });

  it("answers list and refuses an unknown family on the command line", () => {
    const script = join(skillRoot, "scripts/design-lock.mjs");
    const list = spawnSync(process.execPath, [script, "list"], { encoding: "utf8" });
    assert.equal(list.status, 0, list.stderr);
    for (const id of ["field-notes", "graphite", "meadow", "computational-brutalism", "neo-brutalism", "landing", "workspace", "settings"]) assert.match(list.stdout, new RegExp(id, "u"));
    assert.match(list.stdout, /never: .*DS-007/u);
    const bad = spawnSync(process.execPath, [script, "init", "--style", "graphite", "--family", "poster", "--dir", scratch()], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--family must be one of landing, workspace, settings/u);
  });
});

describe("frontend-ui-ux kit: density", () => {
  // User rule (2026-10-25): rich is the default; a calm, minimal page only when the request asks.
  const lockOf = (dir) => JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8"));
  it("locks the rich register by default and the calm one only when the request asks for it", () => {
    for (const family of Object.keys(FAMILIES)) {
      const dir = scratch();
      initLock({ family, dir, brief: "a page for a harbour fee planner" });
      assert.equal(lockOf(dir).density, "rich", family);
    }
    for (const text of ["a minimal landing page", "keep it calm and quiet", "a restrained settings page", "미니멀한 랜딩 페이지", "차분한 대시보드", "절제된 톤의 소개 페이지"]) assert.equal(densityForBrief(text), "calm", text);
    for (const text of ["a launch page", "a dashboard for cold-chain trucks", "minimise the load time", "minimum order form"]) assert.equal(densityForBrief(text), "rich", text);
    const calm = scratch();
    initLock({ family: "landing", dir: calm, brief: "a minimal launch page" });
    assert.equal(lockOf(calm).density, "calm");
    const flag = scratch();
    initLock({ family: "landing", dir: flag, density: "calm" });
    assert.equal(lockOf(flag).density, "calm");
    assert.throws(() => initLock({ family: "landing", dir: scratch(), density: "sparse" }), /--density must be rich or calm/u);
    const match = spawnSync(process.execPath, [join(skillRoot, "scripts/design-lock.mjs"), "match", "미니멀한 소개 페이지"], { encoding: "utf8" });
    assert.match(match.stdout, /density: calm/u);
  });

  it("gives the rich register a tighter section rhythm, texture and a glow; the calm one keeps the broad flat page", () => {
    const fieldNotes = kitStyles().find((style) => style.id === "field-notes");
    const rich = tokensCss(fieldNotes, []);
    const calm = tokensCss(fieldNotes, [], "calm");
    assert.match(rich, /--density: "rich";/u);
    assert.match(calm, /--density: "calm";/u);
    const pad = (css) => [...css.matchAll(/--section-pad: (\d+)px/gu)].map((m) => Number(m[1]));
    assert.deepEqual(pad(calm), [64, 96, 128]);
    assert.ok(pad(rich).every((value, i) => value < pad(calm)[i]), `rich rhythm ${pad(rich)} must be tighter than ${pad(calm)}`);
    assert.match(rich, /--canvas-pattern: radial-gradient/u, "field-notes carries its notebook dots in the rich register");
    assert.match(calm, /--canvas-pattern: none;/u);
    assert.match(rich, /--glow: 0 0 \d+px/u);
    assert.match(calm, /--glow: none;/u);
    for (const id of ["computational-brutalism", "neo-brutalism"]) assert.match(tokensCss(kitStyles().find((style) => style.id === id), []), /--glow: none;/u, `${id} keeps its elevation grammar (DS-007)`);
  });

  it("ships a second accent family in every style, above the WCAG floors in both themes", () => {
    for (const role of ["accent-2", "accent-2-ink", "accent-2-wash", "on-accent-2"]) assert.ok(COLOR_ROLES.includes(role), role);
    for (const style of kitStyles()) {
      for (const theme of ["light", "dark"]) {
        const c = style.color[theme];
        for (const [fg, bg] of [["on-accent-2", "accent-2"], ["accent-2-ink", "canvas"], ["accent-2-ink", "surface"], ["accent-2-ink", "accent-2-wash"]]) {
          const ratio = contrast(c[fg], c[bg]);
          assert.ok(ratio >= 4.5, `${style.id} ${theme} ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
        }
        assert.ok(contrast(c["accent-2"], c.canvas) >= 3, `${style.id} ${theme} accent-2 reads as a surface on the canvas`);
        assert.notEqual(c["accent-2"], c.accent, `${style.id} ${theme}: a second family, not a copy`);
      }
    }
    const sheet = readFileSync(join(kit, "components.css"), "utf8");
    for (const part of [".ui-band", ".ui-band--accent-2", ".ui-wash", ".ui-glow", ".ui-panel--accent-2", ".ui-tag--accent-2"]) assert.ok(sheet.includes(part), part);
  });
});

describe("frontend-ui-ux kit: signature moment", () => {
  it("names a closed set of moments: bold ones for read-once pages, small ones for work surfaces", () => {
    assert.deepEqual(MOMENT_SCALE_BY_FAMILY, { landing: "bold", workspace: "small", settings: "small" });
    assert.deepEqual(MOMENT_KINDS.bold, ["hero-composition", "type-set-piece", "data-moment", "diagram", "motion-detail", "interactive-object"]);
    assert.deepEqual(MOMENT_KINDS.small, ["chart", "empty-state", "header-detail"]);
    assert.deepEqual(Object.keys(RULES["DS-008"].threshold.needs).sort(), [...MOMENT_KINDS.bold, ...MOMENT_KINDS.small].sort(), "the probe knows what every kind must contain");
  });

  it("records what the moment is and where it sits, and refuses a loud moment on a work surface", () => {
    const dir = scratch();
    initLock({ family: "landing", dir, moment: "hero-composition", momentNote: "pixel invoice stack beside the title", momentPlace: "hero art column" });
    const lock = JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8"));
    assert.deepEqual(lock.moment, { scale: "bold", kind: "hero-composition", note: "pixel invoice stack beside the title", place: "hero art column", selector: "[data-ui-moment]", above_fold: true });
    const work = scratch();
    initLock({ family: "workspace", dir: work });
    assert.deepEqual(JSON.parse(readFileSync(join(work, LOCK_FILE), "utf8")).moment, { scale: "small", kind: null, note: null, place: null, selector: "[data-ui-moment]", above_fold: false });
    assert.throws(() => initLock({ family: "workspace", dir: scratch(), moment: "hero-composition", momentNote: "x" }), /work surface takes a small moment: chart, empty-state, header-detail/u);
    assert.throws(() => initLock({ family: "landing", dir: scratch(), moment: "confetti", momentNote: "x" }), /unknown moment "confetti"/u);
    assert.throws(() => initLock({ family: "landing", dir: scratch(), moment: "diagram" }), /--moment-note/u);
    setMoment({ dir: work, kind: "chart", note: "deliveries per hour with the late-afternoon dip marked" });
    assert.equal(JSON.parse(readFileSync(join(work, LOCK_FILE), "utf8")).moment.kind, "chart");
    const cli = spawnSync(process.execPath, [join(skillRoot, "scripts/design-lock.mjs"), "moment", "--dir", work, "--kind", "empty-state", "--note", "no excursions today", "--place", "excursions panel"], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(readFileSync(join(work, LOCK_FILE), "utf8")).moment.place, "excursions panel");
    const list = spawnSync(process.execPath, [join(skillRoot, "scripts/design-lock.mjs"), "list"], { encoding: "utf8" });
    assert.match(list.stdout, /moments \(landing\): hero-composition, type-set-piece/u);
  });

  it("gives the moment its own type ceiling above the display range", () => {
    for (const style of kitStyles()) {
      assert.ok(style.type.moment_px.max > style.type.display_px.max, style.id);
      assert.deepEqual(lockRecord(style, "landing").type.moment_px, style.type.moment_px);
      assert.match(tokensCss(style, []), new RegExp(`--fs-moment: clamp\\(${style.type.display_px.min}px, .*, ${style.type.moment_px.max}px\\);`, "u"));
    }
    const broken = structuredClone(kitStyles()[0]);
    broken.type.moment_px.max = broken.type.display_px.max;
    assert.ok(validateStyle(broken).some((issue) => issue.includes("type.moment_px")));
  });

  it("marks the moment slot in every starter and documents the rule", () => {
    for (const family of Object.keys(FAMILIES)) assert.match(readFileSync(join(kit, "layouts", `${family}.html`), "utf8"), /data-ui-moment="\{\{/u, family);
    const doc = readFileSync(join(skillRoot, "references/house-styles.md"), "utf8");
    assert.match(doc, /## \d\. Signature moment/u);
    for (const kind of [...MOMENT_KINDS.bold, ...MOMENT_KINDS.small]) assert.ok(doc.includes(`\`${kind}\``), kind);
    assert.match(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), /--moment <kind> --moment-note "<what it is>"/u);
    assert.match(readFileSync(join(root, "plugins/litclaude/bin/litclaude-hook.js"), "utf8"), /one signature moment/u);
  });
});

describe("frontend-ui-ux kit: pixel-art.mjs", () => {
  it("turns a grid into crisp role-filled runs and refuses what would not read as pixel art", () => {
    const svg = pixelSvg("iia.\n.mm.", { label: "two rows", cell: 8 });
    assert.match(svg, /viewBox="0 0 4 2"/u);
    assert.match(svg, /<rect x="0" y="0" width="2" height="1" style="fill: var\(--c-ink\)"\/>/u);
    assert.match(svg, /fill: var\(--c-accent\)/u);
    assert.match(svg, /role="img" aria-label="two rows"/u);
    assert.doesNotMatch(svg, /#[0-9a-f]{6}/iu, "a motif inherits the lock instead of naming colours");
    assert.throws(() => pixelSvg("iq", { label: "x" }), /unknown grid character "q"/u);
    assert.throws(() => pixelSvg("ii", {}), /--label is required/u);
    assert.throws(() => pixelSvg("ii", { label: "x", cell: 4 }), /under 6 px/u);
  });
});

describe("frontend-ui-ux probe: design-lock rules", () => {
  it("registers DS-001 to DS-007 with the documented severities", () => {
    assert.deepEqual(Object.keys(RULES).filter((id) => id.startsWith("DS-")), ["DS-001", "DS-002", "DS-003", "DS-004", "DS-005", "DS-006", "DS-007", "DS-008"]);
    assert.deepEqual(["DS-001", "DS-002", "DS-003", "DS-004", "DS-005", "DS-006", "DS-007", "DS-008"].map((id) => RULES[id].severity), ["HIGH", "HIGH", "HIGH", "MEDIUM", "LOW", "HIGH", "MEDIUM", "HIGH"]);
    assert.match(RULES["CF-403"].note, /elevation "offset"/u);
    assert.equal(RULES["DS-003"].threshold.lowSeverity, "MEDIUM");
  });

  it("finds the lock beside the page and reports a broken one instead of skipping it", () => {
    const dir = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir, scaffold: true });
    const found = findLock({ root: dir, sourceRoot: dir });
    assert.equal(found.lock.style, "field-notes");
    const broken = scratch();
    writeFileSync(join(broken, LOCK_FILE), "{ not json");
    assert.match(findLock({ root: broken, sourceRoot: broken }).error, /unreadable/u);
    assert.equal(findLock({ root: scratch(), sourceRoot: null }).lock, null);
  });

  it("flags a leftover starter slot statically in HTML but not a framework template", () => {
    const dir = scratch();
    writeFileSync(join(dir, "index.html"), "<h1>{{Product}}</h1>");
    writeFileSync(join(dir, "App.vue"), "<template><p>{{count}}</p></template>");
    const result = staticProbe(dir);
    const hits = result.findings.filter((finding) => finding.rule === "DS-006");
    assert.equal(hits.length, 1);
    assert.match(hits[0].selector, /index\.html:1/u);
  });

  it("prints the LOOK questions with the screenshots a rendered run saved", () => {
    const table = renderTable({ manifest: { url: "http://127.0.0.1/", not_verified: [], screenshots: [{ viewport: "1440", path: "/tmp/s/1440.png" }, { viewport: "768", path: "/tmp/s/768.png" }], blocked_reason: null }, findings: [] });
    assert.match(table, /- 1440: \/tmp\/s\/1440\.png/u);
    assert.doesNotMatch(table, /768\.png/u);
    for (const [id] of LOOK_RUBRIC) assert.match(table, new RegExp(`^${id} `, "mu"));
    assert.match(table, /Verdict: Approve \(0 HIGH\)$/u, "the verdict line stays last for the stop gate");
    assert.doesNotMatch(renderTable({ manifest: { url: null, not_verified: [], screenshots: [], blocked_reason: "browser unavailable" }, findings: [] }), /LOOK-1/u);
  });
});

const driver = probeBrowserDriver();
const browserSkip = ["available", "beyond-verified"].includes(driver.status) ? false : `agent-browser is not usable here (${driver.blocker})`;

describe("frontend-ui-ux probe: rendered lock conformance", { skip: browserSkip }, () => {
  const page = (body, extraCss = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lock fixture</title>
<link rel="stylesheet" href="ui/tokens.css"><link rel="stylesheet" href="ui/components.css"><style>${extraCss}</style></head><body><main class="ui-container ui-stack" id="main">${body}</main></body></html>`;
  const runProbe = (dir) => {
    const out = join(dir, "evidence");
    mkdirSync(out, { recursive: true });
    const run = spawnSync(process.execPath, [probe, dir, "--out", out, "--viewports", "1440"], { encoding: "utf8", timeout: 300_000, env: { ...process.env, AGENT_BROWSER_ARGS: "--use-mock-keychain,--password-store=basic" } });
    return { ...run, report: JSON.parse(readFileSync(join(out, "findings.json"), "utf8")) };
  };

  it("passes a page built from the kit without any DS finding", () => {
    const dir = scratch();
    initLock({ styleId: "graphite", family: "workspace", dir, moment: "header-detail", momentNote: "loan count beside the title" });
    writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1">Branch loans</h1><p class="ui-lead">Loans per branch today.</p><div class="ui-panel" data-ui-moment="header-detail"><div class="ui-stat"><p class="ui-stat__label">Items lent</p><div class="ui-stat__value">1,284</div></div><button class="ui-btn ui-btn--primary" type="button">Export</button></div>`));
    const run = runProbe(dir);
    assert.equal(run.report.manifest.design_lock.style, "graphite");
    assert.deepEqual(run.report.findings.filter((finding) => finding.rule.startsWith("DS-")), [], run.stdout);
  });

  it("reports a page that drifts off its lock in font, colour, size and slots", () => {
    const dir = scratch();
    initLock({ styleId: "graphite", family: "workspace", dir });
    writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1">{{Screen title}}</h1><p class="drift">Off-lock copy</p><div class="chip a">One</div><div class="chip b">Two</div><div class="chip c">Three</div><div class="chip d">Four</div>`,
      ".drift { font-family: Georgia, serif; font-size: 15px; color: #7a1fa2; } .chip { padding: 8px; border-radius: 5px; } .a { background: #ff00aa; } .b { background: #00c2ff; } .c { background: #ffcc00; } .d { background: #22aa22; }"));
    const run = runProbe(dir);
    const rules = new Set(run.report.findings.map((finding) => finding.rule));
    for (const rule of ["DS-002", "DS-003", "DS-004", "DS-005", "DS-006"]) assert.ok(rules.has(rule), `${rule} must fire\n${run.stdout}`);
    assert.equal(run.report.findings.find((finding) => finding.rule === "DS-003").severity, "HIGH", "four or more off-palette colours are HIGH");
    assert.equal(run.status, 1);
  });

  it("accepts the neo-brutalist offset register a lock records and still catches blur inside it", () => {
    const dir = scratch();
    initLock({ styleId: "neo-brutalism", family: "landing", dir, moment: "hero-composition", momentNote: "sticker on the line-up block" });
    const body = `<h1 class="ui-h1">Club nights</h1><div class="ui-panel" data-ui-moment="hero-composition" style="min-height: 240px"><svg width="240" height="120" role="img" aria-label="Two rooms"><rect width="120" height="120" style="fill: var(--c-support)"/></svg><p>Two rooms, one list.</p></div><div class="ui-panel ui-panel--accent"><p>Doors at nine.</p></div><span class="ui-sticker">Free before ten</span><button class="ui-btn ui-btn--primary" type="button">Get the list</button>`;
    writeFileSync(join(dir, "index.html"), page(body));
    const clean = runProbe(dir);
    assert.ok(!clean.report.findings.some((finding) => finding.rule === "CF-403"), `the lock records the register\n${clean.stdout}`);
    assert.deepEqual(clean.report.findings.filter((finding) => finding.rule.startsWith("DS-")), [], clean.stdout);
    writeFileSync(join(dir, "index.html"), page(body, ".ui-sticker { box-shadow: 0 8px 24px var(--c-ink); }"));
    assert.ok(runProbe(dir).report.findings.some((finding) => finding.rule === "DS-007"), "blur inside an offset lock is DS-007");
  });

  it("holds a flat computational-brutalism lock to rings and still reports offset shadows on a soft lock", () => {
    const flat = scratch();
    initLock({ styleId: "computational-brutalism", family: "workspace", dir: flat, moment: "header-detail", momentNote: "core readout framed under the title" });
    writeFileSync(join(flat, "index.html"), page(`<h1 class="ui-h1">Reactor bay</h1><div class="ui-frame" data-ui-moment="header-detail"><span class="ui-coord">X 024 / Y 118</span><div class="ui-readout ui-scan">CORE 312.4 K</div></div><div class="ui-panel lifted"><p>Loop B nominal.</p></div>`, ".lifted { box-shadow: 0 4px 12px var(--c-line-strong); }"));
    const run = runProbe(flat);
    assert.deepEqual(run.report.findings.filter((finding) => finding.rule.startsWith("DS-")).map((finding) => finding.rule), ["DS-007"], run.stdout);
    const soft = scratch();
    initLock({ styleId: "graphite", family: "workspace", dir: soft });
    writeFileSync(join(soft, "index.html"), page(`<h1 class="ui-h1">Branch loans</h1><div class="ui-panel hard"><p>One card with a hard shadow.</p></div>`, ".hard { box-shadow: 4px 4px 0 var(--c-ink); }"));
    assert.ok(runProbe(soft).report.findings.some((finding) => finding.rule === "CF-403"), "a soft lock records no register");
  });

  it("fails a read-once page with no signature moment, a buried one or a gradient-and-centred-text hero (DS-008)", () => {
    const motif = pixelSvg("iiiiii\niaaaai\niiiiii", { label: "An invoice stack", cell: 48 });
    const hero = (inner, css = "") => page(`<section class="ui-hero"><div class="ui-split"><div class="ui-hero__copy"><h1 class="ui-display">Bill every hour</h1><p class="ui-lead">Hours in, invoices out.</p></div>${inner}</div></section>`, css);
    const ds008 = (dir) => runProbe(dir).report.findings.filter((finding) => finding.rule === "DS-008");

    const undeclared = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir: undeclared });
    writeFileSync(join(undeclared, "index.html"), hero(`<div class="ui-hero__art">${motif}</div>`));
    assert.match(ds008(undeclared).map((finding) => finding.value).join("\n"), /declares no signature moment/u);

    const legacy = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir: legacy });
    const old = JSON.parse(readFileSync(join(legacy, "design.lock.json"), "utf8"));
    delete old.moment;
    writeFileSync(join(legacy, "design.lock.json"), JSON.stringify(old, null, 2));
    writeFileSync(join(legacy, "index.html"), hero(`<div class="ui-hero__art">${motif}</div>`));
    const stale = ds008(legacy);
    assert.equal(stale[0]?.severity, "HIGH", "a lock written before signature moments does not pass a page without one");
    assert.match(stale[0].value, /predates signature moments/u);

    const missing = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir: missing, moment: "hero-composition", momentNote: "invoice stack" });
    writeFileSync(join(missing, "index.html"), hero(`<div class="ui-hero__art">${motif}</div>`));
    const absent = ds008(missing);
    assert.equal(absent[0]?.severity, "HIGH");
    assert.match(absent[0].value, /no \[data-ui-moment\]/u);

    writeFileSync(join(missing, "index.html"), hero(`<div class="ui-hero__art" data-ui-moment="hero-composition">${motif}</div>`));
    assert.deepEqual(ds008(missing), [], "a declared, present, above-the-fold composition passes");

    writeFileSync(join(missing, "index.html"), hero(`<div class="ui-hero__art"><div style="height: 1400px"></div><div data-ui-moment="hero-composition">${motif}</div></div>`));
    assert.match(ds008(missing).map((finding) => finding.value).join("\n"), /below the fold/u);

    const generic = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir: generic, moment: "type-set-piece", momentNote: "headline" });
    writeFileSync(join(generic, "index.html"), page(`<section class="ui-hero" data-ui-moment="type-set-piece" style="text-align: center; background-image: linear-gradient(135deg, var(--c-accent), var(--c-support)); min-height: 520px"><h1 class="ui-display">Bill every hour</h1><p class="ui-lead">Hours in, invoices out.</p></section>`));
    assert.match(ds008(generic).map((finding) => finding.value).join("\n"), /generic gradient-and-centred-text hero/u);

    const hollow = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir: hollow, moment: "data-moment", momentNote: "fee burn" });
    writeFileSync(join(hollow, "index.html"), hero(`<div class="ui-hero__art" data-ui-moment="data-moment" style="min-height: 320px"><p>Fee burn</p></div>`));
    assert.match(ds008(hollow).map((finding) => finding.value).join("\n"), /data-moment.*holds no/u);
  });

  it("lets the moment use its own type ceiling and nothing else on the page", () => {
    const dir = scratch();
    initLock({ styleId: "field-notes", family: "landing", dir, moment: "type-set-piece", momentNote: "the fee figure set huge" });
    writeFileSync(join(dir, "index.html"), page(`<div data-ui-moment="type-set-piece" style="min-height: 240px"><p class="ui-setpiece">92 %</p></div><p class="ui-setpiece">Outside</p>`));
    const findings = runProbe(dir).report.findings;
    const ds004 = findings.filter((finding) => finding.rule === "DS-004");
    assert.equal(ds004.length, 1, JSON.stringify(findings));
    assert.match(ds004[0].selector, /^p\.ui-setpiece$/u);
    assert.deepEqual(findings.filter((finding) => finding.rule === "DS-008"), []);
  });

  it("reports DS-001 when the page never loads the generated tokens", () => {
    const dir = scratch();
    initLock({ styleId: "meadow", family: "landing", dir });
    writeFileSync(join(dir, "index.html"), "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>No tokens</title></head><body><main><h1>Plain page</h1></main></body></html>");
    const run = runProbe(dir);
    assert.ok(run.report.findings.some((finding) => finding.rule === "DS-001" && finding.severity === "HIGH"), run.stdout);
  });
});

describe("frontend-ui-ux: the lock is enrolled where a run reads", () => {
  it("names the lock step in SKILL.md, the hook's mode contract, the reference router and the craft floor", () => {
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
    assert.match(skill, /scripts\/design-lock\.mjs" init --family <landing\|workspace\|settings> \[--style <field-notes\|graphite\|meadow\|computational-brutalism\|neo-brutalism>\] \[--brief "<the request>"\]/u);
    assert.match(skill, /`computational-brutalism` and `neo-brutalism` are opt-in only, never defaults/u);
    assert.match(skill, /references\/house-styles\.md/u);
    assert.match(skill, /LOOK-1 to LOOK-6/u);
    const hook = readFileSync(join(root, "plugins/litclaude/bin/litclaude-hook.js"), "utf8");
    assert.match(hook, /scripts\/design-lock\.mjs init/u);
    assert.match(hook, /answer its LOOK questions/u);
    assert.match(readFileSync(join(skillRoot, "references/complete-contract.md"), "utf8"), /\| `references\/house-styles\.md` \|/u);
    assert.match(readFileSync(join(skillRoot, "references/craft-floor.md"), "utf8"), /DS-\* lock rules/u);
  });

  it("ships every kit file in the generated skill resource list", () => {
    const resources = readFileSync(join(root, "plugins/litclaude/lib/canonical-skill-resources.mjs"), "utf8");
    const kitFiles = ["kit/components.css", "kit/ui.js", "kit/fonts.json", "kit/styles/field-notes.json", "kit/styles/graphite.json", "kit/styles/meadow.json", "kit/styles/computational-brutalism.json", "kit/styles/neo-brutalism.json", "kit/layouts/landing.html", "kit/layouts/workspace.html", "kit/layouts/settings.html", "scripts/design-lock.mjs", "scripts/pixel-art.mjs", "scripts/interface-probe-lock.mjs", "references/house-styles.md"];
    for (const file of kitFiles) assert.ok(resources.includes(`skills/frontend-ui-ux/${file}`), `${file} is not pinned for install`);
  });
});
