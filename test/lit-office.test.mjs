import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
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
      // A deck shows the notice as a tag on every slide; a document prints it once (docx-spec Amendments 4, A4.7).
      assert.match(body, id === "lit-docx" ? /printed once/u : /coloured tag/u, `${id} explains the visible notice`);
      // The A/B tasks are one-line requests; their wording must not be taught to the skill.
      for (const phrase of ["분기 실적 발표자료", "신제품 기획서", "sources 폴더", "보고서랑 발표자료"]) {
        assert.equal(body.includes(phrase), false, `${id} contains A/B task wording: ${phrase}`);
      }
    }
    assert.match(pptx, /card is as tall as its text/u);
  });

  it("lit-pptx chooses a direction before building, and its reference library covers every tonality, treatment and family", () => {
    const body = readFileSync(join(pptxRoot, "SKILL.md"), "utf8");
    const procedure = body.slice(body.indexOf("## #contract.procedure"), body.indexOf("### 정/반/합"));
    // Step two is the direction card, written before the outline and the source.
    assert.ok(procedure.indexOf("**Choose the direction first: the direction card.**") < procedure.indexOf("**Outline before prose.**"));
    for (const field of ["deck type, reader, tonality and the two alternatives", "one-sentence reason tied to the audience and the signals that fired",
      "the dials (density and variance", "the treatments by slide role", "one family per slide", "**what would make this direction wrong**"]) {
      assert.ok(procedure.includes(field), `direction card field: ${field}`);
    }
    for (const type of ["Pitch", "Business review", "Research talk", "Lecture or teaching", "Data-heavy review", "Image-led", "Korean text briefing", "Status update"]) {
      assert.match(procedure, new RegExp(`^   \\| ${type}[^|]*\\| [A-Z][a-z]+ \\(\\d+, \\d+\\)`, "mu"), `selection row for ${type}`);
    }
    assert.match(procedure, /\*\*Compare strip\.\*\*/u);
    assert.match(procedure, /there is no silent default look/u);
    assert.match(body, /\| compare \| The user asks to see options/u);
    assert.doesNotMatch(body, /AZURE-PRO[^|\n]*by default|AZURE-PRO` \(default\)|AZURE-PRO with Pretendard, no questions/u);
    const refs = join(pptxRoot, "references");
    const treatments = ["top-rule", "top-plain-large", "side-rail", "band", "statement", "overlay", "kicker-numeral", "bottom-anchor"];
    const titleRef = readFileSync(join(refs, "title-treatments.md"), "utf8");
    for (const t of treatments) assert.ok(titleRef.includes(`| \`${t}\` |`), `title-treatments.md row for ${t}`);
    const { FAMILIES, VARIANTS } = createRequire(import.meta.url)(join(pptxRoot, "scripts", "lib", "grid-resolver.js"));
    const familyRef = readFileSync(join(refs, "layout-families.md"), "utf8");
    for (const id of [...Object.keys(FAMILIES), ...Object.values(VARIANTS).flat()]) assert.ok(familyRef.includes(`| \`${id}\` |`), `layout-families.md row for ${id}`);
    const fill = readFileSync(join(refs, "density-and-fill.md"), "utf8");
    for (const policy of ["step-up", "distribute", "anchor-visual", "change-family", "OF-112", "A closing carries the ask and the next step", "Every table gets a takeaway", "Every content slide carries its supporting facts", "The title names the topic; the claim opens the body", "Numbers are never the whole slide"]) {
      assert.ok(fill.includes(policy), `density-and-fill.md: ${policy}`);
    }
    assert.match(readFileSync(join(refs, "direction-step.md"), "utf8"), /## 6\. The compare strip/u);
    for (const id of ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"]) {
      const sheet = readFileSync(join(refs, "tonalities", `${id}.md`), "utf8");
      for (const section of ["## When to use it", "## When it is the wrong choice", "## Tokens", "## Treatments by slide role", "## Families and variants", "## Do", "## Avoid", "## Two worked slides", "## Examples"]) {
        assert.ok(sheet.includes(`\n${section}\n`), `${id}.md: ${section}`);
      }
      // The token table is read from the pack, so the pack's accent appears in it.
      const accent = readFileSync(join(pptxRoot, "templates", "tonalities", id, "pack.yaml"), "utf8").match(/^  accent: "(#[0-9A-F]{6})"/mu)[1];
      assert.ok(sheet.includes(accent), `${id}.md names its accent ${accent}`);
      assert.ok((sheet.match(/```markdown\n/gu) || []).length >= 2, `${id}.md has two worked slide sources`);
      assert.ok(sheet.split(/\s+/u).length >= 550, `${id}.md is a full sheet`);
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
    assert.match(bare, /tonality its direction step picks/u);
    assert.match(bare, /two alternatives \(there is no silent default look\)/u);
    assert.doesNotMatch(bare, /AZURE-PRO/u);
    assert.doesNotMatch(bare, /Soft-confirm/u);
    assert.match(bare, /never become \[blanks\]/u);
    assert.match(bare, /label it as an example or assumption/u);
    const explicit = hookContext("lit-pptx 신규 입사자 온보딩 덱");
    assert.ok(explicit.includes(join(pptxRoot, "SKILL.md")));
    assert.match(explicit, /Style gate:/u);
    assert.match(explicit, /the tonality the direction step chose \(with its reason\) as the first option, its two alternatives and a compare option/u);
    // A document takes a direction too: no default profile under bare lit, the same style gate for a token.
    assert.match(bare, /a document likewise takes the tonality its direction step picks/u);
    assert.doesNotMatch(bare, /korean-generic when the text is Korean/u);
    assert.match(hookContext("lit-docx 신규 입사자 안내 문서"), /for a document, the same: the tonality its direction step chose/u);
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

  const registry = join(pptxRoot, "scripts", "lib", "template-registry.js");
  const registryProbe = (body, env = {}) => spawnSync(process.execPath, ["-e", `const r = require(${JSON.stringify(registry)});\n${body}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

  it("an unknown tonality, treatment or family is a clear error that lists what exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-tonality-"));
    try {
      const flag = compile([join(fixtures, "deck-tonality.md"), "--tonality", "nope", "--pptx", join(dir, "d.pptx")], dir);
      assert.equal(flag.status, 1);
      assert.match(flag.stderr, /Unknown tonality "nope"/u);
      assert.match(flag.stderr, /ledger/u);
      writeFileSync(join(dir, "fm.md"), readFileSync(join(fixtures, "deck-tonality.md"), "utf8").replace("tonality: ledger", "tonality: wobble"));
      const fm = compile([join(dir, "fm.md"), "--pptx", join(dir, "d.pptx")], dir);
      assert.equal(fm.status, 1);
      assert.match(fm.stderr, /Unknown tonality "wobble"/u);
      const swap = (from, to) => {
        writeFileSync(join(dir, "s.md"), readFileSync(join(fixtures, "deck-tonality.md"), "utf8").replace(from, to));
        return compile([join(dir, "s.md"), "--pptx", join(dir, "d.pptx")], dir);
      };
      const treatment = swap("layout: kpi-row\n", "layout: kpi-row\ntitle: wobble\n");
      assert.equal(treatment.status, 1);
      assert.match(treatment.stderr, /unknown title treatment "wobble"/u);
      assert.match(treatment.stderr, /top-rule/u);
      const outside = swap("layout: kpi-row\n", "layout: kpi-row\ntitle: band\n");
      assert.equal(outside.status, 1);
      assert.match(outside.stderr, /"band" is not one of the ledger treatments \(top-rule, side-rail, kicker-numeral, bottom-anchor\)/u);
      const family = swap("layout: agenda\n", "layout: wobble-grid\n");
      assert.equal(family.status, 1);
      assert.match(family.stderr, /layout "wobble-grid" is neither a layout family nor a legacy layout/u);
      assert.match(family.stderr, /kpi-row/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the tonality packs next to the legacy templates, which load as packs with their own look", () => {
    const listed = compile(["--list-tonalities"], root);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /^ledger — /mu);
    for (const name of ["AZURE-PRO", "AZURE-A2Z", "BOILERPLATE-PRETENDARD", "BOILERPLATE-A2Z"]) {
      assert.match(listed.stdout, new RegExp(`^${name} \\(legacy template\\)`, "mu"));
    }
    const probe = registryProbe(`
      const ledger = r.loadPack("ledger");
      const legacy = Object.fromEntries(r.listTemplates().map((n) => [n, r.loadTemplate(n).pack]));
      console.log(JSON.stringify({ ledger: { id: ledger.id, treatments: ledger.treatments, density: ledger.density, accent: ledger.palette.accent },
        legacy: Object.fromEntries(Object.entries(legacy).map(([n, p]) => [n, { legacy: p.legacy, treatments: p.treatments, caps: p.capabilities, pad: p.tokens.card.pad, kpi: p.tokens.kpi.minCardWidth }])) }));`);
    assert.equal(probe.status, 0, probe.stderr);
    const out = JSON.parse(probe.stdout);
    assert.deepEqual(out.ledger, { id: "ledger", treatments: ["top-rule", "side-rail", "kicker-numeral", "bottom-anchor"], density: 10, accent: "#0E6B5A" });
    assert.deepEqual(out.legacy["AZURE-PRO"], { legacy: true, treatments: ["top-rule"], caps: ["rich-blocks", "recolor", "font-swap", "mesh-background"], pad: 0.3, kpi: 1.9 });
    assert.deepEqual(out.legacy["BOILERPLATE-PRETENDARD"].caps, []);
  });

  const TONALITIES = ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"];
  const packOf = (id) => JSON.parse(registryProbe(`console.log(JSON.stringify(r.loadPack(${JSON.stringify(id)})))`).stdout);

  it("lists eight tonalities, and each tonality's families with the titles they take there and its variants", () => {
    const listed = compile(["--list-tonalities"], root);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual([...listed.stdout.matchAll(/^([a-z]+) — /gmu)].map((m) => m[1]), TONALITIES);
    for (const id of TONALITIES) {
      const pack = packOf(id);
      const layouts = compile(["--list-layouts", id], root);
      assert.equal(layouts.status, 0, layouts.stderr);
      for (const family of pack["layout-families"]) assert.match(layouts.stdout, new RegExp(`^  ${family} \\[[a-z, -]+\\]$`, "mu"), `${id} ${family}`);
      for (const key of ["covers", "sections", "closings"]) {
        assert.ok(pack[key].length >= (key === "covers" ? 3 : 2), `${id} ${key}`);
        assert.match(layouts.stdout, new RegExp(`^${key}: ${pack[key].join(", ")}$`, "mu"));
      }
    }
    const unknown = compile(["--list-layouts", "wobble"], root);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown tonality or template "wobble"\. Tonalities: atlas, chalk/u);
  });

  it("no two tonalities share both their title treatments and their layout families", () => {
    const packs = TONALITIES.map(packOf);
    const key = (p) => `${[...p.treatments].sort()}|${[...p["layout-families"]].sort()}`;
    for (let i = 0; i < packs.length; i++) {
      for (let j = i + 1; j < packs.length; j++) {
        assert.notEqual(key(packs[i]), key(packs[j]), `${packs[i].id} and ${packs[j].id}`);
      }
    }
  });

  it("an unsupported combination says what the tonality allows instead of falling back silently", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-combo-"));
    try {
      const source = readFileSync(join(fixtures, "deck-tonality.md"), "utf8");
      const run = (edit, tonality) => {
        writeFileSync(join(dir, "c.md"), edit(source).replace("tonality: ledger", `tonality: ${tonality}`));
        return compile([join(dir, "c.md"), "--pptx", join(dir, "c.pptx")], dir);
      };
      // A title the family cannot take.
      const overlay = run((s) => s.replace("layout: kpi-row\n", "layout: kpi-row\ntitle: overlay\n"), "atlas");
      assert.equal(overlay.status, 1);
      assert.match(overlay.stderr, /the kpi-row family does not take "overlay"; it allows top-rule, band, top-plain-large, side-rail, bottom-anchor/u);
      // A full-bleed image family with no image to bleed.
      const bare = run((s) => s.replace("layout: text-column\n", "layout: image-full\n"), "atlas");
      assert.equal(bare.status, 1);
      assert.match(bare.stderr, /no atlas treatment \(overlay, bottom-anchor, side-rail, top-plain-large, statement\) fits the image-full family \(overlay\)/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a pack with a missing role, an out-of-range dial or a body colour below 4.5:1", () => {
    const dir = mkdtempSync(join(tmpdir(), "lit-office-pack-"));
    try {
      const source = readFileSync(join(pptxRoot, "templates", "tonalities", "ledger", "pack.yaml"), "utf8");
      const plant = (id, edit) => {
        mkdirSync(join(dir, id), { recursive: true });
        writeFileSync(join(dir, id, "pack.yaml"), edit(source.replace("id: ledger", `id: ${id}`)));
      };
      plant("no-ink", (s) => s.replace(/^ {2}ink: .*\n/mu, ""));
      plant("dense-eleven", (s) => s.replace(/^density: \d+$/mu, "density: 11"));
      // The default faces are Pretendard; an A2Z face belongs in faces-a2z (spec-v2 Amendments 5).
      plant("a2z-default", (s) => s.replace(/^faces:\n {2}display: Pretendard Bold$/mu, "faces:\n  display: A2Z Bold"));
      plant("grey-ink", (s) => s.replace(/^ {2}ink: .*$/mu, '  ink: "#B0B0B0"'));
      const load = (id) => registryProbe(`try { r.loadPack(${JSON.stringify(id)}); console.log("loaded"); } catch (e) { console.log(e.message); }`,
        { LIT_PPTX_TONALITY_DIRS: dir }).stdout;
      assert.match(load("no-ink"), /palette\.ink is missing/u);
      assert.match(load("dense-eleven"), /density must be an integer 1-10/u);
      assert.match(load("a2z-default"), /faces\.display must name a bundled face \(Pretendard Regular or Bold\)/u);
      assert.match(load("grey-ink"), /ink on ground is [\d.]+:1, below 4\.5:1/u);
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

  // Shapes of every slide as points: name, box, solid fill, first run colour and size.
  const shapesOf = (pptx) => {
    const probe = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from pptx import Presentation
p = Presentation(sys.argv[1])
def colour(sh):
    try:
        for para in sh.text_frame.paragraphs:
            for r in para.runs:
                if r.text.strip():
                    return str(r.font.color.rgb) if r.font.color and r.font.color.type is not None else None
    except Exception:
        return None
def fill(sh):
    try:
        return str(sh.fill.fore_color.rgb) if sh.fill.type == 1 else None
    except Exception:
        return None
out = []
for s in p.slides:
    out.append([{"name": sh.name, "x": sh.left / 12700, "y": sh.top / 12700, "w": sh.width / 12700, "h": sh.height / 12700,
                 "text": sh.text_frame.text if sh.has_text_frame else "", "fill": fill(sh),
                 "colour": colour(sh) if sh.has_text_frame else None,
                 "chart": bool(getattr(sh, "has_chart", False) and sh.has_chart),
                 "table": bool(getattr(sh, "has_table", False) and sh.has_table),
                 "picture": sh.shape_type == 13} for sh in s.shapes])
print(json.dumps({"slides": out, "subject": p.core_properties.subject}))
`, pptx], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    return JSON.parse(probe.stdout);
  };
  const tonalityDeck = (dir, extra = [], env = {}, source = join(fixtures, "deck-tonality.md")) => spawnSync(process.execPath, [
    join(pptxRoot, "scripts", "compile-deck.js"), source, "--pptx", join(dir, "deck.pptx"), ...extra,
  ], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });

  it("a tonality pack changes palette, title treatment and gaps without a code edit", () => {
    const dir = work();
    try {
      // The kpi row is pinned to the top-rule title, so the pinned title survives the fill-driven choice.
      const pinned = join(dir, "pinned.md");
      writeFileSync(pinned, readFileSync(join(fixtures, "deck-tonality.md"), "utf8").replace("layout: kpi-row\n", "layout: kpi-row\ntitle: top-rule\n"));
      const ledger = tonalityDeck(dir, [], {}, pinned);
      assert.equal(ledger.status, 0, ledger.stderr + ledger.stdout);
      const a = shapesOf(join(dir, "deck.pptx"));
      // A second pack, written as data only: another accent, a band title on text slides, a lower density.
      const packs = join(dir, "packs");
      mkdirSync(join(packs, "variant-test"), { recursive: true });
      const source = readFileSync(join(pptxRoot, "templates", "tonalities", "ledger", "pack.yaml"), "utf8");
      writeFileSync(join(packs, "variant-test", "pack.yaml"), source
        .replace("id: ledger", "id: variant-test")
        .replaceAll("#0E6B5A", "#5B2C83")
        .replace("treatments: [top-rule, side-rail, kicker-numeral, bottom-anchor]", "treatments: [band, top-rule, side-rail, bottom-anchor]")
        .replace(/^ {2}content: top-rule$/mu, "  content: band")
        .replace(/^ {2}sequence: kicker-numeral$/mu, "  sequence: top-rule")
        .replace("decoration: [accent-rule, hairline-rule, rail-fill, numeral]", "decoration: [header-band, accent-rule, hairline-rule, rail-fill]")
        .replace(/^density: \d+$/mu, "density: 4"));
      // The variant's own density applies: the source leaves the dial to the pack.
      const unpinned = join(dir, "unpinned.md");
      writeFileSync(unpinned, readFileSync(pinned, "utf8").replace(/^density: \d+\n/mu, ""));
      const variant = tonalityDeck(dir, ["--tonality", "variant-test"], { LIT_PPTX_TONALITY_DIRS: packs }, unpinned);
      assert.equal(variant.status, 0, variant.stderr + variant.stdout);
      const b = shapesOf(join(dir, "deck.pptx"));
      assert.equal(b.slides.length, a.slides.length);
      const treatments = (deck) => deck.slides.map((shapes) => (shapes.find((s) => s.name.startsWith("title@")) || {}).name);
      // The agenda takes each pack's content title.
      assert.equal(treatments(a)[1], "title@top-rule");
      assert.equal(treatments(b)[1], "title@band");
      assert.equal(treatments(a)[2], "title@top-rule", "the pinned title is kept");
      // A chart with no takeaways and no source has nothing for a side title's rail, so it takes the
      // bottom title the family allows (spec-v2 Amendments 7: a rail is never left empty).
      assert.equal(treatments(a)[3], "title@bottom-anchor", "a chart alone takes the bottom title, not an empty rail");
      const fills = (deck) => new Set(deck.slides.flat().flatMap((s) => [s.fill, s.colour]).filter(Boolean));
      assert.ok(fills(a).has("0E6B5A") && !fills(a).has("5B2C83"));
      assert.ok(fills(b).has("5B2C83") && !fills(b).has("0E6B5A"));
      // The body's left edge (a list marker or a line of text) sits on the grid margin.
      const bullets = (deck) => deck.slides[4].filter((s) => (s.text || s.fill) && !s.name.startsWith("title@") && s.y < 486 && s.y > 100).sort((p, q) => p.x - q.x);
      assert.equal(Math.round(bullets(a)[0].x), 36, "dense grid margin at density 8");
      assert.equal(Math.round(bullets(b)[0].x), 48, "standard grid margin at density 4");
      assert.match(a.subject, /tonality=ledger density=8 grid=dense/u);
      assert.match(b.subject, /tonality=variant-test density=4 grid=standard/u);
      // Each slide carries its layout family as the first shape's name, so a checker can compare it with what it measures.
      assert.deepEqual(a.slides.map((shapes) => shapes[0].name), ["family@cover-typographic", "family@agenda", "family@kpi-row",
        "family@chart-insight", "family@text-column", "family@section-rule", "family@closing-ask"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("legacy templates keep their look and every old deck compiles to the same slide count", () => {
    for (const [template, source] of [["AZURE-PRO", "deck-azure.md"], ["AZURE-A2Z", "deck-azure.md"], ["AZURE-PRO", "deck-chart.md"],
      ["BOILERPLATE-PRETENDARD", "deck-boilerplate.md"], ["BOILERPLATE-A2Z", "deck-boilerplate.md"]]) {
      const dir = work();
      try {
        assert.equal(deck(join(fixtures, source), template, dir).status, 0, `${template} ${source}`);
        const ast = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(fixtures, source)], { encoding: "utf8" });
        const slides = shapesOf(join(dir, "deck.pptx")).slides;
        assert.equal(slides.length, JSON.parse(ast.stdout).slides.length, `${template} ${source}`);
        if (template === "AZURE-PRO" && source === "deck-azure.md") {
          const title = slides[1].find((s) => s.name === "title@legacy");
          assert.ok(title, "the legacy title is named for the checker");
          assert.deepEqual([title.x, title.y, title.w].map((v) => Math.round(v * 100) / 100), [60.48, 53.28, 835.2]);
          assert.equal(slides[1][0].name, "family@text-column");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const dir = work();
    try {
      const built = deck(join(fixtures, "deck-azure.md"), "AZURE-PRO", dir, ["--tonality", "ledger"]);
      assert.equal(built.status, 0, built.stderr);
      assert.equal(shapesOf(join(dir, "deck.pptx")).slides.length, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a sparse slide is filled to within the density band by the pack's fill order", () => {
    const dir = work();
    try {
      const built = tonalityDeck(dir);
      assert.equal(built.status, 0, built.stderr);
      // The build log names every slide it filled: the band before, the band after and the policies used.
      const filled = [...built.stdout.matchAll(/^fill: slide (\d+) band (0\.\d+) -> (0\.\d+) \(([^)]+)\)$/gmu)];
      const text = filled.find((m) => m[1] === "5");
      assert.ok(text, built.stdout);
      assert.ok(Number(text[2]) > 0.14, `slide 5 started sparse: ${text[0]}`);
      assert.ok(Number(text[3]) <= 0.14, `slide 5 ends inside the density-8 band: ${text[0]}`);
      assert.match(text[4], /step-up/u);
      const shapes = shapesOf(join(dir, "deck.pptx")).slides[4];
      const title = shapes.find((s) => s.name.startsWith("title@"));
      const body = shapes.filter((s) => s.text && s !== title && s.y < 486);
      const bottom = Math.max(...body.map((s) => s.y + s.h));
      const top = title.y + title.h;
      assert.ok((486 - bottom) / (486 - top) <= 0.14, `measured band ${((486 - bottom) / (486 - top)).toFixed(3)}`);
      const chartSlide = shapesOf(join(dir, "deck.pptx")).slides[3];
      const chart = chartSlide.find((s) => s.chart);
      // The body floor is 486 pt, or 378 pt over a bottom-anchored title.
      const floor = chartSlide.some((s) => s.name === "title@bottom-anchor") ? 378 : 486;
      assert.ok(chart.y + chart.h >= 0.84 * floor, "the chart is anchored to the body floor");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A solid-colour-ramp PNG, written here so the tests need no image files in the repository.
  const png = (w, h, rgb) => {
    const raw = Buffer.concat(Array.from({ length: h }, (_, y) => {
      const row = Buffer.alloc(1 + w * 3);
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(rgb[c] * (0.6 + (0.4 * (x + y)) / (w + h)));
      return row;
    }));
    const chunk = (type, data) => {
      const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
      return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };

  /**
   * One sample deck per tonality from the family library: its covers, the agenda, its sections
   * between its families, then its closings, so every family and variant the pack lists is drawn.
   */
  const tonalitySample = (dir, id) => {
    const library = readFileSync(join(fixtures, "tonality-families.md"), "utf8");
    const [, front, rest] = library.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
    const slides = rest.split(/\n---\n(?=\n?---\nlayout:)/u).map((t) => t.trim()).filter(Boolean)
      .map((t) => (t.endsWith("---") ? t : `${t}\n---`)).map((t) => ({ layout: t.match(/layout: (\S+)/u)[1], text: t }));
    const pack = JSON.parse(spawnSync(process.execPath, ["-e", `console.log(JSON.stringify(require(${JSON.stringify(join(pptxRoot, "scripts", "lib", "template-registry.js"))}).loadPack(${JSON.stringify(id)})))`], { encoding: "utf8" }).stdout);
    const pick = (names) => names.map((n) => {
      const slide = slides.find((s) => s.layout === n);
      assert.ok(slide, `the family library has no ${n} slide`);
      return slide.text;
    });
    const families = pack["layout-families"];
    const half = Math.ceil(families.length / 2);
    const body = [...pick(pack.covers), ...pick(families.includes("agenda") ? [] : ["agenda"]), ...pick(pack.sections.slice(0, 1)),
      ...pick(families.slice(0, half)), ...pick(pack.sections.slice(1)), ...pick(families.slice(half)), ...pick(pack.closings)];
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "sample-a.png"), png(480, 270, [90, 120, 150]));
    writeFileSync(join(dir, "assets", "sample-b.png"), png(400, 300, [150, 120, 90]));
    writeFileSync(join(dir, `sample-${id}.md`), `---\n${front.replace(/^tonality: .*/mu, `tonality: ${id}`)}\n---\n\n${body.join("\n\n")}\n`);
    return { pack, expected: [...pack.covers, ...(families.includes("agenda") ? [] : ["agenda"]), ...pack.sections.slice(0, 1), ...families.slice(0, half), ...pack.sections.slice(1), ...families.slice(half), ...pack.closings] };
  };

  it("says when a slide's family or variant is not the tonality's own, and what it drew instead", () => {
    const dir = work();
    try {
      const source = readFileSync(join(fixtures, "deck-tonality.md"), "utf8")
        .replace("layout: text-column\n\n## 지연 원인", "layout: statement\n\n## 지연 원인")
        .replace("layout: section\n", "layout: section-image\n");
      writeFileSync(join(dir, "n.md"), source);
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "n.md"), "--pptx", join(dir, "n.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      assert.match(built.stdout, /note: slide 5: ledger has no statement title, so the sentence is drawn as a top-rule title/u);
      assert.match(built.stdout, /note: slide 6: section-image is not a ledger section variant \(section-rule, section-numeral\)/u);
      assert.match(built.stdout, /note: slide 6: drawn as section-rule/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const id of ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"]) {
    it(`${id}: every layout family and cover, section and closing variant it lists compiles, and its sample passes the QA gate`, () => {
      const dir = work();
      try {
        const { pack, expected } = tonalitySample(dir, id);
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, `sample-${id}.md`), "--pptx", join(dir, "deck.pptx")], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr + built.stdout);
        // Nothing the pack lists falls back to another variant or family.
        assert.doesNotMatch(built.stdout, /cannot be drawn|is not a \S+ (cover|section|closing) variant|drawn as /u, built.stdout);
        const deckShapes = shapesOf(join(dir, "deck.pptx"));
        assert.deepEqual(deckShapes.slides.map((shapes) => (shapes.find((s) => s.name.startsWith("family@")) || {}).name), expected.map((f) => `family@${f}`));
        // Every title is one of the pack's treatments (covers and sections carry their own names).
        const titles = deckShapes.slides.map((shapes) => (shapes.find((s) => s.name.startsWith("title@")) || {}).name).filter(Boolean)
          .map((n) => n.slice(6)).filter((t) => !["cover", "section"].includes(t));
        for (const t of titles) assert.ok(pack.treatments.includes(t), `${id}: title@${t}`);
        assert.ok(new Set(titles).size >= 3, `${id}: ${[...new Set(titles)]}`);
        const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
        const report = JSON.parse(gate.stdout);
        // The sample lists every family once in the pack's order, so it is a catalogue and not a
        // sequence a reader follows; composition variety (OF-111) is judged on the example decks.
        const reasons = report.failure_reasons.filter((reason) => !reason.startsWith("craft OF-111 "));
        assert.deepEqual(reasons, [], JSON.stringify(report.failure_reasons));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const exampleRoot = join(pptxRoot, "references", "examples");
  // The examples name three pictures the user supplies; the test draws flat ones of the same shape.
  const exampleAssets = (dir) => {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "example-a.png"), png(480, 270, [90, 120, 150]));
    writeFileSync(join(dir, "assets", "example-b.png"), png(400, 300, [150, 120, 90]));
    writeFileSync(join(dir, "assets", "example-c.png"), png(300, 400, [110, 140, 110]));
  };
  const outputFindings = (report, severity) => [...report.craft_floor.findings, ...report.craft_floor.advisories]
    .filter((f) => ["OF-110", "OF-111", "OF-112", "OF-113"].includes(f.check) && f.severity === severity);

  it("the deck output checks fail a deck of one look repeated (OF-110 to OF-113)", () => {
    const dir = work();
    try {
      const built = spawnSync(runtimePython, ["-B", join(fixtures, "build_output_flat.py"), join(dir, "deck.pptx")], { encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
      assert.equal(gate.status, 1);
      const report = JSON.parse(gate.stdout);
      const high = outputFindings(report, "HIGH");
      for (const id of ["OF-110", "OF-111", "OF-112", "OF-113"]) {
        assert.ok(high.some((f) => f.check === id), `${id} in ${JSON.stringify(high.map((f) => f.check))}`);
        assert.ok(report.failure_reasons.some((reason) => reason.startsWith(`craft ${id}`) && reason.includes(" — ")), `${id} reason with a hint`);
      }
      assert.ok(high.some((f) => f.check === "OF-110" && f.slide === 7 && /drawn as top-rule, named side-rail/u.test(f.detail)), "a written name is never the evidence");
      assert.ok(high.some((f) => f.check === "OF-110" && f.slide === null && /1 title treatment/u.test(f.detail)));
      assert.ok(high.some((f) => f.check === "OF-113" && f.slide === 5 && /x 60 vs 48/u.test(f.detail)));
      assert.ok(high.some((f) => f.check === "OF-112" && /median empty band 0\.\d+/u.test(f.detail)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a legacy template reports the variety checks as advisories, never as a failed gate", () => {
    const dir = work();
    try {
      const azure = readFileSync(join(fixtures, "deck-azure.md"), "utf8");
      const [, front, rest] = azure.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
      const slides = rest.split(/\n---\n(?=\n?---\nlayout:)/u).map((t) => t.trim()).filter(Boolean).map((t) => (t.endsWith("---") ? t : `${t}\n---`));
      const table = slides.find((t) => t.includes("layout: content"));
      const cards = slides.find((t) => t.includes("layout: main"));
      // Eight content slides under the one legacy title position: the single look, repeated.
      const body = [slides[0], ...Array.from({ length: 8 }, (_, i) => (i % 2 ? cards.replace("## 분류 라인 처리량이 병목이다", `## 분류 라인 처리량이 병목이다 ${i + 1}`)
        : table.replace("## 투자안 비교", `## 투자안 비교 ${i + 1}`))), slides[slides.length - 1]];
      writeFileSync(join(dir, "legacy.md"), `---\n${front}\n---\n\n${body.join("\n\n")}\n`);
      assert.equal(deck(join(dir, "legacy.md"), "AZURE-PRO", dir).status, 0);
      const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
      const report = JSON.parse(gate.stdout);
      assert.deepEqual(outputFindings(report, "HIGH"), []);
      const advisories = new Set(outputFindings(report, "MEDIUM").map((f) => f.check));
      assert.ok(advisories.has("OF-110") && advisories.has("OF-111"), JSON.stringify([...advisories]));
      assert.equal(gate.status, 0, JSON.stringify(report.failure_reasons));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every worked example compiles under its tonality and passes the gate, deck output checks included", () => {
    const files = readdirSync(exampleRoot).filter((f) => f.endsWith(".md")).sort();
    assert.ok(files.length >= 12, `${files.length} examples`);
    const tonalities = new Set();
    for (const file of files) {
      const dir = work();
      try {
        const source = readFileSync(join(exampleRoot, file), "utf8");
        const tonality = (source.match(/^tonality: (\S+)$/mu) || [])[1];
        assert.ok(tonality, `${file} names its tonality`);
        tonalities.add(tonality);
        exampleAssets(dir);
        copyFileSync(join(exampleRoot, file), join(dir, file));
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, file), "--pptx", join(dir, "deck.pptx")], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, `${file}: ${built.stderr}${built.stdout}`);
        assert.match(built.stdout, new RegExp(`^Tonality ${tonality} `, "mu"));
        assert.doesNotMatch(built.stdout, /cannot be drawn|is not a \S+ (cover|section|closing) variant|takes none of/u, `${file}: ${built.stdout}`);
        assert.ok(shapesOf(join(dir, "deck.pptx")).slides.length >= 8, `${file} has eight or more slides`);
        const gate = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir);
        const report = JSON.parse(gate.stdout);
        assert.equal(gate.status, 0, `${file}: ${JSON.stringify(report.failure_reasons)}`);
        assert.deepEqual(outputFindings(report, "HIGH"), [], file);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    assert.deepEqual([...tonalities].sort(), ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"]);
  });

  it("draws tables and charts in each pack's style, one colour per data series", () => {
    const dir = work();
    try {
      const styles = {};
      for (const id of ["ledger", "gazette", "paper", "signal"]) {
        tonalitySample(dir, id);
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, `sample-${id}.md`), "--pptx", join(dir, `${id}.pptx`)], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr + built.stdout);
        const probe = spawnSync(runtimePython, ["-B", "-c", `
import json, re, sys, zipfile
from pptx import Presentation
p = Presentation(sys.argv[1])
z = zipfile.ZipFile(sys.argv[1])
series = []
for name in sorted(n for n in z.namelist() if re.match(r"ppt/charts/chart\\d+\\.xml$", n)):
    xml = z.read(name).decode("utf-8")
    for ser in re.findall(r"<c:ser>(.*?)</c:ser>", xml, re.S):
        fill = re.sub(r"<c:dLbls>.*?</c:dLbls>", "", ser.split("<c:cat>")[0], flags=re.S)  # label text colour is not a series colour
        series.append(sorted(set(re.findall(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', fill))))
header = None
for s in p.slides:
    for sh in s.shapes:
        if sh.has_table and header is None:
            c = sh.table.cell(0, 0)
            header = str(c.fill.fore_color.rgb) if c.fill.type == 1 else None
print(json.dumps({"series": series, "header": header}))
`, join(dir, `${id}.pptx`)], { encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        styles[id] = JSON.parse(probe.stdout);
      }
      // Gazette lists no chart family; the other three each draw charts.
      for (const id of ["ledger", "paper", "signal"]) assert.ok(styles[id].series.length > 0, id);
      for (const [id, style] of Object.entries(styles)) {
        for (const colours of style.series) assert.equal(colours.length, 1, `${id}: a series drawn in ${colours}`);
      }
      // Ledger and Gazette head their tables with the field colour; Paper and Signal keep the head unfilled.
      assert.equal(styles.ledger.header, "0A4438");
      assert.equal(styles.gazette.header, "233A4F");
      assert.equal(styles.paper.header, null);
      assert.equal(styles.signal.header, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a table's takeaway moves under the table, its points side by side, when that fills the body better than beside it", () => {
    const dir = work();
    try {
      const built = tonalityDeck(dir, [], {}, join(fixtures, "deck-fill-audit.md"));
      assert.equal(built.status, 0, built.stderr + built.stdout);
      const slide = shapesOf(join(dir, "deck.pptx")).slides[1];
      const table = slide.find((s) => s.table);
      const takeaway = slide.find((s) => s.text.startsWith("북부 센터의 지연"));
      assert.ok(takeaway.y >= table.y + table.h, `takeaway at y ${takeaway.y} sits under the table ending at ${table.y + table.h}`);
      const second = slide.find((s) => s.text.startsWith("남부 센터는"));
      assert.ok(second.y >= table.y + table.h && Math.abs(second.x + second.w - (table.x + table.w)) < 2, "the second point closes the table's width");
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.ok(!gate.craft_floor.findings.some((f) => f.check === "OF-109" && f.slide === 2), JSON.stringify(gate.craft_floor.findings));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a comparison head that wraps gets a frame as tall as its drawn lines", () => {
    const dir = work();
    try {
      assert.equal(tonalityDeck(dir, [], {}, join(fixtures, "deck-fill-audit.md")).status, 0);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.deepEqual(gate.layout.details.filter((d) => d.slide === 3), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the reading-ramp step-up enlarges reference entries too", () => {
    const dir = work();
    try {
      const built = tonalityDeck(dir, [], {}, join(fixtures, "deck-fill-audit.md"));
      assert.match(built.stdout, /^fill: slide 4 band 0\.\d+ -> 0\.\d+ \([^)]*step-up/mu, built.stdout);
      const entries = shapesOf(join(dir, "deck.pptx")).slides[3].filter((s) => s.text.startsWith("["));
      const sizes = JSON.parse(spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from pptx import Presentation
s = Presentation(sys.argv[1]).slides[3]
print(json.dumps([r.font.size.pt for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith("[") for p in sh.text_frame.paragraphs for r in p.runs]))
`, join(dir, "deck.pptx")], { encoding: "utf8" }).stdout);
      assert.equal(entries.length, 3);
      assert.ok(sizes.every((z) => z > 14), `entries stepped above the 14 pt reading body: ${sizes}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a soft term written as a capitalised word matches the word, not letters inside another word", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "w.md"), "---\ntonality: paper\ntitle: Word match\n---\n\n---\nlayout: text-column\n\n## The process diagram shows three stages\n\n- Figure 2 is a diagram of the reactor layout\n- The pilot program ran for six weeks\n---\n");
      writeFileSync(join(dir, "r.md"), "---\ntonality: paper\ntitle: Word match\n---\n\n---\nlayout: text-column\n\n## The controller needs more RAM\n\n- Each node holds 16 GB RAM\n---\n");
      for (const name of ["w", "r"]) {
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, `${name}.md`), "--pptx", join(dir, `${name}.pptx`)], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr);
      }
      const warnings = (name) => JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, `${name}.pptx`)], dir).stdout).anti_slop.review_warnings;
      assert.deepEqual(warnings("w"), []);
      assert.ok(warnings("r").length > 0, "RAM as a word is still reported");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a journal name in *single stars* is set in italics, without the stars", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "i.md"), "---\ntonality: paper\ntitle: Italics\n---\n\n---\nlayout: references-appendix\n\n## References\n\n- [1] Example, A. (2021). Single-feed limits. *Journal of Example Engineering*, 14(2), 101–118.\n- [2] Sample, C. (2023). Two-stage feeding. *Example Process Letters*, 9, 33–41.\n---\n");
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "i.md"), "--pptx", join(dir, "i.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const runs = JSON.parse(spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from pptx import Presentation
s = Presentation(sys.argv[1]).slides[0]
print(json.dumps([[r.text, bool(r.font.italic)] for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith("[") for p in sh.text_frame.paragraphs for r in p.runs]))
`, join(dir, "i.pptx")], { encoding: "utf8" }).stdout);
      assert.ok(runs.every(([text]) => !text.includes("*")), JSON.stringify(runs));
      assert.deepEqual(runs.filter(([, italic]) => italic).map(([text]) => text), ["Journal of Example Engineering", "Example Process Letters"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a quote beside a side title sits in the middle of the body as a display slide, not at the top of an empty page", () => {
    const dir = work();
    try {
      // A pack with neither a statement nor a top-rule title draws a quote beside its side rail
      // (the bundled packs all take one of the two, so the pack is written here as data).
      const packs = join(dir, "packs");
      mkdirSync(join(packs, "rail-only"), { recursive: true });
      writeFileSync(join(packs, "rail-only", "pack.yaml"), readFileSync(join(pptxRoot, "templates", "tonalities", "studio", "pack.yaml"), "utf8")
        .replace("id: studio", "id: rail-only")
        .replace("treatments: [side-rail, statement, top-plain-large, bottom-anchor, overlay]", "treatments: [side-rail, kicker-numeral, top-plain-large, bottom-anchor, overlay]")
        .replace(/^ {2}statement: statement$/mu, "  statement: top-plain-large")
        .replace(", statement]", "]"));
      writeFileSync(join(dir, "q.md"), "---\ntonality: rail-only\ntitle: 인용\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: quote\n\n## 먼저 써 본 고객의 말\n\n“퇴근 후에는 식탁, 주말에는 운동할 바닥이 생겼어요.”\n\n— 예시 고객 인터뷰, 원룸 거주\n---\n");
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "q.md"), "--pptx", join(dir, "q.pptx")], { cwd: dir, encoding: "utf8", env: { ...process.env, LIT_PPTX_TONALITY_DIRS: packs } });
      assert.equal(built.status, 0, built.stderr);
      const slide = shapesOf(join(dir, "q.pptx")).slides[0];
      assert.ok(slide.some((s) => s.name === "title@side-rail"), JSON.stringify(slide.map((s) => s.name)));
      const quote = slide.find((s) => s.text.startsWith("퇴근"));
      const middle = quote.y + quote.h / 2;
      assert.ok(middle > 36 + 450 / 3 && middle < 36 + (2 * 450) / 3, `quote centre at y ${middle}`);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "q.pptx")], dir).stdout);
      assert.deepEqual(gate.craft.findings.filter((f) => f.check === "sparse_slide"), []);
      assert.deepEqual(gate.craft_floor.findings.filter((f) => f.check === "OF-109"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a deck at variance 4 or more carries at least three title treatments even when fill alone would choose two", () => {
    const dir = work();
    try {
      // The comparison is pinned to top-rule. The agenda no longer lends the deck a numeral (its row count read as a
      // stray section number, spec-v2 Amendments 8), so the deck opens a part: its slides carry the part numeral.
      writeFileSync(join(dir, "g.md"), readFileSync(join(fixtures, "deck-briefing-gazette.md"), "utf8")
        // Density 8 keeps the case this test was written for (fill alone settles on two titles there).
        .replace("tonality: gazette\n", "tonality: gazette\ndensity: 8\n").replace("layout: comparison\n", "layout: comparison\ntitle: top-rule\n")
        .replace("---\nlayout: content\n\n## 검토 결과 요약", "---\nlayout: section\n\n# 검토 결과와 개선안\n---\n\n---\nlayout: content\n\n## 검토 결과 요약"));
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "g.md"), "--pptx", join(dir, "g.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const used = new Set([...built.stdout.match(/^Treatments: (.*)$/mu)[1].matchAll(/\d+:(\S+)/gu)].map((m) => m[1]));
      assert.ok(used.size >= 3, built.stdout);
      assert.ok(!/^2:kicker-numeral/mu.test(built.stdout.match(/^Treatments: (.*)$/mu)[1]), "the agenda takes no numeral");
      assert.deepEqual(floorFindings(gateJson(dir, join(dir, "g.pptx")), "OF-110"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no title zone covers more than 40 % of the content slides when another zone fills as well", () => {
    const dir = work();
    try {
      const built = tonalityDeck(dir, [], {}, join(fixtures, "deck-review-ledger.md"));
      assert.equal(built.status, 0, built.stderr);
      assert.match(built.stdout, /^variety: slide \d+ drawn under \S+ so no title zone covers more than 40 % of the content slides$/mu);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "deck.pptx")], dir).stdout);
      assert.deepEqual(gate.craft_floor.findings.filter((f) => f.check === "OF-111"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the fill check measures a side-rail slide over the body beside the rail, not over the empty rail", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "a.png"), png(480, 270, [90, 120, 150]));
      writeFileSync(join(dir, "s.md"), "---\ntonality: studio\ntitle: 경첩\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: image-split\ntitle: side-rail\n\n## 경첩 하나로 30초 안에 바꾼다\n\n![도 3. 경첩 구조 확대 | 출처: 예시 이미지](assets/a.png)\n\n- **경첩** 2만 회 개폐 시험 통과 (예시)\n- **잠금** 펼친 상태에서 자동으로 고정된다\n---\n");
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "s.md"), "--pptx", join(dir, "s.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "s.pptx")], dir).stdout);
      const slide = gate.craft.slides[0];
      assert.equal(slide.display, false);
      assert.ok(slide.fill >= 0.45, `fill ${slide.fill} over the body beside the rail`);
      // A rail slide whose body is really half empty still fails.
      writeFileSync(join(dir, "e.md"), "---\ntonality: studio\ntitle: 경첩\n---\n\n---\nlayout: text-column\ntitle: side-rail\n\n## 경첩 하나로 30초 안에 바꾼다\n\n- 2만 회 개폐 시험 통과 (예시)\n---\n");
      assert.equal(spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "e.md"), "--pptx", join(dir, "e.pptx")], { cwd: dir, encoding: "utf8" }).status, 0);
      const empty = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "e.pptx")], dir).stdout);
      assert.ok(empty.craft.findings.some((f) => f.check === "sparse_slide") || empty.craft_floor.findings.some((f) => f.check === "OF-109"), JSON.stringify(empty.craft));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Display slides (cover, statement, section, big number, closing): sizes and run colours per shape.
  const runsOf = (pptx) => {
    const probe = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from pptx import Presentation
p = Presentation(sys.argv[1])
def rgb(r):
    try:
        return str(r.font.color.rgb) if r.font.color and r.font.color.type is not None else None
    except Exception:
        return None
out = []
for s in p.slides:
    out.append([{"name": sh.name, "text": sh.text_frame.text if sh.has_text_frame else "",
                 "runs": [[r.text, r.font.size.pt if r.font.size else None, rgb(r)] for para in sh.text_frame.paragraphs for r in para.runs if r.text.strip()]
                 if sh.has_text_frame else []} for sh in s.shapes])
print(json.dumps(out))
`, pptx], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    return JSON.parse(probe.stdout);
  };
  const displayDeck = (dir, tonality, source = join(fixtures, "deck-display.md"), name = "deck") => {
    const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), source, "--tonality", tonality, "--pptx", join(dir, `${name}.pptx`)], { cwd: dir, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr + built.stdout);
    return { built, shapes: shapesOf(join(dir, `${name}.pptx`)).slides, runs: runsOf(join(dir, `${name}.pptx`)), pptx: join(dir, `${name}.pptx`) };
  };
  const gateOn = (dir, pptx, slide) => {
    const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [pptx], dir).stdout);
    return [...gate.craft.findings, ...gate.craft_floor.findings].filter((f) => f.slide === slide && (f.severity || "HIGH") === "HIGH");
  };
  // A filled shape covering the whole canvas.
  const fullCanvas = (s) => s.fill && Math.round(s.x) === 0 && Math.round(s.y) === 0 && Math.round(s.w) === 960 && Math.round(s.h) === 540;
  const lines = (text) => text.split(/[\n\v]/u).map((l) => l.trim()).filter(Boolean);

  it("a statement is set at the display step, never the retired hero step, in balanced lines that never end on one word", () => {
    const dir = work();
    try {
      const { runs } = displayDeck(dir, "signal");
      const title = runs[3].find((s) => s.name === "title@statement");
      assert.ok(title, JSON.stringify(runs[3].map((s) => s.name)));
      assert.ok(title.runs.every(([, size]) => size === 36), `statement sizes ${JSON.stringify(title.runs)}`);
      const set = lines(title.text);
      assert.ok(set.length >= 2, `lines ${JSON.stringify(set)}`);
      assert.ok(set.every((l) => l.split(/\s+/u).length >= 2), `a line holds one word: ${JSON.stringify(set)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a named type-led cover takes each tonality's own device, so covers differ in structure", () => {
    const dir = work();
    try {
      const device = {};
      for (const t of ["signal", "atlas", "chalk", "gazette", "ledger", "paper", "night"]) {
        const { shapes, runs } = displayDeck(dir, t, undefined, t);
        const cover = shapes[0];
        const title = runs[0].find((s) => s.name === "title@cover");
        assert.ok(title, `${t}: ${JSON.stringify(cover.map((s) => s.name))}`);
        const fills = cover.filter((s) => s.fill && !s.name.startsWith("lit-notice"));
        if (fills.some(fullCanvas)) device[t] = "drench";
        else if (fills.some((s) => Math.round(s.x) === 0 && Math.round(s.y) > 0 && Math.round(s.y + s.h) === 540 && Math.round(s.w) === 960)) device[t] = "plate";
        else if (fills.some((s) => Math.round(s.x) === 0 && Math.round(s.y) === 0 && Math.round(s.h) === 540 && s.w < 400)) device[t] = "rail";
        else if (fills.some((s) => Math.round(s.y) === 0 && Math.round(s.w) === 960 && s.h >= 150 && s.h <= 240)) device[t] = "band";
        else if (cover.filter((s) => s.text && /^[\d.,]+[^\s]*|^\d/u.test(s.text) && runs[0].some((r) => r.text === s.text && r.runs.some(([, z]) => z >= 24 && z <= 26))).length >= 3) device[t] = "figures";
        else if (/^20\d\d$/u.test((cover.find((s) => /^20\d\d$/u.test(s.text)) || {}).text || "")) device[t] = "numeral";
        else if (cover.filter((s) => !s.text && s.h <= 3 && s.w >= 600).length >= 2) device[t] = "rules";
        else device[t] = "plain";
      }
      assert.deepEqual(device, { signal: "drench", atlas: "plate", chalk: "rail", gazette: "band", ledger: "figures", paper: "rules", night: "numeral" });
      // On the drenched cover the title is at the cover step (no hero step) in the colour that reads on the field.
      const signal = runsOf(join(dir, "signal.pptx"))[0].find((s) => s.name === "title@cover");
      assert.ok(signal.runs.every(([, size, colour]) => size === 44 && colour === "FFFFFF"), JSON.stringify(signal.runs));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an editorial tonality opens on the deck's image when the named cover is not its own", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "a.png"), png(640, 480, [120, 110, 90]));
      writeFileSync(join(dir, "c.md"), readFileSync(join(fixtures, "deck-display.md"), "utf8")
        .replace("## 맞벌이 가구의 주말 세탁 부담과 수거·배송 대행 수요\n", "## 맞벌이 가구의 주말 세탁 부담과 수거·배송 대행 수요\n---\n\n---\nlayout: image-split\n\n## 앱 주문과 다음 날 배송\n\n![도 1. 주문 화면 | 출처: 예시 이미지](assets/a.png)\n\n- **주문** 수거 시간을 30분 단위로 고른다\n- **배송** 다음 날 저녁 9시 전에 돌려준다\n"));
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "c.md"), "--tonality", "studio", "--pptx", join(dir, "c.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      assert.match(built.stdout, /slide 1: drawn as cover-split-image/u, built.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a section carries its agenda position and the part count, and quiet tonalities show the part index", () => {
    const dir = work();
    try {
      // Chalk: the hero numeral says which part of how many.
      const chalk = displayDeck(dir, "chalk", undefined, "chalk").shapes[2];
      assert.ok(chalk.some((s) => /^03\s*\/\s*04$/u.test(s.text)), JSON.stringify(chalk.map((s) => s.text)));
      // With the agenda known, the numeral's page carries the agenda too, so the title is not alone on the page.
      assert.ok(chalk.some((s) => s.text.includes("시장") && s.text.includes("요청")), JSON.stringify(chalk.map((s) => s.text)));
      // Ledger: under the rule, the deck's parts in one line, this part in the accent.
      const ledger = displayDeck(dir, "ledger", undefined, "ledger");
      const index = ledger.runs[2].find((s) => s.text.includes("01") && s.text.includes("04"));
      assert.ok(index, JSON.stringify(ledger.runs[2].map((s) => s.text)));
      assert.ok(["시장", "서비스", "실적", "요청"].every((w) => index.text.includes(w)), index.text);
      const marked = index.runs.filter(([, , colour]) => colour === "0E6B5A").map(([text]) => text).join("");
      assert.match(marked, /03.*실적/u, JSON.stringify(index.runs));
      assert.ok(!/시장|요청/u.test(marked), JSON.stringify(index.runs));
      // Gazette: the index sits in the header band, the title on the ground under it.
      const gazette = displayDeck(dir, "gazette", undefined, "gazette").shapes[2];
      const strip = gazette.find((s) => s.text.includes("01") && s.text.includes("04"));
      assert.ok(strip && strip.y + strip.h <= 216, JSON.stringify(gazette.map((s) => [s.text, s.y])));
      // Under the band the title is set as a statement over what the part opens with, down the page.
      const under = gazette.filter((s) => s.text && s.y > 216 && !s.name.startsWith("lit-notice"));
      assert.ok(under.some((s) => s.text.includes("맞벌이 가구")) && Math.max(...under.map((s) => s.y + s.h)) >= 330, JSON.stringify(under.map((s) => [s.text, s.y, s.h])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a big number sits on a panel that fills its region, with the evidence beside it", () => {
    const dir = work();
    try {
      for (const t of ["ledger", "gazette", "signal"]) {
        const { shapes, runs, pptx } = displayDeck(dir, t, undefined, t);
        const slide = shapes[5];
        const number = slide.find((s) => s.text === "62%");
        assert.ok(number, `${t}: ${JSON.stringify(slide.map((s) => s.text))}`);
        const cx = number.x + number.w / 2;
        const cy = number.y + number.h / 2;
        // A filled panel, or an outlined one (Gazette): a text-less frame behind the number.
        const panel = slide.find((s) => !s.text && !s.name.startsWith("lit-notice") && s.x <= cx && cx <= s.x + s.w && s.y <= cy && cy <= s.y + s.h);
        assert.ok(panel, `${t}: no panel behind the number`);
        assert.ok(panel.y + panel.h >= 372, `${t}: panel ends at ${panel.y + panel.h}`);
        assert.ok(panel.w * panel.h >= 0.2 * 960 * 540, `${t}: panel ${panel.w} x ${panel.h}`);
        // A figure stays within two steps of the body: title size at most (spec-v2 Amendments 5).
        const size = runs[5].find((s) => s.text === "62%").runs[0][1];
        assert.ok(size >= 18 && size <= 26, `${t}: number at ${size} pt`);
        assert.deepEqual(gateOn(dir, pptx, 6), [], `${t}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a closing turns its table into action rows keyed by amount or date, with the next step as the band above the footer", () => {
    const dir = work();
    try {
      const { shapes, runs, pptx } = displayDeck(dir, "signal");
      const slide = shapes[6];
      assert.ok(!slide.some((s) => s.table), "the ask's table is drawn as rows");
      for (const key of ["18억 원", "7억 원", "5억 원"]) {
        const shape = runs[6].find((s) => s.text === key);
        assert.ok(shape && shape.runs[0][1] >= 18 && shape.runs[0][1] <= 26, `${key}: ${JSON.stringify(shape)}`);
      }
      // One bar per use, as long as its share of the ask.
      const bars = slide.filter((s) => s.fill === "C8361A" && !s.text && s.h <= 12 && s.w >= 4).sort((a, b) => a.y - b.y);
      assert.equal(bars.length, 3, JSON.stringify(slide.map((s) => [s.fill, s.w, s.h])));
      assert.ok(Math.abs(bars[1].w / bars[0].w - 7 / 18) < 0.02 && Math.abs(bars[2].w / bars[0].w - 5 / 18) < 0.02, JSON.stringify(bars.map((b) => b.w)));
      // The band spans the grid (a card inside the safe margins of the compact grid), ending on the body floor.
      const step = slide.find((s) => s.text.startsWith("다음 단계"));
      const band = slide.find((s) => s.fill === "C8361A" && Math.round(s.x) === 24 && Math.round(s.w) === 912 && s.y <= step.y && step.y + step.h <= s.y + s.h);
      assert.ok(band && band.y + band.h <= 487 && band.h >= 48, JSON.stringify(slide.map((s) => [s.text, s.fill, s.x, s.y, s.w, s.h])));
      assert.equal(step.colour, "FFFFFF");
      assert.deepEqual(gateOn(dir, pptx, 7), []);
      // Rows without amounts are keyed by their date, and a quiet tonality boxes the next step inside the margins.
      writeFileSync(join(dir, "d.md"), "---\ntonality: ledger\ndensity: 8\ntitle: 진행 보고\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: closing-ask\n\n## 결제사 일정 협의 지원 요청\n\n| 요청 | 담당 | 기한 |\n|---|---|---|\n| 결제사 시험 환경 개설 일정 확정 요청 | 예시 사업본부장 | 10월 7일 |\n| 자료 이관 보관 규정 결론 | 예시 법무파트 | 10월 21일 |\n\n- 다음 보고: 10월 30일, 예시 프로젝트 관리자\n---\n");
      const dated = displayDeck(dir, "ledger", join(dir, "d.md"), "dated");
      for (const key of ["10월 7일", "10월 21일"]) {
        const shape = dated.runs[0].find((s) => s.text === key);
        assert.ok(shape && shape.runs[0][1] >= 18 && shape.runs[0][1] <= 26, `${key}: ${JSON.stringify(dated.runs[0].map((s) => s.text))}`);
      }
      const box = dated.shapes[0].find((s) => (s.fill || s.text === "") && s.y > 300 && s.x >= 23 && s.x + s.w <= 937 && s.w >= 600);
      assert.ok(box, JSON.stringify(dated.shapes[0].map((s) => [s.text, s.fill, s.x, s.y, s.w, s.h])));
      assert.deepEqual(gateOn(dir, dated.pptx, 1), []);
      // Under a header band the rows still share the room evenly with the step.
      const banded = displayDeck(dir, "gazette", join(dir, "d.md"), "banded");
      assert.deepEqual(gateOn(dir, banded.pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("each tonality carries a statement with its own device: board, epigraph rules or a field, never an empty rail", () => {
    const dir = work();
    try {
      const statement = (t) => {
        const d = displayDeck(dir, t, undefined, `s-${t}`);
        const title = d.shapes[3].find((s) => s.name === "title@statement");
        assert.ok(title, `${t}: ${JSON.stringify(d.shapes[3].map((s) => s.name))}`);
        assert.deepEqual(gateOn(dir, d.pptx, 4).filter((f) => f.check === "OF-110"), [], t);
        return { title, slide: d.shapes[3] };
      };
      const chalk = statement("chalk");
      assert.ok(chalk.slide.some((s) => fullCanvas(s) && s.fill === "1F3B33") && chalk.title.colour === "FFFFFF", "chalk board");
      const paper = statement("paper");
      assert.ok(paper.slide.filter((s) => !s.text && s.h <= 2 && s.w >= 800).length >= 2, "paper epigraph rules");
      const atlas = statement("atlas");
      // Atlas sets the sentence on the whole-page field (spec-v2 Amendments 7: a plate left the top half empty).
      assert.ok(atlas.slide.some((s) => fullCanvas(s) && s.fill === "1A1D21") && atlas.title.colour === "FFFFFF", "atlas field");
      const studio = statement("studio");
      // T7 (spec-v2 Amendments 8): the offset rail stood empty beside the sentence; Studio frames it in two hairlines.
      assert.ok(!studio.slide.some((s) => s.fill && Math.round(s.x) === 0 && Math.round(s.y) === 0 && s.h >= 400 && s.w < 400), "no empty rail beside the studio statement");
      assert.ok(studio.slide.filter((s) => !s.text && s.h <= 2 && s.w >= 800).length >= 2, "studio statement between two hairlines");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a contact-split closing keeps every key on one line inside the field, and the next step closes the field on the body floor", () => {
    const dir = work();
    try {
      const check = (d, slide, keys, stepStart) => {
        const shapes = d.shapes[slide];
        assert.ok(!shapes.some((s) => s.table), "the ask's table is drawn as rows");
        const field = shapes.find((s) => s.fill === "141414" && s.x > 400 && Math.round(s.x + s.w) === 960);
        assert.ok(field, JSON.stringify(shapes.map((s) => [s.text, s.fill, s.x, s.y, s.w, s.h])));
        for (const key of keys) {
          const s = shapes.find((q) => q.text === key);
          const size = d.runs[slide].find((q) => q.text === key).runs[0][1];
          assert.ok(s && size >= 18 && size <= 26, `${key}: ${JSON.stringify(s)} at ${size}`);
          // Inset from the field's edges and wide enough to hold the key on one line.
          assert.ok(s.x >= field.x + 24 && s.y >= field.y + 24 && s.x + s.w <= 960 - 24, `${key} not inset: ${JSON.stringify([s, field])}`);
          assert.ok(s.w >= [...key].length * 0.62 * size, `${key} frame ${s.w} for ${size} pt`);
        }
        // The next step (or the contact) is the field's foot: a band of the field's colour on the body
        // floor that meets the field, so the field is not left empty under its last key.
        const step = shapes.find((s) => s.text.startsWith(stepStart));
        const band = shapes.find((s) => s.fill === "141414" && s !== field && step && s.y <= step.y && step.y + step.h <= s.y + s.h);
        assert.ok(step && step.colour === "FFFFFF" && band, JSON.stringify(shapes.map((s) => [s.text, s.fill, s.x, s.y, s.w, s.h])));
        assert.ok(Math.abs(band.x + band.w - field.x) < 1 && band.y + band.h <= 487 && band.y + band.h >= 470, JSON.stringify([band, field]));
        const lastKey = Math.max(...keys.map((k) => { const q = shapes.find((x) => x.text === k); return q.y + q.h; }));
        assert.ok(band.y - lastKey <= 0.25 * (486 - field.y), `field empty under its last key: ${lastKey}, band at ${band.y}`);
        assert.deepEqual(gateOn(dir, d.pptx, slide + 1), []);
      };
      check(displayDeck(dir, "studio"), 6, ["18억 원", "7억 원", "5억 원"], "다음 단계");
      writeFileSync(join(dir, "d.md"), "---\ntonality: studio\ntitle: 입점 제안\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: closing-ask\n\n## 11월 본 판매 전 입점 조건 협의\n\n| 논의할 것 | 담당 | 기한 |\n|---|---|---|\n| 매장 전시 공간과 시연 일정 | 예시 영업팀 | 10월 셋째 주 |\n| 초도 물량과 납기 | 예시 생산팀 | 10월 말 |\n\n- 연락: 예시 디자인 스튜디오 영업 담당\n---\n");
      check(displayDeck(dir, "studio", join(dir, "d.md"), "dated"), 0, ["10월 셋째 주", "10월 말"], "연락");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a section with the agenda is a composed index; without one it carries the section's first content line, never a bare numeral", () => {
    const dir = work();
    try {
      const ledger = displayDeck(dir, "ledger", undefined, "ledger");
      const slide = ledger.shapes[2];
      // The part numeral at display scale, the agenda as a list (one part a line) spread down the body.
      // The part numeral at title size (a number never takes the display step), over the part title.
      const numeral = ledger.runs[2].find((s) => /^03/u.test(s.text));
      assert.ok(numeral && numeral.runs[0][1] === 26, JSON.stringify(ledger.runs[2].map((s) => [s.text, s.runs])));
      const index = slide.find((s) => s.text.includes("시장") && s.text.includes("요청"));
      assert.ok(index && lines(index.text).length === 4, JSON.stringify(index));
      const drawn = slide.filter((s) => !s.name.startsWith("lit-notice") && (s.text || s.fill));
      const top = Math.min(...drawn.map((s) => s.y));
      const bottom = Math.max(...drawn.map((s) => s.y + s.h));
      assert.ok(top <= 160 && bottom >= 400, `composition spans ${top}-${bottom}`);
      writeFileSync(join(dir, "m.md"), "---\ntonality: ledger\ntitle: Churn review\n---\n\n---\nlayout: text-column\n\n## Churn fell in Q3\n\n- Month-two churn fell to 5.0 % (sample)\n---\n\n---\nlayout: section\n\n# Method notes\n---\n\n---\nlayout: references-appendix\n\n## Data sources and definitions\n\n- [1] Billing system export (sample)\n- [2] Churn: share of subscribers who cancel in a month\n---\n");
      for (const t of ["ledger", "night", "paper"]) {
        const d = displayDeck(dir, t, join(dir, "m.md"), `m-${t}`);
        const section = d.shapes[1];
        assert.ok(!section.some((s) => /^\s*\d+\s*$/u.test(s.text)), `${t}: bare numeral ${JSON.stringify(section.map((s) => s.text))}`);
        assert.ok(section.some((s) => s.text.includes("Data sources and definitions")), `${t}: ${JSON.stringify(section.map((s) => s.text))}`);
        const title = d.runs[1].find((s) => s.name === "title@section");
        assert.ok(title.runs[0][1] >= 36, `${t}: section title at ${title.runs[0][1]}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("body text that wraps breaks at spaces only, so a number keeps its unit and a word stays whole", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "b.png"), png(640, 480, [120, 130, 140]));
      const intact = (shapes, needle, whole) => {
        const shape = shapes.find((s) => s.text.replace(/\s+/gu, " ").includes(needle));
        assert.ok(shape, `${needle}: ${JSON.stringify(shapes.map((s) => s.text))}`);
        const set = lines(shape.text);
        // A renderer may break between a digit and Hangul; explicit breaks at spaces leave it nothing to break.
        assert.ok(set.length >= 2, `${needle}: not broken at spaces: ${JSON.stringify(shape.text)}`);
        assert.ok(set.some((l) => l.includes(whole)), `${whole} split: ${JSON.stringify(set)}`);
      };
      const a = oneSlide(dir, "a", "chalk", "layout: image-split\n\n## 예제: 공부 시간이 1시간 늘면 점수는 평균 4.2점 오른다\n\n![도 1. 학생 40명의 공부 시간과 점수 | 출처: 예시 이미지](assets/b.png)\n\n- **기울기** 4.2점/시간\n- **절편** 51점\n- **해석** 공부 시간이 0인 학생의 예상 점수가 51점이라는 뜻이지, 실제로 그런 학생이 있다는 뜻은 아니다");
      intact(a.shapes, "예상 점수가", "51점이라는");
      const b = oneSlide(dir, "b", "ledger", "layout: comparison\n\n## 개선안: 자율 선택제보다 협업일 지정제가 불편을 더 줄인다\n\n:::: columns 1fr 1fr\n::: col\n- **안 1. 자율 선택 유지 (주 1-3일)**\n  (1) 장점: 개인 사정에 맞추기 쉽다\n  (2) 단점: 회의 조율 불편이 그대로 남는다\n  (3) 비용: 추가 비용 없음\n:::\n::: col\n- **안 2. 주 2일 정례화 + 팀별 협업일 지정**\n  (1) 장점: 회의를 협업일에 모을 수 있다\n  (2) 단점: 팀마다 협업일 합의가 필요하다\n  (3) 비용: 회의실 예약 체계 개편 약 4천만 원\n:::\n::::", 8);
      intact(b.shapes, "회의실 예약 체계", "4천만 원");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a title that wraps never leaves one word on its last line", () => {
    const dir = work();
    try {
      const ems = (s) => [...s].reduce((a, ch) => a + (/\s/u.test(ch) ? 0.28 : /[가-힣]/u.test(ch) ? 0.94 : /[A-Z0-9%]/u.test(ch) ? 0.62 : 0.52), 0);
      writeFileSync(join(dir, "e.md"), "---\ntonality: atlas\ntitle: Pilot\n---\n\n---\nlayout: closing-ask\n\n## We ask the board to approve the second pilot budget before the November planning review\n\n- Next step: a decision memo on 4 November\n---\n");
      const decks = ["atlas", "studio", "signal", "ledger"].map((t) => [t, displayDeck(dir, t, undefined, `w-${t}`), 6])
        .concat([["atlas-en", displayDeck(dir, "atlas", join(dir, "e.md"), "w-en"), 0], ["studio-en", displayDeck(dir, "studio", join(dir, "e.md"), "w-en2"), 0]]);
      for (const [t, d, i] of decks) {
        const title = d.shapes[i].find((s) => s.name.startsWith("title@"));
        const size = d.runs[i].find((s) => s.name === title.name).runs[0][1];
        // One line when the engine's measure (the estimate with its 6 % slack) fits the frame.
        if (ems(title.text.replace(/\s+/gu, " ")) * size * 1.06 <= title.w) continue;
        const set = lines(title.text);
        assert.ok(set.length >= 2, `${t}: a wrapping title has no balanced breaks: ${JSON.stringify(title.text)}`);
        assert.ok(set[set.length - 1].split(/\s+/u).length >= 2, `${t}: last line is one word: ${JSON.stringify(set)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Short content that stopped at the top of the body: each case is a fixture slide the render
  // audit flagged, built alone, and the gate must find no hollow band on it.
  // `density` pins the dial for a test about fill on short content (the compact default never steps type up).
  const oneSlide = (dir, name, tonality, body, density) => {
    writeFileSync(join(dir, `${name}.md`), `---\ntonality: ${tonality}\n${density ? `density: ${density}\n` : ""}title: 확인\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\n${body}\n---\n`);
    const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, `${name}.md`), "--pptx", join(dir, `${name}.pptx`)], { cwd: dir, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr + built.stdout);
    return { built, pptx: join(dir, `${name}.pptx`), shapes: shapesOf(join(dir, `${name}.pptx`)).slides[0] };
  };
  const hollow = (dir, pptx) => gateOn(dir, pptx, 1).filter((f) => ["OF-109", "sparse_slide"].includes(f.check));

  it("a short process under a top title runs as rows down the body, not as columns at its top", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "p", "signal", "layout: process\ntitle: top-rule\n\n## 세 단계로 하루 안에 끝난다\n\n- **1. 수거** 저녁 8시까지 문 앞에서 수거\n- **2. 세탁** 제휴 세탁소에서 당일 처리, 품질 사진 기록\n- **3. 배송** 다음 날 저녁 9시 전 문 앞 배송", 8);
      const nums = shapes.filter((s) => /^[123]$/u.test(s.text)).sort((a, b) => a.y - b.y);
      assert.equal(nums.length, 3);
      assert.ok(nums[2].y - nums[0].y > 200 && Math.abs(nums[2].x - nums[0].x) < 1, JSON.stringify(nums.map((n) => [n.x, n.y])));
      assert.deepEqual(hollow(dir, pptx), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a short reference list spreads its entries down to the body floor", () => {
    const dir = work();
    try {
      const { pptx } = oneSlide(dir, "r", "ledger", "layout: references-appendix\n\n## 붙임: 자료 출처\n\n- [1] 예시 기업 내부 결산 자료, 2026년 3분기 (예시)\n- [2] 예시 업계 협회 분기 통계, 2026년 9월 발표 (예시)\n- [3] 원자재 시세 공개 자료, 2026년 7-9월 평균 (예시)\n- [4] 영업이익률: 영업이익을 매출로 나눈 값\n- [5] 계획 대비: 연초 사업 계획의 분기 목표와 비교한 값");
      assert.deepEqual(hollow(dir, pptx), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a few headed points in a text column become rows, the head beside its point, spread down the body", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "c", "ledger", "layout: content\n\n## 재택근무를 주 2일로 정례화하되, 팀별 협업일은 지정한다\n\n- **근거** 시범 운영 1년 동안 월평균 이용률 78%, 업무 만족도 4.1점으로 제도는 자리 잡았다\n- **문제** 불편 사항의 64%가 회의 일정 조율과 대면 협업 부족에 몰렸다\n- **요청** 안 2 채택과 회의실 예약 체계 개편 예산 4천만 원을 10월 중 결정", 8);
      const head = shapes.find((s) => s.text === "근거");
      const point = shapes.find((s) => s.text.startsWith("시범 운영"));
      assert.ok(head && point && point.x > head.x + head.w - 1 && Math.abs(point.y - head.y) < 8, JSON.stringify(shapes.map((s) => [s.text.slice(0, 8), s.x, s.y])));
      assert.deepEqual(hollow(dir, pptx), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a three-row comparison holds the body without inflating its type", () => {
    const dir = work();
    try {
      for (const [t, body] of [["atlas", "layout: comparison\n\n## 같은 거실, 다른 바닥 면적\n\n:::: columns 1fr 1fr\n::: col\n- **일반 식탁**\n  (1) 상시 차지하는 바닥 1.2㎡\n  (2) 의자 네 개를 따로 둔다\n  (3) 운동할 바닥은 남지 않는다\n:::\n::: col\n- **접이식 가구**\n  (1) 접었을 때 바닥 0.2㎡\n  (2) 의자 두 개는 선반 안에 들어간다\n  (3) 접으면 1.0㎡의 바닥이 생긴다\n:::\n::::"],
        ["paper", "layout: comparison\n\n## Contributions and limits\n\n:::: columns 1fr 1fr\n::: col\n- **Contributions**\n  (1) A 50% conversion gain at equal reactor volume\n  (2) A feed schedule that needs no new equipment\n  (3) Results repeated in three runs per feed rate\n:::\n::: col\n- **Limits**\n  (1) One temperature and one catalyst tested\n  (2) Pilot scale only; heat removal at full scale is untested\n  (3) Feed rates above 2.0 L/min not covered\n:::\n::::"]]) {
        const { pptx } = oneSlide(dir, `k-${t}`, t, body, 8);
        assert.deepEqual(hollow(dir, pptx), [], t);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a table's takeaways under it stand midway in the room the table leaves, not at its foot", () => {
    const dir = work();
    try {
      const { pptx } = oneSlide(dir, "t", "gazette", "layout: table-insight\ntitle: top-rule\n\n## 지연·중단 과제와 담당\n\n| 과제 | 상태 | 원인 | 담당 | 해소 예정 |\n|---|---|---|---|---|\n| 결제 연동 | 지연 | 외부 결제사 시험 환경 지연 | 예시 결제파트 | 10월 14일 |\n| 정산 보고서 | 지연 | 요구사항 변경 | 예시 재무파트 | 10월 7일 |\n| 구 시스템 자료 이관 | 중단 | 보관 규정 검토 중 | 예시 법무파트 | 미정 |\n\n> 표 2. 9월 말 지연·중단 과제 (예시)\n\n- 지연 두 건은 10월 중 해소 예정이고, 중단 한 건은 보관 규정 결론을 기다린다\n- 결제 연동이 가장 늦게 해소된다 (10월 14일)");
      assert.deepEqual(hollow(dir, pptx), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("headed groups of sub-points on the reading ramp run in two columns when one measure leaves the slide sparse", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "g", "gazette", "layout: content\ntitle: top-rule\n\n## 검토 배경: 시범 운영 1년 동안 이용률은 높았고 불편은 협업에 몰렸다\n\n- **시범 운영 개요**\n  (1) 대상: 본사 4개 본부 612명, 2025년 10월부터 12개월\n  (2) 방식: 주 1-3일 자율 선택, 사전 신청제\n- **주요 결과**\n  (1) 월평균 이용률 78%, 본부 간 편차 최대 21%p\n  (2) 업무 만족도 3.4점 → 4.1점 (5점 척도)\n  (3) 불편 사항의 64%가 회의 일정 조율과 대면 협업 부족\n- **시사점**\n  (1) 제도 자체보다 협업일 운영 방식이 성패를 가른다");
      const xs = new Set(shapes.filter((s) => /^(시범 운영 개요|주요 결과|시사점)$/u.test(s.text)).map((s) => Math.round(s.x)));
      assert.equal(xs.size, 2, JSON.stringify(shapes.map((s) => [s.text.slice(0, 10), s.x, s.y])));
      assert.deepEqual(hollow(dir, pptx), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a list marker is a dot drawn beside its line, not a text frame of its own", () => {
    const dir = work();
    try {
      const { shapes } = oneSlide(dir, "b", "signal", "layout: text-column\ntitle: top-rule\n\n## 주문 한 건에서 남는 몫은 4,300원이다\n\n- 고객 결제 2만 1천 원 가운데 60%는 제휴 세탁소에 정산된다\n- 플랫폼 몫 4,300원은 수거·배송 비용 4,100원과 비슷한 규모다");
      assert.ok(!shapes.some((s) => s.text.trim() === "•"), JSON.stringify(shapes.map((s) => s.text)));
      const line = shapes.find((s) => s.text.startsWith("고객 결제"));
      const dot = shapes.find((s) => !s.text && s.fill === "C8361A" && s.w <= 8 && s.h <= 8 && s.x < line.x && s.y >= line.y && s.y <= line.y + 30);
      assert.ok(dot, JSON.stringify(shapes.map((s) => [s.text.slice(0, 6), s.fill, s.x, s.y, s.w, s.h])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a deck short of distinct layouts moves a data slide to a title that adds one (OF-111)", () => {
    const dir = work();
    try {
      // The pitch under Paper, whose fill-chosen titles leave four layouts where five are needed (since
      // checkpoint D round 2 Signal reaches five from fill alone).
      writeFileSync(join(dir, "p.md"), readFileSync(join(fixtures, "deck-pitch-signal.md"), "utf8").replace("tonality: signal\n", "tonality: paper\n"));
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "sample-image-a.png"), png(480, 270, [90, 120, 150]));
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "p.md"), "--pptx", join(dir, "p.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      assert.match(built.stdout, /^variety: slide \d+ drawn under \S+ so the deck carries \d+ layouts$/mu, built.stdout);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "p.pptx")], dir).stdout);
      assert.deepEqual(gate.craft_floor.findings.filter((f) => f.check === "OF-111"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Checkpoint B round 2 (spec-v2 Amendments 5): labels, restrained numbers, Pretendard, density ──
  const declarative = (texts) => {
    // A script file, not -c: the runtime bootstrap may re-run the interpreter with sys.argv.
    const dir = work();
    try {
      writeFileSync(join(dir, "probe.py"), `import json, sys\nsys.path.insert(0, sys.argv[1])\nimport craft_extras\nprint(json.dumps([craft_extras.declarative_title(t) for t in json.loads(sys.stdin.read())]))\n`);
      const probe = spawnSync(runtimePython, ["-B", join(dir, "probe.py"), join(pptxRoot, "scripts")], { encoding: "utf8", input: JSON.stringify(texts) });
      assert.equal(probe.status, 0, probe.stderr);
      return JSON.parse(probe.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("OF-114 reads a sentence title as declarative and a topic label as a label", () => {
    const claims = ["맞벌이 가구는 빨래에 주말 반나절을 쓴다", "18개월 운영 자금 30억 원을 요청드립니다", "매출은 다섯 분기 연속 늘었다",
      "재주문 비율 절반 돌파함", "결제 연동 일정 확정됨", "전년보다 매출이 늘었어요", "계획보다 4%p 뒤처져 있음",
      "Revenue grew 12% in Q2", "Churn fell in Q3", "The staged feed doubles conversion.", "Retention is the constraint"];
    const labels = ["분기별 매출 추이", "수도권 세탁 대행 시장 규모와 온라인 비중", "운영 자금 30억 원 요청 내역 (18개월)", "사업 개요와 수요 전망",
      "부가세 포함 단가", "주요 이슈", "3분기 경영 실적 보고", "Conversion by feed rate, runs 1-12", "Method notes", "Data sources and definitions",
      "Quarterly revenue and margin, 2025-2026", "왜 지금인가?"];
    assert.deepEqual(declarative(claims), claims.map(() => true), JSON.stringify(claims));
    assert.deepEqual(declarative(labels), labels.map(() => false), JSON.stringify(labels));
  });

  it("OF-114 fails a declarative title or cover subtitle under a tonality, with a hint, and passes labels", () => {
    const dir = work();
    try {
      const body = (title, sub) => `---\ntonality: ledger\ntitle: 확인\n${sub ? `subtitle: ${sub}\n` : ""}notice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: cover-typographic\n\n# 수거·배송 세탁 서비스 투자 제안\n---\n\n---\nlayout: table-insight\n\n## ${title}\n\n| 항목 | 금액 (원) | 비중 |\n|---|---|---|\n| 고객 결제 | 21,000 | 100% |\n| 세탁소 정산 | 12,600 | 60% |\n| 수거·배송 | 4,100 | 20% |\n| 플랫폼 몫 | 4,300 | 20% |\n\n> 표 1. 주문 한 건당 수익 구조 (예시 데이터)\n\n- 플랫폼 몫 4,300원은 수거·배송 비용 4,100원과 비슷한 규모다\n- 고객 결제의 60%는 제휴 세탁소에 정산된다\n---\n`;
      const gate = (name, md) => {
        writeFileSync(join(dir, `${name}.md`), md);
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, `${name}.md`), "--pptx", join(dir, `${name}.pptx`)], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr + built.stdout);
        const run = py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, `${name}.pptx`)], dir);
        return { status: run.status, report: JSON.parse(run.stdout) };
      };
      const bad = gate("bad", body("주문 한 건에서 남는 몫은 4,300원이다", "동네 세탁을 하루 안에 돌려준다"));
      const of114 = bad.report.craft_floor.findings.filter((f) => f.check === "OF-114" && f.severity === "HIGH");
      assert.ok(of114.some((f) => f.slide === 2), JSON.stringify(of114));
      assert.ok(of114.some((f) => f.slide === 1 && /subtitle/u.test(f.detail)), JSON.stringify(of114));
      assert.ok(bad.report.failure_reasons.some((r) => r.startsWith("craft OF-114") && r.includes(" — ")), JSON.stringify(bad.report.failure_reasons));
      assert.equal(bad.status, 1);
      const good = gate("good", body("주문 한 건당 수익 구조", "수도권 6개 구 운영 실적과 자금 계획"));
      assert.deepEqual(good.report.craft_floor.findings.filter((f) => f.check === "OF-114"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every tonality sets its deck in Pretendard unless the source asks for the A2Z faces", () => {
    const dir = work();
    try {
      const faces = (pptx) => {
        const probe = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from pptx import Presentation
p = Presentation(sys.argv[1])
names = set()
for s in p.slides:
    for sh in s.shapes:
        if sh.has_text_frame:
            for para in sh.text_frame.paragraphs:
                for r in para.runs:
                    if r.text.strip() and r.font.name: names.add(r.font.name)
print(json.dumps(sorted(names)))
`, pptx], { encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        return JSON.parse(probe.stdout);
      };
      for (const t of ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"]) {
        const d = displayDeck(dir, t, undefined, t);
        const used = faces(d.pptx);
        assert.ok(used.length && used.every((f) => f === "Pretendard"), `${t}: ${JSON.stringify(used)}`);
      }
      writeFileSync(join(dir, "a2z.md"), readFileSync(join(fixtures, "deck-display.md"), "utf8").replace("tonality: ledger\n", "tonality: signal\nfaces: a2z\n"));
      const a2z = displayDeck(dir, "signal", join(dir, "a2z.md"), "a2z");
      assert.ok(faces(a2z.pptx).some((f) => f.startsWith("에이투지체")), JSON.stringify(faces(a2z.pptx)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("numbers stay within two steps of the body: no hero step, no figure above the title size", () => {
    const dir = work();
    try {
      for (const t of ["signal", "ledger", "studio", "gazette", "chalk", "night"]) {
        const { runs } = displayDeck(dir, t, undefined, t);
        runs.forEach((slide, i) => {
          for (const shape of slide) {
            for (const [text, size] of shape.runs) {
              assert.ok(size == null || size <= 44, `${t} slide ${i + 1}: "${text}" at ${size} pt`);
              const figure = /^[\s\d.,:%/+\-▲▼()]*\d[\s\d.,:%/+\-▲▼()]*(?:[조억만천]?\s?(?:원|건|명|개|곳|일|월|년|%p?))?$/u.test(text.trim());
              assert.ok(!figure || size == null || size <= 26, `${t} slide ${i + 1}: figure "${text}" at ${size} pt`);
            }
          }
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a KPI row carries each figure's basis, and a big number with several figures is a data panel with their basis", () => {
    const dir = work();
    try {
      const kpi = oneSlide(dir, "k", "ledger", "layout: kpi-row\n\n## 출시 6개월 주문 지표\n\n| 월 주문 | 재주문 비율 | 평균 객단가 |\n|---|---|---|\n| 1만 8천 건 | 54% | 2만 1천 원 |\n| 4월 대비 2.9배 | 목표 50% | 전월 대비 +4% |\n\n> 2026년 9월 기준, 예시 주문 시스템 (예시)\n\n- 재주문 비율이 목표 50%를 넘었다\n- 객단가는 셔츠 묶음 주문이 늘며 올랐다", 8);
      for (const basis of ["4월 대비 2.9배", "목표 50%", "전월 대비 +4%"]) assert.ok(kpi.shapes.some((s) => s.text.includes(basis)), `${basis}: ${JSON.stringify(kpi.shapes.map((s) => s.text))}`);
      assert.deepEqual(gateOn(dir, kpi.pptx, 1), []);
      const big = oneSlide(dir, "b", "signal", "layout: big-number\n\n## 수도권 세탁 대행 시장 규모와 온라인 비중\n\n| 연간 시장 규모 | 앱 주문 비중 | 수거·배송 제공 세탁소 |\n|---|---|---|\n| 1조 2천억 원 | 6% | 20% |\n| 2025년 기준 | 전년 4% | 다섯 곳 중 한 곳 |\n\n> 출처: 예시 업계 조사, 2026 (예시)\n\n- 대부분의 주문은 아직 매장 방문으로 들어온다\n- 앱 주문 비중이 1년 사이 2%p 늘었다", 8);
      const runs = runsOf(big.pptx)[0];
      for (const v of ["1조 2천억 원", "6%", "20%"]) {
        const r = runs.find((s) => s.text === v);
        assert.ok(r, `${v}: ${JSON.stringify(runs.map((s) => s.text))}`);
        assert.ok(r.runs[0][1] <= 26, `${v} at ${r.runs[0][1]} pt`);
      }
      for (const basis of ["2025년 기준", "전년 4%", "다섯 곳 중 한 곳"]) assert.ok(big.shapes.some((s) => s.text.includes(basis)), `${basis}: ${JSON.stringify(big.shapes.map((s) => s.text))}`);
      assert.deepEqual(gateOn(dir, big.pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every pack sits at the dense end: density 10 on the compact grid and ramp, above the readable floor", () => {
    const registryFile = join(pptxRoot, "scripts", "lib", "template-registry.js");
    const probe = spawnSync(process.execPath, ["-e", `const r = require(${JSON.stringify(registryFile)});
console.log(JSON.stringify(["atlas","chalk","gazette","ledger","night","paper","signal","studio"].map((id) => { const t = r.loadTonality(id); return [id, t.pack.dials.density, t.pack.tok.sizes.body, t.pack.hero, t.pack.grid.name, t.pack.grid.margin]; })));
const g = r.loadTonality("ledger").pack;
console.log(JSON.stringify({ sizes: g.tok.sizes, sum: 2 * g.grid.margin + 12 * g.grid.col + 11 * g.grid.gutter }));`], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const [packs, ledger] = probe.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(packs, ["atlas", "chalk", "gazette", "ledger", "night", "paper", "signal", "studio"].map((id) => [id, 10, 13, false, "compact", 24]));
    // The readable floor (spec-v2 Amendments 6): body 12 pt or more, captions and sources 9, table cells 11.
    assert.ok(ledger.sizes.body >= 12 && ledger.sizes.source >= 9 && ledger.sizes.label >= 11, JSON.stringify(ledger.sizes));
    assert.equal(ledger.sum, 960);
  });

  // ── Checkpoint B round 3 (spec-v2 Amendments 6): denser pages ──
  it("on the compact step a one-line top title sits close over its rule and the body starts higher", () => {
    const resolver = join(pptxRoot, "scripts", "lib", "grid-resolver.js");
    const probe = spawnSync(process.execPath, ["-e", `const G = require(${JSON.stringify(resolver)});
const out = {};
for (const d of [9, 10]) {
  const tok = G.densityTokens(d);
  const grid = G.makeGrid("16:9", tok.grid);
  const f = G.treatmentGeometry("top-rule", { grid, sizes: tok.sizes, title: "분기별 매출 추이", decoration: new Set(["hairline-rule"]), tight: tok.tight });
  out[d] = { titleBottom: f.title.y + f.title.h, rule: f.decor[0].y, body: f.body.y };
}
console.log(JSON.stringify(out));`], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const out = JSON.parse(probe.stdout);
    assert.equal(out[9].body, 120);
    assert.ok(out[10].body <= 96, JSON.stringify(out));
    assert.ok(out[10].rule >= out[10].titleBottom && out[10].rule <= out[10].titleBottom + 24, JSON.stringify(out));
  });

  it("Ledger at density 9 keeps five distinct layouts on the briefing deck (OF-111): the engine reads partitions as the check does", () => {
    const dir = work();
    try {
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(fixtures, "deck-briefing-ledger.md"), "--pptx", join(dir, "b.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      const gate = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "b.pptx")], dir).stdout);
      assert.deepEqual(gate.craft_floor.findings.filter((f) => f.check === "OF-111"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a KPI row holds up to six figures with their basis", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "k6", "ledger", "layout: kpi-row\n\n## 3분기 경영 지표\n\n| 매출 | 영업이익 | 영업이익률 | 영업현금흐름 | 수주 잔고 | 순차입금 |\n|---|---|---|---|---|---|\n| 1,184억 원 | 110억 원 | 9.3% | 96억 원 | 2,310억 원 | 412억 원 |\n| 계획 대비 +3.9% | 계획 대비 +10.0% | 계획 대비 +0.5%p | 전년 동기 81억 원 | 전분기 대비 +4% | 전분기 대비 −28억 원 |\n\n> 2026년 3분기, 내부 결산 자료 (예시)\n\n- 매출과 영업이익이 모두 계획을 넘었다\n- 수주 잔고는 매출 약 2분기분이다");
      for (const v of ["1,184억 원", "110억 원", "9.3%", "96억 원", "2,310억 원", "412억 원", "전분기 대비 −28억 원"]) assert.ok(shapes.some((s) => s.text === v), `${v}: ${JSON.stringify(shapes.map((s) => s.text))}`);
      assert.deepEqual(gateOn(dir, pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a 2x2 matrix keeps its takeaways beside the quadrants and sets each cell as a head over its details", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "m", "ledger", "layout: matrix-2x2\n\n## 원가 상승 품목별 대응 우선순위\n\n| 영향 \\ 대응 난이도 | 쉬움 | 어려움 |\n|---|---|---|\n| 큼 | 포장재 단가 재협상 · 연 6억 원 · 즉시 · 구매팀 | 원자재 장기 계약 · 연 14억 원 · 12월 확정 · 구매팀 |\n| 작음 | 물류 경로 통합 · 연 3억 원 · 즉시 · 물류팀 | 설비 교체 · 연 2억 원 · 보류 · 생산팀 |\n\n> 표 2. 원가 상승 품목별 대응 우선순위 (예시)\n\n- 즉시 대응하는 두 항목의 연간 영향액은 합계 9억 원이다\n- 원자재 장기 계약은 12월에 안을 확정한다\n- 설비 교체는 3월에 다시 검토한다");
      for (const t of ["즉시 대응하는 두 항목의 연간 영향액은 합계 9억 원이다", "설비 교체는 3월에 다시 검토한다"]) assert.ok(shapes.some((s) => s.text.replace(/\s+/gu, " ").includes(t)), `${t}: ${JSON.stringify(shapes.map((s) => s.text))}`);
      const head = shapes.find((s) => s.text === "포장재 단가 재협상");
      const detail = shapes.find((s) => /연 6억 원/u.test(s.text) && !/재협상/u.test(s.text));
      assert.ok(head && detail && detail.y > head.y, JSON.stringify(shapes.map((s) => [s.text, s.y])));
      assert.deepEqual(gateOn(dir, pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a source or note line closes a data slide as a strip on the body floor, not as a takeaway", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "s", "ledger", "layout: table-insight\ntitle: top-rule\n\n## 사업부별 3분기 매출\n\n| 사업부 | 매출 (억 원) | 전년 대비 |\n|---|---|---|\n| 소재 | 512 | +41% |\n| 부품 | 438 | +23% |\n| 서비스 | 234 | −4% |\n| 합계 | 1,184 | +23% |\n\n> 표 1. 사업부별 매출 (예시)\n\n- 소재 사업부가 증가분의 69%를 만들었다\n- 서비스 사업부만 매출이 줄었다\n- 출처: 예시 기업 내부 결산 자료(2026년 3분기)\n- 주: 전년 대비는 2025년 3분기와 비교한 값");
      const src = shapes.find((s) => s.text.startsWith("출처:"));
      const note = shapes.find((s) => s.text.startsWith("주:"));
      assert.ok(src && note, JSON.stringify(shapes.map((s) => s.text)));
      assert.ok(src.y + src.h >= 470 && note.y + note.h >= 470 && src.y + src.h <= 492, JSON.stringify([src, note]));
      assert.ok(Math.abs(src.x - 24) < 1, `strip starts at the margin: ${src.x}`);
      assert.ok(!shapes.some((s) => s.w <= 6 && s.h <= 6 && Math.abs(s.y + s.h / 2 - (src.y + 8)) < 6), "no list marker on a strip line");
      assert.deepEqual(gateOn(dir, pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("on the compact step a chart is paired with a compact table of its values", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "c", "ledger", "layout: chart-insight\n\n## 분기별 매출 실적과 계획 추이\n\n| 분기 | 매출 실적 (억 원) | 매출 계획 (억 원) |\n|---|---|---|\n| 25년 2Q | 921 | 900 |\n| 25년 3Q | 962 | 940 |\n| 25년 4Q | 1,015 | 990 |\n| 26년 1Q | 1,071 | 1,040 |\n| 26년 2Q | 1,120 | 1,090 |\n| 26년 3Q | 1,184 | 1,140 |\n\n> 분기별 매출 실적과 계획 (예시 데이터)\n\n- 매출은 다섯 분기 연속 늘었다\n- 여섯 분기 모두 계획을 넘었다");
      assert.ok(shapes.some((s) => s.chart), "a chart");
      const table = shapes.find((s) => s.table);
      assert.ok(table, JSON.stringify(shapes.map((s) => s.name)));
      const chart = shapes.find((s) => s.chart);
      // Beside the chart: in the takeaway column, or in a side title's rail under the takeaways.
      assert.ok(table.x >= chart.x + chart.w || table.x + table.w <= chart.x, "the table stands beside the chart");
      assert.deepEqual(gateOn(dir, pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a split-image cover crops its picture to the box and keeps the picture's aspect", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "a.png"), png(480, 270, [90, 120, 150]));
      writeFileSync(join(dir, "c.md"), "---\ntonality: studio\ntitle: 확인\n---\n\n---\nlayout: cover-split-image\n\n# 수거·배송 세탁 서비스 투자 제안\n---\n\n---\nlayout: image-split\n\n## 주문 화면 예시\n\n![도 1. 주문 화면 | 출처: 예시 이미지](assets/a.png)\n\n- 앱에서 맡기면 문 앞에서 수거한다\n---\n");
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "c.md"), "--pptx", join(dir, "c.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      const probe = spawnSync(runtimePython, ["-B", "-c", `
import json, sys
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
p = Presentation(sys.argv[1])
pic = next(sh for sh in p.slides[0].shapes if sh.shape_type == MSO_SHAPE_TYPE.PICTURE)
w = pic.width * (1 / max(1e-6, 1 - pic.crop_left - pic.crop_right))
h = pic.height * (1 / max(1e-6, 1 - pic.crop_top - pic.crop_bottom))
print(json.dumps({"aspect": w / h}))
`, join(dir, "c.pptx")], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      assert.ok(Math.abs(JSON.parse(probe.stdout).aspect - 480 / 270) < 0.02, probe.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a native number word stays with its counter, a prefix with its figure, and a separator with the word before it when a line breaks", () => {
    const resolver = join(pptxRoot, "scripts", "lib", "grid-resolver.js");
    const probe = spawnSync(process.execPath, ["-e", `const G = require(${JSON.stringify(resolver)});
const out = [];
for (let w = 6; w <= 16; w += 0.5) {
  out.push(G.keepLines("과제 한 곳에서 지연이 생겼고 매출은 다섯 분기 연속 늘었으며 세 곳이 남았다", w, 12));
  out.push(G.balanceLines("매출은 다섯 분기 연속 증가", 2, w));
  out.push(G.keepLines("포장재 단가 재협상 · 연 6억 원 · 즉시", w, 12));
}
console.log(JSON.stringify(out));`], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    for (const set of JSON.parse(probe.stdout)) {
      for (const line of set.split("\n")) {
        assert.ok(!/(^|\s)(한|두|세|네|다섯|여섯|연|월|약|총)$/u.test(line), `split after a number word or prefix: ${JSON.stringify(set)}`);
        assert.ok(!/^·/u.test(line), `a line starts with a separator: ${JSON.stringify(set)}`);
      }
    }
  });

  it("J3: a line never breaks inside a short parenthetical such as (▲ +3.9%)", () => {
    const resolver = join(pptxRoot, "scripts", "lib", "grid-resolver.js");
    const probe = spawnSync(process.execPath, ["-e", `const G = require(${JSON.stringify(resolver)});
const out = [];
for (let w = 6; w <= 16; w += 0.5) {
  out.push(G.keepLines("1,184억 원으로 계획보다 44억 원(▲ +3.9%) 많았다", w, 12));
  out.push(G.keepLines("Revenue beat the plan by 44 (▲ +3.9 %) this quarter", w, 12));
  out.push(G.balanceLines("영업이익 110억 원(▲ +10.0%)", 2, w));
}
console.log(JSON.stringify(out));`], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    for (const set of JSON.parse(probe.stdout)) {
      for (const line of set.split("\n")) assert.ok(!/\([^)]*$/u.test(line), `a break inside a short parenthetical: ${JSON.stringify(set)}`);
    }
  });

  it("a section without an agenda carries the opened slides' first lines, so the page is not a title alone", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "m.md"), "---\ntonality: ledger\ntitle: Churn review\n---\n\n---\nlayout: text-column\n\n## Churn by month, Q3\n\n- Month-two churn fell to 5.0 % (sample)\n---\n\n---\nlayout: section\n\n# Method notes\n---\n\n---\nlayout: references-appendix\n\n## Data sources and definitions\n\n- [1] Billing system export, July-September (sample)\n- [2] Churn: share of subscribers who cancel in a month\n- [3] Cohort: subscribers by first billing month\n---\n");
      for (const t of ["ledger", "night"]) {
        const d = displayDeck(dir, t, join(dir, "m.md"), `m-${t}`);
        const section = d.shapes[1].filter((s) => !s.name.startsWith("lit-notice") && s.text);
        assert.ok(section.some((s) => s.text.includes("Billing system export")), `${t}: ${JSON.stringify(section.map((s) => s.text))}`);
        const bottom = Math.max(...section.map((s) => s.y + s.h));
        assert.ok(bottom >= 380, `${t}: text ends at ${bottom}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a contact-split closing's field carries the total of its amounts under the keys", () => {
    const dir = work();
    try {
      const d = displayDeck(dir, "studio");
      const slide = d.shapes[6];
      const field = slide.find((s) => s.fill === "141414" && s.x > 400 && Math.round(s.x + s.w) === 960);
      assert.ok(field, JSON.stringify(slide.map((s) => [s.text, s.fill])));
      const total = slide.find((s) => /합계/u.test(s.text) && s.text.includes("30억 원"));
      assert.ok(total && total.x >= field.x && total.y > field.y + field.h * 0.5, JSON.stringify(slide.map((s) => [s.text, s.x, s.y])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a numeric column with a dash for a missing value is still right-aligned (OF-103)", () => {
    const dir = work();
    try {
      const t = oneSlide(dir, "dash", "ledger", "layout: table-insight\n\n## 사업부별 3분기 매출과 이익 증가분\n\n| 사업부 | 매출 (억 원) | 전년 대비 | 이익 증가분 (억 원) |\n|---|---|---|---|\n| 소재 | 512 | ▲ +41% | +18 |\n| 부품 | 438 | ▲ +23% | +8 |\n| 서비스 | 234 | ▼ −4% | 0 |\n| 전년 3분기 | 962 | — | — |\n\n> 표 1. 사업부별 3분기 실적 (예시 데이터)\n\n- 소재 사업부가 이익 증가분 26억 원 중 18억 원을 만들었다\n- 서비스 사업부만 매출이 줄었다");
      assert.deepEqual(gateOn(dir, t.pptx, 1).filter((f) => f.check === "OF-103"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a crowded chart keeps its labels apart: a zero-based axis, values on the axis instead of colliding labels, slanted categories", () => {
    const dir = work();
    try {
      const chartXml = (pptx) => {
        const probe = spawnSync(runtimePython, ["-B", "-c", "import sys, zipfile, re\nz = zipfile.ZipFile(sys.argv[1])\nprint(''.join(z.read(n).decode() for n in z.namelist() if re.match(r'ppt/charts/chart\\d+\\.xml', n)))", pptx], { encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        return probe.stdout;
      };
      const crowded = oneSlide(dir, "crowd", "gazette", "layout: chart-insight\ntitle: side-rail\n\n## 분기별 매출 실적과 계획 추이\n\n::: chart type=column unit=\"억 원\"\n| 분기 | 매출 실적 (억 원) | 매출 계획 (억 원) |\n|---|---|---|\n| 24년 1Q | 702 | 690 |\n| 24년 2Q | 731 | 720 |\n| 24년 3Q | 760 | 745 |\n| 24년 4Q | 802 | 790 |\n| 25년 1Q | 845 | 830 |\n| 25년 2Q | 921 | 900 |\n| 25년 3Q | 962 | 940 |\n| 25년 4Q | 1,015 | 990 |\n| 26년 1Q | 1,071 | 1,040 |\n| 26년 2Q | 1,120 | 1,090 |\n| 26년 3Q | 1,184 | 1,140 |\n> 분기별 매출 실적과 계획 (예시 데이터)\n:::\n\n- 매출은 열한 분기 연속 늘었다\n- 3분기 매출은 계획을 4% 넘었다", 8);
      const x = chartXml(crowded.pptx);
      assert.match(x, /<c:min val="0"\/>/u, "a value axis of positive data starts at zero");
      assert.doesNotMatch(x, /<c:showVal val="1"\/>/u, "paired values too wide for their bars are read off the axis");
      assert.match(x, /<c:valAx>[\s\S]*?<c:delete val="0"\/>/u, "the value axis is shown when the labels are off");
      assert.match(x, /<c:catAx>[\s\S]*?<a:bodyPr rot="-2700000"/u, "category labels wider than their slot are slanted");
      const roomy = oneSlide(dir, "roomy", "ledger", "layout: full-chart\n\n## 연간 매출 비교\n\n::: chart type=column unit=\"억 원\"\n| 연도 | 매출 |\n|---|---|\n| 2025 | 3,980 |\n| 2026 | 4,420 |\n> 연간 매출 (예시 데이터)\n:::\n\n- 2026년 매출은 전년보다 11% 늘었다");
      assert.match(chartXml(roomy.pptx), /<c:showVal val="1"\/>/u, "labels stay where they fit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a line chart of several series reads its values off the axis, and a horizontal bar chart keeps its category labels level", () => {
    const dir = work();
    try {
      const chartXml = (pptx) => {
        const probe = spawnSync(runtimePython, ["-B", "-c", "import sys, zipfile, re\nz = zipfile.ZipFile(sys.argv[1])\nprint(''.join(z.read(n).decode() for n in z.namelist() if re.match(r'ppt/charts/chart\\d+\\.xml', n)))", pptx], { encoding: "utf8" });
        assert.equal(probe.status, 0, probe.stderr);
        return probe.stdout;
      };
      const line = chartXml(oneSlide(dir, "line", "night", "layout: content\n\n## 권역별 월간 응답 시간\n\n::: chart type=line unit=\"ms\"\n| 월 | 동부 | 서부 | 남부 |\n|---|---|---|---|\n| 1월 | 398 | 421 | 512 |\n| 2월 | 402 | 418 | 498 |\n| 3월 | 391 | 409 | 476 |\n> 권역별 응답 시간 (예시 데이터)\n:::\n출처: 예시 운영 기록").pptx);
      assert.doesNotMatch(line, /<c:showVal val="1"\/>/u, "three line series with value labels print them on top of each other");
      assert.match(line, /<c:valAx>[\s\S]*?<c:delete val="0"\/>/u, "the value axis is shown when the labels are off");
      const bar = chartXml(oneSlide(dir, "bar", "night", "layout: content\n\n## 원인별 장애 건수\n\n::: chart type=bar unit=\"건\"\n| 원인 | 건수 |\n|---|---|\n| 배포 과정의 설정 변경 실수 | 6 |\n| 외부 결제 의존 서비스 지연 | 5 |\n| 주말 처리 용량 부족 | 3 |\n| 신규 코드 결함 | 3 |\n> 원인별 장애 건수 (예시 데이터)\n:::\n출처: 예시 장애 기록").pptx);
      assert.match(bar, /<c:barDir val="bar"\/>/u);
      assert.doesNotMatch(bar.slice(bar.indexOf("<c:catAx>"), bar.indexOf("</c:catAx>")), /rot="-2700000"/u, "category labels of a horizontal bar chart are slanted");
      assert.match(bar, /<c:showVal val="1"\/>/u, "four single bars keep their values");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("horizontal bars with negative values set their category labels at the axis minimum, clear of the bars", () => {
    const dir = work();
    try {
      const { pptx } = oneSlide(dir, "neg", "ledger", "layout: content\n\n## 요인별 영업이익 증감\n\n::: chart type=bar unit=\"억 원\"\n| 요인 | 증감 (억 원) |\n|---|---|\n| 소재 고부가 제품 | 11 |\n| 부품 물량 | 6 |\n| 부품 단가 인하 | -2 |\n| 서비스 인건비 | -8 |\n> 요인별 영업이익 증감 (예시 데이터)\n:::\n출처: 예시 손익 자료");
      const xml = spawnSync("unzip", ["-p", pptx, "ppt/charts/chart1.xml"], { encoding: "utf8" }).stdout;
      assert.match(xml.slice(xml.indexOf("<c:catAx>"), xml.indexOf("</c:catAx>")), /<c:tickLblPos val="low"\/>/u, "category labels at the zero line sit on the negative bars");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a missing cell in a line chart is a gap in the line, never a point at zero", () => {
    const dir = work();
    try {
      const { pptx } = oneSlide(dir, "gap", "night", "layout: content\n\n## 가입 월별 잔존율\n\n::: chart type=line unit=\"%\"\n| 가입 월 | 30일 잔존 (%) | 90일 잔존 (%) |\n|---|---|---|\n| 3월 | 56.0 | 45.2 |\n| 4월 | 57.2 | 46.1 |\n| 5월 | 58.1 | 47.0 |\n| 6월 | 59.4 | — |\n| 7월 | 60.3 |  |\n> 가입 월별 잔존율 (예시 데이터)\n:::\n출처: 예시 분석 자료");
      const xml = spawnSync("unzip", ["-p", pptx, "ppt/charts/chart1.xml"], { encoding: "utf8" }).stdout;
      const late = xml.slice(xml.lastIndexOf("<c:ser>"));
      const points = [...late.slice(late.indexOf("<c:val>")).matchAll(/<c:pt idx="(\d)"><c:v>([^<]*)<\/c:v>/gu)].map((m) => [Number(m[1]), m[2]]);
      assert.deepEqual(points.filter(([i, v]) => i >= 3 && v !== ""), [], `the two missing 90-day values are drawn: ${JSON.stringify(points)}`);
      assert.match(xml, /<c:dispBlanksAs val="gap"\/>/u, "a blank must break the line, not join across it");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clustered horizontal bars too thin for a value label read off the axis, and a narrow horizontal bar keeps few, level axis numbers", () => {
    const dir = work();
    try {
      const chartXml = (pptx) => spawnSync("unzip", ["-Z1", pptx], { encoding: "utf8" }).stdout.split("\n").filter((n) => /^ppt\/charts\/chart\d+\.xml$/u.test(n)).sort()
        .map((n) => spawnSync("unzip", ["-p", pptx, n], { encoding: "utf8" }).stdout);
      const [pair] = chartXml(oneSlide(dir, "pair", "night", "layout: kpi-over-chart\n\n## 3분기 누수 탐지 실적\n\n| 탐지 건수 | 음향 감지 비중 | 평균 수리 기간 |\n|---|---|---|\n| 1,240건 | 38% | 2.4일 |\n| 2분기 1,010건 | 2분기 29% | 2분기 3.1일 |\n\n::: chart type=bar unit=\"건\"\n| 방법 | 2분기 | 3분기 |\n|---|---|---|\n| 고객 신고 | 410 | 380 |\n| 음향 감지기 | 290 | 470 |\n| 야간 유량 분석 | 180 | 250 |\n| 위성 조사 | 70 | 90 |\n| 순찰 | 60 | 50 |\n> 탐지 방법별 누수 건수 (예시 데이터)\n:::\n\n- 음향 감지기가 처음으로 가장 많은 누수를 찾았다\n출처: 예시 작업 지시 시스템").pptx);
      assert.doesNotMatch(pair, /<c:showVal val="1"\/>/u, "value labels of two thin bars per row touch each other");
      assert.match(pair, /<c:valAx>[\s\S]*?<c:delete val="0"\/>/u, "the value axis is shown in their place");
      const grid = chartXml(oneSlide(dir, "grid", "night", "layout: dashboard-grid\n\n## 활성화 단계, 안정성, 이용 시간\n\n::: chart type=bar unit=\"%\"\n| 단계 | 설치 대비 (%) |\n|---|---|\n| Install | 100 |\n| Account linked | 72 |\n| Identity verified | 58 |\n| First transfer | 47.5 |\n> 활성화 단계 (예시 데이터)\n:::\n\n::: chart type=line unit=\"%\"\n| 월 | 무충돌 세션 (%) |\n|---|---|\n| 7월 | 99.71 |\n| 8월 | 99.55 |\n| 9월 | 99.60 |\n> 무충돌 세션 (예시 데이터)\n:::\n\n::: chart type=column unit=\"분\"\n| 월 | 이용 시간 (분) |\n|---|---|\n| 7월 | 3.1 |\n| 8월 | 3.3 |\n| 9월 | 3.2 |\n> 이용 시간 중앙값 (예시 데이터)\n:::\n\n- 본인 인증 단계에서 설치의 14%p가 빠진다").pptx);
      const funnel = grid.find((x) => x.includes('<c:barDir val="bar"/>'));
      const unit = Number(funnel.match(/<c:valAx>[\s\S]*?<c:majorUnit val="([\d.]+)"\/>/u)?.[1]);
      // Long category names leave the axis a narrow strip; past four numbers there LibreOffice packs them edge to edge or slants them.
      assert.ok(unit > 0 && Math.ceil(100 / unit) + 1 <= 4, `value axis step ${unit} leaves ${Math.ceil(100 / unit) + 1} numbers across a narrow panel`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Checkpoint B round 3 leftovers ──
  it("a chart whose takeaways leave no room for a values column carries its values across, under the chart", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "v", "night", "layout: chart-insight\n\n## New subscriptions by month, Apr-Sep\n\n| Month | 2026 | 2025 |\n|---|---|---|\n| Apr | 3,120 | 2,610 |\n| May | 3,340 | 2,700 |\n| Jun | 3,410 | 2,820 |\n| Jul | 3,780 | 3,050 |\n| Aug | 4,050 | 3,240 |\n| Sep | 4,460 | 3,510 |\n\n> New subscriptions per month, 2026 vs same month 2025 (sample data)\n\n- New subscriptions rose every month of Q3: 3,780 to 4,460.\n- September is the highest month on record, 27% above September 2025.\n- Q3 total was 12,290 vs 9,800 in Q3 2025 (+25%); every month beat its 2025 value.\n- The annual plan took 38% of Q3 new subscriptions.\n- Source: billing system export, Apr-Sep 2025 and 2026 (sample)\n- Note: a new subscription is a first paid invoice; free trials excluded");
      const chart = shapes.find((s) => s.chart);
      const table = shapes.find((s) => s.table);
      assert.ok(chart && table, JSON.stringify(shapes.map((s) => [s.name, s.text.slice(0, 20)])));
      // Months across, one row a series: as wide as the chart, under it.
      assert.ok(table.y >= chart.y + chart.h - 1 && Math.abs(table.x - chart.x) < 1 && table.h <= 100, JSON.stringify([chart, table]));
      assert.deepEqual(gateOn(dir, pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a comparison keeps a criteria column for long labels and for one row whose labels differ", () => {
    const dir = work();
    try {
      const critOf = (shapes, label) => shapes.find((s) => s.text === label);
      const en = oneSlide(dir, "q", "ledger", "layout: comparison\n\n## Q3 target vs actual\n\n:::: columns 1fr 1fr\n::: col\n- **Target**\n  (1) Subscribers: 46,000 paying by 30 Sep, +16% on the Q2 base\n  (2) Churn: 3.0% a month on average across July-September\n  (3) Payback: 8 months, acquisition cost recovered from gross margin\n  (4) New subscriptions: 11,500 in the quarter, about 3,830 a month\n:::\n::: col\n- **Actual**\n  (1) Subscribers: 48,200 paying on 30 Sep, 2,200 above target\n  (2) Churn: 2.9% a month on average, 0.1 pt below target\n  (3) Payback: 7.5 months, half a month shorter than target\n  (4) New subscriptions: 12,290, 790 above target, about 4,100 a month\n:::\n::::\n\n- Source: Q3 2026 plan; billing system export to 30 Sep (sample)");
      for (const label of ["Subscribers", "Churn", "Payback", "New subscriptions"]) assert.ok(critOf(en.shapes, label), `${label}: ${JSON.stringify(en.shapes.map((s) => s.text))}`);
      assert.ok(!en.shapes.some((s) => s.text.startsWith("New subscriptions:")), "the label is lifted out of the sides");
      assert.deepEqual(gateOn(dir, en.pptx, 1), []);
      const mixed = oneSlide(dir, "m", "paper", "layout: comparison\n\n## Research question and test design\n\n:::: columns 1fr 1fr\n::: col\n- **Single-feed baseline**\n  (1) Feed: one inlet at the reactor head takes the whole feed\n  (2) Vessel: 20 L stirred reactor, one temperature (sample)\n  (3) Runs: 6 feed rates × 3 replicates = 18 runs\n  (4) Limit: conversion plateaus near 50% after minute 30\n:::\n::: col\n- **Staged feed tested**\n  (1) Feed: three equal inlets along the reactor\n  (2) Vessel: the same 20 L reactor; three feed valves added\n  (3) Runs: 6 feed rates × 3 replicates = 18 runs\n  (4) Question: can conversion pass 50% at 60 min?\n:::\n::::\n\n- Source: Example Process Lab run log (sample)");
      for (const label of ["Feed", "Vessel", "Runs", "Limit / Question"]) assert.ok(critOf(mixed.shapes, label), `${label}: ${JSON.stringify(mixed.shapes.map((s) => s.text))}`);
      assert.deepEqual(gateOn(dir, mixed.pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a closing keeps the unit its column head carries on every amount, and the amounts key the rows", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "u", "paper", "layout: closing-ask\n\n## Partner plant for a full-scale trial\n\n| Next step | Budget (k USD) | When | Owner | Expected result |\n|---|---|---|---|---|\n| Full-scale heat-removal model | 30 | 2026 Q4 | Example Process Lab | Cooling limit per stage |\n| Stage-split runs (two splits) | 25 | 2026 Q4 | Example Process Lab | Best split, 18 runs |\n| Partner plant trial, 4 weeks | 110 | 2027 Q1 | Partner (open) | ≥ 70% conversion at scale |\n| Joint report and go/no-go | 15 | 2027 Q2 | Lab and partner | Rollout decision |\n| Total | 180 | 2026 Q4-2027 Q2 | — | — |\n\n- Next step: scoping call in November 2026, owner Example Speaker");
      for (const key of ["30k USD", "25k USD", "110k USD", "15k USD"]) assert.ok(shapes.some((s) => s.text === key), `${key}: ${JSON.stringify(shapes.map((s) => s.text))}`);
      assert.ok(!shapes.some((s) => /(^|·\s*)\d+\s*·/u.test(s.text)), `a bare amount in a detail line: ${JSON.stringify(shapes.map((s) => s.text))}`);
      assert.deepEqual(gateOn(dir, pptx, 1), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a contact-split closing's field (a corner field, bleeding right and bottom) ends in its foot line on the band's floor, and the rule spans the key track", () => {
    const dir = work();
    try {
      const d = displayDeck(dir, "studio");
      const slide = d.shapes[6];
      const field = slide.find((s) => s.fill === "141414" && s.x > 400 && Math.round(s.x + s.w) === 960);
      assert.ok(field && Math.round(field.y + field.h) === 540, JSON.stringify(field));
      // Under the total only the footer zone is left: at most 15 % of the field's height.
      const total = slide.find((s) => /합계/u.test(s.text));
      assert.ok(total && field.y + field.h - (total.y + total.h) <= 0.15 * field.h, JSON.stringify([field, total]));
      // The rule over the total spans the same width as the bars' tracks.
      const tracks = slide.filter((s) => s.fill && !s.text && s.h > 5 && s.h < 7 && s.x > field.x);
      const rule = slide.find((s) => !s.text && s.h < 1 && s.x > field.x && s.y < total.y && s.y > total.y - 40);
      const trackW = Math.max(...tracks.map((s) => s.w));
      assert.ok(rule && Math.abs(rule.w - trackW) < 1, JSON.stringify({ rule, trackW }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The largest empty horizontal band of the body, as a share of it: from the title's foot (the top
  // margin when the title sits low) to the source strip (else the 486 pt floor), over every shape
  // that sets ink (text, table, chart, picture); the empty title rail and the notice under the floor
  // do not count. The render audit measures the same band on the page against 0.20; frames run a
  // line's leading past their glyphs, so the frame measure keeps a margin under it (0.18).
  const emptyBand = (shapes) => {
    const title = shapes.find((s) => s.name.startsWith("title@"));
    const top = title && title.y + title.h < 486 * 0.6 ? title.y + title.h : 36;
    const strip = shapes.filter((s) => /^(출처|주|Source|Note):/u.test(s.text) && s.y > top).map((s) => s.y);
    const floor = strip.length ? Math.min(...strip) : 486;
    const ink = shapes.filter((s) => s !== title && !s.name.startsWith("family@") && !s.name.startsWith("lit-notice") && s.y < floor && s.y + s.h > top
      && (s.text.trim() || s.table || s.chart || s.picture)).map((s) => [Math.max(top, s.y), Math.min(floor, s.y + s.h)]).sort((a, b) => a[0] - b[0]);
    let cursor = top;
    let gap = 0;
    for (const [y0, y1] of ink) {
      gap = Math.max(gap, y0 - cursor);
      cursor = Math.max(cursor, y1);
    }
    return Math.max(gap, floor - cursor) / (floor - top);
  };

  it("a timeline sits with its takeaways on the body, no empty band over its axis", () => {
    const dir = work();
    try {
      for (const t of ["ledger", "gazette"]) {
        const { pptx, shapes } = oneSlide(dir, `tl-${t}`, t, "layout: timeline\n\n## 원가 대응 일정과 담당\n\n| 시점 | 할 일 | 담당 | 목표 |\n|---|---|---|---|\n| 10월 | 포장재 단가 재협상 완료 | 구매팀 | 단가 −5% |\n| 11월 | 물류 경로 통합 시범 운영 | 물류팀 | 운송비 −8% |\n| 12월 | 원자재 장기 계약안 확정 | 구매팀 | 계약 조건 합의 |\n| 27년 1월 | 1차 효과 점검 보고 | 경영기획팀 | 절감액 확인 |\n| 27년 2월 | 원자재 장기 계약 시행 | 구매팀 | 2년 고정가 적용 |\n| 27년 3월 | 설비 교체 재검토 | 생산팀 | 투자 여부 결정 |\n\n> 표 3. 원가 대응 일정과 담당 (예시)\n\n- 즉시 대응하는 두 항목(포장재, 물류)은 11월까지 끝낸다 (표 2)\n- 원자재 장기 계약은 12월에 안을 확정하고 2월부터 고정가를 적용한다\n- 보류한 설비 교체(연 2억 원)는 1월 점검 결과를 보고 3월에 다시 검토한다\n- 출처: 예시 기업 구매·물류·생산팀 실행 계획(2026년 9월 작성)");
        const band = emptyBand(shapes);
        assert.ok(band <= 0.18, `${t}: largest empty band ${band.toFixed(3)}: ${JSON.stringify(shapes.map((s) => [s.text.slice(0, 10), Math.round(s.y), Math.round(s.h)]))}`);
        assert.deepEqual(gateOn(dir, pptx, 1), [], t);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("comparison rows, grouped text and a table's notes spread so no gap between them passes a fifth of the body", () => {
    const dir = work();
    try {
      const cases = [
        ["cmp", "ledger", "layout: comparison\ntitle: side-rail\n\n## 9월 계획 대비 실적 비교\n\n:::: columns 1fr 1fr\n::: col\n- **9월 계획**\n  (1) 재고 연동: 9월 말까지 재고 오차 0.5% 이하로 연동을 끝낸다\n  (2) 결제 연동: 9월 넷째 주에 결제사 시험 환경에서 시험 300건을 시작한다\n  (3) 진척률: 9월 말 66%, 7월에 확정한 이정표 가중치 기준선 기준\n  (4) 남은 작업량: 9월 4주 245점, 9월에 주당 45점씩 줄이는 계획\n:::\n::: col\n- **9월 실적**\n  (1) 재고 연동: 9월 말에 완료했고 재고 오차는 기준 안이다 (정상)\n  (2) 결제 연동: 결제사 시험 환경이 열리지 않아 시험을 못 했다 (지연 2주)\n  (3) 진척률: 62%로 계획보다 4%p 낮고, 8월 말 −1%p보다 차이가 커졌다\n  (4) 남은 작업량: 296점으로 계획보다 51점 많고, 주당 38점씩 줄었다\n:::\n::::\n\n- 출처: 예시 프로젝트 관리 기록, 7월 확정 기준선 대비(2026년 9월 30일)"],
        ["grp", "ledger", "layout: content\n\n## 시범 운영 1년 검토 배경과 결과\n\n- **요약**\n  (1) 이용률은 월평균 78%로 높았고, 불편은 협업에 몰렸다\n  (2) 주간 회의 시간은 1인당 4.1시간에서 5.3시간으로 1.2시간 늘었다\n- **시범 운영 개요**\n  (1) 대상: 본사 4개 본부 612명, 2025년 10월부터 12개월\n  (2) 방식: 주 1-3일 자율 선택, 전일 오후 6시까지 사전 신청\n- **이용 결과**\n  (1) 월평균 이용률 78%, 본부 간 편차 최대 21%p (개발 89%, 영업 68%)\n  (2) 주 2일 이용이 가장 많아 이용자의 47%를 차지했다\n- **만족 결과**\n  (1) 업무 만족도 3.4점 → 4.1점 (5점 척도, 응답 523명, 응답률 85%)\n  (2) 네 본부 모두 0.6-0.7점 올랐다 (표 2)\n- **불편 사항**\n  (1) 불편 응답의 64%가 회의 일정 조율과 대면 협업 부족\n  (2) 그다음은 결재 지연 18%, 장비 지원 11% 순이다\n- **시사점**\n  (1) 제도 자체보다 협업일 운영 방식이 성패를 가른다\n  (2) 그래서 주 2일 정례화와 팀별 협업일 지정(안 2)을 함께 검토했다\n- 출처: 인사기획팀 이용 기록(2025.10-2026.09), 직원 만족도 조사(2026년 9월)"],
        ["tbl", "paper", "layout: table-insight\n\n## Conversion and reactor volume vs prior work\n\n| Study | Reactor (L) | Conversion (%) | Stages | Time (min) |\n|---|---|---|---|---|\n| Example A (2021) | 40 | 72 | 1 | 90 |\n| Example B (2023) | 25 | 68 | 2 | 60 |\n| Example C (2024) | 30 | 70 | 1 | 75 |\n| Example D (2025) | 20 | 58 | 2 | 60 |\n| This work, single feed | 20 | 50 | 1 | 60 |\n| This work, staged | 20 | 75 | 3 | 60 |\n\n> Table 1. Comparison with prior work at the reported end time (sample values)\n\n- Prior work reached similar conversion only with larger reactors (25-40 L).\n- This work reaches 75% in the smallest reactor (20 L) at 60 min.\n- Example A needed twice the volume (40 L) and 90 min for 72%.\n- Two-stage designs (B, D) reached 58-68%; three stages reach 75% here.\n- Source: references [1]-[4] and this work's run log (sample values)\n- Note: conversion at each study's reported end time; temperatures differ between studies"],
      ];
      const bands = cases.map(([name, t, body]) => {
        const { pptx, shapes } = oneSlide(dir, name, t, body);
        assert.deepEqual(gateOn(dir, pptx, 1), [], name);
        return [name, Number(emptyBand(shapes).toFixed(3))];
      });
      assert.ok(bands.every(([, band]) => band <= 0.18), `largest empty bands ${JSON.stringify(bands)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a wide picture beside a taller takeaway column stands on the body floor, so no band is empty across both", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "wide.png"), png(480, 270, [90, 120, 150]));
      writeFileSync(join(dir, "assets", "four-three.png"), png(400, 300, [150, 120, 90]));
      const points = "- **요약** 경첩 하나로 식탁과 선반을 바꾸며, 시범 고객 평균 28초 걸렸다 (30회)\n- **내구** 2만 회 개폐 시험 통과, 하루 5회 사용 기준 약 11년 (예시)\n- **잠금** 펼치면 자동으로 고정되고 상판 60kg까지 버틴다\n- **소재** 경첩 축은 스테인리스강, 2만 회 시험 뒤 유격 0.5mm 이하 (예시)\n- **소음** 접고 펼 때 평균 38dB로 늦은 저녁에도 쓸 수 있다 (예시 측정)\n- **보증** 경첩 5년, 상판 2년, 보증 기간 안 무상 교체\n- 출처: 예시 시험기관 개폐 내구 시험(2026년 7월), 시범 고객 측정 30회";
      const bands = [["studio", "wide.png"], ["atlas", "wide.png"], ["chalk", "four-three.png"]].map(([t, file]) => {
        const { pptx, shapes } = oneSlide(dir, `img-${t}`, t, `layout: image-split\ntitle: side-rail\n\n## 경첩 구조와 내구 시험 결과\n\n![도 3. 경첩 구조 확대 | 출처: 예시 이미지](assets/${file})\n\n${points}`);
        assert.deepEqual(gateOn(dir, pptx, 1), [], t);
        return [t, Number(emptyBand(shapes).toFixed(3))];
      });
      assert.ok(bands.every(([, band]) => band <= 0.18), `largest empty bands ${JSON.stringify(bands)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a Markdown link in body text becomes a linked word, never literal brackets", () => {
    const dir = work();
    try {
      const r = oneSlide(dir, "link", "paper", "layout: references-appendix\n\n## Data sources and definitions\n\n- [1] Example Process Lab. (2026). Sample dataset for staged feeding (synthetic). [link](https://example.org/dataset)\n- [2] Conversion: share of feed converted at 60 min\n- [3] Staged feed: the same volume fed in three steps");
      assert.ok(!r.shapes.some((s) => /\]\(https?:/u.test(s.text)), JSON.stringify(r.shapes.map((s) => s.text)));
      const probe = spawnSync(runtimePython, ["-B", "-c", "import sys\nfrom pptx import Presentation\np = Presentation(sys.argv[1])\nprint([r.hyperlink.address for sh in p.slides[0].shapes if sh.has_text_frame for pa in sh.text_frame.paragraphs for r in pa.runs if r.hyperlink.address])", r.pptx], { encoding: "utf8" });
      assert.match(probe.stdout, /https:\/\/example\.org\/dataset/u, probe.stdout + probe.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a closing-contact-split whose amounts add up keeps its next-step line clear of the total", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "c.md"), "---\ntitle: 운영 자금 요청\ntonality: studio\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: cover-typographic\n\n# 운영 자금 요청\n---\n\n---\nlayout: closing-contact-split\n\n## 18개월 운영 자금 사용 계획\n\n| 쓰임 | 금액 |\n|---|---|\n| 권역 확대 | 14억 원 |\n| 배송 거점 | 4억 원 |\n| 품질 관리 | 7억 원 |\n| 앱 개발 인력 | 5억 원 |\n\n- 다음 단계: 11월 둘째 주 실사 미팅에서 세부 집행 일정과 분기별 점검 지표를 함께 확정, 담당 예시 재무팀\n---\n");
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "c.md"), "--pptx", join(dir, "c.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      const page = shapesOf(join(dir, "c.pptx")).slides[1];
      const total = page.find((s) => s.text.startsWith("합계"));
      const step = page.find((s) => s.text.startsWith("다음 단계"));
      assert.ok(total && step, JSON.stringify(page.map((s) => s.text)));
      const box = (s) => [s.x, s.y, s.w, s.h].map((v) => Math.round(v));
      const clear = step.x + step.w <= total.x || total.x + total.w <= step.x || step.y + step.h <= total.y || total.y + total.h <= step.y;
      assert.ok(clear, `step ${JSON.stringify(box(step))} meets total ${JSON.stringify(box(total))}`);
      const report = JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [join(dir, "c.pptx")], dir).stdout);
      assert.deepEqual(report.semantic_overlaps?.violations ?? [], [], JSON.stringify(report.semantic_overlaps));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Checkpoint D round 2 (spec-v2 Amendments 7) ──
  const partXml = (pptx, pattern) => {
    const probe = spawnSync(runtimePython, ["-B", "-c", "import sys, zipfile, re\nz = zipfile.ZipFile(sys.argv[1])\nnames = sorted((n for n in z.namelist() if re.fullmatch(sys.argv[2], n)), key=lambda n: int(re.sub(r'\\D', '', n) or 0))\nprint('\\x00'.join(z.read(n).decode() for n in names))", pptx, pattern], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    return probe.stdout.replace(/\n$/u, "").split("\x00");
  };
  const gateJson = (dir, pptx, extra = []) => JSON.parse(py(join(pptxRoot, "scripts", "qa_deck.py"), [pptx, ...extra], dir).stdout);
  const floorFindings = (report, check) => [...report.craft_floor.findings, ...report.craft_floor.advisories].filter((f) => f.check === check);
  // Runs of every text frame on one slide with their bold flag, read off the XML.
  const boldRuns = (pptx, index) => {
    const xml = partXml(pptx, "ppt/slides/slide\\d+\\.xml")[index];
    return [...xml.matchAll(/<a:r><a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)<\/a:t><\/a:r>/gu)].map((m) => ({ text: m[2], bold: /\bb="1"/u.test(m[1]) }));
  };
  // Shift a named shape on one slide of a deck (a planted defect for the gate).
  const plant = (src, out, code) => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import sys
from pptx import Presentation
from pptx.util import Pt
p = Presentation(sys.argv[1])
${code}
p.save(sys.argv[2])
`, src, out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  };
  const solidPng = (dir, file, rgb, lines = null) => {
    const run = spawnSync(runtimePython, ["-B", "-c", `
import sys
from PIL import Image, ImageDraw
im = Image.new("RGB", (800, 500), tuple(int(v) for v in sys.argv[2].split(",")))
d = ImageDraw.Draw(im)
if sys.argv[3] != "-":
    ink = tuple(int(v) for v in sys.argv[3].split(","))
    for x in (80, 330, 580):
        d.rectangle([x, 200, x + 150, 300], outline=ink, width=4)
    d.line([230, 250, 330, 250], fill=ink, width=4)
    d.line([480, 250, 580, 250], fill=ink, width=4)
im.save(sys.argv[1])
`, join(dir, file), rgb.join(","), lines ? lines.join(",") : "-"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  };

  it("R1: a section preview runs at most two lines an opened slide in a column within 70 % of the page, run-in labels bold with their colon", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "s.md"), "---\ntonality: chalk\ntitle: 회귀 입문\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: text-column\n\n## 4강 학습 목표\n\n- 회귀가 답하는 질문을 정의한다\n---\n\n---\nlayout: section\n\n# 회귀가 답하는 질문\n---\n\n---\nlayout: text-column\n\n## 회귀 기울기의 뜻과 해석 예\n\n- 회귀는 x가 1 늘 때 y가 평균 얼마나 변하는지 묻는다\n- 기울기는 언제나 'y 단위 / x 단위'로 읽는다\n- 세 번째 줄은 미리보기에 나오지 않는다\n---\n\n---\nlayout: text-column\n\n## 예제: 공부 시간과 시험 점수, 학생 40명\n\n- **결과** 공부 시간이 1시간 긴 학생의 점수가 평균 4.2점 높다 (95% 구간 2.7-5.7)\n- **자료:** 학생 40명, 하루 공부 시간 0-6시간, 점수 100점 만점\n- **주의** 이 줄도 미리보기에 나오지 않는다\n---\n");
      const d = displayDeck(dir, "chalk", join(dir, "s.md"), "s");
      const page = d.shapes[1].filter((s) => s.text && !s.name.startsWith("lit-notice") && !s.name.startsWith("title@"));
      const previews = page.filter((s) => /회귀는|결과|기울기는/u.test(s.text));
      assert.ok(previews.length >= 2, JSON.stringify(page.map((s) => s.text)));
      for (const s of previews) {
        assert.ok(s.w <= 0.7 * 960 + 0.5, `preview ${Math.round(s.w)} pt wide, over 70 % of the page`);
        assert.ok(s.w >= 0.6 * 960, `preview ${Math.round(s.w)} pt wide: the wide option keeps most of the cap`);
        assert.ok(lines(s.text).length <= 2, `more than two lines: ${JSON.stringify(s.text)}`);
      }
      assert.ok(!page.some((s) => /나오지 않는다/u.test(s.text)), "a third line stays out of the preview");
      const runs = boldRuns(d.pptx, 1);
      assert.ok(runs.some((r) => r.bold && r.text === "결과:"), `bold run-in label with its colon: ${JSON.stringify(runs)}`);
      assert.ok(runs.some((r) => r.bold && r.text === "자료:"), "a label that brings its own colon keeps one colon");
      assert.ok(!runs.some((r) => r.text.includes("::")), "never two colons");
      // An English deck takes the narrower column of about 70 characters.
      writeFileSync(join(dir, "e.md"), "---\ntonality: night\ntitle: Review\n---\n\n---\nlayout: text-column\n\n## Subscription KPIs\n\n- Paying subscribers grew 21% in the quarter\n---\n\n---\nlayout: section\n\n# Method notes\n---\n\n---\nlayout: references-appendix\n\n## Data sources and definitions\n\n- **Billing** export from 1 July to 30 September 2026, every paying account (sample).\n- [2] Q3 2026 plan targets, approved June 2026 (sample).\n- [3] Churn: share of subscribers active at month start who cancel in that month.\n---\n");
      const e = displayDeck(dir, "night", join(dir, "e.md"), "e");
      const en = e.shapes[1].filter((s) => /Billing|plan targets/u.test(s.text));
      // The cap is about 70 characters at the pack's body size, read from the pack as the engine does.
      const sized = spawnSync(process.execPath, ["-e", `const r = require(${JSON.stringify(join(pptxRoot, "scripts", "lib", "template-registry.js"))});
process.stdout.write(String(r.loadTonality("night").pack.tok.sizes.body));`], { encoding: "utf8" });
      assert.equal(sized.status, 0, sized.stderr);
      const body = Number(sized.stdout.trim());
      assert.ok(body > 0, sized.stdout);
      assert.ok(en.length && en.every((s) => s.w <= 70 * body * 0.5 + 0.5), JSON.stringify(en.map((s) => [s.w, s.text])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2a: a bottom title ends on the body floor whatever its line count, and the gate fails one that floats above it (OF-115)", () => {
    const dir = work();
    try {
      const chart = "::: chart type=column unit=\"천 건\"\n| 월 | 전체 주문 (천 건) | 재주문 (천 건) |\n|---|---|---|\n| 4월 | 6.2 | 1.9 |\n| 5월 | 7.9 | 2.9 |\n| 6월 | 9.4 | 3.9 |\n| 7월 | 11.8 | 5.4 |\n> 월별 전체 주문과 재주문 (예시 데이터)\n:::\n\n- 월 주문은 4월 6,200건에서 7월 1만 1,800건으로 늘었다\n- 광고비를 늘리지 않은 6-7월에도 증가세가 이어졌다\n- 출처: 예시 내부 주문 기록";
      writeFileSync(join(dir, "b.md"), `---\ntonality: paper\ntitle: 주문\nnotice: 예시 데이터 — 실제 수치로 바꿔 주세요\n---\n\n---\nlayout: chart-insight\ntitle: bottom-anchor\n\n## 월별 전체 주문과 재주문 추이\n\n${chart}\n---\n\n---\nlayout: chart-insight\ntitle: bottom-anchor\n\n## 수도권 세 지역의 월별 전체 주문과 재주문 추이, 2026년 4월부터 7월까지 넉 달\n\n${chart}\n---\n`);
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "b.md"), "--pptx", join(dir, "b.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr + built.stdout);
      const slides = shapesOf(join(dir, "b.pptx")).slides;
      const titles = slides.map((s) => s.find((x) => x.name === "title@bottom-anchor"));
      assert.ok(titles.every(Boolean), JSON.stringify(slides.map((s) => s.map((x) => x.name))));
      assert.equal(lines(titles[0].text).length, 1);
      assert.equal(lines(titles[1].text).length, 2);
      for (const t of titles) {
        const textBottom = t.y + lines(t.text).length * 26 * 1.15;
        assert.ok(textBottom >= 486 - 12 && t.y + t.h <= 487, `title text ends at ${textBottom.toFixed(0)}, frame ${t.y.toFixed(0)}+${t.h.toFixed(0)}`);
      }
      // A chart beside its takeaways grows into the room a one-line title used to leave under itself.
      const besides = slides.filter((s) => { const c = s.find((x) => x.chart); return s.some((x) => x.text && x.x >= c.x + c.w); });
      assert.ok(besides.length >= 1);
      for (const s of besides) {
        const c = s.find((x) => x.chart);
        const t = s.find((x) => x.name === "title@bottom-anchor");
        assert.ok(c.y + c.h >= t.y - 60, `chart ends at ${(c.y + c.h).toFixed(0)}, title at ${t.y.toFixed(0)}`);
      }
      const gate = gateJson(dir, join(dir, "b.pptx"));
      assert.deepEqual(floorFindings(gate, "OF-115"), []);
      assert.deepEqual(floorFindings(gate, "OF-113"), [], "a bottom title is anchored by its bottom edge");
      // The old geometry: the title and what stands on its line 54 pt higher, leaving the floor empty under it.
      plant(join(dir, "b.pptx"), join(dir, "up.pptx"), "for s in p.slides[0].shapes:\n    if s.top >= Pt(380) and not s.name.startswith('lit-notice'):\n        s.top = s.top - Pt(54)");
      const up = gateJson(dir, join(dir, "up.pptx"));
      assert.ok(floorFindings(up, "OF-115").some((f) => f.slide === 1 && f.severity === "HIGH" && /bottom title/u.test(f.detail)), JSON.stringify(floorFindings(up, "OF-115")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2b: a side rail carries the criteria labels, the takeaways and the source under its title; the gate fails a rail left empty (OF-115)", () => {
    const dir = work();
    try {
      const cmp = oneSlide(dir, "c", "ledger", "layout: comparison\ntitle: side-rail\n\n## 3분기 계획 대비 실적 비교\n\n:::: columns 1fr 1fr\n::: col\n- **계획**\n  (1) 매출: 1,140억 원, 전년 3분기 962억 원보다 18.5% 많은 목표\n  (2) 영업이익: 100억 원, 전년 3분기 84억 원보다 19% 많은 목표\n  (3) 영업이익률: 8.8%, 전년 3분기 8.7%와 비슷한 수준\n  (4) 영업현금흐름: 90억 원, 영업이익의 90%\n:::\n::: col\n- **실적**\n  (1) 매출: 1,184억 원으로 계획보다 44억 원(▲ +3.9%) 많았다\n  (2) 영업이익: 110억 원으로 계획보다 10억 원 많았다\n  (3) 영업이익률: 9.3%로 계획보다 0.5%p 높았다\n  (4) 영업현금흐름: 96억 원으로 계획보다 6억 원 많았다\n:::\n::::\n\n- 출처: 예시 기업 2026년 연간 사업 계획(1월 확정), 3분기 내부 결산 자료\n- 주: 전년 대비는 2025년 3분기 기준");
      const title = cmp.shapes.find((s) => s.name === "title@side-rail");
      assert.ok(title, JSON.stringify(cmp.shapes.map((s) => s.name)));
      const titleBottom = title.y + lines(title.text).length * 26 * 1.15;
      for (const label of ["매출", "영업이익", "영업이익률", "영업현금흐름"]) {
        const s = cmp.shapes.find((x) => x.text === label);
        assert.ok(s && s.x + s.w <= 336 + 0.5 && s.y >= titleBottom, `${label} in the rail under the title: ${JSON.stringify(s)}`);
      }
      const strip = cmp.shapes.find((s) => s.text.startsWith("출처:"));
      assert.ok(strip && strip.x + strip.w <= 336 + 0.5 && strip.y + strip.h >= 440, `source at the rail's foot: ${JSON.stringify(strip)}`);
      assert.ok(cmp.shapes.filter((s) => /계획보다/u.test(s.text)).every((s) => s.x >= 336 - 0.5), "the sides keep the body beside the rail");
      const g1 = gateJson(dir, cmp.pptx);
      assert.deepEqual([...floorFindings(g1, "OF-110"), ...floorFindings(g1, "OF-115")], [], "still read as a side rail, and the rail is used");
      const chart = oneSlide(dir, "k", "ledger", "layout: chart-insight\ntitle: side-rail\n\n## 주차별 남은 작업량, 계획 대비 실적\n\n::: chart type=column unit=\"점\"\n| 주차 | 실적 (점) | 계획 (점) |\n|---|---|---|\n| 8월 3주 | 492 | 470 |\n| 8월 4주 | 450 | 425 |\n| 9월 1주 | 410 | 380 |\n| 9월 2주 | 371 | 335 |\n| 9월 3주 | 335 | 290 |\n| 9월 4주 | 296 | 245 |\n> 주차별 남은 작업량, 실적과 계획 (예시 데이터)\n:::\n\n- 9월 남은 작업량은 주당 평균 38점씩 줄었다 (410 → 296점)\n- 이 속도면 약 8주 뒤인 11월 셋째 주에 남은 작업이 0이 된다\n- 계획과의 차이는 8월 3주 22점에서 9월 4주 51점으로 커졌다\n- 계획 완료 시점(11월 첫째 주, 6주 뒤)에 맞추려면 주당 약 49점씩 줄여야 한다\n- 출처: 예시 프로젝트 작업 관리 도구 주간 집계");
      const takeaways = chart.shapes.filter((s) => /주당 평균|8주 뒤|차이는|6주 뒤/u.test(s.text));
      assert.equal(takeaways.length, 4, JSON.stringify(chart.shapes.map((s) => s.text.slice(0, 16))));
      assert.ok(takeaways.every((s) => s.x + s.w <= 336 + 0.5), "the takeaways stand in the rail");
      const plot = chart.shapes.find((s) => s.chart);
      assert.ok(plot.x >= 336 - 0.5 && plot.w >= 500, `the chart takes the body beside the rail: ${JSON.stringify(plot)}`);
      const g2 = gateJson(dir, chart.pptx);
      assert.deepEqual([...floorFindings(g2, "OF-110"), ...floorFindings(g2, "OF-115")], []);
      // A side rail pinned on a slide with nothing to put in it is reported.
      const empty = oneSlide(dir, "e", "studio", "layout: text-column\ntitle: side-rail\n\n## 경첩 하나로 바꾸는 식탁\n\n- 2만 회 개폐 시험 통과 (예시)\n- 펼친 상태에서 자동으로 고정된다\n- 접으면 깊이가 18cm로 줄어 벽에 붙는다\n- 세 칸 선반이 칸당 8kg까지 버틴다");
      assert.ok(floorFindings(gateJson(dir, empty.pptx), "OF-115").some((f) => f.severity === "HIGH" && /rail/u.test(f.detail)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2b: a slide whose rail would stay empty takes another title unless the source pins the rail", () => {
    const dir = work();
    try {
      // Chalk draws definitions under a side rail by default; a method with nothing for the rail takes a top title.
      const { shapes } = oneSlide(dir, "m", "chalk", "layout: method\n\n## 단순 선형회귀식과 기호의 뜻\n\ny = β₀ + β₁x + ε\n\n- **y** 설명하려는 값 (예: 시험 점수)\n  (1) 예제: 100점 만점, 학생 40명 평균 67.8점\n- **x** 설명에 쓰는 값 (예: 공부 시간)\n  (1) 예제: 시험 전 1주일 하루 평균, 0-6시간\n- **β₁** 기울기, x가 1 늘 때 y의 평균 변화\n  (1) 예제 값 4.2점/시간, 95% 구간 2.7-5.7\n- **β₀** 절편, x가 0일 때 y의 평균\n  (1) 예제 값 51점");
      const title = shapes.find((s) => s.name.startsWith("title@"));
      assert.notEqual(title.name, "title@side-rail", "the rail would hold the title alone");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2c: beside a chart, the source and note close the takeaway column instead of running across the body", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "c", "ledger", "layout: chart-insight\ntitle: top-rule\n\n## 분기별 매출 실적과 계획 추이\n\n::: chart type=column unit=\"억 원\"\n| 분기 | 매출 실적 (억 원) | 매출 계획 (억 원) | 전년 (억 원) | 목표 (억 원) |\n|---|---|---|---|---|\n| 25년 2Q | 921 | 900 | 850 | 910 |\n| 25년 3Q | 962 | 940 | 870 | 950 |\n| 25년 4Q | 1,015 | 990 | 905 | 1,000 |\n| 26년 1Q | 1,071 | 1,040 | 921 | 1,050 |\n| 26년 2Q | 1,120 | 1,090 | 962 | 1,100 |\n| 26년 3Q | 1,184 | 1,140 | 1,015 | 1,150 |\n> 분기별 매출 실적과 계획 (예시 데이터)\n:::\n\n- 매출은 다섯 분기 연속 늘었고 여섯 분기 모두 계획을 넘었다\n- 3분기 매출은 전년 같은 분기보다 23% 늘었다\n- 출처: 예시 기업 분기 결산 자료(2025년 2분기-2026년 3분기), 연간 사업 계획\n- 주: 계획은 각 연도 1월에 확정한 분기 목표");
      const plot = shapes.find((s) => s.chart);
      const strip = shapes.find((s) => s.text.startsWith("출처:"));
      const points = shapes.filter((s) => /^(매출은 다섯|3분기 매출은)/u.test(s.text));
      if (points.every((s) => s.x >= plot.x + plot.w - 0.5)) {
        assert.ok(strip.x >= plot.x + plot.w - 0.5, `the strip stands in the takeaway column: chart ${JSON.stringify(plot)}, strip ${JSON.stringify(strip)}`);
        assert.ok(plot.y + plot.h >= 440, `the chart runs down to the floor: ${plot.y + plot.h}`);
      } else {
        // Two short points cannot fill a column beside the chart (spec-v2 Amendments 8): they run under it, the strip across the foot.
        assert.ok(points.every((s) => s.y >= plot.y + plot.h - 0.5) && plot.w >= 0.9 * 912, JSON.stringify({ plot, points }));
      }
      assert.ok(strip.y + strip.h >= 470, `the strip stands on the floor: ${strip.y + strip.h}`);
      assert.deepEqual(floorFindings(gateJson(dir, pptx), "OF-115"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2 review loop: compact process rows reach across the body, and a closing summary keeps its source in the strip", () => {
    const dir = work();
    try {
      const steps = "layout: process\ntitle: top-rule\n\n## 회귀 분석 4단계 절차와 점검 항목\n\n- **1. 그리기** 산점도로 관계의 모양과 이상값을 먼저 본다\n  (1) 도구 스프레드시트 산점도 · 약 5분\n  (2) 확인 관계가 직선에 가까운지 · 예제 이상값 2명\n- **2. 맞추기** 최소제곱법으로 직선을 구한다\n  (1) 도구 스프레드시트 회귀 함수 · 약 5분\n  (2) 결과 β₀ 51, β₁ 4.2 · 잔차 제곱합이 가장 작은 직선\n- **3. 읽기** 기울기와 절편을 단위와 함께 해석한다\n  (1) 기울기 4.2점/시간 · 95% 구간 2.7-5.7\n  (2) 절편 51점 · 관측 범위 0-6시간 안에서만 읽기\n- **4. 점검하기** 잔차를 그려 곡선이나 이상값이 없는지 본다\n  (1) 도구 잔차 그림 · 약 10분\n  (2) R² 0.46 · 잔차 표준편차 8.1점 · 곡선 패턴 없음\n- 출처: 예제 자료 학생 40명, 표 2 (예시)";
      const proc = oneSlide(dir, "p", "chalk", steps);
      const rests = proc.shapes.filter((s) => /^(산점도로|최소제곱법으로|기울기와|잔차를)/u.test(s.text));
      assert.equal(rests.length, 4, JSON.stringify(proc.shapes.map((s) => s.text.slice(0, 12))));
      // At body size the 26-character measure stopped near the middle of the body, leaving its right third empty.
      for (const r of rests) assert.ok(r.x + r.w >= 24 + 912 * 0.75, `what happens reaches across: ${(r.x + r.w).toFixed(0)}`);
      assert.deepEqual(floorFindings(gateJson(dir, proc.pptx), "OF-115"), []);
      const close = oneSlide(dir, "s", "chalk", "layout: closing-summary-list\n\n## 이번 주 정리와 과제\n\n- 표준 범위 밖의 시료는 희석해 다시 잰다\n- 잔차를 기울기보다 먼저 읽는다\n- 과제: 질산염 자료로 직선을 맞추고 잔차표를 목요일까지 낸다\n- 출처: 예시 화학 실습 자료, 2026 (예시)");
      const source = close.shapes.find((s) => s.text.startsWith("출처:"));
      assert.ok(source, JSON.stringify(close.shapes.map((s) => s.text.slice(0, 12))));
      assert.ok(!/^\d+$/u.test(close.shapes[close.shapes.indexOf(source) - 1]?.text ?? ""), "the source is not a numbered summary row");
      assert.ok(source.h <= 24, `the source is set as the strip: ${JSON.stringify(source)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2d: a title panel over a picture hugs its text on the page foot, and Atlas sets a quote on the whole-page field", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "a.png"), png(960, 540, [170, 180, 190]));
      writeFileSync(join(dir, "a.md"), "---\ntonality: atlas\ntitle: 접이식 식탁\ndate: 2026-10-02\ndepartment: 예시 가구 디자인 스튜디오\npresenter: 예시 디자이너\nnotice: 예시 이미지 데이터 — 실제 자료로 바꿔 주세요\n---\n\n---\nlayout: cover-full-image\n\n# 소형 거실용 접이식 식탁·벽 선반\n---\n\n---\nlayout: image-full\n\n## 4인 식탁으로 펼친 상태\n\n![도 1. 4인 식탁으로 펼친 모습 | 출처: 예시 이미지](assets/a.png)\n---\n\n---\nlayout: quote\n\n## 시범 고객 후기\n\n“퇴근 후에는 식탁, 주말에는 운동할 바닥이 생겼어요.”\n\n— 예시 고객 인터뷰, 원룸(20m²) 거주 1인 가구, 사용 2개월 차\n---\n");
      const d = displayDeck(dir, "atlas", join(dir, "a.md"), "a");
      const title = d.shapes[0].find((s) => s.name === "title@cover");
      const panel = d.shapes[0].find((s) => s.fill && s.y <= title.y && s.y + s.h >= title.y + title.h && s.w < 960);
      assert.ok(panel, JSON.stringify(d.shapes[0].map((s) => [s.name, s.fill, s.x, s.y, s.w, s.h])));
      assert.ok(panel.y + panel.h >= 539.5, `the panel bleeds off the foot: ${panel.y + panel.h}`);
      assert.ok(title.y - panel.y <= 36, `the panel starts just above the title: panel ${panel.y}, title ${title.y}`);
      assert.ok(d.shapes[2].some(fullCanvas), "the quote stands on the whole-page field");
      const gate = gateJson(dir, d.pptx);
      assert.deepEqual(floorFindings(gate, "OF-115"), []);
      // The old plate (the field under the lower half, nothing above it) is reported.
      plant(d.pptx, join(dir, "plate.pptx"), "s = p.slides[2]\nf = next(x for x in s.shapes if x.left == 0 and x.top == 0 and x.width == p.slide_width)\nf.top = Pt(300)\nf.height = Pt(240)\nt = next(x for x in s.shapes if x.name.startswith('title@'))\nt.top = Pt(330)");
      assert.ok(floorFindings(gateJson(dir, join(dir, "plate.pptx")), "OF-115").some((f) => f.slide === 3 && /open page|plate/u.test(f.detail)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R3: two tonalities of one source never draw the same skeleton (OF-116 via --sibling)", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "sample-image-b.png"), png(800, 600, [200, 205, 212]));
      copyFileSync(join(fixtures, "deck-lecture-ko.md"), join(dir, "lecture.md"));
      for (const t of ["chalk", "paper"]) {
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "lecture.md"), "--tonality", t, "--pptx", join(dir, `${t}.pptx`)], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr + built.stdout);
      }
      const pair = gateJson(dir, join(dir, "paper.pptx"), ["--sibling", join(dir, "chalk.pptx")]);
      assert.deepEqual(floorFindings(pair, "OF-116"), [], JSON.stringify(floorFindings(pair, "OF-116")));
      const same = gateJson(dir, join(dir, "paper.pptx"), ["--sibling", join(dir, "paper.pptx")]);
      const hit = floorFindings(same, "OF-116");
      assert.ok(hit.length === 1 && hit[0].severity === "HIGH" && /0 of \d+ content slides/u.test(hit[0].detail), JSON.stringify(hit));
      assert.equal(same.pass, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R4: a dark tonality draws a figure's dark variant when the source folder has one, and the gate fails a light figure card on a dark ground", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      solidPng(join(dir, "assets"), "flow.png", [255, 255, 255], [40, 40, 40]);
      const body = "layout: figure-academic\n\n## Three-stage feed layout\n\n![Figure 2. Process layout used in all runs | Source: synthetic sample diagram](assets/flow.png)\n\n- Feed split into three equal stages along the reactor\n- Inlets at 0, 1/3 and 2/3 of reactor length\n- Source: Figure 2, layout used in all 36 runs (sample)";
      const light = oneSlide(dir, "light", "night", body);
      const card = floorFindings(gateJson(dir, light.pptx), "OF-117");
      assert.ok(card.some((f) => f.severity === "HIGH" && f.slide === 1), JSON.stringify(card));
      solidPng(join(dir, "assets"), "flow.dark.png", [15, 20, 25], [230, 236, 242]);
      const dark = oneSlide(dir, "dark", "night", body);
      const media = spawnSync("unzip", ["-Z1", dark.pptx], { encoding: "utf8" }).stdout.split("\n").filter((n) => /^ppt\/media\/image/u.test(n));
      const blobs = media.map((n) => createHash("sha256").update(spawnSync("unzip", ["-p", dark.pptx, n], { encoding: "buffer", maxBuffer: 1 << 26 }).stdout).digest("hex"));
      assert.ok(blobs.includes(sha256(join(dir, "assets", "flow.dark.png"))), "the dark variant is the picture drawn");
      assert.deepEqual(floorFindings(gateJson(dir, dark.pptx), "OF-117"), []);
      // A light tonality keeps the figure as written.
      const paper = oneSlide(dir, "paper", "paper", body);
      const pmedia = spawnSync("unzip", ["-Z1", paper.pptx], { encoding: "utf8" }).stdout.split("\n").filter((n) => /^ppt\/media\/image/u.test(n));
      const pblobs = pmedia.map((n) => createHash("sha256").update(spawnSync("unzip", ["-p", paper.pptx, n], { encoding: "buffer", maxBuffer: 1 << 26 }).stdout).digest("hex"));
      assert.ok(pblobs.includes(sha256(join(dir, "assets", "flow.png"))));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R6: a chart puts the accent on its current series: the latest period, else the measured series over a plan or target, else the last", () => {
    const dir = work();
    try {
      const colours = (pptx) => partXml(pptx, "ppt/charts/chart\\d+\\.xml")[0].split("<c:ser>").slice(1)
        .map((ser) => (/<c:spPr>[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/u.exec(ser) || [])[1]);
      const deck = (name, tonality, head) => oneSlide(dir, name, tonality, `layout: chart-insight\n\n## Monthly values\n\n| Month | ${head[0]} | ${head[1]} |\n|---|---|---|\n| Apr | 3,120 | 2,610 |\n| May | 3,340 | 2,700 |\n| Jun | 3,410 | 2,820 |\n| Jul | 3,780 | 3,050 |\n\n> Monthly values (sample data)\n\n- Every month beat the comparison.`).pptx;
      assert.equal(colours(deck("y", "night", ["2026", "2025"]))[0], "E3A857", "2026 is the current year");
      assert.equal(colours(deck("q", "night", ["Q3 growth (k USD)", "Q2 growth (k USD)"]))[0], "E3A857", "Q3 is the current quarter");
      assert.equal(colours(deck("q2", "night", ["Q2 churn (%)", "Q3 churn (%)"]))[1], "E3A857");
      assert.equal(colours(deck("p", "ledger", ["실적 (점)", "계획 (점)"]))[0], "0E6B5A", "the measured series over its plan");
      assert.equal(colours(deck("s", "paper", ["Single feed (%)", "Staged feed (%)"]))[1], "8C1C2B", "else the last series, in every pack");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R8: chart data labels keep the decimals the table writes (18.0 stays 18.0)", () => {
    const dir = work();
    try {
      const { pptx } = oneSlide(dir, "d", "signal", "layout: chart-insight\n\n## 월별 전체 주문과 재주문 추이\n\n| 월 | 전체 주문 (천 건) | 재주문 (천 건) |\n|---|---|---|\n| 7월 | 11.8 | 5.4 |\n| 8월 | 14.6 | 7.3 |\n| 9월 | 18.0 | 9.7 |\n\n> 월별 전체 주문과 재주문 (예시 데이터)\n\n- 9월 주문은 1만 8천 건이다");
      const xml = partXml(pptx, "ppt/charts/chart\\d+\\.xml")[0];
      assert.match(xml, /<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0\.0"/u, "one decimal, as written");
      const whole = oneSlide(dir, "w", "signal", "layout: chart-insight\n\n## 연간 매출\n\n| 연도 | 매출 |\n|---|---|\n| 2024 | 3,520 |\n| 2025 | 3,980 |\n| 2026 | 4,420 |\n\n> 연간 매출 (예시 데이터)\n\n- 2026년 매출은 전년보다 11% 늘었다");
      assert.match(partXml(whole.pptx, "ppt/charts/chart\\d+\\.xml")[0], /<c:dLbls>[\s\S]*?<c:numFmt formatCode="#,##0"/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R9: Korean text runs carry lang ko-KR in tonality and legacy decks, Latin-only runs keep en-US", () => {
    const dir = work();
    try {
      const { pptx } = oneSlide(dir, "k", "ledger", "layout: chart-insight\n\n## 주 2일 수거, 3분기 주문 추이\n\n| 월 | 주문 (천 건) |\n|---|---|\n| 7월 | 11.8 |\n| 8월 | 14.6 |\n| 9월 | 18.0 |\n\n> 월별 주문 (예시)\n\n- 9월 주문은 Q3 최고치다 (예시)\n- Q3 2026");
      const tagged = (xml) => [...xml.matchAll(/<a:rPr([^>]*)>[\s\S]*?<a:t>([^<]*)<\/a:t>/gu)].map((m) => ({ text: m[2], lang: (/\blang="([^"]+)"/u.exec(m[1]) || [])[1], alt: (/\baltLang="([^"]+)"/u.exec(m[1]) || [])[1] }));
      const runs = partXml(pptx, "ppt/slides/slide\\d+\\.xml").flatMap(tagged);
      const korean = runs.filter((r) => /[가-힣]/u.test(r.text));
      assert.ok(korean.length > 3 && korean.every((r) => r.lang === "ko-KR" && r.alt === "en-US"), JSON.stringify(korean.filter((r) => r.lang !== "ko-KR")));
      assert.ok(runs.some((r) => r.text === "Q3 2026" && r.lang === "en-US"));
      const chart = partXml(pptx, "ppt/charts/chart\\d+\\.xml")[0];
      assert.match(chart, /<c:lang val="ko-KR"\/>/u, "a chart with Korean labels is a Korean chart");
      const legacy = deck(join(fixtures, "deck-azure.md"), "AZURE-PRO", dir);
      assert.equal(legacy.status, 0, legacy.stderr);
      const lruns = partXml(join(dir, "deck.pptx"), "ppt/slides/slide\\d+\\.xml").flatMap(tagged).filter((r) => /[가-힣]/u.test(r.text));
      assert.ok(lruns.length > 3 && lruns.every((r) => r.lang === "ko-KR"), JSON.stringify(lruns.filter((r) => r.lang !== "ko-KR").slice(0, 3)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Fix round 3 (spec-v2 Amendments 8) ──
  // The largest empty band inside a text column, from the top of a block list down to where the visual ends, as a share of the body.
  const columnGap = (blocks, top, reach, floor = 486) => {
    let gap = 0;
    let cursor = top;
    for (const b of [...blocks].sort((m, n) => m.y - n.y)) { gap = Math.max(gap, b.y - cursor); cursor = Math.max(cursor, b.y + b.h); }
    return Math.max(gap, reach - cursor) / (floor - top);
  };

  it("T1: two or three short takeaways beside a chart, figure rows or a picture fill their column by layout; the gate fails a column that stops short (OF-115)", () => {
    const dir = work();
    try {
      // A chart with its values under it and two short takeaways beside it (the sibling example 12 p6 shape).
      const chart = oneSlide(dir, "c", "studio", "layout: chart-insight\ntitle: top-plain-large\n\n## 유사 기획전의 관람객 추이\n\n::: chart type=column unit=\"만 명\"\n| 전시 | 1주 차 (만 명) | 4주 차 (만 명) | 8주 차 (만 명) |\n|---|---|---|---|\n| 2023년 원도심 옛 지도전 | 4.1 | 9.8 | 14.2 |\n| 2024년 항구 사진전 | 5.6 | 13.1 | 21.4 |\n| 2025년 근대 생활사전 | 6.2 | 15.7 | 26.9 |\n> 유사 기획전 세 건의 누적 관람객 (예시 데이터)\n:::\n\n- 최근 전시일수록 누적 관람객이 많고, 8주 차 평균 2.08만 명\n- 이번 전시 목표는 8주 2.5만 명\n- 출처: 예시 시립미술관 관람객 집계(2023~2025년)");
      const plot = chart.shapes.find((s) => s.chart);
      const points = chart.shapes.filter((s) => /^(최근 전시일수록|이번 전시 목표)/u.test(s.text));
      const beside = points.filter((s) => s.x >= plot.x + plot.w - 1);
      if (beside.length) {
        const top = Math.min(plot.y, ...beside.map((s) => s.y));
        assert.ok(columnGap(beside, top, Math.min(486, plot.y + plot.h)) <= 0.4, `takeaway column: ${JSON.stringify(beside.map((s) => [s.text.slice(0, 8), Math.round(s.y), Math.round(s.h)]))}`);
      } else {
        // Two short points cannot fill even a three-column column: they run under the chart, side by side.
        assert.ok(points.length === 2 && points.every((s) => s.y >= plot.y + plot.h - 1) && points[0].x !== points[1].x, JSON.stringify(points));
        assert.ok(plot.w >= 0.9 * 912, `the chart takes the body's width: ${plot.w}`);
      }
      assert.deepEqual(floorFindings(gateJson(dir, chart.pptx), "OF-115"), []);
      // Figure rows beside three short takeaways (example 01 p6).
      const rows = oneSlide(dir, "k", "signal", "layout: kpi-row\ntitle: bottom-anchor\n\n## 출시 6개월 주문·재주문 지표\n\n| 월 주문 | 재주문 비율 | 평균 객단가 | 월 거래액 | 활성 고객 |\n|---|---|---|---|---|\n| 1만 8천 건 | 54% | 2만 1천 원 | 3억 7,800만 원 | 7,800명 |\n| 4월 6,200건 | 4월 31% | 목표 2만 원 | 4월 1억 2,400만 원 | 4월 3,100명 |\n\n> 2026년 9월 기준, 내부 주문 기록 (예시)\n\n- 출시 6개월 만에 재주문 비율이 절반을 넘었다 (31% → 54%)\n- 재주문 고객의 월평균 주문은 2.3회로 신규 고객의 두 배다\n- 평균 객단가는 목표 2만 원보다 5% 높다\n- 출처: 내부 주문 기록, 2026년 4-9월 (예시)");
      assert.deepEqual(floorFindings(gateJson(dir, rows.pptx), "OF-115"), [], "the takeaways beside the figure rows share the column");
      // A wide picture beside five takeaways takes most of the body (it stood in half of it, a third of its column empty above it).
      solidPng(dir, "wide.png", [220, 224, 230], [150, 156, 166]);
      const pic = oneSlide(dir, "p", "signal", "layout: image-split\ntitle: bottom-anchor\n\n## 맞벌이 가구 주간 세탁 소요 시간\n\n![도 1. 주말 세탁 장면 | 출처: 예시 이미지](wide.png)\n\n- 맞벌이 가구는 빨래에 주말 반나절을 쓴다: 주 4.2시간 중 68%\n- 1인 가구는 주 2.6시간, 평일 저녁 비중이 32%로 더 높다\n- 세탁소 방문은 월 3.1회, 한 번에 왕복 평균 24분이 걸린다\n- 응답 가구 41%가 월 2만 원 이하면 대행을 쓰겠다고 답했다\n- 출처: 수도권 맞벌이·1인 가구 600가구 설문, 2026년 6월 (예시)");
      const image = pic.shapes.find((s) => s.picture);
      assert.ok(image && image.w >= 0.55 * 912, `the picture takes more than half the body: ${JSON.stringify(image)}`);
      assert.deepEqual(floorFindings(gateJson(dir, pic.pptx), "OF-115"), []);
      // The gate reads the band inside the column, not its last block: a column whose points stop high above the source strip fails.
      plant(pic.pptx, join(dir, "short.pptx"), "s = p.slides[0]\nk = 0\nfor sh in s.shapes:\n    if sh.has_text_frame and sh.text_frame.text.startswith(('맞벌이 가구는', '1인 가구는', '세탁소 방문은', '응답 가구')):\n        sh.top, sh.height = Pt(40 + 20 * k), Pt(18)\n        k += 1");
      assert.ok(floorFindings(gateJson(dir, join(dir, "short.pptx")), "OF-115").some((f) => /column beside a longer one/u.test(f.detail)), JSON.stringify(floorFindings(gateJson(dir, join(dir, "short.pptx")), "OF-115")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T1: a takeaway column that closes with the chart's values fills by layout; the gate reads the values table as part of that column (OF-115)", () => {
    const dir = work();
    try {
      // Two short takeaways, the chart's values under them and the source on the floor (a sibling example shape that stood 42 % empty under the table).
      const { pptx, shapes } = oneSlide(dir, "v", "studio", "layout: asymmetric-feature\n\n## Unit sales by glaze, Q3\n\n::: chart type=bar unit=\"units\"\n| Glaze | Units |\n|---|---|\n| Ash white | 4,820 |\n| Iron black | 3,610 |\n| Celadon | 2,140 |\n| Speckled oat | 1,930 |\n> Units sold by glaze (example data)\n:::\n\n- **Lead** Ash white, 39% of units\n- **Plan** Celadon moves to a gift box of two\n- Source: Example studio sales ledger");
      const plot = shapes.find((s) => s.chart);
      const column = shapes.filter((s) => (s.table || /^(Lead|Plan|Source):/u.test(s.text)) && s.x >= plot.x + plot.w - 1);
      if (column.length) {
        const top = Math.min(plot.y, ...column.map((s) => s.y));
        assert.ok(columnGap(column, top, Math.min(486, plot.y + plot.h)) <= 0.4, `takeaway column: ${JSON.stringify(column.map((s) => [s.text.slice(0, 8), Math.round(s.y), Math.round(s.h)]))}`);
      }
      assert.deepEqual(floorFindings(gateJson(dir, pptx), "OF-115"), []);
      // The same column set by hand, the table under two one-line points and the source on the floor, fails.
      plant(pptx, join(dir, "hole.pptx"), `s = p.slides[0]
for sh in s.shapes:
    t = sh.text_frame.text if sh.has_text_frame else ""
    if getattr(sh, "has_chart", False) and sh.has_chart:
        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(108), Pt(366), Pt(358)
    elif t.startswith("Figure 1."):
        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(472), Pt(366), Pt(14)
    elif t.startswith(("Lead:", "Plan:")):
        sh.left, sh.top, sh.width, sh.height = Pt(434), Pt(108 if t.startswith("Lead:") else 136), Pt(502), Pt(22)
    elif t.startswith("Source:"):
        sh.left, sh.top, sh.width, sh.height = Pt(414), Pt(474), Pt(522), Pt(12)
    elif getattr(sh, "has_table", False) and sh.has_table:
        sh.left, sh.top, sh.width = Pt(414), Pt(177), Pt(522)
        for row in sh.table.rows:
            row.height = Pt(140 / len(sh.table.rows))
        sh.height = Pt(140)
    elif sh.width < Pt(8) and sh.height < Pt(8):
        sh.left = Pt(414)`);
      const hole = floorFindings(gateJson(dir, join(dir, "hole.pptx")), "OF-115");
      assert.ok(hole.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)), JSON.stringify(hole));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("K1: takeaways beside figure rows fill their column down to the body floor; the gate measures that column to the floor, not to where the rows stop (OF-115)", () => {
    const dir = work();
    try {
      // Four figures and four takeaways under a bottom title (a sibling example that stood 45 % open under its takeaways).
      const { pptx, shapes } = oneSlide(dir, "k", "signal", "layout: kpi-row\ntitle: bottom-anchor\n\n## 출시 9개월 고객사·설비 지표\n\n| 고객사 | 연결 설비 | 월 반복 매출 | 해지율 |\n|---|---|---|---|\n| 46곳 | 3,820대 | 3,440만 원 | 월 1.1% |\n| 1월 9곳 | 1월 610대 | 1월 550만 원 | 목표 2% 이하 |\n\n- 막은 정지 212건, 건당 약 800만 원씩 고객사 손실 약 17억 원 절감\n- 1월 대비 고객사 5.1배(9곳 → 46곳), 연결 설비 6.3배(610대 → 3,820대)\n- 고객사 한 곳당 설비 약 83대, 월 반복 매출 약 75만 원(설비당 약 9천 원)\n- 해지율 월 1.1%, 목표 2%의 절반 남짓\n- 출처: 내부 계약·알림 기록, 2026년 1-9월 (예시)");
      const title = shapes.find((s) => s.text.startsWith("출시 9개월"));
      const figure = shapes.find((s) => s.text === "46곳");
      const points = shapes.filter((s) => /^(막은 정지|1월 대비|고객사 한 곳당|해지율 월)/u.test(s.text));
      const source = shapes.find((s) => s.text.startsWith("출처:"));
      assert.equal(points.length, 4);
      const beside = points.filter((s) => s.x > figure.x + 200);
      if (beside.length === points.length) {
        // Beside the rows the points share the column down to the source strip on the floor.
        assert.ok(columnGap([...beside, source], figure.y, title.y, title.y) <= 0.4, `takeaway column: ${JSON.stringify(beside.map((s) => [s.text.slice(0, 6), Math.round(s.y), Math.round(s.h)]))}`);
      }
      assert.deepEqual(floorFindings(gateJson(dir, pptx), "OF-115"), []);
      // The points set close under one another at the top of the column, as before the fix: the gate fails it even
      // though the figure rows beside them stop above the floor too.
      plant(pptx, join(dir, "short.pptx"), "s = p.slides[0]\nk = 0\nx = max(sh.left for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith('출처:'))\nfor sh in s.shapes:\n    if sh.has_text_frame and sh.text_frame.text.startswith(('막은 정지', '1월 대비', '고객사 한 곳당', '해지율 월')):\n        sh.left, sh.top, sh.width, sh.height = x + Pt(20), Pt(36 + 56 * k), Pt(346), Pt(50 if k < 3 else 25)\n        k += 1\n    elif sh.width < Pt(8) and sh.height < Pt(8):\n        sh.top = Pt(4)");
      const short = floorFindings(gateJson(dir, join(dir, "short.pptx")), "OF-115");
      assert.ok(short.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)), JSON.stringify(short));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T1: summary groups of unequal length split where the two columns come out nearest even (OF-115)", () => {
    const dir = work();
    try {
      // Three groups of three, three and two points: split by count, the third stood alone and left its column half empty.
      const { pptx, shapes } = oneSlide(dir, "s", "gazette", "layout: summary-box-list\n\n## 검토 결과 핵심 요약과 건의 방향\n\n::: key-message\n재택근무를 주 2일로 정례화하되, 팀마다 협업일 하루를 지정해 대면 회의를 그날에 모은다\n:::\n\n- **시범 운영 결과**\n  (1) 월평균 이용률 78%, 본부 간 편차 최대 21%p\n  (2) 업무 만족도 3.4점 → 4.1점 (5점 척도, 응답 523명)\n  (3) 과제 기한 준수율 92% → 93%, 생산성 변화는 미미\n- **남은 불편**\n  (1) 불편 사항의 64%가 회의 일정 조율과 대면 협업 부족\n  (2) 주간 회의 시간 1인당 4.1시간에서 5.3시간으로 증가\n  (3) 신규 입사자 업무 적응 기간 평균 2주 증가 (6주 → 8주)\n- **건의 방향**\n  (1) 제도 자체보다 협업일 운영 방식이 성패를 가른다\n  (2) 비용은 회의실 예약 체계 개편 4천만 원뿐이다\n- 출처: 재택근무 시범 운영 기록과 직원 만족도 조사, 2025.10-2026.09 (예시)");
      const left = shapes.find((s) => s.text.startsWith("시범 운영 결과"));
      const right = shapes.find((s) => s.text.includes("건의 방향"));
      assert.ok(left && right && right.x > left.x + 100, JSON.stringify([left, right]));
      const second = shapes.find((s) => s.text.includes("남은 불편"));
      assert.ok(second && Math.abs(second.x - right.x) < 1, `the second group stands in the right column with the third: ${JSON.stringify(second)}`);
      assert.deepEqual(floorFindings(gateJson(dir, pptx), "OF-115"), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T1: a short sidebar note beside a long main column stands across the top and the main points run in two columns under it", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "n", "chalk", "layout: sidebar-note\ntitle: top-rule\n\n## Four common calibration mistakes\n\n- **Reading outside the standards**\n  (1) A sample above 8 mg/L must be diluted and measured again\n  (2) The fit says nothing about linearity beyond the top standard\n- **Forcing the line through zero**\n  (1) A blank still gives a small signal, and dropping it biases low samples\n  (2) Here, forcing zero moves a 0.5 mg/L sample by about 2%\n- **Measuring standards in one rising run**\n  (1) Drift over the run then looks like a change in slope\n  (2) Randomise the order and rerun the blank at the end\n- **Skipping the residual check**\n  (1) A high r² can hide one bad standard; the practice run still had r² 0.99\n  (2) Read the residual table before you read the slope\n\n::: main-box\nReport the value, its interval and the standard range together\n:::");
      const note = shapes.find((s) => s.text.startsWith("Report the value"));
      const heads = shapes.filter((s) => /^(Reading outside|Forcing the line|Measuring standards|Skipping the residual)/u.test(s.text));
      assert.ok(note && heads.every((h) => h.y > note.y + note.h), "the note stands above the main points");
      assert.ok(new Set(heads.map((h) => Math.round(h.x))).size === 2, `two columns: ${JSON.stringify(heads.map((h) => Math.round(h.x)))}`);
      assert.deepEqual(floorFindings(gateJson(dir, pptx), "OF-115"), []);
      // The note in a narrow column beside main points that stop short of three quarters of the body: the
      // gate still reads the band under the note against where the points end.
      plant(pptx, join(dir, "beside.pptx"), `s = p.slides[0]
y = 120
for sh in s.shapes:
    t = sh.text_frame.text if sh.has_text_frame else ""
    if t.startswith("Report the value"):
        sh.left, sh.top, sh.width, sh.height = Pt(660), Pt(120), Pt(264), Pt(50)
    elif sh.has_text_frame and t and not sh.name.startswith(("title@", "lit-notice")):
        sh.left, sh.top, sh.width, sh.height = Pt(24), Pt(y), Pt(600), Pt(18)
        y += 22
    elif not sh.has_text_frame or not t:
        if not sh.name.startswith(("family@", "lit-notice")):
            sh.left, sh.top, sh.width, sh.height = Pt(648), Pt(120), Pt(288), Pt(62)`);
      const beside = floorFindings(gateJson(dir, join(dir, "beside.pptx")), "OF-115");
      assert.ok(beside.some((f) => f.severity === "HIGH" && /column beside a longer one/u.test(f.detail)), JSON.stringify(beside));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T3: a next-step line that fits the box sets on one line across it; a longer one keeps the measure with even lines", () => {
    const dir = work();
    try {
      const { shapes } = oneSlide(dir, "a", "chalk", "layout: closing-ask\n\n## 5강 전까지 회귀 실습 과제\n\n| 과제 | 분량 | 배점 | 기한 | 확인할 점 |\n|---|---|---|---|---|\n| 산점도와 회귀선 그리기 | 자료 20건 이상 | 6점 | 10월 5일(월) | 이상값 표시 |\n| 기울기 해석하기 | 1문장 | 4점 | 10월 6일(화) | 단위 포함 |\n| 잔차 그림과 이상값 확인 | 그림 1장 | 6점 | 10월 7일(수) | 곡선 패턴 여부 |\n| R² 해석하기 | 2문장 이내 | 4점 | 10월 8일(목) | '정확도'로 읽지 않기 |\n\n- 과제: 5강(10월 9일) 전까지 자료 20건 이상으로 회귀를 직접 한 번 해 본다\n- 제출: 단계마다 기한까지 학습 게시판의 한 게시물에 이어서 올린다 (4강 과제, 총 20점)\n- 다음 시간: 잔차 분석과 다중회귀, 질문은 전날까지 게시판에 (예시 강사)");
      const task = shapes.find((s) => s.text.startsWith("과제:"));
      assert.ok(task && lines(task.text).length === 1 && task.w >= 700, `one line across the box: ${JSON.stringify(task)}`);
      // The old 34-em measure broke this line before its last word ("해 본다" alone on line two).
      for (const s of shapes.filter((x) => /^(과제|제출|다음 시간):/u.test(x.text))) assert.ok(s.w >= 400, JSON.stringify(s));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T4: an agenda takes no count numeral beside its title, and the gate fails one (OF-119)", () => {
    const dir = work();
    try {
      const { pptx, shapes } = oneSlide(dir, "g", "chalk", "layout: agenda\n\n## 4강 학습 목표와 순서\n\n- **표본과 모집단** 전부를 볼 수 없을 때 일부로 짐작하는 이유\n- **표본 평균의 흔들림** 같은 방법으로 뽑아도 평균이 매번 다른 까닭\n- **신뢰구간 계산** 평균, 표준편차, 표본 크기로 범위를 구하는 네 단계\n- **흔한 실수** 구간을 잘못 읽는 세 가지 방식");
      const title = shapes.find((s) => s.name.startsWith("title@"));
      assert.notEqual(title.name, "title@kicker-numeral");
      assert.ok(!shapes.some((s) => s.text === "4" && s.y < 120), "no stray numeral beside the title");
      assert.ok(title.x <= 30, `the title starts at the margin: ${title.x}`);
      plant(pptx, join(dir, "k.pptx"), "s = p.slides[0]\nt = [sh for sh in s.shapes if sh.name.startswith('title@')][0]\nt.left = Pt(180)\nt.name = 'title@kicker-numeral'\nb = s.shapes.add_textbox(Pt(24), Pt(36), Pt(120), Pt(72))\nb.text_frame.text = '4'\nb.text_frame.paragraphs[0].runs[0].font.size = Pt(60)");
      assert.ok(gateOn(dir, join(dir, "k.pptx"), 1).some((f) => f.check === "OF-119"), JSON.stringify(gateOn(dir, join(dir, "k.pptx"), 1).map((f) => f.check)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T5: two tonalities of one source differ on at least two content slides (OF-116 needs two), and a pack draws a comparison with its own structure", () => {
    const dir = work();
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "sample-image-b.png"), png(800, 600, [200, 205, 212]));
      copyFileSync(join(fixtures, "deck-lecture-ko.md"), join(dir, "lecture.md"));
      for (const t of ["chalk", "paper"]) {
        const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "lecture.md"), "--tonality", t, "--pptx", join(dir, `${t}.pptx`)], { cwd: dir, encoding: "utf8" });
        assert.equal(built.status, 0, built.stderr);
      }
      assert.deepEqual(floorFindings(gateJson(dir, join(dir, "chalk.pptx"), ["--sibling", join(dir, "paper.pptx")]), "OF-116"), []);
      const cmp = (t) => shapesOf(join(dir, `${t}.pptx`)).slides.map((s) => s.find((x) => x.name.startsWith("title@"))?.name).filter(Boolean);
      assert.ok(cmp("paper").length && cmp("chalk").length);
      // One differing slide is not enough once a deck has four content slides.
      // craft_extras re-executes itself under the office runtime, so the probe runs as a file, not with -c.
      writeFileSync(join(dir, "bar.py"), "import sys\nsys.path.insert(0, sys.argv[1])\nimport craft_extras as c\na = [('top', 'one')] * 6\nb = [('side', 'one')] + a[1:]\nseq = iter([a, b, a, [('side', 'one'), ('side', 'grid')] + a[2:]])\nc.skeleton = lambda prs: next(seq)\nc.Presentation = lambda path: None\nprint(len(c.compare_skeletons('x', 'y')), len(c.compare_skeletons('x', 'y')))\n");
      const bar = spawnSync(runtimePython, ["-B", join(dir, "bar.py"), join(pptxRoot, "scripts")], { encoding: "utf8" });
      assert.equal(bar.status, 0, bar.stderr);
      assert.equal(bar.stdout.trim(), "1 0", "one differing slide of six fails, two pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T6: a series keeps one colour across the deck: alone on a chart it takes the colour it has beside the highlighted series", () => {
    const dir = work();
    try {
      writeFileSync(join(dir, "s.md"), "---\ntonality: paper\ntitle: Staged feeding\n---\n\n---\nlayout: chart-insight\n\n## Single-feed baseline conversion\n\n::: chart type=line unit=\"%\"\n| Time (min) | Single feed (%) |\n|---|---|\n| 0 | 0 |\n| 30 | 35 |\n| 60 | 50 |\n:::\n\n- Conversion stalls after minute 30\n---\n\n---\nlayout: chart-insight\n\n## Staged vs single feed conversion\n\n::: chart type=line unit=\"%\"\n| Time (min) | Single feed (%) | Staged feed (%) |\n|---|---|---|\n| 0 | 0 | 0 |\n| 30 | 35 | 47 |\n| 60 | 50 | 75 |\n:::\n\n- The staged feed reaches 75% at 60 min\n---\n");
      const built = spawnSync(process.execPath, [join(pptxRoot, "scripts", "compile-deck.js"), join(dir, "s.md"), "--pptx", join(dir, "s.pptx")], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const charts = partXml(join(dir, "s.pptx"), "ppt/charts/chart\\d+\\.xml");
      const colours = (xml) => [...xml.matchAll(/<c:ser>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/gu)].map((m) => m[1].toUpperCase());
      const [single, pair] = charts.map(colours);
      assert.equal(single[0], pair[0], `Single feed alone ${single[0]}, beside Staged feed ${pair[0]}`);
      assert.notEqual(pair[0], pair[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T7: a wide method figure runs across the body over its terms, and the Studio statement stands between hairlines", () => {
    const dir = work();
    try {
      solidPng(dir, "flow.png", [255, 255, 255], [40, 44, 52]);
      const run = spawnSync(runtimePython, ["-B", "-c", "import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]); im.crop((0, 120, 800, 350)).save(sys.argv[1])", join(dir, "flow.png")], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const { shapes } = oneSlide(dir, "m", "paper", "layout: method\n\n## Three-stage feed layout and symbols\n\n![Figure 2. Process layout used in all runs | Source: synthetic sample diagram](flow.png)\n\n- **Layout:** the feed splits into three equal stages, inlets at 0, 1/3 and 2/3 of reactor length\n- **X:** conversion, the fraction of feed reacted\n  (1) Sampled at the outlet every 10 min, 0-60 min\n- **k, τ:** rate constant (1/min) and residence time (min); τ = V / F\n- **n:** number of feed stages\n  (1) n = 3 in all staged runs; n = 1 for the single-feed baseline\n- **F:** total feed rate, L/min\n  (1) Six rates tested: 0.5, 0.75, 1.0, 1.25, 1.5 and 2.0\n- Source: Figure 2, layout used in all 36 runs (sample)");
      const fig = shapes.find((s) => s.picture);
      const terms = shapes.filter((s) => /^(Layout|X|k, τ|n|F):/u.test(s.text) || /Layout:|conversion, the fraction/u.test(s.text));
      assert.ok(fig.w >= 450, `the wide figure is drawn wider than half the body: ${JSON.stringify(fig)}`);
      assert.ok(terms.length && terms.every((t) => t.y >= fig.y + fig.h), `terms under the figure: ${JSON.stringify(terms.map((t) => [t.text.slice(0, 10), Math.round(t.y)]))}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T8: a bold run-in label takes its colon in the engine, and the gate fails one without a separator (OF-118)", () => {
    const dir = work();
    try {
      // Points with and without a label stay one list (all-labelled points would set the labels in a column of their own).
      const { pptx } = oneSlide(dir, "r", "signal", "layout: text-column\ntitle: top-rule\n\n## 서비스 흐름 요약\n\n- **요약** 앱에서 맡기면 저녁에 문 앞에서 수거하고 다음 날 저녁 9시 전에 돌려준다\n- **주문:** 오후 6-8시 사이 30분 단위로 수거 시간을 고른다\n- 배송 기사가 저녁 8시까지 문 앞에서 수거한다");
      const runs = boldRuns(pptx, 0);
      assert.ok(runs.some((r) => r.bold && r.text === "요약:"), JSON.stringify(runs));
      assert.ok(runs.some((r) => r.bold && r.text === "주문:") && !runs.some((r) => r.text.includes("::")), "a label with its own colon keeps one");
      assert.deepEqual(gateOn(dir, pptx, 1).filter((f) => f.check === "OF-118"), []);
      plant(pptx, join(dir, "bare.pptx"), "s = p.slides[0]\nfor sh in s.shapes:\n    if sh.has_text_frame:\n        for para in sh.text_frame.paragraphs:\n            for r in para.runs:\n                if r.text == '요약:':\n                    r.text = '요약'");
      assert.ok(gateOn(dir, join(dir, "bare.pptx"), 1).some((f) => f.check === "OF-118"), "a bold label running into its sentence is reported");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T9: a single takeaway stays with its timeline, a chart states its unit once (legend or a level axis title), and a contact-split field starts where its rows end", () => {
    const dir = work();
    try {
      const tl = oneSlide(dir, "t", "gazette", "layout: timeline\ntitle: top-rule\n\n## 4분기 일정\n\n| 시점 | 일 | 상태 |\n|---|---|---|\n| 10월 2주 | 결제 이관 | 진행 |\n| 10월 4주 | 통합 시험 | 예정 |\n| 11월 2주 | 전체 공개 | 예정 |\n\n- 결제 이관이 끝나면 통합 시험을 바로 시작한다");
      const take = tl.shapes.find((s) => s.text.startsWith("결제 이관이 끝나면"));
      const labels = tl.shapes.filter((s) => /^(결제 이관|통합 시험|전체 공개)$/u.test(s.text));
      const lowest = Math.max(...labels.map((s) => s.y + s.h));
      assert.ok(take.y - lowest <= 60, `the takeaway follows the axis: label foot ${Math.round(lowest)}, takeaway ${Math.round(take.y)}`);
      const two = oneSlide(dir, "u", "ledger", "layout: chart-insight\ntitle: top-rule\n\n## 주차별 남은 작업 수\n\n::: chart type=line unit=\"개\"\n| 주차 | 계획 (개) | 실적 (개) |\n|---|---|---|\n| 8월 4주 | 30 | 30 |\n| 9월 2주 | 21 | 22 |\n| 10월 2주 | 0 | 3 |\n:::\n\n- 남은 작업은 주당 다섯 개씩 줄어 11월 첫 주에 끝난다");
      assert.doesNotMatch(partXml(two.pptx, "ppt/charts/chart\\d+\\.xml")[0], /<c:valAx>[\s\S]*<c:title>/u, "the legend carries the unit, so the axis carries no title");
      const one = oneSlide(dir, "v", "ledger", "layout: chart-insight\ntitle: top-rule\n\n## 회차별 사용성 시험 과업 성공률\n\n::: chart type=column unit=\"%\"\n| 회차 | 과업 성공률 |\n|---|---|\n| 1차 | 68 |\n| 2차 | 77 |\n| 3차 | 84 |\n:::\n\n- 3차 시험에서 84%로 목표 85%에 다가섰다");
      const axis = /<c:valAx>[\s\S]*?<c:title>[\s\S]*?<a:bodyPr rot="(-?\d+)"/u.exec(partXml(one.pptx, "ppt/charts/chart\\d+\\.xml")[0]);
      assert.ok(axis && Number(axis[1]) % 21600000 === 0, `a level axis title: ${axis && axis[1]}`);
      const close = oneSlide(dir, "w", "studio", "layout: closing-contact-split\n\n## 11월 본 판매 입점 조건 협의 안건\n\n| 안건 | 담당 | 일정 |\n|---|---|---|\n| 매장 전시·시연 | 예시 영업팀 | 10월 셋째 주 |\n| 초도 물량·납기 | 예시 생산팀 | 10월 말 |\n| 설치 서비스 | 예시 고객지원팀 | 10월 말 |\n\n- 요청: 조건 세 가지를 정한다");
      const field = close.shapes.find((s) => s.fill && s.x > 300 && Math.round(s.x + s.w) === 960);
      // The field moves left only when the rows and the step keep their sizes and line counts (it never costs type).
      assert.ok(field && field.x < 24 + 912 * 7 / 12 - 12, `the field starts where the rows end: ${JSON.stringify(field)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the Python helpers leave no bytecode in the plugin", () => {
    const caches = [...walk(pptxRoot), ...walk(docxRoot), ...walk(libRoot)].filter((file) => file.includes("__pycache__"));
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
