# Marimekko chart

Catalog ID: marimekko

## Purpose and selection

Use a Marimekko chart for a two-way part-to-whole view: column width represents each category's share of the total, segment height represents each series' share within that category, and each segment's area therefore represents the joint share. It answers which categories are large and how their internal composition differs.

## Exclusions

Use a treemap for one part-to-whole hierarchy, a 100% stacked bar when category widths should be equal, a grouped bar when comparing series totals across categories, and a table when precise ranking is primary. Do not use categories with different units in one column. More than eight categories or five series usually makes cells too narrow to label.

## Content schema

Supply a total and unit; 3–8 ordered categories; 2–5 ordered series; and an amount for every present category-series pair. State the source, period, rounding policy, missing-series policy, and one optional focal cell. Categories and series must use stable IDs; order series by descending overall total, with source order as the tie-breaker. Bind every data segment to category ID, series ID, and amount; bind every label, caption, and key to the same identifiers. Missing pairs are omitted, not represented as zero-height rectangles.

## Deterministic layout recipe

Use a 1000 × 500 SVG with plot bounds x=40..956 and y=40..420. Start with 4px constant gutters between columns; compute each column width from its category total divided by the grand total, after subtracting all gutters, then snap boundaries to whole pixels while preserving the total plot width. Each column spans the full 380px plot height. Within a column, order series consistently by descending overall total and allocate segment heights by within-column share. Segments tile from top to bottom with no vertical gaps; shared boundaries use a hairline. Use a 4px grid for plot constants and column edges; data-driven segment boundaries use whole pixels and are not snapped. Below the plot, place each category name and whole-share under its column; reserve a lower strip for series keys and a source line. For screens narrower than 760px, preserve chart width and use a local horizontal scroller.

## Encoding rules

Column width, within-column height, and segment area all state related facts, so every dimension must be derived from the declared amounts. Keep one ink-opacity level per series in a rank-ordered neutral ramp and one focal accent segment at most. Print the amount and within-column share inside sufficiently large segments; the focal label may clarify its share of that category to avoid implying a whole-total share. Narrow cells use an information mark only when it fits fully; explain that cell in the key. Never widen a column or pad a segment for text. State that width is category share, height is within-category share, and area is joint share. The chart shows a whole: merge a small tail only into a named Other category or series and disclose it.

## Korean behavior

Use Hangul for category and series names when intended for Korean readers. Retain data units and official product names. Use Korean number grouping and percentages consistently, and distinguish within-category percentages from whole-total shares in both captions and labels. Pretendard is used for names; the mono role is for amounts, units, and concise IDs. Preserve stable category order while wrapping captions at phrase boundaries. Never rotate or abbreviate labels into ambiguity.

## Light, dark, and full variants

Light and dark layouts share every column width, segment height, amount, category order, series order, and focal choice. Use identical ramp opacity values while semantic paper/ink tokens invert; check text contrast on each series fill. Full editorial may add a framing headline, one takeaway, and source/date note outside the plot, without changing the geometry. Set a 760px minimum canvas inside a local scroller; do not shrink data marks to fit a phone viewport.

## Accessibility

Add SVG title and description identifying the total, unit, period, category and series counts, both encodings, and any focal cell. Supply a companion data table with whole and within-category shares. Never use fill tone alone to identify a series; the keys name the series and repeat the same visual token. Explain information-mark cells in text and ensure every narrow column can still be identified by its caption and table row.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for clipping, overlap, label fit, mobile overflow, contrast, skin polarity, SVG accessibility, and visible text. Run scripts/verify-type.mjs --type=marimekko to recompute column-width, segment-height, and joint-area shares from amounts; check tiling, constant gutters, stable series order, complete bindings, focal count, marker containment, and total reconciliation. Inspect a narrow viewport screenshot and a full-size export; run humanizer checks on all visible text.

## Anti-patterns

- Equal-width columns when category totals differ.
- Unequal column heights or gaps between segments.
- Reordering a series inside only one column.
- Drawing an absent category-series pair as a zero-height segment.
- Dropping a category or series without an explicit named aggregation.
- Expanding marks to fit labels or using rotated type in slivers.
- Claiming area is comparable while width or height has been manually adjusted.
- Naming ramp direction by lightness when light and dark invert it.

## Related references

[Treemap](type-treemap.md) · [Heatmap](type-heatmap.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md)
