// Stop receipt gate. A session that ran lit-loop, litwork or start-work and changed code should end
// with a passing check of that code (the receipts in lib/receipts.mjs). A code change is an edit-tool
// timestamp or a code fingerprint that differs from the one taken when the discipline started. When
// the fingerprint is available, the passing receipt's codeSha must match the tree at stop; otherwise
// the receipt has to be newer than the edit. `receiptGate` in
// LitClaude's config.json picks what happens when it does not: `off`; `shadow` (the default) warns in
// a systemMessage and logs a line to `sessions/<sid>/receipt-gate.jsonl`; `enforce` blocks the stop
// naming the check, at most RECEIPT_GATE_MAX_BLOCKS times per prompt_id, then ends the session with
// `continue: false`. A Stop the host re-entered (`stop_hook_active`) is never blocked. Doc-only
// sessions and projects with no check stay silent, and any unreadable state lets the stop through:
// the caller wraps this in a catch, and a block is logged before it is returned.
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import { markLitHome, readLitConfigKey, writeLitConfigKey } from "./mark.mjs";
import { STATE_APPEND_FLAG, resolveProjectStateRoot } from "./project-state-root.mjs";
import { codeShaOf, readReceiptState } from "./receipts.mjs";
import { sessionStateDir } from "./session-state.mjs";
import { readStack } from "./workflow-stack.mjs";

export const RECEIPT_GATE_MODES = Object.freeze(["off", "shadow", "enforce"]);
export const RECEIPT_GATE_MAX_BLOCKS = 2;
export const RECEIPT_GATE_LOG = "receipt-gate.jsonl";
const ACTIVATING_SKILLS = new Set(["lit-loop", "litwork", "start-work"]);

export const readReceiptGateMode = ({ env = process.env, litHome = markLitHome(env) } = {}) => {
  const stored = readLitConfigKey(litHome, "receiptGate");
  return RECEIPT_GATE_MODES.includes(stored) ? stored : "shadow";
};

export const writeReceiptGateMode = (litHome, mode) => {
  if (!RECEIPT_GATE_MODES.includes(mode)) throw new Error(`receiptGate takes one of: ${RECEIPT_GATE_MODES.join(", ")}`);
  return writeLitConfigKey(litHome, "receiptGate", mode);
};

const sessionActivated = (cwd, sessionId) => {
  const { frames, history } = readStack(cwd, sessionId);
  return [...frames, ...history].some((entry) => ACTIVATING_SKILLS.has(entry?.skill));
};

const readGateLog = (dir) => {
  try {
    return readFileSync(join(dir, RECEIPT_GATE_LOG), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

const logDecision = (dir, record) => {
  const fd = openSync(join(dir, RECEIPT_GATE_LOG), STATE_APPEND_FLAG, 0o600);
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
};

/**
 * `{ action: "none" }`, `{ action: "warn", systemMessage }`, `{ action: "block", reason }` or
 * `{ action: "stop", stopReason }` for one Stop. `detectCheck` names the project's check.
 */
export const evaluateReceiptGate = ({ cwd, input, mode, detectCheck, now = new Date() }) => {
  const none = { action: "none" };
  const sessionId = input?.session_id;
  if (mode === "off" || !RECEIPT_GATE_MODES.includes(mode)) return none;
  if (mode === "enforce" && input?.stop_hook_active === true) return none;
  if (!sessionActivated(cwd, sessionId)) return none;
  const { receipts, lastCodeEditAt, baselineCodeSha } = readReceiptState(cwd, sessionId);
  let currentCodeSha = null;
  try {
    currentCodeSha = codeShaOf(cwd);
  } catch {
    currentCodeSha = null;
  }
  const fingerprint = typeof currentCodeSha === "string" && typeof baselineCodeSha === "string";
  const edited = Number.isFinite(lastCodeEditAt);
  const drifted = fingerprint && currentCodeSha !== baselineCodeSha;
  if (!edited && !drifted) return none;
  const passed = fingerprint
    ? receipts.some((receipt) => receipt.exit === 0 && receipt.codeSha === currentCodeSha)
    : edited && receipts.some((receipt) => receipt.exit === 0 && Date.parse(receipt.at) > lastCodeEditAt);
  if (passed) return none;
  const check = detectCheck(cwd) ?? detectCheck(resolveProjectStateRoot(cwd)) ?? receipts.findLast((receipt) => typeof receipt.check === "string")?.check ?? null;
  if (check === null) return none;
  const dir = sessionStateDir(cwd, sessionId);
  if (dir === null) return none;
  const promptId = typeof input.prompt_id === "string" ? input.prompt_id : null;
  const at = now.toISOString();
  if (mode === "shadow") {
    logDecision(dir, { at, mode, action: "warn", check, promptId });
    return { action: "warn", systemMessage: `LitClaude: code changed after the last passing ${check} run; no passing check since.` };
  }
  const blocks = readGateLog(dir).filter((entry) => entry.action === "block" && entry.promptId === promptId).length;
  if (blocks < RECEIPT_GATE_MAX_BLOCKS) {
    logDecision(dir, { at, mode, action: "block", check, promptId });
    return { action: "block", reason: `LitClaude receipt gate: code changed after the last passing check. Run \`${check}\` on its own and fix what fails before finishing.` };
  }
  logDecision(dir, { at, mode, action: "stop", check, promptId });
  return { action: "stop", stopReason: `LitClaude: stopped after ${RECEIPT_GATE_MAX_BLOCKS} reminders; code changed and \`${check}\` has not passed since.` };
};
