import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const canonicalSkillsInventory = canonicalSkillIds.join(", ");

function makeHome() {
  return mkdtempSync(join(tmpdir(), "litclaude-install-test-"));
}

function makeClaudeHome() {
  return mkdtempSync(join(tmpdir(), "litclaude-claude-install-test-"));
}

function runCli(args, home, claudeHome = join(home, ".claude")) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, LITCLAUDE_HOME: home, CLAUDE_HOME: claudeHome },
  });
}

function runCliWithEnv(args, home, claudeHome, env) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env, LITCLAUDE_HOME: home, CLAUDE_HOME: claudeHome },
  });
}

function assertFile(path, description) {
  assert.equal(existsSync(path), true, `${description} should exist at ${path}`);
  assert.equal(statSync(path).isFile(), true, `${description} should be a file`);
}

function resolveRegisteredPlugin(home, claudeHome, expectedPluginPath) {
  const pathResult = runCli(["path"], home, claudeHome);
  assert.equal(pathResult.status, 0, pathResult.stderr);
  const path = pathResult.stdout.trim().split("\n").at(-1);
  assert.equal(resolve(path), expectedPluginPath);
  return path;
}

describe("portable LitClaude install layout", () => {
  it("runs the documented scaffold command from an installed plugin in a normal user project", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    const project = makeHome();
    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);
      const pluginPath = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", version);
      const scaffoldPath = join(pluginPath, "scripts", "scaffold-plan.mjs");
      const skill = readFileSync(join(pluginPath, "skills", "lit-plan", "SKILL.md"), "utf8");

      assert.match(
        skill,
        /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/scaffold-plan\.mjs" <slug> --draft-only/u,
        "the installed skill must name a plugin-root-relative executable",
      );
      assertFile(scaffoldPath, "installed scaffold-plan executable");

      const scaffold = spawnSync(process.execPath, [scaffoldPath, "installed-probe", "--draft-only"], {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginPath },
      });
      assert.equal(scaffold.status, 0, scaffold.stderr);
      assert.match(scaffold.stdout, /created: \.litclaude[/\\]drafts[/\\]installed-probe\.md/u);
      assertFile(
        join(project, ".litclaude", "drafts", "installed-probe.md"),
        "user-project scaffold draft",
      );
      assert.equal(existsSync(join(project, "plans", "installed-probe.md")), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("integration.installed-nested-assets", async () => {
    const catalog = await import("../plugins/litclaude/lib/canonical-skill-catalog.mjs");
    const resources = catalog.canonicalSkillResourceFiles;
    assert.ok(
      Array.isArray(resources),
      "installed integrity needs a canonical nested-resource inventory, not entrypoint-only checks",
    );
    assert.ok(resources.length > catalog.canonicalSkillFiles.length);

    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);
      const pluginPath = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", version);

      for (const relativePath of resources) {
        assertFile(join(pluginPath, relativePath), `installed canonical resource ${relativePath}`);
      }

      const queryCli = join(pluginPath, "skills", "frontend-ui-ux", "scripts", "query-design-intelligence.mjs");
      const query = spawnSync(
        process.execPath,
        [queryCli, "--query", "CJK terminal dashboard", "--domain", "ux-guidelines", "--limit", "1", "--json"],
        { cwd: pluginPath, encoding: "utf8", timeout: 5000 },
      );
      assert.equal(query.signal, null);
      assert.equal(query.status, 0, query.stderr);
      assert.equal(JSON.parse(query.stdout).schema_id, "litfamily.design-intelligence-query/v1alpha1");

      const visualCli = join(pluginPath, "skills", "visual-qa", "scripts", "cli.mjs");
      const capturePath = join(home, "installed-capture.txt");
      writeFileSync(capturePath, "┌──┐\n│한│\n└──┘\n");
      const visual = spawnSync(process.execPath, [visualCli, "tui-check", capturePath, "--cols", "4"], {
        cwd: pluginPath,
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(visual.signal, null);
      assert.equal(visual.status, 0, visual.stderr);
      assert.equal(JSON.parse(visual.stdout).maxWidth, 4);

      writeFileSync(queryCli, `${readFileSync(queryCli, "utf8")}\n// tampered nested resource\n`);
      const doctor = runCliWithEnv(["doctor"], home, claudeHome, { PATH: "" });
      assert.notEqual(doctor.status, 0, "doctor must reject a hash-tampered nested skill resource");
      assert.match(doctor.stderr, /SKILL_RESOURCE_INTEGRITY_FAIL/u);
      assert.match(doctor.stderr, /skills\/frontend-ui-ux\/scripts\/query-design-intelligence\.mjs/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("installs the versioned Claude Code plugin payload into Claude's user plugin registry", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["install"], home, claudeHome);

      assert.equal(
        result.status,
        0,
        `install should exit 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );

      const pluginPath = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", version);

      assert.equal(existsSync(pluginPath), true, "versioned plugin path should exist");
      assert.equal(
        realpathSync(resolveRegisteredPlugin(home, claudeHome, pluginPath)),
        realpathSync(pluginPath),
        "CLI path should resolve to the registered Claude plugin",
      );

      const registry = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
      assert.equal(registry.plugins["litclaude@litclaude-ai"][0].installPath, pluginPath);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.enabledPlugins["litclaude@litclaude-ai"], true);
      assert.equal(settings.extraKnownMarketplaces["litclaude-ai"].source.source, "directory");
      assert.equal(settings.extraKnownMarketplaces["litclaude-ai"].source.path, join(home, "marketplaces", "litclaude-ai"));
      assert.equal(settings.statusLine.type, "command");
      assert.match(settings.statusLine.command, /LITCLAUDE_HUD_ACCENT=cyan node ".+bin\/litclaude-hud\.js"/u);
      assert.equal(settings.litclaude.statusLineManaged, true);
      assert.equal(settings.litclaude.statusLineCommand, settings.statusLine.command);
      assert.equal(settings.litclaude.statusLineVersion, packageJson.version);
      assert.equal(settings.litclaude.hudAccent, "cyan");
      assert.match(settings.litclaude.statusLineInstalledAt, /^\d{4}-\d{2}-\d{2}T/u);
      const knownMarketplaces = JSON.parse(readFileSync(join(claudeHome, "plugins", "known_marketplaces.json"), "utf8"));
      assert.equal(knownMarketplaces["litclaude-ai"].installLocation, join(home, "marketplaces", "litclaude-ai"));
      assertFile(join(home, "marketplaces", "litclaude-ai", ".claude-plugin", "marketplace.json"), "LitClaude local marketplace");

      assertFile(join(pluginPath, ".claude-plugin", "plugin.json"), "Claude plugin manifest");
      assertFile(join(pluginPath, ".mcp.json"), "MCP configuration");
      assertFile(join(pluginPath, ".lsp.json"), "LSP configuration");
      assertFile(join(pluginPath, "hooks", "hooks.json"), "hook manifest");
      assertFile(join(pluginPath, "skills", "start-work", "SKILL.md"), "start-work skill");
      assertFile(join(pluginPath, "skills", "lit-plan", "SKILL.md"), "lit-plan skill");
      assertFile(join(pluginPath, "skills", "lit-handoff", "SKILL.md"), "lit-handoff adapter");
      assertFile(join(pluginPath, "commands", "lit-handoff.md"), "lit-handoff command");
      assertFile(join(pluginPath, "vendor", "handoff", "SKILL.md"), "canonical handoff source");
      assertFile(join(pluginPath, "skills", "lit-scientific-visualization", "SKILL.md"), "scientific visualization adapter");
      assertFile(join(pluginPath, "commands", "lit-scientific-visualization.md"), "scientific visualization command");
      assertFile(join(pluginPath, "vendor", "scientific-visualization", "SKILL.md"), "canonical scientific visualization source");
      assertFile(join(pluginPath, "vendor", "scientific-visualization", "scripts", "style_presets.py"), "scientific visualization style runtime");
      assertFile(join(pluginPath, "vendor", "scientific-visualization", "assets", "publication.mplstyle"), "scientific visualization style asset");
      assertFile(join(pluginPath, "agents", "lit-planner.md"), "planner agent");
      assertFile(join(pluginPath, "agents", "quality-reviewer.md"), "quality reviewer agent");
      assertFile(join(pluginPath, "bin", "litclaude-hook.js"), "hook bin");
      assertFile(join(pluginPath, "bin", "litclaude-mcp.js"), "MCP bin");
      assertFile(join(pluginPath, "lib", "wikify-knowledge.mjs"), "Wikify knowledge runtime");
      assertFile(join(pluginPath, "lib", "wikify-knowledge-cli.mjs"), "Wikify knowledge CLI");
      assertFile(join(pluginPath, "bin", "litclaude-lsp-doctor.js"), "LSP doctor bin");
      assertFile(join(pluginPath, "bin", "litclaude-scientific-visualization-doctor.js"), "scientific visualization doctor bin");
      const bundledDoctor = spawnSync(
        process.execPath,
        [join(pluginPath, "bin", "litclaude-scientific-visualization-doctor.js"), "--json"],
        { cwd: pluginPath, encoding: "utf8" },
      );
      assert.equal(bundledDoctor.status, 0, bundledDoctor.stderr);
      const bundledReport = JSON.parse(bundledDoctor.stdout);
      assert.equal(bundledReport.payload, "PASS");
      assert.equal(bundledReport.integrity.handoff.status, "PASS");
      assert.equal(bundledReport.integrity.scientificVisualization.status, "PASS");
      const diagramRoot = join(pluginPath, "skills", "lit-diagram-drawer");
      for (const file of ["SKILL.md", "scripts/verify-diagram.mjs", "scripts/export.mjs", "scripts/doctor.mjs", "assets/fonts/PretendardVariable.woff2", "assets/fonts/OFL.txt"]) {
        assertFile(join(diagramRoot, file), `lit-diagram-drawer ${file}`);
      }
      const installedDiagram = spawnSync(
        process.execPath,
        [join(diagramRoot, "scripts", "verify-diagram.mjs"), join(diagramRoot, "examples", "07-deployment-boundary", "after.html")],
        { cwd: home, encoding: "utf8" },
      );
      assert.equal(installedDiagram.status, 0, installedDiagram.stderr);
      assert.match(installedDiagram.stdout, /DIAGRAM_PASS .* humanizer-block=0/u);
      for (const file of ["skills/lit-pptx/SKILL.md", "skills/lit-pptx/NOTICE", "skills/lit-pptx/scripts/compile-deck.js", "skills/lit-pptx/scripts/qa_deck.py",
        "skills/lit-pptx/scripts/layout_inventory.py", "skills/lit-pptx/fonts/pretendard/Pretendard-Regular.otf", "skills/lit-pptx/fonts/pretendard/OFL.txt",
        "skills/lit-docx/SKILL.md", "skills/lit-docx/NOTICE", "skills/lit-docx/scripts/convert_md_to_docx.py", "skills/lit-docx/scripts/qa_docx.py",
        "skills/lit-docx/templates/docx/korean-generic.docx", "lib/office-runtime.mjs", "lib/office-runtime-lock/requirements.lock", "lib/ooxml_integrity.py", "lib/render_pages.py", "lib/office_data.py"]) {
        assertFile(join(pluginPath, file), `office ${file}`);
      }
      const installedTemplates = spawnSync(process.execPath, [join(pluginPath, "skills", "lit-pptx", "scripts", "compile-deck.js"), "--list-templates"], { cwd: home, encoding: "utf8" });
      assert.equal(installedTemplates.status, 0, installedTemplates.stderr);
      assert.match(installedTemplates.stdout, /^AZURE-PRO /mu);
      const installedOfficeStatus = spawnSync(process.execPath, [join(pluginPath, "lib", "office-runtime.mjs"), "status", "--json"], { cwd: home, encoding: "utf8", env: { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, ".cache"), LITCLAUDE_OFFICE_RUNTIME: "" } });
      assert.equal(installedOfficeStatus.status, 0, installedOfficeStatus.stderr);
      assert.equal(JSON.parse(installedOfficeStatus.stdout).root, join(home, ".cache", "litclaude", "office-runtime"));
      assertFile(join(pluginPath, "bin", "litclaude-hud.js"), "HUD bin");
      assertFile(join(pluginPath, "lib", "litgoal", "paths.mjs"), "litgoal paths runtime");
      assertFile(join(pluginPath, "lib", "litgoal", "state.mjs"), "litgoal state runtime");
      assertFile(join(pluginPath, "lib", "litgoal", "ledger.mjs"), "litgoal ledger runtime");
      assertFile(join(pluginPath, "lib", "litgoal", "cli.mjs"), "litgoal CLI runtime");

      for (const excluded of [".omc", "evidence", "test"]) {
        assert.equal(
          existsSync(join(pluginPath, excluded)),
          false,
          `${excluded} should not be copied into the registered plugin root`,
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("restores only LitClaude-managed statusLine on uninstall", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      mkdirSync(claudeHome, { recursive: true });
      writeFileSync(
        join(claudeHome, "settings.json"),
        `${JSON.stringify({
          statusLine: { type: "command", command: "bash \"$HOME/custom-hud.sh\"" },
          keepMe: true,
        })}\n`,
      );

      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const installedSettings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.match(installedSettings.statusLine.command, /litclaude-hud\.js/u);
      assert.equal(installedSettings.litclaude.previousStatusLine.command, "bash \"$HOME/custom-hud.sh\"");

      const uninstall = runCli(["uninstall"], home, claudeHome);
      assert.equal(uninstall.status, 0, uninstall.stderr);

      const restoredSettings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(restoredSettings.keepMe, true);
      assert.equal(restoredSettings.statusLine.command, "bash \"$HOME/custom-hud.sh\"");
      assert.equal(restoredSettings.litclaude, undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("retracts only its own permission rules on uninstall", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      mkdirSync(claudeHome, { recursive: true });
      writeFileSync(
        join(claudeHome, "settings.json"),
        `${JSON.stringify({
          permissions: {
            defaultMode: "ask",
            auditTag: "keep",
            allow: ["Read", "Bash(my-tool:*)"],
            deny: ["Bash(rm -rf:*)", "Bash(curl:*)"],
          },
        })}\n`,
      );

      const install = runCli(["install", "--permission-mode", "balanced"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const installed = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.ok(installed.permissions.allow.includes("Bash(git status:*)"), "balanced mode should broaden allow");
      assert.ok(installed.permissions.deny.includes("Bash(rm -rf:*)"), "every mode keeps the dangerous-shell deny set");
      assert.ok(installed.permissions.allow.includes("Bash(my-tool:*)"), "user-authored allow must survive install");

      const uninstall = runCli(["uninstall"], home, claudeHome);
      assert.equal(uninstall.status, 0, uninstall.stderr);

      // Leaving our rules behind would keep broadening permissions after the user removed the thing that
      // asked for them; removing theirs would be destroying user configuration. Only ours may go.
      const after = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.deepEqual(after.permissions.allow, ["Read", "Bash(my-tool:*)"]);
      assert.deepEqual(after.permissions.deny, ["Bash(rm -rf:*)", "Bash(curl:*)"]);
      assert.equal(after.permissions.defaultMode, "ask");
      assert.equal(after.permissions.auditTag, "keep");
      assert.equal(after.litclaude, undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor rejects removed owned allow and deny rules while preserving foreign rules", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const settingsPath = join(claudeHome, "settings.json");
      writeFileSync(settingsPath, `${JSON.stringify({
        permissions: {
          allow: ["Bash(my-tool:*)"],
          deny: ["Bash(curl:*)"],
        },
      })}\n`);
      const install = runCli(["install", "--permission-mode", "balanced"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const removedAllow = settings.litclaude.permissionRulesWritten.allow[0];
      const removedDeny = settings.litclaude.permissionRulesWritten.deny[0];
      settings.permissions.allow = settings.permissions.allow.filter((rule) => rule !== removedAllow);
      settings.permissions.deny = settings.permissions.deny.filter((rule) => rule !== removedDeny);
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, { PATH: "" });
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /PERMISSION_INTEGRITY_FAIL/u);
      assert.match(doctor.stderr, new RegExp(removedAllow.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.match(doctor.stderr, new RegExp(removedDeny.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.doesNotMatch(doctor.stdout, /DOCTOR_PASS/u);

      const after = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.ok(after.permissions.allow.includes("Bash(my-tool:*)"));
      assert.ok(after.permissions.deny.includes("Bash(curl:*)"));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor rejects malformed permission ownership metadata and mode/profile drift", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const install = runCli(["install", "--permission-mode", "balanced"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);
      const settingsPath = join(claudeHome, "settings.json");
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      settings.litclaude.permissionRulesWritten = { allow: "not-an-array", deny: [] };
      settings.litclaude.permissionPreference.mode = "yolo";
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, { PATH: "" });
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /PERMISSION_INTEGRITY_FAIL/u);
      assert.match(doctor.stderr, /permissionRulesWritten\.allow/iu);
      assert.match(doctor.stderr, /permissionPreference/iu);
      assert.doesNotMatch(doctor.stdout, /DOCTOR_PASS/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("preserves yolo collisions and cleans inserted permissions even when HUD ownership is absent", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      mkdirSync(claudeHome, { recursive: true });
      const settingsPath = join(claudeHome, "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify({
          statusLine: { type: "command", command: "node /tmp/user-hud.js" },
          permissions: {
            defaultMode: "plan",
            allow: ["Edit", "Bash(git:*)"],
            deny: ["Bash(sudo:*)"],
          },
        })}\n`,
      );

      const install = runCli(["install", "--permission-mode", "yolo"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);
      const installed = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.deepEqual(installed.litclaude.permissionRulesWritten.allow.includes("Edit"), false);
      assert.deepEqual(installed.litclaude.permissionRulesWritten.allow.includes("Bash(git:*)"), false);
      assert.deepEqual(installed.litclaude.permissionRulesWritten.deny.includes("Bash(sudo:*)"), false);

      installed.statusLine = { type: "command", command: "node /tmp/user-hud.js" };
      installed.litclaude.statusLineManaged = false;
      writeFileSync(settingsPath, `${JSON.stringify(installed, null, 2)}\n`);

      const uninstall = runCli(["uninstall"], home, claudeHome);
      assert.equal(uninstall.status, 0, uninstall.stderr);
      const after = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.deepEqual(after.permissions, {
        defaultMode: "plan",
        allow: ["Edit", "Bash(git:*)"],
        deny: ["Bash(sudo:*)"],
      });
      assert.equal(after.statusLine.command, "node /tmp/user-hud.js");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("preserves a user-changed statusLine on uninstall", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const settingsPath = join(claudeHome, "settings.json");
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      settings.statusLine = { type: "command", command: "node /tmp/user-hud.js" };
      settings.litclaude.extraFutureKey = "keep";
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

      const uninstall = runCli(["uninstall"], home, claudeHome);
      assert.equal(uninstall.status, 0, uninstall.stderr);
      assert.match(uninstall.stdout, /HUD_WARNING: statusLine changed by user/u);

      const restoredSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.equal(restoredSettings.statusLine.command, "node /tmp/user-hud.js");
      assert.equal(restoredSettings.litclaude.extraFutureKey, "keep");
      assert.equal(restoredSettings.litclaude.statusLineManaged, undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor validates the installed plugin with Claude when Claude is available", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const fakeBin = join(home, "fake-bin");
      const logPath = join(home, "claude-args.log");
      const fakeClaude = join(fakeBin, "claude");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        fakeClaude,
        `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${logPath}'\nif [ "$1" = "--version" ]; then echo 'Claude Code 2.1.158'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "validate" ]; then echo 'Validation passed'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "details" ] && [ "$3" = "litclaude@litclaude-ai" ]; then echo 'LitClaude (litclaude) ${version}'; echo 'Component inventory'; echo 'Skills (${canonicalSkillIds.length}) ${canonicalSkillsInventory}'; echo 'Agents (11) lit-planner, lit-executor'; echo 'Hooks (5)'; exit 0; fi\necho 'unexpected claude args' >&2\nexit 2\n`,
      );
      chmodSync(fakeClaude, 0o755);

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, {
        PATH: `${fakeBin}:${process.env.PATH}`,
      });

      assert.equal(doctor.status, 0, doctor.stderr);
      assert.match(doctor.stdout, /PERMISSION_SETTINGS_SCOPE: global Claude settings permissions\.allow\/deny/u);
      assert.match(doctor.stdout, /PERMISSION_OWNERSHIP: preserves pre-existing entries; removes only LitClaude-inserted entries/u);
      assert.match(doctor.stdout, /CLAUDE_VERSION: Claude Code 2\.1\.158/u);
      assert.match(doctor.stdout, /CLAUDE_PLUGIN_VALIDATE_PASS/u);
      assert.match(doctor.stdout, /CLAUDE_PLUGIN_DETAILS_PASS/u);
      assert.match(doctor.stdout, /SCIENTIFIC_VISUALIZATION_(?:RUNTIME_PASS|DEGRADED)/u);
      assert.match(doctor.stdout, /BUNDLED_SKILLS_PAYLOAD_PASS/u);
      assert.match(doctor.stdout, /DOCTOR_PASS/u);

      const log = readFileSync(logPath, "utf8");
      assert.match(log, /^--version$/m);
      assert.match(
        log,
        new RegExp(`^plugin validate .+plugins/cache/litclaude-ai/litclaude/${version.replaceAll(".", "\\.")}$`, "m"),
      );
      assert.match(log, /^plugin details litclaude@litclaude-ai$/m);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor rejects a hash-tampered installed bundled skill", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);
      const pluginPath = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", version);
      writeFileSync(join(pluginPath, "vendor", "handoff", "SKILL.md"), "tampered\n");

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, { PATH: "" });
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /BUNDLED_SKILLS_INTEGRITY_FAIL/u);
      assert.match(doctor.stderr, /hashMismatches/u);
      assert.match(doctor.stderr, /LitClaude bundled-skills payload is incomplete or hash-invalid/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor rejects plugin details that omit either bundled skill enrollment", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const fakeBin = join(home, "fake-bin");
      const fakeClaude = join(fakeBin, "claude");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        fakeClaude,
        `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 'Claude Code 2.1.158'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "validate" ]; then exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "details" ]; then echo 'LitClaude (litclaude) ${version}'; echo 'Skills (${canonicalSkillIds.length - 1}) ${canonicalSkillIds.filter((skillId) => skillId !== "lit-scientific-visualization").join(", ")}'; echo 'Commands (2) lit-scientific-visualization'; echo 'Agents (11) lit-planner'; exit 0; fi\nexit 2\n`,
      );
      chmodSync(fakeClaude, 0o755);

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, {
        PATH: `${fakeBin}:${process.env.PATH}`,
      });
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /expected canonical skills: lit-scientific-visualization/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor rejects stale Claude plugin details that hide the shipped agent inventory", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const fakeBin = join(home, "fake-bin");
      const fakeClaude = join(fakeBin, "claude");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        fakeClaude,
        `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 'Claude Code 2.1.158'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "validate" ]; then echo 'Validation passed'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "details" ] && [ "$3" = "litclaude@litclaude-ai" ]; then echo 'LitClaude (litclaude) 0.3.23'; echo 'Component inventory'; echo 'Skills (7) lit-loop, lit-plan'; echo 'Agents (0)'; echo 'Hooks (5)'; exit 0; fi\nexit 2\n`,
      );
      chmodSync(fakeClaude, 0o755);

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, {
        PATH: `${fakeBin}:${process.env.PATH}`,
      });

      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /Claude plugin details did not show current LitClaude agent inventory/u);
      assert.match(doctor.stderr, /expected version 1\.0\.15/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("doctor separates LitClaude LSP config from external installed LSP plugin binary errors", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const registryPath = join(claudeHome, "plugins", "installed_plugins.json");
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      registry.plugins["rust-analyzer-lsp@claude-plugins-official"] = [
        {
          scope: "user",
          installPath: join(claudeHome, "plugins", "cache", "claude-plugins-official", "rust-analyzer-lsp", "1.0.0"),
          version: "1.0.0",
        },
      ];
      registry.plugins["pyright-lsp@claude-plugins-official"] = [
        {
          scope: "user",
          installPath: join(claudeHome, "plugins", "cache", "claude-plugins-official", "pyright-lsp", "1.0.0"),
          version: "1.0.0",
        },
      ];
      registry.plugins["gopls-lsp@claude-plugins-official"] = [
        {
          scope: "user",
          installPath: join(claudeHome, "plugins", "cache", "claude-plugins-official", "gopls-lsp", "1.0.0"),
          version: "1.0.0",
        },
      ];
      writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

      const fakeBin = join(home, "fake-bin");
      const fakeClaude = join(fakeBin, "claude");
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        fakeClaude,
        `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo 'Claude Code 2.1.158'; exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "validate" ]; then exit 0; fi\nif [ "$1" = "plugin" ] && [ "$2" = "details" ]; then echo 'LitClaude (litclaude) ${version}'; echo 'Component inventory'; echo 'Skills (${canonicalSkillIds.length}) ${canonicalSkillsInventory}'; echo 'Agents (11) lit-planner, lit-executor'; echo 'Hooks (5)'; exit 0; fi\nexit 2\n`,
      );
      chmodSync(fakeClaude, 0o755);

      const doctor = runCliWithEnv(["doctor"], home, claudeHome, {
        PATH: `${fakeBin}:/usr/bin:/bin`,
      });

      assert.equal(doctor.status, 0, doctor.stderr);
      assert.match(doctor.stdout, /LITCLAUDE_LSP_SERVERS: typescript/u);
      assert.match(doctor.stdout, /EXTERNAL_LSP_WARNING: rust-analyzer-lsp@claude-plugins-official requires rust-analyzer/u);
      assert.match(doctor.stdout, /EXTERNAL_LSP_WARNING: pyright-lsp@claude-plugins-official requires pyright-langserver/u);
      assert.match(doctor.stdout, /EXTERNAL_LSP_WARNING: gopls-lsp@claude-plugins-official requires gopls/u);
      assert.match(doctor.stdout, /These warnings are not emitted by LitClaude's \.lsp\.json/u);
      assert.match(doctor.stdout, /DOCTOR_PASS/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("path, run, update, and uninstall manage only LitClaude install state", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const install = runCli(["install"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);

      const pathResult = runCli(["path"], home, claudeHome);
      assert.equal(pathResult.status, 0, pathResult.stderr);
      assert.equal(
        realpathSync(pathResult.stdout.trim().split("\n").at(-1)),
        realpathSync(join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", version)),
      );

      const fakeBin = join(home, "fake-bin");
      const logPath = join(home, "claude-run.log");
      mkdirSync(fakeBin, { recursive: true });
      const fakeClaude = join(fakeBin, "claude");
      writeFileSync(fakeClaude, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > '${logPath}'\nexit 0\n`);
      chmodSync(fakeClaude, 0o755);

      const run = runCliWithEnv(["run", "--", "--help"], home, claudeHome, {
        PATH: `${fakeBin}:${process.env.PATH}`,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(readFileSync(logPath, "utf8").trim(), "--help");

      const update = runCli(["update"], home, claudeHome);
      assert.equal(update.status, 0, update.stderr);
      assert.match(update.stdout, /INSTALL_PASS/u);

      const unrelatedDir = join(home, "unrelated");
      const unrelatedFile = join(unrelatedDir, "keep.txt");
      mkdirSync(unrelatedDir, { recursive: true });
      writeFileSync(unrelatedFile, "keep");

      const dryUninstall = runCli(["--dry-run", "uninstall"], home, claudeHome);
      assert.equal(dryUninstall.status, 0, dryUninstall.stderr);
      assert.equal(existsSync(join(claudeHome, "plugins", "installed_plugins.json")), true, "dry-run uninstall must keep Claude registry");
      assert.equal(existsSync(unrelatedFile), true, "dry-run uninstall must keep unrelated files");

      const uninstall = runCli(["uninstall"], home, claudeHome);
      assert.equal(uninstall.status, 0, uninstall.stderr);
      assert.equal(existsSync(join(home, "current")), false);
      assert.equal(existsSync(join(home, "litclaude-ai")), false);
      assert.equal(existsSync(join(claudeHome, "plugins", "cache", "litclaude-ai")), false);
      const registry = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
      assert.equal(registry.plugins["litclaude@litclaude-ai"], undefined);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.enabledPlugins["litclaude@litclaude-ai"], undefined);
      assert.equal(settings.extraKnownMarketplaces["litclaude-ai"], undefined);
      const knownMarketplaces = JSON.parse(readFileSync(join(claudeHome, "plugins", "known_marketplaces.json"), "utf8"));
      assert.equal(knownMarketplaces["litclaude-ai"], undefined);
      assert.equal(existsSync(unrelatedFile), true, "uninstall must not delete unrelated files");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});


describe("design-production installed resources", () => {
  it("installs and executes README helpers and refuses tampered nested assets", () => {
    const home = realpathSync(makeHome());
    const claudeHome = realpathSync(makeClaudeHome());
    try {
      const install = runCli(["install", "--yes"], home, claudeHome);
      assert.equal(install.status, 0, install.stderr);
      const plugin = join(claudeHome, "plugins/cache/litclaude-ai/litclaude", version);
      const helper = join(plugin, "skills/readme-studio/scripts/validate-readme-facts.mjs");
      assertFile(helper, "README facts checker");
      writeFileSync(join(home, "package.json"), '{"name":"fixture"}');
      const facts = join(home, "facts.json");
      writeFileSync(facts, JSON.stringify({ claims: [{ id: "package", value: "deliberately false", source: "package.json" }], badges: [] }));
      const checked = spawnSync(process.execPath, [helper, "--project-root", home, "--facts", facts], { encoding: "utf8", cwd: home });
      assert.equal(checked.status, 0, checked.stderr);
      const report = JSON.parse(checked.stdout);
      assert.equal(report.validation_scope, "structure-only");
      assert.equal(report.source_contents_compared, false);
      assert.equal(report.badge_truth_checked, false);
      const template = join(plugin, "skills/readme-studio/templates/hyperframes-cover/index.motion.json");
      assertFile(template, "installed motion sidecar");
      writeFileSync(template, '{}');
      const doctor = runCliWithEnv(["doctor"], home, claudeHome, { PATH: "" });
      assert.notEqual(doctor.status, 0);
      assert.match(doctor.stderr, /SKILL_RESOURCE_INTEGRITY_FAIL/u);
      assert.match(doctor.stderr, /readme-studio.*index\.motion\.json/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});
