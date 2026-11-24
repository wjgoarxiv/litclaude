// The sunset in the Claude apps: the SVG card's scene (lib/mod/svg-sunset.mjs) and the Ignition look's
// synthwave ground (lib/mod/backdrop.mjs). Words come first, idle and off hold still, and a new drawing
// carries on where the last one was.
import assert from "node:assert/strict";
import test from "node:test";

import { POWER_MS, SUNK, composeScene, sceneStateOf } from "../plugins/litclaude/lib/mod/backdrop.mjs";
import { textWidth } from "../plugins/litclaude/lib/mod/layout.mjs";
import { lerpColor } from "../plugins/litclaude/lib/mod/motion.mjs";
import { parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { SVG_CARD, THREAD_ROW_H, composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { BRAND_STOPS, NEON, SKY, SUN_SPOTS, sunSpot } from "../plugins/litclaude/lib/mod/svg-sunset.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 20_000_000;
const SID = "app-sunset-0001";
const CYAN = "#5fd7ff";
const none = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, handoff: null });
const usage = { context: { percent: 42 }, rateLimits: [{ kind: "five_hour", percentUsed: 31 }, { kind: "seven_day", percentUsed: 12 }] };
const frame = (skill, family, stage, extra = {}) => ({ skill, family, stage, role: "spine", status: "active", verdicts: {}, at: new Date(NOW - 2000).toISOString(), ...extra });
const flow = (...frames) => { const stack = parseWorkflowStack({ version: 1, sessionId: SID, frames, history: [] }, SID); return { stack, record: stack.record }; };
const work = (next = "implement shout") => ({ ...none(), ignition: { discipline: "start-work", at: NOW - 1000 }, work: { id: "w", status: "active", total: 5, checked: 2, nextTask: next, lanes: [], lastEvent: null }, workflow: flow(frame("start-work", "main", "work", { n: 2, total: 5 })) });
const chips = (...ids) => ids.map((id, i) => ({ id, at: NOW - 100 - i, state: "current" }));
const band = (over) => buildBandModel({ now: NOW, usage, git: "main", ...over });
const LONG = "rewrite the installer so a torn profile write is rolled back and the old profile is restored";
const CARDS = {
  idle: band({ snapshot: none() }),
  running: band({ snapshot: work(), isWorking: true, skills: chips("start-work"), step: { name: "Edit", at: NOW - 2000 } }),
  hangul: band({ snapshot: work("설치 도중 실패하면 되돌리기 구현"), isWorking: true, skills: chips("start-work") }),
  lanes: band({ snapshot: { ...none(), ignition: { discipline: "start-work", at: NOW - 1000 }, workflow: flow(frame("lit-loop", "loop", "GREEN", { status: "paused", n: 2, total: 5 }), frame("start-work", "main", "work", { role: "side", n: 3, total: 6 })) }, isWorking: true, agents: ["executor", "librarian-researcher", "lit-verifier"].map((name, i) => ({ id: `a${i}`, name, type: name, status: "running" })), skills: chips("start-work") }),
  turn: band({ snapshot: work(), waiting: { reason: "question" }, skills: chips("start-work") }),
  "turn at rest": band({ snapshot: none(), waiting: { reason: "question" } }),
  done: band({ snapshot: none(), completion: { id: "goal:x", detail: "goal met · 3/3 criteria" } }),
  review: band({ snapshot: { ...none(), ignition: { discipline: "review-work", at: NOW - 1000 }, workflow: flow(frame("review-work", "main", "review", { verdicts: { goal: "pass", qa: "running", security: "fail" } })) }, isWorking: true }),
  rewind: band({ snapshot: { ...none(), ignition: { discipline: "lit-adhd", at: NOW - 1000 } }, isWorking: true, skills: chips("lit-adhd") }),
  club: band({ snapshot: none(), club: true, invitedBy: "octocat" }),
  warning: { ...band({ snapshot: work(), isWorking: true }), warnings: [{ tone: "red", subject: "ui probe", text: "missing label", hint: "" }] },
  crowded: band({ snapshot: work(LONG), isWorking: true, skills: chips("start-work", "lit-plan", "litresearch", "review-work", "lit-humanizer", "deep-interview") }),
};
const SCENES = {
  idle: sceneStateOf(null, {}),
  working: sceneStateOf({ phases: { plan: "done", work: "now", review: "todo" }, progress: { done: 2, total: 5 } }, { isWorking: true }),
  asking: sceneStateOf({ phases: { plan: "done", work: "now", review: "todo" }, progress: { done: 3, total: 5 }, waiting: "question" }, { isWorking: true }),
  done: sceneStateOf(null, { burst: true }),
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const draw = (name, opts = {}) => composeSvgCard(CARDS[name], { motion: "full", accent: CYAN, ...opts }).source;
const sceneOf = (source) => source.slice(source.indexOf('<g class="lit-scene">'));
const decode = (body) => body.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&amp;/gu, "&");
// Where each word of the card stands, read back from the drawing itself.
const words = (source) => [...source.matchAll(/<text (?!class)x="([\d.]+)" y="(\d+)"([^>]*)>([^<]*)</gu)].map(([, x, y, attrs, body]) => {
  const w = textWidth(decode(body)) * SVG_CARD.cell;
  const x0 = attrs.includes('text-anchor="end"') ? Number(x) - w : Number(x);
  return { body, x0, x1: x0 + w, y0: Number(y) - 10, y1: Number(y) + 3 };
});
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
// A drawing is well formed: every tag closed in order, every id used once, every reference resolved.
const assertValid = (source, label) => {
  const stack = [];
  for (const [, close, tag, , self] of source.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/gu)) {
    if (close) assert.equal(stack.pop(), tag, `${label}: </${tag}>`);
    else if (!self) stack.push(tag);
  }
  assert.deepEqual(stack, [], label);
  assert.equal((source.match(/</gu) ?? []).length, (source.match(/<\/?[a-zA-Z]+(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/gu) ?? []).length, `${label}: every < opens a whole tag`);
  const ids = [...source.matchAll(/ id="([^"]+)"/gu)].map(([, id]) => id);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate id`);
  for (const [, id] of source.matchAll(/(?:url\(#|href="#)([^)"]+)/gu)) assert.ok(ids.includes(id), `${label}: #${id} is defined`);
  assert.doesNotMatch(source, /NaN|undefined|Infinity|null/u, label);
};

test("every card state carries the sunset, and no part of it touches a word", () => {
  for (const name of Object.keys(CARDS)) {
    const source = draw(name);
    const scene = sceneOf(source);
    const taken = words(source);
    assert.match(scene, /class="lit-sun"/u, `${name}: the sun`);
    const height = Number(/height="(\d+)"/u.exec(source)[1]);
    const sun = [...scene.match(/class="lit-sun" d="([^"]+)"/u)[1].matchAll(/M([\d.]+) ([\d.]+)A([\d.]+) \3 0 0 1 ([\d.]+) ([\d.]+)H([\d.]+)A\3 \3 0 0 1 ([\d.]+)/gu)];
    const boxes = sun.map(([, x0, y1, , , y0, , x1]) => ({ part: "sun", x0: Number(x0), x1: Number(x1), y0: Number(y0), y1: Number(y1) }));
    assert.ok(boxes.length >= 1, `${name}: the sun's slices`);
    const glow = scene.match(/class="lit-glow" d="M([\d.]+) ([\d.]+)a([\d.]+)/u);
    for (const [, d, size] of scene.matchAll(/class="lit-star" d="([^"]+)"[^>]*stroke-width="([\d.]+)"/gu)) for (const [, x, y] of d.matchAll(/M([\d.]+) ([\d.]+)h0/gu)) boxes.push({ part: "star", x0: x - size, x1: Number(x) + Number(size), y0: y - size, y1: Number(y) + Number(size) });
    const [, left, top] = scene.match(/<clipPath id="lit-sea"><path d="M([\d.]+) ([\d.]+)H/u);
    boxes.push({ part: "sea", x0: Number(left), x1: SVG_CARD.width, y0: Number(top), y1: height });
    if (glow) {
      const [from, cy, r] = glow.slice(1).map(Number);
      const cx = from + r;
      for (const word of taken) assert.ok(Math.hypot(Math.max(word.x0 - cx, 0, cx - word.x1), Math.max(word.y0 - cy, 0, cy - word.y1)) >= r, `${name}: the glow reaches ${word.body}`);
    }
    const shoot = scene.match(/class="lit-shoot" x="(\d+)" y="(\d+)" width="(\d+)"[\s\S]*?values="0 0;(-\d+) (\d+)/u);
    if (shoot) { const [x, y, w, dx, dy] = shoot.slice(1).map(Number); boxes.push({ part: "shooting star", x0: x + dx, x1: x + w, y0: y, y1: y + dy + 2 }); }
    for (const box of boxes) {
      const hit = taken.find((word) => overlaps(box, word));
      assert.equal(hit, undefined, `${name}: the ${box.part} covers ${hit?.body}`);
    }
  }
});

test("the sun gives way to words: smaller, then aside, then its rim, then gone", () => {
  const at = (...taken) => sunSpot(taken, 880, 160);
  const pick = (spot) => spot && [spot.cx, spot.r, spot.sink];
  assert.deepEqual(pick(at()), SUN_SPOTS[0]);
  assert.deepEqual(pick(at({ x0: 18, y0: 75, x1: 640, y1: 90 })), SUN_SPOTS[1], "a long detail line");
  assert.deepEqual(pick(at({ x0: 18, y0: 100, x1: 600, y1: 120 })), SUN_SPOTS[2], "a long chips row");
  assert.deepEqual(pick(at({ x0: 18, y0: 100, x1: 840, y1: 120 })), SUN_SPOTS[3], "a full chips row leaves the rim");
  assert.equal(at({ x0: 18, y0: 131, x1: 860, y1: 146 }), null, "a full bottom row leaves nothing");
  assert.ok(sunSpot([], 880, 160 + THREAD_ROW_H * 4).cy === 160 + THREAD_ROW_H * 4 - 24, "thread rows push it down");
});

test("the card keeps its size, its words and their contrast", () => {
  for (const name of Object.keys(CARDS)) {
    const source = draw(name);
    const threads = CARDS[name].threads?.reserve ?? 0;
    assert.match(source, new RegExp(`^<svg [^>]*width="880" height="${160 + THREAD_ROW_H * threads}"`, "u"), name);
    for (const [, fill, attrs] of source.matchAll(/<text (?!class)[^>]*?fill="(#[0-9a-f]{6})"([^>]*)>(?!·<)/giu)) {
      // Dark ink stands on a pill, muted ink on the muted pill; separators and rails are not words.
      if (lum(fill) < 0.02 || ["#30363d", "#46505c", "#adb5bf"].includes(fill)) continue;
      for (const sky of SKY) assert.ok(contrast(fill, sky) >= 4.5, `${name}: ${fill} on ${sky} is ${contrast(fill, sky).toFixed(2)} ${attrs}`);
    }
  }
  for (const stop of [...BRAND_STOPS, ...BRAND_STOPS.map((color) => lerpColor(color, "#ffffff", 0.32)), lerpColor(CYAN, "#b48cff", 0.75), CYAN]) assert.ok(contrast("#0b0f14", stop) >= 4.5, `ink on ${stop}`);
});

test("neon, brand and stage: pink through violet to the accent, amber on your turn, a warning's own colour", () => {
  const running = draw("running");
  assert.match(running, /fill="url\(#lit-sky\)" stroke="url\(#lit-neon\)" stroke-width="2.5">/u);
  const stops = [...running.match(/<linearGradient id="lit-neon"[^>]*>(.*?)<\/linearGradient>/u)[1].matchAll(/stop-color="([^"]+)"/gu)].map(([, color]) => color);
  assert.deepEqual(stops, [...NEON, CYAN]);
  assert.match(running, /class="lit-shore"/u, "the border is lit under the sun");
  assert.match(running, /fill="url\(#lit-brand\)"/u);
  assert.match(running, /fill="url\(#lit-stage\)"/u);
  const idle = draw("idle");
  assert.match(idle, /stroke="url\(#lit-neon\)" stroke-width="1.5" stroke-opacity="0.8"/u, "dimmer and thinner at rest");
  assert.doesNotMatch(idle, /lit-stage|#ff2d95" ?\/><stop offset="0.5" stop-color="#b48cff"/u);
  assert.match(draw("turn at rest"), /id="lit-neon"[^>]*><stop offset="0" stop-color="#ff9a3c"/u);
  assert.match(draw("warning"), /fill="url\(#lit-sky\)" stroke="#ff5f5f"/u);
  assert.match(draw("rewind"), /stroke="url\(#lit-rainbow\)"/u);
  assert.match(draw("club"), /stroke="url\(#lit-club\)"/u);
});

test("gauges have round ends and keep the fraction", () => {
  const running = draw("running");
  const bar = [...running.matchAll(/<rect x="([\d.]+)" y="76" width="([\d.]+)" height="10" rx="5" fill="([^"]+)"/gu)].map(([, x, w, fill]) => ({ x, w: Number(w), fill }));
  assert.deepEqual(bar.map(({ fill }) => fill), ["#3a3f47", "url(#lit-bar)"]);
  assert.equal(bar[0].x, bar[1].x);
  assert.ok(Math.abs(bar[1].w / bar[0].w - 2 / 5) < 0.01);
  const ctx = [...running.matchAll(/<rect x="[\d.]+" y="133" width="([\d.]+)" height="8" rx="4"/gu)].map(([, w]) => Number(w));
  assert.ok(Math.abs(ctx[1] / ctx[0] - 0.42) < 0.01);
  assert.equal((draw("lanes").match(/height="9" rx="4.5"/gu) ?? []).length, 4, "two thread gauges, a track and a fill each");
});

test("idle, off and subtle hold the scene still, byte for byte", () => {
  for (const name of Object.keys(CARDS)) {
    const off = draw(name, { motion: "off" });
    assert.doesNotMatch(off, /<animate/u, name);
    assert.equal(off, draw(name, { motion: "off", clock: 987_654 }), `${name}: off does not depend on the clock`);
    assert.doesNotMatch(sceneOf(draw(name, { motion: "subtle" })), /<animate|lit-shoot|lit-heat/u, `${name}: subtle holds the sunset`);
    const moving = draw(name);
    if (CARDS[name].idle && name !== "rewind") assert.doesNotMatch(sceneOf(moving), /<animate/u, `${name}: at rest`);
    assert.equal(moving, draw(name), `${name}: nothing new keeps the same source`);
    const later = draw(name, { clock: 987_654 });
    assert.equal(later.replace(/begin="-\d+ms"/gu, ""), moving.replace(/begin="-\d+ms"/gu, ""), `${name}: the clock moves only where the loops open`);
  }
});

test("every loop of the scene closes without a seam and opens where the clock has it", () => {
  const scene = sceneOf(draw("running", { clock: 5000 }));
  const loops = [...scene.matchAll(/<animate(?:Transform)? ([^>]*?)\/>/gu)].map(([, attrs]) => Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/gu)].map(([, k, v]) => [k, v])));
  assert.ok(loops.length >= 9 && loops.length <= 15, `${loops.length} loops`);
  for (const loop of loops) {
    assert.match(loop.begin, /^-\d+ms$/u);
    assert.equal(loop.repeatCount, "indefinite");
    assert.ok(Number.parseInt(loop.dur, 10) >= 1800, `${loop.attributeName} ${loop.dur}: nothing flickers`);
    const values = loop.values.split(";");
    const first = values[0];
    const last = values.at(-1);
    if (loop.type === "translate" && loop.attributeName === "transform" && first !== last) {
      // A wave moves one whole wavelength, so its end is its start.
      const path = scene.slice(0, scene.indexOf(`values="${loop.values}"`)).match(/<path d="M-(\d+) [^"]*"[^>]*><animateTransform [^>]*$/u);
      assert.equal(last, `${path[1]} 0`, "one wavelength");
    } else if (loop.attributeName !== "gradientTransform") assert.equal(last, first, loop.values);
  }
  // Loops that share what they move and how long they take share one phase, so a swap never jumps.
  const seen = new Map();
  for (const loop of loops) {
    const key = `${loop.attributeName} ${loop.dur}`;
    if (seen.has(key)) assert.equal(loop.begin, seen.get(key), key);
    seen.set(key, loop.begin);
  }
});

test("the sea's colour stands still while its waves run", () => {
  // A wave's paint moves with it, so its gradient must be carried back just as far, or the colour jumps at every wrap.
  const { source } = composeSvgCard(CARDS.running, { clock: 3300 });
  const waves = [...source.matchAll(/<path d="M-\d+ \d+q[^"]*" stroke="url\(#(lit-water-\d)\)"[^>]*><animateTransform attributeName="transform" type="translate" values="0 0;(\d+) 0" ([^>]*)\/>/gu)];
  assert.equal(waves.length, 3);
  for (const [, id, step, timing] of waves) {
    const gradient = new RegExp(`<radialGradient id="${id}" href="#lit-water"><animateTransform attributeName="gradientTransform" type="translate" values="0 0;-(\\d+) 0" ([^>]*)/></radialGradient>`, "u").exec(source);
    assert.ok(gradient, `${id} is carried back`);
    assert.deepEqual([gradient[1], gradient[2]], [step, timing]);
  }
});

test("card drawings are valid, carry no filter and stay small", () => {
  for (const name of Object.keys(CARDS)) for (const motion of ["full", "subtle", "off"]) {
    const source = draw(name, { motion });
    assertValid(source, `${name} ${motion}`);
    assert.doesNotMatch(source, /<filter|feGaussian|<script|\son[a-z]+=|href="(?!#)/iu, `${name}: no filter, script or remote part`);
    assert.ok(source.length < 20_000, `${name} ${motion}: ${source.length} characters`);
    const size = (source.match(/<[a-zA-Z]/gu) ?? []).length;
    assert.ok(size < 230, `${name} ${motion}: ${size} elements`);
    assert.ok((sceneOf(source).match(/<animate/gu) ?? []).length <= 15, `${name} ${motion}`);
  }
});

test("the look wears the sunset in every state: sky, sun, ridge, floor and a calm column under the instruments", () => {
  for (const [name, state] of Object.entries(SCENES)) for (const still of [false, true]) {
    const { source } = composeScene(state, { still, clockMs: 4000 });
    const label = `${name}${still ? " still" : ""}`;
    assertValid(source.replace(/<style>.*?<\/style>/su, ""), label);
    const order = ['fill="url(#sky)"', 'fill="url(#stp)"', 'fill="url(#su)"', 'class="rgf"', 'class="fln"', 'fill="url(#calm)"', '<line class="fz"'].map((part) => source.indexOf(part));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `${label}: ${order}`);
    assert.match(source, /<rect x="-456" width="912" height="100%" fill="url\(#calm\)"\/>/u, `${label}: the column is calm, gutter to gutter`);
    assert.match(source, new RegExp(`transform="translate\\(0 ${SUNK[state.mood]}\\)"`, "u"), `${label}: how far the sun is up`);
    assert.equal((source.match(/class="flh/gu) ?? []).length, 8, `${label}: the floor's lines`);
    assert.equal(/class="flh flr/u.test(source), !still && state.mood !== "idle", `${label}: the floor rolls in a run alone`);
    assert.doesNotMatch(source, /filter="url\(#[a-z]+\)"[^>]*class="(?:flh|stf|rgf|fln)/u);
  }
  assert.ok(SUNK.idle > SUNK.asking && SUNK.asking > SUNK.working && SUNK.done === SUNK.working, "low at rest, up in a run");
});

test("both modes define every colour the scene uses", () => {
  const { source } = composeScene(SCENES.done, { clockMs: 0 });
  const style = /<style>(.*?)<\/style>/su.exec(source)[1];
  const [dark, light] = [/svg\{([^}]*--t:[^}]*)\}/u, /prefers-color-scheme: light\)\{svg\{([^}]*)\}/u].map((re) => new Map([...re.exec(style)[1].matchAll(/--([\w]+):(#[0-9A-F]{6})/giu)].map(([, k, v]) => [k, v])));
  assert.deepEqual([...light.keys()].sort(), [...dark.keys()].sort());
  for (const tokens of [dark, light]) {
    assert.ok(contrast(tokens.get("act"), tokens.get("sk0")) >= 4.5, "warm readouts on the sky");
    assert.ok(contrast(tokens.get("mark"), tokens.get("bg")) >= 4.5, "resting readouts");
  }
  const own = new Set([...style.matchAll(/var\(--([a-z][\w]*)\)/gu)].map(([, k]) => k));
  for (const name of ["sn0", "sn1", "sn2", "fg", "sk0", "sk3", "rg", "str", "cya"]) assert.ok(own.has(name), name);
});

test("the sun rises at the power-on and sinks at the power-down, once, less the time gone by", () => {
  const on = composeScene(SCENES.working, { clockMs: 0, power: { dir: "on", ageMs: 300 } }).source;
  assert.match(on, /<g class="suon" transform="translate\(0 0\)"/u);
  assert.match(on, /@keyframes su\{0%\{transform:translateY\(350px\)/u);
  assert.match(on, /\.pgw,\.suon,\.suoff\{animation-delay:calc\(var\(--k,0s\) - var\(--pa\)\)\}/u);
  assert.match(on, /\.suon\{animation:su 1s both\}\.suoff\{animation:su 1\.8s both\}/u);
  assert.deepEqual({ ...POWER_MS }, { on: 1000, off: 1800 });
  const off = composeScene(SCENES.idle, { clockMs: 0, power: { dir: "off", ageMs: 0 } }).source;
  assert.match(off, /<g class="suoff" transform="translate\(0 350\)"/u);
  for (const opts of [{}, { still: true, power: { dir: "on", ageMs: 0 } }]) assert.doesNotMatch(composeScene(SCENES.working, opts).source, /class="su(?:on|off)"|@keyframes su\{/u);
});

test("under reduced motion no shooting star hangs in the sky", () => {
  // The held frame has no keyframes, so a star that only they hide would stand still there.
  for (const state of Object.values(SCENES)) for (const [group] of composeScene(state, {}).source.matchAll(/<g class="sho[01][^>]*>/gu)) assert.match(group, / opacity="0"/u);
  assert.match(composeScene(SCENES.working, {}).source, /<g class="sho0 /u);
});

test("the look's loops keep the shared 24 s clock", () => {
  for (const state of Object.values(SCENES)) {
    const { source } = composeScene(state, { clockMs: 0 });
    for (const [, name, seconds] of source.matchAll(/\.(tw|sgl|flr|gm|sho0|sho1)\{[^}]*animation:\w+ ([\d.]+)s/gu)) assert.ok(Math.abs(24 / seconds - Math.round(24 / seconds)) < 1e-9, `${name} ${seconds}s`);
    for (const [, seconds] of source.matchAll(/--(?:td|gd):([\d.]+)s/gu)) assert.ok(Math.abs(24 / seconds - Math.round(24 / seconds)) < 1e-9, `${seconds}s`);
    for (const [cls] of source.matchAll(/class="(?:stf tw|flh flr|gm |sgl )[^"]*"/gu)) assert.match(cls, /\bz\b/u, cls);
  }
});
