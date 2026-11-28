import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateSkillPlanStop, recordSkillPlanTurn, requiredPlanSkills, turnSkillActivity } from "../plugins/litclaude/lib/skill-plan-gate.mjs";
import { buildSkillPlan } from "../plugins/litclaude/lib/skill-plan.mjs";
import { editPayload, receiptHarness } from "./helpers/receipt-harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const scratch = mkdtempSync(join(tmpdir(), "litclaude-skill-plan-gate-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
const project = () => {
  const dir = join(scratch, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const at = (ms) => new Date(ms).toISOString();
const assistant = (ms, content) => JSON.stringify({ type: "assistant", timestamp: at(ms), message: { role: "assistant", content } });
const transcript = (dir, lines) => {
  const path = join(dir, "t.jsonl");
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
};
const planOf = (companions, installed = ["decks", "figures"]) => buildSkillPlan({ primary: "lit-pptx", companions, installed: new Set(installed), loopBase: true });

describe("skill-plan turn-end check", () => {
  it("requires every companion the model can load, never the primary or a missing extension", () => {
    assert.deepEqual(requiredPlanSkills(planOf(["lit-scientific-visualization"])), [{ id: "lit-pptx", plugin: "decks" }, { id: "lit-scientific-visualization", plugin: "figures" }]);
    assert.deepEqual(requiredPlanSkills(planOf(["lit-scientific-visualization"], ["figures"])), [{ id: "lit-scientific-visualization", plugin: "figures" }]);
    assert.deepEqual(requiredPlanSkills(null), []);
  });

  it("reads Skill calls and SKIP lines of this turn only", () => {
    const text = [
      assistant(900, [{ type: "tool_use", name: "Skill", input: { skill: "decks:lit-pptx" } }]),
      assistant(1100, [{ type: "tool_use", name: "Skill", input: { skill: "figures:lit-scientific-visualization" } }, { type: "text", text: "Plan.\nSKIP lit-docx: the user wants slides only" }]),
      "not json",
      JSON.stringify({ type: "user", timestamp: at(1200), message: { content: "SKIP refactor: typed by the user" } }),
    ].join("\n");
    const { loaded, skipped } = turnSkillActivity(text, 1000);
    assert.deepEqual([...loaded], ["figures:lit-scientific-visualization"]);
    assert.deepEqual([...skipped], ["lit-docx"]);
  });

  it("reads skip lines written as list items, in bold or with a dash", () => {
    const text = assistant(1100, [{ type: "text", text: "Plan:\n- SKIP lit-pptx: no deck\n1. SKIP lit-docx: n/a\nSKIP **lit-xlsx**: n/a\n* `SKIP` refactor — not needed\nSKIP debugging：없음" }]);
    assert.deepEqual([...turnSkillActivity(text, 1000).skipped].sort(), ["debugging", "lit-docx", "lit-pptx", "lit-xlsx", "refactor"]);
  });

  it("arms only under a lit-loop plan, passes a turn that ends on a question, and expires", () => {
    const planned = buildSkillPlan({ primary: "lit-plan", companions: ["lit-pptx"], installed: new Set(["decks"]), loopBase: true });
    assert.deepEqual(requiredPlanSkills(planned), []);
    const cwd = project();
    recordSkillPlanTurn(cwd, { sessionId: "q1", plan: planOf(["lit-scientific-visualization"]), now: 1000 });
    const asking = transcript(cwd, [assistant(1100, [{ type: "text", text: "어떤 데이터로 그릴까요?" }])]);
    assert.deepEqual(evaluateSkillPlanStop({ cwd, sessionId: "q1", transcriptPath: asking, now: 2000 }), { action: "allow", why: "asked" });
    assert.equal(evaluateSkillPlanStop({ cwd, sessionId: "q1", transcriptPath: transcript(cwd, []), now: 2000 }).action, "block");
    recordSkillPlanTurn(cwd, { sessionId: "q2", plan: planOf(["lit-scientific-visualization"]), now: 1000 });
    assert.equal(evaluateSkillPlanStop({ cwd, sessionId: "q2", transcriptPath: transcript(cwd, []), now: 1000 + 3 * 60 * 60 * 1000 }).why, "expired");
  });

  it("blocks once naming a planned skill that was neither loaded nor skipped, then lets the stop pass", () => {
    const cwd = project();
    recordSkillPlanTurn(cwd, { sessionId: "s1", plan: planOf(["lit-scientific-visualization"]), now: 1000 });
    const path = transcript(cwd, [assistant(1500, [{ type: "tool_use", name: "Skill", input: { skill: "figures:lit-scientific-visualization" } }])]);
    const first = evaluateSkillPlanStop({ cwd, sessionId: "s1", transcriptPath: path, now: 2000 });
    assert.equal(first.action, "block");
    assert.deepEqual(first.missing, ["decks:lit-pptx"]);
    assert.match(first.reason, /SKIP <skill-id>: <reason>/u);
    assert.equal(evaluateSkillPlanStop({ cwd, sessionId: "s1", transcriptPath: path, now: 2000 }).action, "allow");
  });

  it("passes when each planned skill was loaded (plugin, litclaude stub or bare id) or skipped", () => {
    const cwd = project();
    recordSkillPlanTurn(cwd, { sessionId: "s2", plan: planOf(["lit-scientific-visualization", "refactor"]), now: 1000 });
    const path = transcript(cwd, [
      assistant(1100, [{ type: "tool_use", name: "Skill", input: { skill: "litclaude:lit-pptx" } }]),
      assistant(1200, [{ type: "tool_use", name: "Skill", input: { skill: "refactor" } }, { type: "text", text: "**SKIP lit-scientific-visualization**: no data was given" }]),
    ]);
    assert.deepEqual(evaluateSkillPlanStop({ cwd, sessionId: "s2", transcriptPath: path, now: 2000 }), { action: "allow", why: "settled" });
  });

  it("allows with no plan, no transcript, an unsafe session id, or a cleared turn", () => {
    const cwd = project();
    assert.equal(evaluateSkillPlanStop({ cwd, sessionId: "s3", transcriptPath: "/nope" }).action, "allow");
    recordSkillPlanTurn(cwd, { sessionId: "s3", plan: planOf(["lit-scientific-visualization"]), now: 1000 });
    assert.equal(evaluateSkillPlanStop({ cwd, sessionId: "s3", transcriptPath: undefined }).action, "allow");
    recordSkillPlanTurn(cwd, { sessionId: "s3", plan: null });
    assert.equal(evaluateSkillPlanStop({ cwd, sessionId: "s3", transcriptPath: transcript(cwd, []) }).action, "allow");
    assert.equal(recordSkillPlanTurn(cwd, { sessionId: "../x", plan: planOf(["lit-scientific-visualization"]) }), null);
  });

  it("the real hook arms the turn at the prompt and blocks the stop once, never under stop_hook_active", () => {
    const cwd = project();
    const config = join(scratch, `claude-${n}`);
    mkdirSync(join(config, "plugins"), { recursive: true });
    const env = { PATH: process.env.PATH, HOME: join(scratch, "home"), LITCLAUDE_HOME: join(scratch, "lit-home"), CLAUDE_CONFIG_DIR: config, LITCLAUDE_HUD_STATE_ROOT: join(scratch, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", NO_COLOR: "1" };
    const hook = (event, input) => spawnSync(process.execPath, [hookPath, event], { cwd, env, encoding: "utf8", input: JSON.stringify({ session_id: "hook-s", cwd, ...input }) });
    const prompt = hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt_id: "p1", prompt: "리팩터링 좀 해주고 왜 테스트가 멈추는지 원인 찾아줘 lit" });
    assert.equal(prompt.status, 0, prompt.stderr);
    assert.match(prompt.stdout, /is required, not a suggestion/u);
    assert.match(prompt.stdout, /SKIP <skill-id>: <reason>/u);
    const path = transcript(cwd, [assistant(Date.now() + 5, [{ type: "tool_use", name: "Skill", input: { skill: "litclaude:refactor" } }])]);
    const active = hook("stop", { hook_event_name: "Stop", transcript_path: path, stop_hook_active: true });
    assert.doesNotMatch(active.stdout, /skill plan/iu);
    const stop = hook("stop", { hook_event_name: "Stop", transcript_path: path, stop_hook_active: false });
    assert.match(stop.stdout, /"decision":"block"/u);
    assert.match(stop.stdout, /debugging was planned/u);
    const again = hook("stop", { hook_event_name: "Stop", transcript_path: path, stop_hook_active: false });
    assert.doesNotMatch(again.stdout, /skill plan/iu);
  });

  it("the receipt gate blocks first when both want the stop; the skill plan keeps its one reminder for later", () => {
    // Given an enforce session whose lit prompt planned two skills, edited code and ran no check
    const h = receiptHarness();
    mkdirSync(h.env.LITCLAUDE_HOME, { recursive: true });
    writeFileSync(join(h.env.LITCLAUDE_HOME, "config.json"), `${JSON.stringify({ receiptGate: "enforce" })}\n`);
    const prompted = h.run("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "리팩터링 좀 해주고 왜 테스트가 멈추는지 원인 찾아줘 lit" });
    assert.equal(prompted.status, 0, prompted.stderr);
    h.run("post-tool-use", editPayload(join(h.project, "src", "a.js")));
    const path = transcript(h.project, []);
    // When the turn stops
    const first = JSON.parse(h.run("stop", { hook_event_name: "Stop", transcript_path: path, stop_hook_active: false }).stdout.trim());
    // Then the receipt gate's reason comes out, and the skill-plan record has not spent its block
    assert.equal(first.decision, "block");
    assert.match(first.reason, /npm test/u);
    assert.doesNotMatch(first.reason, /skill plan/iu);
    assert.equal(JSON.parse(readFileSync(join(h.dir, "skill-plan-turn.json"), "utf8")).blockCount, 0);
  });

  it("a shadow receipt warning goes out with the skill-plan block, since the next stop skips both", () => {
    // Given the default shadow mode, a lit prompt that planned two skills, an edit and no check
    const h = receiptHarness();
    h.run("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt: "리팩터링 좀 해주고 왜 테스트가 멈추는지 원인 찾아줘 lit" });
    h.run("post-tool-use", editPayload(join(h.project, "src", "a.js")));
    // When the turn stops with neither skill loaded
    const out = JSON.parse(h.run("stop", { hook_event_name: "Stop", transcript_path: transcript(h.project, []), stop_hook_active: false }).stdout.trim());
    // Then one output carries the block and the warning
    assert.equal(out.decision, "block");
    assert.match(out.reason, /LitClaude skill plan: /u);
    assert.match(out.systemMessage, /no passing check since/u);
  });
});
