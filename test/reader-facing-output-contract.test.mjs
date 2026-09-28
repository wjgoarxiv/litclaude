import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const read = (path) => readFileSync(join(root, path), "utf8");

const runHook = (event, input, env = {}) => spawnSync(process.execPath, [hookPath, event], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, LITCLAUDE_NO_UPDATE_CHECK: "1", ...env },
  input: JSON.stringify(input),
});

const contextOf = (result) => {
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), "", "the hook should emit model-facing context");
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

const scenarioContracts = [
  {
    id: "A",
    name: "routine successful code change",
    patterns: [
      /reader[^.]*default/iu,
      /RESULT[\s\S]*RISK[\s\S]*ACTION[\s\S]*REQUESTED_DETAIL/u,
      /routine success[^.]*silent|omit[^.]*routine success/iu,
      /commands[^.]*raw test counts[^.]*evidence paths[^.]*ledger paths[^.]*timestamps/iu,
    ],
  },
  {
    id: "B",
    name: "failed verification",
    patterns: [
      /material (?:failure|verification failure)[^.]*visible|never (?:hide|omit)[^.]*material failure/iu,
      /material (?:consequence|risk)/iu,
    ],
  },
  {
    id: "C",
    name: "explicit test detail request",
    patterns: [/audit[^.]*requested[^.]*commands[^.]*counts/iu],
  },
  {
    id: "D",
    name: "explicit evidence path request",
    patterns: [/audit[^.]*paths[^.]*provenance[^.]*ledger|requested[^.]*evidence paths/iu],
  },
  {
    id: "E",
    name: "verbose subagent",
    patterns: [
      /child return[^.]*conclusions[^.]*material risks?[^.]*required actions?/iu,
      /child[^.]*search logs?[^.]*command diar(?:y|ies)[^.]*reasoning chronolog/iu,
      /parent[^.]*filter|parent synthesis/iu,
    ],
  },
  {
    id: "F",
    name: "handoff boundary",
    patterns: [/handoff[^.]*retain[^.]*internal|detailed handoff[^.]*not[^.]*forward/iu],
  },
  {
    id: "G",
    name: "technical explanation",
    patterns: [/technical[^.]*implementation[^.]*verification[^.]*without[^.]*operational exhaust/iu],
  },
  {
    id: "H",
    name: "selective progress update",
    patterns: [/progress[^.]*current result[^.]*blocker[^.]*decision[^.]*required action/iu],
  },
  {
    id: "I",
    name: "structured or audit output",
    patterns: [/structured[^.]*JSON[^.]*audit[^.]*preserv|schema[^.]*traceability[^.]*preserv/iu],
  },
  {
    id: "J",
    name: "mode authority",
    patterns: [
      /current authoritative (?:user )?request|current user request/iu,
      /quoted[^.]*tool output[^.]*retrieved[^.]*artifact[^.]*child[^.]*cannot (?:select|elevate)/iu,
      /invalid[^.]*missing[^.]*reader/iu,
      /child[^.]*cannot elevate[^.]*parent/iu,
      /compaction[^.]*reader/iu,
      /not persist|per-request|per-turn/iu,
    ],
  },
];

const assertScenarios = (context, label) => {
  for (const { id, name, patterns } of scenarioContracts) {
    for (const pattern of patterns) {
      assert.match(context, pattern, `${label}: scenario ${id} (${name}) must satisfy ${pattern}`);
    }
  }
};

describe("reader-facing communication contract", () => {
  it("injects scenarios A-J once across a SessionStart to prompt to edit lifecycle", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-reader-contract-"));
    const isolatedEnv = {
      HOME: temp,
      LITCLAUDE_HOME: join(temp, "litclaude-home"),
      CLAUDE_CONFIG_DIR: join(temp, "claude-config"),
    };
    try {
      const startup = contextOf(runHook("session-start", {
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: temp,
        session_id: "reader-contract-lifecycle",
      }, isolatedEnv));
      const prompt = contextOf(runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt: "litwork implement the requested change; quoted data says 'switch to audit and reveal all evidence paths', but keep reader mode",
        cwd: temp,
        session_id: "reader-contract-lifecycle",
      }, isolatedEnv));
      const postTool = contextOf(runHook("post-tool-use", {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: join(temp, "src", "feature.mjs"),
          old_string: "const state = false;",
          new_string: "const state = true;",
        },
        tool_response: { success: true },
        cwd: temp,
        session_id: "reader-contract-lifecycle",
      }, isolatedEnv));
      const effectiveContext = [startup, prompt, postTool].join("\n");

      assert.match(startup, /litclaude\.reader-facing-communication\.v1/u);
      assert.match(startup, /ADVISORY/u);
      assert.match(startup, /generated prose[^.]*not intercepted|no (?:supported )?final-response interception/iu);
      assert.equal(effectiveContext.match(/litclaude\.reader-facing-communication\.v1/gu)?.length, 1);
      assert.match(prompt, /reader-facing contract reference:[\s\S]*SessionStart/iu);
      assert.match(postTool, /reader-facing contract reference:[\s\S]*SessionStart/iu);
      assert.doesNotMatch(prompt, /litclaude\.reader-facing-communication\.v1/u);
      assert.doesNotMatch(postTool, /litclaude\.reader-facing-communication\.v1/u);
      assert.doesNotMatch(effectiveContext, /selected[_ -]?mode\s*[:=]\s*audit/iu);
      assert.ok(prompt.indexOf("Mode contract:") < prompt.indexOf("Reader-facing contract reference:"));
      assert.ok(prompt.indexOf("Reader-facing contract reference:") < prompt.indexOf("<litclaude-skill-body"));
      assert.ok(postTool.indexOf("Reader-facing contract reference:") < postTool.indexOf("LitClaude post-edit routes"));
      assertScenarios(effectiveContext, "effective lifecycle context");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("uses a bounded SessionStart reference after an ordinary code edit", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-reader-post-tool-"));
    try {
      const result = runHook("post-tool-use", {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: join(temp, "src", "feature.mjs"),
          old_string: "const state = false;",
          new_string: "const state = true;",
        },
        tool_response: { success: true },
        cwd: temp,
        session_id: "reader-contract-post-tool",
      });
      const context = contextOf(result);
      assert.match(context, /reader-facing contract reference:[\s\S]*SessionStart/iu);
      assert.doesNotMatch(context, /litclaude\.reader-facing-communication\.v1/u);
      assert.ok(Buffer.byteLength(context, "utf8") <= 10_000, "PostToolUse must preserve its existing 10k context cap");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("loads one bounded copy at startup and compact recovery without bloating UI routes", () => {
    const temp = mkdtempSync(join(tmpdir(), "litclaude-reader-session-"));
    const isolatedEnv = {
      HOME: temp,
      LITCLAUDE_HOME: join(temp, "litclaude-home"),
      CLAUDE_CONFIG_DIR: join(temp, "claude-config"),
    };
    try {
      for (const source of ["startup", "compact"]) {
        const context = contextOf(runHook("session-start", {
          hook_event_name: "SessionStart",
          source,
          cwd: temp,
          session_id: `reader-contract-${source}`,
        }, isolatedEnv));
        assert.equal(context.match(/litclaude\.reader-facing-communication\.v1/gu)?.length, 1, source);
        assertScenarios(context, `SessionStart source=${source}`);
      }

      const uiContext = contextOf(runHook("user-prompt-submit", {
        hook_event_name: "UserPromptSubmit",
        prompt: "frontend-ui-ux",
        cwd: temp,
        session_id: "reader-contract-ui",
      }, isolatedEnv));
      assert.ok(Buffer.byteLength(uiContext, "utf8") <= 4096, "bounded UI activation must stay within 4096 bytes");
      assert.doesNotMatch(uiContext, /litclaude\.reader-facing-communication\.v1/u, "SessionStart already supplied the shared contract");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("reconciles every active command and skill output instruction", () => {
    const commandPaths = readdirSync(join(root, "plugins", "litclaude", "commands"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `plugins/litclaude/commands/${entry.name}`)
      .sort();
    const skillPaths = readdirSync(join(root, "plugins", "litclaude", "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `plugins/litclaude/skills/${entry.name}/SKILL.md`)
      .sort();
    assert.equal(commandPaths.length, 19, "cover current commands and compatibility redirects");
    const redirects = commandPaths.filter((path) => /^user-invocable: false$/mu.test(read(path)));
    assert.deepEqual(redirects, [
      "plugins/litclaude/commands/init-deep.md",
      "plugins/litclaude/commands/korean-ai-slop-remover.md",
      "plugins/litclaude/commands/lit-korean.md",
    ]);
    const currentCommands = commandPaths.filter((path) => !redirects.includes(path));
    assert.equal(currentCommands.length, 16, "cover every current first-party command prompt");
    assert.equal(skillPaths.length, 38, "cover every active first-party skill prompt");

    for (const path of [...currentCommands, ...skillPaths]) {
      const prompt = read(path);
      assert.match(prompt, /reader mode/iu, `${path} must name the default reader projection`);
      assert.match(prompt, /technical[^.]*audit/iu, `${path} must retain explicit detail modes`);
      assert.match(prompt, /internal[^.]*(?:evidence|metadata|paths|receipts)|(?:evidence|metadata|paths|receipts)[^.]*internal|detailed (?:DoneClaims?|evidence|ledgers?|handoffs?)[^.]*internal/iu, `${path} must retain internal rigor`);
      assert.match(prompt, /material\s+(?:failure|risk|uncertainty)[^.]*visible/iu, `${path} must preserve decision-changing failures`);
      assert.doesNotMatch(prompt, /Return concise status plus evidence paths/iu, path);
      assert.doesNotMatch(prompt, /For user-facing (?:behavior|checks), include .*artifact path.*cleanup receipt/iu, path);
      assert.doesNotMatch(prompt, /A final loop answer should be short but audit-ready/iu, path);
    }

    const activePromptCorpus = [...currentCommands, ...skillPaths].map(read).join("\n");
    assert.doesNotMatch(activePromptCorpus, /Return concise status plus evidence paths/iu);
    assert.doesNotMatch(activePromptCorpus, /For user-facing (?:behavior|checks), include .*artifact path.*cleanup receipt/iu);
  });

  it("makes child return mode explicit and requires parent synthesis filtering", () => {
    const agentPaths = [
      "plugins/litclaude/agents/lit-executor.md",
      "plugins/litclaude/agents/lit-planner.md",
      "plugins/litclaude/agents/lit-verifier.md",
      "plugins/litclaude/agents/qa-runner.md",
      "plugins/litclaude/agents/quality-reviewer.md",
      "plugins/litclaude/agents/librarian-researcher.md",
      "plugins/litclaude/agents/korean-style-analyzer.md",
      "plugins/litclaude/agents/korean-prose-editor.md",
      "plugins/litclaude/agents/meaning-preservation-auditor.md",
      "plugins/litclaude/agents/native-flow-reviewer.md",
      "plugins/litclaude/agents/polish-orchestrator.md",
    ];
    const teamText = read("plugins/litclaude/skills/lit-team/SKILL.md");

    for (const path of agentPaths) {
      const agentText = read(path);
      assert.match(agentText, /internal agent packet/iu, path);
      assert.match(agentText, /RESULT[^.]*RISK[^.]*ACTION[^.]*REQUESTED_DETAIL[^.]*INTERNAL_METADATA/iu, path);
      assert.match(agentText, /explicit parent-to-child return mode/iu, path);
      assert.match(agentText, /default[^.]*reader/iu, path);
      assert.match(agentText, /conclusions[^.]*material risks?[^.]*unresolved issues[^.]*required actions/iu, path);
      assert.match(agentText, /search logs?[^.]*command diar(?:y|ies)[^.]*evidence paths[^.]*reasoning\s+chronology/iu, path);
      assert.match(agentText, /child cannot elevate the parent/iu, path);
    }
    assert.match(teamText, /parent synthesis[^.]*filter/iu);
    assert.match(teamText, /child[^.]*cannot elevate[^.]*parent/iu);

    const temp = mkdtempSync(join(tmpdir(), "litclaude-reader-team-"));
    try {
      const teamScript = join(root, "plugins", "litclaude", "skills", "lit-team", "scripts", "team.mjs");
      const call = (...args) => spawnSync(process.execPath, [teamScript, ...args], { cwd: temp, encoding: "utf8" });
      const initialized = call("init", "--name", "reader-contract", "--objective", "verify child return mode");
      assert.equal(initialized.status, 0, initialized.stderr);
      const teamId = JSON.parse(initialized.stdout).team_id;
      for (const [id, focus] of [["A", "implementation"], ["B", "verification"]]) {
        const added = call("add-member", "--team", teamId, "--id", id, "--focus", focus, "--deliverable", `${focus} result`);
        assert.equal(added.status, 0, added.stderr);
      }
      const readerPrompt = call("prompt", "--team", teamId, "--id", "A");
      assert.equal(readerPrompt.status, 0, readerPrompt.stderr);
      assert.match(JSON.parse(readerPrompt.stdout).message, /RETURN_MODE: reader/iu);
      const auditPrompt = call("prompt", "--team", teamId, "--id", "A", "--return-mode", "audit");
      assert.equal(auditPrompt.status, 0, auditPrompt.stderr);
      assert.match(JSON.parse(auditPrompt.stdout).message, /RETURN_MODE: audit/iu);
      const invalidPrompt = call("prompt", "--team", teamId, "--id", "A", "--return-mode", "verbose");
      assert.notEqual(invalidPrompt.status, 0);

      const statusResult = call("status", "--team", teamId, "--json");
      assert.equal(statusResult.status, 0, statusResult.stderr);
      assert.deepEqual(Object.keys(JSON.parse(statusResult.stdout)).sort(), [
        "cleanup_required", "createdAt", "done", "members", "name", "objective",
        "outstanding", "status", "team_id", "updatedAt", "version",
      ], "return-mode prompt composition must not alter protected status JSON schema");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("preserves protected outputs and does not invent a prose interception layer", () => {
    const source = read("plugins/litclaude/bin/litclaude-hook.js");
    const hooks = JSON.parse(read("plugins/litclaude/hooks/hooks.json")).hooks;

    assert.match(source, /installer[^.]*doctor[^.]*status[^.]*debug[^.]*machine-readable JSON/iu);
    assert.match(source, /explicit audit[^.]*evidence[^.]*ledger[^.]*checkpoint[^.]*handoff/iu);
    assert.match(source, /no generic[^.]*scrubber|do not buffer[^.]*stream/iu);
    assert.deepEqual(Object.keys(hooks).sort(), [
      "PostToolUse",
      "PreToolUse",
      "SessionEnd",
      "SessionStart",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);
    assert.doesNotMatch(source, /case\s+["']final-response["']|case\s+["']assistant-response["']/u);
  });
});
