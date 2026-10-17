// The LIT card in the desktop app's own elements: a bordered Box of flex rows and monospaced Text
// spans, laid out by the app rather than by counted cells. The app draws a Box as a flex div and a
// Text as a styled span (the host's StyledElement), so a new tree updates the page in place. The Svg
// card it replaces was a whole document the app loaded into a fresh sandboxed frame on every real
// change (the stage, the tool, a skill), which blanked the card and restarted its animations.
//
// It shows the same five rows and colours as the Svg card (svg-card.mjs): the brand pill, the
// discipline and the stage indicator; the workflow map or the phase track with the lanes and
// progress; the detail line with the running tool; the skill chips, the notice or the finish; the
// usage figures. Box and Text carry no animation props, so this card is still; like the Svg card
// it carries no step clock and no loop countdown, so time alone never changes the tree.

import { barCells } from "./motion.mjs";
import { C, LABELS, PHASES, TONES, VERDICT_FILL, borderColor, indicatorOf, levelColor, mapColor, rightOfPhases } from "./svg-card.mjs";

const MAX_CHIPS = 6;

/**
 * The card as one element tree from a surface's `{ Box, Text }`. `accent` is the HUD accent.
 */
export const composeNativeCard = ({ Box, Text }, model, { accent = "#5fd7ff" } = {}) => {
  const span = (body, { fill = C.white, bold = false, bg = null } = {}) => Text({
    children: body,
    color: fill,
    mono: true,
    wrap: "truncate-end",
    ...(bg ? { backgroundColor: bg } : {}),
    ...(bold ? { weight: "semibold" } : {}),
  });
  const pill = (label, fill, ink = C.ink, bold = true) => span(` ${label} `, { fill: ink, bg: fill, bold });
  const pieces = (list) => list.map(([body, style]) => span(body, style));
  const group = (children, gap = "xs") => Box({ flexDirection: "row", alignItems: "center", gap, flexShrink: 1, overflow: "hidden", children });
  const joined = (groups) => groups.flatMap((list, index) => (index > 0 ? [span("·", { fill: C.faint }), ...pieces(list)] : pieces(list)));
  const row = (left, right = []) => Box({
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "md",
    children: [group(left.length ? left : [span(" ")]), ...(right.length ? [group(right)] : [])],
  });

  const indicator = indicatorOf(model, accent);
  const top = row(
    [pill("🔥 LIT", C.pink), span("·", { fill: C.dim }), span(model.title ?? "ready", model.idle ? { fill: C.dim } : { fill: accent, bold: true })],
    [span(indicator.label, { fill: indicator.fill, bold: !indicator.plain })],
  );

  const nowFill = (isWork = true) => (model.idle ? C.muted : model.ctxWarning && isWork ? C.amber : accent);
  const nowInk = model.idle ? C.mutedText : C.ink;
  let track;
  if (model.workflow) {
    const { stages } = model.workflow;
    const last = Math.max(1, stages.length - 1);
    const left = [];
    stages.forEach((stage, index) => {
      if (index > 0) left.push(span("──", { fill: stage.state === "todo" ? C.rail : mapColor(accent, (index - 0.5) / last) }));
      if (stage.state === "now") left.push(pill(stage.label, nowFill(), nowInk));
      else left.push(span(`${stage.label} ${stage.state === "done" ? "✓" : "·"}`, { fill: stage.state === "done" ? mapColor(accent, index / last) : C.dim }));
    });
    track = row(left, joined(rightOfPhases(model, false)));
  } else {
    const left = [];
    PHASES.forEach((id, index) => {
      const state = model.phases[id];
      if (index > 0) left.push(span("──", { fill: model.phases[PHASES[index - 1]] === "done" ? accent : C.rail }));
      if (state === "now") left.push(pill(LABELS[id], nowFill(id === "work"), nowInk));
      else left.push(span(`${state === "done" ? "●" : "○"} ${LABELS[id]}`, { fill: state === "done" ? accent : C.dim }));
    });
    track = row(left, joined(rightOfPhases(model)));
  }

  const flow = model.workflow;
  const detailLeft = [];
  if (flow) {
    detailLeft.push(span("└", { fill: C.dim }));
    const parts = [];
    if (flow.count) {
      const { done, total, unit } = flow.count;
      const bar = barCells(total > 0 ? done / total : 0, 8).map(({ glyph, color }) => span("▮", { fill: glyph === "█" ? color : C.empty }));
      parts.push([span(unit, { fill: C.dim }), Box({ flexDirection: "row", children: [span(`${done}`, { bold: true }), span(`/${total}`, { fill: C.dim })] }), Box({ flexDirection: "row", children: bar })]);
    }
    if (flow.verdicts) parts.push(flow.verdicts.map(({ name, state }) => span(`${name} ${VERDICT_FILL[state][0]}`, { fill: VERDICT_FILL[state][1] })));
    for (const item of flow.items) parts.push([span(item)]);
    if (flow.next) parts.push([span("next", { fill: C.dim }), span("▸", { fill: accent }), span(flow.next)]);
    parts.forEach((part, index) => detailLeft.push(...(index > 0 ? [span("·", { fill: C.faint })] : []), ...part));
  }
  const detail = row(detailLeft, model.step ? [span("◌", { fill: accent }), span(model.step.name)] : []);

  let middle;
  if (model.completion) {
    middle = row([span("✦", { fill: C.pink }), span("COMPLETE", { bold: true }), span(`· ${model.completion.detail ?? ""}`, { fill: C.green })]);
  } else if (model.notice) {
    const [bar, title, icon] = TONES[model.notice.tone] ?? TONES.pink;
    middle = row([span("▌", { fill: bar }), span(`${icon} ${model.notice.title}`, { fill: title, bold: true }), ...(model.notice.detail ? [span(`· ${model.notice.detail}`, { fill: C.dim })] : [])]);
  } else if (model.skills.length === 0) {
    if (!model.idle && model.next && !model.workflow?.next) middle = row([span("▸", { fill: accent }), span(model.next)]);
    else if (!model.idle) middle = row([span("no LitFamily skill yet in this request", { fill: C.dim })]);
    else middle = row([span("no LitFamily skill yet · type", { fill: C.dim }), span("lit <task>", { fill: accent }), span("to start one", { fill: C.dim })]);
  } else {
    const shown = model.skills.slice(0, MAX_CHIPS).map((chip) => (chip.state === "current"
      ? pill(`⚡ ${chip.id}`, accent)
      : pill(`↯ ${chip.id}`, C.muted, C.mutedText, false)));
    const rest = model.skills.length - MAX_CHIPS;
    middle = row([span("skills", { fill: C.dim }), group(rest > 0 ? [...shown, pill(`+${rest}`, C.muted, C.dim, false)] : shown, "sm")]);
  }

  const bottomGroups = [];
  const warning = model.warnings[0];
  if (warning) {
    const color = warning.tone === "red" ? C.red : C.amber;
    bottomGroups.push([span(`${warning.tone === "red" ? "✗" : "⚠"} ${warning.subject}`, { fill: color, bold: true }), span(warning.text, { fill: color })]);
  }
  const { context, rates, git } = model.figures;
  if (context !== null) {
    const filled = Math.max(0, Math.min(5, Math.round(context / 20)));
    const bar = Array.from({ length: 5 }, (_, i) => span("▮", { fill: i < filled ? accent : C.empty }));
    bottomGroups.push([span("ctx", { fill: C.dim }), span(`${context}%`, { fill: accent }), Box({ flexDirection: "row", children: bar })]);
  }
  for (const rate of rates) bottomGroups.push([span(rate.label, { fill: C.dim }), span(`${rate.percent}%`, { fill: levelColor(rate.percent) })]);
  if (git) bottomGroups.push([span("git", { fill: C.dim }), span(git, { fill: accent })]);
  const bottom = row(bottomGroups.flatMap((list, index) => (index > 0 ? [span("·", { fill: C.faint }), ...list] : list)));

  return Box({
    flexDirection: "column",
    gap: "xs",
    paddingX: "md",
    paddingY: "sm",
    borderStyle: "round",
    borderColor: borderColor(model, accent),
    backgroundColor: C.bg,
    children: [top, track, detail, middle, bottom],
  });
};
