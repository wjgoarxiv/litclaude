import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { INTERFACE_PROBE_MAX_BLOCKS, interfaceProbeTurnPath } from "../plugins/litclaude/lib/interface-probe-gate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const skills = join(root, "plugins", "litclaude", "skills");
const workspaces = [];
after(() => { for (const path of workspaces) rmSync(path, { recursive: true, force: true }); });

const workspace = () => {
  const cwd = mkdtempSync(join(tmpdir(), "litclaude-interface-probe-gate-"));
  writeFileSync(join(cwd, "package.json"), "{}\n");
  workspaces.push(cwd);
  return cwd;
};

const hook = (event, input) => {
  const result = spawnSync(process.execPath, [hookPath, event], { cwd: root, encoding: "utf8", env: { ...process.env }, input: JSON.stringify(input) });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const prompt = (cwd, text, session = "session-ui-1") => hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", session_id: session, prompt_id: "p1", prompt: text, cwd });
const write = (cwd, relative, session = "session-ui-1") => {
  const file = join(cwd, relative);
  hook("post-tool-use", { hook_event_name: "PostToolUse", session_id: session, cwd, tool_name: "Write", tool_input: { file_path: file, content: "x" }, tool_response: { type: "create", filePath: file } });
};
const bash = (cwd, command, stdout, session = "session-ui-1") => {
  hook("post-tool-use", { hook_event_name: "PostToolUse", session_id: session, cwd, tool_name: "Bash", tool_input: { command }, tool_response: { stdout, stderr: "", interrupted: false } });
};
const stop = (cwd, session = "session-ui-1", active = false) => {
  const out = hook("stop", { hook_event_name: "Stop", session_id: session, stop_hook_active: active, cwd });
  return out ? JSON.parse(out) : null;
};
const PROBE = "node \"$SKILL/scripts/interface-probe.mjs\" index.html --out .qa/r1";
// Loop-shaped requests with no interface wording, so the prompt hook routes them to lit-loop.
const LOOP_PROMPT = "lit implement the reading list feature end to end";

describe("interface-probe hand-off gate: a lit-loop turn that edits an interface", () => {
  it("arms on a lit-loop prompt and names the hand-off in the loop's mode contract", () => {
    const cwd = workspace();
    const context = prompt(cwd, LOOP_PROMPT);
    assert.match(context, /lit-loop/u);
    assert.match(context, /Skill\(frontend-ui-ux\), whose interface probe must pass before done/u);
    assert.ok(existsSync(interfaceProbeTurnPath(cwd)));
  });

  it("holds the stop until the probe has run after the last interface edit", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT);
    write(cwd, "src/server.js");
    assert.equal(stop(cwd), null, "a backend edit alone never waits for a browser probe");
    write(cwd, "public/index.html");
    const held = stop(cwd);
    assert.equal(held.decision, "block");
    assert.match(held.reason, /public\/index\.html/u);
    assert.match(held.reason, /Skill\(frontend-ui-ux\)/u);
    assert.match(held.reason, /interface-probe\.mjs/u);
    bash(cwd, PROBE, "| Severity | Rule | Where | Measured | Fix |\n\nVerdict: Approve (0 HIGH)\n");
    assert.equal(stop(cwd, "session-ui-1", true), null, "a clean probe run after the edit releases the turn");
    write(cwd, "public/style.css");
    assert.equal(stop(cwd).decision, "block", "an edit after the probe needs another run");
  });

  it("holds the stop while the last probe run still reports a HIGH finding", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT);
    write(cwd, "components/Card.tsx");
    bash(cwd, PROBE, "Verdict: Block (2 HIGH)\n");
    const held = stop(cwd);
    assert.equal(held.decision, "block");
    assert.match(held.reason, /HIGH finding/u);
    bash(cwd, PROBE, "Verdict: Approve (0 HIGH)\n");
    assert.equal(stop(cwd, "session-ui-1", true), null);
  });

  it("does not count a probe run that measured nothing", () => {
    for (const [label, command, stdout] of [
      ["silent no-op", PROBE, ""],
      ["blocked run", PROBE, "BLOCKED: matrix incomplete (320, 768)\n\nVerdict: BLOCKED: matrix incomplete (320, 768)\n"],
      ["output sent to a file with no readable manifest", `${PROBE} > probe.log 2>&1`, ""],
    ]) {
      const cwd = workspace();
      prompt(cwd, LOOP_PROMPT);
      write(cwd, "index.html");
      bash(cwd, command, stdout);
      const held = stop(cwd);
      assert.equal(held?.decision, "block", label);
      assert.match(held.reason, /not clean|no clean run/u, label);
    }
  });

  it("accepts a clean run read from its --out manifest when the output went to a file", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT);
    write(cwd, "index.html");
    const out = join(cwd, ".qa", "final");
    mkdirSync(out, { recursive: true });
    const manifest = (overrides) => JSON.stringify({ manifest: { exit_code: 0, viewports_run: ["320", "390", "768", "1440", "390-dark", "390-reduced-motion", "1440-zoom200"], ...overrides }, findings: [] });
    writeFileSync(join(out, "findings.json"), manifest({ exit_code: 2, viewports_run: ["390"] }));
    bash(cwd, `node "$S/scripts/interface-probe.mjs" index.html --out .qa/final > probe.log`, "");
    assert.equal(stop(cwd)?.decision, "block", "an incomplete manifest is not clean");
    writeFileSync(join(out, "findings.json"), manifest({}));
    bash(cwd, `node "$S/scripts/interface-probe.mjs" index.html --out .qa/final > probe.log`, "");
    assert.equal(stop(cwd, "session-ui-1", true), null);
  });

  it("never traps the session: after the block cap it warns once and allows", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT);
    write(cwd, "index.html");
    for (let block = 0; block < INTERFACE_PROBE_MAX_BLOCKS; block += 1) assert.equal(stop(cwd, "session-ui-1", block > 0).decision, "block");
    assert.match(stop(cwd, "session-ui-1", true).systemMessage, /allowing the stop/u);
    assert.equal(stop(cwd, "session-ui-1", true), null);
  });

  it("fails safe on an unreadable record", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT);
    write(cwd, "index.html");
    writeFileSync(interfaceProbeTurnPath(cwd), "{not json");
    assert.equal(stop(cwd), null);
  });
});

describe("interface-probe hand-off gate: turns that must not wait for a probe", () => {
  it("a lit-loop turn on a command-line tool or a backend runs no probe", () => {
    const cwd = workspace();
    prompt(cwd, "lit implement the export command for the command line tool");
    for (const file of ["bin/cli.js", "src/export.py", "app/models.py", "api/routes.ts", "README.md"]) write(cwd, file);
    assert.equal(stop(cwd), null);
  });

  it("an interface edit outside a lit workflow turn is not held", () => {
    const cwd = workspace();
    prompt(cwd, "what does this function return?");
    assert.equal(existsSync(interfaceProbeTurnPath(cwd)), false);
    write(cwd, "index.html");
    assert.equal(stop(cwd), null);
  });

  it("a new ordinary prompt clears the previous turn's record", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT);
    write(cwd, "index.html");
    prompt(cwd, "thanks, that's all");
    assert.equal(stop(cwd), null);
  });

  it("another session's stop is not held by this session's turn", () => {
    const cwd = workspace();
    prompt(cwd, LOOP_PROMPT, "session-a");
    write(cwd, "index.html", "session-a");
    assert.equal(stop(cwd, "session-b"), null);
  });
});

describe("interface-probe hand-off: skill text", () => {
  it("lit-loop's SURFACE step and lit-plan's Verification hand web interfaces to frontend-ui-ux", () => {
    const loop = readFileSync(join(skills, "lit-loop", "SKILL.md"), "utf8");
    assert.match(loop, /hand that part to `frontend-ui-ux`/u);
    assert.match(loop, /its interface probe \(run\s+from that skill's own directory across the full responsive matrix\)/u);
    assert.match(loop, /A CLI, library or backend-only criterion runs no probe/u);
    const plan = readFileSync(join(skills, "lit-plan", "SKILL.md"), "utf8");
    assert.match(plan, /names `frontend-ui-ux` in\s+its Verification/u);
  });
});
