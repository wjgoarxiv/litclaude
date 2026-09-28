#!/usr/bin/env node
// tools/scan-legacy-tokens.mjs — T04 guarded-token scanner for LitClaude.
//
// Enumerates every git-tracked + untracked-non-ignored file, captures the exact
// bytes into one immutable snapshot, scans only that snapshot for guarded tokens,
// and fails the gate on any hit or capture error. Success is snapshot-scoped and
// does not assert that the mutable live tree remained clean after capture. The
// allowlist file is retained only as a zero-entry compatibility schema; entries
// are not exemptions.
//
// Guarded token set (assembled from fragments below — no literal tokens in this source):
//   GUARDED (assembled from fragments below — no literal tokens in this source):
//     three bounded tokens: old state-dir prefix, old brand name, old trigger keyword.
//     five substring tokens: old npm package, old marketplace, old repo origin, source-origin handle+URL, old workflow name.
//     one bounded token: old goal/CLI name (assembled from fragments).
//   NEVER GUARDED: lit, litwork, litgoal, litclaude, claude.
//   D20 (supersedes D12): old own-vocab tokens are now legacy and ARE guarded.
//
// Exit codes:
//   0 = clean (no offenders, no errors)
//   1 = any fault (guarded-token leak / non-empty allowlist / git fault) — fail-closed
//   2 = operator/usage error
//
// Self-immunity: every guarded token is assembled from fragments; this source file contains no
// literal guarded token and will never flag itself.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalFrontendManifestPath,
  verifyCanonicalFrontendCorpus,
} from "../plugins/litclaude/lib/canonical-frontend-corpus.mjs";
import {
  MAX_BOUNDED_AGGREGATE_BYTES,
  MAX_BOUNDED_FILE_BYTES,
  readDirectoryStable,
  readRegularStable,
} from "../plugins/litclaude/lib/secure-path-read.mjs";

// --- Legacy token set (assembled from fragments; self-immunity) -------------------------------

// Each token is built from character fragments so no literal guarded token appears in this file.
export const LEGACY_TOKENS = Object.freeze([
  ["o", "m", "o"].join(""),                          // 0 — bounded
  ["lazy", "claude"].join(""),                        // 1 — bounded
  ["oh-my-", "open", "agent"].join(""),              // 2 — substring
  ["lazy", "codex"].join(""),                         // 3 — substring
  ["sisyphus", "labs"].join(""),                      // 4 — substring
  ["code-yeong", "yu"].join(""),                      // 5 — substring (source-origin handle)
  ["github.com/code-yeong", "yu/"].join(""),          // 6 — substring (source-origin URL prefix)
  ["u", "l", "w"].join(""),                           // 7 — bounded (D20: old trigger keyword)
  ["ultra", "work"].join(""),                         // 8 — substring (D20: old workflow name)
  ["ultra", "goal"].join(""),                         // 9 — bounded (D20: old goal/CLI name)
]);

export const LEGACY_TOKEN_IDS = Object.freeze(
  Object.fromEntries(LEGACY_TOKENS.map((token, index) => [token, `guard-${String(index + 1).padStart(2, "0")}`])),
);

function legacyTokenId(token) {
  return LEGACY_TOKEN_IDS[token] ?? "guard-unknown";
}

/** Per-token match mode. Bounded for the short collision-prone tokens; substring for the rest. */
export const DEFAULT_MATCH_MODES = Object.freeze({
  [LEGACY_TOKENS[0]]: "bounded",
  [LEGACY_TOKENS[1]]: "bounded",
  [LEGACY_TOKENS[2]]: "substring",
  [LEGACY_TOKENS[3]]: "substring",
  [LEGACY_TOKENS[4]]: "substring",
  [LEGACY_TOKENS[5]]: "substring",
  [LEGACY_TOKENS[6]]: "substring",
  [LEGACY_TOKENS[7]]: "bounded",
  [LEGACY_TOKENS[8]]: "substring",
  [LEGACY_TOKENS[9]]: "bounded",
});

const SELF_PATH = fileURLToPath(import.meta.url);
export const MAX_SCAN_FILE_BYTES = MAX_BOUNDED_FILE_BYTES;
export const MAX_SCAN_AGGREGATE_BYTES = MAX_BOUNDED_AGGREGATE_BYTES;

// --- Error type -------------------------------------------------------------------------------

export class LegacyScanError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LegacyScanError";
    this.code = code;
    this.details = details;
  }
}

export class ExternalTermScanError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExternalTermScanError";
    this.code = code;
    this.details = details;
  }
}

// --- Pure matcher -----------------------------------------------------------------------------

function isWordChar(c) {
  return c !== "" && c >= "0" && c <= "z" && /[a-z0-9]/.test(c);
}

/**
 * Return all ascending match offsets of `token` in `haystack` under `mode` (case-insensitive).
 * Pure and reusable by tests.
 * @param {string} haystack
 * @param {string} token  lowercase
 * @param {"substring"|"bounded"} mode
 * @returns {number[]}
 */
export function matchToken(haystack, token, mode) {
  const lc = haystack.toLowerCase();
  const out = [];
  if (token.length === 0) return out;
  let from = 0;
  for (;;) {
    const i = lc.indexOf(token, from);
    if (i === -1) break;
    if (mode === "bounded") {
      const before = i === 0 ? "" : lc[i - 1];
      const after = i + token.length >= lc.length ? "" : lc[i + token.length];
      if (!isWordChar(before) && !isWordChar(after)) {
        out.push(i);
        from = i + token.length;
      } else {
        from = i + 1;
      }
    } else {
      out.push(i);
      from = i + token.length;
    }
  }
  return out;
}

// --- Binary detection -------------------------------------------------------------------------

/** True when the buffer contains a NUL byte (binary). Pure. */
export function isBinary(buffer) {
  return buffer.includes(0);
}

// --- Per-file scan ----------------------------------------------------------------------------

// Control-char regex built from char codes so no literal control character appears in source.
const CONTROL_CHAR_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

function sanitizeContext(line) {
  const cleaned = line.replace(CONTROL_CHAR_RE, " ");
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}

/**
 * All token hits in a single file's text. Pure and deterministic.
 * @param {string} path
 * @param {string} text
 * @param {readonly string[]} [tokens]
 * @param {Readonly<Record<string,"substring"|"bounded">>} [modes]
 * @returns {Array<{path:string,token:string,line:number,column:number,context:string,mode:string}>}
 */
export function scanText(path, text, tokens = LEGACY_TOKENS, modes = DEFAULT_MATCH_MODES) {
  const hits = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (const token of tokens) {
      const mode = modes[token] ?? "substring";
      const offsets = matchToken(line, token, mode);
      for (const off of offsets) {
        hits.push({
          path,
          token,
          line: li + 1,
          column: off + 1,
          context: sanitizeContext(line),
          mode,
        });
      }
    }
  }
  return hits;
}

// --- Allowlist load + validate ----------------------------------------------------------------

/**
 * Load and strictly validate the compatibility allowlist. Non-empty entries are rejected.
 * @param {string} allowlistPath
 * @returns {{version:1, entries:Array<{path:string,token:string,reason:string,removalCondition:string}>}}
 */
function parseAllowlist(raw, allowlistPath) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LegacyScanError(
      "LITCLAUDE_SCAN_ALLOWLIST_INVALID_JSON",
      `allowlist is not valid JSON: ${err.message}`,
      { path: allowlistPath },
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LegacyScanError("LITCLAUDE_SCAN_ALLOWLIST_SCHEMA_INVALID", "allowlist root must be an object", {});
  }
  if (parsed.version !== 1) {
    throw new LegacyScanError(
      "LITCLAUDE_SCAN_ALLOWLIST_SCHEMA_INVALID",
      `allowlist version must be 1 (got ${JSON.stringify(parsed.version)})`,
      { field: "version" },
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw new LegacyScanError(
      "LITCLAUDE_SCAN_ALLOWLIST_SCHEMA_INVALID",
      "allowlist.entries must be an array",
      { field: "entries" },
    );
  }

  if (parsed.entries.length !== 0) {
    throw new LegacyScanError(
      "LITCLAUDE_SCAN_ALLOWLIST_NONEMPTY",
      "allowlist entries are not exemptions; remove all entries and eliminate the guarded traces",
      { entries: parsed.entries.length },
    );
  }

  return { version: 1, entries: [] };
}

export function loadAllowlist(allowlistPath) {
  let raw;
  try {
    raw = readFileSync(allowlistPath, "utf8");
  } catch (err) {
    throw new LegacyScanError(
      "LITCLAUDE_SCAN_ALLOWLIST_MISSING",
      err?.code === "ENOENT"
        ? `allowlist not found: ${allowlistPath}`
        : `allowlist unreadable: ${allowlistPath}`,
      { path: allowlistPath },
    );
  }
  return parseAllowlist(raw, allowlistPath);
}

/**
 * Load caller-supplied external terms for in-memory matching only. Reports use ids only.
 * @param {string} termsPath
 * @returns {Array<{id:string,value:string,matchMode:"substring"|"bounded"}>}
 */
export function loadExternalTerms(termsPath) {
  let raw;
  try {
    raw = readFileSync(termsPath, "utf8");
  } catch (err) {
    throw new ExternalTermScanError(
      "LITCLAUDE_EXTERNAL_TERMS_MISSING",
      err?.code === "ENOENT"
        ? `external terms file not found: ${termsPath}`
        : `external terms file unreadable: ${termsPath}`,
      { path: termsPath },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ExternalTermScanError(
      "LITCLAUDE_EXTERNAL_TERMS_INVALID_JSON",
      `external terms file is not valid JSON: ${err.message}`,
      { path: termsPath },
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", "external terms root must be an object", { path: termsPath });
  }
  if (parsed.version !== 1) {
    throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", "external terms version must be 1", { field: "version" });
  }
  if (!Array.isArray(parsed.terms)) {
    throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", "external terms must be an array", { field: "terms" });
  }

  const ids = new Set();
  return parsed.terms.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} must be an object`, { index });
    }
    for (const field of ["id", "value", "matchMode"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        throw new ExternalTermScanError(
          "LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID",
          `term ${index} field ${field} must be a non-empty string`,
          { index, field },
        );
      }
    }
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(entry.id)) {
      throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} id is invalid`, { index, field: "id" });
    }
    if (ids.has(entry.id)) {
      throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} id is duplicated`, { index, field: "id" });
    }
    ids.add(entry.id);
    if (entry.matchMode !== "substring" && entry.matchMode !== "bounded") {
      throw new ExternalTermScanError("LITCLAUDE_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} matchMode is invalid`, { index, field: "matchMode" });
    }
    return { id: entry.id, value: entry.value.toLowerCase(), matchMode: entry.matchMode };
  });
}

// --- File enumeration -------------------------------------------------------------------------

/**
 * Enumerate tracked + untracked-non-ignored files via `git ls-files --cached --others --exclude-standard -z`.
 * Throws LegacyScanError on git failure.
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listRepoFiles(repoRoot) {
  let out;
  try {
    out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    const stderr = err?.stderr ? err.stderr.toString("utf8") : "";
    if (err?.code === "ENOENT") {
      throw new LegacyScanError("LITCLAUDE_SCAN_GIT_FAILED", "git not found on PATH", { stderr });
    }
    if (/not a git repository/i.test(stderr)) {
      throw new LegacyScanError(
        "LITCLAUDE_SCAN_NOT_A_GIT_REPO",
        `not a git repository: ${repoRoot}`,
        { stderr, repoRoot },
      );
    }
    throw new LegacyScanError("LITCLAUDE_SCAN_GIT_FAILED", "git ls-files failed", {
      status: err?.status,
      stderr,
    });
  }
  return out
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0);
}

function boundRepoInventory(repoRoot) {
  const before = readDirectoryStable(repoRoot, repoRoot);
  if (before.failure) {
    throw new LegacyScanError("LITCLAUDE_SCAN_INVENTORY_CHANGED", "repository root identity changed during inventory", {
      repoRoot,
      reason: before.failure,
    });
  }
  const files = [...listRepoFiles(repoRoot)].sort();
  const after = readDirectoryStable(repoRoot, repoRoot, { ancestors: before.ancestors });
  if (after.failure) {
    throw new LegacyScanError("LITCLAUDE_SCAN_INVENTORY_CHANGED", "repository root identity changed during inventory", {
      repoRoot,
      reason: after.failure,
    });
  }
  return { files, rootSnapshot: { ancestors: after.ancestors } };
}

const SNAPSHOT_SCOPE = "captured-enumerated-files";

function updateSnapshotDigest(hash, rel, bytes) {
  const pathBytes = Buffer.from(rel, "utf8");
  hash.update(`${pathBytes.length}\0`, "utf8");
  hash.update(pathBytes);
  hash.update(`${bytes.length}\0`, "utf8");
  hash.update(bytes);
}

function captureExpectedSnapshot(rootSnapshot, protectedSnapshot) {
  const ancestors = new Map();
  for (const ancestor of rootSnapshot?.ancestors ?? []) ancestors.set(ancestor.absolutePath, ancestor);
  for (const ancestor of protectedSnapshot?.ancestors ?? []) ancestors.set(ancestor.absolutePath, ancestor);
  return {
    ...(protectedSnapshot ?? {}),
    ancestors: [...ancestors.values()],
  };
}

/**
 * Capture one finite, immutable snapshot of every enumerated path. The digest binds the
 * sorted inventory and exact bytes. Once this function returns, scanning performs no
 * further live-tree reads; later mutations are outside this snapshot's verdict.
 */
function captureRepoSnapshot({
  repoRoot,
  files,
  rootSnapshot,
  protectedPaths = new Set(),
  protectedSnapshots = new Map(),
  ordinaryErrorCode,
  protectedErrorCode = ordinaryErrorCode,
  fileTooLargeCode,
  aggregateTooLargeCode,
}) {
  const digest = createHash("sha256");
  digest.update("litclaude-scanner-snapshot-v1\0", "utf8");
  const capturedFiles = [];
  let capturedBytes = 0;

  for (const rel of files) {
    const isProtected = protectedPaths.has(rel);
    const read = readRegularStable(
      repoRoot,
      resolve(repoRoot, rel),
      captureExpectedSnapshot(rootSnapshot, isProtected ? protectedSnapshots.get(rel) : undefined),
      { maxBytes: MAX_SCAN_FILE_BYTES },
    );
    if (read.failure) {
      const code = read.failure === "FILE_TOO_LARGE"
        ? fileTooLargeCode
        : isProtected ? protectedErrorCode : ordinaryErrorCode;
      throw new LegacyScanError(
        code,
        read.failure === "FILE_TOO_LARGE"
          ? `enumerated file exceeds the ${MAX_SCAN_FILE_BYTES}-byte capture limit: ${rel}`
          : isProtected
          ? `protected canonical file could not be captured unchanged: ${rel}`
          : `enumerated file could not be captured unchanged: ${rel}`,
        { path: rel, reason: read.failure, maxBytes: MAX_SCAN_FILE_BYTES },
      );
    }
    if (capturedBytes + read.bytes.length > MAX_SCAN_AGGREGATE_BYTES) {
      throw new LegacyScanError(
        aggregateTooLargeCode,
        `captured files exceed the ${MAX_SCAN_AGGREGATE_BYTES}-byte aggregate limit`,
        { path: rel, capturedBytes, nextFileBytes: read.bytes.length, maxBytes: MAX_SCAN_AGGREGATE_BYTES },
      );
    }
    capturedBytes += read.bytes.length;

    updateSnapshotDigest(digest, rel, read.bytes);
    capturedFiles.push(Object.freeze({
      path: rel,
      protected: isProtected,
      binary: isBinary(read.bytes),
      bytes: read.bytes,
    }));
  }

  return Object.freeze({
    files: Object.freeze(capturedFiles),
    snapshotScope: SNAPSHOT_SCOPE,
    snapshotFileCount: capturedFiles.length,
    snapshotByteCount: capturedBytes,
    snapshotDigest: digest.digest("hex"),
  });
}

const snapshotReportFields = (snapshot) => ({
  snapshotScope: SNAPSHOT_SCOPE,
  snapshotFileCount: snapshot?.snapshotFileCount ?? 0,
  snapshotByteCount: snapshot?.snapshotByteCount ?? 0,
  snapshotDigest: snapshot?.snapshotDigest ?? null,
});

// --- Reconcile --------------------------------------------------------------------------------

/**
 * Reconcile hits against the compatibility allowlist. The default policy has no exemptions.
 * @param {Array<{path:string,token:string}>} hits
 * @param {{entries:Array<{path:string,token:string}>}} allowlist
 * @param {ReadonlySet<string>} trackedPaths
 */
export function reconcile(hits, allowlist, trackedPaths) {
  const keyOf = (path, token) => `${path}\x00${token}`;
  const allowedKeys = new Set(allowlist.entries.map((e) => keyOf(e.path, e.token)));

  const offenders = hits.filter((h) => !allowedKeys.has(keyOf(h.path, h.token)));

  const hitKeys = new Set(hits.map((h) => keyOf(h.path, h.token)));
  const deadEntries = [];
  const pendingEntries = [];
  for (const entry of allowlist.entries) {
    if (!trackedPaths.has(entry.path)) {
      pendingEntries.push(entry);
      continue;
    }
    if (!hitKeys.has(keyOf(entry.path, entry.token))) {
      deadEntries.push(entry);
    }
  }

  return { offenders, deadEntries, pendingEntries };
}

// --- Orchestration ----------------------------------------------------------------------------

/**
 * Top-level scan. Never throws; converts LegacyScanError into report.errors.
 * @param {{repoRoot:string, allowlistPath:string, tokens?:readonly string[], modes?:Record<string,string>}} opts
 */
export function runScan(opts) {
  const tokens = opts.tokens ?? LEGACY_TOKENS;
  const modes = opts.modes ?? DEFAULT_MATCH_MODES;
  const errors = [];

  const emptyReport = (extra = {}) => ({
    ok: false,
    scannedFiles: 0,
    totalHits: 0,
    allowlistedHits: 0,
    offenders: [],
    deadEntries: [],
    pendingEntries: [],
    protectedHits: 0,
    errors,
    ...snapshotReportFields(),
    ...extra,
  });

  let inventory;
  try {
    inventory = boundRepoInventory(opts.repoRoot);
  } catch (err) {
    if (!(err instanceof LegacyScanError)) throw err;
    errors.push({ code: err.code, message: err.message, details: err.details });
    return emptyReport();
  }
  const files = inventory.files;
  const trackedPaths = new Set(files);

  // The imported 167-file frontend library is the sole scanner exception. It is not an
  // allowlist: every exempt corpus file must first match its exact path, size, SHA-256,
  // aggregate, and entry type. The independently committed legal companions and the
  // manifest are scanned normally. A failed preflight grants zero exemptions.
  let protectedPaths = new Set();
  let protectedSnapshots = new Map();
  const pluginRoot = resolve(opts.repoRoot, "plugins", "litclaude");
  if (existsSync(join(pluginRoot, canonicalFrontendManifestPath))) {
    const canonical = verifyCanonicalFrontendCorpus(pluginRoot);
    if (canonical.status === "PASS") {
      protectedPaths = canonical.protectedPaths;
      protectedSnapshots = canonical.protectedSnapshots;
    } else {
      errors.push({
        code: "LITCLAUDE_CANONICAL_CORPUS_INVALID",
        message: "canonical frontend corpus preflight failed; no scanner exemption was applied",
        details: { failures: canonical.failures },
      });
    }
  }

  let snapshot;
  try {
    snapshot = captureRepoSnapshot({
      repoRoot: opts.repoRoot,
      files,
      rootSnapshot: inventory.rootSnapshot,
      protectedPaths,
      protectedSnapshots,
      ordinaryErrorCode: "LITCLAUDE_SCAN_FILE_READ_FAILED",
      protectedErrorCode: "LITCLAUDE_PROTECTED_FILE_DRIFT",
      fileTooLargeCode: "LITCLAUDE_SCAN_FILE_TOO_LARGE",
      aggregateTooLargeCode: "LITCLAUDE_SCAN_AGGREGATE_TOO_LARGE",
    });
  } catch (err) {
    if (!(err instanceof LegacyScanError)) throw err;
    errors.push({ code: err.code, message: err.message, details: err.details });
    return emptyReport();
  }

  const absoluteRepoRoot = resolve(opts.repoRoot);
  const absoluteAllowlist = resolve(opts.allowlistPath);
  const allowlistRelative = relative(absoluteRepoRoot, absoluteAllowlist).replaceAll("\\", "/");
  const allowlistOutsideSnapshot = allowlistRelative === ""
    || isAbsolute(allowlistRelative)
    || allowlistRelative.split("/")[0] === "..";
  const capturedAllowlist = allowlistOutsideSnapshot
    ? undefined
    : snapshot.files.find(({ path }) => path === allowlistRelative);
  let allowlist;
  try {
    if (capturedAllowlist === undefined) {
      throw new LegacyScanError(
        "LITCLAUDE_SCAN_ALLOWLIST_MISSING",
        "allowlist must be an enumerated file inside the captured repository snapshot",
        { path: opts.allowlistPath },
      );
    }
    allowlist = parseAllowlist(capturedAllowlist.bytes.toString("utf8"), opts.allowlistPath);
  } catch (err) {
    if (!(err instanceof LegacyScanError)) throw err;
    errors.push({ code: err.code, message: err.message, details: err.details });
    return emptyReport(snapshotReportFields(snapshot));
  }

  const allHits = [];
  let scannedFiles = 0;
  let protectedHits = 0;
  for (const captured of snapshot.files) {
    if (captured.binary) continue;
    const text = captured.bytes.toString("utf8");
    if (captured.protected) {
      scannedFiles += 1;
      protectedHits += scanText(captured.path, text, tokens, modes).length;
      continue;
    }
    scannedFiles += 1;
    const hits = scanText(captured.path, text, tokens, modes);
    for (const h of hits) allHits.push(h);
  }

  const { offenders, deadEntries, pendingEntries } = reconcile(allHits, allowlist, trackedPaths);

  offenders.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.token !== b.token) return a.token < b.token ? -1 : 1;
    return a.column - b.column;
  });
  const sortEntries = (arr) =>
    [...arr].sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
    });

  const ok = offenders.length === 0 && deadEntries.length === 0 && errors.length === 0;
  return {
    ok,
    scannedFiles,
    totalHits: allHits.length,
    allowlistedHits: 0,
    offenders,
    deadEntries: sortEntries(deadEntries),
    pendingEntries: sortEntries(pendingEntries),
    protectedHits,
    errors,
    ...snapshotReportFields(snapshot),
  };
}

/**
 * Scan repo files for externally supplied terms and report offenders by opaque id only.
 * @param {{repoRoot:string, termsPath:string}} opts
 */
export function runExternalTermScan(opts) {
  const errors = [];
  const emptyReport = (extra = {}) => ({
    ok: false,
    scannedFiles: 0,
    offenders: [],
    errors,
    ...snapshotReportFields(),
    ...extra,
  });

  let terms;
  try {
    terms = loadExternalTerms(opts.termsPath);
  } catch (err) {
    if (!(err instanceof ExternalTermScanError)) throw err;
    errors.push({ code: err.code, message: err.message, details: err.details });
    return emptyReport();
  }

  let inventory;
  try {
    inventory = boundRepoInventory(opts.repoRoot);
  } catch (err) {
    if (!(err instanceof LegacyScanError)) throw err;
    errors.push({ code: err.code, message: err.message, details: err.details });
    return emptyReport();
  }

  const files = inventory.files;
  const byValue = new Map(terms.map((term) => [term.value, term]));
  const values = terms.map((term) => term.value);
  const modes = Object.fromEntries(terms.map((term) => [term.value, term.matchMode]));
  let snapshot;
  try {
    snapshot = captureRepoSnapshot({
      repoRoot: opts.repoRoot,
      files,
      rootSnapshot: inventory.rootSnapshot,
      ordinaryErrorCode: "LITCLAUDE_EXTERNAL_FILE_READ_FAILED",
      fileTooLargeCode: "LITCLAUDE_EXTERNAL_FILE_TOO_LARGE",
      aggregateTooLargeCode: "LITCLAUDE_EXTERNAL_AGGREGATE_TOO_LARGE",
    });
  } catch (err) {
    if (!(err instanceof LegacyScanError)) throw err;
    errors.push({ code: err.code, message: err.message, details: err.details });
    return emptyReport();
  }

  const offenders = [];
  let scannedFiles = 0;

  for (const captured of snapshot.files) {
    if (captured.binary) continue;
    scannedFiles += 1;
    const text = captured.bytes.toString("utf8");
    for (const hit of scanText(captured.path, text, values, modes)) {
      const term = byValue.get(hit.token);
      if (term === undefined) continue;
      offenders.push({ path: hit.path, termId: term.id, line: hit.line, column: hit.column, mode: hit.mode });
    }
  }

  offenders.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.termId !== b.termId) return a.termId < b.termId ? -1 : 1;
    return a.column - b.column;
  });

  return {
    ok: offenders.length === 0 && errors.length === 0,
    scannedFiles,
    offenders,
    errors,
    ...snapshotReportFields(snapshot),
  };
}

// --- CLI --------------------------------------------------------------------------------------

const USAGE = `Usage: node tools/scan-legacy-tokens.mjs [flags]

Flags:
  --json                  Emit the snapshot-scoped ScanReport as a single JSON line to stdout.
  --repo-root <path>      Repo root to scan (default: git toplevel, else cwd).
  --allowlist <path>      Zero-entry compatibility file (default: <repo-root>/tools/legacy-token-allowlist.json).
  --external-terms <path> Scan caller-supplied external terms; reports opaque ids only.
  --quiet                 Suppress the success summary line (ignored with --json).
  --help, -h              Print this usage and exit 0.`;

function parseArgs(argv) {
  const flags = { json: false, quiet: false, repoRoot: null, allowlist: null, externalTerms: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--repo-root" || arg === "--allowlist" || arg === "--external-terms") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `missing value for ${arg}` };
      }
      if (arg === "--repo-root") flags.repoRoot = value;
      else if (arg === "--allowlist") flags.allowlist = value;
      else flags.externalTerms = value;
      i += 1;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { flags };
}

function resolveRepoRoot(explicit) {
  if (explicit) return resolve(explicit);
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (top) return top;
  } catch {
    // fall through to cwd
  }
  return process.cwd();
}

function main() {
  const { flags, error } = parseArgs(process.argv.slice(2));
  if (error) {
    process.stderr.write(`[scan-legacy-tokens] ${error}\n${USAGE}\n`);
    process.exit(2);
  }
  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const repoRoot = resolveRepoRoot(flags.repoRoot);
  const allowlistPath = flags.allowlist
    ? resolve(flags.allowlist)
    : resolve(repoRoot, "tools/legacy-token-allowlist.json");

  const report = flags.externalTerms
    ? runExternalTermScan({ repoRoot, termsPath: resolve(flags.externalTerms) })
    : runScan({ repoRoot, allowlistPath });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exit(report.ok ? 0 : 1);
  }

  for (const err of report.errors) {
    process.stderr.write(`[scan-legacy-tokens] ${err.code}: ${err.message}\n`);
  }
  for (const o of report.offenders) {
    if ("termId" in o) {
      process.stdout.write(`${o.path}:${o.line}:${o.column} [${o.termId}]\n`);
    } else {
      process.stdout.write(`${o.path}:${o.line}:${o.column} [${legacyTokenId(o.token)}]\n`);
    }
  }
  for (const e of report.deadEntries ?? []) {
    process.stderr.write(`[scan-legacy-tokens] LITCLAUDE_SCAN_ALLOWLIST_DEAD_ENTRY: ${e.path} [${legacyTokenId(e.token)}]\n`);
  }
  for (const e of report.pendingEntries ?? []) {
    process.stderr.write(
      `[scan-legacy-tokens] pending allowlist entry (file not yet tracked): ${e.path} [${legacyTokenId(e.token)}]\n`,
    );
  }

  if (report.ok) {
    if (!flags.quiet) {
      process.stdout.write(
        flags.externalTerms
          ? `external-term scan: OK (${report.scannedFiles} text files; snapshot ${report.snapshotScope}, ${report.snapshotFileCount} files, sha256 ${report.snapshotDigest}; does not prove the mutable live tree remained clean)\n`
          : `legacy-token scan: OK (${report.scannedFiles} text files, 0 guarded hits; snapshot ${report.snapshotScope}, ${report.snapshotFileCount} files, sha256 ${report.snapshotDigest}; does not prove the mutable live tree remained clean)\n`,
      );
    }
    process.exit(0);
  }
  process.stdout.write(
    flags.externalTerms
      ? `external-term scan: FAIL (${report.offenders.length} offenders; ${report.snapshotDigest ? `snapshot ${report.snapshotScope}, ${report.snapshotFileCount} files, sha256 ${report.snapshotDigest}` : "snapshot unavailable because capture did not complete"})\n`
      : `legacy-token scan: FAIL (${report.offenders.length} offenders, 0 allowed exceptions; ${report.snapshotDigest ? `snapshot ${report.snapshotScope}, ${report.snapshotFileCount} files, sha256 ${report.snapshotDigest}` : "snapshot unavailable because capture did not complete"})\n`,
  );
  process.exit(1);
}

// Run CLI only when invoked directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === SELF_PATH) {
  main();
}
