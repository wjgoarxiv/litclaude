---
name: autoconference:resume
description: |
  Resume an interrupted autoconference from its last checkpoint.
  Reads conference_events.jsonl to find last completed phase and resumes.
  TRIGGER when: user wants to resume/continue a conference, conference was interrupted.
  DO NOT TRIGGER when: user wants to start a new conference (use autoconference or plan).
allowed-tools:
  - Agent
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# Autoconference Resume — Checkpoint Recovery

*Resume an interrupted conference from its last checkpoint. Reads `conference_events.jsonl` to determine exactly where to re-enter the conference protocol.*

## Purpose

Conferences are interrupted. Power failures, context window limits, timeouts, and user interruptions all happen. The `resume` skill reconstructs the conference state from its append-only event log and re-enters the autoconference protocol at the correct point — without re-running work that was already completed.

**This skill does NOT restart a conference from scratch.** It recovers from interruption and continues forward.

---

## Recovery Protocol

Follow all 6 steps in order. Do not skip steps. Do not begin Phase 1 research until the recovery point is confirmed and state is validated.

---

## Step 1: Locate Conference Directory

**Objective:** Find the conference directory and verify it is recoverable.

Ask the user:
> "Where is the conference directory? (Or press Enter to search the current directory.)"

If the user provides a path, verify it exists and contains the required files.

If the user does not provide a path, search the current directory for conference artifacts:
```bash
find . -name "conference_events.jsonl" -maxdepth 4
```

For each candidate path found, show it to the user and ask: "Is this the conference you want to resume?"

**Verify these files exist in the conference directory:**
- `conference.md` — required. If missing, cannot resume.
- `conference_events.jsonl` — required. If missing, cannot resume (no event log = no checkpoint).

If either file is missing, stop and tell the user:
> "Cannot resume: {file} is missing from {path}. To start a new conference, use `/autoconference`. To set up a new conference, use `/autoconference:plan`."

**Also check for:**
- `conference_results.tsv` — if present, read the last row to get the last-known best metric.
- `researcher_*_results.tsv` — to verify per-researcher state.
- `researcher_*_log.md` — to understand what each researcher accomplished.

**Record:** `conference_dir` — the confirmed absolute path to the conference directory.

---

## Step 2: Parse Event Log

**Objective:** Determine the exact state of the conference at interruption.

Read the full `conference_events.jsonl` file. Parse all events in order to reconstruct state.

```bash
cat {conference_dir}/conference_events.jsonl
```

Build a state summary:

| Field | How to determine |
|-------|-----------------|
| `conference_started` | `conference.started` event present? yes/no |
| `last_round_started` | Highest round number in `round.started` events |
| `last_round_completed` | Highest round number in `round.completed` events |
| `last_poster_session` | Highest round number in `round.poster_session` events |
| `last_peer_review` | Highest round number in `round.peer_review` events |
| `conference_converged` | `conference.converged` event present? yes/no |
| `conference_completed` | `conference.completed` event present? yes/no |
| `researchers_active` | From `round.started` payload, list of researcher IDs in last started round |
| `iterations_logged` | Count of `researcher.iteration` events per researcher in last incomplete round |

Show the user a plain-English summary:

```
Conference state:
  - Total rounds completed: {N}
  - Last completed event: {event_type} at {timestamp}
  - Researchers in last round: {A, B, C}
  - Convergence reached: {yes/no}
  - Interruption point: {description}
```

**Record:** All fields above as `event_state`.

---

## Step 3: Determine Recovery Point

**Objective:** Map the last completed event to the exact re-entry point in the conference protocol.

Use this table to determine the recovery point:

| Last Event | Condition | Recovery Point | Action |
|-----------|-----------|---------------|--------|
| `conference.started` | No rounds started | Start of Round 1, Phase 1 | Initialize output files if missing, begin Round 1 |
| `round.started` | Round N started, no iterations logged | Start of Phase 1, Round N | Re-spawn all researchers for Round N from scratch |
| `round.started` | Round N started, some iterations logged | Mid-Phase 1, Round N | Check which researchers completed; re-spawn only incomplete ones from their last `kept` state |
| `researcher.iteration` | Round N, some researchers done | Mid-Phase 1, Round N | Some researchers done, others mid-iteration — see Step 5 |
| `round.poster_session` | Round N poster done, no peer review | Start of Phase 3, Round N | Poster session already done — re-spawn Reviewer only |
| `round.peer_review` | Round N peer review done, round not completed | Phase 4 (Knowledge Transfer), Round N | Peer review done — run Knowledge Transfer to update Shared Knowledge and complete round |
| `round.completed` | Round N completed cleanly | Start of Round N+1 | Read conference.md for Shared Knowledge, check convergence, begin Round N+1 |
| `conference.converged` | Convergence event present but no `conference.completed` | Synthesis | Conference converged — just run Synthesis (Step 11 of autoconference protocol) |
| `conference.completed` | Both events present | Nothing to resume | Tell user: "This conference is already complete. Outputs are in {conference_dir}/synthesis.md" |

Present the determined recovery point to the user and confirm:
> "Based on the event log, I'll resume at: {recovery_point_description}. Does this look correct?"

If the user disagrees, ask them to describe where they think the conference was interrupted and resolve manually.

**Record:** `recovery_point` — the confirmed re-entry point.

---

## Step 4: Validate State

**Objective:** Verify that the files on disk are consistent with the event log before re-entering.

### Check 1: Researcher TSV files

For each researcher `{ID}` expected (from `conference.md` count):
- Verify `researcher_{ID}_results.tsv` exists.
- Check that the row count is consistent with the number of `researcher.iteration` events logged for that researcher.
- If TSV is missing but iterations were logged: warn and offer to reconstruct a minimal TSV from the event log.
- If TSV row count is higher than event log: warn — "Researcher {ID} TSV has more rows than events logged. Data may be from a previous interrupted run."

### Check 2: Worktree branches (if metric mode with code changes)

Read `conference.md` to determine if worktree mode is active (`mode: metric` AND code change research).

If worktrees are in use:
```bash
git worktree list
```

For each expected branch (`conference/researcher-{ID}`, `conference/best`):
- Verify the worktree exists.
- Check for uncommitted changes: `git -C {worktree_path} status --porcelain`
- If uncommitted changes exist: warn the user. These are from the interrupted session and may represent partial work.

### Check 3: Staleness warning

Check the timestamp of the last event in `conference_events.jsonl`.

Calculate hours since last event. If > 24 hours:
> "Warning: This conference was interrupted {N} hours ago. The state may be stale. Environment changes (dependency updates, file deletions, code changes outside the conference) could cause failures. Proceed with caution."

Ask: "Do you want to proceed with recovery, or start fresh with `/autoconference`?"

### Check 4: conference.md integrity

Re-read `conference.md` and verify:
- Required fields are present (goal, mode, count, max_rounds).
- Shared Knowledge section exists (may be empty if no rounds completed).
- Conference Log table exists.

If any required field is missing or corrupted, stop and ask the user to repair the file before resuming.

**Record:** `validation_warnings` — list of any warnings found (do not block on warnings, only on errors).

---

## Step 5: Revert Incomplete Work

**Objective:** Bring all researcher state to a clean, known-good checkpoint.

This step ensures no researcher resumes from a partially-completed, inconsistent state.

### For researchers that were mid-iteration at interruption:

A researcher is "mid-iteration" if:
- `round.started` for Round N was logged
- Some (but not all) `researcher.iteration` events were logged for that researcher in Round N
- `round.completed` for Round N was NOT logged

For mid-iteration researchers, revert to their last `kept` state:

**File-based (no worktrees):**
- Read the researcher's TSV file. Find the last row where `outcome == kept`.
- This is the last good state. Any rows after the last `kept` are from the interrupted iteration and should be discarded.
- Truncate the TSV to the last `kept` row. (Do this carefully — show the user which rows will be removed before truncating.)

**Worktree-based (metric mode with code changes):**
- Find the last committed state on the researcher's branch: `git -C {worktree_path} log --oneline -5`
- Reset to the last commit (which corresponds to the last `kept` state): `git -C {worktree_path} reset --hard HEAD`
- Verify no uncommitted changes remain: `git -C {worktree_path} status --porcelain`

### For researchers that completed their Phase 1 work:

A researcher is "complete" if their last `researcher.iteration` event for Round N has `outcome == final` or if `round.poster_session` was already logged.

No revert needed for complete researchers. Their state is already clean.

### For the `conference/best` branch (if worktree mode):

Only cherry-pick validated findings to `conference/best` AFTER `round.peer_review` is completed and verdicts are parsed. If the conference was interrupted before `round.peer_review`, do not modify `conference/best` — wait until the review is done.

**Record:** `reverted_researchers` — list of researcher IDs that were reverted, and to which state.

---

## Step 6: Resume

**Objective:** Re-enter the autoconference protocol at the confirmed recovery point and run to completion.

### Log the resume event:

Append to `conference_events.jsonl`:
```jsonl
{"event": "conference.resumed", "timestamp": "{ISO_TIMESTAMP}", "payload": {"recovery_point": "{recovery_point}", "round": {N}, "reverted_researchers": [...]}}
```

### Load the autoconference protocol:

Read the full autoconference SKILL.md from `../../skills/autoconference/SKILL.md` (or the root `../../SKILL.md` if the skills/autoconference directory is empty).

The autoconference SKILL.md contains the master Conference Orchestration Protocol. The `resume` skill's job is to:
1. Determine WHERE to re-enter that protocol (done in Steps 3–5 above)
2. Hand off to the autoconference protocol at that point

### Re-entry by recovery point:

**"Start of Round N, Phase 1":**
Re-enter at Step 6 of the autoconference protocol (ROUND LOOP → Phase 1). Spawn all N researchers for Round N. Pass the current Shared Knowledge from `conference.md`.

**"Mid-Phase 1, Round N — re-spawn incomplete researchers":**
Re-enter at Step 6 (Phase 1), but only for researchers that did not complete Phase 1 in Round N. Do not re-spawn researchers that already logged their Phase 1 completion. Pass their reverted state as the starting point.

**"Start of Phase 3, Round N — Poster done, re-spawn Reviewer":**
Re-enter at Step 8 (Phase 3 — Peer Review). The poster session file `poster_session_round_{N}.md` already exists. Spawn only the Reviewer agent.

**"Phase 4, Round N — Knowledge Transfer":**
Re-enter at Step 9 (Phase 4 — Knowledge Transfer). The peer review file `peer_review_round_{N}.md` already exists. Parse its verdicts and run Knowledge Transfer.

**"Start of Round N+1":**
Re-enter at Step 10 (convergence check). Round N is complete. Check convergence. If not converged and budget remains, begin Round N+1 at Step 6.

**"Synthesis only":**
Re-enter at Step 11 (SYNTHESIS). Spawn the Synthesizer (Opus) with paths to all existing poster session, peer review, researcher log, and TSV files.

### Proceed to completion:

From the re-entry point, follow the autoconference protocol exactly as written — do not abbreviate steps, do not skip phases. The conference runs to completion (convergence, budget exhaustion, or user interruption) from this point forward.

The Persistence Directive applies: **Never stop a round prematurely. Never ask "should I continue?" Advance automatically until a terminal condition is reached.**

---

## Resume Invariants

- Never re-run work that has a `round.completed` event for that round.
- Never modify `conference_events.jsonl` except to append — it is an append-only log.
- Never skip the validation step (Step 4) — resuming into a corrupted state causes silent errors.
- Never skip the revert step (Step 5) for mid-iteration researchers — partial iterations produce misleading TSV rows that corrupt convergence detection.
- If `conference.completed` is already logged, do not resume — tell the user the conference is done.
- The `conference.resumed` event must be logged before any research resumes.
- After logging `conference.resumed`, follow the autoconference protocol exactly — do not invent an alternative protocol.

---

## Chaining

```
resume → autoconference (continuation from recovery point)
```

Full skill chain for a complete conference lifecycle:
```
plan → autoconference → (resume if interrupted) → ship
```
