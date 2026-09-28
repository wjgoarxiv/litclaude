import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../scripts/strip-ansi.mjs";

import { buildPlanSkeleton, checkPlanStructure } from "../scripts/scaffold-plan.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(repoRoot, "bin", "litclaude-ai.js");
const hookPath = join(repoRoot, "plugins", "litclaude", "bin", "litclaude-hook.js");

const fixtureRoot = () => mkdtempSync(join(tmpdir(), "litclaude-lifecycle-"));

const writePlan = (root, lines = ["# Approved Plan", "", "## TODOs", "", "- [ ] First task", ""]) => {
  mkdirSync(join(root, "plans"), { recursive: true });
  writeFileSync(join(root, "plans", "approved.md"), lines.join("\n"));
};

const runCli = (root, args, options = {}) => spawnSync(
  process.execPath,
  [binPath, "start-work", ...args, "--root", root, "--json"],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  },
);

const runHook = (event, root, input = {}) => spawnSync(
  process.execPath,
  [hookPath, event],
  {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ cwd: root, hook_event_name: event, ...input }),
  },
);

const parse = (result) => JSON.parse(result.stdout);
const resumeRouteFromDenial = (result) => parse(result).hookSpecificOutput.permissionDecisionReason.match(/\/litclaude:start-work resume[^\n]+/u)?.[0];

const pauseOutsideWithPreTool = (root, outside, promptId = "prompt-outside") => {
  const result = runHook("pre-tool-use", root, {
    session_id: "session-1",
    prompt_id: promptId,
    tool_use_id: `tool-${promptId}`,
    tool_name: "Write",
    tool_input: { file_path: join(outside, "outside.txt"), content: "data" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parse(result).hookSpecificOutput.permissionDecision, "deny");
  return resumeRouteFromDenial(result);
};

const initArgs = (root, overrides = []) => [
  "init",
  "--plan", "plans/approved.md",
  "--work-id", "work-1",
  "--session-id", "session-1",
  "--grant", `read:${root}`,
  "--grant", `write:${root}`,
  "--grant", `execute:${root}`,
  "--grant", `test:${root}`,
  "--idempotency-key", "init-1",
  ...overrides,
];

describe("schema-3 bounded-authority start-work lifecycle", () => {
  it("initializes canonical schema-3 state idempotently with null worktree mapped to authorized cwd", () => {
    const root = fixtureRoot();
    try {
      writePlan(root);
      const first = runCli(root, initArgs(root));
      const second = runCli(root, initArgs(root));

      assert.equal(first.status, 0, first.stderr);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(parse(second), parse(first), "an exact idempotency replay must return the original result");
      const state = parse(first).state;
      const work = state.works["work-1"];
      assert.equal(state.schema_version, 3);
      assert.equal(state.revision, 1);
      assert.equal(work.revision, 1);
      assert.equal(work.status, "active");
      assert.equal(work.active_plan, realpathSync(join(root, "plans", "approved.md")));
      assert.equal(work.plan_root, realpathSync(join(root, "plans")));
      assert.equal(work.worktree_path, null);
      assert.equal(work.effective_worktree_root, realpathSync(root));
      assert.equal(work.authority.cwd_root, realpathSync(root));
      assert.equal(work.authority.authority_root, realpathSync(root));
      assert.equal(work.authority.grants.length, 4);
      assert.equal(existsSync(join(root, ".litclaude", "start-work", "ledger.jsonl")), true);

      const conflict = runCli(root, initArgs(root, ["--grant", `package:${root}`]));
      assert.notEqual(conflict.status, 0);
      assert.match(parse(conflict).error.message, /idempotency key conflict/iu);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an exact replay when the current plan no longer has visible top-level tasks", () => {
    const root = fixtureRoot();
    try {
      writePlan(root);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      const ledger = join(root, ".litclaude", "start-work", "ledger.jsonl");
      rmSync(ledger);
      writePlan(root, ["# Approved Plan", "", "```md", "- [ ] Fenced task is not executable", "```", ""]);

      const replay = runCli(root, initArgs(root));

      assert.notEqual(replay.status, 0);
      assert.match(parse(replay).error.message, /plan has no top-level checkbox tasks/iu);
      assert.equal(existsSync(ledger), false, "rejected replay must not reconcile the missing ledger");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects initialization when the plan has no visible top-level tasks without creating durable state", () => {
    const root = fixtureRoot();
    try {
      writePlan(root, ["# Approved Plan", "", "  - [ ] Nested task is not executable", ""]);

      const result = runCli(root, initArgs(root));

      assert.notEqual(result.status, 0);
      assert.match(parse(result).error.message, /plan has no top-level checkbox tasks/iu);
      assert.equal(existsSync(join(root, ".litclaude", "boulder.json")), false);
      assert.equal(existsSync(join(root, ".litclaude", "start-work", "ledger.jsonl")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("initializes a generated plan after it passes the structural contract", () => {
    const root = fixtureRoot();
    try {
      const plan = buildPlanSkeleton("generated-plan", "clear")
        .replaceAll(/<fill[^>]*>/gu, "done")
        .replace("- [ ] 1. <title>", "- [ ] 1. Generated task");
      assert.equal(checkPlanStructure(plan).ok, true);
      writePlan(root, plan.split("\n"));

      const result = runCli(root, initArgs(root));

      assert.equal(result.status, 0, result.stderr);
      assert.ok(parse(result).state.works["work-1"].progress.total > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed on unauthorized cwd, active work, wrong session, stale revision, and held lock", () => {
    const root = fixtureRoot();
    try {
      writePlan(root);
      const unauthorized = runCli(root, [
        "init", "--plan", "plans/approved.md", "--work-id", "bad", "--session-id", "session-1",
        "--grant", `read:${root}`, "--idempotency-key", "bad-init",
      ]);
      assert.notEqual(unauthorized.status, 0);
      assert.match(parse(unauthorized).error.message, /cwd.*write grant|write grant.*cwd/iu);

      const unknownOption = runCli(root, [...initArgs(root), "--user-confirmed", "true"]);
      assert.notEqual(unknownOption.status, 0);
      assert.match(parse(unknownOption).error.message, /unknown start-work option/iu);

      assert.equal(runCli(root, initArgs(root)).status, 0);
      const competing = runCli(root, initArgs(root, ["--work-id", "work-2", "--idempotency-key", "init-2"]));
      assert.notEqual(competing.status, 0);
      assert.match(parse(competing).error.message, /active work/iu);

      for (const args of [
        ["progress", "--work-id", "work-1", "--session-id", "wrong", "--expected-revision", "1", "--idempotency-key", "wrong-session"],
        ["progress", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "0", "--idempotency-key", "stale"],
      ]) {
        const result = runCli(root, args);
        assert.notEqual(result.status, 0);
        assert.match(parse(result).error.message, /session|revision/iu);
      }

      mkdirSync(join(root, ".litclaude", "start-work", ".lock"), { recursive: true });
      const locked = runCli(root, ["status"], { env: { LITCLAUDE_START_WORK_LOCK_TIMEOUT_MS: "20" } });
      assert.notEqual(locked.status, 0);
      assert.match(parse(locked).error.message, /lock timed out/iu);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pauses only for a genuinely new non-forbidden authority boundary", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      writePlan(root);
      assert.equal(runCli(root, initArgs(root)).status, 0);

      const covered = runCli(root, [
        "pause", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1",
        "--action", "write", "--target-root", root, "--idempotency-key", "covered",
      ]);
      assert.equal(covered.status, 0, covered.stderr);
      assert.equal(parse(covered).already_authorized, true);
      assert.equal(parse(covered).state.revision, 1);
      assert.equal(parse(covered).state.works["work-1"].status, "active");

      const forbidden = runCli(root, [
        "pause", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1",
        "--action", "publish", "--target-root", outside, "--idempotency-key", "forbidden",
      ]);
      assert.notEqual(forbidden.status, 0);
      assert.match(parse(forbidden).error.message, /forbidden authority action/iu);
      assert.equal(parse(runCli(root, ["status"])).state.revision, 1);

      const novel = runCli(root, [
        "pause", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1",
        "--action", "write", "--target-root", outside, "--idempotency-key", "novel",
      ]);
      assert.equal(novel.status, 0, novel.stderr);
      const work = parse(novel).state.works["work-1"];
      assert.equal(work.status, "paused");
      assert.equal(work.revision, 2);
      assert.equal(work.pending_boundary.action, "write");
      assert.equal(work.pending_boundary.root, realpathSync(outside));
      assert.match(work.pending_boundary.boundary_id, /^boundary-/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("resumes only through an exact trusted UserPromptSubmit boundary/grant identity", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      writePlan(root);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      const route = pauseOutsideWithPreTool(root, outside);
      const paused = parse(runCli(root, ["status"])).state.works["work-1"];

      const genericResume = runCli(root, ["resume", "--work-id", "work-1"]);
      assert.notEqual(genericResume.status, 0);
      assert.match(parse(genericResume).error.message, /explicit UserPromptSubmit route/iu);

      const injected = runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-injected",
        prompt: `Please explain ${route}`,
      });
      assert.equal(injected.status, 0, injected.stderr);
      assert.equal(parse(runCli(root, ["status"])).state.works["work-1"].status, "paused");

      const trusted = runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-resume",
        prompt: route,
      });
      assert.equal(trusted.status, 0, trusted.stderr);
      const output = parse(trusted);
      assert.match(stripAnsi(output.systemMessage ?? ""), /🔥 LIT IGNITED · start-work 🔥/u);
      assert.match(output.hookSpecificOutput.additionalContext, /<litclaude-start-work-context>/u);
      assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /Please explain/u);
      const work = parse(runCli(root, ["status"])).state.works["work-1"];
      assert.equal(work.status, "active");
      assert.equal(work.revision, 3);
      assert.equal(work.pending_boundary, null);
      assert.equal(work.authority.grants.some(({ grant_id }) => grant_id === paused.pending_boundary.grant_id), true);
      assert.equal(work.authority.consumed_grants.some(({ grant_id }) => grant_id === paused.pending_boundary.grant_id), true);

      const replay = runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-replay",
        prompt: route,
      });
      assert.equal(replay.status, 0, replay.stderr);
      assert.match(parse(replay).hookSpecificOutput.additionalContext, /already consumed/iu);
      assert.equal(parse(runCli(root, ["status"])).state.revision, 3);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps consumed grants while compacting events, terminal works, and history", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      writePlan(root);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      const route = pauseOutsideWithPreTool(root, outside);
      const paused = parse(runCli(root, ["status"])).state.works["work-1"];
      assert.equal(runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-resume",
        prompt: route,
      }).status, 0);

      let revision = 3;
      for (let index = 0; index < 75; index += 1) {
        writePlan(root, ["# Approved Plan", "", "## TODOs", "", index % 2 ? "- [ ] First task" : "- [x] First task", ""]);
        const progress = runCli(root, [
          "progress", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", String(revision),
          "--idempotency-key", `progress-${index}`,
        ]);
        assert.equal(progress.status, 0, progress.stderr);
        revision = parse(progress).state.revision;
      }

      const work = parse(runCli(root, ["status"])).state.works["work-1"];
      assert.ok(work.events.length <= 64);
      assert.equal(work.authority.consumed_grants.some(({ grant_id }) => grant_id === paused.pending_boundary.grant_id), true);
      const reusedAfterCompaction = runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-reuse-after-compaction",
        prompt: route,
      });
      assert.match(parse(reusedAfterCompaction).hookSpecificOutput.additionalContext, /already consumed/iu);

      writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [x] First task", ""]);
      let result = runCli(root, [
        "progress", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", String(revision),
        "--idempotency-key", "final-progress",
      ]);
      revision = parse(result).state.revision;
      result = runCli(root, [
        "complete", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", String(revision),
        "--idempotency-key", "complete-1",
      ]);
      assert.equal(result.status, 0, result.stderr);

      for (let index = 2; index <= 12; index += 1) {
        writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [x] Done", ""]);
        const workId = `work-${index}`;
        const initialized = runCli(root, initArgs(root, [
          "--work-id", workId,
          "--session-id", `session-${index}`,
          "--idempotency-key", `init-${index}`,
        ]));
        assert.equal(initialized.status, 0, initialized.stderr);
        const currentRevision = parse(initialized).state.revision;
        const completed = runCli(root, [
          "complete", "--work-id", workId, "--session-id", `session-${index}`,
          "--expected-revision", String(currentRevision), "--idempotency-key", `complete-${index}`,
        ]);
        assert.equal(completed.status, 0, completed.stderr);
      }

      const state = parse(runCli(root, ["status"])).state;
      assert.equal(state.active_work_id, null);
      assert.ok(Object.keys(state.works).length <= 8);
      assert.ok(state.history.length <= 16);
      assert.ok(state.revision > revision, "revision must remain monotonic across terminal re-init cycles");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("uses fenced-checkbox-safe progress and refuses completion while paused or unchecked", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      writePlan(root, [
        "# Approved Plan", "", "## TODOs", "", "````md", "```", "- [ ] illustrative only", "````", "- [ ] Real task", "  - [ ] nested criterion", "",
      ]);
      assert.equal(runCli(root, initArgs(root)).status, 0);

      let complete = runCli(root, [
        "complete", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1", "--idempotency-key", "early",
      ]);
      assert.notEqual(complete.status, 0);
      assert.match(parse(complete).error.message, /unchecked top-level task/iu);

      const paused = runCli(root, [
        "pause", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1",
        "--action", "write", "--target-root", outside, "--idempotency-key", "pause",
      ]);
      assert.equal(paused.status, 0, paused.stderr);
      complete = runCli(root, [
        "complete", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "2", "--idempotency-key", "paused-complete",
      ]);
      assert.notEqual(complete.status, 0);
      assert.match(parse(complete).error.message, /paused work cannot complete/iu);

      const pausedWork = parse(paused).state.works["work-1"];
      const route = `/litclaude:start-work resume --work-id work-1 --revision 2 --boundary-id ${pausedWork.pending_boundary.boundary_id} --prompt-id cli-pause --grant-id ${pausedWork.pending_boundary.grant_id}`;
      assert.equal(runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-resume",
        prompt: route,
      }).status, 0);
      writePlan(root, [
        "# Approved Plan", "", "## TODOs", "", "````md", "```", "- [ ] illustrative only", "````", "- [x] Real task", "  - [ ] nested criterion", "",
      ]);
      const progress = runCli(root, [
        "progress", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "3", "--idempotency-key", "done-progress",
      ]);
      assert.equal(progress.status, 0, progress.stderr);
      assert.equal(parse(progress).progress.total, 1);
      assert.equal(parse(progress).progress.unchecked, 0);
      complete = runCli(root, [
        "complete", "--work-id", "work-1", "--session-id", "session-1",
        "--expected-revision", String(parse(progress).state.revision), "--idempotency-key", "done",
      ]);
      assert.equal(complete.status, 0, complete.stderr);
      assert.equal(parse(complete).state.works["work-1"].status, "completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("fails closed if the canonical plan is replaced by a symlink", () => {
    const root = fixtureRoot();
    const outside = fixtureRoot();
    try {
      writePlan(root);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      const plan = join(root, "plans", "approved.md");
      const foreignPlan = join(outside, "foreign.md");
      writeFileSync(foreignPlan, "# Foreign\n\n- [x] Pretend complete\n");
      rmSync(plan);
      symlinkSync(foreignPlan, plan);

      const progress = runCli(root, [
        "progress", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1", "--idempotency-key", "symlink-progress",
      ]);
      assert.notEqual(progress.status, 0);
      assert.match(parse(progress).error.message, /plan.*symbolic link/iu);
      assert.equal(parse(runCli(root, ["status"])).state.revision, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reconciles missing ledger events without duplicating receipts", () => {
    const root = fixtureRoot();
    try {
      writePlan(root);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      const ledger = join(root, ".litclaude", "start-work", "ledger.jsonl");
      writeFileSync(ledger, "");

      assert.equal(runCli(root, ["status"]).status, 0);
      const once = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
      assert.equal(once.length, 1);
      assert.equal(JSON.parse(once[0]).event, "work.initialized");

      assert.equal(runCli(root, ["status"]).status, 0);
      const twice = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
      assert.deepEqual(twice, once);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits one continuation per new progress and allows stop-hook re-entry", () => {
    const root = fixtureRoot();
    try {
      writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [ ] First", "- [ ] Second", ""]);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [x] First", "- [ ] Second", ""]);

      const first = runHook("stop", root, {
        session_id: "session-1", prompt_id: "prompt-1", stop_hook_active: false,
      });
      assert.equal(first.status, 0, first.stderr);
      const firstOutput = parse(first);
      assert.equal(firstOutput.decision, "block");
      assert.match(firstOutput.reason, /Second/u);
      assert.match(firstOutput.reason, /work-1/u);
      const emittedRevision = firstOutput.revision;

      const reentry = runHook("stop", root, {
        session_id: "session-1", prompt_id: "prompt-1", stop_hook_active: true,
      });
      assert.equal(reentry.status, 0, reentry.stderr);
      assert.equal(reentry.stdout, "");

      writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [x] First", "- [x] Second", ""]);
      const reevaluated = runHook("stop", root, {
        session_id: "session-1", prompt_id: "prompt-1", stop_hook_active: false,
      });
      assert.equal(reevaluated.status, 0, reevaluated.stderr);
      assert.equal(parse(reevaluated).decision, "block");
      assert.match(parse(reevaluated).reason, /all top-level tasks checked/u);

      const later = runHook("stop", root, {
        session_id: "session-1", prompt_id: "prompt-2", stop_hook_active: false,
      });
      assert.equal(later.status, 0, later.stderr);
      assert.equal(later.stdout, "");

      const staleSession = runHook("stop", root, {
        session_id: "wrong-session", prompt_id: "prompt-3", stop_hook_active: false,
      });
      assert.equal(staleSession.stdout, "");
      const malformedActive = runHook("stop", root, {
        session_id: "session-1", prompt_id: "prompt-4", stop_hook_active: "false",
      });
      assert.equal(malformedActive.stdout, "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits Stop continuation after code-owned progress recording", () => {
    const root = fixtureRoot();
    try {
      writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [ ] First", "- [ ] Second", ""]);
      assert.equal(runCli(root, initArgs(root)).status, 0);
      writePlan(root, ["# Approved Plan", "", "## TODOs", "", "- [x] First", "- [ ] Second", ""]);
      const progress = runCli(root, [
        "progress", "--work-id", "work-1", "--session-id", "session-1", "--expected-revision", "1", "--idempotency-key", "progress-before-stop",
      ]);
      assert.equal(progress.status, 0, progress.stderr);
      const revision = parse(progress).state.revision;

      const stop = runHook("stop", root, {
        session_id: "session-1", prompt_id: "prompt-after-progress", stop_hook_active: false,
      });
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal(parse(stop).decision, "block");
      assert.match(parse(stop).reason, /Second/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bounds transcript reads and refuses symlink transcripts", () => {
    const root = fixtureRoot();
    try {
      const target = join(root, "target-transcript.txt");
      const link = join(root, "linked-transcript.txt");
      writeFileSync(target, "Context compacted after long thread.");
      symlinkSync(target, link);

      const linked = runHook("session-start", root, { transcript_path: link, session_id: "session-1" });
      assert.equal(linked.status, 0, linked.stderr);
      assert.doesNotMatch(parse(linked).hookSpecificOutput.additionalContext, /context pressure detected/iu);

      const oversized = join(root, "oversized-transcript.txt");
      writeFileSync(oversized, `${"x".repeat(300_000)}context compacted`);
      const large = runHook("session-start", root, { transcript_path: oversized, session_id: "session-1" });
      assert.equal(large.status, 0, large.stderr);
      assert.doesNotMatch(parse(large).hookSpecificOutput.additionalContext, /context pressure detected/iu);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps non-resume UserPromptSubmit lifecycle context reads side-effect-free", () => {
    const root = fixtureRoot();
    try {
      const result = runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt: "$start-work plans/approved.md",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(join(root, ".litclaude")), false);

      const stop = runHook("stop", root, { session_id: "session-1", prompt_id: "prompt-1", stop_hook_active: false });
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal(stop.stdout, "");
      assert.equal(existsSync(join(root, ".litclaude")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an exact no-state resume failure side-effect-free", () => {
    const root = fixtureRoot();
    try {
      const prompt = "/litclaude:start-work resume --work-id work-1 --revision 1 --boundary-id boundary-aaaaaaaaaaaaaaaaaaaa --prompt-id prompt-1 --grant-id grant-bbbbbbbbbbbbbbbbbbbb";
      const result = runHook("user-prompt-submit", root, {
        session_id: "session-1",
        prompt_id: "prompt-current",
        prompt,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(stripAnsi(parse(result).systemMessage ?? ""), /resume blocked/iu);
      assert.equal(existsSync(join(root, ".litclaude")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enrolls the lifecycle in Claude-native command, skill, agent, hook, manifest, doctor, installer, help, and package surfaces", () => {
    const surfaces = {
      manifest: readFileSync(join(repoRoot, "plugins", "litclaude", ".claude-plugin", "plugin.json"), "utf8"),
      hooks: readFileSync(join(repoRoot, "plugins", "litclaude", "hooks", "hooks.json"), "utf8"),
      command: readFileSync(join(repoRoot, "plugins", "litclaude", "commands", "start-work.md"), "utf8"),
      skill: readFileSync(join(repoRoot, "plugins", "litclaude", "skills", "start-work", "SKILL.md"), "utf8"),
      agent: readFileSync(join(repoRoot, "plugins", "litclaude", "agents", "lit-executor.md"), "utf8"),
      doctor: readFileSync(join(repoRoot, "scripts", "doctor.mjs"), "utf8"),
      installer: readFileSync(binPath, "utf8"),
      readme: readFileSync(join(repoRoot, "README.md"), "utf8"),
    };

    for (const [name, text] of Object.entries(surfaces)) {
      assert.match(text, /bounded-authority|start-work lifecycle|start-work-lifecycle/iu, `${name} must enroll the lifecycle`);
    }
    assert.match(surfaces.command, /\/litclaude:start-work resume --work-id <id> --revision <n> --boundary-id <id> --prompt-id <id> --grant-id <id>/u);
    assert.match(surfaces.skill, /schema[- ]3/iu);
    assert.match(surfaces.skill, /consumed grants/iu);
    assert.match(surfaces.agent, /no generic.*resume bypass/iu);

    const exactResumeRoute = "/litclaude:start-work resume --work-id <id> --revision <n> --boundary-id <id> --prompt-id <id> --grant-id <id>";
    const routeSurfaces = {
      readme: surfaces.readme,
      hooksDoc: readFileSync(join(repoRoot, "docs", "hooks.md"), "utf8"),
      command: surfaces.command,
      startSkill: surfaces.skill,
      litLoopSkill: readFileSync(join(repoRoot, "plugins", "litclaude", "skills", "lit-loop", "SKILL.md"), "utf8"),
      executorAgent: surfaces.agent,
      cli: readFileSync(join(repoRoot, "plugins", "litclaude", "lib", "start-work-cli.mjs"), "utf8"),
    };
    for (const [name, text] of Object.entries(routeSurfaces)) {
      assert.ok(text.includes(exactResumeRoute), `${name} must use the exact prompt-bound resume route`);
    }

    for (const [name, text] of Object.entries({
      readme: surfaces.readme,
      hooksDoc: routeSurfaces.hooksDoc,
      startSkill: surfaces.skill,
      litLoopSkill: routeSurfaces.litLoopSkill,
    })) {
      const compactText = text.replace(/\s+/gu, " ");
      assert.match(compactText, /stop_hook_active.{0,220}true.{0,80}stay(?:s)? silent/iu, `${name} must keep Stop re-entry non-blocking`);
      assert.doesNotMatch(text, /same-prompt[^\n]*replay|replays it only|replay returns the same payload|retained prompts replay/iu, `${name} must not prescribe stale Stop replay`);
    }

    const help = spawnSync(process.execPath, [binPath], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(help.status, 64);
    assert.match(help.stderr, /start-work\s+Manage schema-3 bounded-authority lifecycle state/iu);
  });
});
