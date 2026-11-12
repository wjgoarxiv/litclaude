// `litclaude-ai extensions <verb>`: manage the LitFamily extensions from LitClaude's own CLI. In Claude Code the
// extensions are plugins of the wjgoarxiv-skills marketplace, so Claude Code itself installs, updates and removes
// them (its plugin cache is the destination, and its installed_plugins.json record is the receipt). These verbs
// read that record, look for a skill of the user's own with an extension's name, and run Claude Code's own plugin
// commands in the order the stubs give them. Every write verb only prints its plan until `--yes` is given.
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { shellFreeCommand } from "../plugins/litclaude/lib/npm-invocation.mjs";
import {
  EXTENSION_SKILLS,
  MARKETPLACE_LINE,
  extensionLeftovers,
  installLine,
  sameNameSkills,
} from "../plugins/litclaude/lib/extensions-notice.mjs";

export const MARKETPLACE = "wjgoarxiv-skills";
export const DEFAULT_SOURCE = "wjgoarxiv/wjgoarxiv-skills";
export const CLI = "litclaude-ai extensions";
export const FAMILIES = Object.freeze([...new Set(Object.values(EXTENSION_SKILLS))]);
const STAMP = /^\d{8}-\d{6}$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

const pluginId = (family) => `${family}@${MARKETPLACE}`;
const idsOf = (family) => Object.keys(EXTENSION_SKILLS).filter((id) => EXTENSION_SKILLS[id] === family);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const lstat = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

const realDir = (path) => {
  const value = lstat(path);
  return Boolean(value && value.isDirectory() && !value.isSymbolicLink());
};

// Bytes under a folder, without following symlinks.
const folderBytes = (path) => {
  const value = lstat(path);
  if (!value) return 0;
  if (!value.isDirectory() || value.isSymbolicLink()) return value.size;
  let total = 0;
  for (const name of readdirSync(path)) total += folderBytes(join(path, name));
  return total;
};

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
};

const describeSource = (record) => {
  const source = record?.source ?? {};
  if (source.source === "directory" || source.source === "file") return { text: source.path, path: source.path };
  if (source.source === "github") return { text: `github ${source.repo}` };
  if (source.source === "git" || source.source === "url") return { text: source.url };
  return { text: JSON.stringify(source) };
};

/** Everything the verbs read: the host's marketplace and plugin records, same-name skills and backups. */
export const readExtensionsState = ({ claudeHome, cwd, home = homedir() }) => {
  const known = readJson(join(claudeHome, "plugins", "known_marketplaces.json")) ?? {};
  const registry = readJson(join(claudeHome, "plugins", "installed_plugins.json"))?.plugins ?? {};
  const record = known[MARKETPLACE];
  let marketplace = null;
  if (record) {
    const source = describeSource(record);
    marketplace = { source: source.text, path: source.path ?? null, missing: Boolean(source.path) && !lstat(source.path) };
  }
  const installed = {};
  for (const family of FAMILIES) {
    const entries = registry[pluginId(family)];
    if (Array.isArray(entries) && entries.length > 0) {
      installed[family] = entries.map((entry) => ({
        scope: entry.scope ?? "user",
        version: entry.version ?? "unknown",
        installedAt: entry.installedAt ?? null,
        installPath: entry.installPath ?? null,
        missing: typeof entry.installPath === "string" && !lstat(entry.installPath),
      }));
    }
  }
  const sameName = sameNameSkills({ claudeHome, cwd, home });
  const extensions = Object.entries(EXTENSION_SKILLS).map(([id, family]) => {
    const install = installed[family] ?? [];
    const others = sameName.filter((row) => row.id === id);
    const state = install.length > 0 ? (others.length > 0 ? "competing" : "installed") : others.length > 0 ? "user-managed" : "not installed";
    return { id, plugin: family, state, install, others };
  });
  return { marketplace, installed, extensions, sameName, backups: listBackups({ claudeHome, cwd }) };
};

/** Dated backup folders under `<claude home>/extension-backups` and `<project>/.claude/extension-backups`. */
export const listBackups = ({ claudeHome, cwd, now = Date.now() }) => {
  const parents = [join(claudeHome, "extension-backups")];
  if (cwd) {
    const project = join(cwd, ".claude", "extension-backups");
    const same = (() => {
      try {
        return realpathSync(project) === realpathSync(parents[0]);
      } catch {
        return false;
      }
    })();
    if (!same && project !== parents[0]) parents.push(project);
  }
  const rows = [];
  for (const parent of parents) {
    if (!realDir(parent)) continue;
    for (const name of readdirSync(parent).sort()) {
      const path = join(parent, name);
      const value = lstat(path);
      const dated = STAMP.test(name) && value.isDirectory() && !value.isSymbolicLink();
      const ageDays = Math.floor((now - value.mtimeMs) / DAY_MS);
      rows.push({ path, name, dated, bytes: dated ? folderBytes(path) : 0, ageDays, contents: dated ? readdirSync(path) : [] });
    }
  }
  return rows;
};

/** What `check` reports: problems that need action (each with its fix line) and notes that do not. */
export const checkExtensions = ({ claudeHome, cwd, home = homedir(), litHome, cacheHome, currentVersion }) => {
  const state = readExtensionsState({ claudeHome, cwd, home });
  const problems = [];
  for (const row of state.sameName) {
    const installed = Boolean(state.installed[row.plugin]);
    problems.push({
      kind: installed ? "competing" : "user-managed",
      text: installed
        ? `${row.shown} competes with ${row.plugin}:${row.id}; Claude Code loads both`
        : `${row.shown} is a skill of your own with the name of an extension; it would compete with ${row.plugin}:${row.id}`,
      fix: row.move,
    });
  }
  if (state.marketplace?.missing) {
    problems.push({
      kind: "source-missing",
      text: `the ${MARKETPLACE} marketplace points at ${state.marketplace.path}, which no longer exists`,
      fix: MARKETPLACE_LINE,
    });
  }
  for (const [family, entries] of Object.entries(state.installed)) {
    for (const entry of entries.filter((item) => item.missing)) {
      problems.push({
        kind: "install-missing",
        text: `${pluginId(family)} is recorded at ${entry.installPath}, which no longer exists`,
        fix: `claude plugin uninstall ${pluginId(family)} && ${installLine(family)}`,
      });
    }
  }
  const notes = [];
  const dated = state.backups.filter((row) => row.dated);
  if (dated.length > 0) {
    const bytes = dated.reduce((sum, row) => sum + row.bytes, 0);
    notes.push({ text: `${dated.length} backup folder(s) in extension-backups, ${formatBytes(bytes)}`, fix: `${CLI} prune-backups` });
  }
  if (litHome && cacheHome && currentVersion) {
    for (const row of extensionLeftovers({ claudeHome, litHome, cacheHome, currentVersion, home })) {
      notes.push({ text: `left by an older LitClaude: ${row}` });
    }
  }
  return { ...state, problems, notes };
};

const VERBS = new Set(["list", "check", "install", "update", "remove", "prune-backups"]);

const usageText = `Usage: ${CLI} <list|check|install|update|remove|prune-backups> [...]
  list [--json]                     each extension: installed, not installed, or a skill of your own
  check [--json]                    what needs action, with the line that fixes it (exit 1 when something does)
  install <id|plugin...|--all>      add the shelf if needed, then claude plugin install
  update [<id|plugin...>|--all]     refresh the shelf, then claude plugin update each installed plugin
  remove <id|plugin...>             claude plugin uninstall; never touches a skill folder of your own
  prune-backups [--older-than <days>]  list dated backups in extension-backups; delete them with --yes
Write verbs only print their plan; add --yes to run it. --from <path> uses a local wjgoarxiv-skills clone,
and --allow-shadow lets install go on beside a same-name skill of your own (with a warning).
`;

export const parseExtensionsArgs = (args) => {
  const options = { verb: args[0], targets: [], all: false, yes: false, json: false, from: null, allowShadow: false, olderThan: null };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--dry-run" || arg === "--dry-run=true") options.yes = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--allow-shadow") options.allowShadow = true;
    else if (arg === "--from") options.from = value();
    else if (arg === "--family") options.targets.push(value());
    else if (arg === "--older-than") {
      const days = Number(value());
      if (!Number.isInteger(days) || days < 0) throw new Error("--older-than takes a whole number of days");
      options.olderThan = days;
    } else if (arg.startsWith("-")) throw new Error(`Unknown extensions option: ${arg}`);
    else options.targets.push(arg);
  }
  return options;
};

/** Plugins named by extension ids or plugin names; an unknown name is an error. */
export const resolveFamilies = (targets) => {
  const families = [];
  for (const target of targets) {
    const family = FAMILIES.includes(target) ? target : EXTENSION_SKILLS[target];
    if (!family) throw new Error(`Unknown extension: ${target}. Extensions: ${Object.keys(EXTENSION_SKILLS).join(", ")}; plugins: ${FAMILIES.join(", ")}`);
    if (!families.includes(family)) families.push(family);
  }
  return families;
};

const runHost = (args, { env, cwd }) => {
  const invocation = shellFreeCommand("claude", args, { env });
  const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8", env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.error ? null : result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(), error: result.error };
};

const hostAvailable = (context) => {
  const result = runHost(["--version"], context);
  return !result.error && result.status === 0;
};

const gitAvailable = ({ env }) => !spawnSync("git", ["--version"], { env, stdio: "ignore" }).error;

const fromHint = (verb = "install") => `Without network access, point the shelf at a local clone instead: ${CLI} ${verb}${verb === "install" ? " <plugin>" : ""} --from <path to a wjgoarxiv-skills clone>`;

// The marketplace step: `--from` (re)points the shelf at a local clone; otherwise the public shelf is added once.
const planMarketplace = (state, options, out) => {
  if (options.from) {
    const path = resolve(options.from);
    const catalog = readJson(join(path, ".claude-plugin", "marketplace.json"));
    if (catalog?.name !== MARKETPLACE) {
      return { error: `--from ${path} is not a ${MARKETPLACE} clone (no .claude-plugin/marketplace.json named ${MARKETPLACE})` };
    }
    if (state.marketplace?.path && resolve(state.marketplace.path) === path) return { steps: [] };
    if (state.marketplace) out.push(`  The ${MARKETPLACE} marketplace now reads from ${state.marketplace.source}; this points it at ${path}.`);
    return { steps: [["plugin", "marketplace", "add", path]] };
  }
  if (state.marketplace?.missing) {
    return { error: `The ${MARKETPLACE} marketplace points at ${state.marketplace.path}, which no longer exists.\n${fromHint(options.verb)}` };
  }
  if (state.marketplace) return { steps: [] };
  return { steps: [["plugin", "marketplace", "add", DEFAULT_SOURCE]], needsGit: true };
};

const shownLine = (args) => `claude ${args.map((arg) => (/^[\w@./:=+-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`)).join(" ")}`;

const runSteps = (steps, context, write) => {
  for (const step of steps) {
    write(`  running: ${shownLine(step)}`);
    const result = runHost(step, context);
    if (result.status !== 0) {
      if (result.output) write(result.output.split("\n").map((line) => `    ${line}`).join("\n"));
      return { failed: step, output: result.output };
    }
    if (result.output) write(`    ${result.output.split("\n").filter(Boolean).at(-1)}`);
  }
  return { failed: null };
};

const listLines = (state) => {
  const lines = [
    "LitFamily extensions (Claude Code plugins from the wjgoarxiv-skills marketplace)",
    `  Marketplace: ${state.marketplace ? `${MARKETPLACE} from ${state.marketplace.source}${state.marketplace.missing ? " (missing)" : ""}` : "not added"}`,
  ];
  for (const row of state.extensions) {
    const head = `  ${row.id.padEnd(30)} ${row.plugin.padEnd(13)}`;
    if (row.install.length === 0) lines.push(`${head}${row.state === "user-managed" ? "not installed; a skill of your own has this name" : "not installed"}`);
    for (const entry of row.install) {
      lines.push(`${head}installed ${entry.version} (${entry.scope}${entry.installedAt ? `, ${entry.installedAt.slice(0, 10)}` : ""})${entry.missing ? " - its folder is gone" : ""}`);
    }
    for (const other of row.others) lines.push(`${" ".repeat(47)}${row.state === "competing" ? "competes with" : "your own skill:"} ${other.shown} (${other.scope})`);
  }
  return lines;
};

export const runExtensionsCli = (args, {
  env = process.env, cwd = process.cwd(), claudeHome, litHome, cacheHome, currentVersion,
  stdout = process.stdout, stderr = process.stderr,
} = {}) => {
  const home = env.HOME || homedir();
  const write = (line = "") => stdout.write(`${line}\n`);
  const warn = (line) => stderr.write(`${line}\n`);
  let options;
  try {
    options = parseExtensionsArgs(args);
  } catch (error) {
    warn(error.message);
    return 64;
  }
  if (!VERBS.has(options.verb)) {
    if (options.verb && !["help", "--help", "-h"].includes(options.verb)) warn(`Unknown extensions verb: ${options.verb}`);
    stdout.write(usageText);
    return options.verb && !["help", "--help", "-h"].includes(options.verb) ? 64 : 0;
  }
  const context = { env, cwd };

  if (options.verb === "list") {
    const state = readExtensionsState({ claudeHome, cwd, home });
    if (options.json) {
      write(JSON.stringify({ marketplace: state.marketplace, extensions: state.extensions.map(({ others, ...row }) => ({ ...row, others: others.map(({ scope, path, move }) => ({ scope, path, move })) })) }, null, 2));
    } else {
      for (const line of listLines(state)) write(line);
      write(`  Change them with: ${CLI} install|update|remove <plugin> (prints its plan; --yes runs it)`);
    }
    return 0;
  }

  if (options.verb === "check") {
    const result = checkExtensions({ claudeHome, cwd, home, litHome, cacheHome, currentVersion });
    if (options.json) {
      write(JSON.stringify({ ok: result.problems.length === 0, problems: result.problems, notes: result.notes }, null, 2));
      return result.problems.length === 0 ? 0 : 1;
    }
    write("LitFamily extensions check");
    if (result.problems.length === 0) write("  Nothing needs action.");
    for (const problem of result.problems) {
      write(`  NEEDS ACTION: ${problem.text}`);
      write(`    fix: ${problem.fix}`);
    }
    for (const note of result.notes) write(`  note: ${note.text}${note.fix ? ` (${note.fix})` : ""}`);
    return result.problems.length === 0 ? 0 : 1;
  }

  if (options.verb === "prune-backups") {
    const rows = listBackups({ claudeHome, cwd });
    const chosen = rows.filter((row) => row.dated && (options.olderThan === null || row.ageDays >= options.olderThan));
    write(`LitFamily extension backups${options.olderThan === null ? "" : ` older than ${options.olderThan} day(s)`}`);
    if (rows.length === 0) write("  No backups.");
    for (const row of rows) {
      if (!row.dated) write(`  left alone (not a dated backup folder): ${row.path}`);
      else write(`  ${chosen.includes(row) ? "" : "kept (newer): "}${row.path}  ${formatBytes(row.bytes)}, ${row.ageDays} day(s) old${row.contents.length ? `, holds ${row.contents.join(", ")}` : ""}`);
    }
    const bytes = chosen.reduce((sum, row) => sum + row.bytes, 0);
    if (chosen.length === 0) return 0;
    if (!options.yes) {
      write(`  Would delete ${chosen.length} folder(s), ${formatBytes(bytes)}. Nothing changed; add --yes to delete them.`);
      return 0;
    }
    for (const row of chosen) {
      // Look again right before deleting: still a real folder directly inside an extension-backups folder.
      if (!realDir(row.path)) continue;
      rmSync(row.path, { recursive: true, force: false });
      write(`  deleted ${row.path}`);
    }
    write(`  Freed ${formatBytes(bytes)}.`);
    return 0;
  }

  let families;
  try {
    families = resolveFamilies(options.targets);
  } catch (error) {
    warn(error.message);
    return 64;
  }
  const state = readExtensionsState({ claudeHome, cwd, home });
  if (options.all) families = options.verb === "install" ? [...FAMILIES] : Object.keys(state.installed);
  if (options.verb === "update" && families.length === 0 && options.targets.length === 0) families = Object.keys(state.installed);
  if (families.length === 0) {
    if (options.verb === "update") {
      write("No LitFamily extension is installed, so there is nothing to update.");
      return 0;
    }
    warn(`Name what to ${options.verb}: an extension id or a plugin (${FAMILIES.join(", ")})${options.verb === "install" ? ", or --all" : ""}.`);
    return 64;
  }

  const plan = [];
  const notes = [];

  if (options.verb === "remove") {
    let refused = false;
    for (const family of families) {
      const entries = state.installed[family] ?? [];
      const own = state.sameName.filter((row) => row.plugin === family && options.targets.some((target) => target === row.id || target === family));
      for (const row of own) {
        warn(`Refused: ${row.shown} is a skill of your own, not a plugin LitClaude or Claude Code installed; it stays where it is.`);
        refused = true;
      }
      if (entries.length === 0) {
        if (own.length === 0) notes.push(`  ${pluginId(family)} is not installed.`);
        continue;
      }
      for (const entry of entries) {
        plan.push(entry.scope === "user" ? ["plugin", "uninstall", pluginId(family)] : ["plugin", "uninstall", pluginId(family), "--scope", entry.scope]);
      }
      const siblings = idsOf(family);
      if (siblings.length > 1) notes.push(`  ${pluginId(family)} carries ${siblings.join(", ")}; removing it removes all of them.`);
    }
    return finish({ verb: "remove", plan, notes, options, context, write, warn, claudeHome, cwd, home, families, exitOnRefuse: refused });
  }

  // install and update both start at the shelf.
  const blockers = state.sameName.filter((row) => families.includes(row.plugin));
  if (blockers.length > 0 && options.verb === "install") {
    const lines = blockers.flatMap((row) => [`    ${row.shown} would compete with ${row.plugin}:${row.id}`, `      ${row.move}`]);
    if (!options.allowShadow) {
      warn("Stopped: a skill of your own has the name of an extension, and Claude Code would load both.");
      warn("Move it whole into a dated folder Claude Code does not read, then run this again (or add --allow-shadow to keep both):");
      for (const line of lines) warn(line);
      return 1;
    }
    warn("Warning: these skills of your own will load beside the extension and compete with it (--allow-shadow):");
    for (const line of lines) warn(line);
  } else if (blockers.length > 0) {
    warn(`Note: ${blockers.map((row) => row.shown).join(", ")} still competes with the extension; see ${CLI} check.`);
  }

  if (options.verb === "update" && !state.marketplace && !options.from) {
    warn(`The ${MARKETPLACE} marketplace is not added, so nothing can be updated. Install first: ${CLI} install <plugin>`);
    return 1;
  }
  const shelf = planMarketplace(state, options, notes);
  if (shelf.error) {
    warn(shelf.error);
    return 1;
  }
  if (shelf.needsGit && !gitAvailable(context)) {
    warn(`git is not installed, and Claude Code needs it to fetch the ${MARKETPLACE} marketplace from GitHub.\n${fromHint(options.verb)}`);
    return 1;
  }
  plan.push(...shelf.steps);

  if (options.verb === "install") {
    for (const family of families) {
      if (state.installed[family]) notes.push(`  ${pluginId(family)} is already installed (${state.installed[family][0].version}); use ${CLI} update.`);
      else plan.push(["plugin", "install", pluginId(family)]);
    }
  } else {
    if (shelf.steps.length === 0) plan.push(["plugin", "marketplace", "update", MARKETPLACE]);
    for (const family of families) {
      if (!state.installed[family]) notes.push(`  ${pluginId(family)} is not installed; use ${CLI} install ${family}.`);
      else plan.push(["plugin", "update", pluginId(family)]);
    }
  }
  return finish({ verb: options.verb, plan, notes, options, context, write, warn, claudeHome, cwd, home, families, before: state, shelfStep: shelf.steps.length > 0 });
};

function finish({ verb, plan, notes, options, context, write, warn, claudeHome, cwd, home, families, before, shelfStep, exitOnRefuse = false }) {
  write(`LitFamily extensions ${verb}`);
  for (const note of notes) write(note);
  const pluginSteps = plan.filter((step) => step[1] !== "marketplace");
  if (pluginSteps.length === 0) {
    write("  Nothing to run.");
    return exitOnRefuse ? 1 : 0;
  }
  if (!options.yes) {
    write("  Would run, in this order:");
    for (const step of plan) write(`    ${shownLine(step)}`);
    write("  Nothing changed. Add --yes to run these.");
    return exitOnRefuse ? 1 : 0;
  }
  if (!hostAvailable(context)) {
    warn("Claude Code (`claude`) is not on PATH, so LitClaude cannot run its plugin commands. Nothing changed.");
    return 1;
  }
  const result = runSteps(plan, context, write);
  if (result.failed) {
    const shelfFailed = result.failed[1] === "marketplace";
    warn(`Stopped: \`${shownLine(result.failed)}\` failed${shelfFailed ? ", so no plugin was installed or updated" : ""}.`);
    if (shelfFailed && !options.from) warn(fromHint(verb));
    return 1;
  }
  const after = readExtensionsState({ claudeHome, cwd, home });
  let changed = verb === "install";
  for (const family of families) {
    const now = after.installed[family]?.[0];
    if (verb === "remove") write(now ? `  ${pluginId(family)} is still recorded; see claude plugin list.` : `  removed ${pluginId(family)}`);
    else if (verb === "install") {
      if (now) write(`  installed ${pluginId(family)} ${now.version}`);
    } else if (now) {
      const was = before.installed[family]?.[0]?.version;
      if (was !== now.version) changed = true;
      write(was && was !== now.version ? `  updated ${pluginId(family)} ${was} -> ${now.version}` : `  current ${pluginId(family)} ${now.version}`);
    }
  }
  if (changed) write("  The change loads after /reload-plugins or in a new session.");
  if (shelfStep && verb === "update") write(`  The shelf now reads from ${after.marketplace?.source}.`);
  return exitOnRefuse ? 1 : 0;
}

/** One doctor line: what is installed and whether `check` finds anything. */
export const extensionsDoctorLine = (input) => {
  const result = checkExtensions(input);
  const installed = Object.keys(result.installed);
  const head = `EXTENSIONS: ${installed.length === 0 ? "none installed" : `installed ${installed.join(", ")}`}`;
  return result.problems.length === 0
    ? `${head}; nothing needs action (${CLI} list)`
    : `${head}; ${result.problems.length} need(s) action - run ${CLI} check`;
};

export { usageText as extensionsUsage };
