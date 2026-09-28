import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { acquireOwnerLock, releaseOwnerLock } from "./owner-lock.mjs";
import {
  directoryIdentity,
  pathIdentity,
  sameDirectoryIdentity,
  samePathIdentity,
} from "./secure-path-read.mjs";
import { decodeStrictUtf8, parseStrictJson } from "./strict-json.mjs";
import { containsSecret, URI_USERINFO_PATTERN } from "./secret-shapes.mjs";
import { resolveProjectStateRoot } from "./project-state-root.mjs";

const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 512;
const MAX_REF_BYTES = 256;
const NORMAL_QUERY_BUDGET = 2048;
const HARD_QUERY_BUDGET = 4096;
const MIN_QUERY_BUDGET = 256;
const CLAIM_SCHEMA = "litclaude.wikify-claim.v1";
const claimKeys = ["schema", "id", "kind", "text", "provenance", "evidence", "state", "timestamp"];
const captureEventKeys = ["kind", "text", "provenance", "evidence"];
const provenanceKeys = ["product", "surface", "ref"];
const evidenceKeys = ["ref"];
const captureProvenanceKeys = ["ref"];
const captureEvidenceKeys = ["ref"];
const kinds = new Set(["fact", "decision", "failure", "risk", "rule", "checkpoint"]);
const states = new Set(["review-needed", "accepted", "rejected", "stale"]);
const reviewStates = new Set(["accepted", "rejected", "stale"]);
const safeId = /^wk-[a-f0-9]{24}$/u;
const uriUserinfoPattern = URI_USERINFO_PATTERN;
const instructionPatterns = [
  /\b(?:ignore|disregard)\s+(?:(?:all|any|every|the)\s+)?(?:previous|prior)\s+instructions?\b/iu,
  /(?:^|\s)(?:#{1,6}\s*)?(?:system|assistant|developer)\s*:/iu,
  /<\|(?:system|assistant|developer)\|>/iu,
  /\b(?:jailbreak|execute (?:this|the following) command|publish all credentials)\b/iu,
];

export class WikifyKnowledgeError extends Error {
  constructor(message, status = 64) {
    super(message);
    this.name = "WikifyKnowledgeError";
    this.status = status;
  }
}

const byteLength = (value) => Buffer.byteLength(value, "utf8");
const normalizeText = (value) => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
const promptJsonEscapes = Object.freeze({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" });
const stringifyPromptData = (value) => JSON.stringify(value).replace(/[<>&]/gu, (character) => promptJsonEscapes[character]);

const validateBoundedText = (value, label, maxBytes) => {
  if (typeof value === "string" && /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new WikifyKnowledgeError(`${label} contains control characters`);
  }
  const normalized = normalizeText(value);
  if (!normalized) throw new WikifyKnowledgeError(`${label} is required`);
  if (byteLength(normalized) > maxBytes) throw new WikifyKnowledgeError(`${label} exceeds ${maxBytes} bytes`);
  return normalized;
};

const containsUriUserinfo = (value) => uriUserinfoPattern.test(value);
const containsInstructions = (value) => instructionPatterns.some((pattern) => pattern.test(value));
const validateEvidenceRef = (value) => {
  const normalized = value.replaceAll("\\", "/");
  const pathPart = normalized.split("#", 1)[0];
  if (
    normalized.startsWith("/")
    || normalized.startsWith("~")
    || /^[A-Za-z]:\//u.test(normalized)
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(normalized)
    || pathPart.split("/").some((part) => part === "..")
  ) {
    throw new WikifyKnowledgeError("evidence ref must be a local relative reference");
  }
  return value;
};
const hasExactKeys = (value, expected) => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).length === expected.length
  && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const rejectUnknownKeys = (value, allowed, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new WikifyKnowledgeError(`${label} contains an unknown input key`);
  }
};
const isCanonicalTimestamp = (value) => {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
};

const deterministicId = (kind, text, provenance, evidence) => {
  const digest = createHash("sha256")
    .update(JSON.stringify([kind, text, provenance.product, provenance.ref, evidence.ref]))
    .digest("hex")
    .slice(0, 24);
  return `wk-${digest}`;
};

const canonicalRoot = (root) => {
  const candidate = resolveProjectStateRoot(root ?? process.cwd());
  try {
    const details = lstatSync(candidate);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("invalid root");
    return realpathSync(candidate);
  } catch {
    throw new WikifyKnowledgeError("knowledge root must be an existing regular directory");
  }
};

const ensurePrivateDirectory = (path) => {
  if (existsSync(path)) {
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new WikifyKnowledgeError("knowledge state path is not a regular directory", 65);
    }
    return;
  }
  mkdirSync(path, { mode: 0o700 });
};

export const knowledgeDirectory = (root = resolveProjectStateRoot()) => {
  const canonical = canonicalRoot(root);
  const litDirectory = join(canonical, ".litclaude");
  const directory = join(litDirectory, "knowledge");
  for (const path of [litDirectory, directory]) {
    if (!existsSync(path)) break;
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new WikifyKnowledgeError("knowledge state path is not a regular directory", 65);
    }
  }
  return directory;
};
export const knowledgeClaimsPath = (root = resolveProjectStateRoot()) => join(knowledgeDirectory(root), "claims.jsonl");
export const knowledgeSettingsPath = (root = resolveProjectStateRoot()) => join(knowledgeDirectory(root), "settings.json");

const prepareKnowledgeDirectory = (root) => {
  const canonical = canonicalRoot(root);
  const litDirectory = join(canonical, ".litclaude");
  const directory = join(litDirectory, "knowledge");
  ensurePrivateDirectory(litDirectory);
  ensurePrivateDirectory(directory);
  return directory;
};

const withClaimsLock = (root, operation) => {
  const directory = prepareKnowledgeDirectory(root);
  const lockDir = join(directory, ".claims-lock");
  const owner = acquireOwnerLock(lockDir);
  try {
    return operation(directory);
  } finally {
    releaseOwnerLock(lockDir, owner);
  }
};

const nodeIdentity = directoryIdentity;
const sameNode = sameDirectoryIdentity;
const sameFileNode = samePathIdentity;
const sameStableFileNode = (left, right) => left?.dev === right?.dev
  && left?.ino === right?.ino
  && left?.birthtimeMs === right?.birthtimeMs;

const parentIdentity = (path) => {
  const details = lstatSync(dirname(path), { throwIfNoEntry: false });
  if (!details) return undefined;
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error("knowledge state parent is not a regular directory");
  }
  return nodeIdentity(details);
};

const requireParentIdentity = (path) => {
  const expected = parentIdentity(path);
  if (!expected) throw new Error("knowledge state parent is missing");
  return expected;
};

const verifyParentIdentity = (path, expected) => {
  const current = parentIdentity(path);
  if (!sameNode(current, expected)) throw new Error("knowledge state ancestor changed");
  return current;
};

const assertRegularStateFile = (path, expectedParent) => {
  const expected = expectedParent ?? parentIdentity(path);
  if (!expected) return false;
  const details = lstatSync(path, { throwIfNoEntry: false });
  verifyParentIdentity(path, expected);
  if (!details) return false;
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new WikifyKnowledgeError("knowledge persistence failed", 65);
  }
  if (details.nlink !== 1) {
    throw new WikifyKnowledgeError("knowledge state file has unsafe link count", 65);
  }
  if (details.size > MAX_LEDGER_BYTES) throw new WikifyKnowledgeError("knowledge ledger exceeds 4194304 bytes", 65);
  return { parent: expected, file: pathIdentity(details) };
};

const validateOpenedStateFile = (descriptor) => {
  const details = fstatSync(descriptor);
  if (!details.isFile()) throw new Error("knowledge state file is not regular");
  if (details.nlink !== 1) throw new Error("knowledge state file has unsafe link count");
  if (details.size > MAX_LEDGER_BYTES) throw new Error("knowledge state file is oversized");
  return details;
};

const verifyOpenedStateFile = (descriptor, path, expectedParent, expectedFile) => {
  verifyParentIdentity(path, expectedParent);
  const opened = validateOpenedStateFile(descriptor);
  const named = lstatSync(path, { throwIfNoEntry: false });
  if (!named?.isFile() || named.isSymbolicLink() || !sameFileNode(pathIdentity(named), pathIdentity(opened))
    || (expectedFile !== undefined && !sameFileNode(pathIdentity(opened), expectedFile))) {
    throw new Error("knowledge state path changed");
  }
  return opened;
};

const openStateFile = (path, flags, mode = 0o600, expectedParent = requireParentIdentity(path), expectedFile) => {
  let descriptor;
  try {
    descriptor = openSync(path, flags | (constants.O_NOFOLLOW ?? 0), mode);
    verifyOpenedStateFile(descriptor, path, expectedParent, expectedFile);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
};

const readStateFile = (path, failureMessage, snapshot) => {
  let descriptor;
  try {
    const expectedParent = snapshot?.parent ?? requireParentIdentity(path);
    const expectedFile = snapshot?.file;
    descriptor = openStateFile(path, constants.O_RDONLY, 0o600, expectedParent, expectedFile);
    verifyOpenedStateFile(descriptor, path, expectedParent, expectedFile);
    const content = decodeStrictUtf8(readFileSync(descriptor));
    verifyOpenedStateFile(descriptor, path, expectedParent, expectedFile);
    return content;
  } catch {
    throw new WikifyKnowledgeError(failureMessage, 65);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const appendStateText = (path, text, expectedParent) => {
  return rewriteStateFile(path, (content) => `${content}${text}`, expectedParent);
};

const truncateStateFile = (path, length, expectedParent) => {
  return rewriteStateFile(path, (content) => content.slice(0, length), expectedParent);
};

const parseLedger = (path, { recoverFinalLine = false, expectedParent } = {}) => {
  const snapshot = assertRegularStateFile(path, expectedParent);
  if (!snapshot) return [];
  let content = readStateFile(path, "knowledge ledger read failed", snapshot);
  if (!content) return [];

  if (!content.endsWith("\n")) {
    const lastNewline = content.lastIndexOf("\n");
    const finalText = content.slice(lastNewline + 1);
    try {
      parseStrictJson(finalText);
    } catch {
      const retainedContent = content.slice(0, lastNewline + 1);
      if (!recoverFinalLine) return parseRows(retainedContent);
      parseRows(retainedContent);
      try {
        truncateStateFile(path, lastNewline + 1, snapshot.parent);
        return parseRows(retainedContent);
      } catch {
        throw new WikifyKnowledgeError("knowledge interrupted-write recovery failed", 65);
      }
    }
    parseRows(finalText);
    content = `${content}\n`;
    if (recoverFinalLine) appendStateText(path, "\n", snapshot.parent);
  }
  return parseRows(content);
};

const parseRows = (content) => {
  const rows = [];
  for (const line of content.split("\n").filter(Boolean)) {
    try {
      const row = parseStrictJson(line);
      if (
        !hasExactKeys(row, claimKeys)
        || row.schema !== CLAIM_SCHEMA
        || !safeId.test(row.id)
        || !kinds.has(row?.kind)
        || !states.has(row?.state)
        || !hasExactKeys(row.provenance, provenanceKeys)
        || row.provenance.product !== "litclaude"
        || !hasExactKeys(row.evidence, evidenceKeys)
        || !isCanonicalTimestamp(row.timestamp)
        || !validateBoundedText(row.text, "text", MAX_TEXT_BYTES)
        || !validateBoundedText(row.provenance.surface, "provenance surface", MAX_REF_BYTES)
        || !validateBoundedText(row.provenance.ref, "provenance ref", MAX_REF_BYTES)
        || !validateEvidenceRef(validateBoundedText(row.evidence.ref, "evidence ref", MAX_REF_BYTES))
      ) throw new Error("invalid row");
      if (row.id !== deterministicId(row.kind, row.text, row.provenance, row.evidence)) {
        throw new Error("forged row id");
      }
      const inspected = `${row.text}\n${row.provenance.surface}\n${row.provenance.ref}\n${row.evidence.ref}`;
      if (
        containsUriUserinfo(inspected)
        || containsSecret(row.text)
        || containsSecret(row.provenance.surface)
        || containsSecret(row.provenance.ref)
        || containsSecret(row.evidence.ref)
        || containsInstructions(inspected)
      ) {
        throw new Error("unsafe row");
      }
      rows.push(row);
    } catch {
      throw new WikifyKnowledgeError("knowledge ledger contains a malformed authoritative record", 65);
    }
  }
  return rows;
};

const currentRecords = (rows) => {
  const current = new Map();
  for (const row of rows) current.set(row.id, row);
  return current;
};

const syncPath = (path) => {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const details = fstatSync(descriptor);
    if (!details.isFile() && !details.isDirectory()) throw new Error("knowledge sync path is not regular");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const openStateForRewrite = (path, expectedParent) => {
  const parent = expectedParent ?? requireParentIdentity(path);
  const named = lstatSync(path, { throwIfNoEntry: false });
  verifyParentIdentity(path, parent);
  if (!named) return { parent, descriptor: undefined, content: "", mode: 0o600 };

  let descriptor;
  try {
    const expectedFile = pathIdentity(named);
    descriptor = openStateFile(path, constants.O_RDONLY, 0o600, parent, expectedFile);
    const opened = verifyOpenedStateFile(descriptor, path, parent, expectedFile);
    const content = decodeStrictUtf8(readFileSync(descriptor));
    verifyOpenedStateFile(descriptor, path, parent, expectedFile);
    return { parent, descriptor, content, mode: opened.mode & 0o777 };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
};

const rewriteStateFile = (path, buildContent, expectedParent) => {
  const source = openStateForRewrite(path, expectedParent);
  let descriptor;
  let temporary;
  let temporaryContent;
  let temporaryIdentity;
  try {
    const content = buildContent(source.content);
    if (byteLength(content) > MAX_LEDGER_BYTES) throw new Error("knowledge state file is oversized");
    temporaryContent = content;

    temporary = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      source.mode,
    );
    fchmodSync(descriptor, source.mode);
    writeFileSync(descriptor, content, { encoding: "utf8" });
    fsyncSync(descriptor);
    verifyOpenedStateFile(descriptor, temporary, source.parent);
    const stableTemporary = fstatSync(descriptor);
    temporaryIdentity = pathIdentity(stableTemporary);
    if (!stableTemporary.isFile() || stableTemporary.nlink !== 1 || stableTemporary.size > MAX_LEDGER_BYTES) {
      throw new Error("knowledge temporary file gained an unsafe link");
    }

    verifyParentIdentity(path, source.parent);
    if (source.descriptor !== undefined) {
      const current = fstatSync(source.descriptor);
      if (!current.isFile() || current.nlink !== 1 || current.size > MAX_LEDGER_BYTES) {
        throw new Error("knowledge state file changed during rewrite");
      }
      const named = lstatSync(path, { throwIfNoEntry: false });
      if (!named?.isFile() || named.isSymbolicLink() || !sameFileNode(pathIdentity(named), pathIdentity(current))) {
        throw new Error("knowledge state path changed during rewrite");
      }
    } else if (lstatSync(path, { throwIfNoEntry: false })) {
      throw new Error("knowledge state path appeared during rewrite");
    }

    verifyOpenedStateFile(descriptor, temporary, source.parent);
    renameSync(temporary, path);
    temporary = undefined;
    syncPath(dirname(path));
    assertRegularStateFile(path, source.parent);
    if (fstatSync(descriptor).nlink !== 1) {
      throw new Error("knowledge temporary file gained an external link during rewrite");
    }
    if (source.descriptor !== undefined && fstatSync(source.descriptor).nlink !== 0) {
      throw new Error("knowledge state file gained an external link during rewrite");
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (source.descriptor !== undefined) closeSync(source.descriptor);
    if (temporary !== undefined) {
      try {
        verifyParentIdentity(temporary, source.parent);
        const current = lstatSync(temporary, { throwIfNoEntry: false });
        if (!current || !current.isFile() || current.isSymbolicLink()
          || !sameFileNode(pathIdentity(current), temporaryIdentity)) throw new Error("temporary identity changed");
        const quarantine = `${temporary}.remove.${randomUUID()}`;
        renameSync(temporary, quarantine);
        const moved = lstatSync(quarantine, { throwIfNoEntry: false });
        if (!moved || !moved.isFile() || moved.isSymbolicLink() || moved.nlink !== 1
          || !sameStableFileNode(pathIdentity(moved), temporaryIdentity)
          || readFileSync(quarantine, "utf8") !== temporaryContent) {
          throw new Error("temporary contents changed");
        }
        rmSync(quarantine, { force: true });
      } catch {
        // Do not remove a pathname after its parent or file identity has changed.
      }
    }
  }
};

const appendRecord = (root, build) => withClaimsLock(root, (directory) => {
  const path = join(directory, "claims.jsonl");
  const expectedParent = requireParentIdentity(path);
  const rows = parseLedger(path, { recoverFinalLine: true, expectedParent });
  const result = build(currentRecords(rows));
  if (!result.record) return result.receipt;
  try {
    appendStateText(path, `${JSON.stringify(result.record)}\n`, expectedParent);
    syncPath(directory);
    const latest = currentRecords(parseLedger(path, { expectedParent })).get(result.record.id);
    if (latest?.state !== result.record.state || latest?.timestamp !== result.record.timestamp) {
      throw new Error("read-back mismatch");
    }
  } catch {
    throw new WikifyKnowledgeError("knowledge persistence failed", 65);
  }
  return result.receipt;
});

const normalizeEvent = (event, surface) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new WikifyKnowledgeError("structured event must be an object");
  }
  rejectUnknownKeys(event, captureEventKeys, "structured event");
  rejectUnknownKeys(event.provenance, captureProvenanceKeys, "structured event provenance");
  rejectUnknownKeys(event.evidence, captureEvidenceKeys, "structured event evidence");
  if (!kinds.has(event.kind)) throw new WikifyKnowledgeError("unsupported kind");
  const text = validateBoundedText(event.text, "text", MAX_TEXT_BYTES);
  const provenanceSurface = validateBoundedText(surface, "provenance surface", MAX_REF_BYTES);
  const provenanceRef = validateBoundedText(event.provenance?.ref, "provenance ref", MAX_REF_BYTES);
  const evidenceRef = validateEvidenceRef(validateBoundedText(event.evidence?.ref, "evidence ref", MAX_REF_BYTES));
  if (containsSecret(provenanceSurface)) throw new WikifyKnowledgeError("secret-bearing provenance surface rejected", 65);
  if (containsUriUserinfo(provenanceSurface)) throw new WikifyKnowledgeError("credential-bearing URI rejected", 65);
  if (containsInstructions(provenanceSurface)) throw new WikifyKnowledgeError("instruction-shaped provenance surface rejected");
  const inspected = `${text}\n${provenanceSurface}\n${provenanceRef}\n${evidenceRef}`;
  if (containsUriUserinfo(inspected)) throw new WikifyKnowledgeError("credential-bearing URI rejected", 65);
  if (containsSecret(text) || containsSecret(provenanceSurface) || containsSecret(provenanceRef) || containsSecret(evidenceRef)) {
    throw new WikifyKnowledgeError("secret-bearing event rejected", 65);
  }
  if (containsInstructions(inspected)) throw new WikifyKnowledgeError("instruction-shaped event rejected");
  const provenance = { product: "litclaude", surface: provenanceSurface, ref: provenanceRef };
  const evidence = { ref: evidenceRef };
  return {
    id: deterministicId(event.kind, text, provenance, evidence),
    kind: event.kind,
    text,
    provenance,
    evidence,
  };
};

export const readCaptureSettings = (root = resolveProjectStateRoot()) => {
  return withClaimsLock(root, (directory) => {
    const path = join(directory, "settings.json");
    const snapshot = assertRegularStateFile(path);
    if (!snapshot) return { capture: true };
    try {
      const settings = parseStrictJson(readStateFile(path, "knowledge settings read failed", snapshot));
      if (typeof settings?.capture !== "boolean") throw new Error("invalid settings");
      return { capture: settings.capture };
    } catch {
      throw new WikifyKnowledgeError("knowledge settings are malformed", 65);
    }
  });
};

export const writeCaptureSettings = (root, captureEnabled) => {
  if (typeof captureEnabled !== "boolean") throw new WikifyKnowledgeError("capture setting must be a boolean");
  try {
    return withClaimsLock(root, (directory) => {
      const path = join(directory, "settings.json");
      const expectedParent = requireParentIdentity(path);
      assertRegularStateFile(path, expectedParent);
      rewriteStateFile(
        path,
        () => `${JSON.stringify({ capture: captureEnabled }, null, 2)}\n`,
        expectedParent,
      );
      return { ok: true, status: "configured", capture: captureEnabled };
    });
  } catch {
    throw new WikifyKnowledgeError("knowledge settings persistence failed", 65);
  }
};

export const captureKnowledgeEvent = (root, event, { surface = "runtime" } = {}) => {
  const normalized = normalizeEvent(event, surface);
  if (!readCaptureSettings(root).capture) {
    return { ok: true, status: "disabled", written: false };
  }
  return appendRecord(root, (records) => {
    if (records.has(normalized.id)) {
      return {
        receipt: { ok: true, status: "duplicate", written: false, id: normalized.id },
      };
    }
    const record = {
      schema: CLAIM_SCHEMA,
      ...normalized,
      state: "review-needed",
      timestamp: new Date().toISOString(),
    };
    return {
      record,
      receipt: { ok: true, status: "review-needed", written: true, id: record.id },
    };
  });
};

export const reviewKnowledgeRecord = (root, id, state, { surface = "review" } = {}) => {
  if (!safeId.test(id ?? "")) throw new WikifyKnowledgeError("invalid knowledge id");
  if (!reviewStates.has(state)) throw new WikifyKnowledgeError("review state must be accepted, rejected, or stale");
  const reviewSurface = validateBoundedText(surface, "provenance surface", MAX_REF_BYTES);
  if (containsSecret(reviewSurface)) throw new WikifyKnowledgeError("secret-bearing provenance surface rejected", 65);
  if (containsInstructions(reviewSurface)) throw new WikifyKnowledgeError("instruction-shaped provenance surface rejected");
  return appendRecord(root, (records) => {
    const current = records.get(id);
    if (!current) throw new WikifyKnowledgeError("knowledge id not found", 66);
    if (current.state === state) {
      return { receipt: { ok: true, status: "duplicate", written: false, id, state } };
    }
    const record = {
      ...current,
      state,
      timestamp: new Date().toISOString(),
      provenance: { ...current.provenance, surface: reviewSurface },
    };
    return {
      record,
      receipt: { ok: true, status: "reviewed", written: true, id, state },
    };
  });
};

const tokens = (value) => new Set(normalizeText(value).toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{2,}/gu) ?? []);

const relevanceScore = (queryTokens, record) => {
  const recordTokens = tokens(`${record.kind} ${record.text} ${record.provenance.ref} ${record.evidence.ref}`);
  let score = 0;
  for (const token of queryTokens) if (recordTokens.has(token)) score += 1;
  return score;
};

export const queryKnowledge = (root, queryText, { budget = NORMAL_QUERY_BUDGET } = {}) => {
  const query = validateBoundedText(queryText, "query text", MAX_TEXT_BYTES);
  if (!Number.isInteger(budget) || budget < MIN_QUERY_BUDGET || budget > HARD_QUERY_BUDGET) {
    throw new WikifyKnowledgeError("budget must be between 256 and 4096 bytes");
  }
  const queryTokens = tokens(query);
  const records = [...currentRecords(parseLedger(knowledgeClaimsPath(root))).values()]
    .filter((record) => record.state === "accepted")
    .map((record) => ({ record, score: relevanceScore(queryTokens, record) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id));
  if (!records.length) return "";

  const opening = "<litclaude-knowledge>\n";
  const closing = "</litclaude-knowledge>\n";
  let output = opening;
  for (const { record } of records) {
    const line = `${stringifyPromptData({
      id: record.id,
      kind: record.kind,
      text: record.text,
      timestamp: record.timestamp,
      provenance: record.provenance,
      evidence: record.evidence,
    })}\n`;
    if (byteLength(output + line + closing) > budget) break;
    output += line;
  }
  if (output === opening) return "";
  return `${output}${closing}`;
};

export const WIKIFY_KNOWLEDGE_LIMITS = Object.freeze({
  maxTextBytes: MAX_TEXT_BYTES,
  maxRefBytes: MAX_REF_BYTES,
  normalQueryBudget: NORMAL_QUERY_BUDGET,
  hardQueryBudget: HARD_QUERY_BUDGET,
});
