# Streamgraph

**Catalog ID:** `streamgraph`  
**Parent family:** [Line and quantitative chart guidance](type-line.md)

## Purpose and selection

Use a streamgraph to show how a nonnegative total and its composition change across many evenly spaced periods. The outer envelope shows total volume; the layers show each component's share. Use a bar chart or table when exact per-period values matter, a line chart for a few trend points, and a 100% stacked area when only proportions matter.

## Content schema

Supply 3–24 ordered periods and 2–6 named layers. Each layer has one nonnegative numeric value for every period, one stable display name, and a declared unit. Keep zero periods in the dataset. Provide a shared scale, the total for each period, and the source/date context. If data is illustrative, say so. Layer names contain no digits so the legend's numeric total remains unambiguous.

## Deterministic layout recipe

1. Fix the plot rectangle and period positions evenly from left to right. Use a symmetric baseline at its vertical center. At each period, sum all layer values and multiply by the one shared linear scale. Set the stack top to `baseline − totalHeight/2` and the bottom to `baseline + totalHeight/2`.
2. Choose one fixed stack order for the entire chart. Put the largest aggregate layers nearest the center line and keep that order at every period; order changes would make a band's identity jump.
3. For each period, accumulate layer thicknesses from the lower boundary. Use the same scale for every layer and period. Preserve a true zero as a zero-thickness pinch; do not interpolate or drop it.
4. Draw boundaries as smooth curves whose control points preserve the true period vertices. If using the canonical smoothing recipe, keep control points at one-sixth of the chord; never shift vertices to make the silhouette smoother. Add a thin paper-colored separator between neighboring fills.
5. Omit y-axis ticks and gridlines. Label periods below the plot, and put each layer's name and total in the legend. Mark at most one landmark period with a short leader and mono label. Include the shared scale or bucket size in a source line.

## Visual encoding

Use one restrained ink-opacity ramp for nonfocal layers and one accent layer selected for the point of the story. The largest aggregate layer receives the strongest neutral tone; the accent does not automatically mean the largest. The envelope height encodes total volume; layer thickness encodes amount. Do not use a 100% normalization or private scale per layer. Use skin-neutral legend language such as “strongest tone.”

## Korean text

Use Pretendard for layer names and period captions; use mono for totals, dates, units, and source metadata. Keep the same unit across all layers and spell it once in the axis/source line. Prefer short names without digits; if a Korean service identifier inherently includes a numeral, provide a separate short label that contains no additional number in the legend while retaining the true identifier in metadata. Follow [Korean typography](korean-typography.md) for number formatting and Hangul line height.

## Light, dark, and full variants

Keep the dataset, layer order, stack geometry, scale, and landmark the same in all variants. Light and dark skins resolve the same ink opacities against their own paper token; check separator visibility and layer distinction after rendering. A full editorial layout may add a finding headline, a short caption, and a source note around the same plot. Do not add text inside layer shapes.

## Accessibility

Provide a description that states the periods, unit, shared symmetric baseline, total trend, and focal layer. Name every layer in the legend and report its aggregate total. Since adjacent fill tones may be close, labels and legend order must identify each layer; hue cannot be the only cue. Avoid text over fills and confirm separators are visible in both skins and in grayscale.

## Verifier gates

Run `scripts/verify-diagram.mjs` for rendered overlaps, clipping, contrast, skin polarity, visible text, and a11y. Run `scripts/verify-type.mjs --type=streamgraph` to recompute each stack boundary, fixed order, shared scale, symmetric envelope, period/layer caps, zero handling, and legend bindings from declared data. Inspect the smallest layer and zero pinch at presentation size.

## Anti-patterns

- A shifting baseline, bottom-anchored stack, or independently normalized layer.
- Uneven period spacing where periods are equally spaced, or changing stack order.
- Dropping zero periods, smoothing away real vertices, or reading exact values off the envelope.
- Too many layers for the palette or text placed on colored areas.
- A legend that describes opacity by a lightness direction that reverses between skins.
- Multiple landmark callouts that compete with the overall silhouette.

## Related references

[Line chart](type-line.md) · [Bar chart](type-bar.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
