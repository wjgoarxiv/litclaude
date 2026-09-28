# Layer stack

Catalog ID: layers

## Purpose and selection

Use a layer stack for ordered abstractions that sit on top of one another: protocol stacks, application layers, system boundaries, memory levels, or policy layers. One shared width makes the hierarchy and direction easy to compare.

## Exclusions

Use swimlane when groups perform concurrent work; use architecture for components linked across zones; use nested when containment is the meaning; and use a table for a flat list. Do not use stacking as decoration for items with no parent/child or ordered relationship.

## Content schema

Provide a title and one explicit ordering principle, such as higher-level to lower-level or request to physical storage. Supply 4–6 ordered layers. Each layer has a short name, optional index or stable ID, and a concise note or technical detail. Identify zero or one focal layer and state why it deserves emphasis. Declare direction in words.

## Deterministic layout recipe

Use a centered stack 800–880px wide in a 1000px viewBox. Place 4–6 full-width horizontal bands, each 56–72px high, with no vertical gap; use the same x and width for all layers. Allocate a 56px left gutter for a direction marker and 24px internal side padding for text. Each row has a mono index at left, a 14–16px semibold layer name near the left-center, and a muted sublabel aligned right. A 1px hairline separates rows and a stronger outline bounds the entire stack. Snap band edges to the 4px grid. If sublabels do not fit, shorten them or provide a separate key; do not vary row height to fit arbitrary prose.

## Encoding rules

Choose one fill strategy for the entire stack: paper with hairline separators, or two alternating near-paper tones. Give one focal layer a restrained accent tint and outline. All others stay neutral. Put an up/down arrow and a short label outside the stack to declare ordering. Use no inter-layer arrows unless a specific transfer relation is separate from the layer order; the vertical arrangement already communicates sequence.

## Korean behavior

Keep layer names in Hangul where the audience is Korean, and retain common protocol names such as TCP/IP and HTTP as authored. Put English expansions in a note if they materially help. Use Pretendard for Korean names; mono indices are short. Allow a two-line note only if every layer uses the same rule. Avoid narrow vertical lettering and preserve a generous line height for Hangul.

## Light, dark, and full variants

Light and dark variants preserve layer order, focal layer, band height, and labels. Swap semantic fills and strokes, not the meaning of the direction arrow. The full editorial version can add a small context sentence and source note above or below the stack; do not add summary cards that repeat each layer's name. Avoid a textured background in embedded slide versions.

## Accessibility

Use SVG title and description to state what is layered and which direction to read. Keep the direction phrase in text, not only in an arrow. Provide a numbered text list for screen readers and grayscale print. Contrast must hold on both the focal tint and the alternating row fills.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for bounds, row overlap, clipping, contrast, skin inversion, SVG semantics, and visible text. Run scripts/verify-type.mjs --type=layers to check 4–6 rows, common width, ordered IDs, one focal maximum, consistent fill mode, and direction marker. Inspect a render at the final size and run humanizer checks on title, labels, and notes.

## Anti-patterns

- Layers that are not actually hierarchical.
- Skipped numbering with no explanation.
- A different strong hue on every layer.
- Unequal heights without a meaning.
- Arrow clutter between adjacent bands.
- A focal stripe that is not named in the title or description.
- Rotated Hangul labels or unreadably small detail.
- Extra framing that forces the useful stack below the fold.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md)
