import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const skillPath = join(root, "plugins", "litclaude", "skills", "structural-search", "SKILL.md");
const skill = () => readFileSync(skillPath, "utf8");

const contextFor = (prompt) => {
  const result = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};
const bodyFor = (prompt) => /<litclaude-skill-body name="([a-z-]+)">/u.exec(contextFor(prompt))?.[1] ?? null;

describe("structural-search route", () => {
  it("answers its own name and the dollar shorthand", () => {
    assert.equal(bodyFor("structural-search find all fetch calls"), "structural-search");
    assert.equal(bodyFor("$structural-search"), "structural-search");
    assert.equal(bodyFor("structural-search"), "structural-search");
  });

  it("fires on a search verb AND a syntax-shape object", () => {
    for (const prompt of [
      "find every call site that passes a callback",
      "rewrite these imports by syntax shape",
      "replace all imports of lodash with named imports",
      "migrate the call sites to the new signature",
      "find the declarations in this file",
    ]) {
      assert.equal(bodyFor(prompt), "structural-search", `should fire for: ${prompt}`);
    }
  });

  it("stays silent when the object is a string, not a syntax shape", () => {
    // The verb alone is far too common. "find the bug" must stay inert.
    for (const prompt of ["find the login handler", "search for TODO comments", "grep for the error string", "search the repo for TODO"]) {
      assert.equal(bodyFor(prompt), null, `must not activate for: ${prompt}`);
    }
  });

  it("is not an anywhere-token", () => {
    assert.equal(bodyFor("plain structural-search discussion"), null);
  });

  it("does not hijack other routes, and injects no undefined mode contract", () => {
    assert.equal(bodyFor("lit plan the migration"), "lit-plan");
    assert.equal(bodyFor("lit-team"), "lit-team");
    assert.doesNotMatch(contextFor("structural-search"), /undefined/u);
  });
});

describe("structural-search capability discipline", () => {
  it("probes for the engine and refuses to assume it", () => {
    const text = skill();
    assert.match(text, /ast-grep --version 2>&1 \| grep -qi 'ast-grep'/u, "must verify identity from version output");
    assert.match(text, /STRUCTURAL_SEARCH_BIN/u);
    assert.match(text, /unavailable/u);
  });

  it("names the sg false-identity hazard explicitly", () => {
    // `sg` is an unrelated system utility on many Linux distributions, so `command -v sg`
    // succeeding proves nothing. This is the hazard most likely to produce a confident
    // wrong answer, so it must be stated, not implied.
    assert.match(skill(), /`sg`/u);
    // Whitespace-tolerant: the phrase wraps across lines in the source, and pinning prose to a
    // line break is exactly the brittle assertion the PROSE-target rule in litwork warns about.
    assert.match(skill(), /unrelated\s+system\s+utility/iu);
    assert.match(skill(), /BLOCKED_TOOL_IDENTITY_UNVERIFIED/u);
  });

  it("makes the unavailable path a named blocker, not a silent degrade", () => {
    const text = skill();
    assert.match(text, /BLOCKED_STRUCTURAL_ENGINE_UNAVAILABLE/u);
    assert.match(text, /label/iu, "the textual fallback must be labelled");
    assert.match(text, /query_class/u);
    assert.match(text, /Do \*\*not\*\* install anything|never install/iu);
  });

  it("keeps rewrite as a separate, previewed phase", () => {
    const text = skill();
    assert.match(text, /separate phase/iu);
    assert.match(text, /preview/iu);
    assert.match(text, /apply \*\*once\*\*|apply once/iu);
  });

  it("routes semantic questions away from itself", () => {
    // Syntax trees do not resolve types or symbols; sending those here produces confident
    // wrong answers, so the skill must point at the LSP surface instead.
    assert.match(skill(), /Skill\(lsp\)/u);
    assert.match(skill(), /does not prove semantics|do not prove semantics/iu);
  });

  it("declares the unported reference corpus rather than leaving it silent", () => {
    assert.match(skill(), /Deliberate non-port/u);
    assert.match(skill(), /28 KB|three reference documents/u);
  });
});

describe("structural-search is reachable from discovery", () => {
  it("is cross-referenced from the skills where the question actually arises", () => {
    // A destination nothing references is the orphan problem this run has been closing.
    // With no NL route, these cross-references ARE the discovery path, so they are load-bearing.
    for (const skillName of ["lit-init", "refactor"]) {
      const text = readFileSync(join(root, "plugins", "litclaude", "skills", skillName, "SKILL.md"), "utf8");
      assert.match(text, /Skill\(structural-search\)/u, `${skillName} must point at structural-search`);
    }
  });
});

describe("structural-search conjunction — the negatives that make it safe", () => {
  // A VOCABULARY-ONLY predicate scored 8 false positives out of 8 on these. The shipped
  // predicate also requires a search VERB, which is what makes them silent: add / update /
  // check / fix / document are not searches. This is the corpus any future change must survive.
  it("does not fire on ordinary prompts containing compiler vocabulary", () => {
    for (const prompt of [
      "whats the function signature here",
      "add a declaration for this variable",
      "update the import statement at the top",
      "the AST output is confusing, explain it",
      "check the call site of this bug",
      "fix the type declaration in types.d.ts",
      "document the signature of this API",
      "this declaration is in the wrong file",
    ]) {
      assert.equal(bodyFor(prompt), null, `must stay silent for: ${prompt}`);
    }
  });

  it("routes WHO questions to the language server, not here", () => {
    // Ask the language server WHO and WHAT; ask a structural engine WHAT SHAPE.
    // A call site is a syntax node; a CALLER is the enclosing function, which needs scope and
    // symbol resolution to name. `usages of X` and `references to X` are the same category —
    // deciding which X is *this* X is symbol resolution a tree matcher cannot do.
    // These briefly fired after a request to make "find all the callers" match; that request
    // contradicted this skill's own "Use Skill(lsp) instead" line. Pinned so it cannot return.
    for (const prompt of [
      "find all the callers",
      "find the callers of this helper",
      "locate all callers of parseConfig",
      "find all usages of this helper",
      "locate every usage of parseConfig",
      "search for references to the old API",
    ]) {
      assert.equal(bodyFor(prompt), null, `WHO question must go to Skill(lsp), not fire here: ${prompt}`);
    }
  });

  it("keeps the skill body and the shape list consistent about WHO vs WHAT SHAPE", () => {
    // The defect this replaces was a body that said one thing and a shape list that did the
    // opposite. Assert both halves agree.
    const text = skill();
    assert.match(text, /Skill\(lsp\)/u);
    assert.match(text, /WHO and WHAT; ask a structural engine WHAT SHAPE/u);
    // The excluded terms must not reappear in the documented shape list.
    const shapeBlock = /```\nverb[\s\S]*?```/u.exec(text)?.[0] ?? "";
    for (const excluded of ["callers", "usages", "references to", "call graph"]) {
      assert.ok(!shapeBlock.includes(excluded), `${excluded} is a WHO term and must not be a shape`);
    }
  });

  it("drops the two shape terms that collided with non-code meanings", () => {
    // Bare `signatures` matched "search the changelog for signatures" (cryptographic), and
    // `references to` matched a docs search — and is a SEMANTIC question this skill routes to
    // Skill(lsp) anyway, so matching it here would contradict the skill's own boundary.
    assert.equal(bodyFor("search the changelog for signatures"), null);
    assert.equal(bodyFor("search for references to the old API in the docs"), null);
    // The qualified form still fires.
    assert.equal(bodyFor("migrate the call sites to the new signature"), "structural-search");
  });

  it("keeps the two known over-fires, because the cost is asymmetric", () => {
    // Kept on purpose: a false fire ends in probe -> unavailable -> labelled textual, which is
    // what would have happened anyway. A MISS on "replace all imports of lodash" produces a
    // naive text replace that breaks code. Pinned so the trade-off is visible, not accidental.
    assert.equal(bodyFor("find the imports in this file"), "structural-search");
    assert.equal(bodyFor("locate the AST dump file"), "structural-search");
  });

  it("does not hijack the UI design route", () => {
    assert.equal(bodyFor("design a new settings page UI"), "frontend-ui-ux");
    assert.equal(bodyFor("lit plan the migration"), "lit-plan");
  });

  it("records how it is reached in the skill body", () => {
    const text = skill();
    assert.match(text, /How this skill is reached/u);
    assert.match(text, /discriminating half is the object, not the verb/iu);
    assert.match(text, /call site/u);
  });
});
