import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CACHE_TTL_MS,
  runAutomaticUpdate,
  sanitizeNpmEnvironment,
} from "../plugins/litclaude/lib/automatic-update.mjs";

const GENERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const tty = { isTTY: true, write() {} };

describe("foreground automatic update", () => {
  it("characterizes the existing notifier boundary as cache-only", async () => {
    const { runUpdateNotifier, writeUpdateCache } = await import("../bin/update-notifier.mjs");
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-characterization-"));
    const cachePath = join(home, "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    try {
      writeUpdateCache(cachePath, {
        packageName: "@litfamily/litclaude",
        latestVersion: "9.9.9",
        checkedAt: new Date(now - 86_400_001).toISOString(),
        attemptedAt: new Date(now - 86_400_001).toISOString(),
        generation: GENERATION,
      }, { now });
      let refreshes = 0;
      const result = runUpdateNotifier({
        command: "doctor",
        rest: [],
        dryRun: false,
        currentVersion: "0.3.40",
        cachePath,
        env: {},
        stdin: tty,
        stdout: tty,
        stderr: tty,
        now,
        spawnRefresh: () => {
          refreshes += 1;
          return true;
        },
      });
      assert.equal(result, "noticed-refreshing");
      assert.equal(refreshes, 1);
      assert.equal(readFileSync(cachePath, "utf8").includes("9.9.9"), true);
      // This is the pre-change contract: the advisory refresh never invokes npm.
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("installs the exact stable candidate in the foreground and writes a receipt", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-red-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    const invocations = [];
    let verifiedTarget;
    try {
      mkdirSync(join(litHome, "update-notifier"), { recursive: true });
      writeFileSync(cachePath, `${JSON.stringify({
        schema: 3,
        packageName: "@litfamily/litclaude",
        latestVersion: "0.3.41",
        checkedAt: new Date(now - 1_000).toISOString(),
        attemptedAt: new Date(now - 1_000).toISOString(),
        generation: GENERATION,
      })}\n`);
      const result = runAutomaticUpdate({
        surface: "session-start",
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        claudeHome,
        env: {
          LITCLAUDE_HOME: litHome,
          CLAUDE_CONFIG_DIR: claudeHome,
        },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now,
        spawn: (command, args, options) => {
          invocations.push({ command, args, options });
          return { status: 0, stdout: "INSTALL_PASS\n", stderr: "" };
        },
        verifyInstall: ({ targetVersion }) => {
          verifiedTarget = targetVersion;
          return targetVersion === "0.3.41";
        },
      });

      assert.equal(result.status, "installed");
      assert.deepEqual(invocations.map(({ command, args }) => ({ command, args })), [
        {
          command: "npm",
          args: ["exec", "--yes", "--package", "@litfamily/litclaude@0.3.41", "--", "litclaude-ai", "install", "--no-auto-update"],
        },
        {
          command: "npm",
          args: ["exec", "--yes", "--package", "@litfamily/litclaude@0.3.41", "--", "litclaude-ai", "doctor", "--no-auto-update"],
        },
      ]);
      assert.equal(invocations[0].options.timeout > 0, true);
      assert.equal(verifiedTarget, "0.3.41");
      assert.equal(result.receiptPath.endsWith("receipt.json"), true);
      assert.equal(JSON.parse(readFileSync(result.receiptPath, "utf8")).status, "installed");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("removes npm credentials and preserves only safe registry/proxy settings", () => {
    const env = sanitizeNpmEnvironment({
      PATH: "/safe/bin",
      HOME: "/safe/home",
      LITCLAUDE_HUD_APPEARANCE: "light",
      LITCLAUDE_HUD_COLOR_DEPTH: "16",
      LITCLAUDE_HUD_NO_COLOR: "1",
      NPM_TOKEN: "secret",
      NODE_AUTH_TOKEN: "secret",
      npm_config_userconfig: "/secret/.npmrc",
      npm_config_registry: "https://registry.example.test/",
      HTTPS_PROXY: "https://proxy.example.test/",
      HTTP_PROXY: "http://user:password@proxy.example.test/",
    });
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.NODE_AUTH_TOKEN, undefined);
    assert.equal(env.npm_config_userconfig, undefined);
    assert.equal(env.npm_config_registry, "https://registry.example.test/");
    assert.equal(env.HTTPS_PROXY, "https://proxy.example.test/");
    assert.equal(env.HTTP_PROXY, undefined);
    assert.equal(env.LITCLAUDE_HUD_APPEARANCE, "light");
    assert.equal(env.LITCLAUDE_HUD_COLOR_DEPTH, "16");
    assert.equal(env.LITCLAUDE_HUD_NO_COLOR, "1");
  });

  it("keeps opt-outs, non-interactive surfaces, stale cache, and recursion no-op", () => {
    const base = {
      surface: "management",
      command: "doctor",
      rest: [],
      currentVersion: "0.3.40",
      env: {},
      stdin: tty,
      stdout: tty,
      stderr: tty,
    };
    for (const env of [
      { CI: "1" },
      { NO_UPDATE_NOTIFIER: "1" },
      { LITCLAUDE_NO_UPDATE_CHECK: "1" },
      { LITCLAUDE_NO_AUTO_UPDATE: "1" },
      { LITCLAUDE_AUTO_UPDATE_ACTIVE: "1" },
    ]) {
      const result = runAutomaticUpdate({ ...base, env, spawn: () => assert.fail("opt-out must not spawn npm") });
      assert.equal(result.status, "gated");
    }
    for (const variant of [
      { surface: "tool" },
      { surface: "management", stdin: { isTTY: false } },
      { surface: "management", rest: ["--json"] },
      { surface: "management", dryRun: true },
      { surface: "session-start", input: { hook_event_name: "SessionStart" } },
    ]) {
      const result = runAutomaticUpdate({ ...base, ...variant, spawn: () => assert.fail("ineligible surface must not spawn npm") });
      assert.equal(result.status, "gated");
    }

    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-stale-"));
    const litHome = join(home, "lit");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.41",
      checkedAt: new Date(now - CACHE_TTL_MS - 1).toISOString(),
      attemptedAt: new Date(now - CACHE_TTL_MS - 1).toISOString(),
      generation: GENERATION,
    })}\n`);
    try {
      const result = runAutomaticUpdate({
        ...base,
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        now,
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        surface: "session-start",
        spawn: () => assert.fail("stale cache must not spawn npm"),
        spawnRefresh: () => true,
      });
      assert.equal(result.status, "stale-cache");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rolls back when npm reports success but doctor/version verification fails", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-rollback-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.41",
      checkedAt: new Date(now - 1_000).toISOString(),
      attemptedAt: new Date(now - 1_000).toISOString(),
      generation: GENERATION,
    })}\n`);
    try {
      const result = runAutomaticUpdate({
        surface: "session-start",
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        claudeHome,
        env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now,
        spawn: () => ({ status: 0, stdout: "success-looking output\n", stderr: "" }),
        verifyInstall: () => false,
      });
      assert.equal(result.status, "rolled-back");
      const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
      assert.equal(receipt.rollback.ok, true);
      assert.equal(receipt.verified, false);
      assert.equal(readFileSync(result.receiptPath, "utf8").includes("success-looking"), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rolls back a misleading zero-status spawn error and records the receipt", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-spawn-error-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.41",
      checkedAt: new Date(now - 1_000).toISOString(),
      attemptedAt: new Date(now - 1_000).toISOString(),
      generation: GENERATION,
    })}\n`);
    const calls = [];
    try {
      const result = runAutomaticUpdate({
        surface: "session-start",
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        claudeHome,
        env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now,
        spawn: (command, args) => {
          calls.push({ command, args });
          return { status: 0, error: new Error("some spawn error"), stdout: "", stderr: "" };
        },
        verifyInstall: () => assert.fail("version verification must not run after a spawn error"),
      });
      assert.equal(result.status, "rolled-back");
      assert.equal(calls.length, 1, "doctor must not run after a spawn error");
      const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
      assert.equal(receipt.status, "rolled-back");
      assert.equal(receipt.install.ok, false);
      assert.equal(receipt.install.errorCode, "SPAWN_ERROR");
      assert.equal(receipt.rollback.ok, true);
      assert.equal(readFileSync(result.receiptPath, "utf8").includes("some spawn error"), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("records timeout and fences the child from recursive automatic updates", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-timeout-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.41",
      checkedAt: new Date(now - 1_000).toISOString(),
      attemptedAt: new Date(now - 1_000).toISOString(),
      generation: GENERATION,
    })}\n`);
    const calls = [];
    try {
      const result = runAutomaticUpdate({
        surface: "session-start",
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        claudeHome,
        env: {
          LITCLAUDE_HOME: litHome,
          CLAUDE_CONFIG_DIR: claudeHome,
          NPM_TOKEN: "do-not-forward",
        },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now,
        spawn: (command, args, options) => {
          calls.push({ command, args, options });
          return { status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" };
        },
      });
      assert.equal(result.status, "rolled-back");
      assert.equal(calls.length, 1, "doctor must not run after a timed-out install");
      assert.equal(calls[0].args.at(-1), "--no-auto-update");
      assert.equal(calls[0].options.env.NPM_TOKEN, undefined);
      assert.equal(calls[0].options.env.LITCLAUDE_AUTO_UPDATE_ACTIVE, "1");
      assert.equal(calls[0].options.timeout > 0, true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("surfaces rollback failure as unknown state instead of claiming retention", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-unknown-state-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.41",
      checkedAt: new Date(now - 1_000).toISOString(),
      attemptedAt: new Date(now - 1_000).toISOString(),
      generation: GENERATION,
    })}\n`);
    try {
      const result = runAutomaticUpdate({
        surface: "session-start",
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        claudeHome,
        env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now,
        spawn: () => ({ status: 0, stdout: "", stderr: "" }),
        verifyInstall: () => false,
        restore: () => { throw new Error("simulated restore I/O failure"); },
      });
      assert.equal(result.status, "rollback-failed");
      const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
      assert.equal(receipt.rollback.ok, false);
      assert.match(receipt.rollback.error, /simulated restore I\/O failure/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("stale cache on session-start refreshes latest.json", async () => {
    const { refreshSessionUpdateCache } = await import("../plugins/litclaude/lib/automatic-update.mjs");
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-refresh-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-10-11T00:00:00.000Z");
    const stale = new Date(now - CACHE_TTL_MS - 1).toISOString();
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.40",
      checkedAt: stale,
      attemptedAt: stale,
      generation: GENERATION,
    })}\n`);
    const scheduled = [];
    const base = {
      surface: "session-start",
      currentVersion: "0.3.40",
      cachePath,
      litHome,
      claudeHome,
      env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome, npm_config_registry: "http://127.0.0.1:9/" },
      input: { hook_event_name: "SessionStart", session_id: "session-test" },
      now,
      spawn: () => assert.fail("a stale cache must not install"),
      spawnRefresh: (...args) => {
        scheduled.push(args);
        return true;
      },
    };
    try {
      for (const optOut of ["CI", "NO_UPDATE_NOTIFIER", "LITCLAUDE_NO_UPDATE_CHECK", "LITCLAUDE_NO_AUTO_UPDATE"]) {
        const gated = runAutomaticUpdate({ ...base, env: { ...base.env, [optOut]: "" } });
        assert.equal(gated.status, "gated", optOut);
      }
      assert.equal(runAutomaticUpdate({ ...base, noAutoUpdate: true }).status, "gated");
      assert.equal(scheduled.length, 0, "an opt-out must not schedule a registry request");

      const first = runAutomaticUpdate(base);
      assert.equal(first.status, "stale-cache");
      assert.equal(first.refresh, "scheduled");
      assert.equal(scheduled.length, 1);
      const [refreshCachePath, generation, registryUrl] = scheduled[0];
      assert.equal(refreshCachePath, cachePath);
      assert.equal(registryUrl, "http://127.0.0.1:9/%40litfamily%2Flitclaude/latest");
      const attempted = JSON.parse(readFileSync(cachePath, "utf8"));
      assert.equal(attempted.generation, generation);
      assert.equal(attempted.attemptedAt, new Date(now).toISOString());
      assert.equal(attempted.latestVersion, "0.3.40");

      const second = runAutomaticUpdate(base);
      assert.equal(second.refresh, "throttled");
      assert.equal(scheduled.length, 1, "a second session inside the attempt window must not request again");

      const requests = [];
      const refreshed = await refreshSessionUpdateCache({
        cachePath,
        generation,
        registryUrl,
        now: () => now + 1_000,
        fetch: async (url, init) => {
          requests.push({ url, init });
          return new Response(JSON.stringify({ name: "@litfamily/litclaude", version: "9.9.9" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });
      assert.equal(refreshed, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, registryUrl);
      assert.equal(requests[0].init.redirect, "error");
      assert.equal(requests[0].init.signal instanceof AbortSignal, true);
      const cache = JSON.parse(readFileSync(cachePath, "utf8"));
      assert.equal(cache.latestVersion, "9.9.9");
      assert.equal(cache.checkedAt, new Date(now + 1_000).toISOString());
      assert.equal(cache.generation, generation);

      const installs = [];
      const third = runAutomaticUpdate({
        ...base,
        now: now + 2_000,
        spawn: (command, args) => {
          installs.push(args);
          return { status: 1, stdout: "", stderr: "" };
        },
      });
      assert.equal(third.status, "rolled-back");
      assert.equal(installs[0].includes("@litfamily/litclaude@9.9.9"), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("an offline refresh leaves the attempt record and settles", async () => {
    const { refreshSessionUpdateCache } = await import("../plugins/litclaude/lib/automatic-update.mjs");
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-offline-"));
    const cachePath = join(home, "latest.json");
    const now = Date.parse("2026-10-11T00:00:00.000Z");
    const record = `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: null,
      checkedAt: null,
      attemptedAt: new Date(now).toISOString(),
      generation: GENERATION,
    })}\n`;
    writeFileSync(cachePath, record);
    try {
      for (const fetch of [
        async () => { throw new TypeError("fetch failed"); },
        async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } }),
        async () => new Response(JSON.stringify({ name: "other-package", version: "9.9.9" }), { status: 200, headers: { "content-type": "application/json" } }),
      ]) {
        const refreshed = await refreshSessionUpdateCache({
          cachePath,
          generation: GENERATION,
          registryUrl: "https://registry.npmjs.org/%40litfamily%2Flitclaude/latest",
          now: () => now + 1_000,
          fetch,
        });
        assert.equal(refreshed, false);
        assert.equal(readFileSync(cachePath, "utf8"), record);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("installed target is not reinstalled", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-installed-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const now = Date.parse("2026-10-11T00:00:00.000Z");
    mkdirSync(join(litHome, "update-notifier"), { recursive: true });
    mkdirSync(join(claudeHome, "plugins"), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.41",
      checkedAt: new Date(now - 1_000).toISOString(),
      attemptedAt: new Date(now - 1_000).toISOString(),
      generation: GENERATION,
    })}\n`);
    // A long-lived Claude Code process keeps running the hook from the folder it started
    // with, so its plugin version stays 0.3.40 after 0.3.41 was already installed.
    writeFileSync(join(claudeHome, "plugins", "installed_plugins.json"), `${JSON.stringify({
      version: 2,
      plugins: { "litclaude@litclaude-ai": [{ scope: "user", version: "0.3.41" }] },
    })}\n`);
    try {
      const result = runAutomaticUpdate({
        surface: "session-start",
        currentVersion: "0.3.40",
        cachePath,
        litHome,
        claudeHome,
        env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome },
        input: { hook_event_name: "SessionStart", session_id: "session-test" },
        now,
        spawn: () => assert.fail("an installed target must not be installed again"),
        spawnRefresh: () => assert.fail("a fresh cache must not schedule a refresh"),
      });
      assert.equal(result.status, "already-installed");
      assert.equal(result.targetVersion, "0.3.41");
      assert.equal(existsSync(join(litHome, "update-notifier", "automatic")), false, "no backup or receipt for a skipped install");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("a failed target backs off for 24 hours", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-auto-backoff-"));
    const litHome = join(home, "lit");
    const claudeHome = join(home, "claude");
    const cachePath = join(litHome, "update-notifier", "latest.json");
    const receiptPath = join(litHome, "update-notifier", "automatic", "receipt.json");
    const now = Date.parse("2026-10-11T00:00:00.000Z");
    const writeCache = (latestVersion, at) => writeFileSync(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: "@litfamily/litclaude",
      latestVersion,
      checkedAt: new Date(at - 1_000).toISOString(),
      attemptedAt: new Date(at - 1_000).toISOString(),
      generation: GENERATION,
    })}\n`);
    mkdirSync(join(litHome, "update-notifier", "automatic"), { recursive: true });
    writeCache("9.9.9", now);
    writeFileSync(receiptPath, `${JSON.stringify({
      schema: 1,
      generation: GENERATION,
      status: "rolled-back",
      packageName: "@litfamily/litclaude",
      fromVersion: "0.3.40",
      targetVersion: "9.9.9",
      finishedAt: new Date(now - 60 * 60 * 1_000).toISOString(),
    })}\n`);
    const installs = [];
    const run = (at) => runAutomaticUpdate({
      surface: "session-start",
      currentVersion: "0.3.40",
      cachePath,
      litHome,
      claudeHome,
      env: { LITCLAUDE_HOME: litHome, CLAUDE_CONFIG_DIR: claudeHome },
      input: { hook_event_name: "SessionStart", session_id: "session-test" },
      now: at,
      spawn: (command, args) => {
        installs.push(args.find((arg) => arg.startsWith("@litfamily/litclaude@")));
        return { status: 1, stdout: "", stderr: "" };
      },
      spawnRefresh: () => true,
    });
    try {
      const blocked = run(now);
      assert.equal(blocked.status, "backoff");
      assert.equal(blocked.targetVersion, "9.9.9");
      assert.deepEqual(installs, [], "a target that failed within 24 hours must not be installed again");

      writeCache("9.9.10", now);
      assert.equal(run(now).status, "rolled-back");
      assert.deepEqual(installs, ["@litfamily/litclaude@9.9.10"], "a newer target is not blocked");

      const later = now + CACHE_TTL_MS + 60 * 60 * 1_000;
      writeCache("9.9.9", later);
      writeFileSync(receiptPath, `${JSON.stringify({
        ...JSON.parse(readFileSync(receiptPath, "utf8")),
        targetVersion: "9.9.9",
        finishedAt: new Date(now - 60 * 60 * 1_000).toISOString(),
      })}\n`);
      assert.equal(run(later).status, "rolled-back");
      assert.deepEqual(installs, ["@litfamily/litclaude@9.9.10", "@litfamily/litclaude@9.9.9"], "the target is tried again after 24 hours");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
