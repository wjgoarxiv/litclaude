import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EXTENSION_SKILLS } from "../plugins/litclaude/lib/extensions-notice.mjs";
import { findWorkflowTrigger } from "../plugins/litclaude/lib/route-match.mjs";

// lit-xlsx ships as the `sheets` plugin of the wjgoarxiv-skills marketplace. LitClaude keeps a same-name stub: the
// id, the `lit` workbook route and the slash command lead to the install line, or to sheets:lit-xlsx when installed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const stubRoot = join(pluginRoot, "skills", "lit-xlsx");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const stub = readFileSync(join(stubRoot, "SKILL.md"), "utf8");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

const hook = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

describe("lit-xlsx is a same-name stub for the sheets extras plugin", () => {
  it("says what the skill makes, where it lives and how to install it", () => {
    assert.match(stub, /^---\nname: lit-xlsx\n/u);
    assert.match(stub, /Excel workbook/u);
    assert.match(stub, /^claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills$/mu);
    assert.match(stub, /^claude plugin install sheets@wjgoarxiv-skills$/mu);
    assert.match(stub, /sheets:lit-xlsx/u);
    assert.match(stub, /npx @litfamily\/litclaude extensions install sheets/u);
    assert.match(stub, /Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`\./u);
    assert.doesNotMatch(stub, /\/Users\/[a-z]/u, "no private home path");
  });

  it("is a stub, not the body: one small SKILL.md and nothing else", () => {
    assert.ok(Buffer.byteLength(stub) < 9000, `${Buffer.byteLength(stub)} bytes`);
    assert.deepEqual(walk(stubRoot).map((f) => relative(stubRoot, f)), ["SKILL.md"]);
  });

  it("is enrolled as the sheets extension", () => {
    assert.equal(EXTENSION_SKILLS["lit-xlsx"], "sheets");
  });

  it("bare-lit workbook wording routes to lit-xlsx, and a Word report still routes to lit-docx", () => {
    for (const prompt of ["lit 엑셀로 정리해줘", "lit make an xlsx report", "lit 스프레드시트 만들어줘", "lit create an excel budget", "lit 표 계산 시트 만들어줘"]) {
      assert.equal(findWorkflowTrigger(prompt)?.skillId, "lit-xlsx", prompt);
    }
    assert.equal(findWorkflowTrigger("lit 엑셀 보고서 만들어줘")?.skillId, "lit-xlsx");
    assert.equal(findWorkflowTrigger("분기 계획 보고서 써줘 lit")?.skillId, "lit-docx");
    assert.equal(findWorkflowTrigger("lit-xlsx build a budget with scenarios")?.skillId, "lit-xlsx");
  });

  it("the hook context names the stub and carries the sheets install line", () => {
    for (const prompt of ["lit 엑셀로 정리해줘", "lit make an xlsx report", "lit-xlsx build a budget with scenarios"]) {
      const context = hook(prompt);
      assert.match(context, /Skill\(lit-xlsx\)/u, prompt);
      assert.match(context, /name="lit-xlsx"/u, prompt);
      assert.match(context, /an \.xlsx workbook/u, prompt);
      assert.match(context, /sheets@wjgoarxiv-skills/u, prompt);
      assert.match(context, /sheets:lit-xlsx/u, prompt);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${Buffer.byteLength(context, "utf8")} bytes`);
    }
  });
});
