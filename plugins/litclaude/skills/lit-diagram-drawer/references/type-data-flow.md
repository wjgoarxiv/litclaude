# Data Flow

**Catalog ID:** data-flow

## Purpose and selection

Use this type for a typed data pipeline where the reader needs to see which role acts at each step and how a payload changes. It suits ingestion, storage, transformation, analysis, and publication flows with ownership lanes. Use a business swimlane for approvals or service operations where actors and task handoffs matter more than data types. Use DP integration for a topology of platform endpoints without a stage sequence.

## Content schema

Declare 1–4 ordered roles, each with a two-line display name and a unique short key. Declare 1–6 ordered pipeline steps with number and short label. Add only real role-step nodes; absent participation stays empty. A node may have a title, one-line action, tool or system, optional input/output payload codes, and a focal flag. Declare edges explicitly by node IDs, with direction and one of four meanings: ordinary handoff, governance trigger, focal cross-role handoff, or published output. The schema has three focal slots: one step, one receiving node, and one incoming cross-role edge. Populate exactly one of each; if the brief has no meaningful focus, select a different type instead of fabricating one. Keep custom concern colors to a few clearly named meanings.

## Deterministic layout recipe

Derive the viewBox width as 140px for the role rail plus 112px per step plus 28px right padding. Set the header to 36px, each lane to 80px, and the legend to 80px; use 100px for the legend when a concern-color row is required. Thus viewBox height is 36 + 80 × lane count + legend height. Step center j is x=140 + 112j + 56. Lane top k is y=36 + 80k. Place a node at x=center−50 and y=lane top+8; every node is 100 × 64. Empty cells have no shape, text, or placeholder. Center the lane's two-line name in its left rail and mark lane boundaries with quiet rules.

Each node can hold a compact role tag, title, short action, and tool label. Put its input payload chip at bottom-left and output chip at bottom-right; omit a chip only when the node has no input or output. Keep chip meanings in a small horizontal legend. The focal step uses an accent header, the receiving node has the focal outline, and the incoming focal edge is the only labeled accent route.

Draw edges before nodes. Route same-lane edges from the right side to the next node's left side. Route cross-lane edges with an orthogonal single bend and an 8px corner, using a top or bottom port for a vertical arrival. Stagger shared ports by at least 12px. Label only the focal handoff; place its text on a paper mask with a clear gap around the route. Keep the legend in a horizontal strip below the lanes.

## Encoding rules

Step position communicates sequence; lane position communicates ownership; node text names the work; payload chips show input and output shape. Use distinct neutral line styles for standard data handoff and governance triggers. The one focal transfer uses the accent and a short payload label. Input and output codes describe payload format independently from any node tint. If semantic concern colors are used, name them in the legend and keep connectors' colors tied to edge meaning, never to node color. Leave non-focal edge labels blank to protect the grid from text collisions.

## Korean behavior

Use Korean role and action names when the operating audience uses Korean. Preserve exact system names and payload codes; add Korean explanations for unfamiliar abbreviations. Use Pretendard for node copy and mono for step numbers, payload codes, protocols, and role IDs. Keep two-line lane labels consistent, and allow Hangul node titles to wrap without shrinking the text. Make a chip's spoken alternative explicit, for example “입력: 테이블”.

## Light, dark, and full variants

Light uses alternating low-contrast lane fills only when they improve tracking, plus restrained dividers. Dark reverses the dividers, lane tint, and chip surfaces while preserving the same row/column geometry and flow styling. Full may add a short title and takeaway and a horizontal legend. Do not add placeholders or summary cards that duplicate every node.

## Accessibility

The description should state the role order, pipeline stages, focal handoff, and what payload-chip positions mean. Keep the SVG title and description, with reading order following lanes then steps. Pair line pattern and label with color. Offer a text sequence or table when every transfer must be read exactly. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for route overlap, clipping, contrast, accessibility, and text checks. Run scripts/verify-type.mjs --type=data-flow for schema bounds, empty-cell behavior, exactly one focal entry in each required slot, edge endpoints, routing, and payload-chip placement. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Drawing empty cells as faded placeholder boxes.
- Labeling every edge instead of reserving one label for the central handoff.
- Using diagonal arrows or encoding role, flow, and concern with competing color systems.
- Showing tools without showing who performs the work.
- Changing payload codes to localized labels without preserving their technical identity.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
