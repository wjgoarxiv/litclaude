# High-Level with vertical concern rail

Catalog ID: high-level-vertical

## Purpose and selection

Choose this catalog entry when the central reading is a left-to-right platform pipeline plus a compact right-hand rail of cross-cutting concerns. The rail makes orchestration, security, observability, governance, or backup visibly span the lifecycle. It is a variant of the High-Level stack, with the same component and connector vocabulary.

## Exclusions

Do not add a vertical rail simply to fill unused space. If there are no cross-cutting concerns, use [High-Level](type-high-level.md). If concerns belong to individual services rather than the whole platform, show them beside those services or use an architecture diagram. Do not place arbitrary labels vertically; the rail must express ordered, system-wide scopes.

## Content schema

Reuse the High-Level input schema: ordered horizontal phases, source cards, cluster components, explicit connections, and a unique focal component. Add an ordered rail list of concern IDs and one matching cross-cutting bar per concern. Reserve names such as Orchestration, Security, Observability, Governance, and Backup for this rail. Use a declared short name, optional subtitle, and at most two justified concern-color overrides. If the orchestration stage has a bar, it occupies a cluster-wide horizontal strip and has a matching orchestration rail entry.

## Deterministic layout recipe

Fix the SVG at 1000px wide. Reserve x=972..1000 for the 28px rail and x=964..972 as empty breathing room; all pipeline geometry stops at x=964. Use the 1000 × 600 reference canvas for three rail items and two concern bars. Place horizontal phases at y=4..32 and the source / cluster body at y=40..376. Start the concern bars at y=388, then advance 44px per row; each bar is 40px tall. Allocate the rail's vertical height from y=40 through the bottom edge of the last bar, dividing that span equally among rail entries; the last segment absorbs any grid remainder. Use a flat leading edge, a point at each segment's end, and a centered notch between neighboring segments. Rotate the rail labels -90 degrees around the segment center, but keep all other labels horizontal. Keep diagram edges attached to nodes, not the rail, unless a concern-specific relationship is explicitly in the data.

## Encoding rules

The main phase chevrons encode pipeline order. Rail chevrons encode coverage, not additional process steps. Pair each rail entry one-to-one with a named concern bar below the cluster. The bar supplies concrete implementation detail; the rail supplies its scope. Use one modest highlight on a real concern, retain accessible text for each rail item, and draw vertical text only for short English rail tags where the glyphs remain readable. Preserve semantic link styles from the High-Level guide. Never use rail colors to imply security status without a legend and a stated meaning.

## Korean behavior

Use concise Hangul labels for concern bars and keep the rail's narrow vertical tag in a short English acronym only when it is a registered system term; put the full Korean concern name in the paired horizontal bar. Do not rotate a Korean phrase into the rail. Keep brands and protocol names unchanged, set Korean in Pretendard, and apply the shared spacing and numeral rules.

## Light, dark, and full variants

The light and dark variants share the exact rail division, phase widths, node coordinates, and connections. In dark mode, map all elements through semantic tokens; re-check paper-colored text on rail fills, especially for a custom color. Full editorial adds framing text around the SVG, not an extra concern or component. Keep the HTML viewport horizontally scrollable at small widths instead of scaling labels below the output-spec minimum.

## Accessibility

Provide an SVG title and description and a second horizontal list of rail concerns for assistive technology. The vertical labels supplement that list; they do not replace it. Preserve reading order as pipeline, concern rail, then concern bars. Color cannot be the only cue linking a rail segment to its paired bar. Prevent the rotated labels from entering the page reading order twice if a text equivalent is supplied.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for clipping, overlap, contrast, dark-skin polarity, title/description, label readability, and viewport overflow. Run scripts/verify-type.mjs --type=high-level-vertical to check rail count, equal segments, rail-to-bar pairing, reserved clear gap, and identical pipeline membership to the base type. Confirm no horizontal content enters the x=964..972 gutter. Inspect the screenshot at desktop and narrow viewport widths; then run humanizer checks on all visible text.

## Anti-patterns

- A floating rail that has no corresponding horizontal concern bars.
- Concern bars with no rail segment, or two rail segments claiming the same bar.
- Using the rail as a second set of workflow stages.
- Putting long Hangul labels in 28px-wide segments.
- Connecting components to rail segments as though they were nodes.
- Compressing the entire 1000px canvas to phone width instead of using a local horizontal scroller.
- Adding rails for decorative symmetry.

## Related references

[High-Level](type-high-level.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Semantic patterns](semantic-patterns.md)
