import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readStack } from "../plugins/litclaude/lib/workflow-stack.mjs";

// On the real host a background review lane ends with no `last_assistant_message` at SubagentStop:
// its report is the `SubagentHandback` call at the end of its transcript, and the prompt the model
// wrote opens with a heading such as `# Scope/diff verification`, not `Review lane: …`. The lane
// stayed at running on the card. These cases replay that shape through the real hook process.

const hookPath = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));
const SESSION = "handback-session";

const runHook = (project, event, input, env) => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: project,
    encoding: "utf8",
    env,
    input: JSON.stringify({ cwd: project, session_id: SESSION, prompt_id: "prompt-1", hook_event_name: event, ...input }),
  });
  assert.equal(result.status, 0, `${event}: ${result.stderr}`);
  return result;
};

const runHookAsync = (project, event, input, env) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [hookPath, event], { cwd: project, env, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", fail);
  child.on("close", (status) => (status === 0 ? done() : fail(new Error(`${event}: ${stderr}`))));
  child.stdin.end(JSON.stringify({ cwd: project, session_id: SESSION, prompt_id: "prompt-1", hook_event_name: event, ...input }));
});

const LANES = [
  { lane: "goal", description: "Lane 1: scope/diff verification", heading: "# Scope/diff verification", n: 1 },
  { lane: "qa", description: "Lane 2: tests/evidence execution", heading: "# Tests/evidence execution", n: 2 },
  { lane: "quality", description: "Lane 3: package/payload and code quality", heading: "# Package/payload and code quality review", n: 3 },
  { lane: "security", description: "Lane 4: security/provenance review", heading: "# Security/provenance review", n: 4 },
  { lane: "context", description: "Lane 5: real-surface/docs readiness", heading: "# Real-surface/docs readiness", n: 5 },
];

const promptOf = ({ heading, n }) => `${heading}\n\nWork review, lane ${n} of 5, using review-work and rules discipline. Read-only.\n\nReturn: verdict: PASS | FAIL\n`;

// The transcript as Claude Code writes it today: the prompt, a large request record, the
// handback call, then the host's receipt for it.
const writeTranscript = (path, prompt, report, { handback = true } = {}) => {
  const lines = [
    { type: "user", isSidechain: true, message: { role: "user", content: prompt } },
    { type: "api-request", params: { padding: "x".repeat(300_000) } },
    handback
      ? { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "SubagentHandback", input: { message: report } }] } }
      : { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: report }] } },
    { type: "user", isSidechain: true, message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content: [{ type: "text", text: "{\"success\":true,\"message\":\"Report delivered to your caller.\"}" }] }] } },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
};

const withReview = async (body) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-handback-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    runHook(project, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "litclaude:review-work" } }, env);
    return await body(project, env);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
};

const verdicts = (project) => readStack(project, SESSION).frames.findLast((frame) => frame.family === "main" && frame.stage === "review")?.verdicts ?? {};

const stopLane = (project, env, lane, report, options) => {
  const transcript = join(project, `agent-${lane.lane}.jsonl`);
  writeTranscript(transcript, promptOf(lane), report, options);
  runHook(project, "subagent-stop", { agent_id: `agent-${lane.lane}`, agent_type: "litclaude:lit-verifier", agent_transcript_path: transcript, stop_hook_active: false }, env);
};

test("a background lane's handback verdict reaches its lane when the prompt has only a heading", () => withReview((project, env) => {
  for (const lane of LANES) {
    runHook(project, "pre-tool-use", { tool_name: "Agent", tool_input: { description: lane.description, prompt: promptOf(lane), run_in_background: true } }, env);
  }
  assert.deepEqual(verdicts(project), { goal: "running", qa: "running", quality: "running", security: "running", context: "running" });
  stopLane(project, env, LANES[0], "Review mode: work review (lane 1 of 5, scope/diff)\n\nVerdict: PASS (confidence MEDIUM-HIGH)\n\nOnly math.mjs changed.");
  assert.equal(verdicts(project).goal, "pass", "the handback's Verdict line lands on the goal lane");
  stopLane(project, env, LANES[3], "Verdict: FAIL\n\n- token printed in a log line");
  assert.equal(verdicts(project).security, "fail");
  for (const lane of [LANES[1], LANES[2], LANES[4]]) stopLane(project, env, lane, "**Verdict:** PASS");
  assert.deepEqual(verdicts(project), { goal: "pass", qa: "pass", quality: "pass", security: "fail", context: "pass" });
}));

test("a lane whose last message is plain text still reports from its transcript", () => withReview((project, env) => {
  runHook(project, "pre-tool-use", { tool_name: "Agent", tool_input: { description: LANES[1].description, prompt: promptOf(LANES[1]), run_in_background: true } }, env);
  stopLane(project, env, LANES[1], "verdict: PASS\nconfidence: HIGH", { handback: false });
  assert.equal(verdicts(project).qa, "pass");
}));

test("a heading names a lane only for a reviewer review-work spawned", () => withReview((project, env) => {
  // No PreToolUse marked qa running, so a stray subagent with a `# Tests …` heading moves nothing.
  stopLane(project, env, LANES[1], "Verdict: PASS");
  assert.equal(verdicts(project).qa, undefined);
}));

test("a non-review subagent records nothing", () => withReview((project, env) => {
  const transcript = join(project, "agent-explore.jsonl");
  writeTranscript(transcript, "Find every caller of parseConfig.", "Found three callers.");
  runHook(project, "subagent-stop", { agent_id: "agent-explore", agent_type: "Explore", agent_transcript_path: transcript, stop_hook_active: false }, env);
  assert.deepEqual(verdicts(project), {});
}));

test("five lanes stopping at once all keep their verdicts", async () => {
  // On the host the five background lanes finish within a second; each stop rewrote the whole
  // stack from what it had read, so a later write dropped an earlier lane's verdict.
  for (let round = 0; round < 4; round += 1) {
    const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-handback-race-")));
    const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
    try {
      mkdirSync(join(project, ".git"));
      runHook(project, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "litclaude:review-work" } }, env);
      for (const lane of LANES) runHook(project, "pre-tool-use", { tool_name: "Agent", tool_input: { description: lane.description, prompt: promptOf(lane), run_in_background: true } }, env);
      await Promise.all(LANES.map((lane) => {
        const transcript = join(project, `agent-${lane.lane}.jsonl`);
        writeTranscript(transcript, promptOf(lane), "Verdict: PASS");
        return runHookAsync(project, "subagent-stop", { agent_id: `agent-${lane.lane}`, agent_transcript_path: transcript, stop_hook_active: false }, env);
      }));
      assert.deepEqual(verdicts(project), { goal: "pass", qa: "pass", quality: "pass", security: "pass", context: "pass" }, `round ${round}`);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }
});

test("a lane's handback written just after SubagentStop still lands", () => withReview(async (project, env) => {
  // The host can run SubagentStop before it flushes the lane's last entries: at the stop the
  // transcript ended at the request record, and the handback reached the file a moment later.
  runHook(project, "pre-tool-use", { tool_name: "Agent", tool_input: { description: LANES[2].description, prompt: promptOf(LANES[2]), run_in_background: true } }, env);
  const transcript = join(project, "agent-quality.jsonl");
  writeTranscript(transcript, promptOf(LANES[2]), "Verdict: PASS");
  const full = readFileSync(transcript, "utf8").split("\n");
  writeFileSync(transcript, `${full.slice(0, 2).join("\n")}\n`);
  const stopped = runHookAsync(project, "subagent-stop", { agent_id: "agent-quality", agent_transcript_path: transcript, stop_hook_active: false }, env);
  await new Promise((done) => setTimeout(done, 400));
  writeFileSync(transcript, full.join("\n"));
  await stopped;
  assert.equal(verdicts(project).quality, "pass");
}));

test("a lane still at work when it stops waits only briefly and records nothing", () => withReview(async (project, env) => {
  runHook(project, "pre-tool-use", { tool_name: "Agent", tool_input: { description: LANES[2].description, prompt: promptOf(LANES[2]), run_in_background: true } }, env);
  const transcript = join(project, "agent-quality.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "user", message: { role: "user", content: promptOf(LANES[2]) } })}\n${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reading math.mjs." }, { type: "tool_use", id: "t", name: "Read", input: {} }] } })}\n`);
  const started = Date.now();
  await runHookAsync(project, "subagent-stop", { agent_id: "agent-quality", agent_transcript_path: transcript, stop_hook_active: false }, env);
  assert.ok(Date.now() - started < 6_000, "the hook gives up well inside its 10 s timeout");
  assert.equal(verdicts(project).quality, "running");
}));
