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
const skillPath = join(root, "plugins", "litclaude", "skills", "lit-recap", "SKILL.md");

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

describe("lit-recap read-only session recap", () => {
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
      assert.match(stripAnsi(parsed.systemMessage ?? ""), /🔥 LIT IGNITED · lit-recap 🔥/u, `${prompt} should activate lit-recap`);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.match(context, /\/litclaude:lit-recap/u, `${prompt} should reference the recap command`);
      assert.match(context, /Skill\(lit-recap\)/u, `${prompt} should reference the recap skill`);
      assert.match(context, /read-only/iu, `${prompt} should state the read-only contract`);
      assert.match(context, /🔥 \*\*LIT IGNITED · lit-recap\*\* 🔥/u, `${prompt} should request its own probe`);
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

  it("ships the canonical Korean recap template in the skill", () => {
    const skill = readRequired(skillPath, "lit-recap skill");

    for (const header of [
      "# 작업 리캡 (lit-recap)",
      "## ✅ 완료된 작업",
      "## 🔄 진행 중",
      "## ⛔ 블로커",
      "## 📁 증거 경로",
      "## ➡️ 다음 단계",
      "## ⚡ 요약",
    ]) {
      assert.ok(skill.includes(header), `skill must contain exact header ${header}`);
    }

    assert.match(skill, /\[TypeScript\]|\[npm\]|\[docs\]|\[test\]/u, "skill must show tech-kind tagging examples");
    assert.match(skill, /\.litclaude\/litgoal\/goals\.json/u);
    assert.match(skill, /ledger\.jsonl/u);
    assert.match(skill, /brief\.md/u);
    assert.match(skill, /name:\s*lit-recap/u);
  });

  it("defines English and brief switching plus technical-token fidelity", () => {
    const skill = readRequired(skillPath, "lit-recap skill");

    assert.match(skill, /--en|in English|영어/u, "skill must define the English-mode switch");
    assert.match(skill, /--brief|짧게/u, "skill must define the brief switch");
    assert.match(skill, /verbatim|그대로|원문/u, "skill must keep technical tokens verbatim");
  });

  it("ships a thin read-only command that routes to the skill", () => {
    const command = readRequired(commandPath, "lit-recap command");

    assert.match(command, /^---\n[\s\S]*description:/u, "command must have frontmatter with a description");
    assert.match(command, /Skill\(lit-recap\)/u, "command must route to Skill(lit-recap)");
    assert.match(command, /read-only/iu, "command must state the read-only contract");
    assert.doesNotMatch(command, /\$ARGUMENTS/u, "command must not render broken argument placeholders");
  });
});
