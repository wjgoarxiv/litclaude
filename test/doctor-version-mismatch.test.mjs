import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { cliEnv } from "./helpers/cli-env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const withInstall = (header, check) => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-doctor-version-"));
  const claudeHome = mkdtempSync(join(tmpdir(), "litclaude-doctor-version-claude-"));
  try {
    const env = (extra = {}) => cliEnv({ ...process.env, LITCLAUDE_HOME: home, CLAUDE_HOME: claudeHome, CLAUDE_CONFIG_DIR: claudeHome, ...extra });
    const install = spawnSync(process.execPath, [binPath, "install"], { cwd: root, encoding: "utf8", env: env() });
    assert.equal(install.status, 0, install.stderr);
    const fakeBin = join(home, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    const lines = [header, `Skills (${canonicalSkillIds.length}) ${canonicalSkillIds.join(", ")}`, "Agents (11) lit-planner"].filter(Boolean);
    writeFileSync(
      join(fakeBin, "claude"),
      `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 'Claude Code 2.1.158'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "validate" ]; then exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "details" ]; then ${lines.map((line) => `echo '${line}';`).join(" ")} exit 0; fi\nexit 2\n`,
    );
    chmodSync(join(fakeBin, "claude"), 0o755);
    const doctor = spawnSync(process.execPath, [binPath, "doctor"], { cwd: root, encoding: "utf8", env: env({ PATH: `${fakeBin}:${process.env.PATH}` }) });
    return check(doctor);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  }
};

describe("doctor names which side is older when the plugin and the command differ", () => {
  it("a plugin older than the command says to run litclaude update", () => {
    withInstall("LitClaude (litclaude) 0.3.23", (doctor) => {
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /expected version/u);
      assert.ok(doctor.stderr.includes(`expected version ${version}. This command is LitClaude ${version} but the installed plugin is 0.3.23; they differ, and the plugin is the older one. Type: litclaude update --yes`), doctor.stderr);
      assert.doesNotMatch(doctor.stderr, /Re-run litclaude install/u);
    });
  });

  it("a plugin newer than the command says to install the newer package", () => {
    withInstall("LitClaude (litclaude) 99.0.0", (doctor) => {
      assert.notEqual(doctor.status, 0);
      assert.ok(doctor.stderr.includes(`expected version ${version}. This command is LitClaude ${version} but the installed plugin is 99.0.0; they differ, and the command on your PATH is the older one. Type: npm install -g @litfamily/litclaude@99.0.0`), doctor.stderr);
      assert.doesNotMatch(doctor.stderr, /Re-run litclaude install/u);
    });
  });

  it("details that show no readable version keep the old closing sentence, and no marker line moves", () => {
    withInstall("LitClaude (litclaude)", (doctor) => {
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, new RegExp(`expected version ${version.replaceAll(".", "\\.")}`, "u"));
      assert.match(doctor.stderr, /Re-run litclaude install in the intended CLAUDE_CONFIG_DIR\./u);
      assert.match(doctor.stdout, /^AGENT_FILE: /mu);
      assert.match(doctor.stdout, /^CLAUDE_PLUGIN_VALIDATE_PASS$/mu);
      assert.doesNotMatch(doctor.stdout, /DOCTOR_PASS|UPDATE_VERSIONS/u);
    });
  });
});
