# Diagram verification guide

Verification is a set of checks on a rendered artifact and its source. A clean source lint does not prove that a browser rendered the intended result, and a screenshot alone cannot prove the font, text, or semantic relationships.

## Shared checks

Run:

~~~sh
node scripts/verify-diagram.mjs path/to/diagram.html
node scripts/verify-type.mjs --type=<catalog-id> path/to/diagram.html
node scripts/verify-brief.mjs path/to/brief.md path/to/diagram.html
node scripts/check-visible-text.mjs path/to/diagram.html
~~~

Without arguments, `verify-brief.mjs` checks the bundled worked examples, and `verify-all.mjs` checks every bundled template and example.

The shared verifier reports overlap candidates, label bounds, off-canvas geometry, connector crossings, contrast, theme polarity, SVG naming, unsafe references, and visible-text humanizer findings. `verify-diagram.mjs` (and `verify-all.mjs` for bundled examples) also rejects process/generator text, a missing visible title, role-specific size and content-fill failures, edge labels overlapping any node box, text boxes intersecting connector paths or boundary/group outlines, routes entering non-endpoint nodes with 8px padding or running alongside a boundary within 4px for 12px, arrowheads hidden by destination boxes, and node gaps below 12px. Every marked route's arrow tip must meet its target box edge within 2px (sequence messages instead bind to lifelines); the projected head length must be at least `max(12 × viewBox-width / 1080, 5 × stroke-width)`. It flags a route when its path length exceeds 1.4 times the Manhattan distance between its route endpoints, when it uses more than two bends (or three while crossing a boundary), when aligned row/column neighbors are not linked by a straight segment, when distinct edges share a collinear segment with less than 12px clearance, when distinct routed edges geometrically cross (including edges with the same unordered node pair), or when one polyline has arrowheads at both ends. Sequence lifelines are excluded from generic crossing counts because message intersections with lifelines are intentional. A labeled connector needs `data-edge-for="source|destination"` on its text and matching endpoint/label attributes on its route. The text anchor must be within 24px of that route and nearer to it than to any other route. Boundary/group labels use the 13px connector floor and the 4.5:1 text contrast floor. Its 1080×640 floors are 28px title, 15px node, and 13px connector/boundary text; other canvases scale proportionally. Decision nodes marked `data-node-type="decision"` must declare at least two pipe-separated `data-outcomes`, and each value must match an outgoing `data-label`; the brief verifier then confirms each named outcome is present with the right direction. The type verifier checks the numeric or structural rules registered for the selected catalog entry. For sequence diagrams it also requires one dashed `line[data-lifeline-for]` per participant, lifeline endpoints at participant-box centers, every message connected to both named lifelines, and messages ordered from top to bottom. `verify-brief.mjs` requires each brief's node names and relationship labels as exact SVG text, checks each labeled edge's direction and endpoints, checks trust-boundary membership declarations (complete semicolon-separated internal and external node lists against node-box geometry), and rejects unlisted English words in Korean labels.

## Failure meanings

- **Overlap:** two unrelated node boxes occupy the same region. Containment, intentional Venn overlap, and declared pattern-specific intersections are not reported as failures.
- **Clipped or overflowing label:** measured text extends beyond its assigned node or safe canvas. Widen, wrap, or edit the label.
- **Off-canvas item:** a node, arrowhead, label, or essential mark crosses the SVG viewBox or the selected safe inset.
- **Connector crossing:** unrelated paths intersect without a clear bridge, routing gap, or explicit crossing convention.
- **Contrast failure:** text or an essential non-text mark falls below the applicable ratio in the selected theme.
- **Polarity failure:** the theme claims light or dark but retains colors that are too close to the opposite skin.
- **Accessibility failure:** SVG name or description is absent, IDs collide, reading order is incoherent, or labels are not available as text.
- **Humanizer block:** visible copy includes clear drafting residue. Review warnings in context; warnings are not automatic failures.
- **Process text:** visible SVG text names the generator/product, shows a template/variant/source/notes tag, or describes design rules instead of the diagram subject.
- **Missing visible title:** the SVG has an accessible `<title>` but no reader-facing title text. Show the diagram subject above the composition.
- **Connector-label collision:** a text bounding box intersects a declared connector path. Move the label clear of the full route.
- **Edge-label association:** the label anchor is more than 24px from its named route, lacks one matching route, or is no closer to that route than to another connector. Move it beside its own path and update `data-edge-for` if the relationship changes.
- **Outline-label collision:** a trust-boundary or group outline crosses a text box. Move the text away from the outline and keep the named boundary visible.
- **Boundary-label readability:** a boundary/group name is under 13px at the reference canvas or below 4.5:1 contrast. Increase its size or contrast.
- **Route along boundary:** a connector runs within 4px of a boundary edge for 12px or more. Route across the boundary or away from its outline.
- **Hidden or detached arrowhead:** marker geometry overlaps the destination node, or its tip is more than 2px from the target box edge. End the route with the tip touching the edge while the head body remains outside the node.
- **Language mismatch:** a Korean brief's visible label contains an English word that is not listed as a name or term in that brief. Translate the label or explicitly list the term in the brief.
- **Route through node:** a declared edge enters or runs within 8px of any node other than its named source or destination. Reroute the edge so its destination is unambiguous.
- **Node gap:** two declared node boxes are less than 12px apart. Increase their separation so labels and arrows do not visually merge.
- **Route detour or excess bends:** the polyline is longer than 1.4× its endpoint Manhattan distance or has more than two bends (three while crossing a boundary). Move nodes or choose a shorter path before adding turns.
- **Aligned-neighbor detour:** same-row or same-column neighbor nodes have a bent route. Connect them with one straight segment.
- **Shared route segment:** distinct edges overlap collinearly or pass within 12px over a shared span. Reroute one edge so its direction is distinct and unambiguous.
- **Route crossing:** two distinct directed paths intersect at a point away from a shared endpoint. This includes opposite directions between the same two nodes; separate their return and forward paths with a visible gap.
- **Trust-boundary membership:** every boundary-bearing brief must list every node exactly once as internal or external. Internal node boxes must lie fully inside the marked trust-boundary rectangle; external node boxes must lie fully outside it.
- **Opposed arrowheads:** one directed polyline has both a start marker and an end marker. Keep one arrowhead per directed edge unless the brief explicitly defines a two-way relationship.
- **Sequence lifeline:** a participant has no dashed lifeline, the line does not start at its box center or reach the final message, a message misses its named lifeline, or message order is not top-to-bottom. Bind each message endpoint to its actor lifeline and preserve order.
- **Content fill:** the declared node bounds use less than 68% of canvas width or 40% of canvas height. Recompose the subject to use the available slide area.
- **Cluster gap ratio (OF-201):** with two or more boundary or group outlines, the smallest gap between nodes of different groups is less than twice the largest gap inside a group, so nothing reads as grouped. Pull each group's members together or push the groups apart.
- **Accent count (OF-202):** node fills use four or more saturated hue families; three is printed as an `ADVISORY` line and does not fail. Keep one structural accent plus at most one semantic colour, each paired with a label or icon.
- **Label case (OF-203, advisory):** a Latin label reads as Title Case, with a capitalised function word such as "Of" or "The". Use sentence case; a proper-noun component name is not flagged.
- **Label overflow (OF-204):** a node or boundary label is wider than its own box minus an 8px inset. Shorten the label, wrap it, or widen the box. Edge labels are not measured by this check.

## Type checks

The shared type verifier includes contracts for quantitative chart families and semantic patterns. These cover conservation, scales, labels, and named structure where such properties can be checked from explicit SVG data attributes. A missing data contract is reported as unavailable, never as a pass.

## Imported content

Use the matching Python standard-library extractor before drawing. Extracted JSON is a bounded intermediate representation. It never preserves source styles, coordinates, scripts, links, or embedded payloads. Render a new diagram from that content and retain a short fidelity note.

## Fixtures and receipts

Each rule has a passing and a deliberately failing fixture in the LitClaude test suite, covering visible text, size, fill, edge association and node clearance, decision outcomes, boundary/group outlines and labels, route simplicity, shared segments, crossings (including same-node-pair crossings), opposed heads, arrowhead size and contact, gaps, sequence lifelines, exact brief content, language, and trust-boundary membership. When a check fails, fix the diagram; do not weaken a check to accept a malformed result.

The T7 scorer is a comparison aid, not a quality oracle. Keep its individual metrics visible and reject a bare PNG when source metadata is missing.
