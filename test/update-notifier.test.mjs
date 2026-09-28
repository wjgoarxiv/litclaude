import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CACHE_TTL_MS,
  MAX_RESPONSE_BYTES,
  REGISTRY_URL,
  compareStableSemver,
  fetchLatestVersion,
  formatUpdateNotice,
  parseRegistryResponse,
  readUpdateCache,
  refreshUpdateCache,
  runUpdateNotifier,
  shouldRunUpdateNotifier,
  spawnDetachedRefresh,
  writeUpdateCache,
} from "../bin/update-notifier.mjs";

const makeTty = () => ({
  isTTY: true,
  output: "",
  write(chunk) {
    this.output += chunk;
  },
});
const GENERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const waitForFile = async (path, message) => {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("npm update notifier", () => {
  it("accepts only the official package's stable semver metadata", () => {
    const valid = parseRegistryResponse({
      statusCode: 200,
      headers: { "content-type": "application/json", "content-length": "48" },
      body: Buffer.from('{"name":"@litfamily/litclaude","version":"1.20.3"}'),
    });
    assert.deepEqual(valid, { packageName: "@litfamily/litclaude", latestVersion: "1.20.3" });

    for (const response of [
      { statusCode: 404, headers: { "content-type": "application/json" }, body: Buffer.from("{}") },
      { statusCode: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("{}") },
      { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"name":"other","version":"1.2.3"}') },
      { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"name":"@litfamily/litclaude","version":"1.2.3-beta.1"}') },
      { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(MAX_RESPONSE_BYTES + 1, 32) },
    ]) {
      assert.throws(() => parseRegistryResponse(response));
    }
  });

  it("compares stable semver numerically without accepting loose versions", () => {
    assert.equal(compareStableSemver("1.10.0", "1.9.9"), 1);
    assert.equal(compareStableSemver("2.0.0", "2.0.0"), 0);
    assert.equal(compareStableSemver("0.9.9", "1.0.0"), -1);
    assert.throws(() => compareStableSemver("v1.2.3", "1.2.2"));
  });

  it("writes and reads a strict product-owned cache atomically", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-cache-"));
    const cachePath = join(home, "update-notifier", "latest.json");
    const checkedAt = "2026-07-23T10:00:00.000Z";
    const attemptedAt = "2026-07-23T10:05:00.000Z";
    const now = Date.parse("2026-07-23T11:00:00.000Z");
    try {
      writeUpdateCache(cachePath, { packageName: "@litfamily/litclaude", latestVersion: "0.4.1", checkedAt, attemptedAt, generation: GENERATION }, { now });
      assert.deepEqual(readUpdateCache(cachePath, { now }), {
        schema: 3,
        packageName: "@litfamily/litclaude",
        latestVersion: "0.4.1",
        checkedAt,
        attemptedAt,
        generation: GENERATION,
      });
      assert.deepEqual(readdirSync(join(home, "update-notifier")), ["latest.json"]);

      writeFileSync(cachePath, `{"schema":3,"packageName":"other","latestVersion":"9.9.9","checkedAt":"bad","attemptedAt":"bad","generation":"${GENERATION}"}\n`);
      assert.equal(readUpdateCache(cachePath, { now }), null);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("gates on management commands, both TTYs, CI, JSON, dry-run, and opt-outs", () => {
    const base = {
      command: "install",
      rest: [],
      dryRun: false,
      env: {},
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true },
    };
    assert.equal(shouldRunUpdateNotifier(base), true);
    for (const command of ["path", "run", "uninstall", "litgoal", "workflow-check", "start-work"])
      assert.equal(shouldRunUpdateNotifier({ ...base, command }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, stdin: { isTTY: false } }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, stdout: { isTTY: false } }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, stderr: { isTTY: false } }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, env: { CI: "1" } }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, rest: ["--json"] }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, dryRun: true }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, env: { NO_UPDATE_NOTIFIER: "1" } }), false);
    assert.equal(shouldRunUpdateNotifier({ ...base, env: { LITCLAUDE_NO_UPDATE_CHECK: "1" } }), false);
  });

  it("prints a pinned stderr-only notice from a fresh valid cache", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-notice-"));
    const cachePath = join(home, "latest.json");
    const stdin = { isTTY: true };
    const stdout = makeTty();
    const stderr = makeTty();
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    try {
      writeUpdateCache(cachePath, {
        packageName: "@litfamily/litclaude",
        latestVersion: "0.3.33",
        checkedAt: new Date(now - CACHE_TTL_MS + 1).toISOString(),
        attemptedAt: new Date(now - CACHE_TTL_MS + 1).toISOString(),
        generation: GENERATION,
      }, { now });
      const result = runUpdateNotifier({
        command: "doctor",
        rest: [],
        dryRun: false,
        currentVersion: "0.3.32",
        cachePath,
        env: {},
        stdin,
        stdout,
        stderr,
        now,
        spawnRefresh: () => assert.fail("fresh cache must not refresh"),
      });
      assert.equal(result, "noticed");
      assert.equal(stdout.output, "");
      assert.equal(stderr.output, formatUpdateNotice("0.3.32", "0.3.33"));
      assert.match(stderr.output, /npm exec --yes --package @litfamily\/litclaude@0\.3\.33 -- litclaude install/u);
      assert.match(stderr.output, /restart Claude Code/u);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("notifies from stale trusted success while reserving one new attempt without erasing it", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-stale-"));
    const cachePath = join(home, "latest.json");
    const stdin = { isTTY: true };
    const stdout = makeTty();
    const stderr = makeTty();
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    let refreshes = 0;
    try {
      const checkedAt = new Date(now - CACHE_TTL_MS * 2).toISOString();
      const attemptedAt = new Date(now - CACHE_TTL_MS - 1).toISOString();
      writeUpdateCache(cachePath, {
        packageName: "@litfamily/litclaude",
        latestVersion: "9.9.9",
        checkedAt,
        attemptedAt,
        generation: GENERATION,
      }, { now });
      const result = runUpdateNotifier({
        command: "update",
        rest: [],
        dryRun: false,
        currentVersion: "0.3.32",
        cachePath,
        env: {},
        stdin,
        stdout,
        stderr,
        now,
        spawnRefresh: () => { refreshes += 1; },
      });
      assert.equal(result, "noticed-refreshing");
      assert.equal(refreshes, 1);
      assert.equal(stdout.output, "");
      assert.match(stderr.output, /@litfamily\/litclaude@9\.9\.9 -- litclaude install/u);
      assert.deepEqual(readUpdateCache(cachePath, { now }), {
        schema: 3,
        packageName: "@litfamily/litclaude",
        latestVersion: "9.9.9",
        checkedAt,
        attemptedAt: new Date(now).toISOString(),
        generation: readUpdateCache(cachePath, { now })?.generation,
      });

      runUpdateNotifier({
        command: "update",
        rest: [],
        dryRun: false,
        currentVersion: "0.3.32",
        cachePath,
        env: {},
        stdin,
        stdout,
        stderr,
        now: now + 60 * 60 * 1_000,
        spawnRefresh: () => { refreshes += 1; },
      });
      assert.equal(refreshes, 1, "an interrupted or offline attempt must remain throttled for 24 hours");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("launches the refresh child detached with ignored stdio and unreferences it", () => {
    let invocation;
    let unreferenced = false;
    const parentEnv = {
      PATH: "/safe/bin",
      HOME: "/safe/home",
      TMPDIR: "/safe/tmp",
      NODE_EXTRA_CA_CERTS: "/safe/ca.pem",
      HTTP_PROXY: "http://proxy-user:proxy-pass@proxy.example",
      HTTPS_PROXY: "https://proxy.example",
      NO_PROXY: "localhost",
      LANG: "C.UTF-8",
      NPM_TOKEN: "npm-secret",
      NODE_AUTH_TOKEN: "node-secret",
      npm_config_userconfig: "/secret/npmrc",
      NPM_CONFIG_USERCONFIG: "/secret/upper-npmrc",
      npm_config__authToken: "config-secret",
    };
    assert.equal(spawnDetachedRefresh(
      "/tmp/litclaude-latest.json",
      GENERATION,
      () => false,
      () => assert.fail("lost transition ownership must fence the process spawn"),
    ), false);
    spawnDetachedRefresh("/tmp/litclaude-latest.json", GENERATION, () => true, (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      child.unref = () => {
        unreferenced = true;
        child.emit("error", new Error("simulated async spawn failure"));
      };
      return child;
    }, parentEnv);
    assert.equal(invocation.command, process.execPath);
    assert.match(invocation.args[0], /update-notifier-refresh\.mjs$/u);
    assert.equal(invocation.args[1], "/tmp/litclaude-latest.json");
    assert.equal(invocation.args[2], GENERATION);
    assert.deepEqual(invocation.options, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        PATH: "/safe/bin",
        HOME: "/safe/home",
        TMPDIR: "/safe/tmp",
        NODE_EXTRA_CA_CERTS: "/safe/ca.pem",
        HTTPS_PROXY: "https://proxy.example",
        NO_PROXY: "localhost",
        LANG: "C.UTF-8",
      },
    });
    assert.equal(unreferenced, true);
  });

  it("preserves the last successful result when the reserved refresh is offline", async () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-offline-"));
    const cachePath = join(home, "latest.json");
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    const state = {
      packageName: "@litfamily/litclaude",
      latestVersion: "0.3.33",
      checkedAt: "2026-07-22T10:00:00.000Z",
      attemptedAt: new Date(now).toISOString(),
      generation: GENERATION,
    };
    try {
      writeUpdateCache(cachePath, state, { now });
      await assert.rejects(refreshUpdateCache(cachePath, {
        fetch: async () => { throw new Error("offline"); },
        now: () => now + 1_000,
      }), /offline/u);
      assert.deepEqual(readUpdateCache(cachePath, { now: now + 1_000 }), { schema: 3, ...state });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("records and throttles a synchronous spawn failure without crashing the parent", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-spawn-error-"));
    const cachePath = join(home, "latest.json");
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    const tty = makeTty();
    let attempts = 0;
    try {
      assert.doesNotThrow(() => runUpdateNotifier({
        command: "doctor", rest: [], dryRun: false, currentVersion: "0.3.32",
        cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty, now,
        spawnRefresh: () => { attempts += 1; throw new Error("spawn failed"); },
      }));
      assert.equal(attempts, 1);
      assert.equal(readUpdateCache(cachePath, { now })?.attemptedAt, new Date(now).toISOString());
      runUpdateNotifier({
        command: "doctor", rest: [], dryRun: false, currentVersion: "0.3.32",
        cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty, now: now + 1_000,
        spawnRefresh: () => { attempts += 1; },
      });
      assert.equal(attempts, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects noncanonical or future timestamps without trusting notice or throttle state", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-future-"));
    const cachePath = join(home, "latest.json");
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    const stdin = { isTTY: true };
    const stdout = makeTty();
    const stderr = makeTty();
    let refreshes = 0;
    try {
      for (const attemptedAt of ["2026-07-23T12:00:01.000Z", "2026-07-23T11:00:00Z"]) {
        writeFileSync(cachePath, `${JSON.stringify({
          schema: 3,
          packageName: "@litfamily/litclaude",
          latestVersion: "9.9.9",
          checkedAt: "2026-07-23T10:00:00.000Z",
          attemptedAt,
          generation: GENERATION,
        })}\n`);
        stderr.output = "";
        runUpdateNotifier({
          command: "doctor",
          rest: [],
          dryRun: false,
          currentVersion: "0.3.32",
          cachePath,
          env: {},
          stdin,
          stdout,
          stderr,
          now,
          spawnRefresh: () => { refreshes += 1; },
        });
        assert.equal(stderr.output, "", "invalid timestamps must not emit a trusted notice");
        assert.equal(readUpdateCache(cachePath, { now })?.attemptedAt, new Date(now).toISOString());
      }
      assert.equal(refreshes, 2, "invalid timestamps must not suppress a replacement attempt");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("coalesces concurrent parent scheduling through the product reservation lock", async () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-concurrent-"));
    const cachePath = join(home, "latest.json");
    const spawnLog = join(home, "spawn.log");
    const now = Date.now();
    const moduleUrl = new URL("../bin/update-notifier.mjs", import.meta.url).href;
    try {
      writeUpdateCache(cachePath, {
        packageName: "@litfamily/litclaude",
        latestVersion: "0.3.33",
        checkedAt: new Date(now - CACHE_TTL_MS * 2).toISOString(),
        attemptedAt: new Date(now - CACHE_TTL_MS - 1).toISOString(),
        generation: GENERATION,
      }, { now });
      const source = `
        import { appendFileSync } from "node:fs";
        import { runUpdateNotifier } from ${JSON.stringify(moduleUrl)};
        const tty = { isTTY: true, write() {} };
        runUpdateNotifier({ command: "doctor", rest: [], dryRun: false,
          currentVersion: "0.3.32", cachePath: process.argv[1], env: {},
          stdin: tty, stdout: tty, stderr: tty, now: Number(process.argv[3]),
          spawnRefresh: () => appendFileSync(process.argv[2], "spawn\\n") });
      `;
      const workers = Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", source, cachePath, spawnLog, String(now)], {
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
      }));
      await Promise.all(workers);
      const lines = readdirSync(home).includes("spawn.log")
        ? (await import("node:fs/promises")).readFile(spawnLog, "utf8")
        : Promise.resolve("");
      assert.equal((await lines).trim().split(/\n/u).filter(Boolean).length, 1);
      assert.equal(readUpdateCache(cachePath, { now })?.attemptedAt, new Date(now).toISOString());
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("coalesces on a fresh reservation and safely replaces a stale reservation", () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-lock-"));
    const cachePath = join(home, "latest.json");
    const lockPath = `${cachePath}.reservation.lock`;
    let now;
    const tty = makeTty();
    let refreshes = 0;
    try {
      mkdirSync(lockPath, { recursive: true });
      now = Date.now();
      runUpdateNotifier({ command: "install", rest: [], dryRun: false, currentVersion: "0.3.32",
        cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty, now,
        spawnRefresh: () => { refreshes += 1; } });
      assert.equal(refreshes, 0);

      const stale = new Date(now - 60_000);
      writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify({
        schema: 2,
        generation: GENERATION,
        pid: 99_999_999,
        acquiredAt: stale.toISOString(),
      })}\n`);
      utimesSync(lockPath, stale, stale);
      runUpdateNotifier({ command: "install", rest: [], dryRun: false, currentVersion: "0.3.32",
        cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty, now,
        spawnRefresh: () => { refreshes += 1; } });
      assert.equal(refreshes, 1);
      assert.equal(readUpdateCache(cachePath, { now })?.attemptedAt, new Date(now).toISOString());
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("age-gates recovery of missing and malformed reservation owners", () => {
    const now = Date.now();
    const tty = makeTty();
    const cases = [
      { label: "fresh missing owner", owner: null, ageMs: 1_000, expectedRefreshes: 0 },
      { label: "stale missing owner", owner: null, ageMs: 60_000, expectedRefreshes: 1 },
      { label: "fresh malformed owner", owner: "{not-json}\n", ageMs: 1_000, expectedRefreshes: 0 },
      { label: "stale malformed owner", owner: "{not-json}\n", ageMs: 60_000, expectedRefreshes: 1 },
    ];

    for (const testCase of cases) {
      const home = mkdtempSync(join(tmpdir(), "litclaude-update-ownerless-lock-"));
      const cachePath = join(home, "latest.json");
      const lockPath = `${cachePath}.reservation.lock`;
      let refreshes = 0;
      try {
        mkdirSync(lockPath, { recursive: true });
        if (testCase.owner !== null) writeFileSync(join(lockPath, "owner.json"), testCase.owner);
        const timestamp = new Date(now - testCase.ageMs);
        utimesSync(lockPath, timestamp, timestamp);

        runUpdateNotifier({
          command: "doctor",
          rest: [],
          dryRun: false,
          currentVersion: "0.3.32",
          cachePath,
          env: {},
          stdin: tty,
          stdout: tty,
          stderr: tty,
          now,
          spawnRefresh: () => { refreshes += 1; },
        });

        assert.equal(refreshes, testCase.expectedRefreshes, testCase.label);
        assert.equal(
          existsSync(lockPath),
          testCase.expectedRefreshes === 0,
          `${testCase.label} lock lifetime`,
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  });

  it("does not let a stale observer remove a newly created reservation generation", async () => {
    const notifier = await import("../bin/update-notifier.mjs");
    assert.equal(typeof notifier.inspectUpdateReservation, "function");
    assert.equal(typeof notifier.recoverObservedReservation, "function");

    const home = mkdtempSync(join(tmpdir(), "litclaude-update-takeover-race-"));
    const cachePath = join(home, "latest.json");
    const reservationPath = `${cachePath}.reservation.lock`;
    const markerPath = join(home, "observed.json");
    const continuePath = join(home, "continue");
    const resultPath = join(home, "result.json");
    const oldGeneration = "11111111-1111-4111-8111-111111111111";
    const newGeneration = "22222222-2222-4222-8222-222222222222";
    const now = Date.now();
    const moduleUrl = new URL("../bin/update-notifier.mjs", import.meta.url).href;
    try {
      mkdirSync(reservationPath, { recursive: true });
      writeFileSync(join(reservationPath, "owner.json"), `${JSON.stringify({
        schema: 2,
        generation: oldGeneration,
        pid: 99_999_999,
        acquiredAt: new Date(now - 60_000).toISOString(),
      })}\n`);
      const stale = new Date(now - 60_000);
      utimesSync(reservationPath, stale, stale);

      const source = `
        import { existsSync, writeFileSync } from "node:fs";
        import { inspectUpdateReservation, recoverObservedReservation } from ${JSON.stringify(moduleUrl)};
        const [cachePath, markerPath, continuePath, resultPath, now] = process.argv.slice(1);
        const observed = inspectUpdateReservation(cachePath, Number(now));
        writeFileSync(markerPath, JSON.stringify(observed));
        while (!existsSync(continuePath)) await new Promise((resolve) => setTimeout(resolve, 5));
        const recovered = recoverObservedReservation(cachePath, observed, Number(now));
        writeFileSync(resultPath, JSON.stringify({ recovered }));
      `;
      const observer = spawn(process.execPath, [
        "--input-type=module", "-e", source, cachePath, markerPath, continuePath, resultPath, String(now),
      ], { stdio: "ignore" });
      const observerExit = new Promise((resolve, reject) => {
        observer.once("error", reject);
        observer.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`observer exited ${code}`)));
      });
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 5_000;
        const poll = () => {
          if (readdirSync(home).includes("observed.json")) return resolve();
          if (Date.now() >= deadline) return reject(new Error("observer did not inspect stale reservation"));
          setTimeout(poll, 5);
        };
        poll();
      });

      rmSync(reservationPath, { recursive: true, force: true });
      mkdirSync(reservationPath);
      writeFileSync(join(reservationPath, "owner.json"), `${JSON.stringify({
        schema: 2,
        generation: newGeneration,
        pid: process.pid,
        acquiredAt: new Date(now).toISOString(),
      })}\n`);
      writeFileSync(continuePath, "continue\n");
      await observerExit;

      assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), { recovered: false });
      assert.equal(JSON.parse(readFileSync(join(reservationPath, "owner.json"), "utf8")).generation, newGeneration);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fences a paused transition owner after takeover and successor completion", async () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-transition-fence-"));
    const cachePath = join(home, "latest.json");
    const pausedPath = join(home, "old-owner-paused");
    const continuePath = join(home, "continue-old-owner");
    const spawnLog = join(home, "spawn.log");
    const oldResultPath = join(home, "old-result.txt");
    const transitionPath = `${cachePath}.transition.lock`;
    const reservationPath = `${cachePath}.reservation.lock`;
    const startedAt = Date.now();
    const takeoverAt = startedAt + CACHE_TTL_MS + 1;
    const moduleUrl = new URL("../bin/update-notifier.mjs", import.meta.url).href;
    let oldOwnerExit;
    const source = `
      import { appendFileSync, existsSync, writeFileSync } from "node:fs";
      import { runUpdateNotifier } from ${JSON.stringify(moduleUrl)};
      const [cachePath, pausedPath, continuePath, spawnLog, resultPath, now] = process.argv.slice(1);
      const tty = { isTTY: true, write() {} };
      const result = runUpdateNotifier({ command: "doctor", rest: [], dryRun: false,
        currentVersion: "0.3.32", cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty,
        now: Number(now), spawnRefresh: (_path, _generation, continuesToOwnTransition) => {
          writeFileSync(pausedPath, "paused\\n");
          while (!existsSync(continuePath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          if (typeof continuesToOwnTransition !== "function" || continuesToOwnTransition()) {
            appendFileSync(spawnLog, "old\\n");
            return true;
          }
          return false;
        } });
      writeFileSync(resultPath, result);
    `;

    try {
      const oldOwner = spawn(process.execPath, [
        "--input-type=module", "-e", source, cachePath, pausedPath, continuePath,
        spawnLog, oldResultPath, String(startedAt),
      ], { stdio: "ignore" });
      oldOwnerExit = new Promise((resolve, reject) => {
        oldOwner.once("error", reject);
        oldOwner.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`old owner exited ${code}`)));
      });
      await waitForFile(pausedPath, "old transition owner did not pause before spawn");

      for (const lockPath of [transitionPath, reservationPath]) {
        const ownerFile = join(lockPath, "owner.json");
        const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
        writeFileSync(ownerFile, `${JSON.stringify({ ...owner, pid: 99_999_999 })}\n`);
      }

      const tty = makeTty();
      const successorStatus = runUpdateNotifier({
        command: "doctor", rest: [], dryRun: false, currentVersion: "0.3.32",
        cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty, now: takeoverAt,
        spawnRefresh: () => writeFileSync(spawnLog, "successor\n"),
      });
      assert.equal(successorStatus, "refreshing");
      const successorGeneration = readUpdateCache(cachePath, { now: takeoverAt })?.generation;
      assert.match(successorGeneration ?? "", /^[0-9a-f-]{36}$/u);
      assert.equal(await refreshUpdateCache(cachePath, {
        generation: successorGeneration,
        fetch: async () => ({ packageName: "@litfamily/litclaude", latestVersion: "0.4.1" }),
        now: () => takeoverAt + 1_000,
      }), true);

      writeFileSync(continuePath, "continue\n");
      await oldOwnerExit;

      assert.deepEqual(readFileSync(spawnLog, "utf8").trim().split(/\n/u), ["successor"]);
      assert.equal(readFileSync(oldResultPath, "utf8"), "coalesced");
      assert.deepEqual(readUpdateCache(cachePath, { now: takeoverAt + 1_000 }), {
        schema: 3,
        packageName: "@litfamily/litclaude",
        latestVersion: "0.4.1",
        checkedAt: new Date(takeoverAt + 1_000).toISOString(),
        attemptedAt: new Date(takeoverAt).toISOString(),
        generation: successorGeneration,
      });
    } finally {
      writeFileSync(continuePath, "continue\n");
      if (oldOwnerExit) await oldOwnerExit.catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not stale-recover a transition whose process owner is still live", async () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-live-transition-"));
    const cachePath = join(home, "latest.json");
    const pausedPath = join(home, "owner-paused");
    const continuePath = join(home, "continue-owner");
    const spawnLog = join(home, "spawn.log");
    const startedAt = Date.now();
    const takeoverAt = startedAt + CACHE_TTL_MS + 1;
    const moduleUrl = new URL("../bin/update-notifier.mjs", import.meta.url).href;
    let ownerExit;
    const source = `
      import { appendFileSync, existsSync, writeFileSync } from "node:fs";
      import { runUpdateNotifier } from ${JSON.stringify(moduleUrl)};
      const [cachePath, pausedPath, continuePath, spawnLog, now] = process.argv.slice(1);
      const tty = { isTTY: true, write() {} };
      runUpdateNotifier({ command: "doctor", rest: [], dryRun: false,
        currentVersion: "0.3.32", cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty,
        now: Number(now), spawnRefresh: () => {
          writeFileSync(pausedPath, "paused\\n");
          while (!existsSync(continuePath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          appendFileSync(spawnLog, "owner\\n");
        } });
    `;

    try {
      const owner = spawn(process.execPath, [
        "--input-type=module", "-e", source, cachePath, pausedPath, continuePath, spawnLog, String(startedAt),
      ], { stdio: "ignore" });
      ownerExit = new Promise((resolve, reject) => {
        owner.once("error", reject);
        owner.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`owner exited ${code}`)));
      });
      await waitForFile(pausedPath, "live transition owner did not pause before spawn");

      const tty = makeTty();
      let successorSpawns = 0;
      const status = runUpdateNotifier({
        command: "doctor", rest: [], dryRun: false, currentVersion: "0.3.32",
        cachePath, env: {}, stdin: tty, stdout: tty, stderr: tty, now: takeoverAt,
        spawnRefresh: () => { successorSpawns += 1; },
      });
      writeFileSync(continuePath, "continue\n");
      await ownerExit;

      assert.equal(status, "coalesced");
      assert.equal(successorSpawns, 0);
      assert.deepEqual(readFileSync(spawnLog, "utf8").trim().split(/\n/u), ["owner"]);
    } finally {
      writeFileSync(continuePath, "continue\n");
      if (ownerExit) await ownerExit.catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("fences a late old refresh from overwriting a newer cache generation", async () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-late-worker-"));
    const cachePath = join(home, "latest.json");
    const oldGeneration = "11111111-1111-4111-8111-111111111111";
    const newGeneration = "22222222-2222-4222-8222-222222222222";
    const now = Date.parse("2026-07-23T12:00:00.000Z");
    try {
      writeFileSync(cachePath, `${JSON.stringify({
        schema: 3,
        packageName: "@litfamily/litclaude",
        latestVersion: "0.4.1",
        checkedAt: "2026-07-23T11:00:00.000Z",
        attemptedAt: "2026-07-23T11:30:00.000Z",
        generation: newGeneration,
      })}\n`);
      await refreshUpdateCache(cachePath, {
        generation: oldGeneration,
        fetch: async () => ({ packageName: "@litfamily/litclaude", latestVersion: "0.3.33" }),
        now: () => now,
      });
      const state = JSON.parse(readFileSync(cachePath, "utf8"));
      assert.equal(state.generation, newGeneration);
      assert.equal(state.latestVersion, "0.4.1");
      assert.equal(state.checkedAt, "2026-07-23T11:00:00.000Z");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("allows the current generation to complete without changing its attempt identity", async () => {
    const home = mkdtempSync(join(tmpdir(), "litclaude-update-current-worker-"));
    const cachePath = join(home, "latest.json");
    const startedAt = Date.parse("2026-07-23T11:30:00.000Z");
    const completedAt = Date.parse("2026-07-23T12:00:00.000Z");
    try {
      writeUpdateCache(cachePath, {
        packageName: "@litfamily/litclaude",
        latestVersion: "0.3.33",
        checkedAt: "2026-07-23T11:00:00.000Z",
        attemptedAt: new Date(startedAt).toISOString(),
        generation: GENERATION,
      }, { now: startedAt });
      const completed = await refreshUpdateCache(cachePath, {
        generation: GENERATION,
        fetch: async () => ({ packageName: "@litfamily/litclaude", latestVersion: "0.4.1" }),
        now: () => completedAt,
      });
      assert.equal(completed, true);
      assert.deepEqual(readUpdateCache(cachePath, { now: completedAt }), {
        schema: 3,
        packageName: "@litfamily/litclaude",
        latestVersion: "0.4.1",
        checkedAt: new Date(completedAt).toISOString(),
        attemptedAt: new Date(startedAt).toISOString(),
        generation: GENERATION,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses only the bounded official registry GET and converts network failures to rejection", async () => {
    let requestUrl;
    let requestOptions;
    let timeoutMs;
    const request = (url, options) => {
      requestUrl = url;
      requestOptions = options;
      const req = new EventEmitter();
      req.setTimeout = (ms, callback) => {
        timeoutMs = ms;
        queueMicrotask(callback);
      };
      req.destroy = (error) => queueMicrotask(() => req.emit("error", error));
      return req;
    };

    await assert.rejects(fetchLatestVersion({ request }));
    assert.equal(requestUrl, REGISTRY_URL);
    assert.equal(requestOptions.method, "GET");
    assert.equal(timeoutMs, 3_000);
    assert.equal(Object.keys(requestOptions.headers).some((name) => /auth|token|cookie/iu.test(name)), false);
  });
});
