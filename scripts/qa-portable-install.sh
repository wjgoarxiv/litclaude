#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT=""
TMP_HOME=""
TMP_CLAUDE_HOME=""
EVIDENCE=""
PACKAGE_VERSION=""

cleanup() {
  if [ -n "$TMP_ROOT" ]; then
    rm -rf "$TMP_ROOT"
    TMP_ROOT=""
  fi
}
trap cleanup EXIT INT TERM

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp/}litclaude-portable-qa-root.XXXXXX")" || {
  echo "PORTABLE_QA_SETUP_FAIL: unable to create disposable QA root" >&2
  exit 1
}
TMP_HOME="$TMP_ROOT/home"
TMP_CLAUDE_HOME="$TMP_ROOT/claude-config"
EVIDENCE="$TMP_ROOT/evidence/portable-qa-install.txt"
if ! mkdir -p "$TMP_HOME" "$TMP_CLAUDE_HOME" "$(dirname "$EVIDENCE")"; then
  echo "PORTABLE_QA_SETUP_FAIL: unable to initialize disposable QA root" >&2
  exit 1
fi
export HOME="$TMP_HOME"
export LITCLAUDE_HOME="$TMP_HOME"
export CLAUDE_CONFIG_DIR="$TMP_CLAUDE_HOME"
PACKAGE_VERSION_OUTPUT="$(node "$ROOT/bin/litclaude-ai.js" --version 2>&1)"
PACKAGE_VERSION="${PACKAGE_VERSION_OUTPUT##*$'\n'}"
HOOK_EVENT_COUNT="$(node -e 'const fs = require("fs"); const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (!manifest.hooks || typeof manifest.hooks !== "object" || Array.isArray(manifest.hooks)) process.exit(1); process.stdout.write(String(Object.keys(manifest.hooks).length));' "$ROOT/plugins/litclaude/hooks/hooks.json")" || {
  echo "PORTABLE_QA_SETUP_FAIL: unable to read shipped hook inventory" >&2
  exit 1
}

run_claude() {
  env HOME="$TMP_HOME" CLAUDE_CONFIG_DIR="$TMP_CLAUDE_HOME" claude "$@"
}

: > "$EVIDENCE"

{
  echo "LitClaude portable install QA"
  echo "ROOT: $ROOT"
  echo "PACKAGE_VERSION: $PACKAGE_VERSION"
  date
} >> "$EVIDENCE"

TMP_HOME="$TMP_ROOT/home"
TMP_CLAUDE_HOME="$TMP_ROOT/claude-config"
mkdir -p "$TMP_HOME" "$TMP_CLAUDE_HOME"
export LITCLAUDE_HOME="$TMP_HOME"
export CLAUDE_CONFIG_DIR="$TMP_CLAUDE_HOME"

run_step() {
  local label="$1"
  shift
  local status
  {
    echo
    echo "## $label"
    "$@"
    status="$?"
    echo "STATUS:$status"
  } >> "$EVIDENCE" 2>&1
  if [ "$status" != "0" ]; then
    echo "${label}_FAIL"
    exit "$status"
  fi
}

run_step INSTALL node "$ROOT/bin/litclaude-ai.js" install

PLUGIN_PATH_OUTPUT="$(node "$ROOT/bin/litclaude-ai.js" path)"
PLUGIN_PATH="${PLUGIN_PATH_OUTPUT##*$'\n'}"
{
  echo
  echo "## PATH"
  echo "$PLUGIN_PATH"
} >> "$EVIDENCE"

if [ ! -f "$PLUGIN_PATH/.claude-plugin/plugin.json" ]; then
  echo "INSTALL_FAIL: plugin manifest missing" >> "$EVIDENCE"
  echo "INSTALL_FAIL"
  exit 1
fi
for runtime_file in \
  "$PLUGIN_PATH/lib/litgoal/paths.mjs" \
  "$PLUGIN_PATH/lib/litgoal/state.mjs" \
  "$PLUGIN_PATH/lib/litgoal/ledger.mjs" \
  "$PLUGIN_PATH/lib/litgoal/cli.mjs"
do
  if [ ! -f "$runtime_file" ]; then
    echo "INSTALL_FAIL: litgoal runtime missing: $runtime_file" >> "$EVIDENCE"
    echo "INSTALL_FAIL"
    exit 1
  fi
done
echo "LITGOAL_RUNTIME_PASS" >> "$EVIDENCE"
if [ ! -f "$TMP_CLAUDE_HOME/plugins/installed_plugins.json" ]; then
  echo "INSTALL_FAIL: Claude plugin registry missing" >> "$EVIDENCE"
  echo "INSTALL_FAIL"
  exit 1
fi
if [ ! -f "$TMP_CLAUDE_HOME/settings.json" ]; then
  echo "INSTALL_FAIL: Claude settings missing" >> "$EVIDENCE"
  echo "INSTALL_FAIL"
  exit 1
fi
if [ ! -f "$TMP_CLAUDE_HOME/plugins/known_marketplaces.json" ]; then
  echo "INSTALL_FAIL: Claude known marketplaces missing" >> "$EVIDENCE"
  echo "INSTALL_FAIL"
  exit 1
fi
if [ ! -f "$TMP_HOME/marketplaces/litclaude-ai/.claude-plugin/marketplace.json" ]; then
  echo "INSTALL_FAIL: LitClaude local marketplace missing" >> "$EVIDENCE"
  echo "INSTALL_FAIL"
  exit 1
fi
node -e 'const fs = require("fs"); const p = process.argv[1]; const registry = JSON.parse(fs.readFileSync(`${p}/plugins/installed_plugins.json`, "utf8")); const entry = registry.plugins["litclaude@litclaude-ai"]?.[0]; if (!entry || entry.scope !== "user" || !entry.installPath.includes("/plugins/cache/litclaude-ai/litclaude/")) process.exit(1);' "$TMP_CLAUDE_HOME"
node -e 'const fs = require("fs"); const p = process.argv[1]; const h = process.argv[2]; const settings = JSON.parse(fs.readFileSync(`${p}/settings.json`, "utf8")); const market = settings.extraKnownMarketplaces?.["litclaude-ai"]; if (settings.enabledPlugins?.["litclaude@litclaude-ai"] !== true || market?.source?.source !== "directory" || market.source.path !== `${h}/marketplaces/litclaude-ai`) process.exit(1);' "$TMP_CLAUDE_HOME" "$TMP_HOME"
node -e 'const fs = require("fs"); const p = process.argv[1]; const h = process.argv[2]; const known = JSON.parse(fs.readFileSync(`${p}/plugins/known_marketplaces.json`, "utf8")); const market = known["litclaude-ai"]; if (market?.source?.source !== "directory" || market.installLocation !== `${h}/marketplaces/litclaude-ai`) process.exit(1);' "$TMP_CLAUDE_HOME" "$TMP_HOME"
echo "INSTALL_PASS" >> "$EVIDENCE"

run_step DOCTOR node "$ROOT/bin/litclaude-ai.js" doctor
echo "DOCTOR_PASS" >> "$EVIDENCE"

if command -v claude >/dev/null 2>&1; then
  run_step CLAUDE_PLUGIN_DETAILS run_claude plugin details litclaude@litclaude-ai
  if ! grep -q "LitClaude (litclaude) $PACKAGE_VERSION" "$EVIDENCE" || ! grep -Eq "Skills \\([0-9]+\\)" "$EVIDENCE" || ! grep -q "lit-loop" "$EVIDENCE" || ! grep -q "lit-plan" "$EVIDENCE" || ! grep -Eq "Agents \\([1-9][0-9]*\\)" "$EVIDENCE" || ! grep -q "lit-planner" "$EVIDENCE" || grep -q "Agents (0)" "$EVIDENCE" || ! grep -q "Hooks ($HOOK_EVENT_COUNT)" "$EVIDENCE" || ! grep -q "PreToolUse" "$EVIDENCE" || ! grep -q "SubagentStart" "$EVIDENCE"; then
    echo "CLAUDE_PLUGIN_DETAILS_FAIL: expected current LitClaude version plus skills/agents/hooks inventory" >> "$EVIDENCE"
    echo "CLAUDE_PLUGIN_DETAILS_FAIL"
    exit 1
  fi
else
  echo "CLAUDE_PLUGIN_DETAILS_SKIP: claude executable not found" >> "$EVIDENCE"
fi

run_step DRY_RUN_UNINSTALL node "$ROOT/bin/litclaude-ai.js" --dry-run uninstall
if [ ! -d "$PLUGIN_PATH" ]; then
  echo "DRY_RUN_UNINSTALL_FAIL: plugin removed during dry-run" >> "$EVIDENCE"
  exit 1
fi

run_step UNINSTALL node "$ROOT/bin/litclaude-ai.js" uninstall
if [ -e "$TMP_HOME/current" ] || [ -e "$TMP_HOME/litclaude-ai" ] || [ -e "$TMP_CLAUDE_HOME/plugins/cache/litclaude-ai" ]; then
  echo "UNINSTALL_FAIL: managed state remains" >> "$EVIDENCE"
  echo "UNINSTALL_FAIL"
  exit 1
fi
node -e 'const fs = require("fs"); const p = process.argv[1]; const settings = JSON.parse(fs.readFileSync(`${p}/settings.json`, "utf8")); if (settings.enabledPlugins?.["litclaude@litclaude-ai"] !== undefined) process.exit(1);' "$TMP_CLAUDE_HOME"
node -e 'const fs = require("fs"); const p = process.argv[1]; const settings = JSON.parse(fs.readFileSync(`${p}/settings.json`, "utf8")); const known = JSON.parse(fs.readFileSync(`${p}/plugins/known_marketplaces.json`, "utf8")); if (settings.extraKnownMarketplaces?.["litclaude-ai"] !== undefined || known["litclaude-ai"] !== undefined) process.exit(1);' "$TMP_CLAUDE_HOME"
echo "UNINSTALL_PASS" >> "$EVIDENCE"

echo "CLEANUP: removing portable QA disposable root"
cleanup
TMP_HOME=""
TMP_CLAUDE_HOME=""
EVIDENCE=""
echo "CLEANUP: removed portable QA disposable root"
echo "PORTABLE_QA_PASS"
