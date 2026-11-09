// The LIT card as one SVG drawing, for the surfaces that are not a terminal grid. The Claude desktop
// app draws a mod's Text in a proportional font and cuts each span to the cells it was given, so the
// terminal card's text border and its padded pills come apart there. Those surfaces carry an `Svg`
// element instead, and this module draws the same card into it: the brand pill, the discipline and
// the stage indicator on top, the workflow map (or the phase track and progress when no family
// places the session), the detail line with the live step, the thread rows while more than one
// thread is live (the terminal card's rows, drawn the same way), the skill chips (or the notice or
// the finish), and the live figures at the bottom.
//
// It draws the settled state of the model; the terminal's entrances and crossfades stay terminal
// only. While LitClaude works and motion allows, SMIL animation in the drawing keeps it moving: the
// brand pill and the border breathe (full and subtle), a light crosses the current stage and this
// request's chips, a bright head runs along the rail leaving the current stage, the count bar's
// head shimmers, the step spinner turns and a comet runs around the border (full only). Idle, it is
// still. The drawing carries no step clock and no loop countdown: the surface loads each new
// drawing afresh, restarting every animation, so a figure that moves with time alone would make the
// card blink on every poll. Each loop opens mid-cycle (see `loop`), so a fresh load starts on a
// frame of the running card rather than on a dim border and a comet at the corner.
//
// Text is set in a monospace face and placed by counted cells (Hangul and emoji as two), so the
// layout does not depend on measuring a font the drawing cannot see.

import { gauge, knownFacts } from "../rewind/gauge.mjs";
import { textWidth, truncateToWidth } from "./layout.mjs";
import { CLUB_GLINT, CLUB_GOLD, CLUB_PILL, CLUB_STOPS, LOOKS, lookOf } from "./looks.mjs";
import { TIMINGS, barCells, gradientAt, rainbowAt } from "./motion.mjs";

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
// Each reserved thread row adds this much height, between the detail line and the chips.
export const THREAD_ROW_H = 22;
const PILL_H = 20;
const FONT = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'JetBrains Mono', Consolas, monospace";

// Timing of one looping animation, started `phase` of the way into its cycle. The surface loads
// each new drawing afresh, so every loop would otherwise open on its first frame: the breathing at
// its dimmest, the light off the pill's left edge, the comet parked at the top-left corner. A
// negative begin opens each loop mid-cycle, in a frame that looks like the card already running.
const loop = (ms, phase) => `dur="${ms}ms" begin="-${Math.round(ms * phase)}ms" repeatCount="indefinite"`;
// The breathing pieces share one phase so the pill, the border and the count bar's head stay in step.
const BREATH_PHASE = 0.25;

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
// `veil` lays white over a rainbow fill so the dark ink keeps its contrast on every hue.
const pill = (x, y, label, { fill, ink, bold = true, sweep = false, breath = null, breathPeak = 0.85, veil = false }) => {
  const w = widthOf(label) + 16;
  const top = y - PILL_H + 6;
  const parts = [`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${fill}"/>`];
  if (veil) parts.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="#ffffff" opacity="0.3"/>`);
  if (breath) parts.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${breath}" opacity="0"><animate attributeName="opacity" values="0;${breathPeak};0" ${loop(TIMINGS.breath, BREATH_PHASE)}/></rect>`);
  if (sweep) parts.push(`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="url(#lit-sweep)"/>`);
  parts.push(text(x + 8, y, label, { fill: ink, bold }));
  return { markup: parts.join(""), end: x + w };
};

const indicatorOf = (model, accent) => {
  if (model.completion) return { label: "DONE ✓", fill: C.green };
  if (model.look === "turn") return { label: LOOKS.turn.label, fill: C.amber };
  if (model.look === "review") return { label: `${LOOKS.review.label} ${model.workflow.verdicts.filter(({ state }) => state === "pass" || state === "fail").length}/${model.workflow.verdicts.length}`, fill: accent };
  if (model.look === "club") return { label: `${LOOKS.club.label} ✦`, fill: CLUB_GOLD };
  if (model.idle) return { label: "idle", fill: C.dim, plain: true };
  const flow = model.workflow;
  if (flow?.paused && flow.current >= 0) return { label: `${flow.stages[flow.current].id.toUpperCase()} ||`, fill: C.dim };
  if (flow && flow.current >= 0) return { label: `${flow.stages[flow.current].id.toUpperCase()} ●`, fill: model.ctxWarning ? C.amber : accent };
  if (flow && model.lanes.count === 0) return { label: "DONE ✓", fill: C.green };
  const current = PHASES.find((id) => model.phases[id] === "now");
  if (current) return { label: `${LABELS[current]} ●`, fill: model.ctxWarning && current === "work" ? C.amber : accent };
  if (PHASES.every((id) => model.phases[id] === "done") && model.lanes.count === 0) return { label: "DONE ✓", fill: C.green };
  return { label: "LIVE ●", fill: accent };
};

// The rewind look draws the LIT pill and a `REWIND <<` indicator in the turning rainbow; the club
// look a gold pill after a `✧`, a rose title closed by a `✦`, and `CLUB ✦` on its gold-gradient pill.
const topRow = (model, accent, animate, rewind = false) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[0];
  const club = model.look === "club";
  const lead = club ? text(pad, y, "✧", { fill: CLUB_STOPS[1] }) : "";
  const from = club ? pad + widthOf("✧ ") : pad;
  const brand = rewind
    ? pill(from, y, "🔥 LIT", { fill: "url(#lit-rainbow)", ink: C.ink, veil: true })
    : pill(from, y, "🔥 LIT", { fill: club ? CLUB_GOLD : C.pink, ink: C.ink, breath: animate.breath ? C.orange : null });
  const indicator = rewind && !model.completion ? { label: "REWIND <<", fill: "url(#lit-rainbow)" } : indicatorOf(model, accent);
  // The club pill is 16 wider than the bare indicator text; it ends where the text would.
  const pillWide = club ? 16 : 0;
  // A newer LitClaude installed than the one loaded: `restart to <version>` left of the indicator.
  const chip = model.restart ? `restart to ${model.restart}` : null;
  const chipEnd = width - pad - widthOf(indicator.label) - 16 - pillWide;
  const label = club
    ? pill(width - pad - widthOf(indicator.label) - 16, y, indicator.label, { fill: "url(#lit-club-pill)", ink: C.ink }).markup
    : text(width - pad, y, indicator.label, { fill: indicator.fill, bold: !indicator.plain, anchor: "end" });
  const right = label + (chip ? text(chipEnd, y, chip, { fill: C.amber, anchor: "end" }) : "");
  const tail = club ? " ✦" : "";
  const room = width - pad - widthOf(indicator.label) - 16 - pillWide - (chip ? widthOf(chip) + 16 : 0) - brand.end - widthOf(" · ") - widthOf(tail);
  const name = truncateToWidth(model.title ?? "ready", Math.max(4, Math.floor(room / SVG_CARD.cell)));
  const title = run(brand.end + 4, y, [[" · ", { fill: C.dim }], [name, club ? { fill: CLUB_STOPS[1] } : model.idle && !rewind ? { fill: C.dim } : { fill: accent, bold: true }], ...(club ? [[tail, { fill: CLUB_GOLD }]] : [])]);
  return lead + brand.markup + title.markup + right;
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
        if (animate.sweep && !model.workflow.paused) out.push(`<circle cx="${x1.toFixed(1)}" cy="${y - 4}" r="2.5" fill="#ffffff"><animate attributeName="cx" values="${x1.toFixed(1)};${x2.toFixed(1)}" ${loop(TIMINGS.flow, 0.5)}/></circle>`);
      } else {
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y - 4}" x2="${x2.toFixed(1)}" y2="${y - 4}" stroke="${C.rail}" stroke-width="1.5" stroke-linecap="round" stroke-opacity="0.7"/>`);
      }
      x = x2 + 6;
    }
    const label = labelOf(stage, layout.short);
    if (stage.state === "now" && model.workflow.paused) {
      // A paused stage holds still, as on the terminal card.
      const drawn = pill(x, y, label, { fill: C.muted, ink: C.mutedText });
      out.push(drawn.markup);
      x = drawn.end;
    } else if (stage.state === "now") {
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
      + (animate.breath ? `<animateTransform attributeName="transform" type="rotate" values="0 ${cx.toFixed(1)} ${y - 4};360 ${cx.toFixed(1)} ${y - 4}" ${loop(TIMINGS.spin * 8, 0.5)}/>` : "")
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
    if (head >= 0 && animate.sweep) out.push(`<rect x="${(x + head * 9).toFixed(1)}" y="${y - 10}" width="7" height="10" rx="1.5" fill="#ffffff" opacity="0"><animate attributeName="opacity" values="0;0.6;0" ${loop(TIMINGS.breath, BREATH_PHASE)}/></rect>`);
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
// The club card's quiet `invited by @<id>` chip on the muted pill, ending at the card's right pad;
// drawn only when it clears whatever the row already holds (ending at `after`) by 16.
const inviteChipSvg = (model, y, after) => {
  if (!model.invitedBy || after === null) return "";
  const handle = `@${model.invitedBy}`;
  const w = widthOf(`invited by ${handle}`) + 16;
  const x = SVG_CARD.width - SVG_CARD.pad - w;
  if (x < after + 16) return "";
  return `<rect x="${x.toFixed(1)}" y="${y - PILL_H + 6}" width="${w.toFixed(1)}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${C.muted}"/>`
    + run(x + 8, y, [["invited by ", { fill: C.mutedText }], [handle, { fill: CLUB_STOPS[1], bold: true }]]).markup;
};

const middleRow = (model, accent, animate, shift = 0, rewind = false) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[3] + shift;
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
    const hint = run(pad, y, [["no LitFamily skill yet · type ", { fill: C.dim }], ["lit <task>", { fill: accent }], [" to start one", { fill: C.dim }]]);
    return hint.markup + inviteChipSvg(model, y, hint.end);
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
    const tinted = rewind && lookOf(chip.id) === "rewind";
    const drawn = tinted
      ? pill(x, y, label, { fill: "url(#lit-rainbow)", ink: C.ink, veil: true, sweep: animate.sweep })
      : pill(x, y, label, { fill: current ? accent : C.muted, ink: current ? C.ink : C.mutedText, bold: current, sweep: current && animate.sweep });
    out.push(drawn.markup);
    x = drawn.end + 8;
  });
  if (rewind && animate.sweep && x !== null) out.push(sparksSvg(x, width - pad, y));
  if (model.away && x !== null && x + widthOf("back? type lit adhd to catch up") <= room) out.push(run(x, y, [["back? type ", { fill: C.dim }], ["lit adhd", { fill: accent }], [" to catch up", { fill: C.dim }]]).markup);
  else out.push(inviteChipSvg(model, y, x));
  return out.join("");
};

// The rewind look's sparks: ASCII stars drifting right to left through the room the chips leave,
// each fading in and out on its own slow loop (no faster than TIMINGS.sparks / 4 per twinkle).
const SPARK_SEEDS = Object.freeze([[0.08, 1.0, "*"], [0.22, 1.3, "+"], [0.37, 0.8, "."], [0.51, 1.1, "*"], [0.66, 0.9, "'"], [0.79, 1.4, "+"], [0.93, 0.7, "*"]]);
const sparksSvg = (from, to, y) => {
  const span = to - from;
  if (span < 60) return "";
  return SPARK_SEEDS.map(([start, speed, glyph], i) => {
    const x = from + start * span;
    const dur = Math.round(TIMINGS.sparks / speed);
    return `<text class="lit-spark" x="${x.toFixed(1)}" y="${y}" fill="${rainbowAt(start)}" opacity="0.8">${esc(glyph)}`
      + `<animateTransform attributeName="transform" type="translate" values="0 0;${(-start * span).toFixed(1)} 0" ${loop(dur, 0)}/>`
      + `<animate attributeName="opacity" values="0.3;0.9;0.3" ${loop(Math.round(TIMINGS.sparks / 2), i / SPARK_SEEDS.length)}/></text>`;
  }).join("");
};

// ctx 42% ▰▰▱▱▱ · 5h 31% · 1w 12% · git main, after a warning when one is up.
const bottomRow = (model, accent, shift = 0) => {
  const { width, pad } = SVG_CARD;
  const y = ROW_Y[4] + shift;
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

const THREAD_FILL = Object.freeze({ running: ["●", C.green], paused: ["|", C.dim], blocked: ["!", C.amber], idle: ["-", C.dim], done: ["✓", C.green] });
const TASK_MARK = Object.freeze({ shell: "$", monitor: "~" });
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// What a thread with no total says instead of a gauge. Each new drawing restarts the card's
// animations, so the drawing leaves out the last step (it changes on every tool call) and counts
// steps by tens past ten.
const threadFacts = ({ steps, elapsedMs, state }) => knownFacts({ steps: Number.isInteger(steps) && steps >= 10 ? Math.floor(steps / 10) * 10 : steps, elapsedMs, state })
  .replace(/^(\d+0) steps/u, (all, n) => (steps >= 10 ? `${n}+ steps` : all));
const PULSE = "━━━━━";
// The indeterminate pulse over a thread with no total: a light that slides along its track, or a
// still track with motion off.
const pulseSvg = (x, y, animate, fill) => {
  const w = widthOf(PULSE);
  if (!animate) return "";
  return `<rect x="${x.toFixed(1)}" y="${y - 8}" width="${(w / 3).toFixed(1)}" height="4" rx="2" fill="${fill}" opacity="0.9"><animate attributeName="x" values="${x.toFixed(1)};${(x + (w * 2) / 3).toFixed(1)};${x.toFixed(1)}" ${loop(TIMINGS.flow * 2, 0.25)}/></rect>`;
};

/**
 * The thread rows (view.mjs threadsOf), as the terminal card lays them out (frame.mjs threadRows):
 * the stack parent first with each child under it, lanes and background tasks under a fork line
 * when two or more run, other sessions last, `+N more` on the last row. Returns the markup.
 */
const threadRowsSvg = (model, { animate = false, rewind = false } = {}) => {
  const { width, pad } = SVG_CARD;
  const { chain, lanes, herdrLanes = [], others, laneCount = 0, taskCount = 0, more } = model.threads;
  const lines = [];
  chain.forEach((thread, index) => lines.push({ thread, lead: index === 0 ? "" : `${"   ".repeat(index - 1)}└─ ` }));
  const under = "   ".repeat(Math.max(0, chain.length - 1));
  if (laneCount + taskCount >= 2) {
    const label = [laneCount ? plural(laneCount, "lane") : null, taskCount ? plural(taskCount, "task") : null].filter(Boolean).join(" · ");
    lines.push({ fork: `${under}┬ ${label} in parallel` });
    lanes.forEach((thread, index) => lines.push({ thread, lead: `${under}${index === lanes.length - 1 ? "└─" : "├─"} ` }));
  } else {
    lanes.forEach((thread) => lines.push({ thread, lead: chain.length ? `${under}└─ ` : "" }));
  }
  herdrLanes.forEach((thread) => lines.push({ thread, lead: "" }));
  others.forEach((thread) => lines.push({ thread, lead: "" }));
  const threads = lines.filter(({ thread }) => thread).map(({ thread }) => thread);
  const nameCells = Math.min(28, Math.max(...threads.map(({ name }) => textWidth(name))));
  const stageCells = Math.min(10, Math.max(0, ...threads.map(({ stage }) => (stage ? textWidth(stage) : 0))));
  const out = [];
  lines.forEach((line, index) => {
    const y = ROW_Y[2] + THREAD_ROW_H * (index + 1);
    const tail = index === lines.length - 1 && more > 0 ? `+${more} more` : null;
    if (tail) out.push(text(width - pad, y, tail, { fill: C.dim, anchor: "end" }));
    const room = Math.floor((width - pad * 2 - (tail ? widthOf(tail) + 16 : 0)) / SVG_CARD.cell);
    if (line.fork) {
      out.push(text(pad, y, truncateToWidth(line.fork, room), { fill: C.dim }));
      return;
    }
    const { thread } = line;
    const [stateMark, color] = THREAD_FILL[thread.state] ?? THREAD_FILL.running;
    const mark = thread.task ? TASK_MARK[thread.task] ?? "$" : stateMark;
    const name = truncateToWidth(thread.name, nameCells);
    const drawn = gauge(thread.done, thread.total);
    const facts = drawn ? null : threadFacts(thread);
    const progress = drawn
      ? [[` ${drawn}`, { fill: C.white }], [` ${thread.state}`, { fill: color }]]
      : [[" ", {}], [PULSE, { fill: rewind ? "url(#lit-rainbow)" : C.rail, pulse: true }], [" ", {}],
        ...(facts.startsWith(thread.state) ? [[facts, { fill: color }]] : [[thread.state, { fill: color }], [` · ${facts}`, { fill: C.dim }]])];
    const pieces = [
      [line.lead, { fill: C.dim }],
      [`${mark} `, { fill: color, bold: true }],
      [name + " ".repeat(Math.max(0, nameCells - textWidth(name))), { fill: C.white, bold: thread.active }],
      ...(stageCells ? [[` ${truncateToWidth(thread.stage ?? "", stageCells).padEnd(stageCells)}`, { fill: C.dim }]] : []),
      ...progress,
      ...(thread.session ? [[` · other session ${thread.session}`, { fill: C.dim }]] : []),
    ];
    // Pieces past the room are cut from the right, as the terminal card clips its rows.
    let used = 0;
    const kept = [];
    for (const [body, style] of pieces) {
      const cells = textWidth(body);
      if (used + cells > room) {
        if (room - used > 1) kept.push([truncateToWidth(body, room - used), style]);
        break;
      }
      kept.push([body, style]);
      used += cells;
    }
    out.push(run(pad, y, kept).markup);
    const before = kept.findIndex(([, style]) => style.pulse);
    if (before >= 0) out.push(pulseSvg(pad + kept.slice(0, before).reduce((sum, [body]) => sum + widthOf(body), 0), y, animate, rewind ? "#ffffff" : C.white));
  });
  return out.join("");
};

const borderColor = (model, accent) => {
  if (model.warnings.some(({ tone }) => tone === "red")) return C.red;
  if (model.warnings.length) return C.amber;
  return model.idle ? C.faint : accent;
};

// The rewind look's border (plans/lit-adhd.md D7): a rainbow gradient whose stops each walk the hue
// wheel over TIMINGS.hue while the card moves, so the colours cycle; with motion off it stands still.
const RAINBOW_STOPS = 6;
const rainbowDefs = (animate) => {
  const stops = Array.from({ length: RAINBOW_STOPS + 1 }, (_, i) => {
    const color = rainbowAt(i / RAINBOW_STOPS);
    if (!animate) return `<stop offset="${(i / RAINBOW_STOPS).toFixed(3)}" stop-color="${color}"/>`;
    const values = Array.from({ length: RAINBOW_STOPS + 1 }, (_, j) => rainbowAt((i + j) / RAINBOW_STOPS)).join(";");
    return `<stop offset="${(i / RAINBOW_STOPS).toFixed(3)}" stop-color="${color}"><animate attributeName="stop-color" values="${values}" ${loop(TIMINGS.hue, 0.5)}/></stop>`;
  });
  return `<defs><linearGradient id="lit-rainbow" x1="0" x2="1" y1="0" y2="1">${stops.join("")}</linearGradient></defs>`;
};

// The club look's ring: gold on the left side through rose to violet on the right, so the top edge
// and the bottom edge each carry the whole velvet and the ring closes gold on gold at the left, as
// the terminal card lays it clockwise. The pill gradient fills `CLUB ✦`.
const gradientStops = (stops) => stops.map((color, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(3)}" stop-color="${color}"/>`).join("");
const clubDefs = () => `<defs><linearGradient id="lit-club" x1="0" x2="1" y1="0" y2="0">${gradientStops(CLUB_STOPS.slice(0, 3))}</linearGradient>`
  + `<linearGradient id="lit-club-pill" x1="0" x2="1" y1="0" y2="0">${gradientStops(CLUB_PILL)}</linearGradient></defs>`;

// The club glint (full motion only): a warm light crossing the top edge left to right in
// TIMINGS.clubGlint, then off the card until the next pass, TIMINGS.clubGlintPeriod apart. The first
// pass waits TIMINGS.clubGlintRest, as on the terminal card.
const clubGlintSvg = (width) => {
  const reach = 120;
  const pass = (TIMINGS.clubGlint / TIMINGS.clubGlintPeriod).toFixed(3);
  return `<defs><linearGradient id="lit-club-glint" gradientUnits="userSpaceOnUse" x1="${-reach}" x2="0" y1="0" y2="0">`
    + `<stop offset="0" stop-color="${CLUB_GLINT}" stop-opacity="0"/><stop offset="0.5" stop-color="${CLUB_GLINT}" stop-opacity="0.95"/><stop offset="1" stop-color="${CLUB_GLINT}" stop-opacity="0"/>`
    + `<animateTransform attributeName="gradientTransform" type="translate" values="0 0;${width + reach} 0;${width + reach} 0" keyTimes="0;${pass};1" dur="${TIMINGS.clubGlintPeriod}ms" begin="${TIMINGS.clubGlintRest}ms" repeatCount="indefinite"/>`
    + `</linearGradient></defs><line x1="15" y1="1.25" x2="${width - 15}" y2="1.25" stroke="url(#lit-club-glint)" stroke-width="2.5" stroke-linecap="round"/>`;
};

/** What the card says, for a reader that cannot see the drawing. */
export const svgCardAlt = (model) => {
  const parts = [`LIT ${model.rewind ? "rewind" : model.idle ? "idle" : "working"}`];
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
  const threads = model.threads ? [...model.threads.chain, ...model.threads.lanes, ...(model.threads.herdrLanes ?? []), ...model.threads.others] : [];
  if (threads.length) parts.push(`threads ${threads.map((thread) => `${thread.name} ${gauge(thread.done, thread.total) ? `${gauge(thread.done, thread.total)} ${thread.state}` : threadFacts(thread)}`).join(", ")}${model.threads.more ? `, ${model.threads.more} more` : ""}`);
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
  const { width } = SVG_CARD;
  // The thread rows sit between the detail line and the chips; the card grows by their reserve.
  const shift = model.threads ? THREAD_ROW_H * model.threads.reserve : 0;
  const height = SVG_CARD.height + shift;
  const rewind = (model.rewind === true || (!model.idle && lookOf(model.discipline) === "rewind")) && model.warnings.length === 0;
  const working = (!model.idle || rewind) && motion !== "off";
  const animate = { breath: working, sweep: working && motion === "full", comet: working && motion === "full" };
  const club = model.look === "club" && model.warnings.length === 0;
  const edge = rewind ? "url(#lit-rainbow)" : club ? "url(#lit-club)" : borderColor(model, accent);
  const perimeter = 1000;
  const defs = (rewind ? rainbowDefs(animate.breath) : club ? clubDefs() : "") + (animate.sweep
    ? `<defs><linearGradient id="lit-sweep" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" values="-1.2 0;1.2 0" ${loop(TIMINGS.sweep, 0.5)}/></linearGradient></defs>`
    : "");
  const frame = `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="${C.bg}" stroke="${edge}" stroke-width="${model.idle && !rewind && !club ? "1.5" : "2.5"}"${model.idle && !rewind && !club ? ' stroke-opacity="0.8"' : ""}>`
    + (animate.breath && !model.warnings.length ? `<animate attributeName="stroke-opacity" values="0.85;1;0.85" ${loop(TIMINGS.breath, BREATH_PHASE)}/>` : "")
    + "</rect>";
  const comet = animate.comet
    ? `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="none" stroke="url(#lit-comet)" stroke-width="2.5" stroke-linecap="round" pathLength="${perimeter}" stroke-dasharray="70 ${perimeter - 70}"><animate attributeName="stroke-dashoffset" values="0;-${perimeter}" ${loop(TIMINGS.comet * 2, 0.5)}/></rect>`
      + `<defs><linearGradient id="lit-comet" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${C.orange}"/><stop offset="0.6" stop-color="${C.pink}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>`
    : "";
  const body = [
    topRow(model, accent, animate, rewind),
    model.workflow ? mapRowSvg(model, accent, animate) : phaseRow(model, accent, animate),
    detailRowSvg(model, accent, animate),
    model.threads ? threadRowsSvg(model, { animate: animate.sweep, rewind }) : "",
    middleRow(model, accent, animate, shift, rewind),
    bottomRow(model, accent, shift),
  ].join("");
  const glint = club && motion === "full" ? clubGlintSvg(width) : "";
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="${SVG_CARD.font}">${defs}${frame}${comet}${glint}${body}</svg>`;
  return { source, alt: svgCardAlt(model), animated: working || glint !== "" };
};
