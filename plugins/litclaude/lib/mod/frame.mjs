// Turns a band model and one sampled frame into the LIT card: five rows of coloured spans. A span is
// { text, fg?, bg?, bold? }; the surface module draws each row as a line of Text elements. The card
// draws its own rounded border so the top edge can carry the title and the bottom edge the live
// figures, and every row is fitted to exactly the card's width, counting Hangul and emoji as two
// cells, so nothing wraps and the card keeps its height whether LitClaude is working or idle.
//
//   ╭─ [🔥 LIT] · start-work ───────────────────────────────── WORK ● ─╮
//   │ interview ✓ ━━ plan ✓ ━━ [work 3/7] ━━ review · ── done ·  1 lane │
//   │ └ task 3/7 ███░░░░░ · next ▸ 4. README demo        - Bash · 0:12 │
//   │ skills [⚡ start-work] [↯ lit-plan]                               │
//   ╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · 1w 12% · git main ─────────────────────╯
//
// The second row is the workflow map (workflow.mjs): done stages carry a check in a colour graded
// along the rail from flame orange through pink to the accent, the current stage is a pill, the
// stages ahead are dim. The rail leaving the current stage fills with its count and, while
// LitClaude works, carries a bright head; the rails ahead are dim `─`. A narrow card drops the
// rails, then shortens the names, then shows only the current stage and its neighbours. With no
// family to place the session in, the row is the PLAN / WORK / REVIEW track instead. The third row
// is the stage's detail and, on the right, the tool the main loop is running and for how long.
//
// Each bracket pair stands for the two end cells of a filled pill: the brand on pink, the current
// stage and this request's skills on the accent with dark text, skills from earlier requests on
// dark grey. Those end cells are rounded Nerd Font caps in the pill's colour, or one cell of
// padding in that colour with basic glyphs, so a pill is as wide in either glyph set.
//
// In a real Claude Code 2.1.292 terminal, a row whose only change is a non-ASCII glyph (a block,
// symbol, Hangul or Nerd Font cell) keeps showing the old glyph; a change to ASCII text, or to the
// colour of an ASCII cell, repaints. So every change is carried by ASCII: a bar cell is a space on
// its colour and the leading cell fades in by colour, embers are ASCII sparks, labels pop in letter
// by letter, a notice slides by its leading spaces, a chip's light moves over its ASCII name, and a
// glyph swaps only together with the colour of its words. The map's rail cells keep their glyph
// and move by colour alone (a colour change on `─` or `━` repaints), and the live step's spinner
// and clock are ASCII.

import { textWidth, truncateToWidth } from "./layout.mjs";
import { barCells, gradientAt, lerpColor } from "./motion.mjs";
import { glyphSet } from "./settings.mjs";
import { formatDuration } from "./view.mjs";

export const PALETTE = Object.freeze({
  pink: "#ff2d95",
  pinkText: "#ff6fae",
  orange: "#ff6337",
  cyan: "#00e5ff",
  accent: "#5fd7ff",
  green: "#6bdb8f",
  amber: "#ffaf3c",
  red: "#ff5f5f",
  violet: "#b48cff",
  white: "#e6edf3",
  dim: "#6e7681",
  faint: "#30363d",
});

// The status line's level colours (xterm 71, 178, 167) and its empty bar cells (238).
const HUD = Object.freeze({ green: "#5faf5f", yellow: "#d7af00", red: "#d75f5f", empty: "#444444" });
// Past this many columns the card stops growing, so a wide terminal does not stretch it thin.
export const CARD_MAX = 120;
// Pill colours: dark text on the bright fills, the muted pill for earlier skills and +N, the brand
// pink of the status line's prefix, and the connectors between phases.
const PILL = Object.freeze({ ink: "#0b0f14", muted: "#2d333b", mutedText: "#adb5bf", brand: PALETTE.pink, rail: "#46505c" });
const TONE = Object.freeze({
  pink: { bar: PALETTE.pink, title: PALETTE.pinkText, icon: "🔥" },
  amber: { bar: PALETTE.amber, title: PALETTE.amber, icon: "⚠" },
  red: { bar: PALETTE.red, title: PALETTE.red, icon: "✗" },
});
const LABELS = Object.freeze({ plan: "PLAN", work: "WORK", review: "REVIEW" });
const PHASES = Object.freeze(["plan", "work", "review"]);

const span = (text, style = {}) => ({ text, ...style });
export const rowWidth = (row) => row.reduce((sum, part) => sum + textWidth(part.text), 0);
export const rowText = (row) => row.map(({ text }) => text).join("");

// Cuts a row to `cells`, splitting the span that crosses the edge.
export const clipRow = (row, cells) => {
  const out = [];
  let room = cells;
  for (const part of row) {
    if (room <= 0) break;
    const width = textWidth(part.text);
    if (width <= room) {
      out.push(part);
      room -= width;
    } else {
      out.push({ ...part, text: truncateToWidth(part.text, room, "") });
      room = 0;
    }
  }
  return out;
};

// Clips a row to `cells` and pads it with spaces to exactly that width.
const fitRow = (row, cells) => {
  const clipped = clipRow(row, cells);
  const missing = cells - rowWidth(clipped);
  return missing > 0 ? [...clipped, span(" ".repeat(missing))] : clipped;
};

// A label popping in: the first `reveal` share of its characters, and while ease-out-back carries
// the reveal past 1, a cell or two of extra padding so the label visibly overshoots and settles.
export const revealText = (label, reveal) => {
  if (!(reveal > 0)) return null;
  const chars = [...label];
  const count = Math.max(1, Math.round(reveal * chars.length));
  return chars.slice(0, Math.min(count, chars.length)).join("") + " ".repeat(Math.max(0, count - chars.length));
};

// Text inside a pill, one span per character, when a light is passing: the fill brightens around
// `shimmer` (0 to 1 across the visible characters). Without a light the text stays one span.
const litText = (text, style, shimmer) => {
  if (shimmer === null || shimmer === undefined) return [span(text, style)];
  const chars = [...text];
  const visible = chars.filter((ch) => ch.trim()).length;
  let k = 0;
  return chars.map((ch) => {
    if (!ch.trim()) return span(ch, { ...style });
    const position = visible <= 1 ? 0 : k / (visible - 1);
    k += 1;
    const near = Math.abs(position - shimmer);
    return span(ch, near < 0.18 ? { ...style, bg: lerpColor(style.bg, "#ffffff", (1 - near / 0.18) * 0.6) } : { ...style });
  });
};

// A filled pill around `body` (spans that already carry the fill as `bg`): rounded caps in the
// fill colour where the glyph set has them, one cell of padding in the fill otherwise.
const pill = (body, fill, glyphs) => (glyphs.capLeft
  ? [span(glyphs.capLeft, { fg: fill }), ...body, span(glyphs.capRight, { fg: fill })]
  : [span(" ", { bg: fill }), ...body, span(" ", { bg: fill })]);

const inkOf = (accent) => ({ done: lerpColor(accent, PALETTE.dim, 0.45), now: accent, todo: PALETTE.dim, warn: PALETTE.amber });

// Colour of one phase in this frame: the crossfade from its previous state, then the amber mix for
// the work phase while the context warning is up.
const phaseColor = (id, sample, ink) => {
  const { from, to, mix } = sample.phases[id];
  const color = lerpColor(ink[from], ink[to], mix);
  return id === "work" && sample.warn > 0 ? lerpColor(color, ink.warn, sample.warn) : color;
};

// The warning glyph swaps on the same frame the ASCII `ctx` text appears, so the row repaints.
const warned = (id, sample) => id === "work" && sample.warn > 0.02;

const segment = (id, priority, spans, joiner = "  ") => (spans && spans.length ? { id, priority, spans, joiner, width: rowWidth(spans) } : null);

// Keeps segments in display order, dropping the highest priority numbers first until the joined
// row fits `room`; each kept segment after the first is preceded by its own joiner.
const fitJoined = (segments, room) => {
  let kept = segments.filter(Boolean);
  const total = () => kept.reduce((sum, part, index) => sum + part.width + (index > 0 ? textWidth(part.joiner) : 0), 0);
  while (kept.length > 0 && total() > room) {
    const worst = kept.reduce((a, b) => (b.priority >= a.priority ? b : a));
    kept = kept.filter((part) => part !== worst);
  }
  return kept;
};

const joinSegments = (kept, joinerColor) => kept.flatMap((part, index) => (index > 0 ? [span(part.joiner, { fg: joinerColor }), ...part.spans] : part.spans));

const COMET_TAIL = 12;

// The comet's colour `k` of the way from its tail (0) to its head (1): flame orange fading in, pink
// through the body and white at the head, laid over the rule's own colour.
const cometColor = (base, k) => {
  const hue = k > 0.8 ? lerpColor(PALETTE.pink, "#ffffff", (k - 0.8) / 0.2) : lerpColor(PALETTE.orange, PALETTE.pink, k / 0.8);
  return lerpColor(base, hue, Math.min(1, k * 1.6));
};

// The rule of an edge, `count` cells from column `start`. With a comet ({ x, dir }: its head's
// column and travel direction) the cells behind the head light up, brightest at the head, and the
// rule becomes one span per cell; without one it stays a single span.
const ruleSpans = (count, color, start, comet) => {
  if (!comet) return [span("─".repeat(count), { fg: color })];
  return Array.from({ length: count }, (_, i) => {
    const behind = comet.dir * (comet.x - (start + i));
    const k = behind >= 0 && behind <= COMET_TAIL ? 1 - behind / COMET_TAIL : 0;
    return span("─", { fg: k > 0 ? cometColor(color, k) : color });
  });
};

// An edge of the card: `open` and `close` are its corners, `left` its title or figures and
// `right` the phase indicator, with the rule filling whatever room is left.
const edgeRow = (open, left, right, close, width, color, comet = null) => {
  const tail = right.length ? [span(" "), ...right, span(` ${close}`, { fg: color })] : [span(close, { fg: color })];
  const fill = Math.max(1, width - textWidth(open) - rowWidth(left) - 1 - rowWidth(tail));
  const start = textWidth(open) + rowWidth(left) + 1;
  return clipRow([span(open, { fg: color }), ...left, span(" "), ...ruleSpans(fill, color, start, comet), ...tail], width);
};

// Where the ambient comet is on this card: along the top rule left to right for the first half of
// its loop, then back along the bottom rule, starting and ending just off the card.
const cometOn = (sample, edge, width) => {
  const u = sample.ambient?.comet;
  if (u === null || u === undefined) return null;
  const span = width + 2 * COMET_TAIL;
  if (edge === "top") return u < 0.5 ? { x: u * 2 * span - COMET_TAIL, dir: 1 } : null;
  return u >= 0.5 ? { x: width + COMET_TAIL - (u - 0.5) * 2 * span, dir: -1 } : null;
};

// While LitClaude works the brand pill breathes from its pink toward the flame orange and back.
const brandSpans = (sample, glyphs) => {
  const reveal = revealText("🔥 LIT", sample.pills[0]);
  if (reveal === null) return [];
  const fill = sample.ambient ? lerpColor(PILL.brand, PALETTE.orange, 0.85 * sample.ambient.breath) : PILL.brand;
  return pill(litText(reveal, { fg: PILL.ink, bg: fill, bold: true }, sample.completion?.shimmer ?? null), fill, glyphs);
};
const indicatorSpans = (model, sample, glyphs, accent) => {
  if (sample.completion) return [span(`DONE ${glyphs.done}`, { fg: PALETTE.green, bold: true })];
  if (model.idle) return [span("idle", { fg: PALETTE.dim })];
  const flow = model.workflow;
  if (flow && flow.current >= 0) {
    const warn = model.ctxWarning && sample.warn > 0.02;
    return [span(`${flow.stages[flow.current].id.toUpperCase()} ${warn ? glyphs.warn : glyphs.now}`, { fg: warn ? lerpColor(accent, PALETTE.amber, sample.warn) : accent, bold: true })];
  }
  if (flow && model.lanes.count === 0) return [span(`DONE ${glyphs.done}`, { fg: PALETTE.green, bold: true })];
  const current = PHASES.find((id) => model.phases[id] === "now");
  if (current) return [span(`${LABELS[current]} ${warned(current, sample) ? glyphs.warn : glyphs.now}`, { fg: phaseColor(current, sample, inkOf(accent)), bold: true })];
  if (PHASES.every((id) => model.phases[id] === "done") && model.lanes.count === 0) return [span(`DONE ${glyphs.done}`, { fg: PALETTE.green, bold: true })];
  return [span(`LIVE ${glyphs.now}`, { fg: accent, bold: true })];
};

// ╭─ [🔥 LIT] · <discipline> ──── <PHASE ●> ─╮. On a narrow card the phase indicator goes first,
// then the discipline shortens, then it goes too.
const topEdge = (model, sample, { width, glyphs, accent, edge }) => {
  const brand = brandSpans(sample, glyphs);
  const right = indicatorSpans(model, sample, glyphs, accent);
  const name = model.title ?? "ready";
  const nameStyle = model.idle ? { fg: PALETTE.dim } : { fg: accent, bold: true };
  const title = (text) => (text ? [span(" · ", { fg: PALETTE.dim }), span(text, nameStyle)] : []);
  const fixed = textWidth("╭─ ") + rowWidth(brand) + 1 + 1;
  const withRight = fixed + rowWidth(title(name)) + 1 + rowWidth(right) + textWidth(" ─╮");
  const comet = cometOn(sample, "top", width);
  if (withRight <= width) return edgeRow("╭─ ", [...brand, ...title(name)], right, "─╮", width, edge, comet);
  const room = width - fixed - textWidth("─╮") - textWidth(" · ");
  const shown = room >= 4 ? truncateToWidth(name, room) : "";
  return edgeRow("╭─ ", [...brand, ...title(shown)], [], "─╮", width, edge, comet);
};

const barSpans = (fraction, sample, cells) => barCells(fraction, cells, sample.fillGlow ?? 0)
  .map(({ glyph, color }) => (glyph === "█" ? span(" ", { bg: color }) : span(glyph, { fg: color })));

// ●● 2 lanes 1:07: a dot per running lane (amber once stalled), the count and the longest lane's
// clock. While LitClaude works a light walks across the dots (full motion) or they breathe (subtle),
// so running lanes move while the main turn waits; a dot changes only by colour, which repaints.
const laneSegment = (model, sample, glyphs) => {
  const list = model.lanes.list.slice(0, 4);
  const ambient = model.idle ? null : sample.ambient;
  const dots = list.map((lane, index) => {
    const base = lane.status === "stalled" ? PALETTE.amber : PALETTE.green;
    let light = 0;
    if (ambient?.flow !== null && ambient?.flow !== undefined) light = 0.8 * Math.max(0, 1 - Math.abs(ambient.flow * (list.length + 1) - 0.5 - index));
    else if (ambient) light = 0.5 * ambient.breath;
    return span(glyphs.lane, { fg: lerpColor(base, "#ffffff", light) });
  });
  const clock = sample.lanes ? ` ${formatClock(sample.lanes.elapsedMs)}` : "";
  return segment("lanes", 3, [...dots, span(` ${model.lanes.count} ${model.lanes.count === 1 ? "lane" : "lanes"}${clock}`, { fg: PALETTE.dim })]);
};

// The right half of the phase row: a context warning, the lanes, the autoloop budget and the
// progress of the plan or goal, dropped in that priority order when the row is narrow.
const progressSegment = (model, sample, glyphs, cells) => {
  if (model.progress) {
    const label = model.progress.unit === "tasks" ? "tasks" : "goal";
    return segment("progress", 1, [
      span(`${label} `, { fg: PALETTE.dim }),
      ...barSpans(sample.fill, sample, cells),
      span(" "),
      span(String(model.progress.done), { fg: lerpColor(PALETTE.white, PALETTE.cyan, Math.max(sample.flash, sample.fillGlow ?? 0)), bold: true }),
      span(`/${model.progress.total}`, { fg: PALETTE.dim }),
    ]);
  }
  const goal = model.goal;
  if (!goal) return null;
  const met = goal.status === "complete";
  return segment("progress", 1, [
    span("goal ", { fg: PALETTE.dim }),
    span(met ? `${glyphs.done} ` : "", { fg: PALETTE.green }),
    span(`${goal.passed}/${goal.total}`, { fg: met ? PALETTE.green : PALETTE.white, bold: met }),
  ]);
};

// ● PLAN ━━ [WORK] ━━ ○ REVIEW: the active phase is a pill on the accent (amber while the context
// warning is up), done phases a dim-accent dot and the rest a dim ring. Each form of a label is
// as wide as the others, so a phase changing state never moves the row.
const phaseTrack = (model, sample, { glyphs, accent, rail, short }) => {
  const ink = inkOf(accent);
  const out = [];
  PHASES.forEach((id, index) => {
    const label = short ? LABELS[id][0] : LABELS[id];
    const state = sample.phases[id].to;
    const shown = revealText(state === "now" ? label : `${state === "done" ? "●" : "○"} ${label}`, sample.pills[index + 1]);
    if (shown === null) return;
    if (out.length) out.push(span(` ${glyphs.rail.repeat(rail)} `, { fg: sample.phases[PHASES[index - 1]].to === "done" ? ink.done : PILL.rail }));
    if (state === "now") {
      const fill = model.idle ? lerpColor(phaseColor(id, sample, ink), PILL.muted, 0.5) : phaseColor(id, sample, ink);
      const sweep = model.idle ? null : sample.ambient?.sweep ?? null;
      out.push(...pill(litText(shown.slice(0, label.length).padEnd(label.length), { fg: PILL.ink, bg: fill, bold: true }, sweep), fill, glyphs));
    } else {
      out.push(span(warned(id, sample) ? shown.replace(/^[●○]/u, glyphs.warn) : shown, { fg: phaseColor(id, sample, ink) }));
    }
  });
  return out;
};

const phaseRow = (model, sample, { inner, glyphs, accent }) => {
  const variants = [{ rail: 2, short: false }, { rail: 1, short: false }, { rail: 1, short: true }];
  const tracks = variants.map((variant) => phaseTrack(model, sample, { glyphs, accent, ...variant }));
  const right = [];
  if (sample.rest > 0) {
    const warning = model.ctxWarning && sample.warn > 0.02
      ? [span(`ctx ${model.ctxWarning.percent}% → ${model.ctxWarning.threshold}%`, { fg: lerpColor(PALETTE.dim, PALETTE.amber, sample.warn), bold: sample.warn > 0.5 })]
      : null;
    right.push(segment("ctx", 1, warning));
    if (model.lanes.count > 0) {
      right.push(laneSegment(model, sample, glyphs));
    }
    if (model.autoloop) {
      right.push(segment("loop", 4, [span(`${glyphs.loop} ${model.autoloop.n}/${model.autoloop.max}`, { fg: PALETTE.violet }), span(` · ${formatDuration(model.autoloop.leftMs)}`, { fg: PALETTE.dim })]));
    }
    right.push(progressSegment(model, sample, glyphs, inner >= 70 ? 8 : 5));
  }
  const track = tracks.find((candidate) => rowWidth(candidate) + 2 + 10 <= inner) ?? tracks.at(-1);
  const kept = fitJoined(right, inner - rowWidth(track) - 2);
  const tail = joinSegments(kept, PALETTE.faint);
  if (!tail.length) return fitRow(track, inner);
  return fitRow([...track, span(" ".repeat(Math.max(2, inner - rowWidth(track) - rowWidth(tail)))), ...tail], inner);
};

// The colour of a point `position` (0 to 1) of the way along the map: flame orange, pink, accent.
const mapColor = (accent, position) => gradientAt([PALETTE.orange, PALETTE.pink, accent], position);

// A stage name cut to its first three letters, its count kept: `work 3/7` becomes `wor 3/7`.
const shortLabel = (label) => label.replace(/^[A-Za-z]+/u, (word) => word.slice(0, 3));

// The rail from stage `index - 1` to stage `index`, `cells` wide. Behind the current stage it is
// `━` graded along the map; leaving it, `━` filled by the stage's count with a bright head while
// LitClaude works; ahead, dim `─`. With no room for rails, one space.
const railSpans = (model, sample, index, cells, accent) => {
  if (cells === 0) return [span(" ")];
  const { stages } = model.workflow;
  const last = Math.max(1, stages.length - 1);
  const at = (cell) => (index - 1 + (cell + 0.5) / cells) / last;
  const into = stages[index].state;
  const from = stages[index - 1].state;
  let body;
  if (into === "done" || into === "now") {
    body = Array.from({ length: cells }, (_, cell) => span("━", { fg: mapColor(accent, at(cell)) }));
  } else if (from === "now") {
    const filled = model.workflow.count ? sample.fill * cells : 0;
    const flow = model.idle ? null : sample.ambient?.flow ?? null;
    const head = flow === null ? -1 : Math.floor(flow * cells);
    body = Array.from({ length: cells }, (_, cell) => {
      const base = cell < filled ? mapColor(accent, at(cell)) : PILL.rail;
      return span("━", { fg: cell === head ? lerpColor(base, "#ffffff", 0.75) : base });
    });
  } else {
    body = [span("─".repeat(cells), { fg: PILL.rail })];
  }
  return [span(" "), ...body, span(" ")];
};

// interview ✓ ━━ plan ✓ ━━ [work 3/7] ━━ review · ── done ·
const mapTrack = (model, sample, { glyphs, accent, rail, short = false, window = false }) => {
  const { stages, current } = model.workflow;
  const last = Math.max(1, stages.length - 1);
  const focus = current < 0 ? stages.length - 1 : current;
  const shown = stages.map((_, index) => index).filter((index) => !window || Math.abs(index - focus) <= 1);
  const out = [];
  if (window && shown[0] > 0) out.push(span("… ", { fg: PALETTE.dim }));
  shown.forEach((index) => {
    const stage = stages[index];
    const label = short ? shortLabel(stage.label) : stage.label;
    const text = stage.state === "now" ? label : `${label} ${stage.state === "done" ? glyphs.done : "·"}`;
    const revealed = revealText(text, sample.pills[Math.min(3, 1 + Math.floor(index / 2))]);
    if (revealed === null) return;
    if (out.length && !(window && out.length === 1 && shown[0] > 0)) out.push(...railSpans(model, sample, index, rail, accent));
    if (stage.state === "now") {
      let fill = model.idle ? lerpColor(accent, PILL.muted, 0.5) : accent;
      if (model.ctxWarning) fill = lerpColor(fill, PALETTE.amber, sample.warn);
      if (sample.ambient && !model.idle) fill = lerpColor(fill, "#ffffff", 0.2 * sample.ambient.breath);
      const sweep = model.idle ? null : sample.ambient?.sweep ?? null;
      out.push(...pill(litText(revealed.slice(0, label.length).padEnd(label.length), { fg: PILL.ink, bg: fill, bold: true }, sweep), fill, glyphs));
    } else {
      out.push(span(revealed, { fg: stage.state === "done" ? mapColor(accent, index / last) : PALETTE.dim }));
    }
  });
  if (window && shown.at(-1) < stages.length - 1) out.push(span(" …", { fg: PALETTE.dim }));
  return out;
};

const MAP_VARIANTS = Object.freeze([
  { rail: 2 },
  { rail: 1 },
  { rail: 0 },
  { rail: 0, short: true },
  { rail: 0, short: true, window: true },
]);

// The map, then the context warning, the lanes and the autoloop budget while there is room.
const mapRow = (model, sample, { inner, glyphs, accent }) => {
  const tracks = MAP_VARIANTS.map((variant) => mapTrack(model, sample, { glyphs, accent, ...variant }));
  const track = tracks.find((candidate) => rowWidth(candidate) <= inner) ?? tracks.at(-1);
  const right = [];
  if (sample.rest > 0) {
    if (model.ctxWarning && sample.warn > 0.02) {
      right.push(segment("ctx", 1, [span(`ctx ${model.ctxWarning.percent}% → ${model.ctxWarning.threshold}%`, { fg: lerpColor(PALETTE.dim, PALETTE.amber, sample.warn), bold: sample.warn > 0.5 })]));
    }
    if (model.lanes.count > 0) {
      right.push(laneSegment(model, sample, glyphs));
    }
    if (model.autoloop) {
      right.push(segment("loop", 4, [span(`${glyphs.loop} ${model.autoloop.n}/${model.autoloop.max}`, { fg: PALETTE.violet }), span(` · ${formatDuration(model.autoloop.leftMs)}`, { fg: PALETTE.dim })]));
    }
  }
  const kept = fitJoined(right, inner - rowWidth(track) - 2);
  const tail = joinSegments(kept, PALETTE.faint);
  if (!tail.length) return fitRow(track, inner);
  return fitRow([...track, span(" ".repeat(Math.max(2, inner - rowWidth(track) - rowWidth(tail)))), ...tail], inner);
};

const SPINNER = Object.freeze(["-", "\\", "|", "/"]);

// m:ss, or h:mm:ss past the hour.
export const formatClock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
};

// The live step: an ASCII spinner, the tool's name and how long it has run. Nothing else of the call.
const stepSpans = (sample, accent) => {
  if (!sample.step) return [];
  return [
    span(`${SPINNER[sample.spin ?? 0]} `, { fg: accent, bold: true }),
    span(sample.step.name, { fg: PALETTE.white }),
    span(` · ${formatClock(sample.step.elapsedMs)}`, { fg: PALETTE.dim }),
  ];
};

const VERDICT_STYLE = Object.freeze({
  pass: (glyphs) => [glyphs.done, PALETTE.green],
  fail: (glyphs) => [glyphs.fail, PALETTE.red],
  pending: () => ["·", PALETTE.dim],
  running: (glyphs) => [glyphs.lane, PALETTE.amber],
});

// The review lanes or a crucible verdict: each name in its verdict's colour (a lane under review
// amber), so a change repaints.
// `cut` shortens the names to that many letters; 0 drops them and leaves the marks.
const verdictSpans = (verdicts, glyphs, cut = Infinity) => verdicts.flatMap(({ name, state }, index) => {
  const [mark, color] = VERDICT_STYLE[state](glyphs);
  const text = cut === 0 ? mark : `${name.slice(0, cut)} ${mark}`;
  return [...(index > 0 ? [span(" ")] : []), span(text, { fg: color })];
});

// └ task 3/7 ███░░░░░ · paused · next ▸ <task>                    - Bash · 0:12
const detailRow = (model, sample, { inner, glyphs, accent }) => {
  const flow = model.workflow;
  const right = stepSpans(sample, accent);
  const segments = [];
  if (flow?.count) {
    const { done, total, unit } = flow.count;
    const glow = sample.ambient && !model.idle ? 0.5 * sample.ambient.breath : sample.fillGlow ?? 0;
    const bar = barCells(sample.fill, inner >= 70 ? 8 : 5, glow).map(({ glyph, color }) => (glyph === "█" ? span(" ", { bg: color }) : span(glyph, { fg: color })));
    segments.push(segment("count", 1, [
      span(`${unit} `, { fg: PALETTE.dim }),
      span(String(done), { fg: lerpColor(PALETTE.white, PALETTE.cyan, Math.max(sample.flash, sample.fillGlow ?? 0)), bold: true }),
      span(`/${total} `, { fg: PALETTE.dim }),
      ...bar,
    ], " · "));
  }
  const lead = [span("└ ", { fg: PALETTE.dim })];
  const room = inner - rowWidth(lead) - (right.length ? rowWidth(right) + 2 : 0);
  if (flow?.verdicts) {
    const before = segments.reduce((sum, part) => sum + part.width + textWidth(part.joiner), 0);
    const forms = [Infinity, 3, 0].map((cut) => segment("verdicts", 2, verdictSpans(flow.verdicts, glyphs, cut), " · "));
    segments.push(forms.find((form) => before + form.width <= room) ?? forms.at(-1));
  }
  (flow?.items ?? []).forEach((item, index) => segments.push(segment(`item-${index}`, 3 + index, [span(item, { fg: PALETTE.white })], " · ")));
  let left = joinSegments(fitJoined(segments, room), PALETTE.faint);
  if (flow?.next) {
    const gap = left.length ? [span(" · ", { fg: PALETTE.faint })] : [];
    const label = [span("next ", { fg: PALETTE.dim }), span(`${glyphs.next} `, { fg: accent })];
    const avail = room - rowWidth(left) - rowWidth(gap) - rowWidth(label);
    if (avail >= 6) left = [...left, ...gap, ...label, span(truncateToWidth(flow.next, avail), { fg: PALETTE.white })];
  }
  if (!left.length && !right.length) return fitRow([], inner);
  const body = [...lead, ...left];
  if (!right.length) return fitRow(body, inner);
  return fitRow([...body, span(" ".repeat(Math.max(1, inner - rowWidth(body) - rowWidth(right)))), ...right], inner);
};

const CHIP_TONE = Object.freeze({
  current: (accent) => ({ fill: accent, text: PILL.ink }),
  recent: () => ({ fill: PILL.muted, text: PILL.mutedText }),
});

// One chip pill: the bolt and the skill name, on the accent for this request or muted for an
// earlier one. A chip that just arrived carries full motion's light along its name, or fills up
// from the muted pill under subtle; a chip changing state crossfades its colours.
const chipSpans = (chip, timed, glyphs, accent, sweep = null) => {
  const to = timed?.to ?? chip.state;
  const from = timed?.from ?? to;
  const mix = timed?.mix ?? 1;
  const arrive = timed?.arrive ?? 1;
  let fill = lerpColor(CHIP_TONE[from](accent).fill, CHIP_TONE[to](accent).fill, mix);
  const text = lerpColor(CHIP_TONE[from](accent).text, CHIP_TONE[to](accent).text, mix);
  if (arrive < 1 && (timed?.shimmer === null || timed?.shimmer === undefined)) fill = lerpColor(PILL.muted, fill, arrive);
  const bold = to === "current";
  return pill([
    span(`${to === "current" ? glyphs.bolt : glyphs.recentBolt} `, { fg: text, bg: fill }),
    ...litText(chip.id, { fg: text, bg: fill, bold }, timed?.shimmer ?? (to === "current" && arrive >= 1 ? sweep : null)),
  ], fill, glyphs);
};

const mutedPill = (text, glyphs) => pill([span(text, { fg: PALETTE.dim, bg: PILL.muted })], PILL.muted, glyphs);

const chipsRow = (model, sample, { inner, glyphs, accent }) => {
  const chips = model.skills;
  if (chips.length === 0) {
    if (!model.idle && model.next && !model.workflow?.next) return fitRow([span("▸ ", { fg: accent }), span(truncateToWidth(model.next, inner - 2), { fg: PALETTE.white })], inner);
    if (!model.idle) return fitRow([span("no LitFamily skill yet in this request", { fg: PALETTE.dim })], inner);
    const hints = [
      [span("no LitFamily skill yet · type ", { fg: PALETTE.dim }), span("lit <task>", { fg: accent }), span(" to start one", { fg: PALETTE.dim })],
      [span("no skill yet · type ", { fg: PALETTE.dim }), span("lit <task>", { fg: accent })],
      [span("type ", { fg: PALETTE.dim }), span("lit <task>", { fg: accent })],
    ];
    return fitRow(hints.find((hint) => rowWidth(hint) <= inner) ?? hints.at(-1), inner);
  }
  const row = inner >= 30 ? [span("skills", { fg: PALETTE.dim })] : [];
  let shown = 0;
  for (const chip of chips) {
    // While LitClaude works the light that crosses the active phase crosses this request's chips too.
    const entry = chipSpans(chip, sample.chips?.[chip.id], glyphs, accent, model.idle ? null : sample.ambient?.sweep ?? null);
    const gap = row.length ? [span(" ")] : [];
    const rest = chips.length - shown - 1;
    const reserve = rest > 0 ? 1 + rowWidth(mutedPill(`+${rest}`, glyphs)) : 0;
    if (rowWidth(row) + rowWidth(gap) + rowWidth(entry) + reserve > inner) break;
    row.push(...gap, ...entry);
    shown += 1;
  }
  if (shown < chips.length) row.push(...(row.length ? [span(" ")] : []), ...mutedPill(`+${chips.length - shown}`, glyphs));
  return fitRow(row, inner);
};

const noticeRow = (sample, inner) => {
  const { data, offset } = sample.notice;
  const tone = TONE[data.tone] ?? TONE.pink;
  return fitRow([
    span(" ".repeat(offset)),
    span("▎", { fg: tone.bar }),
    span(` ${tone.icon} ${data.title}`, { fg: tone.title, bold: true }),
    ...(data.detail ? [span(`  · ${data.detail}`, { fg: PALETTE.dim })] : []),
  ], inner);
};

const SPARKS = [".", "+", "*"];

const completionRow = (sample, inner) => {
  const completion = sample.completion;
  const glow = completion.embers === null ? 0 : 0.6 * Math.sin(Math.PI * completion.embers);
  const words = [
    span("COMPLETE", { fg: lerpColor(lerpColor(PALETTE.dim, PALETTE.white, completion.title), PALETTE.pinkText, glow), bold: true }),
    span(` · ${completion.data.detail}`, { fg: lerpColor(PALETTE.dim, PALETTE.green, completion.detail) }),
  ];
  const row = [];
  if (completion.embers !== null) {
    const count = Math.max(0, Math.min(18, Math.floor((inner - rowWidth(words) - 2) / 2)));
    for (let i = 0; i < count; i += 1) {
      const life = Math.min(1, Math.max(0, completion.embers * 1.6 - i * 0.04));
      const alpha = life <= 0 || life >= 1 ? 0 : Math.sin(life * Math.PI);
      const glyph = alpha < 0.05 ? " " : SPARKS[Math.min(2, Math.floor(alpha * 3))];
      row.push(span(glyph, { fg: lerpColor(PALETTE.faint, i % 3 ? PALETTE.pink : PALETTE.amber, alpha) }), span(" "));
    }
    row.push(span("  "));
  } else {
    row.push(span("✦ ", { fg: PALETTE.pink }));
  }
  return fitRow([...row, ...words], inner);
};

const levelColor = (percent) => (percent >= 90 ? HUD.red : percent >= 70 ? HUD.yellow : HUD.green);

// ╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · 1w 12% · git main ───╯, or a warning first when one is up. The branch goes
// first on a narrow card, then the weekly window, the five-hour one and the context bar.
const bottomEdge = (model, sample, { width, glyphs, accent, edge }) => {
  const { context, rates, git } = model.figures;
  const warning = model.warnings[0];
  const segments = [];
  if (warning) {
    const color = warning.tone === "red" ? PALETTE.red : PALETTE.amber;
    segments.push(segment("warning", 0, [span(`${warning.tone === "red" ? glyphs.fail : "⚠"} ${warning.subject}`, { fg: color, bold: true }), span(` ${warning.text}`, { fg: color })], " · "));
  }
  if (context !== null) {
    segments.push(segment("ctx", 1, [span("ctx ", { fg: PALETTE.dim }), span(`${context}%`, { fg: accent })], " · "));
    const filled = Math.max(0, Math.min(5, Math.round(context / 20)));
    segments.push(segment("ctxbar", 2, [span("▰".repeat(filled), { fg: accent }), span("▱".repeat(5 - filled), { fg: HUD.empty })], " "));
  }
  rates.forEach((rate, index) => segments.push(segment(`rate-${rate.label}`, 3 + index * 0.5, [span(`${rate.label} `, { fg: PALETTE.dim }), span(`${rate.percent}%`, { fg: levelColor(rate.percent) })], " · ")));
  if (git) segments.push(segment("git", 4, [span(`${glyphs.branch} `, { fg: PALETTE.dim }), span(git, { fg: accent })], " · "));
  const room = width - textWidth("╰─ ") - 1 - 1 - textWidth("─╯");
  let kept = fitJoined(segments, room);
  if (kept[0]?.id === "ctxbar") kept = kept.slice(1);
  if (kept.length === 0 && warning) kept = [{ ...segments[0], spans: clipRow(segments[0].spans, room) }];
  return edgeRow("╰─ ", joinSegments(kept, edge), [], "─╯", width, edge, cometOn(sample, "bottom", width));
};

// The border: red or amber under a warning, otherwise the accent. Idle it is a calm, dim accent;
// while LitClaude works it sits a step above the accent and breathes brighter toward white with the
// brand pill.
const edgeColor = (model, sample, accent) => {
  if (model.warnings.some(({ tone }) => tone === "red")) return PALETTE.red;
  if (model.warnings.length) return PALETTE.amber;
  if (model.idle) return lerpColor(PALETTE.faint, accent, 0.35);
  return lerpColor(accent, "#ffffff", 0.15 + 0.3 * (sample.ambient?.breath ?? 0));
};

/**
 * The card for one frame: `{ mode: "card", border, width, rows }`, always five rows (top edge,
 * workflow map or phase track, detail line, chips row, bottom edge), each exactly `width` cells:
 * the terminal's columns up to CARD_MAX. `accent` is the status line's accent colour
 * (settings.mjs accentFromSettings).
 */
export const composeBand = (model, sample, { columns, glyphs: glyphMode = "basic", accent = PALETTE.accent }) => {
  const glyphs = glyphSet(glyphMode);
  const width = Math.max(12, Math.min(CARD_MAX, columns));
  const inner = width - 4;
  const edge = edgeColor(model, sample, accent);
  const side = (row) => [span("│ ", { fg: edge }), ...row, span(" │", { fg: edge })];
  const options = { width, inner, glyphs, accent, edge };
  const middle = sample.completion ? completionRow(sample, inner) : sample.notice ? noticeRow(sample, inner) : chipsRow(model, sample, options);
  return {
    mode: "card",
    border: edge,
    width,
    rows: [
      topEdge(model, sample, options),
      side(model.workflow ? mapRow(model, sample, options) : phaseRow(model, sample, options)),
      side(detailRow(model, sample, options)),
      side(middle),
      bottomEdge(model, sample, options),
    ],
  };
};

const GATE_STYLE = Object.freeze({
  ok: (glyphs) => ({ glyph: glyphs.done, fg: PALETTE.green }),
  pending: () => ({ glyph: "…", fg: PALETTE.amber }),
  fail: (glyphs) => ({ glyph: glyphs.fail, fg: PALETTE.red }),
});

const gateEntries = (gates, glyphs) => gates.map((gate) => {
  const style = GATE_STYLE[gate.state](glyphs);
  return [span(style.glyph, { fg: style.fg }), span(` ${gate.label}`, { fg: PALETTE.dim })];
});

/** Rows for the evidence pane's tab (`goal`, `lanes` or `gates`), fitted to `columns`. */
export const composeEvidence = (evidence, tab, { columns, glyphs: glyphMode = "basic" }) => {
  const glyphs = glyphSet(glyphMode);
  const rows = [];
  const line = (...parts) => rows.push(clipRow(parts, columns));
  if (tab === "lanes") {
    if (evidence.lanes.length === 0) line(span("No subagents in this session.", { fg: PALETTE.dim }));
    for (const lane of evidence.lanes) {
      const color = lane.status === "failed" ? PALETTE.red : lane.status === "running" ? PALETTE.green : PALETTE.dim;
      line(span(`${lane.status === "failed" ? glyphs.fail : glyphs.lane} `, { fg: color }), span(lane.name, { fg: PALETTE.white }), span(`  ${lane.type} · ${lane.status}${lane.quiet ? ` · quiet ${lane.quiet}` : ""}`, { fg: PALETTE.dim }));
    }
    return rows;
  }
  if (tab === "gates") {
    if (evidence.work) line(span("plan  ", { fg: PALETTE.dim }), span(`${evidence.work.plan ?? "plan"} · ${evidence.work.done}/${evidence.work.total}`, { fg: PALETTE.white }));
    if (evidence.gates.length === 0) line(span("No gate is armed in this session.", { fg: PALETTE.dim }));
    for (const entry of gateEntries(evidence.gates, glyphs)) line(...entry);
    if (evidence.icons) line(span("icons ", { fg: PALETTE.dim }), span(evidence.icons, { fg: PALETTE.dim }));
    return rows;
  }
  const goal = evidence.goal;
  if (!goal) {
    line(span("No litgoal goal in this project for this session.", { fg: PALETTE.dim }));
  } else {
    line(span("goal  ", { fg: PALETTE.dim }), span(goal.objective, { fg: PALETTE.white, bold: true }), span(`  ${goal.status}`, { fg: PALETTE.dim }));
    line(span(""));
    for (const criterion of goal.criteria) {
      const mark = criterion.status === "pass" ? [glyphs.done, PALETTE.green] : criterion.status === "fail" || criterion.status === "blocked" ? [glyphs.fail, PALETTE.red] : ["·", PALETTE.faint];
      const tail = `  ${criterion.ago}`;
      const description = truncateToWidth(criterion.description, Math.max(8, columns - textWidth(criterion.id) - textWidth(tail) - 5));
      line(span(`${mark[0]} `, { fg: mark[1] }), span(criterion.id, { fg: PALETTE.white }), span(`  ${description}`, { fg: PALETTE.dim }), span(tail, { fg: PALETTE.dim }));
    }
    for (const blocker of goal.blockers) line(span(`${glyphs.flag} `, { fg: PALETTE.amber }), span(blocker, { fg: PALETTE.amber }));
    if (goal.reviewBlocked) line(span(`${glyphs.flag} `, { fg: PALETTE.amber }), span("review: blocked", { fg: PALETTE.amber }));
  }
  if (evidence.timeline.length) {
    line(span(""));
    for (const entry of evidence.timeline) {
      const color = entry.event.startsWith("evidence") ? PALETTE.accent : entry.event.startsWith("checkpoint") ? PALETTE.violet : PALETTE.green;
      line(span(entry.ago.padEnd(10), { fg: PALETTE.dim }), span(entry.event.padEnd(20), { fg: color }), span(entry.detail, { fg: PALETTE.dim }));
    }
  }
  return rows;
};
