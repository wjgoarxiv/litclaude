// The lit-adhd skill and its lit-rewind alias (plans/lit-adhd.md todo 11): every route reaches
// lit-adhd through the real hook binary, near-miss words do not, recap keeps its own route, the
// skill is enrolled on every surface that lists skills, and the gauge rule (D9) is written into
// both the skill's output contract and the hook's context.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripAnsi } from "../scripts/strip-ansi.mjs";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-resources.mjs";
import { LIT_SKILL_IDS } from "../plugins/litclaude/lib/mod/skills.mjs";
import { nextStepPath, writeNextStep } from "../plugins/litclaude/lib/rewind/next-step.mjs";
import { READ_ONLY_DISCIPLINES } from "../plugins/litclaude/lib/workflow-stack.mjs";
import { README_SKILL_IMAGE_PATHS } from "../tools/check-pack-payload.mjs";
import { assertNoWorkflowActivationContext } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const hookPath = join(plugin, "bin", "litclaude-hook.js");
const skillPath = join(plugin, "skills", "lit-adhd", "SKILL.md");
const read = (path) => readFileSync(path, "utf8");

let promptCount = 0;
const runHook = (prompt, cwd, sessionId = "adhd-route-test") => {
  promptCount += 1;
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd, session_id: sessionId, prompt_id: `adhd-prompt-${promptCount}` }),
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const withProject = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-adhd-route-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};
const GAUGE_RULE = [/\[▉▉▉░░\] 3\/5/u, /both numbers are (?:real|recorded)/iu, /known facts/iu];

describe("lit-adhd routes", () => {
  it("every typed route activates lit-adhd with the read-only brief contract", () => withProject((cwd) => {
    for (const prompt of ["lit adhd", "lit rewind", "$lit-rewind", "$lit-adhd", "lit adhd 요약해줘", "lit-adhd", "lit-rewind --here", "litwork rewind"]) {
      const parsed = runHook(prompt, cwd);
      assert.match(stripAnsi(parsed.systemMessage ?? ""), /lit-adhd/u, `${prompt} should ignite lit-adhd`);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.match(context, /Skill\(lit-adhd\)/u, prompt);
      assert.match(context, /litclaude-ai rewind --brief/u, prompt);
      assert.match(context, /READ-ONLY/u, prompt);
      assert.doesNotMatch(context, /Skill\(lit-recap\)|Skill\(lit-loop\)/u, prompt);
    }
  }));

  it("near-miss words do not activate it and recap keeps its own route", () => withProject((cwd) => {
    for (const prompt of ["adhdx", "rewinding the tape", "adhd", "/litclaude:lit-rewind", "/litclaude:lit-adhd"]) {
      const parsed = runHook(prompt, cwd);
      assert.equal(parsed.systemMessage, undefined, `${prompt} should not activate`);
      assertNoWorkflowActivationContext(parsed.hookSpecificOutput.additionalContext, prompt);
    }
    // A bare `lit` still routes as it always did; the near-miss word just must not reach lit-adhd.
    for (const prompt of ["lit adhder", "lit adhdx now", "lit rewinding"]) {
      const parsed = runHook(prompt, cwd);
      assert.doesNotMatch(stripAnsi(parsed.systemMessage ?? ""), /lit-adhd/u, prompt);
      assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /Skill\(lit-adhd\)/u, prompt);
    }
    for (const prompt of ["recap", "lit recap", "리캡"]) {
      const context = runHook(prompt, cwd).hookSpecificOutput.additionalContext;
      assert.match(context, /Skill\(lit-recap\)/u, prompt);
      assert.doesNotMatch(context, /Skill\(lit-adhd\)/u, prompt);
    }
  }));

  it("a brief in the middle of a loop leaves the workflow stack alone", () => withProject((cwd) => {
    const stackFile = join(cwd, ".litclaude", "workflow-stack", "adhd-route-test.json");
    runHook("lit-loop fix the typo in README.md", cwd);
    const before = JSON.parse(read(stackFile)).frames;
    assert.equal(before.at(-1).skill, "lit-loop");
    runHook("lit adhd", cwd);
    assert.deepEqual(JSON.parse(read(stackFile)).frames, before);
    assert.ok(READ_ONLY_DISCIPLINES.includes("lit-adhd") && READ_ONLY_DISCIPLINES.includes("lit-rewind"));
  }));

  it("both slash commands exist and load the one skill", () => {
    for (const name of ["lit-adhd", "lit-rewind"]) {
      const text = read(join(plugin, "commands", `${name}.md`));
      assert.match(text, /Skill\(lit-adhd\)/u, name);
      assert.match(text, /litclaude-ai rewind --brief/u, name);
      assert.doesNotMatch(text, /^user-invocable: false$/mu, `${name} is a live alias, not a redirect`);
    }
  });
});

// `go` after a brief (todo 12): the hook reads this session's next-step record, at most 30 minutes
// old, acts on exactly that step, and deletes the record; anything else leaves `go` ordinary text.
describe("go continues the briefed next step", () => {
  const SID = "adhd-route-test";
  const writePlan = (cwd, name = "a.md") => {
    mkdirSync(join(cwd, "plans"), { recursive: true });
    writeFileSync(join(cwd, "plans", name), "# A\n\n## TODOs\n\n- [ ] 1. Do the one thing\n");
  };
  const lifecycle = (cwd) => {
    const dir = join(cwd, ".litclaude", "start-work");
    return existsSync(dir) ? readdirSync(dir, { recursive: true }).join(" ") : "";
  };
  const context = (parsed) => parsed.hookSpecificOutput.additionalContext;

  it("go with a start-plan record starts exactly that plan and consumes the record", () => withProject((cwd) => {
    writePlan(cwd);
    writePlan(cwd, "b.md");
    writeNextStep(cwd, SID, { kind: "start-plan", target: { plan: "plans/b.md" } });
    const parsed = runHook("go", cwd);
    assert.match(context(parsed), /LitClaude started start-work work-b-[0-9a-f]{8} on /u);
    assert.match(stripAnsi(parsed.systemMessage ?? ""), /start-work/u);
    assert.equal(existsSync(nextStepPath(cwd, SID)), false, "record deleted after use");
    assert.doesNotMatch(context(runHook("go", cwd)), /started start-work/u, "a second go is ordinary text");
  }));

  it("every go spelling continues; a longer prompt does not", () => withProject((cwd) => {
    for (const prompt of ["lit go", "ㄱㄱ", "고", "진행", "Go!"]) {
      writeNextStep(cwd, SID, { kind: "approve-boundary", target: { workId: "work-x", plan: "plans/a.md" } });
      assert.match(context(runHook(prompt, cwd)), /lit approve/u, prompt);
      assert.equal(existsSync(nextStepPath(cwd, SID)), false, prompt);
    }
    writeNextStep(cwd, SID, { kind: "approve-boundary", target: { workId: "work-x", plan: "plans/a.md" } });
    assert.doesNotMatch(context(runHook("go ahead and delete the tests", cwd)), /briefed next step/u);
    assert.equal(existsSync(nextStepPath(cwd, SID)), true, "an ordinary prompt leaves the record alone");
  }));

  it("go resumes this session's paused frame", () => withProject((cwd) => {
    runHook("lit-loop fix the typo in README.md", cwd);
    runHook("lit docx write the summary report", cwd);
    writeNextStep(cwd, SID, { kind: "resume-frame", target: { skill: "lit-loop", stage: "PIN" } });
    const parsed = runHook("go", cwd);
    assert.match(context(parsed), /resuming the paused lit-loop/u);
    const frames = JSON.parse(read(join(cwd, ".litclaude", "workflow-stack", `${SID}.json`))).frames;
    assert.equal(frames.at(-1).skill, "lit-loop");
    assert.equal(frames.at(-1).status, "active");
  }));

  it("go continues this session's active start-work", () => withProject((cwd) => {
    writePlan(cwd);
    assert.match(context(runHook("/litclaude:start-work plans/a.md", cwd)), /started start-work/u);
    writeNextStep(cwd, SID, { kind: "continue-work", target: { plan: "plans/a.md" } });
    assert.match(context(runHook("go", cwd)), /resuming existing work, not starting new work/u);
  }));

  it("a stale record, another session's record and a tampered target are inert", () => withProject((cwd) => {
    writePlan(cwd);
    writeNextStep(cwd, SID, { kind: "start-plan", target: { plan: "plans/a.md" } }, new Date(Date.now() - 31 * 60_000));
    assert.doesNotMatch(context(runHook("go", cwd)), /started start-work/u, "31 minutes old");
    assert.equal(lifecycle(cwd), "", "nothing initialized");
    writeNextStep(cwd, "another-session", { kind: "start-plan", target: { plan: "plans/a.md" } });
    assert.doesNotMatch(context(runHook("go", cwd)), /started start-work/u, "another session's record");
    assert.equal(existsSync(nextStepPath(cwd, "another-session")), true, "never consumed by this session");
    writeFileSync(join(cwd, "x.md"), "- [ ] 1. outside\n");
    for (const plan of ["../x.md", "plans/../x.md", "plans/missing.md", "/etc/passwd"]) {
      writeNextStep(cwd, SID, { kind: "start-plan", target: { plan } });
      const text = context(runHook("go", cwd));
      assert.doesNotMatch(text, /started start-work/u, plan);
      assert.match(text, /nothing was started/u, plan);
    }
    assert.equal(lifecycle(cwd), "", "nothing initialized");
  }));

  it("a boundary approval is never automatic", () => withProject((cwd) => {
    writeNextStep(cwd, SID, { kind: "approve-boundary", target: { workId: "work-x", plan: "plans/a.md", action: "write", root: "/tmp/x" } });
    const text = context(runHook("go", cwd));
    assert.match(text, /`lit approve`/u);
    assert.match(text, /approves nothing/u);
    assert.doesNotMatch(text, /The user approved/u);
  }));
});

describe("lit-adhd skill body and enrollment", () => {
  it("states the gauge rule in the skill's output contract and in the hook context", () => withProject((cwd) => {
    const outputs = section(read(skillPath), "## #contract.outputs");
    const context = runHook("lit adhd", cwd).hookSpecificOutput.additionalContext;
    for (const rule of GAUGE_RULE) {
      assert.match(outputs, rule, `SKILL.md #contract.outputs: ${rule}`);
      assert.match(context, rule, `adhdContext: ${rule}`);
    }
    assert.match(outputs, /never a guess/iu);
  }));

  it("carries the contract sections, references and a non-placeholder corpus", () => {
    const text = read(skillPath);
    for (const heading of ["## #contract.activation", "## #contract.inputs", "## #contract.mode_matrix", "## #contract.procedure", "## #contract.outputs", "## #contract.evidence", "## #contract.hard_stops", "## #contract.anti_patterns"]) {
      assert.ok(text.includes(heading), heading);
    }
    assert.ok(text.split(/\s+/u).length >= 1500, "SKILL.md should be a dense body");
    for (const ref of ["references/card-examples.md", "references/status-taxonomy.md"]) {
      assert.ok(text.includes(ref), `SKILL.md names ${ref}`);
      assert.ok(existsSync(join(plugin, "skills", "lit-adhd", ref)), ref);
    }
    assert.match(text, /lit recap/u, "cross-links lit-recap");
    assert.match(read(join(plugin, "skills", "lit-recap", "SKILL.md")), /lit-adhd/u, "lit-recap cross-links lit-adhd");
  });

  it("is enrolled in the catalog, the card's skill list, the resource pins, parity, README and docs", () => {
    assert.ok(canonicalSkillIds.includes("lit-adhd"), "catalog");
    assert.ok(LIT_SKILL_IDS.includes("lit-adhd"), "card skill list");
    assert.ok(canonicalSkillResourceManifest.has("skills/lit-adhd/SKILL.md"), "PINNED_TREES");
    assert.ok(canonicalSkillResourceManifest.has("skills/lit-adhd/scripts/rewind.mjs"), "PINNED_TREES script");
    assert.ok(canonicalSkillResourceManifest.has("lib/rewind/collect.mjs"), "collector pinned for the script");
    const parity = JSON.parse(read(join(root, "tools", "payload-substance-parity.json")));
    assert.ok(parity.products.p27.skills.includes("lit-adhd"), "parity p27");
    assert.equal(parity.products.p27.inventory.count, readdirSync(join(plugin, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length);
    assert.ok(README_SKILL_IMAGE_PATHS.includes("docs/assets/skills/lit-adhd.webp"), "README image");
    for (const doc of ["docs/skills.md", "docs/skills_ko-KR.md", "docs/guide.md", "docs/guide_ko-KR.md", "docs/hooks.md", "CHANGELOG.md"]) {
      assert.match(read(join(root, doc)), /lit-adhd/u, doc);
      assert.match(read(join(root, doc)), /lit-rewind/u, `${doc} names the alias`);
    }
  });
});
