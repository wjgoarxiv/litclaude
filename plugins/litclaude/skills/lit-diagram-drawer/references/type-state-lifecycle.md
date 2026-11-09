# Lifecycle phase map

**Catalog ID:** `state-lifecycle`  
**Parent grammar:** [State machine](type-state.md)

## Purpose and selection

Use this state-machine specialization when one subject proceeds through a short ordered lifecycle and waits, retries, recovery, cancellation, and final outcomes are essential to the story. It keeps the progress rail separate from interruptions and terminal results. Use ordinary state machine for dense guard logic and [Sequence](type-sequence.md) when actor messages or request timing are central.

## Content schema

Prepare one subject, four or five primary phase states, zero to two wait/recovery states, and zero to two terminal states. Each phase has a stable id, short name, and optional short qualifier. Each transition has a source, target, event, and optional guard or action. Record cancellation and failure separately when both can happen. Mark any optional start/end pseudo-state explicitly.

## Deterministic layout recipe

1. Draw the primary phases in a single left-to-right rail in actual lifecycle order. Keep their centers on a common baseline and use equal box widths unless the longest label needs a wider shared size.
2. Place wait and recovery states in a separate support band above the phase rail. Connect them to the phase where they interrupt and show the labeled re-entry edge back into the lifecycle. A retry loop names the retry limit or trigger.
3. Place terminal outcomes in a separate band below the rail. Use separate boxes for cancelled and failed outcomes where both exist. Join each outcome to its actual transition source; do not route every phase to every terminal state unless the model says so.
4. Add event/guard/action labels beside the corresponding edges. Keep loopbacks outside the main rail and assign distinct ports to preserve direction at crossings.
5. Show the complete small lifecycle in one static frame: 4–5 primary phases, ≤2 support states, ≤2 terminal states, ≤9 total states, and ≤10 transitions. If either limit is reached, split the overview from detailed guard logic.

## Visual encoding

Position and band headings identify primary progress, waiting/recovery, and termination. Use box style and explicit tags such as `WAIT`, `RECOVERY`, and `TERMINAL` as redundant cues; use no more than two accent elements and never use color as the sole distinction. Keep event labels in a mono role and state names in the sans role.

## Korean text

Use short Korean names for phases and outcomes, with Pretendard and sufficient line height for multi-line Hangul. Use consistent verbs or nouns across the rail; do not mix “진행 중” labels with action sentences unless the model requires it. Use mono for event IDs, retry counts, and system terms. Keep `취소` and `실패` explicit even if they share a subdued tone. See [Korean typography](korean-typography.md).

## Light, dark, and full variants

All variants preserve the same three bands, state positions, connectors, and labels. Light and dark variants alter only semantic colors. The full editorial variant may add a title, one sentence explaining the lifecycle boundary, and a source note; it should not turn the rail into a card dashboard or add steps. Keep band labels readable on both backgrounds.

## Accessibility

Use a title and description that name the subject, primary progression, interruption path, and terminal outcomes. Band position, text tags, and connector direction must distinguish progress from recovery without hue. Label every re-entry edge. Preserve readable node labels and distinct arrowheads after export; provide a logical reading sequence that follows the primary rail before support and terminal paths.

## Verifier gates

Run `scripts/verify-diagram.mjs` for overlap, clipping, contrast, skin, text, and a11y. Run `scripts/verify-type.mjs --type=state-lifecycle` for band membership, counts, and labeled transition rules. Inspect the loopback and distinct terminal paths in every rendered skin.

## Anti-patterns

- Actor lifelines or request/response arrows disguised as lifecycle phases.
- Wait states placed on the primary progress rail.
- Cancellation and failure merged into one color-only outcome.
- A retry loop with no labeled event or re-entry destination.
- Every implementation-level guard copied into an overview.
- Missing support or terminal states in the static fallback.

## Related references

[State machine](type-state.md) · [Sequence](type-sequence.md) · [Semantic patterns](semantic-patterns.md#9-lifecycle-phase-map) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
