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
const OPTION = "CLAUDE_PLUGIN_OPTION_PARK_PING";
const PLAN = "# Plan\n\n## TODOs\n\n- [ ] 1. Write a.txt\n- [ ] 2. Write the report outside the project\n";

const fixture = (t, option) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-park-ping-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(project, "plans"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(project, "plans", "p.md"), PLAN);
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
  delete env[OPTION];
  if (option !== undefined) env[OPTION] = option;
  return { base, project, outside, env };
};

const run = (f, event, input, env = f.env) => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: f.project,
    encoding: "utf8",
    input: JSON.stringify({ cwd: f.project, session_id: "park-s1", ...input }),
    env,
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};

const start = (f) => run(f, "user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt_id: "p-start", prompt: "/litclaude:start-work plans/p.md" });
const write = (f, path, id, env) => run(f, "pre-tool-use", {
  hook_event_name: "PreToolUse", prompt_id: "p-start", tool_use_id: id, tool_name: "Write", tool_input: { file_path: path, content: "x" },
}, env);
const notify = (f, type = "permission_prompt", env) => run(f, "notification", { hook_event_name: "Notification", notification_type: type, message: "Claude needs your permission" }, env);
const OSC9 = /^\u001b\]9;LitClaude start-work: a parked step waits on you: write .+\. Type lit approve to allow, or lit cancel to end the run\.\u0007$/u;

describe("park ping", () => {
  it("is enrolled: a Notification hook and a plugin option that defaults to off", () => {
    const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks;
    assert.match(hooks.Notification[0].hooks[0].command, /litclaude-hook\.js\\?" notification$/u);
    assert.equal(hooks.Notification[0].matcher, "^(permission_prompt|idle_prompt|agent_needs_input)$");
    const option = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).userConfig.park_ping;
    assert.equal(option.default, "off");
    assert.match(option.description, /approves nothing/u);
  });

  it("sends nothing when the option is off: the park still denies the call", (t) => {
    const f = fixture(t);
    start(f);
    const parked = write(f, join(f.outside, "r.txt"), "toolu_1");
    assert.equal(parked.hookSpecificOutput.permissionDecision, "deny");
    assert.match(parked.hookSpecificOutput.permissionDecisionReason, /parked this call/u);
    assert.equal(parked.terminalSequence, undefined);
    assert.equal(notify(f), null);
  });

  it("with the option on, pings exactly once per parked step, never per retry or notification", (t) => {
    const f = fixture(t, "on");
    start(f);
    const first = write(f, join(f.outside, "r.txt"), "toolu_1");
    assert.equal(first.hookSpecificOutput.permissionDecision, "deny");
    assert.match(first.terminalSequence, OSC9);
    assert.match(first.terminalSequence, /write \S*\/outside\./u, "it names what waits (a long path keeps its tail)");
    for (const id of ["toolu_2", "toolu_3"]) assert.equal(write(f, join(f.outside, "r.txt"), id).terminalSequence, undefined);
    assert.equal(notify(f), null, "the park already pinged");
    assert.equal(notify(f, "idle_prompt"), null);
    const other = join(f.base, "elsewhere");
    mkdirSync(other);
    assert.match(write(f, join(other, "s.txt"), "toolu_4").terminalSequence, OSC9, "a second parked step gets its own ping");
  });

  it("never approves: the parked call stays parked after the ping", (t) => {
    const f = fixture(t, "on");
    start(f);
    write(f, join(f.outside, "r.txt"), "toolu_1");
    const state = JSON.parse(readFileSync(join(f.project, ".litclaude", "boulder.json"), "utf8"));
    const work = state.works[state.active_work_id];
    assert.equal(work.pending_boundaries.length, 1);
    assert.equal(work.authority.grants.some((grant) => grant.root === f.outside), false);
  });

  it("a notification pings once for a step parked before the option was on", (t) => {
    const f = fixture(t);
    start(f);
    write(f, join(f.outside, "r.txt"), "toolu_1");
    const on = { ...f.env, [OPTION]: "on" };
    assert.equal(notify(f, "agent_completed", on), null, "only waiting notifications ping");
    assert.match(notify(f, "idle_prompt", on).terminalSequence, OSC9);
    assert.equal(notify(f, "permission_prompt", on), null);
  });

  it("osc777 sends the OSC 777 form", (t) => {
    const f = fixture(t, "osc777");
    start(f);
    assert.match(write(f, join(f.outside, "r.txt"), "toolu_1").terminalSequence, /^\u001b\]777;notify;LitClaude;LitClaude start-work: .+lit approve.+\u0007$/u);
  });

  it("sends nothing, and still parks, when the record cannot be written", (t) => {
    const f = fixture(t, "on");
    start(f);
    writeFileSync(join(f.project, ".litclaude", "shown"), "a file where the folder should be");
    const parked = write(f, join(f.outside, "r.txt"), "toolu_1");
    assert.equal(parked.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(parked.terminalSequence, undefined);
  });

  it("keeps control characters out of the sequence", async () => {
    const { parkPingText, parkPingSequence } = await import("../plugins/litclaude/lib/park-ping.mjs");
    const text = parkPingText([{ action: "write", root: "/tmp/a\u0007\u001b]9;evil\u0007b" }]);
    assert.doesNotMatch(text, /[\u0000-\u001f\u007f]/u);
    assert.match(text, /^LitClaude/u, "an OSC 9 body must not start with a digit");
    assert.equal(parkPingSequence("osc9", text).match(/\u0007/gu).length, 1);
  });
});
