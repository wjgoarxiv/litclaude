import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readStack, writeStack } from "../plugins/litclaude/lib/workflow-stack.mjs";
import { buildPlanSkeleton } from "../scripts/scaffold-plan.mjs";
import { SKILL_FIRST_NOTICE } from "./helpers/hook-context.mjs";

// A repeated `lit` in one session must continue the active discipline instead of restarting it:
// the first activation carries the full contract, the repeats carry a short note.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");
const cliPath = join(repoRoot, "bin", "litclaude-ai.js");
const CONTINUE_BYTES = 600;
const FULL_FLOOR_BYTES = 2_000;
const SKILL_LOAD_LINE = /Load this exact installed entrypoint/u;

let temp;
let env;
let counter = 0;

const markerCwd = () => {
  const cwd = join(temp, `proj-${counter++}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package.json"), "{}\n");
  return cwd;
};

const bareCwd = () => {
  const cwd = join(temp, `bare-${counter++}`);
  mkdirSync(cwd, { recursive: true });
  return cwd;
};

const runHook = (eventName, input) => {
  const result = spawnSync(process.execPath, [hookPath, eventName], {
    cwd: input.cwd,
    encoding: "utf8",
    env,
    input: JSON.stringify(input),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
};

const sessionId = () => `reentry-${counter++}`;
const prompt = (cwd, sid, text) => {
  const output = runHook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", cwd, session_id: sid, prompt: text, prompt_id: `p${counter++}` });
  return output.hookSpecificOutput?.additionalContext ?? "";
};
const bytes = (text) => Buffer.byteLength(text, "utf8");
// SessionStart carries the rules, so a prompt after it measures the activation alone.
const startSession = (cwd, sid) => runHook("session-start", { hook_event_name: "SessionStart", cwd, session_id: sid, source: "startup" });

const assertFull = (context, label) => {
  assert.ok(bytes(context) > FULL_FLOOR_BYTES, `${label}: ${bytes(context)} bytes is not a full activation`);
  assert.match(context, SKILL_LOAD_LINE, label);
};
const assertContinue = (context, label) => {
  assert.ok(bytes(context) <= CONTINUE_BYTES, `${label}: ${bytes(context)} bytes is over ${CONTINUE_BYTES}`);
  assert.doesNotMatch(context, SKILL_LOAD_LINE, label);
  assert.doesNotMatch(context, /before acting|\/goal|READY_TO_PASTE|Soft-confirm/u, label);
  assert.match(context, /already active/u, label);
};

const completePlan = (slug) => buildPlanSkeleton(slug, "clear").replaceAll(/<fill[^>]*>/gu, "done").replace("- [ ] 1. <title>", "- [ ] 1. first task");
const writePlan = (cwd, slug = "demo") => {
  mkdirSync(join(cwd, "plans"), { recursive: true });
  writeFileSync(join(cwd, "plans", `${slug}.md`), completePlan(slug));
};

const turnFile = (cwd) => join(cwd, ".litclaude", "lit-plan", "turn.json");
// The session's top workflow frame, read and refined the way the model's stage call would.
const topFrame = (cwd, sid) => readStack(cwd, sid).frames.at(-1);
const setTopCount = (cwd, sid, counts) => {
  const stack = readStack(cwd, sid);
  Object.assign(stack.frames.at(-1), counts);
  writeStack(cwd, sid, stack);
};
const activationFiles = () => (existsSync(env.LITCLAUDE_HUD_STATE_ROOT) ? readdirSync(env.LITCLAUDE_HUD_STATE_ROOT).filter((name) => name.endsWith(".activation.json")) : []);

before(() => {
  temp = mkdtempSync(join(tmpdir(), "litclaude-reentry-"));
  env = {
    PATH: process.env.PATH,
    HOME: join(temp, "home"),
    LITCLAUDE_HOME: join(temp, "lit-home"),
    CLAUDE_HOME: join(temp, "claude-home"),
    CLAUDE_CONFIG_DIR: join(temp, "claude-config"),
    LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud-state"),
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
  mkdirSync(env.HOME, { recursive: true });
});

after(() => rmSync(temp, { recursive: true, force: true }));

describe("lit re-entry: continue the active discipline", () => {
  it("sends the full activation once, then a short note for each repeat of the same discipline", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    assertFull(prompt(cwd, sid, "lit fix the bug"), "prompt 1");
    for (const [index, text] of ["lit add a test", "lit also cover the edge cases", "lit and update the docs", "lit one more thing"].entries()) {
      assertContinue(prompt(cwd, sid, text), `prompt ${index + 2}`);
    }
  });

  it("keeps the repeat note on the user's task and on the discipline it continues", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    prompt(cwd, sid, "lit fix the bug");
    const context = prompt(cwd, sid, "lit add a retry test");
    assert.match(context, /lit-loop/u);
    assert.match(context, /LIT IGNITED/u, "the reply mark survives the short note");
    assert.doesNotMatch(context, /Subagent delegation|Dynamic workflow:/u);
  });

  it("does not offer another /goal line, create a plan or reset the stage card on a repeat", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    const first = prompt(cwd, sid, "lit fix the bug");
    assert.match(first, /\/goal Continue until/u);
    setTopCount(cwd, sid, { n: 2, total: 5, unit: "step" });
    const second = prompt(cwd, sid, "lit add a test");
    assert.doesNotMatch(second, /\/goal/u);
    const after = topFrame(cwd, sid);
    assert.equal(after.n, 2, "the progress card keeps its place");
    assert.equal(after.total, 5);
    assert.equal(existsSync(join(cwd, "plans")), false, "a repeat creates no plan file");
  });

  it("continues after a plain prompt in between, because the activation is still in the conversation", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    prompt(cwd, sid, "lit fix the bug");
    prompt(cwd, sid, "what does that function return?");
    assertContinue(prompt(cwd, sid, "lit now the second file"), "after a plain prompt");
  });

  it("starts over after compaction, because the earlier activation left the conversation", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    prompt(cwd, sid, "lit fix the bug");
    runHook("session-start", { hook_event_name: "SessionStart", cwd, session_id: sid, source: "compact" });
    assertFull(prompt(cwd, sid, "lit add a test"), "after compaction");
  });
});

describe("lit re-entry: switch, restart and a new session", () => {
  it("gives lit plan its full activation while lit-loop is active, once, and lit-loop a short note on the way back", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    assertFull(prompt(cwd, sid, "lit fix the bug"), "lit-loop");
    const plan = prompt(cwd, sid, "lit plan the migration");
    assertFull(plan, "lit plan after lit-loop");
    assert.match(plan, /planning-only/u);
    assert.equal(existsSync(turnFile(cwd)), true, "the plan persistence gate is armed for the plan turn");
    assertContinue(prompt(cwd, sid, "lit plan the rollback too"), "second lit plan");
    assert.equal(existsSync(turnFile(cwd)), true, "a repeated lit plan keeps the gate armed");
    // lit-loop's contract is still in the conversation, so going back to it gets the short note.
    assertContinue(prompt(cwd, sid, "lit fix the bug in the parser"), "back to lit-loop");
    assert.equal(existsSync(turnFile(cwd)), false, "leaving lit plan disarms the gate");
  });

  it("restarts on lit new and lit restart with the full activation", () => {
    for (const word of ["new", "restart"]) {
      const cwd = markerCwd();
      const sid = sessionId();
      prompt(cwd, sid, "lit fix the bug");
      const context = prompt(cwd, sid, `lit ${word} refactor the parser`);
      assertFull(context, `lit ${word}`);
      assert.match(context, /\/goal Continue until/u, "a restart offers its goal line again");
      assertContinue(prompt(cwd, sid, "lit also the lexer"), `repeat after lit ${word}`);
    }
  });

  it("sends start-work in full on every prompt, because its prompt carries the write grant", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    assertFull(prompt(cwd, sid, "start-work plans/a.md"), "start-work 1");
    assertFull(prompt(cwd, sid, "start-work plans/a.md"), "start-work 2");
  });

  it("treats a different session id as a fresh start, even in the same project", () => {
    const cwd = markerCwd();
    assertFull(prompt(cwd, sessionId(), "lit fix the bug"), "session A");
    assertFull(prompt(cwd, sessionId(), "lit fix the bug"), "session B");
  });
});

describe("lit re-entry: resume and confirmation", () => {
  it("asks for confirmation only for a bare lit with no task and nothing active", () => {
    const idle = prompt(markerCwd(), sessionId(), "lit");
    assert.match(idle, /Soft-confirm/u);
    assert.doesNotMatch(prompt(markerCwd(), sessionId(), "lit fix the typo"), /Soft-confirm/u);

    const cwd = markerCwd();
    const sid = sessionId();
    prompt(cwd, sid, "lit fix the typo");
    const bareInActiveSession = prompt(cwd, sid, "lit");
    assertContinue(bareInActiveSession, "bare lit while lit-loop is active");
  });

  it("continues the active lit-plan on a bare lit or lit continue, keeping its planning-only line, the plan path and the armed gate", () => {
    for (const text of ["lit", "lit continue"]) {
      const cwd = markerCwd();
      const sid = sessionId();
      startSession(cwd, sid);
      assertFull(prompt(cwd, sid, "lit plan the migration"), "lit plan");
      writePlan(cwd);
      setTopCount(cwd, sid, { n: 1, total: 3, unit: "step" });
      const context = prompt(cwd, sid, text);
      assertContinue(context, `${text} while lit-plan is active`);
      assert.match(context, /lit-plan/u);
      assert.match(context, /planning-only/iu);
      assert.match(context, /plans\/demo\.md/u);
      assert.match(context, /LIT IGNITED · lit-plan/u);
      assert.doesNotMatch(context, /Soft-confirm|resum/iu);
      assert.equal(existsSync(turnFile(cwd)), true, "the plan gate stays armed");
      assert.equal(topFrame(cwd, sid).n, 1, "no stage reset");
      assert.deepEqual(readdirSync(join(cwd, "plans")), ["demo.md"], "no new plan");
    }
  });

  it("resumes an existing plan with open tasks on a bare lit or lit continue, without writing a new plan", () => {
    for (const text of ["lit", "lit continue"]) {
      const cwd = markerCwd();
      writePlan(cwd);
      const before = readdirSync(join(cwd, "plans"));
      const sid = sessionId();
      startSession(cwd, sid);
      const context = prompt(cwd, sid, text);
      assert.ok(bytes(context) <= CONTINUE_BYTES, `${text}: ${bytes(context)} bytes`);
      assert.match(context, /resum/iu);
      assert.match(context, /plans\/demo\.md/u);
      assert.match(context, /no new plan/iu);
      assert.doesNotMatch(context, SKILL_LOAD_LINE);
      assert.doesNotMatch(context, /Soft-confirm/u);
      assert.deepEqual(readdirSync(join(cwd, "plans")), before, "resume writes no plan");
      assert.equal(existsSync(turnFile(cwd)), false, "resume does not arm the plan gate");
    }
  });

  it("resumes the active start-work of this session on a bare lit", () => {
    const cwd = markerCwd();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    writeFileSync(join(cwd, "plans", "approved.md"), "# Approved Plan\n\n## TODOs\n\n- [ ] First task\n");
    const sid = sessionId();
    const init = spawnSync(process.execPath, [
      cliPath, "start-work", "init", "--plan", "plans/approved.md", "--work-id", "work-9", "--session-id", sid,
      "--grant", `read:${cwd}`, "--grant", `write:${cwd}`, "--idempotency-key", "init-9", "--root", cwd, "--json",
    ], { cwd, encoding: "utf8", env });
    assert.equal(init.status, 0, init.stderr);
    startSession(cwd, sid);
    const context = prompt(cwd, sid, "lit");
    assert.ok(bytes(context) <= CONTINUE_BYTES, `${bytes(context)} bytes`);
    assert.match(context, /resum/iu);
    assert.match(context, /work-9/u);
    assert.doesNotMatch(context, /Soft-confirm|SKILL\.md/u);
  });

  it("does not turn a task into a resume: lit fix X with a plan on disk is a normal activation", () => {
    const cwd = markerCwd();
    writePlan(cwd);
    assertFull(prompt(cwd, sessionId(), "lit fix the typo"), "lit fix X");
  });
});

describe("lit re-entry: unreadable state falls back to the full activation", () => {
  it("falls back when the session record is corrupt", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    prompt(cwd, sid, "lit fix the bug");
    const files = activationFiles();
    assert.equal(files.length > 0, true, "the first lit leaves a session record");
    for (const name of files) writeFileSync(join(env.LITCLAUDE_HUD_STATE_ROOT, name), "{not json");
    assertFull(prompt(cwd, sid, "lit add a test"), "corrupt record");
    assertContinue(prompt(cwd, sid, "lit add another test"), "the record is rewritten");
  });

  it("falls back when the record names no known discipline", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    prompt(cwd, sid, "lit fix the bug");
    for (const name of activationFiles()) writeFileSync(join(env.LITCLAUDE_HUD_STATE_ROOT, name), JSON.stringify({ discipline: 7, sessionId: sid }));
    assertFull(prompt(cwd, sid, "lit add a test"), "malformed record");
  });

  it("falls back, without failing the hook, when the state directory cannot be written", () => {
    const cwd = markerCwd();
    const sid = sessionId();
    const blocked = join(temp, "blocked-state");
    writeFileSync(blocked, "a file where the state directory should be\n");
    const blockedEnv = { ...env, LITCLAUDE_HUD_STATE_ROOT: blocked };
    const run = (text) => {
      const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
        cwd, encoding: "utf8", env: blockedEnv,
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd, session_id: sid, prompt: text, prompt_id: `p${counter++}` }),
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    };
    assertFull(run("lit fix the bug"), "first");
    assertFull(run("lit add a test"), "second, with nothing recorded");
  });
});

describe("prompt-time rules in a directory with no project marker", () => {
  it("sends the bundled rules once, not on every later prompt", () => {
    const cwd = bareCwd();
    const sid = sessionId();
    runHook("session-start", { hook_event_name: "SessionStart", cwd, session_id: sid, source: "startup" });
    for (const text of ["fix the typo", "rename the helper", "lit fix the bug", "fix another typo"]) {
      const context = prompt(cwd, sid, text);
      assert.doesNotMatch(context, /## Project Instructions|lit-humanizer\.md/u, text);
    }
    assert.equal(prompt(cwd, sid, "what is 2+2"), SKILL_FIRST_NOTICE);
  });
});
