import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { explainRoute } from "../plugins/litclaude/lib/route-match.mjs";

// The golden routing table for `litclaude-ai why`. Each row is [prompt, the discipline the real hook
// ignites (null = no route), kind]. The labels pin today's routing; explainRoute must agree with the
// hook on every row, so a routing change shows up here as a label change, never as a silent drift.
// A bare-lit route that does one part of the work runs as lit-loop; CASCADE pins the route the cascade chose.
const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const pluginCli = join(root, "plugins", "litclaude", "bin", "litclaude-ai");
const npmCli = join(root, "bin", "litclaude-ai.js");

const GOLDEN = [
  ["lit plan the login fix", "lit-plan", "single"],
  ["lit review the auth module", "lit-loop", "single"],
  ["lit debug the flaky upload test", "lit-loop", "single"],
  ["lit research vector databases", "lit-loop", "single"],
  ["lit set a goal for the migration", "litgoal", "single"],
  ["lit fix the null check in the parser", "lit-loop", "single"],
  ["lit workflow migrate the tests", "native-workflow", "single"],
  ["lit team mode refactor the CLI", "agent-team", "single"],
  ["lit brainstorm names for the app", "lit-brainstorm", "single"],
  ["lit ultra-brainstorm pricing models", "ultra-brainstorm", "single"],
  ["lit hijack the retry technique from this paper", "lit-hijack", "single"],
  ["handoff", "lit-handoff", "single"],
  ["lit handoff", "lit-handoff", "single"],
  ["lit deep interview the auth redesign", "deep-interview", "single"],
  ["lit interview me about the onboarding flow", "deep-interview", "single"],
  ["lit deep-interview a plan for the launch", "deep-interview", "two"],
  ["lit comprehend the scheduler", "lit-comprehend", "single"],
  ["lit adhd", "lit-adhd", "single"],
  ["lit recap", "lit-adhd", "single"],
  ["refactor the payment module", "refactor", "single"],
  ["$lit-plan the onboarding flow", "lit-plan", "single"],
  ["lit-init", "lit-init", "single"],
  ["review-work the last commit", "review-work", "single"],
  ["lit-crucible the cache design", "lit-plan", "single"],
  ["lit start work on plans/x.md", "start-work", "single"],
  ["lit make a slide deck for the onboarding session", "lit-loop", "single"],
  ["lit write a project report document", "lit-loop", "single"],
  ["lit draw a P&ID for the reactor loop", "lit-loop", "single"],
  ["lit redesign the settings page", "lit-loop", "single"],
  ["redesign the settings page layout", "frontend-ui-ux", "single"],
  ["lit find every call site of parseConfig", "lit-loop", "single"],
  ["find all import statements of lodash", "structural-search", "single"],
  ["lit render a lyric video for the chorus", "lit-loop", "single"],
  ["최신 벡터DB 조사해줘 lit", "lit-loop", "single"],
  ["lit 리캡", "lit-adhd", "single"],
  ["lit", "lit-loop", "single"],
  ["litwork tidy the logs", "litwork", "single"],
  ["comprehend the auth flow", "lit-comprehend", "single"],
  ["wikify these notes", "wikify", "single"],
  ["hello there", null, "none"],
  ["the lit-commit discussion was useful", null, "none"],
  ["autoresearch: tune the prompt", null, "none"],
  ["lit start the work queue", null, "none"],
  ["please $start-work plans/a.md", null, "none"],
  ["how does /lit-plan work", null, "none"],
  // Two routes match; the cascade order picks the first and the second is the runner-up.
  ["lit review the plan", "lit-loop", "two"],
  ["lit debug the dashboard styling", "lit-loop", "two"],
  ["lit plan the landing page redesign", "lit-plan", "two"],
  ["lit research and write a report on caching", "lit-loop", "two"],
  ["lit brainstorm a plan for the launch", "lit-brainstorm", "two"],
  // Fenced, backtick-quoted or host-authored text is set aside, so these route nowhere.
  ["```\nlit plan the login fix\n```", null, "inert"],
  ["what does `lit review` do?", null, "inert"],
  ["~~~\nlit debug the worker\n~~~", null, "inert"],
  ["see `lit workflow` here\n```js\nrefactor()\n```", null, "inert"],
  ["<task-notification>lit research finished</task-notification>", null, "inert"],
];

const CASCADE = Object.fromEntries([
  [
    "lit review the auth module",
    "review-work"
  ],
  [
    "lit debug the flaky upload test",
    "debugging"
  ],
  [
    "lit research vector databases",
    "litresearch"
  ],
  [
    "lit make a slide deck for the onboarding session",
    "lit-pptx"
  ],
  [
    "lit write a project report document",
    "lit-docx"
  ],
  [
    "lit draw a P&ID for the reactor loop",
    "lit-schematic"
  ],
  [
    "lit redesign the settings page",
    "frontend-ui-ux"
  ],
  [
    "lit find every call site of parseConfig",
    "structural-search"
  ],
  [
    "lit render a lyric video for the chorus",
    "lit-typographic-motion"
  ],
  [
    "최신 벡터DB 조사해줘 lit",
    "litresearch"
  ],
  [
    "lit review the plan",
    "review-work"
  ],
  [
    "lit debug the dashboard styling",
    "debugging"
  ],
  [
    "lit research and write a report on caching",
    "lit-docx"
  ]
]);

const temp = mkdtempSync(join(tmpdir(), "litclaude-route-why-"));
after(() => rmSync(temp, { recursive: true, force: true }));

// Spawns the real UserPromptSubmit hook in a fresh project and session, then reads the discipline it
// recorded for the HUD: the route the hook actually selected for this turn.
const hookRoute = (prompt, index) => {
  const project = join(temp, `project-${index}`);
  const state = join(temp, `hud-${index}`);
  mkdirSync(project, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: join(temp, "home"),
    LITCLAUDE_HOME: join(temp, "lit-home"),
    CLAUDE_HOME: join(temp, "claude-home"),
    CLAUDE_CONFIG_DIR: join(temp, "claude-config"),
    LITCLAUDE_HUD_STATE_ROOT: state,
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
  const input = { hook_event_name: "UserPromptSubmit", session_id: `route-why-${index}`, prompt_id: `prompt-${index}`, cwd: project, prompt };
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], { cwd: project, env, encoding: "utf8", input: JSON.stringify(input) });
  assert.equal(result.status, 0, result.stderr);
  const record = readdirSync(state).find((name) => name.endsWith(".json") && !name.includes(".activation"));
  return JSON.parse(readFileSync(join(state, record), "utf8")).discipline;
};

describe("litclaude-ai why: golden routing table", () => {
  it("holds 55 labelled prompts, with at least five two-route and five inert rows", () => {
    assert.equal(GOLDEN.length, 55);
    assert.ok(GOLDEN.filter(([, , kind]) => kind === "two").length >= 5);
    assert.ok(GOLDEN.filter(([, , kind]) => kind === "inert").length >= 5);
  });

  it("the real hook route equals explainRoute().route for every row", () => {
    GOLDEN.forEach(([prompt, expected], index) => {
      const hook = hookRoute(prompt, index);
      assert.equal(hook, expected, `hook route drifted on row ${index}`);
      assert.equal(explainRoute(prompt).route, hook, `explainRoute disagrees with the hook on row ${index}`);
    });
  });

  it("keeps the cascade's route for a bare-lit route that runs as lit-loop", () => {
    for (const [prompt, route] of Object.entries(CASCADE)) assert.equal(explainRoute(prompt).cascadeRoute, route, prompt);
    assert.equal(explainRoute("lit plan the login fix").cascadeRoute, undefined);
    assert.equal(explainRoute("refactor the payment module").cascadeRoute, undefined);
  });

  it("names a rule for every routed row and a different runner-up for every two-route row", () => {
    GOLDEN.forEach(([prompt, expected, kind], index) => {
      const explained = explainRoute(prompt);
      if (expected !== null) assert.match(explained.ruleId ?? "", /^[a-z-]+:[a-z0-9-]+$/u, `row ${index}`);
      if (kind === "two") {
        assert.ok(explained.runnerUp, `row ${index} should have a runner-up`);
        assert.notEqual(explained.runnerUp.route, explained.route, `row ${index}`);
      }
    });
    assert.equal(explainRoute("lit plan the login fix").ruleId, "natural:plan");
    assert.deepEqual(explainRoute("lit review the plan").runnerUp, { route: "lit-plan", ruleId: "natural:plan" });
    assert.equal(explainRoute("handoff").ruleId, "exact:handoff");
    assert.equal(explainRoute("lit handoff").ruleId, "exact:handoff");
    assert.equal(explainRoute("lit deep interview the auth redesign").ruleId, "natural:deep-interview");
  });

  it("marks fenced, quoted and host-authored prompts inert, and nothing else", () => {
    GOLDEN.forEach(([prompt, , kind], index) => {
      const explained = explainRoute(prompt);
      if (kind === "inert") assert.equal(explained.inert, true, `row ${index}`);
      if (kind === "single" || kind === "two") assert.equal(explained.inert, false, `row ${index}`);
    });
    assert.equal(explainRoute("hello there").inert, false);
    assert.equal(explainRoute("how does /lit-plan work").ruleId, "stop:slash-command-mention");
  });

  it("a closed teammate message is set aside; the user's line beside it still routes", () => {
    const block = '<teammate-message teammate_id="lane-a" color="blue" summary="task done">task 4 is finished</teammate-message>';
    const only = `Another Claude session sent a message:\n<teammate-message teammate_id="lane-a" color="blue">lit review found 3 issues; lit plan the fix</teammate-message>`;
    const explained = explainRoute(only);
    assert.equal(explained.route, null);
    assert.equal(explained.inert, true);
    assert.equal(explained.ruleId, "inert:set-aside");
    assert.equal(hookRoute(only, "teammate-1"), null);
    assert.equal(explainRoute(`${block}\nlit plan the next steps`).route, "lit-plan");
  });

  it("treats a non-string prompt as no route", () => {
    assert.deepEqual(explainRoute(undefined), { route: null, ruleId: null, runnerUp: null, inert: false });
  });
});

describe("litclaude-ai why: a run word at the end of a request", () => {
  it("routes like the same word at the start, and a question about the word stays unrouted", () => {
    [
      ["fix the login button lit-loop", "lit-loop"],
      ["로그인 버튼 고쳐줘 lit-loop", "lit-loop"],
      ["tidy the logs litwork", "litwork"],
      ["로그 정리해줘. 부탁해 litwork", "litwork"],
      ["port this paper's retry technique lit-hijack", "lit-hijack"],
      ["what does lit-loop do?", null],
      ["how do I use lit-loop?", null],
    ].forEach(([prompt, expected], index) => {
      const hook = hookRoute(prompt, 1000 + index);
      assert.equal(hook, expected, prompt);
      assert.equal(explainRoute(prompt).route, hook, `explainRoute disagrees with the hook on ${prompt}`);
    });
  });
});

describe("litclaude-ai why: CLI", () => {
  const cliEnv = { PATH: process.env.PATH, HOME: join(temp, "cli-home"), NO_COLOR: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", NO_UPDATE_NOTIFIER: "1" };
  const run = (bin, args) => spawnSync(process.execPath, [bin, ...args], { cwd: temp, env: cliEnv, encoding: "utf8" });

  for (const [label, bin] of [["plugin bin", pluginCli], ["npm bin", npmCli]]) {
    it(`${label} prints the route and rule id in one short block`, () => {
      const result = run(bin, ["why", "lit plan the login fix"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^route\s+lit-plan$/mu);
      assert.match(result.stdout, /^rule\s+natural:plan$/mu);
      assert.match(result.stdout, /^inert\s+no$/mu);
      assert.ok(result.stdout.trim().split("\n").length <= 8, "one short block");
    });

    it(`${label} shows the bare-lit skill plan with lit-loop first and its cuts`, () => {
      const result = run(bin, ["why", "어 나는 이 데이터를 예쁜 그래프와 피피티로 표현하고 싶어~ lit"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^plan\s+lit-loop → lit-scientific-visualization → lit-pptx$/mu);
      assert.match(result.stdout, /^cut\s+none$/mu);
      assert.match(run(bin, ["why", "lit plan the login fix"]).stdout, /^plan\s+none$/mu);
    });

    it(`${label} reports a fenced prompt as inert`, () => {
      const result = run(bin, ["why", "```\nlit plan the login fix\n```"]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^route\s+none$/mu);
      assert.match(result.stdout, /^inert\s+yes$/mu);
    });

    it(`${label} never echoes more than 80 characters of the prompt`, () => {
      const tail = "SECRET-TAIL-SHOULD-NOT-APPEAR";
      const prompt = `lit plan ${"x".repeat(100)}${tail}`;
      const result = run(bin, ["why", prompt]);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, new RegExp(tail, "u"));
      assert.ok(!result.stdout.includes("x".repeat(72)), "at most 80 prompt characters are shown");
    });

    it(`${label} rejects a missing prompt with usage`, () => {
      const result = run(bin, ["why"]);
      assert.equal(result.status, 64);
      assert.match(result.stderr, /Usage: litclaude-ai why "<prompt>"/u);
    });
  }
});
