# Conference Protocol

Authoritative reference for round structure, convergence logic, failure handling, worktree
management, and qualitative mode behavior. The Conference Chair (SKILL.md) follows this
document for all orchestration decisions.

---

## Section 1: Round Structure

A conference consists of one or more rounds. Each round has exactly four phases that execute
in strict sequence. Parallelism occurs only within Phase 1.

```
┌─────────────────────────────────────────────────────────────┐
│                      CONFERENCE ROUND                        │
│                                                              │
│  Phase 1: INDEPENDENT RESEARCH (parallel)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │Researcher│  │Researcher│  │Researcher│  N agents run     │
│  │    A     │  │    B     │  │    C     │  simultaneously   │
│  │ iter×N   │  │ iter×N   │  │ iter×N   │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       └──────────────┴─────────────┘                        │
│                       │                                      │
│  Phase 2: POSTER SESSION (sequential, Haiku)                │
│  ┌────────────────────────────────────────┐                 │
│  │ Session Chair collects all researcher  │                 │
│  │ logs → poster_session_round_N.md       │                 │
│  └────────────────────┬───────────────────┘                 │
│                       │                                      │
│  Phase 3: PEER REVIEW (sequential, Opus)                    │
│  ┌────────────────────────────────────────┐                 │
│  │ Reviewer challenges claims             │                 │
│  │ → peer_review_round_N.md              │                 │
│  └────────────────────┬───────────────────┘                 │
│                       │                                      │
│  Phase 4: KNOWLEDGE TRANSFER (Conference Chair)             │
│  ┌────────────────────────────────────────┐                 │
│  │ Validated findings → Shared Knowledge  │                 │
│  │ Cherry-pick validated code (if wt)     │                 │
│  │ Update conference_results.tsv verdicts │                 │
│  │ Log round.completed event              │                 │
│  └────────────────────────────────────────┘                 │
│                       │                                      │
│              Convergence check                               │
│           (see Section 2 below)                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Phase 1: Independent Research

**Entry condition:** Round has started. Worktrees (if applicable) have been reset to
`conference/best` (or current branch for round 1).

**Execution:** Conference Chair spawns N Researcher agents simultaneously using the Agent
tool with `run_in_background: true`. All N calls are issued in a single message block.

**Researcher assignment:** Each researcher receives:
- Their search space partition (assigned strategy) or full space (free strategy)
- Shared knowledge accumulated from all prior rounds
- The `LAST_ROUND` signal if this is the final round

**Waiting:** Conference Chair waits for ALL researcher agents to complete or timeout.
Per-researcher timeout: `researcher_timeout` from `conference.md`, or `time_budget /
researcher_count` if not explicitly set.

**Exit condition:** All researchers have completed (status: COMPLETED, TARGET_REACHED,
or STALLED_L3), or the per-researcher timeout has elapsed for each.

---

### Phase 2: Poster Session

**Entry condition:** Phase 1 is complete. At least one researcher produced output
(even if others failed or timed out).

**Skip condition:** Single-researcher conference (count: 1). Phase 2 is skipped;
proceed directly to Phase 3.

**Execution:** Conference Chair spawns one Session Chair (Haiku) agent. Passes paths
to all researcher log files and TSV files. Context is capped: last 10 iterations per
researcher to prevent context overflow.

**Exit condition:** `poster_session_round_{N}.md` exists and is non-empty.

---

### Phase 3: Peer Review

**Entry condition:** Phase 2 is complete (or skipped for single-researcher).

**Execution:** Conference Chair spawns one Reviewer (Opus) agent. Passes the poster
session file (or researcher outputs directly, for single-researcher). For worktree mode,
also passes worktree paths for running verification tests.

**Exit condition:** `peer_review_round_{N}.md` exists and contains verdicts for all
key findings.

---

### Phase 4: Knowledge Transfer

**Entry condition:** Phase 3 is complete.

**Execution (Conference Chair):**

1. Read `peer_review_round_{N}.md`
2. Extract all findings with verdict `validated`
3. Append each validated finding to `Shared Knowledge` in the conference context
   (this section is passed to all researchers in the next round's prompt)
4. If worktree mode: cherry-pick validated code changes to `conference/best` branch
   (see Section 5 for conflict resolution)
5. Update `conference_results.tsv`: set `peer_review_verdict` column for all rows
   from this round
6. Update `conference.md` Conference Log table (append one row per researcher)
7. Write `round.completed` event to `conference_events.jsonl`

**Exit condition:** All 7 steps above complete. Convergence check begins.

---

## Section 2: Convergence Logic

After each round's Phase 4, the Conference Chair checks whether the conference should
continue or terminate. Conditions are evaluated in order; the first matching condition wins.

### Condition 1: Target Reached (immediate exit)

**Trigger:** Any researcher reports `TARGET_REACHED` status (metric hit the target value).

**Action:** Mark conference as `CONVERGED`. Proceed to synthesis. No further rounds needed.

**Note:** If ALL researchers hit the target simultaneously, proceed to synthesis immediately.
If only some do, the others' results are still used in synthesis.

---

### Condition 2: Metric Convergence (metric mode)

**Trigger:** Best metric across ALL researchers did not improve for 2 consecutive complete rounds.

**Calculation:**
```
round_best(N) = max/min metric_value across all researchers in round N
               (direction from conference.md)

converged = round_best(N) <= round_best(N-1) + noise_threshold
            AND same condition held in round N-1
```

Noise threshold: default 0.1% of baseline metric value. If metric is integer-valued
(e.g., test cases passed), threshold is 0.

**Action:** Mark conference as `CONVERGED`. Proceed to synthesis.

---

### Condition 3: Qualitative Convergence (qualitative mode)

**Trigger:** Reviewer assigns scores >= 8/10 to ALL researcher outputs for 2 consecutive rounds.

**Check location:** `peer_review_round_{N}.md`, Qualitative Scores table, Reviewer Score column.

**Action:** Mark conference as `CONVERGED`. Proceed to synthesis.

---

### Condition 4: Budget Stop

**Trigger:** Any of the following hard limits is hit:

| Limit | Source | Check |
|-------|--------|-------|
| `max_total_iterations` | conference.md | Sum of all iterations across all researchers across all rounds |
| `max_rounds` | conference.md | Round number equals max_rounds |
| `time_budget` | conference.md | Wall-clock elapsed time >= time_budget |

**Action:** Mark conference as `BUDGET_STOP`. Signal `LAST_ROUND` to researchers if
`max_rounds` is the binding constraint (so researchers can switch to EXPLOIT for the
final round). Proceed to synthesis after that round completes.

**Important:** `LAST_ROUND` signal must be sent BEFORE Phase 1 of the final round,
not during.

---

### Condition 5: All Stalled

**Trigger:** ALL researchers simultaneously report stuck Level 2 or Level 3 in the
same round's Phase 1.

**Action:** Mark conference as `STALLED`. Trigger early synthesis — no further rounds.
This overrides `max_rounds` (if more rounds remain) because more iterations will not help.

---

### Decision Table

```
After round N, check in order:

1. Any TARGET_REACHED?          → CONVERGED → synthesis
2. Budget hit?                  → BUDGET_STOP → [signal LAST_ROUND if max_rounds] → synthesis
3. All stalled?                 → STALLED → synthesis
4. Metric/qualitative converged (2 consecutive)?  → CONVERGED → synthesis
5. None of the above?           → continue → round N+1
```

---

## Section 3: Failure Modes

### 3.1 Researcher Crash or Timeout

**Detection:** Researcher agent does not complete within `researcher_timeout`.

**Response:**
1. Log `researcher.stuck` event to `conference_events.jsonl` with `stuck_level: timeout`
2. Mark this researcher as `FAILED` in `conference_results.tsv` for this round
3. Proceed to Phase 2 with results from completed researchers only
4. In the next round, re-spawn the failed researcher from its last known good state
   (last complete row in `researcher_{ID}_results.tsv`)

**Phase 2 handling:** Session Chair notes the researcher as `FAILED` in the poster session
with whatever partial output is available (may be empty for that researcher).

**Minimum to continue:** At least one researcher must complete Phase 1 to proceed.
If ALL researchers fail or time out in the same round, abort the conference with a
`conference.failed` event and produce a partial report from available data.

---

### 3.2 Researcher PIVOT and Re-spawn

Two exit paths from the autoresearch inner loop:

**Target Reached:**
- Researcher metric hit the success target
- Conference Chair marks this researcher as `CONVERGED`
- Check: if ALL researchers are CONVERGED or STALLED/FAILED, skip to synthesis immediately
- Otherwise, continue with the remaining researchers for this round's remaining phases

**Level 2 Stuck (5 consecutive non-improving iterations — DEEP PIVOT):**
- Researcher signals `STALLED_L2` to Conference Chair after exhausting the deep pivot attempt
- Conference Chair marks this researcher as `STALLED_L2` in the round log
- Researcher continues participating in this round but may be re-assigned a different search partition next round
- In the next round, re-spawn with the strategy from Shared Knowledge that differs most from the current approach

**Level 3 Stuck (7 consecutive non-improving iterations — search space exhausted):**
- Researcher signals `STALLED_L3` to Conference Chair
- Conference Chair marks this researcher as `STALLED` in the round log
- Researcher is still included in Phase 2 (its findings — even negative ones — are useful)
- **The conference does NOT stop** — only this researcher pauses
- In the next round, Conference Chair re-spawns this researcher with a fundamentally different strategy derived from other researchers' validated findings in Shared Knowledge

---

### 3.3 Merge Conflicts in Worktree Mode

When cherry-picking validated improvements to `conference/best` in Phase 4:

**Step 1:** Conference Chair attempts `git cherry-pick` for each validated change.

**Step 2:** If a conflict occurs on file `F`:
- Compare `metric_value` of the researcher who made the conflicting change in this round
- The researcher with the **better metric delta** wins file `F`
- The other researcher's change for file `F` is discarded
- Non-conflicting files from both researchers are kept

**Step 3:** Log all conflicts and resolutions in `peer_review_round_{N}.md` under
"Conflict Resolution" section (Reviewer fills this in if conflicts are anticipated;
Conference Chair updates it post-cherry-pick with actual outcome).

**Step 4:** If automatic resolution fails (ambiguous metric or identical metric for
conflicting researchers), keep the change from the lower-lettered researcher
(A beats B, B beats C) and log the tie-break rule used.

---

### 3.4 Conference Resumption After Interruption

All per-round artifacts are written to disk incrementally. On startup:

**Step 1:** Conference Chair scans the working directory for existing round artifacts:
```
poster_session_round_N.md   → Phase 2 complete for round N
peer_review_round_N.md      → Phase 3 complete for round N
conference_results.tsv      → Phase 4 rows added for round N
```

**Step 2:** Determine the last fully completed round (all 4 phases done — look for
a `round.completed` event in `conference_events.jsonl` for round N).

**Step 3:** Resume behavior:
- If round N is fully complete → start round N+1
- If round N is partially complete (mid-round interruption) → discard incomplete
  artifacts from round N and re-run round N from Phase 1

**Step 4:** Re-read Shared Knowledge from the last fully completed round's peer review
and propagate to all researchers in the resumed round.

**File safety:** Never overwrite completed round artifacts. Use round number in filename
(`poster_session_round_N.md`) to ensure idempotency.

---

### 3.5 Single-Researcher Conference (count: 1)

Degrades gracefully to enhanced autoresearch with peer review:

| Phase | Single-Researcher Behavior |
|-------|---------------------------|
| Phase 1 | Runs one researcher (Researcher A) — no change |
| Phase 2 | **SKIPPED** — nothing to compare across researchers |
| Phase 3 | **Runs normally** — Reviewer still challenges the single researcher's claims (this is the value-add over plain autoresearch) |
| Phase 4 | Knowledge transfer to Researcher A's next-round context (validated findings feed back as shared knowledge) |

**Naming convention:** Per-researcher TSV uses `researcher_A_results.tsv` naming
(not `autoresearch-results.tsv`) for consistency with multi-researcher conferences.

**When to use:** A single-researcher conference is appropriate when the user wants
autoresearch's optimization loop PLUS adversarial external review of findings before
accepting them. The peer review overhead is the only cost — it adds one Opus call per round.

---

### 3.6 No Metric Defined (qualitative mode config error)

**Detection:** `Mode: qualitative` but no `Success Criteria` section, OR `Mode: metric`
but no `Success Metric` section.

**Response:** Conference Chair aborts startup with a clear error message:
```
ERROR: conference.md validation failed.
  - Mode is 'qualitative' but 'Success Criteria' section is missing or empty.
  - Add a 'Success Criteria' section describing what a good result looks like.
```

Do not begin Phase 1 until the config is valid.

---

## Section 4: Endgame

### Conference-Level Endgame Override

The Conference Chair's `LAST_ROUND` signal overrides each researcher's individual
endgame logic. This precedence rule ensures the whole conference exploits on the
final round, not just individual researchers.

**When `LAST_ROUND` is signaled:**
- Conference Chair has determined this will be the final round (budget stop by max_rounds,
  or convergence detected but one more round is allowed to confirm)
- ALL researchers receive `Signal: LAST_ROUND` in their Phase 1 prompt
- ALL researchers switch to EXPLOIT mode immediately (no risky new strategies)
- Researchers focus on micro-optimizations of their current best approach

**Last round behavior by role:**

| Role | Last Round Behavior |
|------|---------------------|
| Researcher | EXPLOIT mode: micro-optimizations only, no new risky strategies |
| Session Chair | Standard summarization (no change) |
| Reviewer | Focus on validating final claims rather than aggressive challenge — goal is a clean synthesis handoff |
| Synthesizer | N/A — runs after the last round |

### Individual Endgame (without LAST_ROUND signal)

Each researcher independently detects its own endgame when `remaining_iterations < 3`
within its current round. This is the autoresearch endgame behavior and runs normally
unless overridden by the conference-level signal.

---

## Section 5: Worktree Management

### When Worktrees Activate

Worktrees are created only when BOTH conditions hold:

| Condition | Required? |
|-----------|-----------|
| `Mode: metric` | Yes — qualitative mode produces analysis, not code |
| Researchers make code/file changes (not prompt-only) | Yes — prompt/config optimization can use simple file copies |

If either condition is false, researchers work in the main working directory with
separate named files (`researcher_A_log.md`, etc.). No worktrees are needed.

**Auto-detection:** Conference Chair reads the `Allowed Changes` section of `conference.md`.
If it references code files, source directories, or any non-text artifact, activate worktrees.
If it references only prompt text or configuration values, skip worktrees.

---

### Branch Structure

```
main (or user's current branch — untouched during conference)
  ├── conference/researcher-A    ← Researcher A's isolated workspace
  ├── conference/researcher-B    ← Researcher B's isolated workspace
  ├── conference/researcher-C    ← Researcher C's isolated workspace
  └── conference/best            ← Validated improvements cherry-picked here
```

**Branch creation:** Conference Chair creates all branches at startup before round 1.
Initial state: all branches point to the same commit as the user's current branch.

---

### Per-Round Worktree Lifecycle

```
Round N begins
    │
    ├─ Phase 1 start:
    │     Conference Chair resets each conference/researcher-{ID} branch
    │     to match conference/best (or current branch for round 1)
    │     via: git -C {worktree_path} reset --hard conference/best
    │
    ├─ Phase 1 (research):
    │     Each researcher works exclusively in their worktree path
    │     Commits go to conference/researcher-{ID}
    │
    ├─ Phase 2 (poster session):
    │     Session Chair reads: git diff conference/best conference/researcher-{ID}
    │     (diff stats only — not full patch — to cap context size)
    │
    ├─ Phase 3 (peer review):
    │     Reviewer can run tests in any worktree via the worktree paths
    │     Uses /compare-worktrees if available
    │
    └─ Phase 4 (knowledge transfer):
          For each validated finding with code changes:
            git -C {conference_best_worktree} cherry-pick {commit_hash}
          Handle conflicts per Section 3.3
Round N complete
```

---

### Cleanup After Synthesis

After `synthesis.md` and `final_report.md` are produced, the Conference Chair offers
three options:

**Option 1: Merge best into main**
```bash
git checkout main
git merge conference/best --no-ff -m "conference: merge validated improvements"
git branch -d conference/researcher-A conference/researcher-B conference/researcher-C conference/best
git worktree remove {worktree_A_path}
git worktree remove {worktree_B_path}
git worktree remove {worktree_C_path}
```

**Option 2: Keep worktrees for inspection**
Print paths to all worktrees and branches. No cleanup performed. User can inspect
and merge manually.

**Option 3: Clean up everything**
```bash
git worktree remove {worktree_A_path}
git worktree remove {worktree_B_path}
git worktree remove {worktree_C_path}
git branch -D conference/researcher-A conference/researcher-B conference/researcher-C conference/best
```

Default: present all three options to the user. Do not merge or delete automatically.

---

## Section 6: Qualitative Mode

### Overview

Qualitative mode enables the conference format for research tasks that have no numeric
metric: literature synthesis, hypothesis generation, design exploration, writing quality.

The core tradeoff: autoresearch's Principle #2 (Mechanical Verification) cannot apply
because there is no computable metric. Qualitative mode uses self-assessment as a proxy.

---

### Self-Assessment as Proxy Metric

**Inner loop:** After each iteration, the researcher rates its output 1-10 against the
Success Criteria from `conference.md`. This self-assessed score drives keep/revert
decisions within Phase 1.

**Logging:** Self-assessed score is recorded as `metric_value` in
`researcher_{ID}_results.tsv`. This keeps the TSV format consistent with metric mode
and enables convergence curve analysis.

**Limitation:** Self-assessment is unreliable. The adversarial Reviewer in Phase 3
provides the authoritative judgment and may overturn self-assessments. This is
explicitly acknowledged — qualitative mode is less reliable than metric mode in the
inner loop, but the Reviewer compensates at the conference level.

---

### Reviewer Scoring in Qualitative Mode

In qualitative mode, the Reviewer (Phase 3) assigns authoritative scores instead of
just verdicts:

| Metric | Range | Meaning |
|--------|-------|---------|
| Reviewer Score | 1-10 | Authoritative quality judgment against Success Criteria |
| Self-Assessed Score | 1-10 | Researcher's own estimate (may differ from reviewer) |

**Score rubric (suggested):**
- **9-10:** Exceeds criteria — comprehensive, novel, well-connected
- **7-8:** Meets criteria — solid work, minor gaps
- **5-6:** Partially meets criteria — clear gaps or shallow coverage
- **3-4:** Below criteria — significant issues in depth or accuracy
- **1-2:** Does not meet criteria — fundamental misunderstanding or off-topic

The Reviewer documents its scores in `peer_review_round_{N}.md` under "Qualitative Scores."

---

### Convergence in Qualitative Mode

**Threshold:** Reviewer assigns scores >= 8/10 to ALL researcher outputs for 2 consecutive rounds.

**Rationale:** A score of 8 ("meets criteria with minor gaps") sustained across all
researchers and two rounds indicates the conference has reached saturation — incremental
rounds are unlikely to produce meaningful improvement.

**Early convergence:** If all researchers score 9-10 in a single round, convergence
may be declared after 1 round at the Conference Chair's discretion.

**No convergence reached:** If scores plateau below 8 for 2+ rounds, apply the
All Stalled rule (Section 2, Condition 5) and proceed to synthesis with the best
available outputs.

---

### Qualitative Mode Configuration Example

```markdown
## Mode
qualitative

## Success Criteria
A comprehensive taxonomy of LLM agent architectures covering:
- At least 15 distinct architectural patterns
- Clear identification of 3+ research gaps
- Cross-domain connections to non-LLM systems
- Actionable recommendations for practitioners
```

No `Success Metric` section is needed. The Reviewer uses the Success Criteria text
directly as its evaluation rubric.

---

### Worktrees in Qualitative Mode

Worktrees are NEVER used in qualitative mode. Researchers produce analysis documents
(markdown files, structured notes) rather than code changes. File separation is achieved
through naming conventions (`researcher_A_log.md`, etc.) in the main working directory.

---

## Quick Reference

### Conference Termination Reasons

| Reason | Code | Condition |
|--------|------|-----------|
| Target reached | `CONVERGED` | Any researcher hit metric target |
| Metric plateau | `CONVERGED` | No improvement for 2 rounds |
| Quality plateau | `CONVERGED` | Reviewer >= 8/10 all researchers for 2 rounds |
| Round limit | `BUDGET_STOP` | Round count == max_rounds |
| Iteration limit | `BUDGET_STOP` | Total iterations >= max_total_iterations |
| Time limit | `BUDGET_STOP` | Elapsed time >= time_budget |
| All stalled | `STALLED` | All researchers at stuck L2+ simultaneously |

### Phase Skip Conditions

| Phase | Skip When |
|-------|-----------|
| Phase 2 (Poster Session) | count == 1 (single researcher) |
| Phase 3 (Peer Review) | Never — peer review always runs |
| Phase 4 (Knowledge Transfer) | Never — always runs after review |
| Worktree operations | Mode != metric OR changes are prompt/config only |
