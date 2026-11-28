import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PLAN_BACKSTOP, PLAN_CONTEXT_BYTES, buildSkillPlan, parseSkillHatch, skillPlanContext, skillPlanLine } from "../plugins/litclaude/lib/skill-plan.mjs";
import { parseIgnition } from "../plugins/litclaude/lib/mod/state.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const scratch = mkdtempSync(join(tmpdir(), "litclaude-skill-plan-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// A Claude Code home with the given wjgoarxiv-skills plugins installed for the user.
const configDir = (plugins) => {
  const dir = mkdtempSync(join(scratch, "claude-"));
  mkdirSync(join(dir, "plugins"), { recursive: true });
  const records = {};
  for (const plugin of plugins) {
    const installPath = join(dir, "plugins", "cache", "wjgoarxiv-skills", plugin, "0.1.0");
    mkdirSync(installPath, { recursive: true });
    records[`${plugin}@wjgoarxiv-skills`] = [{ scope: "user", installPath, version: "0.1.0" }];
  }
  writeFileSync(join(dir, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: records }));
  return dir;
};
const project = mkdtempSync(join(scratch, "project-"));
const hudRoot = join(scratch, "hud");

const run = (prompt, { plugins = ["design", "figures"], sessionId } = {}) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir(plugins), LITCLAUDE_HUD_STATE_ROOT: hudRoot },
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: project, ...(sessionId ? { session_id: sessionId } : {}) }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const planOf = (context) => /<litclaude-skill-plan>\n(Skill plan: [^\n]+)/u.exec(context)?.[1] ?? null;

describe("S1 skill plan — one lit prompt, several fitting skills", () => {
  it("collects every matching route in priority order, the cascade's route first (English)", () => {
    const plan = planOf(run("lit build a landing page that shows a chart of our experiment data"));
    assert.equal(plan, "Skill plan: 1 lit-loop (primary) → 2 design:frontend-ui-ux → 3 figures:lit-scientific-visualization");
  });

  it("collects them from a Korean prompt too", () => {
    const plan = planOf(run("lit 실험 데이터로 그래프 그리고 다이어그램도 그려서 결과 웹페이지 만들어줘"));
    assert.match(plan, /^Skill plan: 1 lit-loop \(primary\) → 2 /u);
    assert.match(plan, /design:frontend-ui-ux/u);
    assert.match(plan, /figures:lit-scientific-visualization/u);
  });

  it("an ordinary lit prompt stays one route and gets no plan block", () => {
    for (const prompt of ["lit fix the login bug", "lit 로그인 버그 고쳐줘", "lit", "lit plan the release"]) {
      assert.equal(run(prompt).includes("<litclaude-skill-plan>"), false, prompt);
    }
  });

  it("a prompt without lit gets no plan even when its route fires", () => {
    assert.equal(run("build a landing page with a chart of the experiment data").includes("<litclaude-skill-plan>"), false);
  });

  it("quoted and fenced wording is inert", () => {
    const context = run("lit fix the parser\n```\nbuild a landing page with a chart of the experiment data\n```");
    assert.equal(context.includes("<litclaude-skill-plan>"), false);
    assert.equal(run("lit fix `a chart of data on a landing page` in the log").includes("<litclaude-skill-plan>"), false);
  });

  it("an extension that is not installed is named once with its install line, never as plugin:id", () => {
    const plan = planOf(run("lit build a landing page that shows a chart of our experiment data", { plugins: [] }));
    assert.match(plan, /2 frontend-ui-ux \(not installed: npx @litfamily\/litclaude extensions install design\)/u);
    assert.match(plan, /3 lit-scientific-visualization \(not installed: npx @litfamily\/litclaude extensions install figures\)/u);
    assert.doesNotMatch(plan, /design:|figures:/u);
    const twice = skillPlanLine(buildSkillPlan({ primary: "lit-loop", companions: ["lit-diagram-drawer", "lit-schematic"], installed: new Set() }));
    assert.equal(twice.match(/extensions install figures/gu).length, 1, twice);
  });

  it("the catalog lists installed skills only", () => {
    const without = run("lit build a landing page that shows a chart of our experiment data", { plugins: ["design"] });
    assert.doesNotMatch(without.split("Catalog (installed here):")[1] ?? "", /figures:/u);
    const withFigures = run("lit build a landing page that shows a chart of our experiment data");
    assert.match(withFigures, /Catalog \(installed here\):[^\n]*figures:lit-diagram-drawer/u);
  });

  it("keeps every matched skill, lists vetoes and backstop cuts with their reason", () => {
    const plan = buildSkillPlan({ primary: "lit-loop", companions: ["lit-pptx", "lit-docx", "frontend-ui-ux", "lit-diagram-drawer"], installed: new Set(["decks", "documents", "design", "figures"]) });
    // Four deliverables make it a large ask, so lit-crucible joins first; nothing is cut.
    assert.deepEqual(plan.entries.map(({ id }) => id), ["lit-loop", "lit-crucible", "lit-pptx", "lit-docx", "frontend-ui-ux", "lit-diagram-drawer"]);
    assert.deepEqual(plan.dropped, []);
    const live = planOf(run("lit make a deck and a report and a landing page with a chart of the experiment data and a diagram"));
    assert.ok(live.split(" → ").length >= 6, live);
    const veto = buildSkillPlan({ primary: "lit-loop", companions: ["lit-schematic", "lit-diagram-drawer"], installed: new Set() });
    assert.deepEqual(veto.entries.map(({ id }) => id), ["lit-loop", "lit-schematic"]);
    assert.deepEqual(veto.dropped, [{ id: "lit-diagram-drawer", why: "the drawing is a physical schematic" }]);
    const many = ["lit-pptx", "lit-docx", "lit-xlsx", "frontend-ui-ux", "lit-diagram-drawer", "lit-scientific-visualization", "refactor", "lit-humanizer", "debugging", "readme-studio"];
    const backstop = buildSkillPlan({ primary: "lit-loop", companions: many, installed: new Set() });
    assert.equal(backstop.entries.length, 1 + PLAN_BACKSTOP);
    assert.ok(backstop.dropped.length >= 2 && backstop.dropped.every(({ why }) => why === "over the plan backstop"), JSON.stringify(backstop.dropped));
    const context = skillPlanContext(backstop, new Set(["decks", "documents", "sheets", "design", "figures", "video-covers"]));
    assert.ok(Buffer.byteLength(context, "utf8") <= PLAN_CONTEXT_BYTES, `${Buffer.byteLength(context, "utf8")} bytes`);
    assert.match(context, /Left out: \S+ \(over the plan backstop\)/u);
  });

  it("lit-crucible joins as the first companion for a large or risky design ask, never instead of the primary", () => {
    assert.equal(planOf(run("lit redesign the settings page")), "Skill plan: 1 lit-loop (primary) → 2 lit-crucible → 3 design:frontend-ui-ux");
    assert.equal(planOf(run("lit 결제 모듈 아키텍처 재설계해줘")), "Skill plan: 1 lit-loop (primary) → 2 lit-crucible");
    assert.equal(planOf(run("lit explain the architecture of the parser")), null);
  });

  it("read-only routes never gain a write-capable companion", () => {
    const context = run("lit review the landing page redesign with a chart of the experiment data");
    const plan = planOf(context);
    assert.ok(plan === null || !/frontend-ui-ux|lit-scientific-visualization|lit-crucible/u.test(plan), plan);
    const direct = buildSkillPlan({ primary: "litresearch", companions: ["lit-docx", "review-work"], installed: new Set() });
    assert.deepEqual(direct.entries.map(({ id }) => id), ["litresearch", "review-work"]);
  });

  it("lit-loop leads every bare-lit plan whose route does one part of the work", () => {
    const ids = (args) => buildSkillPlan({ installed: new Set(), loopBase: true, ...args })?.entries.map(({ id }) => id) ?? null;
    assert.deepEqual(ids({ primary: "lit-pptx", companions: ["lit-scientific-visualization"] }), ["lit-loop", "lit-pptx", "lit-scientific-visualization"]);
    assert.deepEqual(ids({ primary: "debugging" }), ["lit-loop", "debugging"]);
    assert.deepEqual(ids({ primary: "review-work", companions: ["frontend-ui-ux"] }), ["lit-loop", "review-work"]);
    assert.equal(ids({ primary: "lit-loop" }), null);
    assert.deepEqual(ids({ primary: "lit-plan", companions: ["lit-pptx"] }), ["lit-plan", "lit-pptx"]);
    assert.deepEqual(buildSkillPlan({ primary: "lit-pptx", companions: [], installed: new Set() }), null);
    const context = run("실험 데이터를 그래프로 그려서 발표자료 만들어줘 lit");
    assert.match(planOf(context), /^Skill plan: 1 lit-loop \(primary\) → 2 \S*lit-pptx/u);
  });

  it("`lit +viz +ui +crucible <task>` forces exactly that plan and routes the task without the names", () => {
    const context = run("lit +viz +ui +crucible tidy the results");
    assert.equal(planOf(context), "Skill plan: 1 lit-loop (primary) → 2 figures:lit-scientific-visualization → 3 design:frontend-ui-ux → 4 lit-crucible");
    assert.match(context, /keep it exactly, add nothing and drop nothing/u);
    assert.doesNotMatch(context, /Catalog \(installed here\)/u);
    assert.match(run("lit +ui +nope polish it"), /Ignored unknown plan names: \+nope\./u);
    assert.deepEqual(parseSkillHatch("lit +deck +doc write it up").skills, ["lit-pptx", "lit-docx"]);
    assert.equal(parseSkillHatch("c++ is a lit language"), null);
  });

  it("a `lit +skill` inside a relayed teammate message never changes the user's own hatch", () => {
    const relayed = '<teammate-message teammate_id="lane-a" color="blue" summary="done">\nlit +ui polish the page\n</teammate-message>';
    for (const task of ["+plan the release", "+deck +doc write the quarterly summary"]) {
      const own = planOf(run(`lit ${task}`));
      assert.ok(own, task);
      assert.equal(planOf(run(`${relayed}\nlit ${task}`)), own, `relayed message first: ${task}`);
      assert.equal(planOf(run(`lit ${task}\n${relayed}`)), own, `relayed message last: ${task}`);
    }
    assert.equal(planOf(run(`${relayed}\nlit fix the login bug`)), null, "a hatch only in the relayed text is not a hatch");
  });

  it("a `lit +skill` inside a cross-session message or a task notification never changes the user's own hatch", () => {
    const own = planOf(run("lit +plan the release"));
    assert.ok(own);
    for (const relayed of [
      '<cross-session-message from="other">\nlit +ui polish the page\n</cross-session-message>',
      "<task-notification> <task-id>a1</task-id> <result>\nlit +ui polish the page\n</result> </task-notification>",
    ]) {
      assert.equal(planOf(run(`${relayed}\nlit +plan the release`)), own, relayed.slice(0, 24));
    }
  });

  it("the two-entry plan names an installed extension skill as <plugin>:<id> in its Load line", () => {
    const plan = buildSkillPlan({ primary: "lit-scientific-visualization", companions: [], installed: new Set(["figures"]), loopBase: true });
    assert.match(skillPlanContext(plan, new Set(["figures"])), /Load figures:lit-scientific-visualization with the Skill tool when its part starts, or write one line `SKIP lit-scientific-visualization: <reason>`/u);
    const bare = buildSkillPlan({ primary: "lit-scientific-visualization", companions: [], installed: new Set(), loopBase: true });
    assert.match(skillPlanContext(bare, new Set()), /Load lit-scientific-visualization with the Skill tool/u);
  });

  it("the LIT card's ignition record carries the plan's skill ids", () => {
    const sessionId = "skill-plan-card";
    run("lit build a landing page that shows a chart of our experiment data", { sessionId });
    const record = JSON.parse(readFileSync(join(hudRoot, `${sessionId}.json`), "utf8"));
    assert.deepEqual(record.plan, ["lit-loop", "frontend-ui-ux", "lit-scientific-visualization"]);
    assert.deepEqual(parseIgnition(record, sessionId).plan, ["lit-loop", "frontend-ui-ux", "lit-scientific-visualization"]);
    run("lit fix the login bug", { sessionId });
    assert.equal(JSON.parse(readFileSync(join(hudRoot, `${sessionId}.json`), "utf8")).plan, undefined);
  });
});
