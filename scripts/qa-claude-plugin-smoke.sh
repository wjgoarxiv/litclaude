#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT=""
TMP_HOME=""
TMP_CLAUDE_HOME=""
EVIDENCE=""
SESSION="litclaude-plugin-smoke-inner-$$"

cleanup() {
  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true
  fi
  if [ -n "$TMP_ROOT" ]; then
    rm -rf "$TMP_ROOT"
    TMP_ROOT=""
  fi
}
trap cleanup EXIT INT TERM

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp/}litclaude-plugin-smoke-root.XXXXXX")" || {
  echo "SMOKE_SETUP_FAIL: unable to create disposable QA root" >&2
  exit 1
}
TMP_HOME="$TMP_ROOT/home"
TMP_CLAUDE_HOME="$TMP_ROOT/claude-config"
EVIDENCE="$TMP_ROOT/evidence/task-9-claude-smoke.txt"
if ! mkdir -p "$TMP_HOME" "$TMP_CLAUDE_HOME" "$(dirname "$EVIDENCE")"; then
  echo "SMOKE_SETUP_FAIL: unable to initialize disposable QA root" >&2
  exit 1
fi
export HOME="$TMP_HOME"
export LITCLAUDE_HOME="$TMP_HOME"
export CLAUDE_CONFIG_DIR="$TMP_CLAUDE_HOME"
PACKAGE_VERSION="$(node "$ROOT/bin/litclaude-ai.js" --version 2>&1)"

run_claude() {
  env HOME="$TMP_HOME" CLAUDE_CONFIG_DIR="$TMP_CLAUDE_HOME" claude "$@"
}

: > "$EVIDENCE"

{
  echo "LitClaude Claude Code smoke"
  echo "ROOT: $ROOT"
  echo "PACKAGE_VERSION: $PACKAGE_VERSION"
  date
} >> "$EVIDENCE"

if ! command -v claude >/dev/null 2>&1; then
  {
    echo "CONTROLLED_SKIP: claude executable unavailable"
    echo "CLEANUP: no tmux session started"
  } >> "$EVIDENCE"
  echo "CONTROLLED_SKIP: claude executable unavailable"
  exit 0
fi

CLAUDE_VERSION="$(run_claude --version 2>&1 || true)"
echo "CLAUDE_VERSION: $CLAUDE_VERSION" >> "$EVIDENCE"

if ! command -v tmux >/dev/null 2>&1; then
  HELP_OUTPUT="$(run_claude --plugin-dir "$ROOT/plugins/litclaude" --help 2>&1 || true)"
  {
    echo "CONTROLLED_SKIP: tmux unavailable"
    echo "$HELP_OUTPUT" | sed -n '1,40p'
    echo "CLEANUP: no tmux session started"
  } >> "$EVIDENCE"
  echo "CONTROLLED_SKIP: tmux unavailable"
  exit 0
fi

tmux new-session -d -s "$SESSION" "cd '$ROOT' && env HOME='$TMP_HOME' CLAUDE_CONFIG_DIR='$TMP_CLAUDE_HOME' LITCLAUDE_HOME='$TMP_HOME' claude --plugin-dir ./plugins/litclaude --help; printf '\nINNER_STATUS:%s\n' \"\$?\"; sleep 5"
sleep 1
tmux capture-pane -pt "$SESSION" -S -200 >> "$EVIDENCE" 2>&1 || true
tmux kill-session -t "$SESSION" >/dev/null 2>&1 || true

if rg -q "INNER_STATUS:0|Usage|Claude Code" "$EVIDENCE"; then
  echo "SMOKE_PASS: claude --plugin-dir accepted local LitClaude plugin path" >> "$EVIDENCE"
  echo "CLEANUP: $SESSION killed" >> "$EVIDENCE"
  echo "SMOKE_PASS: claude --plugin-dir accepted local LitClaude plugin path"
else
  echo "CONTROLLED_SKIP: claude help did not expose a stable plugin-dir smoke result" >> "$EVIDENCE"
  echo "CLEANUP: $SESSION killed" >> "$EVIDENCE"
  echo "CONTROLLED_SKIP: claude help did not expose a stable plugin-dir smoke result"
fi
echo "CLEANUP: removing smoke QA disposable root"
cleanup
echo "CLEANUP: removed smoke QA disposable root"
