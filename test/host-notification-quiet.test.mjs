import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SKILL_FIRST_NOTICE, SUGGESTION_NOTICE } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const NO_ACTIVATION = "LitClaude prompt hook checked: no workflow activation.";

// A throwaway project and home, so the result never depends on this machine's own Claude Code folders.
const sandbox = mkdtempSync(join(tmpdir(), "litclaude-host-quiet-"));
const project = join(sandbox, "project");
mkdirSync(join(project, ".git"), { recursive: true });
const env = Object.fromEntries(Object.entries({
  ...process.env, HOME: sandbox, CLAUDE_CONFIG_DIR: join(sandbox, ".claude"), LITCLAUDE_HOME: join(sandbox, ".litclaude"),
}).filter(([key]) => key !== "CLAUDE_PROJECT_DIR"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const promptContext = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: project,
    encoding: "utf8",
    env,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: project }),
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.systemMessage, undefined, prompt);
  return parsed.hookSpecificOutput.additionalContext.split("\n\n## Project Instructions\n", 1)[0];
};

const taskNotification = (result) => `<task-notification> <task-id>a1cef978f194f54e2</task-id> <status>completed</status> <summary>Agent finished</summary> <result>${result}</result> </task-notification>`;
const teammate = '<teammate-message teammate_id="lane-a" color="blue" summary="task done">task 4 is finished</teammate-message>';

describe("a prompt that is only host text gets no suggestion and no catalog", () => {
  for (const [label, prompt] of [
    ["the host banner", "[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event; the lane finished."],
    ["an unclosed task notification", "<task-notification> <task-id>b1</task-id> <status>completed</status> <result>the lane finished."],
    ["one task notification", taskNotification("The lane finished and wrote its report.")],
    ["two task notifications", `${taskNotification("one")}\n\n${taskNotification("two")}\n`],
    ["one teammate message", teammate],
    ["a teammate message and a task notification", `${teammate}\n${taskNotification("done")}`],
    ["a system reminder", "<system-reminder>\nthe date changed\n</system-reminder>"],
  ]) {
    it(label, () => {
      assert.equal(promptContext(prompt), NO_ACTIVATION);
    });
  }

  it("the user's own text beside a notification keeps the catalog line", () => {
    assert.equal(promptContext("hello there"), SKILL_FIRST_NOTICE);
    assert.equal(promptContext(`${taskNotification("done")}\nhello there`), SKILL_FIRST_NOTICE);
    assert.equal(promptContext(`${teammate}\nhello there`), SKILL_FIRST_NOTICE);
  });

  it("a blank prompt is not host text and keeps today's catalog line", () => {
    assert.equal(promptContext(""), SKILL_FIRST_NOTICE);
  });

  it("text that fires a suggestion rule keeps its candidates beside a notification", () => {
    const context = promptContext(`${taskNotification("done")}\ndraw an architecture diagram of our services and make a kinetic typography video of the launch quote`);
    assert.match(context, SUGGESTION_NOTICE);
    assert.match(context, /lit-diagram-drawer/u);
  });
});
