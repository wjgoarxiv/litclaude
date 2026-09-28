import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { nodeStatus, pythonStatus } from "../plugins/litclaude/lib/office-runtime.mjs";
import { fakeNpm, npmGlobalInstallEnv, npmGlobalModeKeys } from "./helpers/fake-npm.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const pptxRoot = join(pluginRoot, "skills", "lit-pptx");
const docxRoot = join(pluginRoot, "skills", "lit-docx");
const libRoot = join(pluginRoot, "lib");
const fixtures = join(root, "test", "fixtures", "lit-office");
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
    const office = [...walk(pptxRoot), ...walk(docxRoot), ...["office-runtime.mjs", "office_runtime_bootstrap.py", "ooxml_integrity.py", "render_pages.py"].map((f) => join(libRoot, f))];
    for (const file of office.filter((f) => /\.(md|py|js|mjs|yaml|json|txt)$/u.test(f) || f.endsWith("NOTICE"))) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /TEMPLATE-EXAMPLE-1|BrandBay/u, relative(root, file));
    }
  });

  it("every shipped template asset is used by a kept template", () => {
    const yaml = walk(join(pptxRoot, "templates")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const asset of walk(join(pptxRoot, "assets"))) {
      const name = asset.split("/").pop();
      assert.ok(yaml.includes(name) || /^circle-(?:lg|md|sm)\.png$/u.test(name), `unused asset ${relative(root, asset)}`);
    }
  });
});

describe("lit-pptx and lit-docx — organic enrollment", () => {
  it("both skills are in the catalog and every shipped file is hash-pinned", () => {
    for (const id of ["lit-pptx", "lit-docx"]) assert.ok(canonicalSkillIds.includes(id), id);
    for (const skill of [pptxRoot, docxRoot]) {
      for (const file of walk(skill)) {
        const key = relative(pluginRoot, file);
        assert.equal(canonicalSkillResourceManifest.get(key), sha256(file), `unpinned or stale: ${key}`);
      }
    }
    for (const key of ["lib/office-runtime.mjs", "lib/office_runtime_bootstrap.py", "lib/ooxml_integrity.py", "lib/render_pages.py", "lib/office_data.py",
      "lib/office-runtime-lock/package.json", "lib/office-runtime-lock/package-lock.json", "lib/office-runtime-lock/requirements.lock"]) {
      assert.equal(canonicalSkillResourceManifest.get(key), sha256(join(pluginRoot, key)), key);
    }
  });

  it("SKILL.md frontmatter names match and point at helpers that exist", () => {
    for (const [id, dir] of [["lit-pptx", pptxRoot], ["lit-docx", docxRoot]]) {
      const body = readFileSync(join(dir, "SKILL.md"), "utf8");
      assert.match(body, new RegExp(`^---\\nname: ${id}\\n`, "u"));
      const helpers = [...new Set([...body.matchAll(/(?<![\w/])(scripts\/[\w.-]+\.(?:py|js|mjs))(?![\w.])/gu)].map((m) => m[1]))];
      assert.ok(helpers.length >= 4, `${id} names its helpers`);
      assert.ok([...body.matchAll(/"\$SKILL_ROOT\/scripts\//gu)].length >= 4, `${id} spells out absolute commands`);
      for (const helper of helpers) assert.ok(existsSync(join(dir, helper)), `${id}: ${helper}`);
      for (const libHelper of [...body.matchAll(/"\$LITCLAUDE_LIB\/([\w.-]+)"/gu)].map((m) => m[1])) {
        assert.ok(existsSync(join(libRoot, libHelper)), `${id}: lib/${libHelper}`);
      }
      assert.ok(existsSync(join(dir, "NOTICE")), `${id} NOTICE`);
    }
  });

  it("both skills teach the data file, the visible example tag and content-sized cards, without the A/B task wording", () => {
    const pptx = readFileSync(join(pptxRoot, "SKILL.md"), "utf8");
    const docx = readFileSync(join(docxRoot, "SKILL.md"), "utf8");
    for (const [id, body] of [["lit-pptx", pptx], ["lit-docx", docx]]) {
      assert.match(body, /^\s*data: [\w.-]+\.json/mu, `${id} shows the data: key`);
      assert.match(body, /office_data\.py" check/u, `${id} runs the data check`);
      assert.match(body, /\{\{ table:[\w-]+ \}\}/u, `${id} shows a data table placeholder`);
      assert.match(body, /coloured tag/u, `${id} explains the visible notice`);
      // The A/B tasks are one-line requests; their wording must not be taught to the skill.
      for (const phrase of ["분기 실적 발표자료", "신제품 기획서", "sources 폴더", "보고서랑 발표자료"]) {
        assert.equal(body.includes(phrase), false, `${id} contains A/B task wording: ${phrase}`);
      }
    }
    assert.match(pptx, /card is as tall as its text/u);
  });

  it("the Node lock carries no advisory-affected sharp or image-size", () => {
    const pkg = JSON.parse(readFileSync(join(libRoot, "office-runtime-lock", "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(libRoot, "office-runtime-lock", "package-lock.json"), "utf8"));
    const atLeast = (version, floor) => {
      const a = version.split(".").map(Number), b = floor.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
      return true;
    };
    assert.ok(atLeast(lock.packages["node_modules/sharp"].version, "0.35.4"), "sharp >= 0.35.4 (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c)");
    assert.ok(atLeast(lock.packages["node_modules/image-size"].version, "2.0.3"), "image-size >= 2.0.3 (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr)");
    assert.equal(pkg.overrides["image-size"], lock.packages["node_modules/image-size"].version);
  });

  it("the lockfiles pin exact versions", () => {
    const pkg = JSON.parse(readFileSync(join(libRoot, "office-runtime-lock", "package.json"), "utf8"));
    for (const [name, version] of Object.entries(pkg.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/u, name);
    const lock = JSON.parse(readFileSync(join(libRoot, "office-runtime-lock", "package-lock.json"), "utf8"));
    for (const name of Object.keys(pkg.dependencies)) assert.equal(lock.packages[`node_modules/${name}`].version, pkg.dependencies[name]);
    const requirements = readFileSync(join(libRoot, "office-runtime-lock", "requirements.lock"), "utf8")
      .split("\n").filter((line) => line.trim() && !line.startsWith("#"));
    assert.ok(requirements.length >= 7);
    for (const line of requirements) assert.match(line, /^[A-Za-z0-9_.-]+==[\w.]+$/u, line);
    for (const needed of ["python-pptx", "python-docx", "Markdown", "beautifulsoup4", "pymupdf", "PyYAML", "defusedxml"]) {
      assert.ok(requirements.some((line) => line.startsWith(`${needed}==`)), needed);
    }
  });

  it("bundled fonts are the unmodified OFL releases within the 6 MB budget", () => {
    const provenance = JSON.parse(readFileSync(join(pptxRoot, "fonts", "provenance.json"), "utf8"));
    const files = [...provenance.pretendard.files, ...provenance.a2z.files];
    let total = 0;
    for (const { file, bytes, sha256: expected } of files) {
      const path = join(pptxRoot, "fonts", file);
      assert.equal(statSync(path).size, bytes, file);
      assert.equal(sha256(path), expected, file);
      total += bytes;
    }
    assert.ok(total <= 6 * 1024 * 1024, `fonts total ${total} bytes`);
    const onDisk = walk(join(pptxRoot, "fonts")).map((file) => relative(join(pptxRoot, "fonts"), file)).filter((f) => f !== "provenance.json").sort();
    assert.deepEqual(onDisk, files.map(({ file }) => file).sort());
    assert.match(readFileSync(join(pptxRoot, "fonts", "pretendard", "OFL.txt"), "utf8"), /SIL Open Font License/u);
  });

  it("the installed doctor and the repo doctor report office runtime readiness without installing", () => {
    const status = spawnSync(process.execPath, [join(libRoot, "office-runtime.mjs"), "status", "--json"], {
      encoding: "utf8",
      env: { ...process.env, LITCLAUDE_OFFICE_RUNTIME: mkdtempSync(join(tmpdir(), "lit-office-status-")) },
    });
    assert.equal(status.status, 0, status.stderr);
    const report = JSON.parse(status.stdout);
    assert.equal(report.node.ready, false);
    assert.deepEqual(readdirSync(report.root), [], "status must not install anything");
    assert.deepEqual(report.hostTools.map((tool) => tool.id), ["soffice", "pandoc", "xelatex"]);
    assert.match(readFileSync(join(root, "scripts", "doctor.mjs"), "utf8"), /office-runtime\.mjs", "status"/u);
    assert.match(readFileSync(join(root, "bin", "litclaude-ai.js"), "utf8"), /OFFICE_RUNTIME: /u);
  });
});

describe("office runtime first-use install", () => {
  it("drops npm's global-install settings from the npm ci child", { skip: process.platform === "win32" ? "POSIX fake npm" : false }, (t) => {
    const npm = fakeNpm();
    const cache = mkdtempSync(join(tmpdir(), "lit-office-npm-env-"));
    t.after(() => {
      rmSync(npm.dir, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    });
    const result = spawnSync(process.execPath, [join(libRoot, "office-runtime.mjs"), "ensure", "--node"], {
      encoding: "utf8",
      env: { ...process.env, ...npmGlobalInstallEnv, PATH: npm.path, LITCLAUDE_OFFICE_RUNTIME: cache },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /OFFICE_RUNTIME_NODE_INSTALL_FAILED: npm ci exited 1/u);
    const [call] = npm.calls();
    assert.equal(call.args, "ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error");
    assert.deepEqual(npmGlobalModeKeys(call.env), [], "no global mode reaches npm ci");
    assert.ok(call.env.includes("npm_config_registry=http://127.0.0.1:9/"), "registry settings pass through");
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

  it("names the installed entrypoints, uses the lit defaults and keeps the style gate for an explicit token", () => {
    const bare = hookContext("분기 계획 보고서 써줘 lit");
    assert.match(bare, /LIT IGNITED · lit-docx|lit-docx/u);
    assert.ok(bare.includes(join(docxRoot, "SKILL.md")), "installed SKILL.md path");
    assert.match(bare, /ask no style questions/u);
    assert.match(bare, /AZURE-PRO with Pretendard/u);
    assert.doesNotMatch(bare, /Soft-confirm/u);
    assert.match(bare, /never become \[blanks\]/u);
    assert.match(bare, /label it as an example or assumption/u);
    const explicit = hookContext("lit-pptx 신규 입사자 온보딩 덱");
    assert.ok(explicit.includes(join(pptxRoot, "SKILL.md")));
    assert.match(explicit, /Style gate:/u);
  });
});

describe("lit-pptx engine without the runtime", () => {
  const compile = (args, cwd) => spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, LITCLAUDE_OFFICE_RUNTIME: join(tmpdir(), "lit-office-must-not-install") },
  });

  it("lists the four bundled templates and compiles an AST without installing anything", () => {
    const listed = compile(["--list-templates"], root);
    assert.equal(listed.status, 0, listed.stderr);
    for (const name of ["AZURE-PRO", "AZURE-A2Z", "BOILERPLATE-PRETENDARD", "BOILERPLATE-A2Z"]) {
      assert.match(listed.stdout, new RegExp(`^${name} `, "mu"));
    }
    assert.doesNotMatch(listed.stdout, /TEMPLATE-EXAMPLE/u);
    const dir = mkdtempSync(join(tmpdir(), "lit-office-ast-"));
    try {
      const ast = compile([join(fixtures, "deck-azure.md"), "--ast", join(dir, "ast.json")], dir);
      assert.equal(ast.status, 0, ast.stderr);
      const parsed = JSON.parse(readFileSync(join(dir, "ast.json"), "utf8"));
      assert.equal(parsed.slides.length, 6);
      assert.equal(existsSync(join(tmpdir(), "lit-office-must-not-install")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses YAML inline comments so no template writes a NaN character spacing", () => {
    const probe = spawnSync(process.execPath, ["-e", `
      const r = require(${JSON.stringify(join(pptxRoot, "scripts", "lib", "template-registry.js"))});
      const out = {};
      for (const name of r.listTemplates()) {
        const t = r.loadTemplate(name);
        out[name] = { spacing: t.template.global_typography && t.template.global_typography.char_spacing,
          leaked: (JSON.stringify(t).match(/"[^"]*\\s#[^"]*"/g) || []).length };
      }
      console.log(JSON.stringify(out));`], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    for (const [name, { spacing, leaked }] of Object.entries(JSON.parse(probe.stdout))) {
      assert.equal(leaked, 0, `${name} kept an inline comment in a value`);
      if (spacing !== undefined) assert.equal(typeof spacing, "number", `${name} char_spacing`);
    }
  });

  it("compiles ::: chart into a table block that carries the chart, and rejects an unknown type", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-chart-ast-"));
    try {
      const built = compile([join(fixtures, "deck-chart.md"), "--ast", join(dir, "ast.json")], dir);
      assert.equal(built.status, 0, built.stderr);
      const blocks = JSON.parse(readFileSync(join(dir, "ast.json"), "utf8")).slides.flatMap((slide) => slide.blocks);
      const charts = blocks.filter((block) => block.chart);
      assert.deepEqual(charts.map((block) => block.chart.type), ["column", "doughnut"]);
      assert.equal(charts[0].headers.length, 3);
      assert.ok(blocks.some((block) => block.type === "table-caption" && block.figure === true));
      writeFileSync(join(dir, "bad.md"), "---\ntemplate: AZURE-PRO\ntitle: t\n---\n\n---\nlayout: content\n\n## t\n\n::: chart type=radar\n| a | b |\n|---|---|\n| x | 1 |\n:::\n---\n");
      const bad = compile([join(dir, "bad.md"), "--ast", join(dir, "bad.json")], dir);
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /type must be one of/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps every template decoration inside its canvas and offers no brand font system", () => {
    const probe = spawnSync(process.execPath, ["-e", `
      const r = require(${JSON.stringify(join(pptxRoot, "scripts", "lib", "template-registry.js"))});
      const out = [];
      for (const name of r.listTemplates()) {
        const t = r.loadTemplate(name);
        const W = t.template.dimensions.width, H = t.template.dimensions.height;
        for (const [set, value] of Object.entries(t.mapping.decorations || {})) {
          for (const d of (value.elements || value || [])) {
            if (!d || d.x == null) continue;
            if (d.x < 0 || d.y < 0 || d.x + (d.w || 0) > W + 0.01 || d.y + (d.h || 0) > H + 0.01) out.push(name + ":" + set + ":" + d.type);
          }
        }
      }
      console.log(JSON.stringify({ off: out, fonts: require(${JSON.stringify(join(pptxRoot, "scripts", "lib", "font-map.js"))}).KEYS }));`], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.deepEqual(result.off, []);
    assert.deepEqual(result.fonts, ["pretendard", "a2z"]);
  });

  it("finds a learned template in .lit-pptx/templates under the working directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-learned-"));
    try {
      const target = join(dir, ".lit-pptx", "templates", "MY-BRAND");
      const source = join(pptxRoot, "templates", "enrolled", "BOILERPLATE-PRETENDARD");
      spawnSync("mkdir", ["-p", target]);
      for (const name of readdirSync(source)) copyFileSync(join(source, name), join(target, name));
      const listed = compile(["--list-templates"], dir);
      assert.match(listed.stdout, /^MY-BRAND /mu);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const dataCli = (args, cwd) => spawnSync("python3", ["-B", join(libRoot, "office_data.py"), ...args], { cwd, encoding: "utf8" });

  it("resolves numbers from a data file: derived columns, a total row, formats and passing checks", () => {
    const check = dataCli(["check", join(fixtures, "deck-data.md")], fixtures);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    const report = JSON.parse(check.stdout);
    assert.equal(report.values.visits, 9500);
    assert.equal(report.values.loans, 5950);
    assert.equal(report.checks.length, 3);
    assert.ok(report.checks.every((c) => c.pass));
    const resolved = dataCli(["resolve", join(fixtures, "deck-data.md")], fixtures).stdout;
    assert.match(resolved, /방문 9,500명, 전년보다 \+13\.1%/u);
    assert.match(resolved, /\| 62\.6% \|/u);
    assert.match(resolved, /\| 서부 \| 1,900 \| 1,350 \| 71\.1 \|/u);
    assert.match(resolved, /\| \*\*합계\*\* \| \*\*9,500\*\* \| \*\*5,950\*\* \| \*\*62\.6\*\* \|/u);
    assert.doesNotMatch(resolved, /\{\{/u);
    const dir = mkdtempSync(join(tmpdir(), "lit-office-data-chart-"));
    try {
      writeFileSync(join(dir, "c.md"), `---\ntitle: t\ndata: ${join(fixtures, "data", "numbers.json")}\n---\n\n{{ table:branches | columns=방문 no-total }}\n`);
      const chart = dataCli(["resolve", join(dir, "c.md")], dir).stdout;
      assert.match(chart, /^\| 분관 \| 방문 \|$/mu);
      assert.doesNotMatch(chart, /합계|대출/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops on a failed check, an unknown name and an expression outside the allowed set", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-data-"));
    try {
      const write = (json, body) => {
        writeFileSync(join(dir, "n.json"), JSON.stringify(json));
        writeFileSync(join(dir, "d.md"), `---\ntitle: t\ndata: n.json\n---\n\n${body}\n`);
        return dataCli(["resolve", join(dir, "d.md")], dir);
      };
      const failed = write({ values: { a: 2, b: 3, total: 6 }, checks: ["a + b == total"] }, "{{ total }}");
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /data check failed: a \+ b == total \(left 5, right 6\)/u);
      const unknown = write({ values: { revenue: 1 } }, "{{ revnue }}");
      assert.equal(unknown.status, 1);
      assert.match(unknown.stderr, /unknown name 'revnue' \(defined: revenue\)/u);
      for (const unsafe of ['__import__("os")', "revenue.__class__", "open('x')"]) {
        const result = write({ values: { revenue: 1 } }, `{{ ${unsafe} }}`);
        assert.equal(result.status, 1, unsafe);
        assert.match(result.stderr, /not allowed|not a table column/u, unsafe);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compile-deck fills the numbers from the data file before parsing, and refuses a failed check", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-data-ast-"));
    try {
      const built = compile([join(fixtures, "deck-data.md"), "--ast", join(dir, "ast.json")], dir);
      assert.equal(built.status, 0, built.stderr);
      const text = readFileSync(join(dir, "ast.json"), "utf8");
      assert.match(text, /9,500/u);
      assert.doesNotMatch(text, /\{\{/u);
      writeFileSync(join(dir, "n.json"), JSON.stringify({ values: { a: 1 }, checks: ["a == 2"] }));
      writeFileSync(join(dir, "bad.md"), "---\ntemplate: AZURE-PRO\ntitle: t\ndata: n.json\n---\n\n---\nlayout: content\n\n## {{ a }}\n---\n");
      const bad = compile([join(dir, "bad.md"), "--ast", join(dir, "bad.json")], dir);
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /^Data error: data check failed: a == 2 \(left 1, right 2\)/mu);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every Python helper compiles", () => {
    const files = [...walk(pptxRoot), ...walk(docxRoot), ...walk(libRoot)].filter((file) => file.endsWith(".py"));
    const result = spawnSync("python3", ["-B", "-c", "import ast,sys\nfor f in sys.argv[1:]: ast.parse(open(f,encoding='utf-8').read(), f)", ...files], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
});

// The rest drives the real engine and converters. They need the pinned runtime; the suite
// never installs it (that needs the network). `node plugins/litclaude/lib/office-runtime.mjs
// ensure` prepares it once for the default cache or for $LITCLAUDE_OFFICE_RUNTIME.
const runtimeReady = nodeStatus().ready && pythonStatus().ready;
const runtimePython = pythonStatus().interpreter;
const soffice = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;

describe("lit-pptx and lit-docx with the pinned runtime", { skip: runtimeReady ? false : "office runtime not installed; run node plugins/litclaude/lib/office-runtime.mjs ensure" }, () => {
  const work = () => mkdtempSync(join(tmpdir(), "lit-office-run-"));
  const py = (script, args, cwd) => spawnSync("python3", [script, ...args], { cwd, encoding: "utf8" });
  const deck = (source, template, dir, extra = []) => spawnSync(process.execPath, [
    join(pptxRoot, "scripts", "compile-deck.js"), source, "--template", template, "--pptx", join(dir, "deck.pptx"), ...extra,
  ], { cwd: dir, encoding: "utf8" });

  it("compiles an AZURE-PRO Korean and English deck with embedded fonts and passes the QA gate", () => {
    const dir = work();
    try {
      const built = deck(join(fixtures, "deck-azure.md"), "AZURE-PRO", dir, ["--embed-fonts"]);
      assert.equal(built.status, 0, built.stderr + built.stdout);
      assert.match(built.stdout, /Pretendard \[regular\] <- Pretendard-Regular\.otf/u);
      assert.match(built.stdout, /integrity OK/u);
      const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
      const report = JSON.parse(gate.stdout);
      assert.equal(gate.status, 0, JSON.stringify(report.failure_reasons));
      assert.equal(report.integrity.pass, true);
      assert.equal(report.layout.overflow_shapes, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every bundled template compiles the fixture and passes the gate", () => {
    for (const [template, source] of [["AZURE-A2Z", "deck-azure.md"],
      ["BOILERPLATE-PRETENDARD", "deck-boilerplate.md"], ["BOILERPLATE-A2Z", "deck-boilerplate.md"]]) {
      const dir = work();
      try {
        const built = deck(join(fixtures, source), template, dir);
        assert.equal(built.status, 0, `${template}: ${built.stderr}`);
        const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
        assert.equal(gate.status, 0, `${template}: ${JSON.stringify(JSON.parse(gate.stdout).failure_reasons)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("the craft floor fails each planted office defect (OF-101 to OF-109) with a hint", () => {
    const dir = work();
    try {
      const built = spawnSync(runtimePython, ["-B", join(fixtures, "build_craft_sloppy.py"), join(dir, "deck.pptx")], { encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
      assert.equal(gate.status, 1);
      const report = JSON.parse(gate.stdout);
      const checks = new Set(report.craft_floor.findings.map((finding) => finding.check));
      for (const id of ["OF-101", "OF-102", "OF-103", "OF-104", "OF-106", "OF-107", "OF-108", "OF-109"]) {
        assert.ok(checks.has(id), `${id} in ${[...checks]}`);
        assert.ok(report.failure_reasons.some((reason) => reason.startsWith(`craft ${id} on slide(s)`) && reason.includes(" — ")), `${id} reason with a hint`);
      }
      const spacing = report.craft_floor.advisories.filter((finding) => finding.check === "OF-105");
      assert.ok(spacing.length > 0, "cards closer than twice the gap between their contents");
      assert.ok(spacing.every((finding) => finding.severity === "MEDIUM"), "OF-105 stays advisory until the calibration re-run promotes it");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the AZURE-PRO card rows pass the craft floor with no HIGH finding", () => {
    const dir = work();
    try {
      assert.equal(deck(join(fixtures, "deck-azure.md"), "AZURE-PRO", dir).status, 0);
      const report = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.deepEqual(report.craft_floor.findings, []);
      assert.equal("template" in report.craft_floor, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the DOCX gate fails a left-aligned numeric column (OF-302) and keeps the line-length check advisory (OF-301)", () => {
    const dir = work();
    try {
      const out = join(dir, "report.docx");
      const convert = py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-data.md"), out], dir);
      assert.equal(convert.status, 0, convert.stderr + convert.stdout);
      const clean = JSON.parse(py(join(docxRoot, "scripts", "qa_docx.py"), [out, "--source", join(fixtures, "report-data.md"), "--kind", "report"], dir).stdout);
      assert.equal(clean.lint.design.some((finding) => finding.rule === "rule-60-numeric-column-alignment"), false, "the converter right-aligns numbers");
      assert.ok(clean.lint.advisories.some((finding) => finding.rule === "rule-61-text-measure"), "Korean body lines over 38 characters are reported");
      assert.equal(clean.pass, true, JSON.stringify(clean.failure_reasons));

      const left = join(dir, "left.docx");
      const shifted = spawnSync(runtimePython, ["-B", "-c", `
import sys
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
d = Document(sys.argv[1])
for row in d.tables[0].rows[1:]:
    for cell in row.cells[1:]:
        for paragraph in cell.paragraphs:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
d.save(sys.argv[2])
`, out, left], { encoding: "utf8" });
      assert.equal(shifted.status, 0, shifted.stderr);
      const gate = py(join(docxRoot, "scripts", "qa_docx.py"), [left, "--source", join(fixtures, "report-data.md"), "--kind", "report"], dir);
      assert.equal(gate.status, 1);
      const report = JSON.parse(gate.stdout);
      assert.ok(report.lint.design.some((finding) => finding.rule === "rule-60-numeric-column-alignment" && /OF-302/u.test(finding.message)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the layout inventory and the gate catch text that spills out of its card and off the slide", () => {
    const dir = work();
    try {
      assert.equal(deck(join(fixtures, "deck-overflow.md"), "AZURE-PRO", dir).status, 0);
      const inventory = JSON.parse(py(join(pptxRoot, "scripts", "layout_inventory.py"), [join(dir, "deck.pptx"), "--issues-only"], dir).stdout);
      assert.ok(inventory.summary.frame_overflow >= 1, JSON.stringify(inventory.summary));
      assert.ok(inventory.summary.slide_overflow >= 1, JSON.stringify(inventory.summary));
      const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
      assert.equal(gate.status, 1);
      assert.match(JSON.parse(gate.stdout).failure_reasons.join(" "), /layout defects/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("draws native editable charts, fills the table slide and passes the gate", () => {
    const dir = work();
    try {
      const built = deck(join(fixtures, "deck-chart.md"), "AZURE-PRO", dir);
      assert.equal(built.status, 0, built.stderr);
      const parts = spawnSync(runtimePython, ["-B", "-c", "import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", join(dir, "deck.pptx")], { encoding: "utf8" }).stdout;
      assert.equal((parts.match(/^ppt\/charts\/chart\d+\.xml$/gmu) || []).length, 2, "two native charts");
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.equal(gate.pass, true, JSON.stringify(gate.failure_reasons));
      const fills = gate.craft.slides.filter((slide) => !slide.display).map((slide) => slide.fill);
      assert.ok(fills.every((fill) => fill >= 0.45), JSON.stringify(fills));
      const notices = spawnSync(runtimePython, ["-B", "-c", "from pptx import Presentation;import sys;p=Presentation(sys.argv[1]);print(sum(1 for s in p.slides for sh in s.shapes if sh.has_text_frame and '예시 데이터' in sh.text_frame.text))", join(dir, "deck.pptx")], { encoding: "utf8" }).stdout.trim();
      assert.equal(Number(notices) >= 4, true, "notice line on every slide");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the gate fails a thin slide, a table-only deck and each craft defect, with a fix hint", () => {
    const expectations = [
      ["deck-thin.md", ["sparse_slide"]],
      ["deck-sparse.md", ["table_only_deck"]],
      ["deck-craft-defects.md", ["long_foreign_note", "off_slide_shape", "placeholder_text", "stray_box"]],
    ];
    for (const [source, checks] of expectations) {
      const dir = work();
      try {
        assert.equal(deck(join(fixtures, source), "AZURE-PRO", dir).status, 0, source);
        const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
        assert.equal(gate.status, 1, source);
        const report = JSON.parse(gate.stdout);
        const found = new Set(report.craft.findings.map((finding) => finding.check));
        for (const check of checks) assert.ok(found.has(check), `${source}: ${check} in ${[...found]}`);
        assert.ok(report.failure_reasons.every((reason) => !reason.startsWith("craft") || reason.includes(" — ")), "every craft reason has a hint");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("a card is as tall as its text: a short row is drawn short, a long row taller, both inside the region", () => {
    const dir = work();
    try {
      assert.equal(deck(join(fixtures, "deck-cards.md"), "AZURE-PRO", dir).status, 0);
      const probe = spawnSync(runtimePython, ["-B", "-c", `
import sys, json
from pptx import Presentation
p = Presentation(sys.argv[1])
out = []
for slide in p.slides:
    cards = [s for s in slide.shapes if s.shape_type == 1 and s.width / 914400 > 2 and s.height / 914400 > 1
             and not s.text_frame.text.strip() and not s.name.startswith("lit-notice")]
    out.append([round(s.height / 914400, 2) for s in cards])
print(json.dumps(out))
`, join(dir, "deck.pptx")], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      const [short, long] = JSON.parse(probe.stdout);
      assert.equal(short.length, 2);
      assert.equal(new Set(short).size, 1, "a row shares one height");
      assert.ok(short[0] <= 2.2, `short cards ${short}`);
      assert.ok(long[0] > short[0] + 0.5, `long ${long} vs short ${short}`);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.equal(gate.layout.overflow_shapes, 0, "fitted cards never spill");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the example notice is a coloured tag on every slide, and the craft gate does not count it as content", () => {
    const dir = work();
    try {
      const built = deck(join(fixtures, "deck-data.md"), "AZURE-PRO", dir);
      assert.equal(built.status, 0, built.stderr);
      const probe = spawnSync(runtimePython, ["-B", "-c", `
import sys, json
from pptx import Presentation
p = Presentation(sys.argv[1])
out = []
for slide in p.slides:
    tag = [s for s in slide.shapes if s.name == "lit-notice tag"]
    text = [s for s in slide.shapes if s.name == "lit-notice text"]
    run = text[0].text_frame.paragraphs[0].runs[0] if text else None
    out.append({"fill": str(tag[0].fill.fore_color.rgb) if tag else None,
                "ink": str(run.font.color.rgb) if run else None, "bold": bool(run and run.font.bold),
                "pt": run.font.size.pt if run else 0, "text": text[0].text_frame.text if text else ""})
print(json.dumps(out, ensure_ascii=False))
`, join(dir, "deck.pptx")], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      const slides = JSON.parse(probe.stdout);
      assert.equal(slides.length, 3);
      for (const slide of slides) {
        assert.deepEqual([slide.fill, slide.ink, slide.bold], ["FDECEA", "A21B12", true]);
        assert.ok(slide.pt >= 10, "readable size");
        assert.match(slide.text, /예시 데이터/u);
      }
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.equal(gate.contrast.pass, true, JSON.stringify(gate.contrast.violations));
      assert.ok(gate.contrast.checked_runs > 0);
      const kpi = gate.craft.slides.find((slide) => slide.slide === 2);
      assert.ok(kpi.fill < 0.45, `a KPI row alone is still thin without the tag inflating it (${kpi.fill})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the DOCX notice is a tag in every page header (a band under the title when page 1 has no header), and data numbers are filled", () => {
    for (const profile of [[], ["--publisher", "korean-generic"]]) {
      const dir = work();
      try {
        const out = join(dir, "report.docx");
        const convert = py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-data.md"), out, ...profile], dir);
        assert.equal(convert.status, 0, convert.stderr + convert.stdout);
        const probe = spawnSync(runtimePython, ["-B", "-c", `
import sys, json
from docx import Document
d = Document(sys.argv[1])
band = [p for p in d.paragraphs if "예시 데이터" in p.text]
headers = []
for section in d.sections:
    for part in (section.header, section.first_page_header if section.different_first_page_header_footer else None):
        if part is not None and not part.is_linked_to_previous:
            headers.append(part._element.xml)
print(json.dumps({"band": band[0]._p.xml if band else "", "headers": headers,
                  "body": "\\n".join(p.text for p in d.paragraphs), "cells": [c.text for r in d.tables[0].rows for c in r.cells]}, ensure_ascii=False))
`, out], { encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        const info = JSON.parse(probe.stdout);
        if (profile.length) {
          // korean-generic's title page has its own empty header, so the tag sits under the title there.
          assert.match(info.band, /w:fill="FDECEA"/u, "band shading");
          assert.match(info.band, /w:color w:val="A21B12"/u);
        } else {
          assert.equal(info.band, "", "the plain profile's page-1 header already carries the tag");
        }
        assert.ok(info.headers.some((xml) => xml.includes("예시 데이터") && xml.includes('w:fill="FDECEA"')), `${profile}: header tag`);
        assert.match(info.body, /9,500명으로 전년보다 \+13\.1% 늘었고, 대출률은 62\.6%/u);
        assert.ok(info.cells.includes("5,950"));
        const gate = py(join(docxRoot, "scripts", "qa_docx.py"), [out, "--source", join(fixtures, "report-data.md"), "--kind", "report", ...profile], dir);
        assert.equal(gate.status, 0, gate.stdout);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("caption numbers follow the deck language: Figure/Table on an English deck, 도/표 on a Korean one", () => {
    for (const [source, expected] of [["deck-english.md", ["Figure 1.", "Table 1."]], ["deck-chart.md", ["도 1.", "표 1."]]]) {
      const dir = work();
      try {
        assert.equal(deck(join(fixtures, source), "AZURE-PRO", dir).status, 0, source);
        const probe = spawnSync(runtimePython, ["-B", "-c", "from pptx import Presentation;import sys,re,json;p=Presentation(sys.argv[1]);print(json.dumps(sorted({m for s in p.slides for sh in s.shapes if sh.has_text_frame for m in re.findall(r'^(?:도|표|Figure|Table) 1\\.', sh.text_frame.text)})))", join(dir, "deck.pptx")], { encoding: "utf8" });
        assert.deepEqual(JSON.parse(probe.stdout), expected.sort(), source);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("the integrity check rejects a NaN attribute and a dangling relationship", () => {
    const dir = work();
    try {
      assert.equal(deck(join(fixtures, "deck-azure.md"), "AZURE-PRO", dir).status, 0);
      const doctored = spawnSync("python3", ["-B", "-c", `
import zipfile, sys
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "ppt/slides/slide2.xml":
            data = data.replace(b'spc="-100"', b'spc="NaN"', 1)
        if item.filename == "ppt/slides/_rels/slide1.xml.rels":
            data = data.replace(b"</Relationships>", b'<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/missing.png"/></Relationships>')
        zout.writestr(item, data)
`, join(dir, "deck.pptx"), join(dir, "bad.pptx")], { encoding: "utf8" });
      assert.equal(doctored.status, 0, doctored.stderr);
      const check = spawnSync("python3", [join(libRoot, "ooxml_integrity.py"), join(dir, "bad.pptx"), "--json"], { encoding: "utf8" });
      assert.equal(check.status, 1);
      const report = JSON.parse(check.stdout);
      assert.equal(report.checks.values, false);
      assert.equal(report.checks.rels, false);
      assert.equal(spawnSync("python3", [join(libRoot, "ooxml_integrity.py"), join(dir, "deck.pptx")], { encoding: "utf8" }).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("converts a Korean report to korean-generic DOCX that passes the document gate", () => {
    const dir = work();
    try {
      const out = join(dir, "report.docx");
      const convert = py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-ko.md"), out, "--publisher", "korean-generic"], dir);
      assert.equal(convert.status, 0, convert.stderr + convert.stdout);
      const gate = py(join(docxRoot, "scripts", "qa_docx.py"), [out, "--source", join(fixtures, "report-ko.md"), "--publisher", "korean-generic", "--kind", "report"], dir);
      const report = JSON.parse(gate.stdout);
      assert.equal(gate.status, 0, JSON.stringify(report.failure_reasons));
      assert.equal(report.content.tables, 1);
      assert.deepEqual(report.content.missing_headings, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("plain-profile frontmatter becomes a title block and tables get content-sized, unsplittable rows", () => {
    const dir = work();
    try {
      const out = join(dir, "plan.docx");
      assert.equal(py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-plain-frontmatter.md"), out], dir).status, 0);
      const probe = spawnSync(runtimePython, ["-B", "-c", `
import sys, json
from docx import Document
d = Document(sys.argv[1])
paras = [p.text for p in d.paragraphs if p.text.strip()]
t = d.tables[0]
xml = t._tbl.xml
widths = [c.width for c in t.columns]
right = [p.alignment for p in t.rows[1].cells[1].paragraphs]
print(json.dumps({"first": paras[:4], "widths": widths, "cantSplit": xml.count("w:cantSplit"), "header": xml.count("w:tblHeader"), "rows": len(t.rows), "right": str(right[0])}))
`, out], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      const info = JSON.parse(probe.stdout);
      assert.equal(info.first[0], "사내 카풀 앱 도입 계획");
      assert.ok(!info.first.some((line) => /^(---|title:|author:)/u.test(line)), JSON.stringify(info.first));
      assert.equal(new Set(info.widths).size, info.widths.length, "columns are sized to content, not equal");
      assert.equal(info.cantSplit, info.rows);
      assert.equal(info.header, 1);
      assert.match(info.right, /RIGHT/u);
      const gate = py(join(docxRoot, "scripts", "qa_docx.py"), [out, "--source", join(fixtures, "report-plain-frontmatter.md")], dir);
      assert.equal(gate.status, 0, gate.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the document gate fails unfilled blanks", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "blank.md"), "# 신규 서비스 계획\n\n[제품명]은 [목표 고객]을 위한 서비스이며 예상 매출은 [금액]이다.\n");
      const out = join(dir, "blank.docx");
      assert.equal(py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(dir, "blank.md"), out], dir).status, 0);
      const gate = py(join(docxRoot, "scripts", "qa_docx.py"), [out, "--source", join(dir, "blank.md")], dir);
      assert.equal(gate.status, 1);
      assert.match(JSON.parse(gate.stdout).failure_reasons.join(" "), /unfilled blanks/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the document gate fails AI-tell prose in the plain profile", () => {
    const dir = work();
    try {
      const out = join(dir, "slop.docx");
      assert.equal(py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-slop.md"), out], dir).status, 0);
      const gate = py(join(docxRoot, "scripts", "qa_docx.py"), [out, "--source", join(fixtures, "report-slop.md")], dir);
      assert.equal(gate.status, 1);
      const rules = JSON.parse(gate.stdout).lint.prose.map((finding) => finding.rule);
      assert.ok(rules.includes("rule-01-ai-phrase"), rules.join(","));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("edits an existing DOCX into a new file and leaves the original untouched", () => {
    const dir = work();
    try {
      const out = join(dir, "report.docx");
      py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-ko.md"), out, "--publisher", "korean-generic"], dir);
      const before = sha256(out);
      const edited = py(join(docxRoot, "scripts", "edit_docx.py"), [out, "--replace", "스캐너", "판독기", "-o", join(dir, "edited.docx")], dir);
      assert.equal(edited.status, 0, edited.stderr);
      assert.equal(sha256(out), before);
      const text = py(join(docxRoot, "scripts", "edit_docx.py"), [join(dir, "edited.docx"), "--extract-text"], dir);
      assert.match(text.stdout, /판독기/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders deck and document pages to PNG when soffice exists", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const dir = work();
    try {
      assert.equal(deck(join(fixtures, "deck-azure.md"), "AZURE-PRO", dir).status, 0);
      const pages = spawnSync("python3", [join(libRoot, "render_pages.py"), join(dir, "deck.pptx"), "--out-dir", join(dir, "renders"), "--pages", "2", "--json"], { encoding: "utf8" });
      assert.equal(pages.status, 0, pages.stderr);
      const report = JSON.parse(pages.stdout);
      assert.equal(report.status, "rendered");
      assert.equal(report.pages.length, 2);
      for (const png of report.pages) assert.ok(statSync(png).size > 10_000, png);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the Python helpers leave no bytecode in the plugin", () => {
    const caches = [...walk(pptxRoot), ...walk(docxRoot), ...walk(libRoot)].filter((file) => file.includes("__pycache__"));
    assert.deepEqual(caches.map((file) => relative(root, file)), []);
  });
});
