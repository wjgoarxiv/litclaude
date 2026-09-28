---
name: autoconference:analyze
description: |
  Post-conference analysis — compares researcher trajectories, identifies failure modes,
  extracts transferable insights, and produces an insight taxonomy.
  TRIGGER when: user wants to analyze conference results, understand what happened,
  extract learnings from a completed conference.
  DO NOT TRIGGER when: user wants to run a conference (use autoconference) or ship results (use ship).
allowed-tools:
  - Agent
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebSearch
---

# autoconference:analyze — Post-Conference Insight Analysis

Analyze a completed autoconference to extract insights, patterns, and transferable learnings. This skill reads all conference artifacts and produces a structured `analysis-report.md`.

**Chaining position:** `autoconference → analyze → ship`

---

## Pre-Analysis Setup

Before running analysis, verify the conference directory exists and is complete.

1. Ask the user: "Which conference directory should I analyze?" (if not already specified)
2. Confirm the directory contains at minimum: `conference.md` and `conference_results.tsv`
3. If `final_report.md` does not exist, warn: "No final_report.md found — analysis will work from raw researcher results only. Continue?"
4. Set `CONF_DIR` to the conference directory path for all subsequent reads.

---

## Step 1: Load Conference Data

Read all available conference artifacts from `CONF_DIR`. Do not skip files — the more context, the better the analysis.

**Required files (fail if missing):**
- `conference.md` — Extract: goal, metric, baseline value, researcher count, max_rounds, strategy assignments
- `conference_results.tsv` — The aggregated results table

**Optional files (read if present, skip gracefully if absent):**
- `researcher_{ID}_results.tsv` for each researcher ID found in `conference.md` — Individual iteration histories
- `poster_session_round_*.md` — Knowledge sharing transcripts from each round's symposium phase
- `peer_review_round_*.md` — Adversarial review transcripts from each round's review phase
- `synthesis.md` — Intermediate synthesis notes if generated mid-conference
- `final_report.md` — The conference's own synthesis output

**Extraction targets while reading:**
- From `conference.md`: goal statement, target metric name and direction (maximize/minimize), baseline metric value, number of researchers, their assigned strategies, whether a Devil's Advocate was assigned
- From `conference_results.tsv`: columns (researcher_id, round, iteration, metric_value, strategy_description, kept/reverted, notes)
- From poster session files: what knowledge was shared, which researcher shared it, which round
- From peer review files: what claims were challenged, what was overturned, reviewer reasoning

---

## Step 2: Trajectory Comparison

For each researcher, compute the following metrics from their `researcher_{ID}_results.tsv`:

**Convergence speed:** Number of iterations from start to the iteration where the researcher first achieved their personal best metric. Lower is faster.

**Exploration breadth:** Count of distinct strategy categories tried. Strategies are "distinct" if they describe fundamentally different approaches (e.g., "regularization tuning" vs. "architecture change" are distinct; "L1 regularization" vs. "L2 regularization" are the same category). Use your judgment to cluster.

**Success rate:** `(number of iterations marked 'kept') / (total iterations)`. Express as a percentage.

**Final metric vs baseline improvement:** `(final_best_metric - baseline_metric) / baseline_metric * 100%`. Label as improvement or regression depending on metric direction.

**Notable finding:** One sentence describing the most significant discovery or pattern for this researcher.

Produce the following comparison table in the report:

| Researcher | Assigned Strategy | Best Metric | Convergence Speed (iters) | Exploration Breadth | Success Rate | Final Improvement vs Baseline | Notable Finding |
|------------|-------------------|-------------|---------------------------|---------------------|--------------|-------------------------------|-----------------|
| R1         | ...               | ...         | ...                       | ...                 | ...          | ...                           | ...             |
| R2         | ...               | ...         | ...                       | ...                 | ...          | ...                           | ...             |
| ...        | ...               | ...         | ...                       | ...                 | ...          | ...                           | ...             |

After the table, write 2-3 sentences summarizing the key trajectory differences. Who converged fastest? Who explored most broadly? Was there a trade-off between speed and final metric?

---

## Step 3: Failure Mode Analysis

Identify patterns of failure across all researchers. A "failure" is any iteration marked `reverted` or any claim marked `challenged`/`overturned` in peer review.

**Substep 3a — Reverted strategy clustering:**
Go through all researcher TSV files and collect every row where `kept = reverted`. Group these by strategy type (same clustering logic as Step 2). For each cluster, record:
- Strategy type name
- How many times it was tried across all researchers
- How many researchers tried it
- Whether it ever worked for anyone (any `kept` row in the same cluster)

Present as a table:

| Strategy Type | Times Tried | By N Researchers | Ever Worked? | Verdict |
|---------------|-------------|------------------|--------------|---------|
| ...           | ...         | ...              | ...          | ...     |

Verdict should be one of: `dead end` (never worked), `researcher-specific` (worked for some but not others), `timing-dependent` (worked in later rounds but not early), `conditional` (worked only with specific prerequisites).

**Substep 3b — Peer review overturns:**
From `peer_review_round_*.md` files, list every claim that was challenged or overturned. For each:
- The claim made
- The round it was challenged in
- The reason given for the challenge
- Whether the researcher recovered (did they produce a better result after the challenge?)

**Substep 3c — Systematic failure patterns:**
Look for failures that afflicted multiple researchers in the same round. If 3+ researchers tried the same type of strategy and it failed in round N, that is a systematic failure. Flag these explicitly: "Systematic failure in Round N: [description]. Possible cause: [hypothesis]."

---

## Step 4: Cross-Researcher Insight Extraction

Analyze knowledge transfer effectiveness using the `poster_session_round_*.md` files.

**Substep 4a — Knowledge transfer audit:**
For each piece of knowledge shared in a poster session:
- Who shared it
- What round it was shared in
- Which researchers were present (all, unless the file indicates otherwise)
- Whether any researcher subsequently adopted that technique (check their TSV rows after that round)
- The metric impact of adoption (compare metric in the round before adoption vs. 2 rounds after)

**Substep 4b — Transfer effectiveness table:**

| Shared Knowledge Item | Source Researcher | Round Shared | Adopters | Non-Adopters | Avg Metric Gain for Adopters |
|-----------------------|-------------------|--------------|----------|--------------|------------------------------|
| ...                   | ...               | ...          | ...      | ...          | ...                          |

**Substep 4c — Breakthrough propagation:**
Identify whether any single researcher's breakthrough had outsized influence. A "breakthrough" is any iteration that produced a metric improvement >2x the average per-iteration improvement for that researcher. If a breakthrough was shared and caused measurable improvements in others, record:
- "Researcher R{ID}'s discovery of [technique] in Round N propagated to R{ID2} and R{ID3}, producing combined improvements of X%."

If no poster session files exist, write: "No poster session transcripts available — transfer analysis skipped."

---

## Step 5: Insight Taxonomy

Produce a structured taxonomy of all actionable insights extracted from the conference. An insight is any finding that could be applied to a future similar problem.

Assign each insight a type from this controlled vocabulary:
- `technique` — A specific method or approach that improved the metric
- `anti-pattern` — A specific method or approach that consistently failed
- `meta-strategy` — An insight about how to run the search process itself (e.g., "explore broadly in early rounds, exploit in later rounds")
- `domain-insight` — A fact about the problem domain that influenced strategy selection
- `tooling` — An observation about tools, libraries, or infrastructure

Confidence scoring:
- `high` — Observed by 2+ researchers, consistent result, no contradictory evidence
- `medium` — Observed by 1 researcher with clear causal mechanism, or by 2+ researchers with one contradictory instance
- `low` — Observed once, causation unclear, or contradicted by another researcher

Transferability:
- `yes` — Applies broadly to similar problems in this domain
- `conditional` — Applies only under specific conditions (describe them)
- `no` — Specific to this dataset/problem instance

| # | Insight | Type | Source Researcher(s) | Round First Observed | Confidence | Transferable? | Conditions (if conditional) |
|---|---------|------|----------------------|----------------------|------------|---------------|-----------------------------|
| 1 | ...     | ...  | ...                  | ...                  | ...        | ...           | ...                         |
| 2 | ...     | ...  | ...                  | ...                  | ...        | ...           | ...                         |
| ... | ...   | ...  | ...                  | ...                  | ...        | ...           | ...                         |

Aim for completeness — a thin taxonomy is a failed analysis. Extract at least one insight per researcher per round if the data supports it.

---

## Step 6: Novelty Assessment

For each insight in the taxonomy (Step 5), score it on two additional dimensions:

**Predictability score** (was this obvious from the baseline?):
- `obvious` — Any domain expert would have predicted this from the problem statement
- `plausible` — An expert might have guessed this, but it wasn't certain
- `surprising` — This would not have been predicted without running the conference

**Multi-agent advantage** (did the conference format enable this discovery?):
- `yes` — This insight required multiple researchers, knowledge transfer, or adversarial review to emerge
- `possibly` — Could have been found by a single researcher, but conference accelerated it
- `no` — Any single researcher running enough iterations would have found this

Add these columns to the insight taxonomy table, or present as a supplementary table referencing insight numbers.

After the table, write a "Conference ROI" paragraph: Given the total number of researcher-iterations run, how much insight was produced? Was the conference format justified, or could a single deep autoresearch loop have achieved similar results? Be honest — if the answer is "a single researcher would have been sufficient," say so.

---

## Step 7: Write Report

Write `{CONF_DIR}/analysis-report.md` with the following structure. Do not truncate any section — each section must be fully populated.

```
# Conference Analysis Report

**Conference Goal:** [from conference.md]
**Baseline Metric:** [value and metric name]
**Best Achieved Metric:** [value, by which researcher, in which round]
**Total Researcher-Iterations:** [sum across all researchers]
**Analysis Generated:** [current date]

---

## 1. Trajectory Comparison
[Full table and summary from Step 2]

## 2. Failure Mode Analysis

### 2a. Reverted Strategy Clusters
[Table from Step 3a]

### 2b. Peer Review Overturns
[List from Step 3b]

### 2c. Systematic Failure Patterns
[Findings from Step 3c, or "None detected."]

## 3. Cross-Researcher Insight Extraction

### 3a. Knowledge Transfer Audit
[Table from Step 4b]

### 3b. Breakthrough Propagation
[Findings from Step 4c]

## 4. Insight Taxonomy
[Full table from Step 5]

## 5. Novelty Assessment
[Extended table from Step 6 + Conference ROI paragraph]

## 6. Recommended Next Steps

[Write 3-5 concrete, actionable recommendations based on the analysis. Each recommendation should cite at least one specific insight from the taxonomy. Format as a numbered list with one sentence of justification per item.]
```

After writing, confirm: "Analysis complete. Report written to `{CONF_DIR}/analysis-report.md`. [N] insights extracted, [M] failure modes identified. Top recommendation: [first item from §6]."

---

## Error Handling

**Missing researcher TSV files:** Proceed with `conference_results.tsv` only. Note in the report which researchers had no individual TSV available and flag that trajectory analysis for those researchers is approximate.

**Truncated conference (stopped before max_rounds):** Note the stopping round prominently at the top of the report. Distinguish between: user-interrupted, convergence-triggered, or error-stopped. Adjust trajectory analysis accordingly.

**No poster session files:** Skip Step 4 and note the absence. Knowledge transfer analysis requires these files.

**Contradictory data** (e.g., a strategy marked both `kept` and `reverted` in different rows): Flag it explicitly in the relevant section and use the later-round entry as the authoritative record.
