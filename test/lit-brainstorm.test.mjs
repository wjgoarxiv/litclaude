import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceFiles } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { LIT_SKILL_IDS } from "../plugins/litclaude/lib/mod/skills.mjs";
import { buildPlanSkeleton } from "../scripts/scaffold-plan.mjs";
import { stripAnsi } from "../scripts/strip-ansi.mjs";
import { assertNoWorkflowActivationContext } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const skillDir = join(pluginRoot, "skills", "lit-brainstorm");
const read = (path) => readFileSync(join(root, path), "utf8");

let temp;
let env;
let counter = 0;

before(() => {
  temp = mkdtempSync(join(tmpdir(), "litclaude-brainstorm-"));
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

const projectCwd = () => {
  const cwd = join(temp, `proj-${counter++}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package.json"), "{}\n");
  return cwd;
};

const runHook = (prompt, cwd = projectCwd()) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    env,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd }),
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  return { context: parsed.hookSpecificOutput.additionalContext, message: stripAnsi(parsed.systemMessage ?? "") };
};

const routeOf = (prompt, cwd) => {
  const { context, message } = runHook(prompt, cwd);
  return { context, route: /LIT IGNITED · ([a-z-]+)/u.exec(message)?.[1] ?? null };
};

describe("lit-brainstorm enrollment", () => {
  it("is a canonical skill with its own command, references and pinned resources", () => {
    assert.ok(canonicalSkillIds.includes("lit-brainstorm"), "canonical skill catalog");
    assert.ok(LIT_SKILL_IDS.includes("lit-brainstorm"), "LIT card skill ids");
    assert.ok(existsSync(join(pluginRoot, "commands", "lit-brainstorm.md")), "slash command file");
    for (const path of [
      "skills/lit-brainstorm/SKILL.md",
      "skills/lit-brainstorm/references/idea-lenses.md",
      "skills/lit-brainstorm/references/scoring-and-convergence.md",
      "skills/lit-brainstorm/references/session-notes-template.md",
    ]) {
      assert.ok(existsSync(join(pluginRoot, path)), `${path} ships`);
      assert.ok(canonicalSkillResourceFiles.includes(path), `${path} is pinned and installed`);
    }
  });

  it("lists the command, the skill and the routes in the docs a user reads", () => {
    for (const path of ["docs/hooks.md", "docs/guide.md", "docs/guide_ko-KR.md"]) {
      assert.match(read(path), /lit brainstorm/u, `${path} names the route`);
    }
    for (const path of ["docs/skills.md", "docs/skills_ko-KR.md"]) {
      assert.match(read(path), /<code>lit-brainstorm<\/code>/u, `${path} has the row`);
    }
    assert.ok(existsSync(join(root, "docs", "assets", "skills", "lit-brainstorm.webp")), "skill snapshot");
  });

  it("states its mode contract in the prompt hook", () => {
    assert.match(read("plugins/litclaude/bin/litclaude-hook.js"), /Mode contract: lit-brainstorm is open-ended ideation/u);
  });
});

describe("lit-brainstorm routing", () => {
  it("routes the brainstorm words to lit-brainstorm, not to deep-interview or lit-plan", () => {
    for (const prompt of [
      "lit brainstorm a name for my app",
      "lit brainstorming launch channels for the beta",
      "lit ideation for the onboarding flow",
      "lit ideate on pricing tiers",
      "lit idea a weekend project for my kid",
      "lit ideas for the team offsite",
      "lit 브레인스토밍 앱 이름 후보",
      "brainstorm a name for my app lit",
      "lit-brainstorm a name for my app",
      "$lit-brainstorm a name for my app",
    ]) {
      const { context, route } = routeOf(prompt);
      assert.equal(route, "lit-brainstorm", `${prompt} should route to lit-brainstorm`);
      assert.match(context, /Skill\(lit-brainstorm\)/u, prompt);
      assert.match(context, /\/litclaude:lit-brainstorm/u, prompt);
      assert.match(context, /Mode contract: lit-brainstorm/u, prompt);
      assert.doesNotMatch(context, /Skill\((deep-interview|lit-plan)\)/u, prompt);
    }
  });

  it("names the installed SKILL.md and no /goal line", () => {
    const { context } = runHook("lit brainstorm a name for my app");
    assert.match(context, /<litclaude-skill-body name="lit-brainstorm">\s*Load this exact installed entrypoint "[^"]+\/skills\/lit-brainstorm\/SKILL\.md"/u);
    assert.doesNotMatch(context, /\/goal Continue until/u, "an ideation turn binds no goal");
  });

  it("keeps the neighbouring routes where they were", () => {
    for (const [prompt, expected] of [
      ["lit plan the brainstorm schedule", "lit-plan"],
      ["lit review the brainstorm notes", "review-work"],
      ["lit research name collisions for a coffee app", "litresearch"],
      ["lit goal ship the idea generator", "litgoal"],
      ["deep-interview a mobile app idea", "deep-interview"],
      ["lit fix the idea generator crash", "lit-loop"],
      ["lit pick the ideal batch size", "lit-loop"],
    ]) {
      assert.equal(routeOf(prompt).route, expected, prompt);
    }
  });

  it("does not activate on slash forms, code spans, or the words without lit", () => {
    for (const prompt of [
      "/lit-brainstorm a name",
      "/litclaude:lit-brainstorm a name",
      "/lit brainstorm a name",
      "`lit brainstorm a name`",
      "brainstorm a name for my app",
      "I have an idea for the login page",
    ]) {
      const { context, message } = runHook(prompt);
      assert.equal(message, "", `${prompt} should not ignite`);
      assertNoWorkflowActivationContext(context, prompt);
    }
  });

  it("carries a repeat of the same discipline as a short note", () => {
    const cwd = projectCwd();
    const sid = `brainstorm-reentry-${counter++}`;
    const send = (prompt) => {
      const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
        cwd,
        encoding: "utf8",
        env,
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd, session_id: sid }),
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    };
    assert.match(send("lit brainstorm a name for my app"), /Load this exact installed entrypoint/u);
    const repeat = send("lit brainstorm more with a playful tone");
    assert.match(repeat, /lit-brainstorm is already active/u);
    assert.doesNotMatch(repeat, /Load this exact installed entrypoint/u);
  });
});

describe("lit-brainstorm skill depth", () => {
  const skill = () => readFileSync(join(skillDir, "SKILL.md"), "utf8");

  it("is a dense divergent-then-convergent workflow, not a stub", () => {
    const text = skill();
    assert.ok(Buffer.byteLength(text, "utf8") >= 18_000, `SKILL.md is ${Buffer.byteLength(text, "utf8")} bytes`);
    assert.match(text, /^---\nname: lit-brainstorm\n/u);
    for (const heading of [
      "## When to use lit-brainstorm",
      "## How to start it in Claude Code",
      "## Session notes",
      "## Phase 0: Frame",
      "## Phase 1: Diverge",
      "## Phase 2: Cluster and dedupe",
      "## Phase 3: Score",
      "## Phase 4: Converge",
      "## Phase 5: Ask",
      "## Phase 6: Hand off",
      "## Parallel idea lanes",
      "## Stop rules",
      "## Safety boundaries",
      "## Report shape",
      "## Failure modes",
      "## Worked example",
      "## Final checklist",
    ]) {
      assert.ok(text.includes(heading), `missing ${heading}`);
    }
  });

  it("separates itself from its neighbours and hands off without implementing", () => {
    const text = skill();
    for (const neighbour of ["deep-interview", "lit-plan", "lit-crucible", "litresearch"]) {
      assert.match(text, new RegExp(`\`${neighbour}\``, "u"), `compares itself with ${neighbour}`);
    }
    assert.match(text, /never implements/iu);
    assert.match(text, /AskUserQuestion/u);
    assert.match(text, /\.litclaude\/brainstorm\//u);
    assert.match(text, /Agent tool/u);
    assert.match(text, /TASK:[\s\S]*DELIVERABLE[\s\S]*SCOPE[\s\S]*VERIFY/u);
    assert.match(text, /lit brainstorm[\s\S]*lit ideation[\s\S]*lit idea\b/u);
    assert.match(text, /\/litclaude:lit-brainstorm/u);
    assert.match(text, /hypothes[ie]s/u);
  });

  it("resolves every references/ path it names, and the references carry real content", () => {
    const text = skill();
    const named = [...new Set([...text.matchAll(/references\/([a-z0-9-]+\.md)/gu)].map((match) => match[1]))];
    assert.ok(named.length >= 3, "names its reference files");
    for (const file of named) assert.ok(existsSync(join(skillDir, "references", file)), `references/${file}`);
    assert.deepEqual(readdirSync(join(skillDir, "references")).sort(), [...named].sort(), "no orphaned reference file");
    assert.ok(readFileSync(join(skillDir, "references", "idea-lenses.md"), "utf8").length >= 5_000, "idea lenses");
    assert.ok(readFileSync(join(skillDir, "references", "scoring-and-convergence.md"), "utf8").length >= 4_000, "scoring and convergence");
    assert.ok(readFileSync(join(skillDir, "references", "session-notes-template.md"), "utf8").length >= 1_500, "notes template");
  });

  it("names no sibling product or foreign harness", () => {
    const corpus = [skill(), ...readdirSync(join(skillDir, "references")).map((f) => readFileSync(join(skillDir, "references", f), "utf8"))].join("\n");
    assert.doesNotMatch(corpus, /\blit(?:hermes|codex|opencode|grok|muse)\b|spawn_agent|apply_patch/iu);
  });

  it("points deep-interview and lit-plan at it for open ideation", () => {
    const interview = readFileSync(join(pluginRoot, "skills", "deep-interview", "SKILL.md"), "utf8");
    const doNotUse = /<Do_Not_Use_When>([\s\S]*?)<\/Do_Not_Use_When>/u.exec(interview)?.[1] ?? "";
    assert.match(doNotUse, /open-ended brainstorming[\s\S]*`lit-brainstorm`/u);
    assert.match(readFileSync(join(pluginRoot, "commands", "deep-interview.md"), "utf8"), /lit-brainstorm/u);
    assert.match(readFileSync(join(pluginRoot, "skills", "lit-plan", "SKILL.md"), "utf8"), /`lit-brainstorm`/u);
  });

  it("ships a command that loads the skill and keeps the contract shape", () => {
    const command = readFileSync(join(pluginRoot, "commands", "lit-brainstorm.md"), "utf8");
    assert.match(command, /^---\n[\s\S]*description:[\s\S]*---\n/u);
    assert.match(command, /## #contract\.activation/u);
    assert.match(command, /Use the `lit-brainstorm` skill/u);
    assert.doesNotMatch(command, /\$ARGUMENTS/u);
  });
});

describe("litgoal and review-work say what they are for", () => {
  const SENTENCE = "litgoal sets and keeps the finish line; lit-loop and start-work run toward it.";

  it("routes litgoal under its own skill name and states the finish-line meaning everywhere it is described", () => {
    for (const prompt of ["litgoal ship the importer", "lit goal ship the importer"]) {
      const { context, route } = routeOf(prompt);
      assert.equal(route, "litgoal", prompt);
      assert.match(context, /Skill\(litgoal\)/u);
      assert.ok(context.includes(SENTENCE), `${prompt}: the mode contract carries the sentence`);
    }
    assert.ok(read("plugins/litclaude/skills/litgoal/SKILL.md").includes(SENTENCE), "skill");
    assert.ok(read("plugins/litclaude/commands/litgoal.md").includes(SENTENCE), "command");
    assert.ok(read("docs/hooks.md").includes(SENTENCE), "hooks doc");
    assert.match(read("docs/skills.md"), /<code>lit-loop<\/code> and <code>start-work<\/code> run toward it/u);
  });

  it("names plan review and work review, with the auto-pick rule, in the skill and the command", () => {
    for (const path of ["plugins/litclaude/skills/review-work/SKILL.md", "plugins/litclaude/commands/review-work.md"]) {
      const text = read(path);
      assert.match(text, /\*\*Plan review\*\*/u, `${path} names plan review`);
      assert.match(text, /\*\*Work review\*\*/u, `${path} names work review`);
      assert.match(text, /lit review plan/u, `${path} shows the forced plan form`);
      assert.match(text, /lit review work/u, `${path} shows the forced work form`);
      assert.match(text, /first line of the report/iu, `${path} says the mode goes on the first line`);
      assert.match(text, /neither[\s\S]*ask/iu, `${path} asks when neither exists`);
    }
    const skill = read("plugins/litclaude/skills/review-work/SKILL.md");
    assert.match(skill, /### Auto-pick/u);
    assert.match(skill, /ticked/u);
  });

  it("injects both modes and the auto-pick rule into the prompt hook", () => {
    const { context } = runHook("lit review");
    assert.match(context, /Plan review \(after lit-plan, before start-work\)/u);
    assert.match(context, /Work review \(after lit-loop or start-work\)/u);
    assert.match(context, /Auto-pick:/u);
    assert.match(context, /first line of its report/u);
  });

  it("honours a forced mode, and reports plan signals for the auto-pick", () => {
    for (const [prompt, mode] of [
      ["lit review plan", "plan review"],
      ["lit review work", "work review"],
      ["review-work plan", "plan review"],
      ["$review-work work", "work review"],
    ]) {
      assert.match(runHook(prompt).context, new RegExp(`Review mode forced by the user: ${mode}\\.`, "u"), prompt);
    }
    assert.doesNotMatch(runHook("lit review this diff").context, /Review mode forced/u);
    assert.doesNotMatch(runHook("lit review the plan quality of this diff").context, /Review mode forced/u);

    const cwd = projectCwd();
    mkdirSync(join(cwd, "plans"), { recursive: true });
    const plan = buildPlanSkeleton("demo", "clear").replaceAll(/<fill[^>]*>/gu, "done").replace("- [ ] 1. <title>", "- [ ] 1. first task");
    writeFileSync(join(cwd, "plans", "demo.md"), plan);
    const rows = plan.match(/^- \[ \] /gmu).length;
    assert.match(runHook("lit review", cwd).context, new RegExp(`Review-mode signals: plans/demo\\.md has 0 ticked and ${rows} open task row\\(s\\)\\.`, "u"));
    writeFileSync(join(cwd, "plans", "demo.md"), plan.replace("- [ ] 1. first task", "- [x] 1. first task"));
    assert.match(runHook("lit review", cwd).context, new RegExp(`Review-mode signals: plans/demo\\.md has 1 ticked and ${rows - 1} open task row\\(s\\)\\.`, "u"));
    assert.doesNotMatch(runHook("lit review", projectCwd()).context, /Review-mode signals/u, "no plan, no signal");
  });
});
