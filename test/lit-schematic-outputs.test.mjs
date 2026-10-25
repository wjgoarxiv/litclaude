import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderInteractive } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/interactive.mjs";
import { createIsoView } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/iso.mjs";
import { createFigure } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/figure.mjs";
import { check } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/qa-core.mjs";
import { diagnose } from "../plugins/litclaude/skills/lit-schematic/scripts/doctor.mjs";
import { renderMotion } from "../plugins/litclaude/skills/lit-schematic/scripts/motion.mjs";
import { rasterScale } from "../plugins/litclaude/skills/lit-schematic/scripts/render.mjs";
import { crc32, inkGrid, missingInk } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/png.mjs";
import { deflateSync } from "node:zlib";
import { scaffold } from "../plugins/litclaude/skills/lit-schematic/scripts/scaffold.mjs";
import { LAYERS, MOVES, ORDER, VIEWS, frame, scene } from "../plugins/litclaude/skills/lit-schematic/examples/iso-heat-exchanger/scene.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const hookSkills = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const activation = context.split("\n\n## Project Instructions\n", 1)[0];
  return [...new Set([...activation.matchAll(/Skill\(([a-z-]+)\)/gu)].map((match) => match[1]))];
};

describe("lit-schematic cutaway scene", () => {
  it("draws every part with its assembly group and keeps the exploded parts in frame", () => {
    const { svg, view } = scene({ reach: true });
    for (const group of ["shell", "bundle", "front", "rear", "support"]) assert.match(svg, new RegExp(`data-group="${group}"`, "u"), group);
    const v = view.screenVector(MOVES.front);
    assert.ok(Math.hypot(v[0], v[1]) > 10, "the front head moves a visible distance");
    assert.equal(check(svg).verdict, "PASS");
  });

  it("closes the motion loop: the first and last states match and the flow advances whole periods", () => {
    const at = (t) => frame(t).replace(/stroke-dashoffset="[^"]*"/gu, "");
    assert.equal(at(0), at(1), "frame(1) is frame(0) apart from the dash phase");
    assert.notEqual(at(0), at(0.5), "the loop moves");
    assert.doesNotMatch(frame(0.5), /data-leader=/u, "films carry no callouts");
  });
});

describe("lit-schematic interactive page", () => {
  const views = VIEWS.slice(0, 2).map(({ id, label, azimuth, elevation }) => {
    const drawn = scene({ azimuth, elevation, reach: true });
    return { id, label, svg: drawn.svg, explode: Object.fromEntries(Object.entries(MOVES).map(([g, m]) => [g, drawn.view.screenVector(m)])) };
  });
  const html = renderInteractive({ title: "Exchanger", description: "Test page", views, layers: LAYERS, order: ORDER });

  it("is one self-contained file", () => {
    assert.doesNotMatch(html, /<link\b|\bsrc=|@import|url\(\s*['"]?(?!#|data:)/iu, "no external resource");
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<)]+/gu)].map((m) => m[0]);
    assert.deepEqual([...new Set(urls)], ["http://www.w3.org/2000/svg"], "only the SVG namespace");
  });

  it("offers views, an exploded view and layers as accessible controls", () => {
    for (const v of views) assert.match(html, new RegExp(`data-view-button="${v.id}"[^>]*aria-pressed=`, "u"));
    assert.match(html, /id="explode" aria-pressed="false" aria-keyshortcuts="E"/u);
    for (const l of LAYERS) assert.match(html, new RegExp(`<input type="checkbox" checked data-layer="${l.group}"`, "u"));
    assert.match(html, /aria-live="polite"/u);
    assert.match(html, /prefers-reduced-motion/u);
    assert.match(html, /:focus-visible/u);
    assert.match(html, /setAttribute\("tabindex", "0"\)/u, "callout labels become focusable");
    assert.match(html, /e\.repeat/u, "a held key toggles once");
    assert.match(html, /\.stage svg\{[^}]*max-height:max\(\d+px, calc\(100vh - \d+px\)\)/u, "the whole machine fits the window under the controls");
  });

  it("carries each view's explode vectors and the leave order, and opens in a state from the hash", () => {
    const data = JSON.parse(html.match(/<script type="application\/json" id="lit-data">([^<]*)<\/script>/u)[1]);
    assert.deepEqual(data.order, ORDER);
    assert.equal(data.views.length, 2);
    for (const v of data.views) for (const g of ORDER) assert.equal(v.explode[g].length, 2);
    assert.notDeepEqual(data.views[0].explode.front, data.views[1].explode.front, "screen moves differ per view");
    assert.match(html, /URLSearchParams\(location\.hash/u);
  });

  it("refuses a page without views", () => {
    assert.throws(() => renderInteractive({ title: "x", views: [] }), /at least one view/u);
  });
});

describe("lit-schematic motion export", () => {
  it("stops with a named blocker instead of installing a missing encoder", () => {
    const out = mkdtempSync(join(tmpdir(), "lit-schematic-motion-test-"));
    try {
      assert.throws(() => renderMotion({ frame: () => "<svg/>", out, which: () => null, chromePath: "/bin/true" }), /ENCODER_REQUIRED ffmpeg not found\. This script never installs software/u);
      assert.throws(() => renderMotion({ frame: () => "<svg/>", out, chromePath: null }), /RENDERER_REQUIRED/u);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("reports the encoders in the doctor without making them required", () => {
    const report = diagnose({ out: tmpdir(), env: { PATH: "" } });
    const ids = report.checks.map((c) => c.id);
    assert.ok(ids.includes("motion.ffmpeg") && ids.includes("motion.webp"));
    assert.notEqual(report.status, "BLOCKED", "motion tools never block drawing");
  });
});

describe("lit-schematic raster size", () => {
  it("lowers the dpi of a sheet too large for one browser frame instead of returning a cut-off image", () => {
    const mm = 96 / 25.4;
    const a3 = rasterScale(Math.ceil(420 * mm), Math.ceil(297 * mm), 600);
    assert.equal(a3.dpi, 600, "A3 at 600 dpi still fits");
    const a2 = rasterScale(Math.ceil(594 * mm), Math.ceil(420 * mm), 600);
    assert.ok(a2.dpi < 600 && a2.dpi >= 400, `A2 drops to ${a2.dpi} dpi`);
    assert.ok(Math.ceil(594 * mm) * Math.ceil(420 * mm) * a2.scale ** 2 <= 80e6);
  });

  it("finds the regions a cut-off render left blank, so an empty sheet cannot pass", () => {
    // A grey RGB PNG whose rows below `paintedRows` are white, like a screenshot Chrome stopped painting.
    const png = (w, h, paintedRows) => {
      const rows = [];
      for (let y = 0; y < h; y++) {
        const row = Buffer.alloc(1 + w * 3, y < paintedRows ? 90 : 255);
        row[0] = 0;
        rows.push(row);
      }
      const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, "latin1");
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 0);
        return Buffer.concat([head, data, crc]);
      };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(h, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
    };
    const whole = inkGrid(png(120, 120, 120));
    assert.ok(whole.every((v) => v > 0.9));
    assert.deepEqual(missingInk(whole, inkGrid(png(240, 240, 240))), [], "a complete render at a higher dpi passes");
    const cut = missingInk(whole, inkGrid(png(240, 240, 20)));
    assert.equal(cut.length, 30, "only the top row of cells was painted");
  });
});

describe("lit-schematic cutaway routes and scaffold", () => {
  it("keeps a cutaway asked for as a film or a page with lit-schematic", () => {
    assert.deepEqual(hookSkills("lit 오토클레이브 컷어웨이를 모션 영상으로 만들어줘"), ["lit-schematic"]);
    assert.deepEqual(hookSkills("lit make an interactive html cutaway of the reactor"), ["lit-schematic"]);
    assert.deepEqual(hookSkills("lit draw an animated cutaway of the autoclave as an mp4"), ["lit-schematic"]);
    assert.deepEqual(hookSkills("lit 우리 제품 소개 영상 만들어줘"), ["lit-typographic-motion"]);
  });

  it("scaffolds the iso scene next to its build, wired to the installed kit", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-schematic-scaffold-iso-"));
    try {
      scaffold("iso", dir);
      assert.ok(existsSync(join(dir, "scene.mjs")));
      const sceneText = readFileSync(join(dir, "scene.mjs"), "utf8");
      const buildText = readFileSync(join(dir, "build.mjs"), "utf8");
      assert.doesNotMatch(sceneText + buildText, /"\.\.\/\.\.\/scripts\//u, "no relative kit imports left");
      assert.match(buildText, /import \{ renderInteractive \} from "file:\/\//u);
      const run = spawnSync(process.execPath, [join(dir, "build.mjs"), dir], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.ok(existsSync(join(dir, "iso-heat-exchanger.svg")));
      assert.throws(() => scaffold("iso", dir), /already exists/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lit-schematic callout spacing", () => {
  it("warns when two dots are too close for any label order", () => {
    const v = createIsoView({ azimuth: 40, elevation: 26 });
    const body = v.lathe({ name: "body", axis: "z", profile: [[0, 0], [0, 30], [100, 30], [100, 0]] });
    v.callout({ part: body, at: body.anchor(0.5), text: "Body", side: "right" });
    v.callout({ part: body, at: body.anchor(0.505), text: "Same spot", side: "right" });
    const fig = createFigure({ width: "single", height: 70, title: "Crowded" });
    fig.panel(null, [0, 0, 85, 70]).iso(v);
    const svg = fig.render();
    assert.ok(fig.warnings().some((w) => /closer than 1\.4 mm/u.test(w)), "the placer says it could not clear them");
    assert.ok(check(svg).findings.some((f) => f.code === "LEADER.SPACING"), "and the gate fails them");
  });
});
