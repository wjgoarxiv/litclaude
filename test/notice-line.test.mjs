import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Every prompt file ends with LitClaude's notice line: copyright, licence, the official repo and a
// per-file fingerprint in plain hex. This guard checks the format only; it cannot know the fingerprints.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const plugin = join(root, "plugins", "litclaude");
const NOTICE = /^<!-- LitClaude © 2026 wjgoarxiv · MIT · github\.com\/wjgoarxiv\/litclaude · fp:([0-9a-f]{12}) -->$/u;
const promptFiles = () => [
  ...readdirSync(join(plugin, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join("skills", d.name, "SKILL.md")),
  ...readdirSync(join(plugin, "agents")).filter((f) => f.endsWith(".md")).map((f) => join("agents", f)),
];

describe("notice line in every prompt file", () => {
  it("every SKILL.md and agent .md ends with exactly one well-formed notice line, each fingerprint unique", () => {
    const files = promptFiles();
    assert.ok(files.length >= 50, `found ${files.length} prompt files`);
    const seen = new Map();
    const problems = [];
    for (const rel of files) {
      const text = readFileSync(join(plugin, rel), "utf8");
      const lines = text.trimEnd().split("\n");
      const last = lines.at(-1);
      const m = NOTICE.exec(last);
      if (!m) { problems.push(`${rel}: last line is not the notice`); continue; }
      if (!text.endsWith(`${last}\n`)) problems.push(`${rel}: the notice must be the final line, followed by one newline`);
      if (lines.filter((l) => l.includes("· fp:")).length !== 1) problems.push(`${rel}: more than one notice line`);
      if (seen.has(m[1])) problems.push(`${rel}: fingerprint repeats ${seen.get(m[1])}`);
      seen.set(m[1], rel);
    }
    assert.deepEqual(problems, []);
  });

  it("the notice is plain text: no zero-width characters, homoglyphs or encoded payloads", () => {
    for (const rel of promptFiles()) {
      const last = readFileSync(join(plugin, rel), "utf8").trimEnd().split("\n").at(-1);
      assert.doesNotMatch(last, /[​-‏⁠﻿]/u, rel);
      assert.ok([...last].every((ch) => ch.charCodeAt(0) < 0x80 || ch === "©" || ch === "·"), `${rel}: only ASCII plus © and ·`);
    }
  });
});
