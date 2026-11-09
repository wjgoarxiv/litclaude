#!/usr/bin/env bash
# check_conference.sh - Lightweight progress monitor for autoconference runs
# Usage: check_conference.sh [conference_dir]

CONF_DIR="${1:-.}"
CONF_DIR="${CONF_DIR%/}"  # strip trailing slash

CONF_MD="$CONF_DIR/conference.md"
RESULTS_TSV="$CONF_DIR/conference_results.tsv"
EVENTS_JSONL="$CONF_DIR/conference_events.jsonl"
SYNTHESIS_MD="$CONF_DIR/synthesis.md"
PID_FILE="$CONF_DIR/.autoconference-loop.pid"

# ── Parse conference.md ───────────────────────────────────────────────────────

if [[ -f "$CONF_MD" ]]; then
    # First non-empty line after "## Goal"
    goal=$(awk '/^## Goal/{found=1; next} found && /[^[:space:]]/{print; exit}' \
           "$CONF_MD")
    # max_rounds: line matching "max_rounds", "Rounds:", or scaffolded "Max rounds:"
    max_rounds=$(grep -m1 -iE 'max_rounds|Rounds:' "$CONF_MD" \
                  | grep -oE '[0-9]+' \
                  | head -1)
    # Researcher count: prefer scaffolded "Count", fall back to named researcher entries
    researcher_count=$(grep -m1 -iE '\*\*Count:\*\*|^count:' "$CONF_MD" \
                       | grep -oE '[0-9]+' \
                       | head -1)
    if [[ -z "$researcher_count" ]]; then
        researcher_count=$(grep -cE '^\s*-\s+\*\*Name\*\*:|^\s*-\s+name:' "$CONF_MD" 2>/dev/null) || researcher_count=0
    fi
    # Direction
    direction=$(grep -m1 -i '\*\*Direction:\*\*' "$CONF_MD" \
                | sed 's/.*\*\*Direction:\*\*[[:space:]]*//' \
                | sed 's/[[:space:]]*$//' \
                | tr '[:upper:]' '[:lower:]')
    # Target
    target=$(grep -m1 -i '\*\*Target:\*\*' "$CONF_MD" \
              | sed 's/.*\*\*Target:\*\*[[:space:]]*//' \
              | sed 's/[[:space:]]*$//')
else
    goal="?"; max_rounds="?"; researcher_count="?"; direction="maximize"; target="?"
fi

[[ -z "$goal"              ]] && goal="?"
[[ -z "$max_rounds"        ]] && max_rounds="?"
[[ -z "$researcher_count"  ]] && researcher_count="?"
[[ -z "$direction"          ]] && direction="maximize"
[[ -z "$target"            ]] && target="?"

# ── Parse conference_results.tsv ──────────────────────────────────────────────

best_metric="?"; best_researcher="?"

if [[ -f "$RESULTS_TSV" ]]; then
    # Expect conference-level columns:
    # round, researcher, iteration, metric_value, delta, delta_pct, status, description,
    # evaluator_source, peer_review_verdict, timestamp
    # Track best metric value and which researcher achieved it
    best_val=""
    while IFS=$'\t' read -r f_round f_researcher f_iteration f_metric f_rest; do
        [[ -z "$f_researcher" ]] && continue
        val="$f_metric"
        if [[ "$val" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
            if [[ -z "$best_val" ]]; then
                best_val="$val"
                best_researcher="$f_researcher"
            else
                if [[ "$direction" == "minimize" ]]; then
                    better=$(awk -v a="$val" -v b="$best_val" 'BEGIN{print (a<b)?1:0}')
                else
                    better=$(awk -v a="$val" -v b="$best_val" 'BEGIN{print (a>b)?1:0}')
                fi
                if [[ "$better" == "1" ]]; then
                    best_val="$val"
                    best_researcher="$f_researcher"
                fi
            fi
        fi
    done < <(tail -n +2 "$RESULTS_TSV" | grep -v '^[[:space:]]*$')

    if [[ -n "$best_val" ]]; then
        best_metric="$best_val"
    fi
    [[ -z "$best_researcher" ]] && best_researcher="?"
fi

# ── Parse conference_events.jsonl ─────────────────────────────────────────────

current_round="0"; last_event_type="?"; last_event_ts="?"; stuck_count="0"

if [[ -f "$EVENTS_JSONL" ]]; then
    # Count current and legacy round completion event names.
    completed_rounds=$(grep -Ec '"round\.completed"|"round\.[0-9]+\.completed"' "$EVENTS_JSONL" 2>/dev/null) || completed_rounds=0
    current_round="$completed_rounds"

    # Count "researcher.stuck" events
    stuck_count=$(grep -c '"researcher\.stuck"' "$EVENTS_JSONL" 2>/dev/null) || stuck_count=0

    # Last event: extract type and timestamp from the last non-empty line
    last_line=$(grep -v '^[[:space:]]*$' "$EVENTS_JSONL" | tail -1)
    if [[ -n "$last_line" ]]; then
        # Extract event type — value of "event" or "type" key
        last_event_type=$(printf '%s' "$last_line" \
                          | grep -oE '"(event|type)"\s*:\s*"[^"]+"' \
                          | head -1 \
                          | grep -oE '"[^"]+"\s*$' \
                          | tr -d '"' \
                          | sed 's/^[[:space:]]*//')
        # Extract timestamp — value of "ts", "timestamp", or "time" key
        last_event_ts=$(printf '%s' "$last_line" \
                        | grep -oE '"(ts|timestamp|time)"\s*:\s*"[^"]+"' \
                        | head -1 \
                        | grep -oE '"[^"]+"\s*$' \
                        | tr -d '"' \
                        | sed 's/^[[:space:]]*//')
    fi
fi

[[ -z "$last_event_type" ]] && last_event_type="?"
[[ -z "$last_event_ts"   ]] && last_event_ts=""

# ── Determine run status ──────────────────────────────────────────────────────

if [[ -f "$SYNTHESIS_MD" ]]; then
    run_status="COMPLETE"
elif [[ -f "$EVENTS_JSONL" ]] && [[ "$current_round" -gt 0 ]]; then
    run_status="running"
else
    run_status="no data"
fi

if [[ -f "$PID_FILE" ]]; then
    pid=$(cat "$PID_FILE" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        run_status="$run_status (loop active)"
    fi
fi

# ── Build display strings ─────────────────────────────────────────────────────

round_display="${current_round} / ${max_rounds}"

# Format last event with timestamp if available
if [[ -n "$last_event_ts" ]]; then
    last_event_display="${last_event_type} @ ${last_event_ts}"
else
    last_event_display="$last_event_type"
fi

# Add stuck researcher info if any
if [[ "$stuck_count" -gt 0 ]]; then
    researcher_display="${researcher_count} (${stuck_count} stuck)"
else
    researcher_display="$researcher_count"
fi

# Truncate long strings to keep box tidy (max ~44 chars for value column)
_trunc() {
    local s="$1" max="${2:-44}"
    if [[ ${#s} -gt $max ]]; then
        printf '%s' "${s:0:$((max-1))}…"
    else
        printf '%s' "$s"
    fi
}

val_w=44

conf_val=$(_trunc "${CONF_DIR}/" $val_w)
goal_val=$(_trunc "$goal" $val_w)
round_val=$(_trunc "$round_display" $val_w)
researcher_val=$(_trunc "$researcher_display" $val_w)
metric_val=$(_trunc "${best_metric} (${best_researcher})" $val_w)
target_val=$(_trunc "$target" $val_w)
status_val=$(_trunc "$run_status" $val_w)
last_val=$(_trunc "$last_event_display" $val_w)

# ── Box drawing ───────────────────────────────────────────────────────────────

inner_w=54  # fixed inner width for clean alignment
border=$(printf '─%.0s' $(seq 1 $inner_w))

_pad_row() {
    local label="$1" value="$2"
    local content="  ${label}${value}"
    local pad=$(( inner_w - ${#content} ))
    if [[ $pad -lt 0 ]]; then
        local max_val=$(( inner_w - ${#label} - 2 ))
        value="${value:0:$((max_val-1))}…"
        content="  ${label}${value}"
        pad=0
    fi
    printf '│%s%*s│\n' "$content" "$pad" ""
}

printf '┌─ autoconference progress ─%s┐\n' "$(printf '─%.0s' $(seq 1 $((inner_w - 28))))"
_pad_row "Conference:   " "$conf_val"
_pad_row "Goal:         " "$goal_val"
_pad_row "Round:        " "$round_val"
_pad_row "Researchers:  " "$researcher_val"
_pad_row "Best metric:  " "$metric_val"
_pad_row "Target:       " "$target_val"
_pad_row "Status:       " "$status_val"
_pad_row "Last event:   " "$last_val"
printf '└%s┘\n' "$border"
