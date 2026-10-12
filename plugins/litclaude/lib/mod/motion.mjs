// Motion vocabulary for the LIT band: easing curves, the approved timings, animated channels and
// colour mixing. Entrances pop with ease-out-back, fills and colour changes run ease-in-out, exits
// accelerate with ease-in. A channel is plain data ({ from, to, at, dur }) sampled against the
// surface's frame clock, so the band module keeps no timers beyond the frames it is animating.

export const EASE = Object.freeze({
  linear: (x) => x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inCubic: (x) => x ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outBack: (x) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2,
});

// Milliseconds. The user approved this faster set in the motion preview; `completion` bounds the
// whole finish moment (shimmer plus embers) and `frame` is the redraw interval while animating.
export const TIMINGS = Object.freeze({
  stagger: 60,
  entry: 160,
  fill: 300,
  flash: 400,
  noticeIn: 220,
  noticeOut: 150,
  noticeHold: 4000,
  crossfade: 140,
  shimmer: 400,
  embers: 1000,
  completion: 1200,
  exit: 150,
  frame: 33,
  breath: 2400,
  sweep: 1800,
  comet: 2600,
  ambientFrame: 66,
});

// full: the approved motion, and while LitClaude works the brand breathes, a light sweeps the active
// phase and a comet runs around the card's rules. subtle: no overshoot, no shimmer or embers, three
// quarters the time, and only the breathing while working. off: every duration is zero, so the band
// draws its final frame and never starts a frame timer.
export const motionProfile = (mode) => {
  if (mode === "off") {
    return { mode, duration: () => 0, enterEase: EASE.linear, noticeEase: EASE.linear, shimmer: false, embers: false, ambient: null };
  }
  if (mode === "subtle") {
    return { mode, duration: (ms) => Math.round(ms * 0.75), enterEase: EASE.outCubic, noticeEase: EASE.outCubic, shimmer: false, embers: false, ambient: { sweep: false, comet: false } };
  }
  return { mode: "full", duration: (ms) => ms, enterEase: EASE.outBack, noticeEase: EASE.outBack, shimmer: true, embers: true, ambient: { sweep: true, comet: true } };
};

export const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

// Progress through a window that opens at `at` and lasts `dur`; a zero-length window is complete.
export const phase = (now, at, dur) => (dur <= 0 ? (now >= at ? 1 : 0) : clamp01((now - at) / dur));

export const still = (value) => ({ from: value, to: value, at: 0, dur: 0 });

export const sample = (channel, now, ease = EASE.inOutCubic) =>
  channel.from + (channel.to - channel.from) * ease(phase(now, channel.at, channel.dur));

export const retarget = (channel, to, now, dur) => {
  if (channel.to === to) return channel;
  const from = sample(channel, now);
  return from === to ? still(to) : { from, to, at: now, dur };
};

export const isSettled = (channel, now) => channel.from === channel.to || now >= channel.at + channel.dur;

const hexToRgb = (hex) => {
  const value = String(hex).replace(/^#/u, "");
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) || 0);
};

export const lerpColor = (a, b, t) => {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const k = clamp01(t);
  return `#${from.map((v, i) => Math.round(v + (to[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
};

export const gradientAt = (stops, position) => {
  if (stops.length === 1) return lerpColor(stops[0], stops[0], 0);
  const scaled = clamp01(position) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  return lerpColor(stops[index], stops[index + 1], scaled - index);
};

export const BAR_STOPS = Object.freeze(["#ff2d95", "#00e5ff"]);
export const BAR_TRACK = "#30363d";

// A bar of `cells` cells filled to `fraction`. Whole cells take the pink-to-cyan gradient; the
// cell the fill is inside fades from the track colour to its gradient colour by how far it is
// filled, so the bar moves continuously in colour rather than in eighth-cell glyphs (a glyph-only
// change is not repainted inside a Claude Code Client region). While the bar moves, `glow` (0 to 1)
// brightens that leading cell. Every filled or fading cell is a solid `█`; the rest is the track.
export const barCells = (fraction, cells, glow = 0) => {
  const filled = clamp01(fraction) * cells;
  const full = Math.floor(filled + 1e-9);
  const part = full < cells ? filled - full : 0;
  const head = part > 1e-6 ? full : full - 1;
  const gradient = (i) => gradientAt(BAR_STOPS, cells <= 1 ? 0 : i / (cells - 1));
  const shine = (i, color) => (i === head && glow > 0 ? lerpColor(color, "#ffffff", glow * 0.7) : color);
  return Array.from({ length: cells }, (_, i) => {
    if (i < full) return { glyph: "█", color: shine(i, gradient(i)) };
    if (i === full && part > 1e-6) return { glyph: "█", color: shine(i, lerpColor(BAR_TRACK, gradient(i), part)) };
    return { glyph: "░", color: BAR_TRACK };
  });
};
