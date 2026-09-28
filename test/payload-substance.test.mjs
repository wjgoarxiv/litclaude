import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECKER = join(REPO_ROOT, "tools", "check-payload-substance.mjs");
const FAMILY_ROOT = process.env.LITCLAUDE_FAMILY_ROOT;
const FAMILY_LAYOUT = process.env.LITCLAUDE_FAMILY_LAYOUT;
const FAMILY_AVAILABLE = Boolean(FAMILY_ROOT && FAMILY_LAYOUT && existsSync(FAMILY_ROOT));

function runChecker(args = [], env = process.env) {
  return spawnSync(process.execPath, [CHECKER, ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
}

function withoutFamilyConfig() {
  const env = { ...process.env };
  delete env.LITCLAUDE_FAMILY_ROOT;
  delete env.LITCLAUDE_FAMILY_LAYOUT;
  return env;
}

test("payload substance gate accepts the current packed skill tree", () => {
  const result = runChecker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_SUBSTANCE_PASS/);
});

test("packed SKILL.md references resolve against the npm payload", () => {
  const result = runChecker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_REFERENCES_PASS: claims=\d+ exemptions=\d+/);
});

test("cross-product payload parity always checks the committed family manifest", () => {
  const result = runChecker();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_PARITY_PASS: source=manifest fraction=0\.5/);
  assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=autoresearch median=30 closures=p27:29/);
  assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=lit-scientific-visualization median=21 closures=p27:20,p28:28,p31:26,p32:20,p33:21/);
  assert.doesNotMatch(result.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/, "default checks must not execute sibling package hooks");
  assert.doesNotMatch(result.stdout, /PAYLOAD_PARITY_FAIL skill=(autoresearch|autoconference)/);
});

test("family freshness probe reports an explicit not-configured skip by default", () => {
  const result = runChecker([], withoutFamilyConfig());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_PARITY_FRESHNESS_NOT_CONFIGURED/);
  assert.doesNotMatch(result.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/);
});

test("optional family freshness probe accepts the checker's live family verdict", { skip: !FAMILY_AVAILABLE }, () => {
  const result = runChecker(["--family-root", FAMILY_ROOT]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAYLOAD_PARITY_PASS: source=manifest fraction=0\.5/);
  assert.match(result.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/);
});

test("family freshness probe rejects a malformed layout", () => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-family-layout-invalid-"));
  const layout = join(root, "layout.json");
  try {
    writeFileSync(layout, "{\n");
    const result = runChecker(["--family-root", root, "--family-layout", layout], withoutFamilyConfig());
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /PAYLOAD_FAMILY_LAYOUT_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("payload substance gate names an unallowlisted hollow skill", () => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-substance-hollow-"));
  try {
    const skills = join(root, "skills");
    mkdirSync(join(skills, "solid"), { recursive: true });
    mkdirSync(join(skills, "hollow"), { recursive: true });
    writeFileSync(join(skills, "solid", "SKILL.md"), "solid\n");
    writeFileSync(join(skills, "hollow", "SKILL.md"), "hollow\n");
    const allowlist = join(root, "allowlist.json");
    writeFileSync(allowlist, JSON.stringify({ schema: "litfamily.payload-substance/v1", skills: { solid: "This bounded instruction is complete for its procedural review." } }));
    const pack = join(root, "pack.json");
    writeFileSync(pack, JSON.stringify([{ files: [{ path: "plugins/litclaude/skills/solid/SKILL.md" }, { path: "plugins/litclaude/skills/hollow/SKILL.md" }] }]));
    const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_SUBSTANCE_FAIL/);
    assert.match(`${result.stdout}\n${result.stderr}`, /hollow/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("payload reference gate names the missing token", () => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-reference-missing-"));
  try {
    const skills = join(root, "skills");
    mkdirSync(join(skills, "hollow"), { recursive: true });
    writeFileSync(join(skills, "hollow", "SKILL.md"), "This skill claims `references/not-packed.md`.\n");
    const allowlist = join(root, "allowlist.json");
    writeFileSync(allowlist, JSON.stringify({ schema: "litfamily.payload-substance/v1", skills: { hollow: "This bounded fixture contains the complete instruction body for its procedural review." } }));
    const pack = join(root, "pack.json");
    writeFileSync(pack, JSON.stringify([{ files: [{ path: "plugins/litclaude/skills/hollow/SKILL.md" }] }]));
    const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_REFERENCE_FAIL skill=hollow token=references\/not-packed\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
