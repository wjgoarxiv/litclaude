# Polar chart

**Catalog ID:** `polar`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Polar for one nonnegative quantitative series across 4–8 categories whose cyclic order is meaningful: hours in a day, months in a seasonal cycle, or ordered phases that wrap. Radius encodes magnitude; angle encodes category position. Use Radar for several entities measured on the same criteria, Bar for categories without a circular order, and Line for longer ordered time sequences.

## Exclusions

The first version is static and supports one series, 4–8 equally spaced categories, a linear scale starting at zero, and at most one focal category. Do not use it for personality/competency wheels, arbitrary point placement, multiple series, negative values, unequal sector widths, log scales, filled wedges, or a donut baseline. Missing values are unknown, not zero; resolve them before drawing.

## Content schema

```yaml
title: "Requests by time window"
unit: "% of daily peak"
scale: { min: 0, max: 100 }
start_angle: -90
clockwise: true
categories:
  - { id: night, label: "00–03", value: 32 }
  - { id: early, label: "03–06", value: 18 }
  - { id: morning, label: "06–09", value: 24 }
  - { id: midday, label: "09–12", value: 58 }
  - { id: peak, label: "12–15", value: 100, focal: true }
  - { id: afternoon, label: "15–18", value: 82 }
  - { id: evening, label: "18–21", value: 76 }
  - { id: late, label: "21–24", value: 45 }
```

Provide 4–8 uniquely named categories in meaningful order, finite values within the shared range, explicit unit, and optional one-category focus. Keep input order; do not sort by value. The `min` must be exactly zero and `max` finite and positive.

## Deterministic layout recipe

Use a 1000×520 viewBox, center `(500,230)`, and outer radius `R=160`. Draw five circular guide rings at 20%, 40%, 60%, 80%, and 100% of `R`. For category `i` among `N`, calculate `theta = start_angle + s×2πi/N`, with `s=+1` clockwise and `−1` counter-clockwise; convert start angle to radians. Compute `r=R×value/max`, then endpoint `(500+r cos(theta), 230+r sin(theta))`. Draw the faint category spoke to the outer ring and a value ray from center to endpoint. Put category text at radius `R+28`, value text at `R+44`; keep labels horizontal, with start/end/middle anchor chosen by the side of the circle. Place scale labels on the top spoke only. A value of zero gets a printed zero but no ray or endpoint marker. Drawing order: paper, rings, spokes and ring labels, non-focal rays, focal ray, markers, category/value labels, legend.

## Encoding rules

Only ray length encodes value. Markers have constant radius; rings and spokes are structural guides, not data. Use muted rays for ordinary categories and one accent ray at most. Do not fill sectors or vary line width by value. Keep the category order and the common zero baseline visible. Store each category's declared value and computed angle/radius as machine-readable metadata for `verify-type`.

The polar verifier contract is carried in SVG attributes: put `data-polar-chart` and the shared `data-polar-cx`, `data-polar-cy`, `data-polar-radius`, `data-polar-min`, `data-polar-max`, `data-polar-start-angle`, `data-polar-clockwise`, `data-polar-radius-encoding="linear"`, and `data-polar-inner-radius="0"` on the root SVG. Wrap each category in a `<g>` with `data-polar-category`, `data-polar-index`, and `data-polar-value`; add `data-polar-focal="true"` only to the single focal category. Give every ray, spoke, and rule line exactly its corresponding `data-polar-ray`, `data-polar-spoke`, or `data-polar-rule` role; mark all five rings with `data-polar-ring`, endpoints with `data-polar-marker`, and value labels with `data-polar-value-label`. The optional canvas rectangle is identified by `data-polar-background`. Keep raw coordinates readable to the checker: no transforms or CSS geometry that could move a verified mark.

## Korean behavior

Keep category order and angles identical across language variants. Prefer short labels; place longer Hangul labels on one or two horizontal lines outside the ring. Keep units in the subtitle or a single legend statement rather than repeating them in every value label. Use Korean numeral formatting consistently, and do not break time ranges or units across lines.

## Light, dark, and full variants

Light/dark keep identical values, coordinates, order, and focus; only shared tokens change. The full variant may add an editorial frame and short interpretation cards, but chart geometry remains fixed. Static output only; do not add hover, drag, or animation.

## Accessibility

The SVG description names the measure, shared scale, category order, and maximum category. Include an ordered text alternative with category/value pairs and unit. Keep all labels horizontal, use numeric labels so color is not required to read the chart, and ensure spoke/ray contrast against each skin. Decorative rings are hidden from the accessible name.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for bounds, clipping, contrast, skin polarity, accessibility, overlaps, and visible-text checks. Run `node scripts/verify-type.mjs --type=polar` to recompute the five rings, spokes, angles, ray lengths, zero values, unique labels, and light/dark geometry parity from the declared input. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Truncated nonzero inner baseline, donut hub, filled wedge, or area encoding.
- Sorting categories by magnitude or placing unequal angles without a declared reason.
- Treating missing data as zero, adding a minimum visible ray, or plotting multiple series.
- Rotated/tangent labels, category-specific colors, or more than one accent target.
- Using polar coordinates when circular order adds no information.
