// plans/litclaude-1042.md todo 3 (A2): a lit-plan turn that saved its plan leaves this session's
// next-step record, so a one-word `go` within 30 minutes starts that plan.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { nextStepPath } from "../plugins/litclaude/lib/rewind/next-step.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const hookPath = join(plugin, "bin", "litclaude-hook.js");
const SID = "session-plan-go";

let count = 0;
const runHook = (event, input) => {
  count += 1;
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: input.cwd,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: "" },
    input: JSON.stringify({ prompt_id: `prompt-go-${count}`, ...input }),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const prompt = (cwd, text, sessionId = SID) => runHook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", session_id: sessionId, prompt: text, cwd });
const stop = (cwd, sessionId = SID) => runHook("stop", { hook_event_name: "Stop", session_id: sessionId, stop_hook_active: false, cwd });
const context = (parsed) => parsed?.hookSpecificOutput?.additionalContext ?? "";

const withProject = (fn) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-lit-plan-go-")));
  writeFileSync(join(cwd, "package.json"), "{}\n");
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};
const savePlan = (cwd, checked = false) => {
  mkdirSync(join(cwd, "plans"), { recursive: true });
  const mark = checked ? "x" : " ";
  writeFileSync(join(cwd, "plans", "demo.md"), `# Demo\n\n## Todos\n\n- [${mark}] 1. write it\n- [${mark}] 2. check it\n`);
};
const record = (cwd, sessionId = SID) => {
  const path = nextStepPath(cwd, sessionId);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
};

describe("lit-plan ends with a one-word go", () => {
  it("a saved plan leaves a start-plan record and go starts it", () => withProject((cwd) => {
    prompt(cwd, "lit-plan: add a README badge");
    savePlan(cwd);
    assert.equal(stop(cwd), null, "the gate allows the stop");
    const step = record(cwd);
    assert.equal(step?.kind, "start-plan");
    assert.deepEqual(step.target, { plan: "plans/demo.md" });
    assert.match(context(prompt(cwd, "go")), /LitClaude started start-work work-demo-[0-9a-f]{8} on demo\.md/u);
  }));

  it("another session's go, a 31-minute-old record and an all-checked plan start nothing", () => withProject((cwd) => {
    prompt(cwd, "lit-plan: add a README badge");
    savePlan(cwd);
    stop(cwd);
    assert.doesNotMatch(context(prompt(cwd, "go", "session-someone-else")), /started start-work/u);
    assert.equal(record(cwd, "session-someone-else"), null, "no record for the other session");

    const path = nextStepPath(cwd, SID);
    writeFileSync(path, `${JSON.stringify({ ...record(cwd), at: new Date(Date.now() - 31 * 60_000).toISOString() })}\n`);
    assert.doesNotMatch(context(prompt(cwd, "go")), /started start-work/u, "31 minutes old");
  }));

  it("a plan with every row checked writes no record", () => withProject((cwd) => {
    prompt(cwd, "lit-plan: add a README badge");
    savePlan(cwd, true);
    stop(cwd);
    assert.equal(record(cwd), null);
  }));

  it("a stop outside a lit-plan turn writes no record", () => withProject((cwd) => {
    savePlan(cwd);
    stop(cwd);
    assert.equal(record(cwd), null);
  }));

  it("the closing line offers go and the full command on every lit-plan surface", () => {
    const go = /type `go` within 30 minutes, or `\/litclaude:start-work plans\/<slug>\.md`/u;
    assert.match(readFileSync(join(plugin, "commands", "lit-plan.md"), "utf8"), go, "commands/lit-plan.md");
    assert.match(readFileSync(join(plugin, "skills", "lit-plan", "SKILL.md"), "utf8"), go, "skills/lit-plan/SKILL.md");
    assert.match(readFileSync(hookPath, "utf8"), go, "the lit-plan mode contract");
  });
});
