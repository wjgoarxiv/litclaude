// Synthwave mark for human-facing CLI output (install, doctor, help). Never for model-visible text.
import { MONO_ROWS, PIXEL_ROWS, SHARED_COLOURS } from "./synthwave-rows.mjs";

export const HOST_LABEL = "claude code";
// LitClaude chrome: ice blue at the top of each letter, rose at the base.
export const CHROME_STOPS = Object.freeze(["#e0fbff", "#8be9fd", "#3a6df0", "#ffffff", "#ff9ad5", "#c2185b"]);
const TAGLINE_STOPS = Object.freeze(["#8be9fd", "#ff2d95", "#ffd23f"]);
const EDGE = "#ffffff";
export const SIZES = Object.freeze([
  Object.freeze({ name: "B-L", minCols: 76 }),
  Object.freeze({ name: "B-M", minCols: 44 }),
  Object.freeze({ name: "B-S", minCols: 24 }),
]);

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const sample = (stops, t) => {
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.floor(t * n));
  const f = t * n - i;
  const a = rgb(stops[i]);
  const b = rgb(stops[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
};
const isChrome = (sym) => sym >= "a" && sym <= "l";

function pixelColour(sym) {
  if (sym === " ") return null;
  if (isChrome(sym)) return sample(CHROME_STOPS, (sym.charCodeAt(0) - 97) / 11);
  if (sym === "m") return EDGE;
  return SHARED_COLOURS[sym] ?? null;
}

// xterm 256-colour cube index for a #rrggbb colour.
const cube = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => Math.round((v / 255) * 5));
  return 16 + 36 * r + 6 * g + b;
};
const sgr = (hex, layer, mode) => {
  if (mode === "truecolor") return `${layer === "fg" ? 38 : 48};2;${rgb(hex).join(";")}`;
  return `${layer === "fg" ? 38 : 48};5;${cube(hex)}`;
};
const paint = (ch, fg, bg, mode) => {
  const codes = [fg && sgr(fg, "fg", mode), bg && sgr(bg, "bg", mode)].filter(Boolean);
  return codes.length === 0 ? ch : `\x1b[${codes.join(";")}m${ch}\x1b[0m`;
};

/** Largest size that fits `cols` terminal cells, or null when even B-S does not fit. */
export function pickSize(cols) {
  const width = Number.isFinite(cols) && cols > 0 ? cols : 80;
  return SIZES.find((size) => width >= size.minCols)?.name ?? null;
}

function cellRows(size, mode) {
  const rows = PIXEL_ROWS[size];
  const out = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = "";
    for (let x = 0; x < rows[y].length; x += 1) {
      const upper = rows[y][x];
      const lower = rows[y + 1][x];
      const top = pixelColour(upper);
      const bottom = pixelColour(lower);
      if (top === bottom) line += top ? paint(" ", null, top, mode) : " ";
      else if (top === null) line += paint("▄", bottom, null, mode);
      else line += paint("▀", top, bottom, mode);
    }
    out.push(line);
  }
  return out;
}

function taglineRow(width, mode) {
  const label = `LIT · ${HOST_LABEL}`;
  const pad = " ".repeat(Math.max(0, Math.floor((width - label.length) / 2)));
  if (mode === "mono") return `${pad}${label}`;
  const glyphs = [...label];
  return pad + glyphs.map((ch, i) => (ch === " " ? ch : paint(ch, sample(TAGLINE_STOPS, i / (glyphs.length - 1)), null, mode))).join("");
}

/**
 * Rows for the mark at the given width.
 * mode: "truecolor" | "256" (coloured), "mono" (no colour, the scene in glyphs), "plain" (one text line).
 */
export function synthwaveRows({ cols, mode = "mono" } = {}) {
  const size = pickSize(cols);
  if (mode === "plain" || size === null) return [`LIT · ${HOST_LABEL}`];
  const resolved = mode === "truecolor" || mode === "256" ? mode : "mono";
  const art = resolved === "mono" ? [...MONO_ROWS[size]] : cellRows(size, resolved);
  return [...art, taglineRow(PIXEL_ROWS[size][0].length, resolved)];
}
