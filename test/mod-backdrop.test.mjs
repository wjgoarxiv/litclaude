// The Ignition look (lib/mod/backdrop.mjs): the colours `$.theme.set` sends once a session, and the
// backdrop scene the desktop and mobile apps draw behind the conversation, which follows the live
// LIT state (idle, working with the plan/build/verify cells lit from real progress, asking, done).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";
import { checkColors } from "../plugins/litclaude/hooks/make-colors.js";
import { BURST_MS, GLASS, SCENE, SCENE_MAX, BEZIER, EASE, POWER_MS, SPARK, SPIN, composeScene, lookArgs, lookColors, readoutsOf, sceneKey, sceneStateOf } from "../plugins/litclaude/lib/mod/backdrop.mjs";
import { MOD_CHOICES, normalizeModSettings } from "../plugins/litclaude/lib/mod/settings.mjs";
import { installModH } from "./helpers/mod-h.mjs";

const phases = (plan, work, review) => ({ plan, work, review });
const model = (over = {}) => ({ phases: phases("todo", "todo", "todo"), progress: null, waiting: null, completion: null, ...over });
const STATES = {
  idle: sceneStateOf(null, { isWorking: false, burst: false }),
  "working-1of3": sceneStateOf(model({ phases: phases("done", "now", "todo"), progress: { done: 1, total: 3 } }), { isWorking: true }),
  "working-2of3": sceneStateOf(model({ phases: phases("done", "now", "todo"), progress: { done: 2, total: 3 } }), { isWorking: true }),
  asking: sceneStateOf(model({ phases: phases("done", "now", "todo"), progress: { done: 2, total: 3 }, waiting: "question" }), { isWorking: true }),
  done: sceneStateOf(model(), { isWorking: false, burst: true }),
};

test("look is a plain-string option: on by default, still and off", () => {
  assert.deepEqual(MOD_CHOICES.look, ["on", "still", "off"]);
  assert.equal(normalizeModSettings({}).look, "on");
  assert.equal(normalizeModSettings({ look: "STILL" }).look, "still");
  assert.equal(normalizeModSettings({ look: "off" }).look, "off");
  assert.equal(normalizeModSettings({ look: "sparkly" }).look, "on");
  const manifest = JSON.parse(readFileSync(new URL("../plugins/litclaude/.claude-plugin/plugin.json", import.meta.url), "utf8"));
  assert.equal(manifest.userConfig.look.default, "on");
});

test("the Ignition colours paint on Desktop and use only design-system names", () => {
  const { theme, problems } = lookColors();
  assert.deepEqual(problems.filter((line) => line.startsWith("Desktop won't paint")), []);
  // checkColors repeats makeColors' contrast notes (under the design system's own bar, still painted)
  // and adds a line for any key that is not a design-system name: it must add none.
  assert.deepEqual(checkColors(theme), problems);
  assert.deepEqual(checkColors(theme).filter((line) => /isn't a theme color|paints nothing|Desktop won't paint/u.test(line)), []);
  const args = lookArgs(theme);
  assert.deepEqual(args.backdrop, { scene: SCENE, glass: { ...GLASS } });
  assert.match(SCENE, /^[A-Za-z0-9_-]{1,64}$/u);
  assert.ok(GLASS.blur >= 0 && GLASS.blur <= 64 && GLASS.opacity > 0 && GLASS.opacity <= 1);
  assert.equal("tint" in GLASS, false, "no raw tint: the panels keep their own colour in each mode");
  assert.ok(JSON.stringify(args).length < 256 * 1024);
});

test("live state maps to the scene: progress lights cells, a question signals, a finish ignites", () => {
  const bits = (state) => state.lit.map(Number).join("");
  assert.equal(STATES.idle.mood, "idle");
  assert.equal(bits(STATES.idle), "00000000");
  assert.equal(STATES["working-1of3"].mood, "working");
  assert.equal(bits(STATES["working-1of3"]), "11100000", "plan + 2 of 6 build cells");
  assert.equal(bits(STATES["working-2of3"]), "11111000", "plan + 4 of 6 build cells");
  assert.equal(STATES["working-2of3"].head, 5);
  assert.equal(STATES.asking.mood, "asking");
  assert.equal(STATES.done.mood, "done");
  assert.equal(bits(STATES.done), "11111111");
  const verified = sceneStateOf(model({ phases: phases("done", "done", "done") }), { isWorking: false });
  assert.equal(bits(verified), "11111111");
  assert.equal(sceneStateOf(model({ phases: phases("done", "now", "todo"), progress: { done: 1, total: 20 } }), {}).lit[1], true, "any progress lights a cell");
  const keys = Object.values(STATES).map((state) => sceneKey(state, false));
  assert.equal(new Set(keys).size, keys.length);
  assert.notEqual(sceneKey(STATES.idle, false), sceneKey(STATES.idle, true));
});

test("every scene fits the Svg cap, keeps to the safe CSS, and has a still frame", () => {
  for (const [name, state] of Object.entries(STATES)) {
    for (const still of [false, true]) {
      const { source, alt, animated } = composeScene(state, { still, clockMs: 123_456 });
      const label = `${name}${still ? " still" : ""}`;
      assert.ok(source.length < SCENE_MAX, `${label}: ${source.length} chars`);
      assert.match(source, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u, label);
      assert.ok(alt.length > 10, label);
      assert.doesNotMatch(source, /crispEdges/u, label);
      assert.doesNotMatch(source, /<script|\son[a-z]+=|href="(?!#)|url\((?!#)|@import/iu, label);
      for (const [, query] of source.matchAll(/@media\s*([^{]*)\{/gu)) assert.match(query.trim(), /^\((?:prefers-reduced-motion: reduce|prefers-color-scheme: light|max-width: \d+px)\)$/u, `${label}: ${query}`);
      if (still) {
        assert.equal(animated, false, label);
        assert.doesNotMatch(source, /@keyframes|animation/u, label);
      } else {
        assert.equal(animated, true, label);
        assert.match(source, /@media \(prefers-reduced-motion: reduce\)\{\*\{animation:none!important\}\}/u, `${label}: reduced motion holds a still frame`);
        assert.match(source, /--t:/u, `${label}: the shared clock`);
      }
    }
  }
  const at = (clockMs) => composeScene(STATES["working-1of3"], { clockMs }).source;
  assert.equal(at(1000).replace(/--t:[^;]+;/u, ""), at(9000).replace(/--t:[^;]+;/u, ""), "the clock moves only the shared phase");
  assert.notEqual(at(1000), at(9000));
});

// A fake host, as Claude Code drives the mod: hooks by event, `$` with a theme that records sets.
const host = ({ options = {}, theme = "draws", surfaces = ["desktop"] } = {}) => {
  const hooks = [];
  register((event, matcher, hook) => {
    hooks.push(typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook });
    return { catch: () => undefined };
  }, { glyphs: "basic", motion: "full", ...options });
  const sets = [];
  const drawn = [];
  let now = 50_000_000;
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: (props) => ({ kind: "text", props }),
    Client: (props) => ({ kind: "client", props }),
    Svg: (props) => {
      drawn.push(props);
      return { kind: "svg", props };
    },
  };
  const $ = {
    fs: { stat: async () => null, read: async () => { throw new Error("ENOENT"); }, list: async () => [] },
    session: { cwd: async () => "/nowhere/project", id: async () => "look-0001", usage: async () => null, surfaces: async () => surfaces },
    agent: { list: async () => [] },
    clock: { now: async () => (now += 10), after: () => undefined, every: () => () => undefined },
    env: { get: async () => undefined },
    settings: { read: async () => null },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, resolve: () => elements, notify: async () => ({}) },
  };
  if (theme === "throws") {
    Object.defineProperty($, "theme", { get: () => { throw new Error("no theme on this build"); } });
  } else if (theme !== "absent") {
    $.theme = {
      set: async (args) => {
        sets.push(args);
        return theme === "late" && sets.length === 1 ? { isDrawn: false, reason: "no client that draws themes is attached" } : { isDrawn: true, requestId: `r${sets.length}` };
      },
      clear: async () => ({ isDrawn: false, reason: "cleared" }),
    };
  }
  const fire = async (event, e, matcher = {}) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const step = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => step(index + 1, next)) : "next");
    return step(0, e);
  };
  installModH(() => elements);
  return { fire, sets, drawn };
};

const backdrop = (surface = "desktop") => ({ surface, props: { scene: SCENE, plugin: "litclaude", glass: { blur: GLASS.blur, opacity: GLASS.opacity } } });

test("session.start sets the look once; prompts do not set it again", async () => {
  const { fire, sets } = host();
  await fire("session.start", {});
  await fire("prompt.submit", { text: "hi", origin: { kind: "user" } });
  await fire("prompt.submit", { text: "again", origin: { kind: "user" } });
  assert.equal(sets.length, 1);
  assert.equal(sets[0].backdrop.scene, SCENE);
  assert.deepEqual(checkColors(sets[0].colors).filter((line) => /isn't a theme color|paints nothing|Desktop won't paint/u.test(line)), []);
});

test("a window that attached late gets the look again at the first prompt, once", async () => {
  const { fire, sets } = host({ theme: "late" });
  await fire("session.start", {});
  assert.equal(sets.length, 1);
  await fire("prompt.submit", { text: "hi", origin: { kind: "user" } });
  await fire("prompt.submit", { text: "again", origin: { kind: "user" } });
  assert.equal(sets.length, 2);
});

test("look off sets nothing and draws no backdrop", async () => {
  const { fire, sets, drawn } = host({ options: { look: "off" } });
  await fire("session.start", {});
  await fire("prompt.submit", { text: "hi", origin: { kind: "user" } });
  assert.equal(sets.length, 0);
  assert.equal(await fire("ui.render", backdrop(), { component: "Backdrop" }), "next");
  assert.equal(drawn.length, 0);
});

for (const theme of ["absent", "throws"]) {
  test(`an older host (theme ${theme}) starts without a throw`, async () => {
    const { fire } = host({ theme });
    await fire("session.start", {});
    await fire("prompt.submit", { text: "hi", origin: { kind: "user" } });
  });
}

test("the Backdrop hook draws the scene on desktop and mobile only, and follows the state", async () => {
  const { fire, drawn } = host();
  await fire("session.start", {});
  assert.equal(await fire("ui.render", backdrop("terminal"), { component: "Backdrop" }), "next");
  assert.equal(await fire("ui.render", { ...backdrop(), props: { ...backdrop().props, scene: "someone-else" } }, { component: "Backdrop" }), "next");
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  await fire("ui.render", backdrop("mobile"), { component: "Backdrop" });
  assert.equal(drawn.length, 2);
  assert.equal(drawn[0].isInteractive, true);
  assert.match(drawn[0].alt, /idle/u);
  await fire("turn.start", {});
  await fire("tool.call", { tool: "AskUserQuestion" }).catch(() => undefined);
  await fire("turn.complete", { answer: "Which file should I change?" });
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  assert.match(drawn.at(-1).alt, /asking/u);
});

test("look still draws an image with no animation", async () => {
  const { fire, drawn } = host({ options: { look: "still" } });
  await fire("session.start", {});
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  assert.equal(drawn[0].isInteractive, undefined);
  assert.doesNotMatch(drawn[0].source, /@keyframes/u);
  assert.ok(BURST_MS >= 4000);
});

test("the mod spells the theme call as the loader requires: never $.theme as a value", () => {
  // Code only: the loader reads no comments.
  const source = readFileSync(new URL("../plugins/litclaude/hooks/lit-mod.mjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gmu, "");
  const uses = [...source.matchAll(/\$\.theme\b(.{0,6})/gu)].map(([, after]) => after);
  assert.ok(uses.length > 0);
  for (const after of uses) assert.match(after, /^\.set\(/u, `$.theme${after}`);
});

test("motion runs on solved springs with a bezier fallback, a curve per kind of part, and readouts per state", () => {
  // Each spring settles at 1 with at most one small overshoot and no visible second swing.
  for (const [name, c] of Object.entries(EASE)) {
    const v = c.values;
    assert.equal(v[0], 0, name);
    assert.equal(v.at(-1), 1, name);
    assert.ok(Math.max(...v) <= 1.1, `${name}: overshoot under 10 %`);
    const peak = v.indexOf(Math.max(...v));
    assert.ok(Math.min(...v.slice(peak)) >= 0.99, `${name}: no second swing`);
    assert.match(c.linear, /^linear\(0,[\d.,]+,1\)$/u);
    // The fallback bezier follows the spring within 0.06 at every stop.
    const [x1, y1, x2, y2] = c.bezier.match(/[\d.]+/gu).map(Number);
    for (let i = 0; i < v.length; i += 1) {
      const x = i / (v.length - 1);
      let lo = 0, hi = 1;
      for (let k = 0; k < 40; k += 1) {
        const t = (lo + hi) / 2;
        if (3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3 < x) lo = t; else hi = t;
      }
      const t = (lo + hi) / 2;
      const y = 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
      assert.ok(Math.abs(y - v[i]) < 0.06, `${name}: bezier off by ${Math.abs(y - v[i]).toFixed(3)} at ${x}`);
    }
  }
  for (const [name, state] of Object.entries(STATES)) {
    const { source } = composeScene(state, { clockMs: 5000 });
    // Every linear() comes after its bezier in the same block, so an older engine keeps the bezier.
    const linears = source.match(/animation-timing-function:linear\([^)]*\)/gu) ?? [];
    assert.ok(linears.length > 0, `${name}: spring curves`);
    for (const c of Object.values(EASE)) {
      for (const at of source.split(`animation-timing-function:${c.linear}`).slice(0, -1)) assert.ok(at.endsWith(`animation-timing-function:${c.bezier};`), `${name}: fallback before linear()`);
    }
    // Several distinct curves, no single one for everything, and none of v3's in-out snap.
    const curves = new Set(source.match(/animation-timing-function:(?:linear\([^)]*\)|cubic-bezier\([^)]*\))/gu));
    assert.ok(curves.size >= 6, `${name}: ${curves.size} distinct curves`);
    assert.ok(!source.includes("cubic-bezier(.83,0,.17,1)"), `${name}: no shared snap curve`);
    for (const lag of [".l1{--d:.03s}", ".l2{--d:.07s}", ".l3{--d:.09s}"]) assert.ok(source.includes(lag), `${name}: ${lag}`);
    const read = readoutsOf(state);
    for (const line of [...read.stages, read.state, read.seq]) {
      assert.ok(source.includes(`>${line}<`), `${name}: ${line}`);
      assert.ok(composeScene(state, { still: true }).source.includes(`>${line}<`), `${name} still: ${line}`);
    }
  }
  // Embers each carry their own life, rise, sway and phase.
  const lives = new Set(composeScene(STATES.idle).source.match(/--dur:[\d.]+s/gu));
  assert.ok(lives.size >= 3, "varied ember lifetimes");
  // The finish keeps to the band and below: its layer is clipped under the title strip.
  const done = composeScene(STATES.done).source;
  assert.match(done, /<clipPath id="cb"><rect y="44"/u);
  assert.ok(done.includes('<g clip-path="url(#cb)">'));
  assert.ok(Object.values(BEZIER).every((b) => /^cubic-bezier\([\d.,]+\)$/u.test(b)));
  assert.equal(readoutsOf(STATES["working-2of3"]).phases, "PLAN 1/1 · BUILD 4/6 · VERIFY 0/1");
  assert.equal(readoutsOf(STATES["working-2of3"]).state, "STATE: WORKING");
  assert.equal(readoutsOf(STATES.done).seq, "SEQ 11111111 · 0xFF");
  assert.equal(readoutsOf(STATES.asking).state, "STATE: ASKING");
  assert.equal(readoutsOf(STATES.idle).state, "STATE: STANDBY", "idle reads as a dormant panel");
});


// The desktop frosts a centred column the width of the transcript (768 px by default) with a 48 px
// blur ramp beyond it, so the scene is laid out from the box's centre: sharp parts in the gutters
// past 456 px, the build cells behind the glass, nothing on the glass edge.
test("v5 geometry: the plan and verify cells, the frame, the readouts and the embers live in the gutters; the build cells behind the glass", () => {
  for (const [name, state] of Object.entries(STATES)) {
    const { source } = composeScene(state, { clockMs: 0 });
    const cells = [...source.matchAll(/<svg x="50%" y="80" overflow="visible"><g(?: class="(p[lr])")?><g transform="translate\((-?\d+) 0\)">(?:<g class="[^"]*">)?<rect class="sh/gu)].map(([, side, dx]) => ({ side, dx: Number(dx) }));
    assert.deepEqual(cells.map((cell) => cell.dx), [-496, -300, -180, -60, 60, 180, 300, 496], name);
    assert.deepEqual(cells.filter((cell) => cell.side).map((cell) => cell.side), ["pl", "pr"], `${name}: only the plan and verify cells tuck in`);
    for (const x of [-456, 456]) assert.ok(source.includes(`<line class="fd" x1="${x}" y1="140" x2="${x}" y2="100%"`), `${name}: the frame's rule at ${x}`);
    for (const [, group] of source.matchAll(/<g class="e[lr]">(.*?)<\/g><\/svg>/gu)) {
      for (const [, x] of group.matchAll(/ c?x="(-?\d+)"/gu)) assert.ok(Math.abs(Number(x)) >= 468, `${name}: ember at ${x} stays in the gutter`);
    }
    assert.match(source, /<svg x="50%" y="0" overflow="visible"><g class="wd"><text class="rd[^"]*" x="-470" y="150" text-anchor="end"/u, `${name}: readouts right-aligned to the frame`);
    assert.ok(source.includes("@media (max-width: 1239px){.wd{display:none}}"), `${name}: readouts need a wide box`);
    assert.ok(source.includes("@media (max-width: 1039px){.gt{display:none}.el,.er{display:none}.pl{transform:translateX(152px)}.pr{transform:translateX(-152px)}}"), `${name}: a narrow box drops the gutters and tucks P and V behind the glass`);
    assert.doesNotMatch(source, /<svg x="(?!50%|100%)[\d.]+%"/u, `${name}: nothing placed by a share of the box`);
  }
});

test("lit on and off differ: idle is dormant, a run lights the frame, the gutters and the fuse", () => {
  const idle = composeScene(STATES.idle, { clockMs: 0 }).source;
  const working = composeScene(STATES["working-1of3"], { clockMs: 0 }).source;
  const asking = composeScene(STATES.asking, { clockMs: 0 }).source;
  assert.doesNotMatch(idle, /class="fa"/u, "idle: no lit frame");
  assert.match(idle, />STATE: STANDBY</u);
  assert.match(working, /<line class="fa" x1="-456"/u, "working: the frame lights");
  assert.match(working, /svg\{--fon:var\(--lit\)\}/u, "working: in orange");
  assert.match(asking, /svg\{--fon:var\(--sig\)\}/u, "asking: in lime");
  const embers = (source) => (source.match(/class="ei (?:eg )?z m/gu) ?? []).length;
  assert.ok(embers(working) >= 3 * embers(idle), `embers ${embers(idle)} idle, ${embers(working)} working`);
  assert.match(working, /class="rd ra"/u, "working: readouts in the active colour");
  assert.doesNotMatch(idle, /class="rd ra"/u);
});

test("the power change plays once: on into a run, a slower off back to idle, never in a still frame or once it is over", () => {
  assert.deepEqual({ ...POWER_MS }, { on: 1000, off: 1800 });
  const on = composeScene(STATES["working-1of3"], { clockMs: 0, power: { dir: "on", ageMs: 0 } }).source;
  assert.match(on, /<g class="pwn pw0">/u);
  assert.match(on, /--pa:0s;/u);
  assert.match(on, /\.pwn,\.pwf,\.pgw\{animation-delay:calc\(var\(--k,0s\) - var\(--pa\)\)\}/u, "less the time since the change");
  // A row of slashes wipes out along the rail, a glyph a step, within 0.9 s.
  const slashes = [...on.matchAll(/<text class="pgw w(\d+) off"/gu)];
  assert.equal(slashes.length, 36);
  assert.ok(0.1 + 17 * 0.02 + 0.45 <= 0.9);

  const later = composeScene(STATES["working-1of3"], { clockMs: 0, power: { dir: "on", ageMs: 400 } }).source;
  assert.match(later, /--pa:0\.4s;/u, "a scene composed mid-change carries on from there");
  const over = composeScene(STATES["working-1of3"], { clockMs: 0, power: { dir: "on", ageMs: 1000 } }).source;
  assert.doesNotMatch(over, /class="pw[nf] /u);
  assert.doesNotMatch(over, /class="pgw /u);
  const off = composeScene(STATES.idle, { clockMs: 0, power: { dir: "off", ageMs: 0 } }).source;
  assert.match(off, /<g class="pwf pw0">/u, "the lit frame fades back down over the dim one");
  assert.match(off, /\.pwf\{animation:pwf 1\.6s both\}/u);
  const still = composeScene(STATES["working-1of3"], { still: true, power: { dir: "on", ageMs: 0 } }).source;
  assert.doesNotMatch(still, /pwn|@keyframes/u);
});

test("the mod plays the power-on when a run starts and the power-down when it ends, once each", async () => {
  const { fire, drawn } = host();
  await fire("session.start", {});
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  assert.doesNotMatch(drawn.at(-1).source, /class="pw[nf] /u, "the first scene of a session plays no change");
  await fire("turn.start", {});
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  assert.match(drawn.at(-1).source, /<g class="pwn pw0">/u, "idle to a run powers on");
  const first = drawn.at(-1).source;
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  assert.equal(drawn.at(-1).source, first, "a redraw of the same state keeps the same scene");
  await fire("turn.complete", { answer: "done here" });
  await fire("ui.render", backdrop(), { component: "Backdrop" });
  assert.match(drawn.at(-1).alt, /idle/u);
  assert.match(drawn.at(-1).source, /<g class="pwf pw0">/u, "a run back to idle powers down");
});

// v6: the particles are type. Near embers spin | / - \ on stepped frames and cool from lime or
// orange to ember red; sparks age * + · -; bursts throw * and ×; far embers and the fire are soft,
// pre-blurred light.
test("glyph particles: the set, their stepped life cycles, and soft light with no animated filter", () => {
  const working = composeScene(STATES["working-1of3"], { clockMs: 0 }).source;
  const done = composeScene(STATES.done, { clockMs: 0 }).source;
  const glyphs = (source) => new Set([...source.matchAll(/<text[^>]*>([^<])<\/text>/gu)].map(([, g]) => g));
  for (const g of ["|", "/", "\\", "-", "*", "+", "·"]) assert.ok(glyphs(working).has(g), `working: ${g}`);
  for (const g of ["*", "×", "+", "·"]) assert.ok(glyphs(done).has(g), `done: ${g}`);
  assert.match(working, /<text x="-470" y="\d+">[·:|+▪]{8}<\/text>/u, "the ticker's rows");
  assert.ok(working.includes("▪"), "a block now and then");
  assert.deepEqual([...SPIN], ["|", "/", "-", "\\"]);
  assert.deepEqual([...SPARK], ["*", "+", "·", "-"]);
  // Glyph swaps are stepped; the hidden glyphs stay hidden when motion is reduced.
  assert.match(working, /\.n0,\.n1,\.n2,\.n3\{animation:nk var\(--sp\) steps\(1,end\) infinite\}/u);
  for (const k of [1, 2, 3]) assert.ok(working.includes(`.n${k}{animation-delay:calc(var(--sp) * ${k / 4 - 1})}`));
  assert.match(working, /<text class="n1 off" x="-?\d+" y="[\d.]+%">\/<\/text>/u);
  for (let v = 0; v < 3; v += 1) for (let j = 0; j < 4; j += 1) assert.ok(working.includes(`.dg${v}${j}{animation:dg${v}${j} 2.4s steps(1,end) infinite}`), `drip glyph ${v}${j}`);
  assert.match(done, /<text class="(?:sc|so) b0">[*×]<\/text><text class="sl b1 off">\+<\/text><text class="sr b2 off">·<\/text>/u);
  assert.match(working, /@keyframes eg\{0%\{[^}]*fill:var\(--c0\)[^}]*\}12%[^}]*\}35%\{fill:var\(--lit\)\}65%\{[^}]*fill:var\(--emr\)/u, "embers cool lime, orange, ember red");
  for (const t of [1, 2, 3]) assert.match(working, new RegExp(`class="ei eg z m\\d+ gl t${t}"`, "u"), `tier ${t}`);
  // Soft light is gradients; no filter sits on anything that moves.
  for (const source of [working, done, composeScene(STATES.asking).source, composeScene(STATES.idle).source]) {
    for (const [tag] of source.matchAll(/<[a-z]+ [^>]*filter="url\(#[a-z]+\)"[^>]*>/gu)) {
      assert.doesNotMatch(tag, /class="[^"]*\b(?:z|ei|ew|bs|gv|dp\d)\b/u, `animated part with a filter: ${tag}`);
    }
    assert.doesNotMatch(source, /<g filter="url\(#soft\)">|filter="url\(#softb\)"/u);
  }
  assert.match(working, /<ellipse class="fk fd0 z q\d" [^>]*fill="url\(#fl\)"\/>/u, "the fire is pre-blurred light");
  assert.match(working, /<circle class="ei z m\d+" [^>]*fill="url\(#eb\)"/u, "far embers are soft dots");
  assert.doesNotMatch(composeScene(STATES.idle, { clockMs: 0 }).source, /class="fk /u, "no fire at rest");
  // Machine gestures while a run is on: a spinner by the state, a stepped ticker, marks that step.
  assert.match(working, /<text class="n0 sv">\|<\/text>/u);
  assert.match(working, /\.tkr\{animation:tk 12s steps\(24,end\) infinite\}/u);
  assert.match(working, /class="mk rk z"/u);
  const idle = composeScene(STATES.idle, { clockMs: 0 }).source;
  assert.doesNotMatch(idle, /class="n0 sv"|tkr z|rk z/u, "the gestures rest with the panel");
  // The still frame shows one glyph per particle and no animation.
  const still = composeScene(STATES["working-1of3"], { still: true }).source;
  assert.doesNotMatch(still, / off"|@keyframes/u);
  // Size cap: every state with a power change stays well under the Svg cap.
  for (const state of Object.values(STATES)) for (const power of [null, { dir: "on", ageMs: 0 }, { dir: "off", ageMs: 0 }]) {
    assert.ok(composeScene(state, { clockMs: 7000, power }).source.length < 100_000);
  }
});
