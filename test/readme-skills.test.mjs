import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { APPROVED_PAYLOAD_PATHS, README_SKILL_IMAGE_PATHS } from "../tools/check-pack-payload.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
// The skill gallery lives on the GitHub README, which loads each snapshot from the repository.
const skillBase = "./docs/assets/skills/";
const MAX_SNAPSHOT_BYTES = 81_920;

// Table order. A grouped row stands for several hook-run skills that have no route of their own.
const ROWS = [
  "lit-loop", "litwork", "lit-plan", "start-work", "review-work", "litgoal", "lit-recap",
  "lit-handoff", "deep-interview", "litresearch", "lit-crucible", "lit-init", "lit-comprehend",
  "lit-humanizer", "lit-diagram-drawer", "lit-pptx", "lit-docx", "frontend-ui-ux", "readme-studio",
  "lit-typographic-motion", "lit-scientific-visualization", "visual-qa", "browser-drive",
  "structural-search", "lit-team", "autoresearch", "autoconference", "wikify", "debugging",
  "refactor", "lit-burnoff", "lit-burnoff-file", "lit-code", "lit-commit", "lsp-setup",
  "automatic-checks",
];
const GROUPS = { "automatic-checks": ["rules", "lsp", "comment-checker"] };

const LANG = {
  en: {
    path: "README.md",
    heading: "## Skills at a glance",
    after: "## What to type",
    before: "## A/B results",
    nav: '<a href="#what-to-type">What to type</a> · <a href="#skills-at-a-glance">Skills</a> · ',
    header: "<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>",
    groupRoute: "runs on its own",
  },
  ko: {
    path: "README_ko-KR.md",
    heading: "## 스킬 한눈에 보기",
    after: "## 무엇을 입력하나요",
    before: "## A/B 결과",
    nav: '<a href="#무엇을-입력하나요">입력할 내용</a> · <a href="#스킬-한눈에-보기">스킬</a> · ',
    header: "<tr><th>이렇게 됩니다</th><th>스킬</th><th>얻는 것</th></tr>",
    groupRoute: "자동 실행",
  },
};

const ROW = /<tr>\n<td><img src="([^"]+)" width="240" alt="([^"<>]+)" \/><\/td>\n<td>(.+?)<br \/><sub>(.+?)<\/sub><\/td>\n<td>(.+?)<\/td>\n<\/tr>/gu;

function assertSkillsSection(content, lang) {
  const spec = LANG[lang];
  const lines = content.split("\n");
  const at = (heading) => lines.indexOf(heading);
  assert.equal(lines.filter((line) => line === spec.heading).length, 1, `${spec.heading} appears once`);
  assert.ok(at(spec.after) !== -1 && at(spec.after) < at(spec.heading), `${spec.heading} follows ${spec.after}`);
  const next = lines.findIndex((line, index) => index > at(spec.heading) && line.startsWith("## "));
  assert.equal(lines[next], spec.before, `${spec.heading} sits directly before ${spec.before}`);
  assert.ok(content.includes(spec.nav), "the top nav links the section");

  const body = lines.slice(at(spec.heading), next).join("\n");
  assert.equal(body.match(/<table>/gu)?.length, 1, "one skill table");
  assert.ok(body.includes(`<table>\n${spec.header}\n`), "table header");
  assert.equal(body.match(/<tr>/gu).length, ROWS.length + 1, "one row per skill plus the header");
  const rows = [...body.matchAll(ROW)];
  assert.equal(rows.length, ROWS.length, "every row keeps the picture, skill and result cells");
  rows.forEach(([, src, alt, name, route, result], index) => {
    const id = ROWS[index];
    assert.equal(src, `${skillBase}${id}.webp`, `row ${index + 1} shows ${id}`);
    assert.ok(lstatSync(new URL(src, root)).isFile(), `${src} must exist on disk`);
    const skills = GROUPS[id] ?? [id];
    assert.equal(name, skills.map((skill) => `<code>${skill}</code>`).join(" · "), `${id} name cell`);
    if (GROUPS[id]) assert.equal(route, spec.groupRoute, `${id} runs without a route`);
    else assert.match(route, /^<code>[^<]+<\/code>(?: · <code>[^<]+<\/code>)?$/u, `${id} route`);
    assert.equal(alt, result.replaceAll(/<\/?code>/gu, ""), `${id} alt text repeats the visible line`);
  });
  assert.doesNotMatch(body, /\blit(?:hermes|codex|opencode|grok)\b|\.litclaude\/|plans\/|run_id|illustrative|🔥/iu, "no sibling products or internal exhaust");
  return body;
}

test("both READMEs carry the skill table with one pictured row per skill", () => {
  for (const lang of Object.keys(LANG)) assertSkillsSection(read(LANG[lang].path), lang);
});

test("the skill table covers every canonical skill exactly once, including the office and motion skills", () => {
  const covered = ROWS.flatMap((id) => GROUPS[id] ?? [id]);
  assert.equal(new Set(covered).size, covered.length, "no skill appears in two rows");
  assert.deepEqual([...covered].sort(), [...canonicalSkillIds].sort());
  for (const id of ["lit-pptx", "lit-docx", "lit-typographic-motion"]) assert.ok(ROWS.includes(id), `${id} has a row`);
});

test("skill snapshots ship as exact package paths under their byte cap", () => {
  const expected = ROWS.map((id) => `${id}.webp`);
  assert.deepEqual(readdirSync(new URL("docs/assets/skills/", root)).sort(), [...expected].sort());
  for (const file of expected) {
    const path = new URL(`docs/assets/skills/${file}`, root);
    assert.ok(statSync(path).size <= MAX_SNAPSHOT_BYTES, `${file} stays within ${MAX_SNAPSHOT_BYTES} bytes`);
    const bytes = readFileSync(path);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF", file);
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP", file);
  }
  assert.deepEqual(README_SKILL_IMAGE_PATHS, ROWS.map((id) => `docs/assets/skills/${id}.webp`));
  for (const path of README_SKILL_IMAGE_PATHS) assert.ok(APPROVED_PAYLOAD_PATHS.has(path), `${path} is an exact pack exception`);
  assert.ok(JSON.parse(read("package.json")).files.includes("docs/assets/skills"), "skill snapshots keep shipping in the package");
});

test("skill table check rejects a dropped row, a swapped picture, a lost group member or a moved section", () => {
  const content = read("README.md");
  const section = assertSkillsSection(content, "en");
  const pptxRow = section.match(/<tr>\n<td><img src="[^"]+\/lit-pptx\.webp"[\s\S]*?<\/tr>\n/u)[0];
  for (const mutation of [
    content.replace(pptxRow, ""),
    content.replace(`${skillBase}lit-docx.webp`, `${skillBase}lit-pptx.webp`),
    content.replace("<code>rules</code> · <code>lsp</code> · <code>comment-checker</code>", "<code>rules</code> · <code>lsp</code>"),
    content.replace(section, "").replace("\n## Learn more\n", `\n${section}\n## Learn more\n`),
    content.replace('<a href="#skills-at-a-glance">Skills</a> · ', ""),
  ]) {
    assert.notEqual(mutation, content);
    assert.throws(() => assertSkillsSection(mutation, "en"));
  }
});
