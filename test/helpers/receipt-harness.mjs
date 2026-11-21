// Shared fixtures for the receipt ledger and Stop receipt gate tests: a temp project, an isolated
// LitClaude home, and payloads shaped like the ones Claude Code 2.1.330 sent on a real run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");
export const SID = "cccccccc-3333-4333-8333-333333333333";
export const SENTINELS = ["SENTINEL_PROMPT_7f3", "SENTINEL_ARG_7f3", "SENTINEL_STDOUT_7f3", "SENTINEL_STDERR_7f3", "SENTINEL_ERROR_7f3"];

export const receiptHarness = ({ git = true } = {}) => {
  const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "litclaude-receipts-")));
  const project = join(temp, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "package.json"), `${JSON.stringify({ name: "fixture", scripts: { test: "node t.js" } })}\n`);
  if (git) {
    spawnSync("git", ["init", "-q"], { cwd: project });
    spawnSync("git", ["-c", "user.email=f@x", "-c", "user.name=f", "commit", "-q", "--allow-empty", "-m", "base"], { cwd: project });
  }
  const env = {
    ...process.env,
    HOME: join(temp, "home"),
    LITCLAUDE_HOME: join(temp, "lit-home"),
    CLAUDE_HOME: join(temp, "claude-home"),
    CLAUDE_CONFIG_DIR: join(temp, "claude-config"),
    LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud-state"),
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  mkdirSync(env.HOME, { recursive: true });
  const run = (event, payload) => spawnSync(process.execPath, [hookPath, event], {
    cwd: project,
    env,
    encoding: "utf8",
    input: JSON.stringify({ session_id: SID, cwd: project, prompt_id: "p-1", ...payload }),
  });
  const dir = join(project, ".litclaude", "sessions", SID);
  const receipts = () => (existsSync(join(dir, "receipts.jsonl"))
    ? readFileSync(join(dir, "receipts.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []);
  const edits = () => (existsSync(join(dir, "edits.json")) ? JSON.parse(readFileSync(join(dir, "edits.json"), "utf8")) : null);
  return { temp, project, env, run, dir, receipts, edits };
};

export const passingBash = (command) => ({
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command, description: "run" },
  tool_response: { stdout: "SENTINEL_STDOUT_7f3", stderr: "SENTINEL_STDERR_7f3", interrupted: false, isImage: false, noOutputExpected: false },
  prompt: "SENTINEL_PROMPT_7f3",
});
export const failingBash = (command, code = 1) => ({
  hook_event_name: "PostToolUseFailure",
  tool_name: "Bash",
  tool_input: { command, description: "run" },
  error: `Exit code ${code}\n\nSENTINEL_ERROR_7f3`,
  is_interrupt: false,
  prompt: "SENTINEL_PROMPT_7f3",
});
export const editPayload = (filePath, toolName = "Edit") => ({
  hook_event_name: "PostToolUse",
  tool_name: toolName,
  tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
  tool_response: { filePath, success: true },
});

