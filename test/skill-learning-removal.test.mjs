import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalSkillIds, canonicalSkillResourceManifest } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = join(root, "plugins", "litclaude");
const hookPath = join(pluginRoot, "bin", "litclaude-hook.js");
function workspace() {
  return mkdtempSync(join(tmpdir(), "litclaude-skill-removal-"));
}

function runHook(home, event, input, extraEnv = {}) {
  return spawnSync(process.execPath, [hookPath, event], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(input),
    timeout: 5_000,
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CLAUDE_HOME: join(home, ".claude"),
      LITCLAUDE_HOME: join(home, ".litclaude-home"),
      LITCLAUDE_NO_AUTO_UPDATE: "1",
      NO_UPDATE_NOTIFIER: "1",
      ...extraEnv,
    },
  });
}

const bodyFor = (home, project, prompt) => {
  const result = runHook(home, "user-prompt-submit", {
    hook_event_name: "UserPromptSubmit",
    prompt,
    cwd: project,
  });
  assert.equal(result.status, 0, result.stderr);
  const context = result.stdout === "" ? "" : JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  return /<litclaude-skill-body name="([a-z-]+)">/u.exec(context)?.[1] ?? null;
};

describe("removed skill-learning feature", () => {
  it("does not record PreToolUse consultations", () => {
    const fixture = workspace();
    try {
      const home = join(fixture, "home");
      const project = join(fixture, "project");
      mkdirSync(home);
      mkdirSync(join(project, ".git"), { recursive: true });
      const result = runHook(home, "pre-tool-use", {
        hook_event_name: "PreToolUse",
        session_id: "removed-loop",
        cwd: project,
        tool_name: "Skill",
        tool_input: { skill: "litgoal" },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(join(project, ".litclaude", "skill-loop-state.json")), false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("does not schedule a Stop review", () => {
    const fixture = workspace();
    try {
      const home = join(fixture, "home");
      const project = join(fixture, "project");
      mkdirSync(home);
      mkdirSync(join(project, ".git"), { recursive: true });
      const sessionId = "removed-stop-review";
      const consulted = runHook(home, "pre-tool-use", {
        hook_event_name: "PreToolUse",
        session_id: sessionId,
        cwd: project,
        tool_name: "Skill",
        tool_input: { skill: "litgoal" },
      });
      assert.equal(consulted.status, 0, consulted.stderr);
      const correction = runHook(home, "user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        cwd: project,
        prompt: "don't summarize, just list the verified files",
      });
      assert.equal(correction.status, 0, correction.stderr);

      const stop = runHook(home, "stop", {
        hook_event_name: "Stop",
        session_id: sessionId,
        cwd: project,
        transcript_path: join(project, "missing-transcript.jsonl"),
        stop_hook_active: false,
      }, { LITCLAUDE_CLAUDE_BIN: join(fixture, "no-host-claude") });
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal(existsSync(join(project, ".litclaude", "pending-review.json")), false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("has no skill-observer route or pinned resource", () => {
    const fixture = workspace();
    try {
      const home = join(fixture, "home");
      const project = join(fixture, "project");
      mkdirSync(home);
      mkdirSync(join(project, ".git"), { recursive: true });
      assert.equal(canonicalSkillIds.includes("skill-observer"), false);
      assert.equal(bodyFor(home, project, "skill-observer"), null);
      assert.equal(bodyFor(home, project, "$skill-observer"), null);
      assert.equal(bodyFor(home, project, "/litclaude:skill-observer list"), null);
      assert.equal(existsSync(join(pluginRoot, "skills", "skill-observer")), false);
      assert.equal(existsSync(join(pluginRoot, "commands", "skill-observer.md")), false);
      assert.equal(existsSync(join(pluginRoot, "lib", "skill-observer.mjs")), false);
      assert.equal(existsSync(join(pluginRoot, "lib", "skill-loop")), false);
      const hookManifest = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
      const statusMessages = Object.values(hookManifest.hooks)
        .flatMap((groups) => groups.flatMap(({ hooks }) => hooks.map(({ statusMessage }) => statusMessage ?? "")))
        .join("\n");
      assert.doesNotMatch(statusMessages, /skill proposals|skill learning|skill consultations|skill review/iu);
      assert.equal([...canonicalSkillResourceManifest.keys()].some((path) => (
        path.startsWith("lib/skill-loop/")
        || path === "lib/skill-observer.mjs"
        || path.startsWith("skills/skill-observer/")
      )), false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("leaves stale review files byte-identical and inert", () => {
    const fixture = workspace();
    try {
      const home = join(fixture, "home");
      const project = join(fixture, "project");
      const state = join(project, ".litclaude");
      mkdirSync(home);
      mkdirSync(join(project, ".git"), { recursive: true });
      mkdirSync(state);
      const files = new Map([
        ["pending-review.json", `${JSON.stringify({
          schema: "litclaude.pending-skill-review/v1",
          sessionId: "stale-state",
          createdAt: "2026-09-01T00:00:00.000Z",
          transcriptPath: join(project, "stale-transcript.jsonl"),
          reasons: ["correction"],
          consultedSkills: ["litgoal"],
          remainingAllowance: 3,
          status: "pending",
          claimedAt: null,
          completedAt: null,
          queuedProposalIds: [],
        }, null, 2)}\n`],
        ["skill-loop-state.json", `${JSON.stringify({
          schema: "litclaude.skill-loop-state/v1",
          updatedAt: "2026-09-01T00:00:00.000Z",
          sessions: { "stale-state": {
            sessionId: "stale-state",
            toolIterations: 0,
            consultedSkills: ["litgoal"],
            correctionCount: 0,
            proposalCount: 0,
            pendingReview: true,
            recordingDisabled: false,
            lastActivityAt: "2026-09-01T00:00:00.000Z",
          } },
        }, null, 2)}\n`],
      ]);
      const snapshots = new Map();
      for (const [name, contents] of files) {
        const path = join(state, name);
        writeFileSync(path, contents);
        snapshots.set(name, { bytes: readFileSync(path), mtimeMs: statSync(path).mtimeMs });
      }

      const events = [
        ["session-start", { hook_event_name: "SessionStart", session_id: "stale-state", cwd: project }],
        ["pre-tool-use", {
          hook_event_name: "PreToolUse", session_id: "stale-state", cwd: project,
          tool_name: "Skill", tool_input: { skill: "litgoal" },
        }],
        ["pre-tool-use", {
          hook_event_name: "PreToolUse", session_id: "stale-state", cwd: project,
          tool_name: "Skill", tool_input: { skill: "litgoal" },
        }],
        ["pre-tool-use", {
          hook_event_name: "PreToolUse", session_id: "stale-state", cwd: project,
          tool_name: "Skill", tool_input: { skill: "litgoal" },
        }],
        ["stop", {
          hook_event_name: "Stop", session_id: "stale-state", cwd: project,
          transcript_path: join(project, "missing-transcript.jsonl"), stop_hook_active: false,
        }],
      ];
      for (const [event, input] of events) {
        const result = runHook(home, event, input, { LITCLAUDE_CLAUDE_BIN: join(fixture, "no-host-claude") });
        assert.equal(result.status, 0, `${event}: ${result.stderr}`);
        assert.equal(result.stderr, "", `${event} must not report an inert stale file`);
      }

      for (const name of files.keys()) {
        const path = join(state, name);
        const before = snapshots.get(name);
        assert.equal(existsSync(path), true, `${name} must not be deleted`);
        assert.equal(readFileSync(path).compare(before.bytes), 0, `${name} bytes must remain unchanged`);
        assert.equal(statSync(path).mtimeMs, before.mtimeMs, `${name} must not be rewritten`);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("does not pack the removed loop module or observer skill", () => {
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, npm_config_ignore_scripts: "true" },
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const [manifest] = JSON.parse(packed.stdout);
    const paths = manifest.files.map(({ path }) => path);
    assert.equal(paths.some((path) => path.startsWith("plugins/litclaude/lib/skill-loop/")), false);
    assert.equal(paths.some((path) => path.startsWith("plugins/litclaude/skills/skill-observer/")), false);
  });
});
