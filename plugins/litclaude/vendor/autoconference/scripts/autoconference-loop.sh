#!/usr/bin/env bash
# autoconference-loop.sh — Universal overnight conference runner
#
# Detects the active AI CLI tool, then repeatedly invokes it with a
# continuation prompt until the conference completes or max invocations
# is reached. Checks file-based completion signals before each call.
#
# Usage:
#   autoconference-loop.sh [OPTIONS] <conference_dir>
#
# Options:
#   --cli <name>              Override CLI auto-detection (claude|codex|opencode|gemini)
#   --interval <seconds>      Wait time between invocations (default: 360)
#   --max-invocations <N>     Maximum number of CLI invocations (default: 50)
#   --dry-run                 Print commands without executing them
#   -h, --help                Show this help message

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

readonly SCRIPT_NAME="autoconference-loop"
readonly DEFAULT_INTERVAL=360
readonly DEFAULT_MAX_INVOCATIONS=50
readonly PID_FILE_NAME=".autoconference-loop.pid"

# Continuation prompt sent to the CLI on every invocation
readonly CONTINUATION_PROMPT="Continue the autoconference in this directory. Read conference.md for the goal, researchers, and shared knowledge. Check conference_events.jsonl for the last completed event. Resume from the last completed round. Run the next round's 4 phases (Research, Poster Session, Peer Review, Knowledge Transfer). Do not pause or ask for confirmation."

# ─── Defaults ─────────────────────────────────────────────────────────────────

cli_override=""
interval=$DEFAULT_INTERVAL
max_invocations=$DEFAULT_MAX_INVOCATIONS
dry_run=false
conference_dir=""

# ─── Helpers ──────────────────────────────────────────────────────────────────

usage() {
    sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,2\}//'
    exit 0
}

log() {
    # Timestamped log line to stdout
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

# ─── Argument parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cli)
            [[ $# -ge 2 ]] || die "--cli requires an argument"
            cli_override="$2"
            shift 2
            ;;
        --interval)
            [[ $# -ge 2 ]] || die "--interval requires an argument"
            interval="$2"
            shift 2
            ;;
        --max-invocations)
            [[ $# -ge 2 ]] || die "--max-invocations requires an argument"
            max_invocations="$2"
            shift 2
            ;;
        --dry-run)
            dry_run=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            die "Unknown option: $1"
            ;;
        *)
            # First non-option argument is the conference directory
            conference_dir="$1"
            shift
            ;;
    esac
done

# ─── Validate inputs ──────────────────────────────────────────────────────────

[[ -n "$conference_dir" ]] || die "conference_dir is required as the first positional argument"
[[ -d "$conference_dir" ]] || die "conference_dir does not exist or is not a directory: $conference_dir"
[[ -f "${conference_dir}/conference.md" ]] || die "No conference.md found in ${conference_dir}. Run init_conference.py first."

# Resolve to absolute path
conference_dir="$(cd "$conference_dir" && pwd)"

# Validate numeric args
[[ "$interval" =~ ^[0-9]+$ ]]         || die "--interval must be a positive integer"
[[ "$max_invocations" =~ ^[0-9]+$ ]]  || die "--max-invocations must be a positive integer"

# ─── CLI detection ────────────────────────────────────────────────────────────

detect_cli() {
    for candidate in claude codex opencode gemini; do
        if command -v "$candidate" &>/dev/null; then
            printf '%s' "$candidate"
            return 0
        fi
    done
    return 1
}

if [[ -n "$cli_override" ]]; then
    cli="$cli_override"
    command -v "$cli" &>/dev/null || die "Specified CLI '$cli' not found in PATH"
else
    cli="$(detect_cli)" || die "No supported AI CLI found. Install claude, codex, opencode, or gemini."
fi

# ─── PID management ───────────────────────────────────────────────────────────

pid_file="${conference_dir}/${PID_FILE_NAME}"

cleanup() {
    rm -f "$pid_file"
}
trap cleanup EXIT INT TERM

printf '%d\n' "$$" > "$pid_file"

# ─── Build the CLI invocation command ────────────────────────────────────────

# Returns the full command as an array in the global variable CMD_ARRAY.
# Callers must eval or use "${CMD_ARRAY[@]}".
build_cmd() {
    CMD_ARRAY=()
    case "$cli" in
        claude)
            # claude supports -C for working directory
            CMD_ARRAY=(claude -C "$conference_dir" -p "$CONTINUATION_PROMPT" --permission-mode auto)
            ;;
        codex)
            # codex supports -C for working directory
            CMD_ARRAY=(codex -C "$conference_dir" exec "$CONTINUATION_PROMPT" --full-auto)
            ;;
        opencode)
            # opencode uses --dir for working directory
            CMD_ARRAY=(opencode run "$CONTINUATION_PROMPT" --dir "$conference_dir")
            ;;
        gemini)
            # gemini has no cwd flag; we cd before invoking
            CMD_ARRAY=(bash -c "cd $(printf '%q' "$conference_dir") && gemini -p $(printf '%q' "$CONTINUATION_PROMPT") -y")
            ;;
        *)
            die "Unsupported CLI: $cli"
            ;;
    esac
}

# ─── Completion detection ─────────────────────────────────────────────────────

# Returns 0 (true) if conference is complete, 1 (false) otherwise.
is_complete() {
    local dir="$1"
    local events_jsonl="${dir}/conference_events.jsonl"
    local conference_md="${dir}/conference.md"

    # 1. synthesis.md exists → done
    if [[ -f "${dir}/synthesis.md" ]]; then
        log "Completion detected: synthesis.md found."
        return 0
    fi

    # 2. conference_events.jsonl contains "conference.completed"
    if [[ -f "$events_jsonl" ]]; then
        if grep -q '"conference.completed"' "$events_jsonl"; then
            log "Completion detected: conference.completed event found in conference_events.jsonl."
            return 0
        fi
    fi

    # 3. Parse max_rounds from conference.md, count round.completed events in JSONL
    if [[ -f "$conference_md" && -f "$events_jsonl" ]]; then
        local max_rounds
        max_rounds="$(grep -i 'max_rounds\|Rounds:' "$conference_md" \
                     | grep -oE '[0-9]+' \
                     | head -1)" || true
        if [[ -n "$max_rounds" && "$max_rounds" -gt 0 ]]; then
            local completed_rounds
            completed_rounds="$(grep -Ec '"round\.completed"|"round\.[0-9]+\.completed"' "$events_jsonl" 2>/dev/null)" || completed_rounds=0
            if [[ "$completed_rounds" -ge "$max_rounds" ]]; then
                log "Completion detected: completed rounds (${completed_rounds}) >= max_rounds (${max_rounds})."
                return 0
            fi
        fi
    fi

    return 1
}

# ─── Header ───────────────────────────────────────────────────────────────────

print_header() {
    printf '\n'
    printf '═══════════════════════════════════════════════════\n'
    printf '  autoconference-loop — Universal overnight conference runner\n'
    printf '  CLI:          %s\n' "$cli"
    printf '  Conference:   %s\n' "$conference_dir"
    printf '  Interval:     %ss\n' "$interval"
    printf '  Max invokes:  %s\n' "$max_invocations"
    printf '═══════════════════════════════════════════════════\n'
    printf '\n'
}

# ─── Main loop ────────────────────────────────────────────────────────────────

print_header

invocation=0
exit_reason="max_invocations reached"

while [[ $invocation -lt $max_invocations ]]; do

    # Check completion before invoking
    if is_complete "$conference_dir"; then
        exit_reason="completion detected before invocation $((invocation + 1))"
        break
    fi

    invocation=$(( invocation + 1 ))
    log "Invocation ${invocation}/${max_invocations} starting."

    build_cmd

    if $dry_run; then
        log "[DRY-RUN] Would execute: ${CMD_ARRAY[*]}"
    else
        # Execute and allow non-zero exit (the AI CLI may return non-zero on normal exit)
        "${CMD_ARRAY[@]}" || log "CLI exited with non-zero status (continuing loop)."
    fi

    log "Invocation ${invocation}/${max_invocations} finished."

    # Check completion after this invocation
    if is_complete "$conference_dir"; then
        exit_reason="completion detected after invocation ${invocation}"
        break
    fi

    # Wait before next invocation (skip after the last one)
    if [[ $invocation -lt $max_invocations ]]; then
        log "Waiting ${interval}s before next invocation..."
        sleep "$interval"
    fi

done

# ─── Summary ──────────────────────────────────────────────────────────────────

printf '\n'
printf '═══════════════════════════════════════════════════\n'
printf '  autoconference-loop complete\n'
printf '  Invocations run: %s\n' "$invocation"
printf '  Exit reason:     %s\n' "$exit_reason"
printf '  Conference dir:  %s\n' "$conference_dir"
printf '═══════════════════════════════════════════════════\n'
printf '\n'
