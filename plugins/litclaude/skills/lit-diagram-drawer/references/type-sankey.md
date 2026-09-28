# Sankey and flow quantity

**Catalog ID:** `sankey`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Sankey when a quantity splits or merges across stages and ribbon width is the main message: cost allocation, CI time, staffing, or volume movement. Use Pyramid/Funnel for a one-way drop-off without branching; Process for ordered steps without amount encoding. If exact comparisons matter more than flow, use a table or bar chart.

## Exclusions

Exactly three left-to-right stage columns, at most eight nodes and twelve ribbons. Quantities are nonnegative and must conserve at each intermediate node and between columns. A path cannot branch into unstated amounts. No arrowheads: direction is carried by ordered columns. Merge tiny flows into a named “Other” only if the aggregation preserves the total and is explained.

## Content schema

```yaml
title: "Build minutes by outcome"
unit: "minutes"
scale: { px_per_unit: 0.02 }
stages: [Budget, Test stage, Outcome]
nodes:
  - { id: budget, stage: 0, label: CI total, value: 12000 }
  - { id: tests, stage: 1, label: Tests, value: 7000 }
  - { id: build, stage: 1, label: Build, value: 5000 }
  - { id: passed, stage: 2, label: Passed, value: 10000 }
  - { id: failed, stage: 2, label: Failed, value: 2000 }
flows:
  - { id: budget-tests, from: budget, to: tests, value: 7000, focal_path: false }
  - { id: budget-build, from: budget, to: build, value: 5000, focal_path: false }
  - { id: tests-passed, from: tests, to: passed, value: 6000, focal_path: false }
  - { id: tests-failed, from: tests, to: failed, value: 1000, focal_path: false }
  - { id: build-passed, from: build, to: passed, value: 4000, focal_path: false }
  - { id: build-failed, from: build, to: failed, value: 1000, focal_path: true }
```

List exactly three stages, unique nodes in a stage, and explicit source/target/value per flow. Use one unit and one pixels-per-unit constant. A middle node's incoming and outgoing sums equal its declared value; the first and final columns balance to the same overall total. Mark one editorial path at most.

## Deterministic layout recipe

Set one `k` px-per-unit scale for every node and flow. Convert quantities with `height=k×value`, rounded to the nearest 4px for grid alignment; reconcile rounding at each node so its attached ribbons still sum exactly to its rendered height and limit any stated-value discrepancy to one 4px step. Use identical total stack height for each stage. Give each node a 12px bar; stack nodes vertically in a stable input order within each column. Assign each flow a distinct cumulative top/bottom offset interval inside its source and target node. Draw ribbons as one closed cubic path with both control points at the horizontal midpoint between columns, giving a horizontal tangent at both bars. Place column-one labels outside left, column-two labels centered vertically in the clear gutter, and column-three labels outside right. Add headers above and a legend/footer below. Reorder nodes to reduce crossings before changing geometry.

## Encoding rules

Ribbon thickness and node height both encode quantity. Use one muted ribbon treatment for ordinary paths and accent for one focal path; never a distinct hue per flow. No arrowheads, no hidden offsets, and no overlap between ribbons attached to the same bar. Every quantity is printed with its unit and reconciles to the geometry. Keep the smallest visible ribbon at least 4px; aggregate a smaller one only with a documented total.

## Korean behavior

Keep amounts, units, and percentages bound together using one Korean number format. Stage headings may use short Korean nouns; node names should fit a single line where possible. Put unit in the title/subtitle once and retain units beside values when ambiguity remains. Do not wrap a number away from its unit or shorten a label so it changes the underlying category.

## Light, dark, and full variants

All skins use the same nodes, values, scale, ribbon offsets, order, and focal path. Switch shared paper/ink tokens only. A full variant can add concise summary cards, but each card must repeat a declared quantity exactly and must not recalculate the diagram on a different scale.

## Accessibility

Describe the unit, stage order, total, and focal path in the SVG description. Provide a text table of node totals and flow values, with source/target names. Ensure direction is understandable from stage names and text; distinguish focal flow by label as well as accent. Do not place text over ribbons.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for overlap, clipping, canvas bounds, contrast, skin polarity, accessible SVG, and visible-text checks. Run `node scripts/verify-type.mjs --type=sankey` to verify stage/node/flow budgets, conservation, one scale, ribbon thickness, attachment offsets/tangents, crossings, and variant parity. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Ribbon meeting a bar at a slant or a control point that collapses at the target.
- Intermediate labels pinned to a ribbon edge, or an opaque mask that cuts a hole in a band.
- Flow totals that do not balance, different scales by column, or unexplained rounding.
- Ribbons under 4px, repeated attach intervals, or tangled crossings.
- Rainbow flows, arrows on ribbons, or a Sankey used for a simple funnel/process.
