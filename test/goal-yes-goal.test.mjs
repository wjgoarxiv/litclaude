// The approval question offers the native goal as a second answer (backlog 9.39, 2026-11-28): a plan
// without a `goal: native` line used to say "add a goal: native line to the plan", so a user who wanted
// the goal had to edit the plan by hand. Now `yes` starts the work with no goal and `yes goal` starts it
// and arms the same self-ending goal the line would have armed, rebuilt from the plan at that moment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GOAL_ANSWERS, GOAL_STATUS, consentAnswer, goalGuideMarkdown, goalGuidePlain } from "../plugins/litclaude/lib/goal-pipeline.mjs";
import { proposeGoal, proposeLoopGoal } from "../plugins/litclaude/scripts/goal-propose.mjs";

const plugin = fileURLToPath(new URL("../plugins/litclaude/", import.meta.url));
const hookPath = join(plugin, "bin", "litclaude-hook.js");
const temp = mkdtempSync(join(tmpdir(), "litclaude-yes-goal-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const PLAN = "# P\n\n## Todos\n\n- [ ] 1. Make the test pass\n\n## Done when\n\ncheck: `npm test`\n";
const project = (name, plan = PLAN) => {
  const cwd = join(temp, name);
  mkdirSync(join(cwd, "plans"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name, scripts: { test: 'node -e "process.exit(1)"' } }));
  writeFileSync(join(cwd, "plans", "p.md"), plan);
  return cwd;
};
let sent = 0;
const hook = (cwd, prompt, sessionId = "s-goal", event = "UserPromptSubmit") => {
  sent += 1;
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: join(temp, "home"), LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
    input: JSON.stringify({ hook_event_name: event, prompt, cwd, session_id: sessionId, prompt_id: `p-${sent}` }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const intentPath = (cwd, sessionId = "s-goal") => join(cwd, ".litclaude", "sessions", sessionId, "goal", "intent.json");
const neverRuns = () => assert.fail("the optional goal must not run the plan's check to be offered");
const started = /LitClaude started start-work/u;
const selfEnding = /^Every row in plans\/p\.md is ticked and `npm test` exits 0, or the latest reply starts with WAITING-ON-USER:, or after \d+ turns \[lit:[0-9a-f]{8}\]$/u;

describe("the question offers the goal as a second answer", () => {
  it("the line, the answers and the guide are fixed text", () => {
    assert.equal(GOAL_STATUS.startOrGoal, "Approve plan and start work? (yes / yes goal / no)");
    assert.equal(GOAL_STATUS.optional("C"), "Optional goal, set only by `yes goal`: /goal C");
    assert.deepEqual(GOAL_ANSWERS.startOrGoal.map(([word]) => word), ["yes", "yes goal", "no"]);
    const guide = goalGuideMarkdown("startOrGoal");
    assert.doesNotMatch(guide, /\/goal/u, "the goal is shown once, on the line under the question");
    assert.match(guide, /^> Type the answer alone\.$/mu, "two words are not \"the word\"");
    assert.match(goalGuidePlain("startOrGoal"), /\n {2}Type the answer alone\.$/u);
    assert.match(goalGuideMarkdown("startOnly"), /^> Type the word alone\.$/mu);
    assert.match(guide, /^> \| \*\*`yes`\*\* \| Starts the work now, with no goal \|$/mu);
    assert.match(guide, /^> \| \*\*`yes goal`\*\* \| Starts the work now and sets the goal above when this reply ends \|$/mu);
    assert.match(guide, /^> \| \*\*`no`\*\* \| Nothing starts \|$/mu);
  });

  it("a plan without a goal line gets both answers, and nothing tells the user to edit the plan", () => {
    const cwd = project("offer");
    const { line, guide, consent } = proposeGoal({ cwd, planArg: "plans/p.md", run: neverRuns });
    const [ask, optional, ...rest] = line.split("\n");
    assert.equal(ask, GOAL_STATUS.startOrGoal);
    assert.equal(optional, GOAL_STATUS.optional(consent.goal_option.condition));
    assert.deepEqual(rest, []);
    assert.doesNotMatch(line, /add a|goal: native/u);
    assert.equal(consent.condition, null, "a plain yes still sets no goal");
    assert.match(consent.goal_option.condition, selfEnding);
    assert.equal(guide, goalGuideMarkdown("startOrGoal"));
  });

  it("no second answer when no goal can be built, and the line says why", () => {
    for (const [name, plan, reason] of [
      ["no-block", "# P\n\n- [ ] 1. a\n", /no `## Done when` block/u],
      ["judgment", PLAN.replace("npm test", "make it work"), /cannot be checked|not an allowlisted/u],
      ["all-ticked", PLAN.replace("- [ ]", "- [x]"), /has no open row/u],
      ["never", `goal: never\n${PLAN}`, /goal: never/u],
    ]) {
      const { line, consent } = proposeGoal({ cwd: project(name, plan), planArg: "plans/p.md", run: neverRuns });
      const [ask, why] = line.split("\n");
      assert.equal(ask, GOAL_STATUS.startOnly, name);
      assert.match(why, /^No goal set: /u, name);
      assert.match(why, reason, name);
      assert.equal(consent.goal_option, undefined, name);
    }
  });

  it("a yes word and `goal`, alone, are the answer; anything more is not", () => {
    for (const text of ["yes goal", " YES  Goal ", "네 goal", "ok goal"]) assert.equal(consentAnswer(text), "yes goal", text);
    for (const text of ["yes goals", "goal yes", "yes goal please", "yes, goal", "goal"]) assert.equal(consentAnswer(text), null, text);
    assert.equal(consentAnswer("yes"), "yes");
  });
});

describe("the two answers", () => {
  it("`yes goal` starts the work and arms the goal the question showed", () => {
    const cwd = project("yes-goal");
    const { consent } = proposeGoal({ cwd, planArg: "plans/p.md" });
    const context = hook(cwd, "yes goal");
    assert.match(context, started);
    assert.ok(context.includes(GOAL_STATUS.armed(consent.goal_option.id)), context);
    assert.match(context, /WAITING-ON-USER:/u);
    assert.match(context, /Do not run \/goal yourself/u);
    const intent = JSON.parse(readFileSync(intentPath(cwd), "utf8"));
    assert.equal(intent.condition, consent.goal_option.condition);
    assert.equal(intent.plan, "plans/p.md");
  });

  it("`yes` starts the work and arms nothing", () => {
    const cwd = project("yes-only");
    proposeGoal({ cwd, planArg: "plans/p.md" });
    assert.match(hook(cwd, "yes"), started);
    assert.equal(existsSync(intentPath(cwd)), false);
  });

  it("`no` starts nothing and arms nothing", () => {
    const cwd = project("no");
    proposeGoal({ cwd, planArg: "plans/p.md" });
    assert.doesNotMatch(hook(cwd, "no"), started);
    assert.equal(existsSync(intentPath(cwd)), false);
  });

  it("`yes goal` where no goal was offered starts the work and says no goal is set", () => {
    const cwd = project("unoffered", `goal: never\n${PLAN}`);
    proposeGoal({ cwd, planArg: "plans/p.md" });
    const context = hook(cwd, "yes goal");
    assert.match(context, started);
    assert.match(context, /No goal set: /u);
    assert.equal(existsSync(intentPath(cwd)), false);
    assert.equal(existsSync(join(cwd, ".litclaude", "goal", "consent.json")), false, "the question is over");
  });

  it("`goal: never` added after the question wins over `yes goal`", () => {
    const cwd = project("never-later");
    proposeGoal({ cwd, planArg: "plans/p.md" });
    writeFileSync(join(cwd, "plans", "p.md"), `goal: never\n${PLAN}`);
    assert.match(hook(cwd, "yes goal"), started);
    assert.equal(existsSync(intentPath(cwd)), false);
  });

  it("a start that is refused arms nothing on `yes goal` either", () => {
    const cwd = project("gone");
    proposeGoal({ cwd, planArg: "plans/p.md" });
    rmSync(join(cwd, "plans", "p.md"));
    const context = hook(cwd, "yes goal");
    assert.doesNotMatch(context, started);
    assert.match(context, /No goal set: start-work did not start \(/u);
    assert.equal(existsSync(intentPath(cwd)), false);
  });

  it("relayed text and a payload of another event do not answer the question", () => {
    const cwd = project("relayed");
    proposeGoal({ cwd, planArg: "plans/p.md" });
    for (const prompt of ['<teammate-message teammate_id="a" color="blue">yes goal</teammate-message>', "<task-notification>yes goal</task-notification>", "the lane says: yes goal"]) {
      assert.doesNotMatch(hook(cwd, prompt), started, prompt);
    }
    assert.doesNotMatch(hook(cwd, "yes goal", "s-goal", "Stop"), started, "another event");
    assert.equal(existsSync(intentPath(cwd)), false);
    assert.match(hook(cwd, "yes goal"), started, "the user's own prompt still answers it");
  });

  it("on a lit-loop goal question `yes goal` means yes", () => {
    const cwd = project("loop");
    const { consent } = proposeLoopGoal({ cwd, check: "npm test", objective: "fix the redirect" });
    const context = hook(cwd, "yes goal");
    assert.ok(context.includes(GOAL_STATUS.armed(consent.id)));
    assert.doesNotMatch(context, started, "a lit-loop goal starts no start-work");
  });

  it("a plan whose check changed after the question starts, but the stale goal is not armed", () => {
    const cwd = project("changed");
    proposeGoal({ cwd, planArg: "plans/p.md" });
    writeFileSync(join(cwd, "plans", "p.md"), PLAN.replace("npm test", "npm run other"));
    const context = hook(cwd, "yes goal");
    assert.match(context, started);
    assert.match(context, /No goal set: /u);
    assert.equal(existsSync(intentPath(cwd)), false);
  });

  it("a goal option written into the record by hand is not armed", () => {
    const cwd = project("forged");
    const { consent } = proposeGoal({ cwd, planArg: "plans/p.md" });
    const file = join(cwd, ".litclaude", "goal", "consent.json");
    writeFileSync(file, JSON.stringify({ ...consent, goal_option: { ...consent.goal_option, condition: "the user typed anything" } }));
    hook(cwd, "yes goal");
    assert.equal(existsSync(intentPath(cwd)), false);
  });

  it("a plan that already opts in keeps its one question, and `yes goal` answers it like yes", () => {
    const cwd = project("opted", `goal: native\n${PLAN}`);
    const { line, consent } = proposeGoal({ cwd, planArg: "plans/p.md" });
    assert.equal(line, GOAL_STATUS.asked(consent.condition));
    const context = hook(cwd, "yes goal");
    assert.match(context, started);
    assert.ok(context.includes(GOAL_STATUS.armed(consent.id)));
  });
});
