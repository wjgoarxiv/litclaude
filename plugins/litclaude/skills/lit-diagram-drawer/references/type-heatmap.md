# Heatmap

Catalog ID: heatmap

## Purpose and selection

Use a heatmap when a complete row-by-column matrix needs to be scanned and the important comparison is which intersections are relatively stronger or weaker. Typical inputs are service × release, team × week, or class × predicted label. Treat every cell as data, not decoration. Choose one editorial focal cell only when the title makes a claim about that exact intersection.

## Exclusions

Use a table when there are fewer than three rows or columns, a line chart when order and change over time dominate, and a bar chart when readers must compare exact values across categories. Use a diverging palette only for signed values around a meaningful zero or midpoint. If labels force cells below a legible size, split the matrix or summarize it; do not silently remove categories.

## Content schema

Provide a title that states the comparison; complete ordered row and column labels; one numeric value for every intersection; unit and period; any filter or missing-data rule; one declared scale mapping; optional displayed cell values; and zero or one focal row-column pair with the reason it matters. Missing values must be marked as missing, not encoded as zero. The data binding on each cell carries its row ID, column ID, and value; a separate paper underlay carries no data binding.

## Deterministic layout recipe

Use a 1000 × 500 viewBox. Reserve x=40..160 for row labels, y=40..64 for column labels, x=960 as the right edge, and y=420 as the plot floor; leave the lower band for source, legend, and scale key. Start with 4–7 rows and 3–8 columns. Compute cell width and height uniformly from the available plot rectangle after fixed 4px gutters; keep width at least 80px and height at least 36px. If the grid cannot meet both floors, reduce the number of categories through an explicitly named Other group or split into related panels. Right-align row labels in the left gutter, center column labels above cells, and align all grid coordinates to the 4px baseline. Never apply SVG transforms to cells, underlays, labels, or their parent group.

## Encoding rules

Use one monotone ink-opacity ramp for non-focal cells. Declare the domain and transformation in the key; the opacity must never decrease as the value increases. Exclude the focal value when fitting the ramp so an outlier cannot flatten every other cell. Keep the ramp visible at its low end and below the point where cell text loses contrast. Use one accent tint and border for the chosen focal cell. Print exact values inside cells only when they fit; otherwise supply a complete table adjacent to the graphic. If an exact value is required, the key states units and bounds rather than implying that tone is a precise lookup scale.

## Korean behavior

Keep Korean row and column names in Hangul. Use Pretendard for category text and the mono role only for short technical codes or numeric values. Allow two-line wrapping in the label gutters; widen the gutter before shrinking type. Use the common Korean guidance for number grouping, percent signs, units, and mixed Hangul-Latin spacing. Do not rotate Hangul labels to rescue a cramped grid.

## Light, dark, and full variants

Light and dark skins retain identical cell geometry, order, values, and scale. Only semantic color tokens invert; recheck contrast for the darkest non-focal fill and the focal tint in each skin. The full editorial version may add a short framing sentence, source note, and compact conclusion outside the plot. It must not add cells or change the encoding. Keep the legend and source line in the same order across skins.

## Accessibility

Give the SVG a concise title and a description naming the dimensions, measure, period, and focal claim. Never make hue the sole carrier of magnitude: retain the ordered contrast ramp and a text key. Provide a data table for screen readers and for export contexts where cell values matter. Ensure each cell value and axis label meets the text-size and contrast requirements in the accessibility guide.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for bounds, overlap, rendered clipping, contrast, skin polarity, accessibility, and visible-text checks. Run scripts/verify-type.mjs --type=heatmap; it must confirm the complete Cartesian grid, unique row and column bindings, monotone non-focal opacity, focal count, and printed-value agreement. Review a screenshot at presentation size and confirm that no label is clipped. Then run the humanizer check on visible text.

## Anti-patterns

- One unrelated hue per row or column, which makes category identity compete with the quantity ramp.
- A rainbow or two-ended ramp for unsigned counts and rates.
- More than one accent cell or auto-accenting the numeric maximum without checking the story.
- A continuous gradient key that suggests precision the colors do not provide.
- A missing row or column that quietly changes the displayed population.
- A transformed cell whose checked coordinates differ from rendered coordinates.
- Tiny labels, sideways labels, or numbers that collide with the grid.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Line chart](type-line.md)
