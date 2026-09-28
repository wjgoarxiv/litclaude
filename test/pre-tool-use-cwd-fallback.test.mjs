import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(repoRoot, "bin", "litclaude-ai.js");
const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");

const ADVISORY = /working directory .* no longer exists; LitClaude evaluated this tool call at the project root .*\. Run `cd` back to the project before continuing\./u;

const fixtureRoot = () => mkdtempSync(join(tmpdir(), "litclaude-cwd-fallback-"));

// The session's own environment must not decide the outcome: every run states
// CLAUDE_PROJECT_DIR explicitly, or removes it.
const hookEnv = (projectDir) => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  return env;
};

const runHook = ({ processCwd, input, projectDir }) => spawnSync(process.execPath, [hookPath, "pre-tool-use"], {
  cwd: processCwd,
  encoding: "utf8",
  env: hookEnv(projectDir),
  input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "session-root", ...input }),
});

const missingDirectory = (root) => {
  const gone = join(root, "gone");
  mkdirSync(gone);
  rmSync(gone, { recursive: true });
  return gone;
};

const initializeStartWork = (root) => {
  mkdirSync(join(root, "plans"), { recursive: true });
  writeFileSync(join(root, "plans", "approved.md"), "# Approved\n\n## TODOs\n\n- [ ] Ship safely\n");
  const result = spawnSync(process.execPath, [
    binPath, "start-work", "init", "--plan", "plans/approved.md", "--work-id", "work-1", "--session-id", "session-root",
    "--grant", `read:${root}`, "--grant", `write:${root}`, "--grant", `execute:${root}`, "--grant", `test:${root}`,
    "--idempotency-key", "init-1", "--root", root, "--json",
  ], { cwd: root, encoding: "utf8", env: hookEnv(undefined) });
  assert.equal(result.status, 0, result.stderr);
};

describe("PreToolUse falls back to the project root when the working directory is gone", () => {
  it("continues evaluation at CLAUDE_PROJECT_DIR and tells the model to cd back", () => {
    const root = fixtureRoot();
    try {
      const gone = missingDirectory(root);
      const result = runHook({
        processCwd: root,
        projectDir: root,
        input: { cwd: gone, tool_name: "Read", tool_input: { file_path: join(root, "a.txt") } },
      });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
      assert.equal(output.hookSpecificOutput.permissionDecision, undefined, result.stdout);
      assert.match(output.hookSpecificOutput.additionalContext, ADVISORY);
      assert.equal(output.hookSpecificOutput.additionalContext.split("\n").length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the fallback advisory beside other PreToolUse context", () => {
    const root = fixtureRoot();
    try {
      const gone = missingDirectory(root);
      const result = runHook({
        processCwd: root,
        projectDir: root,
        input: { cwd: gone, tool_name: "Bash", tool_input: { command: "git reflog -3" } },
      });
      assert.equal(result.status, 0, result.stderr);
      const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.match(context, ADVISORY);
      assert.match(context, /Skill\(lit-commit\)/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves output byte-identical when the working directory exists", () => {
    const root = fixtureRoot();
    const other = fixtureRoot();
    try {
      const cases = [
        [{ cwd: root, tool_name: "Read", tool_input: { file_path: join(root, "a.txt") } }, ""],
        [
          { cwd: root, tool_name: "Bash", tool_input: { command: "git reflog -3" } },
          `${JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "Skill(lit-commit): this is a commit or history operation. Read the ground truth before acting, keep unrelated dirty state intact, and never rewrite published history without explicit approval.",
            },
          })}\n`,
        ],
      ];
      for (const [input, expected] of cases) {
        for (const projectDir of [undefined, root, other, missingDirectory(other)]) {
          const result = runHook({ processCwd: root, projectDir, input });
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stdout, expected, `CLAUDE_PROJECT_DIR=${projectDir}`);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("still fails closed when no existing project root can be resolved", () => {
    const root = fixtureRoot();
    try {
      const gone = missingDirectory(root);
      for (const projectDir of [undefined, "", missingDirectory(root), join(root, "file.txt")]) {
        writeFileSync(join(root, "file.txt"), "not a directory");
        const result = runHook({
          processCwd: root,
          projectDir,
          input: { cwd: gone, tool_name: "Read", tool_input: { file_path: join(root, "a.txt") } },
        });
        assert.equal(result.status, 0, result.stderr);
        const output = JSON.parse(result.stdout).hookSpecificOutput;
        assert.equal(output.permissionDecision, "deny", `CLAUDE_PROJECT_DIR=${projectDir}`);
        assert.match(output.permissionDecisionReason, /start-work authority check failed closed: .*does not exist/u);
        assert.equal(output.additionalContext, undefined);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps real denials when the fallback root is used", () => {
    const root = fixtureRoot();
    try {
      initializeStartWork(root);
      const gone = missingDirectory(root);
      const guarded = runHook({
        processCwd: root,
        projectDir: root,
        input: { cwd: gone, prompt_id: "prompt-1", tool_use_id: "tool-1", tool_name: "Bash", tool_input: { command: "npm publish" } },
      });
      assert.equal(guarded.status, 0, guarded.stderr);
      const guardedOutput = JSON.parse(guarded.stdout).hookSpecificOutput;
      assert.equal(guardedOutput.permissionDecision, "deny");
      assert.match(guardedOutput.permissionDecisionReason, /forbidden/iu);
      assert.match(guardedOutput.additionalContext, ADVISORY);

      const wrongSession = runHook({
        processCwd: root,
        projectDir: root,
        input: { cwd: gone, session_id: "session-other", tool_name: "Read", tool_input: { file_path: join(root, "a.txt") } },
      });
      const wrongSessionOutput = JSON.parse(wrongSession.stdout).hookSpecificOutput;
      assert.equal(wrongSessionOutput.permissionDecision, "deny");
      assert.equal(wrongSessionOutput.permissionDecisionReason, "wrong session for active start-work authority");

      const allowed = runHook({
        processCwd: root,
        projectDir: root,
        input: { cwd: gone, tool_name: "Read", tool_input: { file_path: join(root, "a.txt") } },
      });
      const allowedOutput = JSON.parse(allowed.stdout).hookSpecificOutput;
      assert.equal(allowedOutput.permissionDecision, undefined, allowed.stdout);
      assert.match(allowedOutput.additionalContext, ADVISORY);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hook fixture: the host runs the script from a deleted directory with JSON on stdin", () => {
    const root = fixtureRoot();
    try {
      const doomed = join(root, "session-clone");
      mkdirSync(doomed);
      const payload = JSON.stringify({
        session_id: "session-root",
        transcript_path: join(root, "transcript.jsonl"),
        cwd: doomed,
        permission_mode: "default",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls", description: "List files" },
        tool_use_id: "toolu_fixture",
      });
      // The shell enters the directory, deletes it, then execs node in place, so
      // both the payload cwd and the hook process cwd are gone, as in a real session.
      const result = spawnSync("/bin/sh", ["-c", 'cd "$1" && rmdir "$1" && exec "$2" "$3" pre-tool-use', "sh", doomed, process.execPath, hookPath], {
        cwd: root,
        encoding: "utf8",
        env: hookEnv(root),
        input: payload,
      });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(output.hookEventName, "PreToolUse");
      assert.equal(output.permissionDecision, undefined, result.stdout);
      assert.match(output.additionalContext, ADVISORY);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
