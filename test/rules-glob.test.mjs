import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGlobMatcher, expandBraces, globRegexSource, matchGlob } from "../plugins/litclaude/lib/rules/glob.mjs";

const matches = (pattern, path) => matchGlob(pattern, path);

describe("rules glob matcher — supported syntax", () => {
  it("matches a literal path", () => {
    assert.equal(matches("src/index.mjs", "src/index.mjs"), true);
    assert.equal(matches("src/index.mjs", "src/other.mjs"), false);
  });

  it("* matches within one segment and never crosses a separator", () => {
    assert.equal(matches("*.md", "README.md"), true);
    assert.equal(matches("*.md", "docs/README.md"), false);
    assert.equal(matches("src/*.mjs", "src/a.mjs"), true);
    assert.equal(matches("src/*.mjs", "src/nested/a.mjs"), false);
    assert.equal(matches("src/*", "src/a"), true);
    assert.equal(matches("src/*", "src/a/b"), false);
  });

  it("? matches exactly one non-separator character", () => {
    assert.equal(matches("a?.md", "ab.md"), true);
    assert.equal(matches("a?.md", "a.md"), false);
    assert.equal(matches("a?.md", "abc.md"), false);
    assert.equal(matches("a?b", "a/b"), false);
  });

  it("** spans zero or more segments in the middle", () => {
    assert.equal(matches("src/**/test.mjs", "src/test.mjs"), true);
    assert.equal(matches("src/**/test.mjs", "src/a/test.mjs"), true);
    assert.equal(matches("src/**/test.mjs", "src/a/b/c/test.mjs"), true);
    assert.equal(matches("src/**/test.mjs", "other/test.mjs"), false);
  });

  it("leading **/ matches zero or more leading segments", () => {
    assert.equal(matches("**/*.ts", "a.ts"), true);
    assert.equal(matches("**/*.ts", "src/a.ts"), true);
    assert.equal(matches("**/*.ts", "src/deep/nested/a.ts"), true);
    assert.equal(matches("**/*.ts", "src/a.tsx"), false);
  });

  it("bare ** matches any non-empty path", () => {
    assert.equal(matches("**", "a"), true);
    assert.equal(matches("**", "a/b/c"), true);
    assert.equal(matches("**", ""), false);
  });

  it("{a,b} expands to alternatives, including nested groups", () => {
    assert.equal(matches("src/*.{ts,tsx}", "src/a.ts"), true);
    assert.equal(matches("src/*.{ts,tsx}", "src/a.tsx"), true);
    assert.equal(matches("src/*.{ts,tsx}", "src/a.js"), false);
    assert.equal(matches("{a,{b,c}}/x.md", "b/x.md"), true);
    assert.equal(matches("{a,{b,c}}/x.md", "c/x.md"), true);
    assert.equal(matches("{a,{b,c}}/x.md", "d/x.md"), false);
  });

  it("expandBraces enumerates every alternative and is bounded", () => {
    assert.deepEqual(expandBraces("a.{ts,tsx}"), ["a.ts", "a.tsx"]);
    assert.deepEqual(expandBraces("plain.md"), ["plain.md"]);
    // 8 nested pairs = 256 combinations; the cap must hold the output finite.
    const explosive = "{a,b}".repeat(12);
    assert.ok(expandBraces(explosive).length <= 256, "brace expansion must stay bounded");
  });

  it("dotfiles match without an opt-in (dot:true parity)", () => {
    assert.equal(matches("*.md", ".hidden.md"), true);
    assert.equal(matches("**/*.md", ".config/notes.md"), true);
    assert.equal(matches("src/*", "src/.env"), true);
  });

  it("normalizes backslash separators and a leading ./", () => {
    assert.equal(matches("src/*.mjs", "src\\a.mjs"), true);
    assert.equal(matches("./src/*.mjs", "src/a.mjs"), true);
  });

  it("matching is case-sensitive", () => {
    assert.equal(matches("README.md", "readme.md"), false);
  });

  it("createGlobMatcher returns a reusable predicate", () => {
    const isMatch = createGlobMatcher("src/**/*.mjs");
    assert.equal(isMatch("src/a.mjs"), true);
    assert.equal(isMatch("src/a/b.mjs"), true);
    assert.equal(isMatch("test/a.mjs"), false);
  });

  it("regex source is anchored so a pattern never matches a suffix by accident", () => {
    assert.match(globRegexSource("a.md"), /^\^/u);
    assert.match(globRegexSource("a.md"), /\$$/u);
    assert.equal(matches("a.md", "xa.md"), false);
    assert.equal(matches("a.md", "a.mdx"), false);
  });

  it("regex metacharacters in a pattern are literal", () => {
    assert.equal(matches("a+b.md", "a+b.md"), true);
    assert.equal(matches("a+b.md", "aab.md"), false);
    assert.equal(matches("a(b).md", "a(b).md"), true);
    assert.equal(matches("v1.2.md", "v1.2.md"), true);
    assert.equal(matches("v1.2.md", "v1x2.md"), false);
  });

  it("is resilient to hostile pattern text instead of throwing", () => {
    for (const pattern of ["", "{", "}", "{unclosed,", "[[[", "\\", "***/**/***", "a".repeat(5000)]) {
      assert.doesNotThrow(() => matchGlob(pattern, "src/a.mjs"), `pattern ${JSON.stringify(pattern)} must not throw`);
    }
  });
});

// These tests PIN divergence; they do not claim parity. Every expectation below was
// measured against real picomatch 4.0.4 (read-only, from the LitCodex donor's
// node_modules) — see probes/litclaude/rules-glob-picomatch-differential.txt. Three
// assumptions in the first draft of this file were WRONG and the differential caught
// them, so do not add a row here from memory: measure it.
//
// Group 1 — real divergences from standard picomatch (what .cursor/rules authors expect).
describe("rules glob matcher — pinned divergences from .cursor/rules (picomatch 4.0.4)", () => {
  it("D1: character classes are literal, not ranges", () => {
    // measured picomatch: true. Unsupported here.
    assert.equal(matches("[ab].md", "a.md"), false);
    assert.equal(matches("[ab].md", "[ab].md"), true);
  });

  it("D2: extglobs are literal, not alternation groups", () => {
    // measured picomatch: "@(a|b).md" vs "a.md" true; "!(a).md" vs "b.md" true.
    assert.equal(matches("@(a|b).md", "a.md"), false);
    assert.equal(matches("!(a).md", "b.md"), false);
  });

  it("D3: POSIX bracket expressions are literal", () => {
    // measured picomatch: true.
    assert.equal(matches("[[:digit:]].md", "1.md"), false);
  });

  it("D4: brace RANGES are literal; only comma alternation expands", () => {
    // measured picomatch: true.
    assert.equal(matches("v{1..3}.md", "v2.md"), false);
    assert.equal(matches("v{1..3}.md", "v{1..3}.md"), true);
  });

  it("D5: backslash is a path separator, never an escape character", () => {
    // measured picomatch (raw pattern): "a\\*.md" matches "a*.md" and NOT "a/x.md" —
    // it escapes the star. LitClaude normalizes "\\" to "/" first, because rule paths
    // arriving from a Windows host matter more than escaping a literal asterisk.
    assert.equal(matches("a\\*.md", "a/x.md"), true);
    assert.equal(matches("a\\*.md", "a*.md"), false);
  });

  it("D6: a trailing /** requires at least one segment below the directory", () => {
    // measured picomatch: "src/**" matches "src" itself under every option set tried.
    // A rule scoped to a directory should not fire for a FILE of the same name.
    assert.equal(matches("src/**", "src/a"), true);
    assert.equal(matches("src/**", "src/a/b"), true);
    assert.equal(matches("src/**", "src"), false);
  });

  it("D7: no regex-style (a|b) groups", () => {
    // measured picomatch: true (parsed as an extglob-ish group).
    assert.equal(matches("(a|b).md", "a.md"), false);
    assert.equal(matches("(a|b).md", "(a|b).md"), true);
  });
});

// Group 2 — deliberate divergence from the DONOR's configuration, not from the dialect.
// LitCodex compiles every pattern with picomatch({ bash: true, dot: true }), and the
// measured effect of `bash: true` is that a trailing `*` behaves like `**`: "*.md"
// matches "docs/README.md" and "src/*" matches "src/a/b". That silently widens every
// directory-scoped rule to the whole subtree. LitClaude keeps the standard meaning.
describe("rules glob matcher — deliberate divergence from the donor's bash:true config", () => {
  it("D8: * stops at a separator (donor's bash:true lets it cross)", () => {
    // measured picomatch {bash:true,dot:true}: true. measured {dot:true}: false.
    assert.equal(matches("*.md", "docs/README.md"), false);
    assert.equal(matches("src/*", "src/a/b"), false);
    assert.equal(matches("src/*.mjs", "src/nested/a.mjs"), false);
  });

  it("D9: ** inside a segment stops at a separator (donor's bash:true lets it cross)", () => {
    // measured picomatch {bash:true,dot:true}: true. measured {dot:true}: false.
    assert.equal(matches("a**b", "axxb"), true);
    assert.equal(matches("a**b", "ax/xb"), false);
  });
});

// Group 3 — measured PARITY with picomatch. These were drafted as divergences and the
// differential proved they are not. They stay as regression pins.
describe("rules glob matcher — measured parity with picomatch", () => {
  it("P1: a single-alternative brace group stays literal in both", () => {
    // measured picomatch: "{a}.md" vs "a.md" false, vs "{a}.md" true. Same here.
    assert.equal(matches("{a}.md", "{a}.md"), true);
    assert.equal(matches("{a}.md", "a.md"), false);
  });

  it("P2: a mid-pattern ! is literal in both", () => {
    // Negation is applied by the rule matcher as a whole-pattern prefix, never here.
    assert.equal(matches("!a.md", "!a.md"), true);
    assert.equal(matches("a!b.md", "a!b.md"), true);
  });

  it("P3: ? never crosses a separator in either implementation", () => {
    assert.equal(matches("a?.md", "a/b.md"), false);
  });
});
