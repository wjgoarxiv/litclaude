# Process

**Catalog ID:** `process`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Semantic patterns](semantic-patterns.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Process when order, responsible actor, and the data or tool passed between steps all matter. It is a responsibility-aware workflow: a reader can see who performs each step, where a handoff crosses lanes, and what artifact enters or leaves. Use Swimlane for simpler cross-functional process where payload/tool detail adds no value; use Sequence when timed messages between system actors are the point.

## Exclusions

Do not use this matrix for unowned serial steps, arbitrary many-to-many dependencies, or a static ownership census. It is limited to six lanes and twelve steps. A grid cell with no activity stays empty; no connector should imply a task that the input does not declare.

## Content schema

```yaml
lanes: [{ key: API, name: [API team] }, { key: OPS, name: [Operations] }]
steps: [{ number: "1", label: Intake }, { number: "2", label: Validate, focal: true }]
nodes:
  - { lane: API, step: 0, title: Receive request, sub: "Request → case", tool: "Portal", chips: { in: null, out: FL } }
  - { lane: OPS, step: 1, title: Verify access, sub: "Case → approved", tool: "Policy check", chips: { in: FL, out: DB }, focal: true }
arrows:
  - { from: { lane: API, step: 0 }, to: { lane: OPS, step: 1 }, style: focal-in }
```

The schema has 1–6 named lanes, 1–12 ordered steps, explicit occupied cells, and declared arrows. Use short uppercase lane keys and labels, one-line node title, optional short transformation, tool, and input/output artifact codes. First-step inputs and last-step outputs are omitted. Allow one focal step and one focal node; their related handoff is the only accent route. Use arrow styles `normal`, `trigger`, `focal-in`, or `focal-out`.

## Deterministic layout recipe

Use `label_col_w=140`, `step_slot_w=112`, `right_pad=28`, `header_h=36`, and `lane_h=80`. Set canvas width to `140 + 112×step_count + 28`; height to `36 + 80×lane_count + legend_height`, with a 100px legend only when a concern-color row is present, otherwise 80px. Lane `k` starts at `36+80k`; step `j` center is `140+8+112j+50`. Place 100×64 nodes centered in their step slot, with 8px vertical lane inset. Empty cells render nothing. Route cross-lane arrows with one right-angle bend: exit the source right edge, travel in the corridor before the destination, then enter its top or bottom. Same-lane adjacent steps may use a horizontal line. Draw all arrows before all nodes. If routes cross, reorder the steps or split; do not invent extra bends.

## Encoding rules

Use topology to choose line style. A trigger is dashed; ordinary transfer is muted solid; only arrows entering or leaving the single focal node use accent. Node color can signal a concern (security, quality, publication, backup) but is optional, limited to three non-focal elements, and never changes arrow color. Use artifact chips only for known payload types; unknown stays absent. Keep tool/sub-label ink muted even on colored nodes. The legend names only styles actually present.

## Korean behavior

Keep lane keys, units, file formats, and tool names stable in Latin characters. Korean lane names may wrap into two balanced lines; step labels should remain short, and node titles should fit one line or use a two-line title with chips omitted. Do not split a unit from its value or a path/API token at punctuation. Use the shared Korean line-height; widen the canvas or abbreviate before shrinking type.

## Light, dark, and full variants

Light and dark use the same input, viewBox formulas, connector routes, and semantic colors; change only token values and lighten custom hues enough to retain contrast on the dark surface. The full variant places that same grid in an editorial frame and may add a small summary strip. It must not reflow lanes, add process steps, or change arrow semantics.

## Accessibility

Add SVG title and a concise description of the actors, step direction, focal handoff, and any trigger. Provide an ordered text alternative by step, then lane. Distinguish triggers by dash pattern as well as wording; distinguish payload types by text code, not color alone. Keep every connector behind nodes, and ensure node labels stay above minimum readable size.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for geometry/overlap, connector bounds, clipped labels, contrast, skin parity, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=process` to validate the catalog marker. Review lane/step limits, occupied-cell uniqueness, focal declarations, endpoints, and arrow topology against this guide. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Placeholder boxes in empty lane/step cells or unlabeled lanes.
- Diagonal connectors, multiple bends, left-side entry, or crossings hidden under nodes.
- More than one focal step/node, colored arrows, or custom colors on focal elements.
- Payload chips on nodes whose title already wraps or where the payload is unknown.
- Twelve-plus steps, seven-plus lanes, or long prose crammed into nodes.
