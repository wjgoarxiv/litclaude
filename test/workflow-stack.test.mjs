// The workflow stack's transition rules, one row at a time (plans/lit-adhd.md todo 2): an
// interjected discipline pauses the running one, a successor finishes it, asking for a skill
// again resumes its frame, read-only disciplines leave the stack alone, `lit continue` after a
// side frame resumes the paused spine (D1, assumed A), and the per-session store refuses links
// and oversized files.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  MAX_FRAMES,
  MAX_HISTORY,
  READ_ONLY_DISCIPLINES,
  STACK_DROP_MS,
  applyStackEvent,
  emptyStack,
  readStack,
  stackPath,
  writeStack,
} from "../plugins/litclaude/lib/workflow-stack.mjs";

const T0 = Date.parse("2026-10-25T10:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * 60_000);

const run = (events, start = emptyStack("s1")) => {
  let stack = start;
  const transitions = [];
  events.forEach((event, index) => {
    const result = applyStackEvent(stack, event, at(index));
    stack = result.stack;
    transitions.push(...result.transitions);
  });
  return { stack, transitions };
};

const shape = (stack) => stack.frames.map(({ skill, role, status, stage }) => `${skill}:${role}:${status}:${stage}`);

test("the first discipline becomes the spine at its entry stage", () => {
  const { stack } = run([{ type: "start", skill: "lit-loop" }]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:active:PIN"]);
});

test("an interjected discipline pauses the spine with its stage and count and pushes a side frame", () => {
  const { stack, transitions } = run([
    { type: "start", skill: "lit-loop" },
    { type: "move", family: "loop", stage: "RED", n: 1, total: 4, unit: "criterion" },
    { type: "start", skill: "lit-brainstorm" },
  ]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:paused:RED", "lit-brainstorm:side:active:interview"]);
  assert.equal(stack.frames[0].n, 1);
  assert.equal(stack.frames[0].total, 4);
  assert.deepEqual(transitions.filter(({ type }) => type === "paused").map(({ skill, stage, n, total }) => [skill, stage, n, total]), [["lit-loop", "RED", 1, 4]]);
});

test("a successor in the main chain finishes the spine instead of pausing it", () => {
  const { stack } = run([
    { type: "start", skill: "lit-plan" },
    { type: "move", family: "main", stage: "plan", done: true },
    { type: "start", skill: "lit-loop" },
  ]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:active:PIN"]);
  const review = run([{ type: "start", skill: "start-work" }, { type: "start", skill: "review-work" }]).stack;
  assert.deepEqual(shape(review), ["review-work:spine:active:review"]);
});

test("read-only disciplines never change the stack", () => {
  const base = run([{ type: "start", skill: "lit-loop" }, { type: "move", family: "loop", stage: "RED", n: 1, total: 4 }]).stack;
  for (const skill of READ_ONLY_DISCIPLINES) {
    const { stack, transitions } = applyStackEvent(base, { type: "start", skill }, at(10));
    assert.deepEqual(stack.frames, base.frames, skill);
    assert.deepEqual(transitions, [], skill);
  }
  assert.ok(READ_ONLY_DISCIPLINES.includes("lit-adhd") && READ_ONLY_DISCIPLINES.includes("lit-rewind") && READ_ONLY_DISCIPLINES.includes("lit-recap"));
});

test("asking for the same skill again resumes its frame with its count, never back at the entry stage", () => {
  const { stack, transitions } = run([
    { type: "start", skill: "lit-loop" },
    { type: "move", family: "loop", stage: "RED", n: 1, total: 4, unit: "criterion" },
    { type: "start", skill: "lit-brainstorm" },
    { type: "start", skill: "lit-loop" },
  ]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:active:RED"]);
  assert.equal(stack.frames[0].n, 1);
  assert.ok(transitions.some(({ type, skill }) => type === "resumed" && skill === "lit-loop"));
  assert.ok(transitions.some(({ type, skill }) => type === "side.done" && skill === "lit-brainstorm"));
});

test("the same skill on a different plan starts that frame over", () => {
  const { stack } = run([
    { type: "start", skill: "lit-loop", ref: { plan: "plans/a.md" } },
    { type: "move", family: "loop", stage: "GREEN", n: 2, total: 3 },
    { type: "start", skill: "lit-loop", ref: { plan: "plans/b.md" } },
  ]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:active:PIN"]);
  assert.equal(stack.frames[0].n, undefined);
  assert.equal(stack.frames[0].ref.plan, "plans/b.md");
});

test("a finished frame is replaced, not paused, and asking for a finished skill again starts it fresh", () => {
  const lanes = { goal: "pass", qa: "pass", quality: "fail", security: "pass", context: "pass" };
  const reviewed = run([
    { type: "start", skill: "review-work" },
    { type: "move", family: "main", stage: "review", verdicts: lanes },
  ]).stack;
  const again = applyStackEvent(reviewed, { type: "start", skill: "review-work" }, at(5)).stack;
  assert.deepEqual(shape(again), ["review-work:spine:active:review"]);
  assert.deepEqual(again.frames[0].verdicts, {}, "a second review is drawn from its own lanes");
  const fix = applyStackEvent(reviewed, { type: "start", skill: "start-work" }, at(5)).stack;
  assert.deepEqual(shape(fix), ["start-work:spine:active:work"], "work after a finished review succeeds it");
  const half = run([{ type: "start", skill: "review-work" }, { type: "move", family: "main", stage: "review", verdicts: { goal: "pass" } }, { type: "start", skill: "start-work" }]).stack;
  assert.deepEqual(shape(half), ["review-work:spine:paused:review", "start-work:side:active:work"], "an unfinished review is only paused");
  const planned = run([{ type: "start", skill: "lit-plan" }, { type: "move", family: "main", stage: "plan", done: true }, { type: "start", skill: "lit-brainstorm" }]).stack;
  assert.deepEqual(shape(planned), ["lit-brainstorm:spine:active:interview"], "a saved plan is finished work, not a paused one");
});

test("D1 (A): continue on a side frame closes it and resumes the nearest paused spine", () => {
  const { stack, transitions } = run([
    { type: "start", skill: "lit-loop" },
    { type: "move", family: "loop", stage: "RED", n: 1, total: 4 },
    { type: "start", skill: "lit-brainstorm" },
    { type: "continue" },
  ]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:active:RED"]);
  assert.deepEqual(transitions.slice(-2).map(({ type, skill }) => `${type}:${skill}`), ["side.done:lit-brainstorm", "resumed:lit-loop"]);
});

test("continue on a spine frame carries on and changes nothing", () => {
  const base = run([{ type: "start", skill: "lit-loop" }]).stack;
  const { stack, transitions } = applyStackEvent(base, { type: "continue" }, at(5));
  assert.deepEqual(stack.frames, base.frames);
  assert.deepEqual(transitions, []);
});

test("restart drops every frame and starts a fresh spine", () => {
  const { stack } = run([
    { type: "start", skill: "lit-loop" },
    { type: "start", skill: "lit-brainstorm" },
    { type: "start", skill: "lit-loop", restart: true },
  ]);
  assert.deepEqual(shape(stack), ["lit-loop:spine:active:PIN"]);
});

test("a discipline with no map family is a side frame and never becomes a spine", () => {
  const alone = run([{ type: "start", skill: "lit-docx" }]).stack;
  assert.deepEqual(shape(alone), ["lit-docx:side:active:null"]);
  const replaced = run([{ type: "start", skill: "lit-docx" }, { type: "start", skill: "lit-loop" }]).stack;
  assert.deepEqual(shape(replaced), ["lit-loop:spine:active:PIN"], "a side with no spine under it is not kept");
  const paused = run([{ type: "start", skill: "lit-loop" }, { type: "start", skill: "lit-docx" }]).stack;
  assert.deepEqual(shape(paused), ["lit-loop:spine:paused:PIN", "lit-docx:side:active:null"]);
});

test("the stack holds at most three frames; a fourth push replaces the older side", () => {
  const { stack } = run([
    { type: "start", skill: "lit-loop" },
    { type: "start", skill: "lit-brainstorm" },
    { type: "start", skill: "litresearch" },
    { type: "start", skill: "lit-docx" },
  ]);
  assert.equal(MAX_FRAMES, 3);
  assert.deepEqual(shape(stack), ["lit-loop:spine:paused:PIN", "litresearch:side:paused:decompose", "lit-docx:side:active:null"]);
});

test("moves land on the active top frame; review verdicts also reach a paused review frame", () => {
  const loop = run([
    { type: "start", skill: "lit-loop" },
    { type: "start", skill: "lit-brainstorm" },
    { type: "move", family: "loop", stage: "RED" },
  ]).stack;
  assert.equal(loop.frames[0].stage, "PIN", "a paused loop does not move while a side runs");
  const review = run([
    { type: "start", skill: "review-work" },
    { type: "start", skill: "lit-brainstorm" },
    { type: "move", family: "main", stage: "review", verdicts: { goal: "pass" }, scope: "nearest" },
  ]).stack;
  assert.deepEqual(review.frames[0].verdicts, { goal: "pass" });
});

test("the model's stage call updates the top frame and starts one when the stack is empty", () => {
  const empty = run([{ type: "record", family: "main", stage: "plan", verdicts: { crucible: "pass" } }]).stack;
  assert.deepEqual(shape(empty), ["null:spine:active:plan"]);
  const top = run([{ type: "start", skill: "lit-loop" }, { type: "record", family: "loop", stage: "SURFACE", n: 2, total: 5, unit: "criterion" }]).stack;
  assert.equal(top.frames[0].stage, "SURFACE");
  assert.equal(top.frames[0].total, 5);
});

test("frames untouched for 24 hours are dropped on the next event", () => {
  const base = run([{ type: "start", skill: "lit-loop" }]).stack;
  const later = new Date(T0 + STACK_DROP_MS + 60_000);
  const { stack } = applyStackEvent(base, { type: "start", skill: "lit-brainstorm" }, later);
  assert.deepEqual(shape(stack), ["lit-brainstorm:spine:active:interview"]);
});

test("history keeps the last twenty transitions and never a prompt or path", () => {
  const events = [];
  for (let index = 0; index < 30; index += 1) events.push({ type: "start", skill: index % 2 ? "lit-brainstorm" : "lit-loop" });
  const { stack } = run(events);
  assert.equal(MAX_HISTORY, 20);
  assert.equal(stack.history.length, 20);
  assert.ok(stack.history.every((entry) => Object.keys(entry).every((key) => ["event", "skill", "at"].includes(key))));
});

test("a plan ref is kept only as a project-relative plans/ path", () => {
  for (const plan of ["../x.md", "/abs/plans/x.md", "plans/../x.md", "plans/x.txt", "plans/sub/x.md"]) {
    const { stack } = run([{ type: "start", skill: "lit-loop", ref: { plan } }]);
    assert.equal(stack.frames[0].ref, undefined, plan);
  }
  assert.equal(run([{ type: "start", skill: "lit-loop", ref: { plan: "plans/ok-1.md" } }]).stack.frames[0].ref.plan, "plans/ok-1.md");
});

test("random event sequences keep the invariants: at most three frames, one active, small JSON", () => {
  const skills = ["lit-loop", "lit-plan", "lit-brainstorm", "start-work", "review-work", "litresearch", "lit-docx", "lit-recap", "lit-adhd"];
  let seed = 7;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let round = 0; round < 200; round += 1) {
    let stack = emptyStack("fuzz");
    for (let step = 0; step < 25; step += 1) {
      const pick = next(5);
      const event = pick < 3 ? { type: "start", skill: skills[next(skills.length)], restart: next(10) === 0 }
        : pick === 3 ? { type: "continue" }
          : { type: "move", family: ["loop", "main", "research"][next(3)], stage: ["RED", "plan", "wave"][next(3)], n: next(5), total: 5 };
      stack = applyStackEvent(stack, event, at(step)).stack;
      assert.ok(stack.frames.length <= MAX_FRAMES);
      assert.ok(stack.frames.filter(({ status }) => status === "active").length <= 1);
      if (stack.frames.length) assert.equal(stack.frames.at(-1).status, "active");
      assert.ok(Buffer.byteLength(JSON.stringify(stack)) <= 64 * 1024);
    }
  }
});

test("the per-session store writes whole files and refuses links and oversized files", () => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-stack-"));
  try {
    mkdirSync(join(root, ".git"));
    const stack = run([{ type: "start", skill: "lit-loop" }]).stack;
    writeStack(root, "sess/one", stack);
    assert.match(stackPath(root, "sess/one"), /\.litclaude\/workflow-stack\/sess_one\.json$/u);
    assert.deepEqual(readStack(root, "sess/one").frames, stack.frames);
    assert.deepEqual(readStack(root, "other").frames, [], "another session reads its own empty stack");
    assert.ok(readFileSync(join(root, ".litclaude", ".gitignore"), "utf8").includes("*"));
    writeFileSync(stackPath(root, "big"), `{"frames":[],"pad":"${"x".repeat(70 * 1024)}"}`);
    assert.deepEqual(readStack(root, "big").frames, []);
    const target = join(root, "elsewhere.json");
    writeFileSync(target, JSON.stringify(stack));
    symlinkSync(target, stackPath(root, "linked"));
    assert.deepEqual(readStack(root, "linked").frames, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
