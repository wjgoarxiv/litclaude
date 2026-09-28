import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import * as mark from "../bin/litfamily-banner.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const env = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TERM: "xterm-256color", CI: "1", LITCLAUDE_NO_AUTO_UPDATE: "1" };
const hook = (cwd, event, input = {}) => {
  const result = spawnSync(process.execPath, [join(root, "plugins/litclaude/bin/litclaude-hook.js"), event], {
    cwd, env, input: JSON.stringify({ cwd, session_id: "mark-session", ...input }), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

it("help prints the Ignition B banner and product lockup without ANSI in a pipe", () => {
  const result = spawnSync(process.execPath, [join(root, "bin/litclaude-ai.js"), "--help"], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith(mark.banner[0].trimEnd() + "\n"), "Ignition B banner missing");
  assert.ok(result.stdout.includes(`claude v${version}`));
  assert.doesNotMatch(result.stdout, /\x1b|██╗/u);
});

it("SessionStart renders a standard mark once across repeat, resume and compact", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lit-mark-session-"));
  mkdirSync(join(cwd, ".git"));
  try {
    const first = hook(cwd, "session-start", { source: "startup" });
    assert.ok(first.systemMessage?.startsWith("\n" + mark.standard.join("\n") + "\n"), "standard mark missing");
    assert.ok(first.systemMessage.endsWith(`litclaude v${version}`));
    for (const source of ["startup", "resume", "compact", "resume"]) {
      assert.equal(hook(cwd, "session-start", { source }).systemMessage, undefined, source);
    }
    assert.ok(hook(cwd, "session-start", { session_id: "new-session" }).systemMessage);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("activation separates the plain harness mark from the model probe line", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lit-mark-activation-"));
  try {
    const payload = hook(cwd, "user-prompt-submit", { prompt: "lit plan the update" });
    assert.equal(payload.systemMessage, `\n${mark.micro.map((row, index) => index === 2
      ? `${row}  🔥 LIT IGNITED · lit-plan 🔥` : row).join("\n")}`);
    assert.doesNotMatch(payload.systemMessage, /\x1b/u);
    assert.match(payload.hookSpecificOutput.additionalContext, /begin your reply with the exact probe line `🔥 \*\*LIT IGNITED · lit-plan\*\* 🔥`/iu);
    assert.match(payload.systemMessage, /🔥 LIT IGNITED · lit-plan 🔥/u);
    assert.doesNotMatch(payload.systemMessage, /\*\*/u);
    assert.equal(hook(cwd, "user-prompt-submit", { prompt: "ordinary text" }).systemMessage, undefined);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

const sheet = readFileSync(join(root, "test/fixtures/litmark/round6.txt"), "utf8");
it("historical round6 fixture matches its preserved generator byte for byte", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lit-mark-generator-"));
  try {
    const result = spawnSync(process.execPath, [join(root, "test/fixtures/litmark/litmark6.mjs")], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, sheet);
    assert.equal(readFileSync(join(cwd, "lit-round6-sheet.txt"), "utf8"), sheet);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("missing identity, symlinked or malformed session state suppresses only decoration", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lit-mark-unsafe-"));
  const outside = mkdtempSync(join(tmpdir(), "lit-mark-outside-"));
  mkdirSync(join(cwd, ".git"));
  try {
    const missing = hook(cwd, "session-start", { session_id: null });
    assert.equal(missing.systemMessage, undefined);
    assert.match(missing.hookSpecificOutput.additionalContext, /rules loaded/u);
    symlinkSync(outside, join(cwd, ".litclaude"), "dir");
    const linked = hook(cwd, "session-start");
    assert.equal(linked.systemMessage, undefined);
    assert.match(linked.hookSpecificOutput.additionalContext, /rules loaded/u);
    rmSync(join(cwd, ".litclaude"));
    mkdirSync(join(cwd, ".litclaude/rules"), { recursive: true });
    writeFileSync(join(cwd, ".litclaude/rules/session-mark-session.json"), "malformed");
    const malformed = hook(cwd, "session-start");
    assert.equal(malformed.systemMessage, undefined);
    assert.match(malformed.hookSpecificOutput.additionalContext, /rules loaded/u);
    assert.equal(readFileSync(join(cwd, ".litclaude/rules/session-mark-session.json"), "utf8"), "malformed");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

for (const order of ["nested-to-root", "root-to-nested"]) {
  it(`SessionStart shares authoritative project state across ${order} cwd changes`, () => {
    const project = mkdtempSync(join(tmpdir(), "lit-mark-cwd-"));
    const nested = join(project, "nested");
    mkdirSync(join(project, ".git"));
    mkdirSync(nested);
    writeFileSync(join(project, "CONTEXT.md"), "CWD-ROOT-RULE: preserve the project rules.\n");
    try {
      const [firstCwd, secondCwd] = order === "nested-to-root" ? [nested, project] : [project, nested];
      const first = hook(firstCwd, "session-start", { source: "startup" });
      const resumed = hook(secondCwd, "session-start", { source: "resume" });
      assert.deepEqual([first, resumed].map((result) => Boolean(result.systemMessage)), [true, false]);
      assert.match(first.hookSpecificOutput.additionalContext, /CWD-ROOT-RULE/u);
      assert.doesNotMatch(resumed.hookSpecificOutput.additionalContext, /CWD-ROOT-RULE/u);
      const compacted = hook(nested, "session-start", { source: "compact" });
      assert.equal(compacted.systemMessage, undefined);
      assert.match(compacted.hookSpecificOutput.additionalContext, /CWD-ROOT-RULE/u);
      assert.equal(hook(project, "session-start", { source: "resume" }).systemMessage, undefined);
      assert.equal(existsSync(join(nested, ".litclaude")), false);
      const stateDir = join(project, ".litclaude", "rules");
      assert.deepEqual(readdirSync(stateDir), ["session-mark-session.json"]);
      const state = JSON.parse(readFileSync(join(stateDir, "session-mark-session.json"), "utf8"));
      assert.equal(state.ignitionShown, true);
      assert.equal(state.postCompactCount, 1);
      assert.ok(hook(nested, "session-start", { session_id: "next-session" }).systemMessage);
      assert.equal(hook(project, "session-start", { session_id: "next-session", source: "resume" }).systemMessage, undefined);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });
}

it("nested SessionStart cannot bypass a symlinked authoritative state directory", () => {
  for (const component of [".litclaude", ".litclaude/rules"]) {
    const project = mkdtempSync(join(tmpdir(), "lit-mark-root-link-"));
    const outside = mkdtempSync(join(tmpdir(), "lit-mark-link-target-"));
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "nested"));
    if (component.includes("/")) mkdirSync(join(project, ".litclaude"));
    writeFileSync(join(outside, "sentinel"), "unchanged");
    symlinkSync(outside, join(project, component), "dir");
    try {
      const result = hook(join(project, "nested"), "session-start", { source: "startup" });
      assert.equal(result.systemMessage, undefined);
      assert.match(result.hookSpecificOutput.additionalContext, /rules loaded/u);
      assert.equal(existsSync(join(project, "nested", ".litclaude")), false);
      assert.deepEqual(readdirSync(outside), ["sentinel"]);
      assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "unchanged");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }
});

it("ignition root discovery preserves invalid and symlinked cwd rejection", () => {
  const project = mkdtempSync(join(tmpdir(), "lit-mark-cwd-trust-"));
  mkdirSync(join(project, ".git"));
  mkdirSync(join(project, "nested"));
  writeFileSync(join(project, "file"), "not a directory");
  symlinkSync(join(project, "nested"), join(project, "linked"), "dir");
  try {
    for (const name of ["missing", "file", "linked", "linked/"]) {
      const result = hook(project, "session-start", { cwd: join(project, name), session_id: `invalid-${name}` });
      assert.equal(result.systemMessage, undefined, name);
      assert.match(result.hookSpecificOutput.additionalContext, /rules loaded/u);
    }
  } finally { rmSync(project, { recursive: true, force: true }); }
});
