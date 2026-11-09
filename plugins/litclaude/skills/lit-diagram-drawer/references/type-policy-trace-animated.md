# Paired policy-evaluation trace

**Catalog ID:** `policy-trace-animated`  
**Semantic pattern:** paired policy-evaluation traces; visual grammar: flowchart-style rule table.  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Semantic patterns](semantic-patterns.md) · [Motion](motion.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use this view when two otherwise similar requests produce different policy outcomes and the reader needs to see the first rule where their paths diverge. It specializes ordered rule evaluation as two aligned traces. Use Sequence only when actor messages and timing matter; use a regular Flowchart when there is one evaluation path.

## Exclusions

There are exactly two traces, 3–6 shared ordered rules, one first divergence, at most 12 status cells, and one terminal outcome per trace. This is not a general comparison matrix or a decision tree. Do not show a denied request continuing through downstream checks as if they ran.

## Content schema

```yaml
title: "Where access decisions diverge"
rules:
  - { id: identity, label: Identity, detail: "Named principal required" }
  - { id: data-class, label: Data class, detail: "Sensitive writes denied" }
  - { id: human-approval, label: Human approval, detail: "Required for writes" }
traces:
  - id: read
    label: Read-only request
    input_delta: "Read scope"
    states: [PASS, PASS, SKIPPED]
    outcome: { status: PERMITTED, detail: "Read allowed" }
  - id: write
    label: Sensitive write
    input_delta: "Write scope"
    states: [PASS, FAIL, NOT REACHED]
    outcome: { status: DENIED, detail: "Review required" }
first_divergence: data-class
```

Both traces reference the same rule IDs in the same order. Each state is `PASS`, `FAIL`, `SKIPPED`, or `NOT REACHED`; the divergence ID must be the first position at which the two states differ. `SKIPPED` means a rule intentionally did not apply; `NOT REACHED` means evaluation stopped earlier. A failed terminal trace must mark later rules not reached.

## Deterministic layout recipe

Use a wide 1200×660 frame. Reserve the left 38% for ordered rule names and brief conditions, and split the remaining width evenly into trace columns. Build 3–6 rows from top to bottom with a fixed row pitch and identical status-card sizes. Each row carries the same rule label at one y-coordinate and one status cell per trace at that same y. Place the first-divergence bracket/leader across the two cells on the exact divergence row and label it in text. Put outcome cards below the final rule row. Draw all row and connector structure first, then status cards, labels, and the footer key. Set height from row count plus fixed header/outcome/footer zones; do not shrink rows to fit longer text.

## Encoding rules

Every status uses a word plus a redundant mark/shape: PASS, FAIL, SKIPPED, or NOT REACHED. The first divergence receives the single focal accent. Use a dashed neutral border for non-applicable or unreached status; do not equate those states. The denied trace ends at its terminal outcome; no later state is presented as evaluated. Keep persistent rule and trace labels visible in every frame. Motion reveals rows in their existing order; it must not change rule order, state, result, or layout.

## Korean behavior

Translate status labels consistently and keep the English machine status in metadata if a consuming tool requires it. Use short rule names and one-line conditions; keep `PASS`, API names, policy IDs, and HTTP/status codes intact. Provide a static Korean text alternative in rule order. If a translated term needs explanation, put it in the supporting note rather than squeezing the status cell.

## Light, dark, and full variants

All variants share the same two traces, row order, divergence, and statuses. Light/dark swap shared tokens only. The full variant may add a concise decision summary outside the matrix. The default delivered frame shows every rule and both outcomes; optional step mode may focus one row, and its final frame must equal the static complete diagram.

## Accessibility

Add title/description and an ordered text alternative with both input differences, every rule state for both traces, the first divergence, and each outcome. Never encode status or outcome through hue alone. Motion requires keyboard-operable previous/next/play/pause/replay controls, an announced current step, visible focus, and the complete no-motion state described in [Motion](motion.md).

## Verifier gates

Run `node scripts/verify-diagram.mjs` for geometry, label clipping, contrast, skin, accessible SVG, and visible-text checks. Run `node scripts/verify-type.mjs --type=policy-trace-animated` for the registered paired-trace contract: shared rule order, first divergence, and outcome consistency. Run `node scripts/verify-motion.mjs` for static-first behavior, ordered complete frames, reduced-motion fallback, control semantics, and deterministic final frame. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Independently ordered traces, missing rules, or a divergence marker on a later mismatch.
- A green/red dot without its status word and non-color cue.
- `SKIPPED` used as a synonym for `NOT REACHED`.
- A denied trace continuing through rules that were never evaluated.
- Hiding rules or outcomes in an animation-only sequence, or highlighting every row.
