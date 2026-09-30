import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins/litclaude");
const hookPath = join(pluginRoot, "bin/litclaude-hook.js");
const hudPath = join(pluginRoot, "bin/litclaude-hud.js");
const cliPath = join(root, "bin/litclaude-ai.js");

const scrubbedEnv = (extra = {}) => {
  const env = { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };
  for (const name of Object.keys(env)) {
    if (name.startsWith("LITCLAUDE_AUTO_HANDOFF") || name.startsWith("LITCLAUDE_JEV") || name === "TYPESAFE_API_KEY") delete env[name];
    if (name === "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" || name === "CLAUDE_CODE_AUTO_COMPACT_WINDOW") delete env[name];
  }
  return { ...env, ...extra };
};

const project = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-auto-handoff-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const runHook = (event, dir, input, env = {}) => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: dir,
    encoding: "utf8",
    input: JSON.stringify({ cwd: dir, session_id: "s1", ...input }),
    env: scrubbedEnv(env),
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
};

const route = (dir, prompt, env) => runHook("user-prompt-submit", dir, { prompt }, env);
const stop = (dir, input = {}, env) => runHook("stop", dir, input, env);
const compactStart = (dir, input = {}, env) => runHook("session-start", dir, { source: "compact", ...input }, env);

const statePath = (dir, name) => join(dir, ".litclaude", "auto-handoff", name);

// What the status line leaves for the Stop hook to read.
const writeContext = (dir, percent, { sessionId = "s1", window = 1000000 } = {}) => {
  mkdirSync(join(dir, ".litclaude", "auto-handoff"), { recursive: true });
  writeFileSync(statePath(dir, `context-${sessionId}.json`), JSON.stringify({ session_id: sessionId, percent, window, updated_at: Date.now() }));
};

const setOn = (dir, percent) => route(dir, `lit-handoff auto on ${percent}`);

const routeLine = (payload) => payload.hookSpecificOutput.additionalContext;
const nonceOf = (reason) => /Auto-handoff id: ([0-9a-f]{8,})/u.exec(reason)?.[1];

const writeHandoff = (dir, nonce, { where = ".handoff/HANDOFF.md", body = "## What Was Done\n- finished the parser\n", ageMs = 0 } = {}) => {
  const target = join(dir, where);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `# Handoff\n\nAuto-handoff id: ${nonce}\n\n${body}`);
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    utimesSync(target, when, when);
  }
  return target;
};

describe("automatic handoff: settings", () => {
  it("is off by default and does nothing at any percent", (t) => {
    const dir = project(t);
    writeContext(dir, 97);
    assert.equal(stop(dir), null);
    const status = route(dir, "lit-handoff auto status");
    assert.match(routeLine(status), /Automatic handoff is off\./u);
  });

  it("the route turns it on with the percent the user gives and off again", (t) => {
    const dir = project(t);
    assert.match(routeLine(setOn(dir, 60)), /Automatic handoff is on at 60%\./u);
    assert.match(routeLine(route(dir, "lit-handoff auto status")), /on at 60%/u);
    assert.match(routeLine(route(dir, "lit-handoff auto off")), /Automatic handoff is off\./u);
    assert.match(routeLine(route(dir, "lit-handoff auto status")), /is off/u);
    writeContext(dir, 90);
    assert.equal(stop(dir), null);
  });

  it("on without a number reuses the last value and asks when there is none", (t) => {
    const dir = project(t);
    const asked = route(dir, "lit-handoff auto on");
    assert.match(routeLine(asked), /Tell me the percent/u);
    assert.match(routeLine(route(dir, "lit-handoff auto status")), /is off/u);
    setOn(dir, 55);
    route(dir, "lit-handoff auto off");
    assert.match(routeLine(route(dir, "lit-handoff auto on")), /on at 55%/u);
    setOn(dir, 70);
    route(dir, "lit-handoff auto off");
    assert.match(routeLine(route(dir, "lit-handoff auto on")), /on at 70%/u);
  });

  it("the route refuses a percent outside 1 to 99 and keeps the current setting", (t) => {
    const dir = project(t);
    for (const bad of ["0", "100", "150", "abc", "5.5", "-3"]) {
      const reply = routeLine(route(dir, `lit-handoff auto on ${bad}`));
      assert.match(reply, /whole number from 1 to 99/u, bad);
      assert.doesNotMatch(reply, /Automatic handoff is on/u, bad);
    }
    assert.match(routeLine(route(dir, "lit-handoff auto status")), /is off/u);
    setOn(dir, 60);
    route(dir, "lit-handoff auto on 400");
    assert.match(routeLine(route(dir, "lit-handoff auto status")), /on at 60%/u);
  });

  it("the environment variables turn it on and override the saved percent", (t) => {
    const dir = project(t);
    setOn(dir, 90);
    writeContext(dir, 75);
    assert.equal(stop(dir), null);
    const blocked = stop(dir, {}, { LITCLAUDE_AUTO_HANDOFF_PERCENT: "70" });
    assert.equal(blocked.decision, "block");
  });

  it("the environment flag alone turns it on when a percent was saved, and 0 turns it off", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    route(dir, "lit-handoff auto off");
    writeContext(dir, 80);
    assert.equal(stop(dir), null);
    assert.equal(stop(dir, {}, { LITCLAUDE_AUTO_HANDOFF: "1" }).decision, "block");
    setOn(dir, 60);
    writeContext(dir, 80, { sessionId: "s2" });
    assert.equal(stop(dir, { session_id: "s2" }, { LITCLAUDE_AUTO_HANDOFF: "0" }), null);
  });

  it("the flag on without any percent stays off and says what is missing", (t) => {
    const dir = project(t);
    writeContext(dir, 95);
    assert.equal(stop(dir, {}, { LITCLAUDE_AUTO_HANDOFF: "1" }), null);
    const status = routeLine(route(dir, "lit-handoff auto status", { LITCLAUDE_AUTO_HANDOFF: "1" }));
    assert.match(status, /no percent/iu);
  });

  it("an invalid percent in the environment or the saved file means off with a warning", (t) => {
    const dir = project(t);
    writeContext(dir, 98);
    for (const bad of ["0", "100", "abc", "5.5", "", "-1"]) {
      assert.equal(stop(dir, {}, { LITCLAUDE_AUTO_HANDOFF: "1", LITCLAUDE_AUTO_HANDOFF_PERCENT: bad }), null, bad);
    }
    const status = routeLine(route(dir, "lit-handoff auto status", { LITCLAUDE_AUTO_HANDOFF: "1", LITCLAUDE_AUTO_HANDOFF_PERCENT: "abc" }));
    assert.match(status, /is off/u);
    assert.match(status, /whole number from 1 to 99/u);

    mkdirSync(join(dir, ".litclaude", "auto-handoff"), { recursive: true });
    writeFileSync(statePath(dir, "settings.json"), JSON.stringify({ enabled: true, percent: 150 }));
    assert.equal(stop(dir), null);
    assert.match(routeLine(route(dir, "lit-handoff auto status")), /whole number from 1 to 99/u);
  });

  it("other prompts that mention the route stay ordinary prompts", (t) => {
    const dir = project(t);
    const payload = route(dir, "please explain what lit-handoff auto on 60 would do");
    assert.doesNotMatch(routeLine(payload), /Automatic handoff is/u);
    assert.equal(existsSync(statePath(dir, "settings.json")), false);
  });
});

describe("automatic handoff: Stop hook", () => {
  it("does not block below the percent", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    writeContext(dir, 59);
    assert.equal(stop(dir), null);
  });

  it("blocks once when the percent is crossed, telling the model how to write the handoff", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    writeContext(dir, 61);
    const first = stop(dir);
    assert.equal(first.decision, "block");
    assert.match(first.reason, /61%/u);
    assert.match(first.reason, /vendor[\\/]handoff[\\/]SKILL\.md/u);
    assert.match(first.reason, /Do not call the Skill tool/u);
    assert.match(first.reason, /credentials, tokens, cookies, private URLs and secret-bearing command output/u);
    assert.doesNotMatch(first.reason, /destination, redaction and verification/u, "the vendored file carries no redaction rule, so the directive states it itself");
    assert.match(first.reason, /Handoff saved\. Run \/compact now\./u);
    assert.ok(nonceOf(first.reason));
    assert.equal(stop(dir), null, "a second Stop at the same crossing stays quiet");
    assert.equal(stop(dir), null);
  });

  it("fires again only after the usage dropped below the percent and crossed it anew", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    writeContext(dir, 70);
    const first = stop(dir);
    assert.equal(first.decision, "block");
    writeContext(dir, 20);
    assert.equal(stop(dir), null);
    writeContext(dir, 65);
    const second = stop(dir);
    assert.equal(second.decision, "block");
    assert.notEqual(nonceOf(second.reason), nonceOf(first.reason));
  });

  it("never blocks while the host reports a continuation after an earlier block", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    writeContext(dir, 80);
    assert.equal(stop(dir, { stop_hook_active: true }), null);
    assert.equal(existsSync(statePath(dir, "session-s1.json")), false, "the crossing is not spent by a continuation");
    assert.equal(stop(dir).decision, "block");
    assert.equal(stop(dir, { stop_hook_active: true }), null);
  });

  it("keeps each session's crossing separate", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    writeContext(dir, 80, { sessionId: "a" });
    writeContext(dir, 80, { sessionId: "b" });
    assert.equal(stop(dir, { session_id: "a" }).decision, "block");
    assert.equal(stop(dir, { session_id: "b" }).decision, "block");
    assert.equal(stop(dir, { session_id: "a" }), null);
  });

  it("does nothing when no percent is available", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    assert.equal(stop(dir), null);
    assert.equal(stop(dir, { transcript_path: join(dir, "missing.jsonl") }), null);
  });

  it("reads the last assistant usage from the transcript when a window is known", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    const transcript = join(dir, "transcript.jsonl");
    writeFileSync(transcript, `${JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: 690000, cache_creation_input_tokens: 10000, output_tokens: 500 } } })}\n`);
    assert.equal(stop(dir, { transcript_path: transcript }), null, "without a window the percent stays unknown");
    const blocked = stop(dir, { transcript_path: transcript }, { LITCLAUDE_AUTO_HANDOFF_WINDOW: "1000000" });
    assert.equal(blocked.decision, "block");
    assert.match(blocked.reason, /70%/u);
  });
});

describe("automatic handoff: reload after compaction", () => {
  const fire = (dir, percent = 60) => {
    setOn(dir, percent);
    writeContext(dir, percent + 10);
    return nonceOf(stop(dir).reason);
  };

  it("injects a bounded digest of the fresh handoff once", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    const file = writeHandoff(dir, nonce, { body: `## What Was Done\n- finished the parser\n${"x".repeat(9000)}\n` });
    const first = compactStart(dir);
    const context = first.hookSpecificOutput.additionalContext;
    assert.match(context, /Automatic handoff reload/u);
    assert.ok(context.includes(file));
    assert.match(context, /finished the parser/u);
    assert.ok(context.length < 20000, `digest is bounded (${context.length})`);
    assert.doesNotMatch(context, new RegExp("x{5000}", "u"));
    const second = compactStart(dir);
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /Automatic handoff reload/u);
  });

  it("finds a root HANDOFF.md as well as the .handoff folder", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce, { where: "HANDOFF.md" });
    assert.match(compactStart(dir).hookSpecificOutput.additionalContext, /Automatic handoff reload/u);
  });

  it("refuses a handoff that is older than the trigger", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce, { ageMs: 3600000 });
    const context = compactStart(dir).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(context, /finished the parser/u);
    assert.match(context, /no fresh handoff/u);
  });

  it("refuses a reload that comes many hours after the trigger", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce);
    const file = statePath(dir, "session-s1.json");
    const session = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...session, firedAt: Date.now() - 7 * 3600000 }));
    const context = compactStart(dir).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(context, /finished the parser/u);
    assert.match(context, /no fresh handoff/u);
  });

  it("refuses a handoff that does not carry this trigger's id", (t) => {
    const dir = project(t);
    fire(dir);
    writeHandoff(dir, "deadbeefdeadbeef");
    const context = compactStart(dir).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(context, /finished the parser/u);
    assert.match(context, /no fresh handoff/u);
  });

  it("injects nothing into another session", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce);
    const other = compactStart(dir, { session_id: "someone-else" });
    assert.doesNotMatch(other.hookSpecificOutput.additionalContext, /Automatic handoff reload|no fresh handoff/u);
    assert.match(compactStart(dir).hookSpecificOutput.additionalContext, /Automatic handoff reload/u, "the owning session still gets it");
  });

  it("injects nothing when automatic handoff is off", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce);
    route(dir, "lit-handoff auto off");
    assert.doesNotMatch(compactStart(dir).hookSpecificOutput.additionalContext, /Automatic handoff reload/u);
  });

  it("injects nothing on an ordinary session start", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce);
    const start = runHook("session-start", dir, { source: "startup" });
    assert.doesNotMatch(start.hookSpecificOutput.additionalContext, /Automatic handoff reload/u);
  });

  it("lets the next crossing fire after the reload", (t) => {
    const dir = project(t);
    const nonce = fire(dir);
    writeHandoff(dir, nonce);
    compactStart(dir);
    writeContext(dir, 15);
    assert.equal(stop(dir), null);
    writeContext(dir, 75);
    assert.equal(stop(dir).decision, "block");
  });
});

describe("automatic handoff: status line and doctor", () => {
  const hud = (dir, status, env = {}) => {
    const result = spawnSync(process.execPath, [hudPath], {
      cwd: dir,
      encoding: "utf8",
      input: `${JSON.stringify({ model: { display_name: "Opus 4.8" }, cwd: dir, session_id: "s1", ...status })}\n`,
      env: scrubbedEnv(env),
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };

  it("writes the percent for the Stop hook only while automatic handoff is on", (t) => {
    const dir = project(t);
    hud(dir, { context_window: { context_window_size: 1000000, used_percentage: 42 } });
    assert.equal(existsSync(statePath(dir, "context-s1.json")), false);
    setOn(dir, 60);
    const line = hud(dir, { context_window: { context_window_size: 1000000, used_percentage: 42 } });
    const written = JSON.parse(readFileSync(statePath(dir, "context-s1.json"), "utf8"));
    assert.equal(written.percent, 42);
    assert.equal(written.window, 1000000);
    assert.equal(written.session_id, "s1");
    assert.match(line, /handoff@60%/u);
  });

  it("leaves the line alone while it is off and marks a bad setting", (t) => {
    const dir = project(t);
    assert.doesNotMatch(hud(dir, {}), /handoff/u);
    assert.match(hud(dir, {}, { LITCLAUDE_AUTO_HANDOFF: "1", LITCLAUDE_AUTO_HANDOFF_PERCENT: "abc" }), /handoff ⚠/u);
  });

  it("records no percent when neither the host nor the transcript has one, but keeps the window", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    hud(dir, { context_window: { context_window_size: 1000000 } });
    const written = JSON.parse(readFileSync(statePath(dir, "context-s1.json"), "utf8"));
    assert.equal(written.percent, null);
    assert.equal(written.window, 1000000);
  });

  const doctorLines = (dir, env = {}) => {
    const result = spawnSync(process.execPath, [cliPath, "--dry-run", "doctor"], { cwd: dir, encoding: "utf8", env: scrubbedEnv(env), timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split("\n").filter((line) => line.startsWith("Auto-handoff"));
  };

  it("doctor shows the state", (t) => {
    const dir = project(t);
    assert.deepEqual(doctorLines(dir), ["Auto-handoff: off"]);
    setOn(dir, 60);
    assert.deepEqual(doctorLines(dir), ["Auto-handoff: on at 60%"]);
    assert.match(doctorLines(dir, { LITCLAUDE_AUTO_HANDOFF_PERCENT: "abc" }).join("\n"), /whole number from 1 to 99/u);
  });

  it("doctor warns when Claude Code compacts at or before the chosen percent", (t) => {
    const dir = project(t);
    setOn(dir, 60);
    const warned = doctorLines(dir, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "50" }).join("\n");
    assert.match(warned, /compacts at 50%/u);
    assert.match(warned, /below/u);
    const fine = doctorLines(dir, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "80" });
    assert.deepEqual(fine, ["Auto-handoff: on at 60%"]);
    const windowed = doctorLines(dir, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" }).join("\n");
    assert.match(windowed, /CLAUDE_CODE_AUTO_COMPACT_WINDOW/u);
  });

  it("parsePercent accepts 100 only when the caller allows it", async () => {
    const { parsePercent } = await import("../plugins/litclaude/lib/auto-handoff.mjs");
    assert.equal(parsePercent("100"), null);
    assert.equal(parsePercent("100", { max: 100 }), 100);
    assert.equal(parsePercent("99", { max: 100 }), 99);
    assert.equal(parsePercent("101", { max: 100 }), null);
    assert.equal(parsePercent("0", { max: 100 }), null);
  });
});

describe("automatic handoff: documentation", () => {
  const read = (path) => readFileSync(join(root, path), "utf8");

  it("the README pages explain which steps are automatic and which are reminders", () => {
    for (const [file, heading, labels] of [
      ["README.md", "## Automatic handoff", ["Automatic:", "Reminder:"]],
      ["README_ko-KR.md", "## 자동 핸드오프", ["자동:", "알림:"]],
    ]) {
      const text = read(file);
      assert.ok(text.includes(heading), `${file} has ${heading}`);
      const section = text.slice(text.indexOf(heading), text.indexOf("\n## ", text.indexOf(heading) + 5));
      for (const label of labels) assert.ok(section.includes(label), `${file} labels ${label}`);
      for (const token of ["lit-handoff auto on", "LITCLAUDE_AUTO_HANDOFF", "LITCLAUDE_AUTO_HANDOFF_PERCENT", "/compact", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"]) {
        assert.ok(section.includes(token), `${file} mentions ${token}`);
      }
    }
  });

  it("hooks.md and privacy.md describe the hook behaviour and the state it writes", () => {
    const hooks = read("docs/hooks.md");
    assert.match(hooks, /## Automatic handoff/u);
    for (const token of ["stop_hook_active", "SessionStart", "source: compact", ".litclaude/auto-handoff/", "Auto-handoff id"]) {
      assert.ok(hooks.includes(token), `hooks.md mentions ${token}`);
    }
    const privacy = read("docs/privacy.md");
    assert.match(privacy, /\.litclaude\/auto-handoff\//u);
  });
});
