import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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
    // lit-pptx is a same-name stub now (test/lit-pptx-stub.test.mjs); its helpers moved to the decks extras plugin.
    for (const [id, dir] of [["lit-docx", docxRoot]]) {
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

  it("lit-docx teaches the data file and the visible example notice, without the A/B task wording", () => {
    const docx = readFileSync(join(docxRoot, "SKILL.md"), "utf8");
    for (const [id, body] of [["lit-docx", docx]]) {
      assert.match(body, /^\s*data: [\w.-]+\.json/mu, `${id} shows the data: key`);
      assert.match(body, /office_data\.py" check/u, `${id} runs the data check`);
      assert.match(body, /\{\{ table:[\w-]+ \}\}/u, `${id} shows a data table placeholder`);
      // A deck shows the notice as a tag on every slide; a document prints it once (docx-spec Amendments 4, A4.7).
      assert.match(body, id === "lit-docx" ? /printed once/u : /coloured tag/u, `${id} explains the visible notice`);
      // The A/B tasks are one-line requests; their wording must not be taught to the skill.
      for (const phrase of ["분기 실적 발표자료", "신제품 기획서", "sources 폴더", "보고서랑 발표자료"]) {
        assert.equal(body.includes(phrase), false, `${id} contains A/B task wording: ${phrase}`);
      }
    }
  });

  it("lit-docx chooses a direction before writing, binds the four page rules, and its reference library covers every tonality and component", () => {
    const body = readFileSync(join(docxRoot, "SKILL.md"), "utf8");
    const procedure = body.slice(body.indexOf("## #contract.procedure"), body.indexOf("### Other workflows"));
    assert.ok(procedure.indexOf("**Choose the direction first: the direction card.**") < procedure.indexOf("**Outline, then write the Markdown source**"));
    for (const field of ["document type, reader, tonality and the two alternatives", "a reason tied to the reader and the signals that fired", "the dials",
      "the cover variant and the heading treatment", "the components planned", "what would make this direction wrong"]) {
      assert.ok(procedure.includes(field), `direction card field: ${field}`);
    }
    for (const [type, first] of [["Report, results", "Report"], ["Korean itemised briefing", "Brief"], ["Guide, procedure", "Manual"], ["Proposal, plan", "Proposal"], ["Memo, notice", "Memo"], ["Essay, newsletter", "Journal"]]) {
      assert.match(procedure, new RegExp(`^   \\| ${type}[^|]*\\| ${first} \\(\\d+, \\d+\\)`, "mu"), `selection row for ${type}`);
    }
    assert.match(procedure, /there is no silent default look, and under a bare `lit` it decides without asking/u);
    for (const rule of ["Headings, the title and the subtitle are noun-phrase labels", "Numbers at their true weight", "Dense by default", "Pretendard everywhere"]) assert.ok(procedure.includes(rule), rule);
    for (const check of ["heading.declarative", "heading.order", "fill.page", "heading.stranded", "table.split", "figure.split", "component.variety"]) assert.ok(procedure.includes(check), `gate check ${check}`);
    assert.match(procedure, /qa_docx\.py" report\.docx --source report\.md --layout/u);
    assert.doesNotMatch(body, /Headings say what the section concludes|headings that only name topics/u);
    const refs = join(docxRoot, "references");
    const direction = readFileSync(join(refs, "direction-step.md"), "utf8");
    for (const part of ["Direction card", "Wrong if", "direction strip", "examples/"]) assert.ok(direction.includes(part), `direction-step.md: ${part}`);
    for (const id of ["report", "brief", "manual", "proposal", "memo", "journal"]) {
      const sheet = readFileSync(join(refs, "tonalities", `${id}.md`), "utf8");
      for (const section of ["## When to use it", "## When it is the wrong choice", "## Tokens"]) assert.ok(sheet.includes(`\n${section}\n`), `${id}.md: ${section}`);
      // The token table is read from the pack, so the pack's accent appears in it.
      // A pack without an accent (Memo, Journal) says so.
      const accent = (readFileSync(join(docxRoot, "templates", "tonalities", `${id}.yaml`), "utf8").match(/[\s{,]accent: "?#?([0-9A-Fa-f]{6})"?/u) || [])[1];
      assert.ok(accent ? sheet.toUpperCase().includes(accent.toUpperCase()) : /no accent/iu.test(sheet), `${id}.md names its accent ${accent || "(none)"}`);
      assert.ok(sheet.split(/\s+/u).length >= 550, `${id}.md is a full sheet`);
    }
    const components = readFileSync(join(refs, "components.md"), "utf8");
    for (const d of ["::: cover", "::: callout", "::: sidebar", "::: pullquote", "::: keyfigures", "::: columns"]) assert.ok(components.includes(d), `components.md: ${d}`);
    const pages = readFileSync(join(refs, "page-composition.md"), "utf8");
    for (const check of ["fill.page", "heading.stranded", "table.split", "figure.split", "component.variety", "heading.declarative"]) assert.ok(pages.includes(check), `page-composition.md: ${check}`);
    // Spec Amendments 4 (restraint) reaches the model: the card names each component's purpose, the budget and the
    // structure per tonality; the notice prints once; pull quotes are off; no example teaches a component its pack drops.
    for (const rule of ["a one-line purpose for each", "at most three component kinds", "printed once", "differ in structure, not colour"]) assert.ok(procedure.includes(rule), `procedure: ${rule}`);
    assert.doesNotMatch(body, /coloured tag|tinted band|::: cover variant=band/u);
    assert.ok(direction.includes("purpose") && direction.includes("A4.6"), "direction-step.md carries the purpose line and the structure table");
    for (const id of ["report", "brief", "manual", "proposal", "memo", "journal"]) {
      const sheet = readFileSync(join(refs, "tonalities", `${id}.md`), "utf8");
      assert.ok(sheet.includes("\n## Structure\n"), `${id}.md: ## Structure`);
      assert.doesNotMatch(sheet, /pull ?quote is allowed|tinted|colour band|zero-padded numerals in the accent/iu, `${id}.md teaches no colour device`);
    }
    assert.match(components, /Pull quotes are off/u);
    assert.match(pages, /1\.53/u, "page-composition.md gives the calibrated leading");
    for (const name of readdirSync(join(refs, "examples")).filter((f) => f.endsWith(".md"))) {
      const src = readFileSync(join(refs, "examples", name), "utf8");
      const tonality = /^tonality:\s*(\S+)/mu.exec(src)[1].toLowerCase();
      assert.doesNotMatch(src, /^:{3,} pullquote/mu, `${name}: no pull quote`);
      if (tonality !== "manual") assert.doesNotMatch(src, /^:{3,} sidebar/mu, `${name}: a sidebar only in a manual`);
      assert.doesNotMatch(src, /variant=(band|split)/u, `${name}: typographic covers only`);
      assert.ok((src.match(/^:{3,} keyfigures/gmu) || []).length <= 1, `${name}: one key-figure strip at most`);
    }
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
  it("refuses an unknown ensure flag before installing anything", () => {
    const cache = mkdtempSync(join(tmpdir(), "lit-office-flag-"));
    try {
      const result = spawnSync(process.execPath, [join(libRoot, "office-runtime.mjs"), "ensure", "--node", "--dry-run"], {
        encoding: "utf8",
        env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/", LITCLAUDE_OFFICE_RUNTIME: cache },
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /unknown ensure option: --dry-run/u);
      assert.deepEqual(readdirSync(cache), [], "a refused flag must not start an install");
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

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

  it("names the installed entrypoints, uses the lit defaults and keeps the style gate for an explicit token", () => {
    const bare = hookContext("분기 계획 보고서 써줘 lit");
    assert.match(bare, /LIT IGNITED · lit-docx|lit-docx/u);
    assert.ok(bare.includes(join(docxRoot, "SKILL.md")), "installed SKILL.md path");
    assert.match(bare, /ask no style questions/u);
    assert.match(bare, /tonality its direction step picks/u);
    assert.match(bare, /two alternatives \(there is no silent default look\)/u);
    assert.doesNotMatch(bare, /AZURE-PRO/u);
    assert.doesNotMatch(bare, /Soft-confirm/u);
    assert.match(bare, /never become \[blanks\]/u);
    assert.match(bare, /label it as an example or assumption/u);
    // lit-pptx is now a same-name stub: its context names the stub and carries no deck style gate.
    const explicit = hookContext("lit-pptx 신규 입사자 온보딩 덱");
    assert.ok(explicit.includes(join(pptxRoot, "SKILL.md")));
    assert.doesNotMatch(explicit, /Style gate:/u);
    // A document takes a direction: no default profile under bare lit, a style gate for a token.
    assert.match(bare, /a document takes the tonality its direction step picks/u);
    assert.doesNotMatch(bare, /korean-generic when the text is Korean/u);
    const docxToken = hookContext("lit-docx 신규 입사자 안내 문서");
    assert.match(docxToken, /Style gate:/u);
    assert.match(docxToken, /for a document, the tonality its direction step chose \(with its reason\) first, two alternatives and a compare option/u);
  });
});

describe("office runtime status after lit-pptx moved out", () => {
  // lit-docx needs only the Python half; the Node half served the deck engine, which left with lit-pptx.
  const status = (dir) => {
    const result = spawnSync(process.execPath, [join(libRoot, "office-runtime.mjs"), "status", "--json"], {
      encoding: "utf8",
      env: { ...process.env, LITCLAUDE_OFFICE_RUNTIME: dir },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  it("names only lit-docx as the first-use trigger and reports ready once the Python half is", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-status-"));
    try {
      const empty = status(dir);
      assert.equal(empty.firstUse, "installs on first lit-docx run");
      if (!empty.python.host.ok) return t.skip("no supported host Python for the readiness half");
      const venvBin = join(empty.python.dir, process.platform === "win32" ? "Scripts" : "bin");
      mkdirSync(venvBin, { recursive: true });
      writeFileSync(join(venvBin, process.platform === "win32" ? "python.exe" : "python"), "");
      writeFileSync(join(empty.python.dir, ".litclaude-ready"), "{}\n");
      const pythonOnly = status(dir);
      assert.equal(pythonOnly.python.ready, true);
      assert.equal(pythonOnly.node.ready, false);
      assert.equal(pythonOnly.firstUse, "ready");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The rest drives the real engine and converters. They need the pinned runtime; the suite
// never installs it (that needs the network). `node plugins/litclaude/lib/office-runtime.mjs
// ensure` prepares it once for the default cache or for $LITCLAUDE_OFFICE_RUNTIME.
const runtimeReady = nodeStatus().ready && pythonStatus().ready;
const runtimePython = pythonStatus().interpreter;
const soffice = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;

describe("lit-docx with the pinned runtime", { skip: runtimeReady ? false : "office runtime not installed; run node plugins/litclaude/lib/office-runtime.mjs ensure" }, () => {
  const work = () => mkdtempSync(join(tmpdir(), "lit-office-run-"));
  const py = (script, args, cwd) => spawnSync("python3", [script, ...args], { cwd, encoding: "utf8" });

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

  it("the integrity check rejects a NaN attribute and a dangling relationship", () => {
    const dir = work();
    try {
      const good = join(dir, "report.docx");
      assert.equal(py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-ko.md"), good, "--publisher", "korean-generic"], dir).status, 0);
      const doctored = spawnSync("python3", ["-B", "-c", `
import re, zipfile, sys
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            data = re.sub(rb'(<w:sz w:val=")\\d+(")', rb'\\1NaN\\2', data, count=1)
        if item.filename == "word/_rels/document.xml.rels":
            data = data.replace(b"</Relationships>", b'<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/></Relationships>')
        zout.writestr(item, data)
`, good, join(dir, "bad.docx")], { encoding: "utf8" });
      assert.equal(doctored.status, 0, doctored.stderr);
      const check = spawnSync("python3", [join(libRoot, "ooxml_integrity.py"), join(dir, "bad.docx"), "--json"], { encoding: "utf8" });
      assert.equal(check.status, 1, check.stdout);
      const report = JSON.parse(check.stdout);
      assert.equal(report.checks.values, false);
      assert.equal(report.checks.rels, false);
      assert.equal(spawnSync("python3", [join(libRoot, "ooxml_integrity.py"), good], { encoding: "utf8" }).status, 0);
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

  it("renders document pages to PNG when soffice exists", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const dir = work();
    try {
      const out = join(dir, "report.docx");
      assert.equal(py(join(docxRoot, "scripts", "convert_md_to_docx.py"), [join(fixtures, "report-ko.md"), out, "--publisher", "korean-generic"], dir).status, 0);
      const pages = spawnSync("python3", [join(libRoot, "render_pages.py"), out, "--out-dir", join(dir, "renders"), "--pages", "1", "--json"], { encoding: "utf8" });
      assert.equal(pages.status, 0, pages.stderr);
      const report = JSON.parse(pages.stdout);
      assert.equal(report.status, "rendered");
      assert.equal(report.pages.length, 1);
      for (const png of report.pages) assert.ok(statSync(png).size > 10_000, png);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });


  it("the Python helpers leave no bytecode in the plugin", () => {
    const caches = [...walk(docxRoot), ...walk(libRoot)].filter((file) => file.includes("__pycache__"));
    assert.deepEqual(caches.map((file) => relative(root, file)), []);
  });
});

// ── lit-docx tonalities and components (plan todo 10; umbrella docx-spec with its Amendments 1) ──
describe("lit-docx tonality packs and page components", { skip: runtimeReady ? false : "office runtime not installed; run node plugins/litclaude/lib/office-runtime.mjs ensure" }, () => {
  const work = () => mkdtempSync(join(tmpdir(), "lit-docx-run-"));
  const convert = (dir, source, args = []) => {
    const out = join(dir, `${args.join("-").replace(/[^A-Za-z0-9-]/gu, "") || "plain"}.docx`);
    const run = spawnSync("python3", [join(docxRoot, "scripts", "convert_md_to_docx.py"), source, out, ...args], { cwd: dir, encoding: "utf8" });
    return { ...run, out };
  };
  const probe = (docx) => {
    const run = spawnSync(runtimePython, ["-B", join(fixtures, "docx_probe.py"), docx], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const built = (dir, source, args) => {
    const c = convert(dir, source, args);
    assert.equal(c.status, 0, c.stderr + c.stdout);
    return { ...probe(c.out), out: c.out, stdout: c.stdout };
  };
  const components = join(fixtures, "doc-components.md");
  const tables = (d) => d.blocks.filter((b) => b.t === "tbl");
  const heads = (d, level) => d.blocks.filter((b) => b.t === "p" && b.style === `Heading ${level}`);
  const tinyPng = (w, h) => {
    const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 150)])));
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };

  it("loads the six packs over the korean-generic base, applies the dials, and refuses unknown names, values and a publisher with a tonality", () => {
    const loader = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_design as d
out = {}
for name in d.TONALITIES:
    t = d.load_tonality(name)
    out[name] = {"density": t.dials["density"], "body": t.body_pt, "table_pt": t.table_pt, "fig": t.keyfigure_pt, "sizes": t.sizes,
                 "margins": t.margins_mm, "title_block": t.title_block, "numbering": t.numbering, "running": t.running_head,
                 "summary": t.design.get("summary_form"), "accent_on": t.design.get("accent_on") or [], "kinds": t.allowed_kinds,
                 "palette": t.palette, "micro": "quote_style" in t.design.get("micro_typography", {}), "leading": t.leading, "pitch": t.pitch}
    out[name + "-en"] = {"pitch": d.load_tonality(name, locale="en").pitch, "numbering": d.load_tonality(name, locale="en").numbering}
dense = d.load_tonality("report", density=3)
out["dense"] = [dense.margins_mm, d.load_tonality("report").margins_mm]
errs = []
for bad in [("Glossy", {}), ("report", {"density": 11})]:
    try:
        d.load_tonality(bad[0], **bad[1])
    except d.DesignError as e:
        errs.append(str(e))
print(json.dumps({"packs": out, "errs": errs}))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(loader.status, 0, loader.stderr);
    const { packs, errs } = JSON.parse(loader.stdout);
    const names = ["Brief", "Journal", "Manual", "Memo", "Proposal", "Report"];
    assert.deepEqual(Object.keys(packs).filter((k) => names.includes(k)).sort(), names);
    for (const name of names) {
      const p = packs[name];
      // Amendments 4: body 10.5-11 pt, a quiet scale (h1 at most 1.5x, h2 about 1.2x, h3 the body size), a title
      // of 2.5-3x the body (a memo's subject line excepted), table text 90-95 % of the body, figures no larger than h2.
      assert.ok(p.density >= 8, `${name} density ${p.density}`);
      assert.ok(p.body >= 10.5 && p.body <= 11, `${name} body ${p.body}`);
      assert.ok(p.sizes.h1 / p.body <= 1.5 && p.sizes.h2 / p.body <= 1.25 && p.sizes.h3 === p.body, `${name} scale ${JSON.stringify(p.sizes)}`);
      if (name !== "Memo") assert.ok(p.sizes.title / p.body >= 2.45 && p.sizes.title / p.body <= 3, `${name} title ${p.sizes.title}`);
      assert.ok(p.table_pt / p.body >= 0.88 && p.table_pt / p.body <= 0.95 && p.table_pt >= 9, `${name} table ${p.table_pt}`);
      assert.ok(p.fig <= p.sizes.h2, `${name} key figure ${p.fig} > h2`);
      // A4, sides of 25 mm or more, the bottom never under the top.
      const [top, bottom, left, right] = p.margins;
      assert.ok(left >= 25 && right >= 25 && bottom >= top, `${name} margins ${p.margins}`);
      // Hangul pitch 165-185 % of the size, Latin 120-145 %. Pretendard's single line measured 1.55 em in Word and
      // 1.51 em in LibreOffice (task-12b/leading-calibration.txt), so the Word multiple is the pitch over 1.53.
      assert.ok(p.pitch >= 1.65 && p.pitch <= 1.85, `${name} Hangul pitch ${p.pitch}`);
      assert.ok(Math.abs(p.leading - p.pitch / 1.53) < 0.01, `${name} multiple ${p.leading} for pitch ${p.pitch}`);
      assert.ok(packs[`${name}-en`].pitch >= 1.2 && packs[`${name}-en`].pitch <= 1.45, `${name} Latin pitch`);
      // Ink: one near-black ink, greys no lighter than #555, one accent at most on two element kinds at most.
      assert.ok(/^(1[0-9A-E]){3}$/u.test(p.palette.ink) || /^1[0-9A-F]1[0-9A-F]1[0-9A-F]$/u.test(p.palette.ink), `${name} ink ${p.palette.ink}`);
      assert.ok(parseInt(p.palette.ink_muted.slice(0, 2), 16) <= 0x55, `${name} muted ink ${p.palette.ink_muted}`);
      assert.ok(p.accent_on.length <= 2, `${name} accent on ${p.accent_on}`);
      assert.ok(!p.kinds.includes("pullquote") && p.kinds.length <= 3, `${name} components ${p.kinds}`);
      assert.ok(p.micro, `${name} inherits the base micro-typography`);
    }
    // A4.6: tonalities differ in structure: no two packs share title block, numbering, running head and summary form.
    assert.equal(new Set(names.map((n) => `${packs[n].title_block}|${packs[n].numbering}|${JSON.stringify(packs[n].running)}|${packs[n].summary}`)).size, 6);
    assert.equal(packs.Report.numbering, "roman-ko", "a Korean report numbers its sections in the institute order");
    assert.equal(packs["Report-en"].numbering, "decimal");
    assert.deepEqual(packs.Memo.kinds, [], "a memo uses no components");
    assert.equal(packs.Proposal.title_block, "cover");
    assert.equal(packs.Brief.summary, "points");
    assert.ok(packs.dense[0][2] > packs.dense[1][2], `density moves the margins: ${JSON.stringify(packs.dense)}`);
    assert.match(errs[0], /Brief.*Journal.*Manual.*Memo.*Proposal.*Report/u);
    assert.match(errs[1], /density/u);
    const dir = work();
    try {
      const both = convert(dir, components, ["--tonality", "Report", "--publisher", "elsevier"]);
      assert.notEqual(both.status, 0);
      assert.match(both.stderr + both.stdout, /tonality.*publisher|publisher.*tonality/iu);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("each directive becomes its Word structure within the component budget, and no fence or marker reaches the page", () => {
    const dir = work();
    try {
      const d = built(dir, components, ["--tonality", "Report"]);
      const text = d.blocks.map((b) => (b.t === "p" ? b.text : b.rows.flat().join(" "))).join("\n");
      assert.doesNotMatch(text, /:::|\{style=|column-break/u, "directive text leaked");
      // Report: the title block opens page 1 above the body; no cover page, one section.
      assert.equal(d.sections.length, 1, JSON.stringify(d.sections));
      const first = d.blocks.findIndex((b) => b.t === "p" && /^Heading/u.test(b.style || ""));
      const head = d.blocks.slice(0, first);
      assert.ok(head.some((b) => b.t === "p" && b.text === "반품 처리 자동화 1분기 운영 결과"), "title from frontmatter");
      assert.ok(head.some((b) => b.t === "p" && b.text.startsWith("운영 결과 보고") && b.text.includes("2026. 10. 1.")), "series line: kind and Korean date");
      assert.ok(head.some((b) => b.t === "p" && b.text === "예시 데이터 — 회사·수치는 모두 가정입니다"), "the notice, once, under the title block");
      assert.ok(!head.some((b) => b.t === "tbl" && b.caption === "keyfigures"), "no key figures before the first section");
      // Key figures move from the cover into the summary: right after the first paragraph under the first heading.
      const kfAt = d.blocks.findIndex((b) => b.t === "tbl" && b.caption === "keyfigures");
      assert.ok(kfAt === first + 2, `key figures under the summary's first paragraph: ${kfAt} vs heading ${first}`);
      const kf = d.blocks[kfAt];
      assert.ok(kf.rows[0].length === 3 && kf.rows[0][0].includes("−42%") && kf.rows[0][0].includes("도입 전 6.2분 대비"), JSON.stringify(kf.rows));
      assert.ok(!kf.fills.flat().some(Boolean), "no fills in the key-figure row");
      // One callout box for a short report, the decision request; the warning keeps its text as a bold lead line.
      const callouts = d.blocks.filter((b) => b.t === "tbl" && /^callout /u.test(b.caption || ""));
      assert.deepEqual(callouts.map((c) => c.caption), ["callout key"]);
      const b = callouts[0].firstCellBorders;
      // A ruled box in the table vocabulary: a 0.75 pt rule above and 0.5 pt below in the accent, no side stripe, no fill.
      assert.ok(b.top && b.top.sz === 6 && b.bottom && b.bottom.sz === 4 && !b.left && !b.right && !callouts[0].fills.flat().some(Boolean), `ruled above and below, no fill: ${JSON.stringify(callouts[0])}`);
      assert.ok(callouts[0].rows[0][0].startsWith("결론과 요청"), "the title leads the callout");
      const warn = d.blocks.findIndex((x) => x.t === "p" && x.text === "공사 시 주의");
      assert.ok(warn >= 0 && d.blocks[warn].runs[0].bold && d.blocks[warn + 1].text === "설치 공사는 성수기를 피해야 한다.", "the warning as text");
      // A Report sets no sidebar and no pull quote: the sidebar's list stays as text, the pull quote repeats the body and is left out.
      assert.ok(!d.blocks.some((x) => x.t === "tbl" && x.caption === "sidebar"));
      assert.ok(d.blocks.some((x) => x.t === "p" && x.text === "오류 유형 (예시)"));
      assert.equal(d.blocks.filter((x) => x.t === "p" && x.text.includes("1.1%에서 0.3%로 낮아졌다")).length, 1, "the repeated sentence stands once");
      assert.ok(!d.blocks.some((x) => x.t === "p" && x.style === "Pullquote"));
      assert.match(d.stdout, /pull quote repeats the body/u);
      // Balanced columns with a column break: one borderless row, each part in its own cell.
      const cols = d.blocks.find((x) => x.t === "tbl" && x.caption === "columns");
      assert.ok(cols && cols.n === 1 && cols.rows[0].length === 2 && cols.rows[0][0].includes("현장 의견"), JSON.stringify(cols));
      // Without a column break the text flows through a balanced two-column section.
      const flow = join(dir, "flow.md");
      writeFileSync(flow, "---\ntitle: 흐름 단\nnotice: 예시\n---\n\n# 의견\n\n::: columns 2\n현장 근무자는 성수기 정체가 반복된다고 말했다. 관리자는 야간 인력 추가를 검토한다.\n:::\n\n끝.\n");
      const f = built(dir, flow, ["--tonality", "Report"]);
      assert.equal(f.sections.filter((s) => s.cols === 2 && s.type === "continuous").length, 1, JSON.stringify(f.sections));
      // Unbalanced parts (one twice the other) do not stand side by side.
      const lop = join(dir, "lop.md");
      writeFileSync(lop, "---\ntitle: 한쪽 단\nnotice: 예시\n---\n\n# 의견\n\n::: columns 2\n## 현장\n\n- 짧다.\n\n<!-- column-break -->\n\n## 관리자\n\n- 야간 정비 인력 1명 추가 배치를 검토하고, 점검표와 설비 화면 안내의 순서를 맞추며, 포장 단계의 바코드 부착 기준을 다시 정한다.\n:::\n");
      assert.ok(!tables(built(dir, lop, ["--tonality", "Report"])).some((t) => t.caption === "columns"), "unbalanced columns read in sequence");
      // A Korean source line names its source as 자료: in the note style.
      const src = d.blocks.find((x) => x.t === "p" && x.text.startsWith("자료:"));
      assert.equal(src.style, "Source Note");
      // Manual draws the sidebar: beside the text, a hairline down its left side, no fill.
      const manual = built(dir, components, ["--tonality", "Manual"]);
      const side = tables(manual).find((t) => t.caption === "sidebar");
      assert.ok(side && side.float === "right" && side.firstCellBorders.left && !side.fills.flat().some(Boolean), JSON.stringify(side));
      // Memo draws no component at all.
      const memo = built(dir, components, ["--tonality", "Memo"]);
      assert.deepEqual(tables(memo).map((t) => t.caption).filter((c) => c && !c.startsWith("cover")), [], "no components in a memo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every pair of tonalities sets the same source with at least three different structural features", () => {
    const dir = work();
    try {
      const names = ["Report", "Brief", "Proposal", "Manual", "Memo", "Journal"];
      const outs = Object.fromEntries(names.map((n) => [n, built(dir, components, ["--tonality", n]).out]));
      const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
paths = json.loads(sys.argv[2])
print(json.dumps({k: d.structure(v) for k, v in paths.items()}))
`, join(docxRoot, "scripts"), JSON.stringify(outs)], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const st = JSON.parse(run.stdout);
      const keys = ["title_block", "summary", "numbering", "components", "running_head", "contents"];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const differ = keys.filter((k) => JSON.stringify(st[names[i]][k]) !== JSON.stringify(st[names[j]][k]));
          assert.ok(differ.length >= 3, `${names[i]} vs ${names[j]} differ in ${differ}: ${JSON.stringify([st[names[i]], st[names[j]]])}`);
        }
      }
      assert.equal(st.Proposal.title_block, "cover page");
      assert.equal(st.Memo.title_block, "memo block");
      assert.equal(st.Brief.summary, "numbered points");
      assert.equal(st.Report.numbering, "roman");
      assert.equal(st.Manual.numbering, "decimal");
      const qa2 = qa(dir, outs.Report, components, ["--tonality", "Report", "--compare", outs.Manual]);
      assert.ok(qa2.report.output.structure.differ.length >= 3, JSON.stringify(qa2.report.output.structure));
      assert.ok(!(qa2.report.output.findings || []).some((f) => f.check === "tonality.structure"), JSON.stringify(qa2.report.output.findings));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("headings are ink with plain numbering by tonality, and every data table is booktabs without fills", () => {
    const dir = work();
    try {
      const ink = (h) => h.runs.every((r) => !r.color || /^1A1A1A$/iu.test(r.color));
      const report = built(dir, components, ["--tonality", "Report"]);
      assert.equal(heads(report, 1)[0].runs[0].text, "Ⅰ.", JSON.stringify(heads(report, 1)[0]));
      assert.equal(heads(report, 2)[0].runs[0].text, "1.", JSON.stringify(heads(report, 2)[0]));
      const manual = built(dir, components, ["--tonality", "Manual"]);
      assert.equal(heads(manual, 1)[0].runs[0].text, "1");
      assert.equal(heads(manual, 2)[0].runs[0].text, "2.1", "the first h2 of the fixture sits under its second h1");
      const journal = built(dir, components, ["--tonality", "Journal"]);
      assert.equal(heads(journal, 1)[0].runs[0].text, "1", "Journal numbers sections for cross-references");
      for (const name of ["Brief", "Proposal", "Memo"]) {
        const d = built(dir, components, ["--tonality", name]);
        assert.ok(heads(d, 1).every((h) => !/^[0-9ⅠⅡⅢ■□○]/u.test(h.runs[0].text)), `${name}: unnumbered, no glyph marker`);
      }
      for (const [name, d] of [["Report", report], ["Manual", manual], ["Journal", journal]]) {
        for (const h of [...heads(d, 1), ...heads(d, 2)]) {
          assert.ok(ink(h) && !h.pBdr.bottom && !h.shd, `${name}: an ink heading with no rule or band: ${JSON.stringify(h)}`);
          assert.ok(h.runs.every((r) => !r.size || r.size <= d.sizes["Heading 1"]), `${name}: numbers at the heading's own size`);
        }
        assert.ok(d.sizes["Heading 1"] / d.sizes.Normal <= 1.5, `${name}: h1 ${d.sizes["Heading 1"]} over body ${d.sizes.Normal}`);
      }
      // A caption attribute asks for another style; every tonality still draws booktabs.
      const styled = built(dir, components, ["--tonality", "Proposal", "--variance", "8"]);
      assert.match(styled.stdout, /drawn as booktabs/u);
      for (const [name, d] of [["Report", report], ["Proposal", styled], ["Manual", manual], ["Journal", journal]]) {
        for (const t of tables(d).filter((x) => !x.caption)) {
          assert.ok(t.borders.top && t.borders.bottom && t.borders.top.sz === 8 && !t.borders.insideV && !t.borders.insideH && !t.borders.left, `${name} booktabs: ${JSON.stringify(t.borders)}`);
          assert.equal(t.firstCellBorders.bottom && t.firstCellBorders.bottom.sz, 4, `${name}: a 0.5 pt rule under the header`);
          assert.ok(!t.fills.flat().some(Boolean), `${name}: no fills: ${JSON.stringify(t.fills)}`);
          assert.equal(t.style, null, "no built-in table style");
          assert.ok(t.header && t.cantSplit === t.n && t.minSize >= 9, JSON.stringify(t));
          assert.equal(t.keepRows, t.n - 1, "a table that fits one page is kept together");
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every tonality sets A4 with 25 mm sides, declares Pretendard only (Journal: Times New Roman for Latin body text) and keeps the readable floors", () => {
    const dir = work();
    try {
      for (const name of ["Report", "Brief", "Manual", "Proposal", "Memo", "Journal"]) {
        const d = built(dir, components, ["--tonality", name]);
        const body = d.sections[d.sections.length - 1];
        assert.ok(Math.abs(body.w - 595.3) < 1 && Math.abs(body.h - 841.9) < 1, `${name}: ${body.w} x ${body.h}`);
        const [top, bottom, left, right] = body.margins_mm;
        assert.ok(left >= 25 && right >= 25 && bottom >= top && 210 - left - right <= 160, `${name}: margins ${body.margins_mm}`);
        const faces = new Set([...Object.values(d.defaults), ...Object.values(d.style_fonts).flatMap((f) => [f.ascii, f.eastAsia]).filter(Boolean), ...d.theme, ...d.numbering]);
        const allowed = name === "Journal" ? ["Pretendard", "Times New Roman", "Courier New"] : ["Pretendard", "Courier New"];
        assert.deepEqual([...faces].filter((f) => !allowed.includes(f)), [], `${name}: ${[...faces]}`);
        assert.equal(d.defaults.eastAsia, "Pretendard", name);
        assert.equal(d.defaults_theme, false, `${name}: theme fonts in the defaults`);
        assert.ok(d.sizes.Normal >= 10.5, `${name}: body ${d.sizes.Normal}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("running heads follow the pack, the notice stands once on page 1 and never in a page header", () => {
    const dir = work();
    try {
      const all = (name) => built(dir, components, ["--tonality", name]);
      const notice = "예시 데이터 — 회사·수치는 모두 가정입니다";
      for (const name of ["Report", "Brief", "Manual", "Proposal", "Memo", "Journal"]) {
        const d = all(name);
        for (const p of d.hf.filter((x) => x.kind.includes("header"))) {
          assert.ok(!p.text.includes("예시 데이터") && !p.shd.length, `${name}: no notice chip in a header: ${JSON.stringify(p)}`);
        }
        const inBody = d.blocks.filter((b) => b.t === "p" && b.text === notice).length;
        const inCover = d.hf.filter((p) => p.section === 0 && p.kind === "footer" && p.text.includes(notice)).length;
        assert.equal(inBody + inCover, 1, `${name}: the notice once (${inBody} in the body, ${inCover} on the cover)`);
      }
      const report = all("Report").hf;
      const rf = report.find((p) => p.kind === "footer");
      assert.ok(rf.text.includes("반품 처리 자동화 결과") && rf.fields.includes("PAGE") && !report.some((p) => p.kind === "header" && p.text.trim()), JSON.stringify(report));
      // Manual: the short title in the header, the folio at the foot. STYLEREF named the first section that starts
      // on the page, not the one the page opens in (both reviewers, task-13), so the header carries no section name.
      const manual = all("Manual").hf;
      const mh = manual.find((p) => p.kind === "header");
      assert.ok(!mh.fields.includes("STYLEREF") && mh.text.includes("반품 처리 자동화 결과") && manual.find((p) => p.kind === "footer").fields.includes("PAGE"), JSON.stringify(manual));
      const proposal = all("Proposal");
      const body = proposal.hf.find((p) => p.section === 1 && p.kind === "footer");
      assert.ok(body.fields.includes("PAGE") && !body.text.replace(/\d/gu, "").trim(), JSON.stringify(body));
      assert.equal(proposal.sections[1].pgNumStart, "1");
      const memo = all("Memo");
      assert.ok(memo.sections[0].titlePg && memo.hf.find((p) => p.kind === "footer").fields.includes("PAGE"), "the memo folio from page 2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Brief opens with the decision request and sets its summary as numbered points with bold lead sentences", () => {
    const dir = work();
    try {
      const d = built(dir, components, ["--tonality", "Brief"]);
      const first = d.blocks.findIndex((b) => b.t === "p" && /^Heading/u.test(b.style || ""));
      const call = d.blocks.findIndex((b) => b.t === "tbl" && b.caption === "callout key");
      assert.ok(call >= 0 && call < first, `the decision box stands before the first section: ${call} vs ${first}`);
      const point = d.blocks[first + 1];
      assert.ok(point.text.startsWith("① 반품 검수 자동화는 첫 분기에 검수 시간을 42% 줄였다.") && point.runs[1].bold && !point.runs[point.runs.length - 1].bold, JSON.stringify(point));
      assert.ok(!tables(d).some((t) => t.caption === "keyfigures"), "a brief carries the figures in its points");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("todo 12b: the folio stands at the right edge, text clears a table's bottom rule, memo values start with a capital, a closing line keeps company, a dated line stays a paragraph", () => {
    const dir = work();
    try {
      // The Footer style's centre tab is cleared, or "short title<TAB>folio" stopped mid-line.
      const report = built(dir, components, ["--tonality", "Report"]);
      const footers = spawnSync("sh", ["-c", `unzip -p "${report.out}" 'word/footer*.xml'`], { encoding: "utf8" }).stdout;
      assert.match(footers, /<w:tab (?:w:pos="\d+" w:val="clear"|w:val="clear" w:pos="\d+")\/>/u, "the inherited centre tab is cleared");
      // The paragraph under a table (or under its 자료 line) stands 8 pt clear; the 자료 line 3 pt.
      const source = join(dir, "t.md");
      writeFileSync(source, "---\ntitle: 표 아래 간격\nnotice: 예시\n---\n\n# 결과\n\n2026-06-30 기준으로 집계했다.\n\n표 1. 비용 (예시)\n\n| 항목 | 금액 (억 원) |\n| --- | ---: |\n| 인건비 | 3.2 |\n| 재작업 | 0.1 |\n\n출처: 예시 결산\n\n표 아래 문단이다.\n\n| 항목 | 금액 (억 원) |\n| --- | ---: |\n| 인건비 | 3.2 |\n| 재작업 | 0.1 |\n\n두 번째 표 아래 문단이다.\n\n- 첫째 항목\n- 둘째 항목\n\n끝맺는 한 줄.\n");
      const t = convert(dir, source, ["--tonality", "Report"]);
      assert.equal(t.status, 0, t.stderr);
      const xml = spawnSync("unzip", ["-p", t.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const para = (text) => xml.match(new RegExp(`<w:p>(?:(?!<w:p>).)*?${text}`, "su"))[0];
      const before = (text) => Number((para(text).match(/<w:spacing [^>]*w:before="(\d+)"/u) || [])[1] || 0);
      assert.ok(before("자료: 예시 결산") >= 60, `자료 line ${before("자료: 예시 결산")}`);
      assert.ok(before("표 아래 문단이다") >= 160, `after a note ${before("표 아래 문단이다")}`);
      assert.ok(before("두 번째 표 아래 문단이다") >= 160, `after a table ${before("두 번째 표 아래 문단이다")}`);
      // A dated first line stays body text: "2026. 6. 30." at the start of a line is not a numbered list.
      assert.match(para("기준으로 집계했다"), /2026\. 6\. 30\. 기준/u);
      assert.doesNotMatch(para("기준으로 집계했다"), /<w:numPr>/u);
      // The closing line keeps company: the item before it keeps with it.
      assert.match(para("둘째 항목"), /<w:keepNext\/>/u, "the block before a short closing line keeps with it");
      // An English memo value starts with a capital; a Brief sets To / From / Subject as one line without middle dots.
      const memoSrc = join(dir, "m.md");
      writeFileSync(memoSrc, "---\ntitle: Parking change\nnotice: Example\n---\n\n::: cover variant=masthead kicker=\"Internal memo\"\nTo: All staff · From: Facilities team · Subject: visitor parking\n:::\n\n# What changes\n\nVisitors park on level 1.\n");
      const memo = built(dir, memoSrc, ["--tonality", "Memo"]);
      assert.ok(tables(memo).find((x) => x.caption === "cover memo").rows.some((r) => r[1] === "Visitor parking"), JSON.stringify(tables(memo)));
      const brief = built(dir, memoSrc, ["--tonality", "Brief"]);
      const line = brief.blocks.find((b) => b.t === "p" && b.text.includes("Facilities team"));
      assert.ok(line && !line.text.includes(" · ") && line.runs[0].bold, JSON.stringify(line));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("todo 12b loop 2: a picture paragraph is single spaced, a Brief section opens under a hairline", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "f.png"), tinyPng(400, 200));
      writeFileSync(join(dir, "fig.md"), "---\ntitle: Figure check\nnotice: Sample\n---\n\n# Results\n\n![Figure 1. Conversion over time (synthetic data).](assets/f.png)\n\nThe figure shows the trend.\n");
      // A Latin body multiple is under 1 (pitch 1.33 over a 1.53 em line); a picture in such a paragraph lost its top.
      for (const args of [[], ["--tonality", "Report"]]) {
        const c = convert(dir, join(dir, "fig.md"), args);
        assert.equal(c.status, 0, c.stderr);
        const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
        const para = xml.match(/<w:p>(?:(?!<w:p>).)*?<w:drawing>/su)[0];
        assert.match(para, /<w:spacing [^>]*w:line="240" w:lineRule="auto"/u, `${args}: ${para.slice(0, 300)}`);
      }
      const brief = convert(dir, components, ["--tonality", "Brief"]);
      const styles = spawnSync("unzip", ["-p", brief.out, "word/styles.xml"], { encoding: "utf8" }).stdout;
      const h1 = styles.match(/<w:style [^>]*w:styleId="Heading1".*?<\/w:style>/su)[0];
      assert.match(h1, /<w:pBdr><w:top w:val="single" w:sz="4"/u, "Brief h1 under a hairline");
      const report = convert(dir, components, ["--tonality", "Report"]);
      const rs = spawnSync("unzip", ["-p", report.out, "word/styles.xml"], { encoding: "utf8" }).stdout;
      assert.doesNotMatch(rs.match(/<w:style [^>]*w:styleId="Heading1".*?<\/w:style>/su)[0], /<w:pBdr>/u, "Report h1 has no rule");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("todo 12b loop 3: Korean institute numbering reads Ⅶ. and its heading with one space, no tab, so every gap is the same; decimal numbers hang alike", () => {
    const dir = work();
    try {
      const source = join(dir, "seven.md");
      writeFileSync(source, "---\ntitle: 일곱 장 보고\nnotice: 예시\n---\n\n" + ["가", "나", "다", "라", "마", "바", "사"].map((x) => `# ${x}장 현황\n\n## ${x}장 세부\n\n${x}장 본문 문단이다.\n`).join("\n"));
      const c = convert(dir, source, ["--tonality", "Report"]);
      assert.equal(c.status, 0, c.stderr);
      const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      // LibreOffice set the tab after Ⅴ. past the hang (the gap after Ⅰ., Ⅳ. and Ⅴ. differed, task-12b review round 2).
      for (const [num, text] of [["Ⅰ.", "가장 현황"], ["Ⅴ.", "마장 현황"], ["Ⅶ.", "사장 현황"], ["1.", "사장 세부"]]) {
        const para = xml.match(new RegExp(`<w:p>(?:(?!<w:p>).)*?${text}`, "su"))[0];
        assert.ok(para.includes(`>${num}</w:t>`) && /<w:t xml:space="preserve"> <\/w:t>/u.test(para) && !para.includes("<w:tab/>") && !/w:hanging=/u.test(para), `${num}: ${para.slice(0, 400)}`);
      }
      // Decimal numbering (English report) keeps a tab and one hang per level, wide enough for "7".
      const en = join(dir, "en.md");
      writeFileSync(en, "---\ntitle: Seven parts\nnotice: Sample\n---\n\n" + ["One", "Two", "Three", "Four", "Five", "Six", "Seven"].map((x) => `# Part ${x}\n\nBody of part ${x}.\n`).join("\n"));
      const e = convert(dir, en, ["--tonality", "Report"]);
      const ex = spawnSync("unzip", ["-p", e.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const hangs = [...ex.matchAll(/w:hanging="(\d+)"/gu)].map((m) => m[1]);
      assert.ok(hangs.length === 7 && new Set(hangs).size === 1, `one hang for h1: ${hangs}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("todo 12b review fixes: a bold lead keeps its space in a list item, a box title set as text stands clear of the text above, text under a page-wide table stands clear in two columns", () => {
    const dir = work();
    try {
      const source = join(dir, "kf.md");
      writeFileSync(source, "---\ntitle: 시험\nnotice: 예시\n---\n\n# 요약\n\n본문이다.\n\n- **1,200개** 태그 부착 품목\n- **72%** 해당 품목\n\n끝.\n");
      for (const args of [["--tonality", "Report"], ["--publisher", "korean-generic"]]) {
        const c = convert(dir, source, args);
        assert.equal(c.status, 0, c.stderr);
        const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
        assert.match(xml, /1,200개<\/w:t><\/w:r><w:r>(?:<w:rPr\/>|<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:t xml:space="preserve"> 태그/u, `${args}: the space after the bold figure`);
      }
      // A callout the Memo sets as text: its bold title line stands 6 pt or more below the paragraph above.
      const memo = convert(dir, components, ["--tonality", "Memo"]);
      const mx = spawnSync("unzip", ["-p", memo.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const title = mx.match(/<w:p>(?:(?!<w:p>).)*?공사 시 주의/su)[0];
      assert.ok(Number((title.match(/w:before="(\d+)"/u) || [])[1] || 0) >= 120, title.slice(0, 300));
      // Key figures a pack does not draw read as a list; a basis joins the label's own brackets, never a second pair.
      const kf2 = join(dir, "kf2.md");
      writeFileSync(kf2, "---\ntitle: 시험\nnotice: 예시\n---\n\n# 요약\n\n본문이다.\n\n::: keyfigures\n- **1,200개** 태그 부착 품목 (예시)\n  - 2026년 9월 기준\n- **2곳** 대상 창고\n  - 2027년 착수\n:::\n\n끝.\n");
      const kb = built(dir, kf2, ["--tonality", "Brief"]);
      const items = kb.blocks.filter((x) => x.t === "p" && /1,200개|2곳/u.test(x.text)).map((x) => x.text);
      assert.deepEqual(items, ["1,200개 태그 부착 품목 (예시, 2026년 9월 기준)", "2곳 대상 창고 (2027년 착수)"]);
      // Journal: a wide table spans the page between two section breaks; the text after the second break stands 8 pt clear.
      const wide = join(dir, "wide.md");
      writeFileSync(wide, "---\ntitle: Wide table\nnotice: Sample\n---\n\n# Results\n\nThe table follows.\n\nTable 1. Values (sample)\n\n| A | B | C | D | E |\n| --- | ---: | ---: | ---: | ---: |\n| x | 1 | 2 | 3 | 4 |\n| y | 5 | 6 | 7 | 8 |\n\nAfter the wide table comes this sentence.\n");
      const j = convert(dir, wide, ["--tonality", "Journal"]);
      assert.equal(j.status, 0, j.stderr);
      const jx = spawnSync("unzip", ["-p", j.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const after = jx.match(/<w:p>(?:(?!<w:p>).)*?After the wide table/su)[0];
      assert.ok(Number((after.match(/w:before="(\d+)"/u) || [])[1] || 0) >= 160, after.slice(0, 300));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Korean documents follow the Korean conventions: dates, <표 n> captions, a units line, 자료, plain dashes, upright Hangul, word wrapping in Word", () => {
    const dir = work();
    try {
      const source = join(dir, "ko.md");
      writeFileSync(source, "---\ntitle: 비용 점검 결과\ndate: 2026-07-15\nnotice: 예시\n---\n\n# 비용\n\n2026-06-30 기준으로 집계했다. *강조한 문장*도 있다.\n\n표 1. 비용 변화 (예시)\n\n| 항목 | 도입 전 (억 원) | 도입 후 (억 원) |\n| --- | ---: | ---: |\n| 인건비 | 3.2 | 1.8 |\n| 재작업 | — | 0.1 |\n\n출처: 예시 결산\n\n- 하나뿐인 항목\n\n끝.\n");
      const d = built(dir, source, ["--tonality", "Report"]);
      const text = d.blocks.filter((b) => b.t === "p").map((b) => b.text).join("\n");
      assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/u, "no ISO dates");
      assert.match(text, /2026\. 6\. 30\. 기준/u);
      assert.match(text, /2026\. 7\. 15\./u);
      const cap = d.blocks.find((b) => b.t === "p" && b.style === "Caption");
      assert.ok(cap.text.startsWith("<표 1> 비용 변화") && cap.runs[0].bold, JSON.stringify(cap));
      const at = d.blocks.indexOf(cap);
      assert.equal(d.blocks[at + 1].text, "(단위: 억 원)", "the shared unit moves to a units line");
      const t = d.blocks[at + 2];
      assert.deepEqual(t.rows[0], ["항목", "도입 전", "도입 후"]);
      assert.ok(d.blocks[at + 3].text.startsWith("자료:"), "출처 reads 자료");
      assert.ok(d.blocks.some((b) => b.t === "p" && b.text === "하나뿐인 항목" && [null, "Normal"].includes(b.style)), "a lone item takes no symbol");
      assert.ok(d.blocks.every((b) => b.t !== "p" || b.runs.every((r) => !r.italic)), "Hangul upright");
      const xml = spawnSync("unzip", ["-p", d.out, "word/styles.xml"], { encoding: "utf8" }).stdout;
      assert.match(xml, /<w:wordWrap w:val="1"\/>/u, "Word wraps Hangul between words (wordWrap on)");
      assert.match(xml, /w:eastAsia="ko-KR"/u);
      const num = spawnSync("unzip", ["-p", d.out, "word/numbering.xml"], { encoding: "utf8" }).stdout;
      assert.doesNotMatch(num, /w:lvlText w:val="[•▪]"/u, "Korean bullets are plain dashes");
      // The publisher path writes the frontmatter date the Korean way too (A4.10 holds on every path).
      const pub = convert(dir, source, ["--publisher", "korean-generic"]);
      assert.equal(pub.status, 0, pub.stderr);
      const doc = spawnSync("unzip", ["-p", pub.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      assert.doesNotMatch(doc, /2026-07-15|2026-06-30/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a figure keeps its alt text as a caption under it in the plain, tonality and publisher paths", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "f.png"), tinyPng(400, 200));
      writeFileSync(join(dir, "fig.md"), "---\ntitle: Figure check\nauthors:\n  - { name: Example Author, affiliation: 1 }\naffiliations:\n  1: Example Lab\nabstract: A short synthetic abstract.\nkeywords: [layout, caption]\n---\n\n# Results\n\n![Figure 1. Conversion over time (synthetic data).](assets/f.png)\n\nThe figure shows the trend.\n");
      for (const args of [[], ["--tonality", "Journal"], ["--publisher", "elsevier"]]) {
        const d = built(dir, join(dir, "fig.md"), args);
        const i = d.blocks.findIndex((b) => b.image);
        assert.ok(i >= 0 && d.blocks[i].keepNext, `${args}: ${JSON.stringify(d.blocks[i])}`);
        const cap = d.blocks[i + 1];
        assert.ok(cap.style === "Caption" && cap.text === "Figure 1. Conversion over time (synthetic data).", `${args}: ${JSON.stringify(cap)}`);
        assert.ok(cap.runs[0].bold && cap.runs[0].text === "Figure 1.", `${args}: label bold`);
        const all = d.blocks.filter((b) => b.t === "p").map((b) => b.text).join("\n");
        assert.match(all, /A short synthetic abstract\./u, `${args}: abstract`);
        assert.match(all, /layout; caption|layout, caption/u, `${args}: keywords`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the plain path: A4, Pretendard declared, no built-in Table Grid, directives drawn with neutral styling", () => {
    const dir = work();
    try {
      const d = built(dir, components, []);
      const body = d.sections[d.sections.length - 1];
      assert.ok(Math.abs(body.w - 595.3) < 1, `A4: ${body.w}`);
      assert.equal(d.defaults.eastAsia, "Pretendard");
      assert.equal(d.defaults.ascii, "Pretendard");
      for (const t of tables(d)) assert.notEqual(t.style, "TableGrid", JSON.stringify(t));
      const text = d.blocks.map((b) => (b.t === "p" ? b.text : b.rows.flat().join(" "))).join("\n");
      assert.doesNotMatch(text, /:::|\{style=|column-break/u);
      assert.ok(tables(d).some((t) => t.caption === "callout key"), "callout drawn");
      assert.equal(d.blocks.filter((b) => b.t === "p" && b.text === "반품 처리 자동화 1분기 운영 결과").length, 1, "one title");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("publisher profiles write the same document.xml as before the tonality engine for a source without figures, apart from pagination properties", () => {
    // sha256 of word/document.xml recorded with the converter before todo 10 (task-10/publisher-before.txt). Todo 12
    // added pagination-only properties (keep-with-next, a list restart, no hyphenation or justification in table
    // cells, the profile's page number), checkpoint D round 2 (spec-v2 Amendments 7, R10) 8 pt above the
    // paragraph after a table, and fix round 3 (docx-spec Amendments 6) three quarters of a line there, 6 pt after a
    // list and a short list kept together: with those removed the XML equals the todo-10 output; the full XML is pinned in after.
    const before = {
      "report-ko": { elsevier: "ae0286ad7dcc474e58ca8a30671c16a0b4d2d4c9c920fd4b55373a85b26c49f1", acs: "c7c42c635847c1327468863ade3505d179444304b3999303da16b8ba0eb7c9a6", ieee: "ce693f1d5ccb9e647be3ff1bd07db47788d5838394a27a8f066b81ae4ce8b980", nature: "475ca80b185128bf43bbf79d92f3016c0304d97de3e9a38d7f6e941cc53a8892", "korean-generic": "d2e49472ab3709f99ee3a907171a6fb983ee6e0cea746d278c7b22e91206c47c" },
      "report-data": { elsevier: "2bcb89be4837a7e40b1e461b361101bbcc2892f247a1e90935c4bba7c079b645", acs: "8b7d2add87879dd24d192b7f5fc814bfdb53bf7bdba3b8558d0280c8dbbf43db", ieee: "3a9c8ce9a73a10da4e5a1c6e52e0f2bf97f38b3236cb74f30136261ef06087a8", nature: "a40081e10cf02f03e72810907c3bc364890d59d3a4935f2ae5df63aaffb2da4a", "korean-generic": "6f3cf5b3c4159874b48494720213450e0dfca9b20421d3185c07e19ca1076790" },
    };
    const after = {
      "report-ko": { elsevier: "cb22a92a1b99c755799c47aa23eb273549008c448c7717a06590694491e181a2", acs: "3b7e22ffd2f8edcb5f11fc2e44fdf947b9dcd65a77cc947340fc669ab7e8c87d", ieee: "de02613baebc31a8095926de92db6ffcd4ea5c86a759ce7939cb4c01e0809dda", nature: "478e44eee0adc23c996b24df7e9820debc4b702dfd9de5a36dd300972c834a6e", "korean-generic": "2d01199ea96c8a904377a982080fdbea674b0a84fa776d9ff5d84c9f999a1fbf" },
      "report-data": { elsevier: "d8765ea13e5b737771e8e1b2478da4597f2af16d9ceac28a36513d298c86136b", acs: "be1dd08862025acfb7bfba9372076733779abf7b40d94973e1f91a5f06b3eb4c", ieee: "e007df91dcc571d2df562aca74dbb729d05e663b052e6f57523dc174deb601d9", nature: "26b16b9ad35dfa0a60d4a8aa4cfc6006018fd5328ffbc4b52df515fa4e37b022", "korean-generic": "cab256bc804c455ba86c28ea2448f670e9f2478fdf09aacb7bf9a2d0b82a7ab7" },
    };
    // The todo-10 XML with the same pagination-only properties removed (stripPagination below).
    const beforeStripped = {
      "report-ko": { elsevier: "7a7401b4d52a47ef3687ab7908593d44e557403dd0dd1106dabd476a0e79541b", acs: "7631e6ac1d5aca98900487450fbd0d4c99f65f2ad7b1749d786a7990d3278e4d", ieee: "e43def4d507185c4dd2b8fa57d9d631e7b601a3f89910f16d1592ddb8f5177de", nature: "89ef09b480e28cbddbf61b0af6c3df43047b45c1c3a419eba8c4ff9bd58e3bee", "korean-generic": "f4c9892f5437acc4401b215819cebde364362b89827d2e3bbbff1213d8f0f65e" },
      "report-data": { elsevier: "bc1968a9bad7a524e70142ebae96070150c853e24b3ac7bd7a7decd7b49537ea", acs: "d8dc99fef7fe2c3607f890b17c547f0c503f9e2e05dc2e082a1adaa3c1e6f060", ieee: "28211094f9141f316eba8da4a9b9c05642cc227d4300b79899f5a06fefd8df2a", nature: "3d84d8a8325b19193d9a69102524d082ddcc7e26a9750c5dfabec6f3e7a9b098", "korean-generic": "4a65c6ab9c66c3725771a8f270d506caf008f26460c3b2f39bdd5815c3a6099c" },
    };
    const stripPagination = (xml) => xml.replaceAll("<w:keepNext/>", "").replaceAll("<w:suppressAutoHyphens/>", "").replaceAll('<w:jc w:val="left"/>', "")
      .replace(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>/gu, "").replace(/<w:footerReference w:type="(?:default|first)" r:id="rId\d+"\/>/gu, "")
      .replaceAll("<w:titlePg/>", "").replace(/r:(embed|id)="rId\d+"/gu, 'r:$1="rId"').replace(/<w:spacing w:before="\d+"\/>/gu, "")
      .replaceAll("<w:pPr></w:pPr>", "").replaceAll("<w:pPr/>", "");
    const dir = work();
    try {
      for (const [source, hashes] of Object.entries(before)) {
        for (const [publisher, hash] of Object.entries(hashes)) {
          const c = convert(dir, join(fixtures, `${source}.md`), ["--publisher", publisher]);
          assert.equal(c.status, 0, c.stderr);
          const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
          assert.equal(createHash("sha256").update(xml).digest("hex"), after[source][publisher], `${source} ${publisher} (todo 12 record)`);
          assert.ok(hash, `${source} ${publisher}: todo-10 record`);
          assert.equal(createHash("sha256").update(stripPagination(xml)).digest("hex"), beforeStripped[source][publisher], `${source} ${publisher}: only pagination properties differ from the todo-10 record`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── todo 11: the document output checks in qa_docx.py (docx_layout.py) ──
  const qa = (dir, docx, source, args = []) => {
    const run = spawnSync("python3", [join(docxRoot, "scripts", "qa_docx.py"), docx, "--source", source, ...args], { cwd: dir, encoding: "utf8" });
    return { status: run.status, report: JSON.parse(run.stdout || "{}"), stderr: run.stderr };
  };
  const checksOf = (report) => [...(report.output?.findings || []), ...(report.output?.advisories || [])].map((f) => `${f.severity}:${f.check}`);

  it("the gate fails a sentence as a heading, title or subtitle and a skipped heading level; noun-phrase labels pass", () => {
    const dir = work();
    try {
      const front = (title, subtitle) => `---\ntitle: ${title}\nsubtitle: ${subtitle}\ntonality: report\nnotice: 예시 데이터\n---\n\n`;
      const body = (h2, h3) => `# 요약\n\n2026년 3분기 매출은 1,184억 원(예시)으로 계획보다 44억 원 많았다.\n\n## ${h2}\n\n영업이익은 110억 원(예시)으로 계획보다 10억 원 많았다.\n\n${h3}\n\n원가 절감 효과는 4분기부터 반영된다.\n`;
      const bad = join(dir, "bad.md");
      writeFileSync(bad, front("3분기에 매출이 크게 늘었다", "모든 목표를 달성함") + body("영업이익이 계획을 넘었다", "#### 원가 대응 일정"));
      const good = join(dir, "good.md");
      writeFileSync(good, front("2026년 3분기 경영 실적", "계획 대비 실적과 4분기 과제") + body("영업이익과 원가", "### 원가 대응 일정"));
      const b = qa(dir, convert(dir, bad, ["--tonality", "report"]).out, bad);
      assert.equal(b.status, 1, JSON.stringify(b.report.output));
      const found = b.report.output.findings.map((f) => `${f.check} ${f.detail}`);
      for (const what of ["the title is a sentence", "the subtitle is a sentence", "the h2 is a sentence"]) assert.ok(found.some((f) => f.includes(what)), `${what}: ${JSON.stringify(found)}`);
      assert.ok(found.some((f) => f.startsWith("heading.order h2 -> h4")), JSON.stringify(found));
      const g = qa(dir, convert(dir, good, ["--tonality", "report"]).out, good);
      assert.deepEqual(g.report.output.findings, [], JSON.stringify(g.report.output));
      assert.equal(g.status, 0, JSON.stringify(g.report.failure_reasons));
      // English: a finite verb or a full stop makes a sentence; a label with a parenthesis does not.
      const en = spawnSync(runtimePython, ["-B", "-c", "import sys, json; sys.path.insert(0, sys.argv[1]); import docx_layout as d; print(json.dumps([d.declarative(t) for t in sys.argv[2:]]))",
        join(docxRoot, "scripts"), "Revenue grew 12% in Q3", "Results are in.", "Conversion by feed rate (sample)", "Why libraries?", "1년 운영 결과", "2. 추진 일정과 담당"], { encoding: "utf8" });
      assert.deepEqual(JSON.parse(en.stdout), [true, true, false, false, false, false], en.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the page checks find an underfilled page, a stranded heading, a split table and figure, and too few components", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
blocks = [{"t": "h", "level": 1, "text": "개요", "raw": "개요"}, {"t": "p", "text": "본문"},
          {"t": "h", "level": 2, "text": "실적표", "raw": "실적표"},
          {"t": "tbl", "rows": ["항목", "매출", "영업이익", "원가"], "component": None},
          {"t": "img", "text": ""}, {"t": "cap", "text": "그림1.처리량추이"}, {"t": "p", "text": "끝"}]
page = lambda lines, images=0: {"h": 842.0, "lines": lines, "ink": [(a, b) for a, b, _ in lines], "images": images}
pages = [page([(60, 72, "개요"), (80, 92, "본문"), (150, 162, "실적표")]),        # fills 0.13 and ends on a heading
         page([(60, 72, "본문둘"), (600, 612, "항목"), (700, 712, "매출")]),
         page([(60, 72, "영업이익"), (80, 92, "원가"), (700, 712, "본문계속")], images=1),
         page([(60, 72, "그림1.처리량추이"), (90, 102, "끝")])]
info = {"blocks": blocks, "components": {k: 0 for k in d.KINDS}, "cover": False, "frame": frame}
found, meta = d.paged(info, pages, True)
plain, _ = d.paged(info, pages, False)
print(json.dumps({"found": [[f["check"], f["severity"], f["page"]] for f in found], "plain": [[f["check"], f["severity"]] for f in plain if f["check"] == "component.variety"], "fills": meta["fills"]}))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    const keys = out.found.map(([c, s, p]) => `${c}:${s}:${p}`);
    for (const k of ["fill.page:FAIL:1", "heading.stranded:FAIL:1", "table.split:FAIL:2", "figure.split:FAIL:3", "component.variety:FAIL:null"]) assert.ok(keys.includes(k), `${k} in ${JSON.stringify(keys)}`);
    assert.deepEqual(out.plain, [["component.variety", "ADVISORY"]], "a document with no tonality gets the variety finding as advice");
    assert.equal(out.fills[3].exempt, "last");
  });

  it("a long display title fits three even lines broken between words", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_design as d
from docx import Document
doc = Document()
title = "Conversion and heat release of a supported catalyst in a continuous feed–reactor–separator loop: a synthetic benchmark"
p = doc.add_paragraph()
size = d.display_run(p, title, 32, d.Mm(170), "123A6B", True, ("Pretendard", "Pretendard"))
lines = "".join(r.text for r in p.runs).split("\\n")  # python-docx reads a w:br as a newline
widths = [d._advance(l.strip(), size) for l in lines]
print(json.dumps({"lines": [l.strip() for l in lines], "size": size, "ratio": min(widths) / max(widths), "text": " ".join(l.strip() for l in lines)}))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.ok(out.lines.length <= 3, JSON.stringify(out));
    assert.ok(out.ratio >= 0.5, `lines as even as the words allow, no word left alone: ${JSON.stringify(out)}`);
    assert.equal(out.text, "Conversion and heat release of a supported catalyst in a continuous feed–reactor–separator loop: a synthetic benchmark");
  });

  it("the page checks find a title over three lines, a wrong page total, a sidebar beside the next heading and a caption apart from its table", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
side = {"t": "tbl", "rows": ["용어풀이"], "component": "sidebar", "cells": ["용어풀이", "무선태그:상자나팔레트에붙이는작은칩"]}
blocks = [{"t": "h", "level": 1, "text": "현황", "raw": "현황"}, {"t": "p", "text": "본문"}, side, {"t": "p", "text": "짧은문단"},
          {"t": "h", "level": 1, "text": "03제안내용", "raw": "03 제안 내용"}, {"t": "p", "text": "다음본문"},
          {"t": "cap", "text": "Table2.Conversionbytemperature"}, {"t": "tbl", "rows": ["Inlet", "180", "200"], "component": None}, {"t": "p", "text": "끝"}]
def page(lines, boxes=()):
    return {"h": 842.0, "lines": [(a, b, t) for a, b, t in lines], "ink": [(60, 780)], "images": 0, "boxes": list(boxes)}
title = [(60, 80, "Conversionandheatrelease"), (82, 102, "ofasupportedcatalystina"), (104, 124, "continuousfeed-reactor-"), (126, 146, "separatorloop")]
p1 = page(title + [(160, 172, "현황"), (180, 192, "본문"), (200, 212, "용어풀이"), (214, 226, "무선태그:상자나팔레트에붙이는작은칩"),
               (230, 242, "짧은문단"), (250, 262, "03제안내용"), (270, 282, "다음본문"), (760, 772, "Table2.Conversionbytemperature"), (800, 810, "1/7")],
          boxes=[(400, 200, 540, 212, "용어풀이"), (400, 214, 540, 300, "무선태그:상자나팔레트에붙이는작은칩"), (60, 250, 300, 262, "03제안내용")])
p2 = page([(60, 72, "Inlet"), (80, 92, "180"), (100, 112, "200"), (120, 132, "끝"), (800, 810, "2/7")])
info = {"blocks": blocks, "components": {k: 0 for k in d.KINDS}, "cover": False, "frame": frame}
found, _ = d.paged(info, [p1, p2], True, {"title": "Conversion and heat release of a supported catalyst in a continuous feed–reactor–separator loop"})
print(json.dumps([[f["check"], f["page"], f["detail"]] for f in found]))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const found = JSON.parse(run.stdout);
    const has = (check, page, part) => found.some(([c, p, detail]) => c === check && p === page && detail.includes(part));
    assert.ok(has("title.lines", 1, "4 lines"), JSON.stringify(found));
    assert.ok(has("folio.total", 1, "/ 7"), JSON.stringify(found));
    assert.ok(has("sidebar.overlap", 1, "03 제안 내용"), JSON.stringify(found));
    assert.ok(has("table.split", 1, "caption"), JSON.stringify(found));
  });

  it("a publisher manuscript restarts its second numbered list, and a narrow table column is never narrower than its longest word, in a tonality and a publisher table", () => {
    const dir = work();
    try {
      const source = join(dir, "lists.md");
      writeFileSync(source, "---\ntitle: Two lists\nnotice: Synthetic example\n---\n\n# Introduction\n\n1. Weigh the feed\n2. Start the pump\n\nThen the template:\n\n1. Conversion at the end of the run\n2. Half-conversion time\n");
      const c = convert(dir, source, ["--publisher", "elsevier"]);
      assert.equal(c.status, 0, c.stderr);
      const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const num = spawnSync("unzip", ["-p", c.out, "word/numbering.xml"], { encoding: "utf8" }).stdout;
      const para = xml.match(/<w:p[ >](?:(?!<\/w:p>).)*Conversion at the end(?:(?!<\/w:p>).)*<\/w:p>/su)[0];
      const id = (para.match(/<w:numId w:val="(\d+)"/u) || [])[1];
      assert.ok(id && new RegExp(`<w:num w:numId="${id}"[^>]*>(?:(?!</w:num>).)*<w:startOverride w:val="1"/>`, "su").test(num), para);
      const table = join(dir, "table.md");
      writeFileSync(table, "---\ntitle: Narrow column\ntonality: report\nnotice: Sample\n---\n\n# Results\n\nTable 1. Results by catalyst (sample)\n\n| Inlet (°C) | Catalyst | Conversion at 60 min (%) | Half-conversion time (min) | Peak heat release (kW) |\n| ---: | --- | ---: | ---: | ---: |\n| 180 | Baseline | 41 (40–42) | 24 (23–25) | 0.92 |\n| 180 | Proposed | 63 (62–64) | 15 (14–16) | 1.10 |\n");
      const paper = join(dir, "paper.md");
      writeFileSync(paper, readFileSync(table, "utf8").replace("tonality: report\n", ""));
      // The tonality table, and (spec Amendments 4, todo 12b) the elsevier and acs tables of the same source.
      for (const [label, c] of [["tonality", convert(dir, table)], ["elsevier", convert(dir, paper, ["--publisher", "elsevier"])], ["acs", convert(dir, paper, ["--publisher", "acs"])]]) {
        assert.equal(c.status, 0, c.stderr);
        const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[2])
import docx_design as d
from docx import Document
doc = Document(sys.argv[1])
tbl = [t for t in doc.tables if t._tbl.find(d.qn("w:tblPr") + "/" + d.qn("w:tblCaption")) is None][0]
w = tbl.rows[0].cells[1].width / 12700
run = tbl.rows[2].cells[1].paragraphs[0].runs[0]
size = run.font.size.pt if run.font.size else 10
need = d._advance("Proposed", size) + 14
print(json.dumps({"width": w, "need": need}))
`, c.out, join(docxRoot, "scripts")], { encoding: "utf8" });
        assert.equal(run.status, 0, run.stderr);
        const { width, need } = JSON.parse(run.stdout);
        assert.ok(width >= need, `${label}: Catalyst column ${width.toFixed(1)} pt, the word "Proposed" needs about ${need.toFixed(1)} pt`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a sidebar's wrapped lines count toward its height when the next heading starts beside it", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
side = {"t": "tbl", "rows": ["Terms"], "component": "sidebar", "cells": ["Termsusedinthisreport", "Coolingmargin:jacketcapacityminuspeakheatrelease;negativemeanstheloopcannotholditstemperature."]}
blocks = [{"t": "h", "level": 2, "text": "Runprotocol", "raw": "Run protocol"}, side, {"t": "p", "text": "Wereportthree"},
          {"t": "h", "level": 2, "text": "Syntheticdatageneration", "raw": "Synthetic data generation"}, {"t": "p", "text": "Conversioncurves"}]
boxes = [(60, 90, 300, 102, "Runprotocol"), (400, 120, 540, 132, "Termsusedinthisreport"), (415, 140, 540, 152, "Coolingmargin:jacket"),
         (415, 156, 540, 168, "capacityminuspeakheat"), (415, 172, 540, 184, "release;negativemeansthe"), (415, 188, 540, 200, "loopcannotholdits"),
         (415, 204, 540, 216, "temperature."), (60, 120, 380, 132, "Wereportthree"), (60, 196, 300, 210, "Syntheticdatageneration"), (60, 230, 540, 242, "Conversioncurves")]
page = {"h": 842.0, "lines": sorted((b[1], b[3], b[4]) for b in boxes), "ink": [(60, 780)], "images": 0, "boxes": boxes}
info = {"blocks": blocks, "components": {k: 0 for k in d.KINDS}, "cover": False, "frame": frame}
found, _ = d.paged(info, [page, {"h": 842.0, "lines": [(60, 72, "끝")], "ink": [(60, 72)], "images": 0, "boxes": []}], True)
print(json.dumps([f["check"] for f in found]))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(JSON.parse(run.stdout).includes("sidebar.overlap"), run.stdout);
  });

  it("loop 6: a long table may split with three rows each side, a tall sidebar beside a short passage stops floating, an inline sidebar keeps together", () => {
    const dir = work();
    try {
      const rows = (n) => Array.from({ length: n }, (_, i) => `| ${180 + i * 10} | Proposed | ${40 + i} |`).join("\n");
      const source = join(dir, "long.md");
      writeFileSync(source, `---\ntitle: Long table\ntonality: manual\nnotice: Sample\n---\n\n# Results\n\nTable 1. Long results (sample)\n\n| Inlet | Catalyst | Conversion |\n| ---: | --- | ---: |\n${rows(20)}\n\nTable 2. Short results (sample)\n\n| Inlet | Catalyst | Conversion |\n| ---: | --- | ---: |\n${rows(5)}\n\nEnd.\n\n## Terms\n\n::: sidebar title="Terms used in this report" width=third\n- **Half-conversion time**: minutes until conversion first reaches half of its 60 min value.\n- **Peak heat release**: the highest one-minute average of heat removed by the jacket.\n- **Cooling margin**: jacket capacity minus peak heat release; negative means the loop cannot hold its temperature.\n:::\n\nWe report three quantities per run:\n\n1. **Conversion at 60 min**, the closest value to steady state within the run length.\n2. **Half-conversion time**, the time at which conversion first reaches half of its 60 min value.\n3. **Peak heat release**, the highest one-minute average of heat removed by the jacket.\n\nThe half-conversion time is a simple measure of start-up speed that changes little between repeats. It does not depend on the exact shape of the curve and can be read from a plot by eye, which keeps it usable in short reports.\n\n## Synthetic data generation\n\nConversion curves were generated.\n`);
      const d = built(dir, source, []);
      const data = tables(d).filter((t) => !t.caption);
      const keeps = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from docx import Document
from docx.oxml.ns import qn
doc = Document(sys.argv[1])
out = []
for t in doc.tables:
    if t._tbl.find(qn("w:tblPr") + "/" + qn("w:tblCaption")) is not None:
        continue
    out.append([r.cells[0].paragraphs[0]._p.find(qn("w:pPr") + "/" + qn("w:keepNext")) is not None for r in t.rows])
print(json.dumps(out))
`, d.out], { encoding: "utf8" });
      const [long, short] = JSON.parse(keeps.stdout);
      // header + 20 body rows: the header keeps a quarter frame of rows (at least three body rows) with it, the last
      // three body rows keep together, the rows between may break; the header row repeats.
      const lead = long.indexOf(false);
      assert.ok(lead >= 4 && long.slice(lead, -3).every((k) => !k) && JSON.stringify(long.slice(-3)) === "[true,true,false]", JSON.stringify(long));
      assert.ok(data[0].header, "the long table repeats its header row");
      assert.deepEqual(short, [true, true, true, true, true, false], "a table under six body rows stays whole");
      assert.ok(!tables(d).find((t) => t.caption === "sidebar").float, "the box is taller than the list and paragraph beside it");
      const brief = built(dir, components, ["--tonality", "Brief"]);
      const inline = brief.blocks.findIndex((b) => b.t === "p" && b.text === "오류 유형 (예시)");
      assert.ok(inline >= 0, "Brief sets the sidebar inline");
      const items = brief.blocks.slice(inline, inline + 4);
      assert.deepEqual(items.map((b) => b.keepNext), [true, true, true, false], JSON.stringify(items.map((b) => [b.text, b.keepNext])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loop 6: the split check allows a long table split with three body rows each side when the table started high on the page", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
names = ["Inlet"] + [f"r{i}" for i in range(1, 9)]
def case(start_y, first):
    blocks = [{"t": "h", "level": 1, "text": "Results", "raw": "Results"}, {"t": "cap", "text": "Table1.Longresults"},
              {"t": "tbl", "rows": names, "component": None, "cells": names}, {"t": "p", "text": "End"}]
    p1 = [(60, 72, "Results"), (start_y - 14, start_y - 2, "Table1.Longresults")] + [(start_y + 20 * i, start_y + 20 * i + 12, names[i]) for i in range(first + 1)]
    p2 = [(60, 72, "Inlet")] + [(80 + 20 * k, 92 + 20 * k, names[i]) for k, i in enumerate(range(first + 1, 9))] + [(300, 312, "End")]
    page = lambda ls: {"h": 842.0, "lines": ls, "ink": [(60, 780)], "images": 0, "boxes": []}
    info = {"blocks": blocks, "components": {k: 0 for k in d.KINDS}, "cover": False, "frame": frame}
    found, _ = d.paged(info, [page(p1), page(p2), page([(60, 72, "x")])], True)
    return [f["check"] for f in found if f["check"] == "table.split"]
print(json.dumps({"ok": case(560, 4), "orphan": case(700, 1), "low": case(640, 4)}))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.deepEqual(out.ok, [], "4 + 4 body rows, the table started at 0.69 of the frame: an allowed split");
    assert.deepEqual(out.orphan, ["table.split"], "one body row left behind");
    assert.deepEqual(out.low, ["table.split"], "the table started at 0.80 of the frame: moving it whole leaves the page full enough");
  });

  it("loop 6: publisher pages carry the profile's bottom-centre page number from page 2, and table cells neither hyphenate nor justify", () => {
    const dir = work();
    try {
      const c = convert(dir, join(fixtures, "report-ko.md"), ["--publisher", "elsevier"]);
      assert.equal(c.status, 0, c.stderr);
      const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from docx import Document
from docx.oxml.ns import qn
doc = Document(sys.argv[1])
s = doc.sections[0]
foot = s.footer._element.xml
first = s.first_page_footer._element.xml
cells = [p for t in doc.tables for r in t.rows for c in r.cells for p in c.paragraphs]
print(json.dumps({"page": "PAGE" in foot, "center": 'w:val="center"' in foot, "titlePg": s.different_first_page_header_footer,
                  "firstHasPage": "PAGE" in first,
                  "hyph": all(p._p.find(qn("w:pPr") + "/" + qn("w:suppressAutoHyphens")) is not None for p in cells),
                  "justified": any((p._p.find(qn("w:pPr") + "/" + qn("w:jc")) is not None and p._p.find(qn("w:pPr") + "/" + qn("w:jc")).get(qn("w:val")) == "both") for p in cells)}))
`, c.out], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const out = JSON.parse(run.stdout);
      assert.deepEqual(out, { page: true, center: true, titlePg: true, firstHasPage: false, hyph: true, justified: false }, JSON.stringify(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a sentence that only opens like a table caption or a box line is not taken for it", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
side = {"t": "tbl", "rows": ["Terms"], "component": "sidebar", "cells": ["Termsusedinthisreport", "Half-conversiontime:minutesuntilconversion"]}
blocks = [{"t": "h", "level": 1, "text": "Results", "raw": "Results"}, side, {"t": "p", "text": "Table2summarisesthethreequantities."},
          {"t": "cap", "text": "Table2.Conversionbyinlettemperature"}, {"t": "tbl", "rows": ["Inlet", "180"], "component": None},
          {"t": "p", "text": "2.Half-conversiontime,thetimeatwhich"}]
page = lambda lines: {"h": 842.0, "lines": lines, "ink": [(60, 780)], "images": 0, "boxes": []}
p1 = page([(60, 72, "Results"), (80, 92, "Termsusedinthisreport"), (94, 106, "Half-conversiontime:minutesuntilconversion"), (700, 712, "Table2summarisesthethreequantities.")])
p2 = page([(60, 72, "Table2.Conversionbyinlettemperature"), (80, 92, "Inlet"), (100, 112, "180"), (130, 142, "Half-conversiontime,thetimeatwhich")])
info = {"blocks": blocks, "components": {k: 0 for k in d.KINDS}, "cover": False, "frame": frame}
found, _ = d.paged(info, [p1, p2], True)
print(json.dumps([[f["check"], f["detail"]] for f in found if f["check"] == "table.split"]))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), []);
  });

  it("the band footer prints the page number only, a sidebar with too little text beside it before the next heading stops floating", () => {
    const dir = work();
    try {
      const brief = built(dir, components, ["--tonality", "Brief"]);
      const footers = spawnSync("sh", ["-c", `unzip -p "${brief.out}" 'word/footer*.xml'`], { encoding: "utf8" }).stdout;
      assert.match(footers, /PAGE/u);
      assert.doesNotMatch(footers, /NUMPAGES/u, "LibreOffice counts the blank page it inserts for a restarted page number");
      const source = join(dir, "side.md");
      writeFileSync(source, "---\ntitle: 용어 상자\ntonality: manual\nnotice: 예시\n---\n\n# 현황\n\n::: sidebar title=\"용어 풀이\" width=third\n- 무선 태그: 상자나 팔레트에 붙이는 작은 칩. 판독기가 가까이 오면 위치를 보낸다.\n- 판독기: 출입구와 통로에 다는 장치. 태그가 지나가면 위치를 기록한다.\n- 표본 실사: 오차가 큰 구역만 골라 세는 방식.\n:::\n\n짧은 문단 하나.\n\n# 제안 내용\n\n다음 본문.\n");
      const d = built(dir, source, []);
      const sidebar = tables(d).find((t) => t.caption === "sidebar");
      assert.ok(sidebar && !sidebar.float, `no float when the text beside it ends before the box: ${JSON.stringify(sidebar)}`);
      const long = built(dir, components, ["--tonality", "Manual"]);
      assert.equal(tables(long).find((t) => t.caption === "sidebar").float, "right", "a sidebar beside enough text still floats");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("publisher tables keep with their caption and stay on one page when they fit, with the header row repeated", () => {
    const dir = work();
    try {
      const source = join(dir, "paper.md");
      writeFileSync(source, "---\ntitle: Conversion by feed rate\nauthors: [Example Author A]\nabstract: Synthetic.\nkeywords: [example]\nnotice: Synthetic example\n---\n\n# Introduction\n\nFeed rate sets conversion [1].\n\nTable 1. Conversion by feed rate (example)\n\n| Feed | Conversion |\n| --- | ---: |\n| 1 | 40 |\n| 2 | 55 |\n| 3 | 61 |\n\nThe table ends here.\n");
      for (const publisher of ["elsevier", "acs"]) {
        const d = built(dir, source, ["--publisher", publisher]);
        const i = d.blocks.findIndex((b) => b.t === "tbl");
        const cap = d.blocks[i - 1];
        const t = d.blocks[i];
        assert.ok(/^Table\s1\./u.test(cap.text) && cap.keepNext, `${publisher} caption keeps with its table: ${JSON.stringify(cap)}`);
        assert.ok(t.cantSplit === t.n && t.keepRows === t.n - 1 && t.header, `${publisher}: ${JSON.stringify(t)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the page checks find a title or heading wrapped inside a word and a component box split over two pages", () => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
kf = {"t": "tbl", "rows": ["55kg하루잔반감량(예시)"], "component": "keyfigures",
      "cells": ["55kg", "하루잔반감량(예시)", "감량목표30%달성시", "6,900만원", "연간절감(예시)", "식재료원가와처리비용합계"]}
blocks = [{"t": "h", "level": 1, "text": "제안개요", "raw": "제안 개요"}, {"t": "p", "text": "본문"},
          {"t": "h", "level": 2, "text": "기대효과", "raw": "기대 효과"}, kf, {"t": "p", "text": "감량효과는"}]
page = lambda lines: {"h": 842.0, "lines": lines, "ink": [(60, 780)], "images": 0}
front = {"title": "구내식당 잔반 감량 시범 사업 제안서"}
def pages(title_lines):
    return [page(title_lines + [(140, 152, "제안개요"), (160, 172, "본문"), (700, 712, "기대효과"), (730, 760, "55kg"), (730, 760, "6,900만원")]),
            page([(60, 72, "하루잔반감량(예시)"), (60, 72, "연간절감(예시)"), (76, 88, "감량목표30%달성시"), (76, 88, "식재료원가와처리비용합계"), (120, 132, "감량효과는")])]
info = {"blocks": blocks, "components": {k: 0 for k in d.KINDS}, "cover": False, "frame": frame}
bad, _ = d.paged(info, pages([(60, 90, "구내식당잔반감량시범사업제"), (95, 125, "안서")]), True, front)
good, _ = d.paged(info, pages([(60, 90, "구내식당잔반감량"), (95, 125, "시범사업제안서")]), True, front)
print(json.dumps({"bad": [[f["check"], f["page"], f["detail"]] for f in bad], "good": [f["check"] for f in good]}))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.ok(out.bad.some(([c, p, detail]) => c === "heading.wrap" && p === 1 && detail.includes("제안서")), JSON.stringify(out.bad));
    assert.ok(out.bad.some(([c, p, detail]) => c === "table.split" && p === 1 && detail.includes("keyfigures")), JSON.stringify(out.bad));
    assert.ok(!out.good.includes("heading.wrap"), `a title broken between words passes: ${JSON.stringify(out.good)}`);
  });


  it("A4.11: the restraint checks find colour, a loud scale, fills, too many components, ISO dates, a header chip and a cover block", () => {
    const dir = work();
    try {
      const bad = join(dir, "bad.docx");
      const make = spawnSync(runtimePython, ["-B", "-c", `
import sys
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
doc = Document()
doc.styles["Normal"].font.size = Pt(10)
h = doc.add_heading("운영 결과", 1)
for r in h.runs:
    r.font.size = Pt(18)
    r.font.color.rgb = RGBColor.from_string("1F5AA6")
doc.add_paragraph("2026-10-01 기준 집계이며 수치는 예시다.")
t = doc.add_table(2, 2)
shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:fill"), "123A6B")
t.cell(0, 0)._tc.get_or_add_tcPr().append(shd)
t.cell(0, 0).paragraphs[0].add_run("구분")
for kind in ("callout", "sidebar", "keyfigures", "keyfigures"):
    box = doc.add_table(1, 1)
    cap = OxmlElement("w:tblCaption"); cap.set(qn("w:val"), kind)
    box._tbl.tblPr.append(cap)
    box.cell(0, 0).paragraphs[0].add_run("상자")
q = doc.add_paragraph("인용", style=doc.styles.add_style("Pullquote", 1))
hp = doc.sections[0].header.paragraphs[0]
run = hp.add_run("예시 데이터")
run.font.color.rgb = RGBColor.from_string("A21B12")
doc.save(sys.argv[1])
`, bad], { encoding: "utf8" });
      assert.equal(make.status, 0, make.stderr);
      const check = (path, tonality) => {
        const run = spawnSync(runtimePython, ["-B", "-c", "import json, sys; sys.path.insert(0, sys.argv[1]); import docx_layout as d; print(json.dumps([[f['check'], f['severity']] for f in d.restraint(sys.argv[2], sys.argv[3] == '1')]))",
          join(docxRoot, "scripts"), path, tonality ? "1" : "0"], { encoding: "utf8" });
        assert.equal(run.status, 0, run.stderr);
        return JSON.parse(run.stdout);
      };
      const found = check(bad, true).map(([c, s]) => `${c}:${s}`);
      for (const k of ["heading.ink:FAIL", "heading.ratio:FAIL", "table.fill:FAIL", "component.budget:FAIL", "date.iso:FAIL", "furniture.chip:FAIL", "color.accent-kinds:FAIL"]) {
        assert.ok(found.includes(k), `${k} in ${JSON.stringify(found)}`);
      }
      // Outside a tonality the restraint checks advise; an ISO date in Korean text fails on every path.
      const plain = check(bad, false);
      assert.ok(plain.every(([c, s]) => s === "ADVISORY" || c === "date.iso"), JSON.stringify(plain));
      // Every tonality build of the components fixture passes them all.
      for (const name of ["Report", "Brief", "Manual", "Proposal", "Memo", "Journal"]) {
        assert.deepEqual(check(built(dir, components, ["--tonality", name]).out, true), [], name);
      }
      // cover.block reads the rendered cover page: filled shapes over a quarter of it fail.
      const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
sys.path.insert(0, sys.argv[1])
import docx_layout as d
frame = {"page_h": 842.0, "top": 60.0, "bottom": 60.0}
page = lambda filled: {"h": 842.0, "lines": [(60, 72, "제목")], "ink": [(60, 400)], "images": 0, "boxes": [], "filled": filled}
info = {"blocks": [{"t": "p", "text": "제목"}], "components": {k: 0 for k in d.KINDS}, "cover": True, "frame": frame}
print(json.dumps([[f["check"] for f in d.paged(info, [page(x), page(0)], True)[0]] for x in (0.36, 0.02)]))
`, join(docxRoot, "scripts")], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const [block, clean] = JSON.parse(run.stdout);
      assert.ok(block.includes("cover.block") && !clean.includes("cover.block"), run.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("a source line under a table that fits one page stays on the table's page", () => {
    const dir = work();
    try {
      const source = join(dir, "src.md");
      const table = "| Item | Amount |\n| --- | ---: |\n| Coordinator | 48,000 |\n| Tools | 17,500 |\n";
      writeFileSync(source, `---\ntitle: Budget note\ntonality: proposal\nnotice: Sample\n---\n\n# Budget\n\nTable 1. Budget (sample)\n\n${table}\nSource: supplier quotes, September 2026 (sample)\n\nTable 2. Second budget (sample)\n\n${table}\nThe second table ends without a source line.\n`);
      const d = built(dir, source, []);
      const data = tables(d).filter((t) => !t.caption);
      assert.equal(data.length, 2, JSON.stringify(tables(d)));
      assert.ok(data[0].keepRows === data[0].n - 1 && data[0].keepLast, `the last row keeps with its source line too: ${JSON.stringify(data[0])}`);
      assert.ok(data[1].keepRows === data[1].n - 1 && !data[1].keepLast, `a table followed by body text keeps only its rows together: ${JSON.stringify(data[1])}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a numbered list after other text starts again at 1 under a tonality", () => {
    const dir = work();
    try {
      const source = join(dir, "lists.md");
      writeFileSync(source, "---\ntitle: Two lists\ntonality: report\nnotice: Synthetic example\n---\n\n# Steps\n\n1. Weigh the feed\n2. Start the pump\n3. Log the time\n\nThen the template:\n\n1. Conversion at the end of the run\n2. Half-conversion time\n");
      const c = convert(dir, source);
      assert.equal(c.status, 0, c.stderr);
      const run = spawnSync(runtimePython, ["-B", "-c", `
import json, sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
doc, num = z.read("word/document.xml").decode(), z.read("word/numbering.xml").decode()
paras = re.findall(r"<w:p[ >].*?</w:p>", doc, re.S)
ids = [(re.search(r'<w:numId w:val="(\\d+)"', p) or [None, None])[1] for p in paras if "Conversion at the end" in p or "Weigh the feed" in p]
starts = {m.group(1): (re.search(r'<w:startOverride w:val="(\\d+)"', m.group(2)) or [None, None])[1] for m in re.finditer(r'<w:num w:numId="(\\d+)"[^>]*>(.*?)</w:num>', num, re.S)}
print(json.dumps({"ids": ids, "start": starts.get(ids[1]) if ids[1] else None}))
`, c.out], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const out = JSON.parse(run.stdout);
      assert.ok(out.ids[1] && out.ids[1] !== out.ids[0] && out.start === "1", JSON.stringify(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a publisher heading style names its face without a theme font that would override it", () => {
    const dir = work();
    try {
      for (const publisher of ["elsevier", "acs", "korean-generic"]) {
        const c = convert(dir, join(fixtures, "report-ko.md"), ["--publisher", publisher]);
        assert.equal(c.status, 0, c.stderr);
        const styles = spawnSync("unzip", ["-p", c.out, "word/styles.xml"], { encoding: "utf8" }).stdout;
        const clashes = [...styles.matchAll(/<w:rFonts [^>]*>/gu)].map((m) => m[0]).filter((f) => /w:ascii="/u.test(f) && /w:asciiTheme="/u.test(f));
        assert.deepEqual(clashes, [], `${publisher}: a theme attribute wins over the named face in Word and LibreOffice`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prose lint reads dashes in table cells and reference lists as data, title case allows minor words, lexical diversity is read per subsection, and a tonality run is not held to a publisher's section order", () => {
    const dir = work();
    const script = join(dir, "lint.py");
    writeFileSync(script, `
import json, sys
sys.path.insert(0, sys.argv[1])
import slop_lint as s
rules = s.load_phrase_rules(s.Path(sys.argv[1]).parent / "references" / "slop_phrase_list.yaml")
pub = s.load_publisher(s.Path(sys.argv[1]).parent / "templates" / "registry.yaml", "korean-generic")
ids = lambda text: sorted({f.rule_id for f in s.lint_text(text, pub, rules, "auto")[0]})
table = "# 목표\\n\\n| 지표 | 도입 전 | 목표 |\\n| --- | ---: | ---: |\\n| 절감액 | — | 3.2 |\\n| 가동률 | — | 95.0 |\\n"
refs = "# References\\n\\n" + "\\n".join(f"[{i}] Example Author {i}, Example Author B. Placeholder title on reactor start-up number {i}. Example Journal. 2021;14:201-215." for i in range(1, 7)) + "\\n"
import random
random.seed(7)
vocab = [f"term{i}" for i in range(400)]
varied = "# Results\\n\\n" + "\\n\\n".join(f"## Part {k}\\n\\n" + " ".join(random.sample(vocab[:80], 60)) + "." for k in range(5)) + "\\n"
flat = "# Results\\n\\n## Part one\\n\\n" + " ".join(["the loop and the catalyst and the loop"] * 12) + ".\\n"
print(json.dumps([ids(table), ids(refs), "rule-10-lexical-diversity" in ids(varied), "rule-10-lexical-diversity" in ids(flat), [s.heading_case_ok(h, "title_case") for h in ("Results and Discussion", "Results and discussion", "Materials And Methods", "Effect of Inlet Temperature")]]))
`);
    try {
      const run = spawnSync("python3", ["-B", script, join(docxRoot, "scripts")], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const [table, refs, varied, flat, cases] = JSON.parse(run.stdout);
      assert.equal(varied, false, "a long section of varied subsections is not low in lexical diversity: TTR is read per subsection");
      assert.equal(flat, true, "a repetitive subsection still is");
      assert.deepEqual(cases, [true, false, true, true], "title case keeps a minor word (and, of) lower case after the first word");
      assert.ok(!table.includes("rule-02-em-dash-cluster"), JSON.stringify(table));
      assert.ok(!refs.includes("rule-05-sentence-variance"), JSON.stringify(refs));
      const source = join(dir, "paper.md");
      writeFileSync(source, "---\ntitle: Conversion by feed rate\ntonality: journal\nnotice: Synthetic example\n---\n\n# Introduction\n\nFeed rate sets the conversion of the loop [1].\n\n# Benchmark loop\n\nThe loop has three units.\n\n# References\n\n[1] Example Author A. Placeholder title. Example Journal. 2021;14:201-215.\n");
      const g = qa(dir, convert(dir, source, ["--tonality", "journal"]).out, source, ["--kind", "manuscript"]);
      assert.ok(!(g.report.lint?.prose || []).some((f) => f.rule === "rule-08-structure-order"), JSON.stringify(g.report.lint?.prose));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a spaced hyphen between words is still a dash finding, a nested list marker under a key figure is not", () => {
    // slop_lint re-runs itself inside the office runtime, which needs a script file, not -c.
    const dir = work();
    const script = join(dir, "dash.py");
    writeFileSync(script, `
import json, sys
sys.path.insert(0, sys.argv[1])
import slop_lint as s
rules = s.load_phrase_rules(s.Path(sys.argv[1]).parent / "references" / "slop_phrase_list.yaml")
pub = s.load_publisher(s.Path(sys.argv[1]).parent / "templates" / "registry.yaml", "korean-generic")
ids = lambda text: sorted({f.rule_id for f in s.lint_text(text, pub, rules, "auto")[0]})
print(json.dumps([ids("# 요약\\n\\n처리량은 31% 늘었다 - 도입 전보다 빠르다.\\n"), ids("# 요약\\n\\n::: keyfigures\\n- **+31%** 처리량 (예시)\\n  - 2026년 3분기, 도입 전 대비\\n:::\\n")]))
`);
    const run = spawnSync("python3", ["-B", script, join(docxRoot, "scripts")], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    assert.equal(run.status, 0, run.stderr);
    const [dash, marker] = JSON.parse(run.stdout);
    assert.ok(dash.includes("rule-02-em-dash-cluster"), JSON.stringify(dash));
    assert.ok(!marker.includes("rule-02-em-dash-cluster"), JSON.stringify(marker));
  });

  it("a publisher run on a source with ::: components keeps their attribute quotes straight and curls the prose quotes", () => {
    const dir = work();
    try {
      const source = join(dir, "pub.md");
      writeFileSync(source, "---\ntitle: 운영 자금 집행 점검\n---\n\n::: callout kind=key title=\"승인 요청\"\n권역 확대 예산 14억 원의 1차 집행을 이번 달 운영 회의에서 승인해 주십시오.\n:::\n\n# 점검 배경\n\n네 개 쓰임 가운데 권역 확대를 \"우선 집행\" 항목으로 정리했다.\n");
      for (const publisher of ["korean-generic", "elsevier"]) {
        const d = built(dir, source, ["--publisher", publisher]);
        const text = d.blocks.map((b) => (b.t === "p" ? b.text : b.rows.flat().join(" "))).join("\n");
        assert.match(text, /승인 요청/u, `${publisher}: the callout title is drawn`);
        assert.doesNotMatch(text, /:::|kind=key/u, `${publisher}: no fence text leaks`);
        assert.match(text, /“우선 집행”/u, `${publisher}: prose quotes still curl`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Checkpoint D round 2 (spec-v2 Amendments 7): memo on one page, spacing around tables and captions ──
  // The paragraph properties of the paragraph whose text starts with `text`.
  const pPr = (xml, text) => {
    const at = xml.indexOf(`>${text}`);
    assert.ok(at > 0, `paragraph "${text}" in document.xml`);
    const start = Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at));
    return (/<w:pPr>[\s\S]*?<\/w:pPr>/u.exec(xml.slice(start, at)) || [""])[0];
  };
  const before = (ppr) => Number((/<w:spacing\b[^>]*w:before="(\d+)"/u.exec(ppr) || [, 0])[1]);
  const after = (ppr) => Number((/<w:spacing\b[^>]*w:after="(\d+)"/u.exec(ppr) || [, 0])[1]);

  it("R5: a memo that fits one page stays on one page, its run-in head and the paragraph after a list set clear (memo.fit)", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const dir = work();
    try {
      const memo = convert(dir, join(fixtures, "memo-en.md"), ["--tonality", "Memo"]);
      assert.equal(memo.status, 0, memo.stderr);
      const xml = spawnSync("unzip", ["-p", memo.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      assert.ok(before(pPr(xml, "Fire lane")) >= 240, `space above the run-in head: ${pPr(xml, "Fire lane")}`);
      assert.ok(before(pPr(xml, "Visitors with a blue badge")) >= 120, "a paragraph after a list stands clear of it");
      const one = qa(dir, memo.out, join(fixtures, "memo-en.md"), ["--layout", "--tonality", "Memo"]);
      assert.ok(!checksOf(one.report).some((c) => c.endsWith("memo.fit")), JSON.stringify(checksOf(one.report)));
      const pdf = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, memo.out], { cwd: dir, encoding: "utf8" });
      assert.equal(pdf.status, 0, pdf.stderr);
      const pages = spawnSync(runtimePython, ["-B", "-c", "import sys, pymupdf; print(len(pymupdf.open(sys.argv[1])))", memo.out.replace(/\.docx$/u, ".pdf")], { encoding: "utf8" });
      assert.equal(pages.stdout.trim(), "1", "the fixture memo fits one page");
      // A memo that spills a few lines onto page 2 is reported.
      const long = join(dir, "long.md");
      writeFileSync(long, readFileSync(join(fixtures, "memo-en.md"), "utf8") + "\nThe new arrangement applies to contractors' vans as well; their drivers receive the same parking code with their work order and wait at the east entrance.\n\nWe will post the new signs in the week before 1 November and remove the old visitor signs from the front row on the same day.\n");
      const spill = convert(dir, long, ["--tonality", "Memo"]);
      const two = qa(dir, spill.out, long, ["--layout", "--tonality", "Memo"]);
      assert.ok(checksOf(two.report).includes("FAIL:memo.fit"), JSON.stringify(checksOf(two.report)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R10: under a publisher profile the paragraph after a table, a table caption and a figure caption stand 8 pt clear of the text", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "fig.png"), tinyPng(60, 30));
      const src = join(dir, "m.md");
      writeFileSync(src, "---\ntitle: Conversion of a supported catalyst\nauthor: Example Author A\n---\n\n# Results\n\nThe proposed catalyst converts more feed than the baseline at every temperature.\n\nTable 1. Conversion at 60 min (example values)\n\n| Inlet (°C) | Baseline | Proposed |\n| ---: | ---: | ---: |\n| 180 | 41 | 63 |\n| 200 | 50 | 75 |\n\nAcross all three temperatures the proposed catalyst converts more feed by 60 min.\n\n![Figure 1. Conversion over time (synthetic)](fig.png)\n\nThe shape of the two curves differs as well as their height.\n");
      for (const publisher of ["elsevier", "acs"]) {
        const c = convert(dir, src, ["--publisher", publisher]);
        assert.equal(c.status, 0, c.stderr);
        const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
        assert.ok(before(pPr(xml, "Across all three")) >= 160, `${publisher}: the paragraph after the table: ${pPr(xml, "Across all three")}`);
        const caption = xml.slice(0, xml.indexOf("Conversion at"));
        assert.ok(before(caption.slice(caption.lastIndexOf("<w:pPr>"))) >= 160, `${publisher}: the table caption after text`);
        const cap = xml.slice(0, xml.indexOf("Conversion over time (synthetic)"));
        assert.ok(after(cap.slice(cap.lastIndexOf("<w:pPr>"))) >= 160, `${publisher}: the figure caption keeps 8 pt under it`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Fix round 3 (docx-spec Amendments 6) ──
  const keepNext = (ppr) => /<w:keepNext\/>/u.test(ppr);

  it("D1: a list of up to six items keeps together with its lead-in, and a heading keeps its lead sentence with the table they open", () => {
    const dir = work();
    try {
      const src = join(dir, "d1.md");
      writeFileSync(src, "---\ntitle: 자동 분류 설비 운영 결과\nnotice: \"예시 데이터: 수치는 가정입니다\"\n---\n\n# 결론과 다음 단계\n\n자동 분류 설비는 처리량과 정확도에서 기대한 효과를 냈다.\n\n다음 단계는 아래와 같다.\n\n1. 2026년 11월: 투입부 개조 예산 승인\n2. 2027년 1월: 주말 두 차례에 걸쳐 개조 공사\n3. 2027년 2월: 야간 정비 인력 1명 추가 배치\n4. 2027년 3월: 개조 효과 확인 뒤 상세 설계 착수\n\n이 보고서의 모든 수치는 예시다.\n\n# 시나리오 비교\n\n세 시나리오의 투자비와 회수 기간을 비교했다.\n\n표 1. 확대 시나리오 비교 (예시)\n\n| 시나리오 | 투자비 (억 원) | 회수 기간 (년) |\n| --- | ---: | ---: |\n| A. 현재 설비 | 11.8 | 6.2 |\n| B. 전용 투입구 | 12.9 | 5.0 |\n\n자료: 예시 추정\n");
      const c = convert(dir, src, ["--tonality", "Report"]);
      assert.equal(c.status, 0, c.stderr);
      const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      assert.ok(keepNext(pPr(xml, "다음 단계는 아래와 같다.")), "the lead-in keeps with its list");
      for (const item of ["2026년 11월", "2027년 1월", "2027년 2월"]) assert.ok(keepNext(pPr(xml, item)), `${item} keeps with the next item`);
      assert.ok(!keepNext(pPr(xml, "2027년 3월")), "the last item ends the chain");
      assert.ok(keepNext(pPr(xml, "세 시나리오의 투자비와")), "the heading's lead sentence keeps with the table it opens");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D1/D2/D4: the page checks find a split short list, a heading apart from its table, a near-empty second page and a lone last paragraph", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "pages.py"), `import sys, json
sys.path.insert(0, sys.argv[1])
import docx_layout as L
frame = {"page_h": 841.9, "top": 70.0, "bottom": 70.0}
def page(lines, bottom):
    ink = [(y0, y1) for y0, y1, _ in lines] + [(70.0, bottom)]
    return {"h": 841.9, "lines": lines, "ink": ink, "images": 0, "boxes": [(72.0, y0, 300.0, y1, t) for y0, y1, t in lines], "filled": 0.0}
blocks = [{"t": "h", "level": 1, "text": "결론", "raw": "결론"}, {"t": "p", "text": "다음단계는아래와같다", "list": False},
          {"t": "p", "text": "첫째항목입니다", "list": True}, {"t": "p", "text": "둘째항목입니다", "list": True}, {"t": "p", "text": "셋째항목입니다", "list": True},
          {"t": "h", "level": 1, "text": "비교", "raw": "비교"}, {"t": "p", "text": "세시나리오를비교했다", "list": False},
          {"t": "tbl", "rows": ["시나리오투자비", "A현재설비"], "component": None, "cells": []}]
info = {"blocks": blocks, "components": {k: 0 for k in L.KINDS}, "cover": False, "memo": False, "frame": frame}
p1 = page([(80, 92, "결론"), (100, 112, "다음단계는아래와같다"), (700, 712, "첫째항목입니다")], 712)
p2 = page([(80, 92, "둘째항목입니다"), (100, 112, "셋째항목입니다"), (740, 752, "비교"), (760, 770, "세시나리오를비교했다")], 770)
p3 = page([(80, 90, "시나리오투자비"), (95, 105, "A현재설비")], 105)
found, _ = L.paged(info, [p1, p2, p3], True, {})
print(json.dumps(sorted({f["check"] for f in found})))
lone = page([(80, 92, "끝")], 92)
found, _ = L.paged({**info, "blocks": blocks[:1]}, [p1, p1, lone], True, {})
print(json.dumps(sorted({f["check"] for f in found})))
# The table belongs to the heading right above it: a section that ends a page is not apart from the next one's table.
gap = blocks[:2] + [{"t": "h", "level": 1, "text": "예산", "raw": "예산"}] + blocks[6:]
full = page([(80, 92, "결론"), (100, 112, "다음단계는아래와같다")] + [(130 + 20 * i, 142 + 20 * i, f"본문{i}줄") for i in range(30)], 742)
nextp = page([(80, 92, "예산"), (100, 112, "세시나리오를비교했다"), (130, 140, "시나리오투자비"), (145, 155, "A현재설비")], 155)
found, _ = L.paged({**info, "blocks": gap}, [full, nextp], True, {})
print(json.dumps(sorted({f["check"] for f in found})))
`);
      const run = spawnSync(runtimePython, ["-B", join(dir, "pages.py"), join(docxRoot, "scripts")], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const [first, second, third] = run.stdout.trim().split("\n").map((l) => JSON.parse(l));
      for (const check of ["list.split", "heading.apart", "page.spill"]) assert.ok(first.includes(check), `${check}: ${JSON.stringify(first)}`);
      assert.ok(second.includes("page.spill"), JSON.stringify(second));
      assert.ok(!third.includes("heading.apart"), `a heading between the lead and the table owns the table: ${JSON.stringify(third)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D2: a source of about a page is set tight in any tonality and stays on one page; a section after a ruled box draws no second rule", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const dir = work();
    try {
      const src = join(dir, "brief.md");
      writeFileSync(src, readFileSync(join(fixtures, "memo-en.md"), "utf8")
        .replace("3. Meet your visitor at the east entrance. Reception will still print badges, but visitors will reach reception through the east corridor.", "3. Meet your visitor at the east entrance; reception still prints badges.")
        .replace("Visitors with a blue badge keep using the four accessible bays beside reception. Nothing changes for them.", "Visitors with a blue badge keep the four accessible bays beside reception.")
        .replace(/Ask the facilities desk on extension 4410 \(example\)[^\n]*/u, "Ask the facilities desk on extension 4410 (example). We will review the arrangement at the end of January."));
      const c = convert(dir, src, ["--tonality", "Brief"]);
      assert.equal(c.status, 0, c.stderr);
      assert.match(c.stdout, /tight spacing/u);
      const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      assert.match(pPr(xml, "What you need to do"), /<w:top w:val="nil"\/>/u, "no hairline over the section right under the Fire lane box");
      const g = qa(dir, c.out, src, ["--layout", "--tonality", "Brief"]);
      assert.ok(!checksOf(g.report).some((x) => x.endsWith("page.spill")), JSON.stringify(checksOf(g.report)));
      const pdf = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, c.out], { cwd: dir, encoding: "utf8" });
      assert.equal(pdf.status, 0, pdf.stderr);
      const pages = spawnSync(runtimePython, ["-B", "-c", "import sys, pymupdf; print(len(pymupdf.open(sys.argv[1])))", c.out.replace(/\.docx$/u, ".pdf")], { encoding: "utf8" });
      assert.equal(pages.stdout.trim(), "1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D3/D4: a wrapping text column takes room from columns that have it, negatives read with the minus sign, and an uncaptioned table stands clear of the sentence above it", () => {
    const dir = work();
    try {
      const src = join(dir, "t.md");
      writeFileSync(src, "---\ntitle: 지점별 주간 방문\nnotice: \"예시 데이터: 수치는 가정입니다\"\n---\n\n# 지점별 방문\n\n지점마다 방문과 변화를 적었다.\n\n| Branch | Visits | Change | Share |\n| --- | ---: | ---: | ---: |\n| Harbour Road | 1,240 | -3 | 21% |\n| North Gate Library | 980 | -12 | 17% |\n| Old Mill | 2,105 | 8 | 36% |\n\n자료: 예시 집계\n");
      const d = built(dir, src, ["--tonality", "Report"]);
      const xml = spawnSync("unzip", ["-p", d.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/gu)].map((m) => Number(m[1]) / 20);
      assert.ok(grid[0] >= 95, `the branch column holds "North Gate Library" or most of it: ${JSON.stringify(grid)}`);
      assert.match(xml, /−3</u, "a negative takes U+2212");
      assert.match(xml, /−12</u);
      assert.doesNotMatch(xml, />-3</u);
      assert.ok(after(pPr(xml, "지점마다 방문과 변화를 적었다.")) >= 120, "the sentence above an uncaptioned table keeps 6 pt under it");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D4: under a publisher profile a paragraph after a list stands 6 pt clear and the paragraph after a table three quarters of a line", () => {
    const dir = work();
    try {
      const src = join(dir, "p.md");
      writeFileSync(src, "---\ntitle: A five-line reporting template\nauthor: Example Author A\n---\n\n# Results\n\nWe propose that every short benchmark report states five lines.\n\n1. Conversion at the end of the run.\n2. Half-conversion time.\n3. Peak heat release.\n\nLines 3 and 4 together let a reader compute the margin.\n\nTable 1. Margin (example)\n\n| Inlet (°C) | Margin (kW) |\n| ---: | ---: |\n| 180 | 0.88 |\n| 220 | -0.07 |\n\nThe negative margin at 220 °C does not make the catalyst unusable.\n");
      for (const publisher of ["elsevier", "acs"]) {
        const c = convert(dir, src, ["--publisher", publisher]);
        assert.equal(c.status, 0, c.stderr);
        const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
        assert.ok(before(pPr(xml, "Lines 3 and 4")) >= 120, `${publisher}: after the list ${pPr(xml, "Lines 3 and 4")}`);
        assert.ok(before(pPr(xml, "The negative margin")) >= 180, `${publisher}: after the table ${pPr(xml, "The negative margin")}`);
        assert.ok(keepNext(pPr(xml, "Conversion at the end")) && keepNext(pPr(xml, "Half-conversion time")), `${publisher}: a short list keeps together`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D6: the gate fails a notice that joins its label and line with a spaced dash", () => {
    const dir = work();
    try {
      const src = join(dir, "n.md");
      writeFileSync(src, "---\ntitle: 운영 메모\ntonality: Memo\nnotice: 예시 안내문 — 일정은 가정입니다\n---\n\n# 일정\n\n다음 주 월요일부터 바뀐다.\n");
      const c = convert(dir, src, ["--tonality", "Memo"]);
      assert.equal(c.status, 0, c.stderr);
      assert.ok(checksOf(qa(dir, c.out, src).report).includes("FAIL:notice.dash"), JSON.stringify(checksOf(qa(dir, c.out, src).report)));
      writeFileSync(src, "---\ntitle: 운영 메모\ntonality: Memo\nnotice: \"예시 안내문: 일정은 가정입니다\"\n---\n\n# 일정\n\n다음 주 월요일부터 바뀐다.\n");
      const ok = convert(dir, src, ["--tonality", "Memo"]);
      assert.ok(!checksOf(qa(dir, ok.out, src).report).includes("FAIL:notice.dash"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Fix round 4 (docx-spec Amendments 7) ──
  it("J1: in a two-column body a page-wide table carries its source line, a list splits only between its first and last two items, and the last page balances its columns", () => {
    const dir = work();
    try {
      const src = join(dir, "j.md");
      writeFileSync(src, "---\ntitle: Conversion of a supported catalyst\nauthor: Example Author A\nnotice: \"Synthetic example: data are placeholders\"\n---\n\n# Methods\n\nWe ran each condition three times.\n\nTable 1. Runs by inlet temperature (example values)\n\n| Inlet (°C) | Catalyst | Conversion (%) | Peak (kW) |\n| ---: | --- | ---: | ---: |\n| 180 | Baseline | 41 | 0.92 |\n| 200 | Proposed | 75 | 1.43 |\n\nSource: synthetic data, three repeats\n\n## Run protocol\n\nEach run starts from a cold, purged loop.\n\nWe propose that every report states five lines:\n\n1. Conversion at the end of the run.\n2. Half-conversion time.\n3. Peak heat release.\n4. Cooling capacity of the loop.\n5. Number of repeats.\n\nLines 3 and 4 together give the margin.\n");
      const c = convert(dir, src, ["--tonality", "Journal"]);
      assert.equal(c.status, 0, c.stderr);
      const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      const table = xml.indexOf("Runs by inlet temperature");
      const resume = xml.indexOf('w:num="1"', table);
      assert.ok(table > 0 && resume > 0 && xml.indexOf(">Source: synthetic data") < resume, "the source line stands under the page-wide table, before the column section resumes");
      assert.ok(keepNext(pPr(xml, "We propose that every report")), "the lead-in keeps with the list");
      for (const item of ["Conversion at the end", "Cooling capacity of the loop"]) assert.ok(keepNext(pPr(xml, item)), `${item} keeps with the next item`);
      for (const item of ["Half-conversion time", "Peak heat release"]) assert.ok(!keepNext(pPr(xml, item)), `a column list may break after ${item}`);
      // The column section ends with a continuous break, so its last page sets both columns to an even depth.
      const sects = [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/gu)];
      const last = sects[sects.length - 1], before = sects[sects.length - 2];
      assert.doesNotMatch(last[0], /w:num="2"/u, `the document closes on a one-column section: ${last[0]}`);
      assert.match(before[0], /w:num="2"/u);
      assert.ok(before.index > xml.indexOf("Lines 3 and 4 together"), "the column section holds the last paragraph");
      // LibreOffice gave up balancing when widow control held a short closing paragraph whole.
      assert.match(pPr(xml, "Lines 3 and 4 together"), /<w:widowControl w:val="0"\/>/u, "the last paragraph may break across the balanced columns");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("J2: a closing section of a few lines and a short list keeps whole, so its paragraph travels with the list", () => {
    const dir = work();
    try {
      const src = join(dir, "j2.md");
      const tail = "# 결론과 다음 단계\n\n자동 분류 설비는 처리량과 정확도에서 기대한 효과를 냈다. 비용 회수가 늦어진 원인은 설비 자체가 아니라 투입부 설계와 야간 운영에 있었고, 두 가지 모두 고칠 수 있다.\n\n다음 단계는 아래와 같다.\n\n1. 2026년 11월: 투입부 개조 예산 승인\n2. 2027년 1월: 개조 공사\n3. 2027년 2월: 야간 정비 인력 추가 배치\n\n이 보고서의 모든 수치는 예시다.\n";
      writeFileSync(src, `---\ntitle: 자동 분류 설비 운영 결과\nnotice: "예시 데이터: 수치는 가정입니다"\n---\n\n# 배경\n\n자동 분류 설비를 제2물류센터에서 1년 운영했고, 처리량과 정확도, 비용 회수를 분기마다 기록해 계획과 비교했다.\n\n${tail}`);
      const c = convert(dir, src, ["--tonality", "Report"]);
      assert.equal(c.status, 0, c.stderr);
      const xml = spawnSync("unzip", ["-p", c.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      assert.ok(keepNext(pPr(xml, "자동 분류 설비는 처리량과")), "the closing section's first paragraph keeps with the list");
      assert.ok(!keepNext(pPr(xml, "자동 분류 설비를 제2물류센터에서")), "an earlier section is untouched");
      // A closing section with a table is not short: it keeps only what D1 keeps.
      writeFileSync(src, `---\ntitle: 자동 분류 설비 운영 결과\nnotice: "예시 데이터: 수치는 가정입니다"\n---\n\n# 배경\n\n자동 분류 설비를 제2물류센터에서 1년 운영했고, 처리량과 정확도, 비용 회수를 분기마다 기록해 계획과 비교했다.\n\n${tail}\n| 단계 | 시기 |\n| --- | --- |\n| 승인 | 11월 |\n`);
      const t = convert(dir, src, ["--tonality", "Report"]);
      const xml2 = spawnSync("unzip", ["-p", t.out, "word/document.xml"], { encoding: "utf8" }).stdout;
      assert.ok(!keepNext(pPr(xml2, "자동 분류 설비는 처리량과")), "a closing section with a table moves no paragraph");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("J1: the page checks find a heading at the foot of a column and a last page whose columns do not balance", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "cols.py"), `import sys, json
sys.path.insert(0, sys.argv[1])
import docx_layout as L
frame = {"page_h": 841.9, "top": 70.0, "bottom": 70.0}
def page(lines):
    # lines: (x0, y0, y1, text); a column line is 230 pt wide
    return {"h": 841.9, "w": 595.3, "lines": sorted((y0, y1, t) for _, y0, y1, t in lines), "ink": [(y0, y1) for _, y0, y1, _ in lines],
            "images": 0, "boxes": [(x0, y0, x0 + 230.0, y1, t) for x0, y0, y1, t in lines], "filled": 0.0}
def col(x, y0, y1, tag):
    return [(x, y, y + 11, f"{tag}{k}줄") for k, y in enumerate(range(int(y0), int(y1), 14))]
def blocks(*items):
    return [{"t": t, "level": 1, "text": x, "raw": x, "list": lst, "cols": 2} if t == "h" else {"t": t, "text": x, "list": lst, "cols": 2} for t, x, lst in items]
info = lambda b: {"blocks": b, "components": {k: 0 for k in L.KINDS}, "cover": False, "memo": False, "frame": frame}
checks = lambda found: sorted({f["check"] for f in found})
# 1: a heading stands alone at the foot of the right column; its paragraph opens the next page.
b = blocks(("h", "서론", False), ("p", "왼쪽0줄", False), ("h", "방법", False), ("p", "다음0줄", False))
p1 = page([(70, 80, 92, "서론")] + col(70, 100, 760, "왼쪽") + col(310, 80, 740, "오른쪽") + [(310, 750, 762, "방법")])
p2 = page(col(70, 80, 400, "다음") + col(310, 80, 390, "끝"))
print(json.dumps(checks(L.paged(info(b), [p1, p2], True, {})[0])))
# 2: the last page sets one column and leaves the other empty.
b = blocks(("h", "서론", False), ("p", "왼쪽0줄", False))
p2 = page(col(70, 80, 500, "다음"))
print(json.dumps(checks(L.paged(info(b), [p1, p2], True, {})[0])))
# 3: a balanced last page, and a column list split two and two, pass.
b = blocks(("h", "서론", False), ("p", "왼쪽0줄", False), ("p", "가항목", True), ("p", "나항목", True), ("p", "다항목", True), ("p", "라항목", True), ("p", "마항목", True))
p1 = page([(70, 80, 92, "서론")] + col(70, 100, 730, "왼쪽") + [(70, 740, 751, "가항목"), (70, 754, 765, "나항목")] + col(310, 80, 765, "오른쪽"))
p2 = page([(70, 80, 91, "다항목"), (70, 94, 105, "라항목"), (70, 108, 119, "마항목")] + col(70, 124, 420, "다음") + col(310, 80, 420, "끝"))
print(json.dumps(checks(L.paged(info(b), [p1, p2], True, {})[0])))
# 4: a column that stops a quarter short of the foot while the next one runs to it.
p1 = page([(70, 80, 92, "서론")] + col(70, 100, 520, "왼쪽") + col(310, 80, 765, "오른쪽"))
print(json.dumps(checks(L.paged(info(b[:2]), [p1, p2], True, {})[0])))
`);
      const run = spawnSync(runtimePython, ["-B", join(dir, "cols.py"), join(docxRoot, "scripts")], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const [foot, lone, even, hole] = run.stdout.trim().split("\n").map((l) => JSON.parse(l));
      assert.ok(foot.includes("heading.column"), JSON.stringify(foot));
      assert.ok(lone.includes("columns.balance"), JSON.stringify(lone));
      assert.ok(!even.includes("columns.balance") && !even.includes("list.split") && !even.includes("heading.column"), JSON.stringify(even));
      assert.ok(hole.includes("columns.balance"), JSON.stringify(hole));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every worked example in the reference library converts under its tonality and passes the gate with its pages checked", { skip: soffice ? false : "soffice not on PATH" }, () => {
    const dir = work();
    try {
      const examples = readdirSync(join(docxRoot, "references", "examples")).filter((f) => f.endsWith(".md")).sort();
      assert.ok(examples.length >= 8, `${examples.length} examples`);
      const tonalities = new Set();
      for (const name of examples) {
        const source = join(docxRoot, "references", "examples", name);
        const tonality = /^tonality:\s*(\S+)/mu.exec(readFileSync(source, "utf8"))[1].toLowerCase();
        tonalities.add(tonality);
        const out = join(dir, name.replace(/\.md$/u, ".docx"));
        const c = spawnSync("python3", [join(docxRoot, "scripts", "convert_md_to_docx.py"), source, out], { cwd: dir, encoding: "utf8" });
        assert.equal(c.status, 0, `${name}: ${c.stderr}`);
        const g = qa(dir, out, source, ["--layout"]);
        assert.equal(g.status, 0, `${name}: ${JSON.stringify(g.report.failure_reasons)} ${JSON.stringify(g.report.output?.findings)}`);
        assert.ok(g.report.output.rendered, `${name}: pages not checked (${g.report.output.render})`);
      }
      assert.deepEqual([...tonalities].sort(), ["brief", "journal", "manual", "memo", "proposal", "report"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
