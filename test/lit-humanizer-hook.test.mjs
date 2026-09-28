import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins/litclaude/bin/litclaude-hook.js");
const fixtureRoot = join(root, "test/fixtures/lit-humanizer");
const pdfProbe = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });

const minimalPdf = (text) => {
  const stream = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, "ascii");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"), stream, Buffer.from("\nendstream", "ascii")]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "ascii"), object, Buffer.from("\nendobj\n", "ascii")]);
    chunks.push(chunk);
    length += chunk.length;
  }
  const xrefOffset = length;
  const xref = [Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`, "ascii")];
  for (const offset of offsets.slice(1)) xref.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "ascii"));
  xref.push(Buffer.from(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "ascii"));
  return Buffer.concat([...chunks, ...xref]);
};

const invokeHook = (event, input, env = process.env) => spawnSync(
  process.execPath,
  [hookPath, event],
  { cwd: input.cwd, encoding: "utf8", input: JSON.stringify(input), env: { ...env, LITCLAUDE_NO_AUTO_UPDATE: "1" }, timeout: 10000 },
);

const runPre = (cwd, toolName, toolInput) => {
  const result = invokeHook("pre-tool-use", { cwd, tool_name: toolName, tool_input: toolInput });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : {};
};

describe("LitClaude lit-humanizer host hooks", () => {
  it("denies block-tier changed text, allows clean text, and keeps warnings advisory", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-hook-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const blocked = runPre(cwd, "Write", { file_path: join(cwd, "report.md"), content: "**Evidence:** raw logs" });
    assert.equal(blocked.permissionDecision, "deny");
    assert.match(blocked.permissionDecisionReason, /lit-humanizer/u);

    const clean = runPre(cwd, "Write", { file_path: join(cwd, "report.md"), content: "The review finished on Friday." });
    assert.deepEqual(clean, {});

    const warning = runPre(cwd, "Write", { file_path: join(cwd, "report.md"), content: "In conclusion, the review finished on Friday." });
    assert.equal(warning.permissionDecision, undefined);
    assert.match(warning.additionalContext, /warning/u);
  });

  it("injects the always-on humanizer rule through the real UserPromptSubmit hook", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-always-on-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const result = invokeHook("user-prompt-submit", { cwd, prompt: "Review this short note.", session_id: "humanizer-always-on" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /Apply to new or changed text/u);
    assert.match(context, /Skill\(lit-humanizer\)/u);
  });

  it("scans only replacement text and skips Markdown quotes and fenced code", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-change-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const path = join(cwd, "report.md");
    assert.deepEqual(runPre(cwd, "Edit", { file_path: path, old_string: "**Evidence:** user text", new_string: "The result is clear." }), {});
    writeFileSync(path, "# Report\n**Evidence:** legacy status\n");
    assert.deepEqual(runPre(cwd, "Write", { file_path: path, content: "# Report\n**Evidence:** legacy status\nThe review ended Friday.\n" }), {});
    assert.deepEqual(runPre(cwd, "Write", { file_path: path, content: "> **Evidence:** quoted source text" }), {});
    assert.deepEqual(runPre(cwd, "Write", { file_path: path, content: "```markdown\n**Evidence:** example\n```" }), {});
    assert.equal(runPre(cwd, "MultiEdit", {
      file_path: path,
      edits: [{ old_string: "one", new_string: "clean" }, { old_string: "two", new_string: "**Evidence:** new text" }],
    }).permissionDecision, "deny");
  });

  it("fails open with a visible note when input exceeds the bounded scan size", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-fail-open-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const result = runPre(cwd, "Write", { file_path: join(cwd, "large.md"), content: "a".repeat(600 * 1024) });
    assert.notEqual(result.permissionDecision, "deny");
    assert.match(result.additionalContext, /check skipped/u);
  });

  it("rechecks newly created Office documents after the write completes", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-office-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const officeRoot = join(cwd, "deliverables");
    mkdirSync(officeRoot);
    const document = join(officeRoot, "report.docx");
    copyFileSync(join(fixtureRoot, "office", "blocked.docx"), document);
    const result = invokeHook("post-tool-use", {
      cwd,
      tool_name: "Write",
      tool_input: { file_path: document },
      tool_response: { filePath: document, success: true },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /lit-humanizer.*block/u);
  });

  it("rechecks script-created Office documents reported by Bash", (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-bash-office-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const document = join(cwd, "generated report.docx");
    copyFileSync(join(fixtureRoot, "office", "blocked.docx"), document);
    const result = invokeHook("post-tool-use", {
      cwd,
      tool_name: "Bash",
      tool_input: { command: "python make_report.py" },
      tool_response: { stdout: `Wrote \"${document}\"\n`, stderr: "", isError: false },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /lit-humanizer.*block/u);
  });

  it("rechecks a newly created PDF when pdftotext is available", { skip: Boolean(pdfProbe.error || pdfProbe.status !== 0) }, (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "lit-humanizer-pdf-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const document = join(cwd, "report.pdf");
    writeFileSync(document, minimalPdf("I hope this helps."));
    const result = invokeHook("post-tool-use", {
      cwd,
      tool_name: "Write",
      tool_input: { file_path: document },
      tool_response: { filePath: document, success: true },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /lit-humanizer.*block/u);
  });
});
