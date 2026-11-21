// The session's receipt ledger: which checks ran and when code last changed, written from what the
// PostToolUse hooks already see. Claude Code 2.1.330 gives a Bash call no exit field: a call that
// exits 0 reaches PostToolUse, a non-zero exit reaches PostToolUseFailure, whose `error` starts with
// the host's own `Exit code <n>` line. The event is the pass/fail signal; the number comes from that
// anchored host line only, never from the command's output. A receipt keeps the check's name (the
// command and its script, no arguments), the exit, and hashes; never a prompt, argument or output.
//   sessions/<sid>/receipts.jsonl  {at, check, exit, outputSha256, treeSha}, one line per check run
//   sessions/<sid>/edits.json      {lastCodeEditAt} from Write, Edit, MultiEdit, NotebookEdit
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { resolveProjectStateRoot, STATE_APPEND_FLAG, STATE_WRITE_FLAG } from "./project-state-root.mjs";
import { sessionStateDir, sessionStatePath } from "./session-state.mjs";

export const RECEIPTS_FILE = "receipts.jsonl";
export const EDITS_FILE = "edits.json";
const MAX_COMMAND = 4096;
const GIT_TIMEOUT_MS = 4000;
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
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
  const check = normalizeCheck(input.tool_input?.command);
  if (check === null) return null;
  let exit;
  let output;
  if (failed) {
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
  const dir = sessionStateDir(cwd, sessionId);
  if (dir === null) return null;
  const receipt = { at: now.toISOString(), check, exit, outputSha256: sha256(String(output)), treeSha: treeShaOf(cwd) };
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
  const path = join(dir, EDITS_FILE);
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify({ lastCodeEditAt: now.toISOString() })}\n`, { flag: STATE_WRITE_FLAG, mode: 0o600 });
  renameSync(staging, path);
  return true;
};

/** The session's receipts (unparseable lines skipped) and its last code edit time (NaN when none). */
export const readReceiptState = (cwd, sessionId) => {
  const dir = sessionStatePath(cwd, sessionId);
  if (dir === null) return { receipts: [], lastCodeEditAt: Number.NaN };
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
  return { receipts, lastCodeEditAt: edits ? Date.parse(JSON.parse(edits)?.lastCodeEditAt) : Number.NaN };
};
