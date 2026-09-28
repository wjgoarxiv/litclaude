# Quadrant

**Catalog ID:** `quadrant`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md) · [Consultant scenario variant](type-quadrant-consultant.md)

## Purpose and selection

Use Quadrant to position a small set of named items against two independent, meaningful axes: prioritization, portfolio review, or product positioning. Position inside the cells matters. If the brief wants four named futures with a short narrative in each cell and no within-cell position, select the separate `quadrant-consultant` catalog entry. Use a table if precise ranks or scores need comparison.

## Exclusions

Do not use the quadrant for more than two dimensions, time series, large point clouds, or categories with no interpretable axes. Items exactly on an axis have ambiguous membership; ask for a placement rule or keep them out of the chart. The standard grammar is capped at twelve points.

## Content schema

```yaml
title: "Work to do first"
x_axis: { label: Impact, low: Limited, high: Broad, min: 0, max: 10 }
y_axis: { label: Ease, low: Difficult, high: Easy, min: 0, max: 10 }
items:
  - { id: auth, label: Access review, x: 8, y: 8, focal: true }
  - { id: cache, label: Cache cleanup, x: 5, y: 6 }
```

Each item carries a stable ID, short label, and x/y values on the declared axes. Normalize both coordinates to the plot range; keep raw values available for visible labels only when exactness matters. At most one item is focal. Axis endpoint terms explain direction; quadrant captions are optional and short.

## Deterministic layout recipe

Use a 1000×560 viewBox with a plot rectangle x=160..840, y=104..424. Put the cross at the midpoint `(500,264)`. Map values linearly: `px=160+680×(x−xmin)/(xmax−xmin)` and `py=424−320×(y−ymin)/(ymax−ymin)`. Draw the two hairline axes through the center, leaving arrow tips and one-word axis labels outside the plot margins. Place each point at its mapped coordinate; keep point marks small and labels 8–10px away. Use a fixed label-placement order (above-right, above-left, below-right, below-left), then choose the first candidate that clears the point, axis, and prior labels. If none fits, reduce the number of items or split the chart; never move the point. Keep labels away from axis lines.

## Encoding rules

Position is the data. Use a small neutral circle for ordinary items and one accent focal point. Do not fill the four cells with different colors. Name both axes, their direction, and their units or scales. Optional quadrant captions sit in the corners and remain subordinate to item labels. If scores are illustrative, say so plainly; do not use approximate placement as a claim of measurement.

## Korean behavior

Keep axis names and endpoint labels short, one line where possible. Use Korean directional terms with clear low/high meaning; do not rely on arrows or color to explain polarity. Korean item names may wrap to two lines. Keep item labels within the plot and avoid breaking mixed Hangul/Latin identifiers or numeric units.

## Light, dark, and full variants

The three variants use the same axis ranges, point positions, label placements, and focal item. Light/dark changes are token-only. The full variant may add a compact interpretation card or a few editorial callouts outside the plotting area; no card may restate every point, and the 2×2 plot itself must remain primary.

## Accessibility

Include title and description naming both axes and the key focal item. Provide a reading-order list of item labels and values. A screen reader must hear each item's two axis values; the focal state must be stated in text. Ensure axes and point outlines meet non-text contrast, with labels readable independently of the mark color.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for collisions, label bounds, clipping, contrast, skin parity, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=quadrant` to validate the catalog marker; manually compare point positions with declared axis bounds and labels. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Four differently colored cell fills, unlabeled axes, or labels placed over the axis cross.
- Points on either axis without an explicit placement policy.
- More than twelve items or moving a point to make its label fit.
- Axis glyphs, vague labels such as “good/bad,” or unsupported score precision.
- Using this point plot for four scenarios that belong in the consultant variant.
