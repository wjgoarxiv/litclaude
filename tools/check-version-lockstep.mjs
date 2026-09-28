#!/usr/bin/env node
// tools/check-version-lockstep.mjs — DEC-E version-lockstep gate.
// Reads package.json version, the plugin manifest, the plugin-local MCP server,
// and every classified version-bearing file.
// (Plugin dir stays plugins/litclaude/ until T08 renames it — do NOT rename here.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VALID_KINDS = new Set(['pinned', 'history', 'derived', 'compatibility']);

function readJson(rel) {
  const abs = resolve(ROOT, rel);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    process.stderr.write('[check-version-lockstep] cannot read ' + rel + ': ' + err.message + '\n');
    process.exit(1);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/gu, '\\$&');
}

function versionPatterns(version) {
  return [version, version.replace(/\./gu, '\\.')];
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function countVersion(haystack, version) {
  const [literal, escaped] = versionPatterns(version);
  // The escaped spelling does not contain the plain literal, so these counts do not overlap.
  return countOccurrences(haystack, literal) + countOccurrences(haystack, escaped);
}

function insideRoot(abs) {
  const fromRoot = relative(ROOT, abs);
  return fromRoot !== '..' && !fromRoot.startsWith('..' + sep) && fromRoot !== '';
}

const pkg = readJson('package.json');
const plugin = readJson('plugins/litclaude/.claude-plugin/plugin.json');
const registry = readJson('tools/version-manifests.json');
const mcpServer = readFileSync(resolve(ROOT, 'plugins/litclaude/bin/litclaude-mcp.js'), 'utf8');

const pkgVer = pkg.version;
const pluginVer = plugin.version;
const mcpServerVer = mcpServer.match(/const serverVersion = "([^"]+)";/u)?.[1];

if (typeof pkgVer !== 'string' || !/^\d+\.\d+\.\d+$/u.test(pkgVer)) {
  process.stderr.write('version lockstep: package.json version is not a plain release semver: ' + String(pkgVer) + '\n');
  process.exit(2);
}

const failures = [];
if (pkgVer !== pluginVer || pkgVer !== mcpServerVer) {
  failures.push(
    '[LITCLAUDE_VERSION_MISMATCH] package.json version (' + pkgVer + ') !== plugin.json version (' + pluginVer + ')' +
      ' or MCP server version (' + (mcpServerVer ?? 'missing') + ')',
  );
}

if (!registry || !Array.isArray(registry.manifests)) {
  process.stderr.write('version lockstep: tools/version-manifests.json must contain a manifests array\n');
  process.exit(2);
}

const seen = new Set();

for (const entry of registry.manifests) {
  const path = entry?.path;
  if (typeof path !== 'string' || path.length === 0) {
    failures.push('registry entry has no relative path');
    continue;
  }
  if (seen.has(path)) {
    failures.push(path + ': duplicate registry entry');
    continue;
  }
  seen.add(path);

  const absolute = resolve(ROOT, path);
  if (!insideRoot(absolute)) {
    failures.push(path + ': registry path escapes the product root');
    continue;
  }
  if (!VALID_KINDS.has(entry.kind)) {
    failures.push(path + ": unsupported registry kind '" + entry.kind + "'");
    continue;
  }
  if (!Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
    failures.push(path + ': occurrences must be a positive integer');
    continue;
  }

  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error) {
    failures.push(path + ': cannot read (' + (error.code ?? error.message) + ')');
    continue;
  }

  if (entry.kind === 'history') {
    const heading = new RegExp('^##\\s+' + escapeRegExp(pkgVer) + '(?:\\s|$)', 'mu');
    if (!heading.test(text)) failures.push(path + ': no release heading for the current package version');
    continue;
  }

  const countedVersion = entry.kind === 'compatibility' ? entry.version : pkgVer;
  if (typeof countedVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(countedVersion)) {
    failures.push(path + ': compatibility version must be a plain release semver');
    continue;
  }
  let incidentalCount = 0;
  if (entry.incidental !== undefined) {
    if (entry.kind !== 'pinned' || !Array.isArray(entry.incidental)) {
      failures.push(path + ': incidental anchors require a pinned entry and an array');
      continue;
    }
    const anchors = new Set();
    for (const anchor of entry.incidental) {
      if (typeof anchor?.text !== 'string' || !anchor.text.trim() || anchors.has(anchor.text) ||
          !Number.isInteger(anchor.occurrences) || anchor.occurrences < 1 ||
          typeof anchor.why !== 'string' || !anchor.why.trim()) {
        failures.push(path + ': invalid or duplicate incidental anchor');
        continue;
      }
      anchors.add(anchor.text);
      if (countOccurrences(text, anchor.text) !== anchor.occurrences) {
        failures.push(path + ': incidental fixture drift — ' + anchor.why);
      }
      incidentalCount += countVersion(anchor.text, countedVersion) * anchor.occurrences;
    }
  }
  const actual = countVersion(text, countedVersion);
  const expected = entry.occurrences + incidentalCount;
  if (actual !== expected) {
    failures.push(
      path + ': expected ' + expected + ' occurrence(s) of ' + countedVersion + ', found ' + actual + ' — ' + entry.why,
    );
    continue;
  }

}

if (failures.length > 0) {
  process.stderr.write('version lockstep FAILED against package.json ' + pkgVer + ':\n');
  for (const failure of failures) process.stderr.write('  - ' + failure + '\n');
  process.stderr.write('\n' + failures.length + ' disagreement(s). Every pinned site must move in one pass.\n');
  process.exit(1);
}

process.stdout.write('version-lockstep OK: ' + registry.manifests.length + ' manifests agree on ' + pkgVer + '\n');
