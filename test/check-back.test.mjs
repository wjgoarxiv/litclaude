import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const REPORT = /<litclaude-check-back-report>\n([\s\S]*?)\n<\/litclaude-check-back-report>/u;

const fixture = (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-check-back-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = join(base, "project");
  mkdirSync(join(project, "plans"), { recursive: true });
  const env = {
    ...process.env,
    HOME: join(base, "home"),
    CLAUDE_CONFIG_DIR: join(base, "claude-config"),
    LITCLAUDE_HOME: join(base, "lit-home"),
    LITCLAUDE_HUD_STATE_ROOT: join(base, "hud"),
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
  delete env.CLAUDE_PLUGIN_OPTION_PARK_PING;
  return { base, project, env };
};

// A plan in the shape lit-plan writes (sections, row fields, one final-verifier row), so it is the
// project's newest valid plan. `rows` are column-zero row lines; each gets the fields a row needs.
const plan = (f, rows) => writeFileSync(join(f.project, "plans", "p.md"), [
  "# p — Work Plan", "", "## TL;DR (For humans)", "Two rows.", "", "## Scope", "Two files.", "",
  "## Verification strategy", "Look.", "", "## Execution strategy", "In order.", "", "## Todos",
  ...rows.flatMap((row) => [row, "  What to do / Must NOT do: it.", "  References: none.", "  Acceptance criteria: done.", "  QA scenarios: look.", "  Commit: N", ""]),
  "## Final verification wave", "- [ ] F1. Final check", "", "## Commit strategy", "None.", "", "## Success criteria", "Both rows done.", "",
].join("\n"));

const run = (f, event, input, session = "cb-s1") => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: f.project,
    encoding: "utf8",
    input: JSON.stringify({ cwd: f.project, session_id: session, ...input }),
    env: f.env,
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};

const prompt = (f, text, session, id = "p1") => run(f, "user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt_id: id, prompt: text }, session);
const checkBack = (f, session) => prompt(f, "lit check-back", session, `cb-${Math.random().toString(16).slice(2)}`);
const report = (output) => REPORT.exec(output?.hookSpecificOutput?.additionalContext ?? "")?.[1] ?? null;
const tool = (f, name, toolInput = {}, session, event = "pre-tool-use") => run(f, event, { hook_event_name: "PreToolUse", tool_name: name, tool_input: toolInput }, session);
const denied = (output) => output?.hookSpecificOutput?.permissionDecision === "deny";

describe("check-back follow-up", () => {
  it("is enrolled: a guard for the network and schedule tools, and an offer in lit-loop and litgoal", () => {
    const groups = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
    const guard = groups.find((group) => group.hooks[0].command.endsWith("check-back-guard"));
    assert.ok(guard, "PreToolUse group running check-back-guard");
    for (const name of ["WebFetch", "WebSearch", "CronCreate", "CronDelete", "ScheduleWakeup", "SendMessage", "EnterWorktree", "Workflow", "RemoteTrigger", "mcp__any_server__tool"]) {
      assert.match(name, new RegExp(guard.matcher, "u"), name);
    }
    for (const skill of ["lit-loop", "litgoal"]) {
      const text = readFileSync(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
      assert.match(text, /`lit check-back`/u, skill);
      assert.match(text, /CronCreate/u, skill);
      assert.match(text, /recurring: false/u, skill);
      assert.match(text, /yes/u, `${skill}: only on the user's yes`);
      assert.match(text, /this Claude Code session/u, `${skill}: states the session limit`);
    }
  });

  it("reports once, says nothing while nothing changed, and reports again after a change", (t) => {
    const f = fixture(t);
    plan(f, ["- [x] 1. First", "- [ ] 2. Second"]);
    const first = report(checkBack(f));
    assert.match(first, /Plan plans\/p\.md: 1 of 3 rows done\. Next: 2\. Second/u);
    assert.deepEqual(checkBack(f), { continue: false, suppressOutput: true }, "no change: no model turn");
    assert.deepEqual(checkBack(f), { continue: false, suppressOutput: true });
    plan(f, ["- [x] 1. First", "- [x] 2. Second"]);
    assert.match(report(checkBack(f)), /2 of 3 rows done\. Next: F1\. Final check/u);
  });

  it("records each report in the shown-ledger as a hash, never the text", (t) => {
    const f = fixture(t);
    plan(f, ["- [ ] 1. Secret row title"]);
    checkBack(f);
    const ledger = readFileSync(join(f.project, ".litclaude", "shown", "ledger.jsonl"), "utf8");
    assert.match(ledger, /"id":"check-back"/u);
    assert.doesNotMatch(ledger, /Secret row title/u);
  });

  it("denies every write, Bash call, agent, schedule change and network tool in the turn a timer started", (t) => {
    const f = fixture(t);
    plan(f, ["- [ ] 1. First"]);
    assert.ok(report(checkBack(f)));
    const inside = join(f.project, "a.txt");
    for (const [name, input] of [["Write", { file_path: inside, content: "x" }], ["Edit", { file_path: inside, old_string: "a", new_string: "b" }], ["MultiEdit", { file_path: inside, edits: [] }], ["NotebookEdit", { notebook_path: join(f.project, "n.ipynb") }], ["Bash", { command: "ls" }], ["Agent", { prompt: "x" }]]) {
      const output = tool(f, name, input);
      assert.ok(denied(output), name);
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /check-back: a timer started this turn/u, name);
    }
    for (const name of ["WebFetch", "WebSearch", "CronCreate", "SendMessage", "EnterWorktree", "Workflow", "RemoteTrigger", "mcp__server__tool"]) assert.ok(denied(tool(f, name, {}, undefined, "check-back-guard")), name);
    for (const [name, input] of [["Read", { file_path: join(f.project, "plans", "p.md") }], ["Grep", { pattern: "x", path: f.project }], ["Glob", { pattern: "*" }]]) {
      assert.equal(denied(tool(f, name, input)), false, name);
    }
  });

  it("the user's next prompt lifts the guard; another session is never affected", (t) => {
    const f = fixture(t);
    plan(f, ["- [ ] 1. First"]);
    checkBack(f);
    const write = (session) => tool(f, "Write", { file_path: join(f.project, "a.txt"), content: "x" }, session);
    assert.equal(denied(write("cb-other")), false, "another session");
    assert.equal(denied(tool(f, "WebFetch", {}, "cb-other", "check-back-guard")), false);
    prompt(f, "thanks, carry on", undefined, "p2");
    assert.equal(denied(write()), false, "lifted by the user's prompt");
    assert.equal(tool(f, "WebFetch", {}, undefined, "check-back-guard"), null);
  });

  it("a silent check-back starts no guarded turn", (t) => {
    const f = fixture(t);
    plan(f, ["- [ ] 1. First"]);
    checkBack(f);
    prompt(f, "ok", undefined, "p2");
    assert.deepEqual(checkBack(f), { continue: false, suppressOutput: true });
    assert.equal(denied(tool(f, "Write", { file_path: join(f.project, "a.txt"), content: "x" })), false);
  });

  it("names parked start-work steps and the words to type", (t) => {
    const f = fixture(t);
    plan(f, ["- [ ] 1. First"]);
    const outside = join(f.base, "outside");
    mkdirSync(outside);
    prompt(f, "/litclaude:start-work plans/p.md", undefined, "p-start");
    run(f, "pre-tool-use", { hook_event_name: "PreToolUse", prompt_id: "p-start", tool_use_id: "toolu_1", tool_name: "Write", tool_input: { file_path: join(outside, "r.txt"), content: "x" } });
    const text = report(checkBack(f));
    assert.match(text, /start-work \S+ is (active|paused)\./u);
    assert.match(text, /Waiting on you: write \S*outside\. Type lit approve, lit deny or lit skip-row\./u);
  });

  it("an unreadable mark fails closed for its own session only", (t) => {
    const f = fixture(t);
    mkdirSync(join(f.project, ".litclaude", "check-back"), { recursive: true });
    writeFileSync(join(f.project, ".litclaude", "check-back", "session-cb-s1.json"), "{not json");
    assert.ok(denied(tool(f, "Bash", { command: "ls" })));
    assert.equal(denied(tool(f, "Bash", { command: "ls" }, "cb-other")), false);
  });

  it("stays silent, and guards nothing, when the record cannot be written", (t) => {
    const f = fixture(t);
    plan(f, ["- [ ] 1. First"]);
    mkdirSync(join(f.project, ".litclaude"), { recursive: true });
    writeFileSync(join(f.project, ".litclaude", "shown"), "a file where the folder should be");
    assert.deepEqual(checkBack(f), { continue: false, suppressOutput: true });
    assert.equal(denied(tool(f, "Bash", { command: "ls" })), false);
  });

  it("only the whole prompt counts", async () => {
    const { isCheckBackPrompt } = await import("../plugins/litclaude/lib/check-back.mjs");
    assert.equal(isCheckBackPrompt("  LIT   check-back \n"), true);
    for (const text of ["lit check-back now", "please lit check-back", "`lit check-back`", "lit checkback"]) assert.equal(isCheckBackPrompt(text), false, text);
  });
});
