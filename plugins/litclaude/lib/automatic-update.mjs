import { spawnSync as nodeSpawnSync } from "node:child_process";
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

export const PACKAGE_NAME = "@litfamily/litclaude";
const MARKETPLACE_NAME = "litclaude-ai";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const AUTO_UPDATE_INSTALL_TIMEOUT_MS = 30_000;
export const AUTO_UPDATE_DOCTOR_TIMEOUT_MS = 15_000;
export const AUTO_UPDATE_TIMEOUT_MS = AUTO_UPDATE_INSTALL_TIMEOUT_MS + AUTO_UPDATE_DOCTOR_TIMEOUT_MS;
export const AUTO_UPDATE_LOCK_STALE_MS = 60_000;
export const AUTO_UPDATE_MAX_OUTPUT_BYTES = 128 * 1_024;
export const AUTO_UPDATE_SCHEMA = 1;

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

const commandForNpm = (env, explicit) => explicit ?? env.LITCLAUDE_NPM_BIN ?? (process.platform === "win32" ? "npm.cmd" : "npm");

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

const runNpm = ({ command, args, env, cwd, timeout, spawn }) => {
  try {
    const result = spawn(command, args, {
      cwd,
      env,
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
  verifyInstall = verifyInstalledVersion,
  restore = restoreTransaction,
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
  const candidate = readCacheCandidate(resolvedCachePath, currentVersion, timestamp);
  if (candidate.status !== "candidate") return candidate;

  const autoRoot = automaticUpdateRoot(resolvedLitHome);
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
      command: installInvocation.command,
      args: installInvocation.args,
      env: childEnv,
      cwd,
      timeout: AUTO_UPDATE_INSTALL_TIMEOUT_MS,
      spawn,
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
        cwd,
        timeout: AUTO_UPDATE_DOCTOR_TIMEOUT_MS,
        spawn,
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
