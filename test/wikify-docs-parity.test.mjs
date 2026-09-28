import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoute = "npm exec --yes --package @litfamily/litclaude -- litclaude wikify <capture|save|review|query|config>";
const operations = ["capture", "save", "review", "query", "config"];
const boundaryDocuments = [
  ["README.md", readFileSync(join(root, "README.md"), "utf8")],
  ["README_ko-KR.md", readFileSync(join(root, "README_ko-KR.md"), "utf8")],
  ["plugins/litclaude/skills/wikify/SKILL.md", readFileSync(join(root, "plugins", "litclaude", "skills", "wikify", "SKILL.md"), "utf8")],
  ["plugins/litclaude/commands/wikify.md", readFileSync(join(root, "plugins", "litclaude", "commands", "wikify.md"), "utf8")],
  ["docs/hooks.md", readFileSync(join(root, "docs", "hooks.md"), "utf8")],
  ["plugins/litclaude/bin/litclaude-hook.js", readFileSync(join(root, "plugins", "litclaude", "bin", "litclaude-hook.js"), "utf8")],
];
const helpDocuments = [
  ["bin/litclaude-ai.js", readFileSync(join(root, "bin", "litclaude-ai.js"), "utf8")],
  ["plugins/litclaude/lib/wikify-knowledge-cli.mjs", readFileSync(join(root, "plugins", "litclaude", "lib", "wikify-knowledge-cli.mjs"), "utf8")],
];
const boundaryPatterns = [
  /user-owned(?: local state)?|local state is user-owned|사용자 소유(?:의)? 로컬 상태/iu,
  /cooperat|협조/iu,
  /same uid|같은 uid/iu,
  /tamper-proof|변조 방지/iu,
  /confidential|기밀성/iu,
  /atomic rename/iu,
  /crash consistency/iu,
  /pre-existing hardlinks?/iu,
  /identity changes?|identity change|identity 변경/iu,
];

test("English and Korean READMEs expose the same Wikify CLI operations", () => {
  const documents = [
    ["README.md", readFileSync(join(root, "README.md"), "utf8")],
    ["README_ko-KR.md", readFileSync(join(root, "README_ko-KR.md"), "utf8")],
  ];

  for (const [name, content] of documents) {
    assert.match(content, new RegExp(publicRoute.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), name);
    for (const operation of operations) {
      assert.match(content, new RegExp(`\\b${operation}\\b`, "u"), `${name} is missing ${operation}`);
    }
    assert.match(content, /review-needed/u, `${name} must document the review-needed state`);
    assert.match(content, /2048-byte normal budget/u, `${name} must document the normal query budget`);
    assert.match(content, /4096-byte hard limit/u, `${name} must document the hard query limit`);
  }
});

test("Wikify documents the minimum local-state boundary", () => {
  for (const [name, content] of boundaryDocuments) {
    for (const pattern of boundaryPatterns) {
      assert.match(content, pattern, `${name} must document ${pattern}`);
    }
  }
});

test("Wikify CLI help states the same-uid boundary", () => {
  for (const [name, content] of helpDocuments) {
    for (const pattern of boundaryPatterns.slice(0, 5)) {
      assert.match(content, pattern, `${name} must document ${pattern}`);
    }
  }
});
