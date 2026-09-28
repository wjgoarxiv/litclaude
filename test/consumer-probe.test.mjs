// The consumer probe from the plan's verification section, as a test.
//
// These four skills existed, shipped, and were documented for months while being reachable
// only after an edit had already happened. Nothing asserted that a route FIRES, so nothing
// noticed. A route without a test asserting it fires is how they got lost; this file is that
// test. The hook appends the always-on bundled-rule context after its route activation.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");

const skillsNamedFor = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const activationContext = context.split("\n\n## Project Instructions\n", 1)[0];
  return [...new Set([...activationContext.matchAll(/Skill\(([a-z-]+)\)/gu)].map((match) => match[1]))];
};

const isSilent = (prompt) => skillsNamedFor(prompt).length === 0;

describe("consumer probe — a UI design request reaches the design skill", () => {
  it("surfaces frontend-ui-ux for a design task that never names the skill", () => {
    // The plan's exact baseline prompt.
    assert.ok(
      skillsNamedFor("design a new settings page UI").includes("frontend-ui-ux"),
      "the flagship design capability must be reachable before editing starts",
    );
  });

  it("surfaces it across the phrasings a user actually types", () => {
    for (const prompt of [
      "restyle the dashboard component",
      "redesign the login screen",
      "the modal layout needs polish",
      "add dark mode styling to the settings view",
      "mockup a responsive pricing page",
    ]) {
      assert.ok(skillsNamedFor(prompt).includes("frontend-ui-ux"), `should surface for: ${prompt}`);
    }
  });

  it("still routes an explicit lit command rather than being hijacked by the design route", () => {
    assert.deepEqual(skillsNamedFor("lit plan the migration"), ["lit-plan"]);
    assert.ok(skillsNamedFor("lit review this diff").includes("review-work"));
  });
});

describe("consumer probe — design intent needs a verb AND an interface noun", () => {
  it("stays silent on non-interface design work", () => {
    // `design` alone is far too common; the conjunction is what makes the route safe.
    for (const prompt of [
      "design the database schema",
      "design an API for the queue",
      "by design the parser is strict",
      "the system design doc is stale",
    ]) {
      assert.ok(isSilent(prompt), `must NOT activate for: ${prompt}`);
    }
  });
});

describe("consumer probe — Korean UI intent reaches the design skill", () => {
  // The plugin's user writes Korean. An English-only route means the capability is
  // unreachable for exactly the prompts it exists for, even though the plan's
  // English-worded criterion passes.
  it("surfaces frontend-ui-ux for Korean design requests", () => {
    for (const prompt of [
      "설정 페이지 UI를 새로 디자인해줘",
      "디자인 시스템을 만들어줘",
      "로그인 화면을 다시 디자인해줘",
      "대시보드 레이아웃을 개편해줘",
      "다크모드 테마를 만들어줘",
      "버튼 스타일을 다듬어줘",
      "반응형 화면 구성을 바꿔줘",
    ]) {
      assert.ok(skillsNamedFor(prompt).includes("frontend-ui-ux"), `should surface for: ${prompt}`);
    }
  });

  it("covers the named UI-chrome nouns", () => {
    // 사이드바 was in the acceptance set and missed on the first pass: 다듬 was in the verb
    // list but the noun half had no term for it. The miss was the noun half, not the verb.
    for (const prompt of [
      "사이드바 좀 다듬어줘",
      "푸터를 다시 디자인해줘",
      "툴바를 만들어줘",
      "위젯을 만들어줘",
      "내비게이션을 개편해줘",
      "네비게이션을 개편해줘",
    ]) {
      assert.ok(skillsNamedFor(prompt).includes("frontend-ui-ux"), `should surface for: ${prompt}`);
    }
  });

  it("rejects 헤더, because HTTP headers already clear the verb half", () => {
    // Measured before deciding: 만들 / 구성 / 배치 are all in uiDesignVerb, so adding 헤더 as
    // a noun would have fired on every one of these. 푸터 is kept — there is no HTTP footer.
    for (const prompt of ["HTTP 헤더를 만들어줘", "요청 헤더를 구성해줘", "응답 헤더를 배치해줘"]) {
      assert.ok(isSilent(prompt), `헤더 must not be a UI noun: ${prompt}`);
    }
    assert.ok(skillsNamedFor("문서 푸터를 다시 디자인해줘").includes("frontend-ui-ux"));
  });

  it("matches the verb STEM so every ending is covered", () => {
    // Korean is agglutinative: one verb, many endings. Enumerating inflections would miss some.
    for (const ending of ["디자인해줘", "디자인하고 싶어", "디자인할 거야", "디자인했어", "리디자인해줘"]) {
      assert.ok(
        skillsNamedFor(`로그인 화면을 ${ending}`).includes("frontend-ui-ux"),
        `stem matching must cover the ending in: ${ending}`,
      );
    }
  });

  // THE load-bearing test. 만들다 is the natural Korean verb for creating a UI, so unlike
  // English (where `build` and `make` were deliberately excluded) it MUST be in the verb list.
  // That means every Korean sentence containing 만들어줘 clears the verb half, and the noun
  // half is the only thing left doing the discriminating. A Korean route with positive tests
  // only would pass while firing on every such sentence.
  it("stays silent on non-UI Korean work that uses the same verbs", () => {
    for (const prompt of [
      "API 클라이언트를 만들어줘",
      "데이터베이스 마이그레이션을 새로 만들어줘",
      "API를 디자인해줘",
      "데이터 모델을 디자인해줘",
      "성능을 개선해줘",
      "신용카드 결제를 만들어줘",
      "빌드 스크립트를 만들어줘",
      // These four clear or nearly clear the verb half, so the noun half is what stops them.
      "더 빠르게 만들어줘",
      "테스트를 하나 더 만들어줘",
      "파서 버그 고쳐줘",
      // 디자이너 does NOT contain 디자인 (인 vs 이), so this one fails both halves — but it
      // is exactly the shape the bare-substring risk would have hit, so it stays pinned.
      "디자이너를 뽑아줘",
    ]) {
      assert.ok(isSilent(prompt), `must NOT activate for: ${prompt}`);
    }
  });

  it("keeps the Latin word-boundary guard working inside Korean text", () => {
    // \b is correct for Latin tokens even next to Hangul, because Hangul is a non-word char.
    // "UI를" matches; "build"/"guide"/"API" must not supply a false `ui`.
    assert.ok(skillsNamedFor("설정 페이지 UI를 새로 디자인해줘").includes("frontend-ui-ux"));
    assert.ok(isSilent("API 빌드 가이드를 만들어줘"));
  });
});

describe("consumer probe — the four skills answer their own names", () => {
  for (const skillId of ["frontend-ui-ux", "visual-qa", "lit-commit", "lsp-setup"]) {
    it(`${skillId} answers a leading bare token and the dollar shorthand`, () => {
      assert.ok(skillsNamedFor(`${skillId} help me`).includes(skillId), `bare token must route ${skillId}`);
      assert.ok(skillsNamedFor(`$${skillId} help me`).includes(skillId), `dollar route must route ${skillId}`);
    });

    it(`${skillId} is NOT an anywhere-token`, () => {
      // Matches how review-work behaves: naming a skill mid-sentence is discussion, not a
      // request. A sibling lane measured bare common words as the worst false-positive class.
      assert.ok(isSilent(`plain ${skillId} discussion`), `${skillId} must not fire mid-sentence`);
      assert.ok(isSilent(`review the commit history with ${skillId}`), `${skillId} must not fire mid-sentence`);
    });

    it(`${skillId} injects its own SKILL.md body, not another skill's`, () => {
      const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
        cwd: root,
        encoding: "utf8",
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `${skillId} help me`, cwd: root }),
      });
      const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.match(context, new RegExp(`<litclaude-skill-body name="${skillId}">`, "u"));
      assert.doesNotMatch(context, /undefined/u, "a missing mode contract would render as 'undefined'");
      if (["frontend-ui-ux", "visual-qa"].includes(skillId)) {
        assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${skillId} activation prompt must stay within 4096 UTF-8 bytes`);
      }
    });
  }
});

describe("consumer probe — diagrams, interfaces, and measured-data plots keep separate owners", () => {
  it("routes a named diagram request to lit-diagram-drawer", () => {
    assert.deepEqual(skillsNamedFor("lit-diagram-drawer draw the service deployment boundary"), ["lit-diagram-drawer"]);
    assert.deepEqual(skillsNamedFor("$lit-diagram-drawer 주문 흐름도를 그려줘"), ["lit-diagram-drawer"]);
  });

  it("keeps interface design on frontend-ui-ux and plots off the diagram route", () => {
    assert.deepEqual(skillsNamedFor("design a new settings page UI"), ["frontend-ui-ux"]);
    for (const prompt of ["draw an architecture diagram", "plot the measured yield data", "make a chart of test latency"]) {
      assert.ok(!skillsNamedFor(prompt).includes("lit-diagram-drawer"), `must NOT activate the diagram skill for: ${prompt}`);
    }
  });
});
