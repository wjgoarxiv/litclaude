// The Ignition look for the desktop and mobile apps: the colours `$.theme.set` sends once a session
// (ignition orange, signal lime, ivory, carbon navy) and the backdrop scene drawn behind the
// conversation. The terminal draws no look; its band and spinner stay as they are.
//
// The scene is an instrument panel with the conversation mounted in it. The desktop draws the scene
// across the whole content frame and frosts a centred column over it: the column is the transcript
// measure (768 px unless the person widened it), fully blurred, with a 48 px blur ramp outside it.
// So the scene has two zones, measured in CSS pixels from the box's centre: the sharp gutters
// beyond `GUTTER` hold the plan and verify cells, the frame brackets that mount the column, the
// readouts, the embers and the rails; the diffuse zone behind the glass holds what reads through a
// blur: the fuse as a heat streak, the lit build cells as soft blooms, a low heat haze. Narrower
// boxes drop the readouts, then pull the plan and verify cells in behind the glass and drop the
// frame, so nothing ever straddles the glass edge.
//
// Cells light from the real LIT progress (view.mjs phases and progress), and the mood follows the
// session: idle is dormant (a cold fuse, a few dim embers, a dim frame, STATE: STANDBY), and a lit
// run powers the panel up: working (the spark burns the fuse towards the next cell), asking (signal
// rings from the cell the work waits at, a lime frame) and done (the fuse ignites end to end,
// bursts open in the gutters, then the verify cell settles lime). Going from idle to a run plays a
// power-on (the frame ignites outward from the column on a spring); going back plays a slower
// power-down.
//
// Motion is physical: the spark runs on a solved spring and settles at its cell, cells kick and
// follow through, embers rise against drag and sparks fall under gravity, and parts that move
// together trail one another by tens of milliseconds, so nothing moves in lockstep.
// Every animation shares one 24 s clock: each duration divides it, and the scene is drawn with
// `--t`, the clock's phase when it was composed, as a negative delay. A scene swapped in for a new
// state therefore picks up every loop where the last one was instead of restarting it. One-shots
// (the power change and the finish) start when their scene loads, less `--pa`, the time since the
// change, so a scene composed again later does not play them again.

import { makeColors } from "../../hooks/make-colors.js";

export const SCENE = "litclaude-ignition";
// No raw tint: each panel keeps the look's own colour in light and dark mode.
export const GLASS = Object.freeze({ blur: 18, opacity: 0.62 });
export const SCENE_MAX = 131_072;
// How long the finish's scene holds before it settles back to the live state.
export const BURST_MS = 9000;
const CLOCK_S = 24;

export const IGNITION = {
  label: "LitFamily Ignition",
  roles: { accent: "#FF6337", danger: "#E5233F", success: "#5DBB63", warning: "#F5A524", pro: "#D7F75B" },
  light: {
    roles: { accent: { stops: { 600: "#99320C" } }, warning: { stops: { 600: "#7E5000" } } },
    gray: {
      anchors: {
        "surface-0": "#EBE7D5",
        "surface-1": "#F2EFDF",
        "surface-2": "#F7F5EA",
        "surface-3": "#F7F5EA",
        "text-primary": "#0B111A",
        "text-secondary": "#323843",
        "text-muted": "#545862",
      },
    },
  },
  dark: {
    roles: { accent: { stops: { 300: "#FF6337" } }, danger: { stops: { 300: "#FF6E8E" } }, pro: { stops: { 300: "#D7F75B" } } },
    gray: {
      anchors: {
        "surface-0": "#080D14",
        "surface-1": "#0D141E",
        "surface-2": "#121A26",
        "surface-3": "#141C28",
        "text-primary": "#F2EFDF",
        "text-secondary": "#CAC7B8",
        "text-muted": "#9E9C91",
      },
    },
  },
};

/** The look's whole colour theme and makeColors' contrast notes. */
export const lookColors = () => makeColors(structuredClone(IGNITION));

/** The one `$.theme.set` argument: the colours and the scene with its glass. */
export const lookArgs = (colors) => ({ colors, backdrop: { scene: SCENE, glass: { ...GLASS } } });

// Geometry, in CSS pixels from the centre of the scene's box (the content frame). The desktop's
// glass column is the transcript measure, 768 px by default, centred, with a blur that fades out
// over 48 px beyond it; `GUTTER` keeps 24 px clear of that. The plan and verify cells sit 40 px out
// in the gutters, the six build cells behind the glass. `WIDE` is the narrowest box with room for
// the readouts; below `ROOMY` there is no sharp gutter worth using, so the frame and the labels go
// and the plan and verify cells move in behind the glass.
const BUILD = 6;
const GLASS_HALF = 384;
const GUTTER = GLASS_HALF + 48 + 24;
const PV = GUTTER + 40;
const WIDE = 1240;
const ROOMY = 1040;
const TUCK = PV - GLASS_HALF + 40;
const CELLS = Object.freeze([
  { dx: -PV, size: 24, kind: "plan" },
  ...Array.from({ length: BUILD }, (_, i) => ({ dx: -300 + i * 120, size: 14, kind: "build" })),
  { dx: PV, size: 32, kind: "verify" },
]);
const FUSE_Y = 80;

/**
 * The scene's state from the band model: `mood` and which of the eight cells are lit. `burst` is a
 * finish still playing; `waiting` (optional) overrides the model's, which may be a poll behind.
 */
export const sceneStateOf = (model, { isWorking = false, burst = false, waiting } = {}) => {
  const asking = waiting !== undefined ? Boolean(waiting) : Boolean(model?.waiting);
  const mood = burst ? "done" : asking ? "asking" : isWorking ? "working" : "idle";
  if (mood === "done") return { mood, lit: CELLS.map(() => true), head: CELLS.length };
  const phases = model?.phases ?? {};
  const progress = model?.progress;
  let built = 0;
  if (phases.work === "done") built = BUILD;
  else if (progress && progress.total > 0) built = Math.min(BUILD - 1, Math.max(progress.done > 0 ? 1 : 0, Math.floor((progress.done / progress.total) * BUILD)));
  const lit = [phases.plan === "done", ...Array.from({ length: BUILD }, (_, i) => i < built), phases.review === "done"];
  const head = lit.indexOf(false);
  return { mood, lit, head: head === -1 ? CELLS.length : head };
};

/** What tells two scenes apart; the clock never does. */
export const sceneKey = (state, still) => `${still ? "still" : "live"}:${state.mood}:${state.lit.map(Number).join("")}`;

// A fixed seed per scene, so the same state always draws the same embers.
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const n2 = (value) => +value.toFixed(2);
// A tight glow kept under the sharp shape, so hard edges still lead.
const filter = (id, region, blur, wide = 0) => `<filter id="${id}" ${region}>${wide ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${wide}" result="w"/>` : ""}<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="b"/><feMerge>${wide ? '<feMergeNode in="w"/>' : ""}<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

// Motion. Each kind of part moves on its own curve, and the springs are solved rather than drawn:
// a unit mass let go from rest at 0 and pulled to 1 by a spring of damping ratio `z`, sampled until
// it settles within 0.4 %, gives the stops of a CSS `linear()` curve. Below a ratio of 1 the mass
// overshoots once by a few percent and settles with no second swing anyone can see. Drag is the
// exponential approach of a body slowed by air; gravity is the t² of a fall. Every `linear()` is
// declared after a cubic-bezier fitted to the same curve, so an engine without `linear()` keeps the
// bezier.
const springX = (z, t) => {
  if (z >= 1) return 1 - Math.exp(-t) * (1 + t);
  const wd = Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * t) * (Math.cos(wd * t) + (z / wd) * Math.sin(wd * t));
};
const settleOf = (z) => {
  let last = 0;
  for (let t = 0; t < 60; t += 0.01) if (Math.abs(1 - springX(z, t)) > 0.004) last = t;
  return last;
};
const springStops = (z, n = 32) => {
  const T = settleOf(z);
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : springX(z, (i / n) * T)));
};
const dragStops = (k, n = 24) => Array.from({ length: n + 1 }, (_, i) => (1 - Math.exp((-k * i) / n)) / (1 - Math.exp(-k)));
const linear = (values) => `linear(${values.map((v) => +v.toFixed(3)).join(",")})`;
const curve = (values, bezier) => Object.freeze({ linear: linear(values), bezier, values: Object.freeze(values) });

/**
 * The spring and drag curves, each a `linear()` and the cubic-bezier fitted to it. `travel` carries
 * the spark (accelerates from rest, overshoots 2 %), `ignite` settles a kicked cell (one 8 %
 * overshoot), `enter` brings a part in with no overshoot, `drag` slows what flies out and `rise` an
 * ember climbing through warm air.
 */
export const EASE = Object.freeze({
  travel: curve(springStops(0.78), "cubic-bezier(.28,.32,.1,1.2)"),
  ignite: curve(springStops(0.62), "cubic-bezier(.36,.88,0,1.2)"),
  enter: curve(springStops(1), "cubic-bezier(.2,.2,.15,1.05)"),
  drag: curve(dragStops(4.5), "cubic-bezier(.22,1,.55,.95)"),
  rise: curve(dragStops(2.2), "cubic-bezier(.2,.48,.45,.85)"),
});
// Curves a bezier draws exactly or well enough: a fall (t²), an exit, a breath, a gather before a
// release, and the fast first push of a kick.
export const BEZIER = Object.freeze({
  gravity: "cubic-bezier(.33,0,.67,.33)",
  exit: "cubic-bezier(.55,0,1,.45)",
  sine: "cubic-bezier(.37,0,.63,1)",
  gather: "cubic-bezier(.6,0,.9,.5)",
  kick: "cubic-bezier(.2,.7,.3,1)",
});
const tf = (c) => (typeof c === "string" ? `animation-timing-function:${c}` : `animation-timing-function:${c.bezier};animation-timing-function:${c.linear}`);

// The travel spring in loop time: where the spark is at a share `s` of its run, and when it first
// reaches a share `x` of the way.
const TRAVEL_T = settleOf(0.78);
const travelAt = (s) => springX(0.78, Math.min(1, s) * TRAVEL_T);
const travelReach = (x) => {
  for (let s = 0; s <= 1; s += 0.005) if (travelAt(s) >= x) return s;
  return 1;
};
// A working run, in percent of its 2.4 s loop: the spark fades in, travels from `RUN_FROM` for
// `RUN_SPAN`, settles at the cell and fades out.
const RUN_FROM = 6;
const RUN_SPAN = 56;
const ARRIVE = RUN_FROM + RUN_SPAN * travelReach(0.97);

// The streak behind a moving head: long while the head is fast, gone once it stops. Sampled from
// the same spring, so it rides with the head.
const streakFrames = (name, from, span, reach, longest) => {
  const n = 24;
  const at = Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n;
    const ds = s < 1 ? 0.01 : -0.01;
    return { p: travelAt(s) * reach, v: Math.abs(travelAt(s + ds) - travelAt(s)) / 0.01 };
  });
  const k = longest / Math.max(...at.map((a) => a.v));
  const frames = at.map(({ p, v }, i) => {
    const length = n2(v * k);
    return `${n2(from + (span * i) / n)}%{stroke-dasharray:${length} 400;stroke-dashoffset:${n2(length - p)}}`;
  });
  return `@keyframes ${name}{0%{stroke-dasharray:0 400;stroke-dashoffset:0}${frames.join("")}100%{stroke-dasharray:0 400;stroke-dashoffset:${-reach}}}`;
};

// Colour tokens. `edge` outlines cells, `sh*` are the hard offset shadows, `mark` the readouts and
// registration marks, `tag*` the flat state block.
const TOKENS_DARK = "--bg:#080D14;--grid:#111B2A;--major:#1A2738;--dense:#22324A;--rail:#2A3647;--edge:#3E4D63;--idle:#1C2636;--lit:#FF6337;--hot:#FFB08F;--ok:#D7F75B;--ink:#080D14;--core:#FFF4E6;--halo:#FF6337;--sig:#D7F75B;--em2:#D7F75B;--sh:#000000;--shl:#8A2C08;--sho:#53660F;--mark:#6E7A8C;--tagi:#2A3647;--tagt:#F2EFDF;--frm:#2A3647;--act:#FFB08F;--emr:#C23A1E";
const TOKENS_LIGHT = "--bg:#EBE7D5;--grid:#DED9C5;--major:#CFC9B2;--dense:#CEC8B0;--rail:#ADA892;--edge:#0B111A;--idle:#DDD8C3;--lit:#FF6337;--hot:#E74800;--ok:#D7F75B;--ink:#080D14;--core:#B83A00;--halo:#FF8F71;--sig:#7E9A12;--em2:#6F8A0A;--sh:#0B111A;--shl:#0B111A;--sho:#0B111A;--mark:#6A6E76;--tagi:#0B111A;--tagt:#F2EFDF;--frm:#ADA892;--act:#99320C;--emr:#A3311A";

// Embers per mood: [right column, left column], how bright they burn, and the lifetimes a near
// ember draws from (far ones live twice as long). Every lifetime divides the 24 s clock. Idle is
// sparse and dim; a run fills the gutters.
const EMBERS = {
  idle: [4, 3, 0.32, [4, 6, 8]],
  working: [24, 14, 0.95, [2.4, 3, 4]],
  asking: [14, 9, 0.7, [3, 4, 6]],
  done: [26, 16, 1, [2.4, 3, 4]],
};
const SWAY = [1.5, 2, 3, 4];
// How far a finish's spark flies, in CSS pixels, by bucket; and its lifetimes and start jitter.
const REACH = [80, 120, 160, 200];
const LIFE = [0.9, 1.1, 1.35, 1.6];
const JITTER = [0, 0.03, 0.06, 0.1];
// Where the finish bursts open: px from the centre, px down, and its lag after the release. All but
// the last open in the gutters; that one blooms behind the glass.
const BURSTS = [[PV, FUSE_Y, 0], [GUTTER + 90, 230, 0.12], [-GUTTER - 70, 200, 0.3], [GUTTER + 60, 400, 0.45], [-GUTTER - 90, 380, 0.62], [180, 150, 0.8]];
// The finish's sweep down the fuse, in seconds, from `SWEEP_X` to the verify cell.
const SWEEP_S = 1.2;
const SWEEP_SPAN = 0.7;
const SWEEP_X = -PV - 240;
const sweepAt = (x) => SWEEP_S * SWEEP_SPAN * travelReach(x);
const LABELS = ["P", "B1", "B2", "B3", "B4", "B5", "B6", "V"];
const MONO = "ui-monospace,Menlo,Consolas,monospace";
// The particles are type. A rising ember spins like a text cursor, one glyph a frame; a spark is
// born hot as `*` (or `×` in a burst) and cools through `+` and `·` to `-`. The glyphs swap on
// stepped frames while the particle itself travels on a smooth curve.
export const SPIN = Object.freeze(["|", "/", "-", "\\"]);
export const SPARK = Object.freeze(["*", "+", "·", "-"]);
const SPINS = [0.36, 0.48, 0.6];
// A spark's ink by age: white-hot, orange, ember red, ember red.
const SPARK_INK = ["sc", "sl", "sr", "sr"];
// How long a fuse drip is visible, as a share of its 2.4 s loop, by drip kind (the dp keyframes).
const DRIP_SPAN = [21, 29, 38];
// The ticker in the left gutter: rows of mostly dots, some marks, a block now and then.
const TICK = ["·", "·", "·", "·", ":", "|", "+", "▪"];
// Nothing the finish draws reaches the title strip above the band.
const TOP = 44;
// The power change: how long the power-on and the power-down play, in ms.
export const POWER_MS = Object.freeze({ on: 1000, off: 1800 });

/** The readouts the scene prints in its gutters, from the state alone. */
export const readoutsOf = (state) => {
  const { mood, lit } = state;
  const built = lit.slice(1, 7).filter(Boolean).length;
  const bits = lit.map(Number).join("");
  const stages = [`PLAN ${lit[0] ? 1 : 0}/1`, `BUILD ${built}/6`, `VERIFY ${lit[7] ? 1 : 0}/1`];
  return {
    stages,
    phases: stages.join(" · "),
    state: `STATE: ${mood === "idle" ? "STANDBY" : mood.toUpperCase()}`,
    seq: `SEQ ${bits} · 0x${parseInt(bits, 2).toString(16).toUpperCase().padStart(2, "0")}`,
  };
};

/**
 * The scene's SVG. `clockMs` is the session clock when it is drawn (the shared phase); `still`
 * draws one frame with no animation, which is also what reduced motion shows of the moving one.
 * `power` (`{ dir: "on" | "off", ageMs }`) plays the power change that led to this state, `ageMs`
 * after it began. The finish's one-shots start when the scene loads; `--age`, never set by the mod,
 * lets a preview hold them at a later moment.
 */
export const composeScene = (state, { still = false, clockMs = 0, power = null } = {}) => {
  const { mood, lit, head } = state;
  const running = mood !== "idle";
  const rand = seeded([...sceneKey(state, still)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 7));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const css = [];
  const vars = [];
  const body = [];
  const phase = n2(((clockMs / 1000) % CLOCK_S + CLOCK_S) % CLOCK_S);
  const lime = mood === "asking" || mood === "done";
  const anim = (cls, live) => (still ? cls : `${cls} ${live}`.trim());
  const powering = !still && power && power.ageMs < POWER_MS[power.dir] ? power.dir : null;
  css.push(`svg{${TOKENS_DARK};--t:${phase}s;--pa:${powering ? n2(power.ageMs / 1000) : 0}s;}`, `@media (prefers-color-scheme: light){svg{${TOKENS_LIGHT}}}`);
  css.push(
    ".bg{fill:var(--bg)}.gd{fill:var(--grid)}.mj{fill:var(--major)}.dn{fill:var(--dense)}.rl{stroke:var(--rail)}.fz{stroke:var(--idle)}.rr{fill:var(--rail)}",
    ".lt{fill:var(--lit)}.ok{fill:var(--ok)}.ik{fill:var(--ink)}.ol{fill:none;stroke:var(--edge)}.sh{fill:var(--sh)}.shl{fill:var(--shl)}.sho{fill:var(--sho)}",
    ".bn{stroke:var(--lit)}.wr{stroke:var(--hot)}.sp{stroke:var(--core)}.ss{stroke:var(--lit)}.em{fill:var(--lit)}.eo{fill:var(--em2)}",
    ".sg{fill:none;stroke:var(--sig)}.sw1{stroke:var(--sig)}.sw2{stroke:var(--lit)}.c0{stop-color:var(--bg)}.h0{stop-color:var(--halo)}.s0{stop-color:var(--sig)}",
    `.mk{stroke:var(--mark);fill:none}.rd{fill:var(--mark);font:500 10px ${MONO};letter-spacing:.08em}.lb{fill:var(--mark);font:500 9px ${MONO};letter-spacing:.06em}`,
    `.tg{font:700 10px ${MONO};letter-spacing:.08em}.tgi{fill:var(--tagi)}.tgt{fill:var(--tagt)}.tgk{fill:var(--ink)}`,
    // The frame: dim at rest, its run colour (orange, lime while asking or done) when lit.
    // Glyphs: three sizes and weights for depth, centred on their point; their inks by heat.
    `.gl{text-anchor:middle;dominant-baseline:central}.t1{font:500 11px ${MONO}}.t2{font:700 14px ${MONO}}.t3{font:700 19px ${MONO}}`,
    ".sc{fill:var(--core)}.so{fill:var(--sig)}.sl{fill:var(--lit)}.sr{fill:var(--emr)}.eg,.ek{fill:var(--lit)}.mkf{fill:var(--mark)}.e0{stop-color:var(--emr)}.off{opacity:0}",
    `svg{--c0:${running ? "var(--sig)" : "var(--lit)"}}`,
    ".fd{stroke:var(--frm);fill:none}.fdf{fill:var(--frm)}.fa{stroke:var(--fon);fill:none}.faf{fill:var(--fon)}.ra{fill:var(--act)}",
    `svg{--fon:${lime ? "var(--sig)" : "var(--lit)"}}`,
    // The gutters, by the room the box leaves beside the glass.
    `@media (max-width: ${WIDE - 1}px){.wd{display:none}}`,
    `@media (max-width: ${ROOMY - 1}px){.gt{display:none}.el,.er{display:none}.pl{transform:translateX(${TUCK}px)}.pr{transform:translateX(-${TUCK}px)}}`,
  );

  // Positions from the box's centre: `mid` opens a group there, `at` a cell's place on the fuse.
  const mid = (y = 0, cls = "") => `<svg x="50%" y="${y}" overflow="visible">${cls ? `<g class="${cls}">` : "<g>"}`;
  const end = "</g></svg>";
  const sideOf = (index) => (index === 0 ? "pl" : index === CELLS.length - 1 ? "pr" : "");
  const at = (index, inner) => `${mid(FUSE_Y, sideOf(index))}<g transform="translate(${CELLS[index].dx} 0)">${inner}</g>${end}`;

  // Ground: graph paper (fine and major lines), a warm sky along the top, halftone strips at both
  // box edges, a calm centre, heat beds at the foot of each gutter, a dithered band behind the fuse.
  const strip = (side, width) => {
    const cols = [3, 2, 1].map((dot, i) => `<rect class="${anim("", `dr z ${side === "l" ? "" : "q7"}`)}" fill="url(#h${dot})" x="${side === "l" ? i * 24 : -width + (2 - i) * (width / 3)}" y="-8" width="${width / 3}" height="100%"/>`).join("");
    return side === "l" ? cols : `<svg x="100%" overflow="visible">${cols}</svg>`;
  };
  const bed = running ? 0.55 : 0.18;
  body.push(
    '<rect class="bg" width="100%" height="100%"/>',
    '<rect fill="url(#gp)" width="100%" height="100%"/>',
    '<rect fill="url(#gp2)" width="100%" height="100%"/>',
    `<rect class="${anim("", "sy z")}" fill="url(#sky)" width="100%" height="280" opacity="${running ? 0.9 : 0.35}"/>`,
    strip("l", 72),
    strip("r", 72),
    '<rect fill="url(#calm)" width="100%" height="100%"/>',
    `${mid(0)}<svg y="100%" overflow="visible"><ellipse class="${anim("", "hb2 z")}" cx="${-GUTTER - 140}" rx="240" ry="300" fill="url(#ho)" opacity="${bed}"/><ellipse class="${anim("", "hb3 z q5")}" cx="${GUTTER + 140}" rx="280" ry="340" fill="url(#${lime ? "hl" : "ho"})" opacity="${n2(bed * 1.1)}"/></svg>${end}`,
    // The gentle fire at the foot of each gutter while a run is on: soft tongues of pre-blurred
    // light that sway and breathe, under the hard glyphs.
    running ? `${mid(0)}<svg y="100%" overflow="visible">${[[70, 70, 150], [160, 90, 210], [260, 60, 130]].flatMap(([dx, rx, ry], i) => [-1, 1].map((s) => `<ellipse class="${anim("", `fk fd${i} z q${i * 2 + (s > 0 ? 1 : 0)}`)}" cx="${s * (GUTTER + dx)}" rx="${rx}" ry="${ry}" fill="url(#fl)"/>`)).join("")}</svg>${end}` : "",
    '<rect fill="url(#dt)" y="40" width="100%" height="80"/>',
    '<rect class="rr" y="40" width="100%" height="2"/><rect class="rr" y="118" width="100%" height="2"/>',
    // The ruler under the fuse: a tick every 8 px, a long one every 64 px.
    '<rect fill="url(#ru)" y="120" width="100%" height="4"/><rect fill="url(#ru2)" y="120" width="100%" height="8"/>',
  );

  // The diffuse zone: a low heat haze along the fuse behind the glass while a run is on, and a soft
  // bloom under each lit build cell, wide enough to read through an 18 px blur.
  if (running) body.push(`${mid(FUSE_Y)}<ellipse class="${anim("", "hp z q3")}" rx="${GLASS_HALF}" ry="70" fill="url(#ho)" opacity="0.22"/>${end}`);
  const blooms = running ? CELLS.map((cell, i) => (cell.kind === "build" && lit[i] ? `<circle cx="${cell.dx}" r="52" fill="url(#${mood === "done" ? "hl" : "ho"})" opacity="0.95"/>` : "")).join("") : "";
  if (blooms) body.push(`${mid(FUSE_Y)}${blooms}${end}`);

  // The verify cell's halo, tight so the hard edges lead.
  const haloOpacity = { idle: 0.12, working: 0.5, asking: 0.6, done: 0.75 }[mood];
  body.push(at(CELLS.length - 1, `<circle class="${anim("", "hp z q3")}" r="${mood === "done" ? 200 : 130}" fill="url(#${lime ? "hl" : "ho"})" opacity="${haloOpacity}"/>`));

  // The fuse: dim dots across the box, then the burnt run up to the last lit cell, a soft heat
  // streak under it that the glass turns into a glow.
  const cellX = (index) => (index < 0 ? SWEEP_X : CELLS[Math.min(index, CELLS.length - 1)].dx);
  const burntTo = head === 0 ? null : cellX(head - 1);
  body.push(`<line class="fz" x1="0" y1="${FUSE_Y}" x2="100%" y2="${FUSE_Y}" stroke-width="4" stroke-dasharray="4 4" opacity="${running ? 1 : 0.6}"/>`);
  // At rest the burnt run is cold: thin, dim, with no glow.
  if (burntTo !== null) {
    body.push(running
      ? `${mid(FUSE_Y)}<line class="bn" x1="-4000" x2="${burntTo}" stroke-width="14" opacity="0.28" filter="url(#soft)"/><line class="bn" x1="-4000" x2="${burntTo}" stroke-width="4" stroke-dasharray="4 4" filter="url(#glowc)"/>${end}`
      : `${mid(FUSE_Y)}<line class="bn" x1="-4000" x2="${burntTo}" stroke-width="4" stroke-dasharray="4 4" opacity="0.3"/>${end}`);
  }

  // The frame that mounts the glass: on each side a rule at the gutter's inner edge with a tick
  // every 16 px, square brackets at its head and foot reaching out into the gutter, and on the right the run's
  // share lit down the rule. Dim at rest; lit while a run is on, igniting outward from the column on
  // a spring at the power-on and fading inward at the power-down.
  const share = lit.filter(Boolean).length / CELLS.length;
  const frameSide = (s, cls, fill, lag) => {
    const x = s * GUTTER;
    const out = s * 14;
    const parts = [
      `<line class="${cls}" x1="${x}" y1="140" x2="${x}" y2="100%" stroke-width="2"/>`,
      `<path class="${cls}" d="M${x + s * -1} 140V128H${x + out}" stroke-width="3"/>`,
      `<svg y="100%" overflow="visible"><path class="${cls}" d="M${x} -48V-36H${x + out}" stroke-width="3"/><rect class="${fill}" x="${x - 3}" y="-52" width="6" height="6"/></svg>`,
    ];
    return `<g class="gt"><g class="${lag}">${parts.join("")}</g></g>`;
  };
  // The ticks are a pattern masked to the rule's side; drawn once per side, dim.
  const ticks = (s) => `<rect class="gt" x="${s < 0 ? -GUTTER - 7 : GUTTER + 1}" y="148" width="6" height="100%" fill="url(#tk)"/>`;
  body.push(`${mid(0)}${ticks(-1)}${ticks(1)}${frameSide(-1, "fd", "fdf", "")}${frameSide(1, "fd", "fdf", "")}${end}`);
  if (running || powering === "off") {
    const fade = powering === "on" ? "pwn" : powering === "off" ? "pwf" : "";
    const lag = (i) => (fade ? `${fade} pw${i}` : "");
    const glow = ' filter="url(#glowf)"';
    body.push(`${mid(0)}<g${glow}>${frameSide(-1, "fa", "faf", lag(0))}${frameSide(1, "fa", "faf", lag(0))}</g>`
      + (share > 0 && running ? `<g class="gt"><g class="${lag(1)}"><line class="bn" x1="${GUTTER}" y1="140" x2="${GUTTER}" y2="${n2(16 + share * 56)}%" stroke-width="2" stroke-dasharray="2 6"${glow}/></g></g>` : "")
      + end);
  }
  // At the power-on a row of slashes wipes out along the rail from the column, a glyph a step.
  if (powering === "on") {
    const wipe = [-1, 1].map((s) => Array.from({ length: 18 }, (_, i) => `<text class="pgw w${i} off" x="${s * (GUTTER + 12 + i * 14)}" y="110">${s < 0 ? "\\" : "/"}</text>`).join("")).join("");
    vars.push(...Array.from({ length: 18 }, (_, i) => `.w${i}{--k:${n2(0.1 + i * 0.02)}s}`));
    body.push(`${mid(0, "gt")}<g class="gl t2 ra">${wipe}</g>${end}`);
  }

  // The finish's clock: the sweep reaches the verify cell, which gathers, then releases.
  const gatherAt = n2(sweepAt(0.97) + 0.03);
  const releaseAt = n2(gatherAt + 0.14);

  // Cells: a hard offset shadow, a 2 px outline, a flat fill once lit, a label under the plan and
  // verify cells (the build cells' labels would only blur). A cell moves as one block: the cell the
  // spark leaves recoils, and at the finish each cell kicks as the sweep passes it.
  CELLS.forEach((cell, index) => {
    const h = cell.size / 2;
    const isVerify = cell.kind === "verify";
    const shadow = lit[index] ? (isVerify ? "sho" : "shl") : "sh";
    const parts = [
      `<rect class="${shadow}" x="${-h + 3}" y="${-h + 3}" width="${cell.size}" height="${cell.size}"/>`,
      `<rect class="bg" x="${-h}" y="${-h}" width="${cell.size}" height="${cell.size}"/>`,
    ];
    if (lit[index] && isVerify) {
      const p = (cell.size - 8) / 7;
      parts.push(`<rect class="ok" x="${-h}" y="${-h}" width="${cell.size}" height="${cell.size}" filter="url(#glow)"/>`);
      parts.push(`<g class="ik">${[[1, 4], [2, 5], [3, 4], [4, 3], [5, 2]].map(([c, r]) => `<rect x="${n2(-h + 4 + c * p)}" y="${n2(-h + 4 + r * p)}" width="${n2(p)}" height="${n2(p)}"/>`).join("")}</g>`);
    } else if (lit[index]) {
      // A lit cell glows while a run is on; at rest it keeps its colour, banked low.
      parts.push(running ? `<rect class="lt" x="${-h}" y="${-h}" width="${cell.size}" height="${cell.size}" filter="url(#glow)"/>` : `<rect class="lt" x="${-h}" y="${-h}" width="${cell.size}" height="${cell.size}" opacity="0.4"/>`);
    } else if (index === head && mood !== "done") {
      // The next cell: it smoulders while idle, kicks hot as the spark lands, breathes while asked.
      const cls = mood === "working" ? "hk z" : mood === "asking" ? "lp z l4" : "hm z";
      parts.push(`<rect class="${anim("lt", cls)}" x="${-h + 3}" y="${-h + 3}" width="${cell.size - 6}" height="${cell.size - 6}" opacity="0.45"/>`);
    }
    parts.push(`<rect class="ol" x="${-h + 1}" y="${-h + 1}" width="${cell.size - 2}" height="${cell.size - 2}" stroke-width="2"/>`);
    let move = "";
    if (mood === "working" && index === head - 1) move = "rc z";
    if (mood === "done") {
      move = `${isVerify ? "gr" : "ig"} c${index}`;
      vars.push(`.c${index}{--k:${isVerify ? gatherAt : n2(sweepAt(Math.min(0.97, (cell.dx - SWEEP_X) / (PV - SWEEP_X))) + 0.03 + rand() * 0.04)}s}`);
    }
    const block = move && !still ? `<g class="${move}">${parts.join("")}</g>` : parts.join("");
    const label = cell.kind === "build" ? "" : `<text class="lb gt" x="0" y="${h + 16}" text-anchor="middle">${LABELS[index]}</text>`;
    body.push(at(index, `${block}${label}`));
  });

  // Working: the spark runs the stretch towards the next cell on the travel spring, a streak behind
  // it as long as it is fast, the hot wire and the halo trailing it by 70 and 30 ms.
  const segment = head < CELLS.length ? [burntTo ?? SWEEP_X, cellX(head)] : null;
  if (mood === "working" && segment) {
    const [x1, x2] = segment;
    const line = (cls, width, dash, extra = "") => `<line class="${cls}" x1="${x1}" x2="${x2}" pathLength="100" stroke-width="${width}" stroke-dasharray="${dash}" stroke-linecap="square"${extra}/>`;
    body.push(
      `${mid(FUSE_Y)}<g filter="url(#glowc)">`,
      line(anim("wr", "gw z l2"), 2, "100 100", ' stroke-dashoffset="3"'),
      line(anim("ss", "st z"), 4, "0 400", ' opacity="0.7"'),
      line(anim("ss", "sk z l1"), 16, "1.4 400", ' stroke-dashoffset="-96.6" opacity="0.35"'),
      line(anim("sp", "sk z"), 8, "1.2 400", ' stroke-dashoffset="-96.8"'),
      `</g>${end}`,
    );
    // Embers knocked off as the spark passes fall under gravity, each with its own size and life.
    const drips = [];
    for (let i = 0; i < 8; i += 1) {
      const f = 0.05 + rand() * 0.9;
      const passes = ((RUN_FROM + RUN_SPAN * travelReach(f)) / 100) * 2.4 + rand() * 0.08;
      const tier = 1 + Math.floor(rand() * 2);
      const v = i % 3;
      vars.push(`.dq${i}{--d:${n2(passes)}s}`);
      const glyphs = still ? '<text class="sl">+</text>' : SPARK.map((g, j) => `<text class="${SPARK_INK[j]} z dq${i} dg${v}${j}${j ? " off" : ""}">${g}</text>`).join("");
      drips.push(`<g transform="translate(${n2(x1 + f * (x2 - x1))} 6)"><g class="${anim("", `dp${v} z dq${i}`)}" opacity="${n2(0.6 + rand() * 0.4)}" transform="translate(0 ${Math.round(16 + rand() * 40)})"><g class="gl t${tier}">${glyphs}</g></g></g>`);
    }
    body.push(`${mid(FUSE_Y)}${drips.join("")}${end}`);
  }

  // Asking: a lime lamp that breathes (a quick rise, a slow fall), its pre-blurred glow 90 ms
  // behind, and square rings that open with drag a second apart. Nothing rises into the title strip.
  if (mood === "asking") {
    const index = Math.min(head, CELLS.length - 1);
    const rings = [0, 1, 2].map((i) => `<g class="${anim("", `rf z rq${i}`)}" opacity="${n2(0.8 - i * 0.25)}"><rect class="${anim("sg", `rg z rq${i}`)}" x="-14" y="-14" width="28" height="28" stroke-width="2" vector-effect="non-scaling-stroke" transform="scale(${n2(1.6 + i * 1.1)})"/></g>`);
    vars.push(".rq0{--d:0s}.rq1{--d:1.04s}.rq2{--d:2.07s}");
    body.push(at(index, `<g clip-path="url(#cf)"><circle class="${anim("", "lp z l3")}" r="70" fill="url(#hl)" opacity="0.7"/>${rings.join("")}</g><rect class="sho" x="-4" y="-4" width="12" height="12"/><rect class="${anim("eo", "lp z")}" x="-6" y="-6" width="12" height="12"/>`));
  }

  // Embers rise up both gutters beside the frame, slowed by drag and swaying, in two layers. Near
  // ones are hard glyphs in three sizes, each over its own soft glow, that spin `|` `/` `-` `\` on
  // stepped frames while they rise on a smooth curve, cooling from lime (orange at rest) through
  // orange to ember red. Far ones are soft dots of heat: a radial gradient that reads as blurred
  // light with no filter to redraw.
  const [right, left, glow, lives] = EMBERS[mood];
  let emberId = 0;
  const embers = (count, s, spread, near) => {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const id = (emberId += 1);
      const tier = near ? 1 + Math.floor(rand() * 3) : 0;
      const x = s * (GUTTER + 12 + Math.round(rand() * spread));
      const y = n2(24 + rand() * 54);
      const opacity = n2(glow * (near ? 0.55 + rand() * 0.45 : 0.35 + rand() * 0.5));
      const life = near ? pick(lives) : pick(lives) * 2;
      const rise = Math.round((near ? 120 : 80) + rand() * (near ? 180 : 120));
      vars.push(`.m${id}{--dur:${life}s;--d:-${n2(rand() * life)}s;--ry:-${rise}px;--sx:${n2(2 + rand() * 6)}px;--sd:${pick(SWAY)}s;--o:${opacity}${near ? `;--sp:${pick(SPINS)}s` : ""}}`);
      const lift = ` transform="translate(0 ${-Math.round(rand() * rise)})"`;
      const particle = near
        ? `<g class="${anim("", `ei eg z m${id}`)} gl t${tier}${still ? " ek" : ""}" opacity="${opacity}"${lift}><circle cx="${x}" cy="${y}%" r="${4 + tier * 3}" fill="url(#eb)" opacity="0.5"/>${(still ? [SPIN[id % 4]] : SPIN).map((g, k) => `<text class="${still ? "" : `n${k}${k ? " off" : ""}`}" x="${x}" y="${y}%">${g}</text>`).join("")}</g>`
        : `<circle class="${anim("", `ei z m${id}`)}" cx="${x}" cy="${y}%" r="${3 + Math.floor(rand() * 4)}" fill="url(#eb)" opacity="${opacity}"${lift}/>`;
      out.push(`<g class="${anim("", `ew z m${id}`)}">${particle}</g>`);
    }
    return `${mid(0, s < 0 ? "el" : "er")}${out.join("")}${end}`;
  };
  body.push(embers(right, 1, 120, false), embers(left, -1, 90, false), embers(right, 1, 60, true), embers(left, -1, 50, true));

  // Done: the sweep runs the fuse (each cell kicks as it passes), the verify cell gathers and
  // releases; shockwaves open with drag 90 ms apart, bursts follow in overlapping waves and fall
  // under gravity, the afterglow decays. All of it stays below the title strip.
  if (mood === "done") {
    vars.push(`.k0{--k:${releaseAt}s}.k1{--k:${releaseAt}s}.k2{--k:${n2(releaseAt + 0.09)}s}.k3{--k:0s}`);
    const shocks = [0, 1].map((i) => `<g class="${anim("", `kf k${i + 1}`)}" opacity="${n2(0.4 - i * 0.15)}"><rect class="${anim(`sw${i + 1}`, `kw k${i + 1}`)}" x="-24" y="-24" width="48" height="48" stroke-width="${3 - i}" vector-effect="non-scaling-stroke" fill="none" transform="scale(${4 + i * 1.5})"/></g>`);
    body.push('<g clip-path="url(#cb)">', at(CELLS.length - 1, `<circle class="${anim("", "ag k0")}" r="240" fill="url(#hl)" opacity="0.45"/>${shocks.join("")}`));
    body.push(
      `${mid(FUSE_Y)}<line class="${anim("sp", "swp k3")}" x1="${SWEEP_X}" x2="${PV}" pathLength="100" stroke-width="6" stroke-dasharray="100 100" stroke-linecap="square" filter="url(#glowc)" opacity="0.35"/>`
        + (still ? "" : `<line class="ss sst k3" x1="${SWEEP_X}" x2="${PV}" pathLength="100" stroke-width="4" stroke-dasharray="0 400" filter="url(#glowc)" opacity="0.7"/>`)
        + end,
    );
    BURSTS.forEach(([x, y, lag], b) => {
      const sparks = [];
      const count = b === 0 ? 20 : 12;
      for (let i = 0; i < count; i += 1) {
        const angle = n2((360 / count) * i + rand() * 8);
        const reach = Math.min(3, Math.floor(rand() * 3) + (b === 0 ? 1 : 0));
        const tier = 1 + Math.floor(rand() * 3);
        const born = (i + b) % 3 === 1 ? "×" : "*";
        const glyphs = still ? '<text class="sl">+</text>' : `<text class="${b === 0 || lime ? "so" : "sc"} b0">${born}</text><text class="sl b1 off">+</text><text class="sr b2 off">·</text>`;
        sparks.push(`<g transform="rotate(${angle})"><g class="${anim("", `bs r${reach} j${Math.floor(rand() * JITTER.length)} bl${Math.floor(rand() * LIFE.length)}`)}" transform="translate(${Math.round(REACH[reach] * 0.6)} 0)" opacity="0.85"><g class="gl t${tier}">${glyphs}</g></g></g>`);
      }
      vars.push(`.bd${b}{--bd:${n2(releaseAt + lag)}s}`);
      const side = b === 0 ? "pr" : Math.abs(x) >= GUTTER ? "gt" : "";
      body.push(`${mid(y, side)}<g transform="translate(${x} 0)"><g class="${anim("", `gv bd${b}`)}">${sparks.join("")}</g></g>${end}`);
    });
    body.push("</g>");
  }

  // Readouts and marks, in the gutters beside the frame: the stage counts stacked under the plan
  // cell, a flat state block with a hard shadow under the verify cell, the sequence bits and the
  // clock at the foot beside registration targets. They need the widest gutters; dim at rest, warm
  // while a run is on.
  const read = readoutsOf(state);
  const tagW = Math.round(read.state.length * 6.4 + 16);
  const tagFill = mood === "working" ? "lt" : lime ? "ok" : "tgi";
  const tagText = mood === "idle" ? "tgt" : "tgk";
  const ink = running ? "ra" : "";
  const target = (x, y) => `<g transform="translate(${x} ${y})"><circle class="mk" r="6" stroke-width="1"/><path class="mk${running && !still ? " rk z" : ""}" d="M-11 0H11M0 -11V11" stroke-width="1"/></g>`;
  const rows = Array.from({ length: 24 }, () => Array.from({ length: 8 }, () => pick(TICK)).join(""));
  const ticker = [...rows, ...rows.slice(0, 6)].map((row, i) => `<text x="${-GUTTER - 14}" y="${i * 12}">${row}</text>`).join("");
  const digits = Array.from({ length: CLOCK_S }, (_, i) => `<text class="rd ${ink}" x="0" y="${i * 14}">T+${String(i).padStart(2, "0")}S</text>`).join("");
  const inner = GUTTER + 14;
  body.push(
    `${mid(0, "wd")}${read.stages.map((line, i) => `<text class="rd ${ink}" x="${-inner}" y="${150 + i * 14}" text-anchor="end"${running ? "" : ' opacity="0.7"'}>${line}</text>`).join("")}`
      + `<g transform="translate(${inner} 134)"><rect class="sh" x="3" y="3" width="${tagW}" height="18"/><rect class="${tagFill}" width="${tagW}" height="18"${running ? "" : ' opacity="0.8"'}/><text class="tg ${tagText}" x="${tagW / 2}" y="13" text-anchor="middle">${read.state}</text></g>`
      // A text spinner beside the state while a run is on; a dash at rest.
      + `<g class="gl t2 ${running ? "ra" : "mkf"}" transform="translate(${inner + tagW + 14} 143)">${running && !still ? SPIN.map((g, k) => `<text class="n${k} sv${k ? " off" : ""}">${g}</text>`).join("") : `<text>${running ? "/" : "-"}</text>`}</g>`
      // A dot-matrix ticker under the stage counts, a row a step while a run is on.
      + `<clipPath id="ct"><rect x="${-inner - 80}" y="194" width="84" height="70"/></clipPath><g clip-path="url(#ct)"><g transform="translate(0 204)"><g class="rd ${ink}${running && !still ? " tkr z" : ""}" text-anchor="end" opacity="${running ? 0.85 : 0.4}">${ticker}</g></g></g>`
      + `<svg y="100%" overflow="visible">${target(-inner - 12, -40)}<text class="rd ${ink}" x="${-inner - 28}" y="-36" text-anchor="end">${read.seq}</text>${target(inner + 12, -40)}<clipPath id="cw"><rect x="${inner + 28}" y="-48" width="80" height="14"/></clipPath><g clip-path="url(#cw)"><g class="${anim("", "ck z")}" transform="translate(${inner + 28} ${-36 - (still ? Math.floor(phase) : 0) * 14})">${digits}</g></g></svg>${end}`,
  );

  if (!still) {
    const quiet = !running;
    css.push(
      // Shorthands first; every duration divides the 24 s clock.
      `@keyframes er{0%{transform:translate(0,0);opacity:0;${tf(EASE.rise)}}12%{opacity:var(--o)}65%{opacity:var(--o);${tf(BEZIER.exit)}}100%{transform:translate(0,var(--ry));opacity:0}}`,
      ".ei{animation:er var(--dur) infinite}",
      // A glyph ember also cools as it rises: lime or orange, then orange, then ember red.
      `@keyframes eg{0%{transform:translate(0,0);opacity:0;fill:var(--c0);${tf(EASE.rise)}}12%{opacity:var(--o)}35%{fill:var(--lit)}65%{opacity:var(--o);fill:var(--emr);${tf(BEZIER.exit)}}100%{transform:translate(0,var(--ry));opacity:0;fill:var(--emr)}}.eg{animation-name:eg}`,
      // Glyph swaps are stepped: the spinner shows each of its four glyphs for a quarter turn.
      "@keyframes nk{0%{opacity:1}25%{opacity:0}100%{opacity:0}}.n0,.n1,.n2,.n3{animation:nk var(--sp) steps(1,end) infinite}.sv{--sp:.6s}",
      ...[1, 2, 3].map((k) => `.n${k}{animation-delay:calc(var(--sp) * ${k / 4 - 1})}`),
      // A drip's glyph ages *, +, ·, - over the part of the loop it is visible.
      ...DRIP_SPAN.flatMap((span, v) => SPARK.map((_, j) => {
        const from = n2((span * j) / 4);
        const to = n2((span * (j + 1)) / 4);
        return `@keyframes dg${v}${j}{0%{opacity:${j ? 0 : 1}}${j ? `${from}%{opacity:1}` : ""}${to}%{opacity:0}100%{opacity:0}}.dg${v}${j}{animation:dg${v}${j} 2.4s steps(1,end) infinite}`;
      })),
      // A burst spark is born * or ×, cools to + at 30 % of its life and to · at 60 %.
      "@keyframes b0{0%{opacity:1}30%{opacity:0}100%{opacity:0}}@keyframes b1{0%{opacity:0}30%{opacity:1}60%{opacity:0}100%{opacity:0}}@keyframes b2{0%{opacity:0}60%{opacity:1}100%{opacity:1}}",
      ".b0{animation:b0 var(--bl) steps(1,end) both}.b1{animation:b1 var(--bl) steps(1,end) both}.b2{animation:b2 var(--bl) steps(1,end) both}",
      // Machine gestures: the registration marks turn an eighth a step, the ticker moves a row a step,
      // and the power-on slashes land one by one and fade in three steps.
      "@keyframes rk{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}.rk{transform-box:fill-box;transform-origin:center;animation:rk 4s steps(8,end) infinite}",
      "@keyframes tk{0%{transform:translate(0,0)}100%{transform:translate(0,-288px)}}.tkr{animation:tk 12s steps(24,end) infinite}",
      "@keyframes pgw{0%{opacity:1}55%{opacity:1}100%{opacity:0}}.pgw{animation:pgw .45s steps(3,end) forwards}",
      // The fire: each tongue sways and breathes on its own slow period.
      "@keyframes fk{0%{transform:scale(1,.9);opacity:.6}100%{transform:scale(1.05,1.08);opacity:.95}}.fk{transform-box:fill-box;transform-origin:50% 100%;animation:fk var(--fd) infinite alternate}.fd0{--fd:2.4s}.fd1{--fd:3s}.fd2{--fd:4s}",
      "@keyframes ew{0%{transform:translateX(calc(var(--sx) * -1))}100%{transform:translateX(var(--sx))}}.ew{animation:ew var(--sd) infinite alternate}",
      // The spark's run: fade in, travel on the spring, settle, fade out; the wire grows behind it.
      `@keyframes sk{0%{stroke-dashoffset:0;opacity:0;${tf(EASE.enter)}}${RUN_FROM}%{stroke-dashoffset:0;opacity:1;${tf(EASE.travel)}}${RUN_FROM + RUN_SPAN}%{stroke-dashoffset:-96.8}80%{opacity:1;${tf(BEZIER.exit)}}90%{stroke-dashoffset:-96.8;opacity:0}100%{stroke-dashoffset:0;opacity:0}}.sk{animation:sk 2.4s infinite}`,
      streakFrames("st", RUN_FROM, RUN_SPAN, 96.8, 22),
      ".st{animation:st 2.4s infinite}",
      `@keyframes gw{0%{stroke-dashoffset:100;opacity:1}${RUN_FROM}%{stroke-dashoffset:100;${tf(EASE.travel)}}${RUN_FROM + RUN_SPAN}%{stroke-dashoffset:3}80%{opacity:1;${tf(BEZIER.exit)}}92%{stroke-dashoffset:3;opacity:0}100%{stroke-dashoffset:100;opacity:0}}.gw{animation:gw 2.4s infinite}`,
      // The cell the spark leaves gathers and springs back; the cell it reaches kicks 40 ms after.
      `@keyframes rc{0%{transform:scale(1);${tf(BEZIER.gather)}}5%{transform:scale(.86);${tf(EASE.ignite)}}30%{transform:scale(1)}100%{transform:scale(1)}}.rc{animation:rc 2.4s infinite}`,
      (() => {
        const a = n2(ARRIVE + 1.7);
        return `@keyframes hk{0%{transform:scale(1);opacity:.4}${a}%{transform:scale(1);opacity:.4;${tf(BEZIER.kick)}}${n2(a + 4)}%{transform:scale(1.5);opacity:1;${tf(EASE.ignite)}}${n2(a + 34)}%{transform:scale(1);opacity:.7;${tf(BEZIER.sine)}}100%{transform:scale(1);opacity:.4}}.hk{animation:hk 2.4s infinite}`;
      })(),
      ...[[28, 3], [46, -4], [64, 6]].map(([fall, dx], i) => `@keyframes dp${i}{0%{transform:translate(0,0);opacity:.9;${tf(BEZIER.gravity)}}${[21, 29, 38][i]}%{transform:translate(${dx}px,${fall}px);opacity:0}100%{transform:translate(${dx}px,${fall}px);opacity:0}}.dp${i}{animation:dp${i} 2.4s infinite}`),
      // Asking: a breath, quick in and slow out; rings open with drag and fade as they go.
      `@keyframes lp{0%{opacity:.4;${tf(EASE.enter)}}16%{opacity:1;${tf(BEZIER.sine)}}100%{opacity:.4}}.lp{animation:lp 3s infinite}`,
      `@keyframes rg{0%{transform:scale(1);${tf(EASE.drag)}}80%{transform:scale(5.2)}100%{transform:scale(5.2)}}.rg{animation:rg 3s infinite}`,
      `@keyframes rf{0%{opacity:0;${tf(EASE.enter)}}5%{opacity:.85;${tf(BEZIER.exit)}}80%{opacity:0}100%{opacity:0}}.rf{animation:rf 3s infinite}`,
      `@keyframes hm{0%{opacity:.15;${tf(EASE.enter)}}22%{opacity:.55;${tf(BEZIER.sine)}}100%{opacity:.15}}.hm{animation:hm 6s infinite}`,
      // Slow ambient breaths, each on its own period so none of them line up.
      `@keyframes hb{0%{opacity:${quiet ? 0.12 : 0.4}}50%{opacity:${quiet ? 0.2 : 0.7}}100%{opacity:${quiet ? 0.12 : 0.4}}}.hb2{animation:hb 12s infinite}.hb3{animation:hb 8s infinite}`,
      `@keyframes sy{0%{opacity:${quiet ? 0.3 : 0.75}}50%{opacity:${quiet ? 0.4 : 0.95}}100%{opacity:${quiet ? 0.3 : 0.75}}}.sy{animation:sy 24s infinite}`,
      `@keyframes hp{0%{opacity:${n2(haloOpacity * 0.7)}}50%{opacity:${haloOpacity}}100%{opacity:${n2(haloOpacity * 0.7)}}}.hp{animation:hp ${mood === "working" ? 4.8 : 6}s infinite}`,
      "@keyframes dr{0%{transform:translate(0,0)}100%{transform:translate(0,-6px)}}.dr{animation:dr 6s infinite alternate}",
      // The clock: one digit a second, read off the shared clock.
      `@keyframes ck{0%{transform:translate(${inner + 28}px,-36px)}100%{transform:translate(${inner + 28}px,${-36 - CLOCK_S * 14}px)}}.ck{animation:ck ${CLOCK_S}s steps(${CLOCK_S},end) infinite}`,
      // The power change, once: the lit frame ignites outward from the column on a spring (the rule,
      // then the share on the rail), or fades back inward, slower.
      `@keyframes pwn{0%{opacity:0;transform:translateX(0) scaleY(.2);${tf(BEZIER.kick)}}18%{opacity:1;${tf(EASE.ignite)}}100%{opacity:1;transform:none}}.pwn{transform-box:fill-box;transform-origin:50% 0;animation:pwn .7s both}`,
      `@keyframes pwf{0%{opacity:1;${tf(BEZIER.sine)}}100%{opacity:0}}.pwf{animation:pwf 1.6s both}`,
      ".pw0{--k:0s}.pw1{--k:.18s}",
      // The finish, once: sweep, cascade, gather and release, shockwaves, bursts, afterglow.
      `@keyframes swp{0%{stroke-dasharray:6 400;stroke-dashoffset:0;opacity:1;${tf(EASE.travel)}}${SWEEP_SPAN * 100}%{stroke-dasharray:6 400;stroke-dashoffset:-100;opacity:1;${tf(BEZIER.exit)}}100%{stroke-dasharray:6 400;stroke-dashoffset:-100;opacity:0}}.swp{animation:swp ${SWEEP_S}s both}`,
      streakFrames("sst", 0, SWEEP_SPAN * 100, 100, 30),
      `.sst{animation:sst ${SWEEP_S}s both}`,
      `@keyframes ig{0%{transform:scale(1);${tf(BEZIER.kick)}}12%{transform:scale(1.45);${tf(EASE.ignite)}}100%{transform:scale(1)}}.ig{animation:ig .8s both}`,
      `@keyframes gr{0%{transform:scale(1);${tf(BEZIER.gather)}}14%{transform:scale(.8);${tf(EASE.ignite)}}70%{transform:scale(1)}100%{transform:scale(1)}}.gr{animation:gr 1s both}`,
      `@keyframes kw{0%{transform:scale(.5);${tf(EASE.drag)}}100%{transform:scale(6)}}.kw{animation:kw 1.4s both}`,
      `@keyframes kf{0%{opacity:0;${tf(EASE.enter)}}5%{opacity:.9;${tf(BEZIER.exit)}}100%{opacity:0}}.kf{animation:kf 1.4s both}`,
      `@keyframes ag{0%{opacity:0;${tf(EASE.enter)}}5%{opacity:1;${tf(EASE.drag)}}100%{opacity:.35}}.ag{animation:ag 8s both}`,
      `@keyframes bs{0%{transform:translate(0,0);opacity:0;${tf(EASE.drag)}}4%{opacity:1}55%{opacity:.9;${tf(BEZIER.exit)}}100%{transform:translate(var(--r),0);opacity:0}}.bs{animation:bs var(--bl) both}`,
      `@keyframes gv{0%{transform:translate(0,0);${tf(BEZIER.gravity)}}100%{transform:translate(0,48px)}}.gv{animation:gv 1.6s both}`,
      // Element curves, after the shorthands that would reset them.
      `.st,.sst{animation-timing-function:linear}.ew,.hb2,.hb3,.sy,.hp,.dr,.fk{${tf(BEZIER.sine)}}`,
      ...REACH.map((px, i) => `.r${i}{--r:${px}px}`),
      ...LIFE.map((s, i) => `.bl${i}{--bl:${s}s}`),
      ...JITTER.map((s, i) => `.j${i}{--j:${s}s}`),
      ...Array.from({ length: 8 }, (_, i) => `.q${i}{--d:-${n2(i * 1.7)}s}`),
      // Lags between parts that move together: 30, 70, 90 and 60 ms.
      ".l1{--d:.03s}.l2{--d:.07s}.l3{--d:.09s}.l4{--d:.06s}",
      ...vars,
      // The shared clock, last so it wins: every looping part starts where the session's clock is;
      // the one-shots start when the scene loads, the power change less the time since it began.
      ".z{animation-delay:calc(var(--d,0s) - var(--t))}",
      ".pwn,.pwf,.pgw{animation-delay:calc(var(--k,0s) - var(--pa))}",
      ".ig,.gr,.kw,.kf,.ag,.swp,.sst{animation-delay:calc(var(--k,0s) - var(--age,0s))}",
      ".gv{animation-delay:calc(var(--bd) - var(--age,0s))}.bs,.b0,.b1,.b2{animation-delay:calc(var(--bd) + var(--j) - var(--age,0s))}",
      "@media (prefers-reduced-motion: reduce){*{animation:none!important}}",
    );
  }

  const dots = (id, size, cls) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect class="${cls}" x="${(8 - size) / 2}" y="${(8 - size) / 2}" width="${size}" height="${size}"/></pattern>`;
  const defs = [
    '<pattern id="gp" width="16" height="16" patternUnits="userSpaceOnUse"><rect class="gd" width="16" height="1"/><rect class="gd" width="1" height="16"/></pattern>',
    '<pattern id="gp2" width="128" height="128" patternUnits="userSpaceOnUse"><rect class="mj" width="128" height="1"/><rect class="mj" width="1" height="128"/></pattern>',
    dots("h3", 3, "dn"), dots("h2", 2, "dn"), dots("h1", 1, "dn"),
    '<pattern id="dt" width="4" height="4" patternUnits="userSpaceOnUse"><rect class="gd" width="2" height="2"/><rect class="gd" x="2" y="2" width="2" height="2"/></pattern>',
    '<pattern id="ru" width="8" height="4" patternUnits="userSpaceOnUse"><rect class="rr" width="1" height="4"/></pattern>',
    '<pattern id="ru2" width="64" height="8" patternUnits="userSpaceOnUse"><rect class="rr" width="2" height="8"/></pattern>',
    // The frame's ticks: a short one every 16 px, a long one every 64.
    '<pattern id="tk" width="6" height="64" patternUnits="userSpaceOnUse"><rect class="fdf" y="0" width="6" height="2"/><rect class="fdf" x="2" y="16" width="4" height="1"/><rect class="fdf" x="2" y="32" width="4" height="1"/><rect class="fdf" x="2" y="48" width="4" height="1"/></pattern>',
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="h0" stop-opacity=".2"/><stop offset="1" class="h0" stop-opacity="0"/></linearGradient>',
    '<radialGradient id="calm" cx=".5" cy=".55" r=".36"><stop offset="0" class="c0" stop-opacity="1"/><stop offset=".55" class="c0" stop-opacity=".92"/><stop offset="1" class="c0" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="ho"><stop offset="0" class="h0" stop-opacity=".5"/><stop offset=".4" class="h0" stop-opacity=".14"/><stop offset="1" class="h0" stop-opacity="0"/></radialGradient>',
    // Pre-blurred light: a far ember and a tongue of fire, soft with no filter to redraw.
    '<radialGradient id="eb"><stop offset="0" class="h0" stop-opacity=".95"/><stop offset=".3" class="h0" stop-opacity=".45"/><stop offset="1" class="h0" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="fl"><stop offset="0" class="h0" stop-opacity=".42"/><stop offset=".45" class="e0" stop-opacity=".16"/><stop offset="1" class="e0" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="hl"><stop offset="0" class="s0" stop-opacity=".5"/><stop offset=".4" class="s0" stop-opacity=".14"/><stop offset="1" class="s0" stop-opacity="0"/></radialGradient>',
    // Below the title strip, in the scene's own space and in a fuse cell's.
    `<clipPath id="cb"><rect y="${TOP}" width="100%" height="100%"/></clipPath>`,
    `<clipPath id="cf"><rect x="-4000" y="${TOP - FUSE_Y}" width="8000" height="8000"/></clipPath>`,
    // Glow regions, in the space of the group they are used in: a box round a cell, the fuse's
    // strip from the centre, the frame's columns; embers and bursts soft.
    filter("glow", 'x="-1" y="-1" width="3" height="3"', 2, 5),
    filter("glowc", 'filterUnits="userSpaceOnUse" x="-1400" y="-36" width="2800" height="72"', 2, 5),
    filter("glowf", `filterUnits="userSpaceOnUse" x="-${GUTTER + 24}" y="100" width="${2 * GUTTER + 48}" height="100%"`, 2),
    filter("soft", 'filterUnits="userSpaceOnUse" x="-1400" y="-40" width="2800" height="100%"', 1.2),
  ];

  const lights = lit.filter(Boolean).length;
  const alt = `LitClaude ignition scene: ${mood}, ${lights} of ${CELLS.length} stages lit`;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-label="${alt}"><style>${css.join("")}</style><defs>${defs.join("")}</defs>${body.join("")}</svg>`;
  return { source, alt, animated: !still };
};
