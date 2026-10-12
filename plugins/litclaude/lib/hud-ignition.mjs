import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Per-session ignition record: the prompt hook writes it on every UserPromptSubmit and the LIT
// card (hooks/lit-mod.mjs, through lib/mod/state.mjs) reads it back, so the card reflects the
// discipline actually selected for the current turn instead of anything the model chooses to
// draw. Mode is per turn and never durable, so the record lives in the per-user temp directory:
// not in the repository state root (activation must stay side-effect-free there) and not in the
// home directory.

export const ignitionStateRoot = (env = process.env) => {
  const override = env.LITCLAUDE_HUD_STATE_ROOT?.trim();
  if (override) return override;
  const tmp = env.TMPDIR?.trim() || tmpdir();
  return join(tmp, "litclaude-hud");
};

const safeSessionFile = (sessionId) => {
  const raw = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "unknown-session";
  return `${raw.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_")}.json`;
};

export const ignitionStatePath = (sessionId, env = process.env) => join(ignitionStateRoot(env), safeSessionFile(sessionId));

export function ignitionMark(discipline, { markdown = false } = {}) {
  const label = `LIT IGNITED · ${discipline}`;
  return markdown ? `🔥 **${label}** 🔥` : `🔥 ${label} 🔥`;
}

export function writeIgnitionState({ sessionId, discipline }, env = process.env, now = () => new Date()) {
  const root = ignitionStateRoot(env);
  mkdirSync(root, { recursive: true });
  const target = ignitionStatePath(sessionId, env);
  const record = {
    sessionId: typeof sessionId === "string" ? sessionId : null,
    discipline: typeof discipline === "string" && discipline ? discipline : null,
    at: now().toISOString(),
  };
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(record)}\n`);
  renameSync(staging, target);
  return record;
}
