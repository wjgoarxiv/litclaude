import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { ignitionStatePath } from "./hud-ignition.mjs";

// Which discipline a session's `lit` prompts already ignited. The prompt hook sends the full
// activation the first time a discipline starts in a session and a short note when the same
// discipline is asked for again, so the record is what the hook, not the model, says is active.
// It sits beside the per-session ignition record in the temp directory: the session id is the
// host's, nothing is written into the repository, and a missing or unreadable record only means
// the next `lit` gets the full activation again.

const DISCIPLINE_PATTERN = /^[a-z][a-z0-9-]{0,40}$/u;
const MAX_RECORD_BYTES = 4096;

// LITCLAUDE_ACTIVATION_STATE_ROOT moves only this record, so a test run can keep its records apart
// from the HUD's.
const recordPath = (sessionId, env) => {
  const ignition = ignitionStatePath(sessionId, env);
  const override = env.LITCLAUDE_ACTIVATION_STATE_ROOT?.trim();
  return (override ? join(override, basename(ignition)) : ignition).replace(/\.json$/u, ".activation.json");
};

const hasSession = (sessionId) => typeof sessionId === "string" && sessionId.trim().length > 0;

export const readActivation = (sessionId, env = process.env) => {
  if (!hasSession(sessionId)) return null;
  try {
    const path = recordPath(sessionId, env);
    if (statSync(path).size > MAX_RECORD_BYTES) return null;
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (!record || typeof record !== "object" || record.sessionId !== sessionId) return null;
    return typeof record.discipline === "string" && DISCIPLINE_PATTERN.test(record.discipline) ? record.discipline : null;
  } catch {
    return null;
  }
};

export const recordActivation = (sessionId, discipline, env = process.env, now = () => new Date()) => {
  if (!hasSession(sessionId) || !DISCIPLINE_PATTERN.test(discipline ?? "")) return false;
  try {
    const path = recordPath(sessionId, env);
    mkdirSync(dirname(path), { recursive: true });
    const staging = `${path}.${process.pid}.tmp`;
    writeFileSync(staging, `${JSON.stringify({ sessionId, discipline, at: now().toISOString() })}\n`);
    renameSync(staging, path);
    return true;
  } catch {
    return false;
  }
};

export const clearActivation = (sessionId, env = process.env) => {
  if (!hasSession(sessionId)) return;
  try {
    rmSync(recordPath(sessionId, env), { force: true });
  } catch {
    // A record that cannot be removed only makes the next lit repeat itself.
  }
};
