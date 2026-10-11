import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const READMES = [
  "README.md", "README_ko-KR.md", "README_npm.md", "README_npm_ko-KR.md",
  "docs/guide.md", "docs/guide_ko-KR.md", "docs/skills.md", "docs/skills_ko-KR.md",
];
const FORBIDDEN = [
  /A\/B/u,
  /blind judge/iu,
  /final verdict/iu,
  /docs\/ab\b/u,
  /#ab-(?:results|결과)/u,
  /블라인드/u,
  /최종 판정/u,
];

test("no README, npm card or guide page shows an A/B comparison, a blind judge or a final verdict", () => {
  for (const path of READMES) {
    const content = read(path);
    for (const pattern of FORBIDDEN) assert.doesNotMatch(content, pattern, `${path} must not match ${pattern}`);
  }
});

test("no A/B heading remains and nothing follows the skills section on the skills page", () => {
  for (const path of ["README.md", "README_ko-KR.md", "docs/guide.md", "docs/guide_ko-KR.md"]) {
    assert.ok(!read(path).split("\n").some((line) => /^#{1,6} .*A\/B/u.test(line)), `${path} has no A/B heading`);
  }
  const headings = { "docs/skills.md": "## Skills at a glance", "docs/skills_ko-KR.md": "## 스킬 한눈에 보기" };
  for (const [path, skills] of Object.entries(headings)) {
    const lines = read(path).split("\n");
    assert.ok(!lines.some((line) => /^#{1,6} .*A\/B/u.test(line)), `${path} has no A/B heading`);
    const at = lines.indexOf(skills);
    assert.notEqual(at, -1, `${path} keeps ${skills}`);
    assert.equal(lines.slice(at + 1).find((line) => /^#{1,2} /u.test(line)), undefined, `${path} ends with ${skills}`);
  }
});

test("the A/B images are gone from the tree and from the package file list", () => {
  assert.equal(existsSync(new URL("docs/ab/", root)), false, "docs/ab must not exist");
  const packageJson = JSON.parse(read("package.json"));
  assert.ok(!packageJson.files.some((entry) => entry === "docs/ab" || entry.startsWith("docs/ab/")), "package.json files must not list docs/ab");
});
