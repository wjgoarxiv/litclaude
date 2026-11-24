// The sunset on the SVG card (svg-card.mjs): the terminal card's scene (sunset.mjs) drawn as vector
// art. A half-sunk sun in slices, its glow, a layered sea that runs outward from it with the sun's
// reflection on it, stars and a shooting star. Text always wins: each part is placed against the
// rectangles the card's words, pills and gauges take (`taken`) and left out where it has no room.
// Light is gradients only, with no filter, so a moving card has nothing expensive to redraw.

import { lerpColor, rainbowAt } from "./motion.mjs";

const FAINT = "#30363d";
// What the resting card's scene fades towards.
const DUSK = "#33203f";
const LOOK = Object.freeze({
  sunset: { sun: ["#ffe27a", "#ff9a3c", "#ff2d8a"], sea: ["#ffdc73", "#ff9a4a", "#ff4f8b", "#b457d6", "#5a46a8"] },
  club: { sun: ["#fff0b0", "#ffb38a", "#ff8fbf"], sea: ["#ffd75f", "#ffb38a", "#ff8fbf", "#b48cff", "#6a5aa8"] },
  turn: { sun: ["#fff0b8", "#ffc95a", "#e08a1e"], sea: ["#ffd98a", "#ffaf3c", "#e08a1e", "#9a6420", "#5a4020"] },
  rewind: { sun: [0.14, 0.02, 0.85].map((at) => lerpColor(rainbowAt(at), "#ffffff", 0.25)), sea: [0.14, 0.05, 0.9, 0.76, 0.62].map(rainbowAt) },
});
// The border's neon, left to right; the accent follows as the last stop.
export const NEON = Object.freeze(["#ff2d95", "#b48cff"]);
export const BRAND_STOPS = Object.freeze(["#ffa033", "#ff2d95"]);
// The card's own sky behind everything: dark enough that every ink on it keeps its contrast.
export const SKY = Object.freeze(["#0d1117", "#100f20", "#191031"]);

// Where the sun may stand, `[x, radius, how far it is sunk]`: its place on the card first, full size
// then small, then further right; under crowded rows only its rim shows above the sea.
export const SUN_SPOTS = Object.freeze([[624, 58, 0], [624, 40, 0], [776, 40, 0], [624, 64, 54], [776, 64, 54]]);
export const HORIZON = 24;
const EDGE = 2;
// The slices of the dome, as heights above the horizon in radii; the gaps between them widen downwards.
const SLICES = Object.freeze([[1, 0.6], [0.55, 0.39], [0.32, 0.205], [0.12, 0]]);
// Star fields: a twinkle period, a size, and where each star stands (x, y up from the horizon).
const STARS = Object.freeze([
  [2900, 2, [[446, 96], [498, 58], [556, 104], [586, 70], [668, 92], [718, 34], [744, 98], [806, 60], [846, 22]]],
  [3700, 1.6, [[430, 52], [474, 20], [520, 86], [546, 40], [702, 76], [732, 14], [768, 70], [820, 100], [852, 78]]],
  [4300, 2.5, [[462, 74], [536, 18], [690, 52], [760, 40], [792, 88], [834, 44]]],
]);

const n3 = (value) => +value.toFixed(3);
const n1 = (value) => +value.toFixed(1);
// The words of a row that stand close together read as one block: no art goes in their gaps.
const blocks = (taken) => {
  const out = [];
  for (const rect of [...taken].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const last = out.at(-1);
    if (last && rect.y0 < last.y1 && rect.y1 > last.y0 && rect.x0 - last.x1 < 100 && rect.x0 >= last.x0) {
      last.x1 = Math.max(last.x1, rect.x1);
      last.y0 = Math.min(last.y0, rect.y0);
      last.y1 = Math.max(last.y1, rect.y1);
    } else out.push({ ...rect });
  }
  return out;
};
const clear = (rects, x0, y0, x1, y1) => rects.every((r) => r.x1 <= x0 || r.x0 >= x1 || r.y1 <= y0 || r.y0 >= y1);
const distance = (rect, x, y) => Math.hypot(Math.max(rect.x0 - x, 0, x - rect.x1), Math.max(rect.y0 - y, 0, y - rect.y1));
const stops = (list) => list.map(([at, color, alpha = 1]) => `<stop offset="${at}" stop-color="${color}"${alpha === 1 ? "" : ` stop-opacity="${alpha}"`}/>`).join("");

const dome = ({ cx, cy, r, sink }) => SLICES.filter(([top]) => top * r > sink).map(([top, low]) => {
  const foot = Math.max(low, sink / r);
  const [w0, w1] = [top, foot].map((d) => n1(r * Math.sqrt(1 - d * d)));
  const [y0, y1] = [n1(cy + sink - r * top), n1(cy + sink - r * foot)];
  return `M${n1(cx - w1)} ${y1}A${r} ${r} 0 0 1 ${n1(cx - w0)} ${y0}H${n1(cx + w0)}A${r} ${r} 0 0 1 ${n1(cx + w1)} ${y1}Z`;
}).join("");

/** Where the sun stands on a card `height` tall, `{ cx, cy, r, sink, half }` (`half` its half-width at the sea), or null when words take its place. */
export const sunSpot = (taken, width, height) => {
  const cy = height - HORIZON;
  const rects = blocks(taken);
  const spots = SUN_SPOTS.map(([cx, r, sink]) => ({ cx, cy, r, sink, half: Math.round(Math.sqrt(r * r - sink * sink)) }));
  return spots.find(({ cx, r, sink, half }) => clear(rects, cx - half - 8, cy - r + sink - 2, cx + half + 8, cy) && clear(rects, cx - half - 24, cy, width, height)) ?? null;
};

/**
 * The scene's markup. `move` runs its loops (`loop` is the card's timing helper); `dim` is the
 * resting card's quieter colour. Returns "" when the sun has no room.
 */
export const sunsetSvg = ({ taken, width, height, look = "sunset", dim = false, move = false, loop }) => {
  const spot = sunSpot(taken, width, height);
  if (!spot) return "";
  const { cx, cy, r, sink, half } = spot;
  const rects = blocks(taken);
  const ink = LOOK[look] ?? LOOK.sunset;
  const shade = (color) => (dim ? lerpColor(color, DUSK, 0.45) : color);
  const sun = ink.sun.map(shade);
  const sea = ink.sea.map(shade);
  const live = (markup) => (move ? markup : "");
  const left = Math.max(EDGE, ...rects.filter((rect) => rect.y1 > cy - 2).map((rect) => rect.x1 + 24));
  const reach = Math.max(150, Math.min(340, cx - left));
  const glow = Math.floor(Math.min(128, ...rects.map((rect) => distance(rect, cx, cy))));
  const parts = [];
  const defs = [
    `<clipPath id="lit-sea"><path d="M${left} ${cy}H${width - EDGE}V${height - 15}a13 13 0 0 1 -13 13H${left}Z"/></clipPath>`,
    `<clipPath id="lit-out"><rect width="${width}" height="${HORIZON}"/></clipPath>`,
    `<linearGradient id="lit-sun" x1="0" x2="0" y1="0" y2="1">${stops([[0, sun[0]], [0.5, sun[1]], [1, sun[2]]])}</linearGradient>`,
    `<radialGradient id="lit-water" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${reach}">${stops([[0, sea[0]], [0.22, sea[1]], [0.48, sea[2], 0.9], [0.74, sea[3], 0.5], [0.92, sea[4], 0.12], [1, sea[4], 0]])}</radialGradient>`,
    `<radialGradient id="lit-deep" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${reach}">${stops([[0, sea[2], 0.42], [0.4, sea[3], 0.2], [1, sea[4], 0]])}</radialGradient>`,
    `<linearGradient id="lit-path" x1="0" x2="1" y1="0" y2="0">${stops([[0, sun[2], 0], [0.25, sun[2]], [0.5, sun[0]], [0.75, sun[2]], [1, sun[2], 0]])}</linearGradient>`,
  ];

  // The sky: stars wherever no word stands within a few pixels, and a shooting star that crosses in
  // the free strip between the map and the detail row.
  for (const [period, size, list] of STARS) {
    const d = list.filter(([x, up]) => clear(rects, x - 9, cy - up - 8, x + 9, cy - up + 8) && Math.hypot(x - cx, up + sink) > r + 9).map(([x, up]) => `M${x} ${cy - up}h0`).join("");
    if (d) parts.push(`<path class="lit-star" d="${d}" stroke="${shade(period === 3700 ? "#ff9ad5" : "#b9adff")}" stroke-width="${size}" stroke-linecap="round" opacity="${dim ? 0.55 : 0.85}">${live(`<animate attributeName="opacity" values="0.35;1;0.35" ${loop(period, 0.3, 3)}/>`)}</path>`);
  }
  if (move && clear(rects, 470, 65, width - 18, 74)) {
    defs.push(`<linearGradient id="lit-shoot" x1="0" x2="1" y1="0" y2="0">${stops([[0, "#fff4e0"], [1, "#b457d6", 0]])}</linearGradient>`);
    parts.push(`<rect class="lit-shoot" x="${width}" y="66" width="44" height="1.6" rx="0.8" fill="url(#lit-shoot)"><animateTransform attributeName="transform" type="translate" values="0 0;-396 6;0 0;0 0" keyTimes="0;0.1;0.1;1" ${loop(9000, 0.5)}/><animate attributeName="opacity" values="0;0.95;0;0" keyTimes="0;0.03;0.1;1" ${loop(9000, 0.5)}/></rect>`);
  }

  // The sun: its glow reaches as far as the nearest word, never under one.
  if (!sink && glow > r + 6) {
    const rim = r / glow;
    const fall = (k, alpha) => [n3(rim + (1 - rim) * k), sun[2], alpha];
    defs.push(`<radialGradient id="lit-glow" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${glow}">${stops([[n3(rim * 0.94), sun[2], 0], [n3(rim), sun[2], 0.6], fall(0.12, 0.36), fall(0.35, 0.17), fall(0.62, 0.06), fall(1, 0)])}</radialGradient>`);
    parts.push(`<path class="lit-glow" d="M${cx - glow} ${cy}a${glow} ${glow} 0 0 1 ${glow * 2} 0Z" fill="url(#lit-glow)" opacity="${dim ? 0.5 : 0.95}">${live(`<animate attributeName="opacity" values="0.7;1;0.7" ${loop(4800, 0.25, 3)}/>`)}</path>`);
  }
  const shape = dome(spot);
  parts.push(`<path class="lit-sun" d="${shape}" fill="url(#lit-sun)"/>`);
  // Heat: a soft light climbs the sun again and again.
  if (move) {
    defs.push(`<linearGradient id="lit-heat" x1="0" x2="0" y1="1" y2="0">${stops([[0, "#fff6d6", 0], [0.5, "#fff6d6", 0.5], [1, "#fff6d6", 0]])}<animateTransform attributeName="gradientTransform" type="translate" values="0 1;0 -1" ${loop(3400, 0.5)}/></linearGradient>`);
    parts.push(`<path d="${shape}" fill="url(#lit-heat)"/>`);
  }

  // The sea: deep light, three layers of waves drawn to the right of the sun and mirrored to its
  // left, so both sides run outward, the sun's broken reflection, and a bright horizon. A wave takes its
  // paint along as it runs, so its colour is carried back as far: the light stays with the sun.
  const wave = (i, y, half, rise, weight, period, phase) => {
    const turns = Math.ceil((reach + half * 2) / half);
    if (move) defs.push(`<radialGradient id="lit-water-${i}" href="#lit-water"><animateTransform attributeName="gradientTransform" type="translate" values="0 0;${-half * 2} 0" ${loop(period, phase)}/></radialGradient>`);
    return `<path d="M${-half * 2} ${y}q${half / 2} ${-rise} ${half} 0${`t${half} 0`.repeat(turns)}" stroke="url(#lit-water${move ? `-${i}` : ""})" stroke-width="${weight}">${live(`<animateTransform attributeName="transform" type="translate" values="0 0;${half * 2} 0" ${loop(period, phase)}/>`)}</path>`;
  };
  parts.push(
    `<g clip-path="url(#lit-sea)"${dim ? ' opacity="0.7"' : ""}><rect x="${left}" y="${cy}" width="${width - left}" height="${HORIZON}" fill="url(#lit-deep)"/>`
      + `<g transform="translate(${cx} ${cy})" fill="none" stroke-linecap="round"><g id="lit-waves" clip-path="url(#lit-out)">${wave(0, 5, 13, 2.6, 1.1, 2200, 0.4)}${wave(1, 11, 19, 3.6, 1.4, 3100, 0.2)}${wave(2, 18, 27, 4.6, 1.7, 4700, 0.6)}</g><use href="#lit-waves" transform="scale(-1 1)"/></g>`
      + [[[3, 1.85], [13.8, 1.1]], [[8.4, 1.5], [19, 0.66]]].map((bars, i) => `<g transform="translate(${cx} ${cy})"><g fill="url(#lit-path)">${bars.map(([dy, k]) => `<rect x="${n1(-half * k)}" y="${dy}" width="${n1(half * k * 2)}" height="2.5" rx="1.2" opacity="${n1(1 - dy / 32)}"/>`).join("")}${live(`<animateTransform attributeName="transform" type="scale" values="1 1;0.8 1;1 1" ${loop(2300 + i * 500, 0.25, 3)}/>`)}</g></g>`).join("")
      + `</g><rect x="${cx - reach}" y="${cy - 0.8}" width="${reach * 2}" height="1.6" fill="url(#lit-path)" clip-path="url(#lit-sea-line)"/>`,
  );
  defs.push(`<clipPath id="lit-sea-line"><rect x="${left}" y="${cy - 1}" width="${width - EDGE - left}" height="2"/></clipPath>`);
  return `<g class="lit-scene"><defs>${defs.join("")}</defs>${parts.join("")}</g>`;
};

/** The sun's light on the card's bottom edge, or "" with no sun. */
export const shoreSvg = ({ taken, width, height, look = "sunset", dim = false }) => {
  const spot = sunSpot(taken, width, height);
  if (!spot) return "";
  const [gold, orange] = (LOOK[look] ?? LOOK.sunset).sun.map((color) => (dim ? lerpColor(color, FAINT, 0.45) : color));
  const [x0, x1] = [spot.cx - 170, Math.min(width - 15, spot.cx + 170)];
  return `<defs><linearGradient id="lit-shore" gradientUnits="userSpaceOnUse" x1="${spot.cx - 170}" x2="${spot.cx + 170}" y1="0" y2="0">${stops([[0, orange, 0], [0.3, orange, 0.8], [0.5, gold], [0.7, orange, 0.8], [1, orange, 0]])}</linearGradient></defs><rect class="lit-shore" x="${x0}" y="${height - 2.25}" width="${x1 - x0}" height="2.5" fill="url(#lit-shore)"/>`;
};

/** The neon border's stops across a card, dimmed at rest. */
export const neonStops = (accent, dim) => [...NEON, accent].map((color, i) => [i / 2, dim ? lerpColor(color, FAINT, 0.45) : color]);
export const stopsOf = stops;
