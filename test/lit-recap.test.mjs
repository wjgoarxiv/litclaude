import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../scripts/strip-ansi.mjs";
import { assertNoWorkflowActivationContext } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const commandPath = join(root, "plugins", "litclaude", "commands", "lit-recap.md");
const removedSkillDir = join(root, "plugins", "litclaude", "skills", "lit-recap");
const adhdSkillPath = join(root, "plugins", "litclaude", "skills", "lit-adhd", "SKILL.md");

const runHook = (eventName, input) =>
  spawnSync(process.execPath, [hookPath, eventName], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(input),
  });

const readRequired = (path, label) => {
  assert.equal(existsSync(path), true, `${label} must exist`);
  return readFileSync(path, "utf8");
};

// lit-recap moved into lit-adhd (S5): the old routes stay as aliases for lit-adhd's recap view.
describe("lit-recap aliases open the lit-adhd recap view", () => {
  it("activates on bounded recap triggers without the litwork banner", () => {
    for (const prompt of [
      "lit recap",
      "litrecap",
      "recap",
      "recap what we did",
      "please recap the session",
      "리캡",
      "리캡 해줘",
      "리캡을 보여줘",
      "$lit-recap summarize",
    ]) {
      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt,
        cwd: root,
      });

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.match(stripAnsi(parsed.systemMessage ?? ""), /🔥 LIT IGNITED · lit-adhd 🔥/u, `${prompt} should activate lit-adhd`);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.match(context, /\/litclaude:lit-adhd/u, `${prompt} should reference the lit-adhd command`);
      assert.match(context, /Skill\(lit-adhd\)/u, `${prompt} should reference the lit-adhd skill`);
      assert.match(context, /rewind(?:\.mjs")? --recap --lang/u, `${prompt} should run the recap view`);
      assert.match(context, /lit-recap moved into lit-adhd \(lit adhd recap\)\./u, `${prompt} should say where lit-recap went`);
      assert.match(context, /READ-ONLY/u, `${prompt} should state the read-only contract`);
      assert.doesNotMatch(context, /Skill\(lit-recap\)/u, `${prompt} must not point at the removed skill`);
    }
  });

  it("rejects substrings, near-misses, code, and slash forms", () => {
    for (const prompt of [
      "recapture the flag",
      "recapitalize the table",
      "recaptcha widget",
      "prerecap notes",
      "litrecapture should not activate",
      "리캡처를 열어줘",
      "리캡쳐",
      "`recap this`",
      "```text\nrecap this\n```",
      "/lit-recap",
      "/litclaude:lit-recap",
      "/litrecap",
      "/lit recap",
    ]) {
      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt,
        cwd: root,
      });

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.systemMessage, undefined, `${prompt} should not activate`);
      assertNoWorkflowActivationContext(parsed.hookSpecificOutput.additionalContext, prompt);
    }
  });

  it("keeps recap activation side-effect-free against durable litgoal state", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-lit-recap-"));
    try {
      const litgoalDir = join(temp, ".litclaude", "litgoal");
      mkdirSync(litgoalDir, { recursive: true });
      const goalsPath = join(litgoalDir, "goals.json");
      const goals = JSON.stringify({ version: 1, objective: "sample objective", status: "active", criteria: [] });
      writeFileSync(goalsPath, goals);
      const listDir = () => readdirSync(temp, { recursive: true }).sort();
      const before = listDir();

      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt: "lit recap",
        cwd: temp,
      });

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.match(context, /read-only/iu);
      assert.match(context, /(do not mutate|no ledger writes|no file)/iu);
      assert.equal(readFileSync(goalsPath, "utf8"), goals, "goals.json must stay byte-identical");
      assert.deepEqual(listDir(), before, "recap activation must not create files");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("lit adhd recap [session] opens the same view without the moved note", () => {
    for (const [prompt, flag] of [["lit adhd recap", "\" --recap --lang"], ["lit adhd recap 1a2b3c4d", "\" --recap 1a2b3c4d --lang"], ["lit adhd 리캡", "\" --recap --lang"]]) {
      const parsed = JSON.parse(runHook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt, cwd: root }).stdout);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.ok(context.includes(flag), `${prompt} -> ${flag}`);
      assert.doesNotMatch(context, /lit-recap moved into lit-adhd/u, prompt);
    }
  });

  it("removes the lit-recap skill and keeps the command as an alias stub", () => {
    assert.equal(existsSync(removedSkillDir), false, "skills/lit-recap is gone");
    const command = readRequired(commandPath, "lit-recap alias command");
    assert.match(command, /description: "Alias: lit-recap moved into lit-adhd/u);
    assert.match(command, /Skill\(lit-adhd\)/u);
    assert.match(command, /rewind(?:\.mjs")? --recap/u);
    assert.doesNotMatch(command, /Skill\(lit-recap\)/u);
    const skill = readRequired(adhdSkillPath, "lit-adhd skill");
    assert.match(skill, /### The recap \(`lit adhd recap \[session\]`\)/u);
    assert.match(skill, /lit-recap moved into lit-adhd \(lit adhd recap\)\./u);
  });
});
