import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// lit-pptx moved to the `decks` plugin of the wjgoarxiv-skills marketplace. LitClaude keeps a same-name stub:
// the id, the `lit` deck route and the slash command still work, and they lead to the install line. The stub
// keeps fonts/pretendard/ because lit-typographic-motion reuses those files by path.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "litclaude");
const stubRoot = join(pluginRoot, "skills", "lit-pptx");
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

describe("lit-pptx is a same-name stub for the decks extras plugin", () => {
  it("says what the skill did, where it lives now and how to install it", () => {
    assert.match(stub, /^---\nname: lit-pptx\n/u);
    assert.match(stub, /PowerPoint deck/u);
    assert.match(stub, /wjgoarxiv-skills/u);
    assert.match(stub, /claude plugin marketplace add <path to your wjgoarxiv-skills clone>/u);
    assert.match(stub, /not (?:been )?published yet/iu, "says plainly the public marketplace is not published yet");
    assert.match(stub, /claude plugin install decks@wjgoarxiv-skills/u);
    assert.match(stub, /decks:lit-pptx/u);
    assert.match(stub, /after (?:it is )?publi/iu, "says the GitHub form comes after publication");
    assert.doesNotMatch(stub, /\/Users\/[a-z]/u, "no private home path");
    assert.doesNotMatch(stub, /install lines above/u, "the install lines sit below, in What moved");
  });

  it("names no private machine path anywhere in the shipped plugin or the docs", () => {
    // `.worktrees/<dir>` placeholders, `/Users/$USER` and `/c/Users/...` are generic; a concrete name is not.
    const privatePath = [/~\/Desktop/u, /27_LITFAMILY/u, /\.worktrees\/(?!<)/u, /\/Users\/[a-z]/u];
    const offenders = [];
    for (const file of [...walk(pluginRoot), ...walk(join(root, "docs"))]) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      for (const pattern of privatePath) if (pattern.test(text)) offenders.push(`${relative(root, file)} ${pattern}`);
    }
    assert.deepEqual(offenders, []);
  });

  it("is a stub, not the body: small, and the only other files are the reused Pretendard pair", () => {
    assert.ok(Buffer.byteLength(stub) < 9000, `${Buffer.byteLength(stub)} bytes`);
    const files = walk(stubRoot).map((f) => relative(stubRoot, f)).sort();
    assert.deepEqual(files, ["SKILL.md", "fonts/pretendard/OFL.txt", "fonts/pretendard/Pretendard-Bold.otf", "fonts/pretendard/Pretendard-Regular.otf"]);
  });

  it("keeps the font bytes lit-typographic-motion checks by hash", () => {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, "skills", "lit-typographic-motion", "fonts", "manifest.json"), "utf8"));
    const motionFonts = join(pluginRoot, "skills", "lit-typographic-motion", "fonts");
    for (const key of ["pretendard-400", "pretendard-700"]) {
      const font = manifest.fonts?.[key] ?? manifest[key] ?? Object.values(manifest).find((v) => v && typeof v === "object" && v[key])?.[key];
      assert.ok(font, key);
      for (const f of [{ path: font.path, sha256: font.sha256 }, ...font.licence]) {
        const sha = createHash("sha256").update(readFileSync(resolve(motionFonts, f.path))).digest("hex");
        assert.equal(sha, f.sha256, f.path);
      }
    }
  });

  it("the bare-lit deck route and the explicit skill name still reach the stub and carry the install line", () => {
    for (const prompt of ["lit 발표자료 만들어줘", "lit-pptx make a deck about our Q3 results"]) {
      const context = hook(prompt);
      assert.match(context, /Skill\(lit-pptx\)/u, prompt);
      assert.match(context, /name="lit-pptx"/u, prompt);
      assert.match(context, /decks@wjgoarxiv-skills/u, prompt);
      assert.match(context, /decks:lit-pptx/u, prompt);
      assert.match(context, /<path to your wjgoarxiv-skills clone>/u, prompt);
      assert.match(context, /not published yet/u, prompt);
      assert.ok(Buffer.byteLength(context, "utf8") <= 4096, `${Buffer.byteLength(context, "utf8")} bytes`);
    }
  });

  it("a deck-only context carries no leftover deck procedure from the old body", () => {
    for (const prompt of ["lit-pptx make a 5-slide deck", "lit 발표자료 만들어줘"]) {
      const context = hook(prompt);
      for (const leftover of ["direction step", "AskUserQuestion", "tonality", "scripts/, references/, templates/"]) {
        assert.ok(!context.includes(leftover), `${prompt}: ${leftover}`);
      }
    }
  });

  it("a prompt for a deck and a document still routes both, and lit-docx keeps its own contract", () => {
    const context = hook("lit 보고서랑 발표자료 둘 다 만들어줘");
    assert.match(context, /Skill\(lit-docx\)/u);
    assert.match(context, /Skill\(lit-pptx\)/u);
    assert.match(context, /Mode contract: lit-docx/u);
    assert.match(context, /decks@wjgoarxiv-skills/u);
    // The docx half of the style gate and the docx skill body stay.
    assert.match(context, /a document takes the tonality its direction step picks/u);
    assert.match(context, /name="lit-docx">\nLoad this exact installed entrypoint [^\n]*SKILL_ROOT for scripts\/, references\/, templates\/ and fonts\//u);
    assert.doesNotMatch(context, /a deck takes the tonality/u);
  });
});
