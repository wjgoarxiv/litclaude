import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = process.env.LITCLAUDE_OWNERSHIP_TEST_BIN || join(root, "bin/litclaude-ai.js");
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const digest = (path) => {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return ["link", readlinkSync(path)];
  if (stat.isDirectory()) return readdirSync(path).sort().map((name) => [name, digest(join(path, name))]);
  return createHash("sha256").update(readFileSync(path)).digest("hex");
};
const fixture = (t) => {
  const path = mkdtempSync(join(tmpdir(), "litclaude-ownership-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const lit = join(path, "lit"), claude = join(path, "claude");
  const run = (command, cli = bin) => spawnSync(process.execPath, [cli, "--no-auto-update", command, ...(command === "install" ? ["--yes"] : [])], {
    cwd: root, encoding: "utf8", timeout: 60000,
    env: { ...process.env, HOME: path, LITCLAUDE_HOME: lit, CLAUDE_CONFIG_DIR: claude, CLAUDE_HOME: claude,
      TMPDIR: path, npm_config_cache: join(path, "npm-cache"), CI: "1", NO_COLOR: "1", LITCLAUDE_NO_UPDATE_CHECK: "1", LITCLAUDE_NO_AUTO_UPDATE: "1" },
  });
  return { path, lit, claude, run, plugin: join(claude, "plugins/cache/litclaude-ai/litclaude", version), marketplace: join(lit, "marketplaces/litclaude-ai"), compatibility: join(lit, "litclaude-ai", version) };
};
const newerCandidate = (f) => {
  const source = join(f.path, "candidate");
  mkdirSync(source);
  cpSync(join(root, "bin"), join(source, "bin"), { recursive: true });
  cpSync(join(root, "plugins"), join(source, "plugins"), { recursive: true });
  const packageJson = JSON.parse(readFileSync(join(root, "package.json")));
  const [major, minor, patch] = packageJson.version.split(".");
  packageJson.version = `${major}.${minor}.${BigInt(patch) + 1n}`;
  writeFileSync(join(source, "package.json"), JSON.stringify(packageJson));
  const manifestPath = join(source, "plugins/litclaude/.claude-plugin/plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.version = packageJson.version;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const nextBin = join(source, "bin/litclaude-ai.js");
  return { nextBin, nextVersion: packageJson.version };
};
const pass = (result) => assert.equal(result.status, 0, result.stderr + result.stdout);
const refusesUnchanged = (f, command) => {
  const before = digest(f.path);
  const result = f.run(command);
  assert.notEqual(result.status, 0, `${command} must refuse foreign or modified install state`);
  assert.match(result.stderr, /INSTALL_OWNERSHIP_CONFLICT/u);
  assert.deepEqual(digest(f.path), before, "refusal must preserve every existing byte and entry");
};

const slice31aVendorPathMap = [
  ["018_llm-wikify", "llm-wikify"],
  ["022_handoff", "handoff"],
  ["045_scientific-visualization", "scientific-visualization"],
  ["060_autoresearch-skill", "autoresearch"],
  ["064_autoconference-skill", "autoconference"],
];
const slice31aActiveManifestPaths = [
  join(root, "plugins/litclaude/lib/canonical-runtime-commitments.mjs"),
  join(root, "plugins/litclaude/lib/bundled-skills-integrity.mjs"),
  join(root, "bin/litclaude-ai.js"),
];
const slice31aActiveManifestText = () => slice31aActiveManifestPaths
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const slice31aOwnershipDigest = (path) => {
  const entries = [];
  const walk = (current, prefix = "") => {
    for (const name of readdirSync(current).sort()) {
      if (!prefix && name === ".litclaude-install-receipt.json") continue;
      const next = join(current, name), rel = prefix ? `${prefix}/${name}` : name, stat = lstatSync(next);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        entries.push([rel, "directory"]);
        walk(next, rel);
      } else if (stat.isFile() && stat.nlink === 1) {
        entries.push([rel, "file", createHash("sha256").update(readFileSync(next)).digest("hex")]);
      } else {
        throw new Error(`unexpected fixture entry: ${next}`);
      }
    }
  };
  walk(path);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
};

const slice31aVendorSnapshot = (path) => {
  const rows = [];
  const walk = (current, prefix = "") => {
    for (const name of readdirSync(current).sort()) {
      const next = join(current, name), rel = prefix ? `${prefix}/${name}` : name, stat = lstatSync(next);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        rows.push([rel, "directory", stat.mode & 0o777]);
        walk(next, rel);
      } else if (stat.isFile() && stat.nlink === 1) {
        rows.push([rel, "file", stat.mode & 0o777, createHash("sha256").update(readFileSync(next)).digest("hex")]);
      } else {
        throw new Error(`unexpected vendor snapshot entry: ${next}`);
      }
    }
  };
  walk(path);
  return rows;
};

const seedLegacyNumberedPlugin = (f) => {
  mkdirSync(join(f.plugin, ".."), { recursive: true });
  cpSync(join(root, "plugins/litclaude"), f.plugin, { recursive: true });
  const vendor = join(f.plugin, "vendor");
  for (const [numbered, canonical] of slice31aVendorPathMap) {
    const oldPath = join(vendor, numbered), canonicalPath = join(vendor, canonical);
    if (existsSync(oldPath)) continue;
    assert.equal(existsSync(canonicalPath), true, `source fixture must contain ${canonical}`);
    renameSync(canonicalPath, oldPath);
  }
  writeFileSync(join(f.plugin, ".litclaude-install-receipt.json"), `${JSON.stringify({
    schema: "litclaude.install-ownership/v1", owner: "litclaude-ai", kind: "plugin", version,
    sha256: slice31aOwnershipDigest(f.plugin),
  })}\n`);
};

const seedOwnedLegacyKoreanSkill = (f) => {
  const copies = [f.plugin, join(f.marketplace, "plugins/litclaude"), join(f.compatibility, "plugins/litclaude")];
  for (const plugin of copies) {
    const legacy = join(plugin, "skills/lit-korean");
    mkdirSync(join(legacy, "references"), { recursive: true });
    writeFileSync(join(legacy, "SKILL.md"), "legacy Korean workflow baseline\n");
    writeFileSync(join(legacy, "references/style.md"), "legacy style notes\n");
  }
  for (const [path, kind] of [[f.plugin, "plugin"], [f.marketplace, "marketplace"], [f.compatibility, "compatibility"]]) {
    writeFileSync(join(path, ".litclaude-install-receipt.json"), `${JSON.stringify({
      schema: "litclaude.install-ownership/v1", owner: "litclaude-ai", kind, version,
      sha256: slice31aOwnershipDigest(path),
    }, null, 2)}\n`);
  }
};

test("[slice31a] active vendor manifests expose canonical unnumbered paths", () => {
  const source = slice31aActiveManifestText();
  const missing = slice31aVendorPathMap
    .filter(([, canonical]) => !source.includes(`vendor/${canonical}`))
    .map(([, canonical]) => canonical);
  assert.deepEqual(missing, [], "active manifests must list every canonical vendor path");
});

test("[slice31a] active vendor manifests omit numbered paths", () => {
  const source = slice31aActiveManifestText();
  const stale = slice31aVendorPathMap
    .filter(([numbered]) => source.includes(`vendor/${numbered}`))
    .map(([numbered]) => numbered);
  assert.deepEqual(stale, [], "active manifests must not retain numbered vendor paths");
});

const slice31aNumberedVendor = "vendor/022_handoff";
const slice31aNonregularRecord = (path) => {
  const exists = existsSync(path);
  if (!exists) return { path, exists: false };
  const stat = lstatSync(path);
  const type = stat.isFIFO() ? "fifo" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  return { path, exists: true, type, mode: stat.mode, dev: stat.dev, ino: stat.ino };
};
const slice31aRefusalFixtures = [
  ["modified numbered vendor payload", (f) => {
    seedLegacyNumberedPlugin(f);
    const path = join(f.plugin, slice31aNumberedVendor, "SKILL.md");
    assert.equal(existsSync(path), true, "the numbered fixture must be seeded before mutation");
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n[slice31a modified]\n")]));
  }],
  ["foreign numbered vendor payload", (f) => {
    seedLegacyNumberedPlugin(f);
    const path = join(f.plugin, slice31aNumberedVendor);
    writeFileSync(join(path, "slice31a-foreign.txt"), "foreign\n");
  }],
  ["symlinked numbered vendor parent", (f) => {
    seedLegacyNumberedPlugin(f);
    rmSync(join(f.plugin, "vendor"), { recursive: true });
    const outside = join(f.path, "slice31a-outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "preserved.txt"), "outside\n");
    symlinkSync(outside, join(f.plugin, "vendor"), "dir");
  }],
  ["nonregular numbered vendor parent", (f) => {
    seedLegacyNumberedPlugin(f);
    rmSync(join(f.plugin, "vendor"), { recursive: true });
    const result = spawnSync("/usr/bin/mkfifo", [join(f.plugin, "vendor")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }],
  ["unsupported numbered vendor receipt", (f) => {
    seedLegacyNumberedPlugin(f);
    const path = join(f.plugin, slice31aNumberedVendor);
    writeFileSync(join(path, ".litclaude-install-receipt.json"), JSON.stringify({ schema: "unsupported" }));
  }],
];

for (const [label, prepare] of slice31aRefusalFixtures) {
  test(`[slice31a] install refuses and preserves ${label}`, (t) => {
    const f = fixture(t);
    prepare(f);
    const nonregular = label === "nonregular numbered vendor parent";
    const before = nonregular ? slice31aNonregularRecord(join(f.plugin, "vendor")) : digest(f.path);
    const result = f.run("install");
    assert.notEqual(result.status, 0, `${label} must be refused`);
    assert.match(result.stderr, /INSTALL_OWNERSHIP_CONFLICT/u);
    const after = nonregular ? slice31aNonregularRecord(join(f.plugin, "vendor")) : digest(f.path);
    assert.deepEqual(after, before, `${label} refusal must preserve the fixture`);
  });
}

for (const command of ["install", "update"]) {
  test(`[slice31b] ${command} migrates a pristine numbered vendor installation`, (t) => {
    const f = fixture(t);
    seedLegacyNumberedPlugin(f);
    const before = slice31aVendorPathMap.map(([numbered]) => slice31aVendorSnapshot(join(f.plugin, "vendor", numbered)));
    const result = f.run(command);
    pass(result);
    for (const [[numbered, canonical], snapshot] of slice31aVendorPathMap.map((entry, index) => [entry, before[index]])) {
      assert.equal(existsSync(join(f.plugin, "vendor", numbered)), false, `${numbered} must not remain active`);
      assert.deepEqual(slice31aVendorSnapshot(join(f.plugin, "vendor", canonical)), snapshot, `${canonical} must preserve bytes and modes`);
    }
  });
}

test("install refuses a foreign payload before writing settings or removing files", (t) => {
  const f = fixture(t);
  mkdirSync(f.plugin, { recursive: true });
  writeFileSync(join(f.plugin, "foreign.txt"), "do not remove\n");
  refusesUnchanged(f, "install");
});

for (const command of ["install", "update", "uninstall"]) {
  test(`${command} explains an unsupported receiptless marketplace without changing the profile`, (t) => {
    const f = fixture(t);
    mkdirSync(f.marketplace, { recursive: true });
    writeFileSync(join(f.marketplace, "preserved-local-file.txt"), "unrecognized legacy bytes\n");
    const before = digest(f.path);
    const result = f.run(command);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(`INSTALL_OWNERSHIP_CONFLICT: ${f.marketplace};`));
    assert.match(result.stderr, /No ownership receipt/u);
    assert.match(result.stderr, /supported pristine legacy baseline/u);
    assert.match(result.stderr, /Do not move only the reported directory/u);
    assert.match(result.stderr, /separate trial profile/u);
    assert.match(result.stderr, /docs\/migration\.md#ownership-conflicts/u);
    assert.deepEqual(digest(f.path), before, "guidance must preserve all profile bytes and entries");
  });
}

test("install refuses symlinked ancestors without touching their targets", (t) => {
  const f = fixture(t);
  mkdirSync(f.claude, { recursive: true });
  const outside = join(f.path, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep"), "foreign");
  symlinkSync(outside, join(f.claude, "plugins"), "dir");
  refusesUnchanged(f, "install");
});

test("modified payloads and foreign marketplace/compatibility entries block install and uninstall atomically", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  for (const [directory, name, mutation] of [
    [f.plugin, "bin/litclaude-hook.js", "modified hook\n"],
    [f.marketplace, "foreign.txt", "foreign marketplace\n"],
    [f.compatibility, "foreign.txt", "foreign compatibility\n"],
  ]) {
    const path = join(directory, name);
    const original = existsSync(path) ? readFileSync(path) : null;
    writeFileSync(path, mutation);
    refusesUnchanged(f, "install");
    refusesUnchanged(f, "uninstall");
    if (original) writeFileSync(path, original); else rmSync(path);
  }
  pass(f.run("install"));
  pass(f.run("uninstall"));
  assert.equal(existsSync(f.plugin), false);
  assert.equal(existsSync(f.marketplace), false);
  assert.equal(existsSync(f.compatibility), false);
  assert.equal(existsSync(join(f.lit, "current")), false);
});

test("install preserves only a modified legacy lit-korean subtree and reports its backup", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  seedOwnedLegacyKoreanSkill(f);
  const legacy = join(f.plugin, "skills/lit-korean");
  writeFileSync(join(legacy, "SKILL.md"), "user-customized Korean workflow\n");

  const result = f.run("install");
  pass(result);
  assert.match(result.stderr, /INSTALL_WARNING: PRESERVED_MODIFIED_SKILL lit-korean/u);
  assert.equal(existsSync(join(f.plugin, "skills/lit-korean")), false);
  assert.deepEqual(readFileSync(join(f.plugin, "skills/lit-humanizer", "SKILL.md")), readFileSync(join(root, "plugins/litclaude/skills/lit-humanizer/SKILL.md")));

  const versionBackup = join(f.lit, "preserved-skills/lit-korean", version);
  const backups = readdirSync(versionBackup);
  assert.equal(backups.length, 1);
  const saved = join(versionBackup, backups[0], "skill", "SKILL.md");
  assert.equal(readFileSync(saved, "utf8"), "user-customized Korean workflow\n");
  assert.equal(readFileSync(join(dirname(saved), "references/style.md"), "utf8"), "legacy style notes\n");
  assert.equal(existsSync(join(f.claude, "skills/lit-korean")), false);
});

test("install preserves a modified legacy lit-korean subtree across a patch upgrade", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  seedOwnedLegacyKoreanSkill(f);
  writeFileSync(join(f.plugin, "skills/lit-korean/SKILL.md"), "user-customized Korean workflow\n");
  const { nextBin, nextVersion } = newerCandidate(f);

  const result = f.run("install", nextBin);
  pass(result);
  assert.equal(result.stderr.match(/INSTALL_WARNING: PRESERVED_MODIFIED_SKILL lit-korean at .+/gu)?.length, 1);

  const installedRoot = join(f.claude, "plugins/cache/litclaude-ai/litclaude", nextVersion);
  const installedRegistry = JSON.parse(readFileSync(join(f.claude, "plugins/installed_plugins.json"), "utf8"));
  assert.equal(installedRegistry.plugins["litclaude@litclaude-ai"][0].version, nextVersion);
  assert.equal(installedRegistry.plugins["litclaude@litclaude-ai"][0].installPath, installedRoot);
  assert.equal(existsSync(join(installedRoot, "skills/lit-korean")), false);
  assert.equal(readFileSync(join(installedRoot, "skills/lit-humanizer/SKILL.md"), "utf8"), readFileSync(join(root, "plugins/litclaude/skills/lit-humanizer/SKILL.md"), "utf8"));

  const preservedRoot = join(f.lit, "preserved-skills/lit-korean", version);
  const preservedVersions = readdirSync(preservedRoot);
  assert.equal(preservedVersions.length, 1);
  assert.equal(readFileSync(join(preservedRoot, preservedVersions[0], "skill/SKILL.md"), "utf8"), "user-customized Korean workflow\n");
});

test("install removes a pristine legacy lit-korean subtree from every managed copy", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  seedOwnedLegacyKoreanSkill(f);
  const result = f.run("install");
  pass(result);
  assert.doesNotMatch(result.stderr, /PRESERVED_MODIFIED_SKILL/u);
  for (const plugin of [f.plugin, join(f.marketplace, "plugins/litclaude"), join(f.compatibility, "plugins/litclaude")]) {
    assert.equal(existsSync(join(plugin, "skills/lit-korean")), false, `${plugin} must not retain the retired skill`);
    assert.equal(existsSync(join(plugin, "skills/lit-humanizer/SKILL.md")), true);
  }
});

test("legacy skill preservation refuses a simultaneous non-skill payload change", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  seedOwnedLegacyKoreanSkill(f);
  writeFileSync(join(f.plugin, "skills/lit-korean/SKILL.md"), "user-customized Korean workflow\n");
  writeFileSync(join(f.plugin, "bin/litclaude-hook.js"), "foreign change\n");
  refusesUnchanged(f, "install");
});

test("uninstall preserves unrelated cache versions, notifier data, and host settings", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  const foreignPaths = [join(f.claude, "plugins/cache/litclaude-ai/another-plugin/data"), join(f.lit, "litclaude-ai/foreign-version/data"), join(f.lit, "update-notifier/foreign.txt")];
  for (const path of foreignPaths) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "foreign bytes\n");
  }
  const settingsPath = join(f.claude, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath));
  settings.userOwned = { preserved: true };
  writeFileSync(settingsPath, JSON.stringify(settings));
  pass(f.run("uninstall"));
  for (const path of foreignPaths) assert.equal(readFileSync(path, "utf8"), "foreign bytes\n");
  assert.deepEqual(JSON.parse(readFileSync(settingsPath)).userOwned, { preserved: true });
});


test("current pointers, receipt corruption, and linked settings refuse before all writes", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  const receiptPath = join(f.plugin, ".litclaude-install-receipt.json");
  const receipt = readFileSync(receiptPath);
  writeFileSync(receiptPath, "{ invalid receipt");
  refusesUnchanged(f, "install");
  refusesUnchanged(f, "uninstall");
  writeFileSync(receiptPath, receipt);
  const current = join(f.lit, "current");
  const originalTarget = readlinkSync(current);
  rmSync(current);
  symlinkSync(f.path, current, "dir");
  refusesUnchanged(f, "install");
  refusesUnchanged(f, "uninstall");
  rmSync(current);
  symlinkSync(originalTarget, current, "dir");
  const settings = join(f.claude, "settings.json");
  const bytes = readFileSync(settings);
  rmSync(settings);
  const other = join(f.path, "foreign-settings.json");
  writeFileSync(other, bytes);
  symlinkSync(other, settings);
  refusesUnchanged(f, "install");
  refusesUnchanged(f, "uninstall");
  rmSync(settings);
  writeFileSync(settings, bytes);
  pass(f.run("uninstall"));
});

test("a newer package can replace clean older receipts while preserving older cache versions", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  const { nextBin, nextVersion } = newerCandidate(f);
  pass(f.run("install", nextBin));
  assert.equal(readlinkSync(join(f.lit, "current")), join(f.lit, "litclaude-ai", nextVersion));
  assert.equal(existsSync(f.plugin), true);
  assert.equal(existsSync(f.compatibility), true);
  pass(f.run("install", nextBin));
  pass(f.run("uninstall", nextBin));
  assert.equal(existsSync(join(f.claude, "plugins/cache/litclaude-ai/litclaude", nextVersion)), false);
  assert.equal(existsSync(f.plugin), true);
  assert.equal(existsSync(f.compatibility), true);
});

test("the empty .in_use folder Claude Code adds to a cache version does not count as foreign state", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  mkdirSync(join(f.plugin, ".in_use"));
  pass(f.run("install"));
  const { nextBin, nextVersion } = newerCandidate(f);
  pass(f.run("install", nextBin));
  assert.equal(readlinkSync(join(f.lit, "current")), join(f.lit, "litclaude-ai", nextVersion));
  pass(f.run("uninstall", nextBin));
  assert.equal(existsSync(join(f.claude, "plugins/cache/litclaude-ai/litclaude", nextVersion)), false);
});

test("a file named .in_use is still foreign state", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  writeFileSync(join(f.plugin, ".in_use"), "not a folder");
  const result = f.run("install");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /INSTALL_OWNERSHIP_CONFLICT/);
});

test("repeat install and uninstall preserve a user-changed HUD setting", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  const settingsPath = join(f.claude, "settings.json");
  const originalHud = JSON.parse(readFileSync(settingsPath)).statusLine;
  for (const desired of [{ type: "command", command: "user-owned-hud" }, { ...originalHud, padding: 3 }, undefined]) {
    const settings = JSON.parse(readFileSync(settingsPath));
    if (desired === undefined) delete settings.statusLine; else settings.statusLine = desired;
    writeFileSync(settingsPath, JSON.stringify(settings));
    pass(f.run("install"));
    assert.deepEqual(JSON.parse(readFileSync(settingsPath)).statusLine, desired);
  }
  pass(f.run("uninstall"));
  assert.equal(JSON.parse(readFileSync(settingsPath)).statusLine, undefined);
});

test("same-ID foreign native registrations and changed marketplace sources are preserved", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  for (const [relative, mutate] of [
    ["plugins/installed_plugins.json", (value) => value.plugins["litclaude@litclaude-ai"].push({ scope: "project", installPath: "/foreign/project", version })],
    ["plugins/installed_plugins.json", (value) => { value.plugins["litclaude@litclaude-ai"][0].installedBy = "another-installer"; }],
    ["plugins/known_marketplaces.json", (value) => { value["litclaude-ai"].source = { source: "github", repo: "foreign/marketplace" }; }],
    ["settings.json", (value) => { value.extraKnownMarketplaces["litclaude-ai"].source = { source: "directory", path: "/foreign/marketplace" }; }],
  ]) {
    const path = join(f.claude, relative);
    const original = readFileSync(path);
    const value = JSON.parse(original);
    mutate(value);
    writeFileSync(path, JSON.stringify(value));
    refusesUnchanged(f, "install");
    refusesUnchanged(f, "uninstall");
    writeFileSync(path, original);
  }
  pass(f.run("uninstall"));
});

// A host rewrite of installed_plugins.json can drop keys it does not know, leaving the
// LitClaude entry without installedBy/enabled while every owned path stays intact.
test("a native registration stripped of installedBy and enabled stays manageable", (t) => {
  const f = fixture(t);
  pass(f.run("install"));
  const registryPath = join(f.claude, "plugins/installed_plugins.json");
  const registry = JSON.parse(readFileSync(registryPath));
  const [entry] = registry.plugins["litclaude@litclaude-ai"];
  delete entry.installedBy;
  delete entry.enabled;
  writeFileSync(registryPath, JSON.stringify(registry));
  pass(f.run("install"));
  pass(f.run("update"));
  pass(f.run("uninstall"));
});

const newerActiveFixture = (t, surface) => {
  const f = fixture(t);
  pass(f.run("install"));
  const registryPath = join(f.claude, "plugins/installed_plugins.json");
  const oldRegistry = readFileSync(registryPath);
  const settingsPath = join(f.claude, "settings.json");
  const oldSettings = readFileSync(settingsPath);
  const oldMarketplace = join(f.path, "old-marketplace");
  cpSync(f.marketplace, oldMarketplace, { recursive: true });
  const { nextBin, nextVersion } = newerCandidate(f);
  pass(f.run("install", nextBin));
  // Leave exactly one newer active surface, so another guard cannot mask it.
  if (surface !== "managed HUD") writeFileSync(settingsPath, oldSettings);
  if (surface !== "native registration") writeFileSync(registryPath, oldRegistry);
  if (surface !== "shared marketplace") {
    rmSync(f.marketplace, { recursive: true });
    cpSync(oldMarketplace, f.marketplace, { recursive: true });
  }
  const current = join(f.lit, "current");
  if (surface !== "current link") {
    rmSync(current);
    if (surface === "current directory") cpSync(join(f.lit, "litclaude-ai", nextVersion), current, { recursive: true });
    else symlinkSync(f.compatibility, current, "dir");
  }
  return { ...f, nextVersion };
};

for (const surface of ["current link", "current directory", "native registration", "shared marketplace", "managed HUD"]) {
  for (const command of ["install", "update", "uninstall"]) {
    test(`${command} refuses newer active ${surface} without changing any bytes or links`, (t) => {
      const f = newerActiveFixture(t, surface);
      refusesUnchanged(f, command);
    });
  }
}

test("inactive newer cache versions do not block current install, update, or uninstall", (t) => {
  const f = newerActiveFixture(t, "inactive caches");
  const inactive = [join(f.lit, "litclaude-ai", f.nextVersion), join(f.claude, "plugins/cache/litclaude-ai/litclaude", f.nextVersion)];
  const before = inactive.map(digest);
  for (const command of ["install", "update", "uninstall"]) {
    pass(f.run(command));
    assert.deepEqual(inactive.map(digest), before);
  }
});

// The registry no longer serves litclaude-ai; keep the published tarball outside git and
// point LITCLAUDE_PUBLISHED_046_TGZ at it (default: evidence/published-0.4.6/). The integrity
// check keeps a locally rebuilt 0.4.6 from standing in for the published bytes.
const published046 = process.env.LITCLAUDE_PUBLISHED_046_TGZ || join(root, "evidence/published-0.4.6/litclaude-ai-0.4.6.tgz");
const published046Integrity = "sha512-dg07v2HRmKiUUREpjpqxevuq82FcwIRW0haX43MxSjUTdcG5DcKrKZRc+Rx4QqF6G/bTKMssolF97Dmti8ctdA==";

for (const hostRewrite of [false, true]) test(`a pristine install of the published litclaude-ai@0.4.6 upgrades in place${hostRewrite ? " after a host registry rewrite" : ""}`, { skip: !existsSync(published046) && "published 0.4.6 tarball not present" }, (t) => {
  assert.equal(`sha512-${createHash("sha512").update(readFileSync(published046)).digest("base64")}`, published046Integrity);
  const f = fixture(t);
  const extracted = join(f.path, "published-046");
  mkdirSync(extracted);
  pass(spawnSync("tar", ["-xzf", published046, "-C", extracted], { encoding: "utf8" }));
  const oldBin = join(extracted, "package/bin/litclaude-ai.js");
  pass(spawnSync(process.execPath, [oldBin, "install", "--yes"], {
    cwd: root, encoding: "utf8", timeout: 60000,
    env: { ...process.env, HOME: f.path, LITCLAUDE_HOME: f.lit, CLAUDE_CONFIG_DIR: f.claude, CLAUDE_HOME: f.claude,
      TMPDIR: f.path, npm_config_cache: join(f.path, "npm-cache"), NO_COLOR: "1", NO_UPDATE_NOTIFIER: "1" },
  }));
  assert.equal(readlinkSync(join(f.lit, "current")), join(f.lit, "litclaude-ai", "0.4.6"));
  if (hostRewrite) {
    const registryPath = join(f.claude, "plugins/installed_plugins.json");
    const registry = JSON.parse(readFileSync(registryPath));
    for (const entry of registry.plugins["litclaude@litclaude-ai"]) { delete entry.installedBy; delete entry.enabled; }
    writeFileSync(registryPath, JSON.stringify(registry));
  }
  pass(f.run("install"));
  assert.equal(readlinkSync(join(f.lit, "current")), join(f.lit, "litclaude-ai", version));
  assert.equal(existsSync(join(f.claude, "plugins/cache/litclaude-ai/litclaude/0.4.6")), true);
});
