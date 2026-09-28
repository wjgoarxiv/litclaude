# State machine

**Catalog ID:** `state`

## Purpose and selection

Use a state machine when a subject has a finite set of modes and legal transitions depend on events, guards, or actions. Examples include an order status, connection state, form wizard, and job queue. Use [Sequence](type-sequence.md) for messages exchanged by actors; use [Lifecycle phase map](type-state-lifecycle.md) when one subject's progress, waits, retries, cancellation, and terminal outcomes deserve distinct bands.

## Content schema

Prepare:

- A list of distinct state records: stable id, short state name, optional qualifier, and role (`initial`, ordinary, terminal, error).
- A list of transition records: source state, target state, triggering event, optional guard, optional action, and whether it is an entry or completion transition.
- The subject and boundary of the state model, including any excluded subsystem or external actor.
- One focal state, if the diagram needs emphasis.

Keep labels in the compact form `event [guard] / action`; omit empty portions. Every transition must identify its trigger. Add start/end pseudo-states only where they clarify entry or completion.

## Deterministic layout recipe

1. Order states by the dominant progression and choose one reading direction: left-to-right for progression or top-to-bottom when the page is narrow. Place the initial point first and terminal points at the flow's far end.
2. Lay states on a simple 4 px grid with consistent box sizes for similar label lengths. Reserve small clear corridors for loopbacks before drawing any connector.
3. Route transitions as curves around boxes, avoiding crossings. Put short self-loops above their state. Attach loopbacks to distinct points so they do not merge into an ambiguous arrowhead.
4. Place event/guard/action text next to the transition it names, on an opaque paper-backed label if a line passes behind it. Keep guards and actions distinct in the label sequence.
5. Draw connectors first, then state boxes and labels. Use a filled start dot and a ringed terminal marker when pseudo-states are shown. Keep the diagram within the global 9-node and 12-transition limits; over-budget logic becomes separate diagrams.

## Visual encoding

Use quiet state boxes, one accent state at most, and consistent line style for all ordinary transitions. A start marker is a filled dot; a terminal marker is a ring with a center. Use the accent to point to the state the reader should notice, often an error state or successful completion. Label transitions rather than color-coding them; different outcomes need explicit text and, when necessary, different line patterns.

## Korean text

Use concise Korean state names in Pretendard and preserve event identifiers or code symbols in mono. Put the event first; keep guard conditions in brackets and actions after a slash. Wrap long Korean state text within the node with phrase-level line breaks. Use no color-coded “성공/실패” distinction without visible text. Follow [Korean typography](korean-typography.md) for Hangul line height and mixed text.

## Light, dark, and full variants

State positions, transition direction, labels, and focal state remain identical across light, dark, and full skins. Light/dark variants switch semantic token values only. The full editorial version may add one title, a concise interpretation, and a source or scope note; it must not add pseudo-states that change the model. Verify terminal rings and loopbacks at the final presentation size.

## Accessibility

Provide a title and description naming the subject, initial condition, principal transitions, and terminal outcomes. Every transition has a readable event label; do not encode legality by color alone. Keep arrowheads separate from box borders, preserve connector contrast, and ensure start and terminal symbols differ by both shape and label. A screen-reader description should follow the flow order rather than list states alphabetically.

## Verifier gates

Run `scripts/verify-diagram.mjs` for bounds, arrow/box overlap, clipped labels, contrast, skin polarity, and a11y. Run `scripts/verify-type.mjs --type=state` for state/transition structure, limits, and required labels. Inspect branch density and labels in rendered light, dark, and full variants; structural checks do not decide whether a transition is understandable.

## Anti-patterns

- Unlabeled transitions or arrows whose direction is unclear.
- More than twice as many transitions as states without splitting the model.
- A separate “timeout” edge from every state when one shared rule can be stated once.
- Lifelines and actor-to-actor messages, which belong in Sequence.
- A wait/retry lifecycle squeezed into the same rail as the main phases.
- A focal state indicated only by hue, or connectors hidden behind boxes and labels.

## Related references

[Lifecycle phase map](type-state-lifecycle.md) · [Sequence](type-sequence.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
