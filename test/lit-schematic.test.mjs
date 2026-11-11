import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { LIT_SKILL_IDS } from "../plugins/litclaude/lib/mod/skills.mjs";

// lit-schematic moved to the figures plugin of wjgoarxiv-skills; its kit, QA gate and builder tests left with it. What
// stays here is the same-name stub's enrollment and every route that reaches it (test/figures-stubs.test.mjs covers
// the stub text).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const skillRoot = join(pluginRoot, "skills", "lit-schematic");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const skillFiles = walk(skillRoot).map((file) => relative(skillRoot, file).replaceAll("\\", "/"));

const hookSkills = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const activation = context.split("\n\n## Project Instructions\n", 1)[0];
  return { context: activation, skills: [...new Set([...activation.matchAll(/Skill\(([a-z-]+)\)/gu)].map((match) => match[1]))] };
};

describe("lit-schematic stub enrollment", () => {
  it("is in the skill catalog, the LIT card list, the pinned trees and the resource hash manifest", () => {
    assert.ok(canonicalSkillIds.includes("lit-schematic"));
    assert.ok(LIT_SKILL_IDS.includes("lit-schematic"));
    assert.match(readFileSync(join(root, "tools", "gen-canonical-skill-resources.mjs"), "utf8"), /"skills\/lit-schematic",/u);
    for (const file of skillFiles) {
      assert.ok(canonicalSkillResourceManifest.has(`skills/lit-schematic/${file}`), `unpinned resource ${file}`);
    }
  });

  it("is wired to the prompt hook and documented in both guides, both skills pages, both READMEs, the hook guide and the changelog", () => {
    const hook = readFileSync(hookPath, "utf8");
    assert.match(hook, /"lit-schematic": \{ command: "\/litclaude:lit-schematic"/u);
    assert.match(hook, /"lit-schematic": "Mode contract: lit-schematic moved/u);
    for (const doc0 of ["docs/guide.md", "docs/guide_ko-KR.md", "docs/skills.md", "docs/skills_ko-KR.md", "docs/hooks.md", "README.md", "README_ko-KR.md", "CHANGELOG.md"]) {
      assert.match(readFileSync(join(root, doc0), "utf8"), /lit-schematic/u, `${doc0} must document the skill`);
    }
    assert.ok(existsSync(join(root, "docs", "assets", "skills", "lit-schematic.webp")), "skills page snapshot");
  });
});

describe("lit-schematic routes", () => {
  it("activates on its tokens and on lit prompts that ask to draw real equipment", () => {
    for (const prompt of [
      "lit-schematic hydrate reactor loop",
      "$lit-schematic 실험 장치 모식도",
      "lit 고압 하이드레이트 반응기 루프 P&ID 그려줘",
      "lit draw a two-panel journal figure of the experimental setup",
      "lit isometric cutaway of a stirred autoclave",
      "lit 논문용 실험 장치 모식도 만들어줘",
      "lit draw the PFD for the absorber section",
    ]) {
      const { skills, context } = hookSkills(prompt);
      assert.deepEqual(skills, ["lit-schematic"], prompt);
      assert.match(context, /<litclaude-skill-body name="lit-schematic">/u);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${prompt}: activation within 4096 bytes`);
    }
  });

  it("activates on Korean drawing nouns, with or without a verb where the noun names a drawing", () => {
    for (const prompt of [
      "lit 장비 레이아웃 도면 그려줘",
      "lit 반응기 단면도",
      "lit 공정 계통도",
      "lit 공장 배치도 그려줘",
      "lit 냉각수 계통도 그려줘",
      "lit 실험 장치 그림 그려줘",
      "lit 공정 흐름도 그려줘",
      "lit draw the plot plan for the tank farm",
    ]) {
      assert.deepEqual(hookSkills(prompt).skills, ["lit-schematic"], prompt);
    }
  });

  it("keeps Korean documents, decks, charts and interfaces with their owners", () => {
    for (const [prompt, expected] of [
      ["lit 도면 검토 보고서 작성해줘", ["lit-docx"]],
      ["lit 공정도 설명 보고서 작성해줘", ["lit-docx"]],
      ["lit 배치도 설명 발표자료 만들어줘", ["lit-pptx"]],
      ["lit 계통도 요약 슬라이드 만들어줘", ["lit-pptx"]],
      ["lit 배치도를 보여주는 대시보드 화면 만들어줘", ["frontend-ui-ux"]],
      ["lit 계통도 모니터링 페이지 디자인해줘", ["frontend-ui-ux"]],
    ]) {
      assert.deepEqual(hookSkills(prompt).skills, expected, prompt);
    }
    for (const prompt of ["lit 단면도 데이터로 그래프 그려줘", "lit 실험 장치 온도 차트 그려줘", "lit plot the P&ID loop pressure graph", "lit 도면 번호 체계 정리해줘"]) {
      assert.ok(!hookSkills(prompt).skills.includes("lit-schematic"), prompt);
    }
  });

  it("leaves documents, interfaces, schema work and tokenless prompts to their owners", () => {
    assert.deepEqual(hookSkills("lit P&ID 설명 보고서 작성해줘").skills, ["lit-docx"]);
    assert.deepEqual(hookSkills("lit make a report about the P&ID").skills, ["lit-docx"]);
    assert.deepEqual(hookSkills("lit design an isometric hero illustration for the landing page").skills, ["frontend-ui-ux"]);
    // An interface that shows a drawing is an interface; the drawing inside it is drawn here.
    assert.deepEqual(hookSkills("lit build a dashboard showing the P&ID of the reactor").skills, ["frontend-ui-ux"]);
    assert.deepEqual(hookSkills("lit P&ID 모니터링 대시보드 만들어줘").skills, ["frontend-ui-ux"]);
    for (const prompt of ["lit draw a P&ID of the reactor loop", "lit draw the P&ID that goes on the dashboard", "lit make the equipment layout for the compressor house"]) {
      assert.deepEqual(hookSkills(prompt).skills, ["lit-schematic"], prompt);
    }
    for (const prompt of ["lit fix the database schema migration", "draw a P&ID of the reactor", "the lit-schematic skill is new", "lit-diagram-drawer draw the service deployment boundary"]) {
      assert.ok(!hookSkills(prompt).skills.includes("lit-schematic"), prompt);
    }
  });

  it("keeps a cutaway asked for as a film or a page with lit-schematic", () => {
    assert.deepEqual(hookSkills("lit 오토클레이브 컷어웨이를 모션 영상으로 만들어줘").skills, ["lit-schematic"]);
    assert.deepEqual(hookSkills("lit make an interactive html cutaway of the reactor").skills, ["lit-schematic"]);
    assert.deepEqual(hookSkills("lit draw an animated cutaway of the autoclave as an mp4").skills, ["lit-schematic"]);
    assert.deepEqual(hookSkills("lit 우리 제품 소개 영상 만들어줘").skills, ["lit-typographic-motion"]);
  });
});
