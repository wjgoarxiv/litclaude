import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("lit-plan defines an adaptive objective-achievable checklist", () => {
  const skill = read("plugins/litclaude/skills/lit-plan/SKILL.md");
  const command = read("plugins/litclaude/commands/lit-plan.md");
  const planner = read("plugins/litclaude/agents/lit-planner.md");
  const docs = `${read("README.md")}\n${read("README_ko-KR.md")}\n${skill}\n${command}\n${planner}`;

  for (const contract of [
    /Adaptive Checklist Depth/u,
    /one bounded objective/i,
    /explicit non-goals/i,
    /resolved or gated unknowns/i,
    /action.*output.*verification/is,
    /failure.*decision branch/is,
    /DoneClaim/u,
    /checklist padding/i,
  ]) {
    assert.match(docs, contract);
  }
});

test("review-work distinguishes draft-plan review from completed-work review", () => {
  const skill = read("plugins/litclaude/skills/review-work/SKILL.md");
  const command = read("plugins/litclaude/commands/review-work.md");
  const docs = `${read("README.md")}\n${read("README_ko-KR.md")}\n${skill}\n${command}`;

  for (const contract of [
    /Plan-Review Mode/u,
    /verdicts: \[PASS, FAIL, BLOCKED, ITERATE, NEEDS-CONTEXT\]/u,
    /objective achievability/i,
    /checklist atomicity/i,
    /acceptance.*evidence/is,
    /decision.*failure.*cleanup/is,
    /PASS \| ITERATE \| NEEDS-CONTEXT/u,
    /only revise when needed/i,
    /must not implement/i,
    /completed-work.*five-lane/is,
  ]) {
    assert.match(docs, contract);
  }
});

test("UserPromptSubmit injects the artifact-selective review-work contract", () => {
  const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
  assert.match(readFileSync(hookPath, "utf8"), /review-work selects the mode from the reviewed artifact/u);

  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "lit review this draft plan", cwd: root }),
  });

  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /draft plan.*PASS \| ITERATE \| NEEDS-CONTEXT/is);
  assert.match(context, /completed work.*five-lane/is);
  assert.match(context, /must not implement/i);
});
