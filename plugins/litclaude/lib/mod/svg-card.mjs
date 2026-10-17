// The LIT card as one SVG drawing, for the surfaces that are not a terminal grid. The Claude desktop
// app draws a mod's Text in a proportional font and cuts each span to the cells it was given, so the
// terminal card's text border and its padded pills come apart there. Those surfaces carry an `Svg`
// element instead, and this module draws the same card into it: the brand pill, the discipline and
// the stage indicator on top, the workflow map (or the phase track and progress when no family
// places the session), the detail line with the live step, the skill chips (or the notice or the
// finish), and the live figures at the bottom.
//
// It draws the settled state of the model; the terminal's entrances and crossfades stay terminal
// only. While LitClaude works and motion allows, SMIL animation in the drawing keeps it moving: the
// brand pill and the border breathe (full and subtle), a light crosses the current stage and this
// request's chips, a bright head runs along the rail leaving the current stage, the count bar's
// head shimmers, the step spinner turns and a comet runs around the border (full only). Idle, it is
// still. The drawing carries no step clock and no loop countdown: the surface loads each new
// drawing afresh, restarting every animation, so a figure that moves with time alone would make the
// card blink on every poll.
//
// Text is set in a monospace face and placed by counted cells (Hangul and emoji as two), so the
// layout does not depend on measuring a font the drawing cannot see.

import { textWidth, truncateToWidth } from "./layout.mjs";
import { TIMINGS, barCells, gradientAt } from "./motion.mjs";

const C = Object.freeze({
  bg: "#0d1117",
  pink: "#ff2d95",
  orange: "#ff6337",
  green: "#6bdb8f",
  amber: "#ffaf3c",
  red: "#ff5f5f",
  violet: "#b48cff",
  white: "#e6edf3",
  dim: "#7d8590",
  faint: "#30363d",
  rail: "#46505c",
  ink: "#0b0f14",
  muted: "#2d333b",
  mutedText: "#adb5bf",
  empty: "#3a3f47",
  hudGreen: "#5faf5f",
  hudYellow: "#d7af00",
  hudRed: "#d75f5f",
});
const LABELS = Object.freeze({ plan: "PLAN", work: "WORK", review: "REVIEW" });
const PHASES = Object.freeze(["plan", "work", "review"]);

// Drawing units: CSS pixels at the card's natural size; the surface draws it at that width, up to its slot.
export const SVG_CARD = Object.freeze({ width: 880, height: 160, font: 13, cell: 7.8, pad: 18 });
const ROW_Y = Object.freeze([28, 58, 86, 114, 142]);
const PILL_H = 20;
const FONT = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'JetBrains Mono', Consolas, monospace";

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const widthOf = (text) => textWidth(text) * SVG_CARD.cell;
const levelColor = (percent) => (percent >= 90 ? C.hudRed : percent >= 70 ? C.hudYellow : C.hudGreen);

// Edge spaces become offsets: an SVG text element drops leading and trailing whitespace.
const text = (x, y, body, { fill = C.white, bold = false, anchor = "start" } = {}) => {
  const lead = String(body).length - String(body).trimStart().length;
  const trimmed = String(body).trim();
  if (!trimmed) return "";
  const at = anchor === "start" ? x + lead * SVG_CARD.cell : x;
  return `<text x="${at.toFixed(1)}" y="${y}" fill="${fill}"${bold ? ' font-weight="700"' : ""}${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${esc(trimmed)}</text>`;
};

// A run of coloured pieces on one baseline, left to right from `x`; returns the markup and where it ends.
const run = (x, y, pieces) => {
  let at = x;
  const out = pieces.map(([body, style]) => {
    const markup = text(at, y, body, style);
    at += widthOf(body);
    return markup;
  });
  return { markup: out.join(""), end: at };
};

// A filled pill holding `label`, its left edge at `x`. `sweep` lays the moving light over it.
const pill = (x, y, label, { fill, ink, bold = true, sweep = false, breath = null, breathPeak = 0.85 }) => {
  const w = widthOf(label) + 16;
  const top = y - PILL_H + 6;
  const parts = [`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${fill}"/>`];
  if (breath) parts.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${breath}" opacity="0"><animate attributeName="opacity" values="0;${breathPeak};0" dur="${TIMINGS.breath}ms" repeatCount="indefinite"/></rect>`);
  if (sweep) parts.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="url(#lit-sweep)"/>`);
  parts.push(text(x + 8, y, label, { fill: ink, bold }));
  return { markup: parts.join(""), end: x + w };
};

const indicatorOf = (model, accent) => {
  if (model.completion) return { label: "DONE ✓", fill: C.green };
  if (model.idle) return { label: "idle", fill: C.dim, plain: true };
  const flow = model.workflow;
  if (flow && flow.current >= 0) return { label: `${flow.stages[flow.current].id.toUpperCase()} ●`, fill: model.ctxWarning ? C.amber : accent };
  if (flow && model.lanes.count === 0) return { label: "DONE ✓", fill: C.green };
  const current = PHASES.find((id) => model.phases[id] === "now");
  if (current) return { label: `${LABELS[current]} ●`, fill: model.ctxWarning && current === "work" ? C.amber : accent };
  if (PHASES.every((id) => model.phases[id] === "done") && model.lanes.count === 0) return { label: "DONE ✓", fill: C.green };
  return { label: "LIVE ●", fill: accent };
};

const topRow = (model, accent, animate) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[0];
  const brand = pill(pad, y, "🔥 LIT", { fill: C.pink, ink: C.ink, breath: animate.breath ? C.orange : null });
  const indicator = indicatorOf(model, accent);
  const right = text(width - pad, y, indicator.label, { fill: indicator.fill, bold: !indicator.plain, anchor: "end" });
  const room = width - pad - widthOf(indicator.label) - 16 - brand.end - widthOf(" · ");
  const name = truncateToWidth(model.title ?? "ready", Math.max(4, Math.floor(room / SVG_CARD.cell)));
  const title = run(brand.end + 4, y, [[" · ", { fill: C.dim }], [name, model.idle ? { fill: C.dim } : { fill: accent, bold: true }]]);
  return brand.markup + title.markup + right;
};

const rightOfPhases = (model, withProgress = true) => {
  const pieces = [];
  if (model.ctxWarning) pieces.push([[`ctx ${model.ctxWarning.percent}% → ${model.ctxWarning.threshold}%`, { fill: C.amber, bold: true }]]);
  if (model.lanes.count > 0) pieces.push([[`● ${model.lanes.count} ${model.lanes.count === 1 ? "lane" : "lanes"}`, { fill: C.green }]]);
  if (model.autoloop) pieces.push([[`↻ ${model.autoloop.n}/${model.autoloop.max}`, { fill: C.violet }]]);
  if (!withProgress) return pieces;
  if (model.progress) {
    pieces.push([[`${model.progress.unit === "tasks" ? "tasks" : "goal"} `, { fill: C.dim }], [`${model.progress.done}`, { fill: C.white, bold: true }], [`/${model.progress.total}`, { fill: C.dim }]]);
  } else if (model.goal) {
    const met = model.goal.status === "complete";
    pieces.push([["goal ", { fill: C.dim }], [`${met ? "✓ " : ""}${model.goal.passed}/${model.goal.total}`, { fill: met ? C.green : C.white, bold: met }]]);
  }
  return pieces;
};

// ● PLAN ── [WORK] ── ○ REVIEW on the left, the lanes, loop and progress figures on the right.
const phaseRow = (model, accent, animate) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[1];
  const out = [];
  let x = pad;
  PHASES.forEach((id, index) => {
    const state = model.phases[id];
    if (index > 0) {
      const done = model.phases[PHASES[index - 1]] === "done";
      out.push(`<line x1="${(x + 6).toFixed(1)}" y1="${y - 4}" x2="${(x + 34).toFixed(1)}" y2="${y - 4}" stroke="${done ? accent : C.rail}" stroke-width="2" stroke-linecap="round"${done ? ' stroke-opacity="0.6"' : ""}/>`);
      x += 40;
    }
    if (state === "now") {
      const fill = model.idle ? C.muted : model.ctxWarning && id === "work" ? C.amber : accent;
      const drawn = pill(x, y, LABELS[id], { fill, ink: model.idle ? C.mutedText : C.ink, sweep: animate.sweep });
      out.push(drawn.markup);
      x = drawn.end;
    } else {
      const color = state === "done" ? accent : C.dim;
      out.push(`<circle cx="${(x + 5).toFixed(1)}" cy="${y - 4}" r="4.5" ${state === "done" ? `fill="${color}" fill-opacity="0.7"` : `fill="none" stroke="${color}" stroke-width="1.5"`}/>`);
      out.push(text(x + 15, y, LABELS[id], { fill: color }));
      x += 15 + widthOf(LABELS[id]);
    }
  });
  // Joined right-aligned; the leftmost group goes first when the row is short of room.
  let groups = rightOfPhases(model);
  const joined = (list) => list.flatMap((pieces, index) => (index > 0 ? [["  ·  ", { fill: C.faint }], ...pieces] : pieces));
  const spanOf = (pieces) => pieces.reduce((sum, [body]) => sum + widthOf(body), 0);
  while (groups.length && x + 24 + spanOf(joined(groups)) > width - pad) groups = groups.slice(1);
  if (groups.length) out.push(run(width - pad - spanOf(joined(groups)), y, joined(groups)).markup);
  return out.join("");
};

const mapColor = (accent, position) => gradientAt([C.orange, C.pink, accent], position);
const shortLabel = (label) => label.replace(/^[A-Za-z]+/u, (word) => word.slice(0, 3));

// Right-aligned groups after `x`, the leftmost dropped first when the row is short of room.
const rightGroups = (groups, x, y) => {
  const { width, pad } = SVG_CARD;
  const joined = (list) => list.flatMap((pieces, index) => (index > 0 ? [["  ·  ", { fill: C.faint }], ...pieces] : pieces));
  const spanOf = (pieces) => pieces.reduce((sum, [body]) => sum + widthOf(body), 0);
  let kept = groups;
  while (kept.length && x + 24 + spanOf(joined(kept)) > width - pad) kept = kept.slice(1);
  return kept.length ? run(width - pad - spanOf(joined(kept)), y, joined(kept)).markup : "";
};

// interview ✓ ━ plan ✓ ━ [work 3/7] ━ review · ─ done ·, with the lanes and budgets on the right.
const mapRowSvg = (model, accent, animate) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[1];
  const { stages, current, count } = model.workflow;
  const last = Math.max(1, stages.length - 1);
  const labelOf = (stage, short) => {
    const label = short ? shortLabel(stage.label) : stage.label;
    return stage.state === "now" ? label : `${label} ${stage.state === "done" ? "✓" : "·"}`;
  };
  const extent = ({ rail, short }) => stages.reduce((sum, stage) => sum + widthOf(labelOf(stage, short)) + (stage.state === "now" ? 16 : 0), 0) + (stages.length - 1) * (rail + 12);
  const layouts = [{ rail: 30, short: false }, { rail: 16, short: false }, { rail: 16, short: true }, { rail: 6, short: true }];
  const layout = layouts.find((candidate) => pad + extent(candidate) <= width - pad - 160) ?? layouts.at(-1);
  const out = [];
  let x = pad;
  stages.forEach((stage, index) => {
    if (index > 0) {
      const x1 = x + 6;
      const x2 = x + 6 + layout.rail;
      const mid = (index - 0.5) / last;
      if (stage.state !== "todo") {
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y - 4}" x2="${x2.toFixed(1)}" y2="${y - 4}" stroke="${mapColor(accent, mid)}" stroke-width="2.5" stroke-linecap="round"/>`);
      } else if (stages[index - 1].state === "now") {
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y - 4}" x2="${x2.toFixed(1)}" y2="${y - 4}" stroke="${C.rail}" stroke-width="2.5" stroke-linecap="round"/>`);
        const filled = count && count.total > 0 ? Math.min(1, count.done / count.total) : 0;
        if (filled > 0) out.push(`<line x1="${x1.toFixed(1)}" y1="${y - 4}" x2="${(x1 + filled * layout.rail).toFixed(1)}" y2="${y - 4}" stroke="${mapColor(accent, mid)}" stroke-width="2.5" stroke-linecap="round"/>`);
        if (animate.sweep) out.push(`<circle cx="${x1.toFixed(1)}" cy="${y - 4}" r="2.5" fill="#ffffff"><animate attributeName="cx" values="${x1.toFixed(1)};${x2.toFixed(1)}" dur="${TIMINGS.flow}ms" repeatCount="indefinite"/></circle>`);
      } else {
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y - 4}" x2="${x2.toFixed(1)}" y2="${y - 4}" stroke="${C.rail}" stroke-width="1.5" stroke-linecap="round" stroke-opacity="0.7"/>`);
      }
      x = x2 + 6;
    }
    const label = labelOf(stage, layout.short);
    if (stage.state === "now") {
      const fill = model.idle ? C.muted : model.ctxWarning ? C.amber : accent;
      const drawn = pill(x, y, label, { fill, ink: model.idle ? C.mutedText : C.ink, sweep: animate.sweep, breath: animate.breath ? "#ffffff" : null, breathPeak: 0.2 });
      out.push(drawn.markup);
      x = drawn.end;
    } else {
      out.push(text(x, y, label, { fill: stage.state === "done" ? mapColor(accent, index / last) : C.dim }));
      x += widthOf(label);
    }
  });
  out.push(rightGroups(rightOfPhases(model, false), x, y));
  return out.join("");
};

const VERDICT_FILL = Object.freeze({ pass: ["✓", C.green], fail: ["✗", C.red], pending: ["·", C.dim], running: ["●", C.amber] });

// └ task 3/7 ▮▮▮▯▯▯▯▯ · next ▸ <task> on the left, the spinner and the tool on the right.
const detailRowSvg = (model, accent, animate) => {
  const { width, pad, cell } = SVG_CARD;
  const y = ROW_Y[2];
  const flow = model.workflow;
  const out = [];
  let right = pad;
  if (model.step) {
    const nameEnd = width - pad;
    out.push(text(nameEnd, y, model.step.name, { fill: C.white, anchor: "end" }));
    const cx = nameEnd - widthOf(model.step.name) - 10;
    out.push(`<circle cx="${cx.toFixed(1)}" cy="${y - 4}" r="4.5" fill="none" stroke="${accent}" stroke-width="1.8" stroke-dasharray="18 10.3">`
      + (animate.breath ? `<animateTransform attributeName="transform" type="rotate" values="0 ${cx.toFixed(1)} ${y - 4};360 ${cx.toFixed(1)} ${y - 4}" dur="${TIMINGS.spin * 8}ms" repeatCount="indefinite"/>` : "")
      + "</circle>");
    right = width - cx + 10;
  }
  if (!flow) return out.join("");
  const room = width - pad - right - 16;
  out.push(text(pad, y, "└", { fill: C.dim }));
  let x = pad + widthOf("└ ");
  const sep = () => {
    out.push(text(x + 6, y, "·", { fill: C.faint }));
    x += 22;
  };
  if (flow.count) {
    const { done, total, unit } = flow.count;
    const drawn = run(x, y, [[`${unit} `, { fill: C.dim }], [String(done), { fill: C.white, bold: true }], [`/${total} `, { fill: C.dim }]]);
    out.push(drawn.markup);
    x = drawn.end;
    const cells = barCells(total > 0 ? done / total : 0, 8);
    cells.forEach(({ glyph, color }, index) => out.push(`<rect x="${(x + index * 9).toFixed(1)}" y="${y - 10}" width="7" height="10" rx="1.5" fill="${glyph === "█" ? color : C.empty}"/>`));
    const head = cells.findLastIndex(({ glyph }) => glyph === "█");
    if (head >= 0 && animate.sweep) out.push(`<rect x="${(x + head * 9).toFixed(1)}" y="${y - 10}" width="7" height="10" rx="1.5" fill="#ffffff" opacity="0"><animate attributeName="opacity" values="0;0.6;0" dur="${TIMINGS.breath}ms" repeatCount="indefinite"/></rect>`);
    x += 8 * 9 + 4;
  }
  const pieces = [];
  if (flow.verdicts) pieces.push(flow.verdicts.map(({ name, state }) => [`${name} ${VERDICT_FILL[state][0]} `, { fill: VERDICT_FILL[state][1] }]));
  for (const item of flow.items) pieces.push([[item, { fill: C.white }]]);
  for (const group of pieces) {
    const span = group.reduce((sum, [body]) => sum + widthOf(body), 0);
    if (x + 22 + span > pad + room) break;
    if (x > pad + widthOf("└ ")) sep();
    const drawn = run(x, y, group);
    out.push(drawn.markup);
    x = drawn.end;
  }
  if (flow.next) {
    const avail = Math.floor((pad + room - x - 22) / cell) - textWidth("next ▸ ");
    if (avail >= 6) {
      if (x > pad + widthOf("└ ")) sep();
      out.push(run(x, y, [["next ", { fill: C.dim }], ["▸ ", { fill: accent }], [truncateToWidth(flow.next, avail), { fill: C.white }]]).markup);
    }
  }
  return out.join("");
};

const TONES = Object.freeze({ pink: [C.pink, "#ff6fae", "🔥"], amber: [C.amber, C.amber, "⚠"], red: [C.red, C.red, "✗"] });

// Skill chips, or the notice or the finish while one is up, or the hint while nothing has fired.
const middleRow = (model, accent, animate) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[3];
  const room = width - pad;
  if (model.completion) {
    return run(pad, y, [["✦ ", { fill: C.pink }], ["COMPLETE", { fill: C.white, bold: true }], [` · ${model.completion.detail ?? ""}`, { fill: C.green }]]).markup;
  }
  if (model.notice) {
    const [bar, title, icon] = TONES[model.notice.tone] ?? TONES.pink;
    return `<rect x="${pad}" y="${y - 14}" width="3" height="18" rx="1.5" fill="${bar}"/>`
      + run(pad + 10, y, [[`${icon} ${model.notice.title}`, { fill: title, bold: true }], ...(model.notice.detail ? [[`  · ${model.notice.detail}`, { fill: C.dim }]] : [])]).markup;
  }
  if (model.skills.length === 0) {
    if (!model.idle && model.next && !model.workflow?.next) return run(pad, y, [["▸ ", { fill: accent }], [truncateToWidth(model.next, Math.floor((room - pad) / SVG_CARD.cell) - 2), { fill: C.white }]]).markup;
    if (!model.idle) return text(pad, y, "no LitFamily skill yet in this request", { fill: C.dim });
    return run(pad, y, [["no LitFamily skill yet · type ", { fill: C.dim }], ["lit <task>", { fill: accent }], [" to start one", { fill: C.dim }]]).markup;
  }
  const out = [text(pad, y, "skills", { fill: C.dim })];
  let x = pad + widthOf("skills") + 10;
  model.skills.forEach((chip, index) => {
    if (x === null) return;
    const current = chip.state === "current";
    const label = `${current ? "⚡" : "↯"} ${chip.id}`;
    const rest = model.skills.length - index - 1;
    const need = widthOf(label) + 16 + (rest > 0 ? widthOf(`+${rest}`) + 26 : 0);
    if (x + need > room) {
      out.push(pill(x, y, `+${model.skills.length - index}`, { fill: C.muted, ink: C.dim, bold: false }).markup);
      x = null;
      return;
    }
    const drawn = pill(x, y, label, { fill: current ? accent : C.muted, ink: current ? C.ink : C.mutedText, bold: current, sweep: current && animate.sweep });
    out.push(drawn.markup);
    x = drawn.end + 8;
  });
  return out.join("");
};

// ctx 42% ▰▰▱▱▱ · 5h 31% · 1w 12% · git main, after a warning when one is up.
const bottomRow = (model, accent) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[4];
  const groups = [];
  const warning = model.warnings[0];
  if (warning) {
    const color = warning.tone === "red" ? C.red : C.amber;
    groups.push({ pieces: [[`${warning.tone === "red" ? "✗" : "⚠"} ${warning.subject}`, { fill: color, bold: true }], [` ${warning.text}`, { fill: color }]] });
  }
  const { context, rates, git } = model.figures;
  if (context !== null) groups.push({ pieces: [["ctx ", { fill: C.dim }], [`${context}%`, { fill: accent }]], bar: context });
  for (const rate of rates) groups.push({ pieces: [[`${rate.label} `, { fill: C.dim }], [`${rate.percent}%`, { fill: levelColor(rate.percent) }]] });
  if (git) groups.push({ pieces: [["git ", { fill: C.dim }], [git, { fill: accent }]] });
  const out = [];
  let x = pad;
  groups.forEach((group, index) => {
    const span = group.pieces.reduce((sum, [body]) => sum + widthOf(body), 0) + (group.bar !== undefined ? 60 : 0);
    if (x + span + (index > 0 ? 24 : 0) > width - pad) return;
    if (index > 0) {
      out.push(text(x + 8, y, "·", { fill: C.faint }));
      x += 24;
    }
    const drawn = run(x, y, group.pieces);
    out.push(drawn.markup);
    x = drawn.end;
    if (group.bar !== undefined) {
      const filled = Math.max(0, Math.min(5, Math.round(group.bar / 20)));
      for (let i = 0; i < 5; i += 1) out.push(`<rect x="${(x + 8 + i * 10).toFixed(1)}" y="${y - 9}" width="7" height="8" rx="1.5" fill="${i < filled ? accent : C.empty}"/>`);
      x += 60;
    }
  });
  return out.join("");
};

const borderColor = (model, accent) => {
  if (model.warnings.some(({ tone }) => tone === "red")) return C.red;
  if (model.warnings.length) return C.amber;
  return model.idle ? C.faint : accent;
};

/** What the card says, for a reader that cannot see the drawing. */
export const svgCardAlt = (model) => {
  const parts = [`LIT ${model.idle ? "idle" : "working"}`];
  if (model.title) parts.push(model.title);
  const flow = model.workflow;
  const current = PHASES.find((id) => model.phases[id] === "now");
  if (flow) {
    const stage = flow.stages[flow.current];
    parts.push(stage ? `stage ${stage.label} of ${flow.stages.map(({ id }) => id).join(", ")}` : "all stages done");
    if (flow.verdicts) parts.push(flow.verdicts.map(({ name, state }) => `${name} ${state}`).join(", "));
  } else if (current && !model.idle) {
    parts.push(`phase ${LABELS[current]}`);
  }
  if (model.step) parts.push(`running ${model.step.name}`);
  if (model.skills.length) parts.push(`skills ${model.skills.map(({ id }) => id).join(", ")}`);
  const { context, rates } = model.figures;
  if (context !== null) parts.push(`context ${context}%`);
  for (const rate of rates) parts.push(`${rate.label} ${rate.percent}%`);
  return parts.join(" · ");
};

/**
 * The card as `{ source, alt, animated }`: an SVG document and its description. `motion` is the
 * mod's setting; the drawing moves only while the model is not idle and motion is not off.
 */
export const composeSvgCard = (model, { motion = "full", accent = "#5fd7ff" } = {}) => {
  const { width, height } = SVG_CARD;
  const working = !model.idle && motion !== "off";
  const animate = { breath: working, sweep: working && motion === "full", comet: working && motion === "full" };
  const edge = borderColor(model, accent);
  const perimeter = 1000;
  const defs = animate.sweep
    ? `<defs><linearGradient id="lit-sweep" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" values="-1.2 0;1.2 0" dur="${TIMINGS.sweep}ms" repeatCount="indefinite"/></linearGradient></defs>`
    : "";
  const frame = `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="${C.bg}" stroke="${edge}" stroke-width="1.5"${model.idle ? ' stroke-opacity="0.8"' : ""}>`
    + (animate.breath && !model.warnings.length ? `<animate attributeName="stroke-opacity" values="0.45;1;0.45" dur="${TIMINGS.breath}ms" repeatCount="indefinite"/>` : "")
    + "</rect>";
  const comet = animate.comet
    ? `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="none" stroke="url(#lit-comet)" stroke-width="2.5" stroke-linecap="round" pathLength="${perimeter}" stroke-dasharray="70 ${perimeter - 70}"><animate attributeName="stroke-dashoffset" values="0;-${perimeter}" dur="${TIMINGS.comet * 2}ms" repeatCount="indefinite"/></rect>`
      + `<defs><linearGradient id="lit-comet" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${C.orange}"/><stop offset="0.6" stop-color="${C.pink}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>`
    : "";
  const body = [
    topRow(model, accent, animate),
    model.workflow ? mapRowSvg(model, accent, animate) : phaseRow(model, accent, animate),
    detailRowSvg(model, accent, animate),
    middleRow(model, accent, animate),
    bottomRow(model, accent),
  ].join("");
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${SVG_CARD.font}">${defs}${frame}${comet}${body}</svg>`;
  return { source, alt: svgCardAlt(model), animated: working };
};
