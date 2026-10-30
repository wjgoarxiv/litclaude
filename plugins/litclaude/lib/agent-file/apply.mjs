// The LitFamily block on disk: the global `CLAUDE.md` that Claude Code reads every session, and a
// project's `AGENTS.md`. Writes are atomic (temporary file, then rename) and keep the file's mode; a
// symlinked, non-regular or non-UTF-8 file is refused rather than rewritten; a file system error comes
// back as `refused-io` instead of stopping the installer. The user's original global file is copied
// once, the first time a block goes in. The on/off setting is `agentFile` in LitClaude's own
// config.json; LITCLAUDE_AGENT_FILE overrides it.

import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLitConfigKey, writeLitConfigKey } from "../mark.mjs";
import { ATTRIBUTION_LINE } from "./attribution.mjs";
import { inspectBlock, ManagedBlockError, removeBlock, upsertBlock } from "./managed-block.mjs";

export const AGENT_FILE_ID = "litclaude";
export const AGENT_FILE_MODES = Object.freeze(["on", "off"]);
// The global block is read on every turn of every session, so it stays small.
export const AGENT_FILE_MAX_BYTES = 1200;

const here = dirname(fileURLToPath(import.meta.url));
const BODIES = { global: "block.md", project: "project-block.md" };

/**
 * The shipped block text: `global` for CLAUDE.md, `project` for a repo's AGENTS.md. With attribution
 * `off` it carries the no-attribution line, before the global block's closing off-switch line.
 */
export const agentFileBody = (kind = "global", { attribution = "keep" } = {}) => {
  const body = readFileSync(join(here, BODIES[kind]), "utf8");
  if (attribution !== "off") return body;
  const offSwitch = body.indexOf("\n- Turn this block off");
  return offSwitch === -1
    ? `${body.replace(/\n*$/u, "\n")}${ATTRIBUTION_LINE}\n`
    : `${body.slice(0, offSwitch + 1)}${ATTRIBUTION_LINE}\n${body.slice(offSwitch + 1)}`;
};

export const readAgentFileMode = ({ env = process.env, litHome }) => {
  const override = String(env.LITCLAUDE_AGENT_FILE ?? "").trim().toLowerCase();
  if (AGENT_FILE_MODES.includes(override)) return override;
  const stored = readLitConfigKey(litHome, "agentFile");
  return AGENT_FILE_MODES.includes(stored) ? stored : "on";
};

export const writeAgentFileMode = (litHome, mode) => {
  if (!AGENT_FILE_MODES.includes(mode)) throw new Error(`agentFile takes one of: ${AGENT_FILE_MODES.join(", ")}`);
  return writeLitConfigKey(litHome, "agentFile", mode);
};

// "missing", "file", "symlink" or "other", without following a link.
const entryKind = (path) => {
  try {
    const stats = lstatSync(path);
    return stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
};

// The file's text, or null when it is not UTF-8 (a UTF-16 file from Notepad, Latin-1): rewriting
// those would corrupt the user's bytes outside the markers.
const readUtf8 = (path) => {
  const bytes = readFileSync(path);
  if (bytes.includes(0) || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
};

// A unique staging name, so a leftover from a crashed run never blocks the next one, removed on failure.
const writeAtomic = (path, text, { createParent }) => {
  if (createParent) mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.litfamily-${randomUUID()}.tmp`;
  let mode = null;
  try {
    mode = statSync(path).mode & 0o7777;
  } catch {
    // A new file takes the default mode.
  }
  try {
    writeFileSync(staging, text, { flag: "wx" });
    if (mode !== null) chmodSync(staging, mode);
    renameSync(staging, path);
  } finally {
    try {
      unlinkSync(staging);
    } catch {
      // Renamed into place, or never written.
    }
  }
};

/**
 * Installs or removes block `id` in `path`. Returns `{status, path, backup?, preview?}` with status
 * created | updated | unchanged | removed | absent | dry-run | refused-symlink | refused-not-file |
 * refused-not-utf8 | refused-malformed | refused-io. `backup: false` skips the first-insert copy (a
 * repo's AGENTS.md, where a copy would sit beside tracked files); `createParent: false` never makes
 * the folder.
 */
export const applyAgentFile = ({ path, id = AGENT_FILE_ID, version, body, action, dryRun = false, now = new Date(), backup = true, createParent = true }) => {
  try {
    const kind = entryKind(path);
    if (kind === "symlink") return { status: "refused-symlink", path };
    if (kind === "other") return { status: "refused-not-file", path };
    const text = kind === "file" ? readUtf8(path) : "";
    if (text === null) return { status: "refused-not-utf8", path };
    let next;
    try {
      next = action === "uninstall" ? removeBlock(text, id) : upsertBlock(text, { id, version, body }, { created: kind === "missing" });
    } catch (error) {
      if (error instanceof ManagedBlockError) return { status: "refused-malformed", path };
      throw error;
    }
    if (!next.changed) return { status: action === "uninstall" ? "absent" : "unchanged", path };
    if (dryRun) return { status: "dry-run", path, preview: next.text };
    if (action === "uninstall") {
      if (next.text === "" && next.created) unlinkSync(path);
      else writeAtomic(path, next.text, { createParent: false });
      return { status: "removed", path };
    }
    let copy;
    if (backup && kind === "file" && inspectBlock(text, id).state === "absent") {
      copy = `${path}.litfamily-backup-${now.toISOString().replace(/[:.]/gu, "-")}`;
      copyFileSync(path, copy);
    }
    writeAtomic(path, next.text, { createParent });
    return { status: kind === "file" ? "updated" : "created", path, ...(copy ? { backup: copy } : {}) };
  } catch (error) {
    return { status: "refused-io", path, error: error?.code ?? error?.message };
  }
};

/**
 * `present v=<x>` (current), `stale v=<x>` (an older install's block), `absent`, `malformed`, or
 * `symlink` / `not-file` / `not-utf8` for a file LitClaude will not write.
 */
export const agentFileState = ({ path, id = AGENT_FILE_ID, version }) => {
  const kind = entryKind(path);
  if (kind === "missing") return "absent";
  if (kind === "symlink") return "symlink";
  if (kind === "other") return "not-file";
  const text = readUtf8(path);
  if (text === null) return "not-utf8";
  const found = inspectBlock(text, id);
  if (found.state !== "present") return found.state;
  return `${found.version === version ? "present" : "stale"} v=${found.version}`;
};
