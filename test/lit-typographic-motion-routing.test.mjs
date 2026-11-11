import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// lit-typographic-motion moved to the video-covers extras plugin; the bare-lit film route below still leads to its
// same-name stub, so the routing corpus stays here.

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion");

const hook = (event, input, cwd = root) => {
  const r = spawnSync(process.execPath, [hookPath, event], { cwd, encoding: "utf8", input: JSON.stringify({ cwd, ...input }), env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
};
const contextFor = (prompt) => hook("user-prompt-submit", { hook_event_name: "UserPromptSubmit", prompt }).hookSpecificOutput?.additionalContext ?? "";
const routeOf = (prompt) => {
  const c = contextFor(prompt).split("\n\n## Project Instructions\n", 1)[0];
  const m = /Activate LitClaude (Skill\([^)]+\))/u.exec(c) ?? /use LitClaude ([\w-]+) discipline/u.exec(c);
  return m ? m[1] : "none";
};

// This product's own corpus, written for LitClaude (not the spec's sentences, not any A/B task).
const POSITIVE = [
  "이 시 구절로 키네틱 타이포 영상 만들어줘 lit",
  "회사 창립 기념 오프닝 타이틀 시퀀스 제작해줘 lit",
  "새 앨범 가사 영상 하나 뽑아줘 lit",
  "우리 동아리 소개 인트로 영상 만들어 줘 lit",
  "이 문장으로 모션그래픽 짧게 제작해줘 lit",
  "make a kinetic type video out of this haiku lit",
  "produce a title sequence for the gallery opening lit",
  "render a lyric video for the chorus lit",
  "create an intro video for the weekly science club lit",
  "build a motion graphics clip that announces the new cafe hours lit",
];
// The collision shapes from the Phase 0 baseline, in this product's own words.
const COLLISIONS = [
  ["연구 성과 발표를 영상으로 만들어줘 lit", "Skill(lit-pptx)"],
  ["make a video version of our quarterly presentation lit", "Skill(lit-pptx)"],
  ["타이포그래피 영상 하나 만들어줘 lit", "Skill(frontend-ui-ux)"],
  ["주간 회의 발표 영상 렌더링해줘 lit", "lit-loop"],
];
const NEGATIVE = [
  ["신입 교육용 슬라이드 덱 만들어줘 lit", "Skill(lit-pptx)"],
  ["build a slide deck for the onboarding session lit", "Skill(lit-pptx)"],
  ["연구실 안전 교육 발표 자료랑 요약 문서 만들어줘 lit", "Skill(lit-pptx)"],
  ["설정 화면 타이포그래피 정리해서 만들어줘 lit", "Skill(frontend-ui-ux)"],
  ["redesign the typography of the pricing page lit", "Skill(frontend-ui-ux)"],
  ["랜딩 페이지에 배경 영상 깔아서 만들어줘 lit", "Skill(frontend-ui-ux)"],
];
// Exclusions: each has a video noun or motion word and must not reach the motion skill.
const EXCLUDED = [
  "이 영상 잘라서 자막 넣어줘 lit",
  "trim this clip and add captions lit",
  "embed a background video in the landing page lit",
  "발표자료에 이 영상 넣어서 만들어줘 lit",
  "insert the product video into the report document lit",
  "유튜브 영상 썸네일 만들어줘 lit",
  "write a script for our tutorial video lit",
  "이 영상 대본 좀 작성해줘 lit",
  "버튼 호버 모션 만들어줘 lit",
  "design motion tokens for the checkout screen lit",
  "주주총회 안건 모션 초안 만들어줘 lit",
  "draft a motion for the committee to approve lit",
  "인트로 문구 좀 다듬어서 만들어줘 lit",
  "build a video upload page lit",
  "make a clip path for the hero section lit",
];

describe("lit-typographic-motion bare-lit routing (real hook)", () => {
  it("routes motion-video requests to the skill, in Korean and English", () => {
    for (const prompt of POSITIVE) assert.equal(routeOf(prompt), "Skill(lit-typographic-motion)", prompt);
  });

  it("fixes the baseline collisions by precedence: a video noun wins over 발표 and 타이포그래피", () => {
    for (const [prompt, before] of COLLISIONS) {
      assert.notEqual(routeOf(prompt), before, `still routed as before: ${prompt}`);
      assert.equal(routeOf(prompt), "Skill(lit-typographic-motion)", prompt);
    }
  });

  it("keeps decks on lit-pptx and interface typography on frontend-ui-ux when no video noun is present", () => {
    for (const [prompt, expected] of NEGATIVE) assert.equal(routeOf(prompt), expected, prompt);
  });

  it("never claims the five exclusions, bare motion or intro, or video as a software feature", () => {
    for (const prompt of EXCLUDED) assert.notEqual(routeOf(prompt), "Skill(lit-typographic-motion)", prompt);
  });

  it("the added motion verbs (제작, render, produce) never fire without a motion-video noun or against an exclusion", () => {
    for (const prompt of ["보고서 제작해줘 lit", "render the dashboard component lit", "produce the quarterly report document lit", "이 영상 편집본 제작해줘 lit"]) {
      assert.notEqual(routeOf(prompt), "Skill(lit-typographic-motion)", prompt);
    }
  });

  it("adds no token-free motion route, and the no-token UI fallback no longer claims a video prompt", () => {
    for (const prompt of ["타이포그래피 영상 하나 만들어줘", "design a kinetic typography video for the intro screen"]) {
      assert.equal(routeOf(prompt), "none", prompt);
    }
    assert.equal(routeOf("design a settings page UI"), "Skill(frontend-ui-ux)", "the UI fallback still works without a video noun");
  });

  it("a leading token names the skill", () => {
    assert.equal(routeOf("lit-typographic-motion 봄 축제 오프닝"), "Skill(lit-typographic-motion)");
  });

  it("the route context names the installed stub and the install line, within 4096 bytes", () => {
    const context = contextFor("이 시 구절로 키네틱 타이포 영상 만들어줘 lit");
    assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${Buffer.byteLength(context, "utf8")} bytes`);
    assert.ok(context.includes(JSON.stringify(join(skillRoot, "SKILL.md"))), "installed SKILL.md path");
    assert.match(context, /same-name pointer stub/u);
    assert.match(context, /video-covers@wjgoarxiv-skills/u);
    assert.doesNotMatch(context, /motion\.mjs|Soft-confirm/u);
  });
});
