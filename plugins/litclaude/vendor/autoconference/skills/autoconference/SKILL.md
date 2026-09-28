---
name: autoconference
description: |
  Core conference loop — spawns N parallel autoresearchers, runs 4-phase rounds
  (independent research, poster session, peer review, knowledge transfer),
  and produces synthesized results combining the best findings.
allowed-tools:
  - Agent
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebFetch
  - WebSearch
---

# Autoconference — Core Conference Protocol

*Full orchestration protocol for the multi-agent research conference.*

## Pre-Flight Setup (Mandatory)

Before starting any conference, the Conference Chair MUST run the start gate below. Do NOT start Phase 1 from implied defaults or a partially specified request.

### Start Gate: Inputs → Conditions → Final Confirm

Required inputs:
- **Researcher count:** exact number of researcher agents.
- **Iterations:** `iterations_per_round` and `max_rounds`, or an exact `max_total_iterations` budget from which those values can be calculated.
- **Success definition:** metric mode requires metric name, target, and direction; qualitative mode requires explicit natural-language Success Criteria.
- **Critic / Devil's Advocate setting:** the adversarial Reviewer remains mandatory every round; ask whether one researcher should also be assigned as a Devil's Advocate (`yes`/`no`).

Gate behavior:
1. **If all required inputs are exact:** calculate the run conditions (`researcher_count × iterations_per_round × max_rounds = max_total_iterations`), summarize researcher count, iteration budget, Success Metric/Criteria, and Critic/Devil's Advocate setting, then ask for explicit final confirmation: "Proceed with these conditions?"
2. **If any required input is missing or vague:** stop and ask the user for exact values. After the user supplies them, calculate the run conditions and ask for final confirmation.
3. **Only after the user confirms:** continue to STARTUP Step 1 and begin the conference workflow.

The user may answer "use recommended defaults" only after seeing the recommended values in the confirmation summary; that still counts as explicit final confirmation.

After the start gate, ask or confirm the remaining setup questions as needed.

### Question 1: Researcher Count
Ask: "How many researchers should participate in this conference?"

Present options:
- **2 researchers** — Minimal. Good for A/B comparison of two approaches.
- **3 researchers** (recommended) — Balanced. Enough diversity for cross-pollination without excessive overhead.
- **4-5 researchers** — Large-scale. For broad search spaces with many distinct strategies.

If the user already specified `count` in conference.md, confirm it: "Your conference.md specifies N researchers. Proceed with this?"

### Question 2: Devil's Advocate Researcher
Ask: "Should one of the researchers be a Devil's Advocate — deliberately pursuing contrarian strategies?"

Explain:
- **Yes** — One researcher is assigned to challenge the mainstream approach. They try the opposite of what seems obvious, test assumptions others take for granted, and explore strategies that the other researchers would dismiss. This catches blind spots and occasionally discovers breakthroughs.
- **No** — All researchers pursue constructive strategies in their assigned search space partitions.

If the user says yes, assign one researcher the Devil's Advocate role (see `../../references/agent-prompts.md` §Devil's Advocate).

### Question 3: Overnight Execution
Ask: "Do you want this conference to run overnight / unattended?"

If yes:
- Recommend: `bash scripts/autoconference-loop.sh ./conference-dir/`
- Explain the 3 execution modes (foreground / nohup / tmux)
- Set `pause_every: never` in the conference config
- Remind: "I'll run autonomously. You can check progress with `bash scripts/check_conference.sh`"

If no:
- Offer `pause_every: N` so the user can review between rounds
- The Conference Chair pauses after each peer review for user feedback

### Question 4: Search Space Strategy
Ask: "How should researchers divide the search space?"

Present options:
- **Assigned** (recommended) — Each researcher gets a specific focus area. Less overlap, more coverage.
- **Free** — All researchers explore the full space. More competition, potential redundancy.

If the user already specified this in conference.md, confirm it.

**IMPORTANT:** Do NOT start Phase 1 of Round 1 until ALL pre-flight questions are answered and the final confirmation gate is explicitly approved.

## When to Use This Skill

Use autoconference when:
- The **search space is large enough to partition** — multiple researchers exploring different regions find more than one exploring sequentially
- The **problem benefits from diverse approaches** — different strategies cross-pollinate
- **Self-evaluation has blind spots** — adversarial reviewer catches what single-agent autoresearch misses (Goodhart's Law mitigation)
- **Synthesis > selection** — combining insights from multiple researchers produces results none could reach alone

Do NOT use when:
- A single autoresearch loop would suffice (use `autoresearch-skill` instead)
- The problem is trivial or has a tiny search space
- No clear metric or success criteria is defined
- A single approach is obviously correct

## The conference.md Format

Copy `../../assets/conference_template.md` to start a new conference (or scaffold with `python ../../scripts/init_conference.py`). Key sections:

| Section | Purpose |
|---------|---------|
| `Goal` | What to achieve (specific and measurable) |
| `Mode` | `metric` (numeric optimization) or `qualitative` (reasoned judgment) |
| `Success Metric` | Metric name, target, direction — metric mode only |
| `Success Criteria` | Natural language description of "good" — qualitative mode only |
| `Researchers` | count, iterations_per_round, max_rounds |
| `Search Space` | Allowed and forbidden changes (inherited by all researchers) |
| `Search Space Partitioning` | `assigned` (each researcher has a focus) or `free` (overlap allowed) |
| `Constraints` | max_total_iterations, time_budget, researcher_timeout |
| `Current Approach` | Baseline description |
| `Shared Knowledge` | Auto-populated each round with validated findings |
| `Conference Log` | Auto-maintained table by Conference Chair |

## Conference Orchestration Protocol

This is the master loop. Follow it exactly as the Conference Chair.

### STARTUP

**1. Read conference.md**
Parse all sections. If any required field is missing or invalid, stop and tell the user what needs fixing before proceeding.

If `conference.md` contains `## Pre-Flight Gate`, treat `**Final confirmation:** pending` as a hard stop: summarize the gate, ask for confirmation, and do not continue until the user approves.

**2. Validate configuration**
- `mode` must be `metric` or `qualitative`
- `count` must be >= 1
- Metric mode: `Success Metric` must have name, target, and direction
- Qualitative mode: `Success Criteria` must be non-empty
- `max_total_iterations` and `max_rounds` must be positive integers

**3. Detect worktree need**
If `mode == metric` AND researchers will make code changes → create per-researcher git worktrees (branches: `conference/researcher-{ID}`, plus `conference/best`). For prompt/config-only or qualitative mode, file-based isolation is sufficient. See `../../references/conference-protocol.md` §5 for full worktree lifecycle.

**4. Initialize output files**
For each researcher `{ID}` in `[A, B, C, ...]` (up to `count`):
- Create `researcher_{ID}_log.md` (empty with header)
- Create `researcher_{ID}_results.tsv` (header + baseline row)

Create `conference_results.tsv` (header only) and `conference_events.jsonl` (empty).
Log `conference.started` event to JSONL.

**5. Partition search space**
- `strategy: assigned` → read Researcher A/B/C Focus sections from conference.md
- `strategy: free` → all researchers receive the full search space

### ROUND LOOP

**6. Phase 1 — Spawn N Researcher agents in parallel**
Spawn all N researchers simultaneously using the `Agent` tool with `run_in_background: true`. Log `round.started` event.

Each Researcher prompt MUST include (see `../../references/agent-prompts.md` §Researcher for full contract):
- The autoresearch 5-stage loop protocol: Understand → Hypothesize → Experiment → Evaluate → Log
- This researcher's search space partition (assigned focus OR full space for `free`)
- The conference's Allowed Changes and Forbidden Changes
- Shared Knowledge from prior rounds (empty for round 1)
- Path to this researcher's log file and TSV file
- Path to this researcher's worktree (if worktree mode)
- `iterations_per_round` count
- Mode-specific evaluation: numeric metric (metric mode) OR self-assessment 1-10 against Success Criteria (qualitative mode)
- If this is the last round: explicit instruction "ENDGAME MODE — switch from EXPLORE to EXPLOIT only"

Wait for all researchers to complete (respect `researcher_timeout`). If a researcher crashes or times out, proceed with partial results from completed researchers; log status `failed` in `conference_results.tsv`. Re-spawn failed researchers next round from their last known good state.

After all researchers complete (or timeout), update `conference_progress.png` — a live multi-researcher convergence plot refreshed every round. Use the `/scientific-visualization` skill: read all `researcher_*_results.tsv` files, plot iteration number (x) vs metric value (y) with one line per researcher (Okabe-Ito palette), overlay a best-of-conference envelope, and mark the target threshold. Call `rcparams()` from `../../scripts/style_presets.py` before plotting. Single-panel layout. Overwrite `conference_progress.png` each round.

**7. Phase 2 — Spawn Session Chair (Haiku) to produce poster session**
Spawn one Session Chair agent. Prompt MUST include:
- Paths to all researcher TSV files + last 10 log entries per researcher (not full logs — context size management)
- Worktree diff summaries (if worktree mode)
- Output path: `poster_session_round_{N}.md`
- Instruction: for each researcher, summarize approach taken, iterations run, best metric, key findings, notable failures

Log `round.poster_session` event.

**8. Phase 3 — Spawn Reviewer (Opus) for adversarial peer review**
Spawn one Reviewer agent. Prompt MUST include:
- Path to `poster_session_round_{N}.md`
- The conference's Success Metric or Success Criteria
- Paths to researcher worktrees (for running validation tests, if applicable)
- Output path: `peer_review_round_{N}.md`
- Instruction: challenge every claim — check for overfitting, measurement noise, invalid comparisons, logical gaps. Assign verdict per finding: `validated` | `challenged` | `overturned`

Log `round.peer_review` event.

**9. Phase 4 — Knowledge Transfer**
Read `peer_review_round_{N}.md` verdicts:
- Append all `validated` findings to the `Shared Knowledge` section in conference.md
- If worktree mode: cherry-pick validated code changes to `conference/best` branch (see `../../references/conference-protocol.md` §5 for conflict resolution rules)
- Update `conference_results.tsv` rows for this round with `peer_review_verdict` values
- Log `round.completed` event with best metric and convergence status

**10. Check convergence**
See `../../references/conference-protocol.md` §2 for full convergence implementation. Also see `convergence-guide.md` in this directory for a focused convergence reference. Summary:

| Condition | Trigger |
|-----------|---------|
| Metric mode: best metric unchanged for 2 consecutive rounds | CONVERGED |
| Qualitative mode: all outputs rated >= 8/10 for 2 consecutive rounds | CONVERGED |
| `max_total_iterations` or `max_rounds` or `time_budget` hit | BUDGET STOP |
| All researchers at stuck Level 2+ simultaneously | STALLED → early synthesis |

- If converged / budget stop / stalled → exit loop → go to SYNTHESIS (Step 11)
- If next round will be the last before `max_rounds` → signal ENDGAME to researchers in Step 6
- Else → increment round counter → return to Step 6

### SYNTHESIS

**11. Spawn Synthesizer (Opus)**
Spawn one Synthesizer agent. Prompt MUST include:
- Paths to ALL `poster_session_round_*.md` and `peer_review_round_*.md` files
- Paths to ALL researcher log files and TSV files
- The conference's Goal and Success Metric/Criteria
- Output paths: `synthesis.md` and `final_report.md`
- Instruction: combine complementary insights from multiple researchers — not just pick the winner. Use `../../assets/synthesis_template.md` and `../../assets/report_template.md`.

**12. Worktree cleanup (if worktree mode)**
Offer three options to the user:
1. Merge `conference/best` into original branch
2. Keep worktrees for manual inspection
3. Delete all conference worktrees and branches

**13. Log completion**
Log `conference.completed` event with links to `synthesis.md` and `final_report.md`. Report summary to user: rounds run, total iterations, final best metric/score, synthesis location.

## Output Files

```
conference.md                    # Config (updated: Shared Knowledge + Conference Log)
conference_results.tsv           # Master conference-level TSV (all rounds, all researchers)
conference_progress.png          # Live convergence plot (updated each round)
conference_events.jsonl          # Append-only event log

researcher_A_log.md              # Per-researcher detailed iteration logs
researcher_A_results.tsv         # Per-researcher TSV
researcher_B_log.md
researcher_B_results.tsv
...

poster_session_round_1.md        # Session Chair summary (one per round)
peer_review_round_1.md           # Reviewer verdicts (one per round)
...

synthesis.md                     # Final synthesized output (Synthesizer)
final_report.md                  # Executive summary with full conference history
```

See `../../references/results-logging.md` for TSV column schemas and JSONL event format.

**Visualization:** All conference visualizations (convergence plots, researcher heatmaps, synthesis diagrams) MUST use `../../scripts/style_presets.py`. Call `rcparams()` before any plotting. See `../../references/visualization-guide.md` for the 7 mandatory rules: white background, Okabe-Ito palette, DPI 600, no titles, colored legend text.

## Safety & Guardrails

- **`max_total_iterations`** — hard cap on total iterations across all researchers. Prevents runaway execution.
- **`max_rounds`** — hard cap on conference rounds.
- **`time_budget`** — wall-clock limit for the entire conference.
- **`researcher_timeout`** — per-researcher time limit (default: `time_budget / researcher_count`, or set explicitly). If exceeded, the researcher is marked `failed` and the conference proceeds with partial results.
- **Automatic rollback** — inherited from autoresearch. Each researcher reverts failed experiments before the next iteration.
- **Per-experiment timeout** — inherited from autoresearch. Each Bash command in Stage 3/4 is wrapped with `timeout 5m`. Exit code 124 = timeout — revert and continue. Distinct from `researcher_timeout` (per-round level) vs per-experiment (per-iteration level).
- **Forbidden changes enforcement** — inherited from autoresearch. The `Forbidden Changes` list is passed verbatim to every researcher's prompt.

## Stuck Detection

**Per-researcher (inherited from autoresearch-skill):**
- Level 1 — Plateau (3 consecutive non-improving): switch to a fundamentally different strategy
- Level 2 — Deep Stuck (5 consecutive non-improving): DEEP PIVOT — radical paradigm shift. Adopt strategy from Shared Knowledge that differs most from current approach. If still non-improving after 2 more attempts, signal STALLED_L2 to Conference Chair (researcher continues but may be re-assigned next round).
- Level 3 — Irrecoverable (7 consecutive non-improving): Signal STALLED_L3 — researcher has exhausted its search space. Conference Chair re-spawns with fundamentally different strategy from Shared Knowledge next round. **The conference does NOT stop** — only this researcher pauses.

**Conference-level:**
- If all researchers simultaneously reach stuck Level 2+ in the same round → Conference Chair logs `conference.stalled` event and proceeds directly to SYNTHESIS (Step 11) without waiting for convergence.
- A Level 3 self-terminated researcher is marked `STALLED` in `conference_results.tsv`. On the next round, it is re-spawned with a fundamentally different strategy derived from other researchers' Shared Knowledge.

## Convergence Logic

| Condition | Mode | Result |
|-----------|------|--------|
| Best metric across all researchers unchanged for 2 consecutive rounds | Metric | CONVERGED |
| Reviewer rates all researcher outputs >= 8/10 for 2 consecutive rounds | Qualitative | CONVERGED |
| `max_total_iterations` hit | Both | BUDGET STOP |
| `max_rounds` hit | Both | BUDGET STOP |
| `time_budget` hit | Both | BUDGET STOP |
| All researchers stuck Level 2+ simultaneously | Both | STALLED → early synthesis |

Full convergence implementation in `../../references/conference-protocol.md` §2. See also `convergence-guide.md` in this directory.

## Qualitative Mode

When `mode: qualitative`, there is no numeric metric. Researchers use **self-assessment** as a proxy:

1. After each iteration, the researcher rates their result 1-10 against the Success Criteria: *"Does this output better satisfy the Success Criteria than the previous best?"*
2. The self-assessed score drives keep/revert decisions within Phase 1 (the inner loop)
3. The Reviewer (Opus) in Phase 3 provides the **authoritative** judgment — it may overturn self-assessments
4. Self-assessment scores are logged to the per-researcher TSV as `metric_value`

This is an acknowledged departure from autoresearch's Principle #2 (Mechanical Verification). The tradeoff enables broader research tasks (literature synthesis, hypothesis generation) at the cost of less reliable inner-loop evaluation. The adversarial Reviewer compensates by providing rigorous external judgment each round. See `../../references/conference-protocol.md` §6.

## Git Worktree Integration

Worktrees activate **only when `mode == metric` AND researchers make code changes**.

| Mode | Change type | Worktrees? |
|------|------------|-----------|
| Metric | Code changes | Yes — each researcher gets own branch |
| Metric | Prompt/config only | No — file isolation is sufficient |
| Qualitative | Any | No — researchers produce analysis, not code |

**Branch structure:**
```
main (user's current branch)
  ├── conference/researcher-A    ← per-researcher worktree
  ├── conference/researcher-B
  ├── conference/researcher-C
  └── conference/best            ← validated improvements cherry-picked here
```

Per-round lifecycle: create/reset from `conference/best` → research → cherry-pick validated → next round.

Use `/worktree-dashboard` to monitor researcher worktrees in real-time during a conference. The Reviewer agent uses `/compare-worktrees` for cross-worktree static analysis and behavioral comparison. Full lifecycle and conflict resolution in `../../references/conference-protocol.md` §5.

## Event Hooks

Events are written to `conference_events.jsonl` (append-only JSONL). Format:
```jsonl
{"event": "conference.started", "timestamp": "2026-03-18T10:00:00Z", "payload": {"researchers": 3, "mode": "metric"}}
{"event": "round.completed", "timestamp": "2026-03-18T10:15:00Z", "payload": {"round": 1, "best_metric": 0.82}}
```

| Event | When |
|-------|------|
| `conference.started` | Conference Chair initializes |
| `round.started` | Each round begins |
| `researcher.iteration` | Researcher completes an iteration |
| `round.poster_session` | Poster session complete |
| `round.peer_review` | Peer review complete |
| `round.completed` | Round finishes |
| `researcher.stuck` | Researcher hits stuck Level 2+ |
| `conference.converged` | Convergence detected |
| `conference.completed` | Synthesis done |

External tools can `tail -f conference_events.jsonl` for real-time monitoring. See `../../references/results-logging.md` §3 for full schema.
