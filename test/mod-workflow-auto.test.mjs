import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";
import { REVIEW_LANES, buildWorkflow, reviewLaneOf } from "../plugins/litclaude/lib/mod/workflow.mjs";
import { workflowStagePath } from "../plugins/litclaude/lib/workflow-stage.mjs";

// The map has to move on its own: in a real session the model never ran `litclaude-ai
// workflow-stage`, and the card stayed at the stage the skill entered. These cases drive
// LitClaude's real hook process and its mod through a whole request and never run that command.

const hookPath = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));
const cliPath = fileURLToPath(new URL("../bin/litclaude-ai.js", import.meta.url));
const SESSION = "auto-session";

const runHook = (project, event, input, env) => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: project,
    encoding: "utf8",
    env,
    input: JSON.stringify({ cwd: project, session_id: SESSION, prompt_id: "prompt-1", hook_event_name: event, ...input }),
  });
  assert.equal(result.status, 0, `${event}: ${result.stderr}`);
  return result;
};

const startWork = (project, args, env) => {
  const result = spawnSync(process.execPath, [cliPath, "start-work", ...args, "--root", project, "--json"], { cwd: project, encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

// Claude Code's mods host as far as the card needs it, over the real project directory.
const diskHost = async (project) => {
  const hooks = [];
  register((event, matcher, hook) => {
    hooks.push(typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook });
    return { catch: () => undefined };
  }, { glyphs: "basic", motion: "off" });
  const timers = [];
  const stat = async (path) => {
    try {
      const info = statSync(path);
      return { kind: info.isFile() ? "file" : "dir", size: info.size, isLink: lstatSync(path).isSymbolicLink(), mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  };
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: ({ children }) => ({ kind: "text", text: children }),
  };
  const $ = {
    fs: {
      stat,
      read: async (path) => readFileSync(path, "utf8"),
      list: async (path) => readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
        isLink: entry.isSymbolicLink(),
        mtimeMs: statSync(join(path, entry.name)).mtimeMs,
      })),
    },
    session: { cwd: async () => project, id: async () => SESSION, usage: async () => null },
    agent: { list: async () => [] },
    clock: { now: async () => Date.now(), after: (ms, fn) => timers.push(fn), every: () => () => undefined },
    env: { get: async (name) => (name === "LITCLAUDE_HUD_STATE_ROOT" ? join(project, ".hud") : undefined) },
    settings: { read: async () => null },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, notify: async () => ({ isSent: false }), resolve: () => elements },
  };
  const fire = async (event, e, matcher = {}, core = undefined) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const run = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => run(index + 1, next)) : core);
    return run(0, e);
  };
  const flush = async () => {
    while (timers.length) await timers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const flatten = (node) => (node.kind === "text" ? [node] : node.children.flatMap(flatten));
  return {
    fire,
    // One tool call as the host runs it: the PreToolUse hook, the mod's tool.call, the PostToolUse hook.
    tool: async (env, toolName, toolInput, { response, skill } = {}) => {
      runHook(project, "pre-tool-use", { tool_name: toolName, tool_input: toolInput }, env);
      await fire("tool.call", { tool: toolName, ...(skill ? { skill } : {}) });
      if (["Write", "Edit", "MultiEdit", "Bash", "Agent"].includes(toolName)) {
        runHook(project, "post-tool-use", { tool_name: toolName, tool_input: toolInput, tool_response: response ?? {} }, env);
      }
      await fire("tool.call", { tool: "Read" });
      await flush();
    },
    // The map row and the detail line, without the card's border.
    rows: async () => {
      // The host's two-second poll, run now: a context measure asks the card for a quick refresh.
      // A second flush lets a completion moment the refresh started play out.
      await fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
      await flush();
      await flush();
      const drawn = await fire("ui.render", { surface: "terminal", props: { bodyColumns: 110 } }, { component: "AbovePrompt" });
      const lines = drawn.children.map((row) => flatten(row).map(({ text }) => text).join(""));
      const inside = (line) => line.slice(1, -1).trim().replace(/\s+/gu, " ");
      // The live step on the detail line's right (`- thinking · 0:00`) is another test's subject.
      return { map: inside(lines[1]), detail: inside(lines[2]).replace(/ [-\\|/] \w+ · \d+:\d\d$/u, ""), top: lines[0] };
    },
  };
};

const PLAN = (checked) => `# Demo\n\n## TODOs\n\n- [${checked >= 1 ? "x" : " "}] 1. Write the parser\n- [${checked >= 2 ? "x" : " "}] 2. Wire the command\n`;

test("the map advances through lit-plan, start-work and review-work from the hooks alone, with no workflow-stage call", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-map-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});

    // lit-plan enters the plan stage, and saving the plan file finishes it.
    await host.tool(env, "Skill", { skill: "litclaude:lit-plan" }, { skill: "litclaude:lit-plan" });
    let rows = await host.rows();
    assert.match(rows.map, /^interview ✓ ━━ plan ━━ work · ── review · ── done ·$/u, "plan is the current stage");
    mkdirSync(join(project, "plans"));
    writeFileSync(join(project, "plans", "demo.md"), PLAN(0));
    await host.tool(env, "Write", { file_path: join(project, "plans", "demo.md"), content: PLAN(0) });
    rows = await host.rows();
    assert.match(rows.map, /^interview ✓ ━━ plan ✓ ━━ work ━━ review · ── done ·$/u, "the saved plan carries a check");
    assert.match(rows.detail, /^└ plan saved/u);

    // start-work: the work's tasks count up as each one is checked in the plan.
    await host.tool(env, "Skill", { skill: "litclaude:start-work" }, { skill: "litclaude:start-work" });
    const started = startWork(project, ["init", "--plan", "plans/demo.md", "--work-id", "w1", "--session-id", SESSION, "--grant", `read:${project}`, "--grant", `write:${project}`, "--idempotency-key", "init-1"], env);
    assert.equal(started.ok, true);
    rows = await host.rows();
    assert.match(rows.map, /^interview ✓ ━━ plan ✓ ━━ work 0\/2 ━━ review · ── done ·$/u);
    for (const checked of [1, 2]) {
      writeFileSync(join(project, "plans", "demo.md"), PLAN(checked));
      await host.tool(env, "Edit", { file_path: join(project, "plans", "demo.md"), old_string: "- [ ]", new_string: "- [x]" });
      rows = await host.rows();
      assert.match(rows.map, new RegExp(`^interview ✓ ━━ plan ✓ ━━ work ${checked}/2 ━━ review · ── done ·$`, "u"), `task ${checked} checked`);
      assert.match(rows.detail, new RegExp(`^└ task ${checked}/2`, "u"));
    }
    const status = startWork(project, ["status"], env);
    startWork(project, ["complete", "--work-id", "w1", "--session-id", SESSION, "--expected-revision", String(status.state.revision), "--idempotency-key", "complete-1"], env);
    rows = await host.rows();
    assert.match(rows.map, /^interview ✓ ━━ plan ✓ ━━ work ✓ ━━ review ━━ done ·$/u, "completed work moves on to review");

    // review-work: each reviewer's lane turns running when it is spawned and takes its verdict.
    await host.tool(env, "Skill", { skill: "litclaude:review-work" }, { skill: "litclaude:review-work" });
    rows = await host.rows();
    assert.equal(rows.detail, "└ goal · quality · security · qa · context ·");
    const lanePrompt = (title) => `Review lane: ${title}.\nGOAL: ship the parser\nReturn this fixed schema:\nverdict: PASS | FAIL\n`;
    await host.tool(env, "Agent", { description: "goal review", prompt: lanePrompt("scope/diff verification"), subagent_type: "general-purpose" }, {
      response: { content: [{ type: "text", text: "verdict: PASS\nconfidence: HIGH\nfindings: []" }] },
    });
    rows = await host.rows();
    assert.equal(rows.detail, "└ goal ✓ quality · security · qa · context ·", "a foreground reviewer's report lands on its lane");
    runHook(project, "pre-tool-use", { tool_name: "Agent", tool_input: { description: "security review", prompt: lanePrompt("security/provenance"), run_in_background: true } }, env);
    rows = await host.rows();
    assert.equal(rows.detail, "└ goal ✓ quality · security ● qa · context ·", "a reviewer at work shows as running");
    const transcript = join(project, "agent-security.jsonl");
    writeFileSync(transcript, `${JSON.stringify({ type: "user", message: { role: "user", content: lanePrompt("security/provenance") } })}\n`);
    runHook(project, "subagent-stop", { agent_id: "agent-sec", agent_type: "general-purpose", agent_transcript_path: transcript, last_assistant_message: "verdict: FAIL\nfindings:\n  - [FAIL] token in log", stop_hook_active: false }, env);
    rows = await host.rows();
    assert.equal(rows.detail, "└ goal ✓ quality · security ✗ qa · context ·", "a background reviewer's verdict arrives at SubagentStop");
    assert.match(rows.map, /━━ review ━━ done ·$/u);

    for (const title of ["package/payload and code quality", "security/provenance", "tests/evidence execution", "real-surface/docs readiness"]) {
      await host.tool(env, "Agent", { description: "lane", prompt: lanePrompt(title) }, { response: { content: [{ type: "text", text: "verdict: PASS" }] } });
    }
    rows = await host.rows();
    assert.match(rows.map, /^interview ✓ ━━ plan ✓ ━━ work ✓ ━━ review ✓ ━━ done ✓$/u, "five passing lanes finish the review");

    const record = JSON.parse(readFileSync(workflowStagePath(project), "utf8"));
    assert.equal(record.sessionId, SESSION);
    assert.deepEqual(Object.keys(record).sort(), ["at", "family", "sessionId", "skill", "stage", "verdicts"], "the record keeps stages and verdicts, never a path, command or prompt");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a lit-loop criterion steps from PIN to RECORD on the tests it writes, passes, runs and records", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-loop-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "test"));
    mkdirSync(join(project, "src"));
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});
    await host.tool(env, "Skill", { skill: "lit-loop" }, { skill: "litclaude:lit-loop" });
    const top = async () => (await host.rows()).top;
    assert.match(await top(), /PIN ● ─╮$/u);
    await host.tool(env, "Write", { file_path: join(project, "test", "parser.test.mjs"), content: "x" });
    assert.match(await top(), /RED ● ─╮$/u, "a test written is RED");
    await host.tool(env, "Bash", { command: "npm test" });
    assert.match(await top(), /RED ● ─╮$/u, "a run before the code changes keeps RED");
    await host.tool(env, "Edit", { file_path: join(project, "src", "parser.mjs"), old_string: "a", new_string: "b" });
    assert.match(await top(), /GREEN ● ─╮$/u, "the code that answers it is GREEN");
    await host.tool(env, "Bash", { command: "node --test test/parser.test.mjs" });
    assert.match(await top(), /VERIFY ● ─╮$/u, "the test run verifies");
    await host.tool(env, "Bash", { command: "litclaude-ai litgoal record-evidence --criterion C1 --status pass" });
    assert.match(await top(), /RECORD ● ─╮$/u, "the litgoal evidence records the criterion");
    await host.tool(env, "Write", { file_path: join(project, "test", "second.test.mjs"), content: "x" });
    assert.match(await top(), /RED ● ─╮$/u, "the next criterion's test starts over at RED");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// Models often write the test and the code with the shell (`cat > test/x.test.js <<'EOF'`), which
// no Write or Edit reports. The map has to move on those writes too, read from the command's write
// targets that exist as files afterwards, and on a failing test run while the criterion is pinned.
test("a lit-loop criterion moves when its test and code are written through the shell", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-shell-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "test"));
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});
    await host.tool(env, "Skill", { skill: "lit-loop" }, { skill: "litclaude:lit-loop" });
    const top = async () => (await host.rows()).top;
    assert.match(await top(), /PIN ● ─╮$/u);

    // A heredoc body full of `=>` and `>` is data, not a write target.
    await host.tool(env, "Bash", { command: "node -e \"console.log(1 > 0)\" > /dev/null; echo ok >&2" }, { response: { stdout: "ok" } });
    assert.match(await top(), /PIN ● ─╮$/u, "writes to /dev/null and stderr move nothing");
    await host.tool(env, "Bash", { command: "npm test" }, { response: { stdout: "ok 1 - greets\n# pass 1\n# fail 0" } });
    assert.match(await top(), /PIN ● ─╮$/u, "a passing run before any test is written keeps PIN");

    const testBody = "const run = (...args) => args;\ntest(\"x\", () => assert.ok(run() > 0));\n";
    writeFileSync(join(project, "test", "greet.test.js"), testBody);
    await host.tool(env, "Bash", { command: `cat > test/greet.test.js <<'EOF'\n${testBody}EOF\nnpm test 2>&1 | tail -5` }, { response: { stdout: "not ok 2 - shouts\n# pass 1\n# fail 1" } });
    assert.match(await top(), /RED ● ─╮$/u, "a test written through a heredoc is RED");

    writeFileSync(join(project, "run.log"), "# fail 1\n");
    await host.tool(env, "Bash", { command: "npm test > run.log 2>&1" }, { response: { stdout: "" } });
    assert.match(await top(), /RED ● ─╮$/u, "a log the run writes is not the fix");

    writeFileSync(join(project, "greet.js"), "module.exports = 1;\n");
    await host.tool(env, "Bash", { command: "sed -i '' 's/1/2/' greet.js" }, { response: { stdout: "" } });
    assert.match(await top(), /GREEN ● ─╮$/u, "the code changed with sed -i is GREEN");
    await host.tool(env, "Bash", { command: "npm test 2>&1 | grep -E '^# (pass|fail)'" }, { response: { stdout: "# pass 2\n# fail 0" } });
    assert.match(await top(), /VERIFY ● ─╮$/u, "the next test run verifies");

    // The next criterion: a test appended with tee, then code and run in one command.
    await host.tool(env, "Bash", { command: "litclaude-ai litgoal record-evidence --criterion C1 --status pass" });
    assert.match(await top(), /RECORD ● ─╮$/u);
    await host.tool(env, "Bash", { command: "printf 'x' | tee -a test/greet.test.js" }, { response: { stdout: "x" } });
    assert.match(await top(), /RED ● ─╮$/u, "a test appended with tee is RED");
    await host.tool(env, "Bash", { command: "cat >> greet.js <<'EOF'\nmodule.exports.x = 2;\nEOF\nnpm test" }, { response: { stdout: "# pass 3\n# fail 0" } });
    assert.match(await top(), /VERIFY ● ─╮$/u, "the code written and the passing run in one command land on VERIFY");

    const record = JSON.parse(readFileSync(workflowStagePath(project), "utf8"));
    assert.deepEqual(Object.keys(record).sort(), ["at", "family", "sessionId", "skill", "stage", "verdicts"], "the record keeps the stage, never a path or a command");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a failing test run while the criterion is pinned turns the map RED", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-fail-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});
    await host.tool(env, "Skill", { skill: "lit-loop" }, { skill: "litclaude:lit-loop" });
    const top = async () => (await host.rows()).top;
    await host.tool(env, "Bash", { command: "npx vitest run" }, { response: { stdout: " Tests  1 failed | 3 passed (4)" } });
    assert.match(await top(), /RED ● ─╮$/u, "a failing run is RED");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// A command that exits non-zero, like a bare failing `npm test`, reaches the host's PostToolUseFailure
// instead of PostToolUse; its writes and its failing run move the loop the same way.
test("a failing shell command still moves the lit-loop map through PostToolUseFailure", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-failure-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "test"));
    const hooks = JSON.parse(readFileSync(fileURLToPath(new URL("../plugins/litclaude/hooks/hooks.json", import.meta.url)), "utf8")).hooks;
    assert.match(hooks.PostToolUseFailure?.[0]?.matcher ?? "", /Bash/u, "hooks.json enrolls PostToolUseFailure for Bash");
    assert.match(hooks.PostToolUseFailure[0].hooks[0].command, /litclaude-hook\.js" post-tool-use-failure$/u);
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});
    await host.tool(env, "Skill", { skill: "lit-loop" }, { skill: "litclaude:lit-loop" });
    const top = async () => (await host.rows()).top;
    const failed = (command, error) => runHook(project, "post-tool-use-failure", { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command }, tool_use_id: "t1", error }, env);

    failed("npm test", "Exit code 1\nnot ok 1 - shouts\n# fail 1");
    assert.match(await top(), /RED ● ─╮$/u, "a bare failing run while pinned is RED");

    writeFileSync(join(project, "greet.js"), "module.exports = 1;\n");
    await host.tool(env, "Bash", { command: "cat > greet.js <<'EOF'\nmodule.exports = 1;\nEOF" }, { response: { stdout: "" } });
    assert.match(await top(), /GREEN ● ─╮$/u);
    failed("npm test", "Exit code 1\nnot ok 2 - shouts\n# fail 1");
    assert.match(await top(), /GREEN ● ─╮$/u, "a failing run does not verify");
    failed("npm test", "interrupted");
    assert.match(await top(), /GREEN ● ─╮$/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a failing command's own test write moves a pinned criterion to RED", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-failure-write-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "test"));
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});
    await host.tool(env, "Skill", { skill: "lit-loop" }, { skill: "litclaude:lit-loop" });
    writeFileSync(join(project, "test", "greet.test.js"), "x\n");
    runHook(project, "post-tool-use-failure", { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "cat > test/greet.test.js <<'EOF'\nx\nEOF\nnode --test" }, tool_use_id: "t2", error: "Exit code 1" }, env);
    assert.match((await host.rows()).top, /RED ● ─╮$/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("the review lanes are the card's five, read from review-work's own lane titles and older names", () => {
  assert.deepEqual(REVIEW_LANES.map(({ id }) => id), ["goal", "quality", "security", "qa", "context"]);
  const titles = {
    "scope/diff verification": "goal",
    "tests/evidence execution": "qa",
    "package/payload and code quality": "quality",
    "security/provenance": "security",
    "real-surface/docs readiness": "context",
    scope: "goal",
    tests: "qa",
    payload: "quality",
    surface: "context",
    "a haiku about cats": null,
  };
  for (const [title, lane] of Object.entries(titles)) assert.equal(reviewLaneOf(title), lane, title);
  const skill = readFileSync(new URL("../plugins/litclaude/skills/review-work/SKILL.md", import.meta.url), "utf8");
  for (const title of Object.keys(titles).slice(0, 5)) assert.ok(skill.includes(`Review lane: ${title}.`), `review-work still titles a lane "${title}"`);
});

test("the card follows the main loop: a skill a subagent loads lights no chip and keeps the title", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-sub-")));
  try {
    mkdirSync(join(project, ".git"));
    const host = await diskHost(project);
    await host.fire("session.start", {});
    await host.fire("turn.start", {});
    await host.fire("tool.call", { tool: "Skill", skill: "litclaude:review-work" });
    await host.fire("tool.call", { tool: "Agent" });
    // A reviewer's own Skill call names its agent; its preloaded skills expand with no owner named.
    await host.fire("tool.call", { tool: "Skill", skill: "litclaude:rules", agentId: "agent-lane" });
    await host.fire("skill.prompt", { skill: "litclaude:visual-qa", text: "body" });
    const { top } = await host.rows();
    assert.match(top, /LIT {1,2}· review-work/u);
    const drawn = await host.fire("ui.render", { surface: "terminal", props: { bodyColumns: 110 } }, { component: "AbovePrompt" });
    const text = JSON.stringify(drawn);
    assert.doesNotMatch(text, /"rules"|visual-qa/u, "the reviewer's skills get no chip");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("the next task reads without the plan's Markdown marks", () => {
  const snapshot = { ignition: { discipline: "start-work", at: 1 }, work: { id: "w", status: "active", total: 2, checked: 1, nextTask: "**Task 2: GREEN, implement `shout`**", lanes: [], lastEvent: null }, completedWorkIds: [], goal: null, workflow: null };
  assert.equal(buildWorkflow({ snapshot, now: 2 }).next, "Task 2: GREEN, implement shout");
});

test("a typed /litclaude:review-work starts a fresh review record, so a second review is drawn from its own lanes", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-typed-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud") };
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, ".litclaude"));
    writeFileSync(workflowStagePath(project), JSON.stringify({ sessionId: SESSION, skill: "review-work", family: "main", stage: "review", verdicts: { goal: "pass", qa: "pass", quality: "pass", security: "pass", context: "pass" }, at: new Date().toISOString() }));
    runHook(project, "user-prompt-submit", { prompt: "/litclaude:review-work Review the change once more." }, env);
    const record = JSON.parse(readFileSync(workflowStagePath(project), "utf8"));
    assert.deepEqual({ family: record.family, stage: record.stage, verdicts: record.verdicts }, { family: "main", stage: "review", verdicts: {} });
    runHook(project, "user-prompt-submit", { prompt: "/litclaude:start-work plans/x.md" }, env);
    assert.throws(() => readFileSync(workflowStagePath(project)), /ENOENT/u, "a typed skill the state files follow clears it");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// A litgoal goal finished in an earlier request stays `complete` in goals.json. A skill started
// after it writes a newer stage record, and the card follows the record, not the old finish.
const finishedGoal = (completedAt) => ({
  version: 1,
  objective: "An earlier request",
  status: "complete",
  autoloop: false,
  criteria: [{ id: "c1", description: "done", status: "pass", evidence: [] }],
  blockers: [],
  steering: [],
  checkpoints: [{ status: "complete", note: "", createdAt: completedAt }],
  createdAt: new Date(Date.parse(completedAt) - 60_000).toISOString(),
  updatedAt: completedAt,
});

const stageAndGoal = async (record, goal) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-auto-goal-")));
  mkdirSync(join(project, ".git"));
  mkdirSync(join(project, ".litclaude", "litgoal"), { recursive: true });
  writeFileSync(join(project, ".litclaude", "litgoal", "goals.json"), JSON.stringify(goal));
  writeFileSync(workflowStagePath(project), JSON.stringify({ sessionId: SESSION, ...record }));
  const host = await diskHost(project);
  await host.fire("session.start", {});
  return { project, rows: await host.rows() };
};

test("a goal finished before the current stage record does not draw the map as done", async () => {
  const now = Date.now();
  const { project, rows } = await stageAndGoal(
    { skill: "lit-crucible", family: "main", stage: "plan", at: new Date(now).toISOString() },
    finishedGoal(new Date(now - 60 * 60 * 1000).toISOString()),
  );
  try {
    assert.match(rows.map, /^interview ✓ ━━ plan ━━ work · ── review · ── done ·$/u, "plan is the current stage");
    assert.doesNotMatch(rows.detail, /complete/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("an old finished goal shared by every session does not draw a new lit-loop as done", async () => {
  const now = Date.now();
  const { project, rows } = await stageAndGoal(
    { skill: "lit-loop", family: "loop", stage: "VERIFY", at: new Date(now).toISOString() },
    finishedGoal(new Date(now - 24 * 24 * 60 * 60 * 1000).toISOString()),
  );
  try {
    assert.match(rows.map, /PIN ✓ ━━ RED ✓ ━━ GREEN ✓ ━━ +VERIFY +━━ REVIEW · ── RECORD ·/u, "VERIFY is the current stage");
    assert.doesNotMatch(rows.map, /RECORD ✓/u);
    assert.doesNotMatch(rows.detail, /complete/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a goal finished after the current stage record still draws the map as done", async () => {
  const now = Date.now();
  const { project, rows } = await stageAndGoal(
    { skill: "litgoal", family: "main", stage: "work", at: new Date(now - 60 * 60 * 1000).toISOString() },
    finishedGoal(new Date(now).toISOString()),
  );
  try {
    assert.match(rows.map, /^interview ✓ ━━ plan ✓ ━━ work ✓ ━━ review ✓ ━━ done ✓$/u, "the finish shows done");
    assert.match(rows.detail, /complete/u);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
