# Treemap

**Catalog ID:** `treemap`

## Purpose and selection

Use a treemap when the relative size of parts within a whole is the central message: storage use, budget, market share, population, or time allocation. Area carries the quantitative comparison. Use a bar chart when exact rank and values matter more than part-to-whole composition, Nested for nonquantitative containment, and Tree when parent-child tracing is the goal.

The two-dimensional [Marimekko variant](type-marimekko.md) has its own catalog route; use it only when both category share and within-category composition matter. See [Bar chart](type-bar.md) for adjacent comparison choices.

## Content schema

Provide one total, 4–8 nonnegative cells, a stable cell id/name, optional parent id for a two-level hierarchy, a value, and its percentage of the declared whole. Include source, unit, period, rounding policy, and an explicit “Other” definition whenever small categories are aggregated. Each cell binds its computed share in `data-share`, including cells with no visible text. A focal cell may be selected for annotation; it is not necessarily the largest.

## Deterministic layout recipe

1. Fix a plot rectangle and calculate each exact share from the unrounded source values. Confirm the shares reconcile to the whole before arranging cells.
2. For a two-level hierarchy, partition the parent rectangles first, then lay out each parent's children within its rectangle. Sort siblings by descending share, then by stable id for ties. Use a squarified tiling: append the next item to the current row only while it improves that row's worst aspect ratio; lay each row along the shorter side of the remaining rectangle. Use this tie-break consistently so identical data yields identical geometry. Do not exceed two levels in a static diagram.
3. Snap cell edges to the 4 px layout grid and leave equal 4 px gutters. Recalculate resulting areas after snapping; keep relative area error within the verifier's published tolerance, checking the smallest cell most closely. Do not stretch or shrink one cell to make labels fit.
4. Label tiers are based on actual text measurement: large cells can hold name, value, and share; medium cells name and value; small cells only a compact abbreviation when it fits; slivers carry no text. A cell at least 12×12 px may contain a centered information mark if it stays inside the boundary; smaller slivers are identified by their legend entry and stable position.
5. Give every cell an appropriate legend entry. If a category cannot be drawn faithfully or remains invisible at the target size, merge it into a named “Other” rather than silently dropping it. Include a source line that states the area encoding, dataset, and date.

## Visual encoding

Area is the data encoding. Use a restrained ink-opacity ramp for neutral cells and one accent cell at most, with accent stroke as a focal cue. Do not use a rainbow, gradient, 3-D, or shadow. State the measure in the source line (for example `AREA = POPULATION`). Name the ramp by contrast strength, not “darker/lighter,” because its apparent lightness changes with the skin. Keep cell labels on the paper-safe label layer and use a mask where patterned backgrounds could show through.

## Korean text

Use Pretendard for cell names and mono for exact values, shares, and source notes. Keep the same unit and decimal precision across all cells; use one Korean thousands and decimal convention. Preserve official category names, and use a legend mapping when an abbreviation is necessary. Avoid rotated Korean text. Follow [Korean typography](korean-typography.md).

## Light, dark, and full variants

All variants use the exact same shares, geometry, label tiers, and focal cell. Light and dark skins change semantic tokens, not opacity values or area. Recheck text contrast against each composited cell fill; midtone fills behind small text are not acceptable. A full editorial layout may add a title, one interpretation sentence, a source line, and a short legend outside the plot without changing cell sizes.

## Accessibility

Provide a title and description stating what area encodes, the whole, the leading components, and how “Other” is composed. Name every cell in an adjacent legend/table, including unlabeled slivers. Color reinforces the area only; the accent does not define ranking. Ensure the information mark, if used, stays inside its cell and that names and values meet text contrast. Supply the exact source data as a text alternative for audit or reuse.

## Verifier gates

Run `scripts/verify-diagram.mjs` for bounds, overlap, clipped text, contrast, skin polarity, visible text, and a11y. Run `scripts/verify-type.mjs --type=treemap` to compare `data-share` against drawn area, validate whole reconciliation, layout budgets, relative error, marker containment, and text bindings. Inspect the smallest cell and the ramp in both rendered skins.

## Anti-patterns

- Stripe tiling, uneven gutters, or layout changes that cannot be reproduced from the same input.
- Missing or fabricated cells, or a total contradicted by displayed rounded values.
- Treating area as an exact share after snapping without checking relative error.
- Rotated or tiny text used to rescue an undersized cell.
- Rainbow colors, dark/light legend language, shadows, or using accent to imply largest.
- A sliver with no legend entry or metadata share.

## Related references

[Bar chart](type-bar.md) · [Nested](type-nested.md) · [Tree](type-tree.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
