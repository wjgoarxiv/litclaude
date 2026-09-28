import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createStartWorkContinuation } from "../plugins/litclaude/lib/start-work-continuation.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");

const makeFixtureRoot = () => mkdtempSync(join(tmpdir(), "litclaude-start-work-next-"));

const writeFixture = (fixtureRoot) => {
  mkdirSync(join(fixtureRoot, ".litclaude", "plans"), { recursive: true });
  mkdirSync(join(fixtureRoot, ".litclaude", "start-work"), { recursive: true });
  writeFileSync(
    join(fixtureRoot, ".litclaude", "boulder.json"),
    `${JSON.stringify(
      {
        schema_version: 2,
        active_work_id: "workflow-gap",
        works: {
          "workflow-gap": {
            work_id: "workflow-gap",
            active_plan: ".litclaude/plans/workflow-gap.md",
            plan_name: "workflow-gap",
            session_ids: ["test-session"],
            status: "active",
            worktree_path: "/tmp/litclaude-worktree",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(fixtureRoot, ".litclaude", "plans", "workflow-gap.md"),
    [
      "# Workflow Gap Plan",
      "",
      "## Implementation Waves",
      "",
      "```md",
      "- [ ] illustrative fenced checkbox must not be selected",
      "```",
      "- [x] Inspect current state.",
      "- [ ] Add continuation helper.",
      "  - [ ] nested acceptance criterion must not be selected",
      "- [ ] Run final verification.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(fixtureRoot, ".litclaude", "start-work", "ledger.jsonl"), "");
};

test("start-work continuation returns null without active Boulder state", () => {
  const fixtureRoot = makeFixtureRoot();
  try {
    assert.equal(createStartWorkContinuation(fixtureRoot, { sessionId: "test-session" }), null);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("start-work continuation identifies the next top-level checkbox", () => {
  const fixtureRoot = makeFixtureRoot();
  try {
    writeFixture(fixtureRoot);

    const directive = createStartWorkContinuation(fixtureRoot, { sessionId: "test-session" });

    assert.notEqual(directive, null);
    assert.match(directive, /Workflow Gap Plan/u);
    assert.match(directive, /\.litclaude\/plans\/workflow-gap\.md/u);
    assert.match(directive, /\.litclaude\/start-work\/ledger\.jsonl/u);
    assert.match(directive, /Add continuation helper/u);
    assert.match(directive, /\/tmp\/litclaude-worktree/u);
    assert.doesNotMatch(directive, /nested acceptance/u);
    assert.doesNotMatch(directive, /illustrative fenced checkbox/u);
    assert.doesNotMatch(directive, /# REFERENCE/u);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("start-work continuation resolves Claude-host session id as-is (no foreign prefix)", () => {
  const fixtureRoot = makeFixtureRoot();
  try {
    mkdirSync(join(fixtureRoot, ".litclaude", "plans"), { recursive: true });
    mkdirSync(join(fixtureRoot, ".litclaude", "start-work"), { recursive: true });
    writeFileSync(
      join(fixtureRoot, ".litclaude", "boulder.json"),
      `${JSON.stringify(
        {
          schema_version: 2,
          works: {
            "claude-work": {
              work_id: "claude-work",
              active_plan: ".litclaude/plans/claude-work.md",
              plan_name: "claude-work",
              session_ids: ["claude-session-abc"],
              status: "active",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(fixtureRoot, ".litclaude", "plans", "claude-work.md"),
      ["# Claude Work Plan", "", "## TODOs", "", "- [ ] First task.", ""].join("\n"),
    );
    writeFileSync(join(fixtureRoot, ".litclaude", "start-work", "ledger.jsonl"), "");

    const directive = createStartWorkContinuation(fixtureRoot, { sessionId: "claude-session-abc" });

    assert.notEqual(directive, null, "should find active work for Claude-host session id stored as-is");
    assert.match(directive, /First task/u);
    // session id must be used verbatim — no host-specific prefix should appear in the directive
    assert.doesNotMatch(directive, /codex/u);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("start-work continuation CLI emits JSON without mutating state", () => {
  const fixtureRoot = makeFixtureRoot();
  try {
    writeFixture(fixtureRoot);

    const before = readFileSync(join(fixtureRoot, ".litclaude", "boulder.json"), "utf8");
    const result = spawnSync(process.execPath, [binPath, "start-work-next", "--root", fixtureRoot, "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LITCLAUDE_HOME: fixtureRoot },
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, "active");
    assert.match(parsed.directive, /Add continuation helper/u);
    assert.equal(readFileSync(join(fixtureRoot, ".litclaude", "boulder.json"), "utf8"), before);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
