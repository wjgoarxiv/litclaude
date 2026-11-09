# IT current state

Catalog ID: it-state

## Purpose and selection

Use this type to show the present-day legacy landscape before a modernization or consolidation. Zones group organizational phases, departments, or technical domains; components name real systems; labeled handoffs expose file shuffling, manual work, and brittle integrations. The intended reading is the current operating picture, including pain points, not the proposed target architecture.

## Exclusions

Use High-Level or DP integration for the proposed platform; architecture for runtime components and service links; and a table for an inventory without meaningful relationships. Do not draw a future-state target in the same picture unless explicitly requested as a before/after pair. A connector from a footer concern to one component is usually a category error because the footer describes a cross-cutting service.

## Content schema

Provide a title, subtitle, and optional eyebrow; choose one orientation; define 2–4 ordered zones with a short name; and list 1–5 components per zone with unique ID, name, optional technical sublabel, optional catalog icon, and kind standard, focal, or external. Define connectors by component IDs with short label, semantic style, optional icon, and optional dashed flag. Add at most three unconnected cross-cutting footer bars. The legend lists only styles actually used, plus focal and external when present. Keep pain-point rationale and source period in a note.

## Deterministic layout recipe

Default to horizontal flow on a 4px grid. Set x padding to 16px, zone gap to 20px, zone top to 52px, and zone height to 360px. Derive each zone width from a 200px base plus 24px per component, then snap widths and distribute the remaining space evenly; never hand-adjust a zone to rescue a label. Inside a zone, inset components 20px, use 56px height (68px if focal, 72px when two-line subtext is needed), and separate rows by 32px. Zone labels sit on a small paper-colored break in the upper border. Footer bars start 24px below zones, are 56px high with 8px gaps, and share the canvas width inside the side margins. Add 40px for the legend and 24px lower breathing room. For vertical orientation, keep x padding=16px and stack the zones from y=52 with a 20px gap. Each zone spans the available 968px width; its height is 112px plus 24px per component. Place the zone label 20px from the top-left, then place its component cards in a single left-to-right row, each 56px high (68px focal, or 72px when subtext wraps), separated by 16px; divide the usable width evenly and give the final card any rounding remainder. Cross-zone links leave the source bottom and enter the destination top. Footer bars follow the last zone using the same 24px offset and row formula as horizontal orientation. Compute viewBox height from the final zone, footer rows, 40px legend, and 24px lower margin; do not rotate or mix zone orientations.

## Encoding rules

Standard components have a plain paper fill and ink outline. Focal components get an accent tint and accent outline; allow no more than two. External components use a muted dashed outline. Link style distinguishes ordinary data handoff, external/network link, and focal/pain-point route; a dashed stroke adds optional or manual transfer meaning. Put a short label and optional monochrome icon near the source end with a visible offset from the connector. Route with rounded orthogonal elbows; connectors must touch destination edges and may not cross through nodes. Cross-cutting footers have no outgoing connectors. Cap custom color overrides at three, and never apply them to a focal node.

## Korean behavior

Retain official product and institution spellings; add concise Korean explanations for acronyms when known. Keep the zone name short enough to fit horizontally. Use two-line Hangul sublabels rather than tiny type. Pretendard is the default sans face; reserve mono for file formats, protocol names, system IDs, and connector tags. Follow the shared rules for slash spacing, dates, units, and Korean/Latin boundaries.

## Light, dark, and full variants

Light and dark versions use the same zone/component inventory, coordinates, edge semantics, and legend order. Apply semantic token inversion and recheck the dashed external boundary, focal tint, and connector-label mask. The full version may frame the SVG with title, one-sentence scope, source/date note, and a short “current friction” summary outside the diagram. It must not add target-state systems into the current-state map.

## Accessibility

Add a title and description that identify the time period, zone sequence, focal pain points, and external systems. Each icon has a text label. Directional handoffs are named in labels or a nearby linear text outline. Do not rely on accent color alone to identify a bottleneck; include a visible focal style and name the concern in text. Apply contrast and reading-order requirements from [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for orthogonal routing, overlap, off-canvas edges, clipping, contrast, skin polarity, SVG semantics, and visible text. Run scripts/verify-type.mjs --type=it-state to check zone count, component limits, valid endpoint IDs, focal and external styles, footer bar count, and legend coverage. Inspect both orientation layouts in a rendered screenshot when vertical mode is used; run the humanizer check over all labels and notes.

## Anti-patterns

- Mixing future platform services into a “current” map without a separate panel.
- More than four zones, five components per zone, or sixteen total components.
- Diagonal edges or arrowheads that stop short of destination borders.
- A focal treatment on every failure point.
- Connected footer bars that imply ownership or flow they do not express.
- Tiny acronym-only labels where stakeholders cannot identify a system.
- Retaining arbitrary source colors or decorative shadows.
- Reordering phases to make the drawing prettier rather than more truthful.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [High-Level](type-high-level.md)
