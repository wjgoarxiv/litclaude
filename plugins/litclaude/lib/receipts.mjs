// The session's receipt ledger: which checks ran and when code last changed, written from what the
// PostToolUse hooks already see. Claude Code 2.1.330 gives a Bash call no exit field: a call that
// exits 0 reaches PostToolUse, a non-zero exit reaches PostToolUseFailure, whose `error` starts with
// the host's own `Exit code <n>` line. The event is the pass/fail signal; the number comes from that
// anchored host line only, never from the command's output. A receipt keeps the check's name (the
// command and its script, no arguments), the exit, and hashes; never a prompt, argument or output.
//   sessions/<sid>/receipts.jsonl  {at, check, exit, outputSha256, treeSha, codeSha}, one line per check run
//   sessions/<sid>/edits.json      {lastCodeEditAt, baselineCodeSha}
//   sessions/<sid>/check-rc        one integer, written by a rewritten piped check and removed on read
// lastCodeEditAt comes from Write, Edit, MultiEdit, NotebookEdit. baselineCodeSha is the code
// fingerprint taken the first time lit-loop, litwork or start-work activates. codeSha is that same
// fingerprint at the check. A piped or `;`-chained check records the integer in check-rc, not the
// pipeline's status and not anything parsed from the command's output. A check that ends a leading
// `&&` chain is wrapped alone; if an earlier part of that chain fails, the check never runs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { resolveProjectStateRoot, STATE_APPEND_FLAG, STATE_WRITE_FLAG } from "./project-state-root.mjs";
import { sessionStateDir, sessionStatePath } from "./session-state.mjs";
import { readStack } from "./workflow-stack.mjs";

export const RECEIPTS_FILE = "receipts.jsonl";
export const EDITS_FILE = "edits.json";
const MAX_COMMAND = 4096;
const GIT_TIMEOUT_MS = 4000;
const CODE_FILE_CAP = 20000;
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const GATED_SKILLS = new Set(["lit-loop", "litwork", "start-work"]);
export const CHECK_RC_FILE = "check-rc";
const WRAP_MARK = "; __lit_rc=$?; printf '%s\\n' \"$__lit_rc\" > ";
const HOST_EXIT_LINE = /^Exit code (\d{1,3})(?:\n|$)/u;
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/u;
// Redirections never change a command's exit status, so they are dropped before matching.
const REDIRECTION = /\s*(?:\d|&)?>>?(?:&\d+|\s*[^\s|;&<>]+)/gu;
const UNSAFE_SHELL = /[|;`&()<>\n\r]|\$\(/u;
const CHECKS = [
  [/^npm\s+test(?=\s|$)/u, () => "npm test"],
  [/^npm\s+run\s+(test[A-Za-z0-9:._-]*)(?=\s|$)/u, (match) => `npm run ${match[1]}`],
  [/^node\s+--test(?=\s|$)/u, () => "node --test"],
  [/^pytest(?=\s|$)/u, () => "pytest"],
  [/^cargo\s+test(?=\s|$)/u, () => "cargo test"],
  [/^go\s+test(?=\s|$)/u, () => "go test"],
];

/**
 * The check a Bash command runs, as `npm test`, `npm run test:unit`, `node --test`, `pytest`,
 * `cargo test` or `go test`; null for anything else. Only `a && b && check` chains count, because a
 * pipe, `;`, `||`, a background `&` or a subshell can report a status that is not the check's.
 */
export const normalizeCheck = (command) => {
  if (typeof command !== "string" || command.length > MAX_COMMAND) return null;
  const segments = command.replace(REDIRECTION, " ").split("&&").map((segment) => segment.trim());
  if (segments.some((segment) => !segment || UNSAFE_SHELL.test(segment))) return null;
  const last = segments.at(-1).replace(ENV_PREFIX, "");
  for (const [pattern, name] of CHECKS) {
    const match = pattern.exec(last);
    if (match) return name(match);
  }
  return null;
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const gitBytes = (cwd, args, input) => execFileSync("git", args, {
  cwd,
  input,
  timeout: GIT_TIMEOUT_MS,
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "ignore"],
});

const isDocRel = (rel) => {
  const path = String(rel).replaceAll("\\", "/");
  return /\.(?:md|txt)$/iu.test(path) || path.startsWith("docs/");
};

/**
 * sha256 of working-tree contents for tracked and untracked code files, ordered by path.
 * Null when this is not a git checkout, the listing is over CODE_FILE_CAP, or git fails.
 * Staging and committing do not change it: the hash is of file bytes, not of HEAD or the index.
 */
export const codeShaOf = (cwd) => {
  try {
    const inside = gitBytes(cwd, ["rev-parse", "--is-inside-work-tree"]).toString("utf8").trim();
    if (inside !== "true") return null;
    const listed = gitBytes(cwd, ["ls-files", "-co", "--exclude-standard", "-z"])
      .toString("utf8").split("\0").filter(Boolean);
    if (listed.length > CODE_FILE_CAP) return null;
    const paths = listed.filter((path) => !isDocRel(path) && !path.includes("\n")).filter((path) => {
      const stats = lstatSync(join(cwd, path), { throwIfNoEntry: false });
      return Boolean(stats && (stats.isFile() || stats.isSymbolicLink()));
    }).sort();
    if (paths.length > CODE_FILE_CAP) return null;
    const hash = createHash("sha256");
    if (paths.length > 0) {
      const blobs = gitBytes(cwd, ["hash-object", "--stdin-paths"], Buffer.from(`${paths.join("\n")}\n`))
        .toString("utf8").trim().split("\n");
      if (blobs.length !== paths.length || blobs.some((blob) => !/^[0-9a-f]{40}$/u.test(blob))) return null;
      for (let i = 0; i < paths.length; i += 1) hash.update(`${paths[i]}\0${blobs[i]}\n`);
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
};

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

// Index of the first unquoted `|` (not `||`) or `;`. `orOr` is an unquoted `||` before that split.
// `lastAndEnd` is the index just after the last unquoted `&&` before it, or -1. A bare `&` marks
// a background command. Quotes hide all three.
const findPipeOrSemi = (command) => {
  let quote = null;
  let escape = false;
  let background = false;
  let index = -1;
  let orOr = false;
  let lastAndEnd = -1;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (escape) { escape = false; continue; }
    if (quote === "'") { if (ch === "'") quote = null; continue; }
    if (quote === '"') {
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "\\") { escape = true; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "|" && command[i + 1] === "|") {
      if (index < 0) orOr = true;
      i += 1;
      continue;
    }
    if ((ch === "|" || ch === ";") && index < 0) index = i;
    if (ch === "&" && command[i + 1] === "&") {
      if (index < 0) lastAndEnd = i + 2;
      i += 1;
      continue;
    }
    if (ch === "&" && command[i - 1] !== ">" && command[i - 1] !== "<" && command[i - 1] !== "|") background = true;
  }
  return { index, background, orOr, lastAndEnd };
};

const sessionGated = (cwd, sessionId) => {
  const { frames, history } = readStack(cwd, sessionId);
  return [...frames, ...history].some((entry) => GATED_SKILLS.has(entry?.skill));
};

const shellWhitespace = (ch) => ch === " " || ch === "\t";

/**
 * The command with its check wrapped so the check's exit is written to `check-rc` and the group's
 * exit stays the check's. A check that is the whole prefix is wrapped as before. A check that is the
 * last part of a leading `&&` chain is wrapped alone; the earlier parts stay byte-identical. Null
 * when nothing should change.
 */
export const planCheckRewrite = ({ cwd, sessionId, command, runInBackground = false }) => {
  try {
    if (runInBackground === true) return null;
    if (typeof command !== "string" || command.length === 0 || command.length > MAX_COMMAND) return null;
    if (command.includes("pipefail")) return null;
    const split = findPipeOrSemi(command);
    if (split.index < 0 || split.background || split.orOr) return null;
    const prefix = command.slice(0, split.index);
    let head = "";
    let trailing = "";
    let checkSegment = prefix;
    if (split.lastAndEnd >= 0) {
      let start = split.lastAndEnd;
      while (start < split.index && shellWhitespace(command[start])) start += 1;
      let end = split.index;
      while (end > start && shellWhitespace(command[end - 1])) end -= 1;
      // An opening `&&` with nothing before it, or a blank last element, is not a chain to wrap.
      if (!/\S/u.test(command.slice(0, split.lastAndEnd - 2)) || start >= end) return null;
      head = command.slice(0, start);
      trailing = command.slice(end, split.index);
      checkSegment = command.slice(start, end);
    }
    if (normalizeCheck(checkSegment) === null) return null;
    if (!sessionGated(cwd, sessionId)) return null;
    const dir = sessionStateDir(cwd, sessionId);
    if (dir === null) return null;
    const rcPath = join(dir, CHECK_RC_FILE);
    if (lstatSync(rcPath, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
    // A short-circuited chain never writes a new exit. Drop a leftover file so it cannot be recorded.
    try {
      unlinkSync(rcPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const wrapped = `{ ${checkSegment}; __lit_rc=$?; printf '%s\\n' "$__lit_rc" > ${shellQuote(rcPath)}; (exit $__lit_rc); }`;
    return `${head}${wrapped}${trailing}${command.slice(split.index)}`;
  } catch {
    return null;
  }
};

const checkFromWrapped = (command) => {
  if (typeof command !== "string") return null;
  const at = command.indexOf(WRAP_MARK);
  if (at < 2) return null;
  if (command.startsWith("{ ")) return normalizeCheck(command.slice(2, at));
  const marker = command.lastIndexOf("&&", at);
  if (marker < 0) return null;
  const braced = /^\s*\{ ([\s\S]*)$/u.exec(command.slice(marker + 2, at));
  return braced ? normalizeCheck(braced[1]) : null;
};

// Reads and removes check-rc. A symlink is left in place and counts as no exit.
const takeCheckRc = (dir) => {
  const path = join(dir, CHECK_RC_FILE);
  let fd;
  try {
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const text = readFileSync(fd, "utf8");
    closeSync(fd);
    fd = undefined;
    unlinkSync(path);
    const match = /^([0-9]{1,3})\n?$/u.exec(text);
    return match ? Number(match[1]) : null;
  } catch {
    if (fd !== undefined) closeSync(fd);
    return null;
  }
};

/** sha256 of `git diff HEAD --binary` plus the untracked file list; null outside a git work tree. */
export const treeShaOf = (cwd) => {
  try {
    const git = (args) => execFileSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const diff = git(["diff", "HEAD", "--binary"]);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ":/"]);
    return createHash("sha256").update(diff).update("\0").update(untracked).digest("hex");
  } catch {
    return null;
  }
};

const appendLine = (path, record) => {
  const fd = openSync(path, STATE_APPEND_FLAG, 0o600);
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
};

/**
 * Appends one receipt for a check run seen by PostToolUse (`failed: false`) or PostToolUseFailure
 * (`failed: true`). A background or interrupted run, a non-check command or an unsafe session id writes
 * nothing.
 */
export const recordCheckRun = ({ cwd, sessionId, input, failed = false, now = new Date() }) => {
  if (input?.tool_name !== "Bash") return null;
  // A background run reaches PostToolUse when it starts, before any result exists.
  if (input.tool_input?.run_in_background === true || input.tool_response?.backgroundTaskId) return null;
  const command = input.tool_input?.command;
  const bare = normalizeCheck(command);
  const wrapped = bare === null ? checkFromWrapped(command) : null;
  const check = bare ?? wrapped;
  if (check === null) return null;
  const dir = sessionStateDir(cwd, sessionId);
  if (dir === null) return null;
  const rcExit = takeCheckRc(dir);
  // A wrapped check has no receipt until its own exit is on disk. The event status is the
  // pipeline's or the later command's, so it is not a substitute.
  if (wrapped !== null && rcExit === null) return null;
  let exit;
  let output;
  if (wrapped !== null) {
    exit = rcExit;
    if (failed) {
      if (input.is_interrupt === true) return null;
      output = typeof input.error === "string" ? input.error : "";
    } else {
      const response = input.tool_response ?? {};
      if (response.interrupted === true) return null;
      output = `${response.stdout ?? ""}\0${response.stderr ?? ""}`;
    }
  } else if (failed) {
    if (input.is_interrupt === true) return null;
    output = typeof input.error === "string" ? input.error : "";
    const hostLine = HOST_EXIT_LINE.exec(output);
    exit = hostLine ? Number(hostLine[1]) : null;
  } else {
    const response = input.tool_response ?? {};
    if (response.interrupted === true) return null;
    exit = 0;
    output = `${response.stdout ?? ""}\0${response.stderr ?? ""}`;
  }
  const receipt = { at: now.toISOString(), check, exit, outputSha256: sha256(String(output)), treeSha: treeShaOf(cwd), codeSha: codeShaOf(cwd) };
  appendLine(join(dir, RECEIPTS_FILE), receipt);
  return receipt;
};

const isDocPath = (root, path) => {
  const rel = relative(root, resolve(root, path)).replaceAll("\\", "/");
  return /\.(?:md|txt)$/iu.test(rel) || rel.startsWith("docs/");
};

/** Records `lastCodeEditAt` when an edit tool changed a path that is not `*.md`, `*.txt` or `docs/**`. */
export const recordCodeEdit = ({ cwd, sessionId, input, filePaths = [], now = new Date() }) => {
  if (!EDIT_TOOLS.has(input?.tool_name)) return false;
  const notebook = input.tool_input?.notebook_path;
  const paths = typeof notebook === "string" ? [...filePaths, notebook] : filePaths;
  const root = resolveProjectStateRoot(cwd);
  if (!paths.some((path) => typeof path === "string" && !isDocPath(root, path))) return false;
  const dir = sessionStateDir(cwd, sessionId);
  if (dir === null) return false;
  const existing = readEditsObject(dir);
  const next = { ...existing, lastCodeEditAt: now.toISOString() };
  writeEdits(dir, next);
  return true;
};

const readEditsObject = (dir) => {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, EDITS_FILE), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
};

const writeEdits = (dir, record) => {
  const path = join(dir, EDITS_FILE);
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(record)}\n`, { flag: STATE_WRITE_FLAG, mode: 0o600 });
  renameSync(staging, path);
};

/** Stores baselineCodeSha the first time a gated discipline activates, when the fingerprint exists. */
export const recordBaselineCodeSha = ({ cwd, sessionId, skill }) => {
  if (!GATED_SKILLS.has(skill)) return false;
  const dir = sessionStateDir(cwd, sessionId);
  if (dir === null) return false;
  const existing = readEditsObject(dir);
  if (typeof existing.baselineCodeSha === "string") return false;
  const codeSha = codeShaOf(cwd);
  if (typeof codeSha !== "string") return false;
  writeEdits(dir, { ...existing, baselineCodeSha: codeSha });
  return true;
};

/** The session's receipts (unparseable lines skipped) and its last code edit time (NaN when none). */
export const readReceiptState = (cwd, sessionId) => {
  const dir = sessionStatePath(cwd, sessionId);
  if (dir === null) return { receipts: [], lastCodeEditAt: Number.NaN, baselineCodeSha: null };
  const read = (name) => {
    try {
      return readFileSync(join(dir, name), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      throw error;
    }
  };
  const receipts = read(RECEIPTS_FILE).split("\n").flatMap((line) => {
    try {
      const record = JSON.parse(line);
      return record && typeof record === "object" ? [record] : [];
    } catch {
      return [];
    }
  });
  const edits = read(EDITS_FILE);
  const parsed = edits ? JSON.parse(edits) : null;
  return {
    receipts,
    lastCodeEditAt: parsed ? Date.parse(parsed.lastCodeEditAt) : Number.NaN,
    baselineCodeSha: typeof parsed?.baselineCodeSha === "string" ? parsed.baselineCodeSha : null,
  };
};
