// The prompt hook runs inside the host's UserPromptSubmit time limit. A start-work lock held by another
// session must make it answer "busy" well inside that limit, or the host kills it and discards the answer.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const hooks = JSON.parse(readFileSync(join(root, "plugins", "litclaude", "hooks", "hooks.json"), "utf8")).hooks;
const promptHookTimeoutMs = hooks.UserPromptSubmit[0].hooks[0].timeout * 1000;

const env = { ...process.env };
delete env.LITCLAUDE_START_WORK_LOCK_TIMEOUT_MS;

describe("prompt hook start-work lock budget", () => {
  it("gives UserPromptSubmit the same 10 s floor as the other hooks", () => {
    assert.ok(promptHookTimeoutMs >= 10_000, `UserPromptSubmit timeout is ${promptHookTimeoutMs} ms`);
  });

  it("answers busy well inside the limit when another session holds the start-work lock", () => {
    const prompt = "/litclaude:start-work plans/p.md";
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-prompt-lock-")));
    try {
      mkdirSync(join(cwd, "plans"));
      writeFileSync(join(cwd, "plans", "p.md"), "# P\n\n## TODOs\n\n- [ ] 1. do it\n");
      const lock = join(cwd, ".litclaude", "start-work", ".lock");
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, "owner.json"), `${JSON.stringify({ nonce: "held", pid: process.pid, acquired_at_ms: Date.now() })}\n`);
      const started = Date.now();
      const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
        cwd: root,
        encoding: "utf8",
        input: `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd, session_id: "session-busy", prompt_id: "prompt-busy" })}\n`,
        env,
      });
      const elapsed = Date.now() - started;
      assert.equal(result.status, 0, result.stderr);
      assert.ok(elapsed < 3_000, `hook took ${elapsed} ms against a ${promptHookTimeoutMs} ms limit`);
      const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
      assert.match(output.systemMessage, /busy/iu);
      assert.match(output.hookSpecificOutput.additionalContext, /again/iu);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
