import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildPlanSkeleton } from "../plugins/litclaude/scripts/scaffold-plan.mjs";
import { explainRoute, findWorkflowTrigger, isReviewPlanPhrase } from "../plugins/litclaude/lib/route-match.mjs";

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

test("plan review audits orchestration, and work review checks the run followed its plan", () => {
  const skill = read("plugins/litclaude/skills/review-work/SKILL.md");
  const command = read("plugins/litclaude/commands/review-work.md");
  const planReview = skill.slice(skill.indexOf("## Plan-Review Mode"), skill.indexOf("## Subagent Assignment Contract"));

  for (const contract of [
    /6\. \*\*Orchestration\*\*/u,
    /Orchestration: single lane/u,
    /scaffold-plan\.mjs" --check/u,
    /share a checkout or a real host/i,
    /fallback/i,
    /courier row/i,
    /executor this host lacks/i,
    /a missing part (?:is|returns) `ITERATE`/iu,
    /six dimensions/u,
  ]) {
    assert.match(planReview, contract);
  }
  assert.doesNotMatch(skill, /five dimensions/u, "the audit table has six rows now");

  const followed = skill.slice(skill.indexOf("### The run followed its plan"));
  assert.ok(skill.includes("### The run followed its plan"));
  for (const contract of [/hand-back file exists/i, /no lane committed/i, /answered or carried forward with a date/i, /row the orchestrator took over says so/i]) {
    assert.match(followed, contract);
  }
  const lanes = skill.slice(skill.indexOf("## Subagent Assignment Contract"), skill.indexOf("## Review Order"));
  assert.match(lanes, /writes\s+its\s+findings\s+to\s+a\s+named\s+file/iu);
  assert.match(lanes, /one\s+wake-up/iu);
  assert.match(lanes, /takes\s+the\s+lane\s+over/iu);
  assert.match(skill, /Run all five lanes/u, "the five lanes stay");
  assert.match(command, /orchestration/iu);
  assert.match(command, /followed its plan/iu);
});

test("review-plan is a route of its own that opens review-work in plan-review mode", () => {
  const named = findWorkflowTrigger("review-plan plans/x.md");
  assert.equal(named.command, "/litclaude:review-plan");
  assert.equal(named.skillId, "review-work");
  assert.equal(named.discipline, "review-work");
  assert.equal(named.view, "plan");
  assert.equal(findWorkflowTrigger("$review-plan plans/x.md").command, "/litclaude:review-plan");
  for (const prompt of ["lit review plan plans/x.md", "lit 계획 리뷰 plans/x.md", "lit 플랜 검토해줘", "lit plan review plans/x.md"]) {
    assert.equal(explainRoute(prompt).ruleId, "natural:review-plan", prompt);
  }
  assert.equal(explainRoute("lit review the plan").ruleId, "natural:review", "a looser phrase keeps its old rule");
  assert.equal(explainRoute("lit review the auth module").ruleId, "natural:review");
  for (const prompt of ["lit 계획 검토 결과를 반영해서 구현해줘", "lit write the plan review section of the report", "lit 플랜 리뷰어 에이전트를 만들어줘"]) {
    assert.notEqual(explainRoute(prompt).ruleId, "natural:review-plan", `${prompt} asks for other work`);
  }
  assert.equal(isReviewPlanPhrase("lit 계획 검토해줘"), true);
  assert.equal(isReviewPlanPhrase("lit 계획 리뷰"), true);
  assert.equal(findWorkflowTrigger("what does review-plan do?"), undefined, "a mention later in a prompt stays inert");

  const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
  for (const prompt of ["review-plan plans/x.md", "lit 계획 리뷰 plans/x.md"]) {
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Review mode forced by the user: plan review\./u, prompt);
  }

  const later = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "lit review the finished work; the review-plan pass was yesterday", cwd: root }),
  });
  assert.equal(later.status, 0, later.stderr);
  assert.doesNotMatch(JSON.parse(later.stdout).hookSpecificOutput.additionalContext, /Review mode forced by the user/u, "a later mention forces nothing");

  const command = read("plugins/litclaude/commands/review-plan.md");
  assert.match(command, /^---\n[\s\S]*description:/u);
  assert.match(command, /Use the `review-work` skill/u);
  assert.match(command, /plan-review mode/u);
  assert.match(command, /PASS \| ITERATE \| NEEDS-CONTEXT/u);
  assert.match(command, /must not implement/iu);
  assert.match(command, /orchestration/iu);
  for (const path of ["plugins/litclaude/skills/lit-plan/SKILL.md", "plugins/litclaude/commands/lit-plan.md"]) {
    assert.match(read(path), /`review-plan plans\/<slug>\.md`/u, `${path} offers the plan review before yes`);
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

test("T18 start-work docs name the short approve and cancel tokens, parked steps, and keep the exact route as a compatible alternative", () => {
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
    assert.match(text, /`lit cancel`/u, `${path} names the one-word cancel`);
    assert.match(text, /park/u, `${path} says an outside call is parked, not a freeze`);
    assert.doesNotMatch(text, /paused work cannot complete|A paused work cannot complete|pauses until the user answers/u, `${path} no longer freezes the run`);
  }
  for (const path of ["plugins/litclaude/skills/lit-plan/SKILL.md", "docs/hooks.md", "docs/guide.md", "docs/guide_ko-KR.md", "plugins/litclaude/skills/lit-adhd/SKILL.md"]) {
    assert.match(read(path), /`lit cancel`/u, `${path} names the one-word cancel`);
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
