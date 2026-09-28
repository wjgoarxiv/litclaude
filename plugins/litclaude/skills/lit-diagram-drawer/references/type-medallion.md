# Medallion data tiers

Catalog ID: medallion

## Purpose and selection

Use this type for a governed data pipeline with ordered quality and access tiers, such as landing, raw, cleaned, curated, and archive. Each tier card states the container, format, accountable writer, and a concrete sample payload. Promotion arcs describe transformations from one adjacent tier to the next; optional path cards describe write methods.

## Exclusions

Use High-Level for a full platform topology, data-flow for role-by-step responsibilities, and Marimekko for measured composition. Do not use medallion for an arbitrary row of services or for an ungoverned process with no data-quality promotion. Do not imply a promotion or access policy that the source has not established.

## Content schema

Provide 3–5 ordered tiers, each with a stable name, storage bucket or location, exactly one focal flag across the diagram, and fields for tool, format, writer, and one or two example payloads. Provide one promotion label for every adjacent pair and declare normal, focal, or lifecycle semantics. Include a sample-data caption. Add zero to two optional write-path cards with tag, method title, and short description. Choose exactly one focal tier; if none is supplied, ask which analytical or policy pivot should lead.

## Deterministic layout recipe

Use a horizontal tier strip with 172 × 380px cards, 16px gaps, 16px left inset, and an 80px arc band above the cards. Place cards at y=80, with centers evenly spaced across the strip. The canonical five-tier SVG is 1040px wide; derive width from tier count and gaps, and retain a 100px right legend margin. Reserve a 16px gap and 56px height per path card below the tiers. Promotion arrows are cubic curves over the top, from the center of one tier to the next; control points sit at y=0, their labels at y=50. This arc is the defining connector and a specific exception to orthogonal routing. The total height covers arc band, cards, optional path row, legend, and bottom margin. Use a deterministic 4px grid for card and frame geometry.

## Encoding rules

Use quiet neutral cards with a 40px header band and four labeled information fields; keep the example payload visibly separate near the bottom. Styles distinguish outer input, ordinary tier, the one focal tier, and cold archive. The focal tier gets a restrained accent outline and tint; its incoming arc may use accent, while a terminal lifecycle arc remains dashed. Use at most two justified custom colors outside the focal tier. Promotion is left-to-right only. Do not put transformations into path cards: path cards name how data moves, while tier fields describe what the tier contains.

## Korean behavior

Use concise Hangul names for stages and field headings, with storage identifiers and format names preserved as authored. Set the field order consistently across every card so Korean readers can compare the same slot from tier to tier. Wrap long tool, format, and writer strings to two lines within the field width; add an adjacent expanded description rather than shrinking labels. Use Pretendard for Korean text and mono for technical formats, bucket paths, and abbreviated tags. State all transformations in language the audience uses.

## Light, dark, and full variants

Light and dark variants retain card size, order, fields, arcs, sample payloads, and focal tier. In dark mode invert surface roles, retain dashed archive treatment, and lighten custom colors only as required for contrast. Full editorial adds an outer framing title, subtitle, and optional summary cards outside the tier strip. It must not omit a tier or reorder transformations. Export to slides with the Office guide's safe margins and a table fallback for field-level detail.

## Accessibility

Add an SVG title and description that state the number and order of tiers, promotion meaning, focal tier, and terminal archive semantics. Every card field needs a visible heading; do not rely on color to identify the focal tier or lifecycle. Provide a linear text list or table of tier fields, particularly when the figure will be inserted in Office. Keep arc labels clear of the curve and the card text.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for card bounds, overlaps, arc-label spacing, clipping, contrast, skin polarity, SVG semantics, and visible text. Run scripts/verify-type.mjs --type=medallion to confirm tier count and order, four fields per tier, one sample payload per tier, exactly one focal tier, adjacent left-to-right promotions, path-card cap, and marker landing. Compare the visible data with the source before export, inspect the screenshot, and run humanizer checks on all text.

## Anti-patterns

- No unique payload example on a tier.
- More than one focal tier or a guessed focal policy.
- Bidirectional or non-adjacent promotion arcs.
- Straight through-gap arrows instead of top arcs.
- A cold dashed treatment on a non-archive tier.
- More than two custom-colored components or color-coded connector semantics.
- Path cards that explain what a tier stores instead of how data is written.
- Text too long for the fixed tier card, hidden behind an export crop.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md)
