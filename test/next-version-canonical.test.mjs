import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const frontendRoot = join(pluginRoot, "skills", "frontend-ui-ux", "references");
const manifestPath = join(frontendRoot, "_canonical-corpus", "manifest.json");
const checkoutClaudeProfileExisted = existsSync(join(root, ".claude"));
const maxCanonicalFileBytes = 8 * 1024 * 1024;

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));

function runHook(prompt) {
  const result = spawnSync(process.execPath, [join(pluginRoot, "bin", "litclaude-hook.js"), "user-prompt-submit"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, cwd: root }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

function copyFrontendFixture() {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-canonical-frontend-"));
  const target = join(temp, "skills", "frontend-ui-ux", "references");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(frontendRoot, target, { recursive: true, preserveTimestamps: true });
  return { temp, target };
}

function copyCanonicalPluginFixture(prefix = "litclaude-canonical-plugin-") {
  const temp = mkdtempSync(join(tmpdir(), prefix));
  const target = join(temp, "plugin");
  mkdirSync(target, { recursive: true });
  cpSync(join(pluginRoot, "skills"), join(target, "skills"), { recursive: true, preserveTimestamps: true });
  cpSync(join(pluginRoot, "commands"), join(target, "commands"), { recursive: true, preserveTimestamps: true });
  cpSync(join(pluginRoot, "vendor"), join(target, "vendor"), { recursive: true, preserveTimestamps: true });
  return { temp, target };
}

function assertImmutableExpectedMap(expectedFiles, expectedSize) {
  assert.equal(expectedFiles instanceof Map, true);
  assert.equal(Object.isFrozen(expectedFiles), true);
  assert.equal(expectedFiles.size, expectedSize);
  const [path, expected] = expectedFiles.entries().next().value;
  assert.equal(typeof path, "string");
  assert.deepEqual(Object.keys(expected).sort(), ["executable", "sha256", "size"]);
  assert.equal(expected.executable, false);
  assert.equal(Object.isFrozen(expected), true);
  assert.throws(() => expectedFiles.set("unexpected", { size: 0, sha256: "0".repeat(64) }), /immutable/iu);
  assert.throws(() => expectedFiles.delete(path), /immutable/iu);
  assert.throws(() => expectedFiles.clear(), /immutable/iu);
  assert.throws(() => expectedFiles.forEach((_value, _key, map) => {
    map.set("forEach-escape", { size: 0, sha256: "0".repeat(64) });
  }), /immutable/iu);
  assert.equal(expectedFiles.size, expectedSize);
}

function writeRestoredPrepackMutationFixture(prefix, canonicalPath) {
  const fixture = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(fixture, "tools"), { recursive: true });
  cpSync(join(root, "plugins"), join(fixture, "plugins"), { recursive: true, preserveTimestamps: true });
  cpSync(join(root, "tools", "check-pack-payload.mjs"), join(fixture, "tools", "check-pack-payload.mjs"));
  writeFileSync(join(fixture, "mutate-canonical.mjs"), `
import { readFileSync, rmSync, writeFileSync } from "node:fs";
const source = new URL(${JSON.stringify(`./${canonicalPath}`)}, import.meta.url);
const backup = new URL("./canonical-source-backup.bin", import.meta.url);
if (process.argv[2] === "prepack") {
  const bytes = readFileSync(source);
  writeFileSync(backup, bytes);
  bytes[0] ^= 1;
  writeFileSync(source, bytes);
} else {
  writeFileSync(source, readFileSync(backup));
  rmSync(backup);
}
`);
  writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
    name: prefix.replace(/-+$/u, ""),
    version: "1.0.0",
    type: "module",
    scripts: {
      prepack: "node mutate-canonical.mjs prepack",
      postpack: "node mutate-canonical.mjs postpack",
    },
    files: ["plugins"],
  })}\n`);
  return fixture;
}

function runVerifierAncestorRace(kind, verifier) {
  const fixture = copyCanonicalPluginFixture("litclaude-ancestor-race-");
  const outside = join(fixture.temp, "outside-plugin");
  cpSync(fixture.target, outside, { recursive: true, preserveTimestamps: true });
  const preload = join(fixture.temp, "swap-ancestor-after-open.mjs");
  const target = kind === "root" ? fixture.target : join(fixture.target, "vendor");
  const replacement = kind === "root" ? outside : join(outside, "vendor");
  const displaced = `${target}.displaced`;
  writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalClose = fs.closeSync;
let swapped = false;
fs.closeSync = function(descriptor, ...args) {
  const result = originalClose.call(this, descriptor, ...args);
  if (!swapped) {
    swapped = true;
    fs.renameSync(process.env.LITCLAUDE_RACE_TARGET, process.env.LITCLAUDE_RACE_DISPLACED);
    fs.symlinkSync(process.env.LITCLAUDE_RACE_REPLACEMENT, process.env.LITCLAUDE_RACE_TARGET);
  }
  return result;
};
syncBuiltinESMExports();
`);
  const moduleUrl = pathToFileURL(join(pluginRoot, "lib", verifier === "frontend" ? "canonical-frontend-corpus.mjs" : "canonical-runtime-closures.mjs")).href;
  const exportName = verifier === "frontend" ? "verifyCanonicalFrontendCorpus" : "verifyCanonicalRuntimeClosures";
  const driver = `import { ${exportName} } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(${exportName}(process.env.LITCLAUDE_PLUGIN_ROOT)));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    encoding: "utf8",
    env: {
      ...process.env,
      LITCLAUDE_PLUGIN_ROOT: fixture.target,
      LITCLAUDE_RACE_DISPLACED: displaced,
      LITCLAUDE_RACE_REPLACEMENT: replacement,
      LITCLAUDE_RACE_TARGET: target,
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true });
  }
}

function runOrdinaryScannerRace(scanKind, mutation) {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-ordinary-scan-race-"));
  const harness = mkdtempSync(join(tmpdir(), "litclaude-ordinary-scan-harness-"));
  const target = join(temp, "ordinary.md");
  const outside = join(harness, "outside.md");
  const preload = join(harness, "mutate-after-enumeration.mjs");
  const allowlist = join(temp, "tools", "legacy-token-allowlist.json");
  const terms = join(harness, "terms.json");
  mkdirSync(dirname(allowlist), { recursive: true });
  writeFileSync(target, "ordinary clean text\n");
  writeFileSync(outside, "ordinary clean text\n");
  writeFileSync(allowlist, '{"version":1,"entries":[]}\n');
  writeFileSync(terms, '{"version":1,"terms":[{"id":"witness","value":"never-present-witness","matchMode":"substring"}]}\n');
  writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalOpen = fs.openSync;
let mutated = false;
fs.openSync = function(path, ...args) {
  if (!mutated && path === process.env.LITCLAUDE_RACE_TARGET) {
    mutated = true;
    const mutation = process.env.LITCLAUDE_RACE_MUTATION;
    if (mutation === "deleted") fs.rmSync(path);
    else if (mutation === "unreadable") fs.chmodSync(path, 0o000);
    else if (mutation === "symlink-substitution") { fs.rmSync(path); fs.symlinkSync(process.env.LITCLAUDE_RACE_OUTSIDE, path); }
    else if (mutation === "same-bytes-substitution") {
      const replacement = path + ".replacement";
      fs.copyFileSync(path, replacement);
      fs.renameSync(replacement, path);
    }
  }
  return originalOpen.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
  spawnSync("git", ["init", "-q"], { cwd: temp });
  const scannerUrl = pathToFileURL(join(root, "tools", "scan-legacy-tokens.mjs")).href;
  const invocation = scanKind === "legacy"
    ? `runScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, allowlistPath: process.env.LITCLAUDE_RACE_ALLOWLIST })`
    : `runExternalTermScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, termsPath: process.env.LITCLAUDE_RACE_TERMS })`;
  const driver = `import { runScan, runExternalTermScan } from ${JSON.stringify(scannerUrl)}; process.stdout.write(JSON.stringify(${invocation}));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    cwd: temp,
    encoding: "utf8",
    env: {
      ...process.env,
      LITCLAUDE_RACE_ALLOWLIST: allowlist,
      LITCLAUDE_RACE_MUTATION: mutation,
      LITCLAUDE_RACE_OUTSIDE: outside,
      LITCLAUDE_RACE_ROOT: temp,
      LITCLAUDE_RACE_TARGET: target,
      LITCLAUDE_RACE_TERMS: terms,
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    if (existsSync(target) && !statSync(target).isSymbolicLink()) chmodSync(target, 0o644);
    rmSync(temp, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
  }
}

function runScannerAncestorRace(scanKind, ancestor) {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-scanner-ancestor-race-"));
  const harness = mkdtempSync(join(tmpdir(), "litclaude-scanner-ancestor-harness-"));
  const repo = join(temp, "repo");
  const outside = join(temp, "outside");
  const targetFile = join(repo, "ordinary", "nested", "file.md");
  const allowlist = join(repo, "tools", "legacy-token-allowlist.json");
  const terms = join(harness, "terms.json");
  const preload = join(harness, "swap-ancestor-during-open.mjs");
  mkdirSync(dirname(targetFile), { recursive: true });
  mkdirSync(dirname(allowlist), { recursive: true });
  writeFileSync(targetFile, "ordinary clean text\n");
  writeFileSync(allowlist, '{"version":1,"entries":[]}\n');
  writeFileSync(terms, '{"version":1,"terms":[{"id":"witness","value":"never-present-witness","matchMode":"substring"}]}\n');
  spawnSync("git", ["init", "-q"], { cwd: repo });
  cpSync(repo, outside, { recursive: true, preserveTimestamps: true });
  const targetAncestor = ancestor === "intermediate" ? join(repo, "ordinary") : repo;
  const replacement = ancestor === "intermediate" ? join(outside, "ordinary") : outside;
  const inventoryRacePreload = scanKind === "legacy" ? `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalExists = fs.existsSync;
let swapped = false;
fs.existsSync = function(path, ...args) {
  if (!swapped && String(path).endsWith("_canonical-corpus/manifest.json")) {
    swapped = true;
    fs.renameSync(process.env.LITCLAUDE_RACE_ANCESTOR, process.env.LITCLAUDE_RACE_DISPLACED);
    fs.renameSync(process.env.LITCLAUDE_RACE_REPLACEMENT, process.env.LITCLAUDE_RACE_ANCESTOR);
  }
  return originalExists.call(this, path, ...args);
};
syncBuiltinESMExports();
` : `
import fs from "node:fs";
const originalMap = Array.prototype.map;
let termMaps = 0;
let swapped = false;
Array.prototype.map = function(callback, ...args) {
  if (this.some?.((entry) => entry?.id === "witness" && entry?.value)) {
    termMaps += 1;
    if (!swapped && termMaps === 2) {
      swapped = true;
      fs.renameSync(process.env.LITCLAUDE_RACE_ANCESTOR, process.env.LITCLAUDE_RACE_DISPLACED);
      fs.renameSync(process.env.LITCLAUDE_RACE_REPLACEMENT, process.env.LITCLAUDE_RACE_ANCESTOR);
    }
  }
  return originalMap.call(this, callback, ...args);
};
`;
  writeFileSync(preload, ancestor === "inventory-root" ? inventoryRacePreload : `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalOpen = fs.openSync;
let swapped = false;
fs.openSync = function(path, ...args) {
  const descriptor = originalOpen.call(this, path, ...args);
  if (!swapped && path === process.env.LITCLAUDE_RACE_FILE) {
    swapped = true;
    fs.renameSync(process.env.LITCLAUDE_RACE_ANCESTOR, process.env.LITCLAUDE_RACE_DISPLACED);
    fs.symlinkSync(process.env.LITCLAUDE_RACE_REPLACEMENT, process.env.LITCLAUDE_RACE_ANCESTOR);
  }
  return descriptor;
};
syncBuiltinESMExports();
`);
  const scannerUrl = pathToFileURL(join(root, "tools", "scan-legacy-tokens.mjs")).href;
  const invocation = scanKind === "legacy"
    ? `runScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, allowlistPath: process.env.LITCLAUDE_RACE_ALLOWLIST })`
    : `runExternalTermScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, termsPath: process.env.LITCLAUDE_RACE_TERMS })`;
  const driver = `import { runScan, runExternalTermScan } from ${JSON.stringify(scannerUrl)}; process.stdout.write(JSON.stringify(${invocation}));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    cwd: harness,
    encoding: "utf8",
    env: {
      ...process.env,
      LITCLAUDE_RACE_ALLOWLIST: allowlist,
      LITCLAUDE_RACE_ANCESTOR: targetAncestor,
      LITCLAUDE_RACE_DISPLACED: `${targetAncestor}.displaced`,
      LITCLAUDE_RACE_FILE: targetFile,
      LITCLAUDE_RACE_REPLACEMENT: replacement,
      LITCLAUDE_RACE_ROOT: repo,
      LITCLAUDE_RACE_TERMS: terms,
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
  }
}

function runScannerPostReadRace(scanKind, mutation) {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-scanner-post-read-"));
  const harness = mkdtempSync(join(tmpdir(), "litclaude-scanner-post-read-harness-"));
  const first = join(temp, "a.md");
  const allowlist = join(temp, "tools", "legacy-token-allowlist.json");
  const terms = join(harness, "terms.json");
  const preload = join(harness, "mutate-after-read.mjs");
  mkdirSync(dirname(allowlist), { recursive: true });
  mkdirSync(join(temp, "late-dir"));
  writeFileSync(first, "ordinary clean text\n");
  writeFileSync(join(temp, "z.md"), "trigger clean text\n");
  writeFileSync(allowlist, '{"version":1,"entries":[]}\n');
  writeFileSync(terms, '{"version":1,"terms":[{"id":"witness","value":"never-present-witness","matchMode":"substring"}]}\n');
  writeFileSync(preload, `
import fs from "node:fs";
const originalSplit = String.prototype.split;
let mutated = false;
String.prototype.split = function(separator, ...args) {
  if (!mutated && separator instanceof RegExp && separator.source.includes("\\\\r\\\\n")) {
    mutated = true;
    if (process.env.LITCLAUDE_RACE_MUTATION === "same-inode-same-size") {
      const bytes = fs.readFileSync(process.env.LITCLAUDE_RACE_FIRST);
      bytes[0] = bytes[0] === 79 ? 111 : 79;
      fs.writeFileSync(process.env.LITCLAUDE_RACE_FIRST, bytes);
    } else {
      fs.writeFileSync(process.env.LITCLAUDE_RACE_ADDED, "late clean text\\n");
    }
  }
  return originalSplit.call(this, separator, ...args);
};
`);
  spawnSync("git", ["init", "-q"], { cwd: temp });
  const scannerUrl = pathToFileURL(join(root, "tools", "scan-legacy-tokens.mjs")).href;
  const invocation = scanKind === "legacy"
    ? `runScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, allowlistPath: process.env.LITCLAUDE_RACE_ALLOWLIST })`
    : `runExternalTermScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, termsPath: process.env.LITCLAUDE_RACE_TERMS })`;
  const driver = `import { runScan, runExternalTermScan } from ${JSON.stringify(scannerUrl)}; process.stdout.write(JSON.stringify(${invocation}));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    cwd: temp,
    encoding: "utf8",
    env: {
      ...process.env,
      LITCLAUDE_RACE_ADDED: join(temp, "late-dir", "late.md"),
      LITCLAUDE_RACE_ALLOWLIST: allowlist,
      LITCLAUDE_RACE_FIRST: first,
      LITCLAUDE_RACE_MUTATION: mutation,
      LITCLAUDE_RACE_ROOT: temp,
      LITCLAUDE_RACE_TERMS: terms,
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
  }
}

function runProtectedPostReadMutation(carrier) {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-protected-post-read-"));
  const harness = mkdtempSync(join(tmpdir(), "litclaude-protected-post-read-harness-"));
  const targetRoot = join(temp, "plugins", "litclaude", "skills", "frontend-ui-ux", "references");
  const target = join(targetRoot, carrier.entry.path);
  const allowlist = join(temp, "tools", "legacy-token-allowlist.json");
  const preload = join(harness, "mutate-protected-after-read.mjs");
  mkdirSync(dirname(targetRoot), { recursive: true });
  mkdirSync(dirname(allowlist), { recursive: true });
  cpSync(frontendRoot, targetRoot, { recursive: true, preserveTimestamps: true });
  writeFileSync(allowlist, '{"version":1,"entries":[]}\n');
  writeFileSync(preload, `
import fs from "node:fs";
const originalSplit = String.prototype.split;
let mutated = false;
String.prototype.split = function(separator, ...args) {
  if (!mutated && separator instanceof RegExp && separator.source.includes("\\\\r\\\\n")) {
    mutated = true;
    const bytes = fs.readFileSync(process.env.LITCLAUDE_RACE_TARGET);
    bytes[0] = bytes[0] === 65 ? 66 : 65;
    fs.writeFileSync(process.env.LITCLAUDE_RACE_TARGET, bytes);
  }
  return originalSplit.call(this, separator, ...args);
};
`);
  spawnSync("git", ["init", "-q"], { cwd: temp });
  const scannerUrl = pathToFileURL(join(root, "tools", "scan-legacy-tokens.mjs")).href;
  const driver = `import { runScan } from ${JSON.stringify(scannerUrl)}; process.stdout.write(JSON.stringify(runScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, allowlistPath: process.env.LITCLAUDE_RACE_ALLOWLIST })));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    cwd: temp,
    encoding: "utf8",
    env: {
      ...process.env,
      LITCLAUDE_RACE_ALLOWLIST: allowlist,
      LITCLAUDE_RACE_ROOT: temp,
      LITCLAUDE_RACE_TARGET: target,
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
  }
}

function runAllowlistCaptureRace() {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-allowlist-capture-race-"));
  const harness = mkdtempSync(join(tmpdir(), "litclaude-allowlist-capture-harness-"));
  const allowlist = join(temp, "tools", "legacy-token-allowlist.json");
  const preload = join(harness, "mutate-allowlist-before-capture.mjs");
  mkdirSync(dirname(allowlist), { recursive: true });
  writeFileSync(join(temp, "ordinary.md"), "ordinary clean text\n");
  writeFileSync(allowlist, '{"version":1,"entries":[]}\n');
  writeFileSync(preload, `
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.execFileSync;
let mutated = false;
childProcess.execFileSync = function(file, args, ...rest) {
  if (!mutated && file === "git" && args?.[0] === "ls-files") {
    mutated = true;
    fs.writeFileSync(process.env.LITCLAUDE_RACE_ALLOWLIST, '{"version":1,"entries":[{}]}\\n');
  }
  return original.call(this, file, args, ...rest);
};
syncBuiltinESMExports();
`);
  spawnSync("git", ["init", "-q"], { cwd: temp });
  const scannerUrl = pathToFileURL(join(root, "tools", "scan-legacy-tokens.mjs")).href;
  const driver = `import { runScan } from ${JSON.stringify(scannerUrl)}; process.stdout.write(JSON.stringify(runScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, allowlistPath: process.env.LITCLAUDE_RACE_ALLOWLIST })));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    cwd: temp,
    encoding: "utf8",
    env: { ...process.env, LITCLAUDE_RACE_ALLOWLIST: allowlist, LITCLAUDE_RACE_ROOT: temp },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
  }
}

function runScannerPreflightDriftCase(kind, carrier) {
  const temp = mkdtempSync(join(tmpdir(), "litclaude-scanner-preflight-"));
  const targetRoot = join(temp, "plugins", "litclaude", "skills", "frontend-ui-ux", "references");
  mkdirSync(dirname(targetRoot), { recursive: true });
  cpSync(frontendRoot, targetRoot, { recursive: true, preserveTimestamps: true });
  const fixture = { temp, target: targetRoot };
  const harness = mkdtempSync(join(tmpdir(), "litclaude-scanner-race-"));
  const target = join(fixture.target, carrier.entry.path);
  const outside = join(harness, "outside.md");
  const preload = join(harness, "mutate-after-preflight.mjs");
  const allowlist = join(fixture.temp, "tools", "legacy-token-allowlist.json");
  mkdirSync(dirname(allowlist), { recursive: true });
  writeFileSync(allowlist, '{"version":1,"entries":[]}\n');
  writeFileSync(outside, `${carrier.hit.token}\n`);
  writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const target = process.env.LITCLAUDE_RACE_TARGET;
const outside = process.env.LITCLAUDE_RACE_OUTSIDE;
const kind = process.env.LITCLAUDE_RACE_KIND;
const original = fs.readFileSync(target);
const originalOpen = fs.openSync;
let targetOpenCount = 0;
let mutated = false;
fs.openSync = function(path, ...args) {
  if (path === target) targetOpenCount += 1;
  if (!mutated && path === target && targetOpenCount === 2) {
    mutated = true;
    if (kind === "changed-bytes") fs.writeFileSync(target, process.env.LITCLAUDE_RACE_WITNESS + "\\n");
    else if (kind === "deleted") fs.rmSync(target);
    else if (kind === "unreadable") fs.chmodSync(target, 0o000);
    else if (kind === "symlink-substitution") { fs.rmSync(target); fs.symlinkSync(outside, target); }
    else if (kind === "same-bytes-substitution") {
      const replacement = target + ".replacement";
      fs.writeFileSync(replacement, original);
      fs.renameSync(replacement, target);
    }
  }
  return originalOpen.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
  spawnSync("git", ["init", "-q"], { cwd: fixture.temp });
  const scannerUrl = pathToFileURL(join(root, "tools", "scan-legacy-tokens.mjs")).href;
  const driver = `import { runScan } from ${JSON.stringify(scannerUrl)}; const report = runScan({ repoRoot: process.env.LITCLAUDE_RACE_ROOT, allowlistPath: process.env.LITCLAUDE_RACE_ALLOWLIST }); process.stdout.write(JSON.stringify(report));`;
  const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
    cwd: fixture.temp,
    encoding: "utf8",
    env: {
      ...process.env,
      LITCLAUDE_RACE_ALLOWLIST: allowlist,
      LITCLAUDE_RACE_KIND: kind,
      LITCLAUDE_RACE_OUTSIDE: outside,
      LITCLAUDE_RACE_ROOT: fixture.temp,
      LITCLAUDE_RACE_TARGET: target,
      LITCLAUDE_RACE_WITNESS: carrier.hit.token,
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    if (existsSync(target) && !statSync(target).isSymbolicLink()) chmodSync(target, 0o644);
    rmSync(fixture.temp, { recursive: true, force: true });
    rmSync(harness, { recursive: true, force: true });
  }
}

describe("canonical frontend corpus", () => {
  it("anchors exact legal paths, source paths, sizes, hashes, and aggregate outside the generated manifest", async () => {
    const commitmentPath = join(pluginRoot, "lib", "canonical-frontend-commitments.mjs");
    assert.equal(existsSync(commitmentPath), true, "frontend legal commitments must live outside the generated manifest");
    const { CANONICAL_FRONTEND_LEGAL_COMMITMENT } = await import(pathToFileURL(commitmentPath).href);
    assert.deepEqual(CANONICAL_FRONTEND_LEGAL_COMMITMENT, {
      fileCount: 3,
      byteCount: 24439,
      treeSha256: "2b7174f0662a5e41259b922fd1d94c24670df66894c7b9f81c9595ebd35fbc52",
      files: [
        {
          path: "_canonical-corpus/legal/frontend-ATTRIBUTION.md",
          sourcePath: "frontend/ATTRIBUTION.md",
          size: 12075,
          sha256: "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92",
        },
        {
          path: "_canonical-corpus/legal/frontend-LICENSE-Apache-2.0.txt",
          sourcePath: "frontend/LICENSE-Apache-2.0.txt",
          size: 11296,
          sha256: "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da",
        },
        {
          path: "_canonical-corpus/legal/root-LICENSE",
          sourcePath: "LICENSE",
          size: 1068,
          sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1",
        },
      ],
    });
  });

  it("rejects coordinated legal-byte and generated-manifest repinning", async () => {
    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    const fixture = copyFrontendFixture();
    try {
      const localManifestPath = join(fixture.target, "_canonical-corpus", "manifest.json");
      const manifest = json(localManifestPath);
      const legal = manifest.legal[0];
      const legalPath = join(fixture.target, legal.path);
      const changed = readFileSync(legalPath);
      changed[0] ^= 1;
      writeFileSync(legalPath, changed);
      legal.sha256 = createHash("sha256").update(changed).digest("hex");
      writeFileSync(localManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const report = verifyCanonicalFrontendCorpus(fixture.temp);
      assert.equal(report.status, "FAIL");
      assert.ok(
        report.failures.some(({ code }) => code === "LEGAL_COMMITMENT_MISMATCH"),
        JSON.stringify(report.failures),
      );
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  it("bounds the canonical manifest, each canonical file, and declared aggregate before whole-file reads", async () => {
    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    const cases = [
      ["manifest", (fixture) => truncateSync(join(fixture.target, "_canonical-corpus", "manifest.json"), maxCanonicalFileBytes + 1), "CANONICAL_FRONTEND_MANIFEST_TOO_LARGE"],
      ["file", (fixture) => {
        const manifest = json(join(fixture.target, "_canonical-corpus", "manifest.json"));
        truncateSync(join(fixture.target, manifest.files[0].path), maxCanonicalFileBytes + 1);
      }, "CANONICAL_FRONTEND_FILE_TOO_LARGE"],
      ["aggregate", (fixture) => {
        const localManifestPath = join(fixture.target, "_canonical-corpus", "manifest.json");
        const manifest = json(localManifestPath);
        for (const entry of manifest.files) entry.size = maxCanonicalFileBytes;
        writeFileSync(localManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }, "CANONICAL_FRONTEND_AGGREGATE_TOO_LARGE"],
    ];

    for (const [label, mutate, expectedCode] of cases) {
      const fixture = copyFrontendFixture();
      try {
        mutate(fixture);
        const report = verifyCanonicalFrontendCorpus(fixture.temp);
        assert.equal(report.status, "FAIL", label);
        assert.ok(report.failures.some(({ code }) => code === expectedCode), `${label}: ${JSON.stringify(report.failures)}`);
      } finally {
        rmSync(fixture.temp, { recursive: true, force: true });
      }
    }
  });

  it("ships the pinned exact manifest and preserves the independent normalized dataset", async () => {
    assert.equal(existsSync(manifestPath), true, "canonical corpus manifest must exist");
    const manifest = json(manifestPath);
    assert.equal(manifest.source.commit, "8ec16c5129df7b9778959e8367657d0e79c2c3bb");
    assert.equal(manifest.source.reference_tree, "9188410be0af35f2421ba300d91a0d7a7341caf0");
    assert.equal(manifest.file_count, 167);
    assert.equal(manifest.byte_count, 2_596_349);
    assert.equal(manifest.aggregate_sha256, "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7");
    assert.equal(manifest.files.length, 167);
    assert.equal(manifest.legal.length, 3);
    assert.deepEqual(manifest.independent_normalized_dataset, {
      source_count: 34,
      record_count: 2277,
      sha256: "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8",
    });

    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    const report = verifyCanonicalFrontendCorpus(pluginRoot);
    assert.equal(report.status, "PASS", JSON.stringify(report.failures));
    assert.equal(report.checkedFiles, 170);
    assert.equal(report.corpusBytes, 2_596_349);
    assert.equal(report.aggregateSha256, manifest.aggregate_sha256);
    assertImmutableExpectedMap(report.expectedPackageFiles, 171);
    assert.deepEqual(report.expectedPackageFiles.get("plugins/litclaude/skills/frontend-ui-ux/references/_canonical-corpus/legal/root-LICENSE"), {
      executable: false,
      size: 1068,
      sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1",
    });
    const { canonicalSkillResourceManifest } = await import("../plugins/litclaude/lib/canonical-skill-resources.mjs");
    const immutableMapPath = join(pluginRoot, "lib", "immutable-expected-file-map.mjs");
    assert.equal(
      canonicalSkillResourceManifest.get("lib/immutable-expected-file-map.mjs"),
      createHash("sha256").update(readFileSync(immutableMapPath)).digest("hex"),
      "the security-critical immutable map helper must be enrolled in installed integrity",
    );
  });

  it("fails closed for missing, extra, changed, symlink, special, unreadable, and malformed-manifest entries", async () => {
    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    const first = json(manifestPath).files[0].path;
    const cases = [
      ["missing", (fixture) => rmSync(join(fixture.target, first)), "CORPUS_MISSING"],
      ["extra", (fixture) => writeFileSync(join(fixture.target, "design", "extra.md"), "extra\n"), "CORPUS_EXTRA"],
      ["changed", (fixture) => writeFileSync(join(fixture.target, first), "changed\n"), "CORPUS_HASH_MISMATCH"],
      ["executable manifest", (fixture) => chmodSync(join(fixture.target, "_canonical-corpus", "manifest.json"), 0o755), "MANIFEST_MODE_MISMATCH"],
      ["executable corpus", (fixture) => chmodSync(join(fixture.target, first), 0o755), "CORPUS_MODE_MISMATCH"],
      ["executable legal", (fixture) => {
        const legal = json(join(fixture.target, "_canonical-corpus", "manifest.json")).legal[0].path;
        chmodSync(join(fixture.target, legal), 0o755);
      }, "CORPUS_MODE_MISMATCH"],
      ["symlink", (fixture) => { rmSync(join(fixture.target, first)); symlinkSync(manifestPath, join(fixture.target, first)); }, "CORPUS_NON_REGULAR"],
      ["unreadable", (fixture) => chmodSync(join(fixture.target, first), 0o000), "CORPUS_UNREADABLE"],
      ["manifest carrier", (fixture) => {
        const path = join(fixture.target, "_canonical-corpus", "manifest.json");
        const value = json(path);
        value.carrier = "unexpected";
        writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
      }, "MANIFEST_SCHEMA_INVALID"],
    ];
    if (process.platform !== "win32") {
      cases.push(["special", (fixture) => {
        const special = join(fixture.target, "design", "special.pipe");
        const result = spawnSync("mkfifo", [special], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }, "CORPUS_NON_REGULAR"]);
    }

    for (const [label, mutate, expectedCode] of cases) {
      const fixture = copyFrontendFixture();
      try {
        mutate(fixture);
        const report = verifyCanonicalFrontendCorpus(fixture.temp);
        assert.equal(report.status, "FAIL", `${label} must fail`);
        assert.ok(report.failures.some(({ code }) => code === expectedCode), `${label}: ${JSON.stringify(report.failures)}`);
      } finally {
        if (existsSync(join(fixture.target, first))) chmodSync(join(fixture.target, first), 0o644);
        rmSync(fixture.temp, { recursive: true, force: true });
      }
    }
  });

  it("accepts secure non-executable frontend, legal, and manifest modes without requiring exact 0644", async () => {
    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    const fixture = copyFrontendFixture();
    try {
      const fixtureManifest = join(fixture.target, "_canonical-corpus", "manifest.json");
      const manifest = json(fixtureManifest);
      chmodSync(fixtureManifest, 0o600);
      chmodSync(join(fixture.target, manifest.files[0].path), 0o600);
      chmodSync(join(fixture.target, manifest.legal[0].path), 0o600);
      const report = verifyCanonicalFrontendCorpus(fixture.temp);
      assert.equal(report.status, "PASS", JSON.stringify(report.failures));
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  it("rejects hash-identical frontend roots reached through persistent ancestor symlinks", async () => {
    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    for (const ancestor of ["root", "skills"]) {
      const fixture = copyCanonicalPluginFixture("litclaude-frontend-ancestor-");
      const outside = join(fixture.temp, "outside-plugin");
      cpSync(fixture.target, outside, { recursive: true, preserveTimestamps: true });
      const target = ancestor === "root" ? fixture.target : join(fixture.target, "skills");
      const replacement = ancestor === "root" ? outside : join(outside, "skills");
      try {
        rmSync(target, { recursive: true });
        symlinkSync(replacement, target);
        const report = verifyCanonicalFrontendCorpus(fixture.target);
        assert.equal(report.status, "FAIL", `${ancestor} symlink must fail`);
        assert.ok(report.failures.some(({ code }) => code.includes("ANCESTOR")), JSON.stringify(report.failures));
      } finally {
        rmSync(fixture.temp, { recursive: true, force: true });
      }
    }
  });

  it("detects a hash-identical frontend root substitution race", () => {
    const report = runVerifierAncestorRace("root", "frontend");
    assert.equal(report.status, "FAIL");
    assert.ok(report.failures.some(({ code }) => code.includes("ANCESTOR")), JSON.stringify(report.failures));
  });

  it("enumerates through a bound Dir handle and rejects a transient restored directory substitution", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-bound-opendir-"));
    const target = join(fixture, "target");
    const outside = join(fixture, "outside");
    const preload = join(fixture, "transient-opendir-swap.mjs");
    mkdirSync(target);
    mkdirSync(outside);
    writeFileSync(join(target, "same.md"), "same bytes\n");
    writeFileSync(join(outside, "same.md"), "same bytes\n");
    writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.opendirSync;
let swapped = false;
fs.opendirSync = function(path, ...args) {
  if (!swapped && path === process.env.LITCLAUDE_RACE_TARGET) {
    swapped = true;
    fs.renameSync(path, process.env.LITCLAUDE_RACE_DISPLACED);
    fs.renameSync(process.env.LITCLAUDE_RACE_OUTSIDE, path);
    const handle = original.call(this, path, ...args);
    fs.renameSync(path, process.env.LITCLAUDE_RACE_OUTSIDE);
    fs.renameSync(process.env.LITCLAUDE_RACE_DISPLACED, path);
    return handle;
  }
  return original.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
    const moduleUrl = pathToFileURL(join(pluginRoot, "lib", "secure-path-read.mjs")).href;
    const driver = `import { readDirectoryStable } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(readDirectoryStable(process.env.LITCLAUDE_RACE_ROOT, process.env.LITCLAUDE_RACE_TARGET)));`;
    const result = spawnSync(process.execPath, ["--import", preload, "--input-type=module", "-e", driver], {
      encoding: "utf8",
      env: {
        ...process.env,
        LITCLAUDE_RACE_DISPLACED: `${target}.displaced`,
        LITCLAUDE_RACE_OUTSIDE: outside,
        LITCLAUDE_RACE_ROOT: fixture,
        LITCLAUDE_RACE_TARGET: target,
      },
    });
    try {
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.ok(report.failure?.includes("ANCESTOR"), JSON.stringify(report));
      const source = read(join(pluginRoot, "lib", "secure-path-read.mjs"));
      assert.match(source, /opendirSync/u);
      assert.doesNotMatch(source, /readdirSync/u);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects subsequent regular-directory and hardlinked-file parent replacements", async () => {
    const { readDirectoryStable, readRegularStable } = await import("../plugins/litclaude/lib/secure-path-read.mjs");
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-expected-ancestors-"));
    const directory = join(fixture, "parent");
    const file = join(directory, "same.md");
    mkdirSync(directory);
    writeFileSync(file, "same bytes\n");
    try {
      const directoryFirst = readDirectoryStable(fixture, directory);
      assert.equal(directoryFirst.failure, undefined);
      renameSync(directory, `${directory}.original`);
      cpSync(`${directory}.original`, directory, { recursive: true });
      const directorySecond = readDirectoryStable(fixture, directory, { ancestors: directoryFirst.ancestors });
      assert.ok(directorySecond.failure?.includes("ANCESTOR"), JSON.stringify(directorySecond));

      rmSync(directory, { recursive: true });
      renameSync(`${directory}.original`, directory);
      const fileFirst = readRegularStable(fixture, file);
      assert.equal(fileFirst.failure, undefined);
      renameSync(directory, `${directory}.original`);
      mkdirSync(directory);
      linkSync(join(`${directory}.original`, "same.md"), file);
      const fileSecond = readRegularStable(fixture, file, fileFirst.snapshot);
      assert.ok(fileSecond.failure?.includes("ANCESTOR"), JSON.stringify(fileSecond));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("preserves canonical bytes as -text and routes the inert library without changing normalized data", () => {
    const attributes = read(join(root, ".gitattributes"));
    for (const directory of ["design", "designpowers", "perfection", "ui-ux-db", "_canonical-corpus/legal"]) {
      assert.match(attributes, new RegExp(`frontend-ui-ux/references/${directory.replaceAll("/", "\\/")}.*-text`, "u"));
    }
    const skill = read(join(pluginRoot, "skills", "frontend-ui-ux", "SKILL.md"));
    assert.match(skill, /canonical library/iu);
    assert.match(skill, /inert reference data/iu);
    assert.match(skill, /2,277/u);
    assert.match(skill, /independent/iu);
    assert.match(skill, /no execution|never execute/iu);
    assert.match(skill, /no fetch|never fetch/iu);
    assert.match(skill, /dependency install/iu);
  });
});

describe("canonical source families", () => {
  it("anchors each reviewed source commit to an independent tree commitment", async () => {
    const commitmentPath = join(pluginRoot, "lib", "canonical-runtime-commitments.mjs");
    assert.equal(existsSync(commitmentPath), true, "reviewed commitments must live outside the generated manifest");
    const { CANONICAL_RUNTIME_COMMITMENTS } = await import(pathToFileURL(commitmentPath).href);
    assert.deepEqual(
      Object.fromEntries([...CANONICAL_RUNTIME_COMMITMENTS].map(([id, value]) => [id, value.treeSha256])),
      {
        autoresearch: "194d6fff2cb728818da6dbdd980a8bd1bff8287113123c17ce69f39b0c1d59a2",
        autoconference: "73340b0a17eafaa0b10c0a41adb73937119781ec7c9062d68cb98d86034b719b",
        wikify: "560a06f32a7628e35ff4d76143361089afebf5260cd70415f1dbbe3de50d76bb",
      },
    );
  });

  it("rejects altered bytes even when the generated manifest is manually repinned", async () => {
    const { verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const fixture = copyCanonicalPluginFixture("litclaude-runtime-repin-guard-");
    try {
      const target = join(fixture.target, "vendor/llm-wikify/SKILL.md");
      const changed = `${read(target)}\nlocal alteration\n`;
      writeFileSync(target, changed);
      const fixtureManifest = join(fixture.target, "vendor/canonical-runtime-closures.json");
      const manifest = json(fixtureManifest);
      const family = manifest.families.find(({ id }) => id === "wikify");
      const entry = family.files.find(({ path }) => path === "SKILL.md");
      entry.size = Buffer.byteLength(changed);
      entry.sha256 = createHash("sha256").update(changed).digest("hex");
      writeFileSync(fixtureManifest, `${JSON.stringify(manifest, null, 2)}\n`);

      const report = verifyCanonicalRuntimeClosures(fixture.target);
      assert.equal(report.status, "FAIL");
      assert.ok(report.failures.some(({ code, family: id }) => code === "RUNTIME_CLOSURE_TREE_COMMITMENT_MISMATCH" && id === "wikify"), JSON.stringify(report.failures));
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  it("refuses to regenerate a manifest for altered bytes under the same source commit", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-runtime-generator-guard-"));
    const fixturePlugin = join(fixture, "plugins", "litclaude");
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      mkdirSync(join(fixturePlugin, "lib"), { recursive: true });
      mkdirSync(join(fixturePlugin, "vendor"), { recursive: true });
      cpSync(join(root, "tools", "gen-canonical-runtime-closures.mjs"), join(fixture, "tools", "gen-canonical-runtime-closures.mjs"));
      const commitmentPath = join(pluginRoot, "lib", "canonical-runtime-commitments.mjs");
      assert.equal(existsSync(commitmentPath), true);
      cpSync(commitmentPath, join(fixturePlugin, "lib", "canonical-runtime-commitments.mjs"));
      cpSync(join(pluginRoot, "lib", "secure-path-read.mjs"), join(fixturePlugin, "lib", "secure-path-read.mjs"));
      cpSync(join(pluginRoot, "vendor", "canonical-runtime-closures.json"), join(fixturePlugin, "vendor", "canonical-runtime-closures.json"));
      for (const directory of ["llm-wikify", "autoresearch", "autoconference"]) {
        cpSync(join(pluginRoot, "vendor", directory), join(fixturePlugin, "vendor", directory), { recursive: true });
      }
      const manifestBefore = read(join(fixturePlugin, "vendor", "canonical-runtime-closures.json"));
      writeFileSync(join(fixturePlugin, "vendor/autoresearch/SKILL.md"), "altered under unchanged commit\n");

      const generated = spawnSync(process.execPath, [join(fixture, "tools", "gen-canonical-runtime-closures.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(generated.status, 1, generated.stdout);
      assert.match(generated.stderr, /RUNTIME_CLOSURE_TREE_COMMITMENT_MISMATCH/u);
      assert.equal(read(join(fixturePlugin, "vendor", "canonical-runtime-closures.json")), manifestBefore, "failed regeneration must not rewrite the manifest");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("bounds the runtime manifest, each closure file, and declared aggregate before whole-file reads", async () => {
    const { verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const cases = [
      ["manifest", (fixture) => truncateSync(join(fixture.target, "vendor/canonical-runtime-closures.json"), maxCanonicalFileBytes + 1), "RUNTIME_CLOSURE_MANIFEST_TOO_LARGE"],
      ["file", (fixture) => truncateSync(join(fixture.target, "vendor/llm-wikify/SKILL.md"), maxCanonicalFileBytes + 1), "RUNTIME_CLOSURE_FILE_TOO_LARGE"],
      ["aggregate", (fixture) => {
        const fixtureManifest = join(fixture.target, "vendor/canonical-runtime-closures.json");
        const manifest = json(fixtureManifest);
        for (const family of manifest.families) {
          for (const entry of family.files) entry.size = maxCanonicalFileBytes;
        }
        writeFileSync(fixtureManifest, `${JSON.stringify(manifest, null, 2)}\n`);
      }, "RUNTIME_CLOSURE_AGGREGATE_TOO_LARGE"],
    ];

    for (const [label, mutate, expectedCode] of cases) {
      const fixture = copyCanonicalPluginFixture(`litclaude-runtime-budget-${label}-`);
      try {
        mutate(fixture);
        const report = verifyCanonicalRuntimeClosures(fixture.target);
        assert.equal(report.status, "FAIL", label);
        assert.ok(report.failures.some(({ code }) => code === expectedCode), `${label}: ${JSON.stringify(report.failures)}`);
      } finally {
        rmSync(fixture.temp, { recursive: true, force: true });
      }
    }
  });

  it("makes the runtime manifest generator reject an oversized closure file before reading it", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-runtime-generator-budget-"));
    const fixturePlugin = join(fixture, "plugins", "litclaude");
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      mkdirSync(join(fixturePlugin, "lib"), { recursive: true });
      mkdirSync(join(fixturePlugin, "vendor"), { recursive: true });
      cpSync(join(root, "tools", "gen-canonical-runtime-closures.mjs"), join(fixture, "tools", "gen-canonical-runtime-closures.mjs"));
      cpSync(join(pluginRoot, "lib", "canonical-runtime-commitments.mjs"), join(fixturePlugin, "lib", "canonical-runtime-commitments.mjs"));
      cpSync(join(pluginRoot, "lib", "secure-path-read.mjs"), join(fixturePlugin, "lib", "secure-path-read.mjs"));
      cpSync(join(pluginRoot, "vendor", "canonical-runtime-closures.json"), join(fixturePlugin, "vendor", "canonical-runtime-closures.json"));
      for (const directory of ["llm-wikify", "autoresearch", "autoconference"]) {
        cpSync(join(pluginRoot, "vendor", directory), join(fixturePlugin, "vendor", directory), { recursive: true });
      }
      truncateSync(join(fixturePlugin, "vendor/llm-wikify/SKILL.md"), maxCanonicalFileBytes + 1);

      const result = spawnSync(process.execPath, [join(fixture, "tools", "gen-canonical-runtime-closures.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /RUNTIME_CLOSURE_FILE_TOO_LARGE/u);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("ships exact source closures and Claude-native family adapters", async () => {
    const { findRuntimeClosureReferenceFailures, verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const report = verifyCanonicalRuntimeClosures(pluginRoot);
    assert.equal(report.status, "PASS", JSON.stringify(report.failures));
    assert.deepEqual(report.families.map(({ id, checked }) => [id, checked]), [
      ["autoresearch", 28],
      ["autoconference", 29],
      ["wikify", 12],
    ]);
    assertImmutableExpectedMap(report.expectedPackageFiles, 76);
    assert.deepEqual(report.expectedPackageFiles.get("plugins/litclaude/commands/autoresearch.md"), {
      executable: false,
      size: 2399,
      sha256: "e062cd04487bc5926ec0f1dd218c487d0d175f7a267b818632b419eae5bcb9cb",
    });
    assert.deepEqual(findRuntimeClosureReferenceFailures(pluginRoot), []);
    assert.equal(
      existsSync(join(pluginRoot, "vendor/autoresearch/references/results-logging.md")),
      true,
      "the autoresearch closure must include its referenced logging protocol",
    );

    const expectations = {
      autoresearch: ["core", "debug", "fix", "learn", "plan", "predict", "reason", "scenario", "security", "ship"],
      autoconference: ["core", "analyze", "debate", "plan", "resume", "ship", "survey"],
      wikify: ["init", "ingest", "query", "save", "lint"],
    };
    for (const [skillId, modes] of Object.entries(expectations)) {
      const skill = read(join(pluginRoot, "skills", skillId, "SKILL.md"));
      for (const mode of modes) assert.match(skill, new RegExp(`\\b${mode}\\b`, "u"), `${skillId} missing ${mode}`);
      assert.match(skill, /lit-plan[\s\S]*explicit[\s\S]*(?:budget|authority)[\s\S]*start-work[\s\S]*bounded[\s\S]*review-work/iu);
      assert.match(skill, /prompt injection|untrusted data/iu);
      assert.match(skill, /no unattended publish|never publish|publish.*explicit approval/iu);
    }

    const autoresearch = read(join(pluginRoot, "skills", "autoresearch", "SKILL.md"));
    assert.match(autoresearch, /Karpathy's autoresearch/u);
    const conference = read(join(pluginRoot, "skills", "autoconference", "SKILL.md"));
    assert.match(conference, /autoresearch/u);
    assert.match(conference, /root.*multi-agent/iu);
    assert.match(conference, /BLOCKED_MULTI_AGENT_UNAVAILABLE/u);
    assert.match(conference, /child agents.*(?:do not|never).*shared state/iu);
    assert.match(conference, /no fake daemon|never claim.*concurr/iu);
    const wikify = read(join(pluginRoot, "skills", "wikify", "SKILL.md"));
    assert.match(wikify, /litresearch[\s\S]*local inert-source[\s\S]*review-work[\s\S]*(?:lit-recap|handoff)/iu);
  });

  it("enrolls one skill and command per family with safe hook routing", () => {
    for (const skillId of ["autoresearch", "autoconference", "wikify"]) {
      assert.equal(existsSync(join(pluginRoot, "skills", skillId, "SKILL.md")), true);
      assert.equal(existsSync(join(pluginRoot, "commands", `${skillId}.md`)), true);
      assert.match(runHook(`${skillId} core request`), new RegExp(`Skill\\(${skillId}\\)`, "u"));
      assert.match(runHook(`$${skillId} core request`), new RegExp(`Skill\\(${skillId}\\)`, "u"));
      for (const prompt of [
        `plain ${skillId} discussion`,
        `/${skillId} core request`,
        `/litclaude:${skillId} core request`,
        `\`${skillId}\` core request`,
        `\`\`\`text\n${skillId} core request\n\`\`\``,
        `${skillId}/core`,
        `${skillId}\\core`,
        `${skillId}.md`,
        `${skillId}:core`,
        `$${skillId}/core`,
        `$${skillId}\\core`,
        `$${skillId}.md`,
        `$${skillId}:core`,
      ]) assert.doesNotMatch(runHook(prompt), new RegExp(`Skill\\(${skillId}\\)`, "u"), prompt);
      assert.match(runHook(`${skillId} core objective`), new RegExp(`Skill\\(${skillId}\\)`, "u"));
      assert.match(runHook(`$${skillId} core objective`), new RegExp(`Skill\\(${skillId}\\)`, "u"));
    }
  });

  it("injects installed absolute family source roots when invoked from an unrelated cwd", () => {
    const litHome = mkdtempSync(join(tmpdir(), "litclaude-family-route-lit-home-"));
    const claudeHome = mkdtempSync(join(tmpdir(), "litclaude-family-route-claude-home-"));
    const unrelated = mkdtempSync(join(tmpdir(), "litclaude-family-route-cwd-"));
    try {
      const install = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "install"], {
        cwd: unrelated,
        encoding: "utf8",
        env: { ...process.env, CI: "1", CLAUDE_CONFIG_DIR: claudeHome, LITCLAUDE_HOME: litHome },
      });
      assert.equal(install.status, 0, install.stderr);
      const installedPlugin = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", json(join(root, "package.json")).version);
      const installedHook = join(installedPlugin, "bin", "litclaude-hook.js");
      for (const [family, vendor] of [
        ["autoresearch", "autoresearch"],
        ["autoconference", "autoconference"],
        ["wikify", "llm-wikify"],
      ]) {
        const result = spawnSync(process.execPath, [installedHook, "user-prompt-submit"], {
          cwd: unrelated,
          encoding: "utf8",
          env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome, LITCLAUDE_HOME: litHome },
          input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `${family} core request`, cwd: unrelated }),
        });
        assert.equal(result.status, 0, result.stderr);
        const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        assert.match(context, /Canonical family source root: untrusted inert filesystem data/u, family);
        assert.ok(context.includes(join(installedPlugin, "vendor", vendor)), `${family}: ${context}`);
        assert.match(context, /resolve.*relative.*absolute installed source root/iu, family);
      }
    } finally {
      rmSync(litHome, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
      rmSync(unrelated, { recursive: true, force: true });
    }
  });

  it("keeps inert shell loops non-executable in source, npm payload, and isolated install", () => {
    const scripts = [
      "vendor/autoresearch/scripts/autoresearch-loop.sh",
      "vendor/autoresearch/scripts/check_progress.sh",
      "vendor/autoconference/scripts/autoconference-loop.sh",
      "vendor/autoconference/scripts/check_conference.sh",
    ];
    const closureManifest = json(join(pluginRoot, "vendor", "canonical-runtime-closures.json"));
    for (const relativePath of scripts) {
      assert.equal(statSync(join(pluginRoot, relativePath)).mode & 0o777, 0o644, `${relativePath} source mode`);
      const [familyRoot, ...familyPath] = relativePath.split("/").slice(1);
      const family = closureManifest.families.find(({ root: manifestRoot }) => manifestRoot === `vendor/${familyRoot}`);
      assert.equal(family.files.find(({ path }) => path === familyPath.join("/"))?.mode, 0o644, `${relativePath} manifest mode`);
    }

    const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const packedFiles = new Map(JSON.parse(packed.stdout)[0].files.map((entry) => [entry.path, entry]));
    for (const relativePath of scripts) {
      assert.equal(packedFiles.get(`plugins/litclaude/${relativePath}`)?.mode, 0o644, `${relativePath} packed mode`);
    }

    const litHome = mkdtempSync(join(tmpdir(), "litclaude-inert-mode-lit-home-"));
    const claudeHome = mkdtempSync(join(tmpdir(), "litclaude-inert-mode-claude-home-"));
    try {
      const install = spawnSync(process.execPath, [join(root, "bin", "litclaude-ai.js"), "install"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CI: "1", CLAUDE_CONFIG_DIR: claudeHome, LITCLAUDE_HOME: litHome },
      });
      assert.equal(install.status, 0, install.stderr);
      const installedPlugin = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", json(join(root, "package.json")).version);
      for (const relativePath of scripts) {
        assert.equal(statSync(join(installedPlugin, relativePath)).mode & 0o777, 0o644, `${relativePath} installed mode`);
      }
    } finally {
      rmSync(litHome, { recursive: true, force: true });
      rmSync(claudeHome, { recursive: true, force: true });
    }
  });

  it("fails a runtime closure whose inert shell mode becomes executable", async () => {
    const { verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-runtime-mode-"));
    try {
      mkdirSync(join(fixture, "vendor"), { recursive: true });
      cpSync(join(pluginRoot, "vendor", "canonical-runtime-closures.json"), join(fixture, "vendor", "canonical-runtime-closures.json"));
      for (const directory of ["llm-wikify", "autoresearch", "autoconference"]) {
        cpSync(join(pluginRoot, "vendor", directory), join(fixture, "vendor", directory), { recursive: true });
      }
      const target = join(fixture, "vendor/autoresearch/scripts/autoresearch-loop.sh");
      chmodSync(target, 0o755);
      const report = verifyCanonicalRuntimeClosures(fixture);
      assert.equal(report.status, "FAIL");
      assert.ok(report.failures.some(({ code, path }) => code === "RUNTIME_CLOSURE_MODE_MISMATCH" && path === "scripts/autoresearch-loop.sh"));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects executable runtime manifests and family adapters", async () => {
    const { verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const cases = [
      ["manifest", "vendor/canonical-runtime-closures.json", "RUNTIME_CLOSURE_MANIFEST_MODE_MISMATCH"],
      ["adapter", "commands/autoresearch.md", "RUNTIME_ADAPTER_MODE_MISMATCH"],
    ];
    for (const [label, relativePath, expectedCode] of cases) {
      const fixture = copyCanonicalPluginFixture(`litclaude-runtime-${label}-mode-`);
      try {
        chmodSync(join(fixture.target, relativePath), 0o755);
        const report = verifyCanonicalRuntimeClosures(fixture.target);
        assert.equal(report.status, "FAIL", label);
        assert.ok(report.failures.some(({ code, path }) => code === expectedCode && path === relativePath), JSON.stringify(report.failures));
      } finally {
        rmSync(fixture.temp, { recursive: true, force: true });
      }
    }
  });

  it("allows non-executable runtime files created with secure 0600 permissions", async () => {
    const { verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const fixture = copyCanonicalPluginFixture("litclaude-runtime-0600-");
    try {
      chmodSync(join(fixture.target, "vendor/autoresearch/scripts/autoresearch-loop.sh"), 0o600);
      const report = verifyCanonicalRuntimeClosures(fixture.target);
      assert.equal(report.status, "PASS", JSON.stringify(report.failures));
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }
  });

  it("rejects persistent and raced runtime ancestor substitutions", async () => {
    const { verifyCanonicalRuntimeClosures } = await import("../plugins/litclaude/lib/canonical-runtime-closures.mjs");
    const fixture = copyCanonicalPluginFixture("litclaude-runtime-ancestor-");
    const outside = join(fixture.temp, "outside-plugin");
    cpSync(fixture.target, outside, { recursive: true, preserveTimestamps: true });
    try {
      rmSync(join(fixture.target, "vendor"), { recursive: true });
      symlinkSync(join(outside, "vendor"), join(fixture.target, "vendor"));
      const report = verifyCanonicalRuntimeClosures(fixture.target);
      assert.equal(report.status, "FAIL");
      assert.ok(report.failures.some(({ code }) => code.includes("ANCESTOR")), JSON.stringify(report.failures));
    } finally {
      rmSync(fixture.temp, { recursive: true, force: true });
    }

    const raced = runVerifierAncestorRace("intermediate", "runtime");
    assert.equal(raced.status, "FAIL");
    assert.ok(raced.failures.some(({ code }) => code.includes("ANCESTOR")), JSON.stringify(raced.failures));
  });

  it("preserves non-executable runtime semantics through an actual umask-077 tarball install", { skip: process.platform === "win32" }, async () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-umask-pack-"));
    const project = join(temp, "project");
    const litHome = join(temp, "lit-home");
    const claudeHome = join(temp, "claude-home");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "package.json"), '{"name":"umask-fixture","version":"1.0.0","private":true}\n');
    try {
      const packed = spawnSync("npm", ["pack", root, "--json", "--pack-destination", temp], { cwd: temp, encoding: "utf8" });
      assert.equal(packed.status, 0, packed.stderr);
      const tarball = join(temp, JSON.parse(packed.stdout)[0].filename);
      const installed = spawnSync("/bin/sh", ["-c", 'umask 077; npm install --ignore-scripts --no-audit --no-fund "$LITCLAUDE_TARBALL"'], {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, LITCLAUDE_TARBALL: tarball },
      });
      assert.equal(installed.status, 0, installed.stderr);
      const packageRoot = join(project, "node_modules", "@litfamily", "litclaude");
      const cli = spawnSync("/bin/sh", ["-c", 'umask 077; node "$LITCLAUDE_CLI" install'], {
        cwd: project,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "1",
          CLAUDE_CONFIG_DIR: claudeHome,
          LITCLAUDE_CLI: join(packageRoot, "bin", "litclaude-ai.js"),
          LITCLAUDE_HOME: litHome,
        },
      });
      assert.equal(cli.status, 0, cli.stderr);
      const installedPlugin = join(claudeHome, "plugins", "cache", "litclaude-ai", "litclaude", json(join(root, "package.json")).version);
      for (const relativePath of [
        "vendor/autoresearch/scripts/autoresearch-loop.sh",
        "vendor/autoconference/scripts/autoconference-loop.sh",
      ]) {
        assert.equal(statSync(join(packageRoot, "plugins", "litclaude", relativePath)).mode & 0o111, 0, `${relativePath} package extraction`);
        assert.equal(statSync(join(installedPlugin, relativePath)).mode & 0o111, 0, `${relativePath} plugin install`);
      }
      chmodSync(join(installedPlugin, "vendor/autoresearch/scripts/autoresearch-loop.sh"), 0o600);
      const verifierUrl = pathToFileURL(join(packageRoot, "plugins/litclaude/lib/canonical-runtime-closures.mjs")).href;
      const { verifyCanonicalRuntimeClosures } = await import(verifierUrl);
      const report = verifyCanonicalRuntimeClosures(installedPlugin);
      assert.equal(report.status, "PASS", JSON.stringify(report.failures));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe("scanner, package, docs, and workspace boundaries", () => {
  it("makes the executable package guard reject coordinated legal-byte and manifest repinning", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-pack-legal-repin-"));
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      cpSync(join(root, "plugins"), join(fixture, "plugins"), { recursive: true, preserveTimestamps: true });
      cpSync(join(root, "tools", "check-pack-payload.mjs"), join(fixture, "tools", "check-pack-payload.mjs"));
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
        name: "litclaude-pack-legal-repin",
        version: "1.0.0",
        type: "module",
        files: ["plugins"],
      })}\n`);

      const localFrontend = join(fixture, "plugins/litclaude/skills/frontend-ui-ux/references");
      const localManifestPath = join(localFrontend, "_canonical-corpus/manifest.json");
      const manifest = json(localManifestPath);
      const legal = manifest.legal[0];
      const legalPath = join(localFrontend, legal.path);
      const changed = readFileSync(legalPath);
      changed[0] ^= 1;
      writeFileSync(legalPath, changed);
      legal.sha256 = createHash("sha256").update(changed).digest("hex");
      writeFileSync(localManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const result = spawnSync(process.execPath, [join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /CANONICAL_FRONTEND_CORPUS_FAIL/u);
      assert.match(result.stderr, /LEGAL_COMMITMENT_MISMATCH/u);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("makes the package guard hash exact legal bytes from the produced tarball", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-pack-legal-tar-"));
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      cpSync(join(root, "plugins"), join(fixture, "plugins"), { recursive: true, preserveTimestamps: true });
      cpSync(join(root, "tools", "check-pack-payload.mjs"), join(fixture, "tools", "check-pack-payload.mjs"));
      const legalPath = "plugins/litclaude/skills/frontend-ui-ux/references/_canonical-corpus/legal/root-LICENSE";
      writeFileSync(join(fixture, "mutate-legal.mjs"), `
import { readFileSync, writeFileSync } from "node:fs";
const path = new URL(${JSON.stringify(`./${legalPath}`)}, import.meta.url);
const bytes = readFileSync(path);
bytes[0] ^= 1;
writeFileSync(path, bytes);
`);
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
        name: "litclaude-pack-legal-tar",
        version: "1.0.0",
        type: "module",
        scripts: { prepack: "node mutate-legal.mjs" },
        files: ["plugins"],
      })}\n`);

      const result = spawnSync(process.execPath, [join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /LEGAL_PACKAGE_HASH_MISMATCH/u);
      assert.match(result.stderr, new RegExp(legalPath.replaceAll("/", "\\/"), "u"));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a frontend corpus tarball mutation even when postpack restores the verified source", () => {
    const corpusPath = `plugins/litclaude/skills/frontend-ui-ux/references/${json(manifestPath).files[0].path}`;
    const fixture = writeRestoredPrepackMutationFixture("litclaude-pack-frontend-tar-", corpusPath);
    try {
      const before = readFileSync(join(fixture, corpusPath));
      const result = spawnSync(process.execPath, [join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /CANONICAL_PACKAGE_BYTES_MISMATCH/u);
      assert.match(result.stderr, new RegExp(corpusPath.replaceAll("/", "\\/"), "u"));
      assert.deepEqual(readFileSync(join(fixture, corpusPath)), before, "postpack must restore the source before the guard compares the tarball");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a runtime closure tarball mutation even when postpack restores the verified source", () => {
    const runtimeManifest = json(join(pluginRoot, "vendor", "canonical-runtime-closures.json"));
    const firstFamily = runtimeManifest.families[0];
    const closurePath = `plugins/litclaude/${firstFamily.root}/${firstFamily.files[0].path}`;
    const fixture = writeRestoredPrepackMutationFixture("litclaude-pack-runtime-tar-", closurePath);
    try {
      const before = readFileSync(join(fixture, closurePath));
      const result = spawnSync(process.execPath, [join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /CANONICAL_PACKAGE_BYTES_MISMATCH/u);
      assert.match(result.stderr, new RegExp(closurePath.replaceAll("/", "\\/"), "u"));
      assert.deepEqual(readFileSync(join(fixture, closurePath)), before, "postpack must restore the source before the guard compares the tarball");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a runtime closure gaining executable tar bits even when postpack restores its source mode", { skip: process.platform === "win32" }, () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-pack-runtime-mode-tar-"));
    const closurePath = "plugins/litclaude/vendor/autoresearch/scripts/autoresearch-loop.sh";
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      cpSync(join(root, "plugins"), join(fixture, "plugins"), { recursive: true, preserveTimestamps: true });
      cpSync(join(root, "tools", "check-pack-payload.mjs"), join(fixture, "tools", "check-pack-payload.mjs"));
      writeFileSync(join(fixture, "mutate-mode.mjs"), `
import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
const source = new URL(${JSON.stringify(`./${closurePath}`)}, import.meta.url);
const backup = new URL("./canonical-source-mode.txt", import.meta.url);
if (process.argv[2] === "prepack") {
  writeFileSync(backup, String(statSync(source).mode & 0o777));
  chmodSync(source, 0o755);
} else {
  chmodSync(source, Number.parseInt(readFileSync(backup, "utf8"), 10));
  rmSync(backup);
}
`);
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
        name: "litclaude-pack-runtime-mode-tar",
        version: "1.0.0",
        type: "module",
        scripts: {
          prepack: "node mutate-mode.mjs prepack",
          postpack: "node mutate-mode.mjs postpack",
        },
        files: ["plugins"],
      })}\n`);

      const beforeMode = statSync(join(fixture, closurePath)).mode & 0o777;
      const result = spawnSync(process.execPath, [join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /CANONICAL_PACKAGE_MODE_MISMATCH/u);
      assert.match(result.stderr, new RegExp(closurePath.replaceAll("/", "\\/"), "u"));
      assert.equal(statSync(join(fixture, closurePath)).mode & 0o777, beforeMode, "postpack must restore the source mode before tar comparison");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a deterministic canonical mutation between verifier completion and pre-pack capture", () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-pack-interval-race-"));
    const corpusPath = `plugins/litclaude/skills/frontend-ui-ux/references/${json(manifestPath).files[0].path}`;
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      cpSync(join(root, "plugins"), join(fixture, "plugins"), { recursive: true, preserveTimestamps: true });
      cpSync(join(root, "tools", "check-pack-payload.mjs"), join(fixture, "tools", "check-pack-payload.mjs"));
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
        name: "litclaude-pack-interval-race",
        version: "1.0.0",
        type: "module",
        files: ["plugins"],
      })}\n`);
      const preload = join(fixture, "mutate-after-verifiers.mjs");
      writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.mkdtempSync;
let mutated = false;
fs.mkdtempSync = function(prefix, ...args) {
  const directory = original.call(this, prefix, ...args);
  if (!mutated && String(prefix).includes("litclaude-pack-guard-")) {
    mutated = true;
    const bytes = fs.readFileSync(process.env.LITCLAUDE_RACE_TARGET);
    bytes[0] ^= 1;
    fs.writeFileSync(process.env.LITCLAUDE_RACE_TARGET, bytes);
  }
  return directory;
};
syncBuiltinESMExports();
`);

      const result = spawnSync(process.execPath, ["--import", preload, join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, LITCLAUDE_RACE_TARGET: join(fixture, corpusPath) },
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /CANONICAL_PREPACK_SNAPSHOT_MISMATCH/u);
      assert.match(result.stderr, new RegExp(corpusPath.replaceAll("/", "\\/"), "u"));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects executable mode drift between verifier completion and pre-pack capture", { skip: process.platform === "win32" }, () => {
    const fixture = mkdtempSync(join(tmpdir(), "litclaude-pack-mode-interval-race-"));
    const closurePath = "plugins/litclaude/vendor/autoresearch/scripts/autoresearch-loop.sh";
    try {
      mkdirSync(join(fixture, "tools"), { recursive: true });
      cpSync(join(root, "plugins"), join(fixture, "plugins"), { recursive: true, preserveTimestamps: true });
      cpSync(join(root, "tools", "check-pack-payload.mjs"), join(fixture, "tools", "check-pack-payload.mjs"));
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
        name: "litclaude-pack-mode-interval-race",
        version: "1.0.0",
        type: "module",
        files: ["plugins"],
      })}\n`);
      const preload = join(fixture, "chmod-after-verifiers.mjs");
      writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.mkdtempSync;
let mutated = false;
fs.mkdtempSync = function(prefix, ...args) {
  const directory = original.call(this, prefix, ...args);
  if (!mutated && String(prefix).includes("litclaude-pack-guard-")) {
    mutated = true;
    fs.chmodSync(process.env.LITCLAUDE_RACE_TARGET, 0o755);
  }
  return directory;
};
syncBuiltinESMExports();
`);

      const result = spawnSync(process.execPath, ["--import", preload, join(fixture, "tools/check-pack-payload.mjs")], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, LITCLAUDE_RACE_TARGET: join(fixture, closurePath) },
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /CANONICAL_PREPACK_MODE_MISMATCH/u);
      assert.match(result.stderr, new RegExp(closurePath.replaceAll("/", "\\/"), "u"));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("parses the allowlist bytes captured in the immutable scanner snapshot", () => {
    const report = runAllowlistCaptureRace();
    assert.equal(report.ok, false);
    assert.ok(report.errors.some(({ code }) => code === "LITCLAUDE_SCAN_ALLOWLIST_NONEMPTY"), JSON.stringify(report.errors));
  });

  it("keeps allowlists empty and exempts only exact verified protected paths", async () => {
    assert.deepEqual(json(join(root, "tools", "legacy-token-allowlist.json")).entries, []);
    const scanner = await import("../tools/scan-legacy-tokens.mjs");
    const report = scanner.runScan({
      repoRoot: root,
      allowlistPath: join(root, "tools", "legacy-token-allowlist.json"),
    });
    assert.equal(report.ok, true, JSON.stringify(report.offenders.slice(0, 3)));
    assert.ok(report.protectedHits > 0, "canonical corpus must exercise the exact hash-scoped exemption");
    assert.equal(report.allowlistedHits, 0);
    const { verifyCanonicalFrontendCorpus } = await import("../plugins/litclaude/lib/canonical-frontend-corpus.mjs");
    const canonical = verifyCanonicalFrontendCorpus(pluginRoot);
    assert.equal([...canonical.protectedPaths].some((path) => path.includes("/_canonical-corpus/legal/")), false,
      "clean legal companions must be scanned normally rather than exempted");

    const manifest = json(manifestPath);
    let carrier;
    for (const entry of [...manifest.files, ...manifest.legal]) {
      const text = read(join(frontendRoot, entry.path));
      const hit = scanner.scanText(entry.path, text)[0];
      if (hit) { carrier = { entry, hit }; break; }
    }
    assert.ok(carrier, "fixture corpus should contain a guarded-token witness");

    const temp = mkdtempSync(join(tmpdir(), "litclaude-scanner-scope-"));
    try {
      mkdirSync(join(temp, "tools"), { recursive: true });
      writeFileSync(join(temp, "tools", "legacy-token-allowlist.json"), '{"version":1,"entries":[]}\n');
      const target = join(temp, "plugins", "litclaude", "skills", "frontend-ui-ux", "references");
      mkdirSync(dirname(target), { recursive: true });
      cpSync(frontendRoot, target, { recursive: true });
      spawnSync("git", ["init", "-q"], { cwd: temp });

      writeFileSync(join(temp, "copied-protected-file.md"), readFileSync(join(frontendRoot, carrier.entry.path)));
      let scoped = scanner.runScan({ repoRoot: temp, allowlistPath: join(temp, "tools", "legacy-token-allowlist.json") });
      assert.equal(scoped.ok, false);
      assert.ok(scoped.offenders.some(({ path }) => path === "copied-protected-file.md"));

      rmSync(join(temp, "copied-protected-file.md"));
      const localManifestPath = join(target, "_canonical-corpus", "manifest.json");
      const altered = json(localManifestPath);
      altered.carrier = carrier.hit.token;
      writeFileSync(localManifestPath, `${JSON.stringify(altered, null, 2)}\n`);
      scoped = scanner.runScan({ repoRoot: temp, allowlistPath: join(temp, "tools", "legacy-token-allowlist.json") });
      assert.equal(scoped.ok, false);
      assert.ok(scoped.errors.some(({ code }) => code === "LITCLAUDE_CANONICAL_CORPUS_INVALID"));
      assert.ok(scoped.offenders.some(({ path }) => path.endsWith("manifest.json")));

      cpSync(manifestPath, localManifestPath);
      const termsPath = join(temp, "terms.json");
      writeFileSync(termsPath, `${JSON.stringify({
        version: 1,
        terms: [{ id: "external-witness", value: carrier.hit.token, matchMode: carrier.hit.mode }],
      })}\n`);
      const external = scanner.runExternalTermScan({ repoRoot: temp, termsPath });
      assert.equal(external.ok, false);
      assert.ok(external.offenders.some(({ path }) => path.includes("frontend-ui-ux/references/")));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("fails protected-file replacement, deletion, unreadability, and substitution after preflight", async () => {
    const scanner = await import("../tools/scan-legacy-tokens.mjs");
    const manifest = json(manifestPath);
    let carrier;
    for (const entry of [...manifest.files, ...manifest.legal]) {
      const hit = scanner.scanText(entry.path, read(join(frontendRoot, entry.path)))[0];
      if (hit) { carrier = { entry, hit }; break; }
    }
    assert.ok(carrier, "canonical corpus must contain a guarded-token race witness");
    for (const kind of ["changed-bytes", "deleted", "unreadable", "symlink-substitution", "same-bytes-substitution"]) {
      const report = runScannerPreflightDriftCase(kind, carrier);
      assert.equal(report.ok, false, `${kind} must fail closed`);
      assert.ok(
        report.errors.some(({ code }) => code === "LITCLAUDE_PROTECTED_FILE_DRIFT"),
        `${kind}: ${JSON.stringify(report.errors)}`,
      );
    }
  });

  it("fails closed when any enumerated ordinary file cannot be read unchanged", () => {
    for (const scanKind of ["legacy", "external"]) {
      for (const mutation of ["deleted", "unreadable", "symlink-substitution", "same-bytes-substitution"]) {
        const report = runOrdinaryScannerRace(scanKind, mutation);
        assert.equal(report.ok, false, `${scanKind}/${mutation} must fail closed`);
        assert.ok(
          report.errors.some(({ code }) => code.includes("FILE_READ_FAILED")),
          `${scanKind}/${mutation}: ${JSON.stringify(report.errors)}`,
        );
      }
    }
  });

  it("fails closed on hash-identical scanner root and intermediate ancestor races", () => {
    for (const scanKind of ["legacy", "external"]) {
      for (const ancestor of ["root", "intermediate", "inventory-root"]) {
        const report = runScannerAncestorRace(scanKind, ancestor);
        assert.equal(report.ok, false, `${scanKind}/${ancestor} must fail closed`);
        assert.ok(
          report.errors.some(({ code }) => code.includes("FILE_READ_FAILED")),
          `${scanKind}/${ancestor}: ${JSON.stringify(report.errors)}`,
        );
      }
    }
  });

  it("keeps legacy and external verdicts scoped to immutable captured snapshots", () => {
    for (const scanKind of ["legacy", "external"]) {
      const changed = runScannerPostReadRace(scanKind, "same-inode-same-size");
      assert.equal(changed.ok, true, `${scanKind} captured bytes must be stable after live mutation`);
      assert.equal(changed.errors.length, 0);
      assert.equal(changed.snapshotScope, "captured-enumerated-files");
      assert.match(changed.snapshotDigest, /^[0-9a-f]{64}$/u);
      assert.equal(changed.snapshotFileCount > 0, true);

      const added = runScannerPostReadRace(scanKind, "added-file");
      assert.equal(added.ok, true, `${scanKind} post-capture additions are outside the snapshot verdict`);
      assert.equal(added.errors.length, 0);
      assert.equal(added.snapshotScope, "captured-enumerated-files");
      assert.equal(added.snapshotDigest, changed.snapshotDigest);
      assert.equal(added.snapshotFileCount, changed.snapshotFileCount);
      assert.equal("liveTreeClean" in added, false);
    }
  });

  it("keeps protected verdicts bound to bytes captured before later live mutation", async () => {
    const scanner = await import("../tools/scan-legacy-tokens.mjs");
    const manifest = json(manifestPath);
    let carrier;
    for (const entry of [...manifest.files, ...manifest.legal]) {
      const hit = scanner.scanText(entry.path, read(join(frontendRoot, entry.path)))[0];
      if (hit) { carrier = { entry, hit }; break; }
    }
    assert.ok(carrier);
    const report = runProtectedPostReadMutation(carrier);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.errors.length, 0);
    assert.equal(report.snapshotScope, "captured-enumerated-files");
    assert.match(report.snapshotDigest, /^[0-9a-f]{64}$/u);
  });

  it("documents that scanner success is snapshot-scoped rather than post-return live-tree proof", () => {
    for (const path of [join(root, "README.md"), join(root, "README_ko-KR.md"), join(root, "docs", "workflow-compatibility-audit.md")]) {
      const text = read(path);
      assert.match(text, /snapshot|스냅샷/iu, path);
      assert.match(text, /digest|다이제스트/iu, path);
      assert.match(text, /live tree|라이브 트리|mutable live/iu, path);
      assert.match(text, /does not prove|입증하지|보장하지/iu, path);
    }
  });

  it("documents independent commitments, immutable package expectations, interval protection, and bounded canonical preflights", () => {
    for (const path of [join(root, "README.md"), join(root, "README_ko-KR.md"), join(root, "docs", "workflow-compatibility-audit.md")]) {
      const text = read(path);
      assert.match(text, /legal companion|legal 파일|법적 동반/iu, path);
      assert.match(text, /outside[\s\S]{0,80}manifest|manifest[\s\S]{0,80}(?:외부|밖)/iu, path);
      assert.match(text, /scan(?:ned|s)?[\s\S]{0,40}normally|일반[\s\S]{0,40}검사|정상[\s\S]{0,40}검사/iu, path);
      assert.match(text, /canonical[\s\S]{0,100}(?:8 MiB|32 MiB)/iu, path);
      assert.match(text, /runtime[\s\S]{0,100}(?:8 MiB|32 MiB)/iu, path);
      assert.match(text, /immutable expected\s+(?:file\s+)?map/iu, path);
      assert.match(text, /verifier-to-capture interval/iu, path);
      assert.match(text, /non-executable/iu, path);
      assert.match(text, /0600/iu, path);
    }
  });

  it("documents honest stable provenance for every canonical runtime family", () => {
    const manifest = json(join(pluginRoot, "vendor", "canonical-runtime-closures.json"));
    const notice = read(join(pluginRoot, "vendor", "NOTICE.md"));
    const provenance = {
      autoresearch: {
        source: "my-agent-skills/060_autoresearch-skill",
        tree: "9102dfeba13a738d23971b69b6b6ad7bf425c923",
      },
      autoconference: {
        source: "my-agent-skills/064_autoconference-skill",
        tree: "8e73d89cefd9ca136f9c45a918517cc5e809fd57",
      },
      wikify: {
        source: "llm-wikify",
        tree: "ca02699317261cf36f9f89e96186728013778da6",
        publicLocator: "https://github.com/wjgoarxiv/llm-wikify/tree/dfe8f8bc372c3bc153dd57697f4a36f366a63e74",
      },
    };
    for (const family of manifest.families) {
      assert.match(notice, new RegExp(`\\b${family.id}\\b`, "u"), `${family.id} missing from NOTICE`);
      assert.match(notice, new RegExp(family.source_commit, "u"), `${family.id} commit missing from NOTICE`);
      assert.ok(notice.includes(`stable source identifier \`${provenance[family.id].source}\``), `${family.id} source identifier missing from NOTICE`);
      if (provenance[family.id].tree) assert.ok(notice.includes(provenance[family.id].tree), `${family.id} tree missing from NOTICE`);
      if (provenance[family.id].publicLocator) assert.ok(notice.includes(provenance[family.id].publicLocator), `${family.id} public locator missing from NOTICE`);
      assert.ok(notice.includes(`${family.root}/LICENSE`), `${family.id} license path missing from NOTICE`);
      assert.match(notice, /MIT/u);
    }
    assert.deepEqual(notice.match(/https?:\/\/[^\s`]+/gu), [provenance.wikify.publicLocator]);
    assert.doesNotMatch(notice, /https?:\/\/[^\s`]*my-agent-skills/iu);
    assert.match(notice, /anonymous upstream retrieval is not claimed/iu);
    assert.match(notice, /runtime\/release integrity relies on bundled licensed bytes plus local canonical closures, not remote fetch/iu);
    assert.match(notice, /public URL is a provenance convenience/iu);
    assert.match(notice, /package integrity remains local/iu);
  });

  it("keeps every exact runtime closure and its manifest byte-stable across git platforms", () => {
    const attributes = read(join(root, ".gitattributes"));
    for (const path of [
      "plugins/litclaude/vendor/autoresearch/** -text",
      "plugins/litclaude/vendor/autoconference/** -text",
      "plugins/litclaude/vendor/llm-wikify/** -text",
      "plugins/litclaude/vendor/canonical-runtime-closures.json -text",
    ]) assert.ok(attributes.split(/\r?\n/u).includes(path), path);
  });

  it("tracks tests by default, keeps generated evidence ignored, and removes README release chronology", () => {
    const ignore = read(join(root, ".gitignore"));
    assert.doesNotMatch(ignore, /^test\/$|^test\/\*$/mu);
    assert.match(ignore, /^test\/evidence\/$/mu);
    assert.match(ignore, /^evidence\/$/mu);

    for (const path of [join(root, "README.md"), join(root, "README_ko-KR.md")]) {
      const text = read(path);
      assert.doesNotMatch(text, /release material|release candidate|release-candidate/iu);
      assert.doesNotMatch(text, /exactly \*\*?\d+ resources|\d+-resource boundary/iu);
      assert.match(text, /CHANGELOG\.md/u);
      for (const skillId of ["autoresearch", "autoconference", "wikify"]) assert.match(text, new RegExp(`\\b${skillId}\\b`, "u"));
    }
  });

  it("preserves checkout-local profile state", () => {
    assert.equal(
      existsSync(join(root, ".claude")),
      checkoutClaudeProfileExisted,
      "source checks must not mutate checkout-local Claude profile state",
    );
  });
});
