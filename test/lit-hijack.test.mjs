import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceFiles } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { LIT_SKILL_IDS } from "../plugins/litclaude/lib/mod/skills.mjs";
import {
  buildImplementerBrief,
  checkRun,
  decideLicence,
  detectLicence,
  findOverlap,
  fxtwitterToMarkdown,
  parseXStatusUrl,
} from "../plugins/litclaude/skills/lit-hijack/scripts/hijack.mjs";
import { stripAnsi } from "../scripts/strip-ansi.mjs";
import { assertNoWorkflowActivationContext } from "./helpers/hook-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const skillDir = join(pluginRoot, "skills", "lit-hijack");
const cliPath = join(skillDir, "scripts", "hijack.mjs");
const read = (path) => readFileSync(join(root, path), "utf8");

let temp;
let env;
let counter = 0;

before(() => {
  temp = mkdtempSync(join(tmpdir(), "litclaude-hijack-"));
  env = {
    PATH: process.env.PATH,
    HOME: join(temp, "home"),
    LITCLAUDE_HOME: join(temp, "lit-home"),
    CLAUDE_HOME: join(temp, "claude-home"),
    CLAUDE_CONFIG_DIR: join(temp, "claude-config"),
    LITCLAUDE_HUD_STATE_ROOT: join(temp, "hud-state"),
    LITCLAUDE_NO_UPDATE_CHECK: "1",
    LITCLAUDE_NO_AUTO_UPDATE: "1",
    NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
  mkdirSync(env.HOME, { recursive: true });
});

after(() => rmSync(temp, { recursive: true, force: true }));

const freshDir = (name) => {
  const dir = join(temp, `${name}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const projectCwd = () => {
  const cwd = freshDir("proj");
  writeFileSync(join(cwd, "package.json"), "{}\n");
  return cwd;
};

const runHook = (prompt, cwd = projectCwd()) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    env,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd }),
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  return { context: parsed.hookSpecificOutput.additionalContext, message: stripAnsi(parsed.systemMessage ?? "") };
};

const routeOf = (prompt) => {
  const { context, message } = runHook(prompt);
  return { context, route: /LIT IGNITED · ([a-z-]+)/u.exec(message)?.[1] ?? null };
};

const cli = (args, cwd = temp) => spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8", env });

// Own-written sample prose. Nothing here is taken from a real post.
const SOURCE_PROSE = [
  "A careful studio writes the brief before any frame exists, so the model cannot fill gaps with its favourite defaults.",
  "The brief names the one thing a viewer must remember and the outcome that would make the film unacceptable to ship.",
].join(" ");
const PARAPHRASE = "Pin the takeaway and the rejection condition in a short production note first; only then may rendering start.";

describe("lit-hijack enrollment", () => {
  it("is a canonical skill with its own command, references, script and pinned resources", () => {
    assert.ok(canonicalSkillIds.includes("lit-hijack"), "canonical skill catalog");
    assert.ok(LIT_SKILL_IDS.includes("lit-hijack"), "LIT card skill ids");
    assert.ok(existsSync(join(pluginRoot, "commands", "lit-hijack.md")), "slash command file");
    for (const path of [
      "skills/lit-hijack/SKILL.md",
      "skills/lit-hijack/scripts/hijack.mjs",
      "skills/lit-hijack/references/capture-and-provenance.md",
      "skills/lit-hijack/references/distil-and-licence.md",
      "skills/lit-hijack/references/gap-and-port-design.md",
      "skills/lit-hijack/references/clean-room-build.md",
      "skills/lit-hijack/references/parity-and-report.md",
    ]) {
      assert.ok(existsSync(join(pluginRoot, path)), `${path} ships`);
      assert.ok(canonicalSkillResourceFiles.includes(path), `${path} is pinned and installed`);
    }
  });

  it("lists the command, the skill and the route in the docs a user reads", () => {
    for (const path of ["docs/hooks.md", "docs/guide.md", "docs/guide_ko-KR.md"]) {
      assert.match(read(path), /lit hijack/u, `${path} names the route`);
    }
    for (const path of ["docs/skills.md", "docs/skills_ko-KR.md"]) {
      assert.match(read(path), /<code>lit-hijack<\/code>/u, `${path} has the row`);
    }
    assert.ok(existsSync(join(root, "docs", "assets", "skills", "lit-hijack.webp")), "skill snapshot");
  });

  it("states its mode contract in the prompt hook", () => {
    assert.match(read("plugins/litclaude/bin/litclaude-hook.js"), /Mode contract: lit-hijack ports the mechanisms/u);
  });

  it("is named by the neighbours it hands work to", () => {
    for (const neighbour of ["litresearch", "lit-plan", "start-work"]) {
      assert.match(read(`plugins/litclaude/skills/${neighbour}/SKILL.md`), /`lit-hijack`/u, `${neighbour} points at lit-hijack`);
    }
  });
});

describe("lit-hijack routing", () => {
  it("routes the hijack words to lit-hijack ahead of plan, review and research", () => {
    for (const prompt of [
      "lit hijack https://x.com/someone/status/1 into my motion skill",
      "lit hijacking the review lanes from this repo into my plan skill",
      "lit hijack this repo's research method into a new skill",
      "lit 하이재킹 이 글의 기법을 내 스킬에",
      "lit 하이잭 이 PDF 두 개",
      "lit-hijack these five posts",
      "$lit-hijack https://github.com/example/repo",
    ]) {
      const { context, route } = routeOf(prompt);
      assert.equal(route, "lit-hijack", `${prompt} should route to lit-hijack`);
      assert.match(context, /Skill\(lit-hijack\)/u, prompt);
      assert.match(context, /\/litclaude:lit-hijack/u, prompt);
      assert.match(context, /Mode contract: lit-hijack/u, prompt);
      assert.doesNotMatch(context, /Skill\((lit-plan|review-work|litresearch)\)/u, prompt);
    }
  });

  it("names the installed SKILL.md and offers a /goal line for the long run", () => {
    const { context } = routeOf("lit hijack the brief technique from this post into my skill");
    assert.match(context, /<litclaude-skill-body name="lit-hijack">\s*Load this exact installed entrypoint "[^"]+\/skills\/lit-hijack\/SKILL\.md"/u);
    assert.match(context, /\/goal Continue until/u);
  });

  it("keeps the neighbouring routes where they were", () => {
    for (const [prompt, expected] of [
      ["lit plan the hijack report layout", "lit-plan"],
      ["lit review the hijack ledger", "review-work"],
      ["lit research session hijack defences", "litresearch"],
      ["lit debug the session hijack in the login flow", "debugging"],
      ["lit fix the session hijack bug", "lit-loop"],
    ]) {
      assert.equal(routeOf(prompt).route, expected, prompt);
    }
  });

  it("stays ahead of the schematic route when the material is a drawing technique", () => {
    for (const [prompt, expected] of [
      ["lit hijack the P&ID drawing technique from this post into lit-schematic", "lit-hijack"],
      ["lit 하이재킹 이 글의 컷어웨이 그리는 기법을 내 스킬에", "lit-hijack"],
      ["lit hijack this cutaway motion video technique into my skill", "lit-hijack"],
      ["lit draw a P&ID of the hijack test rig", "lit-schematic"],
    ]) {
      assert.equal(routeOf(prompt).route, expected, prompt);
    }
  });

  it("does not activate on slash forms, code spans, or the word without lit", () => {
    for (const prompt of [
      "/lit-hijack these posts",
      "/litclaude:lit-hijack these posts",
      "/lit hijack these posts",
      "`lit hijack these posts`",
      "hijack these posts into my skill",
      "how do attackers hijack a session cookie?",
    ]) {
      const { context, message } = runHook(prompt);
      assert.equal(message, "", `${prompt} should not ignite`);
      assertNoWorkflowActivationContext(context, prompt);
    }
  });
});

describe("hijack.mjs capture helpers", () => {
  it("parses X status URLs and nothing else", () => {
    assert.equal(parseXStatusUrl("https://x.com/someone/status/2105643919119696297"), "2105643919119696297");
    assert.equal(parseXStatusUrl("https://twitter.com/a_b/status/42?s=20"), "42");
    assert.equal(parseXStatusUrl("https://x.com/i/article/42"), null);
    assert.equal(parseXStatusUrl("https://example.com/status/42"), null);
  });

  it("turns an fxtwitter post with a long article into Markdown and provenance", () => {
    const json = {
      code: 200,
      tweet: {
        url: "https://x.com/writer/status/77",
        id: "77",
        text: "Short teaser",
        created_at: "Thu Oct 01 13:00:05 +0000 2026",
        author: { screen_name: "writer", name: "A Writer" },
        article: {
          title: "Studio notes",
          content: {
            blocks: [
              { key: "a", type: "header-one", text: "First part", entityRanges: [] },
              { key: "b", type: "unstyled", text: "Plain paragraph.", entityRanges: [] },
              { key: "c", type: "unordered-list-item", text: "one item", entityRanges: [] },
              { key: "d", type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
              { key: "e", type: "atomic", text: " ", entityRanges: [{ key: 1, offset: 0, length: 1 }] },
              { key: "f", type: "blockquote", text: "quoted line", entityRanges: [] },
            ],
            entityMap: [
              { key: "0", value: { type: "MARKDOWN", data: { markdown: "```\nlayout/\n```" } } },
              { key: "1", value: { type: "MEDIA", data: {} } },
            ],
          },
        },
      },
    };
    const { markdown, meta } = fxtwitterToMarkdown(json);
    assert.equal(meta.author, "A Writer (@writer)");
    assert.equal(meta.published, "2026-10-01T13:00:05.000Z");
    assert.equal(meta.kind, "x-article");
    assert.equal(meta.title, "Studio notes");
    assert.match(markdown, /^# Studio notes$/mu);
    assert.match(markdown, /^## First part$/mu);
    assert.match(markdown, /^- one item$/mu);
    assert.match(markdown, /^```\nlayout\/\n```$/mu);
    assert.match(markdown, /^\[media\]$/mu);
    assert.match(markdown, /^> quoted line$/mu);
    const plain = fxtwitterToMarkdown({ code: 200, tweet: { ...json.tweet, article: null } });
    assert.equal(plain.meta.kind, "x-post");
    assert.match(plain.markdown, /Short teaser/u);
  });
});

describe("hijack.mjs licence gate", () => {
  it("detects common licences from their text or an SPDX line", () => {
    assert.equal(detectLicence("MIT License\n\nPermission is hereby granted, free of charge, to any person").spdx, "MIT");
    assert.equal(detectLicence("Apache License\nVersion 2.0, January 2004").spdx, "Apache-2.0");
    assert.equal(detectLicence("GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007").spdx, "GPL-3.0");
    assert.equal(detectLicence("GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3").spdx, "AGPL-3.0");
    assert.equal(detectLicence("// SPDX-License-Identifier: MPL-2.0\n").spdx, "MPL-2.0");
    assert.equal(detectLicence("This is free and unencumbered software released into the public domain.").spdx, "Unlicense");
    assert.equal(detectLicence("Licensed under Creative Commons Attribution-NonCommercial 4.0").spdx, "CC-BY-NC-4.0");
    assert.equal(detectLicence("Just a readme with no terms").spdx, "NOASSERTION");
  });

  it("maps every licence class to a take decision, and prohibition to review", () => {
    assert.equal(decideLicence("MIT").decision, "ideas-credit");
    assert.equal(decideLicence("Apache-2.0").decision, "ideas-credit");
    assert.equal(decideLicence("CC-BY-4.0").decision, "ideas-credit");
    assert.equal(decideLicence("GPL-3.0").decision, "ideas-only");
    assert.equal(decideLicence("CC-BY-SA-4.0").decision, "ideas-only");
    assert.equal(decideLicence("CC-BY-NC-4.0").decision, "ideas-only");
    assert.equal(decideLicence("NOASSERTION").decision, "ideas-only");
    assert.equal(decideLicence("NOASSERTION", { text: "Do not copy, adapt or redistribute any part of this guide." }).decision, "needs-review");
    assert.equal(decideLicence("NOASSERTION", { text: "© 2026 A Writer. All rights reserved.\nNo part of this publication may be reproduced." }).decision, "needs-review");
  });

  it("reads reuse terms only where the source talks about rights, not inside its subject matter", () => {
    // A real capture tripped this: an article's own checklist template said "DO NOT COPY: …".
    const article = "## Reference analysis\n\n- KEEP: the pacing of the reveal\n- DO NOT COPY: the exact layout of the hero shot\n";
    assert.equal(decideLicence("NOASSERTION", { text: article }).decision, "ideas-only");
    assert.equal(decideLicence("MIT", { text: `${article}\nSPDX-License-Identifier: MIT` }).decision, "ideas-credit");
  });
});

describe("hijack.mjs overlap gate", () => {
  it("flags a verbatim run and passes a paraphrase", () => {
    const sources = [{ id: "S1", text: SOURCE_PROSE }];
    const copied = `Intro line.\nAs one note says, a careful studio writes the brief before any frame exists, so the model cannot fill gaps.\n`;
    const runs = findOverlap({ sources, targets: [{ path: "SKILL.md", text: copied }], minWords: 12 });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, "S1");
    assert.equal(runs[0].path, "SKILL.md");
    assert.equal(runs[0].line, 2);
    assert.ok(runs[0].words >= 12);
    assert.deepEqual(findOverlap({ sources, targets: [{ path: "SKILL.md", text: PARAPHRASE }], minWords: 12 }), []);
  });

  it("ignores case, punctuation and Markdown, and works on Hangul", () => {
    const sources = [{ id: "S2", text: "먼저 브리프를 쓰고 그다음에 장면을 그린다 그래야 모델이 빈칸을 자기 취향으로 채우지 않는다 정말로" }];
    const target = "**먼저** 브리프를 쓰고, 그다음에 장면을 그린다. 그래야 모델이 빈칸을 자기 취향으로 채우지 않는다!";
    assert.equal(findOverlap({ sources, targets: [{ path: "a.md", text: target }], minWords: 12 }).length, 1);
    assert.equal(findOverlap({ sources, targets: [{ path: "a.md", text: target }], minWords: 20 }).length, 0);
  });
});

// A complete small run on disk: one captured source, one mechanism, a spec, a build, parity and a report.
const writeRun = () => {
  const target = freshDir("target");
  mkdirSync(join(target, "skills", "toy"), { recursive: true });
  writeFileSync(join(target, "skills", "toy", "SKILL.md"), "# Toy\n\nLine two.\nWrite the promo brief.\n");
  const run = join(target, ".litclaude", "hijack", "studio-brief");
  const init = cli(["init", run, "--target", target, "--base-ref", "abc1234"]);
  assert.equal(init.status, 0, init.stderr);
  const sourceFile = join(target, "post.md");
  writeFileSync(sourceFile, `${SOURCE_PROSE}\n`);
  const capture = cli(["capture", run, sourceFile, "--kind", "file", "--url", "https://x.com/writer/status/77", "--author", "A Writer", "--date", "2026-10-01"]);
  assert.equal(capture.status, 0, capture.stderr);
  const licence = cli(["licence", run]);
  assert.equal(licence.status, 0, licence.stderr);
  const ledgerPath = join(run, "ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  ledger.mechanisms = [{
    id: "M1",
    title: "Brief before render",
    sources: ["S1"],
    locator: "S1 paragraph 1",
    what: "A production note fixes the takeaway and the rejection condition before any rendering.",
    why: "Unfilled decisions are filled by model defaults, which is where look-alike output comes from.",
    evidence: "anecdotal",
    evidence_note: "Practitioner report, no measurement.",
    gap: { status: "weak", refs: ["skills/toy/SKILL.md:4"], note: "asks for a brief with no required fields" },
    port: { decision: "adapt", reason: "The toy skill already writes a brief; it lacks the two required fields." },
    parity: {
      criterion: "A brief from the toy skill names the takeaway and the rejection condition.",
      red: "baseline brief has neither field",
      green: "treatment brief has both fields",
      surface: "claude -p in a throwaway workspace",
      artifact: "parity/treatment.md",
    },
  }];
  ledger.build = { plan: "plans/toy-brief.md", changed: ["skills/toy/SKILL.md"] };
  ledger.parity = { baseline_outputs: ["parity/baseline.md"], treatment_outputs: ["parity/treatment.md"], markers: ["Rejection condition"] };
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(join(run, "SPEC.md"), "# Spec\n\n## M1 Brief before render\n\nThe toy skill's brief gains two required fields: Takeaway and Rejection condition.\n");
  mkdirSync(join(target, "plans"), { recursive: true });
  writeFileSync(join(target, "plans", "toy-brief.md"), "# Toy brief\n\n- [ ] 1. Add the two fields (SPEC M1)\n");
  writeFileSync(join(target, "skills", "toy", "SKILL.md"), "# Toy\n\nLine two.\nWrite the promo brief with a Takeaway and a Rejection condition field.\n");
  mkdirSync(join(run, "parity"), { recursive: true });
  writeFileSync(join(run, "parity", "baseline.md"), "Brief: a fun launch video.\n");
  writeFileSync(join(run, "parity", "treatment.md"), "Takeaway: one tap. Rejection condition: any invented screen.\n");
  writeFileSync(join(run, "REPORT.md"), "# Report\n\n## Taken\n\nM1 adapted.\n\n## Left\n\nNothing else.\n\n## Provenance\n\nS1 https://x.com/writer/status/77 (A Writer, 2026-10-01), ideas-only.\n");
  return { target, run, ledgerPath };
};

const editLedger = (ledgerPath, change) => {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  change(ledger);
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
};

describe("hijack.mjs run gate", () => {
  it("passes a complete run through every phase, from the CLI too", () => {
    const { run } = writeRun();
    const result = checkRun(run, { phase: "report" });
    assert.deepEqual(result.issues, []);
    assert.equal(result.ok, true);
    const ledger = JSON.parse(readFileSync(join(run, "ledger.json"), "utf8"));
    assert.equal(ledger.sources[0].licence.decision, "ideas-only", "an X post with no licence is ideas-only");
    assert.match(ledger.sources[0].retrieved_at, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(ledger.sources[0].files[0].sha256, /^[0-9a-f]{64}$/u);
    const cliCheck = cli(["check", run, "--phase", "report"]);
    assert.equal(cliCheck.status, 0, cliCheck.stdout + cliCheck.stderr);
  });

  it("fails a source with missing provenance or a tampered capture", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { delete ledger.sources[0].retrieved_at; });
    assert.match(checkRun(run, { phase: "capture" }).issues.join("\n"), /S1: retrieved_at/u);
    const second = writeRun();
    const captured = JSON.parse(readFileSync(second.ledgerPath, "utf8")).sources[0].files[0].path;
    writeFileSync(join(second.run, captured), "changed after capture\n");
    assert.match(checkRun(second.run, { phase: "capture" }).issues.join("\n"), /S1: .*sha256 mismatch/u);
  });

  it("fails a gap claim whose file:line does not resolve", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { ledger.mechanisms[0].gap.refs = ["skills/toy/SKILL.md:400"]; });
    assert.match(checkRun(run, { phase: "gap" }).issues.join("\n"), /M1: gap ref skills\/toy\/SKILL\.md:400/u);
  });

  it("fails a taken mechanism that rests only on a no-go source", () => {
    const { run, ledgerPath } = writeRun();
    editLedger(ledgerPath, (ledger) => { ledger.sources[0].licence.decision = "no-go"; });
    assert.match(checkRun(run, { phase: "gap" }).issues.join("\n"), /M1: .*no-go/u);
  });

  it("fails a spec that points at the sources or copies them", () => {
    const { run } = writeRun();
    writeFileSync(join(run, "SPEC.md"), "# Spec\n\n## M1\n\nRead sources/S1/content.md for details.\n");
    assert.match(checkRun(run, { phase: "spec" }).issues.join("\n"), /SPEC\.md names the captured sources/u);
    writeFileSync(join(run, "SPEC.md"), `# Spec\n\n## M1\n\n${SOURCE_PROSE}\n`);
    assert.match(checkRun(run, { phase: "spec" }).issues.join("\n"), /SPEC\.md:5 copies \d+ words from S1/u);
  });

  it("fails a build without a plan in lit-plan's row grammar that covers every taken mechanism", () => {
    const { run, target, ledgerPath } = writeRun();
    writeFileSync(join(target, "plans", "toy-brief.md"), "# Toy brief\n\n1. Add the two fields (SPEC M1)\n");
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /build\.plan plans\/toy-brief\.md has no column-zero task row/u);
    writeFileSync(join(target, "plans", "toy-brief.md"), "# Toy brief\n\n- [ ] 1. Add the two fields\n");
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /build\.plan plans\/toy-brief\.md never cites M1/u);
    editLedger(ledgerPath, (ledger) => { delete ledger.build.plan; });
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /build\.plan is missing/u);
  });

  it("fails a build that copied source wording into the target", () => {
    const { run, target } = writeRun();
    writeFileSync(join(target, "skills", "toy", "SKILL.md"), `# Toy\n\n${SOURCE_PROSE}\n`);
    assert.match(checkRun(run, { phase: "build" }).issues.join("\n"), /skills\/toy\/SKILL\.md:3 copies \d+ words from S1/u);
  });

  it("fails parity when the behaviour never appeared, or the baseline saw the treatment", () => {
    const { run } = writeRun();
    writeFileSync(join(run, "parity", "treatment.md"), "A fun launch video.\n");
    assert.match(checkRun(run, { phase: "parity" }).issues.join("\n"), /marker "Rejection condition" never appears in a treatment output/u);
    const second = writeRun();
    writeFileSync(join(second.run, "parity", "baseline.md"), "Rejection condition: none.\n");
    assert.match(checkRun(second.run, { phase: "parity" }).issues.join("\n"), /baseline output parity\/baseline\.md shows marker "Rejection condition"/u);
  });

  it("fails a report that skips a mechanism or a needed credit", () => {
    const { run, ledgerPath } = writeRun();
    writeFileSync(join(run, "REPORT.md"), "# Report\n\n## Taken\n\n## Left\n\n## Provenance\n");
    assert.match(checkRun(run, { phase: "report" }).issues.join("\n"), /REPORT\.md does not account for M1/u);
    const second = writeRun();
    editLedger(second.ledgerPath, (ledger) => { ledger.sources[0].licence.decision = "ideas-credit"; });
    assert.match(checkRun(second.run, { phase: "report" }).issues.join("\n"), /S1 needs credit/u);
    void ledgerPath;
  });

  it("builds an implementer brief from the spec alone", () => {
    const { run } = writeRun();
    const brief = buildImplementerBrief(run);
    assert.match(brief, /^TASK:/mu);
    assert.match(brief, /DELIVERABLE/u);
    assert.match(brief, /SCOPE/u);
    assert.match(brief, /VERIFY/u);
    assert.match(brief, /Rejection condition/u, "carries the spec text");
    assert.doesNotMatch(brief, /x\.com\/writer|sources\/S1/u, "names no captured source");
  });

  it("refuses a PDF capture whose bytes are not a PDF", () => {
    const { run, target } = writeRun();
    writeFileSync(join(target, "fake.pdf"), "not a pdf\n");
    const result = cli(["capture", run, join(target, "fake.pdf"), "--kind", "pdf"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /%PDF-/u);
  });
});

describe("lit-hijack skill depth", () => {
  const skill = () => readFileSync(join(skillDir, "SKILL.md"), "utf8");

  it("is a dense phased workflow, not a stub", () => {
    const text = skill();
    assert.ok(Buffer.byteLength(text, "utf8") >= 18_000, `SKILL.md is ${Buffer.byteLength(text, "utf8")} bytes`);
    assert.match(text, /^---\nname: lit-hijack\n/u);
    for (const heading of [
      "## When to use lit-hijack",
      "## How to start it in Claude Code",
      "## The run folder",
      "## Phase 0: Frame",
      "## Phase 1: Capture",
      "## Phase 2: Distil",
      "## Phase 3: Licence gate",
      "## Phase 4: Gap analysis",
      "## Phase 5: Port design and spec",
      "## Phase 6: Build",
      "## Phase 7: Parity proof",
      "## Phase 8: Report",
      "## Stop rules",
      "## Safety boundaries",
      "## Failure modes",
      "## Worked example",
      "## Final checklist",
    ]) {
      assert.ok(text.includes(heading), `missing ${heading}`);
    }
  });

  it("routes to its neighbours instead of re-implementing them", () => {
    const text = skill();
    for (const neighbour of ["litresearch", "lit-plan", "start-work", "review-work"]) {
      assert.match(text, new RegExp(`\`${neighbour}\``, "u"), `hands work to ${neighbour}`);
    }
    for (const command of ["capture", "licence", "overlap", "brief", "check"]) {
      assert.match(text, new RegExp(`hijack\\.mjs ${command}\\b`, "u"), `documents hijack.mjs ${command}`);
    }
    assert.match(text, /api\.fxtwitter\.com/u);
    assert.match(text, /TASK:[\s\S]*DELIVERABLE[\s\S]*SCOPE[\s\S]*VERIFY/u);
    assert.match(text, /\/litclaude:lit-hijack/u);
  });

  it("resolves every references/ path it names, and the references carry real content", () => {
    const text = skill();
    const named = [...new Set([...text.matchAll(/references\/([a-z0-9-]+\.md)/gu)].map((match) => match[1]))];
    assert.ok(named.length >= 5, "names its reference files");
    for (const file of named) assert.ok(existsSync(join(skillDir, "references", file)), `references/${file}`);
    assert.deepEqual(readdirSync(join(skillDir, "references")).sort(), [...named].sort(), "no orphaned reference file");
    for (const file of named) {
      assert.ok(readFileSync(join(skillDir, "references", file), "utf8").length >= 3_000, `references/${file} has content`);
    }
  });

  it("names no sibling product or foreign harness", () => {
    const corpus = [skill(), ...readdirSync(join(skillDir, "references")).map((f) => readFileSync(join(skillDir, "references", f), "utf8"))].join("\n");
    assert.doesNotMatch(corpus, /\blit(?:hermes|codex|opencode|grok|muse|gravity)\b|spawn_agent|apply_patch/iu);
  });

  it("ships a command that loads the skill and keeps the contract shape", () => {
    const command = readFileSync(join(pluginRoot, "commands", "lit-hijack.md"), "utf8");
    assert.match(command, /^---\n[\s\S]*description:[\s\S]*---\n/u);
    assert.match(command, /## #contract\.activation/u);
    assert.match(command, /Use the `lit-hijack` skill/u);
    assert.doesNotMatch(command, /\$ARGUMENTS/u);
  });
});
