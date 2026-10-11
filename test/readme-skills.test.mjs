import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { APPROVED_PAYLOAD_PATHS, README_SKILL_IMAGE_PATHS } from "../tools/check-pack-payload.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
// The skill gallery lives on docs/skills.md (Korean: docs/skills_ko-KR.md), linked from the README.
// Each page loads its snapshots from the repository, relative to docs/.
const docsRoot = new URL("docs/", root);
const skillBase = "./assets/skills/";
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
    path: "docs/skills.md",
    readme: "README.md",
    heading: "## Skills at a glance",
    header: "<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>",
    groupRoute: "runs on its own",
  },
  ko: {
    path: "docs/skills_ko-KR.md",
    readme: "README_ko-KR.md",
    heading: "## 스킬 한눈에 보기",
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
  assert.equal(lines.findIndex((line, index) => index > at(spec.heading) && /^#{1,2} /u.test(line)), -1, `${spec.heading} is the last section`);

  const body = lines.slice(at(spec.heading)).join("\n");
  assert.equal(body.match(/<table>/gu)?.length, 1, "one skill table");
  assert.ok(body.includes(`<table>\n${spec.header}\n`), "table header");
  assert.equal(body.match(/<tr>/gu).length, ROWS.length + 1, "one row per skill plus the header");
  const rows = [...body.matchAll(ROW)];
  assert.equal(rows.length, ROWS.length, "every row keeps the picture, skill and result cells");
  rows.forEach(([, src, alt, name, route, result], index) => {
    const id = ROWS[index];
    assert.equal(src, `${skillBase}${id}.webp`, `row ${index + 1} shows ${id}`);
    assert.ok(lstatSync(new URL(src, docsRoot)).isFile(), `${src} must exist on disk`);
    const skills = GROUPS[id] ?? [id];
    assert.equal(name, skills.map((skill) => `<code>${skill}</code>`).join(" · "), `${id} name cell`);
    if (GROUPS[id]) assert.equal(route, spec.groupRoute, `${id} runs without a route`);
    else assert.match(route, /^<code>[^<]+<\/code>(?: · <code>[^<]+<\/code>)?$/u, `${id} route`);
    assert.equal(alt, result.replaceAll(/<\/?code>/gu, ""), `${id} alt text repeats the visible line`);
  });
  assert.doesNotMatch(body, /\blit(?:hermes|codex|opencode|grok)\b|\.litclaude\/|plans\/|run_id|illustrative|🔥/iu, "no sibling products or internal exhaust");
  return body;
}

test("both skills pages carry the skill table with one pictured row per skill, linked from their README", () => {
  for (const lang of Object.keys(LANG)) {
    assertSkillsSection(read(LANG[lang].path), lang);
    const readme = read(LANG[lang].readme);
    assert.ok(readme.includes(`href="./${LANG[lang].path}"`), `${LANG[lang].readme} top nav links the skills page`);
    assert.ok(readme.includes(`](./${LANG[lang].path})`), `${LANG[lang].readme} body links the skills page`);
  }
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
  const content = read("docs/skills.md");
  const section = assertSkillsSection(content, "en");
  const pptxRow = section.match(/<tr>\n<td><img src="[^"]+\/lit-pptx\.webp"[\s\S]*?<\/tr>\n/u)[0];
  for (const mutation of [
    content.replace(pptxRow, ""),
    content.replace(`${skillBase}lit-docx.webp`, `${skillBase}lit-pptx.webp`),
    content.replace("<code>rules</code> · <code>lsp</code> · <code>comment-checker</code>", "<code>rules</code> · <code>lsp</code>"),
    `${content}\n## Notes\n\nA section after the table.\n`,
    content.replace("<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>", "<tr><th>Skill</th></tr>"),
  ]) {
    assert.notEqual(mutation, content);
    assert.throws(() => assertSkillsSection(mutation, "en"));
  }
});
