// An append-only record of what LitClaude already told the user and how each run ended, kept at
// `<project state root>/.litclaude/shown/ledger.jsonl`, one JSON object per line:
//   {"kind":"notice","id":"adhd","hash":"<16 hex>","at":<ms>}      text LitClaude printed itself
//   {"kind":"run-end","source":"start-work","id":"<work id>","outcome":"sent|nothing|waiting","at":<ms>}
// A notice is stored as a hash of its whitespace-normalised text, never the text. Only text LitClaude
// emits itself is covered; model prose is not intercepted. The record is advisory: a missing, corrupt or
// symlinked ledger reads as empty (today's behaviour: the notice is shown), and a write that fails
// changes nothing for the caller. A symlinked `.litclaude` or `shown` folder is never followed.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

import { prepareStateDir, PROJECT_STATE_DIR, STATE_APPEND_FLAG } from "./project-state-root.mjs";

export const RUN_END_OUTCOMES = Object.freeze(["sent", "nothing", "waiting"]);
const LEDGER_DIR = "shown";
const LEDGER_FILE = "ledger.jsonl";
// Only the newest part is read, so a long-lived ledger never slows a hook down.
const READ_TAIL_BYTES = 256 * 1024;
const ANSI = /\x1b\[[0-9;]*m/gu;

export const noticeHash = (text) => createHash("sha256")
  .update(String(text).replace(ANSI, "").replace(/\s+/gu, " ").trim())
  .digest("hex")
  .slice(0, 16);

const ledgerPath = (stateRoot) => join(stateRoot, PROJECT_STATE_DIR, LEDGER_DIR, LEDGER_FILE);

const readRows = (stateRoot) => {
  let fd;
  try {
    for (const folder of [join(stateRoot, PROJECT_STATE_DIR), join(stateRoot, PROJECT_STATE_DIR, LEDGER_DIR)]) {
      const stat = lstatSync(folder);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
    }
    const path = ledgerPath(stateRoot);
    if (lstatSync(path).isSymbolicLink()) return [];
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size === 0) return [];
    const length = Math.min(opened.size, READ_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, opened.size - length);
    const lines = buffer.toString("utf8").split("\n");
    if (opened.size > length) lines.shift();
    const rows = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row !== null && typeof row === "object" && Number.isFinite(row.at)) rows.push(row);
      } catch {
        // A damaged line is skipped, not fatal.
      }
    }
    return rows;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const append = (stateRoot, row) => {
  let fd;
  try {
    if (!prepareStateDir(join(stateRoot, PROJECT_STATE_DIR, LEDGER_DIR))) return false;
    fd = openSync(ledgerPath(stateRoot), STATE_APPEND_FLAG, 0o600);
    // The leading newline keeps a row apart from a damaged last line that has no newline of its own.
    writeSync(fd, `\n${JSON.stringify(row)}\n`);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/** Whether this text was already recorded as shown, optionally only within the last `ttlMs`. */
export const wasShown = ({ stateRoot, text, now = Date.now(), ttlMs = Number.POSITIVE_INFINITY }) => {
  const hash = noticeHash(text);
  return readRows(stateRoot).some((row) => row.kind === "notice" && row.hash === hash && now - row.at <= ttlMs);
};

/** Records that LitClaude printed this text. Returns false when the record could not be written. */
export const recordShown = ({ stateRoot, id, text, now = Date.now() }) =>
  append(stateRoot, { kind: "notice", id, hash: noticeHash(text), at: now });

/** The newest run-end row, or null. */
export const lastRunEnd = (stateRoot) => readRows(stateRoot).filter((row) => row.kind === "run-end").at(-1) ?? null;

/** Records how a run ended, once per (source, id, outcome). Returns true when a row was written. */
export const recordRunEnd = ({ stateRoot, source, id, outcome, now = Date.now() }) => {
  try {
    if (!RUN_END_OUTCOMES.includes(outcome) || typeof source !== "string" || typeof id !== "string") return false;
    const seen = readRows(stateRoot).some((row) => row.kind === "run-end" && row.source === source && row.id === id && row.outcome === outcome);
    return seen ? false : append(stateRoot, { kind: "run-end", source, id, outcome, at: now });
  } catch {
    return false;
  }
};
