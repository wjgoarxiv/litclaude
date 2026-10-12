// Turns a band model and one sampled frame into the LIT card: four rows of coloured spans. A span is
// { text, fg?, bg?, bold? }; the surface module draws each row as a line of Text elements. The card
// draws its own rounded border so the top edge can carry the title and the bottom edge the live
// figures, and every row is fitted to exactly the card's width, counting Hangul and emoji as two
// cells, so nothing wraps and the card keeps its height whether LitClaude is working or idle.
//
//   ╭─ [🔥 LIT] · lit-loop ─────────────────────────── WORK ● ─╮
//   │ ● PLAN ━━ [WORK] ━━ ○ REVIEW              goal ██░░░ 2/5 │
//   │ skills [⚡ lit-plan] [⚡ litresearch] [↯ lit-docx]        │
//   ╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · git main ──────────────────────╯
//
// Each bracket pair stands for the two end cells of a filled pill: the brand on pink, the active
// phase and this request's skills on the accent with dark text, skills from earlier requests on
// dark grey. Those end cells are rounded Nerd Font caps in the pill's colour, or one cell of
// padding in that colour with basic glyphs, so a pill is as wide in either glyph set.
//
// In a real Claude Code 2.1.292 terminal, a row whose only change is a non-ASCII glyph (a block,
// symbol, Hangul or Nerd Font cell) keeps showing the old glyph; a change to ASCII text, or to the
// colour of an ASCII cell, repaints. So every change is carried by ASCII: a bar cell is a space on
// its colour and the leading cell fades in by colour, embers are ASCII sparks, labels pop in letter
// by letter, a notice slides by its leading spaces, a chip's light moves over its ASCII name, and a
// glyph swaps only together with the colour of its words.

import { textWidth, truncateToWidth } from "./layout.mjs";
import { barCells, lerpColor } from "./motion.mjs";
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
export const CARD_MAX = 80;
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

// An edge of the card: `open` and `close` are its corners, `left` its title or figures and
// `right` the phase indicator, with the rule filling whatever room is left.
const edgeRow = (open, left, right, close, width, color) => {
  const tail = right.length ? [span(" "), ...right, span(` ${close}`, { fg: color })] : [span(close, { fg: color })];
  const fill = Math.max(1, width - textWidth(open) - rowWidth(left) - 1 - rowWidth(tail));
  return clipRow([span(open, { fg: color }), ...left, span(" "), span("─".repeat(fill), { fg: color }), ...tail], width);
};

const brandSpans = (sample, glyphs) => {
  const reveal = revealText("🔥 LIT", sample.pills[0]);
  if (reveal === null) return [];
  return pill(litText(reveal, { fg: PILL.ink, bg: PILL.brand, bold: true }, sample.completion?.shimmer ?? null), PILL.brand, glyphs);
};
const indicatorSpans = (model, sample, glyphs, accent) => {
  if (sample.completion) return [span(`DONE ${glyphs.done}`, { fg: PALETTE.green, bold: true })];
  if (model.idle) return [span("idle", { fg: PALETTE.dim })];
  const current = PHASES.find((id) => model.phases[id] === "now");
  if (current) return [span(`${LABELS[current]} ${warned(current, sample) ? glyphs.warn : glyphs.now}`, { fg: phaseColor(current, sample, inkOf(accent)), bold: true })];
  if (PHASES.every((id) => model.phases[id] === "done")) return [span(`DONE ${glyphs.done}`, { fg: PALETTE.green, bold: true })];
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
  if (withRight <= width) return edgeRow("╭─ ", [...brand, ...title(name)], right, "─╮", width, edge);
  const room = width - fixed - textWidth("─╮") - textWidth(" · ");
  const shown = room >= 4 ? truncateToWidth(name, room) : "";
  return edgeRow("╭─ ", [...brand, ...title(shown)], [], "─╮", width, edge);
};

const barSpans = (fraction, sample, cells) => barCells(fraction, cells, sample.fillGlow ?? 0)
  .map(({ glyph, color }) => (glyph === "█" ? span(" ", { bg: color }) : span(glyph, { fg: color })));

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
      out.push(...pill([span(shown.slice(0, label.length).padEnd(label.length), { fg: PILL.ink, bg: fill, bold: true })], fill, glyphs));
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
      const dots = model.lanes.list.slice(0, 4).map((lane) => span(glyphs.lane, { fg: lane.status === "stalled" ? PALETTE.amber : PALETTE.green }));
      right.push(segment("lanes", 3, [...dots, span(` ${model.lanes.count} ${model.lanes.count === 1 ? "lane" : "lanes"}`, { fg: PALETTE.dim })]));
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

const CHIP_TONE = Object.freeze({
  current: (accent) => ({ fill: accent, text: PILL.ink }),
  recent: () => ({ fill: PILL.muted, text: PILL.mutedText }),
});

// One chip pill: the bolt and the skill name, on the accent for this request or muted for an
// earlier one. A chip that just arrived carries full motion's light along its name, or fills up
// from the muted pill under subtle; a chip changing state crossfades its colours.
const chipSpans = (chip, timed, glyphs, accent) => {
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
    ...litText(chip.id, { fg: text, bg: fill, bold }, timed?.shimmer),
  ], fill, glyphs);
};

const mutedPill = (text, glyphs) => pill([span(text, { fg: PALETTE.dim, bg: PILL.muted })], PILL.muted, glyphs);

const chipsRow = (model, sample, { inner, glyphs, accent }) => {
  const chips = model.skills;
  if (chips.length === 0) {
    if (!model.idle && model.next) return fitRow([span("▸ ", { fg: accent }), span(truncateToWidth(model.next, inner - 2), { fg: PALETTE.white })], inner);
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
    const entry = chipSpans(chip, sample.chips?.[chip.id], glyphs, accent);
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

// ╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · git main ───╯, or a warning first when one is up. The branch goes
// first on a narrow card, then the rate window, then the context bar.
const bottomEdge = (model, { width, glyphs, accent, edge }) => {
  const { context, rate, git } = model.figures;
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
  if (rate) segments.push(segment("rate", 3, [span(`${rate.label} `, { fg: PALETTE.dim }), span(`${rate.percent}%`, { fg: levelColor(rate.percent) })], " · "));
  if (git) segments.push(segment("git", 4, [span(`${glyphs.branch} `, { fg: PALETTE.dim }), span(git, { fg: accent })], " · "));
  const room = width - textWidth("╰─ ") - 1 - 1 - textWidth("─╯");
  let kept = fitJoined(segments, room);
  if (kept[0]?.id === "ctxbar") kept = kept.slice(1);
  if (kept.length === 0 && warning) kept = [{ ...segments[0], spans: clipRow(segments[0].spans, room) }];
  return edgeRow("╰─ ", joinSegments(kept, edge), [], "─╯", width, edge);
};

const edgeColor = (model, accent) => {
  if (model.warnings.some(({ tone }) => tone === "red")) return PALETTE.red;
  if (model.warnings.length) return PALETTE.amber;
  return lerpColor(PALETTE.faint, accent, model.idle ? 0.35 : 0.6);
};

/**
 * The card for one frame: `{ mode: "card", border, width, rows }`, always four rows (top edge,
 * phase row, chips row, bottom edge), each exactly `width` cells: the terminal's columns up to
 * CARD_MAX. `accent` is the status line's accent colour (settings.mjs accentFromSettings).
 */
export const composeBand = (model, sample, { columns, glyphs: glyphMode = "basic", accent = PALETTE.accent }) => {
  const glyphs = glyphSet(glyphMode);
  const width = Math.max(12, Math.min(CARD_MAX, columns));
  const inner = width - 4;
  const edge = edgeColor(model, accent);
  const side = (row) => [span("│ ", { fg: edge }), ...row, span(" │", { fg: edge })];
  const options = { width, inner, glyphs, accent, edge };
  const middle = sample.completion ? completionRow(sample, inner) : sample.notice ? noticeRow(sample, inner) : chipsRow(model, sample, options);
  return {
    mode: "card",
    border: edge,
    width,
    rows: [topEdge(model, sample, options), side(phaseRow(model, sample, options)), side(middle), bottomEdge(model, options)],
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
