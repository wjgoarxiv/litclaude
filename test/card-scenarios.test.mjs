import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";
import { applyStackEvent, emptyStack } from "../plugins/litclaude/lib/workflow-stack.mjs";

// The terminal LIT card scenarios of plans/2026-11-16-next-updates.md D1, at the record level.
const at = (n) => new Date(Date.UTC(2026, 10, 18, 0, 0, n));
const run = (events) => events.reduce((stack, event, index) => applyStackEvent(stack, event, at(index)).stack, emptyStack("card"));
const brief = (stack) => stack.frames.map((frame) => `${frame.skill}:${frame.role}:${frame.stage ?? "-"}:${frame.status}`);

test("D1-1: a second lit mid loop keeps the loop's stage", () => {
  const stack = run([{ type: "start", skill: "lit-loop" }, { type: "move", family: "loop", stage: "GREEN" }, { type: "start", skill: "lit-loop" }]);
  assert.deepEqual(brief(stack), ["lit-loop:spine:GREEN:active"]);
});

test("D1-2: a side skill that finished hands the loop back instead of leaving it paused", () => {
  const stack = run([{ type: "start", skill: "lit-loop" }, { type: "move", family: "loop", stage: "RED" }, { type: "start", skill: "lit-plan" }, { type: "move", family: "main", stage: "plan", done: true }]);
  assert.deepEqual(brief(stack), ["lit-loop:spine:RED:active"]);
  const open = run([{ type: "start", skill: "lit-loop" }, { type: "start", skill: "lit-plan" }, { type: "move", family: "main", stage: "plan" }]);
  assert.deepEqual(brief(open).map((row) => row.split(":").at(-1)), ["paused", "active"], "an unfinished side keeps the loop paused");
});

test("D1-5: a fourth frame drops a side frame, never the spine", () => {
  const stack = run([{ type: "start", skill: "lit-loop" }, { type: "start", skill: "lit-plan" }, { type: "start", skill: "litresearch" }, { type: "start", skill: "review-work" }]);
  assert.equal(stack.frames.length, 3);
  assert.equal(stack.frames[0].skill, "lit-loop");
  assert.equal(stack.frames[0].role, "spine");
});

test("D1-4: after Esc (turn over) this session's frame rows read idle, not running", () => {
  const frames = run([{ type: "start", skill: "lit-loop" }, { type: "start", skill: "lit-plan" }]).frames.map((frame) => ({ ...frame, at: Date.parse(frame.at) || Date.parse(at(1)) }));
  const snapshot = { workflow: { stack: { frames }, sessionId: "card" } };
  const now = Date.parse(at(5));
  const rowStates = (isWorking) => buildBandModel({ snapshot, now, isWorking }).threads?.chain.map((thread) => thread.state);
  assert.deepEqual(rowStates(true), ["paused", "running"]);
  assert.deepEqual(rowStates(false), ["paused", "idle"]);
});

test("D1-7: nested rows and wide (CJK) or long names keep every gauge in one column", async () => {
  const { composeBand, rowText } = await import("../plugins/litclaude/lib/mod/frame.mjs");
  const { parseWorkflowStack } = await import("../plugins/litclaude/lib/mod/state.mjs");
  const { settledSample } = await import("../plugins/litclaude/lib/mod/timeline.mjs");
  const NOW = 10_000_000;
  const row = (skill, family, stage, extra) => ({ skill, family, stage, role: "spine", status: "active", verdicts: {}, at: new Date(NOW - 2000).toISOString(), ...extra });
  const stack = parseWorkflowStack({ version: 1, sessionId: "s1", frames: [row("lit-plan", "main", "plan", { status: "paused", n: 2, total: 5 }), row("lit-loop", "loop", "RED", { role: "side", n: 1, total: 4 })], history: [] }, "s1");
  const agents = ["한국어 리뷰어 에이전트", "a-very-long-executor-name-for-the-lane-xyz", "explore"].map((name, i) => ({ id: `a${i}`, name, type: "executor", status: "running" }));
  const model = buildBandModel({ snapshot: { ignition: { discipline: "lit-loop", at: NOW - 1000 }, work: null, completedWorkIds: [], goal: null, workflow: { stack, record: stack.record } }, now: NOW, isWorking: true, agents });
  const wide = (ch) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/u.test(ch);
  const columnOf = (text) => {
    let width = 0;
    for (const ch of text) {
      if (ch === "[" || ch === "━") return width;
      width += wide(ch) ? 2 : 1;
    }
    return null;
  };
  for (const columns of [100, 60]) {
    const card = composeBand(model, settledSample(model), { columns, glyphs: "basic", accent: "#5fd7ff" });
    const starts = card.rows.map(rowText).filter((text) => /^│ (?:[|●] |\s*[├└]─ [|●] )/u.test(text)).map(columnOf);
    assert.equal(starts.length, 5, `${columns} cols`);
    assert.equal(new Set(starts).size, 1, `${columns} cols: ${starts.join(",")}`);
  }
});

test("the title follows the frame the rail draws once the prompt's skill has left the stack", async () => {
  const { parseWorkflowStack } = await import("../plugins/litclaude/lib/mod/state.mjs");
  const NOW = 10_000_000;
  const loop = { skill: "lit-loop", family: "loop", stage: "PIN", role: "spine", status: "active", verdicts: {}, at: new Date(NOW - 2000).toISOString() };
  const titleOf = (discipline, frames) => {
    const stack = parseWorkflowStack({ version: 1, sessionId: "s", frames, history: [] }, "s");
    return buildBandModel({ snapshot: { ignition: { discipline, at: NOW - 1000 }, work: null, completedWorkIds: [], goal: null, workflow: stack ? { stack, record: stack.record, sessionId: "s" } : {} }, now: NOW, isWorking: false }).title;
  };
  assert.equal(titleOf("lit-plan", [loop]), "lit-loop", "lit-plan finished and handed back to the loop");
  assert.equal(titleOf("lit-loop", [loop]), "lit-loop");
  assert.equal(titleOf("lit-adhd", [loop]), "lit-adhd", "a read-only skill keeps its own title");
  assert.equal(titleOf("lit-plan", []), "lit-plan", "no stack: the prompt's skill");
});

test("D1-8: another session that went quiet without ending stops reading running", async () => {
  const { parseWorkflowStack } = await import("../plugins/litclaude/lib/mod/state.mjs");
  const NOW = 100_000_000;
  const review = { skill: "review-work", family: "main", stage: "review", role: "spine", status: "active", verdicts: {}, at: new Date(NOW - 60_000).toISOString() };
  const otherState = (quietMs, liveness) => {
    const { frames } = parseWorkflowStack({ version: 1, sessionId: "other-1", frames: [{ ...review, at: new Date(NOW - quietMs).toISOString() }], history: [] }, "other-1");
    const other = { sessionId: "other-1", id8: "other1aa", at: NOW - quietMs, ended: false, frames, liveness: liveness ? { ...liveness, at: NOW - quietMs } : null };
    const model = buildBandModel({ snapshot: { ignition: null, work: null, completedWorkIds: [], goal: null, workflow: { stack: null, others: [other], sessionId: "me" } }, now: NOW, isWorking: false });
    return model.threads?.others[0]?.state ?? null;
  };
  assert.equal(otherState(60_000, { state: "alive" }), "running", "a tool call a minute ago");
  assert.equal(otherState(60_000, null), "running");
  // A killed session writes no Stop or SessionEnd: its last word is `alive`. After five quiet
  // minutes it reads idle, and it leaves the card after OTHER_SESSION_MS as before.
  assert.equal(otherState(6 * 60_000, { state: "alive" }), "idle");
  assert.equal(otherState(6 * 60_000, null), "idle");
  assert.equal(otherState(16 * 60_000, { state: "alive" }), null);
});

test("D1-10: after a resume (no ignition, no chips yet) the card still names the stage the rail draws", async () => {
  const { parseWorkflowStack } = await import("../plugins/litclaude/lib/mod/state.mjs");
  const { composeBand, rowText } = await import("../plugins/litclaude/lib/mod/frame.mjs");
  const { settledSample } = await import("../plugins/litclaude/lib/mod/timeline.mjs");
  const NOW = 10_000_000;
  const loop = { skill: "lit-loop", family: "loop", stage: "VERIFY", role: "spine", status: "active", n: 1, total: 1, verdicts: {}, at: new Date(NOW - 60_000).toISOString() };
  const stack = parseWorkflowStack({ version: 1, sessionId: "s", frames: [loop], history: [], endedAt: new Date(NOW - 30_000).toISOString() }, "s");
  const model = buildBandModel({ snapshot: { ignition: null, work: null, completedWorkIds: [], goal: null, workflow: { stack, record: stack.record, sessionId: "s" } }, now: NOW, isWorking: false });
  assert.equal(model.title, "lit-loop", "the resumed stack names the card, not \"ready\"");
  const text = composeBand(model, settledSample(model), { columns: 100, glyphs: "basic", accent: "#5fd7ff" }).rows.map(rowText).join("\n");
  assert.doesNotMatch(text, /no LitFamily skill yet/u, "the chips row does not deny the skill the rail draws");
  assert.match(text, /lit-loop/u);
});
