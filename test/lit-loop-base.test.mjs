// A bare-lit route that does one part of the work runs under lit-loop. These run the real prompt hook and
// check what the turn is told: the route's own context when the plan kept it, none when the prompt refused
// or only mentioned it, the full context again on a later turn, and the HUD record's base route.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { carrySkillPlanTurn, evaluateSkillPlanStop, recordSkillPlanTurn, skillPlanTurnPath } from "../plugins/litclaude/lib/skill-plan-gate.mjs";
import { buildSkillPlan } from "../plugins/litclaude/lib/skill-plan.mjs";
import { receiptHarness as baseHarness, SID } from "./helpers/receipt-harness.mjs";

// Each harness keeps its own activation records: the suite runner shares one root across files and tests.
const receiptHarness = () => {
  const h = baseHarness();
  h.env.LITCLAUDE_ACTIVATION_STATE_ROOT = join(h.temp, "activation");
  return h;
};

const prompt = (h, text) => {
  const result = h.run("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: text });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  return { context: parsed.hookSpecificOutput.additionalContext.split("\n\n## Project Instructions\n", 1)[0], message: parsed.systemMessage ?? "" };
};
const ignition = (h) => JSON.parse(readFileSync(join(h.env.LITCLAUDE_HUD_STATE_ROOT, `${SID}.json`), "utf8"));

describe("a route under the lit-loop base", () => {
  it("keeps its own context and names itself in the base line", () => {
    const { context, message } = prompt(receiptHarness(), "lit make a deck about the Q3 roadmap");
    assert.match(message.replace(/\x1b\[[\d;]*m/gu, ""), /LIT IGNITED · lit-loop/u);
    assert.match(context, /LIT IGNITED · lit-loop\*\*/u);
    assert.doesNotMatch(context, /LIT IGNITED · lit-pptx/u);
    assert.match(context, /This request matched lit-pptx;/u);
    assert.match(context, /name="lit-pptx"/u);
    assert.match(context, /Skill plan: 1 lit-loop \(primary\) → 2 /u);
    assert.doesNotMatch(context, /goal-propose\.mjs/u, "a deliverable under the loop is offered no /goal");
  });

  it("brings no deck context when the prompt refuses the deck, and runs the skill it asked for", () => {
    const { context } = prompt(receiptHarness(), "lit PPT 말고 보고서로 써줘");
    assert.match(context, /This request matched lit-docx;/u);
    assert.match(context, /name="lit-docx"/u);
    assert.doesNotMatch(context, /name="lit-pptx"|Skill\(lit-pptx\)|a \.pptx deck/u);
    assert.match(context, /Left out: lit-pptx \(named but not asked for\)/u);
  });

  it("runs as plain lit-loop when the prompt only mentions an old deck", () => {
    const { context } = prompt(receiptHarness(), "lit 예전에 만든 발표자료 기준으로 정리해줘");
    assert.match(context, /LIT IGNITED · lit-loop\*\*/u);
    assert.match(context, /durable, evidence-driven execution loop/u);
    assert.doesNotMatch(context, /This request matched|name="lit-pptx"|a \.pptx deck/u);
    assert.match(context, /Left out: lit-pptx \(named but not asked for\)/u);
  });

  it("sends a deliverable's context in full on a later turn of the same session", () => {
    const h = receiptHarness();
    prompt(h, "lit fix the failing test in src/a.js");
    const { context } = prompt(h, "lit make slides about the Q3 roadmap");
    assert.match(context, /This request matched lit-pptx;/u);
    assert.match(context, /name="lit-pptx"/u);
  });

  it("a review turn does not mark lit-loop as already sent: the next fix turn gets the lit-loop contract", () => {
    const h = receiptHarness();
    const review = prompt(h, "lit review this diff");
    assert.match(review.context, /This request matched review-work;/u);
    assert.match(review.context, /Read-only: edit no file/u);
    const fix = prompt(h, "lit fix the failing test in src/a.js");
    assert.match(fix.context, /durable, evidence-driven execution loop/u);
  });

  it("a repeated route gets its short note with the lit-loop probe line, never its own", () => {
    for (const [first, second, route] of [["lit review this diff", "lit review the other diff", "review-work"], ["lit debug the flaky upload test", "lit debug the flaky download test", "debugging"]]) {
      const h = receiptHarness();
      prompt(h, first);
      const { context, message } = prompt(h, second);
      assert.match(context, new RegExp(`LitClaude ${route} is already active`, "u"), second);
      assert.match(context, /LIT IGNITED · lit-loop\*\*/u, second);
      assert.doesNotMatch(context, new RegExp(`LIT IGNITED · ${route}`, "u"), second);
      assert.match(message.replace(/\x1b\[[\d;]*m/gu, ""), /LIT IGNITED · lit-loop/u, second);
    }
  });

  it("arms the interface-probe gate as the route alone did: an interface ask yes, a debugging ask no", () => {
    const armed = (text) => {
      const h = receiptHarness();
      prompt(h, text);
      return existsSync(join(h.dir, "interface-probe-turn.json"));
    };
    assert.equal(armed("lit redesign the dashboard UI"), true);
    assert.equal(armed("lit fix the failing test in src/a.js"), true, "plain lit-loop arms it, as before");
    assert.equal(armed("lit debug why the upload button crashes"), false);
    assert.equal(armed("lit make a deck about the Q3 roadmap"), false);
  });

  it("records the matched route as the HUD base, also when lit-crucible is planned ahead of it", () => {
    const h = receiptHarness();
    prompt(h, "lit redesign the dashboard UI");
    const record = ignition(h);
    assert.equal(record.discipline, "lit-loop");
    assert.equal(record.base, "frontend-ui-ux");
    assert.deepEqual(record.plan.slice(0, 2), ["lit-loop", "lit-crucible"]);
    prompt(h, "lit fix the failing test and refactor the parser");
    assert.equal("base" in ignition(h), false, "a plain lit-loop turn has no base");
  });
});

describe("the skill-plan record across prompts", () => {
  const plan = buildSkillPlan({ primary: "lit-pptx", companions: [], installed: new Set(["decks"]), loopBase: true });

  it("survives one plain follow-up only after a turn that ended on a question", () => {
    const h = receiptHarness();
    recordSkillPlanTurn(h.project, { sessionId: SID, plan, now: Date.now() });
    assert.equal(carrySkillPlanTurn(h.project, SID), null, "no question was asked: the plan is over");
    assert.equal(existsSync(skillPlanTurnPath(h.project, SID)), false);

    recordSkillPlanTurn(h.project, { sessionId: SID, plan, now: Date.now() - 1000 });
    const asking = join(h.project, "t.jsonl");
    writeFileSync(asking, `${JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "어떤 내용으로 만들까요?" }] } })}\n`);
    const stop = evaluateSkillPlanStop({ cwd: h.project, sessionId: SID, transcriptPath: asking });
    assert.equal(stop.why, "asked");
    assert.equal(carrySkillPlanTurn(h.project, SID).asked, false, "kept for the answer, pass spent");
    assert.equal(carrySkillPlanTurn(h.project, SID), null, "a second plain prompt ends it");
  });

  it("the real hook clears it on a plain prompt and on a prompt the hook answers itself", () => {
    const h = receiptHarness();
    prompt(h, "lit refactor the parser and find out why the import step hangs");
    assert.equal(existsSync(skillPlanTurnPath(h.project, SID)), true, "armed");
    h.run("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "never mind" });
    assert.equal(existsSync(skillPlanTurnPath(h.project, SID)), false, "a plain prompt after a finished turn");
    prompt(h, "lit refactor the parser and find out why the import step hangs");
    h.run("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "handoff" });
    assert.equal(existsSync(skillPlanTurnPath(h.project, SID)), false, "a hook-owned prompt");
  });
});
