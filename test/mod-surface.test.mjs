import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MOD_PAYLOAD_PATHS } from "../tools/check-pack-payload.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const read = (path) => readFileSync(path, "utf8");
const ENTRY_POINTS = ["hooks/lit-mod.mjs", "hooks/lit-band-client.mjs"];

// Every file the mod loads, found by following its static imports from the hooks module and the
// band's surface module.
const modClosure = () => {
  const seen = new Map();
  const visit = (absolute) => {
    if (seen.has(absolute)) return;
    const text = read(absolute);
    seen.set(absolute, text);
    for (const [, specifier] of text.matchAll(/^\s*(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/gmu)) {
      if (specifier === "claude-code") continue;
      assert.ok(specifier.startsWith("./") || specifier.startsWith("../"), `${relative(pluginRoot, absolute)} imports ${specifier}; a mod may import only its own files and 'claude-code'`);
      const target = resolve(dirname(absolute), specifier);
      assert.ok(target.startsWith(`${pluginRoot}/`), `${specifier} leaves the plugin`);
      assert.ok(existsSync(target), `${specifier} is missing`);
      visit(target);
    }
  };
  for (const entry of ENTRY_POINTS) visit(join(pluginRoot, entry));
  return seen;
};

test("hooks.json names the mod next to every settings hook, so one file serves old and new Claude Code", () => {
  const hooks = JSON.parse(read(join(pluginRoot, "hooks", "hooks.json")));
  assert.deepEqual(hooks.modules, ["./lit-mod.mjs"]);
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStart", "SubagentStop", "SessionEnd"]) {
    assert.ok(Array.isArray(hooks.hooks[event]), `settings hook ${event} must stay`);
  }
  assert.equal(existsSync(join(pluginRoot, "hooks", "lit-mod.mjs")), true);
});

test("the band's options are plain strings: an options list would stop Claude Code 2.1.270 and older loading LitClaude", () => {
  const manifest = JSON.parse(read(join(pluginRoot, ".claude-plugin", "plugin.json")));
  const config = manifest.userConfig;
  assert.deepEqual(Object.keys(config).sort(), ["band", "glyphs", "motion", "notify"]);
  assert.deepEqual(Object.fromEntries(Object.entries(config).map(([key, field]) => [key, field.default])), { motion: "full", glyphs: "auto", band: "always", notify: "off" });
  for (const [key, field] of Object.entries(config)) {
    assert.equal(field.type, "string", key);
    assert.equal("options" in field, false, `${key} must not declare options`);
    assert.equal(field.sensitive ?? false, false, key);
    assert.deepEqual(Object.keys(field).sort(), ["default", "description", "title", "type"], `${key} keeps to the keys every Claude Code release accepts`);
    assert.ok(field.description.length > 20, key);
  }
});

test("the mod keeps to the static rules: own files only, no dynamic import, no Node", () => {
  const closure = modClosure();
  for (const [path, text] of closure) {
    const name = relative(pluginRoot, path);
    assert.doesNotMatch(text, /\bimport\s*\(/u, `${name} must not use a dynamic import`);
    assert.doesNotMatch(text, /from\s+["']node:/u, `${name} must not import Node built-ins`);
    assert.doesNotMatch(text, /\brequire\s*\(/u, `${name} has no require`);
    assert.doesNotMatch(text, /\bprocess\.(?:env|argv|cwd)/u, `${name} reaches the environment only through $`);
  }
  const hooksModule = closure.get(join(pluginRoot, "hooks", "lit-mod.mjs"));
  assert.doesNotMatch(hooksModule, /const\s*\{[^}]*\}\s*=\s*\$\s*[;\n]/u, "$ is never destructured; each call is spelled $.noun.method");
  assert.match(hooksModule, /module: "\.\/lit-band-client\.mjs"/u, "the Client module is a string literal");
});

test("the mod is read-only: no writes, processes, network, model calls or prompts", () => {
  const closure = modClosure();
  const forbidden = /\$\.(?:fs\.write|process\.|http\.|model\.|store\.(?:set|delete)|env\.set|prompt\.(?:submit|fill)|session\.(?:append|send|compact)|tool\.call|agent\.spawn|mcp\.|audio\.)/u;
  for (const [path, text] of closure) assert.doesNotMatch(text, forbidden, relative(pluginRoot, path));
  const calls = new Set([...closure.values()].flatMap((text) => [...text.matchAll(/\$\.([a-z]+\.[a-zA-Z]+)/gu)].map((match) => match[1])));
  assert.deepEqual([...calls].sort(), [
    "agent.list",
    "clock.after",
    "clock.every",
    "clock.now",
    "command.register",
    "env.get",
    "fs.list",
    "fs.read",
    "fs.stat",
    "session.cwd",
    "session.id",
    "session.usage",
    "settings.read",
    "ui.invalidate",
    "ui.notify",
    "ui.open",
    "ui.resolve",
    "ui.toast",
  ]);
});

test("every file the mod loads ships and is guarded by the pack check and the installer", () => {
  const closure = [...modClosure().keys()].map((path) => `plugins/litclaude/${relative(pluginRoot, path)}`).sort();
  assert.deepEqual([...MOD_PAYLOAD_PATHS].sort(), closure);
  const installer = read(join(root, "bin", "litclaude-ai.js"));
  for (const entry of ENTRY_POINTS) {
    assert.equal(installer.split(`"${entry}"`).length - 1, 2, `${entry} is verified after install and by doctor`);
  }
  const packageJson = JSON.parse(read(join(root, "package.json")));
  assert.ok(packageJson.files.includes("plugins"), "the plugin folder is in the files allowlist");
});

test("the hooks docs explain the band, its options and the older-release behaviour", () => {
  const docs = read(join(root, "docs", "hooks.md"));
  for (const phrase of ["lit-mod.mjs", "/lit-evidence", "motion", "glyphs", "band", "2.1.287", "read-only"]) assert.match(docs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&"), "u"), phrase);
});
