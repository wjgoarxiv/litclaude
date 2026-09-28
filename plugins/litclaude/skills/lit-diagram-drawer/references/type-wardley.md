# Wardley map

**Catalog ID:** `wardley`

## Purpose and selection

Use a Wardley map to reason about a value chain against component evolution: what is user-visible, what is a dependency, and what is moving toward commoditization. It is a strategy map, not a runtime architecture. Use Architecture for deployed components and connections, or a dependency graph when graph topology is the primary story.

## Content schema

Each component needs a stable id, short name, value-chain position, evolution band, and its dependency links. Record which components are moving, their rightward destination or time horizon, and the evidence behind the placement. Use up to nine components, twelve links, and two movement arrows. Each component must take part in the value chain through at least one incoming or outgoing dependency.

## Deterministic layout recipe

1. Fix a two-axis plot. The horizontal axis has four qualitative bands in order: Genesis, Custom-built, Product, Commodity. The vertical axis runs from more visible to the user at top to invisible at bottom. Add no numeric tick values.
2. Place each component inside the appropriate evolution band and value-chain level. For repeatability, use an agreed sub-band position (early/middle/late) and a stable vertical order derived from the chain. Record the placement rationale in the source or companion notes.
3. Draw dependency links as thin straight lines without arrowheads; this is the deliberate exception to the shared orthogonal-connector default because the coordinates are map data. Position represents evolution and visibility. Label dependencies only when the source data needs a qualifier. Avoid bending a line into another semantic type.
4. For a moving component, draw one short right-pointing dashed accent arrow toward the next evolution band. Keep it clear of nearby dependency lines and component labels; add an on-arrow note only for a meaningful time horizon or driver.
5. Add a compact legend for component, dependency, and movement. Keep axis captions horizontal; stack short “visible to user”/“invisible” labels beside the y-axis rather than rotating text.

## Visual encoding

Band position encodes qualitative evolution; vertical position encodes value-chain visibility; links encode dependency; a dashed right-pointing arrow encodes movement toward commodity. Use plain component circles and one accent movement cue. Evolution is not a numeric score, and movement cannot point left. Keep visual language consistent in every band.

## Korean text

Use Pretendard for component names and mono for band names, source notes, and concise timing tags. Use the exact evolution terms agreed by the project; if localizing them, keep the English band mapping in the legend or metadata. Place visible/invisible captions horizontally in Korean. Keep component names short and leave room for Hangul without shrinking the symbols. Follow [Korean typography](korean-typography.md).

## Light, dark, and full variants

Preserve component positions, dependency topology, and rightward movement in every variant. Light/dark skins change only semantic colors; ensure dependency lines remain visible at their intended low emphasis. A full editorial version can add a title, one takeaway about build/buy/movement, and a source note around the same map, without moving points or claiming quantitative precision.

## Accessibility

Provide a title and description that explain both axes, every component's placement, and any movement arrow. Name the four bands visibly. Movement has both direction and text/legend meaning; do not use accent alone. Dependency links remain distinguishable from movement arrows by line style and arrowhead. Avoid rotated axis text and maintain contrast for small components and lines.

## Verifier gates

Run `scripts/verify-diagram.mjs` for off-canvas marks, overlap, clipping, contrast, skin, visible text, and a11y. Run `scripts/verify-type.mjs --type=wardley` for band bounds, component/link caps, linked-component participation, and movement direction/count. Inspect dependency crossings and movement labels in both skins.

## Anti-patterns

- Treating evolution as a continuous numeric maturity score.
- Numbering the visibility axis or implying it is measured.
- A component with no dependency connection, or a leftward movement arrow.
- Runtime request/response flow drawn as map dependencies.
- Too many movement arrows or a label that simply restates “toward commodity.”
- Vertical-writing axis captions or movement labels placed over a dependency crossing.

## Related references

[Architecture](type-architecture.md) · [Dependency graph](type-dependency.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
