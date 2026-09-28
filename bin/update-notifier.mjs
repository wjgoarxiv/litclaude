import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_RESPONSE_BYTES = 64 * 1_024;
const PACKAGE_NAME = "@litfamily/litclaude";
export const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;
const REQUEST_TIMEOUT_MS = 3_000;
const RESERVATION_STALE_MS = 30_000;
const RESERVATION_CLOCK_SKEW_MS = 5_000;
const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const generationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const parseStableSemver = (value) => {
  const match = typeof value === "string" ? value.match(stableSemverPattern) : null;
  if (!match) throw new Error("version is not strict stable semver");
  return match.slice(1).map((part) => BigInt(part));
};

export const compareStableSemver = (left, right) => {
  const leftParts = parseStableSemver(left);
  const rightParts = parseStableSemver(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
};

const contentTypeIsJson = (value) =>
  typeof value === "string" && /^application\/json(?:\s*;\s*charset=(?:utf-8|utf8))?$/iu.test(value.trim());

export const parseRegistryResponse = ({ statusCode, headers = {}, body }) => {
  if (statusCode !== 200) throw new Error("registry response status is not 200");
  if (!contentTypeIsJson(headers["content-type"])) throw new Error("registry response is not application/json");

  const contentLength = headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^(0|[1-9]\d*)$/u.test(String(contentLength))) throw new Error("registry content-length is invalid");
    if (BigInt(contentLength) > BigInt(MAX_RESPONSE_BYTES)) throw new Error("registry response is too large");
  }

  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  if (bytes.length > MAX_RESPONSE_BYTES) throw new Error("registry response is too large");

  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("registry response JSON is invalid");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("registry response is not an object");
  if (parsed.name !== PACKAGE_NAME) throw new Error("registry package name does not match");
  parseStableSemver(parsed.version);
  return { packageName: PACKAGE_NAME, latestVersion: parsed.version };
};

const canonicalTimestamp = (value, now) => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && new Date(timestamp).toISOString() === value;
};

const validCacheRecord = (value, now) => {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  if (value.schema !== 3 || value.packageName !== PACKAGE_NAME) return false;
  if (Object.keys(value).sort().join(",") !== "attemptedAt,checkedAt,generation,latestVersion,packageName,schema") return false;
  if (typeof value.generation !== "string" || !generationPattern.test(value.generation)) return false;
  if (!canonicalTimestamp(value.attemptedAt, now)) return false;
  if (value.latestVersion === null || value.checkedAt === null) {
    return value.latestVersion === null && value.checkedAt === null;
  }
  try {
    parseStableSemver(value.latestVersion);
  } catch {
    return false;
  }
  return canonicalTimestamp(value.checkedAt, now);
};

export const readUpdateCache = (cachePath, { now = Date.now() } = {}) => {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return validCacheRecord(parsed, now) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeUpdateCache = (
  cachePath,
  { packageName, latestVersion, checkedAt, attemptedAt, generation },
  { now = Date.now() } = {},
) => {
  const record = { schema: 3, packageName, latestVersion, checkedAt, attemptedAt, generation };
  if (!validCacheRecord(record, now)) throw new Error("refusing to write invalid update cache");
  const directory = dirname(cachePath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, cachePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

export const fetchLatestVersion = ({ request = httpsGet } = {}) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    const settle = (operation, value) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      operation(value);
    };
    const req = request(
      REGISTRY_URL,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "litclaude-ai-update-notifier",
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("registry response is too large"));
            settle(reject, new Error("registry response is too large"));
            return;
          }
          chunks.push(bytes);
        });
        response.once("error", (error) => settle(reject, error));
        response.once("end", () => {
          try {
            settle(resolve, parseRegistryResponse({
              statusCode: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }));
          } catch (error) {
            settle(reject, error);
          }
        });
      },
    );
    req.once("error", (error) => settle(reject, error));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("registry request timed out")));
    deadline = setTimeout(() => req.destroy(new Error("registry request deadline exceeded")), REQUEST_TIMEOUT_MS);
    deadline.unref();
  });

export const refreshUpdateCache = async (
  cachePath,
  { fetch = fetchLatestVersion, now = () => Date.now(), generation } = {},
) => {
  const result = await fetch();
  let transition;
  for (let attempt = 0; attempt < 50 && !transition; attempt += 1) {
    const transitionAt = now();
    transition = acquireTransition(cachePath, transitionAt);
    if (!transition) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!transition) return false;
  try {
    const completedAt = now();
    const previous = readUpdateCache(cachePath, { now: completedAt });
    const expectedGeneration = generation ?? previous?.generation;
    if (!previous || previous.generation !== expectedGeneration) return false;
    if (!continuesToOwnLock(transition)) return false;
    writeUpdateCache(
      cachePath,
      {
        ...result,
        checkedAt: new Date(completedAt).toISOString(),
        attemptedAt: previous.attemptedAt,
        generation: previous.generation,
      },
      { now: completedAt },
    );
    return true;
  } finally {
    releaseOwnedLock(transition);
  }
};

const hasOptOut = (env, name) => Object.hasOwn(env, name);

export const shouldRunUpdateNotifier = ({ command, rest, dryRun, env, stdin, stdout, stderr }) => {
  if (!new Set(["install", "update", "doctor"]).has(command)) return false;
  if (dryRun || rest.some((arg) => arg === "--json" || arg.startsWith("--json="))) return false;
  if (!stdin.isTTY || !stdout.isTTY || !stderr.isTTY) return false;
  if (hasOptOut(env, "CI") || hasOptOut(env, "NO_UPDATE_NOTIFIER") || hasOptOut(env, "LITCLAUDE_NO_UPDATE_CHECK")) return false;
  return true;
};

export const formatUpdateNotice = (currentVersion, latestVersion) =>
  `\nLitClaude update available: ${currentVersion} → ${latestVersion}\n` +
  `Run: npm exec --yes --package ${PACKAGE_NAME}@${latestVersion} -- litclaude install\n` +
  "Then restart Claude Code.\n\n";

const detachedRefreshEnvKeys = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
];

const proxyUrlEnvKeys = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
]);

const detachedRefreshEnvValueIsSafe = (name, value) => {
  if (!proxyUrlEnvKeys.has(name)) return true;
  try {
    const proxy = new URL(value.includes("://") ? value : `http://${value}`);
    return proxy.username === "" && proxy.password === "";
  } catch {
    return false;
  }
};

const detachedRefreshEnv = (env) => Object.fromEntries(
  detachedRefreshEnvKeys
    .filter((name) => typeof env[name] === "string" && detachedRefreshEnvValueIsSafe(name, env[name]))
    .map((name) => [name, env[name]]),
);

export const spawnDetachedRefresh = (
  cachePath,
  generation,
  continuesToOwnTransition = () => true,
  spawnProcess = spawn,
  env = process.env,
) => {
  if (!continuesToOwnTransition()) return false;
  const child = spawnProcess(
    process.execPath,
    [fileURLToPath(new URL("./update-notifier-refresh.mjs", import.meta.url)), cachePath, generation],
    { detached: true, stdio: "ignore", windowsHide: true, env: detachedRefreshEnv(env) },
  );
  child.once("error", () => {});
  child.unref();
  return true;
};

const reservationLockPath = (cachePath) => `${cachePath}.reservation.lock`;
const transitionLockPath = (cachePath) => `${cachePath}.transition.lock`;
const recoveryLockPath = (cachePath) => `${cachePath}.transition-recovery.lock`;
const ownerPath = (lockPath) => join(lockPath, "owner.json");

const readLockOwner = (lockPath) => {
  try {
    const owner = JSON.parse(readFileSync(ownerPath(lockPath), "utf8"));
    if (!owner || Object.keys(owner).sort().join(",") !== "acquiredAt,generation,pid,schema") return null;
    if (owner.schema !== 2 || !generationPattern.test(owner.generation)) return null;
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return null;
    const acquiredAt = Date.parse(owner.acquiredAt);
    if (!Number.isFinite(acquiredAt) || new Date(acquiredAt).toISOString() !== owner.acquiredAt) return null;
    return owner;
  } catch {
    return null;
  }
};

const processIsLive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
};

const createOwnedLock = (lockPath, now, generation = randomUUID()) => {
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
  const lease = { path: lockPath, generation };
  try {
    writeFileSync(ownerPath(lockPath), `${JSON.stringify({
      schema: 2,
      generation,
      pid: process.pid,
      acquiredAt: new Date(now).toISOString(),
    })}\n`, { encoding: "utf8", mode: 0o600 });
    return lease;
  } catch (error) {
    releaseOwnedLock(lease);
    throw error;
  }
};

const inspectOwnedLock = (lockPath, now) => {
  try {
    const stats = statSync(lockPath);
    const owner = readLockOwner(lockPath);
    const age = now - stats.mtimeMs;
    const ownerLive = owner ? processIsLive(owner.pid) : null;
    const stale = owner
      ? ownerLive === false && (age < -RESERVATION_CLOCK_SKEW_MS || age >= RESERVATION_STALE_MS)
      : age >= RESERVATION_STALE_MS;
    return {
      exists: true,
      generation: owner?.generation ?? null,
      inode: String(stats.ino),
      mtimeMs: stats.mtimeMs,
      stale,
    };
  } catch {
    return { exists: false, generation: null, inode: null, mtimeMs: null, stale: false };
  }
};

const sameLockGeneration = (left, right) =>
  left?.exists === true && right?.exists === true &&
  left.generation === right.generation && left.inode === right.inode && left.mtimeMs === right.mtimeMs;

const continuesToOwnLock = (lease) => {
  if (!lease) return false;
  const owner = readLockOwner(lease.path);
  return owner?.generation === lease.generation && owner.pid === process.pid;
};

const recoverObservedLock = (lockPath, observed, now) => {
  if (!observed?.stale) return false;
  const current = inspectOwnedLock(lockPath, now);
  if (!current.stale || !sameLockGeneration(observed, current)) return false;
  rmSync(lockPath, { recursive: true, force: true });
  return true;
};

const releaseOwnedLock = (lease) => {
  if (!lease) return false;
  if (!continuesToOwnLock(lease)) return false;
  rmSync(lease.path, { recursive: true, force: true });
  return true;
};

export const inspectUpdateReservation = (cachePath, now = Date.now()) =>
  inspectOwnedLock(reservationLockPath(cachePath), now);

export const recoverObservedReservation = (cachePath, observed, now = Date.now()) =>
  recoverObservedLock(reservationLockPath(cachePath), observed, now);

const acquireRecovery = (cachePath, now) => {
  const path = recoveryLockPath(cachePath);
  let lease = createOwnedLock(path, now);
  if (lease) return lease;
  const observed = inspectOwnedLock(path, now);
  if (!recoverObservedLock(path, observed, now)) return null;
  lease = createOwnedLock(path, now);
  return lease;
};

const acquireTransition = (cachePath, now) => {
  const path = transitionLockPath(cachePath);
  const observedRecovery = inspectOwnedLock(recoveryLockPath(cachePath), now);
  if (observedRecovery.exists) {
    if (!observedRecovery.stale) return null;
    if (!recoverObservedLock(recoveryLockPath(cachePath), observedRecovery, now)) return null;
  }
  let lease = createOwnedLock(path, now);
  if (lease) return lease;

  const observed = inspectOwnedLock(path, now);
  if (!observed.stale) return null;
  const recovery = acquireRecovery(cachePath, now);
  if (!recovery) return null;
  try {
    if (!recoverObservedLock(path, observed, now)) return null;
    lease = createOwnedLock(path, now);
    return lease;
  } finally {
    releaseOwnedLock(recovery);
  }
};

const scheduleRefresh = ({ cachePath, now, spawnRefresh }) => {
  const transition = acquireTransition(cachePath, now);
  if (!transition) return "coalesced";
  try {
    const current = readUpdateCache(cachePath, { now });
    if (current) {
      const attemptAge = now - Date.parse(current.attemptedAt);
      if (attemptAge >= 0 && attemptAge < CACHE_TTL_MS) return "throttled";
    }

    const observedReservation = inspectUpdateReservation(cachePath, now);
    if (observedReservation.exists) {
      if (!observedReservation.stale) return "coalesced";
      if (!recoverObservedReservation(cachePath, observedReservation, now)) return "coalesced";
    }

    const generation = randomUUID();
    const reservation = createOwnedLock(reservationLockPath(cachePath), now, generation);
    if (!reservation) return "coalesced";
    try {
      if (!continuesToOwnLock(transition)) return "coalesced";
      writeUpdateCache(
        cachePath,
        {
          packageName: PACKAGE_NAME,
          latestVersion: current?.latestVersion ?? null,
          checkedAt: current?.checkedAt ?? null,
          attemptedAt: new Date(now).toISOString(),
          generation,
        },
        { now },
      );
      if (!continuesToOwnLock(transition)) return "coalesced";
      const spawned = spawnRefresh(cachePath, generation, () => continuesToOwnLock(transition));
      if (spawned === false) return "coalesced";
      return "scheduled";
    } catch {
      return "spawn-error";
    } finally {
      releaseOwnedLock(reservation);
    }
  } finally {
    releaseOwnedLock(transition);
  }
};

export const runUpdateNotifier = ({
  command,
  rest,
  dryRun,
  currentVersion,
  cachePath,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  now = Date.now(),
  spawnRefresh = spawnDetachedRefresh,
}) => {
  try {
    if (!shouldRunUpdateNotifier({ command, rest, dryRun, env, stdin, stdout, stderr })) return "gated";
    const cached = readUpdateCache(cachePath, { now });
    const noticeAvailable = cached?.latestVersion
      ? compareStableSemver(cached.latestVersion, currentVersion) > 0
      : false;
    const attemptAge = cached ? now - Date.parse(cached.attemptedAt) : Number.POSITIVE_INFINITY;
    const refreshDue = !cached || attemptAge < 0 || attemptAge >= CACHE_TTL_MS;
    const refreshStatus = refreshDue
      ? scheduleRefresh({ cachePath, now, spawnRefresh })
      : "throttled";

    if (noticeAvailable) {
      stderr.write(formatUpdateNotice(currentVersion, cached.latestVersion));
    }
    if (noticeAvailable && refreshStatus === "scheduled") return "noticed-refreshing";
    if (noticeAvailable) return "noticed";
    if (refreshStatus === "scheduled") return "refreshing";
    if (refreshStatus === "spawn-error") return "silent-error";
    return refreshStatus === "coalesced" ? "coalesced" : "current";
  } catch {
    return "silent-error";
  }
};
