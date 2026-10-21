# Scoring and convergence

This file holds the rules for Phases 2 to 5 of `lit-brainstorm`: how to cluster, how to score, how to
cut to a short list, and how to present it so the user can choose. The aim is a ranking the user can
disagree with number by number, not a mood the user has to accept.

## Clustering

1. Put every raw option on one list with its handle, one line and lens.
2. Merge duplicates. Two options are the same when they send the work in the same direction and make
   the same trade-off. Keep the sharper wording and the better handle.
3. Group the rest by direction. A cluster is a set of options that share a bet ("buy and wrap",
   "narrow first", "plain names", "evocative names").
4. Name each cluster in a short phrase and keep minority clusters. A cluster with one option is often
   the most different option on the list.
5. Count: raw, after dedupe, clusters. Record the three numbers.
6. If dedupe removed more than half the raw options, the diverging step was too narrow. Run one more
   lens pass with a lens that has not been used.

## Criteria

Fix the criteria in Phase 0, before options exist. Three to five criteria, weights that sum to 100,
each criterion phrased so that a higher score is better.

Default criteria by kind of ask. Replace any that do not fit; never use more than five.

| Kind of ask | Criteria (default weight) |
| --- | --- |
| Name or title | Memorability (30), fit with the audience (30), distinctness (20), easy to say and spell (20) |
| Feature or product idea | User value (35), feasibility (25), distinctness (20), time to a first test (20) |
| Technical direction | Fit with the constraints (30), effort (25), risk of lock-in or rework (25), reversibility (20) |
| Process change | Benefit (35), disruption to adopt (25), evidence it works (20), reversibility (20) |
| Strategy or positioning | Upside (30), fit with strengths (25), downside if wrong (25), time to learn (20) |

Rules:

- Hard constraints are not weights. An option that fails one is cut and the constraint is named.
- When the user states a priority ("price matters most"), raise that weight; do not hide it inside a
  different criterion.
- Ask the user to adjust the criteria only when the choice of criteria is genuinely open; otherwise
  state them and proceed.

## Scoring rubric

Score each surviving option from 1 to 5 on each criterion, with a one-clause reason.

| Score | Meaning |
| ---: | --- |
| 5 | Clearly the best available on this criterion. |
| 4 | Strong; a minor gap. |
| 3 | Adequate; neither helps nor hurts. |
| 2 | Weak; a real cost on this criterion. |
| 1 | Poor; close to a hard constraint failure. |

Calibration rules:

- Score the option against the criterion, not against your liking for it.
- Score each criterion across all options before moving to the next criterion, so the scale stays
  consistent.
- If every option gets a 4 or 5 on a criterion, the criterion does not discriminate; say so and lean
  on the others.
- A `hypothesis` option is scored as if its fact were true, and carries a confidence mark. Do not
  inflate it.

Weighted total = the sum over criteria of (weight / 100) × score. Show the arithmetic:

| Option | C1 (w) | C2 (w) | C3 (w) | C4 (w) | Weighted | Note |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Offbeat | 5 (30) | 3 (30) | 4 (20) | 3 (20) | 3.8 | Music reading is a risk |
| Lantern | 3 (30) | 4 (30) | 3 (20) | 5 (20) | 3.7 | Common word |

## Sensitivity check

1. Take the heaviest weight and move 10 points of it to the next criterion. Recompute.
2. If the leader changes, the ranking depends on a priority the user owns. Say so in one sentence:
   "Offbeat leads unless audience fit matters more than distinctness; then Lantern leads."
3. Take the top option and lower its two best scores by one point. If it drops below the runner-up,
   it is a close call; present both.
4. Do not publish a decimal as if it had that precision. Round to one decimal and describe gaps
   smaller than 0.3 as ties.

## Cutting to the short list

Cut in this order:

1. Options that fail a hard constraint, naming the constraint.
2. Options strictly worse than another on every criterion, naming the option that beats them.
3. Options in the same cluster as a better-scoring option, unless they differ in risk or cost.
4. The lowest weighted totals, until three remain (five at most).

Keep at least one option from a different cluster than the leader, so the user sees a real
alternative and not three variations of one bet. Keep the null option on the short list when it
scores within one tie of the leader, because the honest comparison is with doing nothing.

## The shortlist card

Every shortlist entry uses the same card, so the options can be compared line by line.

| Part | Content |
| --- | --- |
| Handle and one-liner | A sentence the user could repeat to someone else. |
| Why it scores | The two criteria where it wins, with the scores. |
| Main risk | The single thing most likely to make it fail. |
| Cheapest first test | The smallest, fastest way to learn whether it holds: a question, a spike, a mock, a conversation. |
| What you give up | The option or criterion traded away by choosing it. |
| Confidence | `grounded`, or `hypothesis` and the fact to check. |

A combination of two entries is a valid shortlist entry when one clear join beats either alone;
describe the join in the one-liner.

## The recommendation

State which entry you would pick in two sentences: why it wins and what it costs. The recommendation
is advice. It is never a decision, and the next phase asks the user.

## Asking the user

One question with three kinds of answer:

1. Pick one shortlist entry.
2. Combine entries, or lift a part of one into another.
3. Widen: another diverging pass that names what was missing.

With `AskUserQuestion`, give the shortlist handles as options and mark the recommended one. In plain
text, number the options and ask for a number, a combination or "widen: <gap>". If the user widens,
run one more pass on the named gap and return to scoring with the same criteria. A third widen means
the question needs `deep-interview`; offer it.

## Handoff selection

| The pick is | Hand off to | Brief must carry |
| --- | --- | --- |
| Vague: scope, acceptance or decisions still open | `deep-interview` | The pick, why it won, criteria, rejects, open decisions. |
| Concrete: a clear change with criteria and non-goals | `lit-plan` | The pick, criteria, non-goals, the first cheap test. |
| Blocked by a fact gap | `litresearch` | The specific question and the options that depend on it. |
| A chosen approach that worries the user | `lit-crucible` | The approach, the worry, the criteria that would make it fail. |

The brief template is in `session-notes-template.md`. Give the exact next command, for example
`/litclaude:deep-interview <brief>` or `lit plan <brief>`. A prompt hook cannot start the next skill
for the user, so say the command and wait.

## Convergence anti-patterns

- Choosing the leader and proceeding without asking.
- Presenting a long ranked list instead of a short list; more than five entries is another brainstorm.
- Scores with no reasons, or reasons with no scores.
- Weights changed after seeing which option they favour.
- Three shortlist entries from one cluster.
- Hiding a close call to sound decisive.
