# Sequence

**Catalog ID:** `sequence`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Motion](motion.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Sequence for requests, responses, events, and interactions among actors when message order and timing are load-bearing: API calls, auth refresh, or incident reconstruction. Use State Machine for one subject changing state, Process for steps across owners, or Flowchart for decision logic without actor-to-actor messages.

## Exclusions

Support up to five lifelines and twelve messages. Use at most one combined fragment by default; a second is allowed only when each is a single-region `opt` or `loop`. `alt` has at most two regions, nesting depth is one. Creation/destruction, duration bars, parallel/critical/break/ref operators are out of scope; split an over-budget exchange into overview and detail.

## Content schema

```yaml
title: "Token refresh"
actors: [{ id: app, label: Client }, { id: api, label: API }, { id: auth, label: Auth service }]
messages:
  - { from: app, to: api, kind: call, label: "GET /resource", step: 1 }
  - { from: api, to: auth, kind: call, label: "Validate token", step: 2 }
  - { from: auth, to: app, kind: return, label: "New token", step: 3, focal: true }
fragments:
  - { kind: alt, guards: ["token valid", "token expired"], start_step: 2, end_step: 3 }
```

Actor order is explicit and stable. Each message declares source, target, kind (`call`, `return`, `async`), concise label, sequence number, and optional focal state. Fragments declare participants, region guards, and covered message range. Returns must pair with a synchronous call; async messages are one-way.

## Deterministic layout recipe

Place actor boxes in one horizontal row, evenly centered across a 1000px-wide canvas with equal lifeline gaps and symmetric outer margins. Extend dashed lifelines from the actor row to the bottom safe margin. Time runs top to bottom: place message `k` at a fixed 32px vertical interval below the previous message, with enough room for its label and any activation change. Sync calls use horizontal solid arrows; returns use horizontal dashed arrows; async sends use dashed arrows with open heads. Draw narrow activation bars on the receiving lifeline from call receipt through return. Self-calls use a short right-facing U-loop. A branch frame spans only participating lifelines and the message interval; its tab and guard sit above the first message in each region. Reserve at least 24px between messages and place labels above or below their own line without crossing another lifeline.

## Lifeline binding

Mark each participant box with a unique `data-node-id`. Draw one dashed SVG `<line>` per participant with `data-lifeline-for` set to that same ID; its `x1` and `x2` are the box center, `y1` is the box bottom, and `y2` reaches at least the last message row. Every message route carries `data-from` and `data-to`; its first and final points land on the corresponding lifeline x coordinates. Keep message routes in their visual top-to-bottom order in the SVG. The sequence verifier checks the lifeline map, box alignment, final-message coverage, endpoint binding, and order. Lifeline/message intersections are intentional and excluded from generic arrow-crossing totals.

## Encoding rules

Call: solid line and filled head. Return: dashed line and filled head. Async: dashed line and open head. The one primary success message may use accent; do not accent both branches. `alt`, `opt`, and `loop` operators are printed in mono and placed in a light frame with a clear guard. Every activation bar closes. All arrows point down in time; return arrows still travel between actors horizontally and appear later in the vertical sequence.

## Korean behavior

Keep actor labels and endpoints stable. Use short Korean verb phrases for messages and preserve API paths, token names, and protocol codes. Wrap labels only within their lifeline gap; if they collide, shorten the message or add vertical space. Operator names and guards use the same mono role in both languages; provide Korean alternatives without changing step order.

## Light, dark, and full variants

All variants have identical actors, messages, activation spans, fragments, order, and focus. Light/dark change shared tokens only. The full variant may add a short context note but cannot add messages absent from the diagram. Sequence is static by default; use motion only when a staged reveal materially explains the exchange and still follow [Motion](motion.md).

## Accessibility

The SVG description names actors and summarizes the message path and branch outcome. Supply an ordered message list with source, destination, kind, and label; include each guard and region outcome. Distinguish async from return with arrow-head shape and line pattern as well as text. Group related messages in DOM order and keep labels off lifelines.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for geometry, overlaps, message-label bounds, contrast, skin polarity, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=sequence path/to/diagram.html` (or the specialized catalog ID such as `sequence-oauth`) to validate lifelines, participant binding, and message order. Run `node scripts/test-sequence-verifier.mjs` to exercise failing and passing sequence fixtures. Review markers, activations, and fragment budgets against this guide. If animated, also run `node scripts/verify-motion.mjs`. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Upward-time arrows, open heads on returns, filled heads on async sends, or activation bars that never close.
- Branch arrows without an `alt`/`opt`/`loop` frame and guard.
- Labels crossing a neighboring lifeline or actors arranged as swimlanes.
- Nested `alt` blocks, more than five lifelines, or unbounded fragments.
- Coral on both branch results, or a motion-only state that disappears in the static frame.
