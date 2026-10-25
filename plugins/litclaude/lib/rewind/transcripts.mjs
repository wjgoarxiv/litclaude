// Claude Code session transcripts for the lit-adhd collector. Claude stores one JSONL file per
// session under `<config>/projects/<slug>/`, where the slug is the session's absolute cwd with every
// character outside [A-Za-z0-9] turned into `-`. Files reach tens of thousands of lines, so each is
// read as its head and tail only, under a budget shared by the whole run, through a descriptor
// opened without following links. Subagent transcripts (in subfolders, or lines marked
// `isSidechain`) are not sessions of their own and are skipped.

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export const HEAD_BYTES = 64 * 1024;
export const TAIL_BYTES = 256 * 1024;
export const TOTAL_BUDGET_BYTES = 8 * 1024 * 1024;
const FALLBACK_DIR_LIMIT = 200;
const FALLBACK_PEEK_BYTES = 4 * 1024;
const ACTIVE_MS = 15 * 60 * 1000;

export const projectSlug = (path) => String(path).replace(/[^A-Za-z0-9]/gu, "-");

/** A byte budget shared by every read of one collector run. */
export const makeBudget = (limit = TOTAL_BUDGET_BYTES) => ({ limit, used: 0, exhausted: false });

const readSlice = (fd, position, length, budget) => {
  const allowed = Math.min(length, budget.limit - budget.used);
  if (allowed <= 0) {
    budget.exhausted = true;
    return "";
  }
  const buffer = Buffer.alloc(allowed);
  const read = readSync(fd, buffer, 0, allowed, position);
  budget.used += read;
  if (allowed < length) budget.exhausted = true;
  return buffer.subarray(0, read).toString("utf8");
};

/** The parsed lines of a transcript's head and tail; a link or a non-file reads as null. */
export const readTranscriptLines = (path, budget, { head = HEAD_BYTES, tail = TAIL_BYTES } = {}) => {
  let fd;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const { size } = fstatSync(fd);
    const chunks = size <= head + tail
      ? [readSlice(fd, 0, size, budget)]
      : [readSlice(fd, 0, head, budget), readSlice(fd, size - tail, tail, budget)];
    const lines = [];
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === "object") lines.push(parsed);
        } catch {
          // A line cut at a slice edge, or a malformed one, is skipped.
        }
      }
    }
    return lines;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const topLevelTranscripts = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
};

const newestFirst = (paths) => paths
  .map((path) => {
    try {
      return { path, mtimeMs: lstatSync(path).mtimeMs };
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

const peekCwd = (path) => {
  let fd;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const buffer = Buffer.alloc(FALLBACK_PEEK_BYTES);
    const read = readSync(fd, buffer, 0, FALLBACK_PEEK_BYTES, 0);
    for (const line of buffer.subarray(0, read).toString("utf8").split("\n")) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed?.cwd === "string") return parsed.cwd;
      } catch {
        // Partial or malformed line.
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/**
 * The transcript files of every given worktree path, newest first, and whether the projects folder
 * was there at all. A path whose slug folder is missing is looked for among at most 200 project
 * folders by the `cwd` in the first 4 KiB of each folder's newest file.
 */
export const findTranscripts = (configDir, paths) => {
  const projects = join(configDir, "projects");
  try {
    if (!lstatSync(projects).isDirectory()) return { status: "unknown", files: [] };
  } catch {
    return { status: "unknown", files: [] };
  }
  const files = new Set();
  const missing = [];
  for (const path of paths) {
    const found = topLevelTranscripts(join(projects, projectSlug(path)));
    if (found.length) found.forEach((file) => files.add(file));
    else missing.push(path);
  }
  if (missing.length) {
    let folders = [];
    try {
      folders = readdirSync(projects, { withFileTypes: true }).filter((entry) => entry.isDirectory()).slice(0, FALLBACK_DIR_LIMIT);
    } catch {
      folders = [];
    }
    for (const folder of folders) {
      const transcripts = topLevelTranscripts(join(projects, folder.name));
      const newest = newestFirst(transcripts)[0];
      const cwd = newest ? peekCwd(newest.path) : null;
      if (cwd && missing.some((path) => path.normalize("NFC") === cwd.normalize("NFC"))) transcripts.forEach((file) => files.add(file));
    }
  }
  return { status: "ok", files: newestFirst([...files]).map(({ path }) => path) };
};

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
};
const isToolResult = (content) => Array.isArray(content) && content.some((part) => part?.type === "tool_result");
const clip = (text, max) => {
  const flat = String(text).replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
// A typed slash command is stored as `<command-name>` and `<command-args>` tags; it reads as the
// command line the user typed. A namespaced command always counts, a built-in only with arguments.
const slashPrompt = (text) => {
  if (!/^<command-(?:message|name)>/u.test(text)) return text;
  const name = /<command-name>([^<]{1,120})<\/command-name>/u.exec(text)?.[1]?.trim();
  const args = /<command-args>([^<]{0,2000})<\/command-args>/u.exec(text)?.[1]?.trim() ?? "";
  if (!name || (!name.includes(":") && !args)) return text;
  return args ? `${name} ${args}` : name;
};
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const WAITING_TEXT = /[?？]\s*$|`?lit approve`?|`?lit deny`?|승인해\s*주|확인해\s*주|괜찮을까요|할까요/iu;

/**
 * One session's record from its transcript lines: what it was asked, what it did, what it said last,
 * and where it stands. `redact` runs over every text field it returns.
 */
export const sessionRecord = (lines, { redact = (text) => text, now = Date.now() } = {}) => {
  const main = lines.filter((line) => line.isSidechain !== true);
  const sessionId = main.find((line) => typeof line.sessionId === "string")?.sessionId ?? null;
  if (!sessionId) return null;
  let customTitle = null;
  let aiTitle = null;
  let cwd = null;
  let branch = null;
  let started = null;
  let last = null;
  let lastEntry = null;
  const prompts = [];
  const tools = {};
  const files = [];
  let result = null;
  for (const line of main) {
    if (line.type === "custom-title" && typeof line.customTitle === "string") customTitle = line.customTitle;
    if (line.type === "ai-title" && typeof line.aiTitle === "string") aiTitle = line.aiTitle;
    if (typeof line.cwd === "string") cwd ??= line.cwd;
    if (typeof line.gitBranch === "string" && line.gitBranch) branch = line.gitBranch;
    const at = Date.parse(line.timestamp);
    if (Number.isFinite(at)) {
      started = started === null ? at : Math.min(started, at);
      last = last === null ? at : Math.max(last, at);
    }
    if (line.type === "user" && line.isMeta !== true && line.isCompactSummary !== true && !isToolResult(line.message?.content)) {
      const text = slashPrompt(textOf(line.message?.content).trim());
      if (text && !/^<(?:command-|local-command|system-reminder|task-notification)/u.test(text)) {
        prompts.push(text);
        lastEntry = { role: "user", text };
      }
    }
    if (line.type === "assistant" && Array.isArray(line.message?.content)) {
      for (const part of line.message.content) {
        if (part?.type === "tool_use" && typeof part.name === "string") {
          tools[part.name] = (tools[part.name] ?? 0) + 1;
          const path = part.input?.file_path ?? part.input?.notebook_path;
          if (FILE_TOOLS.has(part.name) && typeof path === "string") files.push(path);
          lastEntry = { role: "tool" };
        }
      }
      const text = textOf(line.message.content).trim();
      if (text) {
        result = text;
        lastEntry = { role: "assistant", text };
      }
    }
  }
  const relativeFile = (path) => {
    const inside = cwd ? relative(cwd, path) : path;
    return inside && !inside.startsWith("..") ? inside : path;
  };
  const changed = [...new Set(files.reverse())].slice(0, 5).map((path) => redact(relativeFile(path)));
  const asked = [...new Set([prompts[0], prompts.at(-1)].filter(Boolean))].slice(0, 2).map((text) => redact(clip(text, 160)));
  const waiting = lastEntry?.role === "assistant" && WAITING_TEXT.test(lastEntry.text.slice(-400));
  const status = last === null ? "unknown" : waiting ? "waiting-on-user" : now - last < ACTIVE_MS ? "active" : "ended";
  return {
    sessionId,
    id8: sessionId.slice(0, 8),
    worktree: cwd ? redact(cwd) : "unknown",
    cwd,
    branch: branch ?? "unknown",
    started: started === null ? "unknown" : new Date(started).toISOString(),
    last: last === null ? "unknown" : new Date(last).toISOString(),
    lastMs: last,
    title: redact(clip(customTitle ?? aiTitle ?? prompts[0] ?? "unknown", 80)),
    asked: asked.length ? asked : ["unknown"],
    done: { tools, files: changed, commits: [] },
    result: result ? redact(clip(result, 240)) : "unknown",
    status,
    ...(waiting ? { waitingReason: "asked the user" } : {}),
  };
};
