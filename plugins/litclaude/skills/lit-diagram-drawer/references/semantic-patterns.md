# Behavior-first semantic patterns

Choose a semantic pattern when behavior, state, enforcement, or risk carries the message. The pattern sets what the reader must see; a visual type still controls geometry. A pattern never creates a new catalog type.

| Pattern | Use when | Common visual route |
|---|---|---|
| Fan-in queue / bottleneck | Many arrivals compete for finite capacity, a queue, or a choke point | Data flow; Process when stage ownership dominates |
| Staged framework | Each stage repeats named slots such as input, question, governance, or output | Process; Swimlane when rows mean owners |
| Unstructured input to durable artifact | Loose conversation or files are normalized into a governed result | Data flow; Process for ordered gates |
| Paired policy traces | Two rulesets must show pass, fail, skipped, not reached, and first divergence | Flowchart; Sequence when actor and time are central |
| Secure paved road | Show permitted and rejected ingress paths across a trust boundary | Architecture |
| Governance/control catalog | Group controls by where they are enforced | Layer stack; DP security matrix for role-to-permission mapping |
| Compensating security layers | Controls cover earlier gaps and residual risk moves outward | Layer stack; Nested for containment |
| Traceable block decomposition | A hierarchy needs stable IDs, I/O, constraints, and an implementation link per block | Tree |
| Lifecycle phase map | One subject passes through phases, waits, retries, cancellation, and terminal outcomes | State machine; Sequence when messages dominate |

## Selection rules

1. State the reader's question in one sentence.
2. Choose one pattern only when it captures a real behavior contract. Otherwise choose the visual type directly.
3. Select the nearest type whose geometry makes the relationship legible.
4. Carry the pattern's semantic labels and limits into the type layout.
5. Do not combine multiple grammars just to include every detail. Split the view when the pattern cannot fit clearly.

Queue labels distinguish offered work, accepted work, capacity, waiting, rejected or delayed work, and the drain path. A trust boundary is drawn as a named boundary, and each crossing has an explicit policy. A paired trace aligns equivalent checkpoints and marks the first difference.

Motion is a presentation choice, never a semantic requirement. Use it only when an ordered change becomes easier to understand; keep the final state visible without it.
