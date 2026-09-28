# Crash Recovery Matrix

Five recovery types covering every failure point in the conference round loop. Each type describes detection, recovery strategy, data preservation, and re-entry point.

---

## Type 1: Mid-Research Crash

**Phase:** Phase 1 — Independent Research (a researcher failed during iterations)

### Detection

Scan `conference_events.jsonl` for a `round.started` event for round N without a matching `round.poster_session` event. Then check per-researcher state:

```jsonl
# Round started but no poster session follows:
{"event": "round.started", "payload": {"round": 3, "researcher_states": ["A:ready","B:ready","C:ready"]}}
# Researcher A completed some iterations:
{"event": "researcher.iteration", "payload": {"researcher": "A", "round": 3, "iteration": 4, ...}}
# Researcher B has fewer or no iteration events → likely the crash victim
# No "round.poster_session" event for round 3
```

Also check `researcher_{ID}_results.tsv` — the last row shows how far each researcher got. A researcher with fewer rows than `iterations_per_round` was interrupted.

### Recovery Strategy

1. Identify which researchers completed Phase 1 (check for their final iteration event or TSV row count matching `iterations_per_round`)
2. Mark incomplete researchers as `FAILED` in `conference_results.tsv` for this round
3. **Re-run round N from Phase 1**, but only re-spawn the failed researchers — completed researchers' results are preserved
4. If re-spawning is not feasible (e.g., user wants to proceed quickly), skip to Phase 2 with partial results from completed researchers

### Data Preservation

- Completed researchers: all TSV rows and log entries are intact
- Failed researcher: partial TSV rows are usable (each row represents a completed iteration). Incomplete iterations (no TSV row) produced no artifacts
- `conference_events.jsonl`: all events up to crash point are preserved (append-only)

### Re-Entry Point

Phase 1 of round N (re-spawn failed researchers only) OR Phase 2 of round N (proceed with partial results).

---

## Type 2: Mid-Poster-Session Crash

**Phase:** Phase 2 — Session Chair failed while producing the poster session summary

### Detection

`conference_events.jsonl` contains iteration events for all researchers in round N, but no `round.poster_session` event. Additionally, `poster_session_round_{N}.md` either does not exist or is empty/truncated.

```jsonl
# All researcher iterations present for round N:
{"event": "researcher.iteration", "payload": {"researcher": "C", "round": 3, "iteration": 5, ...}}
# No poster session event:
# (absence of) {"event": "round.poster_session", "payload": {"round": 3, ...}}
```

### Recovery Strategy

1. Delete the incomplete `poster_session_round_{N}.md` if it exists (it may be truncated)
2. Re-spawn the Session Chair (Haiku) with the same inputs: all researcher TSV files and last 10 log entries per researcher
3. The Session Chair is stateless — it reads researcher outputs and produces a summary. No state to restore.

### Data Preservation

- All researcher outputs from Phase 1 are fully intact (Phase 1 completed before Phase 2 started)
- The only lost artifact is the incomplete poster session file, which is regenerated

### Re-Entry Point

Phase 2 of round N (re-spawn Session Chair).

---

## Type 3: Mid-Review Crash

**Phase:** Phase 3 — Reviewer failed while producing peer review verdicts

### Detection

`conference_events.jsonl` contains a `round.poster_session` event for round N, but no `round.peer_review` event. Additionally, `peer_review_round_{N}.md` either does not exist or is incomplete (missing verdicts for some researchers).

```jsonl
# Poster session completed:
{"event": "round.poster_session", "payload": {"round": 3, "summary": "..."}}
# No peer review event:
# (absence of) {"event": "round.peer_review", "payload": {"round": 3, ...}}
```

### Recovery Strategy

1. Delete the incomplete `peer_review_round_{N}.md` if it exists
2. Re-spawn the Reviewer (Opus) with the same inputs: `poster_session_round_{N}.md`, Success Metric/Criteria, and researcher worktree paths
3. The Reviewer is stateless — it reads the poster session and produces verdicts. No state to restore.

### Data Preservation

- All Phase 1 and Phase 2 outputs are intact
- The poster session file is complete and valid (Phase 2 finished)
- Only the incomplete peer review file is lost and regenerated

### Re-Entry Point

Phase 3 of round N (re-spawn Reviewer).

---

## Type 4: Mid-Transfer Crash

**Phase:** Phase 4 — Knowledge transfer failed (Conference Chair crashed while updating Shared Knowledge, cherry-picking, or updating TSV)

### Detection

`conference_events.jsonl` contains a `round.peer_review` event for round N, but no `round.completed` event. The state is partially updated:

```jsonl
# Peer review completed:
{"event": "round.peer_review", "payload": {"round": 3, "validated_count": 5, ...}}
# No round completed event:
# (absence of) {"event": "round.completed", "payload": {"round": 3, ...}}
```

Check partial state:
- `conference.md` Shared Knowledge section — may have some but not all validated findings appended
- `conference_results.tsv` — may have some but not all `peer_review_verdict` values filled
- `conference/best` branch (if worktree mode) — may have some but not all cherry-picks applied

### Recovery Strategy

This is the most complex recovery because Phase 4 has multiple sequential sub-steps:

1. **Re-read** `peer_review_round_{N}.md` to get the authoritative list of validated findings
2. **Check Shared Knowledge** in `conference.md` — compare against the validated list. Append any missing validated findings. Do not duplicate already-appended findings.
3. **Check `conference_results.tsv`** — fill in any missing `peer_review_verdict` values for round N rows
4. **Check worktree state** (if worktree mode):
   - Run `git log conference/best` to see which cherry-picks already landed
   - Compare against the validated findings that should have been cherry-picked
   - Apply any missing cherry-picks
5. **Write the `round.completed` event** to `conference_events.jsonl`

### Data Preservation

- All Phase 1-3 outputs are intact
- `peer_review_round_{N}.md` is the source of truth — it's complete
- Partial Phase 4 updates are preserved and completed (not rolled back)

### Re-Entry Point

Phase 4 of round N (resume from where it left off using the idempotent check-and-complete strategy above). After Phase 4 completes, proceed to convergence check.

---

## Type 5: Pre-Synthesis Crash

**Phase:** Between the final round's completion and synthesis — the conference completed all rounds but the Synthesizer was never spawned or crashed during synthesis

### Detection

`conference_events.jsonl` contains a `round.completed` event for the final round, plus a convergence or budget stop signal, but no `conference.completed` event. `synthesis.md` and `final_report.md` either do not exist or are incomplete.

```jsonl
# Final round completed:
{"event": "round.completed", "payload": {"round": 5, "best_metric": 0.42, "converged": true}}
# Convergence detected:
{"event": "conference.converged", "payload": {"final_best_metric": 0.42, "round_count": 5, "reason": "metric_plateau"}}
# No completion event:
# (absence of) {"event": "conference.completed", ...}
```

### Recovery Strategy

1. Delete incomplete `synthesis.md` and `final_report.md` if they exist
2. Spawn the Synthesizer (Opus) with the standard inputs:
   - All `poster_session_round_*.md` and `peer_review_round_*.md` files
   - All researcher log files and TSV files
   - The conference's Goal and Success Metric/Criteria
3. After synthesis completes, proceed to worktree cleanup (Step 12) and log `conference.completed` event

### Data Preservation

- All round artifacts are complete — the full conference ran successfully
- Only the synthesis output is missing/incomplete

### Re-Entry Point

Step 11 (Synthesis) of the orchestration protocol.

---

## General Recovery Principles

1. **Append-only event log is the source of truth.** `conference_events.jsonl` tells you exactly where the conference stopped. Scan events in reverse to find the last completed phase.

2. **Never overwrite completed round artifacts.** Round-numbered filenames (`poster_session_round_N.md`, `peer_review_round_N.md`) ensure idempotency. Only delete and regenerate artifacts from the interrupted phase.

3. **Stateless agents simplify recovery.** Session Chair, Reviewer, and Synthesizer are stateless — they read inputs and produce outputs. Re-spawning them with the same inputs produces equivalent results.

4. **Researchers have state, but it's captured in TSV.** The last complete row in `researcher_{ID}_results.tsv` represents the researcher's last known good state. Re-spawning from that point is safe.

5. **Phase 4 is the only non-idempotent phase.** It mutates multiple files (`conference.md`, `conference_results.tsv`, worktree branches). The recovery strategy uses check-and-complete rather than rollback-and-retry.

6. **The `/autoconference:resume` command automates this.** It reads `conference_events.jsonl`, determines the recovery type, and executes the appropriate strategy. For manual recovery, follow the type-specific instructions above.
