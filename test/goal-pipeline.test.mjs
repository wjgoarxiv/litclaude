import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GOAL_STATUS, STALL_CHECKS, compileCondition, conditionHash, consentAnswer, falsify, goalStateFromTranscript, goalStep, lintCondition, parseDoneWhen } from "../plugins/litclaude/lib/goal-pipeline.mjs";
import { proposeGoal, proposeLoopGoal } from "../plugins/litclaude/scripts/goal-propose.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const hookPath = join(plugin, "bin", "litclaude-hook.js");
const temp = mkdtempSync(join(tmpdir(), "litclaude-goal-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const PLAN = "# P\n\n## Todos\n\n- [ ] 1. Make the test pass\n\n## Done when\n\ncheck: `npm test`\n";
const project = (name, { plan = PLAN, testExit = 1 } = {}) => {
  const cwd = join(temp, name);
  mkdirSync(join(cwd, "plans"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name, scripts: { test: `node -e "process.exit(${testExit})"` } }));
  writeFileSync(join(cwd, "plans", "p.md"), plan);
  return cwd;
};
const hook = (cwd, prompt, sessionId = "s-goal") => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: join(temp, "home"), LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd, session_id: sessionId, prompt_id: `p-${prompt.length}-${Math.floor(performance.now())}` }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const goalFiles = (cwd) => (existsSync(join(cwd, ".litclaude", "goal")) ? readdirSync(join(cwd, ".litclaude", "goal")).sort() : []);
const status = (condition, met, extra = {}) => JSON.stringify({ type: "attachment", attachment: { type: "goal_status", met, condition, ...extra } });

describe("goal compiler and lint", () => {
  it("builds the fixed condition from the Done when block", () => {
    const done = parseDoneWhen(PLAN);
    assert.deepEqual(done, { ok: true, check: "npm test" });
    const built = compileCondition({ plan: "plans/p.md", check: done.check });
    assert.match(built.condition, /^Every row in plans\/p\.md is ticked and `npm test` exits 0 \[lit:[0-9a-f]{8}\]$/u);
    assert.equal(parseDoneWhen("# P\n").ok, false);
    assert.equal(parseDoneWhen("## Done when\n\nwhen it works\n").ok, false);
  });

  it("rejects judgment words, push or publish as success, unknown commands and over 500 characters", () => {
    for (const check of ["npm test && it works", "node --test looks good", "잘 동작하면", "git push origin main", "npm publish", "curl http://x", "rm -rf build"]) {
      assert.equal(lintCondition(`x ${check}`, check).ok, false, check);
    }
    assert.equal(lintCondition("x", "npm test").ok, true);
    assert.equal(lintCondition("x", "node --test test/a.test.mjs").ok, true);
    assert.equal(compileCondition({ plan: "plans/p.md", check: `node ${"a".repeat(480)}.mjs` }).ok, false);
  });

  it("the falsifier refuses a goal that is already true, hangs or cannot run", () => {
    const ticked = PLAN.replace("- [ ]", "- [x]");
    const run = (status, extra = {}) => () => ({ status, ...extra });
    assert.equal(falsify({ cwd: temp, plan: "plans/p.md", planText: ticked, check: "npm test", run: run(0) }).ok, false);
    assert.match(falsify({ cwd: temp, plan: "plans/p.md", planText: ticked, check: "npm test", run: run(0) }).reason, /already true/u);
    assert.match(falsify({ cwd: temp, plan: "plans/p.md", planText: PLAN, check: "npm test", run: run(null, { error: { code: "ETIMEDOUT" } }) }).reason, /did not finish/u);
    assert.match(falsify({ cwd: temp, plan: "plans/p.md", planText: PLAN, check: "npm test", run: run(null, { error: { code: "ENOENT" } }) }).reason, /cannot run/u);
    assert.equal(falsify({ cwd: temp, plan: "plans/p.md", planText: PLAN, check: "npm test", run: run(1) }).ok, true);
    assert.equal(falsify({ cwd: temp, plan: "plans/p.md", planText: PLAN, check: "npm test", run: run(0) }).ok, true, "open rows keep it false");
    // A check script the plan creates is missing until the work runs (host run 2026-11-18).
    const planned = `${PLAN}\n- [ ] 2. Add scripts/check-bye.sh\n`;
    assert.equal(falsify({ cwd: temp, plan: "plans/p.md", planText: planned, check: "bash scripts/check-bye.sh", run: run(127) }).ok, true);
    assert.match(falsify({ cwd: temp, plan: "plans/p.md", planText: PLAN, check: "bash scripts/typo.sh", run: run(127) }).reason, /cannot run/u, "a script the plan never names is a typo");
  });
});

describe("goal-propose CLI", () => {
  it("prints the consent question and records it, running the real check once", () => {
    const cwd = project("propose");
    const { line, consent } = proposeGoal({ cwd, planArg: "plans/p.md" });
    assert.equal(line, GOAL_STATUS.asked(consent.condition));
    assert.match(line, /^Approve plan, start work and set goal: \/goal Every row in plans\/p\.md is ticked and `npm test` exits 0 \[lit:[0-9a-f]{8}\]\? \(yes \/ edit \/ no\)$/u);
    assert.equal(consent.hash, conditionHash(consent.condition));
    assert.deepEqual(goalFiles(cwd), ["consent.json"]);
  });

  it("without a goal it still asks to start the work, naming why no goal was set (R1)", () => {
    for (const [name, opts, reason] of [
      ["no-block", { plan: "# P\n\n- [ ] 1. a\n" }, /no `## Done when` block/u],
      ["true", { plan: PLAN.replace("- [ ]", "- [x]"), testExit: 0 }, /already true/u],
      ["never", { plan: `goal: never\n${PLAN}` }, /goal: never/u],
    ]) {
      const cwd = project(name, opts);
      const { line, consent } = proposeGoal({ cwd, planArg: "plans/p.md" });
      const [ask, why] = line.split("\n");
      assert.equal(ask, GOAL_STATUS.startOnly, name);
      assert.match(why, /^No goal set: /u, name);
      assert.match(why, reason, name);
      assert.equal(consent.condition, null, name);
      assert.deepEqual(goalFiles(cwd), ["consent.json"], name);
    }
    assert.match(proposeGoal({ cwd: temp, planArg: "../etc/passwd" }).line, /^No goal set: give the plan/u);
  });
});

describe("consent: only an exact yes arms the goal", () => {
  it("yes writes the intent bound to the condition hash; the reply is the armed line", () => {
    const cwd = project("yes");
    const { consent } = proposeGoal({ cwd, planArg: "plans/p.md" });
    const context = hook(cwd, "yes");
    assert.ok(context.includes(GOAL_STATUS.armed(consent.id)));
    assert.match(context, /Do not run \/goal yourself/u);
    assert.match(context, /LitClaude started start-work work-p-[0-9a-f]{8} on p\.md/u, "yes also starts the work (R1)");
    const intent = JSON.parse(readFileSync(join(cwd, ".litclaude", "goal", "intent.json"), "utf8"));
    assert.equal(intent.hash, consent.hash);
    assert.equal(intent.condition, consent.condition);
    assert.equal(intent.sessionId, "s-goal");
    assert.deepEqual(goalFiles(cwd), ["intent.json"]);
  });

  it("no, edit, silence (any other prompt) and a stale or tampered question arm nothing", () => {
    for (const answer of ["no", "edit", "yes please", "y", "go", "ok"]) {
      const cwd = project(`a-${answer.replace(/\W/gu, "")}`);
      proposeGoal({ cwd, planArg: "plans/p.md" });
      hook(cwd, answer);
      assert.equal(existsSync(join(cwd, ".litclaude", "goal", "intent.json")), false, answer);
      assert.equal(existsSync(join(cwd, ".litclaude", "goal", "consent.json")), false, `${answer} ends the question`);
    }
    const stale = project("stale");
    proposeGoal({ cwd: stale, planArg: "plans/p.md", now: Date.now() - 31 * 60 * 1000 });
    hook(stale, "yes");
    assert.equal(existsSync(join(stale, ".litclaude", "goal", "intent.json")), false, "older than 30 minutes");
    const tampered = project("tampered");
    const { consent } = proposeGoal({ cwd: tampered, planArg: "plans/p.md" });
    writeFileSync(join(tampered, ".litclaude", "goal", "consent.json"), JSON.stringify({ ...consent, condition: `${consent.condition} and push` }));
    hook(tampered, "yes");
    assert.equal(existsSync(join(tampered, ".litclaude", "goal", "intent.json")), false, "hash no longer matches");
    assert.equal(consentAnswer(" YES "), "yes");
    assert.equal(consentAnswer("yes."), null);
  });

  it("lit cancel asks the mod to clear only when LitClaude owns a goal", () => {
    const cwd = project("cancel");
    hook(cwd, "lit cancel");
    assert.equal(existsSync(join(cwd, ".litclaude", "goal", "clear.json")), false, "no owner, nothing to clear");
    mkdirSync(join(cwd, ".litclaude", "goal"), { recursive: true });
    writeFileSync(join(cwd, ".litclaude", "goal", "owner.json"), JSON.stringify({ condition: "c [lit:00000000]", sessionId: "s-goal" }));
    const context = hook(cwd, "lit cancel");
    assert.match(context, /LitClaude also clears the goal it set/u);
    assert.equal(JSON.parse(readFileSync(join(cwd, ".litclaude", "goal", "clear.json"), "utf8")).why, "lit cancel");
  });
});

describe("R1: yes approves the plan, starts the work and arms the goal in one step", () => {
  const started = /LitClaude started start-work/u;
  it("yes starts the same start-work a typed /litclaude:start-work starts, with the same grants", () => {
    const viaYes = project("r1-yes");
    proposeGoal({ cwd: viaYes, planArg: "plans/p.md" });
    const yes = hook(viaYes, "yes");
    const typed = hook(project("r1-typed"), "/litclaude:start-work plans/p.md");
    const grants = (text) => /Its grants cover ([^.]+)\./u.exec(text)?.[1];
    assert.match(yes, started);
    assert.ok(grants(yes) && grants(yes) === grants(typed), "the grant line matches the typed start");
    assert.ok(existsSync(join(viaYes, ".litclaude", "goal", "intent.json")));
  });

  it("edit asks again and no, silence, a stale question or a read-only route start nothing", () => {
    for (const [name, answer, opts] of [["r1-edit", "edit"], ["r1-no", "no"], ["r1-silence", "thanks"], ["r1-adhd", "lit adhd"], ["r1-stale", "yes", { now: Date.now() - 31 * 60 * 1000 }]]) {
      const cwd = project(name);
      proposeGoal({ cwd, planArg: "plans/p.md", ...opts });
      const context = hook(cwd, answer);
      assert.doesNotMatch(context ?? "", started, name);
      assert.equal(existsSync(join(cwd, ".litclaude", "goal", "intent.json")), false, name);
      assert.equal(existsSync(join(cwd, ".litclaude", "boulder.json")), false, `${name} leaves no start-work state`);
      if (answer === "edit") assert.match(context, /goal-propose\.mjs/u, "edit re-asks");
    }
  });

  it("a refused start arms no goal and says why in one fixed line", () => {
    const gone = project("r1-gone");
    proposeGoal({ cwd: gone, planArg: "plans/p.md" });
    rmSync(join(gone, "plans", "p.md"));
    const context = hook(gone, "yes");
    assert.doesNotMatch(context, started);
    assert.match(context, /No goal set: start-work did not start \(/u);
    assert.equal(existsSync(join(gone, ".litclaude", "goal", "intent.json")), false);

    const busy = project("r1-busy");
    writeFileSync(join(busy, "plans", "q.md"), "# Q\n\n- [ ] 1. other\n");
    assert.match(hook(busy, "/litclaude:start-work plans/q.md", "s-other"), started);
    proposeGoal({ cwd: busy, planArg: "plans/p.md" });
    const refused = hook(busy, "yes");
    assert.doesNotMatch(refused, started);
    assert.match(refused, /`No goal set: start-work did not start \([^`]*(?:already running|different plan)[^`]*\)`/u);
    assert.equal(existsSync(join(busy, ".litclaude", "goal", "intent.json")), false);
  });

  it("every start path records the exact plan on the session's frame (R4)", () => {
    const frameOf = (cwd, sessionId) => readFileSync(join(cwd, ".litclaude", "workflow-stack", `${sessionId}.json`), "utf8");
    const viaYes = project("r4-yes");
    proposeGoal({ cwd: viaYes, planArg: "plans/p.md" });
    hook(viaYes, "yes", "s-r4a");
    assert.match(frameOf(viaYes, "s-r4a"), /"plan":"plans\/p\.md"/u, "yes");
    const natural = project("r4-natural");
    assert.match(hook(natural, "lit start work", "s-r4b"), started);
    assert.match(frameOf(natural, "s-r4b"), /"plan":"plans\/p\.md"/u, "lit start work with one open plan");
  });

  it("with no goal possible, yes still starts the work and arms nothing", () => {
    const cwd = project("r1-start-only", { plan: "# P\n\n- [ ] 1. a\n" });
    proposeGoal({ cwd, planArg: "plans/p.md" });
    const context = hook(cwd, "yes");
    assert.match(context, started);
    assert.equal(existsSync(join(cwd, ".litclaude", "goal", "intent.json")), false);
    assert.deepEqual(goalFiles(cwd), []);
  });
});

describe("lit-loop: one yes lets the mod set /goal without a plan", () => {
  const loopProject = (name, testExit = 1) => {
    const cwd = join(temp, name);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name, scripts: { test: `node -e "process.exit(${testExit})"` } }));
    return cwd;
  };

  it("asks once with a condition built from the check and the objective, and records the question", () => {
    const cwd = loopProject("loop-ask");
    const { line, consent } = proposeLoopGoal({ cwd, check: "npm test", objective: "fix the login redirect" });
    assert.match(line, /^Set goal for this lit-loop: \/goal `npm test` exits 0 and this is done: fix the login redirect \[lit:[0-9a-f]{8}\]\? \(yes \/ no\)$/u);
    assert.equal(consent.kind, "loop");
    assert.equal(consent.plan, null);
    assert.equal(consent.hash, conditionHash(consent.condition));
    assert.deepEqual(goalFiles(cwd), ["consent.json"]);
    const secret = proposeLoopGoal({ cwd: loopProject("loop-secret"), check: "npm test", objective: "rotate api_key=abc123secret now" });
    assert.match(secret.line, /\[REDACTED\]/u);
    assert.doesNotMatch(JSON.stringify(secret.consent), /abc123secret/u);
  });

  it("asks nothing when the check already passes, is not allowlisted, or the objective is empty", () => {
    for (const [name, args, exit, reason] of [
      ["loop-green", { check: "npm test", objective: "add a flag" }, 0, /already passes/u],
      ["loop-push", { check: "git push", objective: "ship it" }, 1, /not an allowlisted test command|push, publish or release/u],
      ["loop-empty", { check: "npm test", objective: "   " }, 1, /name what the loop should finish/u],
    ]) {
      const cwd = loopProject(name, exit);
      const { line, consent } = proposeLoopGoal({ cwd, ...args });
      assert.match(line, /^No goal set: /u, name);
      assert.match(line, reason, name);
      assert.equal(consent, undefined, name);
      assert.deepEqual(goalFiles(cwd), [], name);
    }
  });

  it("a finished goal does not stop the next lit-loop from asking", () => {
    const cwd = loopProject("loop-after-met");
    mkdirSync(join(cwd, ".litclaude", "goal"), { recursive: true });
    writeFileSync(join(cwd, ".litclaude", "goal", "owner.json"), JSON.stringify({ version: 1, id: "0badc0de", condition: "old [lit:0badc0de]", sessionId: "s-old", closed: "met" }));
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: join(temp, "home"), LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "lit loop fix the next bug", cwd, session_id: "s-new", prompt_id: "p-after-met" }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).systemMessage, /Set goal for this lit-loop: .*fix the next bug/u);
  });

  it("the CLI takes --loop --check <cmd> and the rest as the objective", () => {
    const cwd = loopProject("loop-cli");
    const result = spawnSync(process.execPath, [join(plugin, "scripts", "goal-propose.mjs"), "--loop", "--check", "npm test", "fix", "the", "redirect"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\/goal `npm test` exits 0 and this is done: fix the redirect \[lit:/u);
  });

  it("a lit-loop prompt shows the question itself when the project has a test command", () => {
    const cwd = loopProject("loop-hook");
    const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: join(temp, "home"), LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "lit loop fix the login redirect", cwd, session_id: "s-loop-hook", prompt_id: "p-loop-hook" }),
    });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.match(out.systemMessage, /Set goal for this lit-loop: \/goal `npm test` exits 0 and this is done: fix the login redirect \[lit:[0-9a-f]{8}\]\? \(yes \/ no\)/u);
    assert.match(out.hookSpecificOutput.additionalContext, /LitClaude has shown the user this goal question/u);
    assert.deepEqual(goalFiles(cwd), ["consent.json"]);
    assert.ok(hook(cwd, "yes", "s-loop-hook").includes("LitClaude goal armed"));
    assert.deepEqual(goalFiles(cwd), ["intent.json"]);

    const bare = join(temp, "loop-no-check");
    mkdirSync(bare, { recursive: true });
    const context = hook(bare, "lit loop fix the login redirect", "s-loop-bare");
    assert.match(context, /Native goal: LitClaude can set \/goal for this run/u);
    assert.deepEqual(goalFiles(bare), [], "no test command, no question");
  });

  it("yes arms the goal for the mod and starts no start-work; no arms nothing", () => {
    const cwd = loopProject("loop-yes");
    const { consent } = proposeLoopGoal({ cwd, check: "npm test", objective: "fix the login redirect" });
    const context = hook(cwd, "yes");
    assert.ok(context.includes(GOAL_STATUS.armed(consent.id)), context);
    assert.match(context, /Do not run \/goal yourself/u);
    assert.doesNotMatch(context, /started start-work/u);
    assert.equal(existsSync(join(cwd, ".litclaude", "boulder.json")), false, "no start-work run");
    const intent = JSON.parse(readFileSync(join(cwd, ".litclaude", "goal", "intent.json"), "utf8"));
    assert.equal(intent.condition, consent.condition);
    assert.equal(intent.plan, null);
    assert.deepEqual(goalFiles(cwd), ["intent.json"]);

    const other = loopProject("loop-no");
    proposeLoopGoal({ cwd: other, check: "npm test", objective: "fix it" });
    const no = hook(other, "no");
    assert.match(no, /No goal set: you said no/u);
    assert.deepEqual(goalFiles(other), []);
  });
});

describe("the mod's goal step", () => {
  const cond = "Every row in plans/p.md is ticked and `npm test` exits 0 [lit:1234abcd]";
  const intent = { condition: cond, id: "1234abcd", sessionId: "s1" };
  const owner = { condition: cond, id: "1234abcd", sessionId: "s1", confirmed: true };

  it("sets an armed goal once, and never over a goal the user set by hand", () => {
    assert.deepEqual(goalStep({ intent, transcript: "", sessionId: "s1" }), { do: "set", condition: cond, status: GOAL_STATUS.set("1234abcd") });
    assert.equal(goalStep({ intent: { ...intent, consumedAt: "x" }, transcript: "", sessionId: "s1" }).do, "none");
    assert.equal(goalStep({ intent, transcript: "", sessionId: "other" }).do, "none", "another session's intent");
    const yours = status("ship the docs", false, { sentinel: true });
    assert.deepEqual(goalStep({ intent, transcript: yours, sessionId: "s1" }), { do: "skip-yours", status: GOAL_STATUS.yours });
  });

  it("confirms from the transcript, or says how to paste it", () => {
    assert.equal(goalStep({ owner: { ...owner, confirmed: false }, transcript: status(cond, false, { sentinel: true }), sessionId: "s1" }).do, "confirm");
    assert.deepEqual(goalStep({ owner: { ...owner, confirmed: false }, transcript: "", sessionId: "s1" }), { do: "close", why: "not confirmed", status: `Goal not confirmed. Paste: /goal ${cond}` });
  });

  it("met closes it; cancel, BLOCKED and a stall clear only lit's own goal", () => {
    const running = status(cond, false);
    assert.deepEqual(goalStep({ owner, transcript: `${running}\n${status(cond, true)}`, sessionId: "s1" }), { do: "close", why: "met", status: GOAL_STATUS.met("1234abcd") });
    assert.deepEqual(goalStep({ owner, clear: { why: "lit cancel" }, transcript: running, sessionId: "s1" }).do, "clear");
    const blocked = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "BLOCKED: the test server is down" }] } });
    assert.equal(goalStep({ owner, transcript: `${running}\n${blocked}`, sessionId: "s1" }).why, "BLOCKED");
    assert.equal(goalStep({ owner, transcript: Array.from({ length: STALL_CHECKS }, () => running).join("\n"), sessionId: "s1" }).why, "stalled");
    assert.equal(goalStep({ owner, transcript: running, sessionId: "s1" }).do, "none");
    assert.equal(goalStep({ owner, clear: { why: "lit cancel" }, transcript: status("my own goal", false), sessionId: "s1" }).do, "close", "the user replaced it: lit closes its record and clears nothing");
    assert.equal(goalStep({ owner: { ...owner, closed: "met" }, clear: { why: "x" }, transcript: running, sessionId: "s1" }).do, "none");
  });

  it("reads goal_status records only, and the newest wins", () => {
    const state = goalStateFromTranscript([status("a", false), "not json", status("a", true), status("b", false)].join("\n"));
    assert.equal(state.active, "b");
    assert.ok(state.met.has("a"));
  });
});

describe("goal surfaces", () => {
  it("read-only skills carry goal: never in their frontmatter", () => {
    for (const id of ["lit-adhd", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm", "lit-comprehend", "lit-handoff"]) {
      const head = readFileSync(join(plugin, "skills", id, "SKILL.md"), "utf8").split("\n---\n")[0];
      assert.match(head, /^goal: never$/mu, id);
    }
  });

  it("no shipped prompt tells the model to call get_goal or create_goal when available", () => {
    for (const dir of ["skills", "commands"]) {
      for (const entry of readdirSync(join(plugin, dir), { recursive: true }).filter((name) => String(name).endsWith(".md"))) {
        assert.doesNotMatch(readFileSync(join(plugin, dir, entry), "utf8"), /get_goal|create_goal|update_goal/u, `${dir}/${entry}`);
      }
    }
  });

  it("lit-plan asks the consent line and new plans carry a Done when block", () => {
    const skill = readFileSync(join(plugin, "skills", "lit-plan", "SKILL.md"), "utf8");
    assert.match(skill, /scripts\/goal-propose\.mjs/u);
    assert.match(skill, /ProposeGoal[^\n]*\n?[^\n]*ask_user=true/u);
    assert.match(readFileSync(join(plugin, "scripts", "scaffold-plan.mjs"), "utf8"), /## Done when\n\ncheck: \\`npm test\\`/u);
  });
});
