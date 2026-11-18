import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceFiles } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { LIT_SKILL_IDS } from "../plugins/litclaude/lib/mod/skills.mjs";
import { DISCIPLINE_ENTRY } from "../plugins/litclaude/lib/mod/workflow.mjs";
import { costLine, estimate } from "../plugins/litclaude/skills/ultra-brainstorm/scripts/estimate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const skillDir = join(pluginRoot, "skills", "ultra-brainstorm");
const temp = mkdtempSync(join(tmpdir(), "litclaude-ultra-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const runHook = (prompt) => {
  const cwd = join(temp, "proj");
  mkdirSync(cwd, { recursive: true });
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: join(temp, "home"), CLAUDE_CONFIG_DIR: join(temp, "claude"), LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud"), LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", NO_COLOR: "1" },
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd }),
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  return { context: parsed.hookSpecificOutput.additionalContext, route: /LIT IGNITED · ([a-z-]+)/u.exec(parsed.systemMessage ?? "")?.[1] ?? null };
};

describe("ultra-brainstorm enrollment", () => {
  it("is a canonical skill with its command, references, estimator and pinned resources", () => {
    assert.ok(canonicalSkillIds.includes("ultra-brainstorm"));
    assert.ok(LIT_SKILL_IDS.includes("ultra-brainstorm"), "LIT card chip");
    assert.deepEqual(DISCIPLINE_ENTRY["ultra-brainstorm"], { family: "main", stage: "interview" });
    assert.ok(existsSync(join(pluginRoot, "commands", "ultra-brainstorm.md")));
    for (const path of ["SKILL.md", "references/workflow-script.md", "references/lenses.md", "scripts/estimate.mjs"]) {
      assert.ok(existsSync(join(skillDir, path)), path);
      assert.ok(canonicalSkillResourceFiles.includes(`skills/ultra-brainstorm/${path}`), `${path} is pinned and installed`);
    }
  });

  it("ships at least 30 lenses and a Workflow script that parses as a module", () => {
    const lenses = readFileSync(join(skillDir, "references", "lenses.md"), "utf8").match(/^\d+\. /gmu);
    assert.ok(lenses.length >= 30, `${lenses.length} lenses`);
    const script = /```js\n([\s\S]+?)\n```/u.exec(readFileSync(join(skillDir, "references", "workflow-script.md"), "utf8"))[1];
    assert.match(script, /^export const meta = \{/u);
    assert.match(script, /model: models\.idea, effort: 'low'/u, "idea agents run cheap");
    assert.match(script, /Use no tools/u, "idea agents use no tools");
    assert.doesNotMatch(script, /Date\.now\(\)|Math\.random\(\)|new Date\(\)/u, "the Workflow runtime refuses these");
    // The Workflow runtime runs the body inside an async function (top-level await and return).
    const AsyncFunction = (async () => {}).constructor;
    assert.doesNotThrow(() => new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "args", "budget", script.replace(/^export /u, "")));
  });
});

describe("ultra-brainstorm launch question cost line", () => {
  it("counts one reducer per 30 idea agents and one judge", () => {
    // Calibrated on the 2026-11-18 real 100-agent run (input incl. the system/tool prompt and cache reads,
    // plus output): idea agents 77k each (p10-p90 76.8k-78.2k), reducers 110k-266k, the judge 140k;
    // 8.58M in all. The range keeps that run inside it.
    assert.deepEqual(estimate(100), { agents: 100, reducers: 4, judges: 1, tokens: { low: 7_550_000, high: 9_760_000 } });
    assert.equal(costLine(100), "100 idea agents (haiku, low) + 4 reducers (sonnet) + 1 judge (opus) ≈ 7.6-9.8M tokens");
    const measured = 7_708_513 + 733_542 + 139_574;
    assert.ok(estimate(100).tokens.low <= measured && measured <= estimate(100).tokens.high, "the real run sits inside the range");
    assert.equal(estimate(300).reducers, 10);
    assert.deepEqual(estimate(300).tokens, { low: 300 * 70_000 + 10 * 110_000 + 110_000, high: 300 * 85_000 + 10 * 270_000 + 180_000 });
  });

  it("refuses a non-number, zero and a run over one Workflow's agent cap", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 901]) assert.throws(() => estimate(bad), String(bad));
    const cli = spawnSync(process.execPath, [join(skillDir, "scripts", "estimate.mjs"), "300"], { encoding: "utf8" });
    assert.equal(cli.stdout.trim(), costLine(300));
    assert.equal(spawnSync(process.execPath, [join(skillDir, "scripts", "estimate.mjs"), "lots"], { encoding: "utf8" }).status, 64);
  });

  it("a plain no to the launch question ends it at once; silence still launches nothing (R2)", () => {
    const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const command = readFileSync(join(skillDir, "..", "..", "commands", "ultra-brainstorm.md"), "utf8");
    const { context } = runHook("ultra-brainstorm names for my app");
    for (const [name, text] of [["skill", skill], ["command", command], ["mode contract", context]]) {
      assert.match(text, /plain `?no`? ends it at once/iu, `${name}: no ends the skill without a second ask`);
      assert.match(text, /silence/iu, `${name}: silence still launches nothing`);
    }
  });

  it("an answer that is the picked option's full label counts as its number; two numbers ask again (R6)", () => {
    // Claude Code's AskUserQuestion returns the label verbatim: `→ 100 (recommended)` on the real host.
    const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    assert.match(skill, /full label[^.]*`100 \(recommended\)`[^.]*counts as that number/u);
    assert.match(skill, /names two counts[^.]*ask again/u);
  });

  it("the skill quotes the estimator's own line", () => {
    assert.ok(readFileSync(join(skillDir, "SKILL.md"), "utf8").includes(costLine(100)));
  });
});

describe("ultra-brainstorm routing", () => {
  it("routes the three documented forms", () => {
    for (const prompt of ["ultra-brainstorm names for my app", "lit ultra-brainstorm names for my app", "lit ultra brainstorm 앱 이름 후보", "$ultra-brainstorm names"]) {
      const { context, route } = runHook(prompt);
      assert.equal(route, "ultra-brainstorm", prompt);
      assert.match(context, /Mode contract: ultra-brainstorm/u, prompt);
      assert.match(context, /ask ONE launch question first/u, prompt);
      assert.doesNotMatch(context, /\/goal Continue until/u, "no goal line");
    }
  });

  it("leaves the plain brainstorm route and inert forms alone", () => {
    assert.equal(runHook("lit brainstorm names for my app").route, "lit-brainstorm");
    for (const prompt of ["/litclaude:ultra-brainstorm names", "/lit ultra-brainstorm names", "`lit ultra-brainstorm names`", "an ultra brainstorm would be fun"]) {
      assert.doesNotMatch(runHook(prompt).context, /Mode contract: ultra-brainstorm/u, prompt);
    }
  });
});
