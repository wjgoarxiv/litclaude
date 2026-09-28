# Traceable block decomposition

**Catalog ID:** `tree-block-decomposition`  
**Parent grammar:** [Tree / hierarchy](type-tree.md)

## Purpose and selection

Use this semantic pattern when a system must be decomposed into individually addressable blocks that readers can cite and trace to implementation. Each block remains a noun-like structural element. The hierarchy shows parentage; metadata carries the fuller block record. Use a process type for actions, a dependency graph for cross-block relationships, and Architecture for a small set of runtime zones.

This is a SysML-informed documentation pattern, not a claim of SysML, IDEF0, XMI, or tool-certified conformance.

## Content schema

Every node needs a stable hierarchical id (for example, `PAY-001-02`), noun-phrase name, and implementation path. Every nonroot node also has a parent id. Its complete record contains inputs, outputs, constraints, assumptions, and implementation reference. An optional short input/output pair may appear as the node sublabel only when both fit without crowding. Keep longer values in a sidecar block registry beside the editable source; the visual tree is not the full record.

The SVG node's metadata binds `data-block-id`, `data-block-parent`, and `data-block-name`, plus concise `data-block-input`, `data-block-output`, `data-block-constraint`, `data-block-assumption`, and `data-block-impl` fields when supplied. The visible id badge must exactly match its metadata. When the user asks for structured traceability data, export an opt-in `<diagram-basename>.registry.json` sidecar with a `source` basename and a `blocks` array in source-document order. Project only values already present in the `data-block-*` attributes; omit absent fields and the root's parent key. Do not infer or supplement records, and do not generate the registry by default. Do not put credentials, private source excerpts, or sensitive implementation details in an exported diagram.

## Deterministic layout recipe

1. Follow the Tree layout: root above its children, with short vertical stem, orthogonal sibling bus, and drops into child boxes. Keep a stable sibling order and one parent for every nonroot block.
2. Place the id badge as a compact tag inside the node box. Put the block name in the normal name slot. A short I/O qualifier may occupy the existing sublabel line; it never becomes a separate connector label.
3. Snap tree geometry to the layout grid. Keep the root-plus-three-tier maximum and five-per-level ceiling, with the stricter global maximum of nine nodes. Split at subsystem boundaries and preserve stable ids between diagrams when the hierarchy is larger.
4. Draw connectors before boxes. Do not add I/O arrows between siblings or cousins; that changes the layout into a dependency graph. Avoid visible constraints or assumptions that would turn a compact map into a specification wall.
5. Verify that the registry contains every block and that each visible badge, node, metadata record, and implementation reference resolves to the same stable id.

## Visual encoding

The tree owns the connector grammar and layout. This pattern adds only the id badge and optional brief ports; it adds no new line styles, status colors, or edge labels. Keep IDs in mono and structural names in Pretendard. The accent budget remains at most two elements, but a traceability tree normally needs no focal color.

## Korean text

Use concise Korean noun phrases for block names; names identify structures, not actions. Preserve stable Latin ids, paths, file names, and technical tokens exactly, using mono. Write registry descriptions in Korean or English consistently and avoid mixing language in the same badge. Keep I/O phrases short and line-broken at phrase boundaries. Follow [Korean typography](korean-typography.md).

## Light, dark, and full variants

Keep all node positions, ids, hierarchy, and registry bindings identical across light, dark, and full variants. Light and dark change semantic tokens only. The full editorial form can add scope and provenance around the tree; it must not replace the stable id with a decorative label. Check id badge contrast at the final export size.

## Accessibility

Provide a title and description explaining the root block, hierarchy direction, and how to locate the registry. Each block has a visible id and name; color is not an identifier. Describe hierarchy in parent-first order. The exported SVG must preserve accessible title/description and metadata, and a table or registry must remain available for the full record.

## Verifier gates

Run `scripts/verify-diagram.mjs` for geometry, overlap, clipping, contrast, skin, visible text, and a11y. Run `scripts/verify-type.mjs --type=tree-block-decomposition` to compare node ids, parent ids, visible badges, metadata fields, hierarchy budgets, and orthogonal edges. When a registry was explicitly requested, compare its ordered projection with the source attributes and check for duplicate ids, unresolved parents, and cycles. Inspect a sample registry lookup against the saved SVG/PDF/PNG package.

## Anti-patterns

- Verb-phrase nodes that describe work rather than structural components.
- Separate ICOM sides, input/output arrows, or connector-adjacent identifiers.
- An id badge that disagrees with node metadata or is absent from the registry.
- Long constraints and assumptions rendered as tiny in-node paragraphs.
- A tree used to imply cross-block data flow or multi-parent dependencies.
- Calling the result standards-compliant because it borrows block terminology.

## Related references

[Tree](type-tree.md) · [Semantic patterns](semantic-patterns.md#8-traceable-block-decomposition) · [Output spec](output-spec.md) · [Export](export.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Style guide](style-guide.md)
