import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
