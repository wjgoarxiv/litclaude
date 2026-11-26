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

// Core table order. A grouped row stands for several hook-run skills that have no route of their own.
const CORE = [
  "lit-loop", "litwork", "lit-plan", "start-work", "review-work", "litgoal", "lit-adhd",
  "lit-handoff", "lit-brainstorm", "ultra-brainstorm", "deep-interview", "litresearch", "lit-hijack", "lit-crucible", "lit-init", "lit-comprehend",
  "lit-humanizer", "browser-drive",
  "structural-search", "lit-team", "autoresearch", "autoconference", "wikify", "debugging",
  "refactor", "lit-burnoff", "lit-burnoff-file", "lit-code", "lit-commit", "lsp-setup",
  "automatic-checks",
];
// The extension tables, one per wjgoarxiv-skills plugin, each under its install line.
const PLUGINS = [
  ["decks", ["lit-pptx"]],
  ["documents", ["lit-docx"]],
  ["sheets", ["lit-xlsx"]],
  ["figures", ["lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"]],
  ["design", ["frontend-ui-ux", "visual-qa"]],
  ["video-covers", ["readme-studio", "lit-typographic-motion"]],
];
const ROWS = [...CORE, ...PLUGINS.flatMap(([, ids]) => ids)];
const GROUPS = { "automatic-checks": ["rules", "lsp", "comment-checker"] };

const LANG = {
  en: {
    path: "docs/skills.md",
    readme: "README.md",
    heading: "## Core skills",
    extensions: "## Extensions",
    header: "<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>",
    groupRoute: "runs on its own",
  },
  ko: {
    path: "docs/skills_ko-KR.md",
    readme: "README_ko-KR.md",
    heading: "## 핵심 스킬",
    extensions: "## 확장",
    header: "<tr><th>이렇게 됩니다</th><th>스킬</th><th>얻는 것</th></tr>",
    groupRoute: "자동 실행",
  },
};

const ROW = /<tr>\n<td><img src="([^"]+)" width="240" alt="([^"<>]+)" \/><\/td>\n<td>(.+?)<br \/><sub>(.+?)<\/sub><\/td>\n<td>(.+?)<\/td>\n<\/tr>/gu;

const checkRows = (table, ids, spec, where) => {
  assert.ok(table.startsWith(`<table>\n${spec.header}\n`), `${where} table header`);
  assert.equal(table.match(/<tr>/gu).length, ids.length + 1, `${where}: one row per skill plus the header`);
  const rows = [...table.matchAll(ROW)];
  assert.equal(rows.length, ids.length, `${where}: every row keeps the picture, skill and result cells`);
  rows.forEach(([, src, alt, name, route, result], index) => {
    const id = ids[index];
    assert.equal(src, `${skillBase}${id}.webp`, `${where} row ${index + 1} shows ${id}`);
    assert.ok(lstatSync(new URL(src, docsRoot)).isFile(), `${src} must exist on disk`);
    const skills = GROUPS[id] ?? [id];
    assert.equal(name, skills.map((skill) => `<code>${skill}</code>`).join(" · "), `${id} name cell`);
    if (GROUPS[id]) assert.equal(route, spec.groupRoute, `${id} runs without a route`);
    else assert.match(route, /^<code>[^<]+<\/code>(?: · <code>[^<]+<\/code>)?$/u, `${id} route`);
    assert.equal(alt, result.replaceAll(/<\/?code>/gu, ""), `${id} alt text repeats the visible line`);
  });
};

function assertSkillsSection(content, lang) {
  const spec = LANG[lang];
  const lines = content.split("\n");
  const at = (heading) => lines.indexOf(heading);
  for (const heading of [spec.heading, spec.extensions]) assert.equal(lines.filter((line) => line === heading).length, 1, `${heading} appears once`);
  assert.ok(at(spec.heading) < at(spec.extensions), "core comes before the extensions");
  const core = lines.slice(at(spec.heading), at(spec.extensions)).join("\n");
  assert.equal(core.match(/<table>/gu)?.length, 1, "one core table");
  checkRows(core.slice(core.indexOf("<table>"), core.indexOf("</table>")), CORE, spec, "core");
  const extensions = lines.slice(at(spec.extensions)).join("\n");
  assert.equal(extensions.match(/<table>/gu)?.length, PLUGINS.length, "one table per extension plugin");
  assert.deepEqual([...extensions.matchAll(/^### (.+)$/gmu)].map((match) => match[1]), PLUGINS.map(([plugin]) => plugin), "the plugins, in order");
  for (const [plugin, ids] of PLUGINS) {
    const part = extensions.slice(extensions.indexOf(`### ${plugin}\n`)).split(/\n### /u)[0];
    assert.ok(part.includes(`npx @litfamily/litclaude extensions install ${plugin}\n`), `${plugin} has its install line`);
    checkRows(part.slice(part.indexOf("<table>"), part.indexOf("</table>")), ids, spec, plugin);
  }
  const body = lines.slice(at(spec.heading)).join("\n");
  assert.doesNotMatch(body, /\blit(?:hermes|codex|opencode|grok)\b|\.litclaude\/|plans\/|run_id|illustrative|🔥|lit-recap\.webp/iu, "no sibling products, internal exhaust or the removed lit-recap row");
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

test("skill table check rejects a dropped row, a swapped picture, a lost group member, a lost install line or a merged table", () => {
  const content = read("docs/skills.md");
  const section = assertSkillsSection(content, "en");
  const pptxRow = section.match(/<tr>\n<td><img src="[^"]+\/lit-pptx\.webp"[\s\S]*?<\/tr>\n/u)[0];
  const teamRow = section.match(/<tr>\n<td><img src="[^"]+\/lit-team\.webp"[\s\S]*?<\/tr>\n/u)[0];
  for (const mutation of [
    content.replace(pptxRow, ""),
    content.replace(teamRow, ""),
    content.replace(`${skillBase}lit-docx.webp`, `${skillBase}lit-pptx.webp`),
    content.replace("<code>rules</code> · <code>lsp</code> · <code>comment-checker</code>", "<code>rules</code> · <code>lsp</code>"),
    content.replace("npx @litfamily/litclaude extensions install figures\n", ""),
    content.replace("## Extensions\n", ""),
    content.replace("<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>", "<tr><th>Skill</th></tr>"),
  ]) {
    assert.notEqual(mutation, content);
    assert.throws(() => assertSkillsSection(mutation, "en"));
  }
});
