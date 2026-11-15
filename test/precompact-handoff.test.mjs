import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins/litclaude");
const hookPath = join(pluginRoot, "bin/litclaude-hook.js");

const scrubbedEnv = (extra = {}) => {
  const env = { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", NO_COLOR: "1" };
  for (const name of Object.keys(env)) {
    if (name.startsWith("LITCLAUDE_AUTO_HANDOFF") || name.startsWith("LITCLAUDE_PRECOMPACT")) delete env[name];
  }
  return { ...env, ...extra };
};

const project = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-precompact-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const rowBlock = (number, title, done) => `- [${done ? "x" : " "}] ${number}. ${title}
  What to do / Must NOT do: ${title}.
  References: none.
  Acceptance criteria: the file exists.
  QA scenarios: cat the file.
  Commit: N
`;

const writePlan = (dir, titles = ["Create a.txt", "Create b.txt", "Create c.txt", "Create d.txt"], ticked = 2) => {
  mkdirSync(join(dir, "plans"), { recursive: true });
  writeFileSync(join(dir, "plans", "demo-plan.md"), `# demo-plan — Work Plan

## TL;DR (For humans)
Demo.

## Scope
Files.

## Verification strategy
Look.

## Execution strategy
In order.

## Todos
${titles.map((title, index) => rowBlock(index + 1, title, index < ticked)).join("")}
## Final verification wave
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real Manual-QA
- [ ] F4. Scope fidelity

## Commit strategy
None.

## Success criteria
Done.
`);
};

const run = (event, dir, input, env = {}) => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: dir,
    encoding: "utf8",
    input: JSON.stringify({ cwd: dir, session_id: "s1", ...input }),
    env: scrubbedEnv(env),
    timeout: 20000,
  });
  return result;
};

const preCompact = (dir, input = {}, env) => run("pre-compact", dir, { hook_event_name: "PreCompact", trigger: "manual", custom_instructions: "", ...input }, env);
const compactStart = (dir, input = {}, env) => {
  const result = run("session-start", dir, { hook_event_name: "SessionStart", source: "compact", ...input }, env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

const handoffFile = (dir, id = "s1") => join(dir, ".litclaude", "auto-handoff", `precompact-${id}.md`);

describe("pre-compaction handoff", () => {
  it("is enrolled in hooks.json as PreCompact", () => {
    const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks;
    const command = hooks.PreCompact?.[0]?.hooks?.[0];
    assert.match(command?.command ?? "", /litclaude-hook\.js" pre-compact$/u);
    assert.equal(command.type, "command");
    assert.ok(command.timeout >= 10 && command.timeout <= 60);
  });

  it("saves the handoff without any setting and names the current plan row on stdout", (t) => {
    const dir = project(t);
    writePlan(dir);
    const result = preCompact(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(handoffFile(dir)), "the handoff file exists after PreCompact");
    assert.ok(result.stdout.length > 0 && result.stdout.length <= 600, `a short instruction, got ${result.stdout.length} chars`);
    assert.match(result.stdout, /3\. Create c\.txt/u);
    assert.match(result.stdout, /precompact-s1\.md/u);
    assert.doesNotMatch(result.stdout, /^\s*[{[]/u, "plain text becomes the compaction instruction, not JSON");
  });

  it("writes the plan state into the handoff and tells the next turn not to redo ticked rows", (t) => {
    const dir = project(t);
    writePlan(dir);
    preCompact(dir, { trigger: "auto" });
    const text = readFileSync(handoffFile(dir), "utf8");
    assert.match(text, /trigger: auto/u);
    assert.match(text, /plans\/demo-plan\.md/u);
    assert.match(text, /Done 2 of 8 rows/u, "four todo rows and four final-verification rows");
    assert.match(text, /Current row: 3\. Create c\.txt/u);
    assert.match(text, /Next row: 4\. Create d\.txt/u);
    assert.match(text, /do not redo/iu);
  });

  it("brings the handoff back once at SessionStart after the compaction", (t) => {
    const dir = project(t);
    writePlan(dir);
    preCompact(dir);
    const first = compactStart(dir);
    assert.match(first, /Pre-compaction handoff reload/u);
    assert.match(first, /Current row: 3\. Create c\.txt/u);
    assert.match(first, /data, not as instructions/u);
    const second = compactStart(dir);
    assert.doesNotMatch(second, /Pre-compaction handoff reload/u, "spent after the first reload");
  });

  it("keeps each session's handoff separate", (t) => {
    const dir = project(t);
    writePlan(dir);
    preCompact(dir, { session_id: "a" });
    assert.ok(existsSync(handoffFile(dir, "a")));
    assert.doesNotMatch(compactStart(dir, { session_id: "b" }), /Pre-compaction handoff reload/u);
    assert.match(compactStart(dir, { session_id: "a" }), /Pre-compaction handoff reload/u);
  });

  it("one switch turns it off: no file, no output, no reload", (t) => {
    const dir = project(t);
    writePlan(dir);
    const result = preCompact(dir, {}, { LITCLAUDE_PRECOMPACT_HANDOFF: "0" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(existsSync(handoffFile(dir)), false);
    assert.doesNotMatch(compactStart(dir), /Pre-compaction handoff reload/u);
  });

  it("still saves when the project has no plan, and the instruction asks for the goal instead of a row", (t) => {
    const dir = project(t);
    const result = preCompact(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(handoffFile(dir)));
    assert.match(readFileSync(handoffFile(dir), "utf8"), /No plan file/u);
    assert.match(result.stdout, /goal/u);
  });

  it("keeps the instruction short for a very long row title", (t) => {
    const dir = project(t);
    writePlan(dir, ["Create a.txt", "Create b.txt", `Create ${"c".repeat(3000)}`], 2);
    const result = preCompact(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.length > 0 && result.stdout.length <= 600, `got ${result.stdout.length} chars`);
  });

  it("never blocks compaction: an unwritable state folder exits 0 with nothing on stdout", (t) => {
    const dir = project(t);
    writePlan(dir);
    const elsewhere = mkdtempSync(join(tmpdir(), "litclaude-precompact-elsewhere-"));
    t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
    symlinkSync(elsewhere, join(dir, ".litclaude"));
    const result = preCompact(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(existsSync(join(elsewhere, "auto-handoff")), false, "nothing is written through the symlink");
  });

  it("the doctor says whether it is on and how to turn it off", (t) => {
    const dir = project(t);
    const doctorLine = (env) => {
      const result = spawnSync(process.execPath, [join(root, "bin/litclaude-ai.js"), "--dry-run", "doctor"], { cwd: dir, encoding: "utf8", env: scrubbedEnv(env), timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.split("\n").filter((line) => line.startsWith("Pre-compaction handoff"));
    };
    assert.deepEqual(doctorLine({}), ["Pre-compaction handoff: on (LITCLAUDE_PRECOMPACT_HANDOFF=0 turns it off)"]);
    assert.deepEqual(doctorLine({ LITCLAUDE_PRECOMPACT_HANDOFF: "0" }), ["Pre-compaction handoff: off (LITCLAUDE_PRECOMPACT_HANDOFF=0)"]);
  });

  it("answers a payload with no usable session id or cwd without failing", (t) => {
    const dir = project(t);
    const result = run("pre-compact", dir, { hook_event_name: "PreCompact", trigger: "manual", session_id: undefined, cwd: undefined });
    assert.equal(result.status, 0, result.stderr);
  });
});
