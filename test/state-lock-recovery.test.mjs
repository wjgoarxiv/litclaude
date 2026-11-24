// A lock left behind by a process that died mid-write must not block every later hook call.
// Each case below once made the start-work lock (and with it every tool call) fail forever.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { acquireStartWorkLock, handleStartWorkPreToolUse, initializeStartWork, readStartWorkStatus, releaseStartWorkLock } from "../plugins/litclaude/lib/start-work-lifecycle.mjs";
import { acquireOwnerLock, releaseOwnerLock } from "../plugins/litclaude/lib/owner-lock.mjs";

const DEAD_PID = 999_999;
const longAgo = new Date(Date.now() - 60 * 60 * 1000);
const age = (path) => utimesSync(path, longAgo, longAgo);

const withRoot = (fn) => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-lock-recovery-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const startWorkLock = (root) => join(root, ".litclaude", "start-work", ".lock");

describe("start-work state lock recovery", () => {
  it("reclaims an old lock folder that has no owner record", () => withRoot((root) => {
    const lockDir = startWorkLock(root);
    mkdirSync(lockDir, { recursive: true });
    age(lockDir);
    const owner = acquireStartWorkLock(root, { timeoutMs: 300 });
    assert.ok(owner.nonce);
    releaseStartWorkLock(root, owner);
    assert.equal(existsSync(lockDir), false);
  }));

  it("still waits on a fresh lock folder with no owner record yet", () => withRoot((root) => {
    mkdirSync(startWorkLock(root), { recursive: true });
    assert.throws(() => acquireStartWorkLock(root, { timeoutMs: 100 }), /timed out/u);
  }));

  it("never takes a folder a holder created a moment ago, even with a zero stale window", () => withRoot((root) => {
    const lockDir = startWorkLock(root);
    mkdirSync(lockDir, { recursive: true });
    const second = new Date(Date.now() - 1_000);
    utimesSync(lockDir, second, second);
    assert.throws(() => acquireStartWorkLock(root, { timeoutMs: 100, staleMs: 0 }), /timed out/u);
    assert.ok(existsSync(lockDir));
  }));

  it("reclaims a dead owner's lock even when a crashed contender left its takeover claim", () => withRoot((root) => {
    const lockDir = startWorkLock(root);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "dead-owner", pid: DEAD_PID, acquired_at_ms: 0 })}\n`);
    const claim = join(lockDir, ".takeover-dead-owner");
    writeFileSync(claim, `${DEAD_PID}\n`);
    age(claim);
    const owner = acquireStartWorkLock(root, { timeoutMs: 300 });
    assert.notEqual(owner.nonce, "dead-owner");
    releaseStartWorkLock(root, owner);
  }));

  it("reclaims a lock held far longer than any state update, even if its pid was reused", () => withRoot((root) => {
    const lockDir = startWorkLock(root);
    mkdirSync(lockDir, { recursive: true });
    // process.ppid is alive: the shape of a recycled pid on WSL.
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "recycled", pid: process.ppid, acquired_at_ms: 0 })}\n`);
    const owner = acquireStartWorkLock(root, { timeoutMs: 300 });
    assert.notEqual(owner.nonce, "recycled");
    releaseStartWorkLock(root, owner);
  }));

  it("keeps a live, recent owner and names the lock path and holder when it times out", () => withRoot((root) => {
    const lockDir = startWorkLock(root);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "live", pid: process.ppid, acquired_at_ms: Date.now() })}\n`);
    assert.throws(() => acquireStartWorkLock(root, { timeoutMs: 100 }), (error) => {
      assert.match(error.message, /timed out/u);
      assert.ok(error.message.includes(lockDir), error.message);
      assert.match(error.message, new RegExp(`pid ${process.ppid}`, "u"));
      return true;
    });
  }));
});

describe("owner lock recovery", () => {
  it("reclaims an old lock folder that has no owner record", () => withRoot((root) => {
    const lockDir = join(root, "state", ".lock");
    mkdirSync(lockDir, { recursive: true });
    age(lockDir);
    const owner = acquireOwnerLock(lockDir, { timeoutMs: 300 });
    assert.ok(releaseOwnerLock(lockDir, owner));
  }));

  it("reclaims a dead owner's lock when a crashed contender left an unreadable claim", () => withRoot((root) => {
    const lockDir = join(root, "state", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "deadowner", pid: DEAD_PID, acquired_at_ms: 0 })}\n`);
    const claim = join(lockDir, ".takeover-deadowner.half-written.json");
    writeFileSync(claim, "{\"owner_no");
    age(claim);
    const owner = acquireOwnerLock(lockDir, { timeoutMs: 300 });
    assert.notEqual(owner.nonce, "deadowner");
    assert.ok(releaseOwnerLock(lockDir, owner));
  }));

  it("reclaims a lock held far longer than any state update, even if its pid was reused", () => withRoot((root) => {
    const lockDir = join(root, "state", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "recycled", pid: process.ppid, acquired_at_ms: 0 })}\n`);
    const owner = acquireOwnerLock(lockDir, { timeoutMs: 300 });
    assert.notEqual(owner.nonce, "recycled");
    assert.ok(releaseOwnerLock(lockDir, owner));
  }));

  // A holder writes its owner record right after creating the folder. With a zero stale window a
  // contender once moved that folder aside in between, and the holder failed its own acquisition
  // (Linux CI, "lock ownership receipt failed").
  it("never takes a folder a holder created a moment ago, even with a zero stale window", () => withRoot((root) => {
    const lockDir = join(root, "state", ".lock");
    mkdirSync(lockDir, { recursive: true });
    const second = new Date(Date.now() - 1_000);
    utimesSync(lockDir, second, second);
    assert.throws(() => acquireOwnerLock(lockDir, { timeoutMs: 100, staleMs: 0 }), /timed out/u);
    assert.ok(existsSync(lockDir));
  }));

  it("names the lock path when it times out", () => withRoot((root) => {
    const lockDir = join(root, "state", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ nonce: "live", pid: process.ppid, acquired_at_ms: Date.now() })}\n`);
    assert.throws(() => acquireOwnerLock(lockDir, { timeoutMs: 100 }), (error) => error.message.includes(lockDir));
  }));
});

// A second report: several sessions on a slow WSL drive kept the lock busy rewriting a large
// boulder.json, so every guard call (and `lit cancel`) timed out though no holder had died.
describe("start-work guard under a busy lock", () => {
  const busyProject = (fn) => withRoot((base) => {
    const root = realpathSync(base);
    mkdirSync(join(root, "plans"), { recursive: true });
    writeFileSync(join(root, "plans", "p.md"), "# P\n\n## TODOs\n\n- [ ] Do it\n");
    writeFileSync(join(root, "a.txt"), "hello\n");
    initializeStartWork(root, { plan: "plans/p.md", workId: "w1", sessionId: "s1", grants: [`read:${root}`, `write:${root}`], idempotencyKey: "k1" });
    const holder = acquireStartWorkLock(root, { timeoutMs: 300 });
    try {
      return fn(root, holder);
    } finally {
      releaseStartWorkLock(root, holder);
    }
  });
  const call = (root, session, tool, file, options) => handleStartWorkPreToolUse(root, {
    session_id: session, prompt_id: "p", tool_use_id: "t", cwd: root, tool_name: tool, tool_input: { file_path: join(root, file), content: "x" },
  }, options);

  it("decides the owner's tool calls without waiting for the lock", () => busyProject((root) => {
    const started = Date.now();
    assert.equal(call(root, "s1", "Read", "a.txt").decision, "allow-normal");
    assert.equal(call(root, "s1", "Write", "b.txt").decision, "allow-normal");
    assert.ok(Date.now() - started < 1_500, `took ${Date.now() - started} ms`);
  }));

  it("still refuses another session's write while the lock is busy", () => busyProject((root) => {
    assert.equal(call(root, "s2", "Read", "a.txt").decision, "allow-normal");
    assert.equal(call(root, "s2", "Write", "b.txt").decision, "deny");
  }));

  it("skips a due heartbeat while the lock is busy and records it once the lock is free", () => withRoot((base) => {
    const root = realpathSync(base);
    mkdirSync(join(root, "plans"), { recursive: true });
    writeFileSync(join(root, "plans", "p.md"), "# P\n\n## TODOs\n\n- [ ] Do it\n");
    writeFileSync(join(root, "a.txt"), "hello\n");
    initializeStartWork(root, { plan: "plans/p.md", workId: "w1", sessionId: "s1", grants: [`read:${root}`, `write:${root}`], idempotencyKey: "k1" });
    const later = { now: Date.now() + 5 * 60_000 };
    const holder = acquireStartWorkLock(root, { timeoutMs: 300 });
    try {
      assert.equal(call(root, "s1", "Read", "a.txt", later).decision, "allow-normal");
      assert.equal(JSON.parse(readFileSync(join(root, ".litclaude", "boulder.json"), "utf8")).works.w1.last_tool_at, undefined);
    } finally {
      releaseStartWorkLock(root, holder);
    }
    assert.equal(call(root, "s1", "Read", "a.txt", later).decision, "allow-normal");
    assert.equal(readStartWorkStatus(root).state.works.w1.last_tool_at, new Date(later.now).toISOString());
  }));
});
