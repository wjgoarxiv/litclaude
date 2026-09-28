import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Per-session ignition record: the prompt hook writes it on every UserPromptSubmit and the HUD
// status line reads it back, so the status bar reflects the discipline actually selected for
// the current turn instead of anything the model chooses to draw. Mode is per turn and never
// durable, so the record lives in the per-user temp directory: not in the repository state
// root (activation must stay side-effect-free there) and not in the home directory.

const IGNITION_PALETTE = Object.freeze({
  truecolor: "\x1b[38;2;255;99;55m",
  "256": "\x1b[38;5;203m",
  "16": "\x1b[91m",
});

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

export function readIgnitionState(sessionId, env = process.env) {
  const target = ignitionStatePath(sessionId, env);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return {
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      discipline: typeof parsed.discipline === "string" && parsed.discipline ? parsed.discipline : null,
      at: typeof parsed.at === "string" ? parsed.at : null,
    };
  } catch {
    return null;
  }
}

export function renderIgnitionSegment(state, { depth = "plain" } = {}) {
  const discipline = state?.discipline ?? null;
  if (!discipline) return "";
  const label = ignitionMark(discipline);
  if (depth === "plain") return label;
  const paint = IGNITION_PALETTE[depth] ?? IGNITION_PALETTE["256"];
  return `\x1b[1m${paint}${label}\x1b[0m`;
}
