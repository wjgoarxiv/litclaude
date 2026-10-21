import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateDeliverableHedgeGuard,
  formatDeliverableHedgeContext,
  formatHumanizerBlockReason,
} from "../plugins/litclaude/lib/deliverable-hedge-guard.mjs";
import { canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-resources.mjs";
import { parseRules, scanText } from "../plugins/litclaude/skills/lit-humanizer/scripts/core.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins/litclaude");
const privateToolStateDirectory = [".", "om", "o"].join("");
const makeInput = (cwd, toolName, toolInput) => ({ cwd, tool_name: toolName, tool_input: toolInput });

describe("deliverable hedge guard integration", () => {
  it("uses the shared detector with changed text and keeps warning tier advisory", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-guard-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const path = join(cwd, "report.md");
    const block = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Edit", { file_path: path, old_string: "**Evidence:** old", new_string: "**Evidence:** new" }),
      pluginRoot,
    });
    assert.equal(block.status, "block");
    assert.match(formatHumanizerBlockReason(block), /lit-humanizer blocked/u);

    const warning = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: path, content: "In conclusion, the review finished." }),
      pluginRoot,
    });
    assert.equal(warning.status, "warn");
    assert.match(formatDeliverableHedgeContext(warning), /warnings do not block/u);
  });

  it("scans only newly added lines and skips internal paths", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-diff-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const readerPath = join(cwd, "README.md");
    const previous = "**Evidence:** existing drafting residue\n";
    writeFileSync(readerPath, previous);
    const append = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: readerPath, content: `${previous}A clear new paragraph.\n` }),
      pluginRoot,
    });
    assert.equal(append.status, "clean", "unchanged old prose must not be rescanned");

    for (const path of [
      "plans/brief.md",
      "evidence/report.md",
      "HANDOFF_litclaude.md",
      ".litclaude/ledger.md",
      `${privateToolStateDirectory}/session.md`,
      ".hermes/state/ledger.jsonl",
      "records/SESSION_LEDGER.md",
    ]) {
      const result = evaluateDeliverableHedgeGuard({
        input: makeInput(cwd, "Write", { file_path: join(cwd, path), content: "**Evidence:** internal receipt" }),
        pluginRoot,
      });
      assert.equal(result.status, "clean", `${path} is an internal record`);
    }
  });

  it("scans separate changed hunks without rescanning unchanged prose between them", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-disjoint-diff-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const path = join(cwd, "report.md");
    const before = "Opening sentence.\n**Evidence:** old drafting residue\nMiddle sentence.\nClosing sentence.\n";
    const after = "Opening sentence revised.\n**Evidence:** old drafting residue\nMiddle sentence.\nClosing sentence revised.\n";
    writeFileSync(path, before);
    const result = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: path, content: after }),
      pluginRoot,
    });
    assert.equal(result.status, "clean", "the unchanged block-tier line between disjoint edits must not be rescanned");
  });

  it("fails open with visible context on input and worker failures", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-guard-open-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const path = join(cwd, "report.md");
    const oversized = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: path, content: "x".repeat(600 * 1024) }),
      pluginRoot,
    });
    assert.equal(oversized.status, "unavailable");
    assert.match(formatDeliverableHedgeContext(oversized), /check skipped/u);

    const timedOut = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: path, content: "**Evidence:** review" }),
      pluginRoot,
      execute: () => ({ error: { code: "ETIMEDOUT" }, status: null }),
    });
    assert.equal(timedOut.status, "unavailable");
    assert.match(formatDeliverableHedgeContext(timedOut), /check skipped.*timed out/u);

    const threw = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: path, content: "**Evidence:** review" }),
      pluginRoot,
      execute: () => { throw new Error("unexpected scanner failure"); },
    });
    assert.equal(threw.status, "unavailable");
    assert.match(formatDeliverableHedgeContext(threw), /check skipped/u);
  });

  it("discovers script-created Office paths from PostToolUse Bash output", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-bash-office-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const documentPath = join(cwd, "report.docx");
    copyFileSync(join(root, "test/fixtures/lit-humanizer/office/blocked.docx"), documentPath);
    const result = evaluateDeliverableHedgeGuard({
      input: {
        ...makeInput(cwd, "Bash", { command: "python build_report.py" }),
        tool_response: { stdout: `Wrote ${documentPath}\n`, stderr: "", isError: false },
      },
      pluginRoot,
      phase: "post-create",
    });
    assert.deepEqual(result.paths, [documentPath]);
    assert.equal(result.status, "block");
  });

  it("rechecks a created document in the parent of a subfolder cwd", (t) => {
    const project = mkdtempSync(join(tmpdir(), "lit-humanizer-subcwd-office-"));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const cwd = join(project, "sources");
    mkdirSync(cwd);
    const documentPath = join(project, "report.docx");
    copyFileSync(join(root, "test/fixtures/lit-humanizer/office/blocked.docx"), documentPath);
    const result = evaluateDeliverableHedgeGuard({
      input: { ...makeInput(cwd, "Write", { file_path: documentPath }), tool_response: { filePath: documentPath, success: true } },
      pluginRoot,
      projectDir: project,
      phase: "post-create",
    });
    assert.deepEqual(result.paths, [documentPath]);
    assert.equal(result.status, "block");

    const internalPath = join(project, "plans", "report.docx");
    mkdirSync(join(project, "plans"));
    copyFileSync(documentPath, internalPath);
    const internal = evaluateDeliverableHedgeGuard({
      input: { ...makeInput(cwd, "Write", { file_path: internalPath }), tool_response: { filePath: internalPath, success: true } },
      pluginRoot,
      projectDir: project,
      phase: "post-create",
    });
    assert.equal(internal.status, "clean");
  });

  it("rechecks supported documents from a stable, bounded file read", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-guard-office-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const documentPath = join(cwd, "report.docx");
    const result = evaluateDeliverableHedgeGuard({
      input: {
        ...makeInput(cwd, "Write", { file_path: documentPath }),
        tool_response: { filePath: documentPath, success: true },
      },
      pluginRoot,
      phase: "post-create",
    });
    assert.equal(result.status, "unavailable", "an absent file must fail open without claiming it was checked");
    assert.match(formatDeliverableHedgeContext(result), /check skipped/u);
  });

  it("leaves a document alone when the tool call that names it failed", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-failed-office-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const documentPath = join(cwd, "report.docx");
    copyFileSync(join(root, "test/fixtures/lit-humanizer/office/blocked.docx"), documentPath);
    for (const failure of [{ isError: true }, { is_error: true }, { error: true }, { status: "error" }]) {
      const result = evaluateDeliverableHedgeGuard({
        input: {
          ...makeInput(cwd, "Bash", { command: "python build_report.py" }),
          tool_response: { stdout: `Wrote ${documentPath}\n`, stderr: "", ...failure },
        },
        pluginRoot,
        phase: "post-create",
      });
      assert.equal(result.status, "clean", JSON.stringify(failure));
      assert.deepEqual(result.paths, []);
    }
  });

  it("judges a file outside the working directory only when it lies inside the project", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-inside-"));
    const outside = mkdtempSync(join(tmpdir(), "lit-humanizer-outside-"));
    t.after(() => {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    });
    const content = "**Evidence:** drafting residue\n";
    for (const path of [join(outside, "report.md"), join(cwd, "..", "report.md")]) {
      const skipped = evaluateDeliverableHedgeGuard({ input: makeInput(cwd, "Write", { file_path: path, content }), pluginRoot });
      assert.equal(skipped.status, "clean", path);
    }
    const judged = evaluateDeliverableHedgeGuard({
      input: makeInput(cwd, "Write", { file_path: join(outside, "report.md"), content }),
      pluginRoot,
      projectDir: outside,
    });
    assert.equal(judged.status, "block");
    const inside = evaluateDeliverableHedgeGuard({ input: makeInput(cwd, "Write", { file_path: join(cwd, "report.md"), content }), pluginRoot });
    assert.equal(inside.status, "block");
  });

  it("passes a large write into a LitClaude state folder without a skipped-check note", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-state-folder-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    for (const path of [".litclaude/notes.md", ".lit-state/summary.md"]) {
      const result = evaluateDeliverableHedgeGuard({
        input: makeInput(cwd, "Write", { file_path: join(cwd, path), content: "x".repeat(600 * 1024) }),
        pluginRoot,
      });
      assert.equal(result.status, "clean", path);
      assert.equal(formatDeliverableHedgeContext(result), "", path);
    }
  });

  it("pins guard and detector runtime resources in the install integrity map", () => {
    for (const path of [
      "lib/deliverable-hedge-guard.mjs",
      "skills/lit-humanizer/rules.json",
      "skills/lit-humanizer/scripts/core.mjs",
      "skills/lit-humanizer/scripts/scan-input.mjs",
      "skills/lit-humanizer/scripts/artifact-text.mjs",
      "skills/lit-humanizer/scripts/extract_office_text.py",
    ]) assert.ok(canonicalSkillResourceManifest.has(path), path);
  });
});

describe("negative pledge sentences in deliverables", () => {
  const pledgeRules = ["ko-negative-pledge", "ko-negative-pledge-repeat", "en-negative-pledge"];
  const userPledge = "동일 조건의 독립 성능 비교로 쓰지 않음.";
  const cases = JSON.parse(readFileSync(join(root, "test/fixtures/lit-humanizer/pledge-cases.json"), "utf8"));
  const rules = parseRules(readFileSync(join(pluginRoot, "skills/lit-humanizer/rules.json"), "utf8"));
  const severityRank = { warn: 1, block: 2 };

  const guard = (cwd, toolName, toolInput) => evaluateDeliverableHedgeGuard({ input: makeInput(cwd, toolName, toolInput), pluginRoot });
  const pledgeHits = (result) => result.findings.filter((finding) => pledgeRules.includes(finding.rule));

  it("refuses the user's own sentence in a Write event and names the rule", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const result = guard(cwd, "Write", { file_path: join(cwd, "report.md"), content: userPledge });
    assert.equal(result.status, "block");
    assert.ok(result.findings.some((finding) => finding.rule === "ko-negative-pledge" && finding.severity === "block"));
    assert.match(formatHumanizerBlockReason(result), /ko-negative-pledge line 1/u);
  });

  it("refuses an English pledge in a Write event and names the rule", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-en-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const result = guard(cwd, "Write", { file_path: join(cwd, "report.md"), content: "This report is not intended as a head-to-head benchmark." });
    assert.equal(result.status, "block");
    assert.ok(result.findings.some((finding) => finding.rule === "en-negative-pledge" && finding.severity === "block"));
    assert.match(formatHumanizerBlockReason(result), /en-negative-pledge line 1/u);
  });

  // Whitespace padding must not push the scan past the detector timeout, where a timeout would let the pledge through.
  for (const [label, padded] of [
    ["4,096 spaces after a status word", `검증된${" ".repeat(4096)}x`],
    ["65,536 spaces after a verb stem", `해석하지${" ".repeat(65536)}x`],
  ]) {
    it(`still refuses a pledge followed by a whitespace-padded line (${label}) inside the scan timeout`, (t) => {
      const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-pad-"));
      t.after(() => rmSync(cwd, { recursive: true, force: true }));
      const started = process.hrtime.bigint();
      const result = guard(cwd, "Write", { file_path: join(cwd, "report.md"), content: `${userPledge}\n${padded}\n` });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      assert.equal(result.status, "block");
      assert.ok(result.findings.some((finding) => finding.rule === "ko-negative-pledge" && finding.severity === "block"));
      assert.ok(elapsedMs < 1000, `guard took ${elapsedMs.toFixed(0)} ms`);
    });
  }

  it("denies the same Write event through the real PreToolUse hook and lets a near-miss through", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-hook-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const run = (content) => {
      const result = spawnSync(process.execPath, [join(pluginRoot, "bin/litclaude-hook.js"), "pre-tool-use"], {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" },
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd,
          tool_name: "Write",
          tool_input: { file_path: join(cwd, "report.md"), content },
        }),
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : {};
    };
    const denied = run(userPledge);
    assert.equal(denied.permissionDecision, "deny");
    assert.match(denied.permissionDecisionReason, /ko-negative-pledge/u);
    const allowed = run("냉각수로 쓰지 않음. 한 번에 0.1 이상 바꾸지 않음.");
    assert.notEqual(allowed.permissionDecision, "deny");
  });

  it("matches every pledge to its expected rule and severity", () => {
    assert.equal(cases.pledges.length, 15);
    for (const pledge of cases.pledges) {
      const hits = scanText(pledge.text, rules, "pledge.md");
      if (pledge.severity === "none") {
        assert.deepEqual(hits, [], `pledge ${pledge.n}`);
        continue;
      }
      const top = Math.max(...hits.map((hit) => severityRank[hit.severity]));
      assert.equal(top, severityRank[pledge.severity], `pledge ${pledge.n} top severity`);
      assert.ok(hits.some((hit) => hit.rule === pledge.rule && hit.severity === pledge.severity), `pledge ${pledge.n} ${pledge.rule}`);
    }
  });

  it("keeps every near-miss and review sentence clear of the pledge rules", () => {
    assert.ok(cases.near_misses.length >= 27 && cases.near_misses_review.length >= 215);
    for (const near of [...cases.near_misses, ...cases.near_misses_review]) {
      const hits = scanText(near.text, rules, "near-miss.md").filter((hit) => pledgeRules.includes(hit.rule));
      assert.deepEqual(hits, [], near.text);
    }
  });

  it("decides whole-document cases per rule", () => {
    assert.equal(cases.document_cases.length, 13);
    for (const doc of cases.document_cases) {
      const blocked = scanText(doc.text, rules, "document.md").some((hit) => hit.rule === doc.rule && hit.severity === "block");
      assert.equal(blocked, doc.expect === "block", JSON.stringify(doc.text));
    }
  });

  it("blocks every pledge a model wrote in the host probe", () => {
    assert.equal(cases.pledges_observed.length, 33);
    for (const pledge of cases.pledges_observed) {
      const hits = scanText(pledge.text, rules, "observed.md");
      assert.ok(
        hits.some((hit) => hit.rule === pledge.rule && hit.severity === "block"),
        `${pledge.rule}: ${pledge.text}`,
      );
    }
  });

  for (const [label, content, rule] of [
    ["a Korean intent clause", "이 문서는 제품을 비교하려는 것이 아닙니다.", "ko-negative-pledge"],
    ["an English table sentence", "This table is not a ranking.", "en-negative-pledge"],
    ["a bold-label Korean callout", "> **주의:** 이 표는 순위가 아닙니다.", "ko-negative-pledge"],
    ["a bold-label English callout", "> **Note:** This table is not a ranking.", "en-negative-pledge"],
  ]) {
    it(`refuses ${label} in a Write event and names ${rule}`, (t) => {
      const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-wide-"));
      t.after(() => rmSync(cwd, { recursive: true, force: true }));
      const result = guard(cwd, "Write", { file_path: join(cwd, "report.md"), content: `${content}\n` });
      assert.equal(result.status, "block");
      assert.ok(result.findings.some((finding) => finding.rule === rule && finding.severity === "block"));
      assert.match(formatHumanizerBlockReason(result), new RegExp(`${rule} line 1`, "u"));
    });
  }

  for (const [label, content] of [
    ["a plain quote line", "> 이 표는 순위가 아닙니다."],
    ["a plain English quote line", "> This table is not a ranking."],
    ["a statement that two kinds of value cannot be compared", "숫자와 문자열은 서로 비교할 수 없습니다."],
    ["an instruction to convert before comparing", "Do not compare these values directly; convert to SI first."],
  ]) {
    it(`lets ${label} through a Write event`, (t) => {
      const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-clean-"));
      t.after(() => rmSync(cwd, { recursive: true, force: true }));
      const result = guard(cwd, "Write", { file_path: join(cwd, "report.md"), content: `${content}\n` });
      assert.deepEqual(pledgeHits(result), []);
      assert.notEqual(result.status, "block");
    });
  }

  it("denies a bold-label callout pledge through the real PreToolUse hook", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-callout-hook-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const run = (content) => {
      const result = spawnSync(process.execPath, [join(pluginRoot, "bin/litclaude-hook.js"), "pre-tool-use"], {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" },
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd,
          tool_name: "Write",
          tool_input: { file_path: join(cwd, "report.md"), content },
        }),
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : {};
    };
    const denied = run("> **주의:** 이 표는 순위가 아닙니다.\n");
    assert.equal(denied.permissionDecision, "deny");
    assert.match(denied.permissionDecisionReason, /ko-negative-pledge/u);
    assert.notEqual(run("> 이 표는 순위가 아닙니다.\n").permissionDecision, "deny");
    assert.notEqual(run("숫자와 문자열은 서로 비교할 수 없습니다.\n").permissionDecision, "deny");
  });

  it("refuses a second pledge added to a file that holds one, judged by the lines its occurrences sit on", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-edit-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const path = join(cwd, "report.md");
    const first = "측정값은 인과관계를 주장하지 않음.";
    const second = "두 공정의 차이는 최종 결론이 아님.";
    writeFileSync(path, `# 보고서\n${first}\n`);
    // The edit is applied to the file on disk, so the old pledge and the new one form one repeat, and
    // the new one sits on a changed line.
    const edited = guard(cwd, "Edit", { file_path: path, old_string: `${first}\n`, new_string: `${first}\n${second}\n` });
    assert.equal(edited.status, "block");
    assert.ok(edited.findings.some((finding) => finding.rule === "ko-negative-pledge-repeat"));
    // A whole-file Write over the same path is diffed against the file on disk, with the same result.
    const rewritten = guard(cwd, "Write", { file_path: path, content: `# 보고서\n${first}\n${second}\n` });
    assert.equal(rewritten.status, "block");
    // Both pledges arriving in one Edit, or in a new file, are one scanned text and are refused.
    const both = guard(cwd, "Edit", { file_path: path, old_string: "# 보고서\n", new_string: `# 보고서\n${first}\n${second}\n` });
    assert.equal(both.status, "block");
    assert.ok(both.findings.some((finding) => finding.rule === "ko-negative-pledge-repeat"));
    const created = guard(cwd, "Write", { file_path: join(cwd, "new.md"), content: `${first}\n${second}\n` });
    assert.equal(created.status, "block");
    // A pledge the sentence rule already refuses on its own is refused whatever the file holds.
    const subject = guard(cwd, "Edit", { file_path: path, old_string: `${first}\n`, new_string: `${first}\n이 표는 순위를 매기기 위한 것이 아닙니다.\n` });
    assert.equal(subject.status, "block");
    assert.ok(subject.findings.some((finding) => finding.rule === "ko-negative-pledge"));
  });

  // A large file of repeated pledges makes the scanner report thousands of findings. The
  // scanner output must stay bounded so the child buffer never overflows into an allowed write.
  it("refuses a 500 KiB Write of repeated pledges inside the scan timeout instead of failing open", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-flood-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const line = `${userPledge}\n`;
    const content = line.repeat(Math.floor((500 * 1024) / Buffer.byteLength(line, "utf8")));
    assert.ok(Buffer.byteLength(content, "utf8") < 512 * 1024);
    const started = process.hrtime.bigint();
    const result = guard(cwd, "Write", { file_path: join(cwd, "report.md"), content });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(result.status, "block", `status ${result.status} ${result.reason ?? ""}`);
    assert.ok(result.findings.some((finding) => finding.rule === "ko-negative-pledge" && finding.severity === "block"));
    assert.match(formatHumanizerBlockReason(result), /ko-negative-pledge/u);
    assert.ok(elapsedMs < 2000, `guard took ${elapsedMs.toFixed(0)} ms`);
  });

  it("denies the 500 KiB pledge flood through the real PreToolUse hook", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pledge-flood-hook-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const line = `${userPledge}\n`;
    const content = line.repeat(Math.floor((500 * 1024) / Buffer.byteLength(line, "utf8")));
    const result = spawnSync(process.execPath, [join(pluginRoot, "bin/litclaude-hook.js"), "pre-tool-use"], {
      cwd,
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" },
      input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name: "Write", tool_input: { file_path: join(cwd, "report.md"), content } }),
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.permissionDecision, "deny");
    assert.match(output.permissionDecisionReason, /ko-negative-pledge/u);
  });
});

describe("negation-cluster tiers in deliverables", () => {
  const cases = JSON.parse(readFileSync(join(root, "test/fixtures/lit-humanizer/negation-cluster-cases.json"), "utf8"));
  const clusterHits = (result) => result.findings.filter((finding) => finding.rule === "negation-cluster");
  const tierOf = (result) => {
    const hits = clusterHits(result);
    return hits.some((hit) => hit.severity === "block") ? "block" : hits.some((hit) => hit.severity === "warn") ? "warn" : null;
  };
  const guardWrite = (t, content, name = "report.md") => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-negation-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    return evaluateDeliverableHedgeGuard({ input: makeInput(cwd, "Write", { file_path: join(cwd, name), content }), pluginRoot });
  };
  const fixture = (prefix) => [...cases.positive, ...cases.negative].find((entry) => entry.id.startsWith(prefix)).text;

  it("gives every positive fixture its expected tier", (t) => {
    assert.equal(cases.positive.length, 16);
    for (const entry of cases.positive) assert.equal(tierOf(guardWrite(t, entry.text)), entry.expect, entry.id);
  });

  it("stays silent on every negative fixture, including code, quotes, status tables and limitation lines", (t) => {
    assert.equal(cases.negative.length, 18);
    for (const entry of cases.negative) assert.deepEqual(clusterHits(guardWrite(t, entry.text)), [], entry.id);
  });

  it("refuses a stacked-negation write with the rewrite advice and its example", (t) => {
    const result = guardWrite(t, `# 이용 현황\n\n${fixture("p01")}\n\n탑승 건수 436건은 승차 기준 집계입니다.\n`);
    assert.equal(result.status, "block");
    assert.deepEqual(result.findings.map((finding) => [finding.rule, finding.severity]), [["negation-cluster", "block"]]);
    const reason = formatHumanizerBlockReason(result);
    assert.match(reason, /negation-cluster line 3/u);
    assert.match(reason, /Say what the thing is first, then add the caveat once/u);
    assert.match(reason, /18,420 visits in total, including repeat visits/u);
  });

  it("lets a two-negation English or mixed write through with a warning", (t) => {
    const result = guardWrite(t, fixture("p09"));
    assert.equal(result.status, "warn");
    const context = formatDeliverableHedgeContext(result);
    assert.match(context, /warnings do not block/u);
    assert.match(context, /Say what the thing is first/u);
  });

  it("skips internal paths the guard already exempts", (t) => {
    assert.deepEqual(clusterHits(guardWrite(t, fixture("p01"), "plans/brief.md")), []);
  });

  it("reports the block from the skill's own detector CLI", () => {
    const run = spawnSync(process.execPath, [join(pluginRoot, "skills/lit-humanizer/scripts/detect.mjs"), "--json"], {
      input: fixture("p01"),
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(run.status, 2, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.findings.map((finding) => [finding.rule, finding.severity]), [["negation-cluster", "block"]]);
  });

  it("denies a reworded cluster and allows a limitation line through the real PreToolUse hook", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-negation-hook-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const run = (content) => {
      const result = spawnSync(process.execPath, [join(pluginRoot, "bin/litclaude-hook.js"), "pre-tool-use"], {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" },
        input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name: "Write", tool_input: { file_path: join(cwd, "report.md"), content } }),
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : {};
    };
    const denied = run(fixture("p11"));
    assert.equal(denied.permissionDecision, "deny");
    assert.match(denied.permissionDecisionReason, /negation-cluster line 1/u);
    assert.match(denied.permissionDecisionReason, /Several negations sit in one place/u);
    assert.match(denied.permissionDecisionReason, /18,420 visits in total/u);
    const allowed = run(fixture("n11"));
    assert.equal(allowed.permissionDecision, undefined);
    assert.doesNotMatch(JSON.stringify(allowed), /negation-cluster/u);
  });

  it("does not count an English negation glued to a Korean word", (t) => {
    assert.deepEqual(clusterHits(guardWrite(t, "값은is not final, 수치는is not a count, 비율은isn't fixed.")), []);
  });

  describe("Edit events read the edited file in context", () => {
    const runEdit = (t, existing, oldString, newString) => {
      const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-negation-edit-"));
      t.after(() => rmSync(cwd, { recursive: true, force: true }));
      const path = join(cwd, "README.md");
      writeFileSync(path, existing);
      const result = spawnSync(process.execPath, [join(pluginRoot, "bin/litclaude-hook.js"), "pre-tool-use"], {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" },
        input: JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd,
          tool_name: "Edit",
          tool_input: { file_path: path, old_string: oldString, new_string: newString },
        }),
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : {};
    };

    it("allows an edit that replaces a whole code fence", (t) => {
      const output = runEdit(t, "# Notes\n\n```\nold\n```\n", "```\nold\n```", "```\nassert x is not None  # 아님 아닙니다\n```");
      assert.notEqual(output.permissionDecision, "deny");
      assert.doesNotMatch(JSON.stringify(output), /negation-cluster/u);
    });

    it("allows an edit to code lines whose fence stays unchanged", (t) => {
      const output = runEdit(t, "# Notes\n\n```\nassert x\nif y: pass\n```\n", "assert x\nif y: pass", "assert x is not None  # 아님 아닙니다\nif y is not a: pass");
      assert.notEqual(output.permissionDecision, "deny");
      assert.doesNotMatch(JSON.stringify(output), /negation-cluster/u);
    });

    it("keeps two edited paragraphs apart (n03)", (t) => {
      const output = runEdit(t, "방문 횟수입니다.\n\n탑승 건수입니다.\n", "방문 횟수입니다.\n\n탑승 건수입니다.", fixture("n03"));
      assert.notEqual(output.permissionDecision, "deny");
      assert.doesNotMatch(JSON.stringify(output), /negation-cluster/u);
    });

    it("still refuses an edit that turns a plain paragraph into a stacked-negation block (p01)", (t) => {
      const output = runEdit(t, "# 이용 현황\n\n방문 횟수 18,420회입니다.\n", "방문 횟수 18,420회입니다.", fixture("p01"));
      assert.equal(output.permissionDecision, "deny");
      assert.match(output.permissionDecisionReason, /negation-cluster line 3/u);
    });

    it("refuses an edit that adds two pledges after one old pledge (M-2 a)", (t) => {
      const output = runEdit(t, "이 표는 일반화가 아닙니다.\n\n본문.\n", "본문.", "결론이 아닙니다.\n\n순위가 아닙니다.");
      assert.equal(output.permissionDecision, "deny");
      assert.match(output.permissionDecisionReason, /ko-negative-pledge-repeat/u);
    });

    it("allows an edit to the paragraph between two old pledges (M-2 b)", (t) => {
      const output = runEdit(t, "결론이 아닙니다.\n\n중간 문단입니다.\n\n순위가 아닙니다.\n", "중간 문단입니다.", "고친 중간 문단입니다.");
      assert.notEqual(output.permissionDecision, "deny");
      assert.doesNotMatch(JSON.stringify(output), /ko-negative-pledge-repeat/u);
    });
  });

  describe("a host cwd in a subfolder does not exempt the parent folder", () => {
    // The project root is the CLAUDE_PROJECT_DIR the host sets on the hook process; without it, the
    // git toplevel above cwd; without that, cwd itself.
    const runFrom = (t, toolInput, { projectDir = "project", git = false } = {}) => {
      const project = mkdtempSync(join(tmpdir(), "lit-humanizer-subcwd-"));
      t.after(() => rmSync(project, { recursive: true, force: true }));
      const cwd = join(project, "sources");
      mkdirSync(cwd);
      if (git) mkdirSync(join(project, ".git"));
      const env = { ...process.env, LITCLAUDE_NO_AUTO_UPDATE: "1" };
      delete env.CLAUDE_PROJECT_DIR;
      if (projectDir === "project") env.CLAUDE_PROJECT_DIR = project;
      const result = spawnSync(process.execPath, [join(pluginRoot, "bin/litclaude-hook.js"), "pre-tool-use"], {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        env,
        input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name: "Write", tool_input: toolInput(project) }),
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : {};
    };

    it("refuses p01 written to the parent folder by absolute path", (t) => {
      const output = runFrom(t, (project) => ({ file_path: join(project, "report.md"), content: fixture("p01") }));
      assert.equal(output.permissionDecision, "deny");
      assert.match(output.permissionDecisionReason, /negation-cluster/u);
    });

    it("refuses p01 written to the parent folder by parent-relative path", (t) => {
      const output = runFrom(t, () => ({ file_path: "../report.md", content: fixture("p01") }));
      assert.equal(output.permissionDecision, "deny");
      assert.match(output.permissionDecisionReason, /negation-cluster/u);
    });

    it("refuses p01 in the parent folder when the git toplevel is the only project signal", (t) => {
      const output = runFrom(t, (project) => ({ file_path: join(project, "report.md"), content: fixture("p01") }), { projectDir: null, git: true });
      assert.equal(output.permissionDecision, "deny");
      assert.match(output.permissionDecisionReason, /negation-cluster/u);
    });

    it("skips the parent folder when no project signal reaches above cwd", (t) => {
      const output = runFrom(t, (project) => ({ file_path: join(project, "report.md"), content: fixture("p01") }), { projectDir: null });
      assert.notEqual(output.permissionDecision, "deny");
    });

    it("allows p01 written to host-config and temp-shaped paths outside the project", (t) => {
      const elsewhere = mkdtempSync(join(tmpdir(), "lit-humanizer-elsewhere-"));
      t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
      const targets = [
        join(elsewhere, "home", ".claude", "projects", "x", "memory", "m.md"),
        join(elsewhere, "home", ".claude", "CLAUDE.md"),
        join(elsewhere, "home", ".codex", "AGENTS.md"),
        join(elsewhere, "tmp", "review-nonexistent.md"),
        join(elsewhere, "tmp", "scratchpad", "notes.md"),
      ];
      for (const target of targets) {
        const output = runFrom(t, () => ({ file_path: target, content: fixture("p01") }));
        assert.notEqual(output.permissionDecision, "deny", target);
      }
    });

    it("keeps internal paths in the parent folder exempt", (t) => {
      for (const path of ["plans/brief.md", "HANDOFF.md", ".litclaude/notes.md"]) {
        const output = runFrom(t, (project) => ({ file_path: join(project, path), content: fixture("p01") }));
        assert.notEqual(output.permissionDecision, "deny", path);
      }
    });
  });
});
