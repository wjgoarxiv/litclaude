#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalSkillFiles,
  canonicalSkillIds,
  canonicalSkillResourceFiles,
} from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import {
  HUD_ACCENT_THEMES,
  ansi16CodeForAccent,
  hudColorDepth,
  litBrandPrefix,
  normalizeHudAccent,
  normalizeHudAppearance,
  themeForAccent,
} from "../plugins/litclaude/lib/hud-accent-palette.mjs";
import { readPublicSource } from "../plugins/litclaude/lib/public-source-reader/reader.mjs";
import { verifyBundledSkillsIntegrity } from "../plugins/litclaude/lib/bundled-skills-integrity.mjs";
import { verifyCanonicalFrontendCorpus } from "../plugins/litclaude/lib/canonical-frontend-corpus.mjs";
import { verifyCanonicalRuntimeClosures } from "../plugins/litclaude/lib/canonical-runtime-closures.mjs";
import { verifyCanonicalSkillResources } from "../plugins/litclaude/lib/skill-resource-integrity.mjs";
import { runStartWorkContinuationCli } from "../plugins/litclaude/lib/start-work-continuation.mjs";
import { runStartWorkCli } from "../plugins/litclaude/lib/start-work-cli.mjs";
import { runLitgoalCli } from "../plugins/litclaude/lib/litgoal/cli.mjs";
import { runWorkflowCheckCli } from "../plugins/litclaude/lib/workflow-check.mjs";
import { runWikifyKnowledgeCli } from "../plugins/litclaude/lib/wikify-knowledge-cli.mjs";
import { automaticUpdateRoot, runAutomaticUpdate } from "../plugins/litclaude/lib/automatic-update.mjs";
import { runUpdateNotifier } from "./update-notifier.mjs";
import { assertInstallPath, assertOwnedTree, assertCurrentPointer, assertOwnedRegistrations, migrateLegacyVendorPaths, planModifiedLegacySkill, preserveModifiedLegacySkill, registeredPluginInstallation, writeOwnershipReceipt, removeEmptyDirectory } from "./install-ownership.mjs";
import { banner, lockup, colorMode, supportsBlocks, terminalRows } from "./litfamily-banner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const motionSkillScripts = join(root, "plugins", "litclaude", "skills", "lit-typographic-motion", "scripts");

// lit-typographic-motion pre-warm, attempted by install (and so by the global npm postinstall).
// A failure never fails the install: it prints one receipt line naming the command. The cache is
// only ever written by this step or by \`litclaude-ai motion-runtime install\`, never by a render.
const prewarmMotionRuntime = () => {
  if (process.env.LITCLAUDE_MOTION_PREWARM === "0") {
    return "MOTION_RUNTIME: pre-warm skipped (LITCLAUDE_MOTION_PREWARM=0); run: litclaude-ai motion-runtime install";
  }
  const result = spawnSync(process.execPath, [join(motionSkillScripts, "motion-runtime.mjs"), "install"], {
    encoding: "utf8",
    timeout: Number(process.env.LITCLAUDE_MOTION_PREWARM_TIMEOUT_MS ?? 600000),
  });
  if (result.status === 0) return "MOTION_RUNTIME: pre-warmed (engine deps and fonts ready)";
  const why = `${result.stderr || result.error?.message || "unknown error"}`.trim().split("\n").filter(Boolean).pop()?.slice(0, 200) ?? "unknown error";
  return `MOTION_RUNTIME: not pre-warmed (${why}); run: litclaude-ai motion-runtime install`;
};
const version = packageJson.version;

const usage = `Usage: litclaude-ai [--dry-run] <install|doctor|path|run|update|uninstall|litgoal|wikify|workflow-check|start-work|start-work-next|public-read|motion-runtime> [...args]
       litclaude-ai --version

Commands:
  install       Register the packaged LitClaude plugin in Claude Code.
  doctor        Validate the installed LitClaude plugin path.
  path          Print the installed Claude plugin path.
  run -- ...    Run Claude Code after the global plugin install.
  litgoal       Manage litgoal runtime state and evidence.
  wikify        Manage user-owned local knowledge with cooperative writers; same uid is not a tamper-proof or confidential boundary.
  workflow-check Verify Dynamic workflow, /goal, and subagent delegation readiness.
  start-work    Manage schema-3 bounded-authority lifecycle state.
  start-work-next Print the next active start-work continuation directive.
  public-read   Read a public http(s) source with FetchAttempt/FetchVerdict JSON.
  motion-runtime Pre-warm (install [--audio] [--word-timing]) or report (status) the
                lit-typographic-motion runtime cache. Run it outside a sandboxed session.
  update        Reinstall this package version and refresh the Claude plugin registry.
  uninstall     Remove LitClaude-managed install state.

Public read options:
  --json        Emit a machine-readable JSON result.

Update options:
  --no-auto-update
                Skip LitClaude's foreground automatic install for this command.
                LITCLAUDE_NO_AUTO_UPDATE provides the same opt-out for a session.

Install options:
  --permission-mode <safe|balanced|yolo>
                Mutates global Claude settings permissions.allow/deny.
                safe adds no rules; balanced adds bounded routine rules;
                yolo adds broader edit/write and command rules. Existing
                entries are preserved, and uninstall or a mode change removes
                only LitClaude-inserted entries. Planner/read-only agent
                safeguards are never weakened.
  --yolo        Shorthand for --permission-mode yolo.
  --yes         Accept today's shipped defaults for every question (HUD accent,
                output style) and run without prompts. Model selection stays
                host-owned: Claude Code picks its own models, so the installer
                never asks for a model or reasoning effort.

Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit \`ca251e3\`.
`;

const parseArgs = (argv) => {
  const args = [];
  let noAutoUpdate = false;
  let invalidOption;
  for (const arg of argv) {
    if (arg === "--no-auto-update") {
      noAutoUpdate = true;
      continue;
    }
    if (arg.startsWith("--no-auto-update=")) {
      invalidOption = arg;
    }
    args.push(arg);
  }
  const wantsVersion = args[0] === "--version" || args[0] === "-v";
  if (wantsVersion) return { dryRun: false, command: "version", rest: [], noAutoUpdate, invalidOption };
  const dryRun = args[0] === "--dry-run";
  if (dryRun) args.shift();
  return { dryRun, command: args[0], rest: args.slice(1), noAutoUpdate, invalidOption };
};

const litHome = () => resolve(process.env.LITCLAUDE_HOME ?? join(homedir(), ".litclaude"));
const claudeHome = () => resolve(process.env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_HOME ?? join(homedir(), ".claude"));
const updateNotifierCachePath = (home = litHome()) => join(home, "update-notifier", "latest.json");
const versionRoot = (home = litHome()) => join(home, "litclaude-ai", version);
const currentRoot = (home = litHome()) => join(home, "current");
const pluginPathForRoot = (installRoot) => join(installRoot, "plugins", "litclaude");
const claudePluginRoot = (home = claudeHome()) => join(home, "plugins", "cache", "litclaude-ai", "litclaude", version);
const installedPluginsPath = (home = claudeHome()) => join(home, "plugins", "installed_plugins.json");
const knownMarketplacesPath = (home = claudeHome()) => join(home, "plugins", "known_marketplaces.json");
const claudeSettingsPath = (home = claudeHome()) => join(home, "settings.json");
const pluginKey = "litclaude@litclaude-ai";
const marketplaceName = "litclaude-ai";
const intendedPluginPath = (home = claudeHome()) => claudePluginRoot(home);
const marketplaceRoot = (home = litHome()) => join(home, "marketplaces", marketplaceName);
const marketplacePluginPath = (home = litHome()) => join(marketplaceRoot(home), "plugins", "litclaude");
const sourcePluginPath = () => join(root, "plugins", "litclaude");
const litClaudeSettingsKey = "litclaude";
const knownExternalLspPlugins = {
  "typescript-lsp@claude-plugins-official": ["typescript-language-server"],
  "rust-analyzer-lsp@claude-plugins-official": ["rust-analyzer"],
  "pyright-lsp@claude-plugins-official": ["pyright-langserver", "pyright"],
  "gopls-lsp@claude-plugins-official": ["gopls"],
};
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const hudAccentThemes = HUD_ACCENT_THEMES;
const OUTPUT_STYLE_OPTIONS = [
  { id: "off", label: "None / keep current" },
  { id: "asd-ste100", label: "ASD-STE100 (English)" },
  { id: "asd-ste100-ko", label: "ASD-STE100 (한국어)" },
  { id: "eli5", label: "ELI5 (English)" },
  { id: "eli5-ko", label: "ELI5 (한국어)" },
];
const OUTPUT_STYLE_NAMES = {
  "asd-ste100": "LitClaude — ASD-STE100",
  "asd-ste100-ko": "LitClaude — ASD-STE100 (한국어)",
  "eli5": "LitClaude — ELI5",
  "eli5-ko": "LitClaude — ELI5 (한국어)",
};
const permissionModes = new Set(["safe", "balanced", "yolo"]);
const permissionOwnershipDescription =
  "preserves pre-existing entries; removes only LitClaude-inserted entries on mode change or uninstall";

const parsePermissionMode = (value) => {
  if (!permissionModes.has(value)) fail("--permission-mode must be one of safe, balanced, yolo", 64);
  return value;
};

const parseInstallOptions = (rest, existingPermissionMode = "safe") => {
  const preservedMode = permissionModes.has(existingPermissionMode) ? existingPermissionMode : "safe";
  let permissionMode = parsePermissionMode(process.env.LITCLAUDE_PERMISSION_MODE || preservedMode);
  let permissionExplicit = Boolean(process.env.LITCLAUDE_PERMISSION_MODE);
  let assumeYes = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--permission-mode") {
      const value = rest[index + 1];
      if (!value) fail("--permission-mode requires a value", 64);
      permissionMode = parsePermissionMode(value);
      permissionExplicit = true;
      index += 1;
      continue;
    }
    if (arg === "--yolo") {
      permissionMode = "yolo";
      permissionExplicit = true;
      continue;
    }
    if (arg === "--permission-prompt" || arg === "--select-permissions") {
      permissionExplicit = true;
      continue;
    }
    if (arg === "--no-permission-prompt") {
      continue;
    }
    if (arg === "--yes") {
      assumeYes = true;
      continue;
    }
    fail(`Unknown install option: ${arg}`, 64);
  }

  return { permissionMode, permissionExplicit, assumeYes };
};

const permissionProfile = (mode) => {
  switch (mode) {
    case "balanced":
      return {
        mode,
        description: `global Claude settings permissions.allow/deny: adds bounded routine allow rules and dangerous-shell denies; ${permissionOwnershipDescription}`,
        routineAutomation: true,
        dangerousShellDenyPreserved: true,
        plannerSafeguard: "lit-planner remains permissionMode: plan",
      };
    case "yolo":
      return {
        mode,
        description: `global Claude settings permissions.allow/deny: adds broader edit/write and command allow rules plus dangerous-shell denies; ${permissionOwnershipDescription}`,
        routineAutomation: true,
        dangerousShellDenyPreserved: true,
        plannerSafeguard: "lit-planner remains permissionMode: plan",
      };
    case "safe":
    default:
      return {
        mode: "safe",
        description: `global Claude settings permissions.allow/deny: adds no rules; ${permissionOwnershipDescription}`,
        routineAutomation: false,
        dangerousShellDenyPreserved: true,
        plannerSafeguard: "lit-planner remains permissionMode: plan",
      };
  }
};

const printUsage = () => {
  process.stderr.write(usage);
};

const fail = (message, status = 1) => {
  process.stderr.write(`${message}\n`);
  process.exit(status);
};

const shouldAnimateInstall = () => {
  if (process.env.LITCLAUDE_SPINNER === "1") return true;
  if (process.env.LITCLAUDE_SPINNER === "0") return false;
  return Boolean(process.stdout.isTTY && !Object.hasOwn(process.env, "CI"));
};

const shouldColorInstall = () => supportsBlocks() && colorMode() !== "none";

const installStepTheme = (label) => {
  if (/registry|HUD/iu.test(label)) return { code: 215, tag: "registry" };
  if (/plugin/iu.test(label)) return { code: 141, tag: "plugin" };
  if (/marketplace/iu.test(label)) return { code: 111, tag: "market" };
  if (/cache/iu.test(label)) return { code: 179, tag: "cache" };
  return { code: 81, tag: "setup" };
};

const color256 = (code, text) => shouldColorInstall() ? `\x1b[38;5;${code}m${text}\x1b[0m` : text;
const bold = (text) => shouldColorInstall() ? `\x1b[1m${text}\x1b[0m` : text;

const formatInstallStep = (label) => {
  const theme = installStepTheme(label);
  return `${color256(theme.code, theme.tag)} ${bold(label)}`;
};

// Shared LitFamily banner frame (plans/references/installer-choice-contract.md):
// the canonical Ignition B mark plus the existing install plan frame.
const FAMILY_RULE = `  ${"━".repeat(46)}`;
const trueColorSupported = () => /truecolor|24bit/iu.test(process.env.COLORTERM ?? "");
const brandOrange = (text, color = shouldColorInstall()) => {
  if (!color) return text;
  return trueColorSupported() ? `\x1b[38;2;255;99;55m${text}\x1b[0m` : `\x1b[38;5;203m${text}\x1b[0m`;
};
const planYellow = (text, color = shouldColorInstall()) => {
  if (!color) return text;
  return trueColorSupported() ? `\x1b[38;2;250;204;21m${text}\x1b[0m` : `\x1b[38;5;220m${text}\x1b[0m`;
};
const INSTALL_STAGES = [
  ["01", "Plugin", "copy the packaged plugin payload"],
  ["02", "Market", "write the local marketplace"],
  ["03", "Registry", "enable plugin, HUD, permissions"],
  ["04", "Cache", "refresh the compatibility pointer"],
  ["05", "Verify", "confirm every installed surface"],
];
const renderLitClaudeWordmark = ({ color = shouldColorInstall() } = {}) => {
  if (!supportsBlocks()) return ["LIT", `litclaude v${version}`];
  return terminalRows(lockup(`claude v${version}`, banner).map((row) => row.trimEnd()), {
    mode: color ? colorMode() : "none",
  });
};

const familyBanner = ({ color = shouldColorInstall() } = {}) => [
  brandOrange(FAMILY_RULE, color),
  "",
  ...renderLitClaudeWordmark({ color }),
  `       ${packageJson.description}`,
  "",
  brandOrange(FAMILY_RULE, color),
  "  ╭─ INSTALL PLAN",
  ...INSTALL_STAGES.map(([number, name, description]) => `  │ ${planYellow(number, color)} · ${name.padEnd(10)}${description}`),
  "  ╰─ Model selection: host-owned · unrelated Claude settings preserved",
  "",
].join("\n");

const printCommandBanner = (parsed) => {
  if (["install", "update"].includes(parsed.command)) return;
  if (parsed.rest.some((arg) => arg === "--json" || arg.startsWith("--json="))) return;
  const color = shouldColorInstall();
  process.stdout.write(`${renderLitClaudeWordmark({ color }).join("\n")}\n`);
};

const createInstallProgress = () => {
  const animated = shouldAnimateInstall();
  let frameIndex = 0;
  // Explicit spinner mode keeps structured progress, but cannot enable terminal escapes.
  const live = animated && shouldColorInstall();

  const clearLiveLine = () => {
    if (live) process.stdout.write("\r\x1b[2K");
  };

  return {
    prepare({ claudeTarget, litTarget }) {
      if (!animated) {
        process.stdout.write(`\n${familyBanner({ color: false })}`);
        process.stdout.write(`INSTALL_STEP: Installing LitClaude ${version}\n`);
        return;
      }
      process.stdout.write(`\n${familyBanner()}\n`);
      process.stdout.write(
        `\n╭─ PREPARING INSTALL\n` +
        `│ Package       LitClaude ${version}\n` +
        `│ Action        Installing LitClaude ${version}\n` +
        `│ Claude state  ${claudeTarget}\n` +
        `│ Local state   ${litTarget}\n` +
        `│ Progress      5 persistent stages with a final verification\n` +
        `╰─ Existing unrelated Claude settings are preserved\n\n`,
      );
    },
    async run({ number, title, label, purpose, target }, work) {
      if (!animated) {
        process.stdout.write(`INSTALL_STEP: ${label}\n`);
        return work();
      }

      process.stdout.write(
        `${String(number).padStart(2, "0")} / 05  ${title}\n` +
        `     ${purpose}\n` +
        `     target  ${target}\n`,
      );

      const renderSpinner = () => {
        const frame = spinnerFrames[frameIndex % spinnerFrames.length];
        frameIndex += 1;
        const line = `  ${color256(81, frame)} ${formatInstallStep(label)}`;
        process.stdout.write(live ? `\r\x1b[2K${line}` : `${line}\n`);
      };
      renderSpinner();
      const timer = live ? setInterval(renderSpinner, 80) : undefined;

      try {
        const result = await work();
        if (timer) clearInterval(timer);
        clearLiveLine();
        process.stdout.write(`  ${color256(119, "✓")} ${bold(label)}\n\n`);
        return result;
      } catch (error) {
        if (timer) clearInterval(timer);
        clearLiveLine();
        process.stdout.write(
          `  ${color256(203, "✗")} ${bold(`${label} failed`)}\n\n` +
          `╭─ INSTALL STOPPED\n` +
          `│ Stage         ${String(number).padStart(2, "0")} / 05 · ${title}\n` +
          `│ Reason        ${error instanceof Error ? error.message : String(error)}\n` +
          `│ Next          Resolve the reason above, then rerun litclaude install\n` +
          `╰─ Exit without reporting success\n`,
        );
        throw error;
      }
    },
    receipt(rows) {
      if (!animated) return;
      process.stdout.write("\n╭─ INSTALL RECEIPT\n");
      for (const [key, value] of rows) {
        process.stdout.write(`│ ${key.padEnd(13)} ${value}\n`);
      }
      process.stdout.write("╰─ Installation complete\n\n");
    },
  };
};

const currentExists = (home = claudeHome()) => existsSync(claudePluginRoot(home));

const readInstalledPlugins = (home = claudeHome()) => {
  const registryPath = installedPluginsPath(home);
  if (!existsSync(registryPath)) return { version: 2, plugins: {} };
  const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
  return {
    ...parsed,
    version: parsed.version ?? 2,
    plugins: parsed.plugins ?? {},
  };
};

const writeInstalledPlugins = (registry, home = claudeHome()) => {
  const registryPath = installedPluginsPath(home);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
};

const readClaudeSettings = (home = claudeHome()) => {
  const settingsPath = claudeSettingsPath(home);
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
};

const writeClaudeSettings = (settings, home = claudeHome()) => {
  const settingsPath = claudeSettingsPath(home);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
};

const hudAccentPreview = (theme) => {
  const color = shouldColorInstall();
  const depth = color ? hudColorDepth(process.env) : "plain";
  const appearance = normalizeHudAppearance(process.env.LITCLAUDE_HUD_APPEARANCE);
  const brand = litBrandPrefix(version, {
    noColor: !color,
    depth,
    appearance,
  });
  const accent = !color || depth === "plain"
    ? ""
    : depth === "16"
      ? `\x1b[${ansi16CodeForAccent(theme.name)}m`
      : `\x1b[38;5;${theme.code}m`;
  const mark = `${accent}▌${accent ? "\x1b[0m" : ""}`;
  const metrics = ` | O4.8 │ ctx [${mark}░░] 18%/1000k │ 5h [▏░] 4%`;
  return `${brand}${metrics}`;
};

const shouldPromptHudAccent = () => {
  if (process.env.LITCLAUDE_HUD_ACCENT_PROMPT === "1") return true;
  if (process.env.LITCLAUDE_HUD_ACCENT_PROMPT === "0") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !Object.hasOwn(process.env, "CI"));
};

const chooseHudAccent = async (existingAccent = "cyan") => {
  const preservedAccent = normalizeHudAccent(existingAccent);
  const envAccent = process.env.LITCLAUDE_HUD_ACCENT;
  if (envAccent && process.env.LITCLAUDE_HUD_ACCENT_PROMPT !== "1") {
    return normalizeHudAccent(envAccent);
  }
  if (!shouldPromptHudAccent()) return envAccent ? normalizeHudAccent(envAccent) : preservedAccent;

  process.stdout.write("Choose LitClaude HUD brand color:\n");
  for (const [index, theme] of hudAccentThemes.entries()) {
    process.stdout.write(`  ${index + 1}) ${theme.name.padEnd(8)} ${hudAccentPreview(theme)}  ${theme.mood}\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: shouldColorInstall() });
  try {
    const answer = await rl.question(`Color 1-10 or name [${preservedAccent}]: `);
    const trimmed = answer.trim().toLowerCase();
    const byIndex = hudAccentThemes[Number.parseInt(trimmed, 10) - 1]?.name;
    const selected = byIndex ?? (trimmed ? normalizeHudAccent(trimmed) : preservedAccent);
    if (trimmed && selected === "cyan" && trimmed !== "cyan" && byIndex === undefined) {
      process.stdout.write("HUD_COLOR_WARNING: unknown color; using cyan\n");
    }
    process.stdout.write(`HUD_COLOR_SELECTED: ${selected} ${hudAccentPreview(themeForAccent(selected))}\n`);
    return selected;
  } finally {
    rl.close();
  }
};

const normalizeOutputStyle = (value) => {
  if (!value) return "off";
  const v = String(value).trim().toLowerCase();
  const match = OUTPUT_STYLE_OPTIONS.find((opt) => opt.id === v);
  return match ? match.id : "off";
};

const shouldPromptOutputStyle = () => {
  if (process.env.LITCLAUDE_OUTPUT_STYLE_PROMPT === "1") return true;
  if (process.env.LITCLAUDE_OUTPUT_STYLE_PROMPT === "0") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !Object.hasOwn(process.env, "CI"));
};

const chooseOutputStyle = async (existingChoice = "off") => {
  const preserved = normalizeOutputStyle(existingChoice);
  const envStyle = process.env.LITCLAUDE_OUTPUT_STYLE;
  if (envStyle && process.env.LITCLAUDE_OUTPUT_STYLE_PROMPT !== "1") {
    return normalizeOutputStyle(envStyle);
  }
  if (!shouldPromptOutputStyle()) return envStyle ? normalizeOutputStyle(envStyle) : preserved;

  process.stdout.write("Choose LitClaude output style:\n");
  for (const [index, option] of OUTPUT_STYLE_OPTIONS.entries()) {
    process.stdout.write(`  ${index}) ${option.label}\n`);
  }

  const preservedLabel = OUTPUT_STYLE_OPTIONS.find((opt) => opt.id === preserved)?.label ?? preserved;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: shouldColorInstall() });
  try {
    const answer = await rl.question(`Style 0-4 [${preservedLabel}]: `);
    const trimmed = answer.trim();
    const byIndex = OUTPUT_STYLE_OPTIONS[Number.parseInt(trimmed, 10)]?.id;
    const selected = byIndex !== undefined ? byIndex : (trimmed ? normalizeOutputStyle(trimmed) : preserved);
    const isExplicitOff = trimmed.toLowerCase() === "off" || trimmed.toLowerCase() === "none";
    if (trimmed && byIndex === undefined && selected === "off" && !isExplicitOff) {
      process.stdout.write("OUTPUT_STYLE_WARNING: unknown style; using 'off'\n");
    }
    process.stdout.write(`OUTPUT_STYLE_SELECTED: ${selected}\n`);
    return selected;
  } finally {
    rl.close();
  }
};

const hudCommandForPlugin = (pluginPath, accent = "cyan") =>
  `LITCLAUDE_HUD_ACCENT=${normalizeHudAccent(accent)} node "${join(pluginPath, "bin", "litclaude-hud.js")}"`;

const readKnownMarketplaces = (home = claudeHome()) => {
  const path = knownMarketplacesPath(home);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
};

const writeKnownMarketplaces = (knownMarketplaces, home = claudeHome()) => {
  const path = knownMarketplacesPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(knownMarketplaces, null, 2)}\n`);
};

const marketplaceSource = (marketplacePath) => ({
  source: "directory",
  path: marketplacePath,
});

const writeLocalMarketplace = (home = litHome()) => {
  const rootPath = marketplaceRoot(home);
  const targetPlugin = marketplacePluginPath(home);
  rmSync(rootPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPlugin), { recursive: true });
  cpSync(sourcePluginPath(), targetPlugin, { recursive: true });
  const marketplaceManifestPath = join(rootPath, ".claude-plugin", "marketplace.json");
  mkdirSync(dirname(marketplaceManifestPath), { recursive: true });
  writeFileSync(
    marketplaceManifestPath,
    `${JSON.stringify(
      {
        $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
        name: marketplaceName,
        description: "Local LitClaude npm-installed marketplace.",
        owner: {
          name: "LitClaude contributors",
        },
        plugins: [
          {
            name: "litclaude",
            displayName: "LitClaude",
            version,
            description: packageJson.description,
            author: {
              name: "LitClaude contributors",
            },
            source: "./plugins/litclaude",
            category: "development",
            homepage: "https://github.com/wjgoarxiv/litclaude",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeOwnershipReceipt(rootPath, "marketplace", version);
  return rootPath;
};

const registerMarketplace = (marketplacePath, home = claudeHome()) => {
  const settings = readClaudeSettings(home);
  settings.enabledPlugins = settings.enabledPlugins ?? {};
  settings.enabledPlugins[pluginKey] = true;
  settings.extraKnownMarketplaces = settings.extraKnownMarketplaces ?? {};
  settings.extraKnownMarketplaces[marketplaceName] = {
    source: marketplaceSource(marketplacePath),
  };
  writeClaudeSettings(settings, home);

  const knownMarketplaces = readKnownMarketplaces(home);
  knownMarketplaces[marketplaceName] = {
    source: marketplaceSource(marketplacePath),
    installLocation: marketplacePath,
    lastUpdated: new Date().toISOString(),
  };
  writeKnownMarketplaces(knownMarketplaces, home);
};

const ownsHudStatusLine = (settings, ownership) =>
  settings.statusLine?.type === "command" && settings.statusLine.command === ownership.statusLineCommand &&
  Object.keys(settings.statusLine).every((key) => key === "type" || key === "command");

const installHudStatusLine = (pluginPath, home = claudeHome(), accent = "cyan") => {
  const settings = readClaudeSettings(home);
  const hudAccent = normalizeHudAccent(accent);
  const command = hudCommandForPlugin(pluginPath, hudAccent);
  const existingLitClaude = settings[litClaudeSettingsKey] ?? {};
  const now = new Date().toISOString();
  if (existingLitClaude.statusLineManaged === true && !ownsHudStatusLine(settings, existingLitClaude)) {
    process.stdout.write("HUD_WARNING: statusLine changed by user; leaving it untouched\n");
    return;
  }
  const previousStatusLine =
    existingLitClaude.statusLineManaged === true
      ? existingLitClaude.previousStatusLine
      : settings.statusLine;

  settings.statusLine = {
    type: "command",
    command,
  };
  settings[litClaudeSettingsKey] = {
    ...existingLitClaude,
    statusLineManaged: true,
    statusLineCommand: command,
    statusLineVersion: version,
    hudAccent,
    statusLineInstalledAt: existingLitClaude.statusLineInstalledAt ?? now,
    statusLineUpdatedAt: now,
    previousStatusLine: previousStatusLine ?? null,
  };
  writeClaudeSettings(settings, home);
};

const installOutputStyle = (choice, home = claudeHome()) => {
  if (choice === "off") return;
  const writtenName = OUTPUT_STYLE_NAMES[choice] ?? null;
  if (!writtenName) return;

  const settings = readClaudeSettings(home);
  const existingLitClaude = settings[litClaudeSettingsKey] ?? {};
  const previousWrittenName = existingLitClaude.outputStyleWrittenName ?? null;

  const currentOutputStyle = settings.outputStyle;
  if (currentOutputStyle === undefined || currentOutputStyle === previousWrittenName) {
    settings.outputStyle = writtenName;
  } else {
    process.stdout.write(`Note: outputStyle was changed outside LitClaude (currently "${currentOutputStyle}"). Switch it via /config if you want LitClaude's style.\n`);
  }

  settings[litClaudeSettingsKey] = {
    ...existingLitClaude,
    outputStyleChoice: choice,
    outputStyleWrittenName: writtenName,
  };
  writeClaudeSettings(settings, home);
};

const uninstallHudStatusLine = (home = claudeHome()) => {
  const settingsPath = claudeSettingsPath(home);
  if (!existsSync(settingsPath)) return;

  const settings = readClaudeSettings(home);
  const litClaude = settings[litClaudeSettingsKey];
  if (!litClaude) return;

  if (litClaude.statusLineManaged === true) {
    if (ownsHudStatusLine(settings, litClaude)) {
      if (litClaude.previousStatusLine) {
        settings.statusLine = litClaude.previousStatusLine;
      } else {
        delete settings.statusLine;
      }
    } else if (settings.statusLine?.command) {
      process.stdout.write("HUD_WARNING: statusLine changed by user; leaving it untouched\n");
    }
  }

  const remainingLitClaude = { ...litClaude };
  for (const key of [
    "statusLineManaged",
    "statusLineCommand",
    "statusLineVersion",
    "hudAccent",
    "statusLineInstalledAt",
    "statusLineUpdatedAt",
    "previousStatusLine",
  ]) {
    delete remainingLitClaude[key];
  }

  if (Object.keys(remainingLitClaude).length > 0) {
    settings[litClaudeSettingsKey] = remainingLitClaude;
  } else {
    delete settings[litClaudeSettingsKey];
  }
  writeClaudeSettings(settings, home);
};

const uninstallOutputStyle = (home = claudeHome()) => {
  const settingsPath = claudeSettingsPath(home);
  if (!existsSync(settingsPath)) return;
  const settings = readClaudeSettings(home);
  const litClaude = settings[litClaudeSettingsKey];
  if (!litClaude) return;

  const writtenName = litClaude.outputStyleWrittenName ?? null;
  if (writtenName && settings.outputStyle === writtenName) {
    delete settings.outputStyle;
  } else if (writtenName && settings.outputStyle !== undefined) {
    process.stdout.write("OUTPUT_STYLE_WARNING: outputStyle changed by user; leaving it untouched\n");
  }

  const remainingLitClaude = { ...litClaude };
  for (const key of ["outputStyleChoice", "outputStyleWrittenName"]) {
    delete remainingLitClaude[key];
  }
  if (Object.keys(remainingLitClaude).length > 0) settings[litClaudeSettingsKey] = remainingLitClaude;
  else delete settings[litClaudeSettingsKey];
  writeClaudeSettings(settings, home);
};

const uninstallPermissionRules = (home = claudeHome()) => {
  const settingsPath = claudeSettingsPath(home);
  if (!existsSync(settingsPath)) return;
  const settings = readClaudeSettings(home);
  const litClaude = settings[litClaudeSettingsKey];
  if (!litClaude) return;

  const written = litClaude.permissionRulesWritten ?? { allow: [], deny: [] };
  if (settings.permissions && typeof settings.permissions === "object") {
    const permissions = { ...settings.permissions };
    for (const key of ["allow", "deny"]) {
      if (!Array.isArray(permissions[key])) continue;
      const remaining = permissions[key].filter((rule) => !(written[key] ?? []).includes(rule));
      if (remaining.length > 0) permissions[key] = remaining;
      else delete permissions[key];
    }
    if (Object.keys(permissions).length > 0) settings.permissions = permissions;
    else delete settings.permissions;
  }

  const remainingLitClaude = { ...litClaude };
  for (const key of ["permissionPreference", "permissionMode", "permissionUpdatedAt", "permissionRulesWritten"]) {
    delete remainingLitClaude[key];
  }
  if (Object.keys(remainingLitClaude).length > 0) settings[litClaudeSettingsKey] = remainingLitClaude;
  else delete settings[litClaudeSettingsKey];
  writeClaudeSettings(settings, home);
};

const unregisterMarketplace = (home = claudeHome()) => {
  const settingsPath = claudeSettingsPath(home);
  if (existsSync(settingsPath)) {
    const settings = readClaudeSettings(home);
    if (settings.enabledPlugins) delete settings.enabledPlugins[pluginKey];
    if (settings.extraKnownMarketplaces) delete settings.extraKnownMarketplaces[marketplaceName];
    writeClaudeSettings(settings, home);
  }

  const knownPath = knownMarketplacesPath(home);
  if (existsSync(knownPath)) {
    const knownMarketplaces = readKnownMarketplaces(home);
    delete knownMarketplaces[marketplaceName];
    writeKnownMarketplaces(knownMarketplaces, home);
  }
};

// Shell patterns that stay denied in every mode. `permissionProfile` already claims
// dangerousShellDenyPreserved for all three, so yolo keeps them too.
const dangerousShellDeny = [
  "Bash(rm -rf:*)",
  "Bash(rm -fr:*)",
  "Bash(sudo:*)",
  "Bash(chmod -R:*)",
  "Bash(chown -R:*)",
  "Bash(dd:*)",
  "Bash(mkfs:*)",
];

// The rules each mode actually writes into Claude Code's own permission surface. Until now the three modes
// were recorded but never enforced anywhere, so they had one behaviour between them.
const permissionRulesFor = (mode) => {
  switch (mode) {
    case "balanced":
      return {
        allow: ["Read", "Grep", "Glob", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(npm test:*)", "Bash(node --test:*)"],
        deny: dangerousShellDeny,
      };
    case "yolo":
      return {
        allow: ["Read", "Grep", "Glob", "Edit", "Write", "Bash(git:*)", "Bash(npm:*)", "Bash(node:*)"],
        deny: dangerousShellDeny,
      };
    default:
      return { allow: [], deny: [] };
  }
};

const permissionIntegrityFailures = (settings) => {
  const failures = [];
  const litClaude = settings?.[litClaudeSettingsKey];
  if (!litClaude || typeof litClaude !== "object" || Array.isArray(litClaude)) {
    return ["litclaude permission metadata is missing or malformed"];
  }
  const mode = litClaude.permissionMode;
  if (!permissionModes.has(mode)) failures.push("permissionMode must be safe, balanced, or yolo");
  const expectedProfile = permissionModes.has(mode) ? permissionProfile(mode) : null;
  const actualProfile = litClaude.permissionPreference;
  const profileMatches = expectedProfile !== null
    && actualProfile
    && typeof actualProfile === "object"
    && !Array.isArray(actualProfile)
    && Object.keys(actualProfile).length === Object.keys(expectedProfile).length
    && Object.entries(expectedProfile).every(([key, value]) => actualProfile[key] === value);
  if (
    !profileMatches
  ) failures.push("permissionPreference does not match permissionMode");
  if (
    typeof litClaude.permissionUpdatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(litClaude.permissionUpdatedAt)
  ) failures.push("permissionUpdatedAt must be a canonical UTC timestamp");

  const written = litClaude.permissionRulesWritten;
  const desired = permissionModes.has(mode) ? permissionRulesFor(mode) : { allow: [], deny: [] };
  const permissions = settings.permissions;
  if (permissions !== undefined && (permissions === null || typeof permissions !== "object" || Array.isArray(permissions))) {
    failures.push("permissions must be an object");
  }
  for (const key of ["allow", "deny"]) {
    const owned = written?.[key];
    const active = permissions?.[key] ?? [];
    if (!Array.isArray(owned) || owned.some((rule) => typeof rule !== "string")) {
      failures.push(`permissionRulesWritten.${key} must be an array of strings`);
      continue;
    }
    if (!Array.isArray(active) || active.some((rule) => typeof rule !== "string")) {
      failures.push(`permissions.${key} must be an array of strings`);
      continue;
    }
    if (new Set(owned).size !== owned.length) failures.push(`permissionRulesWritten.${key} must not contain duplicates`);
    for (const rule of owned) {
      if (!desired[key].includes(rule)) failures.push(`permissionRulesWritten.${key} contains rule outside ${mode} mode: ${rule}`);
      if (!active.includes(rule)) failures.push(`owned ${key} rule is missing from global settings: ${rule}`);
    }
    for (const rule of desired[key]) {
      if (!active.includes(rule)) failures.push(`${mode} mode ${key} rule is missing from global settings: ${rule}`);
    }
  }
  return failures;
};

// Merge without clobbering, and retract only what a previous install wrote. Tracking our own entries is what
// lets a user narrow the mode later without us deleting rules they added by hand.
const applyPermissionRules = (settings, mode) => {
  const rules = permissionRulesFor(mode);
  const previous = settings[litClaudeSettingsKey]?.permissionRulesWritten ?? { allow: [], deny: [] };
  const existing = settings.permissions ?? {};
  const rebuild = (current, ours, desired) => {
    const kept = (Array.isArray(current) ? current : []).filter((rule) => !ours.includes(rule));
    const inserted = desired.filter((rule) => !kept.includes(rule));
    return { combined: [...new Set([...kept, ...inserted])], inserted };
  };
  const allow = rebuild(existing.allow, previous.allow ?? [], rules.allow);
  const deny = rebuild(existing.deny, previous.deny ?? [], rules.deny);
  if (allow.combined.length || deny.combined.length || existing.allow || existing.deny) {
    settings.permissions = { ...existing, allow: allow.combined, deny: deny.combined };
  }
  return { allow: allow.inserted, deny: deny.inserted };
};

const recordPermissionConfiguration = (mode, home = claudeHome()) => {
  const settings = readClaudeSettings(home);
  const existingLitClaude = settings[litClaudeSettingsKey] ?? {};
  const rules = applyPermissionRules(settings, mode);
  settings[litClaudeSettingsKey] = {
    ...existingLitClaude,
    permissionPreference: permissionProfile(mode),
    permissionMode: mode,
    permissionRulesWritten: rules,
    permissionUpdatedAt: new Date().toISOString(),
  };
  writeClaudeSettings(settings, home);
};

const registerClaudePlugin = (installRoot, marketplacePath, home = claudeHome(), hudAccent = "cyan", permissionMode = "safe") => {
  const registry = readInstalledPlugins(home);
  const now = new Date().toISOString();
  const existing = registry.plugins[pluginKey]?.[0] ?? {};
  registry.plugins[pluginKey] = [
    {
      scope: "user",
      installPath: installRoot,
      version,
      installedAt: existing.installedAt ?? now,
      lastUpdated: now,
      installedBy: "litclaude-ai",
      enabled: true,
    },
  ];
  writeInstalledPlugins(registry, home);
  registerMarketplace(marketplacePath, home);
  installHudStatusLine(installRoot, home, hudAccent);
  recordPermissionConfiguration(permissionMode, home);
};

const unregisterClaudePlugin = (home = claudeHome()) => {
  const registryPath = installedPluginsPath(home);
  if (!existsSync(registryPath)) return;
  const registry = readInstalledPlugins(home);
  delete registry.plugins[pluginKey];
  writeInstalledPlugins(registry, home);
};

const requireInstalledPluginPath = (home = claudeHome()) => {
  if (!currentExists(home)) {
    fail("LitClaude is not installed. Run `litclaude install` first.");
  }
  const path = intendedPluginPath(home);
  if (!existsSync(join(path, ".claude-plugin", "plugin.json"))) {
    fail("LitClaude install is incomplete. Run `litclaude install` again.");
  }
  return path;
};

const commandExists = (command) => {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return !result.error;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const exactInventoryToken = (value) =>
  new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(value)}(?![A-Za-z0-9_-])`, "u");

const assertCurrentPluginDetails = (detailsOutput) => {
  const missing = [];
  const inventorySections = new Map();
  let currentInventory;
  for (const rawLine of detailsOutput.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "").split("\n")) {
    const header = rawLine.trim().match(/^([A-Za-z][A-Za-z -]+)\s*\(\d+\)/u);
    if (header) currentInventory = header[1].trim().toLowerCase();
    if (currentInventory) {
      inventorySections.set(currentInventory, `${inventorySections.get(currentInventory) ?? ""}\n${rawLine}`);
    }
  }
  const skillsInventory = inventorySections.get("skills") ?? "";

  if (!new RegExp(`\\b${escapeRegex(version)}\\b`, "u").test(detailsOutput)) {
    missing.push(`expected version ${version}`);
  }

  const agentsMatch = detailsOutput.match(/Agents\s+\((\d+)\)/u);
  if (!agentsMatch || Number(agentsMatch[1]) < 1 || !/\blit-planner\b/u.test(detailsOutput)) {
    missing.push("expected nonzero Agents inventory with lit-planner");
  }

  const missingSkills = canonicalSkillIds.filter(
    (skillId) => !exactInventoryToken(skillId).test(skillsInventory),
  );
  if (missingSkills.length > 0) {
    missing.push(`expected canonical skills: ${missingSkills.join(", ")}`);
  }

  if (missing.length > 0) {
    fail(`Claude plugin details did not show current LitClaude agent inventory: ${missing.join("; ")}. Re-run litclaude install in the intended CLAUDE_CONFIG_DIR.`);
  }
};

const printLspDiagnostics = (pluginPath, registry) => {
  const lspPath = join(pluginPath, ".lsp.json");
  const config = JSON.parse(readFileSync(lspPath, "utf8"));
  const litClaudeServers = Object.keys(config);
  process.stdout.write(`LITCLAUDE_LSP_SERVERS: ${litClaudeServers.join(", ") || "none"}\n`);

  for (const server of litClaudeServers) {
    const command = config[server]?.command?.[0];
    if (command && !commandExists(command)) {
      process.stdout.write(`LITCLAUDE_LSP_WARNING: ${server} requires ${command}; use Skill(lsp-setup) to install and verify it, or remove that server from .lsp.json\n`);
    }
  }

  const externalWarnings = [];
  for (const [key, commands] of Object.entries(knownExternalLspPlugins)) {
    if (!registry.plugins[key]?.length) continue;
    if (commands.some(commandExists)) continue;
    externalWarnings.push({ key, command: commands[0] });
    process.stdout.write(`EXTERNAL_LSP_WARNING: ${key} requires ${commands[0]}\n`);
  }

  if (externalWarnings.length > 0) {
    process.stdout.write("These warnings are not emitted by LitClaude's .lsp.json; they come from other installed Claude Code LSP plugins.\n");
  }
};

const resetCurrentPointer = (home, target) => {
  const current = currentRoot(home);
  rmSync(current, { recursive: true, force: true });
  try {
    symlinkSync(target, current, "dir");
  } catch {
    mkdirSync(current, { recursive: true });
    cpSync(target, current, { recursive: true });
  }
};

const verifyInstalledPayload = ({ home, litClaudeHome, targetPlugin }) => {
  for (const relativePath of [
    ".claude-plugin/plugin.json",
    "hooks/hooks.json",
    "bin/litclaude-hook.js",
    "lib/start-work-lifecycle.mjs",
    "lib/start-work-cli.mjs",
    ...canonicalSkillResourceFiles,
    "commands/start-work.md",
    "bin/litclaude-scientific-visualization-doctor.js",
    "commands/lit-handoff.md",
    "vendor/handoff/SKILL.md",
    "commands/lit-scientific-visualization.md",
    "vendor/scientific-visualization/SKILL.md",
    "vendor/scientific-visualization/scripts/style_presets.py",
    "commands/autoresearch.md",
    "commands/autoconference.md",
    "commands/wikify.md",
    "vendor/canonical-runtime-closures.json",
    "skills/frontend-ui-ux/references/_canonical-corpus/manifest.json",
  ]) {
    if (!existsSync(join(targetPlugin, relativePath))) {
      throw new Error(`installed plugin is missing ${relativePath}`);
    }
  }
  const integrity = verifyBundledSkillsIntegrity(targetPlugin);
  if (integrity.status !== "PASS") {
    throw new Error(`installed bundled-skill integrity verification failed: ${JSON.stringify(integrity)}`);
  }
  const resourceIntegrity = verifyCanonicalSkillResources(targetPlugin);
  if (resourceIntegrity.status !== "PASS") {
    throw new Error(`SKILL_RESOURCE_INTEGRITY_FAIL ${JSON.stringify(resourceIntegrity.failures)}`);
  }
  const canonicalFrontend = verifyCanonicalFrontendCorpus(targetPlugin);
  if (canonicalFrontend.status !== "PASS") {
    throw new Error(`CANONICAL_FRONTEND_CORPUS_FAIL ${JSON.stringify(canonicalFrontend.failures)}`);
  }
  const runtimeClosures = verifyCanonicalRuntimeClosures(targetPlugin);
  if (runtimeClosures.status !== "PASS") {
    throw new Error(`CANONICAL_RUNTIME_CLOSURES_FAIL ${JSON.stringify(runtimeClosures.failures)}`);
  }
  if (!readInstalledPlugins(home).plugins[pluginKey]?.length) {
    throw new Error(`Claude registry is missing ${pluginKey}`);
  }
  if (!existsSync(currentRoot(litClaudeHome))) {
    throw new Error("LitClaude compatibility pointer was not created");
  }
};

const preflightInstallOwnership = ({ preserveModifiedSkill = false } = {}) => {
  const home = claudeHome(), lit = litHome();
  assertInstallPath(home, installedPluginsPath(home), { file: true });
  const registry = readInstalledPlugins(home);
  const registration = preserveModifiedSkill
    ? registeredPluginInstallation({
      registry, pluginKey, pluginParent: dirname(claudePluginRoot(home)), home, version,
    })
    : null;
  const activeVersion = registration?.version ?? version;
  const activePlugin = registration?.installPath ?? claudePluginRoot(home);
  let marketplaceVersion = null;
  const trees = [
    [home, claudePluginRoot(home), "plugin"],
    [lit, marketplaceRoot(lit), "marketplace"],
    [lit, versionRoot(lit), "compatibility"],
  ];
  for (const [boundary, path, kind] of trees) {
    assertInstallPath(boundary, path);
    if (!(preserveModifiedSkill && kind === "plugin" && path === activePlugin)) {
      const ownedVersion = assertOwnedTree(path, kind, version, { allowPreviousVersion: kind === "marketplace" });
      if (kind === "marketplace") marketplaceVersion = ownedVersion;
    }
  }
  if (registration && activeVersion !== version) {
    const activeCompatibility = join(lit, "litclaude-ai", activeVersion);
    assertInstallPath(lit, activeCompatibility);
    assertOwnedTree(activeCompatibility, "compatibility", activeVersion, { requirePresent: true });
  }
  const preservation = preserveModifiedSkill
    ? planModifiedLegacySkill({
      activePlugin,
      marketplacePlugin: marketplacePluginPath(lit),
      compatibilityPlugin: pluginPathForRoot(join(lit, "litclaude-ai", activeVersion)),
      version,
      installedVersion: activeVersion,
      marketplaceVersion,
    })
    : null;
  if (preserveModifiedSkill && !preservation) {
    assertOwnedTree(claudePluginRoot(home), "plugin", version);
  }
  assertCurrentPointer(lit, currentRoot(lit), versionRoot(lit), version, { expectedVersion: registration?.version });
  for (const path of [claudeSettingsPath(home), installedPluginsPath(home), knownMarketplacesPath(home)]) {
    assertInstallPath(home, path, { file: true });
  }
  assertOwnedRegistrations({
    registry, settings: readClaudeSettings(home), marketplaces: readKnownMarketplaces(home),
    pluginKey, marketplaceName, marketplacePath: marketplaceRoot(lit), pluginParent: dirname(claudePluginRoot(home)), home, version,
    modifiedPluginRoot: preservation?.activePlugin, modifiedPluginVersion: preservation?.version,
  });
  assertInstallPath(lit, dirname(updateNotifierCachePath(lit)));
  assertInstallPath(lit, updateNotifierCachePath(lit), { file: true });
  return preservation;
};

const install = async ({ dryRun, rest }) => {
  const home = claudeHome();
  const litClaudeHome = litHome();
  const existingLitClaude = readClaudeSettings(home)[litClaudeSettingsKey] ?? {};
  const { permissionMode, permissionExplicit, assumeYes } = parseInstallOptions(rest, existingLitClaude.permissionMode);
  const existingHudAccent = normalizeHudAccent(existingLitClaude.hudAccent);
  const existingOutputStyle = existingLitClaude.outputStyleChoice ?? "off";
  const requestedHudAccent = process.env.LITCLAUDE_HUD_ACCENT
    ? normalizeHudAccent(process.env.LITCLAUDE_HUD_ACCENT)
    : existingHudAccent;
  const targetPlugin = claudePluginRoot(home);
  const sourcePlugin = sourcePluginPath();
  const targetMarketplace = marketplaceRoot(litClaudeHome);
  const progress = createInstallProgress();

  if (dryRun) {
    process.stdout.write(`${familyBanner({ color: false })}\n`);
    process.stdout.write(`DRY_RUN: install LitClaude ${version}\n`);
    process.stdout.write("Model selection: host-owned (Claude Code exposes no native route surface)\n");
    process.stdout.write(`Would copy: ${sourcePlugin} -> ${targetPlugin}\n`);
    process.stdout.write(`Would create local marketplace: ${targetMarketplace}\n`);
    process.stdout.write(`Would register Claude plugin: ${pluginKey}\n`);
    process.stdout.write(`Would set Claude statusLine HUD: ${hudCommandForPlugin(targetPlugin, requestedHudAccent)}\n`);
    const permissionSource = permissionExplicit
      ? "explicit"
      : permissionModes.has(existingLitClaude.permissionMode) ? "preserved" : "default";
    process.stdout.write(`Would mutate global Claude settings permissions.allow/deny: ${permissionMode} (${permissionSource})\n`);
    process.stdout.write(`Permission profile: ${permissionProfile(permissionMode).description}\n`);
    process.stdout.write("Would pre-warm the lit-typographic-motion runtime: litclaude-ai motion-runtime install\n");
    process.stdout.write("Launch with: claude\n");
    return;
  }

  if (!existsSync(sourcePlugin)) {
    fail(`Packaged LitClaude plugin payload is missing: ${sourcePlugin}`);
  }

  const hudAccent = assumeYes
    ? (process.env.LITCLAUDE_HUD_ACCENT ? normalizeHudAccent(process.env.LITCLAUDE_HUD_ACCENT) : existingHudAccent)
    : await chooseHudAccent(existingHudAccent);
  const outputStyleChoice = assumeYes
    ? normalizeOutputStyle(process.env.LITCLAUDE_OUTPUT_STYLE ?? existingOutputStyle)
    : await chooseOutputStyle(existingOutputStyle);
  const preservation = preflightInstallOwnership({ preserveModifiedSkill: true });
  const preservedPath = preserveModifiedLegacySkill(preservation, litClaudeHome);
  const targetCompatibility = versionRoot(litClaudeHome);
  migrateLegacyVendorPaths(targetPlugin, targetPlugin, "plugin", version);
  migrateLegacyVendorPaths(targetMarketplace, marketplacePluginPath(litClaudeHome), "marketplace", version);
  migrateLegacyVendorPaths(targetCompatibility, pluginPathForRoot(targetCompatibility), "compatibility", version);
  progress.prepare({ claudeTarget: home, litTarget: litClaudeHome });
  await progress.run(
    {
      number: 1,
      title: "PLUGIN PAYLOAD",
      label: "Plugin payload copied",
      purpose: "Copy the packaged hooks, skills, agents, MCP, and LSP surfaces",
      target: targetPlugin,
    },
    async () => {
      await rm(targetPlugin, { recursive: true, force: true });
      await mkdir(dirname(targetPlugin), { recursive: true });
      await cp(sourcePlugin, targetPlugin, { recursive: true });
      writeOwnershipReceipt(targetPlugin, "plugin", version);
    },
  );
  const localMarketplace = await progress.run(
    {
      number: 2,
      title: "LOCAL MARKETPLACE",
      label: "Marketplace metadata written",
      purpose: "Create a local Claude marketplace without a GitHub login",
      target: targetMarketplace,
    },
    () => writeLocalMarketplace(litClaudeHome),
  );
  await progress.run(
    {
      number: 3,
      title: "CLAUDE REGISTRY",
      label: "Claude plugin and HUD enabled",
      purpose: "Enable the plugin and HUD, then update global Claude settings permissions.allow/deny",
      target: claudeSettingsPath(home),
    },
    () => {
      registerClaudePlugin(targetPlugin, localMarketplace, home, hudAccent, permissionMode);
      installOutputStyle(outputStyleChoice, home);
    },
  );

  const litRoot = versionRoot(litClaudeHome);
  await progress.run(
    {
      number: 4,
      title: "COMPATIBILITY CACHE",
      label: "Compatibility pointer refreshed",
      purpose: "Refresh the versioned fallback used by LitClaude helper commands",
      target: currentRoot(litClaudeHome),
    },
    async () => {
      await rm(litRoot, { recursive: true, force: true });
      await mkdir(dirname(pluginPathForRoot(litRoot)), { recursive: true });
      await cp(sourcePlugin, pluginPathForRoot(litRoot), { recursive: true });
      writeOwnershipReceipt(litRoot, "compatibility", version);
      resetCurrentPointer(litClaudeHome, litRoot);
    },
  );
  await progress.run(
    {
      number: 5,
      title: "INSTALL VERIFICATION",
      label: "Installed surfaces verified",
      purpose: "Confirm the payload, Claude registry, and compatibility pointer",
      target: targetPlugin,
    },
    () => verifyInstalledPayload({ home, litClaudeHome, targetPlugin }),
  );

  const finalSettings = readClaudeSettings(home);
  const hudManaged = ownsHudStatusLine(finalSettings, finalSettings[litClaudeSettingsKey] ?? {});
  progress.receipt([
    ["Status", "Ready for Claude Code"],
    ["Version", version],
    ["Model route", "host-owned (Claude Code picks models)"],
    ["Plugin", pluginKey],
    ["Plugin path", intendedPluginPath(home)],
    ["HUD", hudManaged ? `${hudAccent} accent` : "user setting preserved"],
    ["Permissions", `${permissionMode}; global settings allow/deny; ownership-safe removal`],
    ["Launch", "claude"],
  ]);
  process.stdout.write("Model selection: host-owned (Claude Code exposes no native route surface)\n");
  process.stdout.write(`INSTALL_PASS: LitClaude ${version} installed\n`);
  process.stdout.write(`Claude plugin: ${pluginKey}\n`);
  process.stdout.write(`Marketplace: ${localMarketplace}\n`);
  process.stdout.write(`Plugin path: ${intendedPluginPath(home)}\n`);
  process.stdout.write(hudManaged ? `HUD: LitClaude statusLine installed (${hudAccent})\n` : "HUD: user statusLine setting preserved\n");
  process.stdout.write(`Global Claude settings permissions.allow/deny: ${permissionMode} — ${permissionProfile(permissionMode).description}\n`);
  process.stdout.write(`${prewarmMotionRuntime()}\n`);
  process.stdout.write("Launch with: claude\n");
  if (preservedPath) process.stderr.write(`INSTALL_WARNING: PRESERVED_MODIFIED_SKILL lit-korean at ${preservedPath}\n`);
};

const doctor = ({ dryRun }) => {
  if (dryRun) {
    const pluginPath = intendedPluginPath();
    process.stdout.write("DRY_RUN: doctor LitClaude install\n");
    process.stdout.write(`Would check plugin files under: ${pluginPath}\n`);
    process.stdout.write(`Would run: claude plugin validate ${pluginPath}\n`);
    process.stdout.write(`Would check Claude plugin registry: ${pluginKey}\n`);
    process.stdout.write(`Would check Claude statusLine HUD: ${hudCommandForPlugin(pluginPath)}\n`);
    process.stdout.write("Would check global Claude settings permissions.allow/deny and LitClaude ownership-safe removal metadata\n");
    process.stdout.write(`Would inspect automatic-update receipt/journal under: ${join(automaticUpdateRoot(litHome()), "receipt.json")}\n`);
    process.stdout.write(`Would run: node ${join(pluginPath, "bin", "litclaude-scientific-visualization-doctor.js")}\n`);
    process.stdout.write(`Would report: node ${join(pluginPath, "lib", "office-runtime.mjs")} status\n`);
    process.stdout.write(`Would report: node ${join(pluginPath, "skills", "lit-typographic-motion", "scripts", "motion-doctor.mjs")} (Chrome, ffmpeg, WebGL2 renderer, software-GL warning, motion pre-warm)\n`);
    process.stdout.write("Would verify exact canonical frontend corpus bytes, legal companions, no extras, and three canonical runtime closures\n");
    return;
  }

  const pluginPath = requireInstalledPluginPath();
  const registry = readInstalledPlugins();
  const registryEntry = registry.plugins[pluginKey]?.[0];
  if (!registryEntry) fail(`LitClaude is missing from Claude plugin registry: ${pluginKey}`);
  const requiredFiles = [
    ".claude-plugin/plugin.json",
    ".mcp.json",
    ".lsp.json",
    "hooks/hooks.json",
    "bin/litclaude-hook.js",
    "bin/litclaude-mcp.js",
    "lib/start-work-lifecycle.mjs",
    "lib/start-work-cli.mjs",
    "commands/start-work.md",
    "commands/lit-handoff.md",
    "vendor/handoff/SKILL.md",
    "vendor/handoff/evals/evals.json",
    "vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
    "vendor/handoff/templates/HANDOFF.md",
    "commands/lit-scientific-visualization.md",
    "bin/litclaude-scientific-visualization-doctor.js",
    "vendor/scientific-visualization/SKILL.md",
    "vendor/scientific-visualization/scripts/style_presets.py",
    "vendor/scientific-visualization/scripts/figure_export.py",
    "vendor/scientific-visualization/assets/color_palettes.py",
    "vendor/provenance/022_handoff.md",
    "vendor/provenance/045_scientific-visualization.md",
    "vendor/licenses/022_handoff-MIT.txt",
    "vendor/licenses/045_scientific-visualization-MIT.txt",
    "commands/autoresearch.md",
    "commands/autoconference.md",
    "commands/wikify.md",
    "vendor/canonical-runtime-closures.json",
    "skills/frontend-ui-ux/references/_canonical-corpus/manifest.json",
  ];

  for (const file of requiredFiles) {
    const path = join(pluginPath, file);
    if (!existsSync(path)) fail(`LitClaude install is missing ${file}. Run \`litclaude install\` again.`);
  }
  for (const file of canonicalSkillFiles) {
    const path = join(pluginPath, file);
    if (!existsSync(path)) {
      fail(`DOCTOR_FAIL: LitClaude install is missing ${file}. Run \`litclaude install\` again.`);
    }
  }
  process.stdout.write("SKILL_CATALOG_PASS\n");
  const resourceIntegrity = verifyCanonicalSkillResources(pluginPath);
  if (resourceIntegrity.status !== "PASS") {
    fail(`SKILL_RESOURCE_INTEGRITY_FAIL ${JSON.stringify(resourceIntegrity.failures)}`);
  }
  process.stdout.write(`SKILL_RESOURCE_INTEGRITY_PASS: ${resourceIntegrity.checked} resources\n`);
  const canonicalFrontend = verifyCanonicalFrontendCorpus(pluginPath);
  if (canonicalFrontend.status !== "PASS") {
    fail(`CANONICAL_FRONTEND_CORPUS_FAIL ${JSON.stringify(canonicalFrontend.failures)}`);
  }
  process.stdout.write(`CANONICAL_FRONTEND_CORPUS_PASS: ${canonicalFrontend.checkedFiles} files; ${canonicalFrontend.corpusBytes} corpus bytes\n`);
  const runtimeClosures = verifyCanonicalRuntimeClosures(pluginPath);
  if (runtimeClosures.status !== "PASS") {
    fail(`CANONICAL_RUNTIME_CLOSURES_FAIL ${JSON.stringify(runtimeClosures.failures)}`);
  }
  process.stdout.write(`CANONICAL_RUNTIME_CLOSURES_PASS: ${runtimeClosures.families.map(({ id, checked }) => `${id}=${checked}`).join(" ")}\n`);

  printLspDiagnostics(pluginPath, registry);

  const scientificVisualizationDoctor = spawnSync(
    process.execPath,
    [join(pluginPath, "bin", "litclaude-scientific-visualization-doctor.js")],
    { encoding: "utf8" },
  );
  if (scientificVisualizationDoctor.stdout) process.stdout.write(scientificVisualizationDoctor.stdout);
  if (scientificVisualizationDoctor.stderr) process.stderr.write(scientificVisualizationDoctor.stderr);
  if (scientificVisualizationDoctor.status !== 0) {
    fail("LitClaude bundled-skills payload is incomplete or hash-invalid. Run `litclaude install` again.");
  }
  process.stdout.write("BUNDLED_SKILLS_PAYLOAD_PASS\n");

  // lit-pptx and lit-docx install their pinned runtime on first use; the doctor reports
  // readiness and the optional host tools but never installs and never fails on them.
  const officeRuntime = spawnSync(process.execPath, [join(pluginPath, "lib", "office-runtime.mjs"), "status"], { encoding: "utf8" });
  for (const line of `${officeRuntime.stdout || officeRuntime.stderr || ""}`.trim().split("\n").filter(Boolean)) {
    process.stdout.write(`OFFICE_RUNTIME: ${line}\n`);
  }

  // lit-typographic-motion: the five readiness probes, every run. Read-only and never fatal; a
  // missing pre-warm names the command that fixes it.
  const motionDoctor = spawnSync(process.execPath, [join(pluginPath, "skills", "lit-typographic-motion", "scripts", "motion-doctor.mjs")], { encoding: "utf8", timeout: 120000 });
  const motionLines = `${motionDoctor.stdout || ""}`.trim().split("\n").filter(Boolean);
  if (motionLines.length) for (const line of motionLines) process.stdout.write(`${line}\n`);
  else process.stdout.write(`MOTION_DOCTOR_WARNING: probes did not run (${`${motionDoctor.stderr || motionDoctor.error?.message || "no output"}`.trim().split("\n")[0]})\n`);

  const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (claude.error) {
    process.stdout.write("CLAUDE_WARNING: claude executable not found in PATH\n");
  } else {
    process.stdout.write(`CLAUDE_VERSION: ${(claude.stdout || claude.stderr).trim()}\n`);
    const validation = spawnSync("claude", ["plugin", "validate", pluginPath], { encoding: "utf8" });
    if (validation.status !== 0) {
      if (validation.stdout) process.stderr.write(validation.stdout);
      if (validation.stderr) process.stderr.write(validation.stderr);
      fail("Claude plugin validation failed.");
    }
    process.stdout.write("CLAUDE_PLUGIN_VALIDATE_PASS\n");
    const details = spawnSync("claude", ["plugin", "details", pluginKey], { encoding: "utf8" });
    if (details.status !== 0) {
      if (details.stdout) process.stderr.write(details.stdout);
      if (details.stderr) process.stderr.write(details.stderr);
      fail("Claude plugin details failed.");
    }
    assertCurrentPluginDetails(`${details.stdout}\n${details.stderr}`);
    process.stdout.write("CLAUDE_PLUGIN_DETAILS_PASS\n");
  }

  process.stdout.write(`Plugin path: ${pluginPath}\n`);
  const automaticReceiptPath = join(automaticUpdateRoot(litHome()), "receipt.json");
  if (existsSync(automaticReceiptPath)) {
    process.stdout.write(`AUTOMATIC_UPDATE_RECEIPT: ${automaticReceiptPath}\n`);
  }
  const settings = readClaudeSettings();
  const permissionFailures = permissionIntegrityFailures(settings);
  if (permissionFailures.length > 0) {
    fail(`PERMISSION_INTEGRITY_FAIL ${JSON.stringify(permissionFailures)}`);
  }
  process.stdout.write("PERMISSION_INTEGRITY_PASS\n");
  const permissionMode = settings[litClaudeSettingsKey]?.permissionMode ?? "safe";
  process.stdout.write(`PERMISSION_MODE: ${permissionMode}\n`);
  process.stdout.write("PERMISSION_SETTINGS_SCOPE: global Claude settings permissions.allow/deny\n");
  process.stdout.write("PERMISSION_OWNERSHIP: preserves pre-existing entries; removes only LitClaude-inserted entries\n");
  process.stdout.write(`PERMISSION_PROFILE: ${permissionProfile(permissionMode).description}\n`);
  if (settings.statusLine?.command === hudCommandForPlugin(pluginPath, settings[litClaudeSettingsKey]?.hudAccent)) {
    process.stdout.write("HUD_STATUSLINE_PASS\n");
  } else {
    process.stdout.write("HUD_STATUSLINE_WARNING: LitClaude HUD is not the active Claude statusLine\n");
  }
  process.stdout.write("Launch with: claude\n");
  process.stdout.write("DOCTOR_PASS\n");
};

const printPath = () => {
  process.stdout.write(`${requireInstalledPluginPath()}\n`);
};

const printVersion = () => {
  process.stdout.write(`${version}\n`);
};

const runPublicRead = async ({ rest }) => {
  const args = [...rest];
  const json = args.includes("--json");
  const filtered = args.filter((arg) => arg !== "--json");
  const input = filtered.join(" ").trim();
  if (!input) fail("public-read requires a URL or query", 64);

  const result = await readPublicSource(input);

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`PUBLIC_READ_PASS: ${result.resolvedUrl}\n`);
    if (result.metadata?.title) process.stdout.write(`# ${result.metadata.title}\n\n`);
    process.stdout.write(`${result.contentText}\n`);
  } else {
    process.stdout.write(`PUBLIC_READ_STOP: ${result.status} ${result.stopReason}\n${result.message}\n`);
  }

  if (result.ok) return 0;
  if (result.status === "invalid-input") return 64;
  return 2;
};

const runClaude = ({ dryRun, rest }) => {
  const separatorIndex = rest.indexOf("--");
  const claudeArgs = separatorIndex === -1 ? rest : rest.slice(separatorIndex + 1);
  if (!dryRun) requireInstalledPluginPath();
  const command = ["claude", ...claudeArgs];

  if (dryRun) {
    process.stdout.write(command.join(" "));
    process.stdout.write("\n");
    return;
  }

  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.error) fail(`failed to start claude: ${result.error.message}`);
  process.exit(result.status ?? 1);
};

const uninstall = ({ dryRun }) => {
  const home = litHome();
  const pluginCacheRoot = join(claudeHome(), "plugins", "cache", "litclaude-ai");
  const updateNotifierRoot = dirname(updateNotifierCachePath(home));
  if (dryRun) {
    process.stdout.write(`DRY_RUN: remove checked ${versionRoot(home)}, ${currentRoot(home)}, ${marketplaceRoot(home)}, ${claudePluginRoot()}, ${pluginKey}, and its marketplace/settings entries; preserve unrelated versions/cache entries and nonempty ${updateNotifierRoot}\n`);
    return;
  }
  rmSync(currentRoot(home), { recursive: true, force: true });
  rmSync(versionRoot(home), { recursive: true, force: true });
  removeEmptyDirectory(join(home, "litclaude-ai"));
  rmSync(marketplaceRoot(home), { recursive: true, force: true });
  // Notifier files predate ownership receipts; retain their bytes and foreign entries.
  removeEmptyDirectory(updateNotifierRoot);
  unregisterClaudePlugin();
  unregisterMarketplace();
  uninstallHudStatusLine();
  uninstallOutputStyle();
  uninstallPermissionRules();
  rmSync(claudePluginRoot(), { recursive: true, force: true });
  removeEmptyDirectory(dirname(claudePluginRoot()));
  removeEmptyDirectory(pluginCacheRoot);
  process.stdout.write("UNINSTALL_PASS\n");
};

const emitAutomaticUpdateResult = (result) => {
  if (!result || result.status === "gated" || result.status === "no-candidate" || result.status === "current" || result.status === "stale-cache" || result.status === "locked") return;
  if (result.status === "installed") {
    process.stdout.write(`AUTO_UPDATE_PASS: LitClaude ${result.targetVersion} installed\n`);
    if (result.receiptPath) process.stdout.write(`AUTO_UPDATE_RECEIPT: ${result.receiptPath}\n`);
    return;
  }
  const label = result.status === "rolled-back"
    ? "ROLLBACK"
    : result.status === "rollback-failed" ? "UNKNOWN_STATE" : "STOPPED";
  process.stderr.write(`AUTO_UPDATE_${label}: automatic update did not replace the current install\n`);
  if (result.receiptPath) process.stderr.write(`AUTO_UPDATE_RECEIPT: ${result.receiptPath}\n`);
};

const runEligibleAutomaticUpdate = (parsed) => {
  if (!["install", "update", "doctor"].includes(parsed.command)) return { status: "gated" };
  // Validate install/update flags before any automatic side effect. This keeps
  // malformed or ambiguous requests fail-closed rather than forwarding them to npm.
  if (parsed.command === "install" || parsed.command === "update") {
    const existing = readClaudeSettings()[litClaudeSettingsKey] ?? {};
    parseInstallOptions(parsed.rest, existing.permissionMode);
  }
  const result = runAutomaticUpdate({
    surface: "management",
    command: parsed.command,
    rest: parsed.rest,
    dryRun: parsed.dryRun,
    currentVersion: version,
    cachePath: updateNotifierCachePath(),
    litHome: litHome(),
    claudeHome: claudeHome(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    noAutoUpdate: parsed.noAutoUpdate,
    cwd: process.cwd(),
  });
  emitAutomaticUpdateResult(result);
  return result;
};

const main = async () => {
  const parsed = parseArgs(process.argv.slice(2));
  const { command } = parsed;

  if (!command) {
    printUsage();
    process.exit(64);
  }
  if (parsed.invalidOption) fail(`Unknown update option: ${parsed.invalidOption}`, 64);

  if (["--help", "-h", "help"].includes(command)) {
    printCommandBanner(parsed);
    process.stdout.write(`${usage}\n`);
    return;
  }

  if (!parsed.dryRun && ["install", "update", "uninstall"].includes(command)) {
    preflightInstallOwnership({ preserveModifiedSkill: ["install", "update"].includes(parsed.command) });
  }
  const automaticUpdate = runEligibleAutomaticUpdate(parsed);
  if (automaticUpdate.status === "rollback-failed") {
    fail("AUTO_UPDATE_UNKNOWN_STATE: automatic update rollback failed; run `litclaude doctor` before using the install", 1);
  }
  if (automaticUpdate.status === "installed") {
    // The automatic transaction already ran the exact-version install and its
    // post-install doctor. Do not immediately re-run the old package's command.
    return;
  }

  printCommandBanner(parsed);

  switch (command) {
    case "install":
    case "update":
      await install(parsed);
      break;
    case "doctor":
      doctor(parsed);
      break;
    case "path":
      printPath(parsed);
      break;
    case "version":
      printVersion();
      break;
    case "run":
      runClaude(parsed);
      break;
    case "litgoal":
      process.exit(runLitgoalCli(parsed.rest));
      break;
    case "wikify":
      process.exit(runWikifyKnowledgeCli(parsed.rest, undefined, process.cwd()));
      break;
    case "workflow-check":
      process.exit(runWorkflowCheckCli(root, version, parsed.rest));
      break;
    case "public-read":
      process.exit(await runPublicRead(parsed));
      break;
    case "start-work-next":
      process.exit(runStartWorkContinuationCli(root, parsed.rest));
      break;
    case "start-work":
      process.exit(runStartWorkCli(parsed.rest, undefined, process.cwd()));
      break;
    case "motion-runtime": {
      const { main: motionRuntime } = await import(pathToFileURL(join(motionSkillScripts, "motion-runtime.mjs")).href);
      process.exit(await motionRuntime(parsed.rest));
      break;
    }
    case "uninstall":
      uninstall(parsed);
      break;
    default:
      printUsage();
      fail(`Unknown command: ${command}`, 64);
  }

  if (command === "install" || command === "update" || command === "doctor") {
    runUpdateNotifier({
      ...parsed,
      currentVersion: version,
      cachePath: updateNotifierCachePath(),
    });
  }
};

main().catch((error) => fail(error.message));
