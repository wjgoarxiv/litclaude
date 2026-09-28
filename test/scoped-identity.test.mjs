import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REGISTRY_URL, parseRegistryResponse, readUpdateCache } from "../bin/update-notifier.mjs";
import { PACKAGE_NAME, automaticUpdateTransactionPaths, buildAutomaticInstallInvocation, runAutomaticUpdate } from "../plugins/litclaude/lib/automatic-update.mjs";

const metadata = (name) => ({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ name, version: "9.9.9" }) });

test("scoped npm identity preserves executable aliases and native marketplace routing", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.name, "@litfamily/litclaude");
  assert.equal(PACKAGE_NAME, pkg.name);
  assert.deepEqual(pkg.bin, { "litclaude-ai": "bin/litclaude-ai.js", litclaude: "bin/litclaude-ai.js" });
  assert.equal(pkg.publishConfig.access, "public");
  const marketplace = JSON.parse(readFileSync(new URL("../.claude-plugin/marketplace.json", import.meta.url)));
  assert.equal(marketplace.name, "litclaude-ai");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "litclaude");
  assert.equal(marketplace.plugins[0].source, "./plugins/litclaude");
  assert.equal(REGISTRY_URL, "https://registry.npmjs.org/%40litfamily%2Flitclaude/latest");
  assert.deepEqual(buildAutomaticInstallInvocation("9.9.9").args, ["exec", "--yes", "--package", "@litfamily/litclaude@9.9.9", "--", "litclaude-ai", "install", "--no-auto-update"]);
});

test("metadata rejects old, foreign and malformed scoped identities", () => {
  assert.equal(parseRegistryResponse(metadata("@litfamily/litclaude")).packageName, PACKAGE_NAME);
  for (const name of ["litclaude-ai", "@litfamily/claude", "@litfamily/other", "@litfamily/claude/extra", "@litfamily/litclaude/extra", "@litfamily/../claude", "@litfamily/../litclaude", "https://registry.npmjs.org/@litfamily/claude", "https://registry.npmjs.org/@litfamily/litclaude", " @litfamily/claude", "@litfamily/claude ", " @litfamily/litclaude", "@litfamily/litclaude "]) {
    assert.throws(() => parseRegistryResponse(metadata(name)), /package name/);
  }
});

for (const packageName of ["litclaude-ai", "@litfamily/claude", "@litfamily/other"]) {
  test(`wrong-package registry cache (${packageName}) cannot launch a scoped update and is preserved`, () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-legacy-cache-"));
    try {
      const cachePath = join(home, "latest.json");
      const now = Date.now();
      const bytes = JSON.stringify({ schema: 3, packageName, latestVersion: "9.9.9", checkedAt: new Date(now).toISOString(), attemptedAt: new Date(now).toISOString(), generation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      writeFileSync(cachePath, bytes);
      assert.equal(readUpdateCache(cachePath, { now }), null);
      const result = runAutomaticUpdate({ surface: "session-start", input: { session_id: "migration" }, currentVersion: "0.1.0", cachePath, litHome: home, claudeHome: join(home, "claude"), env: {}, now, spawn: () => assert.fail("old cache launched npm") });
      assert.equal(result.status, "no-candidate");
      assert.equal(readFileSync(cachePath, "utf8"), bytes);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test("scoped update backs up legacy native paths and verifies the installed legacy registry key", () => {
  const home = mkdtempSync(join(tmpdir(), "litclaude-scoped-verify-"));
  try {
    const litHome = join(home, "lit"), claudeHome = join(home, "claude");
    const paths = automaticUpdateTransactionPaths({ litHome, claudeHome });
    assert.equal(paths.find(({ name }) => name === "claude-plugin-cache").path, join(claudeHome, "plugins/cache/litclaude-ai"));
    assert.equal(paths.find(({ name }) => name === "marketplace-state").path, join(litHome, "marketplaces/litclaude-ai"));
    assert.equal(paths.some(({ path }) => path.includes("@litfamily")), false);
    const cachePath = join(home, "latest.json"), now = Date.now();
    writeFileSync(cachePath, JSON.stringify({ schema: 3, packageName: PACKAGE_NAME, latestVersion: "9.9.9", checkedAt: new Date(now).toISOString(), attemptedAt: new Date(now).toISOString(), generation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    const result = runAutomaticUpdate({ surface: "session-start", input: { session_id: "migration" }, currentVersion: "0.1.0", cachePath, litHome, claudeHome, env: {}, now, spawn: (_cmd, args) => {
      if (args.includes("install")) {
        const manifest = join(claudeHome, "plugins/cache/litclaude-ai/litclaude/9.9.9/.claude-plugin");
        mkdirSync(manifest, { recursive: true });
        writeFileSync(join(manifest, "plugin.json"), JSON.stringify({ version: "9.9.9" }));
        writeFileSync(join(claudeHome, "plugins/installed_plugins.json"), JSON.stringify({ plugins: { "litclaude@litclaude-ai": [{ version: "9.9.9" }] } }));
      }
      return { status: 0 };
    } });
    assert.equal(result.status, "installed");
    assert.equal(JSON.parse(readFileSync(result.receiptPath)).packageName, PACKAGE_NAME);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("failed scoped updates restore receipt-bearing legacy cache trees byte for byte", async () => {
  const { assertOwnedTree, writeOwnershipReceipt } = await import("../bin/install-ownership.mjs");
  const home = mkdtempSync(join(tmpdir(), "litclaude-receipt-rollback-"));
  try {
    const claudeHome = join(home, "claude"), litHome = join(home, "lit"), version = "0.1.0";
    const plugin = join(claudeHome, "plugins/cache/litclaude-ai/litclaude", version);
    mkdirSync(plugin, { recursive: true });
    const sentinel = join(plugin, "user-sentinel.txt");
    writeFileSync(sentinel, "original bytes\n");
    writeOwnershipReceipt(plugin, "plugin", version);
    const receipt = join(plugin, ".litclaude-install-receipt.json"), original = readFileSync(receipt);
    const cachePath = join(home, "latest.json"), now = Date.now();
    writeFileSync(cachePath, JSON.stringify({ schema: 3, packageName: PACKAGE_NAME, latestVersion: "9.9.9", checkedAt: new Date(now).toISOString(), attemptedAt: new Date(now).toISOString(), generation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    const result = runAutomaticUpdate({ surface: "session-start", input: { session_id: "rollback" }, currentVersion: version, cachePath, litHome, claudeHome, env: {}, now, spawn: () => {
      writeFileSync(sentinel, "incomplete install");
      writeFileSync(receipt, "invalid receipt");
      return { status: 1 };
    } });
    assert.equal(result.status, "rolled-back");
    assert.equal(readFileSync(sentinel, "utf8"), "original bytes\n");
    assert.deepEqual(readFileSync(receipt), original);
    assert.doesNotThrow(() => assertOwnedTree(plugin, "plugin", version));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
