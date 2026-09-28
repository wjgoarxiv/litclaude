# High-Level stack

Catalog ID: high-level

## Purpose and selection

Use this parametric layout for an end-to-end platform stack where the reader needs to see the stages from external sources through ingestion, storage, transformation, and consumption, with deployment scope and cross-cutting operation visible. It suits a compact platform overview, not a detailed network topology. Exactly one focal component should explain the title's main point.

## Exclusions

Use IT current-state for a legacy before-picture; deployment for runtime placement by zone, host, artifact, replica, and port; architecture for a general service topology with detailed links; or data-flow for ownership and transformations at each pipeline step. Do not use this pattern when the platform is not deployed to a cluster-like boundary or when the stages do not form an ordered stack.

## Content schema

Supply ordered horizontal phase chevrons with positive integer weights; up to four external sources with role and destination IDs; cluster components with globally unique ID, name, stage, kind, optional icon, short role tag, and optional subtitle; explicit directed connections with relationship kind; exactly one focal component; and an ordered list of vertical concerns. Component kinds are node, orchestration bar, or cross-cutting bar. Each vertical concern pairs with one cross-cutting bar, and an orchestration bar pairs with the orchestration chevron. Unsupported or unknown IDs fail validation instead of becoming guessed nodes.

## Deterministic layout recipe

Use a 1000px-wide SVG. When vertical concerns exist, reserve a 28px strip at x=972 and an 8px breathing gap; the main body ends at x=964. Place the phase banner at y=4 with 28px height. Partition body width by the declared phase weights, snapping boundaries to 4px and assigning any rounding remainder to the last phase. Put the external source zone at x=4, y=40, sized from the first stage width; start the cluster after that source zone at y=40. The default cluster is 336px high. Place one standard node column at each phase center; nodes are 152 × 80px with 16px row gaps. Stack multiple nodes top-down, below the orchestration bar when present. External sources stack in the left zone, no more than four. Cross-cutting bars occupy 40px rows at y=388 + 44k. Derive total height from the last row, plus legend and bottom margin. Vertical chevrons divide y=40 to the last concern row evenly. Build every coordinate from this schema so equal input yields equal SVG.

## Encoding rules

The phase chevrons name progress through the stack; they do not encode quantity. Use a dashed external-source boundary, quiet cluster outline, solid internal primary links, dashed optional or trigger links, and a distinct dashed query/read-back link. Route connectors orthogonally with rounded elbows and separated attachment points. A link touching the focal component may take the accent token; all other links stay muted. Use one icon only where it resolves a recognizable role. Keep phase names short and node subtitles technical. Up to two custom concern colors may identify a real security or governance role; they never recolor links.

## Korean behavior

Keep product and organization names as written. Write phase names in plain Korean and keep English abbreviations after the Korean expansion on first use. Avoid squeezing Korean inside narrow chevrons: use short terms or the matching glossary; do not rotate body labels. Pretendard carries all Korean UI text, while the mono role is reserved for IDs, protocol names, and ports. Follow the Korean typography reference for two-line subtitles and number spacing.

## Light, dark, and full variants

The light skin uses paper and ink surfaces, a restrained accent, and quiet boundaries. Dark skin flips the semantic roles and preserves identical geometry, flow, and emphasis; check accent and custom-color contrast again. Full editorial adds a page eyebrow, title, one-line deck, and optional source/footer outside the SVG. It does not add platform nodes or change stage allocation. The vertical-rail variant is a separate catalog entry; follow [high-level-vertical](type-high-level-vertical.md) when the rail is the defining structure.

## Accessibility

Use SVG title and description, with the description naming source zone, cluster, major stages, cross-cutting concerns, and the focal component. Keep phase text horizontal. Every connection must also be explained by direction and a concise label or by an unambiguous stage order; never make color the only difference between primary, query, and trigger links. Ensure icon-only marks have adjacent text and provide a linearized text summary for the exported figure.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for connector overlap, off-canvas paths, clipping, contrast, light/dark polarity, SVG accessibility, and visible text. Run scripts/verify-type.mjs --type=high-level to validate phase membership, source and node budgets, focal uniqueness, bar/rail pairing, and orthogonal edge endpoints. Inspect a rendered screenshot at the selected output size, then run humanizer checks on titles, tags, subtitles, and edge labels.

## Anti-patterns

- Placing nodes outside the phase whose label they occupy.
- More than four source cards, an overcrowded phase, or a component list with no focal rationale.
- A vertical strip without a matching concern bar or a cross-cutting bar without its paired concern.
- Diagonal connectors, shared attachment points, or arrows hidden behind later nodes.
- Custom-coloring every chevron, component, or connector.
- Using dot texture behind the diagram by default or adding shadows to nodes.
- Treating the cluster boundary as proof of network isolation when that has not been specified.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Vertical rail variant](type-high-level-vertical.md)
