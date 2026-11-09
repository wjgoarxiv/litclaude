# Results Logging Protocol

Structured logging for machine-readable experiment tracking at two levels: per-researcher (matching autoresearch format) and conference-level (adding researcher identity, round context, and peer review verdicts).

---

## Section 1 — Per-Researcher TSV (`researcher_{ID}_results.tsv`)

One file per researcher (e.g., `researcher_A_results.tsv`, `researcher_B_results.tsv`). Same schema as autoresearch's `autoresearch-results.tsv` for compatibility.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `iteration` | int | 0-indexed iteration number within the current round |
| `metric_value` | float | Measured metric value (or self-assessment score 1-10 in qualitative mode) |
| `delta` | float or `-` | Change from baseline (iteration 0 of this researcher) |
| `delta_pct` | string | Percentage change from baseline |
| `status` | enum | `baseline`, `kept`, `reverted` |
| `description` | string | One-line description of the change |
| `evaluator_source` | string | Source of the evaluation — e.g., `script:evaluate.py`, `llm:opus`, `self-assessment` |
| `timestamp` | ISO 8601 | When the experiment completed |

### Example

```tsv
iteration	metric_value	delta	delta_pct	status	description	evaluator_source	timestamp
0	2.3991	-	-	baseline	Recursive quicksort with list comprehensions	script:benchmark.py	2026-03-18T10:00:00Z
1	1.8845	-0.5146	-21.4%	kept	Bottom-up iterative merge sort	script:benchmark.py	2026-03-18T10:05:00Z
2	1.7265	-0.6726	-28.0%	kept	Merge sort + insertion sort for subarrays < 32	script:benchmark.py	2026-03-18T10:10:00Z
3	1.9504	-0.4487	-18.7%	reverted	Natural merge sort with run detection	script:benchmark.py	2026-03-18T10:15:00Z
4	0.9817	-1.4174	-59.1%	kept	LSD radix sort base 256	script:benchmark.py	2026-03-18T10:20:00Z
```

### Notes

- **Qualitative mode:** `metric_value` holds the researcher's self-assessed quality score (1-10). The Reviewer's authoritative scores appear in the conference-level TSV.
- **Iteration numbering:** Resets to 0 at the start of each round for simplicity. The round context is captured in the conference-level TSV.
- **Baseline row:** The first row of each round uses `status: baseline` and `delta: -`.

---

## Section 2 — Conference-Level TSV (`conference_results.tsv`)

One file for the entire conference. Adds researcher identity, round context, and peer review verdicts on top of the per-researcher schema.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `round` | int | Conference round number (1-indexed) |
| `researcher` | string | Researcher identifier (`A`, `B`, `C`, ...) |
| `iteration` | int | Iteration within the round (0-indexed) |
| `metric_value` | float | Measured metric value |
| `delta` | float or `-` | Change from round baseline |
| `delta_pct` | string | Percentage change from round baseline |
| `status` | enum | `baseline`, `kept`, `reverted`, `failed` |
| `description` | string | One-line description of the change |
| `evaluator_source` | string | Source of the evaluation — e.g., `script:evaluate.py`, `llm:opus`, `self-assessment` |
| `peer_review_verdict` | enum | `validated`, `challenged`, `overturned`, `-` |
| `timestamp` | ISO 8601 | When the experiment completed |

### Example

```tsv
round	researcher	iteration	metric_value	delta	delta_pct	status	description	evaluator_source	peer_review_verdict	timestamp
1	A	0	2.3991	-	-	baseline	Recursive quicksort baseline	script:benchmark.py	-	2026-03-18T10:00:00Z
1	A	1	1.8845	-0.5146	-21.4%	kept	Bottom-up iterative merge sort	script:benchmark.py	validated	2026-03-18T10:05:00Z
1	A	2	1.7265	-0.6726	-28.0%	kept	Merge sort + insertion sort < 32	script:benchmark.py	validated	2026-03-18T10:10:00Z
1	B	0	2.4012	-	-	baseline	Recursive quicksort baseline	script:benchmark.py	-	2026-03-18T10:00:00Z
1	B	1	2.1500	-0.2512	-10.5%	kept	Heap sort implementation	script:benchmark.py	challenged	2026-03-18T10:07:00Z
1	B	2	1.9800	-0.4212	-17.5%	kept	Heap sort with Floyd's algorithm	script:benchmark.py	validated	2026-03-18T10:12:00Z
1	C	0	2.3950	-	-	baseline	Recursive quicksort baseline	script:benchmark.py	-	2026-03-18T10:00:00Z
1	C	1	0.9817	-1.4133	-59.1%	kept	LSD radix sort base 256	script:benchmark.py	validated	2026-03-18T10:08:00Z
2	A	0	1.7265	-	-	baseline	Round 2 start from best known	script:benchmark.py	-	2026-03-18T10:30:00Z
2	A	1	1.5100	-0.2165	-12.5%	kept	Merge sort + radix hybrid	script:benchmark.py	validated	2026-03-18T10:35:00Z
```

### Status Values

| Value | Meaning |
|-------|---------|
| `baseline` | Starting point for this researcher in this round |
| `kept` | Change improved the metric and was kept |
| `reverted` | Change did not improve metric; reverted to previous best |
| `failed` | Researcher crashed, timed out, or self-terminated before completing the iteration |

### Peer Review Verdict Values

| Value | Meaning |
|-------|---------|
| `validated` | Reviewer confirmed the claim holds |
| `challenged` | Reviewer flagged the claim as questionable; needs more evidence |
| `overturned` | Reviewer determined the claim is invalid |
| `-` | Not yet reviewed (e.g., baseline row, or round not yet complete) |

---

## Section 3 — Event Log (`conference_events.jsonl`)

An append-only JSONL file recording all significant conference events. Each line is a JSON object. External tools can tail this file for real-time monitoring.

### Schema

```json
{
  "event": "<event_type>",
  "timestamp": "<ISO 8601>",
  "payload": { ... }
}
```

### Event Types

| Event | When | Payload Fields |
|-------|------|----------------|
| `conference.started` | Conference Chair initializes | `researchers`, `mode`, `goal`, `config_summary` |
| `round.started` | Each round begins | `round`, `researcher_states` |
| `researcher.iteration` | Researcher completes an iteration | `researcher`, `round`, `iteration`, `metric_value`, `delta`, `status` |
| `round.poster_session` | Poster session complete | `round`, `summary` |
| `round.peer_review` | Peer review complete | `round`, `validated_count`, `challenged_count`, `overturned_count` |
| `round.completed` | Round finishes | `round`, `best_metric`, `best_researcher`, `converged` |
| `researcher.stuck` | Researcher hits stuck Level 2+ | `researcher`, `round`, `stuck_level` |
| `conference.converged` | Convergence detected | `final_best_metric`, `round_count`, `reason` |
| `conference.completed` | Synthesis done | `synthesis_path`, `final_report_path`, `total_iterations` |

### Example

```jsonl
{"event":"conference.started","timestamp":"2026-03-18T10:00:00Z","payload":{"researchers":3,"mode":"metric","goal":"Optimize inference latency","config_summary":"metric=p95_latency_ms, direction=minimize, target=<50ms"}}
{"event":"round.started","timestamp":"2026-03-18T10:00:05Z","payload":{"round":1,"researcher_states":["A:ready","B:ready","C:ready"]}}
{"event":"researcher.iteration","timestamp":"2026-03-18T10:05:00Z","payload":{"researcher":"A","round":1,"iteration":1,"metric_value":1.8845,"delta":-0.5146,"status":"kept"}}
{"event":"round.poster_session","timestamp":"2026-03-18T10:20:00Z","payload":{"round":1,"summary":"A: merge sort -28%, B: heap sort -17.5%, C: radix sort -59.1%"}}
{"event":"round.peer_review","timestamp":"2026-03-18T10:25:00Z","payload":{"round":1,"validated_count":5,"challenged_count":1,"overturned_count":0}}
{"event":"round.completed","timestamp":"2026-03-18T10:26:00Z","payload":{"round":1,"best_metric":0.9817,"best_researcher":"C","converged":false}}
{"event":"conference.completed","timestamp":"2026-03-18T11:45:00Z","payload":{"synthesis_path":"synthesis.md","final_report_path":"final_report.md","total_iterations":45}}
```

---

## Usage

The TSV files and event log enable:

- **Programmatic analysis:** Load `conference_results.tsv` into pandas; plot per-researcher convergence curves; compute cross-researcher strategy comparison.
- **CI integration:** Parse the last row of `conference_results.tsv` to check if the target was met. Same pattern as autoresearch-skill.
- **Cross-project comparison:** Standardized format across all autoconference runs.
- **Real-time monitoring:** Tail `conference_events.jsonl` with `tail -f` or a log aggregator during a live conference run.
- **Peer review accuracy analysis:** Compare `peer_review_verdict` against final synthesis outcomes to measure reviewer quality over time.

## Relationship to Other Output Files

| File | Purpose | Format | Audience |
|------|---------|--------|----------|
| `conference.md` | User configuration + Conference Log | Markdown | Humans |
| `researcher_{ID}_log.md` | Detailed per-iteration reasoning | Markdown | Humans |
| `researcher_{ID}_results.tsv` | Per-researcher machine-readable results | TSV | Scripts/CI |
| `conference_results.tsv` | Conference-level results with verdicts | TSV | Scripts/CI |
| `conference_events.jsonl` | Event stream for real-time monitoring | JSONL | Scripts/monitoring |
| `poster_session_round_N.md` | Session Chair's round summary | Markdown | Humans |
| `peer_review_round_N.md` | Reviewer's verdicts per round | Markdown | Humans |
| `synthesis.md` | Synthesizer's unified result | Markdown | Humans |
| `final_report.md` | Executive summary | Markdown | Humans |
