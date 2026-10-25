import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { ignitionStatePath } from "./hud-ignition.mjs";

// Which disciplines a session's `lit` prompts already ignited, newest last. The prompt hook sends the
// full activation the first time a discipline starts in a session and a short note whenever it is
// asked for again, even after another discipline ran in between (a lit-loop resumed after a
// brainstorm), so the record is what the hook, not the model, says is loaded.
// It sits beside the per-session ignition record in the temp directory: the session id is the
// host's, nothing is written into the repository, and a missing or unreadable record only means
// the next `lit` gets the full activation again.

const DISCIPLINE_PATTERN = /^[a-z][a-z0-9-]{0,40}$/u;
const MAX_RECORD_BYTES = 4096;
const MAX_DISCIPLINES = 24;

// LITCLAUDE_ACTIVATION_STATE_ROOT moves only this record, so a test run can keep its records apart
// from the HUD's.
const recordPath = (sessionId, env) => {
  const ignition = ignitionStatePath(sessionId, env);
  const override = env.LITCLAUDE_ACTIVATION_STATE_ROOT?.trim();
  return (override ? join(override, basename(ignition)) : ignition).replace(/\.json$/u, ".activation.json");
};

const hasSession = (sessionId) => typeof sessionId === "string" && sessionId.trim().length > 0;

// The session's activated disciplines as `[name, at]` pairs, oldest first. A record from before the
// set existed (`{ discipline, at }`) reads as a set of one.
const readDisciplines = (sessionId, env) => {
  if (!hasSession(sessionId)) return [];
  try {
    const path = recordPath(sessionId, env);
    if (statSync(path).size > MAX_RECORD_BYTES) return [];
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (!record || typeof record !== "object" || record.sessionId !== sessionId) return [];
    const entries = record.disciplines && typeof record.disciplines === "object" ? Object.entries(record.disciplines) : [[record.discipline, record.at]];
    return entries.filter(([name, at]) => typeof name === "string" && DISCIPLINE_PATTERN.test(name) && typeof at === "string")
      .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
  } catch {
    return [];
  }
};

/** The discipline the hook activated most recently in this session. */
export const readActivation = (sessionId, env = process.env) => readDisciplines(sessionId, env).at(-1)?.[0] ?? null;

/** Whether the hook already sent this discipline's full activation in this session. */
export const hasActivated = (sessionId, discipline, env = process.env) => readDisciplines(sessionId, env).some(([name]) => name === discipline);

export const recordActivation = (sessionId, discipline, env = process.env, now = () => new Date()) => {
  if (!hasSession(sessionId) || !DISCIPLINE_PATTERN.test(discipline ?? "")) return false;
  try {
    const path = recordPath(sessionId, env);
    mkdirSync(dirname(path), { recursive: true });
    const kept = readDisciplines(sessionId, env).filter(([name]) => name !== discipline).slice(-(MAX_DISCIPLINES - 1));
    const disciplines = Object.fromEntries([...kept, [discipline, now().toISOString()]]);
    const staging = `${path}.${process.pid}.tmp`;
    writeFileSync(staging, `${JSON.stringify({ sessionId, disciplines })}\n`);
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
