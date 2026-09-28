import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../scripts/strip-ansi.mjs";
import { assertNoWorkflowActivationContext } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const commandPath = join(root, "plugins", "litclaude", "commands", "lit-comprehend.md");
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-comprehend");
const skillPath = join(skillRoot, "SKILL.md");
const templatePath = join(skillRoot, "references", "artifact-template.md");
const verifierPath = join(skillRoot, "scripts", "verify-explainer.mjs");
const scaffoldPath = join(skillRoot, "assets", "explainer-scaffold.html");

const CANONICAL_SECTIONS = [
  "한눈에",
  "이미 알고 있던 것",
  "직관",
  "바뀐 것",
  "직접 만져보기",
  "퀴즈",
  "다음",
];

const runHook = (eventName, input) =>
  spawnSync(process.execPath, [hookPath, eventName], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(input),
  });

const runVerifier = (artifactPath, repo) =>
  spawnSync(process.execPath, [verifierPath, artifactPath, "--repo", repo, "--json"], {
    cwd: root,
    encoding: "utf8",
  });

const readRequired = (path, label) => {
  assert.equal(existsSync(path), true, `${label} must exist`);
  return readFileSync(path, "utf8");
};

// A minimal artifact that satisfies every rule, used as the GREEN baseline. Each
// negative case below mutates exactly one property of it, so a failure names the
// check that broke rather than "the fixture is wrong somewhere".
const quizQuestion = (n, answer) => `
<div class="quiz-q" data-answer="${answer}">
  <p class="q"><span class="n">${n}.</span> 질문 ${n}?</p>
  <button class="opt" data-i="0">보기 가</button>
  <button class="opt" data-i="1">보기 나</button>
  <button class="opt" data-i="2">보기 다</button>
  <div class="fb" data-i="0">가에 대한 설명입니다.</div>
  <div class="fb" data-i="1">나에 대한 설명입니다.</div>
  <div class="fb" data-i="2">다에 대한 설명입니다.</div>
</div>`;

const goodArtifact = (quotedPath, quotedLine) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>fixture</title>
<style>pre{white-space:pre}</style></head><body>
<h2>한눈에</h2><p>한 문단 요약입니다.</p>
<h2>이미 알고 있던 것</h2><p>세션 시작 시점의 상태입니다.</p>
<h2>직관</h2><p>핵심 아이디어를 예시 데이터로 설명합니다.</p>
<h2>바뀐 것</h2>
<pre data-src="${quotedPath}">${quotedLine}</pre>
<h2>직접 만져보기</h2><div class="world">단순화한 모형입니다.</div>
<h2>퀴즈</h2>${quizQuestion(1, 0)}${quizQuestion(2, 2)}${quizQuestion(3, 1)}
<h2>다음</h2><p>다음에 열어볼 파일입니다.</p>
</body></html>`;

describe("lit-comprehend explainer artifact skill", () => {
  it("activates on named routes and injects the artifact contract", () => {
    for (const prompt of ["lit-comprehend", "lit-comprehend HEAD~5..HEAD", "comprehend", "comprehend src/hooks/", "$lit-comprehend", "$comprehend the session"]) {
      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt,
        cwd: root,
      });

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.match(stripAnsi(parsed.systemMessage ?? ""), /comprehend/u, `${prompt} should activate lit-comprehend`);
      const context = parsed.hookSpecificOutput.additionalContext;
      assert.match(context, /\/litclaude:lit-comprehend/u, `${prompt} should reference the command route`);
      assert.match(context, /Skill\(lit-comprehend\)/u, `${prompt} should reference the skill`);
      assert.match(context, /verify-explainer\.mjs/u, `${prompt} should require the verification gate`);
      assert.match(context, /OUTSIDE the repository/iu, `${prompt} should keep the artifact out of the worktree`);
      for (const section of CANONICAL_SECTIONS) {
        assert.ok(context.includes(section), `${prompt} context should name the canonical section ${section}`);
      }
    }
  });

  it("does not hijack ordinary requests for an explanation", () => {
    // The whole point of the named-only route: a user asking for a one-line answer
    // must not get an HTML artifact build. These are the phrasings closest to the
    // skill's intent that still must NOT fire the deterministic hook.
    for (const prompt of [
      "explain this function to me",
      "설명해줘",
      "이해가 안 돼요",
      "what did you do in this session?",
      "comprehension test for the parser",
      "incomprehensible error message",
      "`comprehend`",
      "```text\ncomprehend\n```",
      "/comprehend",
      "/litclaude:lit-comprehend",
    ]) {
      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt,
        cwd: root,
      });

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.systemMessage, undefined, `${prompt} should not activate`);
      assertNoWorkflowActivationContext(parsed.hookSpecificOutput.additionalContext, prompt);
    }
  });

  it("keeps activation side-effect-free against durable litgoal state", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-lit-comprehend-"));
    try {
      const litgoalDir = join(temp, ".litclaude", "litgoal");
      mkdirSync(litgoalDir, { recursive: true });
      const goalsPath = join(litgoalDir, "goals.json");
      const goals = JSON.stringify({ version: 1, objective: "sample objective", status: "active", criteria: [] });
      writeFileSync(goalsPath, goals);
      const listDir = () => readdirSync(temp, { recursive: true }).sort();
      const before = listDir();

      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt: "comprehend",
        cwd: temp,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(goalsPath, "utf8"), goals, "goals.json must stay byte-identical");
      assert.deepEqual(listDir(), before, "activation must not create files");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("ships the canonical section contract and the delta-anchoring discipline", () => {
    const skill = readRequired(skillPath, "lit-comprehend skill");

    assert.match(skill, /name:\s*lit-comprehend/u);
    for (const section of CANONICAL_SECTIONS) {
      assert.ok(skill.includes(section), `skill must name the canonical section ${section}`);
    }
    // The four ideas that separate this from a generic summary. Losing any one of
    // them turns the artifact back into prose the reader still cannot act on.
    assert.match(skill, /delta/iu, "skill must anchor the explanation on what the reader already knew");
    assert.match(skill, /conceptual order/iu, "skill must reorder the walkthrough away from file order");
    assert.match(skill, /micro-world/iu, "skill must offer an interactive way to feel the behavior");
    assert.match(skill, /internal verification record/iu, "skill must retain detailed internal verification");
    assert.match(skill, /limitations_channel: reply/u, "material uncertainty belongs in the chat reply");
    const template = readRequired(templatePath, "reader-facing artifact template");
    assert.doesNotMatch(template, /### (?:확인 안 된 것|증거)/u, "artifact must not force a limitation or evidence section");
    assert.match(skill, /throttle|regulat/iu, "the quiz must be framed as a speed regulator, not a grade");
    assert.match(skill, /goals\.json/u);
    assert.match(skill, /ledger\.jsonl/u);
    assert.match(skill, /--en|in English|영어/u, "skill must define the English-mode switch");
    assert.match(skill, /--md/u, "skill must define the Markdown fallback");
    assert.match(skill, /verbatim|그대로|원문/u, "skill must keep technical tokens verbatim");
    assert.match(skill, /lit-recap/u, "skill must distinguish itself from the status recap");
  });

  it("ships a scaffold and references the skill actually points at", () => {
    const skill = readRequired(skillPath, "lit-comprehend skill");
    const scaffold = readRequired(scaffoldPath, "explainer scaffold");

    for (const relativePath of [
      "assets/explainer-scaffold.html",
      "references/artifact-template.md",
      "references/micro-worlds.md",
      "scripts/verify-explainer.mjs",
    ]) {
      assert.equal(existsSync(join(skillRoot, relativePath)), true, `missing lit-comprehend ${relativePath}`);
    }
    assert.match(skill, /references\/artifact-template\.md/u, "skill must route to the template reference");
    assert.match(skill, /references\/micro-worlds\.md/u, "skill must route to the micro-world reference");
    assert.match(skill, /scripts\/verify-explainer\.mjs/u, "skill must route to its verifier");

    // The scaffold is the artifact's boilerplate; if it needs the network the
    // artifact cannot be read on a plane, which is the point of inlining it.
    // Its header comment names the tags it forbids, so check the markup, not the prose.
    const scaffoldMarkup = scaffold.replace(/<!--[\s\S]*?-->/gu, "");
    assert.doesNotMatch(scaffoldMarkup, /<script[^>]+src=/iu, "scaffold must not load external scripts");
    assert.doesNotMatch(scaffoldMarkup, /<link[^>]+stylesheet/iu, "scaffold must not load external stylesheets");
    assert.match(scaffold, /class="quiz-q"/u, "scaffold must ship the checkable quiz markup");
    assert.match(scaffold, /white-space:\s*pre/u, "scaffold must preserve newlines in code blocks");
  });

  it("passes its verifier on a conforming artifact", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-lit-comprehend-verify-"));
    try {
      // Quote a line that genuinely exists in a tracked file, so the quote check
      // is exercised against real repo content rather than a stub.
      const quotedPath = "plugins/litclaude/lib/canonical-skill-catalog.mjs";
      const quotedLine = "export const canonicalSkillIds = Object.freeze([";
      assert.ok(
        readFileSync(join(root, quotedPath), "utf8").includes(quotedLine),
        "fixture must quote a line that really exists",
      );

      // Keep the artifact outside its fixture repo even when TMPDIR is repo-local.
      const fixtureRepo = join(temp, "repo");
      mkdirSync(join(fixtureRepo, "plugins", "litclaude", "lib"), { recursive: true });
      writeFileSync(join(fixtureRepo, quotedPath), readFileSync(join(root, quotedPath)));
      const artifact = join(temp, "2026-08-01-fixture.html");
      writeFileSync(artifact, goodArtifact(quotedPath, quotedLine));
      const result = runVerifier(artifact, fixtureRepo);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.failures, [], `conforming artifact must pass: ${result.stdout}`);
      assert.equal(report.verdict, "PASS");
      assert.equal(result.status, 0);
      assert.ok(report.checks.length >= 8, "verifier should run the full check set");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("fails the verifier on each defect that would mislead a reader", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-lit-comprehend-red-"));
    try {
      const quotedPath = "plugins/litclaude/lib/canonical-skill-catalog.mjs";
      const quotedLine = "export const canonicalSkillIds = Object.freeze([";
      const base = goodArtifact(quotedPath, quotedLine);

      const cases = [
        [
          "phantom code quote",
          base.replace(quotedLine, "export const thisLineWasNeverInThatFile = true;"),
          "quotes-real",
        ],
        [
          "quote attributed to a file that does not exist",
          base.replace(quotedPath, "plugins/litclaude/lib/no-such-file.mjs"),
          "quotes-real",
        ],
        [
          "code quoted with no attribution at all",
          base.replace(`<pre data-src="${quotedPath}">`, "<pre>"),
          "quotes-real",
        ],
        [
          "external resource",
          base.replace("</head>", '<script src="https://cdn.example.com/x.js"></script></head>'),
          "self-contained",
        ],
        [
          "missing next-step section",
          base.replace("<h2>다음</h2>", "<h2>생략</h2>"),
          "sections",
        ],
        [
          "quiz option without feedback",
          base.replace('<div class="fb" data-i="0">가에 대한 설명입니다.</div>', ""),
          "quiz",
        ],
        [
          "answer always in the same position",
          base.replace('data-answer="2"', 'data-answer="0"').replace('data-answer="1"', 'data-answer="0"'),
          "quiz",
        ],
        [
          "ASCII box diagram",
          base.replace("<h2>직관</h2>", "<h2>직관</h2><p>┌────┐<br>│ in │<br>└────┘</p>"),
          "no-ascii-art",
        ],
      ];

      for (const [label, body, expectedCheck] of cases) {
        const artifact = join(temp, `2026-08-01-${label.replace(/\s+/gu, "-")}.html`);
        writeFileSync(artifact, body);
        const result = runVerifier(artifact, root);
        const report = JSON.parse(result.stdout);
        assert.equal(report.verdict, "FAIL", `${label} must fail the verifier`);
        assert.notEqual(result.status, 0, `${label} must exit nonzero`);
        assert.ok(
          report.failures.some((finding) => finding.check === expectedCheck),
          `${label} must be reported by the ${expectedCheck} check, got ${JSON.stringify(report.failures)}`,
        );
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("refuses an artifact written inside the repository worktree", () => {
    // Writing into the worktree is the failure that survives review: the artifact
    // lands in a diff, gets committed, and rots against the code it describes.
    const inRepo = join(root, "evidence", "2026-08-01-lit-comprehend-boundary-probe.html");
    mkdirSync(join(root, "evidence"), { recursive: true });
    try {
      writeFileSync(inRepo, goodArtifact("plugins/litclaude/lib/canonical-skill-catalog.mjs", "export const canonicalSkillIds = Object.freeze(["));
      const report = JSON.parse(runVerifier(inRepo, root).stdout);
      assert.equal(report.verdict, "FAIL");
      assert.ok(report.failures.some((finding) => finding.check === "outside-repo"));
    } finally {
      rmSync(inRepo, { force: true });
    }
  });

  it("ships a command that routes to the skill and states the artifact boundary", () => {
    const command = readRequired(commandPath, "lit-comprehend command");

    assert.match(command, /^---\n[\s\S]*description:/u, "command must have frontmatter with a description");
    assert.match(command, /Skill\(lit-comprehend\)/u, "command must route to Skill(lit-comprehend)");
    assert.match(command, /outside the repository/iu, "command must keep the artifact out of the worktree");
    assert.match(command, /verify-explainer\.mjs/u, "command must name the verification gate");
    assert.match(command, /lit-recap/u, "command must distinguish itself from the status recap");
    assert.doesNotMatch(command, /\$ARGUMENTS/u, "command must not render broken argument placeholders");
  });

  it("routes the `lit comprehend` phrase to this skill rather than the generic lit cascade", () => {
    // Regression: the bare `lit` token used to swallow this phrase, so `lit comprehend`
    // activated lit-loop and injected the wrong skill body. The route looked alive
    // because something fired — which is exactly how an orphaned route hides.
    for (const prompt of ["lit comprehend", "lit-comprehend", "litwork comprehend"]) {
      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt,
        cwd: root,
      });

      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      const systemMessage = stripAnsi(parsed.systemMessage ?? "");
      assert.match(
        systemMessage,
        /lit-comprehend/u,
        `${prompt} must reach lit-comprehend, not the generic lit cascade`,
      );
      assert.doesNotMatch(
        systemMessage,
        /🔥 LIT IGNITED · lit-loop 🔥/u,
        `${prompt} must not fall through to lit-loop`,
      );
    }
  });

  it("makes activation conditional on a scope gate rather than immediate execution", () => {
    // The skill costs minutes and writes a file. Because the trigger surface is
    // deliberately wide (bare `comprehend` still routes here), the thing that keeps a
    // loose match cheap is this gate — so it has to exist on every surface that can
    // start the work, not just in the skill body.
    const skill = readRequired(skillPath, "lit-comprehend skill");
    const command = readRequired(commandPath, "lit-comprehend command");
    const hookContext = (() => {
      const result = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt: "comprehend",
        cwd: root,
      });
      return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    })();

    for (const [label, text] of [["skill", skill], ["command", command], ["hook context", hookContext]]) {
      assert.match(text, /scope gate|activation is not permission/iu, `${label} must state the scope gate`);
      assert.match(text, /wait/iu, `${label} must require waiting before building`);
      assert.match(text, /git diff --stat|git status/u, `${label} must name a cheap way to build the proposal`);
    }

    // Proceed-immediately vs propose-and-wait must be stated as a rule, not implied.
    assert.match(skill, /path|range|branch|PR/u, "skill must name what counts as an explicit scope");
    assert.match(skill, /infer/iu, "skill must key the gate on whether the file set was inferred");
    assert.match(skill, /한 줄|one-sentence|two sentences|cheap path/iu, "skill must offer the cheaper answer when it fits");
  });
});
