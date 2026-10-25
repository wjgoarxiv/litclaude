import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLineNumber } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/isa.mjs";
import * as S from "../plugins/litclaude/skills/lit-schematic/scripts/lib/pid.mjs";
import { check } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/qa-core.mjs";
import { LINE_KINDS, createSheet } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/sheet.mjs";
import { createLegendSheet } from "../plugins/litclaude/skills/lit-schematic/scripts/lib/legend-sheet.mjs";

// Reads a symbol's drawing into the features that make its geometry class: what a process
// engineer would name when telling a globe valve from a ball valve.
function anatomy(sym) {
  const svg = sym.svg();
  const shapes = [...svg.matchAll(/<(path|circle)\b([^>]*?)\/?>/gu)].map(([, tag, attrs]) => {
    const get = (name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`, "u"))?.[1];
    const d = get("d") ?? "";
    return {
      tag,
      d,
      fill: get("fill"),
      dashed: Boolean(get("stroke-dasharray")),
      vertices: (d.match(/[ML]/gu) ?? []).length,
      closed: /Z/u.test(d),
      arc: /A/u.test(d),
    };
  });
  const texts = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map((m) => m[1]);
  const inked = (s) => s.fill === "#000000";
  return {
    kind: sym.kind,
    circles: shapes.filter((s) => s.tag === "circle").length,
    filledCircles: shapes.filter((s) => s.tag === "circle" && inked(s)).length,
    openCircles: shapes.filter((s) => s.tag === "circle" && !inked(s)).length,
    filledPolys: shapes.filter((s) => s.tag === "path" && s.closed && inked(s)).length,
    closedPolys: shapes.filter((s) => s.tag === "path" && s.closed).length,
    dashed: shapes.filter((s) => s.dashed).length,
    arcs: shapes.filter((s) => s.arc).length,
    paths: shapes.filter((s) => s.tag === "path"),
    texts,
  };
}

describe("lit-schematic line classes", () => {
  it("draws every P&ID line class with its own width, dash or marks", () => {
    const pidKinds = Object.entries(LINE_KINDS).filter(([kind]) => kind !== "stream");
    const signature = ([, spec]) => `${spec.width}|${spec.dash ?? ""}|${spec.marks ?? ""}`;
    const seen = new Map();
    for (const entry of pidKinds) {
      const sig = signature(entry);
      assert.ok(!seen.has(sig), `${entry[0]} looks the same as ${seen.get(sig)} (${sig})`);
      seen.set(sig, entry[0]);
    }
  });

  it("keeps the ISO 128 weight order: main process, minor process, utility, instrument connection", () => {
    const w = (kind) => LINE_KINDS[kind].width;
    assert.ok(w("process-major") > w("process-minor"));
    assert.ok(w("process-minor") > w("utility"));
    assert.ok(w("utility") > w("connection"));
    for (const [kind, spec] of Object.entries(LINE_KINDS)) {
      if (!kind.startsWith("signal-")) continue;
      assert.ok(spec.width < w("utility"), `${kind} is lighter than any pipe`);
      assert.ok(spec.dash || spec.marks, `${kind} carries the ISA-5.1 Table 5.3.2 mark that names it`);
    }
  });

  it("pins the ISA-5.1 signal marks", () => {
    assert.equal(LINE_KINDS["signal-pneumatic"].marks, "slash");
    assert.equal(LINE_KINDS["signal-hydraulic"].marks, "ell");
    assert.equal(LINE_KINDS["signal-capillary"].marks, "cross");
    assert.equal(LINE_KINDS["signal-data"].marks, "circle");
    assert.equal(LINE_KINDS["signal-mechanical"].marks, "dot");
    assert.equal(LINE_KINDS["signal-guided"].marks, "wave");
    assert.equal(LINE_KINDS["signal-unguided"].marks, "wave-gap");
    assert.ok(LINE_KINDS["signal-electric"].dash);
  });

  it("draws each line class in the legend exactly as on the drawing", () => {
    const sheet = createSheet({ title: "Line classes", number: "T-3", rev: "0", date: "2026-10-25", size: "A2" });
    const kinds = Object.keys(LINE_KINDS).filter((kind) => kind !== "stream");
    kinds.forEach((kind, i) => {
      const a = sheet.add(S.offPage({ x: 40, y: 50 + i * 14, text: `FROM ${i}` }));
      const b = sheet.add(S.offPage({ x: 260, y: 50 + i * 14, text: `TO ${i}` }));
      sheet.pipe({ from: a.port("out"), to: b.port("in"), kind, arrows: false });
    });
    const svg = sheet.render();
    for (const kind of kinds) {
      const drawn = svg.match(new RegExp(`<path[^>]*data-line="${kind}"[^>]*>`, "u"))?.[0] ?? "";
      const legend = svg.match(new RegExp(`<path[^>]*data-legend-line="${kind}"[^>]*>`, "u"))?.[0] ?? "";
      const width = (s) => s.match(/stroke-width="([^"]+)"/u)?.[1];
      const dash = (s) => s.match(/stroke-dasharray="([^"]+)"/u)?.[1] ?? "";
      assert.ok(legend, `${kind} has a legend sample`);
      assert.equal(width(legend), width(drawn), `${kind} legend width`);
      assert.equal(dash(legend), dash(drawn), `${kind} legend dash`);
    }
    const result = check(svg);
    assert.equal(result.verdict, "PASS", result.findings.map((f) => `${f.code} ${f.message}`).join("; "));
  });
});

describe("lit-schematic ISA-5.1 instrument bubbles", () => {
  const functions = { discrete: "circle", shared: "square+circle", computer: "hexagon", plc: "square+diamond" };
  const locations = { field: [0, false], main: [1, false], "main-rear": [1, true], aux: [2, false], "aux-rear": [2, true] };

  it("draws function by shape and location by the lines across it", () => {
    for (const fn of Object.keys(functions)) {
      for (const [location, [count, dashed]] of Object.entries(locations)) {
        const sym = S.instrument({ x: 20, y: 20, tag: "PIC-101", fn, location });
        const a = anatomy(sym);
        assert.equal(sym.kind, `instrument.${fn}-${location}`);
        assert.ok(S.describeKind(sym.kind), `${sym.kind} has a legend description`);
        const across = a.paths.filter((p) => p.vertices === 2 && !p.closed && /^M[\d.-]+ ([\d.-]+)L[\d.-]+ \1$/u.test(p.d));
        assert.equal(across.length, count, `${fn}/${location}: ${count} location line(s)`);
        assert.equal(across.filter((p) => p.dashed).length, dashed ? count : 0, `${fn}/${location}: dashed means behind the panel`);
        if (fn === "discrete") assert.equal(a.circles, 1);
        if (fn === "shared") { assert.equal(a.circles, 1); assert.ok(a.paths.some((p) => p.closed && p.vertices === 4)); }
        if (fn === "computer") { assert.equal(a.circles, 0); assert.ok(a.paths.some((p) => p.closed && p.vertices === 6)); }
        if (fn === "plc") { assert.equal(a.circles, 0); assert.equal(a.paths.filter((p) => p.closed && p.vertices === 4).length, 2); }
      }
    }
  });

  it("reads the round-1 location names as before", () => {
    assert.equal(S.instrument({ x: 0, y: 0, tag: "PIC-1", location: "dcs" }).kind, "instrument.shared-main");
    assert.equal(S.instrument({ x: 0, y: 0, tag: "XS-1", location: "plc" }).kind, "instrument.plc-main");
    assert.equal(S.instrument({ x: 0, y: 0, tag: "PI-1", location: "panel" }).kind, "instrument.discrete-main");
    assert.equal(S.instrument({ x: 0, y: 0, tag: "PI-1", location: "local-panel" }).kind, "instrument.discrete-aux");
    assert.equal(S.instrument({ x: 0, y: 0, tag: "PI-1" }).kind, "instrument.discrete-field");
  });
});

describe("lit-schematic symbol geometry classes", () => {
  const v = (type, extra = {}) => anatomy(S.valve({ x: 20, y: 20, type, ...extra }));

  it("tells valve bodies apart the way ISA-5.1 Table 5.4.1 and ISO 10628-2 group 21 do", () => {
    const gate = v("gate");
    assert.equal(gate.closedPolys, 1); assert.equal(gate.circles, 0); assert.equal(gate.filledPolys, 0);
    const globe = v("globe");
    assert.equal(globe.filledCircles, 1); assert.equal(globe.openCircles, 0);
    const ball = v("ball");
    assert.equal(ball.openCircles, 1); assert.equal(ball.filledCircles, 0);
    const plug = v("plug");
    assert.equal(plug.closedPolys, 2); assert.equal(plug.circles, 0);
    const butterfly = v("butterfly");
    assert.equal(butterfly.closedPolys, 0); assert.equal(butterfly.filledCircles, 1);
    const check = v("check");
    assert.equal(check.filledPolys, 1, "check: the solid half points along the allowed flow");
    const needle = v("needle");
    assert.equal(needle.filledPolys, 1); assert.equal(needle.closedPolys, 2);
    const diaphragm = v("diaphragm");
    assert.equal(diaphragm.arcs, 1, "diaphragm body: a bonnet arc over the bowtie");
    const three = S.valve({ x: 20, y: 20, type: "threeway" });
    assert.equal(anatomy(three).closedPolys, 2);
    assert.deepEqual(three.allPorts.map((p) => p.name).sort(), ["a", "b", "c"]);
    for (const [type, kind] of [["gate", "valve.gate"], ["globe", "valve.globe"], ["ball", "valve.ball"], ["butterfly", "valve.butterfly"], ["plug", "valve.plug"], ["needle", "valve.needle"], ["check", "valve.check"], ["diaphragm", "valve.diaphragm"]]) {
      assert.equal(S.valve({ x: 0, y: 0, type }).kind, kind);
    }
  });

  it("draws an angle valve as two bodies at a right angle with perpendicular ports", () => {
    const angle = S.angleValve({ x: 20, y: 20, inlet: "down", outlet: "right" });
    assert.equal(angle.kind, "valve.angle");
    assert.equal(anatomy(angle).closedPolys, 2);
    const ports = Object.fromEntries(angle.allPorts.map((p) => [p.name, p.dir.join(",")]));
    assert.equal(ports.inlet, "0,1");
    assert.equal(ports.outlet, "1,0");
  });

  it("names the actuator in the kind and draws it per ISA-5.1 Table 5.4.2", () => {
    const act = (actuator) => anatomy(S.valve({ x: 20, y: 20, type: "globe", actuator, fail: "FC" }));
    const diaphragm = act("diaphragm");
    assert.equal(diaphragm.kind, "valve.globe.diaphragm");
    assert.equal(diaphragm.arcs, 1);
    const piston = act("piston");
    assert.equal(piston.kind, "valve.globe.piston");
    assert.ok(piston.paths.some((p) => p.closed && p.vertices === 4));
    assert.ok(act("motor").texts.includes("M"));
    assert.ok(act("solenoid").texts.includes("S"));
    const hand = act("hand");
    assert.equal(hand.kind, "valve.globe.hand");
    assert.ok(hand.paths.some((p) => p.vertices === 2 && /^M-?[\d.]+ (-?[\d.]+)L-?[\d.]+ \1$/u.test(p.d)), "handwheel T-bar");
    assert.ok(diaphragm.texts.includes("FC"));
    for (const fail of ["FO", "FC", "FL", "FI"]) assert.ok(S.valve({ x: 0, y: 0, type: "globe", actuator: "diaphragm", fail }));
    assert.throws(() => S.valve({ x: 0, y: 0, type: "globe", actuator: "diaphragm", fail: "closed" }), /FO, FC, FL or FI/u);
  });

  it("keeps the actuator above a horizontal line and its letters upright in every direction", () => {
    for (const orient of ["right", "left", "up", "down"]) {
      const v = S.valve({ x: 20, y: 20, type: "globe", actuator: "diaphragm", fail: "FO", orient });
      if (orient === "right" || orient === "left") assert.equal(v.port("actuator").dir[1], -1, `${orient}: actuator stands up`);
      const svg = v.svg();
      const turned = svg.match(/<g transform="[^"]*(?:rotate\((?!0\))[^)]*\)|scale\()[^"]*">.*?<\/g>/su)?.[0] ?? "";
      assert.doesNotMatch(turned, /<text\b/u, `${orient}: no text inside a turned or mirrored group`);
      assert.match(svg, />FO<\/text>/u);
    }
    const left = S.valve({ x: 20, y: 20, type: "check", orient: "left" }).svg();
    assert.match(left, /scale\(-1 1\)|rotate\(180\)/u, "a check valve still points with the flow");
  });

  it("draws relief devices, machines and exchangers in their standard forms", () => {
    const psv = anatomy(S.safetyValve({ x: 20, y: 20 }));
    assert.equal(psv.kind, "valve.safety"); assert.equal(psv.closedPolys, 2);
    const disk = anatomy(S.ruptureDisk({ x: 20, y: 20 }));
    assert.equal(disk.kind, "relief.rupture"); assert.ok(disk.paths.some((p) => /Q/u.test(p.d)));
    const centrifugal = anatomy(S.pump({ x: 20, y: 20 }));
    assert.equal(centrifugal.kind, "pump.centrifugal"); assert.equal(centrifugal.circles, 1);
    const pd = anatomy(S.pump({ x: 20, y: 20, type: "positive" }));
    assert.equal(pd.kind, "pump.positive"); assert.equal(pd.circles, 3);
    assert.equal(S.compressor({ x: 20, y: 20 }).kind, "compressor.centrifugal");
    assert.equal(S.compressor({ x: 20, y: 20, type: "reciprocating" }).kind, "compressor.reciprocating");
    const plate = anatomy(S.plateExchanger({ x: 20, y: 20 }));
    const diagonals = plate.paths.filter((p) => p.vertices === 2 && !/^M([\d.-]+) [\d.-]+L\1 /u.test(p.d) && !/^M[\d.-]+ ([\d.-]+)L[\d.-]+ \1$/u.test(p.d));
    assert.equal(diagonals.length, 2, "plate exchanger: ISO 10628-2 item 3.6 draws both diagonals");
    const fixed = S.shellTube({ x: 40, y: 20 });
    assert.equal(fixed.kind, "exchanger.shelltube");
    assert.ok(anatomy(fixed).closedPolys >= 3, "fixed tube sheet: shell and a tube sheet at each end");
    assert.equal(S.shellTube({ x: 40, y: 20, type: "utube" }).kind, "exchanger.utube");
    assert.equal(S.shellTube({ x: 40, y: 20, type: "floating" }).kind, "exchanger.floating");
    const air = S.airCooler({ x: 40, y: 20, tag: "E-102" });
    assert.equal(air.kind, "exchanger.aircooler");
    assert.ok(air.allPorts.some((p) => p.name === "in") && air.allPorts.some((p) => p.name === "out"));
  });

  it("draws full-width trays on a tray column and keeps the staggered form on request", () => {
    const spans = (sym) => anatomy(sym).paths.filter((p) => p.dashed).map((p) => {
      const xs = [...p.d.matchAll(/[ML](-?[\d.]+) /gu)].map((m) => Number(m[1]));
      return Math.max(...xs) - Math.min(...xs);
    });
    const full = spans(S.column({ x: 40, y: 60, w: 16, trays: 5 }));
    assert.equal(full.length, 5);
    assert.ok(full.every((w) => Math.abs(w - 16) < 0.01), "ISO 10628-2 item 2.2: each tray spans the shell");
    const staggered = spans(S.column({ x: 40, y: 60, w: 16, trays: 5, trayStyle: "staggered" }));
    assert.equal(staggered.length, 5);
    assert.ok(staggered.every((w) => w < 16 * 0.8), "item 2.5: staggered baffles stop short of the far wall");
  });

  it("draws piping items: reducers, flanges, a figure-8 blind and flow elements", () => {
    assert.equal(S.reducer({ x: 0, y: 0 }).kind, "line.reducer");
    assert.equal(S.reducer({ x: 0, y: 0, eccentric: true }).kind, "line.reducer-eccentric");
    const flange = anatomy(S.flange({ x: 10, y: 10 }));
    assert.equal(flange.kind, "line.flange"); assert.equal(flange.paths.length, 2);
    const closed = anatomy(S.blind({ x: 10, y: 10 }));
    assert.equal(closed.kind, "line.blind"); assert.equal(closed.circles, 2); assert.equal(closed.filledCircles, 1);
    const open = anatomy(S.blind({ x: 10, y: 10, state: "open" }));
    assert.equal(open.kind, "line.blind-open"); assert.equal(open.filledCircles, 1);
    assert.notEqual(S.blind({ x: 10, y: 10 }).svg(), S.blind({ x: 10, y: 10, state: "open" }).svg());
    assert.equal(S.flowElement({ x: 0, y: 0, type: "orifice" }).kind, "flow.orifice");
    assert.equal(S.flowElement({ x: 0, y: 0, type: "venturi" }).kind, "flow.venturi");
    for (const [type, note] of [["magnetic", "MAG"], ["coriolis", "COR"], ["vortex", "VOR"], ["turbine", "TUR"], ["ultrasonic", "US"], ["thermal", "TMF"]]) {
      const fe = anatomy(S.flowElement({ x: 0, y: 0, type }));
      assert.equal(fe.kind, `flow.${type}`);
      assert.ok(fe.texts.includes(note), `${type} carries the ISA-5.1 measurement notation ${note}`);
    }
  });

  it("describes every kind it can draw", () => {
    const samples = [
      S.vessel({ x: 0, y: 0 }), S.drum({ x: 0, y: 0 }), S.tank({ x: 0, y: 0 }), S.gasCylinder({ x: 0, y: 0 }),
      S.airCooler({ x: 0, y: 0 }), S.flange({ x: 0, y: 0 }), S.angleValve({ x: 0, y: 0 }),
      S.valve({ x: 0, y: 0, type: "ball", actuator: "motor" }), S.flowElement({ x: 0, y: 0, type: "coriolis" }),
      S.instrument({ x: 0, y: 0, tag: "FIC-1", fn: "computer", location: "aux-rear" }),
    ];
    for (const sym of samples) assert.ok(S.describeKind(sym.kind), `${sym.kind} has a description`);
  });
});

describe("lit-schematic line numbers", () => {
  it("reads size-fluid-sequence-class line numbers and refuses broken ones", () => {
    for (const ok of ['1/4"-CH4-101-HP1', '2"-P-1001-A1A', '1 1/2"-CW-205-B1', 'DN50-SW-301-CS1-H', '3"-VG-108-LP']) {
      assert.ok(parseLineNumber(ok).ok, ok);
    }
    const parsed = parseLineNumber('2"-P-1001-A1A-IH');
    assert.equal(parsed.size, '2"');
    assert.equal(parsed.fluid, "P");
    assert.equal(parsed.sequence, "1001");
    assert.equal(parsed.spec, "A1A");
    assert.equal(parsed.insulation, "IH");
    for (const bad of ["CH4-101", '2"-P', "pipe 3", '2"--101-A']) assert.equal(parseLineNumber(bad).ok, false, bad);
  });

  it("fails a P&ID whose line number breaks the grammar", () => {
    const doc = (number) => `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60" data-schematic-mode="pid"><path data-line="process-major" data-line-id="L1" data-number="${number}" d="M10 10H90" stroke="#000" stroke-width="0.7" fill="none"/></svg>`;
    const codes = (svg) => check(svg).findings.map((f) => f.code);
    assert.ok(codes(doc("pipe 3")).includes("LINE.NUMBER"));
    assert.ok(!codes(doc('2"-P-101-A1A')).includes("LINE.NUMBER"));
  });

  it("lets a later process line hop over an earlier one without a bend or crossing finding", () => {
    const sheet = createSheet({ size: "A3", title: "Hop", number: "X-001", date: "2026-10-25" });
    const a = sheet.add(S.vessel({ x: 80, y: 120, tag: "V-101" }));
    const b = sheet.add(S.vessel({ x: 240, y: 120, tag: "V-102" }));
    const c = sheet.add(S.vessel({ x: 160, y: 60, tag: "V-103" }));
    const d = sheet.add(S.vessel({ x: 160, y: 200, tag: "V-104" }));
    sheet.pipe({ from: a.port("right", 0.5), to: b.port("left", 0.5) });
    sheet.pipe({ from: c.port("bottom"), to: d.port("top") });
    const svg = sheet.render();
    assert.match(svg, /A1\.2 1\.2 0 0 [01]/u, "the second line hops");
    const codes = check(svg).findings.map((f) => f.code);
    assert.ok(!codes.includes("LINE.BEND_ON_LINE") && !codes.includes("LINE.CROSSING"), codes.join(", "));
  });

  it("never draws a flow arrow inside a symbol, even where the build asked for one", () => {
    const sheet = createSheet({ size: "A3", title: "Arrow", number: "X-002", date: "2026-10-25" });
    const a = sheet.add(S.vessel({ x: 80, y: 120, tag: "V-101" }));
    const b = sheet.add(S.vessel({ x: 240, y: 120, tag: "V-102" }));
    const line = sheet.pipe({ from: a.port("right", 0.5), to: b.port("left", 0.5), arrows: [0.5] });
    sheet.inline(line, S.valve, { type: "gate", at: 0.5 });
    const codes = check(sheet.render()).findings.map((f) => f.code);
    assert.ok(!codes.includes("LINE.ARROW_IN_SYMBOL"), "the kit moves the arrow off the valve");
    const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60" data-schematic-mode="pid"><g data-sym="valve.gate" data-sym-id="S1" data-box="46.5 27.6 53.5 32.4" data-ports="a:46.5,30,-1,0;b:53.5,30,1,0"><path d="M46.5 27.8L53.5 32.2L53.5 27.8L46.5 32.2Z" fill="none" stroke="#000" stroke-width="0.35"/></g><path d="M51.3 30L48.7 30.95L48.7 29.05Z" fill="#000" stroke="none" data-arrow="L1"/></svg>`;
    assert.ok(check(doc).findings.some((f) => f.code === "LINE.ARROW_IN_SYMBOL"), "the gate catches a hand-placed one");
  });
});

describe("lit-schematic legend sheet", () => {
  it("builds the symbols-and-abbreviations sheet from the library and passes the gate", () => {
    const svg = createLegendSheet({ number: "LEG-001", rev: "0", date: "2026-10-25" });
    const result = check(svg);
    assert.equal(result.verdict, "PASS", result.findings.map((f) => `${f.code} ${f.message}`).join("; "));
    for (const kind of ["valve.globe.diaphragm", "valve.angle", "exchanger.aircooler", "line.blind", "flow.coriolis", "instrument.shared-main", "instrument.computer-aux"]) {
      assert.match(svg, new RegExp(`data-legend-item="${kind.replaceAll(".", "\\.")}"`, "u"), kind);
    }
    for (const kind of Object.keys(LINE_KINDS).filter((k) => k !== "stream")) assert.match(svg, new RegExp(`data-legend-line="${kind}"`, "u"), kind);
    assert.match(svg, /data-legend-item="letters:P"/u);
    assert.match(svg, /data-legend-item="fail:FC"/u);
  });
});

describe("lit-schematic leader spacing", () => {
  const fig = (leaders) => `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><g data-part="body" data-hull="10,10 50,10 50,50 10,50"></g>${leaders}</svg>`;
  const leader = (id, from, to, text) => `<path data-leader="${id}" data-target="body" d="M${from[0]} ${from[1]}L${to[0]} ${to[1]}" stroke="#000" stroke-width="0.14" fill="none"/><circle data-leader-dot="${id}" cx="${to[0]}" cy="${to[1]}" r="0.55"/><text x="${from[0] + 1}" y="${from[1] + 0.8}" font-size="2.47" font-family="Arial" data-label="callout" data-for-leader="${id}">${text}</text>`;
  const codes = (svg) => check(svg).findings.filter((f) => f.level === "FAIL").map((f) => f.code);

  it("fails a leader that passes closer than the minimum to another leader or its dot", () => {
    // The round-1 weakness: one leader grazes the dot of its neighbour.
    const crowded = fig(leader("C1", [80, 30], [30, 20], "Impeller") + leader("C2", [80, 21], [20, 19.6], "Thermocouple"));
    assert.ok(codes(crowded).includes("LEADER.SPACING"), "crowded leaders fail");
    const clear = fig(leader("C1", [80, 20], [30, 20], "Impeller") + leader("C2", [80, 40], [30, 40], "Thermocouple"));
    assert.ok(!codes(clear).includes("LEADER.SPACING"), "well spaced leaders pass");
  });
});
