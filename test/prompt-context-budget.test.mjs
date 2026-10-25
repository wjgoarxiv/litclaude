import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SKILL_FIRST_NOTICE } from "./helpers/hook-context.mjs";

// Claude Code shows a hook's additionalContext inline only below 10,000 characters. Above that the
// model gets a saved-file stub and a preview of about 2,000 bytes, so anything past the preview is
// read only when the model opens the file. These budgets keep every route's context whole and put
// the instructions that matter at the front.
const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const HOST_INLINE_CHARS = 10_000;
const CEILING_BYTES = 9_500;
const PREVIEW_BYTES = 2_000;
const NO_ACTIVATION = "LitClaude prompt hook checked: no workflow activation.";

const routes = [
  ["lit fix the typo in README.md", 3_000],
  ["lit README.md 오타를 고쳐줘", 3_000],
  ["lit-loop fix the typo in README.md", 3_000],
  ["litwork fix the typo in README.md", 3_000],
  ["lit-plan fix the typo in README.md", 3_300],
  ["litresearch heat pumps", 3_500],
  ["lit review-work", 3_500],
  ["comprehend this repo", 3_500],
  ["deep-interview a mobile app idea", 3_500],
  ["refactor the parser module", 3_500],
  ["debugging why does the build hang", 3_500],
  ["litgoal show", 3_500],
  ["readme-studio improve README", 3_500],
  ["lit start-work", 3_500],
  // lit-recap inlines its whole body; 9,200 makes room for the one-sentence lit-adhd cross-link.
  ["lit recap", 9_200],
  ["lit adhd", 3_500],
];

// Routes outside the measured set still have to stay under the host's inline limit.
const otherRoutes = [
  "lit-init refresh the guidance",
  "lit-crucible this release change",
  "lit-burnoff the recent changes",
  "lit-commit the staged fix",
  "lsp-setup for this repo",
  "lit run a workflow to fix typos",
  "autoresearch a bounded question",
  "autoconference the design options",
  "wikify the notes folder",
  "structural-search find every fetch call",
  "browser-drive open the pricing page",
  "lit-humanizer 이 문단 다듬어줘",
  "lit-code add the parser",
];

let temp;
let env;
let counter = 0;

const freshCwd = () => {
  const cwd = join(temp, `cwd-${counter++}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package.json"), "{}\n");
  return cwd;
};

const runHook = (eventName, input) => {
  const result = spawnSync(process.execPath, [hookPath, eventName], {
    cwd: input.cwd,
    encoding: "utf8",
    env,
    input: JSON.stringify(input),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? "" : "";
};

// Static rules are delivered once per session, so the per-prompt cost is what follows a SessionStart.
const promptContext = (prompt, { cwd = freshCwd(), sessionId = `budget-${counter++}` } = {}) => {
  runHook("session-start", { hook_event_name: "SessionStart", cwd, session_id: sessionId, source: "startup" });
  return runHook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", cwd, session_id: sessionId, prompt, prompt_id: "p1" });
};

// The pointer names an absolute path, so a checkout's own location would move the count. Measure
// as if installed under a typical Claude Code plugin cache path instead.
const INSTALL_ROOT = "/Users/someone/.claude/plugins/cache/litclaude-ai/litclaude/9.9.99/";
const bytes = (text) => Buffer.byteLength(text.split(root).join(INSTALL_ROOT), "utf8");
const pointerPaths = (context) =>
  [...context.matchAll(/<litclaude-skill-body name="([a-z-]+)">\s*[\s\S]*?"([^"]+\/SKILL\.md)"/gu)].map((match) => ({ name: match[1], path: match[2] }));

before(() => {
  temp = mkdtempSync(join(tmpdir(), "litclaude-context-budget-"));
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

describe("per-route prompt context budget", () => {
  for (const [prompt, budget] of routes) {
    it(`${prompt} stays within ${budget} bytes and under the host inline limit`, () => {
      const context = promptContext(prompt);
      assert.ok(context.length > 0, "the route must emit context");
      assert.ok(context.length < HOST_INLINE_CHARS, `${context.length} chars reaches the host's inline limit`);
      assert.ok(bytes(context) <= budget, `${bytes(context)} bytes is over the ${budget} byte budget`);
    });
  }

  for (const prompt of otherRoutes) {
    it(`${prompt} stays under the ${CEILING_BYTES} byte ceiling`, () => {
      const context = promptContext(prompt);
      assert.match(context, /LIT IGNITED/u, "the route must activate");
      assert.ok(bytes(context) <= CEILING_BYTES, `${bytes(context)} bytes is over the ceiling`);
    });
  }

  it("leaves an unrouted prompt at the one-line skill-first notice", () => {
    for (const prompt of ["what is 2+2", "2+2는 얼마야?"]) {
      assert.equal(promptContext(prompt), SKILL_FIRST_NOTICE, prompt);
    }
    assert.ok(bytes(SKILL_FIRST_NOTICE) <= 400, `${bytes(SKILL_FIRST_NOTICE)} bytes`);
  });

  it("leaves a slash prompt at the bare notice, since the host already expanded its skill", () => {
    assert.equal(promptContext("/litclaude:lit-plan fix the typo in README.md"), NO_ACTIVATION);
  });

  it("keeps a second lit prompt in the same session within the same budget", () => {
    const cwd = freshCwd();
    const sessionId = "budget-second-prompt";
    promptContext("lit fix the typo in README.md", { cwd, sessionId });
    const second = runHook("user-prompt-submit", {
      hook_event_name: "UserPromptSubmit",
      cwd,
      session_id: sessionId,
      prompt: "lit now fix the typo in CHANGELOG.md",
      prompt_id: "p2",
    });
    assert.ok(bytes(second) <= 3_000, `${bytes(second)} bytes`);
    assert.match(second, /LIT IGNITED · lit-loop/u);
  });

  it("keeps SessionStart whole as the carrier of the reader-facing contract", () => {
    const context = runHook("session-start", { hook_event_name: "SessionStart", cwd: freshCwd(), session_id: "budget-start", source: "startup" });
    assert.ok(bytes(context) <= 6_500, `${bytes(context)} bytes`);
    assert.match(context, /litclaude\.reader-facing-communication\.v1/u);
  });
});

// A prompt with no lit token reaches no route, so the notice is the only LitClaude text beside it.
// In an empty print-mode run the model spent its first turns reading the workspace and never
// reached the skill the request described. The notice is the same for every unrouted prompt; it
// never inspects the wording, so it cannot be tuned to these requests.
describe("an unrouted work request is pointed at the skill list first", () => {
  for (const prompt of [
    "Inspect this patch for actionable defects; each finding needs file and line evidence plus a reproduction path, with runtime risks grouped separately.",
    "이 변경을 합쳐도 될지 봐주고, 문제가 있으면 고쳐서 다시 올려줘.",
    "가끔 저장 요청이 멈춰. 증상을 재현해서 원인을 좁히고 최소 수정한 뒤 실제 경로에서 다시 확인해줘.",
    "The checkout flow broke after yesterday's merge. Find out why, fix it, and make sure the page actually works again.",
    "이 접근법을 쓴 기존 사례를 넓게 찾아 출처를 따라가고, 엇갈리는 주장까지 확인해서 요약해줘.",
    "Take this ticket from start to finish: implement it, add tests, verify it, and tell me when it is done.",
    "점수가 안 오르네. 코드를 한 군데씩 바꾸고 자동 측정해서 더 나아졌는지 보고, 멈출 때까지 반복해줘.",
    "이 보고서 문단 좀 덜 뻔하게, 내 말투처럼 다듬어줘. 뜻이랑 확실하지 않은 부분은 그대로 둬.",
    "I just inherited this codebase. Help me get oriented and leave notes so the next session starts faster.",
    "The decisions are settled; turn them into ordered implementation steps, exact files, and acceptance checks.",
    "The sign-in page is built; exercise its error and success states at phone and desktop sizes, then compare captures for breakage.",
  ]) {
    it(`${prompt.slice(0, 48)}... gets the skill-first notice and no route`, () => {
      assert.equal(promptContext(prompt), SKILL_FIRST_NOTICE);
    });
  }
});

describe("what the model sees first", () => {
  for (const [prompt, route] of [
    ["lit fix the typo in README.md", "lit-loop"],
    ["lit README.md 오타를 고쳐줘", "lit-loop"],
    ["litwork fix the typo in README.md", "litwork"],
    ["lit-plan fix the typo in README.md", "lit-plan"],
    ["litresearch heat pumps", "litresearch"],
  ]) {
    it(`${prompt} puts the probe, activation word, language, skill and mode contract in the first ${PREVIEW_BYTES} bytes`, () => {
      const head = Buffer.from(promptContext(prompt), "utf8").subarray(0, PREVIEW_BYTES).toString("utf8");
      assert.match(head, new RegExp(`Begin your reply with the exact probe line \`🔥 \\*\\*LIT IGNITED · ${route}\\*\\* 🔥\``, "u"));
      assert.match(head, /`lit` in the prompt is the LitClaude activation word/u);
      assert.match(head, /reply in the language the user wrote the prompt in/u);
      assert.ok(head.includes(`Skill(${route})`), "skill request");
      assert.match(head, /Mode contract:/u);
    });
  }

  it("keeps the lit-plan planning-only rule and the plan persistence mandate", () => {
    const context = promptContext("lit-plan fix the typo in README.md");
    assert.match(context, /lit-plan is planning-only/u);
    assert.match(context, /scaffold-plan\.mjs/u);
    assert.match(context, /Stop hook blocks a lit-plan turn/u);
  });
});

describe("deferred skill bodies stay reachable", () => {
  let packed;
  before(() => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    packed = new Set(JSON.parse(result.stdout)[0].files.map((file) => file.path));
  });

  for (const [prompt, route] of [
    ["lit fix the typo in README.md", "lit-loop"],
    ["litwork fix the typo in README.md", "litwork"],
    ["lit-plan fix the typo in README.md", "lit-plan"],
    ["litresearch heat pumps", "litresearch"],
    ["lit review-work", "review-work"],
    ["comprehend this repo", "lit-comprehend"],
    ["lit adhd", "lit-adhd"],
    ["deep-interview a mobile app idea", "deep-interview"],
    ["lit brainstorm a name for my app", "lit-brainstorm"],
    ["lit hijack the brief technique from this post into my skill", "lit-hijack"],
    ["refactor the parser module", "refactor"],
    ["debugging why does the build hang", "debugging"],
    ["litgoal show", "litgoal"],
    ["readme-studio improve README", "readme-studio"],
  ]) {
    it(`${prompt} names the installed ${route} SKILL.md, which ships in the package`, () => {
      const context = promptContext(prompt);
      const pointers = pointerPaths(context);
      assert.equal(pointers.length, 1, "exactly one skill pointer");
      assert.equal(pointers[0].name, route);
      assert.ok(existsSync(pointers[0].path), pointers[0].path);
      assert.ok(packed.has(relative(root, pointers[0].path)), `${relative(root, pointers[0].path)} must be in the pack listing`);
    });
  }
});

describe("sections that become visible", () => {
  it("asks for a soft confirmation only on a bare lit with no task", () => {
    assert.match(promptContext("lit"), /Soft-confirm: the bare keyword 'lit' activated this hook/u);
    for (const prompt of ["lit fix the typo in README.md", "lit-loop fix the typo in README.md", "litwork fix the typo in README.md", "lit-plan fix the typo in README.md"]) {
      assert.doesNotMatch(promptContext(prompt), /Soft-confirm/u, prompt);
    }
  });

  it("offers the /goal line with the user's objective, redacted when the prompt carries a secret", () => {
    assert.match(promptContext("lit fix the typo in README.md"), /\/goal Continue until this LitClaude objective is complete: fix the typo in README\.md\./u);
    assert.match(promptContext("lit README.md 오타를 고쳐줘"), /\/goal Continue until this LitClaude objective is complete: README\.md 오타를 고쳐줘\./u);
    const secret = promptContext("lit rotate the key api_key=abc123secret now");
    assert.match(secret, /\[REDACTED\]/u);
    assert.doesNotMatch(secret, /abc123secret/u);
  });

  it("keeps the workflow opt-in gate and the namespaced subagent ids", () => {
    const context = promptContext("lit fix the typo in README.md");
    assert.match(context, /call the Workflow tool only after the user opts in/u);
    assert.match(context, /litclaude:lit-executor/u);
    assert.match(context, /not the bare name/u);
  });
});
