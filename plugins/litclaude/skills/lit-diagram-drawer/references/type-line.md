# Line chart

Catalog ID: line

## Purpose and selection

Use the line entry when ordered time or index points form a continuous trend and the story concerns direction, pace, or turning points. It can show one or a small number of comparable series. This canonical type is for editorial product and operational diagrams; measured scientific data and statistical analysis belong to the dedicated scientific-visualization workflow.

## Exclusions

Use a bar chart for discrete category comparison, a slopegraph for exactly two states with direct endpoint comparisons, a bump chart for rank movement across snapshots, and a ridgeline for distributions rather than one observation per period. Do not join gaps in the data. Avoid more than five series or twelve points in the base chart.

## Content schema

Provide ordered x values and labels; one unit-consistent y value per series and x; declared source, period, and missing-data policy; a shared numeric domain with sensible tick labels; one optional focal series with editorial rationale; and a legend or direct labels. A value is numeric metadata and visible text must agree with it. For product-level summaries, say whether values are actual, sampled, or illustrative.

## Deterministic layout recipe

Use a 1000 × 500 viewBox. Plot bounds are x=80..960 and y=40..420, with axis captions and legend below. Use 4–12 evenly spaced x positions, computed across plot width; use 4–6 horizontal grid lines from the declared y domain. Map y to position with one linear scale for all series. Use a polyline with straight segments; focal stroke width is 1.8px and other lines are 1.2px. Show point dots only on the focal series when several lines are present. If the chart has one short series, dots at all observations may be used. Reserve the lower key band for one sample per series and one source line. Keep design constants on a 4px grid; do not snap data-derived point coordinates.

## Encoding rules

The common plot is allowed a restrained series palette because color helps track a line through many points; use palette order without skipping and reserve the accent for one focal series. Pair hue with direct names, stroke-weight distinction, and optionally dash patterns. Do not use smooth curves to imply unobserved values. Include zero when absolute magnitude comparison requires it; otherwise state the chosen domain and reason. A gap remains a gap. A title makes the takeaway explicit while the axes retain units and scale.

## Korean behavior

Use Korean period labels when the audience is Korean, with the same interval and ordering as the source. Format dates, values, percentages, and units consistently with the shared Korean guide. Use Pretendard for axis and series names; use mono for tick values and short technical units. Do not rotate Hangul labels. Widen margins or abbreviate at phrase boundaries rather than reducing text below the output preset.

## Light, dark, and full variants

Light and dark skins use the same domain, positions, line order, gaps, labels, and data. Recheck line contrast and ensure the series palette remains distinct on both papers. Full editorial may add a title, one takeaway sentence, source/date, and one explanatory annotation outside the plot. It cannot change the plotted data or use decorative motion. See the companion slopegraph, ridgeline, streamgraph, and bump guides for their own grammars.

## Accessibility

Provide SVG title and description with measure, period, units, domain, series count, and missing-data policy. Use direct series labels or a readable key; do not make color the only series identifier. Include the data as a text table when precise values matter. Keep grid lines subordinate but visible and all data marks distinguishable in grayscale.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for bounds, line/text overlap, clipping, contrast, skin polarity, SVG semantics, and visible text. Run scripts/verify-type.mjs --type=line to compare bound values, x ordering, shared domain, gaps, point count, and printed labels. Inspect the rendered chart for crossings, label collisions, and false continuity. Run humanizer checks on title, axis captions, annotation, and key.

## Anti-patterns

- Spline smoothing through sparse observations.
- Connecting across a missing interval.
- Inconsistent or undisclosed scales across series.
- More than five series without splitting into panels.
- Hiding an important baseline or using a cropped y-axis without explanation.
- Dots on every point of every dense line.
- Using a scientific-data plot here when its uncertainty and analysis belong to the scientific-visualization workflow.
- Changing plotted coordinates to give one label more room.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Slopegraph](type-slopegraph.md) · [Ridgeline](type-ridgeline.md) · [Streamgraph](type-streamgraph.md) · [Bump chart](type-bump.md)
