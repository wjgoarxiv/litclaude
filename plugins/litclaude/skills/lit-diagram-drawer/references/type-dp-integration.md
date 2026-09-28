# Data Platform Integration

**Catalog ID:** dp-integration

## Purpose and selection

Choose this type to inventory the systems that connect into a data platform, the platform components they touch, the consumers it serves, and the protocols on those links. It is a topology, not a timeline. Use data flow when ownership across sequential stages is central; use the security matrix when permissions are central.

## Content schema

Declare external sources, an ordered platform interior, consumers, and optional cross-cutting services such as identity or observability. Each endpoint has a stable name, kind/icon key, optional subtitle, and explicit connections. Connections name both ends and carry protocol or purpose. Platform rows may be a full-width service bar or a row of peer components. Limit ordinary source and consumer groups to six each; keep the common case near 14–20 named nodes only when the integration surface itself is the message. Combine truly identical systems with a count and split domains that create a hairball.

## Deterministic layout recipe

Use a 1200px-wide viewBox. Reserve 160px side columns at x=40 and x=1000 for sources and consumers. Place source/consumer nodes at y=92 plus 88px per row, with 64px height. Center the platform zone between them at x=260 with width 696; its height matches the side columns and has explicit padding. Allocate platform bars and peer rows top-to-bottom from a cursor, keeping the primary component row vertically aligned with the second side-column row. Put cross-cutting bars below the zone, each 56px high with 8px separation. Derive canvas height from the last footer and reserve a legend band.

Draw the platform boundary, then connectors, then nodes and footer bars. Edges between side columns and platform use right-to-left ports; bar-to-component triggers leave the bar bottom and enter from the component top. Cross-cutting services connect to the platform boundary, not an arbitrary tool. Route with orthogonal 8px elbows, stagger repeated fan-out ports, and label meaningful protocol edges on clear masks. Avoid intersections; use a small bridge only when rerouting is impossible.

## Encoding rules

Sources stay visibly outside the platform boundary; consumers stay on the opposite side. Internal paths are neutral, protocol/federation paths use a distinct dashed style, and orchestration triggers are dashed and unlabeled if their meaning is in the legend. A focal component or focal handoff may use the accent. Identity and observability remain cross-cutting services rather than ordinary platform nodes. Do not color every vendor differently.

## Korean behavior

Use Korean for section names and captions while retaining exact service names, protocols, and ports. Use Pretendard for visible names and mono for protocol labels, identifiers, and codes. Explain technical abbreviations once; avoid line breaks within API names. When localizing source/consumer labels, retain exact English platform product names.

## Light, dark, and full variants

Light uses a dashed source/platform boundary, a quiet platform surface, and restrained neutral edges. Dark rebuilds these boundaries and the protocol palette for contrast. Full adds title, takeaway, scope, and a compact legend beneath the drawing. Preserve every endpoint, path, and count between variants.

## Accessibility

Describe the platform boundary and the main source-to-platform-to-consumer paths. Provide a route table for protocol and endpoint details. Include text beside every icon, identify line styles in a legend, and preserve reading order from sources through the platform to consumers. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for zones, edge overlaps, clipping, contrast, accessibility, and text. Run scripts/verify-type.mjs --type=dp-integration for side-column budgets, endpoint integrity, zone geometry, footer behavior, and connector style rules. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Collapsing several known endpoints into one “sources” or “consumers” node.
- Replacing labeled connections with one bus arrow.
- Coloring every tool as though vendor identity were the hierarchy.
- Placing identity inside the boundary when it governs all platform components.
- Mixing a phase chevron banner into a topology with no phase question.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
