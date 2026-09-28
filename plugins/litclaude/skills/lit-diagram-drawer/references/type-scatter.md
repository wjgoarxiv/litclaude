# Scatter plot

**Catalog ID:** `scatter`  
**Companion catalog entries:** [Bubble](type-bubble.md) · [Beeswarm](type-beeswarm.md).  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Scatter when the relationship between two continuous variables is the point: correlation, clusters, outliers, or high/low performers. Choose Bubble only when a third, positive magnitude matters; its area needs a separate encoding contract. Choose Beeswarm when one distribution and each observation matter. If a chart is plotting scientific measurements as a scientific result, use the scientific-visualization workflow.

## Exclusions

Use 5–30 points for the standard scatter. Fewer points are usually clearer in prose or a table; more points become a density problem and should be binned or shown with Beeswarm if every observation is meaningful. Do not add a third size scale, unreported jitter, a forced fit line, or labels on every point. Keep the meaning and range of both axes explicit.

## Content schema

```yaml
title: "Service latency and error rate"
x_axis: { label: p95 latency, min: 0, max: 500, unit: ms }
y_axis: { label: Error rate, min: 0, max: 5, unit: "%" }
points:
  - { id: checkout, label: Checkout, x: 260, y: 2.8, focal: true }
  - { id: search, label: Search, x: 180, y: 0.9 }
trend: none                    # optional; only when supported by the data
quadrant_guides: false         # optional median guides
```

Every point has a stable ID and finite x/y values within declared bounds. Label the focal point and no more than two additional outliers. An optional trend line must have a stated model or honest descriptive purpose. Optional median guides label all four regions and remain visual aids rather than new variables.

## Deterministic layout recipe

Use a 1000×500 viewBox with plot bounds x=80..960 and y=40..420. Map each coordinate linearly to those bounds: x increases left-to-right, y increases bottom-to-top. Draw 4–6 equally spaced ticks on each axis, with grid rules aligned to ticks. Give standard points a fixed radius of 5px and a single focal point 6px. Place at most three point labels on paper-backed backgrounds, trying a fixed order of offsets (above-right, above-left, below-right, below-left) and selecting the first that clears prior labels and axes. Never shift the point center. Draw an optional muted dashed trend rule only after confirming that its direction is supported by the data. Reserve the bottom footer for a compact legend or source footnote.

## Encoding rules

Point position encodes x and y. Point size and fill opacity are fixed; only one point may use the accent. Add a fit line only if it clarifies a real pattern, and never use it to imply causation. Include zero in an axis when absolute position needs it; if a useful range omits zero, print the visible bounds prominently. Keep units and scales visible, note any omitted observations, and bind each label/tick to its associated data point or value. Bubble size and beeswarm packing rules live in their companion guides.

## Korean behavior

Use concise Korean axis titles with units and a consistent number format. Keep values and `%`, milliseconds, or other units together. Use Pretendard for prose and the shared mono face for ticks/identifiers. For Korean point labels, use a short phrase and wrap only on word boundaries; a longer name belongs in a side key rather than over the cloud. Preserve Latin service IDs exactly.

## Light, dark, and full variants

All skins preserve point coordinates, scales, ticks, focal point, and label bindings. Light/dark switch shared tokens; confirm grid and mark outlines against each paper surface. Full adds a small editorial title and one interpretation note around the unchanged plot, not a new scale or data series.

## Accessibility

Provide title and description naming both variables, units, bounds, the focal point, and any trend fit. Supply a text table with one row per item and x/y values. Mark focus in text as well as by accent, and ensure circles have visible strokes at presentation size. Keep quadrant labels, if used, explicit rather than relying on position alone. See [Accessibility](accessibility.md).

## Verifier gates

Run `node scripts/verify-diagram.mjs` for bounds, overlaps, label clipping, contrast, skin polarity, accessible SVG, and visible-text checks. Run `node scripts/verify-type.mjs --type=scatter` to validate the catalog marker. No specialized scatter proof is registered; manually compare point coordinates and tick labels with the declared axis bounds. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- More than 30 unlabeled-density points, one label per mark, or silently omitted extremes.
- A trend line forced onto scattered data or interpreted as causal evidence.
- Bubble size used without the separate Bubble contract, or a third variable smuggled into color.
- Moving a point to prevent collision, or using inconsistent bounds for different points.
- Truncated axes with no printed range, or axes whose units are unclear.
