import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { litPlanCompanions, normalizedTriggerText } from "../plugins/litclaude/lib/route-match.mjs";
import { offeredSkills } from "../tools/routing-eval.mjs";

const companions = (prompt) => litPlanCompanions(normalizedTriggerText(prompt)).companions;
const has = (prompt, id) => companions(prompt).includes(id);

describe("bare-lit companion layer", () => {
  it("the acceptance prompt plans lit-loop, lit-pptx and lit-scientific-visualization", () => {
    const [first, ...rest] = offeredSkills("어 나는 이 데이터를 예쁜 그래프와 피피티로 표현하고 싶어~ lit");
    assert.equal(first, "lit-loop");
    assert.deepEqual(rest.sort(), ["lit-pptx", "lit-scientific-visualization"]);
  });

  it("reads Korean desire and instrument frames as a request", () => {
    assert.ok(has("이 기획안을 피피티로 표현하고 싶어 lit", "lit-pptx"));
    assert.ok(has("이 내용을 워드 파일로 남기고 싶어 lit", "lit-docx"));
    assert.ok(has("측정 결과를 그래프로 보여주고 싶어 lit", "lit-scientific-visualization"));
    assert.ok(has("이 흐름을 도식으로 표현하고 싶어 lit", "lit-diagram-drawer"));
    assert.ok(has("이 숫자들 엑셀로 보고 싶어 lit", "lit-xlsx"));
    assert.ok(has("lit a 12-slide keynote on onboarding", "lit-pptx"));
    assert.ok(has("I'd like a short presentation about our Q3 roadmap lit", "lit-pptx"));
  });

  it("sets aside a deliverable that is refused, past, asked about or quoted", () => {
    for (const prompt of ["PPT 말고 그냥 글로만 정리해줘 lit", "피피티 만들 수 있어? lit", "예전에 만든 발표자료에서 숫자만 알려줘 lit",
      "lit summarise this, no slides please", "lit what was on slide 3 of the deck I made last week?",
      "\"발표자료 만들어줘\"라는 말을 라우터가 어떻게 처리하는지 알려줘 lit"]) {
      assert.equal(has(prompt, "lit-pptx"), false, prompt);
      assert.equal(offeredSkills(prompt).includes("lit-pptx"), false, prompt);
    }
    assert.deepEqual(offeredSkills("보고서 말고 발표자료로 만들어줘 lit"), ["lit-loop", "lit-pptx"]);
    assert.deepEqual(offeredSkills("lit not slides, write it up as a word document"), ["lit-loop", "lit-docx"]);
  });

  it("sets aside code words that share a deliverable noun", () => {
    for (const prompt of ["의존성 그래프에서 순환 참조 찾아줘 lit", "graph 라이브러리 버전 올려줘 lit", "플롯 함수 이름을 drawPlot으로 바꿔줘 lit", "lit fix the chart.js import error in the build"]) {
      assert.equal(has(prompt, "lit-scientific-visualization"), false, prompt);
    }
    assert.equal(has("엑셀 파일 읽는 파서 버그 고쳐줘 lit", "lit-xlsx"), false);
    assert.equal(offeredSkills("버그 리포트 정리해서 이슈로 올려줘 lit").includes("lit-docx"), false);
  });

  it("cue lanes reach skills that have no deliverable noun, and their refusals hold", () => {
    assert.ok(has("이 파일 너무 길어, 기능 안 바뀌게 나눠줘 lit", "refactor"));
    assert.ok(has("lit refactor the auth module without changing behaviour", "refactor"));
    assert.equal(has("리팩터링은 하지 말고 버그만 고쳐줘 lit", "refactor"), false);
    assert.ok(has("lit make this paragraph sound less like AI wrote it", "lit-humanizer"));
    assert.ok(has("de-template this email draft, keep the facts lit", "lit-humanizer"));
    assert.equal(has("문장은 건드리지 말고 숫자만 고쳐줘 lit", "lit-humanizer"), false);
    assert.ok(has("lit I'm not sure what I want yet, interview me first", "deep-interview"));
    assert.equal(has("질문하지 말고 바로 진행해 lit", "deep-interview"), false);
    assert.ok(has("lit redo the README with a cover for the launch", "readme-studio"));
    assert.equal(has("README 한 줄만 고쳐줘, 버전 번호 lit", "readme-studio"), false);
    assert.ok(has("왜 테스트가 계속 멈추는지 원인 찾아줘 lit", "debugging"));
    assert.equal(has("lit fix the clamp bug in src/math.mjs and add two edge-case tests", "debugging"), false);
  });

  it("cue lanes set aside talk about a skill, and the non-code lanes set aside code words", () => {
    assert.equal(has("lit 리팩터 스킬이 뭐 하는 거야?", "refactor"), false);
    assert.equal(has("lit the research router is outdated, fix the parser", "litresearch"), false);
    assert.equal(has("lit fix the research script import bug", "litresearch"), false);
    assert.ok(has("lit refactor the parser module without changing behaviour", "refactor"));
    assert.ok(has("lit find out why the import step hangs", "debugging"));
  });

  it("reads a long paste in bounded time and still finds the ask after it", () => {
    for (const blob of ["a".repeat(100_000), "데이터로".repeat(25_000), "x,".repeat(50_000)]) {
      const started = process.hrtime.bigint();
      const found = companions(`lit ${blob} 피피티로 만들어줘`);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 500, `${blob.slice(0, 4)}… took ${ms.toFixed(0)} ms`);
      assert.ok(found.includes("lit-pptx"), blob.slice(0, 4));
    }
  });

  it("a code word in the clause never demotes the cascade's own route to a mention", () => {
    const text = normalizedTriggerText("make a video version of our quarterly presentation lit");
    assert.deepEqual(litPlanCompanions(text, "lit-typographic-motion").mentioned, []);
    assert.deepEqual(offeredSkills("make a video version of our quarterly presentation lit").slice(0, 2), ["lit-loop", "lit-typographic-motion"]);
  });

  it("a deliverable route the prompt only mentions is left out of the plan by name", () => {
    assert.deepEqual(litPlanCompanions(normalizedTriggerText("피피티 만들 수 있어? lit"), "lit-pptx").mentioned, ["lit-pptx"]);
    assert.deepEqual(offeredSkills("피피티 만들 수 있어? lit"), ["lit-loop"]);
  });
});
