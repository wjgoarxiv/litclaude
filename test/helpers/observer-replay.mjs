import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const binPath = join(repoRoot, "bin", "litclaude-ai.js");
const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");

export const REPLAY = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", "replay-2026-10-27.json"), "utf8"));

// Commands the A1 grammar must keep refusing for another session, beyond the replay set.
export const EXTRA_DENIES = [
  "herdr agent send-keys x enter",
  "herdr pane run x",
  "cd /tmp && rm -f a",
  "grep x a > out",
  "herdr agent read x | sh",
  "grep \"$(id)\" a",
  "herdr agent read x --output=out.txt",
  "herdr pane read w2B:p61 --send-keys=enter",
  // The nudge verbs (plan 2026-11-15 todo 2) stop at prompting and splitting.
  "herdr pane close w2B:p61",
  "herdr agent start x --kind codex --pane w2B:p61",
  "herdr agent prompt worker \"$(id)\"",
  "herdr agent prompt worker \"`id`\"",
  "herdr agent prompt worker \"a\\\" ; b\"",
  "herdr agent prompt worker \"check\" --keys=enter",
  "herdr agent prompt worker",
  "herdr pane split --current --cwd /etc --no-focus",
  "herdr pane split --current --direction diagonal",
  "herdr tab create --workspace w2B --label x",
  "find . -delete",
  "find . -name x -fprint out",
  "find . -execdir id",
  "ls a > out",
  // F2 review H1: a watcher may not type the user's approvals into the worker.
  "herdr agent prompt worker \"lit cancel\"",
  "herdr agent prompt worker \"LIT 승인\"",
  "herdr agent prompt worker \"  litwork start work\"",
  "herdr agent prompt worker \"/start-work resume --work-id w\"",
  "herdr agent prompt worker \"go\"",
  "herdr agent prompt worker \"진행\"",
  "herdr agent prompt worker \"ㄱㄱ\"",
  // F2 review L1: BSD `find -f <root>` names a root the checks would not see.
  "find -f /missing-root -name x",
];
// Watcher commands the nudge change lets through, each as one inert command.
export const NUDGE_ALLOWS = [
  "herdr agent prompt worker \"check lane\"",
  "herdr agent prompt worker \"the lit-plan is ready; please read it\"",
  "herdr agent prompt worker \"a; rm -rf x | y && z\" --wait --timeout 60000",
  "herdr pane split --current --direction right --no-focus",
  "herdr tab create --workspace w2B --cwd plans --no-focus",
  "find plans -name '*.md'",
  "ls -la plans",
];

// The replay names folders of the machine it came from. Every absolute path is mapped to an
// existing folder under one temp "world", so the replay reads the same on any host.
export const makeWorld = () => realpathSync(mkdtempSync(join(tmpdir(), "litclaude-observer-world-")));
export const mapCommand = (command, world) => command.replace(/(?<=^|\s)\/[^\s'"|;&]+/gu, (path) => {
  const mapped = join(world, path.replace(/[^\w.-]+/gu, "_"));
  mkdirSync(mapped, { recursive: true });
  return mapped;
});

export const projectWithWork = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-observer-")));
  mkdirSync(join(root, "plans"), { recursive: true });
  writeFileSync(join(root, "plans", "approved.md"), "# Approved\n\n## TODOs\n\n- [ ] Ship safely\n");
  writeFileSync(join(root, "a"), "a\n");
  const result = spawnSync(process.execPath, [
    binPath, "start-work", "init", "--plan", "plans/approved.md", "--work-id", "work-1", "--session-id", "session-root",
    "--grant", `read:${root}`, "--grant", `write:${root}`, "--grant", `execute:${root}`, "--grant", `test:${root}`,
    "--idempotency-key", "init-1", "--root", root, "--json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return root;
};

const preTool = (root, sessionId, command) => spawnSync(process.execPath, [hookPath, "pre-tool-use"], {
  cwd: root,
  encoding: "utf8",
  input: JSON.stringify({
    cwd: root,
    hook_event_name: "pre-tool-use",
    session_id: sessionId,
    prompt_id: `prompt-${sessionId}`,
    stop_hook_active: false,
    tool_use_id: `tool-${sessionId}`,
    tool_name: "Bash",
    tool_input: { command },
  }),
});

// The hook's verdict in a comparable shape: allow (no deny) or deny with its reason, with the
// fixture root and the temp world written as placeholders.
export const verdict = (root, sessionId, command, world) => {
  const run = preTool(root, sessionId, command);
  assert.equal(run.status, 0, run.stderr);
  const output = run.stdout.trim() ? JSON.parse(run.stdout).hookSpecificOutput ?? {} : {};
  const tidy = (text) => text?.replaceAll(root, "<root>").replaceAll(world, "<world>");
  return output.permissionDecision === "deny"
    ? { decision: "deny", reason: tidy(output.permissionDecisionReason) }
    : { decision: "allow", context: tidy(output.additionalContext) ?? null };
};
