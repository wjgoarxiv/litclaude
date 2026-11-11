import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// lit-docx moved to the `documents` plugin of the wjgoarxiv-skills marketplace, and the office runtime went with
// it. LitClaude keeps a same-name stub: the id, the `lit` document route and the slash command still work, and
// they lead to the install line.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const stubRoot = join(pluginRoot, "skills", "lit-docx");
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

describe("lit-docx is a same-name stub for the documents extras plugin", () => {
  it("says what the skill did, where it lives now and how to install it", () => {
    assert.match(stub, /^---\nname: lit-docx\n/u);
    assert.match(stub, /Word document/u);
    assert.match(stub, /wjgoarxiv-skills/u);
    assert.match(stub, /claude plugin marketplace add <path to your wjgoarxiv-skills clone>/u);
    assert.match(stub, /not (?:been )?published yet/iu, "says plainly the public marketplace is not published yet");
    assert.match(stub, /claude plugin install documents@wjgoarxiv-skills/u);
    assert.match(stub, /documents:lit-docx/u);
    assert.match(stub, /after (?:it is )?publi/iu, "says the GitHub form comes after publication");
    assert.doesNotMatch(stub, /\/Users\/[a-z]/u, "no private home path");
    assert.doesNotMatch(stub, /install lines above/u, "the install lines sit below, in What moved");
  });

  it("is a stub, not the body: one small SKILL.md and nothing else", () => {
    assert.ok(Buffer.byteLength(stub) < 9000, `${Buffer.byteLength(stub)} bytes`);
    assert.deepEqual(walk(stubRoot).map((f) => relative(stubRoot, f)), ["SKILL.md"]);
  });

  it("the office runtime left with it: no installer, lockfile, Python helper or status line remains", () => {
    for (const file of ["office-runtime.mjs", "office_runtime_bootstrap.py", "office_data.py", "ooxml_integrity.py", "render_pages.py", "office-runtime-lock"]) {
      assert.equal(existsSync(join(pluginRoot, "lib", file)), false, `lib/${file}`);
    }
    for (const file of ["scripts/doctor.mjs", "bin/litclaude-ai.js"]) {
      assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /office-runtime|OFFICE_RUNTIME/u, file);
    }
  });

  it("the bare-lit document route and the explicit skill name still reach the stub and carry the install line", () => {
    for (const prompt of ["분기 계획 보고서 써줘 lit", "lit-docx write a report on the pilot", "write a docx summarizing the vendor survey lit"]) {
      const context = hook(prompt);
      assert.match(context, /Skill\(lit-docx\)/u, prompt);
      assert.match(context, /name="lit-docx"/u, prompt);
      assert.match(context, /documents@wjgoarxiv-skills/u, prompt);
      assert.match(context, /documents:lit-docx/u, prompt);
      assert.match(context, /<path to your wjgoarxiv-skills clone>/u, prompt);
      assert.match(context, /not published yet/u, prompt);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${Buffer.byteLength(context, "utf8")} bytes`);
    }
  });

  it("a document context carries no leftover document procedure from the old body", () => {
    for (const prompt of ["lit-docx 신규 입사자 안내 문서", "분기 계획 보고서 써줘 lit", "lit 보고서랑 발표자료 둘 다 만들어줘"]) {
      const context = hook(prompt);
      for (const leftover of ["direction step", "AskUserQuestion", "tonality", "Style gate", "scripts/, references/, templates/", "pinned runtime", "[blanks]"]) {
        assert.ok(!context.includes(leftover), `${prompt}: ${leftover}`);
      }
    }
  });

  it("a prompt for a deck and a document routes both stubs, each with its own install line", () => {
    const context = hook("lit 보고서랑 발표자료 둘 다 만들어줘");
    assert.match(context, /Skill\(lit-docx\)/u);
    assert.match(context, /Skill\(lit-pptx\)/u);
    assert.match(context, /documents@wjgoarxiv-skills/u);
    assert.match(context, /decks@wjgoarxiv-skills/u);
  });
});
