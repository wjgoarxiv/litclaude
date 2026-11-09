# Waterfall chart

**Catalog ID:** `waterfall`

## Purpose and selection

Use a waterfall to show how a start total becomes an end total through signed sequential contributions: a budget bridge, headcount change, conversion gains/losses, or a P&L walk. The running total must reconcile at every step. Use a dumbbell for two endpoints where only the gap matters, a bar chart for independent category values, Sankey for branching quantity flow, and funnel for ordered drop-off.

## Content schema

Provide 3–8 bars total: a positive start total, at least one signed nonzero delta, an end total, and optionally one subtotal. Each bar has a stable name, role (`total`, `delta`, `subtotal`), value, unit, and displayed label. Deltas carry an explicit plus or minus sign. Include a single linear domain, source, period, and any “Other” aggregation definition. Totals and deltas use the same unit.

For an SVG implementation, bind `data-role`, signed `data-value`, and `data-name` on every bar; bind the running level on each carry connector with `data-carry`. The verifier recomputes the walk from the declarations and compares it with the displayed geometry.

## Deterministic layout recipe

1. Use vertical bars in left-to-right order: starting total, signed contributions, optional subtotal, and ending total. Select a common linear y-scale whose domain includes zero and every running total; zero is the baseline for total bars.
2. Draw start, subtotal, and end totals from the baseline to their values. Each delta bar spans exactly from the prior running level to the next. Draw a horizontal carry between adjacent bars at the exact level it transports.
3. Reconcile `start + Σ(delta) = end` before placing any geometry. Carry levels reflect every intermediate sum. Round only at the final pixel coordinate; never adjust a bridge for visual convenience. Zero deltas are omitted and explained in a note if material.
4. Give bars equal width and pitch, with sufficient space for category labels. Place totals/increases' value labels above their top; place decrease labels below their lower edge where the incoming carry does not collide. Print every delta with its sign.
5. Use 3–8 bars total, including endpoints, and no more than one subtotal. If there are too many contributions, combine a justified tail into a named “Other” bridge or split the reconciliation into two views.

## Visual encoding

Totals use the strongest neutral outline/fill, increases a light filled treatment, and decreases a hollow treatment. This distinguishes sign in grayscale as well as color. One focal bridge may use the accent; it retains its signed label and geometric direction. Carries use a clearly visible rule because they assert conservation. Axes and gridlines are secondary, while values, signs, and bridge endpoints are primary.

## Korean text

Use Pretendard for categories and mono for exact values, units, and source notes. Print explicit `+`/`−` signs for all changes, regardless of Korean wording. Use one thousands-separator and decimal policy throughout and state whether values are rounded. Keep category labels short and upright; use `기초`, `증가`, `감소`, and `기말` only when they match the accounting meanings. Follow [Korean typography](korean-typography.md).

## Light, dark, and full variants

The values, scale, carries, bar roles, and focal bridge stay unchanged across variants. Light and dark skins use semantic tokens for paper, ink, and accent; a decrease remains hollow in both. The full editorial form can add a headline about the main contribution, one sentence on reconciliation, and source/period metadata. Verify carry visibility and value-label contrast in the dark skin.

## Accessibility

Provide a title and description with the starting amount, signed walk, ending amount, unit, and reconciliation result. Every bar prints its value, and each delta includes its sign. Fill state and geometry redundantly indicate direction; hue is never the only cue. Ensure carry levels are visible and text does not overlap them. Offer an equivalent table of start, delta, running balance, and end values for exact access.

## Verifier gates

Run `scripts/verify-diagram.mjs` for overlap, clipping, off-canvas geometry, contrast, skin, visible text, and a11y. Run `scripts/verify-type.mjs --type=waterfall` to recompute the running total, bridge geometry, carry levels, role/value bindings, signed labels, bar count, and domain. Review every value label at final output resolution; a mathematically valid chart may still have an illegible decrease label.

## Anti-patterns

- A floating delta without a carry or a carry at the wrong running level.
- Unreconciled end total, mixed units, or unsigned delta labels.
- Sign encoded by red/green hue alone.
- A truncated or changing axis that exaggerates bridge size.
- Multiple subtotals, zero-height bars, or more than eight columns.
- Rounded geometry or labels that disagree with the declared values.

## Related references

[Bar chart](type-bar.md) · [Sankey](type-sankey.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
