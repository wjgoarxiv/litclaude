Run this pass before any grid, token, or component decision. Its output fills the Design Contract `intent` group and seeds `omissions`.

## Describe each user by the decision they own

Two groups making the same decision are one group. Merge them, or name what separates them.

- Operator: the decision they make, return frequency, device class, viewport band, network.
- Secondary readers: approver, auditor, on-call responder, support agent.
- Cost of a wrong decision: recoverable in session, expensive to reverse, or permanent.
- Groups this surface refuses to serve, written into `intent.non_goals`.

## Reduce each surface to one completion condition

One surface, one task the user must be able to finish. Everything else is subordinate.

- Phrase it as verb, object, end state: "cancel the shipment and see the refund posted".
- Name the two next-most-frequent tasks; push the rest behind disclosure.
- Require the first viewport to answer: what happened, what matters now, what next.

## Convert quality words into measured signals

"Fast" and "intuitive" are not acceptance criteria. Each becomes a number you can read.

- Completion time at p50 and p90, with the ceiling you will defend.
- Error rate on the primary form, and the share of errors preserving entered input.
- Interaction cost on the frequent path, as a keystroke or tap ceiling.
- Regression consequence: what the product loses when a signal moves the wrong way.

## Register what is not yet known

Every unknown gets an owner in writing, or it returns later as an invented assumption.

- Question phrased so one answer closes it.
- Blocked decision: which layout, density, or token waits on it.
- Route: user answer, repository inspection, instrumentation, or a prototype.
- Working assumption meanwhile, recorded in `intent.constraints`.
- Revisit date; past it, the gap becomes an `omissions` entry with an owner.

## Walk five journeys to the same end state

Each journey ends at the completion condition above. One that stops earlier is a defect.

- Low vision: 200% zoom and 400% text — what reflows, stays reachable, or clips.
- Keyboard only: entry point, tab count to the primary action, escape from every container.
- Screen reader: reading order, programmatic names, the announcement confirming success.
- Low bandwidth: what paints before data arrives, and what the surface says at 3 s and 10 s.
- Unfamiliar language: copy at the declared `text_expansion_percent`, mixed-script wrapping, locale dates.

## Keep more than one answer alive

Hand the next stage a bounded set. One inevitable option is a decision nobody reviewed.

- Produce 2-3 directions separated by structure or density, never by accent hue.
- Give each the task it accelerates, the task it slows, and its migration cost.
- Mark one recommendation with a one-sentence reason; keep the rejected ones legible.

## Halt at named checkpoints

A checkpoint is a stop, not a status line. Work resumes only when the answer exists.

1. Users, critical task, and success signals accepted — blocks all visual work.
2. One direction selected from the bounded set — blocks token and layout commitment.
3. Brand marks, legal copy, and identity approved — report `BLOCKED` until the user answers.
4. Contract validates and its hash is recorded — blocks the independent review pass.

## Hand over the research package

The next stage reads this package, not the transcript. What is missing does not exist.

- Users with decisions, one critical task per surface, ranked information, non-goals.
- Signals with thresholds plus the regression consequence.
- Knowledge-gap register with owners and revisit dates.
- Five journeys with pass conditions; bounded directions with costs and recommendation.
- Finite surface list: routes, states, viewport bands, auth requirements.
- The design contract hash the independent review pass binds its receipt to.

## Failure patterns

Reject:

- A persona described by demographics rather than by a decision.
- "Improve the experience" accepted as an outcome with no observable task.
- One direction presented with no alternative and no stated cost.
- A success claim resting on a single happy-path capture.
