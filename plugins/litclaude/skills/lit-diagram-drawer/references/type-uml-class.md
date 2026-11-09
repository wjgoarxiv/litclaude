# UML class diagram

**Catalog ID:** `uml-class`

## Purpose and selection

Use this diagram for static object structure when operations, inheritance, composition, or typed class relationships matter. Use an ER diagram for entities, attributes, and cardinality; use Sequence, State, Swimlane, or Architecture for the corresponding UML behavior, state, activity, or deployment views. This guide covers class-diagram grammar only.

## Content schema

Prepare up to seven classes, each with a name, optional `interface` stereotype or abstract marker, selected attributes, and meaningful operations. Each member includes visibility, name, and type/signature. Prepare up to eight relationships from the defined vocabulary: inheritance, realization, composition, aggregation, association, or dependency. Association endpoints state multiplicity. Choose one focal class and list all six relationship kinds in a compact legend so the notation is unambiguous.

## Deterministic layout recipe

1. Group classes by package or domain role, then place the focal/base type centrally with subclasses or implementers nearby. Prefer straight links or one orthogonal elbow per relationship. Split by package when routes cross repeatedly.
2. Draw each class as one content-sized box with up to three compartments: centered name, attributes, operations. Omit empty compartments rather than padding boxes to equal height. Keep each member on one line; overflow beyond five members in a compartment becomes an explicit ellipsis or a separate detail view.
3. Draw connectors before boxes using orthogonal routes with rounded elbows. Use fan-out attach points separated enough to distinguish parallel relationships. Keep labels on opaque paper masks with clear space around the line.
4. Place multiplicities close to association endpoints on both sides. Put the composition or aggregation diamond at the owner end. Define every marker in the SVG and include all six notations in the legend, even when some are unused.
5. Keep to seven classes, eight relationships, five members per compartment, and two accent elements. Four or five classes is the normal target; split dense packages instead of shrinking text.

## Visual encoding

Use a stable, explicit line and endpoint vocabulary: inheritance uses a solid hollow triangle; realization uses a dashed hollow triangle; composition has a filled ownership diamond; aggregation has a hollow ownership diamond; association uses an open arrowhead and multiplicities; dependency uses a dashed open arrow. Do not swap composition and aggregation. Use accent for the focal class and, as one grouped cue, its inbound inheritance/realization edges. Keep member visibility symbols and signatures in mono.

## Korean text

Use Pretendard for class names and short stereotypes; use mono for typed attributes, method signatures, visibility signs, and multiplicities. Preserve source-language identifiers verbatim when they are code symbols; explain them in a concise Korean caption if needed. Avoid breaking method signatures across lines. Follow [Korean typography](korean-typography.md) for Hangul line height and mixed names.

## Light, dark, and full variants

Class positions, compartments, relationship types, and multiplicities must match across the three skins. Use the paper token for hollow marker interiors and semantic line tokens for outlines. The full editorial form may add package framing and a short explanation of the focal class; it must not add decorative class boxes or imply unlisted members. Check every marker against the background after export.

## Accessibility

Supply a title and description naming the domain, focal class, and most important relationships. Keep line style and arrowhead shape redundant with legend text; line color alone must never distinguish relationship types. Ensure multiplicities and members remain readable, and ensure an SVG reader can access class names and relation labels in a sensible order.

## Verifier gates

Run `scripts/verify-diagram.mjs` for clipping, overlap, connector geometry, contrast, skin, visible-text, and a11y. Run `scripts/verify-type.mjs --type=uml-class` for class/member caps, marker vocabulary, relationship direction, multiplicities, and connector joins. Inspect dense elbow crossings and all six legend keys at presentation size.

## Anti-patterns

- Listing every getter, setter, or implementation detail instead of the members needed to explain the model.
- Using class boxes when the story is entity fields and cardinalities.
- Composition and aggregation used as synonyms, or association without endpoint multiplicities.
- Diagonal connectors, omitted legend markers, or unlabeled stereotype symbols.
- Equal-height boxes with large empty compartments.
- Accent on several unrelated classes or relationship kinds.

## Related references

[ER diagram](type-er.md) · [Sequence](type-sequence.md) · [State machine](type-state.md) · [Architecture](type-architecture.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
