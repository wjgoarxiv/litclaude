# Venn diagram

**Catalog ID:** `venn`

## Purpose and selection

Use a Venn diagram to explain meaningful overlap between two or three named sets: shared traits, eligibility groups, or a conceptual intersection. Use a matrix for four or more sets, or a table when exact membership matters more than the overlapping shape. Do not use circle area as a quantitative claim unless the source membership counts and geometry were deliberately computed and verified.

## Content schema

Define two or three sets with stable ids, names, optional short descriptions, and their membership records. For every region (each set-only area and every intersection), provide the intended label or explicitly mark it empty. State whether circles are conceptual or quantitatively sized. If an intersection is the focal point, name it in the brief rather than choosing one after rendering.

## Deterministic layout recipe

1. Use two circles for one pairwise comparison or three circles for a three-way overlap. Assign centers and radii on the 4 px grid. Use equal radii for comparable conceptual sets; vary radii only when the intended relative set sizes are supported by source data.
2. Arrange circles symmetrically around the intended common area, leaving clear outer label positions. Verify that every required intersection exists and is large enough to hold its label. Do not distort a circle to make text fit.
3. Put each set name outside its circle with enough clearance from the stroke. Put region labels in the open area they describe. If an overlap is too small, use a short leader to a label in clear space and keep the connection unambiguous.
4. Use low-opacity fills so overlaps remain visible. Highlight one intersection with a restrained accent fill or outline, never both every region and all circles. Add a simple legend only when the membership encoding needs explanation.

## Visual encoding

Circle boundaries identify sets; geometric overlap identifies shared membership. Use soft, related fills and clear hairline borders. Do not make a third set appear as a new color alone; label it. If the numbers of members are not encoded faithfully by circle and intersection areas, state that the diagram is conceptual and provide exact counts in an adjacent table or text.

## Korean text

Use Pretendard for set names and intersection labels. Keep labels concise and name the shared property explicitly. Do not let Hangul labels cross circle borders; use phrase-level wrapping or a leader to a clean label position. Use mono only for exact counts or source identifiers. Follow [Korean typography](korean-typography.md).

## Light, dark, and full variants

Centers, radii, overlaps, and label placement remain identical in light, dark, and full variants. Change semantic surface/fill tokens only and verify compounded overlaps remain distinguishable. In the full version, a concise title and short explanation can sit outside the set geometry; never add decorative circles that look like extra sets.

## Accessibility

Include a title and description that name every set and explain each relevant overlap. Give each circle a visible set name. Text or line style must reinforce any highlighted intersection; color alone does not define membership. Provide the exact set membership or counts in a text alternative when the shape is quantitative.

## Verifier gates

Run `scripts/verify-diagram.mjs` for circle bounds, label clipping, overlaps, contrast, skin, visible text, and a11y. Run `scripts/verify-type.mjs --type=venn` for two/three-set limits, circle geometry, required membership regions, and label placement. Inspect overlap regions in both skins and at the target Office size.

## Anti-patterns

- Four or more circles crowded into one page.
- Missing set names or unexplained empty/intersection regions.
- Circles that do not overlap when intersection is the point.
- Label text touching a circle stroke or floating without a region association.
- Quantitative area claims made by a conceptual sketch.
- Accent color on several overlaps so no one region is focal.

## Related references

[Nested](type-nested.md) · [Treemap](type-treemap.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
