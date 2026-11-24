// The card's sunset: a half-sunk sun, twinkling stars, a shooting star now and then and a glittering
// sea, painted over the cells of the last three body rows that no text uses. Text always wins: the
// sun stays away while any of its cells is taken, and the sea keeps two cells clear of words.

import { textWidth } from "./layout.mjs";
import { lerpColor } from "./motion.mjs";

const FAINT = "#30363d";
const REWIND_SPARKS = Object.freeze([".", "*", "+", "'"]);
const span = (text, style = {}) => ({ text, ...style });

// Cells back to spans: neighbours join when they came from the same span (`from`) and look the same, and the
// blank gaps between words join, whatever colour their spaces carried.
const joinCells = (cells) => cells.reduce((out, { from, ...styled }) => {
  const cell = from === "gap" ? { text: styled.text } : styled;
  const last = out.at(-1);
  if (last && last.from === from && last.fg === cell.fg && last.bg === cell.bg && Boolean(last.bold) === Boolean(cell.bold)) last.text += cell.text;
  else out.push({ from, ...cell });
  return out;
}, []).map(({ from, ...part }) => part);
// The sunset scene, drawn only in cells no text uses. t is the ambient loop's elapsed seconds, null while the card
// rests: the same scene then holds still and costs no frames. Shape glyphs never change, only their colour; what does
// change its glyph (the sea, the stars) is ASCII.
export const SUN_W = 18;
const SUN_DARK = "#1a1030";
const SUN_INK = [["#ffd24a", "#fff0a0"], ["#ff8f3c", "#ffc15a"], ["#ff2d8a", "#ff6b8f"]];
// The dome's outline in eighth-blocks, so it curves; inside, a thin dark slit over the second row and a thicker one over the third.
const SUN_CELLS = [0, 1, 2].map((r) => Array.from({ length: SUN_W }, (_, x) => {
  const d = (x - (SUN_W - 1) / 2) / (SUN_W / 2);
  const fill = Math.max(0, Math.min(8, Math.round(Math.sqrt(1 - d * d) * 24) - (2 - r) * 8));
  if (fill === 0) return null;
  if (fill < 8) return ["▁▂▃▄▅▆▇"[fill - 1]];
  return r === 0 ? ["█"] : [r === 1 ? "▇" : "▆", SUN_DARK];
}));
const STARS = [[0, -30], [1, -24], [0, -18], [1, -13], [0, -9], [1, -5], [0, 22], [1, 25], [0, 29], [1, 32], [0, 35]];
// Colours come in eight steps, mixed once and kept, so a frame mixes nothing twice and equal neighbours merge.
const steps = new Map();
export const mixed = (a, b, k) => {
  const n = Math.max(0, Math.min(8, Math.round(k * 8)));
  const key = a + b + n;
  if (!steps.has(key)) { if (steps.size > 4000) steps.clear(); steps.set(key, lerpColor(a, b, n / 8)); }
  return steps.get(key);
};
// Each look keeps its own colours: the invited card's velvet, YOUR TURN's amber; the rewind sun turns with its rainbow.
const SUN_LOOK = {
  club: { ink: [["#ffd75f", "#fff6d6"], ["#ffb38a", "#ffe0b8"], ["#ff8fbf", "#ffc4e2"]], sea: ["#ffd75f", "#ffb38a", "#ff8fbf", "#b48cff", "#6a5aa8"] },
  turn: { ink: [["#ffc95a", "#fff0b8"], ["#ffaf3c", "#ffd98a"], ["#e08a1e", "#ffb95a"]], sea: ["#ffd98a", "#ffaf3c", "#e08a1e", "#9a6420", "#5a4020"] },
};
const SEA = ["#ffdc73", "#ff9a4a", "#ff4f8b", "#b457d6", "#5a46a8"];
// The sea's light dx cells from under the sun: waves that travel outward, brightest on the sun's path.
const seaCell = (dx, t, SEA_INK = SEA) => {
  const far = Math.abs(dx);
  const wave = Math.sin(far * 0.62 - t * 2.3) + 0.8 * Math.sin(dx * 0.31 + t * 1.1) + 0.6 * Math.sin(dx * 1.37 - t * 0.7);
  const level = wave * 0.62 + 1.05 - far / 34;
  if (level < 0.22) return null;
  const hue = Math.min(3.99, far / 13);
  const base = mixed(SEA_INK[Math.floor(hue)], SEA_INK[Math.floor(hue) + 1], hue % 1);
  return { text: level > 1.0 ? "~" : level > 0.55 ? "-" : ".", fg: mixed(FAINT, base, Math.min(1, 0.18 + level * 0.55)), ...(level > 1.5 ? { bold: true } : {}) };
};
// A row as one entry per cell; a wide character's second cell is null and a mark stays with its character.
const toCells = (row) => {
  const cells = [];
  row.forEach((part, index) => {
    const from = part.bg || part.text.trim() ? index : "gap";
    for (const ch of part.text) {
      const width = textWidth(ch);
      const last = cells.findLast(Boolean);
      if (width === 0 && last) last.text += ch;
      else cells.push({ ...part, text: ch, from }, ...(width === 2 ? [null] : []));
    }
  });
  return cells;
};
const isFree = (cell) => Boolean(cell) && cell.text === " " && !cell.bg;
// Paints the last three body rows: stars and now and then a shooting star over the sun, the sea on the third.
// Returns the rows and whether the sun found room; the sea keeps two cells clear of any text.
export const paintScene = (rows, at, t, dim, sunOk, { look = null, rainbow = null, lift = 1, sparks = null } = {}) => {
  const ink = SUN_LOOK[look]?.ink ?? SUN_INK;
  const s = t ?? 0;
  const grids = rows.map(toCells);
  const shade = (hex) => (dim ? mixed(hex, FAINT, 0.6) : hex);
  const sun = sunOk && grids.every((grid) => grid.slice(at - 2, at + SUN_W + 2).every(isFree) && grid.length >= at + SUN_W + 2);
  const mid = at + SUN_W / 2 - 0.5;
  if (sun) {
    for (const [r, dx] of STARS) {
      const x = at + dx;
      // A star stands clear of words, so it never reads as part of one.
      if (!isFree(grids[r][x]) || ![-3, -2, -1, 1, 2, 3].every((n) => grids[r][x + n] === undefined || isFree(grids[r][x + n]))) continue;
      const tw = 0.5 + 0.5 * Math.sin(s * 1.7 + dx * 2.1);
      grids[r][x] = span(tw > 0.85 ? "*" : tw > 0.45 ? "+" : ".", { fg: mixed(FAINT, shade(dx % 2 ? "#a99bff" : "#ff9ad5"), 0.35 + 0.65 * tw) });
    }
    const dash = t === null ? 9 : s % 9;
    if (dash < 1.1) {
      const head = Math.round(at + SUN_W + 22 - (dash / 1.1) * 34);
      ["*", "-", "-", "."].forEach((ch, i) => { if (isFree(grids[0][head + i])) grids[0][head + i] = span(ch, { fg: mixed("#fff4e0", "#b457d6", i / 3), bold: i === 0 }); });
    }
  }
  if (!rainbow && (t !== null || sun)) {
    const sea = grids[2];
    const before = sea.map(isFree);
    for (let x = 0; x < sea.length; x += 1) {
      const open = before[x] && [1, 2, 3].every((n) => before[x - n] !== false && before[x + n] !== false);
      const cell = open ? seaCell(x - mid, s, SUN_LOOK[look]?.sea) : null;
      if (cell) sea[x] = span(cell.text, { fg: shade(cell.fg), ...(cell.bold ? { bold: true } : {}) });
    }
  }
  if (sun) {
    SUN_CELLS.forEach((line, r) => line.forEach((cell, x) => {
      if (!cell) return;
      // Heat: light runs up the sun and ripples across it.
      const heat = 0.5 + 0.5 * Math.sin(s * 2.1 + r * 1.5 + 0.55 * Math.sin(x * 0.8 + s * 1.6));
      grids[r][at + x] = span(cell[0], { fg: rainbow ? mixed(rainbow(x / SUN_W / 2 + r * 0.12), "#ffffff", 0.45 + 0.25 * heat) : shade(mixed(ink[r][0], ink[r][1], t === null ? 0.25 : 0.25 + (heat - 0.25) * lift)), ...(cell[1] ? { bg: cell[1] } : {}) });
    }));
  }
  // The rewind sparks keep drifting, behind the sun.
  if (rainbow && sparks) for (const { x, glyph } of sparks) { const at2 = Math.floor(grids[2].length * (0.35 + 0.65 * x)); if (isFree(grids[2][at2]) && isFree(grids[2][at2 - 1])) grids[2][at2] = span(REWIND_SPARKS[glyph], { fg: rainbow(x) }); }
  return { rows: grids.map((grid) => joinCells(grid.filter(Boolean))), sun };
};
