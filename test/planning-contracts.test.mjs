import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildPlanSkeleton } from "../plugins/litclaude/scripts/scaffold-plan.mjs";

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

// plans/lit-adhd.md todo 9 (diag-startwork T16-T18, §4.5-§4.7): the typed command is the approval.
test("T16 start-work does not ask the user to set /goal before execution", () => {
  const command = read("plugins/litclaude/commands/start-work.md");
  const skill = read("plugins/litclaude/skills/start-work/SKILL.md");
  for (const text of [command, skill]) {
    assert.doesNotMatch(text, /ask the user to set a native `\/goal`/u);
    assert.doesNotMatch(text, /ready-to-paste `\/goal/iu);
    assert.match(text, /`\/goal` is optional/u);
  }
  for (const path of ["plugins/litclaude/commands/litgoal.md", "plugins/litclaude/skills/litgoal/SKILL.md"]) {
    assert.doesNotMatch(read(path), /wait for the user's next message/iu, path);
    assert.match(read(path), /show (it|the line) once and continue/iu, path);
  }
});

test("T17 lit-plan ends with a single-step start instruction that names the plan path", () => {
  const skill = read("plugins/litclaude/skills/lit-plan/SKILL.md");
  const command = read("plugins/litclaude/commands/lit-plan.md");
  for (const text of [skill, command]) {
    assert.match(text, /`\/litclaude:start-work plans\/<slug>\.md`/u);
    assert.match(text, /typing it approves this plan and runs it/u);
    assert.match(text, /Scope roots:/u);
    assert.doesNotMatch(text, /ready-to-paste `\/goal/iu);
  }
  assert.match(skill, /Please\s+confirm \(or steer\)/u, "the preview and the gate for plan changes stay");
});

test("T18 start-work docs name the short approve token and keep the exact route as a compatible alternative", () => {
  for (const path of [
    "plugins/litclaude/commands/start-work.md",
    "plugins/litclaude/skills/start-work/SKILL.md",
    "plugins/litclaude/skills/lit-loop/SKILL.md",
    "plugins/litclaude/commands/lit-loop.md",
    "plugins/litclaude/agents/lit-executor.md",
  ]) {
    const text = read(path);
    assert.match(text, /`lit approve`/u, path);
    assert.match(text, /`lit deny`/u, path);
  }
  for (const path of ["plugins/litclaude/commands/start-work.md", "plugins/litclaude/skills/start-work/SKILL.md"]) {
    const text = read(path);
    assert.match(text, /\/litclaude:start-work resume --work-id/u, `${path} keeps the exact route`);
    assert.match(text, /already initiali[sz]ed/u, `${path} says the typed command initializes the work`);
    assert.doesNotMatch(text, /require this slash command or the\s+namespaced/u, `${path} no longer sends a natural start back`);
  }
});


// Real-session QA (plans/lit-adhd.md todo 14, S2): a plan scaffolded by lit-plan still told the
// executor to wait for the user's okay before completing, which todo 9 removed from every doc.
test("T18b the plan skeleton's final wave completes without asking the user's okay", () => {
  const skeleton = buildPlanSkeleton("qa-slug", "clear");
  const wave = skeleton.slice(skeleton.indexOf("## Final verification wave"), skeleton.indexOf("## Commit strategy"));
  assert.doesNotMatch(wave, /okay|wait for the user/iu);
  assert.match(wave, /ALL must APPROVE/u);
  assert.match(wave, /a commit and push still ask/iu);
});
