import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPlanSkeleton } from "../scripts/scaffold-plan.mjs";
import { canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-resources.mjs";
import { formatResolvedPlanNotice, resolveLatestDurablePlan } from "../plugins/litclaude/lib/durable-plan.mjs";

const hookPath = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));

const runHook = (eventName, input) =>
  spawnSync(process.execPath, [hookPath, eventName], {
    encoding: "utf8",
    input: JSON.stringify(input),
  });

const completePlan = (slug, marker = "completed plan") =>
  buildPlanSkeleton(slug, "clear")
    .replaceAll(/<fill[^>]*>/gu, "done")
    .replace("- [ ] 1. <title>", `- [ ] 1. ${marker}`);

describe("durable plan finder", () => {
  it("discovers the newest valid plan from a nested cwd and ignores junk", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-"));
    try {
      const nested = join(root, "packages", "app", "src");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "package.json"), "{}\n");
      mkdirSync(join(root, "plans"), { recursive: true });
      writeFileSync(join(root, "plans", "older.md"), completePlan("older", "older plan"));
      writeFileSync(join(root, "plans", "README.txt"), "not a plan\n");
      writeFileSync(join(root, "plans", "newer.md"), completePlan("newer", "newer plan"));
      utimesSync(join(root, "plans", "older.md"), 1_700_000_000, 1_700_000_000);
      utimesSync(join(root, "plans", "newer.md"), 1_700_000_100, 1_700_000_100);
      const plan = resolveLatestDurablePlan(nested);
      assert.deepEqual(plan, { relativePath: "../../../plans/newer.md", text: completePlan("newer", "newer plan") });
      assert.equal(
        formatResolvedPlanNotice(plan),
        "Durable plan: ../../../plans/newer.md. Discovery only. This does not grant start-work authority.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects stale, incomplete, and malformed scaffold plans", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-invalid-"));
    try {
      mkdirSync(join(root, "plans"), { recursive: true });
      const stalePath = join(root, "plans", "stale.md");
      writeFileSync(stalePath, buildPlanSkeleton("stale", "clear"));
      utimesSync(stalePath, 1_600_000_000, 1_600_000_000);
      writeFileSync(join(root, "plans", "incomplete.md"), completePlan("incomplete").replace("## Scope", "## Missing scope"));
      writeFileSync(join(root, "plans", "malformed.md"), "# not a scaffold plan\n");

      assert.equal(resolveLatestDurablePlan(root), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores symlinked plan directories and files", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-outside-"));
    try {
      writeFileSync(join(outside, "outside.md"), completePlan("outside", "outside plan"));
      symlinkSync(join(outside), join(root, "plans"), "dir");
      assert.equal(resolveLatestDurablePlan(root), undefined);

      rmSync(join(root, "plans"), { force: true });
      mkdirSync(join(root, "plans"));
      symlinkSync(join(outside, "outside.md"), join(root, "plans", "linked.md"), "file");
      assert.equal(resolveLatestDurablePlan(root), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not escape a marked project to an unrelated ancestor plans directory", () => {
    const outer = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-boundary-"));
    const root = join(outer, "project");
    const nested = join(root, "packages", "app");
    try {
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "package.json"), "{}\n");
      mkdirSync(join(outer, "plans"), { recursive: true });
      writeFileSync(join(outer, "plans", "escape.md"), completePlan("escape", "outside plan"));
      assert.equal(resolveLatestDurablePlan(nested), undefined);
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked cwd parent before discovering plans", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-parent-link-"));
    const outside = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-parent-outside-"));
    try {
      writeFileSync(join(root, "package.json"), "{}\n");
      mkdirSync(join(root, "plans"), { recursive: true });
      writeFileSync(join(root, "plans", "safe.md"), completePlan("safe"));
      symlinkSync(outside, join(root, "linked-parent"), "dir");
      assert.equal(resolveLatestDurablePlan(join(root, "linked-parent", "nested")), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("uses one slug grammar for writer output and resolver discovery", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-slug-"));
    try {
      mkdirSync(join(root, "plans"), { recursive: true });
      for (const slug of ["bad--slug", "bad-", "a".repeat(81)]) {
        writeFileSync(join(root, "plans", `${slug}.md`), completePlan(slug));
      }
      writeFileSync(join(root, "plans", "good-slug.md"), completePlan("good-slug"));
      assert.equal(resolveLatestDurablePlan(root).relativePath, "plans/good-slug.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces the bounded plan size and survives unreadable or disappearing entries", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-races-"));
    try {
      mkdirSync(join(root, "plans"), { recursive: true });
      writeFileSync(join(root, "plans", "oversized.md"), Buffer.alloc(256 * 1024 + 1, "x"));
      mkdirSync(join(root, "plans", "directory.md"));
      writeFileSync(join(root, "plans", "disappeared.md"), completePlan("disappeared"));
      rmSync(join(root, "plans", "disappeared.md"));
      const unreadable = join(root, "plans", "unreadable.md");
      writeFileSync(unreadable, completePlan("unreadable"));
      chmodSync(unreadable, 0o000);

      assert.doesNotThrow(() => resolveLatestDurablePlan(root));
    } finally {
      const unreadable = join(root, "plans", "unreadable.md");
      if (existsSync(unreadable)) chmodSync(unreadable, 0o600);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names a plan across SessionStart and start-work without creating lifecycle state", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-hook-"));
    try {
      const nested = join(root, "packages", "app");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "package.json"), "{}\n");
      mkdirSync(join(root, "plans"), { recursive: true });
      const marker = "PLAN_TEXT_MUST_STAY_INERT";
      writeFileSync(join(root, "plans", "handoff.md"), completePlan("handoff", marker));
      const started = runHook("session-start", {
        hook_event_name: "SessionStart",
        cwd: nested,
        session_id: "session-b",
      });
      assert.equal(started.status, 0, started.stderr);
      const startContext = JSON.parse(started.stdout).hookSpecificOutput.additionalContext;
      assert.match(startContext, /Durable plan: \.\.\/\.\.\/plans\/handoff\.md/u);
      assert.match(startContext, /Discovery only/u);
      assert.doesNotMatch(startContext, new RegExp(marker, "u"));
      assert.deepEqual(readdirSync(join(root, ".litclaude")), ["rules"]);
      assert.equal(existsSync(join(nested, ".litclaude")), false);

      const work = runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        cwd: nested,
        session_id: "session-b",
        prompt: "$start-work plans/handoff.md",
      });
      assert.equal(work.status, 0, work.stderr);
      const workContext = JSON.parse(work.stdout).hookSpecificOutput.additionalContext;
      assert.match(workContext, /Durable plan: \.\.\/\.\.\/plans\/handoff\.md/u);
      assert.match(workContext, /Discovery only/u);
      assert.doesNotMatch(workContext, new RegExp(marker, "u"));
      assert.doesNotMatch(workContext, /<litclaude-start-work-context>/u);
      assert.doesNotMatch(workContext, /authority resumed/u);
      assert.deepEqual(readdirSync(join(root, ".litclaude")), ["rules"]);
      assert.equal(existsSync(join(nested, ".litclaude")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps hook discovery silent for a symlinked plan directory", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-hook-link-"));
    const outside = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-hook-outside-"));
    try {
      const nested = join(root, "packages", "app");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "package.json"), "{}\n");
      writeFileSync(join(outside, "linked.md"), completePlan("linked", "must stay inert"));
      symlinkSync(outside, join(root, "plans"), "dir");
      const result = runHook("session-start", {
        hook_event_name: "SessionStart",
        cwd: nested,
        session_id: "session-link",
      });
      assert.equal(result.status, 0, result.stderr);
      const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.doesNotMatch(context, /Durable plan:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps hook discovery silent for a symlinked cwd parent and plan file", () => {
    const root = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-hook-path-links-"));
    const outside = mkdtempSync(join(tmpdir(), "litclaude-durable-plan-hook-path-outside-"));
    try {
      const nested = join(root, "packages", "app");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "package.json"), "{}\n");
      mkdirSync(join(root, "plans"), { recursive: true });
      writeFileSync(join(outside, "outside.md"), completePlan("outside", "must stay inert"));

      symlinkSync(outside, join(root, "linked-parent"), "dir");
      const parentLink = runHook("session-start", {
        hook_event_name: "SessionStart",
        cwd: join(root, "linked-parent", "nested"),
        session_id: "session-parent-link",
      });
      assert.equal(parentLink.status, 0, parentLink.stderr);
      assert.doesNotMatch(
        JSON.parse(parentLink.stdout).hookSpecificOutput.additionalContext,
        /Durable plan:/u,
      );

      symlinkSync(join(outside, "outside.md"), join(root, "plans", "linked.md"), "file");
      const fileLink = runHook("session-start", {
        hook_event_name: "SessionStart",
        cwd: nested,
        session_id: "session-file-link",
      });
      assert.equal(fileLink.status, 0, fileLink.stderr);
      assert.doesNotMatch(
        JSON.parse(fileLink.stdout).hookSpecificOutput.additionalContext,
        /Durable plan:/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("enrolls the durable-plan helper in the shipped integrity manifest", () => {
    assert.equal(canonicalSkillResourceManifest.has("lib/durable-plan.mjs"), true);
  });
});
