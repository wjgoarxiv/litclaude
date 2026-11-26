// The PreToolUse hook runs before every file read and edit. Each module it opens is one more file a
// scanner on a managed PC inspects, so these tests count modules and heavy loads, never milliseconds.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { acquireStartWorkLock, initializeStartWork, releaseStartWorkLock } from "../plugins/litclaude/lib/start-work-lifecycle.mjs";

const pluginRoot = fileURLToPath(new URL("../plugins/litclaude/", import.meta.url));
const MAX_HOT_MODULES = 10;

const staticClosure = (entry, seen = new Set()) => {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const [, specifier] of readFileSync(entry, "utf8").matchAll(/^(?:import|export)\s[^;]*?from\s+"(\.[^"]+)";/gmu)) staticClosure(resolve(dirname(entry), specifier), seen);
  return seen;
};

describe("PreToolUse hot path", () => {
  it("starts one guard process per matched call, through the light entry", () => {
    const groups = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse;
    const commands = groups.flatMap((group) => group.hooks.map((hook) => hook.command));
    assert.deepEqual(commands, ["node \"${CLAUDE_PLUGIN_ROOT}/bin/litclaude-guard.js\" pre-tool-use", "node \"${CLAUDE_PLUGIN_ROOT}/bin/litclaude-guard.js\" check-back-guard"]);
    for (const tool of ["Read", "Edit", "Bash", "WebFetch", "mcp__x__y"]) {
      assert.equal(groups.filter((group) => new RegExp(group.matcher, "u").test(tool)).length, 1, tool);
    }
  });

  it(`loads at most ${MAX_HOT_MODULES} modules before it knows a run exists`, () => {
    const files = [...staticClosure(join(pluginRoot, "bin", "litclaude-guard.js"))].map((file) => relative(pluginRoot, file));
    assert.ok(files.length <= MAX_HOT_MODULES, files.join("\n"));
    for (const heavy of ["lib/start-work-lifecycle.mjs", "lib/receipts.mjs", "lib/workflow-stage.mjs", "lib/deliverable-hedge-guard.mjs", "lib/check-back.mjs"]) assert.ok(!files.includes(heavy), heavy);
  });

  describe("with every heavy module replaced by one that throws", () => {
    let base;
    let copy;
    before(() => {
      base = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-hot-")));
      copy = join(base, "plugin");
      for (const part of ["bin", "lib"]) cpSync(join(pluginRoot, part), join(copy, part), { recursive: true });
      for (const name of ["start-work-lifecycle", "receipts", "workflow-stage", "deliverable-hedge-guard", "check-back", "park-ping", "mutated-file-paths"]) {
        writeFileSync(join(copy, "lib", `${name}.mjs`), `throw new Error("${name} was loaded");\n`);
      }
    });
    after(() => rmSync(base, { recursive: true, force: true }));

    const project = (name) => {
      const root = join(base, name);
      mkdirSync(join(root, ".git"), { recursive: true });
      mkdirSync(join(root, "plans"));
      writeFileSync(join(root, "plans", "p.md"), "# P\n\n## TODOs\n\n- [ ] 1. one\n");
      writeFileSync(join(root, "a.txt"), "x\n");
      return root;
    };
    const withRun = (name) => {
      const root = project(name);
      initializeStartWork(root, { plan: "plans/p.md", workId: "w1", sessionId: "owner", grants: [`read:${root}`, `write:${root}`], idempotencyKey: "k1" });
      return root;
    };
    const change = (root, fn) => {
      const path = join(root, ".litclaude", "boulder.json");
      const state = JSON.parse(readFileSync(path, "utf8"));
      fn(state);
      writeFileSync(path, JSON.stringify(state));
    };
    const hook = (root, tool, toolInput, { session = "me", event = "pre-tool-use", env = {} } = {}) => spawnSync(process.execPath, [join(copy, "bin", "litclaude-guard.js"), event], {
      cwd: base, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "", ...env },
      input: JSON.stringify({ cwd: root, session_id: session, prompt_id: "p", tool_use_id: "t", hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput }),
    });
    const silent = (result, label) => {
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.equal(result.stdout, "", label);
    };
    const failsClosed = (result, label) => {
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      const output = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(output.permissionDecision, "deny", label);
      assert.match(output.permissionDecisionReason, /failed closed: start-work-lifecycle was loaded/u, label);
    };
    const calls = (root) => [
      ["Read", { file_path: join(root, "a.txt") }],
      ["Grep", { pattern: "x", path: root }],
      ["Edit", { file_path: join(root, "a.mjs"), old_string: "a", new_string: "b" }],
      ["Write", { file_path: join(root, "a.mjs"), content: "b" }],
      ["Bash", { command: "grep -n x a.txt | head -3; tail -n 2 a.txt" }],
    ];

    it("decides a call with no run, in and out of git", () => {
      const root = project("none");
      for (const [tool, input] of calls(root)) silent(hook(root, tool, input), `${tool}, no run`);
      silent(hook(root, "WebFetch", {}, { event: "check-back-guard" }), "check-back-guard");
    });

    it("decides a call when the project's run has finished", () => {
      const root = withRun("finished");
      change(root, (state) => {
        state.works.w1.status = "completed";
        state.active_work_id = null;
      });
      for (const [tool, input] of calls(root)) silent(hook(root, tool, input), `${tool}, finished run`);
    });

    it("decides a call when the run's owner ended or went idle", () => {
      const ended = withRun("ended");
      change(ended, (state) => {
        state.works.w1.root_session_ended_at = new Date().toISOString();
      });
      for (const [tool, input] of calls(ended)) silent(hook(ended, tool, input), `${tool}, ended owner`);
      const idle = withRun("idle");
      change(idle, (state) => {
        state.works.w1.updated_at = "2026-01-01T00:00:00.000Z";
      });
      for (const [tool, input] of calls(idle)) silent(hook(idle, tool, input), `${tool}, idle owner`);
    });

    it("asks the full guard, which fails closed, when a run may apply", () => {
      const read = ["Read", { file_path: "a.txt" }];
      const root = withRun("live");
      failsClosed(hook(root, ...read, { session: "owner" }), "own run");
      failsClosed(hook(root, ...read), "live run of another session");
      change(root, (state) => {
        state.works.w1.status = "completed";
        state.active_work_id = null;
        state.cancel_notices = { me: { work_id: "w1", plan_name: "p.md" } };
      });
      failsClosed(hook(root, ...read), "cancel notice for this session");
      for (const [name, text] of [["torn", "{ torn"], ["old-schema", "{\"schema_version\":2}"], ["no-works", "{\"schema_version\":3,\"revision\":1,\"events\":[]}"], ["no-active", "{\"schema_version\":3,\"revision\":1,\"events\":[],\"works\":{},\"active_work_id\":7}"]]) {
        const bad = project(name);
        mkdirSync(join(bad, ".litclaude"));
        writeFileSync(join(bad, ".litclaude", "boulder.json"), text);
        failsClosed(hook(bad, ...read), name);
      }
      failsClosed(hook(join(base, "missing"), ...read), "missing cwd with no project root");
    });
  });

  it("bounds the wait for a busy lock below the hook timeout when the state cannot be read", async () => {
    const { handleStartWorkPreToolUse, PRE_TOOL_LOCK_WAIT_MS } = await import("../plugins/litclaude/lib/start-work-lifecycle.mjs");
    assert.ok(PRE_TOOL_LOCK_WAIT_MS <= 2_000, String(PRE_TOOL_LOCK_WAIT_MS));
    const root = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-hot-lock-")));
    const waits = [];
    const wait = Atomics.wait;
    try {
      mkdirSync(join(root, "plans"));
      writeFileSync(join(root, "plans", "p.md"), "# P\n\n## TODOs\n\n- [ ] 1. one\n");
      initializeStartWork(root, { plan: "plans/p.md", workId: "w1", sessionId: "owner", grants: [`read:${root}`, `write:${root}`], idempotencyKey: "k1" });
      writeFileSync(join(root, ".litclaude", "boulder.json"), "{ torn");
      const holder = acquireStartWorkLock(root, { timeoutMs: 0 });
      Atomics.wait = (...args) => {
        waits.push(args[3]);
        return wait(...args);
      };
      assert.throws(() => handleStartWorkPreToolUse(root, { session_id: "owner", cwd: root, tool_name: "Read", tool_input: { file_path: join(root, "a") } }), /lock timed out/u);
      assert.ok(waits.reduce((total, ms) => total + ms, 0) <= PRE_TOOL_LOCK_WAIT_MS + 50, String(waits.length));
      releaseStartWorkLock(root, holder);
    } finally {
      Atomics.wait = wait;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
