// The ping when start-work parks a step: one terminal notification (OSC 9, or OSC 777 for
// terminals that only read that one) that names what waits and the words to type. Claude Code writes
// a hook's `terminalSequence` to the terminal on the hook's behalf, in an interactive session only.
// It is on (OSC 9) unless the plugin option `park_ping` (env CLAUDE_PLUGIN_OPTION_PARK_PING) is `off`;
// `osc777` picks the other sequence. Each parked step is pinged once: the shown-ledger records its id before the sequence is
// returned, and a step whose record cannot be written is not pinged at all, so a retry never pings.
// The ping only informs; it approves nothing.
import { recordShown, wasShown } from "./shown-ledger.mjs";

export const PARK_PING_ENV = "CLAUDE_PLUGIN_OPTION_PARK_PING";
const NAMED_STEPS = 2;
const ROOT_CHARS = 80;

/** "osc9" (the default), "osc777" or null (off). */
export const parkPingMode = (env = process.env) => {
  const value = String(env[PARK_PING_ENV] ?? "").trim().toLowerCase();
  if (value === "off" || value === "no" || value === "0" || value === "false") return null;
  if (value === "osc777") return "osc777";
  return "osc9";
};

// Escape bytes, BEL and other control characters would end or forge the sequence; they become spaces.
const plain = (text, limit) => {
  const flat = String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `…${flat.slice(-(limit - 1))}` : flat;
};

/** The notification text. It starts with a letter: the host rejects an OSC 9 body that starts with a digit. */
export const parkPingText = (steps) => {
  const named = steps.slice(0, NAMED_STEPS).map(({ action, root, command }) => (command ? `${plain(command, ROOT_CHARS)}` : `${plain(action, 12)} ${plain(root, ROOT_CHARS)}`)).join("; ");
  const more = steps.length > NAMED_STEPS ? ` (+${steps.length - NAMED_STEPS} more)` : "";
  const noun = steps.length === 1 ? "step waits" : "steps wait";
  return `LitClaude start-work: a parked ${noun} on you: ${named}${more}. The run goes on; answer when it wraps up with lit approve, lit deny or lit skip-row.`;
};

export const parkPingSequence = (mode, text) => (mode === "osc777"
  ? `\u001b]777;notify;LitClaude;${text}\u0007`
  : `\u001b]9;${text}\u0007`);

const pingKey = (workId, boundaryId) => `park-ping ${workId} ${boundaryId}`;

/**
 * Claims the ping for the given parked steps of one work. Returns the terminal sequence to emit, or null
 * when the option is off, every step was already pinged, or no record could be written.
 */
export const claimParkPing = ({ stateRoot, workId, steps, env = process.env, now = Date.now() }) => {
  try {
    const mode = parkPingMode(env);
    if (!mode || typeof workId !== "string" || !Array.isArray(steps)) return null;
    const fresh = steps.filter((step) => typeof step?.boundaryId === "string"
      && !wasShown({ stateRoot, text: pingKey(workId, step.boundaryId), now }));
    const claimed = fresh.filter((step) => recordShown({ stateRoot, id: "park-ping", text: pingKey(workId, step.boundaryId), now }));
    return claimed.length ? parkPingSequence(mode, parkPingText(claimed)) : null;
  } catch {
    return null;
  }
};
