import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { banner } from "../bin/litfamily-banner.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageSpec = new URL("..", import.meta.url).href;
const binPath = join(root, "bin", "litclaude-ai.js");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const lastOutputLine = (stdout) => stdout.trim().split("\n").at(-1);

const makeHome = () => mkdtempSync(join(tmpdir(), "litclaude-cli-test-"));
const makeClaudeHome = () => mkdtempSync(join(tmpdir(), "litclaude-claude-home-test-"));
const makeClaudeConfigDir = () => mkdtempSync(join(tmpdir(), "litclaude-claude-config-test-"));

const runCli = (args, home, claudeHome = join(home, ".claude")) =>
  spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: "utf8",
			env: {
			...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
			LITCLAUDE_HOME: home,
			CLAUDE_HOME: claudeHome,
			CLAUDE_CONFIG_DIR: claudeHome,
			CLAUDE_CODE_DISABLE_WORKFLOWS: "0",
			CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0",
			CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "16",
		},
  });

const runCliWithEnv = (args, env) => {
  const childEnv = { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color", ...env };
  if (!Object.hasOwn(env, "NO_COLOR")) delete childEnv.NO_COLOR;
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
};

const runCliAsTty = (args, env) => {
  const childEnv = { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color", ...env };
  if (!Object.hasOwn(env, "NO_COLOR")) delete childEnv.NO_COLOR;
  for (const name of ["CI", "NO_UPDATE_NOTIFIER", "LITCLAUDE_NO_UPDATE_CHECK"]) delete childEnv[name];
  const source = `
    import { pathToFileURL } from "node:url";
    const [binPath, ...args] = process.argv.slice(1);
    for (const stream of [process.stdin, process.stdout, process.stderr])
      Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
    process.argv = [process.execPath, binPath, ...args];
    await import(pathToFileURL(binPath).href);
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source, binPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
};

describe("litclaude-ai CLI", () => {
  it("exposes both package and friendly command aliases", () => {
    assert.deepEqual(packageJson.bin, {
      "litclaude-ai": "bin/litclaude-ai.js",
      litclaude: "bin/litclaude-ai.js",
    });
  });

  it("runs the packaged executable from a fresh npm prefix without a checkout shim", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    const prefix = mkdtempSync(join(tmpdir(), "litclaude-npm-prefix-test-"));

    try {
      const result = spawnSync(
        "npm",
        ["exec", "--prefix", prefix, "--yes", "--package", packageSpec, "--", "litclaude", "--version"],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color", LITCLAUDE_HOME: home, CLAUDE_CONFIG_DIR: claudeHome },
        },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.startsWith(`${banner[0].trimEnd()}\n`), "Ignition B banner missing");
      assert.equal(lastOutputLine(result.stdout), packageJson.version);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it("prints the package version without requiring install state", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");
    assert.equal(packageJson.version, "1.0.21");

    for (const flag of ["--version", "-v"]) {
      const result = spawnSync(process.execPath, [binPath, flag], {
        env: { ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color" },
        cwd: root,
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.startsWith(`${banner[0].trimEnd()}\n`), "Ignition B banner missing");
      assert.equal(lastOutputLine(result.stdout), packageJson.version);
      assert.equal(result.stderr, "");
    }
  });

  it("states in CLI help that permission modes mutate global Claude settings with ownership-safe removal", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    try {
      const result = runCli([], home, claudeHome);
      assert.equal(result.status, 64);
      assert.match(result.stderr, /mutates global Claude settings permissions\.allow\/deny/iu);
      assert.match(result.stderr, /removes\s+only LitClaude-inserted entries/iu);
      assert.doesNotMatch(result.stderr, /Record a Claude-native LitClaude automation preference/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("exposes litgoal help with durable state subcommands without mutating state", () => {
    const home = makeHome();

    try {
      const result = runCli(["litgoal", "--help"], home);

      assert.equal(result.status, 0, result.stderr);
      for (const command of [
        "create-goals",
        "status",
        "criteria",
        "record-evidence",
        "checkpoint",
        "steer",
        "record-review-blockers",
      ]) {
        assert.match(result.stdout, new RegExp(`\\b${command}\\b`, "u"), `help should list ${command}`);
      }
      assert.equal(existsSync(join(root, ".litclaude", "litgoal")), false, "help must not create checkout state");
      assert.deepEqual(readdirSync(home), [], "help must not create home state");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports dynamic workflow readiness as a package diagnostic", () => {
    const home = makeHome();

    try {
      const result = runCli(["workflow-check", "--json"], home);

      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.status, "pass");
    assert.equal(report.version, "1.0.21");
      assert.equal(report.checks.goalGuidance, true);
			assert.equal(report.checks.hostWorkflowsEnabled, true);
			assert.equal(report.checks.backgroundTasksEnabled, true);
			assert.equal(report.checks.toolConcurrencyAboveOne, true);
			assert.equal(report.capabilities.toolConcurrency.limit, 16);
      assert.equal(report.checks.dynamicWorkflowGuidance, true);
      assert.equal(report.checks.subagentDelegation, true);
      assert.equal(report.checks.subagentReliability, true);
      assert.equal(report.checks.commandHookAgreement, true);
      assert.equal(report.checks.dynamicWorkflowCommand, true);
      assert.equal(report.checks.hookRoute, true);
      assert.equal(existsSync(join(root, ".litclaude", "litgoal")), false, "workflow-check must not create checkout state");
      assert.deepEqual(readdirSync(home), [], "workflow-check must not create home state");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

	it("fails workflow readiness when host orchestration is disabled or effectively serial", () => {
		const home = makeHome();
		try {
			const result = runCliWithEnv(["workflow-check", "--json"], {
				LITCLAUDE_HOME: home,
				CLAUDE_HOME: join(home, ".claude"),
				CLAUDE_CODE_DISABLE_WORKFLOWS: "1",
				CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
				CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "1",
			});
			assert.equal(result.status, 1, result.stderr);
			const report = JSON.parse(result.stdout);
			assert.equal(report.status, "fail");
			assert.equal(report.checks.hostWorkflowsEnabled, false);
			assert.equal(report.checks.backgroundTasksEnabled, false);
			assert.equal(report.checks.toolConcurrencyAboveOne, false);
			assert.equal(report.capabilities.toolConcurrency.limit, 1);
			assert.deepEqual(
				report.missing.filter((item) => ["hostWorkflowsEnabled", "backgroundTasksEnabled", "toolConcurrencyAboveOne"].includes(item)),
				["hostWorkflowsEnabled", "backgroundTasksEnabled", "toolConcurrencyAboveOne"],
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("fails workflow readiness when Claude settings disable orchestration", () => {
		const home = makeHome();
		const claudeHome = join(home, ".claude");
		mkdirSync(claudeHome, { recursive: true });
		writeFileSync(
			join(claudeHome, "settings.json"),
			JSON.stringify({ disableWorkflows: true, enableWorkflows: false, disableAgentView: true }),
		);
		try {
			const result = runCliWithEnv(["workflow-check", "--json"], {
				LITCLAUDE_HOME: home,
				CLAUDE_HOME: claudeHome,
				CLAUDE_CONFIG_DIR: claudeHome,
				CLAUDE_CODE_DISABLE_WORKFLOWS: "0",
				CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0",
				CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "16",
			});
			assert.equal(result.status, 1, result.stderr);
			const report = JSON.parse(result.stdout);
			assert.equal(report.checks.hostSettingsReadable, true);
			assert.equal(report.checks.hostWorkflowsEnabled, false);
			assert.equal(report.checks.backgroundTasksEnabled, false);
			assert.deepEqual(report.capabilities.hostSettings.gates, ["disableWorkflows", "enableWorkflows", "disableAgentView"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("fails closed when a Claude settings file is malformed", () => {
		const home = makeHome();
		const claudeHome = join(home, ".claude");
		mkdirSync(claudeHome, { recursive: true });
		writeFileSync(join(claudeHome, "settings.json"), "{broken");
		try {
			const result = runCliWithEnv(["workflow-check", "--json"], {
				LITCLAUDE_HOME: home,
				CLAUDE_HOME: claudeHome,
				CLAUDE_CONFIG_DIR: claudeHome,
				CLAUDE_CODE_DISABLE_WORKFLOWS: "0",
				CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0",
				CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "16",
			});
			assert.equal(result.status, 1, result.stderr);
			const report = JSON.parse(result.stdout);
			assert.equal(report.checks.hostSettingsReadable, false);
			assert.equal(report.capabilities.hostSettings.reason, "malformed-json");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("fails workflow readiness when an enterprise managed-policy fragment disables workflows", () => {
		const home = makeHome();
		const managedRoot = join(home, "managed-policy");
		const managedDirectory = join(managedRoot, "managed-settings.d");
		mkdirSync(managedDirectory, { recursive: true });
		writeFileSync(join(managedDirectory, "20-workflows.json"), JSON.stringify({ disableWorkflows: true }));
		try {
			const result = runCliWithEnv(["workflow-check", "--json"], {
				LITCLAUDE_HOME: home,
				CLAUDE_HOME: join(home, ".claude"),
				CLAUDE_CONFIG_DIR: join(home, ".claude"),
				LITCLAUDE_TEST_MANAGED_SETTINGS_ROOT: managedRoot,
				CLAUDE_CODE_DISABLE_WORKFLOWS: "0",
				CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0",
				CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: "16",
			});
			assert.equal(result.status, 1, result.stderr);
			const report = JSON.parse(result.stdout);
			assert.equal(report.checks.hostWorkflowsEnabled, false);
			assert.deepEqual(report.capabilities.hostSettings.gates, ["disableWorkflows"]);
			assert.match(report.capabilities.hostSettings.sources[0], /managed-settings\.d\/20-workflows\.json$/u);
			assert.equal(report.capabilities.hostSettings.remoteOrganizationPolicy, "not-locally-observable");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

  it("exposes public-read as a JSON CLI with SSRF-safe blocked output", () => {
    const home = makeHome();

    try {
      const result = runCli(["public-read", "http://127.0.0.1/private", "--json"], home);

      assert.equal(result.status, 2);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.status, "blocked");
      assert.equal(report.stopReason, "private-address");
      assert.equal(report.contentText, "");
      assert.equal(report.fetchVerdict.status, "blocked");
      assert.equal(report.claimGraph.sources[0].verdict, "blocked");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps CLI private targets blocked when the legacy environment sentinel is set", () => {
    const home = makeHome();

    try {
      const result = runCliWithEnv(["public-read", "http://127.0.0.1/private", "--json"], {
        LITCLAUDE_HOME: home,
        CLAUDE_HOME: join(home, ".claude"),
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        LITCLAUDE_PUBLIC_READ_ALLOW_PRIVATE: "1",
      });

      assert.equal(result.status, 2);
      const report = JSON.parse(result.stdout);
      assert.equal(report.status, "blocked");
      assert.equal(report.stopReason, "private-address");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects malformed public-read input without a stack trace", () => {
    const home = makeHome();

    try {
      const result = runCli(["public-read", "https://", "--json"], home);

      assert.equal(result.status, 64);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.status, "invalid-input");
      assert.equal(report.stopReason, "invalid-url");
      assert.doesNotMatch(result.stdout, /TypeError|at .*litclaude-ai/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects credential-bearing public-read URLs without echoing secrets", () => {
    const home = makeHome();

    try {
      const result = runCli(["public-read", "https://user:secret@example.com/private", "--json"], home);

      assert.equal(result.status, 64);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.status, "invalid-input");
      assert.equal(report.stopReason, "credentials-in-url");
      assert.doesNotMatch(result.stdout, /secret/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects malformed litgoal evidence input with a controlled error", () => {
    const home = makeHome();

    try {
      const result = runCli(["litgoal", "record-evidence", "--json", "{bad"], home);

      assert.equal(result.status, 64);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.status, "error");
      assert.equal(report.command, "record-evidence");
      assert.equal(report.error.message, "invalid litgoal JSON");
      assert.equal(report.error.exitCode, 64);
      assert.doesNotMatch(result.stdout, /at .*litclaude-ai|\{bad/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-runs install as a self-contained file operation without writing", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["--dry-run", "install"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /DRY_RUN/u);
      assert.match(result.stdout, /install LitClaude/i);
      assert.match(result.stdout, /Would register Claude plugin/u);
      assert.match(result.stdout, /Launch with: claude$/mu);
      assert.doesNotMatch(result.stdout, /claude --plugin-dir/u);
      assert.doesNotMatch(result.stdout, /\bbunx\b/u);
      assert.deepEqual(readdirSync(home), [], "dry-run must not create install files");
      assert.deepEqual(readdirSync(claudeHome), [], "dry-run must not create Claude plugin files");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("dry-runs the global Claude permission mutation without writing Claude settings", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["--dry-run", "install", "--permission-mode", "balanced"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Would mutate global Claude settings permissions\.allow\/deny: balanced \(explicit\)/u);
      assert.match(result.stdout, /adds bounded routine allow rules and dangerous-shell denies/u);
      assert.match(result.stdout, /removes only LitClaude-inserted entries/iu);
      assert.deepEqual(readdirSync(home), [], "dry-run must not create install files");
      assert.deepEqual(readdirSync(claudeHome), [], "dry-run must not create Claude plugin files");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("reports host-owned model selection in the install dry-run receipt", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["--dry-run", "install"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /Model selection: host-owned \(Claude Code exposes no native route surface\)/u,
      );
      assert.deepEqual(readdirSync(home), [], "dry-run must not create install files");
      assert.deepEqual(readdirSync(claudeHome), [], "dry-run must not create Claude plugin files");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("rejects malformed installer permission modes without a stack trace", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["install", "--permission-mode", "root"], home, claudeHome);

      assert.equal(result.status, 64);
      assert.match(result.stderr, /--permission-mode must be one of safe, balanced, yolo/u);
      assert.doesNotMatch(result.stderr, /at .*litclaude-ai/u);
      assert.deepEqual(readdirSync(home), [], "invalid permission mode must not create install files");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("installs LitClaude into Claude's user plugin registry", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["install"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /INSTALL_PASS/u);
      assert.match(result.stdout, /Claude plugin: litclaude@litclaude-ai/u);
      assert.match(result.stdout, /Launch with: claude$/mu);
      assert.doesNotMatch(result.stdout, /--plugin-dir/u);

      const installRoot = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", packageJson.version);
      const manifest = join(installRoot, ".claude-plugin", "plugin.json");
      assert.equal(existsSync(manifest), true, "Claude cache must contain plugin manifest");

      const registry = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
      const [entry] = registry.plugins["litclaude@litclaude-ai"];
      assert.equal(entry.scope, "user");
      assert.equal(entry.version, packageJson.version);
      assert.equal(realpathSync(entry.installPath), realpathSync(installRoot));
      assert.equal(entry.installedBy, "litclaude-ai");
      assert.equal(entry.enabled, true);

      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.enabledPlugins["litclaude@litclaude-ai"], true);
      assert.equal(settings.litclaude.permissionMode, "safe");
      assert.equal(settings.litclaude.permissionPreference.dangerousShellDenyPreserved, true);
      assert.equal(
        settings.extraKnownMarketplaces["litclaude-ai"].source.path,
        join(home, "marketplaces", "litclaude-ai"),
      );

      const knownMarketplaces = JSON.parse(readFileSync(join(claudeHome, "plugins", "known_marketplaces.json"), "utf8"));
      assert.equal(knownMarketplaces["litclaude-ai"].source.source, "directory");
      assert.equal(knownMarketplaces["litclaude-ai"].installLocation, join(home, "marketplaces", "litclaude-ai"));
      assert.equal(
        existsSync(join(home, "marketplaces", "litclaude-ai", ".claude-plugin", "marketplace.json")),
        true,
        "install must create a persistent local marketplace for Claude component discovery",
      );
      const marketplace = JSON.parse(
        readFileSync(join(home, "marketplaces", "litclaude-ai", ".claude-plugin", "marketplace.json"), "utf8"),
      );
      const [plugin] = marketplace.plugins;
      assert.equal(marketplace.name, "litclaude-ai");
      assert.equal(plugin.name, "litclaude");
      assert.equal(plugin.displayName, "LitClaude");
      assert.equal(plugin.version, packageJson.version);
      assert.equal(plugin.description, "Claude Code-native workflow distribution.");
      assert.equal(plugin.homepage, "https://github.com/wjgoarxiv/litclaude");
      assert.doesNotMatch(JSON.stringify(marketplace), new RegExp(`${"Lazy"}${"Codex"}`, "iu"));
      assert.doesNotMatch(JSON.stringify(marketplace), new RegExp(["code-yeong","yu"].join(""), "iu"));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("mutates balanced global Claude permissions without weakening agent safeguards", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["install", "--permission-mode", "balanced"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Global Claude settings permissions\.allow\/deny: balanced/u);
      assert.match(result.stdout, /adds bounded routine allow rules and dangerous-shell denies/u);
      assert.match(result.stdout, /removes only LitClaude-inserted entries/iu);

      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.permissionMode, "balanced");
      assert.equal(settings.litclaude.permissionPreference.routineAutomation, true);
      assert.equal(settings.litclaude.permissionPreference.dangerousShellDenyPreserved, true);
      assert.match(settings.litclaude.permissionPreference.plannerSafeguard, /permissionMode: plan/u);

      const installRoot = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", packageJson.version);
      const planner = readFileSync(join(installRoot, "agents", "lit-planner.md"), "utf8");
      const executor = readFileSync(join(installRoot, "agents", "lit-executor.md"), "utf8");
      assert.match(planner, /permissionMode:\s*plan/u);
      assert.match(executor, /permissionMode:\s*acceptEdits/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("preserves installed permission mode and HUD accent on optionless reinstall while explicit choices override", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const first = runCliWithEnv(["install", "--permission-mode", "balanced"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_HUD_ACCENT: "rose",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(first.status, 0, first.stderr);

      const preview = runCliWithEnv(["--dry-run", "update"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_HUD_ACCENT: "",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(preview.status, 0, preview.stderr);
      assert.match(preview.stdout, /LITCLAUDE_HUD_ACCENT=rose/u);
      assert.match(preview.stdout, /Would mutate global Claude settings permissions\.allow\/deny: balanced \(preserved\)/u);

      const reinstall = runCliWithEnv(["update"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_HUD_ACCENT: "",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(reinstall.status, 0, reinstall.stderr);
      let settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.permissionMode, "balanced");
      assert.equal(settings.litclaude.hudAccent, "rose");
      assert.match(settings.statusLine.command, /LITCLAUDE_HUD_ACCENT=rose/u);

      const override = runCliWithEnv(["update", "--yolo"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_HUD_ACCENT: "gold",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(override.status, 0, override.stderr);
      settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.permissionMode, "yolo");
      assert.equal(settings.litclaude.hudAccent, "gold");
      assert.match(settings.statusLine.command, /LITCLAUDE_HUD_ACCENT=gold/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("shows a forced fancy spinner during install", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_SPINNER: "1",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /⠋/u);
      assert.match(result.stdout, /Installing LitClaude/u);
      assert.match(result.stdout, /Plugin payload/u);
      assert.match(result.stdout, /INSTALL_PASS/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("shows color-coded install progress and preview labels", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliAsTty(["install", "--yes"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_SPINNER: "1",
        LITCLAUDE_NO_AUTO_UPDATE: "1",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /╭─ PREPARING INSTALL/u);
      assert.match(result.stdout, /01 \/ 05  PLUGIN PAYLOAD/u);
      assert.match(result.stdout, /02 \/ 05  LOCAL MARKETPLACE/u);
      assert.match(result.stdout, /03 \/ 05  CLAUDE REGISTRY/u);
      assert.match(result.stdout, /04 \/ 05  COMPATIBILITY CACHE/u);
      assert.match(result.stdout, /05 \/ 05  INSTALL VERIFICATION/u);
      assert.match(result.stdout, /\x1b\[38;5;81m⠋\x1b\[0m/u);
      assert.match(result.stdout, /\x1b\[38;5;141mplugin\x1b\[0m/u);
      assert.match(result.stdout, /\x1b\[38;5;215mregistry\x1b\[0m/u);
      assert.match(result.stdout, /╭─ INSTALL RECEIPT/u);
      assert.match(result.stdout, /Status\s+Ready for Claude Code/u);
      assert.match(result.stdout, /Plugin\s+litclaude@litclaude-ai/u);
      assert.match(result.stdout, /Launch\s+claude/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("disables installer color while preserving the structured progress with NO_COLOR", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_SPINNER: "1",
        NO_COLOR: "1",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /╭─ PREPARING INSTALL/u);
      assert.match(result.stdout, /01 \/ 05  PLUGIN PAYLOAD/u);
      assert.match(result.stdout, /╭─ INSTALL RECEIPT/u);
      assert.doesNotMatch(result.stdout, /\x1b\[/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("refuses an unsafe home before stages and never reports success", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    const blockedClaudeHome = join(claudeHome, "not-a-directory");
    writeFileSync(blockedClaudeHome, "blocked\n");

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: blockedClaudeHome,
        LITCLAUDE_SPINNER: "1",
        NO_COLOR: "1",
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /INSTALL_OWNERSHIP_CONFLICT/u);
      assert.doesNotMatch(result.stdout, /INSTALL_PASS|INSTALL PLAN|PLUGIN PAYLOAD/u);
      assert.equal(readFileSync(blockedClaudeHome, "utf8"), "blocked\n");
      assert.deepEqual(readdirSync(home), []);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("previews and persists the selected HUD brand color during install", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = spawnSync(process.execPath, [binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "6\n",
        env: {
          ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_HUD_ACCENT_PROMPT: "1",
          LITCLAUDE_OUTPUT_STYLE_PROMPT: "0",
          LITCLAUDE_SPINNER: "0",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Choose LitClaude HUD brand color/u);
      const escapedVersion = packageJson.version.replaceAll(".", "\\.");
      assert.match(
        result.stdout,
        new RegExp(`\\[🔥LITCLAUDE v${escapedVersion}\\][\\s\\S]+ctx \\[▌░░\\][\\s\\S]+5h \\[▏░\\]`, "u"),
      );
      assert.doesNotMatch(result.stdout, /\x1b/u);
      assert.match(result.stdout, /HUD_COLOR_SELECTED: rose/u);

      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.hudAccent, "rose");
      assert.match(settings.statusLine.command, /LITCLAUDE_HUD_ACCENT=rose node ".+bin\/litclaude-hud\.js"/u);
      assert.equal(settings.statusLine.command, settings.litclaude.statusLineCommand);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("uses the shared light HUD preview policy without coloring essential metrics", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    const env = { ...process.env };
    delete env.NO_COLOR;
    delete env.CI;
    Object.assign(env, {
      LC_ALL: "C.UTF-8",
      TERM: "xterm-256color",
      LITCLAUDE_HOME: home,
      CLAUDE_CONFIG_DIR: claudeHome,
      LITCLAUDE_HUD_APPEARANCE: "light",
      LITCLAUDE_HUD_COLOR_DEPTH: "truecolor",
      LITCLAUDE_HUD_ACCENT_PROMPT: "1",
      LITCLAUDE_OUTPUT_STYLE_PROMPT: "0",
      LITCLAUDE_SPINNER: "0",
      LITCLAUDE_NO_AUTO_UPDATE: "1",
    });
    const ttySource = `
      import { pathToFileURL } from "node:url";
      const [binPath, ...args] = process.argv.slice(1);
      for (const stream of [process.stdin, process.stdout, process.stderr])
        Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
      process.argv = [process.execPath, binPath, ...args];
      await import(pathToFileURL(binPath).href);
    `;

    try {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", ttySource, binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "6\n",
        env,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /\x1b\[0m\x1b\[1m\[🔥LITCLAUDE v/u);
      assert.match(result.stdout, /\x1b\[0m \| O4\.8 │ ctx/u);
      assert.doesNotMatch(result.stdout, /\x1b\[38;2;[^\n]*O4\.8/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("lists HUD accent previews without ANSI when install output is piped", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = spawnSync(process.execPath, [binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "10\n",
        env: {
          ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_HUD_ACCENT_PROMPT: "1",
          LITCLAUDE_OUTPUT_STYLE_PROMPT: "0",
          LITCLAUDE_SPINNER: "0",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      for (const name of ["cyan", "blue", "teal", "green", "lavender", "rose", "gold", "orange", "slate", "gray"]) {
        const escapedVersion = packageJson.version.replaceAll(".", "\\.");
        assert.match(result.stdout, new RegExp(`${name}\\s+\\[🔥LITCLAUDE v${escapedVersion}\\]`, "u"));
      }
      assert.match(result.stdout, /ctx \[▌░░\]/u);
      assert.match(result.stdout, /5h \[▏░\]/u);
      assert.doesNotMatch(result.stdout, /\x1b/u);
      assert.match(result.stdout, /HUD_COLOR_SELECTED: gray/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("uses deterministic installer progress when CI disables animation", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        CI: "1",
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /INSTALL_STEP: Installing LitClaude/u);
      assert.match(result.stdout, /INSTALL_STEP: Plugin payload/u);
      assert.doesNotMatch(result.stdout, /⠋/u);
      assert.doesNotMatch(result.stdout, /\x1b\[/u);
      assert.match(result.stdout, /INSTALL_PASS/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("previews retained notifier state during dry-run uninstall", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["--dry-run", "uninstall"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.includes(join(home, "update-notifier")),
        "dry-run uninstall must disclose retained update notifier state",
      );
      assert.deepEqual(readdirSync(home), [], "dry-run uninstall must not create or remove product state");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("preserves unrelated Claude registry and settings keys on install and uninstall", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      mkdirSync(join(claudeHome, "plugins"), { recursive: true });
      writeFileSync(
        join(claudeHome, "plugins", "installed_plugins.json"),
        `${JSON.stringify({
          version: 2,
          plugins: {
            "other@market": [
              {
                scope: "user",
                installPath: "/tmp/other",
                version: "9.9.9",
              },
            ],
          },
          retainedTopLevel: { keep: true },
        })}\n`,
      );
      writeFileSync(
        join(claudeHome, "settings.json"),
        `${JSON.stringify({
          enabledPlugins: { "other@market": true },
          extraKnownMarketplaces: { keep: { source: { source: "github", repo: "owner/repo" } } },
        })}\n`,
      );

      const installResult = runCli(["install"], home, claudeHome);
      assert.equal(installResult.status, 0, installResult.stderr);

      const uninstallResult = runCli(["uninstall"], home, claudeHome);
      assert.equal(uninstallResult.status, 0, uninstallResult.stderr);

      const registry = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
      assert.equal(registry.retainedTopLevel.keep, true);
      assert.equal(registry.plugins["other@market"][0].version, "9.9.9");
      assert.equal(registry.plugins["litclaude@litclaude-ai"], undefined);

      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.enabledPlugins["other@market"], true);
      assert.equal(settings.extraKnownMarketplaces.keep.source.repo, "owner/repo");
      assert.equal(settings.enabledPlugins["litclaude@litclaude-ai"], undefined);
      assert.equal(settings.extraKnownMarketplaces["litclaude-ai"], undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("prefers CLAUDE_CONFIG_DIR over CLAUDE_HOME for Claude plugin state", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    const claudeConfigDir = makeClaudeConfigDir();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_HOME: claudeHome,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        existsSync(join(claudeConfigDir, "plugins", "cache", "litclaude-ai", "litclaude", packageJson.version)),
        true,
        "CLAUDE_CONFIG_DIR should receive plugin cache",
      );
      assert.equal(
        existsSync(join(claudeHome, "plugins", "cache", "litclaude-ai")),
        false,
        "CLAUDE_HOME should be ignored when CLAUDE_CONFIG_DIR is set",
      );
      const settings = JSON.parse(readFileSync(join(claudeConfigDir, "settings.json"), "utf8"));
      assert.equal(settings.enabledPlugins["litclaude@litclaude-ai"], true);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
      rmSync(claudeConfigDir, { recursive: true, force: true });
    }
  });

  it("reports missing install state for path and doctor commands", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");
    const home = makeHome();

    try {
      const pathResult = runCli(["path"], home);
      assert.notEqual(pathResult.status, 0);
      assert.match(pathResult.stderr, /litclaude install/u);

      const doctorResult = runCli(["doctor"], home);
      assert.notEqual(doctorResult.status, 0);
      assert.match(doctorResult.stderr, /litclaude install/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails doctor when an isolated install is missing a canonical skill payload", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const installResult = runCli(["install"], home, claudeHome);
      assert.equal(installResult.status, 0, installResult.stderr);

      const installRoot = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", packageJson.version);
      rmSync(join(installRoot, "skills", "debugging", "SKILL.md"));

      const doctorResult = runCli(["doctor"], home, claudeHome);
      assert.notEqual(doctorResult.status, 0);
      assert.match(doctorResult.stderr, /DOCTOR_FAIL: LitClaude install is missing skills\/debugging\/SKILL\.md/u);
      assert.doesNotMatch(doctorResult.stdout, /DOCTOR_PASS/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("does not notify or mutate notifier state when doctor fails", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();
    const notifierDir = join(home, "update-notifier");
    const cachePath = join(notifierDir, "latest.json");
    const cache = `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "9.9.9",
      checkedAt: "2026-07-20T00:00:00.000Z",
      attemptedAt: "2026-07-20T00:00:00.000Z",
      generation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })}\n`;

    try {
      mkdirSync(notifierDir, { recursive: true });
      writeFileSync(cachePath, cache);
      const notifierMtime = statSync(notifierDir, { bigint: true }).mtimeNs;

      const result = runCliAsTty(["doctor"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /litclaude install/u);
      assert.equal(readFileSync(cachePath, "utf8"), cache);
      assert.deepEqual(readdirSync(notifierDir), ["latest.json"]);
      assert.equal(statSync(notifierDir, { bigint: true }).mtimeNs, notifierMtime);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /LitClaude update available/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("dry-runs doctor without requiring an installed plugin", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCli(["--dry-run", "doctor"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /DRY_RUN/u);
      assert.match(result.stdout, /doctor LitClaude/i);
      assert.match(result.stdout, /claude plugin validate/u);
      assert.doesNotMatch(result.stdout, /\bbunx\b/u);
      assert.deepEqual(readdirSync(home), [], "dry-run must not create install files");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("dry-runs run as normal claude after global plugin install", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const installResult = runCli(["install"], home, claudeHome);
      assert.equal(installResult.status, 0, installResult.stderr);

      const result = runCli(["--dry-run", "run", "--", "--help"], home, claudeHome);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(lastOutputLine(result.stdout), "claude --help");
      assert.doesNotMatch(result.stdout, /--plugin-dir/u);
      assert.match(result.stdout, /--help/u);
      assert.doesNotMatch(result.stdout, /\bbunx\b/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("rejects an empty command", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");

    const result = spawnSync(process.execPath, [binPath], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 64);
    assert.match(result.stderr, /Usage: litclaude-ai/u);
  });

  it("rejects an unknown command without delegating to an external runner", () => {
    assert.equal(existsSync(binPath), true, "litclaude-ai bin must exist");

    const result = spawnSync(process.execPath, [binPath, "nope"], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 64);
    assert.match(result.stderr, /Unknown command: nope/u);
    assert.doesNotMatch(result.stderr, /\bbunx\b/u);
  });

  it("output style prompt shows menu with 0-4 options and defaults to current choice", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = spawnSync(process.execPath, [binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "\n",
        env: {
          ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_HUD_ACCENT_PROMPT: "0",
          LITCLAUDE_OUTPUT_STYLE_PROMPT: "1",
          LITCLAUDE_SPINNER: "0",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Choose LitClaude output style:/u);
      assert.match(result.stdout, /0\) None \/ keep current/u);
      assert.match(result.stdout, /1\) ASD-STE100 \(English\)/u);
      assert.match(result.stdout, /2\) ASD-STE100 \(한국어\)/u);
      assert.match(result.stdout, /3\) ELI5 \(English\)/u);
      assert.match(result.stdout, /4\) ELI5 \(한국어\)/u);
      assert.match(result.stdout, /Style 0-4 \[None \/ keep current\]:/u);
      assert.match(result.stdout, /OUTPUT_STYLE_SELECTED: off/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("output style prompt selects a style by number and persists it", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = spawnSync(process.execPath, [binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "1\n",
        env: {
          ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_HUD_ACCENT_PROMPT: "0",
          LITCLAUDE_OUTPUT_STYLE_PROMPT: "1",
          LITCLAUDE_SPINNER: "0",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /OUTPUT_STYLE_SELECTED: asd-ste100/u);

      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.outputStyleChoice, "asd-ste100");
      assert.equal(settings.litclaude.outputStyleWrittenName, "LitClaude — ASD-STE100");
      assert.equal(settings.outputStyle, "LitClaude — ASD-STE100");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("output style prompt defaults to prior choice on reinstall", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const first = spawnSync(process.execPath, [binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "3\n",
        env: {
          ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_HUD_ACCENT_PROMPT: "0",
          LITCLAUDE_OUTPUT_STYLE_PROMPT: "1",
          LITCLAUDE_SPINNER: "0",
        },
      });
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /OUTPUT_STYLE_SELECTED: eli5/u);

      const second = spawnSync(process.execPath, [binPath, "install"], {
        cwd: root,
        encoding: "utf8",
        input: "\n",
        env: {
          ...process.env, LC_ALL: "C.UTF-8", TERM: "xterm-256color",
          LITCLAUDE_HOME: home,
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_HUD_ACCENT_PROMPT: "0",
          LITCLAUDE_OUTPUT_STYLE_PROMPT: "1",
          LITCLAUDE_SPINNER: "0",
        },
      });
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /Style 0-4 \[ELI5 \(English\)\]:/u);
      assert.match(second.stdout, /OUTPUT_STYLE_SELECTED: eli5/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("clobber-safety: writes outputStyle when field is unset", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "eli5-ko",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });

      assert.equal(result.status, 0, result.stderr);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.outputStyle, "LitClaude — ELI5 (한국어)");
      assert.equal(settings.litclaude.outputStyleChoice, "eli5-ko");
      assert.equal(settings.litclaude.outputStyleWrittenName, "LitClaude — ELI5 (한국어)");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("clobber-safety: overwrites outputStyle when it still matches prior written name", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const first = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "asd-ste100",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(first.status, 0, first.stderr);

      const second = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "eli5",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(second.status, 0, second.stderr);

      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.outputStyle, "LitClaude — ELI5");
      assert.equal(settings.litclaude.outputStyleChoice, "eli5");
      assert.equal(settings.litclaude.outputStyleWrittenName, "LitClaude — ELI5");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("clobber-safety: skips top-level write when outputStyle was changed externally, but updates tracking fields", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const first = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "asd-ste100",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(first.status, 0, first.stderr);

      const settingsPath = join(claudeHome, "settings.json");
      const mid = JSON.parse(readFileSync(settingsPath, "utf8"));
      mid.outputStyle = "My Custom Style";
      writeFileSync(settingsPath, `${JSON.stringify(mid, null, 2)}\n`);

      const second = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "eli5",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /Note: outputStyle was changed outside LitClaude \(currently "My Custom Style"\)/u);

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      assert.equal(settings.outputStyle, "My Custom Style", "external change must not be clobbered");
      assert.equal(settings.litclaude.outputStyleChoice, "eli5", "tracking must reflect new pick");
      assert.equal(settings.litclaude.outputStyleWrittenName, "LitClaude — ELI5", "written name must reflect new pick");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("output style off selection is a true no-op (no settings.outputStyle written, no tracking fields)", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "off",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });

      assert.equal(result.status, 0, result.stderr);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.outputStyle, undefined, "off must not write outputStyle");
      assert.equal(settings.litclaude.outputStyleChoice, undefined, "off must not write outputStyleChoice");
      assert.equal(settings.litclaude.outputStyleWrittenName, undefined, "off must not write outputStyleWrittenName");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("output style env var bypasses the prompt in non-TTY install", () => {
    const home = makeHome();
    const claudeHome = makeClaudeHome();

    try {
      const result = runCliWithEnv(["install"], {
        LITCLAUDE_HOME: home,
        CLAUDE_CONFIG_DIR: claudeHome,
        LITCLAUDE_OUTPUT_STYLE: "asd-ste100-ko",
        LITCLAUDE_HUD_ACCENT_PROMPT: "0",
      });

      assert.equal(result.status, 0, result.stderr);
      const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
      assert.equal(settings.litclaude.outputStyleChoice, "asd-ste100-ko");
      assert.equal(settings.outputStyle, "LitClaude — ASD-STE100 (한국어)");
      assert.doesNotMatch(result.stdout, /Choose LitClaude output style/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });
});
