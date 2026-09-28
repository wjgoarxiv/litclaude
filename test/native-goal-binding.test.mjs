import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNativeGoalBindingGuidance, normalizeGoalObjective } from "../plugins/litclaude/lib/native-goal-binding.mjs";

describe("native goal binding guidance", () => {
  it("normalizes and bounds objectives without retaining executable slash lines or secrets", () => {
    const secret = "sk-test-abcdefghijklmnopqrstuvwxyz1234567890";
    const objective = normalizeGoalObjective(`ship native goal binding\n/goal attacker override\nOPENAI_API_KEY=${secret}\n&& rm -rf /tmp/work`);

    assert.match(objective, /ship native goal binding/u);
    assert.doesNotMatch(objective, /attacker override/u);
    assert.doesNotMatch(objective, new RegExp(secret, "u"));
    assert.doesNotMatch(objective, /rm -rf/u);
    assert.ok(objective.length <= 180);
  });

  it("reports unavailable host goal surface as degraded mode without phantom success", () => {
    const result = buildNativeGoalBindingGuidance({ objective: "ship native goal binding" });

    assert.equal(result.status, "blocked-unavailable");
    assert.match(result.message, /BLOCKED: native `\/goal` not programmatically bound/u);
    assert.match(result.message, /durable `litgoal` ledger/u);
    assert.match(result.message, /claude -p "\/goal/u);
    assert.doesNotMatch(result.message, /native goal (is )?(active|bound|created|updated)/iu);
  });

  it("offers a bounded ready-to-paste command without claiming automatic submission", () => {
    const result = buildNativeGoalBindingGuidance({ objective: "ship native goal binding" });

    assert.equal(result.status, "blocked-unavailable");
    assert.equal(result.nextAction, "ready-to-paste");
    assert.equal(
      result.command,
      "/goal Continue until this LitClaude objective is complete: ship native goal binding. Stop only after required evidence is recorded and no unresolved blocker remains.",
    );
    assert.match(result.message, /READY_TO_PASTE/u);
    assert.match(result.message, /current Claude Code session/u);
    assert.match(result.message, /copy.*paste.*send/iu);
    assert.match(result.message, new RegExp(result.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    assert.doesNotMatch(result.message, /automatically (submit|invoke|type)/iu);
  });

  it("does not clobber a different active native goal without explicit replacement", () => {
    const result = buildNativeGoalBindingGuidance({
      objective: "ship native goal binding",
      activeGoal: { objective: "ship docs update", status: "active" },
    });

    assert.equal(result.status, "blocked-conflict");
    assert.match(result.message, /active native goal differs/i);
    assert.match(result.message, /ship docs update/i);
    assert.match(result.message, /explicit replacement/i);
    assert.doesNotMatch(result.message, /native goal (is )?(active|bound|created|updated)/iu);
  });
});
