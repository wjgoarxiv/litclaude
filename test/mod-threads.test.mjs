// BRIEF-adhd Addendum 2: when several workflows are live the LIT card shows them as threads, one
// compact row each, with their nesting and a fork line over parallel lanes, instead of one line.
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { composeBand, forkLabel, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { countPlanTasks, parseWorkflowStack, readLitSnapshot } from "../plugins/litclaude/lib/mod/state.mjs";
import { SVG_CARD, THREAD_ROW_H, composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { EMPTY_LISTS, EMPTY_TASKS, TASK_STALE_MS, buildBandModel, endedTaskIds, listProgress, noteBackgroundTask, noteLoopCall } from "../plugins/litclaude/lib/mod/view.mjs";
import { applyStackEvent, emptyStack } from "../plugins/litclaude/lib/workflow-stack.mjs";
import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";

const NOW = 10_000_000;
const SID = "11111111-aaaa-bbbb-cccc-000000000001";
const iso = (ms) => new Date(ms).toISOString();
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const frame = (skill, family, stage, extra = {}) => ({ skill, family, stage, role: "spine", status: "active", verdicts: {}, at: iso(NOW - 2000), ...extra });
const stackOf = (frames) => parseWorkflowStack({ version: 1, sessionId: SID, frames, history: [] }, SID);
const snapshotWith = (frames, extra = {}) => ({
  ...idle(),
  ignition: { discipline: frames.at(-1)?.skill ?? "lit-loop", at: NOW - 1000 },
  workflow: frames.length ? { stack: stackOf(frames), record: stackOf(frames).record } : {},
  ...extra,
});
const agents = (names) => names.map((name, i) => ({ id: `agent-${i}`, name, type: "executor", status: "running" }));
const draw = (model, columns = 100) => composeBand(model, settledSample(model), { columns, glyphs: "basic", accent: "#5fd7ff" });
const texts = (card) => card.rows.map(rowText);
const threadRows = (card) => texts(card).slice(3, -2);

test("one thread keeps today's five-row card, with no thread rows", () => {
  const one = buildBandModel({ snapshot: snapshotWith([frame("lit-loop", "loop", "RED", { n: 1, total: 4 })]), now: NOW, isWorking: true });
  assert.equal(one.threads, null);
  const card = draw(one);
  assert.equal(card.rows.length, 5);
  const bare = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-loop", at: NOW - 1000 } }, now: NOW, isWorking: true, agents: agents(["explore"]) });
  assert.equal(bare.threads, null, "a single lane with no stack is still one thread");
  assert.equal(draw(bare).rows.length, 5);
});

test("three parallel lanes: three rows under a fork line, each with a gauge and a state", () => {
  const model = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-plan", at: NOW - 1000 } }, now: NOW, isWorking: true, agents: agents(["explore", "librarian", "verifier"]) });
  const card = draw(model);
  assert.equal(card.rows.length, 5 + 1 + 3);
  for (const row of card.rows) assert.equal(rowWidth(row), 100, rowText(row));
  const [fork, ...lanes] = threadRows(card);
  assert.match(fork, /^│ ┬ 3 lanes in parallel/u);
  // A lane that keeps no list counts the steps it finished over a total nobody knows.
  assert.match(lanes[0], /^│ ├─ ● explore +\[\?\?\?\] 0\/\? running/u);
  assert.match(lanes[1], /^│ ├─ ● librarian/u);
  assert.match(lanes[2], /^│ └─ ● verifier/u);
});

test("a paused parent keeps its gauge; the running child nests under it, its lanes under the child", () => {
  const frames = [
    frame("lit-plan", "main", "plan", { status: "paused", n: 2, total: 5 }),
    frame("lit-loop", "loop", "RED", { role: "side", n: 1, total: 4 }),
  ];
  const model = buildBandModel({ snapshot: snapshotWith(frames), now: NOW, isWorking: true, agents: agents(["executor", "reviewer"]) });
  const rows = threadRows(draw(model));
  assert.equal(rows.length, 2 + 1 + 2);
  assert.match(rows[0], /^│ \| lit-plan +plan +\[▉▉░░░\] 2\/5 paused/u);
  assert.match(rows[1], /^│ └─ ● lit-loop +RED +\[▉░░░\] 1\/4 running/u);
  assert.match(rows[2], /^│ {4}┬ 2 lanes in parallel/u);
  assert.match(rows[3], /^│ {4}├─ ● executor/u);
  assert.match(rows[4], /^│ {4}└─ ● reviewer/u);
});

test("six threads: four rows and +2 more, the active thread always kept", () => {
  const frames = [frame("start-work", "main", "work", { n: 3, total: 7 })];
  const model = buildBandModel({ snapshot: snapshotWith(frames), now: NOW, isWorking: true, agents: agents(["a1", "a2", "a3", "a4", "a5"]) });
  assert.equal(model.threads.more, 2);
  const rows = threadRows(draw(model));
  const threadLines = rows.filter((row) => /[●|✓!] (?!lanes)/u.test(row));
  assert.equal(threadLines.length, 4);
  assert.match(threadLines[0], /● start-work +work +\[▉▉▉░░░░\] 3\/7 running/u);
  assert.match(rows.find((row) => /lanes in parallel/u.test(row)), /5 lanes in parallel/u, "the fork line counts every lane, shown or not");
  assert.match(rows.at(-1), /\+2 more │$/u);
});

test("blocked and done states read in words beside their glyphs", () => {
  const frames = [frame("start-work", "main", "work", { n: 2, total: 3 })];
  const snapshot = snapshotWith(frames, { work: { id: "w", status: "paused", checked: 2, total: 3, lanes: [] } });
  const stalled = [{ id: "s", name: "quiet-one", type: "executor", status: "running" }];
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: stalled, activity: { first: { s: NOW - 3_600_000 }, last: { s: NOW - 3_600_000 } } });
  const rows = threadRows(draw(model));
  assert.match(rows[0], /! start-work .* blocked/u);
  assert.match(rows[1], /└─ ! quiet-one .* blocked/u);
});

test("another live session of this project shows as one row, marked as another session", () => {
  const frames = [frame("lit-loop", "loop", "GREEN", { n: 2, total: 4 })];
  const other = { id8: "22222222", at: NOW - 60_000, frames: stackOf([frame("start-work", "main", "work", { n: 1, total: 3 })]).frames };
  const stale = { id8: "33333333", at: NOW - 60 * 60_000, frames: stackOf([frame("lit-plan", "main", "plan")]).frames };
  const snapshot = snapshotWith(frames);
  snapshot.workflow.others = [other, stale];
  const rows = threadRows(draw(buildBandModel({ snapshot, now: NOW, isWorking: true })));
  assert.equal(rows.length, 2, "the session quiet for an hour is left out");
  assert.match(rows[0], /^│ ● lit-loop/u);
  assert.match(rows[1], /^│ ● start-work +work +\[▉░░\] 1\/3 running · other session 22222222/u);
});

// In Claude Code a row whose only change is a non-ASCII glyph keeps the old glyph (frame.mjs), so a
// thread row may change a glyph only together with an ASCII cell's text or colour.
const asciiKey = (row) => JSON.stringify(row.flatMap((part) => [...part.text].map((ch) => (ch.codePointAt(0) < 128 ? [ch, part.fg ?? null, part.bg ?? null] : ["#", part.bg ?? null]))));
const fullKey = (row) => JSON.stringify(row.map((part) => [part.text, part.fg ?? null, part.bg ?? null]));

test("repaint stable: reserved rows hold the height and every glyph change rides an ASCII change", () => {
  const snapshot = snapshotWith([frame("start-work", "main", "work", { n: 1, total: 4 })]);
  const sequence = [["a", "b", "c"], ["a", "b"], ["a", "b", "c"], ["a"], []];
  let reserve = 0;
  let previous = null;
  const heights = [];
  for (const names of sequence) {
    const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(names), threadReserve: reserve });
    reserve = model.threads?.reserve ?? 0;
    const card = draw(model);
    heights.push(card.rows.length);
    if (previous && previous.rows.length === card.rows.length) {
      card.rows.forEach((row, index) => {
        if (fullKey(row) !== fullKey(previous.rows[index])) assert.notEqual(asciiKey(row), asciiKey(previous.rows[index]), `row ${index}: ${rowText(previous.rows[index])} -> ${rowText(row)}`);
      });
    }
    previous = card;
  }
  assert.deepEqual(heights.slice(0, 4), [10, 10, 10, 10], "rows stay reserved while more than one thread is live");
  assert.equal(heights[4], 5, "with one thread left the card returns to five rows");
});

test("the mod reads other sessions' stacks from this project, never its own or a link", async () => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-threads-"));
  try {
    mkdirSync(join(root, ".git"));
    const dir = join(root, ".litclaude", "workflow-stack");
    mkdirSync(dir, { recursive: true });
    const write = (sid, frames) => writeFileSync(join(dir, `${sid}.json`), JSON.stringify({ version: 1, sessionId: sid, frames, history: [] }));
    write(SID, [frame("lit-loop", "loop", "RED")]);
    write("22222222-other", [frame("start-work", "main", "work", { n: 1, total: 3 })]);
    symlinkSync(join(dir, "22222222-other.json"), join(dir, "44444444-link.json"));
    const kindOf = (s) => (s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : "file");
    const io = {
      read: async (path) => readFileSync(path, "utf8"),
      stat: async (path) => {
        try {
          const s = lstatSync(path);
          return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs, isLink: s.isSymbolicLink() };
        } catch {
          return null;
        }
      },
      list: async (path) => readdirSync(path).map((name) => {
        const s = lstatSync(join(path, name));
        return { name, kind: kindOf(s), isLink: s.isSymbolicLink(), mtimeMs: s.mtimeMs, size: s.size };
      }),
    };
    const snapshot = await readLitSnapshot(io, { cwd: root, sessionId: SID, env: {} });
    assert.deepEqual(snapshot.workflow.others.map(({ id8 }) => id8), ["22222222"]);
    assert.equal(snapshot.workflow.others[0].frames[0].skill, "start-work");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// lane hud-threads (BRIEF-maximal): every thread gets a real k/n, the desktop card draws the rows,
// and background tasks are threads too.

const todos = (...statuses) => statuses.map((status, i) => ({ content: `todo ${i}`, status, activeForm: `doing ${i}` }));

test("a lane's own TodoWrite or task list gives its k/n; with neither it counts finished steps over ?", () => {
  let lists = EMPTY_LISTS;
  lists = noteLoopCall(lists, "agent-0", { tool: "TodoWrite", todos: todos("completed", "completed", "in_progress", "pending") }, {});
  lists = noteLoopCall(lists, "agent-1", { tool: "TaskCreate", subject: "a" }, { task: { id: "1", subject: "a" } });
  lists = noteLoopCall(lists, "agent-1", { tool: "TaskCreate", subject: "b" }, { task: { id: "2", subject: "b" } });
  lists = noteLoopCall(lists, "agent-1", { tool: "TaskCreate", subject: "c" }, { task: { id: "3", subject: "c" } });
  lists = noteLoopCall(lists, "agent-1", { tool: "TaskUpdate", taskId: "1", status: "completed" }, { success: true });
  for (let i = 0; i < 3; i += 1) lists = noteLoopCall(lists, "agent-2", { tool: "Read", file_path: "/x" }, {});
  assert.deepEqual(listProgress(lists["agent-0"]), { done: 2, total: 4 });
  assert.deepEqual(listProgress(lists["agent-1"]), { done: 1, total: 3 });
  assert.equal(listProgress(lists["agent-2"]), null);
  assert.doesNotMatch(JSON.stringify(lists), /todo 0|doing|"a"|subject/u, "only statuses are kept, never a todo's or a task's text");
  const model = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-plan", at: NOW - 1000 } }, now: NOW, isWorking: true, agents: agents(["explore", "librarian", "verifier"]), lists });
  const rows = threadRows(draw(model));
  assert.match(rows[1], /├─ ● explore +\[▉▉░░\] 2\/4 running/u);
  assert.match(rows[2], /├─ ● librarian +\[▉░░\] 1\/3 running/u);
  assert.match(rows[3], /└─ ● verifier +\[\?\?\?\] 3\/\? running/u);
  assert.ok(rows.every((row) => !/\?\/\?/u.test(row)), "no lane reads ?/?");
});

test("a task list whose creation was not seen knows its done count, not its total", () => {
  let lists = noteLoopCall(EMPTY_LISTS, "main", { tool: "TaskUpdate", taskId: "9", status: "completed" }, { success: true });
  assert.deepEqual(listProgress(lists.main), { done: 1, total: null });
  lists = noteLoopCall(lists, "main", { tool: "TaskUpdate", taskId: "9", status: "deleted" }, { success: true });
  assert.equal(listProgress(lists.main), null);
  // A lane's update of a task the main loop created moves the main loop's list.
  lists = noteLoopCall(EMPTY_LISTS, "main", { tool: "TaskCreate" }, { task: { id: "5", subject: "s" } });
  lists = noteLoopCall(lists, "agent-0", { tool: "TaskUpdate", taskId: "5", status: "completed" }, { success: true });
  assert.deepEqual(listProgress(lists.main), { done: 1, total: 1 });
  assert.equal(listProgress(lists["agent-0"]), null);
});

test("a frame with no recorded count shows its plan's checkboxes, then the goal, then the main loop's list", () => {
  const plan = { ...frame("lit-loop", "loop", "PIN"), ref: { plan: "plans/demo.md" } };
  const stack = stackOf([frame("lit-plan", "main", "plan", { status: "paused" }), plan]);
  stack.frames[1].plan = { done: 0, total: 5 };
  const snapshot = { ...idle(), ignition: { discipline: "lit-loop", at: NOW - 1000 }, workflow: { stack, record: stack.record } };
  let rows = threadRows(draw(buildBandModel({ snapshot, now: NOW, isWorking: true })));
  assert.match(rows[0], /\| lit-plan +plan +\[\?\?\?\] \?\/\? paused/u, "a plan frame that names no plan has nothing to count");
  assert.match(rows[1], /└─ ● lit-loop +PIN +\[░░░░░\] 0\/5 running/u, "the loop counts the plan it took over");
  stack.frames[1].plan = null;
  const lists = noteLoopCall(EMPTY_LISTS, "main", { tool: "TodoWrite", todos: todos("completed", "pending", "pending") }, {});
  rows = threadRows(draw(buildBandModel({ snapshot, now: NOW, isWorking: true, lists })));
  assert.match(rows[1], /lit-loop +PIN +\[▉░░\] 1\/3 running/u, "the frame on top falls back to the main loop's todos");
  assert.match(rows[0], /lit-plan .*\?\/\? paused/u, "a paused parent never takes the main loop's list");
});

test("a start-work frame counts its run's tasks and a saved plan's successor inherits the plan", () => {
  let { stack } = applyStackEvent(emptyStack(SID), { type: "start", skill: "lit-plan" }, new Date(NOW));
  ({ stack } = applyStackEvent(stack, { type: "move", family: "main", stage: "plan", done: true, ref: { plan: "plans/demo.md" } }, new Date(NOW + 1)));
  assert.deepEqual(stack.frames[0].ref, { plan: "plans/demo.md" });
  ({ stack } = applyStackEvent(stack, { type: "start", skill: "lit-loop" }, new Date(NOW + 2)));
  assert.deepEqual(stack.frames.map(({ skill, ref }) => [skill, ref?.plan]), [["lit-loop", "plans/demo.md"]], "lit-loop after a saved plan works from it");
  ({ stack } = applyStackEvent(emptyStack(SID), { type: "start", skill: "lit-plan", ref: { plan: "plans/a.md" } }, new Date(NOW)));
  ({ stack } = applyStackEvent(stack, { type: "start", skill: "lit-brainstorm" }, new Date(NOW + 1)));
  assert.equal(stack.frames.at(-1).ref, undefined, "an interview-stage side frame never inherits a plan");
  ({ stack } = applyStackEvent(stack, { type: "start", skill: "start-work", ref: { plan: "plans/b.md" } }, new Date(NOW + 2)));
  assert.equal(stack.frames.at(-1).ref.plan, "plans/b.md", "a plan named in the prompt wins");

  const snapshot = snapshotWith([frame("start-work", "main", "work")], { work: { id: "w", status: "active", checked: 2, total: 6, lanes: [] } });
  const rows = threadRows(draw(buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(["executor"]) })));
  assert.match(rows[0], /● start-work +work +\[▉▉░░░░\] 2\/6 running/u);
});

test("countPlanTasks reads the start-work checkbox grammar, outside code fences only", () => {
  assert.deepEqual(countPlanTasks("# P\n- [x] one\n- [ ] two\n```\n- [ ] not a task\n```\n  - [ ] indented is not a task\n- [X] three\n"), { done: 2, total: 3 });
  assert.equal(countPlanTasks("no tasks here"), null);
});

test("the mod reads a frame's plan from this project, never through a link", async () => {
  const root = mkdtempSync(join(tmpdir(), "litclaude-threads-plan-"));
  try {
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "plans"));
    writeFileSync(join(root, "plans", "demo.md"), "- [x] a\n- [ ] b\n- [ ] c\n");
    writeFileSync(join(root, "outside.md"), "- [x] a\n");
    symlinkSync(join(root, "outside.md"), join(root, "plans", "linked.md"));
    const dir = join(root, ".litclaude", "workflow-stack");
    mkdirSync(dir, { recursive: true });
    const frames = [{ ...frame("lit-plan", "main", "plan", { status: "paused" }), ref: { plan: "plans/linked.md" } }, { ...frame("lit-loop", "loop", "RED"), ref: { plan: "plans/demo.md" } }];
    writeFileSync(join(dir, `${SID}.json`), JSON.stringify({ version: 1, sessionId: SID, frames, history: [] }));
    const io = diskIo();
    const snapshot = await readLitSnapshot(io, { cwd: root, sessionId: SID, env: {} });
    assert.deepEqual(snapshot.workflow.stack.frames.map(({ plan }) => plan), [null, { done: 1, total: 3 }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const diskIo = () => {
  const kindOf = (s) => (s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : "file");
  return {
    read: async (path) => readFileSync(path, "utf8"),
    stat: async (path) => {
      try {
        const s = lstatSync(path);
        return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs, isLink: s.isSymbolicLink() };
      } catch {
        return null;
      }
    },
    list: async (path) => readdirSync(path).map((name) => {
      const s = lstatSync(join(path, name));
      return { name, kind: kindOf(s), isLink: s.isSymbolicLink(), mtimeMs: s.mtimeMs, size: s.size };
    }),
  };
};

test("background tasks are threads beside the lanes, under one fork line that counts both", () => {
  let tasks = noteBackgroundTask(EMPTY_TASKS, { id: "bsh1", kind: "shell", name: "dev server", at: NOW - 5000 });
  tasks = noteBackgroundTask(tasks, { id: "mon1", kind: "monitor", name: "watch CI", at: NOW - 5000, until: NOW + 60_000 });
  tasks = noteBackgroundTask(tasks, { id: "../evil", kind: "shell", name: "x", at: NOW });
  assert.deepEqual(Object.keys(tasks), ["bsh1", "mon1"], "an id outside the task-id shape is never kept");
  const snapshot = snapshotWith([frame("lit-loop", "loop", "GREEN", { n: 1, total: 3 })]);
  const model = buildBandModel({ snapshot, now: NOW, isWorking: true, agents: agents(["executor"]), tasks });
  const rows = threadRows(draw(model));
  assert.equal(forkLabel(model.threads), "1 lane · 2 tasks in parallel");
  assert.match(rows[1], /^│ ┬ 1 lane · 2 tasks in parallel/u);
  assert.match(rows[3], /├─ \$ dev server +shell +\[\?\?\?\] \?\/\? running/u);
  assert.match(rows[4], /└─ ~ watch CI +monitor/u);
  const later = buildBandModel({ snapshot, now: NOW + 120_000, isWorking: true, tasks });
  assert.deepEqual(later.threads.lanes.map(({ name }) => name), ["dev server"], "a monitor past its deadline is gone");
  assert.equal(buildBandModel({ snapshot, now: NOW + TASK_STALE_MS, isWorking: true, tasks }).threads, null, "a shell never seen ending is dropped once stale");
});

// Seen in the real QA run: a paused lit-loop under start-work left room for two of three lanes.
test("a chain of frames never squeezes parallel lanes below three rows; tasks fold first", () => {
  const frames = [frame("lit-loop", "loop", "GREEN", { status: "paused", n: 10, total: 10 }), frame("start-work", "main", "work", { role: "side", n: 10, total: 10 })];
  const tasks = noteBackgroundTask(EMPTY_TASKS, { id: "b1", kind: "shell", name: "sleep", at: NOW });
  const model = buildBandModel({ snapshot: snapshotWith(frames), now: NOW, isWorking: true, agents: agents(["alpha", "beta", "gamma"]), tasks });
  assert.deepEqual(model.threads.lanes.map(({ name }) => name), ["alpha", "beta", "gamma"]);
  assert.equal(model.threads.more, 1);
  const rows = threadRows(draw(model));
  assert.equal(rows.length, 2 + 1 + 3);
  assert.match(rows[2], /┬ 3 lanes · 1 task in parallel/u);
  assert.match(rows.at(-1), /└─ ● gamma .*\+1 more │$/u);
});

test("a wide card keeps lane names that differ only at the end apart", () => {
  const model = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-loop", at: NOW - 1000 } }, now: NOW, isWorking: true, agents: agents(["Sleep drill agent 1", "Sleep drill agent 2", "Sleep drill agent 3"]) });
  const wide = threadRows(draw(model, 120)).slice(1);
  wide.forEach((row, index) => assert.match(row, new RegExp(`● Sleep drill agent ${index + 1} +\\[`, "u")));
  for (const row of draw(model, 60).rows) assert.equal(rowWidth(row), 60, rowText(row));
  const { alt, source } = composeSvgCard(model, { motion: "off" });
  assert.match(alt, /Sleep drill agent 3/u);
  assert.match(source, />Sleep drill agent 3</u);
});

test("a teammate waiting for a message reads idle, not running", () => {
  const frames = [frame("start-work", "main", "work", { n: 1, total: 3 })];
  const crew = [{ id: "t1", name: "alpha", type: "teammate", status: "idle" }, { id: "t2", name: "beta", type: "teammate", status: "running" }];
  const model = buildBandModel({ snapshot: snapshotWith(frames), now: NOW, isWorking: true, agents: crew });
  assert.deepEqual(model.threads.lanes.map(({ state }) => state), ["idle", "running"]);
  const rows = threadRows(draw(model));
  assert.match(rows[2], /├─ - alpha .* idle/u);
  assert.match(composeSvgCard(model, { motion: "off" }).alt, /alpha \[\?\?\?\] 0\/\? idle/u);
});

test("a task notification ends the tasks it names as finished, and nothing else", () => {
  const text = "<task-notification>\n<task-id>bsh1</task-id>\n<status>completed</status>\n<summary>Background command \"dev\" completed</summary>\n</task-notification>"
    + "<task-notification><task-id>mon1</task-id><status>running</status></task-notification>";
  assert.deepEqual(endedTaskIds(text), ["bsh1"]);
  assert.deepEqual(endedTaskIds("<task-id>x y</task-id>"), []);
});

// The mods host, cut down to what the thread rows touch.
const hookHost = async (listed = []) => {
  const hooks = [];
  register((event, matcher, hook) => {
    hooks.push(typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook });
    return { catch: () => undefined };
  }, { glyphs: "basic", motion: "off" });
  let now = NOW;
  const timers = [];
  const $ = {
    fs: { stat: async () => null, read: async () => { throw new Error("ENOENT"); } },
    session: { cwd: async () => "/nowhere/project", id: async () => "thread-session", usage: async () => null, surfaces: async () => ["terminal"] },
    agent: { list: async () => listed },
    clock: { now: async () => now, after: (ms, fn) => { timers.push(fn); }, every: () => () => undefined },
    env: { get: async () => undefined },
    settings: { read: async () => null },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, resolve: () => elements, notify: async () => ({}) },
  };
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: ({ children }) => ({ kind: "text", text: children }),
    Svg: (props) => ({ kind: "svg", ...props }),
  };
  const fire = async (event, e, matcher = {}, core = undefined) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const step = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => step(index + 1, next)) : core);
    return step(0, e);
  };
  const flush = async () => {
    while (timers.length) await timers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const flatten = (node) => (node.kind === "text" ? [node.text] : node.children.flatMap(flatten));
  const lines = async () => {
    const drawn = await fire("ui.render", { surface: "terminal", props: { bodyColumns: 100 } }, { component: "AbovePrompt" });
    return drawn.children.map((row) => flatten(row).join(""));
  };
  const svg = async () => fire("ui.render", { surface: "desktop", props: { bodyColumns: 100 } }, { component: "AbovePrompt" });
  return { fire, flush, lines, svg, tick: (ms) => { now += ms; } };
};

test("the mod: a background Bash is a thread row until its notification, a monitor until TaskStop", async () => {
  const host = await hookHost([{ id: "agent-9", description: "executor", type: "executor", status: "running" }]);
  await host.fire("session.start", {});
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Bash", command: "npm run dev", description: "dev server", run_in_background: true }, {}, { result: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "bsh42" } });
  await host.fire("tool.call", { tool: "Monitor", description: "watch CI", timeout_ms: 300_000, command: "gh run watch" }, {}, { result: { taskId: "mon7", timeoutMs: 300_000 } });
  await host.fire("tool.call", { tool: "TodoWrite", agentId: "agent-9", todos: todos("completed", "pending") }, {}, { result: { oldTodos: [], newTodos: [] } });
  await host.flush();
  let text = (await host.lines()).join("\n");
  assert.match(text, /┬ 1 lane · 2 tasks in parallel/u);
  assert.match(text, /● executor +\[▉░\] 1\/2 running/u, "the subagent's TodoWrite is its k/n");
  assert.match(text, /\$ dev server +shell/u);
  assert.match(text, /~ watch CI +monitor/u);
  assert.doesNotMatch(text, /npm run dev|gh run watch/u, "a task's command never reaches the card");

  await host.fire("prompt.submit", { text: "<task-notification>\n<task-id>bsh42</task-id>\n<status>completed</status>\n</task-notification>", wait: false, origin: { kind: "task-notification" } }, {}, { text: "" });
  await host.flush();
  text = (await host.lines()).join("\n");
  assert.doesNotMatch(text, /dev server/u, "its notification ends the shell's row");
  assert.match(text, /watch CI/u);

  await host.fire("prompt.submit", { text: "<task-id>mon7</task-id><status>completed</status>", wait: false, origin: { kind: "composer" } }, {}, { text: "" });
  await host.flush();
  assert.match((await host.lines()).join("\n"), /watch CI/u, "a typed prompt that looks like a notification ends nothing");
  await host.fire("tool.call", { tool: "TaskStop", task_id: "mon7" }, {}, { result: { message: "stopped", task_id: "mon7", task_type: "monitor" } });
  await host.flush();
  assert.doesNotMatch((await host.lines()).join("\n"), /watch CI/u, "TaskStop ends the monitor's row");

  await host.fire("tool.call", { tool: "Bash", command: "x", run_in_background: true }, {}, { deny: "no" });
  await host.fire("tool.call", { tool: "Bash", command: "x", run_in_background: true }, {}, { isError: true, result: { backgroundTaskId: "bad1" }, text: "failed" });
  await host.flush();
  assert.doesNotMatch((await host.lines()).join("\n"), /shell/u, "a refused or failed call starts no task");
});

test("the desktop card draws the same thread rows and grows by their reserve", async () => {
  const frames = [frame("lit-plan", "main", "plan", { status: "paused", n: 2, total: 5 }), frame("lit-loop", "loop", "RED", { role: "side", n: 1, total: 4 })];
  const tasks = noteBackgroundTask(EMPTY_TASKS, { id: "b1", kind: "shell", name: "dev server", at: NOW });
  const model = buildBandModel({ snapshot: snapshotWith(frames), now: NOW, isWorking: true, agents: agents(["executor"]), tasks });
  const { source, alt } = composeSvgCard(model, { motion: "off" });
  const height = Number(/height="(\d+)"/u.exec(source)[1]);
  assert.equal(model.threads.reserve, 5, "two frames, a fork line, a lane and a task");
  assert.equal(height, SVG_CARD.height + THREAD_ROW_H * 5);
  const texts = [...source.matchAll(/<text x="([\d.]+)" y="(\d+)"[^>]*>([^<]*)<\/text>/gu)].map(([, x, y, body]) => ({ x: Number(x), y: Number(y), body }));
  for (const { x, y, body } of texts) {
    assert.ok(y < height, `${body} sits inside the drawing`);
    assert.ok(x >= 0 && x <= SVG_CARD.width, `${body} starts inside the width`);
  }
  const rowAt = (needle) => texts.find(({ body }) => body.includes(needle));
  assert.ok(rowAt("lit-plan") && rowAt("1 lane · 1 task in parallel") && rowAt("executor") && rowAt("dev server"), "every thread is drawn");
  assert.ok(texts.some(({ body }) => body.includes("[▉▉░░░] 2/5")), "the paused parent keeps its gauge");
  assert.ok(rowAt("executor").y > rowAt("lit-plan").y && rowAt("dev server").y > rowAt("executor").y);
  const chips = texts.find(({ body }) => /no LitFamily skill/u.test(body));
  assert.ok(chips.y > rowAt("dev server").y, "the chips row moves below the threads");
  assert.match(alt, /threads lit-plan \[▉▉░░░\] 2\/5 paused, lit-loop/u);
  const single = composeSvgCard(buildBandModel({ snapshot: snapshotWith([frames[1]]), now: NOW, isWorking: true }), { motion: "off" });
  assert.equal(Number(/height="(\d+)"/u.exec(single.source)[1]), SVG_CARD.height, "one thread keeps the old drawing");
});

test("the desktop card counts a lane's steps by tens past ten, so its drawing does not reload on every call", () => {
  let lists = EMPTY_LISTS;
  const drawn = [];
  for (let i = 0; i < 25; i += 1) {
    lists = noteLoopCall(lists, "agent-0", { tool: "Read" }, {});
    const model = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-plan", at: NOW - 1000 } }, now: NOW, isWorking: true, agents: agents(["explore", "verifier"]), lists });
    drawn.push(composeSvgCard(model, { motion: "off" }).source);
  }
  assert.equal(new Set(drawn).size, 9 + 2, "steps 1-9 draw each, then 10+ and 20+ only");
  assert.match(drawn.at(-1), /\[\?\?\?\] 20\+\/\?/u);
});
