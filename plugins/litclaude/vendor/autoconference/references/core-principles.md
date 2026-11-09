# Core Principles

Eleven principles behind the autoconference orchestration system. Principles 1–7 are inherited from autoresearch-skill and apply to each Researcher agent's inner loop. Principles 8–11 are conference-specific and govern the multi-agent coordination layer.

---

## Section 1 — Inherited Principles (from autoresearch-skill)

These apply to each Researcher agent's inner loop. See [autoresearch-skill core-principles](https://github.com/wjgoarxiv/autoresearch-skill/blob/main/references/core-principles.md) for full explanations.

| # | Principle | Definition | conference.md Field |
|---|-----------|-----------|---------------------|
| 1 | **Single Metric** | Optimize exactly one measurable quantity. Multiple objectives cause the agent to game tradeoffs instead of improving. | `Success Metric` |
| 2 | **Mechanical Verification** | The metric must be computable without human judgment. *(Relaxed in qualitative mode — see Principle 9)* | `Success Metric → Target` |
| 3 | **Atomic Changes** | One change per iteration. Compound changes make it impossible to attribute improvement or regression. | Enforced by the loop protocol |
| 4 | **Keep or Revert** | If the metric improves, keep the change. Otherwise, revert immediately. No "maybe." | `researcher_{ID}_results.tsv → status` |
| 5 | **Full History** | Record every attempt — successes AND failures. Failed approaches constrain the search space for future rounds. | Per-researcher logs + TSV |
| 6 | **Constrained Search** | Explicitly define what can change and what cannot. Without boundaries, agents may "cheat." | `Search Space → Allowed / Forbidden` |
| 7 | **Autonomous Loop** | The loop runs without human intervention within its constraints. | `Constraints → pause_every: never` |

---

## Section 2 — Conference Principles (new)

| # | Principle | Definition | conference.md Field |
|---|-----------|-----------|---------------------|
| 8 | **Knowledge Transfer** | Validated findings must propagate to all researchers between rounds. Without sharing, parallel research degenerates into N independent runs with no synergy. | `Shared Knowledge` section |
| 9 | **Adversarial Review** | Claims must survive challenge before propagating. Self-evaluation has blind spots (Goodhart's Law). An external reviewer with deep reasoning catches overfitting, noise, and invalid comparisons. | `peer_review_round_N.md` |
| 10 | **Synthesis Over Selection** | The final output combines complementary insights from multiple researchers, not just picks the winner. The conference's value is in cross-pollination — insights no single researcher would produce alone. | `synthesis.md` |
| 11 | **Relentless Persistence** | The conference runs until the budget is spent or convergence is reached. Stopping early leaves the most valuable cross-pollination unrun. | Conference Persistence Directive |

---

## Why Each Conference Principle Matters

### 8. Knowledge Transfer

- **Why:** Parallel researchers exploring independent search partitions will rediscover each other's dead ends if findings are never shared. Knowledge transfer converts N parallel experiments into a compound learning process where each researcher's next round is informed by all others' prior rounds.
- **Violation consequence:** The conference degenerates into N independent autoresearch runs. There is zero synergy. The conference overhead (poster session, peer review) is incurred with no benefit over running autoresearch N times separately.
- **Example:** Researcher A discovers in Round 1 that batch normalization causes instability with this dataset. If this is not shared, Researcher B wastes Round 2 trying the same approach. With knowledge transfer, Researcher B reads "BN unstable — avoid" and explores a different direction instead.

### 9. Adversarial Review

- **Why:** Self-evaluation is systematically optimistic. Researchers measure their own work against their own understanding of the metric. A reviewer with no stake in the result and explicit instructions to challenge claims catches what self-evaluation misses: overfitting to the test set, measurement noise mistaken for improvement, valid-looking but flawed comparisons.
- **Violation consequence:** Goodhart's Law activates. Researchers optimize for the appearance of progress. Noise is reported as signal. Overfit improvements propagate to Shared Knowledge and corrupt subsequent rounds.
- **Example:** Researcher A reports a 3% accuracy improvement. Without review, this propagates to all researchers. With review, the Reviewer checks: "Was the test set fixed? Was the same random seed used? Is 3% within measurement noise?" — and may overturn the claim, preventing a false positive from contaminating the shared state.
- **Note on qualitative mode:** Self-assessment (Principle 2 relaxation) makes Principle 9 more critical, not less. The Reviewer (Opus) provides the authoritative quality score each round, compensating for the unreliability of self-assessed proxy metrics.

### 10. Synthesis Over Selection

- **Why:** Picking the "winning" researcher discards 2/3 of the work done. Different researchers explore different search space partitions and develop complementary insights. The synthesizer's job is to identify which insights are orthogonal (can be combined) vs. redundant (can be deduplicated), producing a unified result that no single researcher could have reached alone.
- **Violation consequence:** The conference produces a result equivalent to running one autoresearch with extra steps. The cross-pollination value — the primary reason to run a conference — is lost.
- **Example:** Researcher A finds the best architectural change. Researcher B finds the best hyperparameter configuration. Neither tested their improvement in combination. The Synthesizer identifies these as orthogonal improvements and combines them, producing a result better than either individual finding.

### 11. Relentless Persistence
- **Why:** Conference value compounds across rounds. Round 1 finds local optima. Round 3+ enables cross-pollination breakthroughs where Researcher A's validated insight transforms Researcher B's approach.
- **Violation consequence:** Conference stops after round 1 with isolated results. The synthesis that would have emerged from cross-pollination never happens.
- **Example:** A 3-round conference with 3 researchers: Round 1 finds 3 local optima. Round 2 cross-pollinates, producing 2 hybrid approaches. Round 3 synthesizes. Stopping at round 1 misses the synthesis entirely.

---

## Mapping to conference.md

| Principle | conference.md Section | Enforcement |
|-----------|----------------------|-------------|
| Single Metric | `## Success Metric` | Template requires exactly one metric + direction |
| Mechanical Verification | `## Success Metric → Target` | Target must be a computable expression |
| Atomic Changes | (Loop protocol) | Researcher agent instructed per-prompt |
| Keep or Revert | Per-researcher TSV | Each row records `kept` or `reverted` |
| Full History | Researcher logs + TSV | Append-only; never delete rows |
| Constrained Search | `## Search Space` | Allowed and Forbidden explicitly listed |
| Autonomous Loop | `## Constraints` | Default: no pause |
| Knowledge Transfer | `## Shared Knowledge` | Conference Chair populates after each round |
| Adversarial Review | `peer_review_round_N.md` | Reviewer (Opus) runs after every poster session |
| Synthesis Over Selection | `synthesis.md` | Synthesizer (Opus) runs once at end |
| Relentless Persistence | Conference Persistence Directive | Conference Chair advances rounds automatically until budget or convergence |
