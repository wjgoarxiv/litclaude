# Bump Chart

**Catalog ID:** bump

## Purpose and selection

Use a bump chart to show how the relative rank of several series changes across ordered snapshots. It communicates rank, not magnitude. Use a slopegraph for exactly two snapshots when the values still matter; use a line chart when magnitude or rate over time is the claim. A ranked list is clearer for one snapshot. If the task is analysis of measured scientific data, route it to the dedicated scientific-visualization skill.

## Content schema

Supply 4–8 named series, 3–6 ordered snapshot labels, and one integer rank for every series at every snapshot. Each snapshot must contain exactly one instance of each rank from 1 through N. Record the measure used to rank and its tie-break rule. All snapshots must use the same measure definition. Mark at most one editorially focal series.

## Deterministic layout recipe

Use a fixed 4px-aligned plot grid. Set each snapshot as an evenly spaced vertical axis. Set rank rows to a constant 56px vertical pitch in the canonical 1000 × 500 frame, with rank 1 at y=88 and rank r at y=88 + 56 × (r−1). Draw straight segments between adjacent snapshots and a small dot at every vertex. Do not smooth. Put snapshot captions under their axis.

Put series names and rank labels in gutters beyond the first and last axes. Align each endpoint label to the row belonging to that series and the column for the endpoint it names. Sort or order series by first-snapshot rank, then keep that order stable. Draw paths before dots and labels. If rank rows or gutters do not fit, reduce series count or widen the canvas rather than moving rank points.

## Encoding rules

Vertical position encodes ordinal rank only. Every rank row has equal distance; horizontal position encodes snapshot order. Stroke tone may carry a restrained ordering cue, but legend language must describe the tone neutrally and remain true in both themes. Accent one focal series and use weight or point size as a redundant cue. Bind each path to its rank sequence and each endpoint label to series, side, and rank.

## Korean behavior

Use Korean snapshot captions and rank labels where appropriate, such as 1위, while preserving rank values as integers. State the ranking measure and tie-break in a Korean source note. Use Pretendard for series names and mono for snapshot codes and rank data. Give gutters enough width for Korean labels; wrap names at word boundaries without allowing them to drift into the plot.

## Light, dark, and full variants

Light uses a neutral stroke ramp, restrained grid-free field, and one focal accent. Dark recalculates the neutral ramp and axis contrast while preserving the same ranking geometry. Full adds title, ranking-method note, and takeaway outside the plot. Do not let the full frame introduce a second series ordering or different data.

## Accessibility

Describe the ranking measure and the major rank changes in text. Keep series identity available through endpoint labels and a data table; color is supplemental. Ensure first and last endpoint labels are programmatically associated with the correct series and snapshot. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for layout, clipping, contrast, and accessibility. Run scripts/verify-type.mjs --type=bump for complete rank permutations, exact rank-row positions, straight adjacent-snapshot segments, snapshot captions, and endpoint label bindings. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Showing magnitude on a rank axis or labeling rank as though it were a value.
- Comparing snapshots built from different ranking definitions.
- Smoothing between observations or filling a genuine missing interval.
- Giving two series the same rank when the declared tie-break requires unique order.
- Moving a vertex off its rank row to solve a label collision.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
