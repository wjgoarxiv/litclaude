import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const pptxRoot = join(pluginRoot, "skills", "lit-pptx");
const docxRoot = join(pluginRoot, "skills", "lit-docx");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === ".git" || entry.name === "node_modules") return [];
  return entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)];
});
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// SPEC D2: files that arrived in the personal pptx skill with its initial import. They are
// identical to a third-party skill and must never ship in this package, under any name.
const EXCLUDED_SHA256 = new Map([
  ["79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa", "LICENSE.txt"],
  ["2d03c07a51c1793be8774664ff6594dcb6ecd3791cf718cd214c296c073fbb39", "scripts/html2pptx.js"],
  ["5da81aba1bfbfd522b52db3156d68d483676ec6d3020a9f5fed684ba8af13335", "html2pptx.md"],
  ["09868e9f1786765421ecf3f0f49c77006738efda82a76df43ed87f7a9bfe2467", "ooxml.md"],
  ["6fe762f45aff8c63fd95b9fcb1337b28921d6fa454e18a0e8158d4c8708d6d00", "ooxml/scripts/pack.py"],
  ["0bd17f76a1a4c388aba42c6d1d39015fa84e405c3e0692397fe12762bd632b58", "ooxml/scripts/unpack.py"],
  ["1ec252de8b14b07d16966c48906ccb1c45c68bcd23557ad31d8c50a27f5f8c0f", "ooxml/scripts/validate.py"],
  ["adead8fe6270e520c397cec9fbee4d606ab10bb80f749e018b42ec894c60d2e5", "scripts/inventory.py"],
  ["c21fd950b6ada7bd2f029885d3e56bc66b7ff061cc8404c492eb301664aa9e5d", "scripts/thumbnail.py"],
  ["8a590747551be847a904e3296fb2f35aa4e7feeb4970a61596c2375306462820", "scripts/replace.py"],
  ["c04ac37916f398ba621b2d9e1e4c1a69225eaad6d7fb0ad116c237ddeb1b2b68", "scripts/rearrange.py"],
]);

const hookContext = (prompt, cwd = root) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const officeSkillsFor = (prompt) => {
  const context = hookContext(prompt).split("\n\n## Project Instructions\n", 1)[0];
  return [...new Set([...context.matchAll(/Skill\((lit-pptx|lit-docx)\)/gu)].map((match) => match[1]))];
};

describe("lit-pptx and lit-docx — excluded third-party files never ship", () => {
  const findExcluded = (dir, table = EXCLUDED_SHA256) => walk(dir)
    .filter((file) => statSync(file).size < 4 * 1024 * 1024)
    .map((file) => [relative(dir, file), table.get(sha256(file))])
    .filter(([, excluded]) => excluded);

  it("no file in the repository matches an excluded SHA-256", () => {
    const hits = findExcluded(root);
    assert.deepEqual(hits, [], `excluded files present: ${JSON.stringify(hits)}`);
  });

  it("the scan reports a planted file whose hash is on the list, under any name", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-guard-"));
    try {
      writeFileSync(join(dir, "renamed.js"), "planted bytes\n");
      const table = new Map([...EXCLUDED_SHA256, [sha256(join(dir, "renamed.js")), "planted.js"]]);
      assert.deepEqual(findExcluded(dir, table), [["renamed.js", "planted.js"]]);
      assert.deepEqual(findExcluded(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no excluded script name or the HTML-first path survives in the office skills", () => {
    const names = [...walk(pptxRoot), ...walk(docxRoot)].map((file) => relative(pluginRoot, file));
    for (const banned of [/html2pptx/u, /(^|\/)ooxml(\/|\.md$)/u, /(^|\/)(inventory|thumbnail|replace|rearrange)\.py$/u, /LICENSE\.txt$/u]) {
      assert.deepEqual(names.filter((name) => banned.test(name)), [], `${banned} must not ship`);
    }
    for (const file of [...walk(pptxRoot), ...walk(docxRoot)].filter((f) => /\.(md|py|js|yaml|json)$/u.test(f))) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /html2pptx|thumbnail\.py|[^_]inventory\.py|ooxml\/scripts/u, relative(root, file));
    }
  });

  it("no company brand template, logo or photo ships (user decision: the company template is excluded)", () => {
    assert.equal(existsSync(join(pptxRoot, "templates", "enrolled", "TEMPLATE-EXAMPLE-1")), false);
    assert.equal(existsSync(join(pptxRoot, "assets", "media")), false);
    const office = [...walk(pptxRoot), ...walk(docxRoot)];
    for (const file of office.filter((f) => /\.(md|py|js|mjs|yaml|json|txt)$/u.test(f) || f.endsWith("NOTICE"))) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /TEMPLATE-EXAMPLE-1|BrandBay/u, relative(root, file));
    }
  });

});

describe("lit-pptx and lit-docx — bare lit routing", () => {
  it("routes report and slide wording under a bare lit, in Korean and English", () => {
    assert.deepEqual(officeSkillsFor("지난달 고객 설문 결과로 보고서 작성해줘 lit"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("팀 워크숍용 슬라이드 준비해줘 lit"), ["lit-pptx"]);
    assert.deepEqual(officeSkillsFor("연구실 안전 교육 발표 자료랑 요약 문서 만들어줘 lit"), ["lit-pptx", "lit-docx"]);
    assert.deepEqual(officeSkillsFor("이사회 보고용 PPT 뽑아줘 lit"), ["lit-pptx"]);
    assert.deepEqual(officeSkillsFor("사내 봉사활동 제안서 초안 잡아서 워드로 정리해줘 lit"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("draft a memo about the office move lit"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("lit build a presentation on our hiring funnel"), ["lit-pptx"]);
    assert.deepEqual(officeSkillsFor("write a docx summarizing the vendor survey lit"), ["lit-docx"]);
  });

  it("routes a deck asked for by its slide count and a named style, with no making verb, to lit-pptx", () => {
    for (const prompt of [
      "lit 신규 서비스 투자 피칭 덱 10장, 네오 브루탈리즘 스타일로",
      "lit 사내 플랫폼 아키텍처 리뷰 발표자료 9장, 컴퓨테이셔널 브루탈리즘 스타일로",
      "lit 디자인사 강의 슬라이드 12장 바우하우스 느낌으로",
      "lit a 10-slide launch deck in a neo-brutalist style",
    ]) {
      assert.deepEqual(officeSkillsFor(prompt), ["lit-pptx"], prompt);
      assert.doesNotMatch(hookContext(prompt).split("\n\n## Project Instructions\n", 1)[0], /Skill\(frontend-ui-ux\)/u, prompt);
    }
    // A count alone is not a deck: no slide noun, no route.
    assert.deepEqual(officeSkillsFor("lit 사진 10장 보정 스타일로"), []);
  });

  it("keeps code documentation, tool reports and non-office work off the office route", () => {
    for (const prompt of [
      "README 문서 업데이트해줘 lit",
      "API 문서 작성해줘 lit",
      "write the API docs for the router lit",
      "fix the flaky test report lit",
      "report the bug in the parser lit",
      "검색 인덱스 만들어줘 lit",
      "lit refactor the report generator module",
      "the deck of cards shuffle has a bug lit",
      "발표자료 만들어줘",
      "write a report",
    ]) {
      assert.deepEqual(officeSkillsFor(prompt), [], `must not route: ${prompt}`);
    }
  });

  it("does not read 'each document' in an engineering request as a Word deliverable", () => {
    const prompt = "Extensive port is required for litmuse. Do NOT just write brief description in each document. Utilize right /herdr pane and start the extensive port procedure with sonnet-grade subagent swarm. Let's gooooo. I like M8 option. (recommendation) ultrathink lit";
    assert.deepEqual(officeSkillsFor(prompt), []);
    assert.match(hookContext(prompt), /Skill\(lit-loop\)/u, "an ordinary lit-loop route");
    for (const quantified of [
      "write the summary in every document lit",
      "fix the typos in all documents lit",
      "draft notes for each doc lit",
      "write a short description in these documents lit",
    ]) {
      assert.deepEqual(officeSkillsFor(quantified), [], `must not route: ${quantified}`);
    }
    assert.deepEqual(officeSkillsFor("lit make a docx report"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("lit write a Word document"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("write a document about the office move lit"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("write a project plan document lit"), ["lit-docx"]);
  });

  it("routes an office request whose source is a Markdown file, and keeps project docs out", () => {
    assert.deepEqual(officeSkillsFor("lit notes.md 메모 파일로 월요일 팀 회의용 슬라이드 10장 만들어줘"), ["lit-pptx"]);
    assert.deepEqual(officeSkillsFor("lit turn notes.md into a 10-slide deck for Monday"), ["lit-pptx"]);
    assert.deepEqual(officeSkillsFor("lit turn meeting-notes.md into a Word report"), ["lit-docx"]);
    assert.deepEqual(officeSkillsFor("lit summary.md 내용으로 보고서 작성해줘"), ["lit-docx"]);
    for (const prompt of [
      "lit update the README with the new install steps",
      "lit write the CHANGELOG.md entry for this release",
      "lit draft docs/setup.md for new contributors",
      "lit AGENTS.md 문서 작성해줘",
      "lit write SECURITY.md for the report process",
    ]) {
      assert.deepEqual(officeSkillsFor(prompt), [], `must not route: ${prompt}`);
    }
  });

  it("names the installed stubs and carries no style gate or document defaults", () => {
    // Both office skills are same-name stubs now (decks and documents plugins of wjgoarxiv-skills).
    const bare = hookContext("분기 계획 보고서 써줘 lit");
    assert.match(bare, /LIT IGNITED · lit-docx|lit-docx/u);
    assert.ok(bare.includes(join(docxRoot, "SKILL.md")), "installed SKILL.md path");
    const explicit = hookContext("lit-pptx 신규 입사자 온보딩 덱");
    assert.ok(explicit.includes(join(pptxRoot, "SKILL.md")));
    const docxToken = hookContext("lit-docx 신규 입사자 안내 문서");
    assert.ok(docxToken.includes(join(docxRoot, "SKILL.md")));
    for (const context of [bare, explicit, docxToken]) {
      assert.doesNotMatch(context, /Style gate:|ask no style questions|never become \[blanks\]/u);
    }
  });
});
