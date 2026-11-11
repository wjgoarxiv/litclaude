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

function runVerifierAncestorRace(kind) {
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
  const moduleUrl = pathToFileURL(join(pluginRoot, "lib", "canonical-runtime-closures.mjs")).href;
  const driver = `import { verifyCanonicalRuntimeClosures } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(verifyCanonicalRuntimeClosures(process.env.LITCLAUDE_PLUGIN_ROOT)));`;
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
import crypto from "node:crypto";
const hashProto = Object.getPrototypeOf(crypto.createHash("sha256"));
const originalUpdate = hashProto.update;
let swapped = false;
hashProto.update = function(data, ...args) {
  if (!swapped && data === "litclaude-scanner-snapshot-v1\0") {
    swapped = true;
    fs.renameSync(process.env.LITCLAUDE_RACE_ANCESTOR, process.env.LITCLAUDE_RACE_DISPLACED);
    fs.renameSync(process.env.LITCLAUDE_RACE_REPLACEMENT, process.env.LITCLAUDE_RACE_ANCESTOR);
  }
  return originalUpdate.call(this, data, ...args);
};
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
      size: 2667,
      sha256: "9ec677084179c7e64ffaf3bb8a0b00b67a454d4c73599cd0656e113fd5afc59a",
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

    const raced = runVerifierAncestorRace("intermediate");
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

  it("documents that scanner success is snapshot-scoped rather than post-return live-tree proof", () => {
    for (const path of [join(root, "docs", "development.md"), join(root, "docs", "development_ko-KR.md"), join(root, "docs", "workflow-compatibility-audit.md")]) {
      const text = read(path);
      assert.match(text, /snapshot|스냅샷/iu, path);
      assert.match(text, /digest|다이제스트/iu, path);
      assert.match(text, /live tree|라이브 트리|mutable live/iu, path);
      assert.match(text, /does not prove|입증하지|보장하지/iu, path);
    }
  });

  it("documents independent commitments, immutable package expectations, interval protection, and bounded runtime preflights", () => {
    for (const path of [join(root, "docs", "development.md"), join(root, "docs", "development_ko-KR.md"), join(root, "docs", "workflow-compatibility-audit.md")]) {
      const text = read(path);
      assert.match(text, /outside[\s\S]{0,80}manifest|manifest[\s\S]{0,80}(?:외부|밖)/iu, path);
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

    // The README is the landing page; the guide and skills pages it links to carry the inventory.
    for (const suffix of ["", "_ko-KR"]) {
      const pages = [`README${suffix}.md`, `docs/guide${suffix}.md`, `docs/skills${suffix}.md`];
      const text = pages.map((page) => read(join(root, page))).join("\n");
      assert.doesNotMatch(text, /release material|release candidate|release-candidate/iu);
      assert.doesNotMatch(text, /exactly \*\*?\d+ resources|\d+-resource boundary/iu);
      assert.match(read(join(root, `README${suffix}.md`)), /CHANGELOG\.md/u);
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
