# Convergence Guide

Focused reference for convergence detection, tuning, and termination tradeoffs in autoconference.

---

## Convergence Conditions

### Metric Mode

| Condition | Trigger | Code |
|-----------|---------|------|
| Target Reached | Any researcher's `metric_value` hits the target defined in `Success Metric` | `CONVERGED` |
| Metric Plateau | Best metric across ALL researchers unchanged for 2 consecutive complete rounds | `CONVERGED` |
| Budget Exhaustion | `max_total_iterations`, `max_rounds`, or `time_budget` hit | `BUDGET_STOP` |
| All Stalled | Every researcher at stuck Level 2+ simultaneously in the same round | `STALLED` |

**Evaluation order matters.** The Conference Chair checks in this sequence — first match wins:

```
1. Any TARGET_REACHED?                              → CONVERGED → synthesis
2. Budget hit (iterations / rounds / time)?          → BUDGET_STOP → synthesis
3. All researchers stalled?                          → STALLED → synthesis
4. Metric plateau (2 consecutive no-improve rounds)? → CONVERGED → synthesis
5. None of the above?                                → continue → round N+1
```

**Noise threshold:** Default is 0.1% of the baseline metric value. For integer-valued metrics (e.g., test cases passed), the threshold is 0. A round's best metric must exceed the previous round's best by more than this threshold to count as an improvement.

### Qualitative Mode

| Condition | Trigger | Code |
|-----------|---------|------|
| Quality Plateau | Reviewer assigns scores >= 8/10 to ALL researcher outputs for 2 consecutive rounds | `CONVERGED` |
| Early Quality | All researchers score 9-10 in a single round (Conference Chair discretion) | `CONVERGED` |
| Budget Exhaustion | Same as metric mode | `BUDGET_STOP` |
| All Stalled | Same as metric mode | `STALLED` |
| Sub-threshold Plateau | Reviewer scores plateau below 8 for 2+ rounds with no improvement | `STALLED` |

**Score source:** The Reviewer's authoritative scores in `peer_review_round_{N}.md` under "Qualitative Scores" — NOT the researchers' self-assessment scores.

---

## Tuning Convergence Sensitivity

### Plateau Window

The default plateau window is **2 consecutive rounds**. This balances:
- **Too short (1 round):** Premature convergence. A single unlucky round triggers early stop, missing potential breakthroughs in the next round.
- **Too long (3+ rounds):** Wasted budget. Continuing after genuine convergence burns iterations that could be saved.

To adjust: Currently hardcoded at 2. To customize, the Conference Chair can be instructed in the conference.md `Goal` section (e.g., "Use a 3-round convergence window for this exploratory conference").

### Noise Threshold

| Metric Type | Default Threshold | Rationale |
|-------------|-------------------|-----------|
| Continuous (float) | 0.1% of baseline | Filters measurement noise |
| Integer | 0 | Any improvement counts |
| Percentage (0-100) | 0.1 absolute | Small enough to detect real gains |

**When to increase:** High-variance metrics where measurement noise exceeds 0.1% (e.g., benchmark latency on shared hardware). Set to 1-2% to avoid false convergence signals from noisy runs.

**When to decrease:** Precision-sensitive tasks where 0.01% matters (e.g., model accuracy on large test sets). Set to 0.01% or use exact comparison.

### Qualitative Score Threshold

The default convergence threshold is **8/10** from the Reviewer. Interpretation:

| Score | Meaning | Converge? |
|-------|---------|-----------|
| 9-10 | Exceeds criteria | Yes (even after 1 round at Chair's discretion) |
| 8 | Meets criteria, minor gaps | Yes (after 2 consecutive rounds) |
| 7 | Solid but with clear gaps | No — keep iterating |
| <= 6 | Below criteria | No — significant work remains |

---

## Early Termination vs Budget Exhaustion

### When Early Termination Is Good

- **Genuine convergence:** The metric has truly plateaued and more iterations will not help. Saving budget is the right call.
- **Target reached:** A researcher hit the success metric. No reason to continue (unless the user wants to find an even better solution — rare).
- **All stalled:** Every researcher has exhausted their search space. Continuing wastes resources.

### When Early Termination Is Bad

- **False plateau:** The metric appeared stuck but a breakthrough was imminent. This happens when:
  - Researchers are in the middle of a strategy shift (Level 1 stuck → pivot → improvement coming)
  - The search space has "plateaus before cliffs" — long flat regions followed by sudden drops
  - One researcher is close to a breakthrough but hasn't reported it yet (it's mid-iteration)

**Mitigation:** The 2-round window helps — a single bad round doesn't trigger convergence. Additionally, the ENDGAME signal on the final round gives researchers one last chance to EXPLOIT.

### When Budget Exhaustion Is Good

- **Exploratory conferences:** The user set a generous budget intentionally. Running all rounds maximizes coverage of the search space.
- **Noisy metrics:** When individual measurements are unreliable, more data points improve the synthesis.
- **Qualitative mode:** Self-assessment is unreliable, so running more rounds gives the Reviewer more chances to correct course.

### When Budget Exhaustion Is Bad

- **Clear convergence ignored:** The metric stopped improving 3 rounds ago but `max_rounds` hasn't been reached. This wastes the user's time and compute.

**Mitigation:** The convergence check runs every round and will trigger `CONVERGED` before budget is exhausted if a true plateau is detected.

---

## Convergence Patterns

### Pattern 1: Quick Convergence (2-3 rounds)

```
Round 1: Researchers explore diverse strategies, one finds a strong approach
Round 2: Knowledge transfer spreads the winning strategy; all researchers refine it
Round 3: Minimal improvement → CONVERGED
```

**Characteristics:** Small search space, clear optimal direction, researchers rapidly align. Common in well-understood optimization problems.

### Pattern 2: Gradual Convergence (5+ rounds)

```
Round 1-2: Initial exploration, moderate improvements
Round 3-4: Cross-pollination produces novel combinations
Round 5-6: Diminishing returns, metric plateaus → CONVERGED
```

**Characteristics:** Large search space, complementary strategies that benefit from synthesis. The most valuable pattern — the conference format adds the most value here.

### Pattern 3: Breakthrough After Plateau

```
Round 1-3: Steady improvement, then plateau
Round 4: One researcher makes a breakthrough via radical pivot
Round 5: Knowledge transfer spreads breakthrough → rapid improvement
Round 6: New plateau → CONVERGED
```

**Characteristics:** Search space has local optima. The Devil's Advocate researcher or a Level 2 DEEP PIVOT often triggers the breakthrough. This is why the 2-round convergence window exists — it prevents premature termination during the plateau at round 3.

### Pattern 4: Stalled Conference

```
Round 1-2: Moderate improvement
Round 3: All researchers hit Level 2 stuck
Round 3: → STALLED → early synthesis
```

**Characteristics:** Search space is too constrained, or the problem is harder than expected. The synthesis still produces value — negative results and failed strategies inform future work.

### Pattern 5: Budget Exhaustion (No Convergence)

```
Round 1-N: Continuous improvement, never plateaus
Round N: max_rounds hit → BUDGET_STOP → synthesis
```

**Characteristics:** Rich search space with many viable strategies. The conference could have benefited from more rounds. Consider re-running with a larger budget or narrower search space partitions.
