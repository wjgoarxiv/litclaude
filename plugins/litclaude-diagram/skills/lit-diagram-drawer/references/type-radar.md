# Radar and spider chart

**Catalog ID:** `radar`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Radar to compare 3–5 entities across 3–5 quantitative criteria on one shared, normalized scale. It is useful when several dimensions form a recognizable profile. Use a table or grouped bar chart for two entities, many criteria, or exact values that readers need to compare; use Polar for one series across cyclic categories.

## Exclusions

All axes must be meaningful, measurable, and comparable after explicit normalization. Do not mix units without a declared transformation, use more than five axes or series, begin at a nonzero baseline, or treat the polygon area as an extra value. Two-series charts usually have clearer alternatives. A measured scientific dataset belongs in the scientific-visualization workflow when that is the requested task.

## Content schema

```yaml
title: "Storage options"
scale: { min: 0, max: 10 }
axes: [Latency, Durability, Cost, Operations, Portability]   # 3–5
series:
  - { id: local, label: Local, values: [8, 6, 7, 5, 8] }
  - { id: managed, label: Managed, values: [7, 9, 6, 8, 7], focal: true }
  - { id: community, label: Community, values: [6, 7, 7, 6, 6] }
```

Every series has exactly one finite value per axis within the shared range. Normalize source measures before drawing and record the method/meaning of the common scale. Keep axis order fixed across every series and skin. At most one series is focal.

## Deterministic layout recipe

Use a 1000×560 viewBox, center `(500,240)`, and outer radius `R=160`. For axis `i` of `N`, set `angle=−π/2+2πi/N` and outer vertex `(cx+R cos(angle), cy+R sin(angle))`. Draw five closed polygon rings at fractions 0.2, 0.4, 0.6, 0.8, 1.0; spokes connect center to each outer vertex. For value `v` on scale maximum `S`, its vertex is `center+(v/S)×(outer_vertex−center)`. Round optional serialized coordinates consistently, but do not alter values. Place one-word axis labels 16px beyond their outer vertex. Put numeric scale ticks along the top axis only. Paint non-focal polygons in stable input order from smallest area to largest, then focal polygon and focal vertices, then legend. Preserve the same series order in the legend.

## Encoding rules

The normalized value along each spoke carries the comparison; polygon fill is only a light translucent aid. Use an editorial series palette with one accent focal series, not one arbitrary hue per item. Show focal vertex markers only on the focal series. Label series by name in the legend; label axis criteria directly. Do not truncate the zero baseline. State the normalization so a “7” has one interpretation on every spoke.

## Korean behavior

Shorten axis names to one word in Korean when possible. Keep scores and denominators explicit, e.g. `7/10`, and state whether high means more or better. Preserve identical axis order in the Korean version. A two-line axis label is allowed only when placed outside the plot and not overlapping its neighbor; otherwise use an explanatory key.

## Light, dark, and full variants

Light/dark preserve data, geometry, series order, normalization, and focus. Only shared tokens and contrast-safe palette variants change. The full variant may add a short summary for the focal option and brief comparison cards; those summaries must not introduce values absent from the chart.

## Accessibility

Include SVG title/description naming the entities, criteria, scale, normalization, and focal series. Provide a table-like text alternative with one row per entity and one value per criterion. Ensure patterns and labels distinguish series in grayscale; do not make polygon hue the sole identity cue. Keep grid and spokes subtle but perceptible.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for bounds, overlap/clipping, contrast, skin polarity, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=radar` to validate the catalog marker. No specialized radar proof is registered; manually compare the declared values, axis order, and coordinates across variants. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- More than five series or axes, two-series radar, or a mixed scale with no normalization.
- A truncated inner ring, non-quantitative axes, or a polygon area presented as a metric.
- Dots on every series, a rainbow, multiple focal series, or unlabeled polygons.
- Axis labels in mono type, text over the grid, or different axis order between skins.
