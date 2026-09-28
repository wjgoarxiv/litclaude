import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const hookSource = readFileSync(hookPath, "utf8");
const turnStatePath = (cwd) => join(cwd, ".litclaude", "lit-plan", "turn.json");

const BLOCK_REASON = "lit-plan must persist plans/<slug>.md (run scaffold-plan.mjs) before finishing";

const runHook = (eventName, input) =>
  spawnSync(process.execPath, [hookPath, eventName], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
    input: JSON.stringify(input),
  });

const makeWorkspace = () => {
  const cwd = mkdtempSync(join(tmpdir(), "litclaude-lit-plan-persistence-"));
  writeFileSync(join(cwd, "package.json"), "{}\n");
  return cwd;
};

const submitLitPlanPrompt = (cwd, sessionId = "session-plan-1", prompt = "lit-plan: add a README badge") => {
  const result = runHook("user-prompt-submit", {
    hook_event_name: "UserPromptSubmit",
    session_id: sessionId,
    prompt_id: "prompt-1",
    prompt,
    cwd,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const stop = (cwd, sessionId = "session-plan-1", stopHookActive = false) => {
  const result = runHook("stop", {
    hook_event_name: "Stop",
    session_id: sessionId,
    stop_hook_active: stopHookActive,
    cwd,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};

const checkboxPlan = (slug) => [
  `# ${slug}`,
  "",
  "## Todos",
  "",
  "- [ ] 1. write the badge markdown",
  "- [ ] 2. verify it renders",
  "",
].join("\n");

describe("lit-plan persistence contract", () => {
  it("tells the model to write plans/<slug>.md through scaffold-plan.mjs before the turn ends", () => {
    const cwd = makeWorkspace();
    try {
      const payload = submitLitPlanPrompt(cwd);
      const context = payload.hookSpecificOutput.additionalContext;
      assert.match(context, /Mode contract: lit-plan is planning-only/u);
      assert.match(context, /plans\/<slug>\.md/u);
      assert.match(context, /scripts\/scaffold-plan\.mjs/u);
      assert.match(context, /before (?:the turn ends|ending the turn)/u);
      assert.equal(existsSync(turnStatePath(cwd)), true, "the lit-plan turn must be recorded for the Stop hook");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the skill prose aligned with the Stop gate: the plan file is written before the turn ends", () => {
    const skillSource = readFileSync(
      join(root, "plugins", "litclaude", "skills", "lit-plan", "SKILL.md"),
      "utf8",
    );
    assert.doesNotMatch(skillSource, /after approval, adds plans\//u, "prose must not sequence the plans/ write behind approval");
    assert.match(skillSource, /scaffold-plan\.mjs/u);
    assert.match(skillSource, /before the turn ends/u, "prose must state the write happens before the turn ends");
  });

  it("surfaces the durable-plan notice on the lit-plan route when a valid plan already exists", () => {
    assert.match(
      hookSource,
      /discipline === "lit-plan"[\s\S]{0,400}formatDurablePlanNotice/u,
      "litworkContext must run formatDurablePlanNotice for lit-plan",
    );
  });
});

describe("lit-plan Stop-hook persistence gate", () => {
  it("blocks the turn when nothing under plans/ was written after the prompt", () => {
    const cwd = makeWorkspace();
    try {
      submitLitPlanPrompt(cwd);
      const output = stop(cwd);
      assert.ok(output, "Stop must emit a decision");
      assert.equal(output.decision, "block");
      assert.ok(output.reason.startsWith(BLOCK_REASON), output.reason);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks when the only plan file predates the prompt", () => {
    const cwd = makeWorkspace();
    try {
      mkdirSync(join(cwd, "plans"), { recursive: true });
      const stale = join(cwd, "plans", "stale.md");
      writeFileSync(stale, checkboxPlan("stale"));
      utimesSync(stale, 1_700_000_000, 1_700_000_000);
      submitLitPlanPrompt(cwd);
      const output = stop(cwd);
      assert.equal(output?.decision, "block");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks and names the checkbox rule when the new plan file has no `- [ ] N.` rows", () => {
    const cwd = makeWorkspace();
    try {
      submitLitPlanPrompt(cwd);
      mkdirSync(join(cwd, "plans"), { recursive: true });
      writeFileSync(join(cwd, "plans", "add-readme-badge.md"), "# add-readme-badge\n\nprose only\n");
      const output = stop(cwd);
      assert.equal(output?.decision, "block");
      assert.ok(output.reason.startsWith(BLOCK_REASON), output.reason);
      assert.match(output.reason, /checkbox/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("passes silently once a checkbox plan was written after the prompt", () => {
    const cwd = makeWorkspace();
    try {
      submitLitPlanPrompt(cwd);
      mkdirSync(join(cwd, "plans"), { recursive: true });
      writeFileSync(join(cwd, "plans", "add-readme-badge.md"), checkboxPlan("add-readme-badge"));
      assert.equal(stop(cwd), null);
      // A continuation after a block (stop_hook_active) passes the same way.
      assert.equal(stop(cwd, "session-plan-1", true), null);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("blocks at most twice per session, then passes with a warning", () => {
    const cwd = makeWorkspace();
    try {
      submitLitPlanPrompt(cwd);
      assert.equal(stop(cwd)?.decision, "block");
      assert.equal(stop(cwd, "session-plan-1", true)?.decision, "block");
      const third = stop(cwd, "session-plan-1", true);
      assert.notEqual(third?.decision, "block");
      assert.match(third?.systemMessage ?? "", /lit-plan/u);
      assert.match(third?.systemMessage ?? "", /plans\//u);
      // The cap is per session: a new lit-plan prompt in the same session stays capped.
      submitLitPlanPrompt(cwd);
      assert.notEqual(stop(cwd)?.decision, "block");
      // A different session starts a fresh counter.
      submitLitPlanPrompt(cwd, "session-plan-2");
      assert.equal(stop(cwd, "session-plan-2")?.decision, "block");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not gate turns that were not routed to lit-plan", () => {
    const cwd = makeWorkspace();
    try {
      submitLitPlanPrompt(cwd);
      assert.equal(stop(cwd)?.decision, "block");
      const plain = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-plan-1",
        prompt_id: "prompt-2",
        prompt: "thanks, that is all for now",
        cwd,
      });
      assert.equal(plain.status, 0, plain.stderr);
      assert.equal(stop(cwd), null);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows the stop when the turn state is unreadable (fail-safe)", () => {
    const cwd = makeWorkspace();
    try {
      submitLitPlanPrompt(cwd);
      writeFileSync(turnStatePath(cwd), "{not json");
      assert.equal(stop(cwd), null);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
