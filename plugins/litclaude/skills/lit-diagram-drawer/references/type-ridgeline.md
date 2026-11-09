# Ridgeline

**Catalog ID:** `ridgeline`  
**Parent family:** distribution variant of Line; select `ridgeline` directly when each row is a distribution, not a value at each time.  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Ridgeline to compare several distributions on a shared horizontal scale when shape, spread, or multimodality matters more than a summary percentile. A ridge represents one distribution. Use a histogram for one distribution, small multiples for two, Line for a time series, or a table of percentiles when shapes are alike and a compact exact summary is clearer.

## Exclusions

Use 3–12 distributions, 8–40 shared bins, one unit and x-domain, and one shared amplitude. The grammar does not show sample size or total volume: each distribution is normalized to its own count before shared scaling, so ridge height is concentration/shape, not traffic. Different units or x-ranges cannot share this layout. Avoid smoothing unless the method and true bin vertices are explicit; default is unsmoothed straight segments.

## Content schema

```yaml
title: "Request latency distributions"
unit: "ms"
x_domain: [0, 500]
bins: [0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 500]
normalization: probability-density-per-series
amplitude: 1.0                  # one shared peak-to-pixel factor
series:
  - { id: checkout, label: Checkout, counts: [0, 1, 6, 17, 21, 14, 8, 6, 7, 9, 7, 4, 0], focal: true }
  - { id: search, label: Search, counts: [0, 2, 7, 13, 18, 15, 11, 8, 5, 3, 2, 1, 0] }
```

Every ridge has the same bin count, x-domain, and known bin values, with zero at both ends so its path returns to baseline. Record the normalization and shared amplitude. At most one ridge is focal. If absolute population size matters, add an explicit sample-size label or choose a chart that encodes volume.

## Deterministic layout recipe

Use a 1000×500 viewBox. Shared x-run is 320–680; map each bin linearly across this span. For `n` ridges, use baselines at `y=152+56i` for five rows; when `n` differs, center the fixed 56px-pitch stack vertically. Convert normalized density to height with the same amplitude for every row. Draw each ridge as a closed polygon: start at the baseline, draw straight segments through each bin point, return to the baseline, close. Do not use splines. Put the series name left of its baseline and its nonzero x-range right of it, aligned to that row. Put bin labels below the stack and one vertical amplitude caption at the left. Draw baselines, then neutral ridges from top to bottom, then the focal ridge and labels. No gridlines.

## Encoding rules

X-position is the shared value domain; vertical height is normalized density. State both in the source note/description, and state that total volume is not encoded. Use one accent ridge and a restrained ink-opacity ramp for others, with fixed stroke weights and low-opacity fills. Keep range labels bound to the bins they summarize. A common amplitude is essential: do not normalize ridge heights independently to make every profile equally tall. Any overlap is deliberate and limited to the next row; peaks must not obscure two rows above.

Bind each ridge path with a unique `data-ridge`, its zero baseline in `data-baseline`, and its ordered comma-separated bins in `data-bins`. Draw one baseline rule per ridge using the same `data-ridge` and `data-role="baseline"`; bind name/range labels to that ID with `data-role="name"` or `data-role="range"`. Each bin tick carries `data-tick` (index) and `data-bin` (value). The checker reads raw geometry, so do not move a path, label, or ancestor with transforms or CSS geometry.

## Korean behavior

Keep every ridge name on its baseline and x-range in the same unit. Use Korean service/cohort labels as concise nouns. Format the shared x-axis units once, and keep bin values and units together. If Korean names wrap, reserve a wider left gutter for all rows; never alter ridge centers or amplitude to make room.

## Light, dark, and full variants

Use identical distributions, shared domain, amplitude, baseline pitch, and accent target in every variant. Light/dark change only shared tokens; use skin-neutral ramp wording such as “strongest tone,” not “darkest.” The full variant may add a small editorial frame or summary cards with already-declared statistics; it may not imply volume from ridge height.

## Accessibility

Describe the measure, unit, domain, normalization, shared amplitude, and meaning of vertical height. Provide a text table with each series name, nonzero range, and any separately declared sample size. Do not rely on opacity or accent to identify rows. Keep outlines contrast-visible and provide a nonvisual statement that overlapping outlines are separate distributions.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for overlaps, off-canvas geometry, clipping, contrast, skin polarity, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=ridgeline` to compare every bin vertex against one shared domain/amplitude, validate baselines/pitch, range labels, endpoint closure, series count, and variant parity. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Private amplitude or baseline for one ridge, or reading volume from ridge height.
- Different domains, units, or bin centers across rows.
- A path that starts/ends above baseline, clips mass, or invents a peak with smoothing.
- Too-tight pitch that hides the row above, one color per series, or a “darker is faster” key.
- One or two ridges, more than twelve, or ranges omitted from a shape-only comparison.
