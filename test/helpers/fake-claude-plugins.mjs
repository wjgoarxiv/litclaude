#!/usr/bin/env node
// A stand-in for the `claude plugin` commands the extensions verbs run, for tests in a throwaway HOME. It keeps
// the two records Claude Code keeps (known_marketplaces.json, installed_plugins.json) and copies a plugin into
// plugins/cache/<marketplace>/<plugin>/<version>, as the real host did in the isolated-HOME probe. A GitHub
// source always fails like an offline clone. Every call is appended to $FAKE_CLAUDE_LOG.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const home = process.env.CLAUDE_CONFIG_DIR;
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${args.join(" ")}\n`);
const read = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const save = (path, value) => {
  mkdirSync(join(home, "plugins"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const knownPath = join(home, "plugins", "known_marketplaces.json");
const registryPath = join(home, "plugins", "installed_plugins.json");
const die = (message) => {
  process.stderr.write(`✘ ${message}\n`);
  process.exit(1);
};
const versionAt = (dir) => JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).version;
const pluginDir = (marketplace, name) => {
  const known = read(knownPath, {})[marketplace];
  if (!known) die(`Plugin "${name}" not found in marketplace "${marketplace}"`);
  if (!existsSync(known.source.path)) die(`Marketplace "${marketplace}" source is missing`);
  const catalog = read(join(known.source.path, ".claude-plugin", "marketplace.json"), { plugins: [] });
  const entry = catalog.plugins.find((plugin) => plugin.name === name);
  if (!entry) die(`Plugin "${name}" not found in marketplace "${marketplace}"`);
  return resolve(known.source.path, entry.source);
};
const copyIn = (marketplace, name, registry) => {
  const source = pluginDir(marketplace, name);
  const version = versionAt(source);
  const target = join(home, "plugins", "cache", marketplace, name, version);
  cpSync(source, target, { recursive: true });
  const now = new Date().toISOString();
  const old = registry.plugins[`${name}@${marketplace}`]?.[0];
  registry.plugins[`${name}@${marketplace}`] = [{ scope: "user", installPath: target, version, installedAt: old?.installedAt ?? now, lastUpdated: now }];
  save(registryPath, registry);
  return { version, old: old?.version };
};

const [top, verb, sub, target] = args;
if (top === "--version") {
  process.stdout.write("2.1.322 (Claude Code)\n");
} else if (top === "plugin" && verb === "marketplace" && sub === "add") {
  if (!existsSync(target)) die(`Failed to add marketplace: Failed to clone marketplace repository: could not read ${target}`);
  const name = read(join(target, ".claude-plugin", "marketplace.json"), {}).name;
  const known = read(knownPath, {});
  known[name] = { source: { source: "directory", path: resolve(target) }, installLocation: resolve(target), lastUpdated: new Date().toISOString() };
  save(knownPath, known);
  process.stdout.write(`✔ Successfully added marketplace: ${name}\n`);
} else if (top === "plugin" && verb === "marketplace" && sub === "update") {
  const known = read(knownPath, {})[target];
  if (!known || !existsSync(known.source.path)) die(`Failed to update marketplace ${target}`);
  process.stdout.write(`✔ Successfully updated marketplace: ${target}\n`);
} else if (top === "plugin" && (verb === "install" || verb === "update")) {
  const [name, marketplace] = sub.split("@");
  const registry = read(registryPath, { version: 2, plugins: {} });
  const installed = registry.plugins[sub]?.[0];
  if (verb === "update" && !installed) die(`Failed to update plugin "${sub}": Plugin "${name}" is not installed`);
  if (verb === "install" && installed) {
    process.stdout.write(`✔ Plugin "${sub}" is already installed\n`);
  } else if (verb === "update" && versionAt(pluginDir(marketplace, name)) === installed.version) {
    process.stdout.write(`${sub} is already at the latest version (${installed.version}).\n`);
  } else {
    const { version, old } = copyIn(marketplace, name, registry);
    process.stdout.write(verb === "install" ? `✔ Successfully installed plugin: ${sub} (scope: user)\n` : `✔ Plugin ${name} updated from ${old} to ${version}\n`);
  }
} else if (top === "plugin" && verb === "uninstall") {
  const registry = read(registryPath, { version: 2, plugins: {} });
  if (!registry.plugins[sub]) die(`Failed to uninstall plugin "${sub}": not found in installed plugins`);
  delete registry.plugins[sub];
  save(registryPath, registry);
  process.stdout.write(`✔ Successfully uninstalled plugin: ${sub.split("@")[0]} (scope: user)\n`);
} else {
  die(`fake claude: unsupported ${args.join(" ")}`);
}
