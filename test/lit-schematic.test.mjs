import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { LIT_SKILL_IDS } from "../plugins/litclaude/lib/mod/skills.mjs";
import { parseEquipmentTag, parseInstrumentTag } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/isa.mjs";
import * as S from "../plugins/litclaude/skills/lit-schematic/scripts/lib/pid.mjs";
import { routeOrthogonal } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/route.mjs";
import { createCanvas, createSheet } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/sheet.mjs";
import { createFigure } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/figure.mjs";
import { createIsoView } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/iso.mjs";
import { check, deltaE, pathPolylines } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/qa-core.mjs";
import { pngInfo, withDpi } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/png.mjs";
import { CHROME_FLAGS } from "../plugins/litclaude/skills/lit-schematic/scripts/render.mjs";
import { checkExports } from "../plugins/litclaude/skills/lit-schematic/scripts/qa.mjs";
import { scaffold } from "../plugins/litclaude/skills/lit-schematic/scripts/scaffold.mjs";
import { STREAM } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/theme.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const skillRoot = join(pluginRoot, "skills", "lit-schematic");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const skillFiles = walk(skillRoot).map((file) => relative(skillRoot, file).replaceAll("\\", "/"));
const body = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
const codes = (svg, options) => check(svg, options).findings.filter((f) => f.level === "FAIL").map((f) => f.code);

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

// A minimal kit-shaped SVG for foils: a 100 x 60 mm figure in the given mode.
const doc = (inner, { mode = "figure", extra = "" } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60" data-schematic-mode="${mode}"${extra}>${inner}</svg>`;
const box = (x0, y0, x1, y1, ports = "", kind = "valve.gate", tag = "") =>
  `<g data-sym="${kind}"${tag ? ` data-tag="${tag}"` : ""} data-box="${x0} ${y0} ${x1} ${y1}" data-ports="${ports}" stroke="#000" stroke-width="0.35" fill="none"><path d="M${x0} ${y0}H${x1}V${y1}H${x0}Z"/></g>`;
const line = (d, id = "L1", kind = "process-major") => `<path data-line="${kind}" data-line-id="${id}" d="${d}" stroke="#000" stroke-width="0.35" fill="none"/>`;
const label = (x, y, text, size = 2.5) => `<text x="${x}" y="${y}" font-size="${size}" font-family="Arial">${text}</text>`;

describe("lit-schematic enrollment", () => {
  it("is in the skill catalog, the LIT card list, the pinned trees and the resource hash manifest", () => {
    assert.ok(canonicalSkillIds.includes("lit-schematic"));
    assert.ok(LIT_SKILL_IDS.includes("lit-schematic"));
    assert.match(readFileSync(join(root, "tools", "gen-canonical-skill-resources.mjs"), "utf8"), /"skills\/lit-schematic",/u);
    for (const file of skillFiles) {
      assert.ok(canonicalSkillResourceManifest.has(`skills/lit-schematic/${file}`), `unpinned resource ${file}`);
    }
    const parity = JSON.parse(readFileSync(join(root, "tools", "payload-substance-parity.json"), "utf8"));
    assert.ok(parity.products.p27.skills.includes("lit-schematic"));
  });

  it("is wired to the prompt hook and documented in both guides, both skills pages, both READMEs, the hook guide and the changelog", () => {
    const hook = readFileSync(hookPath, "utf8");
    assert.match(hook, /"lit-schematic": \{ command: "\/litclaude:lit-schematic"/u);
    assert.match(hook, /"lit-schematic": "Mode contract: lit-schematic/u);
    for (const doc0 of ["docs/guide.md", "docs/guide_ko-KR.md", "docs/skills.md", "docs/skills_ko-KR.md", "docs/hooks.md", "README.md", "README_ko-KR.md", "CHANGELOG.md"]) {
      assert.match(readFileSync(join(root, doc0), "utf8"), /lit-schematic/u, `${doc0} must document the skill`);
    }
    assert.ok(existsSync(join(root, "docs", "assets", "skills", "lit-schematic.webp")), "skills page snapshot");
  });

  it("points to its neighbours and they point back", () => {
    assert.match(body, /`lit-diagram-drawer`/u);
    assert.match(body, /`lit-scientific-visualization`/u);
    for (const neighbour of ["lit-diagram-drawer", "lit-scientific-visualization"]) {
      assert.match(readFileSync(join(pluginRoot, "skills", neighbour, "SKILL.md"), "utf8"), /lit-schematic/u, neighbour);
    }
  });
});

describe("lit-schematic routes", () => {
  it("activates on its tokens and on lit prompts that ask to draw real equipment", () => {
    for (const prompt of [
      "lit-schematic hydrate reactor loop",
      "$lit-schematic 실험 장치 모식도",
      "lit 고압 하이드레이트 반응기 루프 P&ID 그려줘",
      "lit draw a two-panel journal figure of the experimental setup",
      "lit isometric cutaway of a stirred autoclave",
      "lit 논문용 실험 장치 모식도 만들어줘",
      "lit draw the PFD for the absorber section",
    ]) {
      const { skills, context } = hookSkills(prompt);
      assert.deepEqual(skills, ["lit-schematic"], prompt);
      assert.match(context, /<litclaude-skill-body name="lit-schematic">/u);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${prompt}: activation within 4096 bytes`);
    }
  });

  it("activates on Korean drawing nouns, with or without a verb where the noun names a drawing", () => {
    for (const prompt of [
      "lit 장비 레이아웃 도면 그려줘",
      "lit 반응기 단면도",
      "lit 공정 계통도",
      "lit 공장 배치도 그려줘",
      "lit 냉각수 계통도 그려줘",
      "lit 실험 장치 그림 그려줘",
      "lit 공정 흐름도 그려줘",
      "lit draw the plot plan for the tank farm",
    ]) {
      assert.deepEqual(hookSkills(prompt).skills, ["lit-schematic"], prompt);
    }
  });

  it("keeps Korean documents, decks, charts and interfaces with their owners", () => {
    for (const [prompt, expected] of [
      ["lit 도면 검토 보고서 작성해줘", ["lit-docx"]],
      ["lit 공정도 설명 보고서 작성해줘", ["lit-docx"]],
      ["lit 배치도 설명 발표자료 만들어줘", ["lit-pptx"]],
      ["lit 계통도 요약 슬라이드 만들어줘", ["lit-pptx"]],
      ["lit 배치도를 보여주는 대시보드 화면 만들어줘", ["frontend-ui-ux"]],
      ["lit 계통도 모니터링 페이지 디자인해줘", ["frontend-ui-ux"]],
    ]) {
      assert.deepEqual(hookSkills(prompt).skills, expected, prompt);
    }
    for (const prompt of ["lit 단면도 데이터로 그래프 그려줘", "lit 실험 장치 온도 차트 그려줘", "lit plot the P&ID loop pressure graph", "lit 도면 번호 체계 정리해줘"]) {
      assert.ok(!hookSkills(prompt).skills.includes("lit-schematic"), prompt);
    }
  });

  it("leaves documents, interfaces, schema work and tokenless prompts to their owners", () => {
    assert.deepEqual(hookSkills("lit P&ID 설명 보고서 작성해줘").skills, ["lit-docx"]);
    assert.deepEqual(hookSkills("lit make a report about the P&ID").skills, ["lit-docx"]);
    assert.deepEqual(hookSkills("lit design an isometric hero illustration for the landing page").skills, ["frontend-ui-ux"]);
    // An interface that shows a drawing is an interface; the drawing inside it is drawn here.
    assert.deepEqual(hookSkills("lit build a dashboard showing the P&ID of the reactor").skills, ["frontend-ui-ux"]);
    assert.deepEqual(hookSkills("lit P&ID 모니터링 대시보드 만들어줘").skills, ["frontend-ui-ux"]);
    for (const prompt of ["lit draw a P&ID of the reactor loop", "lit draw the P&ID that goes on the dashboard", "lit make the equipment layout for the compressor house"]) {
      assert.deepEqual(hookSkills(prompt).skills, ["lit-schematic"], prompt);
    }
    for (const prompt of ["lit fix the database schema migration", "draw a P&ID of the reactor", "the lit-schematic skill is new", "lit-diagram-drawer draw the service deployment boundary"]) {
      assert.ok(!hookSkills(prompt).skills.includes("lit-schematic"), prompt);
    }
  });
});

describe("lit-schematic payload closure and density", () => {
  it("names every reference, script and example it ships, and ships every one it names", () => {
    const named = [...body.matchAll(/`((?:references|scripts|examples)\/[A-Za-z0-9._/-]+)`/gu)].map((m) => m[1]);
    for (const path of named) assert.ok(existsSync(join(skillRoot, path)), `SKILL.md names missing ${path}`);
    for (const file of skillFiles.filter((f) => /^(?:references\/|scripts\/[^/]+\.mjs$|examples\/)/u.test(f))) {
      const short = file.replace(/^scripts\/lib\//u, "");
      assert.ok(named.includes(file) || body.includes(`\`${short}\``) || body.includes(file), `orphan resource ${file}`);
    }
  });

  it("keeps the skill dense and contract-shaped", () => {
    const words = (text) => text.split(/\s+/u).filter(Boolean).length;
    assert.ok(words(body) >= 1500, `SKILL.md has ${words(body)} words`);
    for (const ref of readdirSync(join(skillRoot, "references"))) {
      const text = readFileSync(join(skillRoot, "references", ref), "utf8");
      assert.ok(words(text) >= 650, `${ref} has ${words(text)} words`);
      assert.match(text, /^## Contents$/mu, `${ref} has a contents list`);
    }
    for (const heading of ["## #contract.activation", "## #contract.inputs", "## #contract.mode_matrix", "## #contract.procedure", "## #contract.outputs", "## #contract.evidence", "## #contract.hard_stops", "## #contract.anti_patterns"]) {
      assert.ok(body.includes(heading), heading);
    }
  });

  it("never names a sibling product, the umbrella tree or the reference checkout", () => {
    for (const file of skillFiles) {
      const text = readFileSync(join(skillRoot, file), "utf8");
      assert.doesNotMatch(text, /\blit(?:hermes|codex|opencode|grok|muse|gravity)\b|27_LITFAMILY|plans\/2026|ref-anatomy|wheresryan22/iu, file);
    }
  });
});

describe("lit-schematic tag grammar", () => {
  it("reads ISA-5.1 tags and refuses broken ones", () => {
    for (const tag of ["PIC-101", "PT-101", "PSV-101", "PSE-101", "PAHH-101", "PDT-12", "TIC-201", "FQI-3", "LSL-5", "TT-101A", "ZSO-7", "XV-2", "AT-1", "HS-4"]) {
      assert.ok(parseInstrumentTag(tag).ok, tag);
    }
    assert.equal(parseInstrumentTag("PSV-101").meaning, "pressure safety valve");
    assert.equal(parseInstrumentTag("PIC-101").meaning, "pressure indicating controlling");
    for (const tag of ["PCI-101", "TTT-1", "PH-1", "pic101", "Ø-1", "PIC"]) assert.ok(!parseInstrumentTag(tag).ok, tag);
    assert.ok(parseEquipmentTag("R-101").ok && parseEquipmentTag("P-101A").ok && parseEquipmentTag("TK-201").ok);
    assert.ok(!parseEquipmentTag("Reactor 1").ok);
    assert.throws(() => S.instrument({ x: 0, y: 0, tag: "PCI-1" }), /instrument tag/u);
  });
});

describe("lit-schematic symbols and routing", () => {
  const factories = {
    vessel: () => S.vessel({ x: 50, y: 50, jacket: true, agitator: "turbine", supports: "legs" }),
    drum: () => S.drum({ x: 50, y: 50 }),
    tank: () => S.tank({ x: 50, y: 50 }),
    cylinder: () => S.gasCylinder({ x: 50, y: 50 }),
    pump: () => S.pump({ x: 50, y: 50, type: "metering" }),
    compressor: () => S.compressor({ x: 50, y: 50, type: "reciprocating" }),
    exchanger: () => S.exchanger({ x: 50, y: 50 }),
    shellTube: () => S.shellTube({ x: 50, y: 50 }),
    plate: () => S.plateExchanger({ x: 50, y: 50 }),
    unit: () => S.unit({ x: 50, y: 50, caption: "CH", ports: { supply: ["right", 0.3], ret: ["right", 0.7] } }),
    controlValve: () => S.valve({ x: 50, y: 50, type: "globe", actuator: "diaphragm", fail: "FC", orient: "up" }),
    threeway: () => S.valve({ x: 50, y: 50, type: "threeway" }),
    regulator: () => S.regulator({ x: 50, y: 50, backPressure: true }),
    psv: () => S.safetyValve({ x: 50, y: 50 }),
    mfc: () => S.mfc({ x: 50, y: 50 }),
    instrument: () => S.instrument({ x: 50, y: 50, tag: "PIC-101", location: "dcs" }),
    offPage: () => S.offPage({ x: 50, y: 50, text: "TO FLARE" }),
  };
  it("gives every symbol a box and ports on its boundary with outward normals", () => {
    for (const [name, make] of Object.entries(factories)) {
      const sym = make();
      const [x0, y0, x1, y1] = sym.box;
      assert.ok(x1 > x0 && y1 > y0, `${name} box`);
      for (const p of sym.allPorts) {
        const inside = p.x >= x0 - 0.01 && p.x <= x1 + 0.01 && p.y >= y0 - 0.01 && p.y <= y1 + 0.01;
        assert.ok(inside, `${name}.${p.name} lies inside its box`);
        assert.equal(Math.abs(p.dir[0]) + Math.abs(p.dir[1]), 1, `${name}.${p.name} normal is axis-aligned`);
      }
      assert.match(sym.svg(), /data-sym="[a-z.-]+"[^>]*data-box="[\d. |-]+"[^>]*data-ports="/u, `${name} markers`);
    }
  });

  it("routes around symbols, crosses lines square and refuses to run along them", () => {
    const obstacle = [60, 30, 80, 70];
    const points = routeOrthogonal({ from: { x: 20, y: 50, dir: [1, 0] }, to: { x: 120, y: 50, dir: [-1, 0] }, obstacles: [obstacle], lines: [[[40, 10], [40, 90]]], bounds: [0, 0, 200, 120] });
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      assert.ok(a[0] === b[0] || a[1] === b[1], "orthogonal");
      for (let k = 0; k <= 20; k++) {
        const p = [a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20];
        assert.ok(!(p[0] > obstacle[0] && p[0] < obstacle[2] && p[1] > obstacle[1] && p[1] < obstacle[3]), `point ${p} inside the obstacle`);
      }
    }
    assert.throws(() => routeOrthogonal({ from: { x: 20, y: 50, dir: [1, 0] }, to: { x: 70, y: 50, dir: [-1, 0] }, obstacles: [[50, 0, 52, 120]], bounds: [0, 0, 100, 120] }), /no clear route/u);
  });

  it("taps only straight runs near the line and snaps inline valves onto straights", () => {
    const c = createCanvas({ box: [0, 0, 200, 120] });
    const a = c.add(S.pump({ x: 30, y: 80 }));
    const b = c.add(S.vessel({ x: 150, y: 50 }));
    const pipe = c.pipe({ from: a.port("discharge"), to: b.port("left", 0.5) });
    assert.throws(() => pipe.tap([60, 10]), /mm from/u);
    const corner = pipe.points[1];
    assert.throws(() => pipe.tap(corner), /bend/u);
    const valve = c.inline(pipe, S.valve, { type: "ball", at: 0.5 });
    assert.equal(valve.kind, "valve.ball");
    assert.equal(pipe.gaps.length, 1);
  });
});

describe("lit-schematic QA gate", () => {
  it("passes the worked examples, built fresh", () => {
    const out = mkdtempSync(join(tmpdir(), "lit-schematic-examples-"));
    try {
      for (const example of readdirSync(join(skillRoot, "examples"))) {
        const run = spawnSync(process.execPath, [join(skillRoot, "examples", example, "build.mjs"), out], { encoding: "utf8" });
        assert.equal(run.status, 0, run.stderr);
        assert.doesNotMatch(run.stderr, /WARN/u, `${example} builds without placement warnings`);
        const svg = readFileSync(join(out, `${example}.svg`), "utf8");
        const result = check(svg);
        assert.equal(result.verdict, "PASS", `${example}: ${result.findings.map((f) => `${f.code} ${f.message}`).join("; ")}`);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("fails each defect class with its own code", () => {
    const valve = box(40, 25, 50, 35, "a:40,30,-1,0;b:50,30,1,0");
    assert.deepEqual(codes(doc("<svg")), ["XML.WELLFORMED"]);
    assert.ok(codes(doc(`${label(10, 10, "Feed gas")}${label(12, 10.5, "Feed gas")}`)).includes("TEXT.OVERLAP"));
    assert.ok(codes(doc(label(10, 10, "tiny", 1.2))).includes("TEXT.MIN_SIZE"));
    assert.ok(codes(doc(label(92, 10, "runs past the edge"))).includes("TEXT.CLIPPED"));
    assert.ok(codes(doc(`${valve}${line("M10 30H90")}`)).includes("LINE.THROUGH_SYMBOL"));
    assert.ok(!codes(doc(`${valve}${line("M10 30H40")}${line("M50 30H90", "L2")}`)).includes("LINE.THROUGH_SYMBOL"));
    assert.ok(codes(doc(`${valve}${line("M20 30H40")}`)).includes("LINE.DANGLING"));
    assert.ok(codes(doc(`${line("M10 10H50V40", "L1")}${line("M50 5V30", "L2")}`)).includes("LINE.BEND_ON_LINE"));
    assert.ok(codes(doc(`${line("M10 10H60", "L1")}${line("M30 10H80", "L2")}`)).includes("LINE.OVERLAP"));
    assert.ok(codes(doc(`${line("M10 20H50", "L1")}${label(25, 21, "line no")}`)).includes("TEXT.ON_LINE"));
    assert.ok(codes(doc(`${box(20, 20, 40, 40, "", "valve.gate")}${label(22, 32, "loose")}`)).includes("TEXT.ON_SYMBOL"));
    assert.ok(codes(doc(`<path d="M1 1H9" stroke="#000" stroke-width="0.03"/>`)).includes("STROKE.MIN"));
    assert.ok(codes(doc(`<image href="https://example.com/x.png" width="5" height="5"/>`)).includes("XML.EXTERNAL"));
    assert.ok(codes(doc(`<script>alert(1)</script>`)).includes("SVG.ACTIVE"));
    assert.ok(codes(doc(box(10, 10, 20, 20, "", "instrument.field", "PCI-101"))).includes("TAG.GRAMMAR"));
    assert.ok(codes(doc(`${box(10, 10, 20, 20, "", "instrument.field", "PT-1")}${box(30, 10, 40, 20, "", "instrument.field", "PT-1")}`)).includes("TAG.DUPLICATE"));
    assert.ok(codes(doc(`<g data-sym="valve.gate" data-tag="XV-1"><path d="M1 1H5" stroke="#000" stroke-width="0.3"/></g>`)).includes("SYMBOL.NO_BOX"));
    assert.ok(codes(doc(box(10, 10, 20, 20), { mode: "pid" })).includes("LEGEND.COVERAGE"));
    assert.ok(codes(doc("", { mode: "pid" })).includes("TITLEBLOCK.FIELDS"));
    assert.ok(codes(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`).includes("SVG.SIZE"));
    const red = `<path data-line="stream" data-role="a" d="M5 5H20" stroke="#d62728" stroke-width="0.35" fill="none"/><path data-line="stream" data-role="b" d="M5 15H20" stroke="#2ca02c" stroke-width="0.35" fill="none"/>`;
    assert.ok(codes(doc(red)).includes("PALETTE.CVD"));
    const panels = `<g data-panel="b" data-panel-box="0 0 50 60"><text x="1" y="3" font-size="2.82" data-label="panel-label">(b)</text></g><g data-panel="a" data-panel-box="50 0 100 60"><text x="51" y="3" font-size="2.82" data-label="panel-label">(a)</text></g>`;
    assert.ok(codes(doc(panels)).includes("PANEL.LABELS"));
    const leaders = `<g data-part="shell" data-hull="10,10 30,10 30,30 10,30"></g><path data-leader="C1" data-target="shell" d="M70 10L40 40" stroke="#000" stroke-width="0.14"/><circle data-leader-dot="C1" cx="40" cy="40" r="0.5"/><text x="71" y="11" font-size="2.47" data-label="callout" data-for-leader="C1">Shell</text>`;
    assert.ok(codes(doc(leaders)).includes("LEADER.LOOSE"));
  });

  it("keeps the stream roles apart for every common colour-vision deficiency", () => {
    const roles = Object.values(STREAM).map((r) => r.color);
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        if (roles[i] === roles[j]) continue;
        for (const vision of ["normal", "deuteranopia", "protanopia", "tritanopia"]) {
          assert.ok(deltaE(roles[i], roles[j], vision) >= 9, `${roles[i]} vs ${roles[j]} under ${vision}`);
        }
      }
    }
  });

  it("samples arcs and curves when it reads path data", () => {
    const [poly] = pathPolylines("M0 0A5 5 0 0 1 10 0");
    assert.ok(poly.points.length > 4);
    assert.ok(Math.min(...poly.points.map((p) => p[1])) < -4.9, "a sweep-1 arc from left to right bulges up");
  });
});

describe("lit-schematic builders", () => {
  it("builds a sheet whose legend covers what it draws and whose title block is complete", () => {
    const sheet = createSheet({ title: "Test sheet", number: "T-1", rev: "0", date: "2026-10-25" });
    const r = sheet.add(S.reactor({ x: 120, y: 140, tag: "R-101", name: "Reactor" }));
    const v = sheet.add(S.vent({ x: 220, y: 90 }));
    const relief = sheet.add(S.safetyValve({ x: 170, y: 100, tag: "PSV-101", setPressure: "SET 12 MPa" }));
    sheet.pipe({ from: r.port("top-right"), to: relief.port("inlet"), kind: "process-minor" });
    sheet.pipe({ from: relief.port("outlet"), to: v.port("in"), kind: "process-minor" });
    const pt = sheet.add(S.instrument({ x: 60, y: 130, tag: "PT-101" }));
    sheet.connect({ from: r.port("left", 0.4), to: pt.port("right") });
    const result = check(sheet.render());
    assert.equal(result.verdict, "PASS", result.findings.map((f) => `${f.code} ${f.message}`).join("; "));
  });

  it("draws PFD stream numbers and a stream table that pass the gate", () => {
    const sheet = createSheet({ mode: "pfd", title: "PFD test", number: "T-2", rev: "0", date: "2026-10-25" });
    const a = sheet.add(S.drum({ x: 80, y: 120, tag: "D-101" }));
    const b = sheet.add(S.drum({ x: 230, y: 120, tag: "D-102" }));
    const feed = sheet.pipe({ from: a.port("right"), to: b.port("left") });
    sheet.streamNumber(feed, 1);
    sheet.streamTable({ box: [60, 170, 260], streams: [1], rows: [{ label: "Pressure (MPa)", values: [5] }, { label: "Temperature (°C)", values: [2] }] });
    const svg = sheet.render();
    assert.match(svg, /data-stream-number="1"/u);
    assert.match(svg, /data-legend-item="stream-number"/u);
    const result = check(svg);
    assert.equal(result.verdict, "PASS", result.findings.map((f) => `${f.code} ${f.message}`).join("; "));
  });

  it("fits an isometric cutaway into a journal panel with non-crossing callouts on visible parts", () => {
    const v = createIsoView({ azimuth: 40, elevation: 26 });
    v.box({ name: "base", plan: { x: -40, y: -40, w: 80, d: 80, r: 3 }, z: -6, h: 6, tone: "lo", layer: -1 });
    const shell = v.lathe({ name: "shell", axis: "z", profile: [[0, 0], [0, 30], [100, 30], [100, 0]], cut: { from: 15, to: 85, span: 90 }, wall: 3 });
    const shaft = v.lathe({ name: "shaft", axis: "z", profile: [[10, 0], [10, 2], [110, 2], [110, 0]], tone: "accent", into: shell });
    v.callout({ part: shell, at: shell.anchor(0.95, -30), text: "Shell" });
    v.callout({ part: shaft, text: "Agitator shaft" });
    const fig = createFigure({ width: "single", height: 70, title: "Cutaway test" });
    fig.panel(null, [0, 0, 85, 70]).iso(v);
    const result = check(fig.render());
    assert.equal(result.verdict, "PASS", result.findings.map((f) => `${f.code} ${f.message}`).join("; "));
    assert.equal(result.stats.leaders, 2);
  });

  it("paints an isometric view in full material colour by default and in grey only on request", () => {
    const fills = (svg) => [...svg.matchAll(/fill="(#[0-9a-f]{6})"/giu)].map((m) => m[1].toLowerCase());
    const chroma = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b); };
    const hueFamilies = (list) => {
      const hues = list.filter((hex) => chroma(hex) >= 40).map((hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
        const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
      });
      return new Set(hues.map((h) => Math.round(h / 30) % 12)).size;
    };
    const draw = (options) => {
      const v = createIsoView({ azimuth: 40, elevation: 26, ...options });
      v.box({ name: "pad", plan: { x: -40, y: -40, w: 80, d: 80, r: 3 }, z: -6, h: 6, tone: "lo", layer: -1 });
      v.box({ name: "leg", plan: { x: -30, y: -30, w: 6, d: 6 }, z: 0, h: 20, tone: "mid" });
      const shell = v.lathe({ name: "shell", axis: "z", origin: [0, 0, 20], profile: [[0, 0], [0, 30], [100, 30], [100, 0]], tone: "hi", cut: { from: 15, to: 85, span: 90 }, wall: 3 });
      v.lathe({ name: "shaft", axis: "z", origin: [0, 0, 20], profile: [[10, 0], [10, 2], [110, 2], [110, 0]], tone: "accent", into: shell });
      v.lathe({ name: "jacket nozzle", axis: "x", origin: [30, 0, 60], profile: [[0, 0], [0, 4], [14, 4], [14, 0]], tone: "copper" });
      const fig = createFigure({ width: "single", height: 70, title: "Palette test" });
      fig.panel(null, [0, 0, 85, 70]).iso(v);
      return fig.render();
    };
    const material = draw({});
    assert.ok(hueFamilies(fills(material)) >= 3, "the default view carries several material hue families");
    assert.equal(check(material).verdict, "PASS", check(material).findings.map((f) => `${f.code} ${f.message}`).join("; "));
    const grey = fills(draw({ palette: "grey" })).filter((hex) => chroma(hex) >= 40);
    assert.ok(hueFamilies(grey) <= 2, "the grey palette keeps only the accent and the copper part coloured");
    assert.throws(() => createIsoView({ palette: "neon" }), /palette/u);
    const craft = readFileSync(join(skillRoot, "references", "isometric-craft.md"), "utf8");
    assert.doesNotMatch(craft, /restrained grey palette|keep it grey with one accent/u);
    assert.match(craft, /palette: "grey"[^.]*opt-in|opt-in[^.]*palette: "grey"/u);
  });

  it("refuses a figure taller than a journal page and an unknown width", () => {
    assert.throws(() => createFigure({ width: "single", height: 260, title: "x" }), /taller/u);
    assert.throws(() => createFigure({ width: "quarter", height: 50, title: "x" }), /width/u);
  });
});

describe("lit-schematic exports and helpers", () => {
  const tinyPng = () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunk = (type, data) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "latin1");
      const crcBuf = Buffer.alloc(4);
      let c = 0xffffffff;
      for (const b of Buffer.concat([Buffer.from(type, "latin1"), data])) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcBuf.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
      return Buffer.concat([head, data, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2362, 0);
    ihdr.writeUInt32BE(10, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", Buffer.from([0])), chunk("IEND", Buffer.alloc(0))]);
  };

  it("writes and reads the PNG resolution and detects a truncated file", () => {
    const png = withDpi(tinyPng(), 600);
    const info = pngInfo(png);
    assert.equal(info.dpi, 600);
    assert.equal(info.closed, true);
    assert.throws(() => pngInfo(png.subarray(0, 20)));
  });

  it("checks PNG resolution and PDF page size against the drawing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-schematic-exports-"));
    try {
      const svg = doc("");
      writeFileSync(join(dir, "ok.png"), withDpi(tinyPng(), 600));
      writeFileSync(join(dir, "low.png"), withDpi(tinyPng(), 150));
      writeFileSync(join(dir, "ok.pdf"), "%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 283.46 170.08] >> endobj\n%%EOF\n");
      writeFileSync(join(dir, "a4.pdf"), "%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj\n%%EOF\n");
      assert.deepEqual(checkExports({ svg, png: join(dir, "ok.png"), pdf: join(dir, "ok.pdf") }), []);
      const bad = checkExports({ svg, png: join(dir, "low.png"), pdf: join(dir, "a4.pdf") }).map((f) => f.code);
      assert.ok(bad.includes("PNG.DPI") && bad.includes("PDF.SIZE"), bad.join());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("launches Chrome with a throwaway, dialog-free keychain", () => {
    assert.ok(CHROME_FLAGS.includes("--use-mock-keychain"));
    assert.ok(CHROME_FLAGS.includes("--password-store=basic"));
    assert.ok(CHROME_FLAGS.includes("--headless=new"));
  });

  it("scaffolds a build wired to the installed kit and refuses the plugin directory and existing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-schematic-scaffold-"));
    try {
      const file = scaffold("pid", dir);
      assert.match(readFileSync(file, "utf8"), /from "file:\/\/[^"]+\/lit-schematic\/scripts\/lib\/pid\.mjs"/u);
      const run = spawnSync(process.execPath, [file, dir], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.throws(() => scaffold("pid", dir), /already exists/u);
      assert.throws(() => scaffold("pid", join(skillRoot, "scratch")), /inside the installed plugin/u);
      assert.ok(!existsSync(join(skillRoot, "scratch", "build.mjs")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(join(skillRoot, "scratch"), { recursive: true, force: true });
    }
  });

  it("doctor reports and never installs", () => {
    const run = spawnSync(process.execPath, [join(skillRoot, "scripts", "doctor.mjs"), "--json"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.ok(["PASS", "DEGRADED", "BLOCKED"].includes(report.status));
    assert.deepEqual(report.checks.map((c) => c.id), ["node", "renderer", "font.korean", "output", "motion.ffmpeg", "motion.webp"]);
    assert.doesNotMatch(readFileSync(join(skillRoot, "scripts", "doctor.mjs"), "utf8"), /npm install|brew install|apt-get/u);
  });
});
