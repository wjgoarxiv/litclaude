# Dependency Graph

**Catalog ID:** dependency

## Purpose and selection

Use a dependency graph when a component has multiple dependents or a real dependency cycle prevents a tree from representing the structure. Use a tree if every item has one parent and the graph is acyclic. Use architecture when the goal is to show system communication rather than prerequisite structure.

## Content schema

Provide up to 9 package, module, or service nodes and up to 14 directed dependency edges. Each node has a stable ID, name, type (internal, external, or leaf), and optional version/registry label. Include fan-in count as a derived value. Declare one cycle for focal treatment at most. If the input is a DAG, state the ranking rule; if cyclic, mark the single back-edge explicitly.

## Deterministic layout recipe

Assign nodes to horizontal rank rows by dependency depth, with a fixed 120px vertical pitch. Use 160 × 56 node boxes, and order within each row by stable name or supplied order. Draw forward edges downward or horizontally within a rank. Route the one permitted cycle around the outside of the node field as a dashed return edge, never through unrelated nodes. Draw the cycle path and its label in accent; keep the touched nodes neutral. Place a derived fan-in badge within the node whose dependency concentration is the story.

Draw edges before node surfaces. Route off-axis edges with rounded 8px elbows, maintain 12px spacing where edges fan out, and bridge a crossing only on the less important path. If more than four rank layers are needed, collapse a leaf cluster into a named aggregate with its count or split the view.

## Encoding rules

Direction means “depends on”; define arrow direction in the caption and use it consistently. Use a low-ink neutral style for internal nodes, a distinct outline for external dependencies, and a restrained leaf treatment. Fan-in is a numeric badge, not a new hue. Accent only the chosen cycle and its label. Version and registry belong in a technical sublabel.

## Korean behavior

Use Korean for relationship explanation and captions, while preserving package IDs, versions, and registry names exactly. Use Pretendard for names and mono for version/registry badges. State arrow direction in Korean because “A → B” may be read as either use or prerequisite direction. Avoid breaking package identifiers across lines.

## Light, dark, and full variants

Light uses neutral node fills and clear rank spacing. Dark uses separately tuned edges and external-node boundaries, preserving the same ranks. Full adds a title and a short note about the one marked cycle or highest fan-in node. Keep all nodes and edges identical across variants.

## Accessibility

Describe the direction convention, rank ordering, highlighted cycle, and highest fan-in dependency in text. Include a list or table of edges for exact dependency audit. Do not encode external/internal status by color alone. Keep badge text available to assistive technology. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for path collision, clipping, contrast, accessibility, and text checks. Run scripts/verify-type.mjs --type=dependency for endpoint resolution, rank order, fan-in counts, cycle limit, edge limits, and cycle routing. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Drawing a simple tree as a graph.
- Letting ordinary forward dependencies point upward.
- Turning every file into a node instead of modeling packages or modules.
- Routing the highlighted cycle through unrelated nodes.
- Omitting fan-in when dependency concentration is the reason to choose this type.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
