# Tree / hierarchy

**Catalog ID:** `tree`

## Purpose and selection

Use a tree for a strict parent-to-children hierarchy: taxonomy, file structure, decision breakdown, or bounded system decomposition. Each nonroot node has one parent and the hierarchy contains no cycles. Use a dependency graph when nodes can have several parents, cross-links, or cycles; use Nested for containment where branch relationships do not need tracing.

For stable block identifiers and per-block inputs, outputs, constraints, and implementation traceability, load [Traceable block decomposition](type-tree-block-decomposition.md) and [Semantic patterns](semantic-patterns.md#8-traceable-block-decomposition).

## Content schema

Each node carries a stable id, parent id (empty only for the root), short name, optional one-line qualifier, and optional focal flag. Each edge is implied by the parent relation; do not add independent edge labels. Record the intended reading direction, depth, and children per level before placing nodes.

## Deterministic layout recipe

1. Place the root at the top and children on the next row; use equal row pitch for each depth. A left-to-right orientation may be used for a very wide or heavily labeled tree, but select one orientation for the whole figure.
2. Center each parent above the span occupied by its descendants. Order siblings by the domain's actual sequence; if none exists, use a stable declared order so reruns are reproducible.
3. Route orthogonal connectors: short parent stem, horizontal sibling bus, then a short drop to each child. Keep connectors behind nodes and attach them at the center of node edges.
4. Use two node widths at most, based on measured label lengths. Align boxes to the layout grid; use a lighter border or fill for leaves only when it remains a redundant cue.
5. Keep at most nine nodes, four levels including the root, and five children at a level. Beyond the budget, split at a meaningful subsystem boundary and provide cross-reference ids between figures.

## Visual encoding

Connector topology carries the hierarchy; box position and text carry identity. Use a single accent node at most, chosen as root or a critical leaf. Do not style every level as a different color. Use the same visual weight for siblings and the same depth spacing throughout. Place connectors before cards so their paths terminate cleanly at the box edge.

## Korean text

Use Pretendard for node names and qualifiers, with compact noun phrases that preserve parent-child meaning. Keep IDs, file paths, and version strings in mono. Wrap labels at natural phrase boundaries and size nodes from the longest Korean label in that row. Do not omit an intermediate hierarchy term to save space. Follow [Korean typography](korean-typography.md).

## Light, dark, and full variants

Keep node coordinates, sibling order, and connectors identical across the three skins. Switch semantic stroke and fill tokens between light and dark. In the full editorial variant, add a short title, scope note, or takeaway outside the hierarchy; do not introduce a separate card grid or imply extra nodes. Confirm orthogonal connectors remain distinguishable on dark paper.

## Accessibility

Use a title and description that state the root, hierarchy direction, and scope. The logical reading order follows each parent before its children and proceeds in the declared sibling order. Preserve branch structure without color. Ensure connector-to-box joins are visible, labels meet contrast requirements, and overflow is not hidden behind a crop.

## Verifier gates

Run `scripts/verify-diagram.mjs` for node bounds, overlap, clipping, contrast, skin, visible-text, and a11y checks. Run `scripts/verify-type.mjs --type=tree` for one root, valid parent links, acyclicity, depth/branch/node budgets, and orthogonal connector joins. Inspect the densest level in the rendered full-width export.

## Anti-patterns

- A node with two parents, a cycle, or an unlabeled skipped level.
- Diagonal connectors or connectors that stop short of a child.
- More than four levels, inconsistent box widths, or one exceptionally broad row.
- Highlighting the root and a leaf with competing accents.
- Cross-tree dependencies drawn as if they were parent-child links.
- Cropping a large tree so that its root or branch context disappears.

## Related references

[Traceable block decomposition](type-tree-block-decomposition.md) · [Dependency graph](type-dependency.md) · [Semantic patterns](semantic-patterns.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
