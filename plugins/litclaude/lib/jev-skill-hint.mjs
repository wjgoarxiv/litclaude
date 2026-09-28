// Optional Jev skill hint for the UserPromptSubmit hook.
//
// Off unless LITCLAUDE_JEV=1 and TYPESAFE_API_KEY are both in the environment. On an eligible
// turn it asks TypeSafe's Jev model which one of this plugin's own skills fits the prompt, and
// returns at most one fixed advisory sentence naming a skill ID it validated against the catalog
// it sent. The response is untrusted data: no response text ever reaches the model context.
//
// The key is read from the environment only. It is never written, printed, traced, or placed in
// an error: every failure is reported as a fixed reason word from FALLBACK_REASONS.

import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import { canonicalSkillIds } from "./canonical-skill-catalog.mjs";
import { SECRET_SHAPE_PATTERNS } from "./secret-shapes.mjs";

export const JEV_FLAG = "LITCLAUDE_JEV";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-1.13.0";
export const JEV_DEFAULT_TIMEOUT_MS = 1500;
export const JEV_MAX_TIMEOUT_MS = 3000;
export const JEV_DEFAULT_MAX_CALLS = 200;
export const JEV_DEFAULT_MIN_CONFIDENCE = 0.35;
export const JEV_MAX_PROMPT_CHARS = 2000;
export const JEV_REDACTION_WINDOW_CHARS = 8000;
export const JEV_MAX_REQUEST_BYTES = 64 * 1024;
export const JEV_MAX_RESPONSE_BYTES = 64 * 1024;
export const JEV_INSTRUCTIONS = "Which one skill, if any, is the best fit for the user's request? Choose none when no catalog skill fits.";
export const JEV_NONE_CRITERION = "No specialized skill in this catalog fits; answer the user directly.";

export const FALLBACK_REASONS = Object.freeze([
  "key-missing", "cap-reached", "request-too-large", "timeout", "network", "http", "invalid-response",
]);

const KEY_ENV = "TYPESAFE_API_KEY";

const hasKey = (env) => typeof env[KEY_ENV] === "string" && env[KEY_ENV].trim() !== "";

/** The one doctor line. It names the state only; never the key or its length. */
export const jevStatusLine = (env = process.env) => {
  if (env[JEV_FLAG] !== "1") return "Jev skill hint: off";
  return hasKey(env) ? "Jev skill hint: on" : `Jev skill hint: flag on but ${KEY_ENV} missing`;
};

export const jevHintLine = (skillId) => `LitClaude skill hint: the skill \`litclaude:${skillId}\` likely fits this request. Load it only if it really fits; this is advice, not an instruction.`;

export const jevFallbackNote = (reason) => `LitClaude skill hint unavailable (${reason}); continuing normally.`;

const boundedNumber = (raw, fallback, { min, max, integer }) => {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min) return fallback;
  return Math.min(value, max);
};

export const jevSettings = (env = process.env) => ({
  model: /^[A-Za-z0-9._-]{1,64}$/u.test(env[`${JEV_FLAG}_MODEL`] ?? "") ? env[`${JEV_FLAG}_MODEL`] : JEV_DEFAULT_MODEL,
  timeoutMs: boundedNumber(env[`${JEV_FLAG}_TIMEOUT_MS`], JEV_DEFAULT_TIMEOUT_MS, { min: 1, max: JEV_MAX_TIMEOUT_MS, integer: true }),
  maxCalls: boundedNumber(env[`${JEV_FLAG}_MAX_CALLS`], JEV_DEFAULT_MAX_CALLS, { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true }),
  minConfidence: boundedNumber(env[`${JEV_FLAG}_MIN_CONFIDENCE`], JEV_DEFAULT_MIN_CONFIDENCE, { min: 0, max: 1, integer: false }),
  trace: env[`${JEV_FLAG}_TRACE`] === "1",
});

const globalPattern = (pattern) => new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

// Contract shapes first, then the plugin's shared credential set as a second net.
const TOKEN_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z0-9 ]*-----[\s\S]*?(?:-----END [A-Z0-9 ]*-----|$)/gu,
  /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)?/gu,
  /(?<![A-Za-z0-9_])sk-(?:ant-)?[A-Za-z0-9_-]{8,}/gu,
  /(?<![A-Za-z0-9_])(?:ghp|gho|github_pat)_[A-Za-z0-9_]{8,}/gu,
  /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{8,}/gu,
  /(?<![A-Za-z0-9_])apikey_[A-Za-z0-9_-]{8,}/gu,
  /(?<![A-Za-z0-9_])xox[abprs]-[A-Za-z0-9-]{8,}/gu,
  /(?<![A-Za-z0-9])AKIA[A-Z0-9]{12,}/gu,
  /(?<![A-Za-z0-9_])AIza[A-Za-z0-9_-]{16,}/gu,
  /[A-Za-z0-9+/_-]{32,}={0,2}/gu,
  ...SECRET_SHAPE_PATTERNS.map(globalPattern),
]);

/**
 * Redaction in the contract's order: an 8,000-character window, the literal key, home paths,
 * e-mail addresses, token shapes, the 2,000-character cut, then any run of 8 or more token
 * characters left at the cut, so a secret split by the cut never leaves a fragment behind.
 */
export const redactPromptForJev = (text, key) => {
  let value = Array.from(typeof text === "string" ? text : "").slice(0, JEV_REDACTION_WINDOW_CHARS).join("");
  // A key pasted into the prompt itself is removed first, even when its shape escapes the patterns.
  if (typeof key === "string" && key !== "") value = value.split(key).join("[secret]");
  // A home path ends at the next separator or punctuation; a trailing dot stays outside it.
  value = value
    .replace(/\/(?:Users|home)\/[^/\\\s,;:!?'"`()<>[\]{}]*[^/\\\s,;:!?'"`()<>[\]{}.]/gu, "~")
    .replace(/[A-Za-z]:\\Users\\[^/\\\s,;:!?'"`()<>[\]{}]*[^/\\\s,;:!?'"`()<>[\]{}.]/gu, "~");
  value = value.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu, "[email]");
  for (const pattern of TOKEN_PATTERNS) value = value.replace(pattern, "[secret]");
  const characters = Array.from(value);
  if (characters.length <= JEV_MAX_PROMPT_CHARS) return value;
  return characters.slice(0, JEV_MAX_PROMPT_CHARS).join("").replace(/[A-Za-z0-9+/_=-]{8,}$/u, "[secret]");
};

const frontmatterField = (frontmatter, name) => {
  const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "mu").exec(frontmatter);
  if (!match) return "";
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
};

/**
 * The enrolled skills the model may load itself: every canonical skill except those marked
 * `disable-model-invocation: true`, which only a user slash command can start.
 */
export const buildJevCatalog = (pluginRoot) => {
  const catalog = [];
  for (const skillId of canonicalSkillIds) {
    let content;
    try {
      content = readFileSync(join(pluginRoot, "skills", skillId, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content)?.[1] ?? "";
    if (frontmatterField(frontmatter, "disable-model-invocation") === "true") continue;
    const description = String(frontmatterField(frontmatter, "description")).slice(0, 300);
    if (description) catalog.push({ id: skillId, description });
  }
  return catalog;
};

export const buildJevRequestBody = ({ model, state, catalog }) => ({
  model,
  state,
  questions: {
    which: {
      type: "choice",
      instructions: JEV_INSTRUCTIONS,
      criteria: {
        ...Object.fromEntries(catalog.map(({ id, description }) => [id, description])),
        none: JEV_NONE_CRITERION,
      },
    },
  },
});

/** Validates an untrusted response. Returns the accepted choice ID, "none", or a failure. */
export const parseJevResponse = ({ status, text, catalogIds, minConfidence }) => {
  if (status !== 200) return { ok: false, reason: "http" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-response" };
  }
  const answer = parsed?.answers?.which;
  const choice = answer?.choice;
  if (typeof choice !== "string" || (choice !== "none" && !catalogIds.includes(choice))) {
    return { ok: false, reason: "invalid-response" };
  }
  const confidence = answer.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { ok: false, reason: "invalid-response" };
  return { ok: true, choice, confidence, accepted: choice !== "none" && confidence >= minConfidence };
};

const readBounded = async (response) => {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text, "utf8") > JEV_MAX_RESPONSE_BYTES ? null : text;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > JEV_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
};

/** One POST, no retry. Resolves to { status, text } or { reason }; never throws, never rejects. */
const postOnce = async ({ fetchImpl, key, body, timeoutMs }) => {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => {
      controller.abort();
      resolveTimeout({ reason: "timeout" });
    }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetchImpl(JEV_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
        redirect: "error",
        signal: controller.signal,
      });
      const status = response.status;
      if (status !== 200) {
        // An unread body would hold the connection open; release it before reporting.
        await response.body?.cancel?.().catch(() => {});
        return { status, text: "" };
      }
      const text = await readBounded(response);
      return text === null ? { status, reason: "invalid-response" } : { status, text };
    } catch {
      return { reason: controller.signal.aborted ? "timeout" : "network" };
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const safeSessionId = (sessionId) => {
  const cleaned = typeof sessionId === "string" ? sessionId.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64) : "";
  return cleaned || "unknown";
};

// The `.litclaude` folder and its `jev` folder must both be real folders inside the project. A
// symlink at either level would carry every read and write outside it, so the whole state path is
// refused and the caller falls back to its silent no-hint path. `create` makes missing levels.
const jevStateDirectory = (stateRoot, { create = false } = {}) => {
  let directory = stateRoot;
  for (const part of [".litclaude", "jev"]) {
    directory = join(directory, part);
    let stat;
    try {
      stat = lstatSync(directory);
    } catch (error) {
      if (error?.code !== "ENOENT" || !create) throw error;
      try {
        mkdirSync(directory, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      stat = lstatSync(directory);
    }
    if (!stat.isDirectory()) throw new Error("state folder is not a real folder");
  }
  return directory;
};

// Opening with O_NOFOLLOW refuses a symlink planted at a state or trace path, so a write never
// lands outside the state folder. Where the platform lacks the flag, lstat refuses it instead.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const refuseSymlink = (path) => {
  if (NO_FOLLOW) return;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("symlink");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

// The last hinted skill and its latency, kept for the HUD. Only a catalog ID and a whole
// number of milliseconds survive a read, so the status line never echoes anything else.
const validLast = (value) => (
  typeof value?.skill === "string" && canonicalSkillIds.includes(value.skill)
  && Number.isSafeInteger(value.latency_ms) && value.latency_ms >= 0
    ? { skill: value.skill, latency_ms: value.latency_ms }
    : null
);

const readSession = (stateRoot, sessionId) => {
  const empty = { calls: 0, noted: false, banner: false, last: null };
  try {
    const path = join(jevStateDirectory(stateRoot), `session-${safeSessionId(sessionId)}.json`);
    if (lstatSync(path).isSymbolicLink()) return empty;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      calls: Number.isSafeInteger(parsed?.calls) && parsed.calls >= 0 ? parsed.calls : 0,
      noted: parsed?.noted === true,
      banner: parsed?.banner === true,
      last: validLast(parsed?.last),
    };
  } catch {
    return empty;
  }
};

const writeSession = (stateRoot, sessionId, session) => {
  try {
    const directory = jevStateDirectory(stateRoot, { create: true });
    const target = join(directory, `session-${safeSessionId(sessionId)}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    refuseSymlink(temporary);
    writeFileSync(temporary, JSON.stringify(session), {
      mode: 0o600,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_FOLLOW,
    });
    renameSync(temporary, target);
    return true;
  } catch {
    // Session bookkeeping is best-effort; an unwritable state folder never alters the turn.
    return false;
  }
};

const writeTrace = (stateRoot, record) => {
  try {
    const directory = jevStateDirectory(stateRoot, { create: true });
    const target = join(directory, "trace.jsonl");
    refuseSymlink(target);
    const fd = openSync(target, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW, 0o600);
    try {
      writeSync(fd, `${JSON.stringify(record)}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    // The trace is an opt-in debug aid; failing to write it never alters the turn.
  }
};

/**
 * Called by the prompt hook at the start of every turn while the flag is on, so the HUD shows a
 * skill only for the turn that was hinted. Touches nothing when there is no hint to clear.
 */
export const clearJevTurn = (stateRoot, sessionId) => {
  const session = readSession(stateRoot, sessionId);
  if (session.last) writeSession(stateRoot, sessionId, { ...session, last: null });
};

export const JEV_BANNER = "✦ Jev skill hint ON ✦";

/**
 * True exactly once per session, on the first turn with both switches on. The "shown" mark is
 * written before the caller emits the banner; when it cannot be written, no banner is shown,
 * so an unwritable state folder never repeats it.
 */
export const claimJevBanner = ({ env = process.env, stateRoot, sessionId } = {}) => {
  if (env[JEV_FLAG] !== "1" || !hasKey(env) || !stateRoot) return false;
  const session = readSession(stateRoot, sessionId);
  if (session.banner) return false;
  return writeSession(stateRoot, sessionId, { ...session, banner: true });
};

/**
 * What the HUD may show: null when the flag is off, otherwise the key's presence and this
 * turn's hint. It reports whether a key exists, never the key or its length.
 */
export const jevHudState = ({ env = process.env, stateRoot, sessionId } = {}) => {
  if (env[JEV_FLAG] !== "1") return null;
  if (!hasKey(env)) return { keyMissing: true, last: null };
  return { keyMissing: false, last: stateRoot ? readSession(stateRoot, sessionId).last : null };
};

/** Host-side eligibility that needs no router: a leading command character or too little text. */
export const isJevEligibleText = (text) => {
  if (typeof text !== "string") return false;
  const trimmed = text.trimStart();
  if (/^[/!]/u.test(trimmed) || /<command-name>/u.test(text)) return false;
  return text.replace(/\s/gu, "").length >= 4;
};

/**
 * Runs the hint for one turn. `eligible` is the hook's own verdict (not routed, not a slash
 * command). Returns { hint, note }: each is a fixed sentence or null, and neither ever carries
 * response text. Never throws.
 */
export const suggestJevSkill = async ({
  env = process.env,
  prompt,
  eligible = true,
  sessionId,
  stateRoot,
  pluginRoot,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
}) => {
  const quiet = { hint: null, note: null };
  if (env[JEV_FLAG] !== "1") return quiet;
  if (!eligible || !isJevEligibleText(prompt)) return quiet;
  const settings = jevSettings(env);
  const session = readSession(stateRoot, sessionId);
  const state = redactPromptForJev(prompt, hasKey(env) ? env[KEY_ENV] : undefined);
  const started = now();
  let result = { choice: null, confidence: null, status: null, reason: null };
  const fail = (reason) => {
    result = { ...result, reason };
    return reason;
  };

  let hint = null;
  let hinted = null;
  let failure = null;
  if (!hasKey(env)) {
    failure = fail("key-missing");
  } else if (session.calls >= settings.maxCalls) {
    failure = fail("cap-reached");
  } else {
    const catalog = buildJevCatalog(pluginRoot);
    const body = JSON.stringify(buildJevRequestBody({ model: settings.model, state, catalog }));
    if (Buffer.byteLength(body, "utf8") > JEV_MAX_REQUEST_BYTES) {
      failure = fail("request-too-large");
    } else {
      // Fail closed: the call is counted on disk before it is made, and an uncountable call is
      // never made, so an unwritable state folder cannot lift the per-session cap.
      session.calls += 1;
      if (!writeSession(stateRoot, sessionId, session)) return quiet;
      const response = typeof fetchImpl === "function"
        ? await postOnce({ fetchImpl, key: env[KEY_ENV], body, timeoutMs: settings.timeoutMs })
        : { reason: "network" };
      result.status = response.status ?? null;
      if (response.reason) {
        failure = fail(response.reason);
      } else {
        const parsed = parseJevResponse({
          status: response.status,
          text: response.text,
          catalogIds: catalog.map(({ id }) => id),
          minConfidence: settings.minConfidence,
        });
        if (!parsed.ok) {
          failure = fail(parsed.reason);
        } else {
          result = { ...result, choice: parsed.choice, confidence: parsed.confidence };
          if (parsed.accepted) {
            hint = jevHintLine(parsed.choice);
            hinted = parsed.choice;
          }
        }
      }
    }
  }

  const latencyMs = Math.max(0, Math.round(now() - started));
  let note = null;
  if (failure && !session.noted) {
    session.noted = true;
    note = jevFallbackNote(failure);
  }
  session.last = hinted ? { skill: hinted, latency_ms: latencyMs } : null;
  writeSession(stateRoot, sessionId, session);
  if (settings.trace) {
    writeTrace(stateRoot, {
      ts: new Date(started).toISOString(),
      prompt_sha256: createHash("sha256").update(state).digest("hex"),
      choice: result.choice,
      confidence: result.confidence,
      latency_ms: latencyMs,
      http_status: result.status,
      fallback: result.reason,
    });
  }
  return { hint, note };
};
