// The answer guide under each goal question: what to type and what each answer does. The question
// lines stay byte-for-byte; the guide is built from the same answer list as the question's tail.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GOAL_ANSWERS, GOAL_STATUS, goalGuideMarkdown, goalGuidePlain } from "../plugins/litclaude/lib/goal-pipeline.mjs";
import { proposeGoal, proposeLoopGoal } from "../plugins/litclaude/scripts/goal-propose.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const temp = mkdtempSync(join(tmpdir(), "litclaude-goal-guide-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const PLAN = "# P\ngoal: native\n\n## Todos\n\n- [ ] 1. Make the test pass\n\n## Done when\n\ncheck: `npm test`\n";
const project = (name, plan = PLAN) => {
  const cwd = join(temp, name);
  mkdirSync(join(cwd, "plans"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name, scripts: { test: 'node -e "process.exit(1)"' } }));
  writeFileSync(join(cwd, "plans", "p.md"), plan);
  return cwd;
};

describe("goal answer guide", () => {
  it("keeps every question line byte-for-byte, its tail built from the answer list", () => {
    assert.equal(GOAL_STATUS.asked("C"), "Approve plan, start work and set goal: /goal C? (yes / edit / no)");
    assert.equal(GOAL_STATUS.startOnly, "Approve plan and start work? (yes / no)");
    assert.equal(GOAL_STATUS.loopAsked("C"), "Set goal for this lit-loop: /goal C? (yes / no)");
    assert.deepEqual(GOAL_ANSWERS.asked.map(([word]) => word), ["yes", "edit", "no"]);
    assert.deepEqual(GOAL_ANSWERS.startOnly.map(([word]) => word), ["yes", "no"]);
    assert.deepEqual(GOAL_ANSWERS.loopAsked.map(([word]) => word), ["yes", "no"]);
  });

  it("the plain guide is aligned lines with no Markdown", () => {
    assert.equal(goalGuidePlain("loopAsked"), "  yes  → set this goal when this turn ends\n  no   → keep working without a goal\n  Type the word alone.");
    const asked = goalGuidePlain("asked");
    assert.match(asked, /^ {2}yes {3}→ /u);
    assert.match(asked, /\n {2}edit {2}→ /u);
    assert.doesNotMatch(asked, /[|*`>]/u);
  });

  it("the Markdown guide is a quoted table with one row per answer and the goal line", () => {
    const md = goalGuideMarkdown("asked", "Every row is ticked and `npm test` exits 0 [lit:0123abcd]");
    assert.equal(md.split("\n")[0], "> **▶ Answer: approve plan · start work · set goal**");
    assert.match(md, /^> Goal: `` \/goal Every row is ticked and `npm test` exits 0 \[lit:0123abcd\] ``$/mu);
    assert.match(md, /^> \| \*\*`yes`\*\* \| Starts the work now and sets this goal when this reply ends \|$/mu);
    assert.match(md, /^> \| \*\*`edit`\*\* \| Change the goal's check first \|$/mu);
    assert.match(md, /^> \| \*\*`no`\*\* \| Nothing starts \|$/mu);
    assert.match(md, /^> Type the word alone\.$/mu);
    const start = goalGuideMarkdown("startOnly");
    assert.doesNotMatch(start, /Goal:|`edit`/u);
    assert.match(start, /^> \| \*\*`yes`\*\* \| Starts the work now, with no goal \|$/mu);
  });

  it("goal-propose returns the guide beside the unchanged line, and the CLI prints both", () => {
    const cwd = project("propose");
    const asked = proposeGoal({ cwd, planArg: "plans/p.md" });
    assert.equal(asked.line, GOAL_STATUS.asked(asked.consent.condition));
    assert.equal(asked.guide, goalGuideMarkdown("asked", asked.consent.condition));
    const start = proposeGoal({ cwd: project("start", `goal: never\n${PLAN}`), planArg: "plans/p.md" });
    assert.equal(start.guide, goalGuideMarkdown("startOnly"));
    const loop = proposeLoopGoal({ cwd: project("loop"), check: "npm test", objective: "fix the redirect" });
    assert.equal(loop.guide, goalGuideMarkdown("loopAsked", loop.consent.condition));
    assert.equal(proposeGoal({ cwd, planArg: "../x.md" }).guide, undefined, "no question, no guide");
    const cli = spawnSync(process.execPath, [join(plugin, "scripts", "goal-propose.mjs"), "plans/p.md"], { cwd: project("cli"), encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^Run charter: [^\n]*\nApprove plan, start work and set goal: .*\(yes \/ edit \/ no\)\n\n> \*\*▶ Answer: /u);
  });

  it("the lit-loop hook question carries the plain guide under the line", () => {
    const cwd = project("hook");
    const result = spawnSync(process.execPath, [join(plugin, "bin", "litclaude-hook.js"), "user-prompt-submit"], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: join(temp, "home"), LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "lit loop fix the login redirect", cwd, session_id: "s-guide", prompt_id: "p-guide" }),
    });
    assert.equal(result.status, 0, result.stderr);
    const message = JSON.parse(result.stdout).systemMessage;
    assert.match(message, /\? \(yes \/ no\)\n {2}yes {2}→ set this goal when this turn ends\n {2}no {3}→ keep working without a goal\n {2}Type the word alone\.$/u);
  });

  it("lit-plan and lit-loop tell the model to render the guide under the question", () => {
    for (const file of [["skills", "lit-plan", "SKILL.md"], ["commands", "lit-plan.md"], ["skills", "lit-loop", "SKILL.md"]]) {
      const text = readFileSync(join(plugin, ...file), "utf8");
      assert.match(text, /answer guide/u, file.join("/"));
      assert.match(text, /Type the word alone/u, file.join("/"));
    }
  });
});

describe("goal answer guide in hook context", () => {
  it("the loop goal instruction asks for the guide under the line", () => {
    const hookText = readFileSync(join(plugin, "bin", "litclaude-hook.js"), "utf8");
    assert.match(hookText, /end your reply once with what it prints: the question, then its answer guide/u);
    assert.match(hookText, /ask its line again with the answer guide it prints under it/u);
  });
});
