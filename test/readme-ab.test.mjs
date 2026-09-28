import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const version = JSON.parse(read("package.json")).version;
// The A/B pictures live on the GitHub README, which loads them from the repository.
const abBase = "./docs/ab/";

// The maintainer's final verdicts and the blind judge's verdict from the same round.
// W = LitClaude won, T = tie, L = baseline won. `eye: false` marks pairs the maintainer
// did not review, where the final verdict is the blind judge's.
const EXPECTED = [
  { task: "S1", final: "W", judge: "T", eye: true },
  { task: "S2", final: "W", judge: "W", eye: false },
  { task: "S3", final: "W", judge: "L", eye: true },
  { task: "S4", final: "W", judge: "W", eye: true },
  { task: "S5", final: "W", judge: "L", eye: true },
  { task: "S6", final: "W", judge: "T", eye: true },
  { task: "S7", final: "W", judge: "W", eye: false },
  { task: "S8", final: "W", judge: "L", eye: true },
  { task: "S9", final: "W", judge: "W", eye: true },
  { task: "S11", final: "W", judge: "W", eye: true },
];

const LANG = {
  en: {
    path: "README.md",
    heading: "## A/B results",
    header: "| Task | Prompt | Final verdict | Blind judge (same round) |",
    cell: { W: "LitClaude won", T: "Tie", L: "Baseline won" },
    notByEye: " (blind judge; not reviewed by eye)",
    total: "| Total | | LitClaude 10 won | LitClaude 5 won, 2 ties, 3 lost |",
    motion: "The motion skill, `lit-typographic-motion`, was rebuilt after its first A/B and has no A/B result yet. The cover at the top of this page was made with it.",
  },
  ko: {
    path: "README_ko-KR.md",
    heading: "## A/B 결과",
    header: "| 과제 | 프롬프트 | 최종 판정 | 블라인드 판정(같은 회차) |",
    cell: { W: "LitClaude 승", T: "무승부", L: "기준 쪽 승" },
    notByEye: " (블라인드 판정, 직접 보지 않음)",
    total: "| 합계 | | LitClaude 10승 | LitClaude 5승 2무 3패 |",
    motion: "모션 스킬 `lit-typographic-motion`은 첫 A/B 뒤에 다시 만들었고, 아직 A/B 결과가 없습니다. 이 페이지 맨 위의 커버가 이 스킬로 만든 영상입니다.",
  },
};

const PROMPTS = {
  S1: "터미널에서 쓰는 할 일 관리 CLI 만들어줘",
  S2: "이 API 서버 가끔 이상하게 동작하는데 고쳐줘",
  S3: "개인 가계부 대시보드 웹페이지 만들어줘",
  S4: "동네 카페 브랜드 랜딩페이지 만들어줘",
  S5: "sources 폴더 자료로 보고서랑 발표자료 만들어줘",
  S6: "Node 22에서 24로 올릴 때 달라지는 거 조사해줘",
  S7: "주문-결제-배송 서비스 구조도 그려줘",
  S8: "분기 실적 발표자료 만들어줘",
  S9: "신제품 기획서 써줘",
  S11: "회의실 예약 웹앱 만들어줘",
};

function section(content, heading) {
  const start = content.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `${heading} section is required`);
  const rest = content.slice(start + 1);
  const next = rest.slice(heading.length).search(/\n## /u);
  return next === -1 ? rest : rest.slice(0, heading.length + next + 1);
}

function assertAbSection(content, lang) {
  const spec = LANG[lang];
  const body = section(content, spec.heading);
  const lines = body.split("\n");
  const headerAt = lines.indexOf(spec.header);
  assert.notEqual(headerAt, -1, "summary table header is required");
  const rows = lines.slice(headerAt + 2, headerAt + 2 + EXPECTED.length);
  EXPECTED.forEach((expected, index) => {
    const cells = rows[index]?.split(" | ") ?? [];
    assert.equal(cells.length, 4, `${expected.task} row must have four cells`);
    assert.ok(cells[0].startsWith(`| ${expected.task} · `), `row ${index + 1} must be ${expected.task}`);
    assert.equal(cells[1], `\`${PROMPTS[expected.task]}\``, `${expected.task} prompt`);
    assert.equal(cells[2], spec.cell[expected.final] + (expected.eye ? "" : spec.notByEye), `${expected.task} final verdict`);
    assert.equal(cells[3], `${spec.cell[expected.judge]} |`, `${expected.task} blind judge verdict`);
  });
  assert.equal(lines[headerAt + 2 + EXPECTED.length], spec.total, "total row must follow the task rows");
  assert.ok(body.includes(spec.motion), "the motion skill line is required");
  assert.doesNotMatch(body, /\bS10\b/u, "no motion A/B row");
  assert.doesNotMatch(body, /\.litclaude\/|evidence|round-\d|judge-|run_id|IGNITED|🔥/u, "no internal exhaust or signature scoring");
  assert.doesNotMatch(body, new RegExp(`LitClaude ${version.replaceAll(".", "\\.")}`, "u"), "the tested build is not the published version");
  for (const { task } of EXPECTED) assert.match(body, new RegExp(`^### ${task} · `, "mu"), `${task} note is required`);
  return body;
}

test("A/B tables carry the final verdicts beside the blind judge in both READMEs", () => {
  for (const lang of Object.keys(LANG)) assertAbSection(read(LANG[lang].path), lang);
});

test("A/B table check rejects a changed verdict, a dropped marker, a wrong total or a changed motion line", () => {
  const content = read("README.md");
  for (const mutation of [
    content.replace("| `터미널에서 쓰는 할 일 관리 CLI 만들어줘` | LitClaude won | Tie |", "| `터미널에서 쓰는 할 일 관리 CLI 만들어줘` | LitClaude won | LitClaude won |"),
    content.replace("LitClaude won (blind judge; not reviewed by eye) | LitClaude won |", "LitClaude won | LitClaude won |"),
    content.replace("| LitClaude 10 won |", "| LitClaude 9 won |"),
    content.replace("has no A/B result yet", "won its A/B"),
  ]) {
    assert.notEqual(mutation, content);
    assert.throws(() => assertAbSection(mutation, "en"));
  }
});

test("every A/B image ships under docs/ab and both READMEs show all of them", () => {
  const files = readdirSync(new URL("docs/ab/", root)).sort();
  assert.deepEqual(files, [
    "S11-baseline-desktop.webp", "S11-baseline-phone.webp", "S11-litclaude-desktop.webp", "S11-litclaude-phone.webp",
    "S3-baseline-desktop.webp", "S3-baseline-phone.webp", "S3-litclaude-desktop.webp", "S3-litclaude-phone.webp",
    "S4-baseline-desktop.webp", "S4-baseline-phone.webp", "S4-litclaude-desktop.webp", "S4-litclaude-phone.webp",
    "S5-baseline-pages.webp", "S5-baseline-slides.webp", "S5-litclaude-pages.webp", "S5-litclaude-slides.webp",
    "S7-litclaude-diagram.webp",
    "S8-baseline-slides.webp", "S8-litclaude-slides.webp",
    "S9-litclaude-pages.webp",
  ]);
  for (const lang of Object.keys(LANG)) {
    const content = read(LANG[lang].path);
    const body = section(content, LANG[lang].heading);
    const used = new Set([...content.matchAll(/docs\/ab\/([^"\s)]+)/gu)].map((match) => match[1]));
    assert.deepEqual([...used].sort(), files, `${lang} README must show every A/B image and nothing else under docs/ab`);
    for (const file of files) {
      assert.ok(body.includes(`src="${abBase}${file}"`), `${lang} README must embed ${file} in the A/B section`);
      assert.ok(lstatSync(new URL(`${abBase}${file}`, root)).isFile(), `${abBase}${file} must exist on disk`);
    }
  }
  const packageJson = JSON.parse(read("package.json"));
  assert.ok(packageJson.files.includes("docs/ab"), "A/B images keep shipping in the package");
});
