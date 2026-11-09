import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { npmInvocation } from "./npm-invocation.mjs";

export const PACKAGE_NAME = "@litfamily/litclaude";
const MARKETPLACE_NAME = "litclaude-ai";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const AUTO_UPDATE_INSTALL_TIMEOUT_MS = 30_000;
export const AUTO_UPDATE_DOCTOR_TIMEOUT_MS = 15_000;
export const AUTO_UPDATE_TIMEOUT_MS = AUTO_UPDATE_INSTALL_TIMEOUT_MS + AUTO_UPDATE_DOCTOR_TIMEOUT_MS;
export const AUTO_UPDATE_LOCK_STALE_MS = 60_000;
export const AUTO_UPDATE_MAX_OUTPUT_BYTES = 128 * 1_024;
export const AUTO_UPDATE_SCHEMA = 1;
// The download ahead of the install runs in the detached refresh child, which nothing waits on.
export const AUTO_UPDATE_PREFETCH_TIMEOUT_MS = 10 * 60 * 1_000;
const REGISTRY_REQUEST_TIMEOUT_MS = 3_000;
const REGISTRY_MAX_RESPONSE_BYTES = 64 * 1_024;
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const generationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sensitiveEnvironmentName = /(?:token|auth|password|secret|cookie|credential|private.?key|node_options|userconfig)/iu;

const parseStableSemver = (value) => {
  const match = typeof value === "string" ? value.match(stableSemverPattern) : null;
  if (!match) throw new Error("version is not strict stable semver");
  return match.slice(1).map((part) => BigInt(part));
};

const compareStableSemver = (left, right) => {
  const leftParts = parseStableSemver(left);
  const rightParts = parseStableSemver(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
};

const canonicalTimestamp = (value, now) => {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now && new Date(parsed).toISOString() === value;
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

const readCacheCandidate = (cachePath, currentVersion, now) => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    return { status: "no-candidate" };
  }
  if (!validCacheRecord(parsed, now)) return { status: "no-candidate" };
  if (parsed.latestVersion === null || parsed.checkedAt === null) return { status: "no-candidate" };
  const checkedAt = Date.parse(parsed.checkedAt);
  if (now - checkedAt > CACHE_TTL_MS) return { status: "stale-cache", checkedAt: parsed.checkedAt };
  try {
    if (compareStableSemver(parsed.latestVersion, currentVersion) <= 0) return { status: "current" };
  } catch {
    return { status: "no-candidate" };
  }
  return { status: "candidate", version: parsed.latestVersion, checkedAt: parsed.checkedAt };
};

export const automaticUpdateRoot = (litHome = resolveHome()) => join(litHome, "update-notifier", "automatic");

export const automaticUpdateCachePath = (litHome = resolveHome()) => join(litHome, "update-notifier", "latest.json");

const resolveHome = () => process.env.LITCLAUDE_HOME
  ? process.env.LITCLAUDE_HOME
  : join(homedir(), ".litclaude");

const resolveClaudeHome = () => process.env.CLAUDE_CONFIG_DIR
  ?? process.env.CLAUDE_HOME
  ?? join(homedir(), ".claude");

const hasOptOut = (env, name) => Object.hasOwn(env ?? {}, name);

const streamIsTty = (stream) => stream?.isTTY === true;

export const shouldRunAutomaticUpdate = ({
  surface = "management",
  command,
  rest = [],
  dryRun = false,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  input = {},
  noAutoUpdate = false,
} = {}) => {
  if (!["session-start", "management"].includes(surface)) return false;
  if (dryRun || noAutoUpdate) return false;
  if (hasOptOut(env, "CI")
    || hasOptOut(env, "NO_UPDATE_NOTIFIER")
    || hasOptOut(env, "LITCLAUDE_NO_UPDATE_CHECK")
    || hasOptOut(env, "LITCLAUDE_NO_AUTO_UPDATE")
    || hasOptOut(env, "LITCLAUDE_AUTO_UPDATE_ACTIVE")) return false;
  if (rest.some((arg) => arg === "--json" || arg.startsWith("--json=") || arg.startsWith("--no-auto-update="))) return false;

  if (surface === "session-start") {
    // Claude Code invokes hooks through pipes, so TTY checks do not apply to this
    // host-owned interactive lifecycle. Other hook/tool/import surfaces never call
    // this function with `session-start` and therefore remain no-op by construction.
    return (input?.hook_event_name === undefined || input.hook_event_name === "SessionStart")
      && typeof input?.session_id === "string"
      && input.session_id.length > 0;
  }

  if (!new Set(["install", "update", "doctor"]).has(command)) return false;
  return streamIsTty(stdin) && streamIsTty(stdout) && streamIsTty(stderr);
};

const safeUrl = (value, { allowPath = false } = {}) => {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (!allowPath && (url.pathname !== "/" || url.search || url.hash)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const safeProxy = (value) => safeUrl(value, { allowPath: true });

const SAFE_ENVIRONMENT_KEYS = new Set([
  "PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "TMPDIR", "TMP", "TEMP",
  "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "NODE_EXTRA_CA_CERTS", "LITCLAUDE_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_HOME",
  "LITCLAUDE_PERMISSION_MODE", "LITCLAUDE_HUD_ACCENT", "LITCLAUDE_HUD_ACCENT_PROMPT",
  "LITCLAUDE_HUD_APPEARANCE", "LITCLAUDE_HUD_COLOR_DEPTH", "LITCLAUDE_HUD_NO_COLOR",
  "LITCLAUDE_OUTPUT_STYLE", "LITCLAUDE_OUTPUT_STYLE_PROMPT", "NO_COLOR",
  "npm_config_registry", "NPM_CONFIG_REGISTRY",
]);

const SAFE_PROXY_KEYS = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "NO_PROXY", "no_proxy",
]);

export const sanitizeNpmEnvironment = (source = process.env) => {
  const result = {};
  for (const [name, value] of Object.entries(source ?? {})) {
    if (typeof value !== "string" || sensitiveEnvironmentName.test(name)) continue;
    if (SAFE_PROXY_KEYS.has(name)) {
      const sanitized = name.toLowerCase().includes("no_proxy")
        ? value.replace(/[^A-Za-z0-9.:[\],_ -]/gu, "")
        : safeProxy(value);
      if (sanitized) result[name] = sanitized;
      continue;
    }
    if (!SAFE_ENVIRONMENT_KEYS.has(name)) continue;
    if (name === "npm_config_registry" || name === "NPM_CONFIG_REGISTRY") {
      const sanitized = safeUrl(value);
      if (sanitized) result[name] = sanitized;
      continue;
    }
    result[name] = value;
  }

  // The child must not inherit the parent update lifecycle. These are product
  // controls, not user credentials, and also fence npm's own update notifier.
  result.NO_UPDATE_NOTIFIER = "1";
  result.LITCLAUDE_NO_UPDATE_CHECK = "1";
  result.LITCLAUDE_NO_AUTO_UPDATE = "1";
  result.LITCLAUDE_AUTO_UPDATE_ACTIVE = "1";
  result.NPM_CONFIG_UPDATE_NOTIFIER = "false";
  result.npm_config_update_notifier = "false";
  result.NPM_CONFIG_FUND = "false";
  result.NPM_CONFIG_AUDIT = "false";
  result.NPM_CONFIG_PROGRESS = "false";
  result.npm_config_fund = "false";
  result.npm_config_audit = "false";
  result.npm_config_progress = "false";
  return result;
};

const writeAtomic = (path, content, mode = 0o600) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const canonicalNow = (now) => {
  const value = typeof now === "function" ? now() : now;
  return Number.isFinite(value) ? value : Date.now();
};

const safeDetail = (value) => String(value ?? "unknown")
  .replace(/(?:token|auth|password|secret|cookie|credential)[^\n]{0,120}/giu, "[redacted]")
  .replace(/[\r\n]+/gu, " ")
  .slice(0, 400);

const appendJournal = (journalPath, event, fields = {}, now = Date.now()) => {
  const row = {
    schema: AUTO_UPDATE_SCHEMA,
    event,
    at: new Date(canonicalNow(now)).toISOString(),
    ...fields,
  };
  mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 });
  appendFileSync(journalPath, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
};

const processIsLive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
};

const readLockOwner = (lockPath) => {
  try {
    const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
    if (!owner || Object.keys(owner).sort().join(",") !== "acquiredAt,generation,pid,schema") return null;
    if (owner.schema !== AUTO_UPDATE_SCHEMA || !generationPattern.test(owner.generation)) return null;
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return null;
    if (!canonicalTimestamp(owner.acquiredAt, Date.now() + AUTO_UPDATE_LOCK_STALE_MS)) return null;
    return owner;
  } catch {
    return null;
  }
};

const acquireInstallLock = (lockPath, now) => {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      const lease = { path: lockPath, generation: randomUUID(), pid: process.pid };
      try {
        writeAtomic(join(lockPath, "owner.json"), `${JSON.stringify({
          schema: AUTO_UPDATE_SCHEMA,
          generation: lease.generation,
          pid: process.pid,
          acquiredAt: new Date(now).toISOString(),
        })}\n`);
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      return lease;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = readLockOwner(lockPath);
        const age = now - lstatSync(lockPath).mtimeMs;
        stale = age >= AUTO_UPDATE_LOCK_STALE_MS && (owner ? !processIsLive(owner.pid) : true);
      } catch {
        stale = false;
      }
      if (!stale) return null;
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
  return null;
};

const releaseInstallLock = (lease) => {
  if (!lease) return false;
  try {
    const owner = readLockOwner(lease.path);
    if (owner?.generation !== lease.generation || owner.pid !== process.pid) return false;
    rmSync(lease.path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};

const nodeKind = (path) => {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
};

const copyNode = (source, target) => {
  const kind = nodeKind(source);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  if (kind === "symlink") {
    symlinkSync(readlinkSync(source), target);
  } else if (kind === "directory") {
    cpSync(source, target, { recursive: true, dereference: false, force: true });
  } else if (kind === "file" || kind === "other") {
    cpSync(source, target, { force: true, dereference: false });
  }
  return kind;
};

export const automaticUpdateTransactionPaths = ({ litHome = resolveHome(), claudeHome = resolveClaudeHome() } = {}) => [
  { name: "claude-plugin-cache", path: join(claudeHome, "plugins", "cache", MARKETPLACE_NAME) },
  { name: "installed-plugins", path: join(claudeHome, "plugins", "installed_plugins.json") },
  { name: "known-marketplaces", path: join(claudeHome, "plugins", "known_marketplaces.json") },
  { name: "claude-settings", path: join(claudeHome, "settings.json") },
  { name: "versioned-state", path: join(litHome, "litclaude-ai") },
  { name: "current-state", path: join(litHome, "current") },
  { name: "marketplace-state", path: join(litHome, "marketplaces", MARKETPLACE_NAME) },
];

const backupTransaction = (backupPath, paths) => {
  mkdirSync(backupPath, { recursive: true, mode: 0o700 });
  const entries = paths.map(({ name, path }, index) => {
    const kind = nodeKind(path);
    const artifact = join(backupPath, `${String(index).padStart(2, "0")}-${name}`);
    if (kind !== "missing") copyNode(path, artifact);
    return { name, path, kind, artifact: kind === "missing" ? null : artifact };
  });
  writeAtomic(join(backupPath, "manifest.json"), `${JSON.stringify({ schema: AUTO_UPDATE_SCHEMA, entries }, null, 2)}\n`);
  return entries;
};

const restoreTransaction = (entries) => {
  const failures = [];
  for (const entry of entries) {
    try {
      rmSync(entry.path, { recursive: true, force: true });
      if (entry.kind !== "missing") copyNode(entry.artifact, entry.path);
    } catch (error) {
      failures.push(`${entry.name}: ${safeDetail(error?.message)}`);
    }
  }
  if (failures.length) throw new Error(`rollback failed (${failures.join("; ")})`);
};

const commandForNpm = (env, explicit) => explicit ?? env.LITCLAUDE_NPM_BIN;

const buildNpmArgs = (targetVersion, command, extraArgs = []) => [
  "exec", "--yes", "--package", `${PACKAGE_NAME}@${targetVersion}`, "--", "litclaude-ai", command,
  ...extraArgs.filter((arg) => arg !== "--no-auto-update"),
  "--no-auto-update",
];

export const buildAutomaticInstallInvocation = (targetVersion, extraArgs = [], npmCommand) => ({
  command: npmCommand ?? (process.platform === "win32" ? "npm.cmd" : "npm"),
  args: buildNpmArgs(targetVersion, "install", extraArgs),
});

const childResult = (result) => {
  const hasError = result?.error != null;
  const hasSignal = result?.signal != null;
  const errorCode = result?.error?.code ?? (hasError ? "SPAWN_ERROR" : null);
  const timedOut = errorCode === "ETIMEDOUT" || result?.signal === "SIGTERM" || result?.signal === "SIGKILL";
  const status = Number.isInteger(result?.status) ? result.status : null;
  return {
    // Node can expose an error or signal alongside a misleading zero status
    // (and test doubles often do). Either condition means the child outcome is
    // not trustworthy; only an un-signalled, error-free zero exit is success.
    ok: !hasError && !hasSignal && !timedOut && status === 0,
    status,
    timedOut,
    signal: result?.signal ?? null,
    errorCode,
    ownershipConflict: /INSTALL_OWNERSHIP_CONFLICT/u.test(`${result?.stdout ?? ""}${result?.stderr ?? ""}`),
    stdoutBytes: Buffer.byteLength(String(result?.stdout ?? ""), "utf8"),
    stderrBytes: Buffer.byteLength(String(result?.stderr ?? ""), "utf8"),
  };
};

const verifyInstalledVersion = ({ claudeHome, targetVersion }) => {
  try {
    const pluginManifest = JSON.parse(readFileSync(
      join(claudeHome, "plugins", "cache", MARKETPLACE_NAME, "litclaude", targetVersion, ".claude-plugin", "plugin.json"),
      "utf8",
    ));
    if (pluginManifest.version !== targetVersion) return false;
    const registry = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
    return registry?.plugins?.["litclaude@litclaude-ai"]?.[0]?.version === targetVersion;
  } catch {
    return false;
  }
};

// `command` is an explicit npm binary, or undefined for the platform's own npm; npmEnv is the
// caller's environment, which names npm's CLI when npm started us (the child env is sanitized).
const runNpm = ({ command, args, env, npmEnv = env, cwd, timeout, spawn, platform = process.platform }) => {
  try {
    const invocation = npmInvocation(args, { command, platform, env: npmEnv });
    const result = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      shell: invocation.shell,
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
      timeout,
      maxBuffer: AUTO_UPDATE_MAX_OUTPUT_BYTES,
      killSignal: "SIGTERM",
    });
    return childResult(result);
  } catch (error) {
    return {
      ok: false,
      status: null,
      timedOut: false,
      signal: null,
      errorCode: error?.code ?? "SPAWN_ERROR",
      ownershipConflict: false,
      detail: safeDetail(error?.message),
      stdoutBytes: 0,
      stderrBytes: 0,
    };
  }
};

const writeReceipt = (autoRoot, receipt) => {
  const receiptPath = join(autoRoot, "receipt.json");
  const attemptPath = join(autoRoot, "receipts", `${receipt.generation}.json`);
  const encoded = `${JSON.stringify(receipt, null, 2)}\n`;
  writeAtomic(attemptPath, encoded);
  writeAtomic(receiptPath, encoded);
  return receiptPath;
};

const resultWithoutSecrets = ({ receiptPath, journalPath, backupPath, ...result }) => ({
  ...result,
  receiptPath,
  journalPath,
  backupPath: backupPath ?? null,
});

const readCacheRecord = (cachePath, now) => {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return validCacheRecord(parsed, now) ? parsed : null;
  } catch {
    return null;
  }
};

// The install child sees only a sanitized `npm_config_registry`, so the version check
// reads that same registry, and the npm default otherwise.
const registryLatestUrl = (env = process.env) => {
  const registry = safeUrl(env?.npm_config_registry ?? env?.NPM_CONFIG_REGISTRY) ?? DEFAULT_REGISTRY;
  return new URL(`${encodeURIComponent(PACKAGE_NAME)}/latest`, registry).toString();
};

const readCappedBody = async (response) => {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^(0|[1-9]\d*)$/u.test(length) || Number(length) > REGISTRY_MAX_RESPONSE_BYTES)) {
    throw new Error("registry response is too large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > REGISTRY_MAX_RESPONSE_BYTES) throw new Error("registry response is too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

// A cold npm cache can spend the whole 30-second install budget on the download over a slow
// link. The refresh child has no budget to keep, so it puts the tarball into the same npm
// cache the install uses (same HOME, same empty npmrc), and the install only unpacks it.
const prefetchUpdateTarball = ({ cachePath, generation, targetVersion, env, spawn }) => {
  const autoRoot = join(dirname(cachePath), "automatic");
  const userConfigPath = join(autoRoot, `${generation}.prefetch.npmrc`);
  try {
    writeAtomic(userConfigPath, "# LitClaude automatic update: no credentials\n");
    const result = runNpm({
      command: commandForNpm(env),
      args: ["cache", "add", `${PACKAGE_NAME}@${targetVersion}`],
      env: { ...sanitizeNpmEnvironment(env), npm_config_userconfig: userConfigPath, NPM_CONFIG_USERCONFIG: userConfigPath },
      npmEnv: env,
      cwd: dirname(cachePath),
      timeout: AUTO_UPDATE_PREFETCH_TIMEOUT_MS,
      spawn,
    });
    appendJournal(join(autoRoot, "journal.jsonl"), "prefetch-finished", {
      generation,
      targetVersion,
      ok: result.ok,
      timedOut: result.timedOut,
      errorCode: result.errorCode,
    }, Date.now());
  } catch {
    // The install downloads the package itself when this step could not.
  } finally {
    rmSync(userConfigPath, { force: true });
  }
};

const isNewer = (candidate, current) => {
  try {
    return compareStableSemver(candidate, current) > 0;
  } catch {
    return false;
  }
};

// Runs in the detached child. It writes only when the attempt it was started for still
// owns the cache, so a newer attempt or the terminal notifier is never overwritten.
export const refreshSessionUpdateCache = async ({
  cachePath,
  generation,
  registryUrl,
  currentVersion,
  env = process.env,
  fetch = globalThis.fetch,
  now = () => Date.now(),
  spawn = nodeSpawnSync,
} = {}) => {
  try {
    if (!safeUrl(registryUrl, { allowPath: true })) return false;
    const response = await fetch(registryUrl, {
      headers: { accept: "application/json", "user-agent": "litclaude-ai-update-notifier" },
      redirect: "error",
      signal: AbortSignal.timeout(REGISTRY_REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    if (!/^application\/json(?:\s*;\s*charset=(?:utf-8|utf8))?$/iu.test(response.headers.get("content-type")?.trim() ?? "")) return false;
    const parsed = JSON.parse(await readCappedBody(response));
    if (parsed?.name !== PACKAGE_NAME) return false;
    parseStableSemver(parsed.version);
    const completedAt = canonicalNow(now);
    const previous = readCacheRecord(cachePath, completedAt);
    if (previous?.generation !== generation) return false;
    writeAtomic(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: PACKAGE_NAME,
      latestVersion: parsed.version,
      checkedAt: new Date(completedAt).toISOString(),
      attemptedAt: previous.attemptedAt,
      generation,
    })}\n`);
    if (isNewer(parsed.version, currentVersion)) {
      prefetchUpdateTarball({ cachePath, generation, targetVersion: parsed.version, env, spawn });
    }
    return true;
  } catch {
    return false;
  }
};

const spawnSessionCacheRefresh = (cachePath, generation, registryUrl, env = process.env, currentVersion = "", spawnProcess = nodeSpawn) => {
  const child = spawnProcess(
    process.execPath,
    [fileURLToPath(new URL("./automatic-update-refresh.mjs", import.meta.url)), cachePath, generation, registryUrl, currentVersion],
    { detached: true, stdio: "ignore", windowsHide: true, env: sanitizeNpmEnvironment(env) },
  );
  child.once("error", () => {});
  child.unref();
  return true;
};

// SessionStart never waits on the network. It records the attempt (one per 24 hours),
// hands the registry request to a detached child, and a later session reads the result.
// A cache file it cannot read as its own record, such as another package's, is left as is.
const scheduleSessionCacheRefresh = ({ cachePath, env, now, spawnRefresh, currentVersion }) => {
  try {
    const previous = readCacheRecord(cachePath, now);
    if (!previous && existsSync(cachePath)) return "preserved";
    if (previous && now - Date.parse(previous.attemptedAt) < CACHE_TTL_MS) return "throttled";
    const generation = randomUUID();
    writeAtomic(cachePath, `${JSON.stringify({
      schema: 3,
      packageName: PACKAGE_NAME,
      latestVersion: previous?.latestVersion ?? null,
      checkedAt: previous?.checkedAt ?? null,
      attemptedAt: new Date(now).toISOString(),
      generation,
    })}\n`);
    return spawnRefresh(cachePath, generation, registryLatestUrl(env), env, currentVersion) === false ? "spawn-error" : "scheduled";
  } catch {
    return "spawn-error";
  }
};

const installedPluginVersion = (claudeHome) => {
  try {
    const registry = JSON.parse(readFileSync(join(claudeHome, "plugins", "installed_plugins.json"), "utf8"));
    const version = registry?.plugins?.["litclaude@litclaude-ai"]?.[0]?.version;
    parseStableSemver(version);
    return version;
  } catch {
    return null;
  }
};

const recentlyFailed = (autoRoot, targetVersion, now) => {
  try {
    const receipt = JSON.parse(readFileSync(join(autoRoot, "receipt.json"), "utf8"));
    if (!["rolled-back", "failed"].includes(receipt?.status) || receipt.targetVersion !== targetVersion) return false;
    const age = now - Date.parse(receipt.finishedAt);
    return age >= 0 && age < CACHE_TTL_MS;
  } catch {
    return false;
  }
};

const readJsonFile = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

// The session that installs an update keeps running the version it started with. The first
// session whose own version is the installed target records that moment in the receipt, once.
const markFirstSession = (autoRoot, currentVersion, now) => {
  try {
    const receipt = readJsonFile(join(autoRoot, "receipt.json"));
    if (receipt?.status !== "installed" || receipt.targetVersion !== currentVersion || receipt.firstSessionAt) return;
    if (typeof receipt.generation !== "string" || !generationPattern.test(receipt.generation)) return;
    writeReceipt(autoRoot, { ...receipt, firstSessionAt: new Date(now).toISOString() });
  } catch {
    // The record is advisory; the session goes on without it.
  }
};

const UPDATE_NOW = "`npx @litfamily/litclaude@latest update`";

// Doctor cause -> remedy. `{name}` and `{until}` are filled in by the doctor.
export const AUTO_UPDATE_REMEDIES = Object.freeze({
  "next-session": "Start a new Claude Code session. Sessions that are already open keep the version they started with.",
  offline: `The last registry check got no answer. Check the network or npm_config_registry, or run ${UPDATE_NOW}.`,
  backoff: `This version failed recently, so it is tried again after {until}. To update now, run ${UPDATE_NOW}.`,
  "install-timeout": `npm did not finish within 30 seconds, usually on a slow link. Run ${UPDATE_NOW}, which has no time limit.`,
  "ownership-conflict": `A file LitClaude did not write is in the install path. Run ${UPDATE_NOW} to see it, move it aside, and run it again.`,
  "install-failed": `npm or the check after the install failed. Run ${UPDATE_NOW} to see the error.`,
  "rollback-failed": `The previous install could not be restored. Run ${UPDATE_NOW} before relying on LitClaude.`,
  "opted-out": `Automatic update is off because {name} is set. Unset it, or run ${UPDATE_NOW} after a release.`,
  "directory-source": "Claude Code does not update this directory marketplace by itself; the LitClaude session-start check is the only automatic path.",
});

const OPT_OUT_NAMES = ["CI", "NO_UPDATE_NOTIFIER", "LITCLAUDE_NO_UPDATE_CHECK", "LITCLAUDE_NO_AUTO_UPDATE", "LITCLAUDE_AUTO_UPDATE_ACTIVE"];
// The refresh child has a 3-second request limit; an attempt this old without an answer failed.
const REFRESH_SETTLE_MS = 60_000;

// Read-only. Every line comes from files on disk, so it says nothing certain about sessions
// that are open right now.
export const automaticUpdateDoctorLines = ({
  env = process.env,
  litHome = env.LITCLAUDE_HOME ?? resolveHome(),
  claudeHome = env.CLAUDE_CONFIG_DIR ?? env.CLAUDE_HOME ?? resolveClaudeHome(),
  now = Date.now(),
} = {}) => {
  const timestamp = canonicalNow(now);
  const lines = [];
  const causes = [];
  const remedy = (cause, fields = {}) => causes.push(`AUTO_UPDATE_REMEDY: ${cause}: ${AUTO_UPDATE_REMEDIES[cause].replace(/\{(\w+)\}/gu, (_, key) => fields[key] ?? "")}`);
  const installed = installedPluginVersion(claudeHome);
  const receipt = readJsonFile(join(automaticUpdateRoot(litHome), "receipt.json"));
  const cache = readCacheRecord(automaticUpdateCachePath(litHome), timestamp);
  const optOut = OPT_OUT_NAMES.find((name) => hasOptOut(env, name));
  const plus24h = (at) => new Date(Date.parse(at) + CACHE_TTL_MS).toISOString();

  if (receipt?.status === "installed" && receipt.targetVersion === installed && !receipt.firstSessionAt) {
    lines.push(`AUTO_UPDATE: installed ${installed}, running ${receipt.fromVersion}: takes effect in the next session`);
    remedy("next-session");
  } else if (receipt?.status === "installed" && receipt.targetVersion === installed) {
    lines.push(`AUTO_UPDATE: running ${installed} since ${receipt.firstSessionAt}`);
  } else if (["rolled-back", "failed", "rollback-failed"].includes(receipt?.status)
    && (!installed || isNewer(receipt.targetVersion, installed))) {
    lines.push(`AUTO_UPDATE: ${receipt.targetVersion} was not applied (${receipt.status} at ${receipt.finishedAt})`);
    if (receipt.status === "rollback-failed") remedy("rollback-failed");
    else if (receipt.install?.ownershipConflict) remedy("ownership-conflict");
    else if (receipt.install?.timedOut) remedy("install-timeout");
    else remedy("install-failed");
    const age = timestamp - Date.parse(receipt.finishedAt);
    if (receipt.status !== "rollback-failed" && age >= 0 && age < CACHE_TTL_MS) remedy("backoff", { until: plus24h(receipt.finishedAt) });
  } else if (installed && cache?.latestVersion && isNewer(cache.latestVersion, installed)) {
    lines.push(`AUTO_UPDATE: ${cache.latestVersion} is available; the next session installs it`);
  } else {
    lines.push(`AUTO_UPDATE: installed ${installed ?? "unknown"}; no newer version known`);
  }

  if (cache) {
    const answered = cache.checkedAt ? `${cache.latestVersion} at ${cache.checkedAt}` : "none yet";
    lines.push(`AUTO_UPDATE_CHECK: last registry answer ${answered}; next check after ${plus24h(cache.attemptedAt)}`);
    const unanswered = !cache.checkedAt || Date.parse(cache.checkedAt) < Date.parse(cache.attemptedAt);
    if (unanswered && timestamp - Date.parse(cache.attemptedAt) >= REFRESH_SETTLE_MS) remedy("offline");
  }
  if (optOut) remedy("opted-out", { name: optOut });
  const source = readJsonFile(join(claudeHome, "plugins", "known_marketplaces.json"))?.[MARKETPLACE_NAME]?.source?.source;
  if (source === "directory") remedy("directory-source");
  lines.push(...causes);
  lines.push("AUTO_UPDATE_LIMIT: read from files only; the doctor cannot see which version an open Claude Code session has loaded.");
  return lines;
};

export const runAutomaticUpdate = ({
  surface = "management",
  command = "install",
  rest = [],
  dryRun = false,
  currentVersion,
  cachePath,
  litHome,
  claudeHome,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  input = {},
  noAutoUpdate = false,
  now = Date.now(),
  cwd = process.cwd(),
  npmCommand,
  spawn = nodeSpawnSync,
  platform = process.platform,
  verifyInstall = verifyInstalledVersion,
  restore = restoreTransaction,
  spawnRefresh = spawnSessionCacheRefresh,
} = {}) => {
  const resolvedLitHome = litHome ?? env.LITCLAUDE_HOME ?? resolveHome();
  const resolvedClaudeHome = claudeHome ?? env.CLAUDE_CONFIG_DIR ?? env.CLAUDE_HOME ?? resolveClaudeHome();
  const resolvedCachePath = cachePath ?? automaticUpdateCachePath(resolvedLitHome);
  if (!shouldRunAutomaticUpdate({ surface, command, rest, dryRun, env, stdin, stdout, stderr, input, noAutoUpdate })) {
    return { status: "gated" };
  }
  let parsedCurrent;
  try {
    parsedCurrent = parseStableSemver(currentVersion);
    if (!parsedCurrent) return { status: "gated" };
  } catch {
    return { status: "gated" };
  }
  const timestamp = canonicalNow(now);
  if (surface === "session-start") markFirstSession(automaticUpdateRoot(resolvedLitHome), currentVersion, timestamp);
  const candidate = readCacheCandidate(resolvedCachePath, currentVersion, timestamp);
  if (surface === "session-start" && ["stale-cache", "no-candidate"].includes(candidate.status)) {
    return {
      ...candidate,
      refresh: scheduleSessionCacheRefresh({ cachePath: resolvedCachePath, env, now: timestamp, spawnRefresh, currentVersion }),
    };
  }
  if (candidate.status !== "candidate") return candidate;
  // A long-lived Claude Code process keeps running the hook from the version folder it
  // started with, so its own version lags behind what an earlier session installed.
  const installedVersion = installedPluginVersion(resolvedClaudeHome);
  if (installedVersion && compareStableSemver(installedVersion, candidate.version) >= 0) {
    return { status: "already-installed", installedVersion, targetVersion: candidate.version };
  }

  const autoRoot = automaticUpdateRoot(resolvedLitHome);
  // A failed target stays in the cache until the registry moves on, so without this every
  // new session would spend the whole install budget on it again.
  if (recentlyFailed(autoRoot, candidate.version, timestamp)) {
    return { status: "backoff", targetVersion: candidate.version };
  }
  const lockPath = join(autoRoot, "install.lock");
  let lease;
  try {
    lease = acquireInstallLock(lockPath, timestamp);
  } catch (error) {
    return { status: "failed", reason: safeDetail(error?.message) };
  }
  if (!lease) return { status: "locked", lockPath };

  const journalPath = join(autoRoot, "journal.jsonl");
  const backupPath = join(autoRoot, "backups", lease.generation);
  const startedAt = new Date(timestamp).toISOString();
  const transactionPaths = automaticUpdateTransactionPaths({ litHome: resolvedLitHome, claudeHome: resolvedClaudeHome });
  let backupEntries;
  let receiptPath;
  let userConfigPath;
  try {
    appendJournal(journalPath, "started", {
      generation: lease.generation,
      fromVersion: currentVersion,
      targetVersion: candidate.version,
      surface,
    }, timestamp);
    backupEntries = backupTransaction(backupPath, transactionPaths);
    appendJournal(journalPath, "backup-created", {
      generation: lease.generation,
      targetVersion: candidate.version,
      pathCount: backupEntries.length,
    }, timestamp);

    const childEnv = sanitizeNpmEnvironment(env);
    userConfigPath = join(autoRoot, `${lease.generation}.npmrc`);
    writeAtomic(userConfigPath, "# LitClaude automatic update: no credentials\n");
    childEnv.npm_config_userconfig = userConfigPath;
    childEnv.NPM_CONFIG_USERCONFIG = userConfigPath;
    const resolvedNpm = commandForNpm(env, npmCommand);
    const installInvocation = buildAutomaticInstallInvocation(candidate.version, rest, resolvedNpm);
    const install = runNpm({
      command: resolvedNpm,
      args: installInvocation.args,
      env: childEnv,
      npmEnv: env,
      cwd,
      timeout: AUTO_UPDATE_INSTALL_TIMEOUT_MS,
      spawn,
      platform,
    });
    appendJournal(journalPath, "install-finished", {
      generation: lease.generation,
      targetVersion: candidate.version,
      ok: install.ok,
      status: install.status,
      timedOut: install.timedOut,
      errorCode: install.errorCode,
    }, Date.now());

    let doctor = null;
    if (install.ok) {
      doctor = runNpm({
        command: resolvedNpm,
        args: buildNpmArgs(candidate.version, "doctor"),
        env: childEnv,
        npmEnv: env,
        cwd,
        timeout: AUTO_UPDATE_DOCTOR_TIMEOUT_MS,
        spawn,
        platform,
      });
      appendJournal(journalPath, "doctor-finished", {
        generation: lease.generation,
        targetVersion: candidate.version,
        ok: doctor.ok,
        status: doctor.status,
        timedOut: doctor.timedOut,
        errorCode: doctor.errorCode,
      }, Date.now());
    }
    rmSync(userConfigPath, { force: true });
    userConfigPath = undefined;

    const verified = install.ok && doctor?.ok === true && verifyInstall({
      claudeHome: resolvedClaudeHome,
      litHome: resolvedLitHome,
      targetVersion: candidate.version,
    });
    const success = install.ok && doctor?.ok === true && verified;
    if (!success) {
      let rollbackError = null;
      try {
        restore(backupEntries);
      } catch (error) {
        rollbackError = safeDetail(error?.message);
      }
      const status = rollbackError ? "rollback-failed" : "rolled-back";
      appendJournal(journalPath, "rollback", {
        generation: lease.generation,
        targetVersion: candidate.version,
        status,
        reason: rollbackError ?? (install.ok ? "post-install doctor or version verification failed" : install.errorCode ?? "npm install failed"),
      }, Date.now());
      const receipt = {
        schema: AUTO_UPDATE_SCHEMA,
        generation: lease.generation,
        status,
        packageName: PACKAGE_NAME,
        fromVersion: currentVersion,
        targetVersion: candidate.version,
        startedAt,
        finishedAt: new Date().toISOString(),
        backupPath,
        journalPath,
        install,
        doctor,
        verified,
        rollback: { attempted: true, ok: rollbackError === null, error: rollbackError },
      };
      receiptPath = writeReceipt(autoRoot, receipt);
      return resultWithoutSecrets({ status, receiptPath, journalPath, backupPath, targetVersion: candidate.version, rollback: receipt.rollback });
    }

    appendJournal(journalPath, "completed", {
      generation: lease.generation,
      fromVersion: currentVersion,
      targetVersion: candidate.version,
      verified: true,
    }, Date.now());
    const receipt = {
      schema: AUTO_UPDATE_SCHEMA,
      generation: lease.generation,
      status: "installed",
      packageName: PACKAGE_NAME,
      fromVersion: currentVersion,
      targetVersion: candidate.version,
      startedAt,
      finishedAt: new Date().toISOString(),
      backupPath,
      journalPath,
      install,
      doctor,
      verified: true,
      rollback: { attempted: false, ok: true, error: null },
    };
    receiptPath = writeReceipt(autoRoot, receipt);
    return resultWithoutSecrets({ status: "installed", receiptPath, journalPath, backupPath, targetVersion: candidate.version, rollback: receipt.rollback });
  } catch (error) {
    const reason = safeDetail(error?.message);
    let rollbackError = null;
    if (backupEntries) {
      try {
        restore(backupEntries);
      } catch (restoreError) {
        rollbackError = safeDetail(restoreError?.message);
      }
    }
    try {
      appendJournal(journalPath, "failed", {
        generation: lease.generation,
        targetVersion: candidate.version,
        reason,
        rollback: rollbackError ? "failed" : backupEntries ? "ok" : "not-started",
      }, Date.now());
      const receipt = {
        schema: AUTO_UPDATE_SCHEMA,
        generation: lease.generation,
        status: rollbackError ? "rollback-failed" : "failed",
        packageName: PACKAGE_NAME,
        fromVersion: currentVersion,
        targetVersion: candidate.version,
        startedAt,
        finishedAt: new Date().toISOString(),
        backupPath,
        journalPath,
        reason,
        rollback: { attempted: Boolean(backupEntries), ok: rollbackError === null, error: rollbackError },
      };
      receiptPath = writeReceipt(autoRoot, receipt);
    } catch {
      // The primary failure remains the only claim if the evidence surface itself is unavailable.
    }
    return resultWithoutSecrets({
      status: rollbackError ? "rollback-failed" : "failed",
      reason,
      receiptPath,
      journalPath,
      backupPath,
      targetVersion: candidate.version,
    });
  } finally {
    if (userConfigPath) rmSync(userConfigPath, { force: true });
    releaseInstallLock(lease);
  }
};
