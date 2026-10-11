// Turns a band model and one sampled frame into rows of coloured spans. A span is
// { text, fg?, bg?, bold? }; the surface module draws each row as a line of Text elements. Every
// row is fitted to the width it is given, counting Hangul and emoji as two cells, so nothing wraps.
//
// In a real Claude Code 2.1.292 terminal, a row whose only change is a non-ASCII glyph (a block,
// symbol, Hangul or Nerd Font cell) keeps showing the old glyph; a change to ASCII text, or to the
// colour of an ASCII cell, repaints. So every change is carried by ASCII: a bar cell is a space on
// its colour and the leading cell fades in by colour, embers are ASCII sparks, labels pop in letter
// by letter, a notice slides by its leading spaces, a glyph swaps only together with its words,
// and each gate state has its own label.

import { fitSegments, textWidth, truncateToWidth } from "./layout.mjs";
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
  cardBorder: "#3a2a4a",
});

const BRAND_STOPS = Object.freeze([PALETTE.orange, PALETTE.pink, PALETTE.cyan]);
const PILL = Object.freeze({
  brand: { bg: PALETTE.pink, fg: "#12060c" },
  done: { bg: "#1d4d36", fg: "#b8f5cf" },
  now: { bg: "#0aa6c2", fg: "#001318" },
  todo: { bg: "#222a33", fg: "#8b949e" },
  warn: { bg: "#c27a0a", fg: "#1a0f00" },
});
const INK = Object.freeze({ done: PALETTE.green, now: PALETTE.accent, todo: PALETTE.dim, warn: PALETTE.amber });
const TONE = Object.freeze({
  pink: { bar: PALETTE.pink, title: PALETTE.pinkText, icon: "🔥" },
  amber: { bar: PALETTE.amber, title: PALETTE.amber, icon: "⚠" },
  red: { bar: PALETTE.red, title: PALETTE.red, icon: "✗" },
});
const LABELS = Object.freeze({ plan: "PLAN", work: "WORK", review: "REVIEW" });

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

// A label popping in: the first `reveal` share of its characters, and while ease-out-back carries
// the reveal past 1, a cell or two of extra padding so the pill visibly overshoots and settles.
export const revealText = (label, reveal) => {
  if (!(reveal > 0)) return null;
  const chars = [...label];
  const count = Math.max(1, Math.round(reveal * chars.length));
  return chars.slice(0, Math.min(count, chars.length)).join("") + " ".repeat(Math.max(0, count - chars.length));
};

const gradientSpans = (text, stops, { shimmer = null, bold = true } = {}) => {
  const chars = [...text];
  const visible = chars.filter((ch) => ch.trim()).length;
  let k = 0;
  return chars.map((ch) => {
    if (!ch.trim()) return span(ch);
    const position = visible <= 1 ? 0 : k / (visible - 1);
    k += 1;
    let fg = gradientAt(stops, position);
    if (shimmer !== null && Math.abs(position - shimmer) < 0.18) fg = lerpColor(fg, "#ffffff", (1 - Math.abs(position - shimmer) / 0.18) * 0.75);
    return span(ch, { fg, bold });
  });
};

const pillSpans = (text, colors, glyphs, bold = true) => [
  ...(glyphs.capLeft ? [span(glyphs.capLeft, { fg: colors.bg })] : []),
  span(text, { fg: colors.fg, bg: colors.bg, bold }),
  ...(glyphs.capRight ? [span(glyphs.capRight, { fg: colors.bg })] : []),
];

const mixColors = (a, b, t) => ({ bg: lerpColor(a.bg, b.bg, t), fg: lerpColor(a.fg, b.fg, t) });

// Colours of one phase in this frame: the crossfade from its previous state, then the amber mix for
// the work phase while the context warning is up.
const phaseColors = (id, sample, palette) => {
  const { from, to, mix } = sample.phases[id];
  let colors = palette === PILL ? mixColors(PILL[from], PILL[to], mix) : { fg: lerpColor(INK[from], INK[to], mix) };
  if (id === "work" && sample.warn > 0) colors = palette === PILL ? mixColors(colors, PILL.warn, sample.warn) : { fg: lerpColor(colors.fg, INK.warn, sample.warn) };
  return colors;
};

const phaseGlyph = (id, model, sample, glyphs) => {
  // The warning glyph swaps on the same frame the ASCII `ctx` text appears, so the row repaints.
  if (id === "work" && sample.warn > 0.02) return glyphs.warn;
  return glyphs[sample.phases[id].to] ?? glyphs.todo;
};

const countText = (model) => (model.progress ? ` ${model.progress.done}/${model.progress.total}` : "");

const brandSpans = (sample, glyphs, nerd) => {
  const shimmer = sample.completion?.shimmer ?? null;
  const reveal = revealText(nerd ? "🔥 LIT" : "(🔥 LIT)", sample.pills[0]);
  if (reveal === null) return [];
  if (!nerd) return gradientSpans(reveal, BRAND_STOPS, { shimmer });
  if (shimmer === null) return pillSpans(reveal, PILL.brand, glyphs);
  const lit = gradientSpans(reveal, [PILL.brand.fg, PILL.brand.fg], { shimmer }).map((part) => ({ ...part, bg: PILL.brand.bg }));
  return [span(glyphs.capLeft, { fg: PILL.brand.bg }), ...lit, span(glyphs.capRight, { fg: PILL.brand.bg })];
};

const barSegment = (model, sample, cells) => {
  if (!model.progress) return null;
  const bar = barCells(sample.fill, cells, sample.fillGlow ?? 0).map(({ glyph, color }) => (glyph === "█" ? span(" ", { bg: color }) : span(glyph, { fg: color })));
  return [
    ...bar,
    span("  "),
    span(String(model.progress.done), { fg: lerpColor(PALETTE.white, PALETTE.cyan, Math.max(sample.flash, sample.fillGlow ?? 0)), bold: true }),
    span(`/${model.progress.total}`, { fg: PALETTE.dim }),
  ];
};

const loopSegment = (model, glyphs, suffix = "") => (model.autoloop
  ? [span(`${glyphs.loop} ${model.autoloop.n}/${model.autoloop.max}`, { fg: PALETTE.violet }), span(` · ${formatDuration(model.autoloop.leftMs)}${suffix}`, { fg: PALETTE.dim })]
  : null);

const ctxSegment = (model, sample) => {
  const warning = model.ctxWarning;
  if (!warning || sample.warn <= 0.02) return null;
  return [span(`ctx ${warning.percent}% → ${warning.threshold}%`, { fg: lerpColor(PALETTE.dim, PALETTE.amber, sample.warn), bold: sample.warn > 0.5 })];
};

const lanesSegment = (model, glyphs) => {
  if (model.lanes.count === 0) return null;
  const dots = model.lanes.list.slice(0, 4).map((lane) => span(glyphs.lane, { fg: lane.status === "stalled" ? PALETTE.amber : PALETTE.green }));
  return [...dots, span(` ${model.lanes.count} ${model.lanes.count === 1 ? "lane" : "lanes"}`, { fg: PALETTE.dim })];
};

const segment = (id, priority, spans, extra = {}) => (spans && spans.length ? { id, priority, spans, width: rowWidth(spans), ...extra } : null);

const assemble = (kept, gap, fitted = {}) => {
  const row = [];
  kept.forEach((part, index) => {
    if (index > 0) row.push(span(" ".repeat(kept[index - 1].trailingSeparator && part.kind === "phase" ? 1 : gap)));
    let spans = part.spans;
    if (part.trailingSeparator && kept[index + 1]?.kind !== "phase") spans = spans.slice(0, -1);
    row.push(...(fitted[part.id] ? fitted[part.id](part.width) : spans));
  });
  return row;
};

const nextSegment = (model) => {
  if (!model.next) return null;
  const text = `▸ ${model.next}`;
  return segment("next", 4, [span(text, { fg: PALETTE.white })], { minWidth: Math.min(12, textWidth(text)) });
};

const ribbonRow = (model, sample, { columns, glyphs, nerd }) => {
  const segments = [segment("brand", 0, brandSpans(sample, glyphs, nerd))];
  ["plan", "work", "review"].forEach((id, index) => {
    const label = nerd
      ? `${phaseGlyph(id, model, sample, glyphs)} ${LABELS[id]}${id === "work" ? countText(model) : ""}`
      : `${LABELS[id]} ${phaseGlyph(id, model, sample, glyphs)}${id === "work" ? countText(model) : ""}`;
    const text = revealText(label, sample.pills[index + 1]);
    if (text === null) return;
    const colors = phaseColors(id, sample, nerd ? PILL : INK);
    const spans = nerd
      ? pillSpans(text, colors, glyphs, sample.phases[id].to !== "todo" || id === "work")
      : [span(text, { fg: colors.fg, bold: sample.phases[id].to === "now" || (id === "work" && sample.warn > 0.5) })];
    const separator = !nerd && id !== "review";
    segments.push(segment(id, id === "work" ? 0 : 3, separator ? [...spans, span(` ${glyphs.link}`, { fg: PALETTE.faint })] : spans, { kind: "phase", trailingSeparator: separator }));
  });
  if (sample.rest > 0) {
    const cells = columns >= 110 ? 10 : columns >= 80 ? 7 : 5;
    segments.push(segment("bar", 2, barSegment(model, sample, cells)));
    const ctx = ctxSegment(model, sample);
    segments.push(ctx ? segment("ctx", 1, ctx) : nextSegment(model));
    segments.push(segment("lanes", 5, lanesSegment(model, glyphs)));
    segments.push(segment("loop", 6, loopSegment(model, glyphs)));
  }
  const kept = fitSegments(segments.filter(Boolean), columns, 2);
  return assemble(kept, 2, { next: (width) => [span(truncateToWidth(`▸ ${model.next}`, width), { fg: PALETTE.white })] });
};

const noticeRow = (sample, columns) => {
  if (!sample.notice) return null;
  const { data, offset } = sample.notice;
  const tone = TONE[data.tone] ?? TONE.pink;
  const row = [
    span(" ".repeat(offset)),
    span("▎", { fg: tone.bar }),
    span(` ${tone.icon} ${data.title}`, { fg: tone.title, bold: true }),
    ...(data.detail ? [span(`  · ${data.detail}`, { fg: PALETTE.dim })] : []),
  ];
  return clipRow(row, columns);
};

const SPARKS = [".", "+", "*"];

const completionRow = (sample, columns) => {
  const completion = sample.completion;
  if (!completion) return null;
  const glow = completion.embers === null ? 0 : 0.6 * Math.sin(Math.PI * completion.embers);
  const words = [
    span("COMPLETE", { fg: lerpColor(lerpColor(PALETTE.dim, PALETTE.white, completion.title), PALETTE.pinkText, glow), bold: true }),
    span(` · ${completion.data.detail}`, { fg: lerpColor(PALETTE.dim, PALETTE.green, completion.detail) }),
  ];
  const row = [];
  if (completion.embers !== null) {
    const count = Math.max(0, Math.min(18, Math.floor((columns - rowWidth(words) - 2) / 2)));
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
  return clipRow([...row, ...words], columns);
};

const laneEntry = (lane, glyphs) => {
  const state = lane.status === "stalled"
    ? { glyph: glyphs.lane, fg: PALETTE.amber, word: "quiet" }
    : lane.status === "waiting" || lane.status === "idle"
      ? { glyph: glyphs.idleLane, fg: PALETTE.faint, word: "waiting" }
      : { glyph: glyphs.lane, fg: PALETTE.green, word: "working" };
  const elapsed = lane.elapsedMs === null ? "" : ` ${formatDuration(lane.elapsedMs)}`;
  return [span(state.glyph, { fg: state.fg }), span(` ${lane.name}`, { fg: PALETTE.white }), span(`  ${state.word}${elapsed}`, { fg: PALETTE.dim })];
};

const listRow = (label, entries, columns) => {
  const row = [span(`${label} `, { fg: PALETTE.dim })];
  let shown = 0;
  for (const entry of entries) {
    const gap = shown > 0 ? [span("    ")] : [];
    const rest = entries.length - shown - 1;
    const reserve = rest > 0 ? textWidth(`  +${rest}`) : 0;
    if (rowWidth(row) + rowWidth(gap) + rowWidth(entry) + reserve > columns) break;
    row.push(...gap, ...entry);
    shown += 1;
  }
  if (shown < entries.length) row.push(span(`  +${entries.length - shown}`, { fg: PALETTE.dim }));
  return clipRow(row, columns);
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

const warningRow = (warning, glyphs, columns) => {
  const color = warning.tone === "red" ? PALETTE.red : PALETTE.amber;
  return clipRow([
    span(warning.tone === "red" ? glyphs.fail : "⚠", { fg: color }),
    span(` ${warning.subject}`, { fg: PALETTE.white }),
    span(` ${warning.text}`, { fg: color }),
    span(` — ${warning.hint}`, { fg: PALETTE.dim }),
  ], columns);
};

const phaseLine = (model, sample, { columns, glyphs }) => {
  const railLength = columns >= 100 ? 6 : columns >= 80 ? 3 : 1;
  const segments = [segment("brand", 0, sample.pills[0] > 0 ? gradientSpans(revealText("🔥 L I T", sample.pills[0]), BRAND_STOPS, { shimmer: sample.completion?.shimmer ?? null }) : [])];
  const phaseSpans = [];
  ["plan", "work", "review"].forEach((id, index) => {
    const text = revealText(`${phaseGlyph(id, model, sample, glyphs)} ${LABELS[id]}`, sample.pills[index + 1]);
    if (text === null) return;
    const colors = phaseColors(id, sample, INK);
    if (phaseSpans.length) {
      const leftDone = sample.phases[["plan", "work", "review"][index - 1]].to === "done";
      phaseSpans.push(span(` ${glyphs.rail.repeat(railLength)} `, { fg: leftDone ? PALETTE.green : PALETTE.faint }));
    }
    phaseSpans.push(span(text, { fg: colors.fg, bold: sample.phases[id].to === "now" }));
  });
  segments.push(segment("phases", 1, phaseSpans));
  if (sample.rest > 0) {
    segments.push(segment("bar", 2, barSegment(model, sample, columns >= 90 ? 14 : 8)));
    segments.push(segment("ctx", 1, ctxSegment(model, sample)));
    segments.push(segment("loop", 4, loopSegment(model, glyphs, " left")));
  }
  return assemble(fitSegments(segments.filter(Boolean), columns, 3), 3);
};

/**
 * The whole band for one frame: `{ mode, border, rows }`. `mode` is `card` (a round-bordered box,
 * `columns` minus its border and padding inside) when two or more lanes run or a warning needs a
 * row of its own, else `ribbon`.
 */
export const composeBand = (model, sample, { columns, glyphs: glyphMode = "basic" }) => {
  const glyphs = glyphSet(glyphMode);
  const nerd = glyphMode === "nerd";
  const extras = [noticeRow(sample, columns), completionRow(sample, columns)].filter(Boolean);
  if (!model.card) {
    return { mode: "ribbon", border: null, rows: [ribbonRow(model, sample, { columns, glyphs, nerd }), ...extras] };
  }
  const inner = Math.max(10, columns - 4);
  const rows = [phaseLine(model, sample, { columns: inner, glyphs })];
  if (sample.rest > 0) {
    if (model.next) rows.push(clipRow([span("next  ", { fg: PALETTE.dim }), span(truncateToWidth(model.next, inner - 6), { fg: PALETTE.white })], inner));
    if (model.lanes.count > 0) rows.push(listRow("lanes", model.lanes.list.map((lane) => laneEntry(lane, glyphs)), inner));
    if (model.gates.length > 0) rows.push(listRow("gates", gateEntries(model.gates, glyphs), inner));
    for (const warning of model.warnings) rows.push(warningRow(warning, glyphs, inner));
  }
  rows.push(...[noticeRow(sample, inner), completionRow(sample, inner)].filter(Boolean));
  const border = model.warnings.some(({ tone }) => tone === "red") ? PALETTE.red : model.warnings.length ? PALETTE.amber : PALETTE.cardBorder;
  return { mode: "card", border, rows };
};

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
