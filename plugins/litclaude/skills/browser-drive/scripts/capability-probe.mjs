#!/usr/bin/env node
// Capability probe for the external browser driver this skill delegates to.
//
// It answers one question — may this session drive a browser, and by what exact command — and it
// answers it as data. Nothing here installs, downloads, or launches a browser. A missing driver is
// a normal result, not an exception, because "no driver" is the answer that most often decides the
// route.
//
// Resolving a name is not the same as verifying a tool. A command on PATH can carry the expected
// name and be something else entirely, so identity is checked against the version banner before the
// driver is reported as usable. The same discipline `Skill(structural-search)` applies to `sg`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, win32 } from "node:path";
import process from "node:process";
import { containsSecret } from "../../../lib/secret-shapes.mjs";

const DRIVER_SOURCE = "vercel-labs/agent-browser";
export const DRIVER_COMMAND = "agent-browser";
export const BROWSER_PROCESS_CLEANUP_FAILED = "BROWSER_PROCESS_CLEANUP_FAILED";

export const BROWSER_DRIVE_BLOCKER = Object.freeze({
  unavailable: "BLOCKED_BROWSER_DRIVER_UNAVAILABLE",
  identity: "BLOCKED_BROWSER_IDENTITY_UNVERIFIED",
  cleanup: "BLOCKED_BROWSER_DRIVER_CLEANUP_FAILED",
});
const MAX_BANNER_CHARS = 200;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_VERSION_TIMEOUT_MS = 10_000;
const MAX_VERSION_TIMEOUT_MS = DEFAULT_VERSION_TIMEOUT_MS;
const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const MAX_WINDOWS_SHIM_BYTES = 4 * 1024;
// The quoted target of an npm `.cmd` shim, relative to the shim's own directory: either the
// native `"%~dp0node_modules\...\agent-browser-win32-x64.exe" %*` that agent-browser's installer
// writes on a reinstall, or npm's own `"%dp0%\node_modules\...\agent-browser.js" %*`.
const WINDOWS_SHIM_TARGET_PATTERN = /"%(?:~dp0|dp0%)\\?([^"%\r\n]+)"\s+%\*/iu;
const VERIFIED_VERSION_FLOOR = "0.34.0";
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const BANNER_INSTRUCTION_PATTERN =
  /(?:^|[^A-Za-z0-9])(?:ignore|disregard|forget)[\s_-]+(?:(?:the|any|all|every)[\s_-]+)?(?:previous|prior|above|earlier)[\s_-]+instructions?\b/iu;
const BANNER_MARKUP_PATTERN = /(?:<\/?[A-Za-z][^>\r\n]{0,128}>|<!--|-->|<!\[CDATA\[|\{\{|\}\})/u;
const ANSI_ESCAPE_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/gu;
const RESIDUAL_CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]/u;
const sanitizeLine = (raw) => raw.replace(ANSI_ESCAPE_PATTERN, "").trim();
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

// Version output is untrusted data from a program this session did not write.
function meaningfulLines(text) {
  if (typeof text !== "string") return null;
  return text.split(/\r?\n/u).map(sanitizeLine).filter((line) => line !== "");
}

function firstMeaningfulLine(text) {
  const line = meaningfulLines(text)?.[0] ?? null;
  return line !== null && line.length <= MAX_BANNER_CHARS ? line : null;
}

function hasOverLimitMeaningfulLine(text) {
  return (meaningfulLines(text) ?? []).some((line) => line.length > MAX_BANNER_CHARS);
}

function hasResidualControlOrFormat(text) {
  return typeof text === "string"
    && text.split(/\r?\n/u).some((raw) => RESIDUAL_CONTROL_OR_FORMAT_PATTERN.test(raw.replace(ANSI_ESCAPE_PATTERN, "")));
}

function outputByteLength(value) {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Buffer.isBuffer(value)) return value.byteLength;
  return 0;
}

function exceedsOutputLimit(resultValue) {
  return outputByteLength(resultValue?.stdout) + outputByteLength(resultValue?.stderr) > MAX_OUTPUT_BYTES;
}

function terminateOwnedProcessGroup(pid) {
  if (process.platform === "win32") return true;
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(-pid, "SIGTERM"); } catch (error) {
    // The wrapper may have exited and the numeric process-group id may already
    // belong to another user's group.  EPERM proves we did not signal it; the
    // original group is therefore gone and cleanup is complete for this run.
    return error?.code === "ESRCH" || error?.code === "EPERM";
  }
  sleepSync(25);
  // A terminated process group can disappear and its numeric id can be reused before the
  // second signal. Probe ownership first: EPERM means the old group is gone and the reused
  // group is not ours, so do not signal it. This avoids turning a successful cleanup into a
  // false denial for a legitimate driver while never sending SIGKILL to an unrelated group.
  try { process.kill(-pid, 0); } catch (error) {
    return error?.code === "ESRCH" || error?.code === "EPERM";
  }
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    if (error?.code !== "EPERM") return false;
    // The group may have disappeared and been reused between the ownership probe and
    // SIGKILL. Confirm that no signalable member of our original group remains before
    // accepting the cleanup as complete.
    try {
      process.kill(-pid, 0);
      return false;
    } catch (probeError) {
      return probeError?.code === "ESRCH" || probeError?.code === "EPERM";
    }
  }
}

function cleanupFailure(resultValue) {
  return {
    ...resultValue,
    error: Object.assign(new Error("the browser process-group cleanup was not verified"), {
      code: BROWSER_PROCESS_CLEANUP_FAILED,
    }),
  };
}

const POSIX_DRIVER_WRAPPER = [
  "parent_pid=$1; mode=$2; shift 2",
  "group_pid=$$",
  "trap '' TERM INT HUP",
  "(",
  "  trap '' TERM INT HUP",
  "  while kill -0 \"$parent_pid\" 2>/dev/null; do /bin/sleep 0.02; done",
  "  kill -TERM -\"$group_pid\" 2>/dev/null",
  "  /bin/sleep 0.1",
  "  kill -KILL -\"$group_pid\" 2>/dev/null",
  ") >/dev/null 2>&1 &",
  // stdin is whatever runBrowserCommand attached: /dev/null (Node opens it for an ignored fd), or
  // a pipe carrying the caller's `input`, which the driver reads to EOF.
  "if [ \"$mode\" = \"shell\" ]; then",
  "  command \"$@\"",
  "else",
  "  \"$@\"",
  "fi",
  "status=$?",
  "exit \"$status\"",
].join("\n");

// Zero is the trap: spawnSync reads timeout 0 as "no timeout", so anything that is not a
// positive integer becomes the finite default instead of an unlimited wait.
const boundedVersionTimeout = (value) => Number.isInteger(value) && value > 0
  ? Math.min(value, MAX_VERSION_TIMEOUT_MS)
  : DEFAULT_VERSION_TIMEOUT_MS;

function outputLimitError() {
  return Object.assign(new Error("browser process output exceeded the safe limit"), { code: "ENOBUFS" });
}

function readFileHead(path, limit) {
  const buffer = Buffer.alloc(limit);
  const fd = openSync(path, "r");
  try {
    let length = 0;
    while (length < limit) {
      const read = readSync(fd, buffer, length, limit - length, length);
      if (read === 0) break;
      length += read;
    }
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

// A driver that starts a background daemon on Windows hands the daemon its inherited stdout and
// stderr handles. spawnSync waits until every pipe closes, so with pipes each call that starts the
// daemon runs into its timeout and reports ETIMEDOUT although the command itself has exited.
// Owned temporary files do not hold the call open; they are read back within the same byte limit
// once the direct child exits.
function spawnWindowsSync(command, args, options, maxBuffer) {
  const directory = mkdtempSync(join(tmpdir(), "litclaude-browser-"));
  try {
    const paths = [join(directory, "stdout"), join(directory, "stderr")];
    const fds = [];
    let resultValue;
    try {
      for (const path of paths) fds.push(openSync(path, "w"));
      resultValue = spawnSync(command, args, {
        ...options,
        stdio: [options.input === undefined ? "ignore" : "pipe", fds[0], fds[1]],
        killSignal: "SIGKILL",
      });
    } finally {
      for (const fd of fds) closeSync(fd);
    }
    const [stdout, stderr] = paths.map((path) => readFileHead(path, maxBuffer + 1));
    const overflow = stdout.byteLength > maxBuffer || stderr.byteLength > maxBuffer;
    const decode = (buffer) => (typeof options.encoding === "string" && options.encoding !== "buffer"
      ? buffer.toString(options.encoding)
      : buffer);
    const output = [decode(stdout), decode(stderr)];
    return {
      ...resultValue,
      output: [null, ...output],
      stdout: output[0],
      stderr: output[1],
      error: resultValue.error ?? (overflow ? outputLimitError() : undefined),
    };
  } finally {
    // The daemon can still hold the files open. Removal is best effort; their content was read.
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* left for the OS temp cleaner */ }
  }
}

/** Run a browser probe command synchronously with bounded output and owned cleanup. */
export function runBrowserCommand(command, args, options = {}) {
  const requestedMaxBuffer = Number.isSafeInteger(options.maxBuffer) && options.maxBuffer > 0
    ? options.maxBuffer
    : MAX_OUTPUT_BYTES;
  const maxBuffer = Math.min(requestedMaxBuffer, MAX_OUTPUT_BYTES);
  let resultValue;
  try {
    resultValue = process.platform === "win32"
      // Windows receives Node's direct-child timeout fallback; there is no owned process group.
      ? spawnWindowsSync(command, args, { ...options, detached: false, maxBuffer }, maxBuffer)
      : spawnSync(
        "/bin/sh",
        ["-c", POSIX_DRIVER_WRAPPER, "litclaude-browser-watch", String(process.pid), options.shell ? "shell" : "direct", command, ...args],
        {
          ...options,
          // POSIX gets an owned process group.
          detached: true,
          shell: false,
          stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
          // SIGTERM can be ignored, and spawnSync keeps waiting for a child that ignores it — the
          // timeout only stays a bound if the kill is one the child cannot swallow.
          killSignal: "SIGKILL",
          maxBuffer,
        },
      );
  } catch {
    return null;
  }
  const processWasStarted = process.platform !== "win32"
    && Number.isSafeInteger(resultValue?.pid)
    && resultValue.pid > 1;
  const cleanupMustBeProven = process.platform !== "win32"
    && (processWasStarted || resultValue?.status === 0 || ["ETIMEDOUT", "ENOBUFS"].includes(resultValue?.error?.code));
  const cleanupVerified = process.platform === "win32"
    || (processWasStarted ? terminateOwnedProcessGroup(resultValue.pid) : !cleanupMustBeProven);
  if (!cleanupVerified || (cleanupMustBeProven && !processWasStarted)) return cleanupFailure(resultValue);
  if (!exceedsOutputLimit(resultValue)) return resultValue;
  return {
    ...resultValue,
    stdout: "",
    stderr: "",
    error: resultValue.error ?? outputLimitError(),
  };
}

function bannerIsUnsafe(text) {
  return (meaningfulLines(text) ?? []).some((line) => BANNER_INSTRUCTION_PATTERN.test(line)
    || BANNER_MARKUP_PATTERN.test(line)
    || containsSecret(line));
}

function parseSemver(value) {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map((part) => BigInt(part)),
    prerelease: match[4]?.split(".") ?? null,
  };
}

function compareSemver(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  if (left.prerelease === null || right.prerelease === null) {
    return left.prerelease === right.prerelease ? 0 : left.prerelease === null ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

// `command -v` is a POSIX shell builtin; cmd.exe has no such command. Windows resolves the name the
// way cmd.exe does, directory by directory in PATH order, trying each PATHEXT extension in turn,
// so npm's extensionless shell shim (which Windows cannot run) is never picked. This is done here
// rather than with where.exe, which prints in the console code page: a profile path with Hangul or
// other non-ASCII characters comes back garbled.
function findOnWindowsPath(searchPath, pathext) {
  const extensions = pathext.split(";").map((value) => value.trim()).filter((value) => value.startsWith("."));
  for (const entry of searchPath.split(win32.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/u, "$1");
    if (directory === "") continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${DRIVER_COMMAND}${extension}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* not in this directory */ }
    }
  }
  return null;
}

const acceptableResolvedPath = (path) => path.length <= MAX_BANNER_CHARS
  && !hasResidualControlOrFormat(path)
  && !bannerIsUnsafe(path);

// Node refuses to start a `.cmd` or `.bat` file without a shell, and a shell would re-parse every
// argument, URLs included. A shim is followed to the native executable it starts; any other batch
// file is something this probe cannot vouch for.
function unwrapWindowsShim(candidate) {
  if (![".cmd", ".bat"].includes(extname(candidate).toLowerCase())) return candidate;
  try {
    if (statSync(candidate).size > MAX_WINDOWS_SHIM_BYTES) return null;
    const match = WINDOWS_SHIM_TARGET_PATTERN.exec(readFileSync(candidate, "utf8"));
    if (!match) return null;
    const target = join(dirname(candidate), ...match[1].split(/[\\/]+/u).filter(Boolean));
    if (extname(target).toLowerCase() === ".exe") return existsSync(target) ? target : null;
    // npm's own shim runs agent-browser's JS launcher, which only starts the native binary beside
    // it (an arm64 host falls back to x64, as the launcher does).
    if (basename(target).toLowerCase() !== `${DRIVER_COMMAND}.js`) return null;
    return [...new Set([process.arch, "x64"])]
      .map((arch) => join(dirname(target), `${DRIVER_COMMAND}-win32-${arch}.exe`))
      .find((path) => existsSync(path)) ?? null;
  } catch {
    return null;
  }
}

function result(status, { command = null, version = null, blocker = null, detail }) {
  return { status, command, version, blocker, detail };
}

function invalidProbeInput() {
  return result("unavailable", {
    blocker: BROWSER_DRIVE_BLOCKER.unavailable,
    detail: "browser driver probe received malformed options; no driver was invoked",
  });
}

function probeFailure() {
  return result("unavailable", {
    blocker: BROWSER_DRIVE_BLOCKER.unavailable,
    detail: "browser driver probe failed closed",
  });
}

export function probeBrowserDriver(options) {
  try {
    // The CLI calls this with no arguments. An explicit undefined is malformed input.
    if (arguments.length === 0) options = {};
    if (options === null || typeof options !== "object" || Array.isArray(options)) return invalidProbeInput();

    let path;
    let runCommand = runBrowserCommand;
    let versionTimeoutMs = DEFAULT_VERSION_TIMEOUT_MS;
    let platform = process.platform;
    try {
      path = options.path;
      const configuredRunCommand = options.runCommand;
      if (configuredRunCommand !== undefined) runCommand = configuredRunCommand;
      versionTimeoutMs = options.versionTimeoutMs;
      if (options.platform !== undefined) platform = options.platform;
    } catch {
      return invalidProbeInput();
    }
    if ((path !== undefined && typeof path !== "string") || typeof runCommand !== "function" || typeof platform !== "string") {
      return invalidProbeInput();
    }

    const windows = platform === "win32";
    const searchPath = typeof path === "string" ? path : (process.env.PATH ?? "");
    const env = { PATH: searchPath };

    let resolved = null;
    const windowsCandidate = windows
      ? findOnWindowsPath(searchPath, process.env.PATHEXT || WINDOWS_DEFAULT_PATHEXT)
      : null;
    if (!windows) {
      try {
        resolved = runCommand("command", ["-v", DRIVER_COMMAND], {
          encoding: "utf8",
          env,
          shell: true,
          timeout: DEFAULT_VERSION_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
        });
      } catch {
        resolved = null;
      }
    }
    if (resolved?.error?.code === BROWSER_PROCESS_CLEANUP_FAILED) {
      return result("unverified-identity", {
        blocker: BROWSER_DRIVE_BLOCKER.cleanup,
        detail: `${DRIVER_COMMAND} resolution cleanup was not verified`,
      });
    }
    const resolverOutputTooLarge = exceedsOutputLimit(resolved);
    const resolverStdout = resolverOutputTooLarge ? [] : (meaningfulLines(resolved?.stdout) ?? []);
    const resolverStderr = resolverOutputTooLarge ? [] : (meaningfulLines(resolved?.stderr) ?? []);
    const resolverHasResidualControlOrFormat = !resolverOutputTooLarge
      && (hasResidualControlOrFormat(resolved?.stdout) || hasResidualControlOrFormat(resolved?.stderr));
    const resolvedPath = windows
      ? (windowsCandidate !== null && acceptableResolvedPath(windowsCandidate) ? windowsCandidate : null)
      : resolved?.status === 0
        && !resolverOutputTooLarge
        && resolverStdout.length === 1
        && resolverStderr.length === 0
        && resolverStdout[0].length <= MAX_BANNER_CHARS
        && !resolverHasResidualControlOrFormat
        && !bannerIsUnsafe(resolverStdout[0])
        ? resolverStdout[0]
        : null;
    if (resolvedPath === null) {
      const resolverRejected = windows
        ? windowsCandidate !== null
        : resolved?.status === 0 || resolved?.error?.code === "ENOBUFS";
      return result(resolverRejected ? "unverified-identity" : "unavailable", {
        blocker: resolverRejected ? BROWSER_DRIVE_BLOCKER.identity : BROWSER_DRIVE_BLOCKER.unavailable,
        detail: resolverRejected
          ? `${DRIVER_COMMAND} resolved but its command path was rejected`
          : `${DRIVER_COMMAND} is not on PATH; this session cannot drive a browser`,
      });
    }
    const command = windows ? unwrapWindowsShim(resolvedPath) : resolvedPath;
    if (command === null || !acceptableResolvedPath(command)) {
      return result("unverified-identity", {
        blocker: BROWSER_DRIVE_BLOCKER.identity,
        detail: `${DRIVER_COMMAND} resolved to a batch file that does not start a native ${DRIVER_COMMAND} executable`,
      });
    }

    let versionRun;
    try {
      versionRun = runCommand(command, ["--version"], {
        encoding: "utf8",
        env,
        timeout: boundedVersionTimeout(versionTimeoutMs),
        maxBuffer: MAX_OUTPUT_BYTES,
      });
    } catch {
      versionRun = null;
    }
    if (versionRun?.error?.code === BROWSER_PROCESS_CLEANUP_FAILED) {
      return result("unverified-identity", {
        command,
        version: null,
        blocker: BROWSER_DRIVE_BLOCKER.cleanup,
        detail: `${command} cleanup was not verified`,
      });
    }
    const versionOutputTooLarge = exceedsOutputLimit(versionRun);
    const version = versionOutputTooLarge
      ? null
      : firstMeaningfulLine(versionRun?.stdout) ?? firstMeaningfulLine(versionRun?.stderr);
    const versionHasResidualControlOrFormat = !versionOutputTooLarge
      && (hasResidualControlOrFormat(versionRun?.stdout) || hasResidualControlOrFormat(versionRun?.stderr));
    const unsafeBanner = !versionOutputTooLarge
      && (bannerIsUnsafe(versionRun?.stdout) || bannerIsUnsafe(versionRun?.stderr));
    const overLimitBanner = !versionOutputTooLarge
      && (hasOverLimitMeaningfulLine(versionRun?.stdout) || hasOverLimitMeaningfulLine(versionRun?.stderr));

    if (versionRun === null || versionRun.status !== 0 || version === null || versionOutputTooLarge
      || versionHasResidualControlOrFormat || unsafeBanner || overLimitBanner) {
      return result("unverified-identity", {
        command,
        version: null,
        blocker: BROWSER_DRIVE_BLOCKER.identity,
        detail: `${command} resolved but did not report a usable version`,
      });
    }
    const versionPrefix = `${DRIVER_COMMAND} `;
    const parsedVersion = version.startsWith(versionPrefix) ? parseSemver(version.slice(versionPrefix.length)) : null;
    const floor = parseSemver(VERIFIED_VERSION_FLOOR);
    if (parsedVersion === null || compareSemver(parsedVersion, floor) < 0) {
      return result("unverified-identity", {
        command,
        version: null,
        blocker: BROWSER_DRIVE_BLOCKER.identity,
        detail: `${command} resolved but did not identify ${DRIVER_COMMAND} at or above the verified floor ${VERIFIED_VERSION_FLOOR} from ${DRIVER_SOURCE}`,
      });
    }
    const beyondVerified = compareSemver(parsedVersion, floor) > 0;
    return result(beyondVerified ? "beyond-verified" : "available", {
      command,
      version,
      detail: beyondVerified
        ? `${command} identified ${DRIVER_SOURCE} ${version}, beyond the verified floor ${VERIFIED_VERSION_FLOOR}`
        : `${command} identified itself as ${DRIVER_SOURCE} at the verified floor ${VERIFIED_VERSION_FLOOR}`,
    });
  } catch {
    return probeFailure();
  }
}

if (process.argv[1]?.endsWith("capability-probe.mjs")) {
  const report = probeBrowserDriver();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = ["available", "beyond-verified"].includes(report.status) ? 0 : 1;
}
