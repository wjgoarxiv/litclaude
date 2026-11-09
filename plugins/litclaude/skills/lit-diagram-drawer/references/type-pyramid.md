# Pyramid and funnel

**Catalog ID:** `pyramid`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use a pyramid for a ranked hierarchy where the broad base supports progressively narrower, rarer, or more valuable levels. Use a funnel when a measured audience or quantity drops through successive stages and the narrowing itself communicates attrition. Use Bar when exact comparisons across categories matter more than the taper; use Tree when the relationship branches.

## Exclusions

Do not mix upward pyramid and downward funnel conventions in one figure. A qualitative priority stack must not borrow numeric widths to imply data. A real funnel must not use decorative equal-width layers when observed proportions differ. Do not present arbitrary hierarchical data as if it were a quantity.

## Content schema

```yaml
orientation: funnel            # pyramid | funnel
title: "Request conversion"
unit: "requests"
layers:                        # 4–6, in visible top-to-bottom order
  - { id: visit, label: Visit, detail: "10,000", value: 10000 }
  - { id: signup, label: Sign-up, detail: "4,200 · 42%", value: 4200 }
  - { id: activate, label: Activation, detail: "1,700 · 17%", value: 1700, focal: true }
  - { id: retain, label: Retained, detail: "980 · 9.8%", value: 980 }
```

Each layer has a stable ID, concise label, optional one-line detail, and optional value. A data funnel requires a nonnegative value for every stage, a shared unit and denominator, and a visible count or percentage. A conceptual pyramid may omit values. Mark at most one focal layer.

## Deterministic layout recipe

Use a 1000×560 viewBox and a centered stack from y=80 with equal layer height `h=64` and 8px inter-layer gap. For a qualitative pyramid with `n` layers, interpolate width linearly from 700px at the base to 260px at the apex, then center each trapezoid on x=500. For a funnel, set each trapezoid's width proportional to the declared value on one linear width scale (`width_i = max_width × value_i / max_value`), retaining a small minimum only if it is labeled as a visual floor and does not alter ranking; default is no floor. Pyramid order is broad base to narrow apex bottom-up; funnel order is largest first at the top. Put label and value at each trapezoid's horizontal center; place optional drop-off notes in a consistent side column. Extend the viewBox if labels exceed the safe area rather than squeezing the stack.

## Encoding rules

Width represents magnitude only in a measured funnel and is proportional to its value. For conceptual hierarchies, the taper is a convention, not a numerical scale; say so in the subtitle or alternative text if ambiguity is possible. Use one neutral treatment across layers, with one accent layer at most: the apex in a pyramid, the conversion bottleneck in a funnel, or one user-selected focal stage. Keep layer height equal. An optional axis arrow may say “rarer” or “drop-off” but cannot replace labels.

## Korean behavior

Use short Korean nouns for stages and concise numeric notation with the shared Korean number and unit format. Keep `%`, count units, and the value together. Labels may wrap to two lines inside wide layers; narrow apex layers get a shorter label. Keep Korean line-height consistent and put explanatory prose outside the trapezoid.

## Light, dark, and full variants

Light and dark retain the same widths, order, labels, and accent target. Change only shared tokens; check each outlined trapezoid against its paper background. The full variant may add a restrained title and one or two summary notes beside the stack, while preserving all layer geometry and data.

## Accessibility

Give the SVG an accessible title and description that state orientation and whether widths are quantitative. Provide a text list in stage order containing each label, value, unit, and denominator. Use labels and numeric text so no comparison depends on color. Keep stroke boundaries visible between neighboring layers and ensure text does not cross polygon edges.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for overlap, edge bounds, label clipping, contrast, skin polarity, accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=pyramid` to validate the catalog marker; manually reconcile declared values and rendered widths for quantitative funnels. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Seven or more layers, unequal decorative layer heights, or layers too small to label.
- Quantitative funnel widths that are equal, reversed, or unrelated to declared values.
- A data value hidden only in a source note, or a percentage without its denominator.
- Multiple accent layers, gradients that imply a second scale, shadows, or separate rainbow colors.
- Using a pyramid for unrelated categories or using a funnel for a hierarchy without attrition.
