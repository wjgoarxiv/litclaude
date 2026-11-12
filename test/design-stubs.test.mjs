import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The design family (frontend-ui-ux and visual-qa) moved to the `design` plugin of the wjgoarxiv-skills marketplace.
// LitClaude keeps a same-name stub for each id: the ids, the `$` routes, the natural-language interface route, the
// polish/audit/harden interface modes and the PostToolUse interface hint still work, and they lead to the install
// line. The frontend-ui-ux stub keeps the interface probe scripts, because the Stop hook holds a lit-loop, litwork or
// litgoal turn that edited web-interface files until that probe ran clean.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
const IDS = ["frontend-ui-ux", "visual-qa"];
const PROBE = ["interface-probe.mjs", "interface-probe-lock.mjs", "interface-probe-page.mjs", "interface-probe-rules.mjs", "interface-probe-server.mjs", "interface-probe-static.mjs"];
const stubRoot = (id) => join(pluginRoot, "skills", id);
const stub = (id) => readFileSync(join(stubRoot(id), "SKILL.md"), "utf8");
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

const ROUTES = [
  ["frontend-ui-ux", "frontend-ui-ux build a pricing page for the billing service"],
  ["frontend-ui-ux", "$frontend-ui-ux build this page"],
  ["frontend-ui-ux", "design a new settings page UI"],
  ["frontend-ui-ux", "이 화면 여백 다듬어줘."],
  ["visual-qa", "visual-qa inspect the rendered settings page"],
  ["visual-qa", "$visual-qa check the settings page at 390px"],
];

describe("the design skills are same-name stubs for the design extras plugin", () => {
  for (const id of IDS) {
    it(`${id} says what it did, where it lives now and how to install it`, () => {
      const md = stub(id);
      assert.match(md, new RegExp(`^---\\nname: ${id}\\n`, "u"));
      assert.match(md, /wjgoarxiv-skills/u);
      assert.match(md, /^claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills$/mu, "installs from the public GitHub marketplace");
      assert.doesNotMatch(md, /not (?:been )?published yet/iu, "no longer calls the public marketplace unpublished");
      assert.match(md, /claude plugin install design@wjgoarxiv-skills/u);
      assert.match(md, new RegExp(`design:${id}`, "u"));
      assert.match(md, /Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`\./u, "keeps the local clone as the offline form");
      assert.match(md, /lit-loop|lit workflow/u, "says what happens when a lit workflow hands work to it");
      assert.doesNotMatch(md, /\/Users\/[a-z]/u, "no private home path");
      // 9500: the frontend-ui-ux stub also carries the interface-probe procedure and the same-name check.
      assert.ok(Buffer.byteLength(md) < 9500, `${Buffer.byteLength(md)} bytes`);
    });
  }

  it("frontend-ui-ux keeps only its interface probe and credits beside the stub; visual-qa is SKILL.md alone", () => {
    const files = (id) => walk(stubRoot(id)).map((f) => relative(stubRoot(id), f)).sort();
    assert.deepEqual(files("frontend-ui-ux"), ["ATTRIBUTION.md", "SKILL.md", ...PROBE.map((f) => `scripts/${f}`)].sort());
    assert.deepEqual(files("visual-qa"), ["SKILL.md"]);
    assert.match(stub("frontend-ui-ux"), /scripts\/interface-probe\.mjs/u, "the stub tells a lit workflow how to run the kept probe");
  });

  it("the kept interface probe still loads, and the Stop gate still names it", () => {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(join(stubRoot("frontend-ui-ux"), "scripts", "interface-probe.mjs"))});`], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(readFileSync(join(pluginRoot, "lib", "interface-probe-gate.mjs"), "utf8"), /run scripts\/interface-probe\.mjs from its skill directory/u);
  });

  it("the lit-diagram-drawer stub no longer carries the Pretendard pair the design kit used", () => {
    const files = walk(stubRoot("lit-diagram-drawer")).map((f) => relative(stubRoot("lit-diagram-drawer"), f));
    assert.deepEqual(files, ["SKILL.md"]);
  });

  it("the canonical frontend corpus verifier left with the corpus", () => {
    for (const path of ["lib/canonical-frontend-corpus.mjs", "lib/canonical-frontend-commitments.mjs"]) {
      assert.equal(existsSync(join(pluginRoot, path)), false, path);
    }
    for (const file of ["scripts/doctor.mjs", "scripts/validate-plugin.mjs", "bin/litclaude-ai.js", "tools/check-pack-payload.mjs", "tools/scan-legacy-tokens.mjs", "plugins/litclaude/bin/litclaude-hook.js"]) {
      assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /canonical-frontend-(?:corpus|commitments)|_canonical-corpus|verifyCanonicalFrontendCorpus/u, file);
    }
  });

  it("every design route still reaches its stub and carries the install line", () => {
    for (const [id, prompt] of ROUTES) {
      const context = hook(prompt);
      assert.match(context, new RegExp(`Skill\\(${id}\\)`, "u"), prompt);
      assert.match(context, new RegExp(`name="${id}"`, "u"), prompt);
      assert.match(context, /design@wjgoarxiv-skills/u, prompt);
      assert.match(context, new RegExp(`design:${id}`, "u"), prompt);
      assert.match(context, /claude plugin marketplace add wjgoarxiv\/wjgoarxiv-skills/u, prompt);
      assert.doesNotMatch(context, /not published yet|<path to your wjgoarxiv-skills clone>/u, prompt);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${prompt}: ${Buffer.byteLength(context, "utf8")} bytes`);
    }
  });

  it("a polish, audit or harden request keeps its interface mode in the stub context", () => {
    assert.match(hook("이 화면 여백 다듬어줘."), /Interface mode: polish/u);
    assert.match(hook("Harden the settings screen against empty data."), /Interface mode: harden/u);
  });

  it("a design context carries no leftover procedure from the old bodies", () => {
    for (const [, prompt] of ROUTES) {
      const context = hook(prompt);
      for (const leftover of ["AskUserQuestion", "design-lock.mjs", "ui/tokens.css", "craft-floor", "complete-contract.md", "litfamily.design-contract", "litfamily.evidence-manifest", "Playwright", "LOOK questions", "house style"]) {
        assert.ok(!context.includes(leftover), `${prompt}: ${leftover}`);
      }
    }
  });
});
