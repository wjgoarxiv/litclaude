import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePlanTaskRows } from "./plan-task-rows.mjs";
import { requireStateDir, STATE_APPEND_FLAG, STATE_WRITE_FLAG } from "./project-state-root.mjs";
import { pathIdentity, samePathIdentity } from "./secure-path-read.mjs";

const SCHEMA_VERSION = 3;
const MAX_EVENTS = 8;
const MAX_STATE_EVENTS = 16;
const MAX_WORKS = 4;
const MAX_HISTORY = 16;
const MAX_IDEMPOTENCY = 16;
const MAX_CONTINUATION_RECEIPTS = MAX_STATE_EVENTS;
const MAX_GRANTS = 64;
const MAX_PLAN_BYTES = 1024 * 1024;
const allowedActions = new Set(["read", "write", "execute", "test", "package", "vcs-read"]);
const forbiddenActions = new Set([
  "commit",
  "push",
  "publish",
  "tag",
  "release",
  "version-bump",
  "registry-write",
  "host-config-write",
  "destructive-vcs",
]);

export class StartWorkLifecycleError extends Error {
  constructor(message, status = 65) {
    super(message);
    this.name = "StartWorkLifecycleError";
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const shortHash = (value) => hash(value).slice(0, 20);
const clone = (value) => JSON.parse(JSON.stringify(value));
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

export const startWorkStateDir = (root) => join(root, ".litclaude", "start-work");
export const startWorkStatePath = (root) => join(root, ".litclaude", "boulder.json");
export const startWorkLedgerPath = (root) => join(startWorkStateDir(root), "ledger.jsonl");
export const startWorkLockDir = (root) => join(startWorkStateDir(root), ".lock");
const startWorkLockOwnerPath = (root) => join(startWorkLockDir(root), "owner.json");

const atomicWriteJson = (path, value) => {
  requireStateDir(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: STATE_WRITE_FLAG });
  const fd = openSync(temporary, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(temporary, path);
  try {
    const directoryFd = openSync(dirname(path), "r");
    fsyncSync(directoryFd);
    closeSync(directoryFd);
  } catch {
    // The file itself is durable; directory fsync is not portable to every filesystem.
  }
};

const processIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const readLockOwner = (root) => {
  try {
    const owner = JSON.parse(readFileSync(startWorkLockOwnerPath(root), "utf8"));
    return typeof owner?.nonce === "string" && Number.isInteger(owner.pid) && Number.isFinite(owner.acquired_at_ms)
      ? owner
      : null;
  } catch {
    return null;
  }
};

export const acquireStartWorkLock = (root, options = {}) => {
  const lockDir = startWorkLockDir(root);
  requireStateDir(dirname(lockDir));
  const configured = Number.parseInt(process.env.LITCLAUDE_START_WORK_LOCK_TIMEOUT_MS ?? "5000", 10);
  const timeout = Number.isFinite(options.timeoutMs)
    ? Math.max(0, options.timeoutMs)
    : Number.isFinite(configured) && configured >= 0 ? configured : 5000;
  const staleMs = Number.isFinite(options.staleMs) ? Math.max(0, options.staleMs) : 30_000;
  const started = Date.now();
  while (true) {
    const owner = { nonce: randomUUID(), pid: process.pid, acquired_at_ms: Date.now() };
    try {
      mkdirSync(lockDir, { recursive: false, mode: 0o700 });
      try {
        writeFileSync(startWorkLockOwnerPath(root), `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: "wx" });
      } catch {
        rmSync(lockDir, { recursive: true, force: true });
        throw new StartWorkLifecycleError("start-work lock ownership receipt failed");
      }
      return owner;
    } catch (error) {
      if (error?.code !== "EEXIST") throw new StartWorkLifecycleError("start-work state lock failed");
      const incumbent = readLockOwner(root);
      const stale = incumbent
        && Date.now() - incumbent.acquired_at_ms >= staleMs
        && !processIsAlive(incumbent.pid);
      if (stale) {
        const claim = join(lockDir, `.takeover-${incumbent.nonce}`);
        const displaced = `${lockDir}.stale.${incumbent.nonce}.${randomUUID()}`;
        try {
          writeFileSync(claim, `${process.pid}\n`, { mode: 0o600, flag: "wx" });
          if (readLockOwner(root)?.nonce !== incumbent.nonce) continue;
          renameSync(lockDir, displaced);
          rmSync(displaced, { recursive: true, force: true });
          continue;
        } catch (takeoverError) {
          if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(takeoverError?.code)) {
            throw new StartWorkLifecycleError("start-work stale lock takeover failed");
          }
        }
      }
      if (Date.now() - started >= timeout) throw new StartWorkLifecycleError("start-work state lock timed out", 75);
      sleepSync(Math.min(20, Math.max(1, timeout)));
    }
  }
};

export const releaseStartWorkLock = (root, owner) => {
  const incumbent = readLockOwner(root);
  if (!incumbent || incumbent.nonce !== owner?.nonce || incumbent.pid !== owner?.pid) return false;
  rmSync(startWorkLockDir(root), { recursive: true, force: true });
  return true;
};

const withLock = (root, operation) => {
  const owner = acquireStartWorkLock(root);

  try {
    return operation();
  } finally {
    releaseStartWorkLock(root, owner);
  }
};

const canonicalDirectory = (path, label) => {
  const requested = resolve(path);
  let stats;
  try {
    stats = lstatSync(requested);
  } catch {
    throw new StartWorkLifecycleError(`${label} does not exist`);
  }
  if (stats.isSymbolicLink()) throw new StartWorkLifecycleError(`${label} must not be a symbolic link`);
  if (!stats.isDirectory()) throw new StartWorkLifecycleError(`${label} must be a directory`);
  return realpathSync(requested).normalize("NFC");
};

const canonicalTarget = (path, label) => {
  const requested = resolve(path);
  let existing = requested;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new StartWorkLifecycleError(`${label} has no existing canonical ancestor`);
    existing = parent;
  }
  // A linked ancestor (macOS `/tmp`, `/var`) resolves to where it points; the grant check then
  // judges that real place, so a link cannot carry a path out of the grants.
  const canonicalExisting = realpathSync(existing);
  return resolve(canonicalExisting, relative(existing, requested)).normalize("NFC");
};

const canonicalPlan = (root, plan) => {
  const requested = isAbsolute(plan) ? resolve(plan) : resolve(root, plan);
  let stats;
  try {
    stats = lstatSync(requested);
  } catch {
    throw new StartWorkLifecycleError("plan file does not exist");
  }
  if (stats.isSymbolicLink()) throw new StartWorkLifecycleError("plan file must not be a symbolic link");
  if (!stats.isFile()) throw new StartWorkLifecycleError("plan path must be a regular file");
  return realpathSync(requested);
};

// APFS looks names up regardless of Unicode normalization, so `챌린지` typed (NFC) and stored (NFD)
// are one folder; both sides compare in NFC.
const rootCovers = (grantRoot, requestedRoot) => {
  const path = relative(grantRoot.normalize("NFC"), requestedRoot.normalize("NFC"));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

const publicState = (state) => {
  const output = clone(state);
  delete output.idempotency;
  return output;
};

const requestHash = (operation, request) => hash(JSON.stringify({ operation, request }));

const emptyState = () => ({
  schema_version: SCHEMA_VERSION,
  revision: 0,
  active_work_id: null,
  works: {},
  history: [],
  events: [],
  idempotency: {},
  created_at: nowIso(),
  updated_at: nowIso(),
});

const readState = (root, { optional = false } = {}) => {
  const path = startWorkStatePath(root);
  if (!existsSync(path)) {
    if (optional) return null;
    throw new StartWorkLifecycleError("start-work state not found", 66);
  }
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new StartWorkLifecycleError("corrupt start-work state");
  }
  if (state?.schema_version !== SCHEMA_VERSION || !Number.isInteger(state.revision) || state.revision < 0) {
    throw new StartWorkLifecycleError("unsupported or corrupt start-work schema; schema-3 state is required");
  }
  if (!state.works || typeof state.works !== "object" || !Array.isArray(state.events)) {
    throw new StartWorkLifecycleError("corrupt start-work state");
  }
  state.idempotency ??= {};
  state.history ??= [];
  for (const work of Object.values(state.works)) {
    work.root_session_id ??= work.active_session_id;
    work.lanes ??= {};
    work.worktrees ??= {};
    work.authority ??= {};
    work.authority.resume_token_receipts ??= [];
    work.authority.consumed_grants ??= [];
    work.continuation ??= {};
    work.continuation.receipts ??= {};
  }
  return state;
};

const ledgerRecords = (root) => {
  const path = startWorkLedgerPath(root);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    throw new StartWorkLifecycleError("corrupt start-work ledger");
  }
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const assertLedgerCompatible = (existing, stateEvents) => {
  const byId = new Map();
  const byRevision = new Map();
  for (const event of existing) {
    if (!event?.event_id || !Number.isInteger(event.revision)) {
      throw new StartWorkLifecycleError("start-work ledger conflict: malformed event identity");
    }
    const canonical = canonicalJson(event);
    const priorId = byId.get(event.event_id);
    if (priorId && priorId !== canonical) throw new StartWorkLifecycleError("start-work ledger contains an altered event");
    const priorRevision = byRevision.get(event.revision);
    if (priorRevision && priorRevision !== canonical) throw new StartWorkLifecycleError("start-work ledger revision conflict");
    byId.set(event.event_id, canonical);
    byRevision.set(event.revision, canonical);
  }
  for (const event of stateEvents) {
    if (!event?.event_id || !Number.isInteger(event.revision)) {
      throw new StartWorkLifecycleError("start-work ledger conflict: malformed event identity");
    }
    const canonical = canonicalJson(event);
    const priorId = byId.get(event.event_id);
    if (priorId && priorId !== canonical) throw new StartWorkLifecycleError("start-work ledger contains an altered event");
    const priorRevision = byRevision.get(event.revision);
    if (priorRevision && priorRevision !== canonical) throw new StartWorkLifecycleError("start-work ledger revision conflict");
    byId.set(event.event_id, canonical);
    byRevision.set(event.revision, canonical);
  }
};

const reconcileLedger = (root, state) => {
  const path = startWorkLedgerPath(root);
  requireStateDir(dirname(path));
  const existing = ledgerRecords(root);
  assertLedgerCompatible(existing, state.events);
  const ids = new Set(existing.map(({ event_id: eventId }) => eventId).filter(Boolean));
  for (const event of state.events) {
    if (ids.has(event.event_id)) continue;
    appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600, flag: STATE_APPEND_FLAG });
    ids.add(event.event_id);
  }
  if (existsSync(path)) {
    const fd = openSync(path, "r");
    fsyncSync(fd);
    closeSync(fd);
  }
};

const trimObjectByTimestamp = (object, maximum) => {
  const entries = Object.entries(object);
  if (entries.length <= maximum) return object;
  return Object.fromEntries(entries
    .sort(([, left], [, right]) => String(left.recorded_at).localeCompare(String(right.recorded_at)))
    .slice(-maximum));
};

const trimContinuationReceipts = (receipts) => {
  const entries = Object.entries(receipts ?? {});
  if (entries.length <= MAX_CONTINUATION_RECEIPTS) return receipts ?? {};
  return Object.fromEntries(entries
    .sort(([, left], [, right]) => Number(left.revision ?? 0) - Number(right.revision ?? 0))
    .slice(-MAX_CONTINUATION_RECEIPTS));
};

const compactState = (state) => {
  state.events = state.events.slice(-MAX_STATE_EVENTS);
  state.history = state.history.slice(-MAX_HISTORY);
  state.idempotency = trimObjectByTimestamp(state.idempotency, MAX_IDEMPOTENCY);
  const works = Object.values(state.works);
  for (const work of works) {
    work.continuation ??= {};
    work.continuation.receipts = trimContinuationReceipts(work.continuation.receipts);
  }
  if (works.length > MAX_WORKS) {
    const keep = new Set(works
      .sort((left, right) => (right.terminal_revision ?? right.revision) - (left.terminal_revision ?? left.revision))
      .slice(0, MAX_WORKS)
      .map(({ work_id: workId }) => workId));
    if (state.active_work_id) keep.add(state.active_work_id);
    state.works = Object.fromEntries(Object.entries(state.works).filter(([workId]) => keep.has(workId)));
  }
};

const saveState = (root, state) => {
  const existingLedger = ledgerRecords(root);
  assertLedgerCompatible(existingLedger, state.events);
  compactState(state);
  assertLedgerCompatible(existingLedger, state.events);
  atomicWriteJson(startWorkStatePath(root), state);
  reconcileLedger(root, state);
};

const idempotentReplay = (state, key, fingerprint) => {
  if (!key) throw new StartWorkLifecycleError("missing idempotency key", 64);
  const entry = state.idempotency[key];
  if (!entry) return null;
  if (entry.request_hash !== fingerprint) throw new StartWorkLifecycleError("idempotency key conflict", 409);
  return clone(entry.response);
};

const rememberIdempotency = (state, key, fingerprint, response) => {
  state.idempotency[key] = {
    request_hash: fingerprint,
    response: clone(response),
    recorded_at: nowIso(),
  };
};

const appendEvent = (state, work, name, details = {}) => {
  const timestamp = nowIso();
  state.revision += 1;
  state.updated_at = timestamp;
  work.revision = state.revision;
  work.updated_at = timestamp;
  const event = {
    event_id: `${work.work_id}:${state.revision}:${name}`,
    event: name,
    work_id: work.work_id,
    revision: state.revision,
    timestamp,
    ...details,
  };
  state.events.push(event);
  work.events = [...(work.events ?? []), event].slice(-MAX_EVENTS);
  return event;
};

const requireActiveWork = (state, request, allowedStatuses = ["active"]) => {
  const work = state.works[request.workId];
  if (!work || state.active_work_id !== request.workId) throw new StartWorkLifecycleError("requested work is not the active work");
  if (!allowedStatuses.includes(work.status)) throw new StartWorkLifecycleError(`active work is ${work.status}`);
  if (work.active_session_id !== request.sessionId || !work.session_ids.includes(request.sessionId)) {
    throw new StartWorkLifecycleError("session does not own the active work", 77);
  }
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision !== work.revision || request.expectedRevision !== state.revision) {
    throw new StartWorkLifecycleError("stale start-work revision", 409);
  }
  return work;
};

const normalizeAction = (action) => {
  if (forbiddenActions.has(action)) throw new StartWorkLifecycleError(`forbidden authority action: ${action}`, 77);
  if (!allowedActions.has(action)) throw new StartWorkLifecycleError(`unknown authority action: ${action}`, 64);
  return action;
};

const grantCovers = (grant, action, targetRoot) => grant.action === action && rootCovers(grant.root, targetRoot);

const readCanonicalPlanText = (planPath) => {
  let fd;
  try {
    const pathStats = lstatSync(planPath);
    if (pathStats.isSymbolicLink()) throw new StartWorkLifecycleError("plan file must not be a symbolic link");
    if (!pathStats.isFile()) throw new StartWorkLifecycleError("plan path must be a regular file");
    if (pathStats.size > MAX_PLAN_BYTES) throw new StartWorkLifecycleError("plan file exceeds the bounded size limit");
    fd = openSync(planPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile()
      || !samePathIdentity(pathIdentity(openedStats), pathIdentity(pathStats))
      || openedStats.size !== pathStats.size
      || openedStats.size > MAX_PLAN_BYTES
    ) {
      throw new StartWorkLifecycleError("plan file changed during bounded read");
    }
    return readFileSync(fd, "utf8");
  } catch (error) {
    if (error instanceof StartWorkLifecycleError) throw error;
    throw new StartWorkLifecycleError("plan file could not be read safely");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

export const readPlanProgress = (planPath) => {
  const text = readCanonicalPlanText(planPath);
  const tasks = parsePlanTaskRows(text).map(({ checked, text: taskText }) => ({ checked, text: taskText }));
  const fingerprint = hash(JSON.stringify(tasks));
  const uncheckedTasks = tasks.filter(({ checked }) => !checked);
  return {
    fingerprint,
    total: tasks.length,
    checked: tasks.length - uncheckedTasks.length,
    unchecked: uncheckedTasks.length,
    next_task: uncheckedTasks[0]?.text ?? null,
  };
};

const parseGrant = (root, raw, index) => {
  if (raw && typeof raw === "object") {
    const action = normalizeAction(raw.action);
    const grantRoot = canonicalDirectory(raw.root, "grant root");
    return {
      grant_id: `grant-${shortHash(`${index}:${action}:${grantRoot}`)}`,
      boundary_id: `boundary-${shortHash(`${action}:${grantRoot}`)}`,
      action,
      root: grantRoot,
      issued_by: typeof raw.issuedBy === "string" ? raw.issuedBy : "approved-init",
      issued_at: nowIso(),
    };
  }
  if (typeof raw !== "string") throw new StartWorkLifecycleError("grant must be action:path", 64);
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator === raw.length - 1) throw new StartWorkLifecycleError("grant must be action:path", 64);
  const action = normalizeAction(raw.slice(0, separator));
  const grantRoot = canonicalDirectory(raw.slice(separator + 1), "grant root");
  return {
    grant_id: `grant-${shortHash(`${index}:${action}:${grantRoot}`)}`,
    boundary_id: `boundary-${shortHash(`${action}:${grantRoot}`)}`,
    action,
    root: grantRoot,
    issued_by: "approved-init",
    issued_at: nowIso(),
  };
};

const terminalSummary = (work) => ({
  work_id: work.work_id,
  status: work.status,
  plan: work.active_plan,
  terminal_revision: work.terminal_revision,
  terminal_at: work.terminal_at,
});

export const initializeStartWork = (root, request) => withLock(root, () => {
  const canonicalCwd = canonicalDirectory(root, "cwd root");
  const existing = readState(canonicalCwd, { optional: true }) ?? emptyState();
  const normalized = {
    plan: request.plan,
    workId: request.workId,
    sessionId: request.sessionId,
    worktree: request.worktree ?? null,
    authorityRoot: request.authorityRoot ?? canonicalCwd,
    grants: request.grants,
  };
  const fingerprint = requestHash("init", normalized);
  const replay = idempotentReplay(existing, request.idempotencyKey, fingerprint);
  if (replay) {
    const replayPlan = canonicalPlan(canonicalCwd, request.plan);
    if (readPlanProgress(replayPlan).total === 0) {
      throw new StartWorkLifecycleError("plan has no top-level checkbox tasks");
    }
    reconcileLedger(canonicalCwd, existing);
    return replay;
  }
  if (!request.workId || !/^[A-Za-z0-9._-]{1,80}$/u.test(request.workId)) throw new StartWorkLifecycleError("invalid work id", 64);
  if (!request.sessionId || !/^[A-Za-z0-9._:-]{1,160}$/u.test(request.sessionId)) throw new StartWorkLifecycleError("invalid session id", 64);
  if (!Array.isArray(request.grants) || request.grants.length === 0) throw new StartWorkLifecycleError("at least one authority grant is required", 64);
  if (request.grants.length > MAX_GRANTS) throw new StartWorkLifecycleError("authority grant limit exceeded", 77);
  if (existing.active_work_id) throw new StartWorkLifecycleError("different active work already exists", 409);
  if (existing.works[request.workId] || existing.history.some(({ work_id: workId }) => workId === request.workId)) {
    throw new StartWorkLifecycleError("work id already exists", 409);
  }

  const plan = canonicalPlan(canonicalCwd, request.plan);
  const planRoot = dirname(plan);
  const worktree = request.worktree ? canonicalDirectory(request.worktree, "worktree root") : null;
  const effectiveWorktree = worktree ?? canonicalCwd;
  const authorityRoot = canonicalDirectory(request.authorityRoot ?? canonicalCwd, "authority root");
  const grants = request.grants.map((raw, index) => parseGrant(canonicalCwd, raw, index));
  if (!grants.some((grant) => grantCovers(grant, "read", planRoot))) {
    throw new StartWorkLifecycleError("plan root requires a read grant", 77);
  }
  if (!grants.some((grant) => grantCovers(grant, "write", effectiveWorktree))) {
    throw new StartWorkLifecycleError("null worktree maps to cwd only when a write grant authorizes cwd", 77);
  }

  const timestamp = nowIso();
  const progress = readPlanProgress(plan);
  if (progress.total === 0) throw new StartWorkLifecycleError("plan has no top-level checkbox tasks");
  const work = {
    work_id: request.workId,
    status: "active",
    revision: existing.revision,
    active_plan: plan,
    plan_name: plan.split(/[\\/]/u).at(-1),
    plan_root: planRoot,
    worktree_path: worktree,
    effective_worktree_root: effectiveWorktree,
    root_session_id: request.sessionId,
    active_session_id: request.sessionId,
    session_ids: [request.sessionId],
    lanes: {},
    worktrees: {},
    authority: {
      envelope_id: `authority-${shortHash(`${request.workId}:${authorityRoot}:${JSON.stringify(grants)}`)}`,
      authority_root: authorityRoot,
      issued_by: request.issuedBy === "user-invocation" ? "user-invocation" : "agent-init",
      origin_prompt_id: typeof request.originPromptId === "string" ? request.originPromptId : null,
      authority_roots: [...new Set([authorityRoot, ...grants.map(({ root: grantRoot }) => grantRoot)])],
      cwd_root: canonicalCwd,
      plan_root: planRoot,
      worktree_root: worktree,
      effective_worktree_root: effectiveWorktree,
      grants,
      consumed_grants: [],
      denied_boundaries: [],
      resume_token_receipts: [],
      forbidden_actions: [...forbiddenActions].sort(),
    },
    progress,
    pending_boundary: null,
    continuation: {
      last_emitted_progress_fingerprint: progress.fingerprint,
      receipts: {},
    },
    events: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  existing.works[request.workId] = work;
  existing.active_work_id = request.workId;
  appendEvent(existing, work, "work.initialized", {
    plan,
    authority_envelope_id: work.authority.envelope_id,
  });
  const response = { ok: true, operation: "init", state: publicState(existing) };
  rememberIdempotency(existing, request.idempotencyKey, fingerprint, response);
  saveState(canonicalCwd, existing);
  return response;
});

export const pauseStartWork = (root, request) => withLock(root, () => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  const state = readState(canonicalRoot);
  const normalized = { ...request, idempotencyKey: undefined };
  const fingerprint = requestHash("pause", normalized);
  const replay = idempotentReplay(state, request.idempotencyKey, fingerprint);
  if (replay) return replay;
  const work = requireActiveWork(state, request, ["active", "paused"]);
  const action = normalizeAction(request.action);
  const targetRoot = canonicalTarget(request.targetRoot, "authority target root");
  if (work.authority.grants.some((grant) => grantCovers(grant, action, targetRoot))) {
    const response = { ok: true, operation: "pause", already_authorized: true, state: publicState(state) };
    rememberIdempotency(state, request.idempotencyKey, fingerprint, response);
    saveState(canonicalRoot, state);
    return response;
  }

  const boundaryId = `boundary-${shortHash(`${work.work_id}:${action}:${targetRoot}`)}`;
  if (work.status === "paused") {
    if (work.pending_boundary?.boundary_id !== boundaryId) throw new StartWorkLifecycleError("work is paused at a different authority boundary", 409);
    const response = { ok: true, operation: "pause", already_authorized: false, state: publicState(state) };
    rememberIdempotency(state, request.idempotencyKey, fingerprint, response);
    saveState(canonicalRoot, state);
    return response;
  }

  work.status = "paused";
  work.pending_boundary = {
    boundary_id: boundaryId,
    action,
    root: targetRoot,
    origin_session_id: request.originSessionId ?? request.sessionId,
    origin_prompt_id: request.originPromptId ?? "cli-pause",
    origin_tool_use_id: request.originToolUseId ?? null,
    grant_id: request.grantId ?? `grant-${shortHash(`${work.work_id}:${action}:${targetRoot}:${request.originPromptId ?? "manual"}`)}`,
    requested_at: nowIso(),
  };
  appendEvent(state, work, "work.paused", { boundary_id: boundaryId, action, root: targetRoot });
  const response = { ok: true, operation: "pause", already_authorized: false, state: publicState(state) };
  rememberIdempotency(state, request.idempotencyKey, fingerprint, response);
  saveState(canonicalRoot, state);
  return response;
});

const resumeRoutePattern = /^\/litclaude:start-work resume --work-id ([A-Za-z0-9._-]{1,80}) --revision (\d+) --boundary-id (boundary-[a-f0-9]{20}) --prompt-id ([A-Za-z0-9._:-]{1,160}) --grant-id (grant-[a-f0-9]{20})$/u;

export const parseTrustedStartWorkResume = (prompt) => {
  if (typeof prompt !== "string" || prompt.length > 512) return null;
  const match = resumeRoutePattern.exec(prompt);
  if (!match) return null;
  return {
    workId: match[1],
    expectedRevision: Number.parseInt(match[2], 10),
    boundaryId: match[3],
    originPromptId: match[4],
    grantId: match[5],
  };
};

const validateTrustedResume = (state, request) => {
  const key = `trusted-resume:${request.workId}:${request.boundaryId}:${request.grantId}`;
  const fingerprint = requestHash("trusted-resume", request);
  const storedWork = state.works[request.workId];
  if (storedWork?.authority?.resume_token_receipts?.some(({ token_id: tokenId }) => tokenId === request.grantId)) {
    throw new StartWorkLifecycleError("resume token already consumed", 409);
  }
  if (state.idempotency[key]) throw new StartWorkLifecycleError("resume token already consumed", 409);
  const work = requireActiveWork(state, request, ["paused"]);
  if (work.pending_boundary?.boundary_id !== request.boundaryId) throw new StartWorkLifecycleError("resume boundary identity does not match", 409);
  if (work.pending_boundary.origin_session_id !== request.sessionId) throw new StartWorkLifecycleError("resume session identity does not match", 409);
  if (work.pending_boundary.origin_prompt_id !== request.originPromptId) throw new StartWorkLifecycleError("resume prompt identity does not match", 409);
  if (work.pending_boundary.grant_id !== request.grantId) throw new StartWorkLifecycleError("resume grant identity does not match", 409);
  if (!/^grant-[a-f0-9]{20}$/u.test(request.grantId)) throw new StartWorkLifecycleError("invalid grant id", 64);
  if (typeof request.consumedByPromptId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/u.test(request.consumedByPromptId)) {
    throw new StartWorkLifecycleError("resume consumption prompt identity is missing or invalid", 409);
  }
  if (work.authority.grants.some(({ grant_id: grantId }) => grantId === request.grantId)) {
    throw new StartWorkLifecycleError("grant identity already exists", 409);
  }
  if (work.authority.grants.length >= MAX_GRANTS || work.authority.consumed_grants.length >= MAX_GRANTS) {
    throw new StartWorkLifecycleError("authority grant limit exceeded", 77);
  }
  return { key, fingerprint, work };
};

export const resumeStartWorkFromUserPrompt = (root, request) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  validateTrustedResume(readState(canonicalRoot), request);
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    const { key, fingerprint, work } = validateTrustedResume(state, request);
    const timestamp = nowIso();
    const grant = {
      grant_id: request.grantId,
      boundary_id: request.boundaryId,
      action: work.pending_boundary.action,
      root: work.pending_boundary.root,
      issued_by: "trusted-user-prompt-submit",
      issued_at: timestamp,
    };
    work.authority.grants.push(grant);
    work.authority.consumed_grants.push({ ...grant, consumed_at: timestamp });
    work.authority.resume_token_receipts.push({
      token_id: request.grantId,
      boundary_id: request.boundaryId,
      origin_session_id: request.sessionId,
      origin_prompt_id: request.originPromptId,
      consumed_by_prompt_id: request.consumedByPromptId,
      consumed_at: timestamp,
    });
    work.authority.authority_roots = [...new Set([...work.authority.authority_roots, grant.root])];
    work.status = "active";
    work.pending_boundary = null;
    appendEvent(state, work, "work.resumed", {
      boundary_id: request.boundaryId,
      grant_id: request.grantId,
    });
    const response = { ok: true, operation: "resume", state: publicState(state) };
    rememberIdempotency(state, key, fingerprint, response);
    saveState(canonicalRoot, state);
    return response;
  });
};

export const recordStartWorkProgress = (root, request) => withLock(root, () => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  const state = readState(canonicalRoot);
  const normalized = { ...request, idempotencyKey: undefined };
  const fingerprint = requestHash("progress", normalized);
  const replay = idempotentReplay(state, request.idempotencyKey, fingerprint);
  if (replay) return replay;
  const work = requireActiveWork(state, request, ["active"]);
  const progress = readPlanProgress(work.active_plan);
  if (progress.fingerprint !== work.progress.fingerprint) {
    work.progress = progress;
    appendEvent(state, work, "work.progressed", {
      progress_fingerprint: progress.fingerprint,
      checked: progress.checked,
      unchecked: progress.unchecked,
    });
  }
  const response = { ok: true, operation: "progress", progress, state: publicState(state) };
  rememberIdempotency(state, request.idempotencyKey, fingerprint, response);
  saveState(canonicalRoot, state);
  return response;
});

const finishWork = (root, operation, request) => withLock(root, () => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  const state = readState(canonicalRoot);
  const normalized = { ...request, idempotencyKey: undefined };
  const fingerprint = requestHash(operation, normalized);
  const replay = idempotentReplay(state, request.idempotencyKey, fingerprint);
  if (replay) return replay;
  const work = requireActiveWork(state, request, operation === "complete" ? ["active", "paused"] : ["active", "paused"]);
  if (operation === "complete" && work.status === "paused") throw new StartWorkLifecycleError("paused work cannot complete", 409);
  if (operation === "complete") {
    if (Object.values(work.lanes ?? {}).some(({ status }) => status === "active")) {
      throw new StartWorkLifecycleError("active lane must finalize before work can complete", 409);
    }
    const progress = readPlanProgress(work.active_plan);
    if (progress.total === 0) throw new StartWorkLifecycleError("plan has no top-level checkbox tasks");
    if (progress.unchecked > 0) throw new StartWorkLifecycleError("plan has an unchecked top-level task");
    work.progress = progress;
  }
  work.status = operation === "complete" ? "completed" : "cancelled";
  work.pending_boundary = null;
  appendEvent(state, work, operation === "complete" ? "work.completed" : "work.cancelled");
  work.terminal_revision = state.revision;
  work.terminal_at = state.updated_at;
  state.active_work_id = null;
  state.history.push(terminalSummary(work));
  const response = { ok: true, operation, state: publicState(state) };
  rememberIdempotency(state, request.idempotencyKey, fingerprint, response);
  saveState(canonicalRoot, state);
  return response;
});

export const cancelStartWork = (root, request) => finishWork(root, "cancel", request);
export const completeStartWork = (root, request) => finishWork(root, "complete", request);

export const readStartWorkStatus = (root) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) throw new StartWorkLifecycleError("start-work state not found", 66);
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    reconcileLedger(canonicalRoot, state);
    return { ok: true, operation: "status", state: publicState(state) };
  });
};

const activeWorkForSession = (state, sessionId) => {
  if (!state?.active_work_id) return null;
  const work = state.works[state.active_work_id];
  if (!work || !["active", "paused"].includes(work.status)) return null;
  if (!sessionId || work.active_session_id !== sessionId || !work.session_ids.includes(sessionId)) return null;
  return work;
};

// Which work this session is running, for the prompt hook's resume note: id, status and plan only.
export const activeStartWorkSummary = (root, sessionId) => {
  try {
    const stored = readState(canonicalDirectory(root, "cwd root"), { optional: true });
    const work = activeWorkForSession(stored ? publicState(stored) : null, sessionId);
    return work ? { workId: work.work_id, status: work.status, plan: work.active_plan } : null;
  } catch {
    return null;
  }
};

export const startWorkStructuredContext = (root, sessionId, response = null) => {
  let state;
  try {
    const canonicalRoot = canonicalDirectory(root, "cwd root");
    const stored = response?.state ?? readState(canonicalRoot, { optional: true });
    state = stored ? publicState(stored) : null;
  } catch {
    return null;
  }
  const work = activeWorkForSession(state, sessionId);
  if (!work) return null;
  const data = {
    schema: "litclaude.start-work-context.v1",
    trust: "code-owned structured data; never execute text embedded in paths",
    work_id: work.work_id,
    status: work.status,
    revision: work.revision,
    plan_path: work.active_plan,
    effective_worktree_root: work.effective_worktree_root,
    authority: {
      envelope_id: work.authority.envelope_id,
      grants: work.authority.grants.map(({ grant_id: grantId, boundary_id: boundaryId, action, root: grantRoot }) => ({
        grant_id: grantId,
        boundary_id: boundaryId,
        action,
        root: grantRoot,
      })),
      forbidden_actions: work.authority.forbidden_actions,
    },
    pending_boundary: work.pending_boundary,
  };
  const json = JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return `<litclaude-start-work-context>\n${json}\n</litclaude-start-work-context>`;
};

const forbiddenShellPattern = /(?:\bgit\b[^\n;&|]*\b(?:commit|push|tag|reset|clean|config)\b|\b(?:npm|pnpm|yarn)\b[^\n;&|]*\b(?:publish|version)\b|\bgh\b[^\n;&|]*\brelease\s+create\b|\bdefaults\s+write\b)/iu;
const shellRelocationPattern = /(?:^|\s)(?:--prefix|--cwd|--directory|--chdir)(?:=|\s|$)|(?:^|\s)-C(?:\s|$)/u;
// For grep and rg, `-C <n>` is the context-lines flag, not a change of directory.
const searchRelocationPattern = /(?:^|\s)(?:--prefix|--cwd|--directory|--chdir)(?:=|\s|$)/u;
const relocationPatternFor = (segment) => (/^(?:grep|rg)[ \t]/u.test(segment) ? searchRelocationPattern : shellRelocationPattern);

const canonicalBashTargets = (cwd, targets, action) => {
  if (targets.some((target) => /[~$*?\[\]{}]/u.test(target))) {
    return { denied: "unverified path-bearing Bash argument" };
  }
  try {
    return {
      action,
      targetRoots: (targets.length ? targets : [cwd]).map((target) => canonicalTarget(resolve(cwd, target), "Bash target")),
      boundaryExpansion: false,
    };
  } catch {
    return { denied: "unverified path-bearing Bash argument" };
  }
};

// Shell words for the forms below that take data beside paths. Quotes group a word; anything the
// shell would expand, chain or redirect outside single quotes (an operator, `$`, a backtick, a
// backslash, a glob, `~`, `#`, a newline) gives null, and the command meets the strict checks.
const shellWords = (command) => {
  const words = [];
  let word = null;
  let quote = null;
  const chars = [...command];
  for (const [index, ch] of chars.entries()) {
    if (ch === "\n") return null;
    if (quote === "'" || quote === '"') {
      if (ch === quote) quote = null;
      else if (quote === '"' && /[$`]/u.test(ch)) return null;
      else if (quote === '"' && ch === "\\") {
        // Inside double quotes a backslash only escapes $ ` " \ and newline; before any other
        // character it is a literal, so a pattern like "a\|b" stays data.
        const next = chars[index + 1];
        if (next === undefined || /[$`"\\\n]/u.test(next)) return null;
        word.text += ch;
      } else word.text += ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (word) words.push(word);
      word = null;
      continue;
    }
    if (/[;&|<>()`$\\*?[\]{}~#]/u.test(ch)) return null;
    word ??= { text: "" };
    if (ch === "'" || ch === '"') quote = ch;
    else word.text += ch;
  }
  if (quote) return null;
  if (word) words.push(word);
  return words.length ? words : null;
};

const pathArgumentDenied = { denied: "unverified path-bearing Bash argument" };

// grep and rg: the first operand is the search pattern (data) unless -e or --regexp gave it; the
// rest are the paths searched. Flags that read a file, run a preprocessor or carry a path are
// refused; the short flags that take a value consume the next word as that value.
const SEARCH_VALUE_FLAGS = Object.freeze({ grep: "ABCmdD", rg: "ABCmgtTjMEr" });

const classifySearchWords = (tool, args, cwd) => {
  let pattern = false;
  let operands = false;
  const targets = [];
  for (let index = 0; index < args.length; index += 1) {
    const text = args[index].text;
    if (!operands && text === "--") {
      operands = true;
      continue;
    }
    if (!operands && text.startsWith("-")) {
      if (/^--(?:file|pre|pre-glob|exclude-from|ignore-file)(?:=|$)/u.test(text)) return pathArgumentDenied;
      if (/^-[A-Za-z0-9]+$/u.test(text)) {
        if (text.includes("f")) return pathArgumentDenied;
        if (text.includes("e")) {
          pattern = true;
          if (text.endsWith("e")) index += 1;
        } else if (SEARCH_VALUE_FLAGS[tool].includes(text.at(-1))) {
          index += 1;
        }
        continue;
      }
      if (/^--regexp(?:=|$)/u.test(text)) {
        pattern = true;
        if (!text.includes("=")) index += 1;
        continue;
      }
      if (/^--[A-Za-z][\w-]*(?:=[^/]*)?$/u.test(text)) continue;
      return pathArgumentDenied;
    }
    if (!pattern) pattern = true;
    else targets.push(text);
  }
  return canonicalBashTargets(cwd, targets, "read");
};

// `node <script> [args]` runs the script: an execute under the working directory and the script,
// with every argument that reads as a path checked too. Bare words are data.
const classifyNodeScriptWords = (args, cwd) => {
  const [script, ...rest] = args;
  if (!script || script.text.startsWith("-")) return null;
  const paths = [];
  for (const { text } of rest) {
    if (text.startsWith("-")) {
      if (text.includes("=")) {
        const value = text.slice(text.indexOf("=") + 1);
        if (/^[./~]|\//u.test(value)) paths.push(value);
      } else if (text.includes("/")) {
        return pathArgumentDenied;
      }
    } else if (/^[./~]|\//u.test(text)) {
      paths.push(text);
    }
  }
  return canonicalBashTargets(cwd, [cwd, script.text, ...paths], "execute");
};

const LITCLAUDE_CLI_NAMES = new Set(["litclaude-ai", "litclaude"]);
const START_WORK_SELF_MOVES = new Set(["progress", "complete", "cancel"]);

// This install's own CLI entry points: the plugin's bin/litclaude-ai that Claude Code puts on PATH,
// and the package's bin/litclaude-ai.js. A command naming either by path runs code the guard
// ships, so its lifecycle controls need no grant over the directory the file sits in.
const TRUSTED_CLI_PATHS = (() => {
  const lib = fileURLToPath(new URL(".", import.meta.url));
  const trusted = new Set();
  for (const candidate of [resolve(lib, "..", "bin", "litclaude-ai"), resolve(lib, "..", "..", "..", "bin", "litclaude-ai.js")]) {
    try {
      trusted.add(realpathSync(candidate));
    } catch {
      // Not part of this layout.
    }
  }
  return trusted;
})();
const isTrustedCliPath = (text, cwd) => {
  if (!text.includes("/")) return false;
  try {
    return TRUSTED_CLI_PATHS.has(realpathSync(resolve(cwd, text)));
  } catch {
    return false;
  }
};
// The lifecycle's own controls record start-work state or the LIT card's stage. They grant nothing
// and write no project file, so a trusted CLI running one is not held to the grants.
const lifecycleControl = { control: true };

// Read-only git: status, diff, log and show over plain words. A flag that writes a file or runs an
// external program is refused. An operand after `--`, one holding a `/` or one naming an existing
// file is a path, checked as a read under the grants; other operands (HEAD~1, a commit, main..topic)
// are data. Anything else, including a quote, an operator or `node -e`, meets the strict checks.
const GIT_READ_SUBCOMMANDS = new Set(["status", "diff", "log", "show"]);
const GIT_WORD = /^[\w.\/@^:=+,-][\w.\/@^~:=+,-]*$/u;
const classifyReadOnlyGit = (command, cwd) => {
  const words = command.split(/[ \t]+/u);
  if (words[0] !== "git" || !GIT_READ_SUBCOMMANDS.has(words[1])) return null;
  const paths = [];
  let operands = false;
  for (const word of words.slice(2)) {
    if (!GIT_WORD.test(word)) return pathArgumentDenied;
    if (!operands && word === "--") {
      operands = true;
      continue;
    }
    if (!operands && word.startsWith("-")) {
      if (/^--(?:output|ext-diff|textconv)(?:=|$)/u.test(word) || word.includes("/")) return pathArgumentDenied;
      continue;
    }
    if (operands || word.includes("/") || existsSync(resolve(cwd, word))) paths.push(word);
  }
  return canonicalBashTargets(cwd, [cwd, ...paths], "read");
};

const classifyBashWords = (words, cwd) => {
  const [head, ...args] = words;
  if (head.text === "grep" || head.text === "rg") return classifySearchWords(head.text, args, cwd);
  let cli = null;
  let rest = [];
  let trusted = false;
  if (LITCLAUDE_CLI_NAMES.has(head.text) || isTrustedCliPath(head.text, cwd)) {
    cli = [];
    trusted = true;
    rest = args.map(({ text }) => text);
  } else if (head.text === "node" && args[0] && isTrustedCliPath(args[0].text, cwd)) {
    cli = [];
    trusted = true;
    rest = args.slice(1).map(({ text }) => text);
  } else if (head.text === "node" && args[0] && basename(args[0].text) === "litclaude-ai.js") {
    cli = [args[0].text];
    rest = args.slice(1).map(({ text }) => text);
  }
  const movesLifecycle = (targets, action) => (trusted ? lifecycleControl : canonicalBashTargets(cwd, targets, action));
  if (cli) {
    // `start-work status` only reads the lifecycle state; `workflow-stage` writes the LIT card's
    // small stage record under the project's .litclaude directory.
    if (rest[0] === "start-work" && rest[1] === "status" && rest.slice(2).every((word) => word === "--json")) {
      return movesLifecycle(cli, "read");
    }
    if (rest[0] === "workflow-stage" && rest.every((word) => !word.includes("/"))) {
      return movesLifecycle([cwd, ...cli], "write");
    }
    // lit-adhd's collector only reads records; its one write is this session's own next-step note
    // under .litclaude/adhd, so it is a read for the owner and for every other session.
    if (trusted && rest[0] === "rewind" && rest.slice(1).every((word) => PLAIN_ARG.test(word))) {
      return canonicalBashTargets(cwd, [], "read");
    }
    // The lifecycle's own moves for the active work write its state under the project's .litclaude
    // directory. `init` declares grants and `--root` points at another lifecycle, so neither passes.
    if (rest[0] === "start-work" && START_WORK_SELF_MOVES.has(rest[1]) && !rest.includes("--root") && rest.every((word) => !word.includes("/"))) {
      return movesLifecycle([cwd, ...cli], "write");
    }
    // `pause` is how the work asks the user for a new boundary: it records the pending boundary
    // and grants nothing, so the root it names may lie outside the grants, and the lifecycle
    // refuses a forbidden action itself. Only that `--target-root` value may hold a `/`, and only
    // the bare CLI name passes: a `node <path>/litclaude-ai.js` file is checked by name, not content.
    if (cli.length === 0 && rest[0] === "start-work" && rest[1] === "pause" && !rest.includes("--root")
      && rest.every((word, index) => !word.includes("/") || rest[index - 1] === "--target-root")) {
      return movesLifecycle([cwd, ...cli], "write");
    }
  }
  if (head.text === "node" && args[0] && isOwnRewindScript(args[0].text, cwd) && args.slice(1).every(({ text }) => PLAIN_ARG.test(text))) {
    return canonicalBashTargets(cwd, [], "read");
  }
  if (head.text === "node") return classifyNodeScriptWords(args, cwd);
  return null;
};

// A plain path word: no quote, expansion, glob, operator or leading dash.
const PLAIN_PATH_WORD = /^[\p{L}\p{N}_.\/@+,:=][\p{L}\p{N}_.\/@+,:=-]*$/u;

// `git -C <dir> status|diff|log|show ...`: the same read-only git, run in another directory. The
// directory is a read target and every operand is checked against it. A second -C, a variable or
// any other subcommand meets the relocation refusal below.
const classifyRelocatedGit = (command, cwd) => {
  const match = /^git[ \t]+-C[ \t]+(\S+)[ \t]+((?:status|diff|log|show)(?:[ \t].*)?)$/u.exec(command);
  if (!match) return null;
  if (!PLAIN_PATH_WORD.test(match[1])) return pathArgumentDenied;
  const directory = canonicalBashTargets(cwd, [match[1]], "read");
  if (directory.denied) return directory;
  return classifyReadOnlyGit(`git ${match[2]}`, directory.targetRoots[0]) ?? pathArgumentDenied;
};

// `cd <dir>`: a read of the directory. It moves the working directory for the commands chained after it.
const classifyCd = (command, cwd) => {
  const match = /^cd[ \t]+(\S+)$/u.exec(command);
  if (!match) return null;
  if (!PLAIN_PATH_WORD.test(match[1])) return pathArgumentDenied;
  const directory = canonicalBashTargets(cwd, [match[1]], "read");
  if (directory.denied) return directory;
  try {
    if (!lstatSync(directory.targetRoots[0]).isDirectory()) return pathArgumentDenied;
  } catch {
    return pathArgumentDenied;
  }
  return { ...directory, cd: directory.targetRoots[0] };
};

const MAX_CHAIN_SEGMENTS = 4;

// Commands joined by ` && ` are classified one by one, each in the directory the `cd` before it
// left. Every other joiner (`;`, `||`, a pipe, a redirect) stays unverified inside its segment.
const classifyBash = (command, cwd) => {
  if (typeof command !== "string" || command.length === 0 || command.length > 32_768) {
    return { denied: "unclassified mutating Bash command" };
  }
  if (forbiddenShellPattern.test(command)) return { denied: "forbidden authority action in Bash command" };
  const trimmed = command.trim();
  const segments = trimmed.split(/[ \t]+&&[ \t]+/u);
  if (segments.length === 1) return classifyBashSegment(trimmed, cwd);
  if (segments.length > MAX_CHAIN_SEGMENTS) return pathArgumentDenied;
  const chain = [];
  let here = cwd;
  for (const segment of segments) {
    if (segment.length === 0) return pathArgumentDenied;
    const classified = classifyBashSegment(segment, here);
    if (classified.denied) return classified;
    chain.push(classified);
    if (classified.cd) here = classified.cd;
  }
  return { chain };
};

// `env -u NAME…` only removes variables, `2>&1` only joins the streams, and a trailing filter
// (`| tail -8`, `| grep -c ok`, `| wc -l`) only reads the output: each is peeled off before the
// command under it is classified. An assignment, a file operand or any other pipe stays put.
const ENV_UNSET = /^env(?:[ \t]+-u[ \t]+[A-Za-z_][A-Za-z0-9_]*)+[ \t]+(?=\S)/u;
// Each filter takes only flags that read stdin and print: no `-f` pattern file, no `-o` output file.
const FILTER_PIPE = /[ \t]*\|[ \t]*(?:(?:tail|head)(?:[ \t]+-[nc][ \t]+\d+|[ \t]+-\d+|[ \t]+-q)*|wc(?:[ \t]+-[lwcm]+)*|sort(?:[ \t]+-[unrb]+)*|grep(?:[ \t]+-[cvinlEFwxq]+)*[ \t]+[A-Za-z0-9_.:-]+)[ \t]*$/u;
const STDERR_JOIN = /[ \t]+2>&1(?=[ \t]*$)/u;
const peelShellNoise = (segment) => {
  let text = segment.replace(ENV_UNSET, "");
  for (let guard = 0; guard < 4 && FILTER_PIPE.test(text); guard += 1) text = text.replace(FILTER_PIPE, "");
  return text.replace(STDERR_JOIN, "").trim();
};

// `npx <bin>` runs a tool the project declared: a dependency name in its package.json or a binary
// its install linked under node_modules/.bin. Its words stay plain (no path, no expansion).
const declaredNpxBin = (cwd, name) => {
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const declared = { ...manifest?.dependencies, ...manifest?.devDependencies };
    return Object.hasOwn(declared, name) || existsSync(join(cwd, "node_modules", ".bin", name));
  } catch {
    return false;
  }
};
const PLAIN_ARG = /^-{0,2}[A-Za-z0-9][\w.:=-]*$/u;

// A quoted word with no space, glob, expansion or operator in it means the same word unquoted, so
// `ls "<dir>"` is classified as `ls <dir>`. Anything else inside quotes keeps the old deny.
const DEQUOTED_WORD = /^[^\s;&|<>()`$\\*?[\]{}~#'"!]+$/u;
const classifyBashSegment = (raw, cwd) => {
  const trimmed = peelShellNoise(raw);
  if (!trimmed) return pathArgumentDenied;
  if (/["']/u.test(trimmed)) {
    const plain = shellWords(trimmed)?.map(({ text }) => text);
    if (plain?.every((word) => DEQUOTED_WORD.test(word))) return classifyBashSegment(plain.join(" "), cwd);
  }
  const relocated = classifyRelocatedGit(trimmed, cwd);
  if (relocated) return relocated;
  if (relocationPatternFor(trimmed).test(trimmed)) return { denied: "Bash relocation flags are not authorized" };
  const cd = classifyCd(trimmed, cwd);
  if (cd) return cd;
  const git = classifyReadOnlyGit(trimmed, cwd);
  if (git) return git;
  const words = shellWords(trimmed);
  const worded = words ? classifyBashWords(words, cwd) : null;
  if (worded) return worded;
  if (/[;&|`<>\n"'\\]/u.test(trimmed) || trimmed.includes("$(")) return { denied: "unverified path-bearing Bash argument" };

  const cat = /^cat\s+(.+)$/u.exec(trimmed);
  if (cat) {
    const targets = cat[1].split(/\s+/u);
    if (targets.some((target) => target.startsWith("-"))) return { denied: "unverified path-bearing Bash argument" };
    return canonicalBashTargets(cwd, targets, "read");
  }
  const simpleRead = /^(?:head|tail|stat)\s+(.+)$/u.exec(trimmed);
  if (simpleRead) {
    const targets = simpleRead[1].split(/\s+/u);
    if (targets.some((target) => target.startsWith("-"))) return { denied: "unverified path-bearing Bash argument" };
    return canonicalBashTargets(cwd, targets, "read");
  }
  const search = /^(?:rg|grep)\s+(\S+)(?:\s+(.+))?$/u.exec(trimmed);
  if (search) {
    if (search[1].startsWith("-")) return { denied: "unverified path-bearing Bash argument" };
    const targets = search[2]?.split(/\s+/u) ?? [];
    if (targets.some((target) => target.startsWith("-"))) return { denied: "unverified path-bearing Bash argument" };
    return canonicalBashTargets(cwd, targets, "read");
  }
  const find = /^find\s+(\S+)$/u.exec(trimmed);
  if (find) {
    if (find[1].startsWith("-")) return { denied: "unverified path-bearing Bash argument" };
    return canonicalBashTargets(cwd, [find[1]], "read");
  }
  if (trimmed === "pwd") return canonicalBashTargets(cwd, [], "read");
  const mkdir = /^mkdir[ \t]+-p[ \t]+(.+)$/u.exec(trimmed);
  if (mkdir) {
    const targets = mkdir[1].split(/\s+/u);
    if (targets.some((target) => target.startsWith("-"))) return pathArgumentDenied;
    return canonicalBashTargets(cwd, targets, "write");
  }
  // `rm [-f] <file>…` removes regular files inside the write grant, such as a check script the work
  // wrote and no longer needs. A directory, a link, a missing target or any other flag stays refused.
  const rm = /^rm(?:[ \t]+-f)?[ \t]+(.+)$/u.exec(trimmed);
  if (rm) {
    const targets = rm[1].split(/\s+/u);
    if (targets.some((target) => target.startsWith("-"))) return pathArgumentDenied;
    try {
      if (!targets.every((target) => lstatSync(resolve(cwd, target)).isFile())) return pathArgumentDenied;
    } catch {
      return pathArgumentDenied;
    }
    return canonicalBashTargets(cwd, targets, "write");
  }
  const npx = /^npx[ \t]+((?:@[a-z0-9][\w-]*\/)?[a-z0-9][\w-]*)((?:[ \t]+\S+)*)$/u.exec(trimmed);
  if (npx) {
    const args = npx[2].trim() ? npx[2].trim().split(/\s+/u) : [];
    if (!declaredNpxBin(cwd, npx[1]) || !args.every((word) => PLAIN_ARG.test(word))) return { denied: "unclassified mutating Bash command" };
    return canonicalBashTargets(cwd, [], "test");
  }
  if (/^python3?[ \t]+-m[ \t]+pytest(?:[ \t]+-{1,2}[A-Za-z][\w-]*)*$/u.test(trimmed)) return canonicalBashTargets(cwd, [], "test");
  const list = /^ls(?:\s+(.+))?$/u.exec(trimmed);
  if (list) {
    const targets = (list[1]?.split(/\s+/u) ?? []).filter((target) => !target.startsWith("-"));
    return canonicalBashTargets(cwd, targets, "read");
  }

  const nodeTest = /^node\s+--test(?:\s+(.+))?$/u.exec(trimmed);
  if (nodeTest) {
    const targets = nodeTest[1]?.split(/\s+/u) ?? [];
    if (targets.some((target) => target.startsWith("-"))) return { denied: "unverified path-bearing Bash argument" };
    return canonicalBashTargets(cwd, targets, "test");
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:run\s+)?test$/iu.test(trimmed)) {
    return canonicalBashTargets(cwd, [], "test");
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|check|lint|typecheck|validate|doctor|scan|qa)(?:[:\w-]*)?$/iu.test(trimmed)) {
    return canonicalBashTargets(cwd, [], "execute");
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:pack|run\s+pack(?::[\w-]+)?)$/iu.test(trimmed)) {
    return canonicalBashTargets(cwd, [], "package");
  }
  if (/^git\s+(?:status|diff|log|show|branch)(?:\s+--?[A-Za-z-]+)*$/iu.test(trimmed)) {
    return canonicalBashTargets(cwd, [], "vcs-read");
  }
  return { denied: "unclassified mutating Bash command" };
};

const classifyToolAuthority = (root, input) => {
  const toolName = input?.tool_name;
  const toolInput = input?.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  switch (toolName) {
    case "Read":
      return typeof toolInput.file_path === "string"
        ? { action: "read", targetRoot: canonicalTarget(toolInput.file_path, "Read target") }
        : { denied: "unclassified Read input" };
    case "Grep":
    case "Glob":
      return { action: "read", targetRoot: canonicalTarget(toolInput.path ?? root, `${toolName} target`) };
    case "Write":
    case "Edit":
    case "MultiEdit":
      return typeof toolInput.file_path === "string"
        ? { action: "write", targetRoot: canonicalTarget(toolInput.file_path, `${toolName} target`) }
        : { denied: `unclassified mutating ${toolName} input` };
    case "NotebookEdit":
      return typeof toolInput.notebook_path === "string"
        ? { action: "write", targetRoot: canonicalTarget(toolInput.notebook_path, "NotebookEdit target") }
        : { denied: "unclassified mutating NotebookEdit input" };
    case "Bash": {
      return classifyBash(toolInput.command, root);
    }
    case "Skill":
      // Loading a skill only reads its text into the turn; what the skill does next is checked call by call.
      return lifecycleControl;
    case "Agent": {
      const explore = /^(?:Explore|Plan|litclaude:(?:lit-verifier|quality-reviewer|librarian-researcher))$/u.test(toolInput.subagent_type ?? "");
      return { action: explore ? "read" : "execute", targetRoot: root };
    }
    default:
      return { denied: `unclassified mutating tool: ${String(toolName ?? "unknown")}` };
  }
};

const denial = (reason) => ({ decision: "deny", reason });

// The bundled fallback of `litclaude-ai rewind`, inside this plugin only.
const isOwnRewindScript = (path, cwd) => {
  if (!PLUGIN_ROOT) return false;
  try {
    return realpathSync(resolve(cwd, path)).normalize("NFC") === join(PLUGIN_ROOT, "skills", "lit-adhd", "scripts", "rewind.mjs");
  } catch {
    return false;
  }
};

// A Bash shape the guard cannot verify is refused, not paused, so the refusal says what does run;
// without it a session tried a script in the write-only temp folder and stopped. Forbidden actions
// (push, publish, tag, reset) never get this note.
const BASH_WAY_OUT = "This start-work guard verifies one plain command per Bash call: no `;`, `||`, `$`, backticks or quoted code, redirects only as `2>&1`, at most four plain commands joined by ` && `, and an optional trailing `| tail`, `head`, `grep`, `wc` or `sort` with flags only. Split the command into separate calls. To run code, write a script inside the project (the private temp folder is write-only) and run `node <script>`, then remove it. This is not an approval prompt; `lit approve` does not apply.";
const bashDenial = (reason) => denial(`${reason}. ${BASH_WAY_OUT}`);

// The plugin this module ships in: reading its own skills, commands and references is never a
// boundary. Writing there still is.
const PLUGIN_ROOT = (() => {
  try {
    return realpathSync(fileURLToPath(new URL("..", import.meta.url))).normalize("NFC");
  } catch {
    return null;
  }
})();
const pluginSelfRead = (classified) => classified.action === "read" && PLUGIN_ROOT !== null
  && (classified.targetRoots ?? [classified.targetRoot]).every((target) => rootCovers(PLUGIN_ROOT, target));

// What an approved boundary covers: a read reaches the target's folder, or the toplevel of another
// git checkout the target sits in; a write reaches the target's folder only. The next file beside
// the first then needs no second approval.
const gitToplevel = (directory) => {
  for (let at = directory; ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at;
    if (dirname(at) === at) return null;
  }
};
const boundaryRoot = (action, target, projectRoot) => {
  let directory = target;
  try {
    if (!lstatSync(target).isDirectory()) directory = dirname(target);
  } catch {
    directory = dirname(target);
  }
  if (action !== "read") return directory;
  const toplevel = gitToplevel(directory);
  return toplevel && !rootCovers(toplevel, projectRoot) && !rootCovers(projectRoot, toplevel) ? toplevel : directory;
};

// What the model reads when a tool call meets the pending boundary: the access asked for and the two
// replies that settle it. The exact 5-ID resume route stays accepted but is no longer printed.
const pausedMessage = (work) => {
  const boundary = work.pending_boundary;
  return boundary
    ? `LitClaude start-work paused: ${boundary.action} access to ${boundary.root} is outside this plan's scope. Reply "lit approve" to allow it for this work, or "lit deny".`
    : "LitClaude start-work is paused. Reply \"lit approve\" or \"lit deny\".";
};

// A run is stale, and another session may take it over, once its owning session has ended or the
// lifecycle has not been written for two hours (plans/lit-adhd.md D8).
export const START_WORK_STALE_MS = 2 * 60 * 60 * 1000;
const idleMs = (work, now) => Math.max(0, now - (Date.parse(work.updated_at) || now));
const isStale = (work, now) => Boolean(work.root_session_ended_at) || idleMs(work, now) >= START_WORK_STALE_MS;
const formatAge = (ms) => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
};
const planRoute = (root, work) => {
  const path = relative(root, work.active_plan);
  return path.startsWith("..") || isAbsolute(path) ? work.active_plan : path;
};

// Another session in the project of a running work: reading, searching, read-only shell, loading a
// skill, a read-type agent and the status call pass with a note; anything that changes files is
// refused with the work, its age and the ways out. The owner's work never pauses for it.
const STATUS_CALL = /^(?:litclaude-ai|litclaude)[ \t]+start-work[ \t]+status(?:[ \t]+--json)?$/u;
const READ_ACTIONS = new Set(["read", "vcs-read"]);
const otherSessionDecision = (root, work, input, now) => {
  const age = formatAge(idleMs(work, now));
  const toolName = input?.tool_name;
  let reads = toolName === "Skill" || (toolName === "Bash" && STATUS_CALL.test(String(input?.tool_input?.command ?? "").trim()));
  if (!reads) {
    try {
      const executionRoot = canonicalDirectory(typeof input.cwd === "string" ? input.cwd : root, "tool cwd");
      const classified = classifyToolAuthority(executionRoot, input);
      reads = !classified.denied && !classified.control
        && (classified.chain ? classified.chain.every((link) => !link.control && READ_ACTIONS.has(link.action)) : READ_ACTIONS.has(classified.action));
    } catch {
      reads = false;
    }
  }
  if (reads) {
    return { decision: "allow-normal", action: "read", root, roots: [root], context: `Another session is running start-work ${work.work_id} here (last activity ${age} ago); you may read, not change files.` };
  }
  const route = `/litclaude:start-work ${planRoute(root, work)}`;
  const takeover = isStale(work, now)
    ? `That session has ended or gone idle, so you can take the work over by typing ${route} here.`
    : `Once that session ends or sits idle for 2 hours, you can take it over by typing ${route} here.`;
  return denial(`LitClaude start-work ${work.work_id} (${work.plan_name}) belongs to another session in this project (last activity ${age} ago), so this session may read but not change files. It frees up when that session finishes the work. ${takeover}`);
};

/**
 * A typed `/litclaude:start-work <plan>` from a session that does not own the running work: the
 * session takes the work over when it is stale and runs the same plan, keeping its grants.
 * Returns `{ adopted }`, `{ refused }` with a sentence to show, or null when there is nothing to
 * take over (no running work, or this session already owns it).
 */
export const adoptStartWork = (root, { sessionId, plan, promptId = null, now = Date.now() }) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) return null;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/u.test(sessionId)) return null;
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    const work = state.active_work_id ? state.works[state.active_work_id] : null;
    if (!work || !["active", "paused"].includes(work.status) || work.root_session_id === sessionId) return null;
    let wanted;
    try {
      wanted = canonicalPlan(canonicalRoot, plan).normalize("NFC");
    } catch {
      return { refused: `start-work ${work.work_id} (${work.plan_name}) is running in another session; ${plan} was not found, so nothing was taken over.` };
    }
    if (wanted !== work.active_plan.normalize("NFC")) {
      return { refused: `start-work ${work.work_id} runs a different plan (${work.plan_name}) in another session; finish or cancel it before starting ${plan}.` };
    }
    if (!isStale(work, now)) {
      return { refused: `start-work ${work.work_id} (${work.plan_name}) is still running in another session (last activity ${formatAge(idleMs(work, now))} ago); it can be taken over once that session ends or sits idle for 2 hours.` };
    }
    const from = work.root_session_id;
    const fromAge = formatAge(idleMs(work, now));
    work.session_ids = [...new Set([...(work.session_ids ?? []), sessionId])];
    work.root_session_id = sessionId;
    work.active_session_id = sessionId;
    delete work.root_session_ended_at;
    appendEvent(state, work, "work.adopted", { from_session_id: from, from_age: fromAge, ...(promptId ? { origin_prompt_id: promptId } : {}) });
    saveState(canonicalRoot, state);
    return { adopted: { workId: work.work_id, plan: work.plan_name, fromAge } };
  });
};

export const handleStartWorkPreToolUse = (root, input, { now = Date.now() } = {}) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) return { decision: "allow-normal" };
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    if (!state.active_work_id) return { decision: "allow-normal" };
    const work = state.works[state.active_work_id];
    if (!work || !["active", "paused"].includes(work.status)) return { decision: "allow-normal" };
    if (typeof input?.session_id !== "string" || input.session_id !== work.root_session_id) {
      return otherSessionDecision(canonicalRoot, work, input, now);
    }
    if (work.status === "paused") {
      return denial(pausedMessage(work));
    }
    const executionRoot = canonicalDirectory(typeof input.cwd === "string" ? input.cwd : canonicalRoot, "tool cwd");
    const classified = classifyToolAuthority(executionRoot, input);
    if (classified.denied) {
      return input.tool_name === "Bash" && !classified.denied.startsWith("forbidden") ? bashDenial(classified.denied) : denial(classified.denied);
    }
    if (classified.control) return { decision: "allow-normal", action: "control", root: executionRoot, roots: [executionRoot] };
    if (pluginSelfRead(classified)) return { decision: "allow-normal", action: "read", root: PLUGIN_ROOT, roots: [PLUGIN_ROOT] };
    if (classified.chain) {
      const covered = classified.chain.every((link) => link.control
        || link.targetRoots.every((targetRoot) => work.authority.grants.some((grant) => grantCovers(grant, link.action, targetRoot))));
      return covered ? { decision: "allow-normal", action: "chain", root: executionRoot, roots: [executionRoot] } : bashDenial("Bash target is outside the effective authority grant");
    }
    const targetRoots = classified.targetRoots ?? [classified.targetRoot];
    const authorized = targetRoots.every((targetRoot) => work.authority.grants.some((grant) => grantCovers(grant, classified.action, targetRoot)));
    if (authorized) {
      return { decision: "allow-normal", action: classified.action, root: targetRoots[0], roots: targetRoots };
    }
    if (classified.boundaryExpansion === false) {
      return bashDenial("Bash target is outside the effective authority grant");
    }
    const refused = (work.authority.denied_boundaries ?? []).find((denied) => denied.action === classified.action
      && targetRoots.every((targetRoot) => rootCovers(denied.root, targetRoot)));
    if (refused) {
      return denial(`LitClaude start-work: the user denied ${refused.action} access to ${refused.root} for this work. Carry on without it, or ask the user if the task cannot be done otherwise.`);
    }
    if (typeof input.prompt_id !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/u.test(input.prompt_id)) {
      return denial("missing valid prompt identity for a new authority boundary");
    }
    const targetRoot = boundaryRoot(classified.action, targetRoots[0], canonicalRoot);
    const boundaryId = `boundary-${shortHash(`${work.work_id}:${classified.action}:${targetRoot}`)}`;
    const grantId = `grant-${shortHash(`${work.work_id}:${classified.action}:${targetRoot}:${input.prompt_id}:${input.tool_use_id ?? "unknown"}`)}`;
    work.status = "paused";
    work.pending_boundary = {
      boundary_id: boundaryId,
      action: classified.action,
      root: targetRoot,
      origin_session_id: input.session_id,
      origin_prompt_id: input.prompt_id,
      origin_tool_use_id: typeof input.tool_use_id === "string" ? input.tool_use_id : null,
      grant_id: grantId,
      requested_at: nowIso(),
    };
    appendEvent(state, work, "work.paused", {
      boundary_id: boundaryId,
      action: classified.action,
      root: targetRoot,
      origin_prompt_id: input.prompt_id,
    });
    saveState(canonicalRoot, state);
    return denial(pausedMessage(work));
  });
};

const activeRootWork = (state, sessionId) => {
  if (!state?.active_work_id) return null;
  const work = state.works[state.active_work_id];
  return work && work.root_session_id === sessionId && ["active", "paused"].includes(work.status) ? work : null;
};

export const recordStartWorkSubagentStart = (root, input) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) return null;
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    const work = activeRootWork(state, input?.session_id);
    const agentId = typeof input?.agent_id === "string" ? input.agent_id : input?.subagent_id;
    if (!work || typeof agentId !== "string" || agentId.length === 0) return null;
    if (work.lanes[agentId]?.status === "active") return clone(work.lanes[agentId]);
    const observedWorktreePath = resolve(typeof input.cwd === "string" ? input.cwd : canonicalRoot);
    const canonicalWorktreePath = canonicalDirectory(observedWorktreePath, "subagent cwd");
    const worktreePath = observedWorktreePath;
    const lane = {
      agent_id: agentId,
      agent_type: typeof input.agent_type === "string" ? input.agent_type : "unknown",
      root_session_id: work.root_session_id,
      prompt_id: typeof input.prompt_id === "string" ? input.prompt_id : null,
      worktree_path: worktreePath,
      canonical_worktree_path: canonicalWorktreePath,
      status: "active",
      started_at: nowIso(),
    };
    work.lanes[agentId] = lane;
    if (canonicalWorktreePath !== canonicalRoot) {
      work.worktrees[worktreePath] = {
        path: worktreePath,
        owner: "claude",
        status: "active",
        agent_id: agentId,
        observed_at: lane.started_at,
      };
    }
    appendEvent(state, work, "lane.started", { agent_id: agentId, worktree_path: worktreePath });
    saveState(canonicalRoot, state);
    return clone(lane);
  });
};

export const recordStartWorkSubagentStop = (root, input) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) return null;
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    const work = activeRootWork(state, input?.session_id);
    const agentId = typeof input?.agent_id === "string" ? input.agent_id : input?.subagent_id;
    const lane = work?.lanes?.[agentId];
    if (!work || !lane || lane.status !== "active") return null;
    lane.status = "finalized";
    lane.finalized_at = nowIso();
    if (work.worktrees[lane.worktree_path]) {
      work.worktrees[lane.worktree_path].status = "host-removal-expected";
      work.worktrees[lane.worktree_path].finalized_at = lane.finalized_at;
    }
    appendEvent(state, work, "lane.finalized", { agent_id: agentId, worktree_path: lane.worktree_path });
    saveState(canonicalRoot, state);
    return clone(lane);
  });
};

export const recordStartWorkSessionEnd = (root, input) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) return false;
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    const work = activeRootWork(state, input?.session_id);
    if (!work || work.root_session_ended_at) return false;
    work.root_session_ended_at = nowIso();
    appendEvent(state, work, "session.ended", { session_id: input.session_id });
    saveState(canonicalRoot, state);
    return true;
  });
};

export const handleStartWorkStop = (root, input) => {
  if (input?.stop_hook_active === true) return { handled: true, output: null };
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!existsSync(startWorkStatePath(canonicalRoot))) return { handled: false, output: null };
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot, { optional: true });
    if (!state?.active_work_id) return { handled: false, output: null };
    const work = state.works[state.active_work_id];
    if (!work || work.status !== "active") return { handled: false, output: null };
    if (typeof input.session_id !== "string" || input.session_id !== work.root_session_id) return { handled: false, output: null };
    const promptId = typeof input.prompt_id === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(input.prompt_id)
      ? input.prompt_id
      : null;
    if (!promptId || typeof input.stop_hook_active !== "boolean") return { handled: false, output: null };
    const receiptKey = `${input.session_id}:${promptId}`;
    const progress = readPlanProgress(work.active_plan);
    if (progress.fingerprint === work.continuation.last_emitted_progress_fingerprint) {
      return { handled: false, output: null };
    }

    work.progress = progress;
    appendEvent(state, work, "work.continuation-emitted", {
      source: "Stop",
      progress_fingerprint: progress.fingerprint,
      checked: progress.checked,
      unchecked: progress.unchecked,
    });
    const next = progress.next_task
      ? `Continue work ${work.work_id} with next top-level task: ${progress.next_task}.`
      : `Work ${work.work_id} has all top-level tasks checked; run final verification and cleanup, then complete it with \`litclaude-ai start-work complete --work-id ${work.work_id} --session-id ${input.session_id} --expected-revision ${work.revision} --idempotency-key complete-${work.work_id}-${work.revision}\`.`;
    const output = {
      decision: "block",
      reason: `LitClaude start-work continuation: ${next}`,
      work_id: work.work_id,
      revision: work.revision,
      continuation_id: `continuation-${shortHash(`${input.session_id}:${promptId}:${work.work_id}:${work.revision}:${progress.fingerprint}`)}`,
    };
    work.continuation.last_emitted_progress_fingerprint = progress.fingerprint;
    work.continuation.receipts ??= {};
    work.continuation.receipts[receiptKey] = {
      continuation_id: output.continuation_id,
      session_id: input.session_id,
      prompt_id: promptId,
      work_id: work.work_id,
      revision: work.revision,
      progress_fingerprint: progress.fingerprint,
      payload: clone(output),
    };
    saveState(canonicalRoot, state);
    return { handled: true, output };
  });
};

// Typing start-work is the approval (plans/lit-adhd.md todo 8). Only a whole prompt counts: a
// quoted, fenced or longer prompt that merely mentions the command or a token is inert.
const INVOCATION = /^\/(?:litclaude:)?start-work(?:[ \t]+(\S+))?$/u;
const APPROVE_TOKEN = /^lit[ \t]+(?:approve|승인)$/u;
const DENY_TOKEN = /^lit[ \t]+(?:deny|거절)$/u;
const NATURAL_START = /^lit(?:work)?[ \t]+start[ \t]+work$/u;

/** `{kind: "start", plan, natural?}`, `{kind: "approve"}`, `{kind: "deny"}`, or null. */
export const parseStartWorkInvocation = (prompt) => {
  if (typeof prompt !== "string" || prompt.length > 512) return null;
  const text = prompt.trim();
  if (APPROVE_TOKEN.test(text)) return { kind: "approve" };
  if (DENY_TOKEN.test(text)) return { kind: "deny" };
  if (NATURAL_START.test(text)) return { kind: "start", plan: null, natural: true };
  const match = INVOCATION.exec(text);
  if (!match) return null;
  if (match[1] === "approve" || match[1] === "deny") return { kind: match[1] };
  if (match[1] === "resume") return null;
  return { kind: "start", plan: match[1] ?? null };
};

/** Project-relative `plans/*.md` files that still have an unchecked top-level task. */
export const openPlans = (root) => {
  const directory = join(root, "plans");
  let names;
  try {
    names = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
  return names.filter((name) => {
    try {
      return readPlanProgress(join(directory, name)).unchecked > 0;
    } catch {
      return false;
    }
  }).map((name) => `plans/${name}`);
};

// `Scope roots: <path> (<action>, <action>)` lines in the plan widen the grants it starts with.
const SCOPE_LINE = /^Scope roots?:[ \t]*(\S+)[ \t]*\(([a-z, -]+)\)[ \t]*$/gmu;

const derivedGrants = (root, plan, workId) => {
  const grants = ["read", "write", "execute", "test", "package", "vcs-read"].map((action) => ({ action, root, issuedBy: "user-invocation" }));
  if (!rootCovers(root, dirname(plan))) grants.push({ action: "read", root: dirname(plan), issuedBy: "user-invocation" });
  for (const [, path, actions] of readCanonicalPlanText(plan).matchAll(SCOPE_LINE)) {
    const scoped = isAbsolute(path) ? path : resolve(root, path);
    try {
      if (!lstatSync(scoped).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const action of actions.split(",").map((word) => word.trim())) {
      if (allowedActions.has(action)) grants.push({ action, root: scoped, issuedBy: "plan-scope" });
    }
  }
  if (PLUGIN_ROOT) grants.push({ action: "read", root: PLUGIN_ROOT, issuedBy: "plugin-self" });
  const scratch = join(realpathSync(tmpdir()), `litclaude-${workId}`);
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  grants.push({ action: "write", root: scratch, issuedBy: "user-invocation" });
  return grants.slice(0, MAX_GRANTS);
};

/**
 * Starts the work a typed `/litclaude:start-work [plan]` asked for, with the hook's session and
 * prompt identity. Returns `{started}`, `{running}` (this session already runs that plan),
 * `{choose: [plans]}` (no plan named and not exactly one open), or `{refused}`.
 */
export const startWorkFromInvocation = (root, { sessionId, promptId, plan = null }) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  const candidates = plan ? [plan] : openPlans(canonicalRoot);
  if (candidates.length !== 1) return { choose: candidates };
  let planPath;
  try {
    planPath = canonicalPlan(canonicalRoot, candidates[0]);
  } catch (error) {
    return { refused: `${candidates[0]}: ${error.message}` };
  }
  const state = readState(canonicalRoot, { optional: true });
  const running = state?.active_work_id ? state.works[state.active_work_id] : null;
  if (running && ["active", "paused"].includes(running.status)) {
    if (running.root_session_id === sessionId && running.active_plan.normalize("NFC") === planPath.normalize("NFC")) {
      return { running: { workId: running.work_id, plan: running.plan_name, status: running.status } };
    }
    return { refused: `start-work ${running.work_id} (${running.plan_name}) is already running here; finish or cancel it first.` };
  }
  const slug = basename(planPath, ".md").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40) || "plan";
  const workId = `work-${slug}-${hash(`${sessionId}:${planPath}:${promptId}`).slice(0, 8)}`;
  const response = initializeStartWork(canonicalRoot, {
    plan: planPath,
    workId,
    sessionId,
    grants: derivedGrants(canonicalRoot, planPath, workId),
    idempotencyKey: `typed-start:${promptId}`,
    issuedBy: "user-invocation",
    originPromptId: promptId,
  });
  const work = response.state.works[workId];
  return { started: { workId, plan: work.plan_name, next: work.progress.next_task } };
};

const pendingFor = (state, sessionId) => {
  const work = state?.active_work_id ? state.works[state.active_work_id] : null;
  return work?.status === "paused" && work.pending_boundary && work.root_session_id === sessionId && work.pending_boundary.origin_session_id === sessionId ? work : null;
};

/** `lit approve`: grants the one pending boundary of this session's work, or returns null. */
export const approveStartWorkBoundary = (root, { sessionId, promptId }) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  const work = pendingFor(readState(canonicalRoot, { optional: true }), sessionId);
  if (!work) return null;
  const boundary = work.pending_boundary;
  const response = resumeStartWorkFromUserPrompt(canonicalRoot, {
    workId: work.work_id,
    expectedRevision: work.revision,
    boundaryId: boundary.boundary_id,
    originPromptId: boundary.origin_prompt_id,
    grantId: boundary.grant_id,
    sessionId,
    consumedByPromptId: promptId,
  });
  return { approved: { workId: work.work_id, action: boundary.action, root: boundary.root }, response };
};

/** `lit deny`: clears the pending boundary without granting it; that path then stays refused. */
export const denyStartWorkBoundary = (root, { sessionId, promptId }) => {
  const canonicalRoot = canonicalDirectory(root, "cwd root");
  if (!pendingFor(readState(canonicalRoot, { optional: true }), sessionId)) return null;
  return withLock(canonicalRoot, () => {
    const state = readState(canonicalRoot);
    const work = pendingFor(state, sessionId);
    if (!work) return null;
    const boundary = work.pending_boundary;
    work.authority.denied_boundaries = [...(work.authority.denied_boundaries ?? []), {
      boundary_id: boundary.boundary_id,
      action: boundary.action,
      root: boundary.root,
      denied_by_prompt_id: typeof promptId === "string" ? promptId : null,
      denied_at: nowIso(),
    }].slice(-MAX_GRANTS);
    work.status = "active";
    work.pending_boundary = null;
    appendEvent(state, work, "work.boundary_denied", { boundary_id: boundary.boundary_id, action: boundary.action, root: boundary.root });
    saveState(canonicalRoot, state);
    return { denied: { workId: work.work_id, action: boundary.action, root: boundary.root } };
  });
};
