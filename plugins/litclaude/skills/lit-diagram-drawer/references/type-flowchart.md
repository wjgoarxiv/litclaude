# Flowchart

**Catalog ID:** flowchart

## Purpose and selection

Use a flowchart for decision logic, algorithms, user-facing routing, or a bounded support/onboarding path. Use a sequence diagram when actor messages and time order matter, and a state machine when the same entity persists through named states and transitions.

## Content schema

Provide one start node, ordered action nodes, decision nodes with a question, and one or more terminal nodes. Each edge has a source, destination, and branch label when it leaves a decision. Keep decisions to at most three exits; split higher-arity choices into nested questions. Declare one happy path or one consequential decision for focal emphasis. Keep the common case to about nine nodes and twelve edges.

## Deterministic layout recipe

Use a 1000px-wide canvas with a top-to-bottom primary route. Put start first, then actions and decisions in topological rows. Assign each node a stable row and branch column from the input order. Align centers to a 4px grid and reserve at least 64px vertical gap between node bounds. Shape grammar is fixed: oval for start/end, square-corner rectangle for action, diamond for decision, and a small neutral dot for a merge. Route orthogonally using 8px elbows; place branch labels near the first segment on paper masks. Draw edges before nodes.

If branches rejoin, merge them before continuing. When crossings cannot be removed by reordering, bridge one lower-priority edge. Split a dense decision tree into overview plus detail rather than compressing node text.

## Encoding rules

Shape carries node type; text labels each outgoing decision branch. Use one accent on the happy path or the most consequential decision, not both if that would exceed the accent budget. Keep all other paths neutral. Do not use color as a substitute for start/action/decision/end shape.

## Korean behavior

Write decision questions as short Korean questions and label every branch with a complete answer such as “예” or “아니요”. Use Pretendard for prose and keep English product names or commands intact in a technical sublabel. Avoid overly long diamond text; place explanation in a nearby note rather than shrinking type. Ensure the accessible description follows branch order.

## Light, dark, and full variants

Light uses paper surfaces, ink outlines, and one path accent. Dark rebuilds node fills and outlines to retain clear shape boundaries. Full adds title, purpose, and a short legend only if line styles need explanation. Preserve branch topology and node positions between themes.

## Accessibility

Include a textual step list with the decision branches, because a static image cannot by itself provide branching navigation. The SVG description should name the start and terminal outcomes. Branch labels must be visible and programmatically associated with their edges or nearby nodes. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for node collision, branch-label clipping, contrast, accessibility, and visible text. Run scripts/verify-type.mjs --type=flowchart for node-shape grammar, branch labels, decision exits, reachability, and edge budgets. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Using fill colors to indicate action versus decision.
- Leaving yes/no or other decision branches unlabeled.
- Giving a diamond four or more exits.
- Crossing branches when a deterministic column reordering would avoid it.
- Making the diagram so dense that a text checklist is easier to follow.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Annotation primitives](primitive-annotation.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
