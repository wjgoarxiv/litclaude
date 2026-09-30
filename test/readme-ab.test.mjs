import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const READMES = ["README.md", "README_ko-KR.md", "README_npm.md", "README_npm_ko-KR.md"];
const FORBIDDEN = [
  /A\/B/u,
  /blind judge/iu,
  /final verdict/iu,
  /docs\/ab\b/u,
  /#ab-(?:results|결과)/u,
  /블라인드/u,
  /최종 판정/u,
];

test("no README or npm card shows an A/B comparison, a blind judge or a final verdict", () => {
  for (const path of READMES) {
    const content = read(path);
    for (const pattern of FORBIDDEN) assert.doesNotMatch(content, pattern, `${path} must not match ${pattern}`);
  }
});

test("no A/B heading remains and the skills section leads into How it works", () => {
  const headings = { "README.md": ["## Skills at a glance", "## How it works"], "README_ko-KR.md": ["## 스킬 한눈에 보기", "## 작동 방식"] };
  for (const [path, [skills, next]] of Object.entries(headings)) {
    const lines = read(path).split("\n");
    const headingLines = lines.filter((line) => line.startsWith("## "));
    assert.ok(!headingLines.some((line) => /A\/B/u.test(line)), `${path} has no A/B heading`);
    const at = lines.indexOf(skills);
    assert.notEqual(at, -1, `${path} keeps ${skills}`);
    assert.equal(lines.slice(at + 1).find((line) => line.startsWith("## ")), next, `${path} follows ${skills} with ${next}`);
  }
});

test("the A/B images are gone from the tree and from the package file list", () => {
  assert.equal(existsSync(new URL("docs/ab/", root)), false, "docs/ab must not exist");
  const packageJson = JSON.parse(read("package.json"));
  assert.ok(!packageJson.files.some((entry) => entry === "docs/ab" || entry.startsWith("docs/ab/")), "package.json files must not list docs/ab");
});
