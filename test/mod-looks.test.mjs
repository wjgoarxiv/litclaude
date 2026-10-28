// plans/mod-skill-looks.md: the card's look comes from one registry. A skill picks its look on every
// route (bare word, typed command with or without the plugin prefix, Skill tool), YOUR TURN breathes
// amber while the session waits on the user, review-work splits the border into its five lanes as
// they report, and a finished plan, goal or release plays one burst.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";
import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { textWidth } from "../plugins/litclaude/lib/mod/layout.mjs";
import { LANE_COLORS, LOOKS, LOOK_BY_SKILL, laneColor } from "../plugins/litclaude/lib/mod/looks.mjs";
import { TIMINGS, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { parseBoulder, parseIgnition, parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { createTimeline, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel, releaseFinish, waitingReason, workflowFinish } from "../plugins/litclaude/lib/mod/view.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const NOW = 10_000_000;
const SID = "looks-session-01";
const ACCENT = "#5fd7ff";
const iso = (ms) => new Date(ms).toISOString();
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const reviewSnapshot = (verdicts) => {
  const stack = parseWorkflowStack({ version: 1, sessionId: SID, frames: [{ skill: "review-work", family: "main", stage: "review", role: "spine", status: "active", verdicts, at: iso(NOW - 2000) }], history: [] }, SID);
  return { ...idle(), ignition: { discipline: "review-work", at: NOW - 1000 }, workflow: { stack, record: stack.record } };
};
const frames = (model, motion = "full", { count = 1, step = 66, columns = 100, start = 1000 } = {}) => {
  const profile = motionProfile(motion);
  const timeline = createTimeline(model, 0, profile);
  return Array.from({ length: count }, (_, i) => composeBand(model, sampleTimeline(timeline, start + i * step, profile), { columns, glyphs: "basic", accent: ACCENT }));
};
const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const relLum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const withHook = (body) => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-looks-"));
  try {
    mkdirSync(join(tmp, "workspace"));
    const env = { ...process.env, HOME: tmp, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "hud") };
    body((prompt) => {
      const run = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], { cwd: root, encoding: "utf8", env, input: JSON.stringify({ session_id: SID, cwd: join(tmp, "workspace"), prompt, hook_event_name: "UserPromptSubmit" }) });
      assert.equal(run.status, 0, run.stderr);
      return parseIgnition(JSON.parse(readFileSync(join(tmp, "hud", `${SID}.json`), "utf8")), SID);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

test("the registry names every look and maps each skill to one", () => {
  assert.deepEqual(Object.keys(LOOKS).sort(), ["club", "done", "review", "rewind", "turn"]);
  assert.equal(LOOK_BY_SKILL["lit-adhd"], "rewind");
  assert.equal(LOOK_BY_SKILL["lit-rewind"], "rewind");
  assert.equal(LOOK_BY_SKILL["review-work"], "review");
  for (const look of Object.values(LOOKS)) assert.ok(look.label && look.palette && look.comet && look.pill);
});

test("every route selects the skill's look: bare word, typed command, plugin prefix and Skill tool", () => {
  withHook((submit) => {
    for (const [prompt, discipline, look] of [["lit adhd", "lit-adhd", "rewind"], ["/lit-adhd", "lit-adhd", "rewind"], ["/litclaude:lit-rewind", "lit-rewind", "rewind"], ["lit review", "review-work", "review"], ["/review-work", "review-work", "review"], ["/litclaude:review-work", "review-work", "review"], ["/review-work the last commit", "review-work", "review"]]) {
      const ignition = submit(prompt);
      assert.equal(ignition?.discipline, discipline, prompt);
      const model = buildBandModel({ snapshot: { ...idle(), ignition }, now: ignition.at + 1000, isWorking: true });
      assert.equal(model.look, look, prompt);
    }
    for (const prompt of ["/review-workx", "please /review-work later", "what does review-work do?"]) {
      const ignition = submit(prompt);
      assert.notEqual(ignition?.discipline, "review-work", prompt);
      const model = buildBandModel({ snapshot: { ...idle(), ignition }, now: ignition?.at ?? NOW, isWorking: true });
      assert.notEqual(model.look, "review", prompt);
    }
  });
  const turnStartedAt = NOW - 5000;
  const viaSkill = buildBandModel({ snapshot: idle(), now: NOW, isWorking: true, turnStartedAt, skills: [{ id: "review-work", at: NOW - 3000, state: "current" }] });
  assert.equal(viaSkill.look, "review", "a Skill tool load of review-work");
  const lastTurn = buildBandModel({ snapshot: idle(), now: NOW, isWorking: true, turnStartedAt, skills: [{ id: "review-work", at: NOW - 9000, state: "recent" }] });
  assert.equal(lastTurn.look, null, "a firing from an earlier turn ends at the next turn");
  assert.equal(buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-adhd", at: NOW - 1000 } }, now: NOW }).rewind, true, "model.rewind still reads true for the rewind look");
});

test("the review look holds through later turns while a background lane is still out", () => {
  // Background lanes report in the turns their task notifications start, after the turn that
  // loaded review-work; the look used to end with that first turn and the corner fell back to REVIEW ●.
  const turnStartedAt = NOW - 5000;
  const skills = [{ id: "review-work", at: NOW - 60_000, state: "recent" }, { id: "rules", at: NOW - 3000, state: "current" }];
  const out = { ...reviewSnapshot({ goal: "pass", quality: "pass", security: "pass", qa: "running", context: "running" }), ignition: null };
  const held = buildBandModel({ snapshot: out, now: NOW, isWorking: true, turnStartedAt, skills });
  assert.equal(held.look, "review");
  assert.match(rowText(frames(held, "off")[0].rows[0]), /REVIEW 3\/5/u);
  const reported = { ...reviewSnapshot({ goal: "pass", quality: "pass", security: "fail", qa: "pass", context: "pass" }), ignition: null };
  assert.equal(buildBandModel({ snapshot: reported, now: NOW, isWorking: true, turnStartedAt, skills }).look, null, "with every lane reported the look ends with its turn as before");
  const unstarted = { ...reviewSnapshot({}), ignition: null };
  assert.equal(buildBandModel({ snapshot: unstarted, now: NOW, isWorking: true, turnStartedAt, skills }).look, null, "no lane out, no hold");
});

test("waiting reasons: a question to the user or a BLOCKED line; code and plain answers are not waiting", () => {
  assert.equal(waitingReason("I found two options.\n\nWhich one should I use?"), "question");
  assert.equal(waitingReason("어느 쪽으로 할까요?"), "question");
  assert.equal(waitingReason("Tried twice.\nBLOCKED: the registry login expired; run npm login."), "blocked");
  assert.equal(waitingReason("Done. Tests pass."), null);
  assert.equal(waitingReason("Here is the check:\n\n```js\nconst ok = a ? b : c?\n```"), null);
  assert.equal(waitingReason("Is it ready? Yes: every gate passed."), null, "a question answered in the same paragraph is not waiting");
  assert.equal(waitingReason(""), null);
});

test("a paused start-work boundary is waiting on the user", () => {
  const state = { active_work_id: "w1", works: { w1: { work_id: "w1", status: "paused", root_session_id: SID, progress: { total: 3, checked: 1 }, pending_boundary: { boundary_id: "boundary-0123456789abcdef0123" } } } };
  assert.equal(parseBoulder(state, SID).work.awaiting, "boundary-0123456789abcdef0123");
  state.works.w1.pending_boundary = null;
  assert.equal(parseBoulder(state, SID).work.awaiting, null);
});

test("YOUR TURN: amber border and label, breathing with a period of at least two seconds", () => {
  const model = buildBandModel({ snapshot: idle(), now: NOW, waiting: { reason: "question" } });
  assert.equal(model.look, "turn");
  const list = frames(model, "full", { count: Math.ceil(6000 / 66), step: 66 });
  assert.match(rowText(list[0].rows[0]), /YOUR TURN/u);
  for (const frame of list) {
    assert.equal(frame.look, "turn");
    assert.ok(frame.rows.every((row) => textWidth(rowText(row)) === frame.width));
  }
  const series = list.map((frame) => relLum(frame.rows[1][0].fg));
  const peaks = series.flatMap((v, i) => (i > 0 && i < series.length - 1 && v > series[i - 1] && v >= series[i + 1] ? [i] : []));
  assert.ok(peaks.length >= 2, "it breathes");
  for (let i = 1; i < peaks.length; i += 1) assert.ok((peaks[i] - peaks[i - 1]) * 66 >= 2000, `period ${(peaks[i] - peaks[i - 1]) * 66} ms`);
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(list[0].rows[1][0].fg.slice(i, i + 2), 16));
  assert.ok(r > g && g > b && r - b > 60, `the border is amber, got ${list[0].rows[1][0].fg}`);
  const off = frames(model, "off", { count: 3, step: 900 });
  assert.equal(new Set(off.map((frame) => JSON.stringify(frame.rows))).size, 1, "still under motion off");
  assert.notEqual(buildBandModel({ snapshot: idle(), now: NOW, waiting: null }).look, "turn");
});

test("review border follows lane reports: dim until a lane reports, its colour when it passes, red on fail", () => {
  const segmentsOf = (frame) => {
    const top = frame.rows[0];
    const cells = [];
    let col = 0;
    for (const part of top) {
      for (const ch of [...part.text]) {
        if (ch === "─") cells.push({ col, fg: part.fg });
        col += textWidth(ch);
      }
    }
    return cells;
  };
  for (const columns of [60, 100, 160]) {
    const pending = frames(buildBandModel({ snapshot: reviewSnapshot({}), now: NOW, isWorking: true }), "off", { columns })[0];
    assert.equal(pending.look, "review");
    for (const { col, fg } of segmentsOf(pending)) assert.equal(fg, laneColor(Math.min(4, Math.floor((col * 5) / pending.width)), "pending"), `${columns} col ${col}`);
    const mixed = buildBandModel({ snapshot: reviewSnapshot({ goal: "pass", qa: "running", security: "fail" }), now: NOW, isWorking: true });
    const frame = frames(mixed, "off", { columns })[0];
    const lanes = mixed.workflow.verdicts.map(({ state }) => state);
    for (const { col, fg } of segmentsOf(frame)) {
      const lane = Math.min(4, Math.floor((col * 5) / frame.width));
      assert.equal(fg, laneColor(lane, lanes[lane]), `${columns} col ${col} lane ${lane} ${lanes[lane]}`);
    }
    assert.ok(frame.rows.every((row) => textWidth(rowText(row)) === frame.width));
    assert.match(rowText(frame.rows[0]), /REVIEW 2\/5/u, "the corner counts the lanes that reported");
  }
  assert.equal(laneColor(0, "pass"), LANE_COLORS[0]);
  assert.notEqual(laneColor(0, "running"), LANE_COLORS[0]);
  assert.equal(laneColor(0, "pending"), laneColor(3, "pending"), "an unreported lane is dim, whatever lane");
  assert.equal(laneColor(2, "fail"), laneColor(4, "fail"));
});

test("done burst: a workflow that reaches done, and a published release; never a dry run, a failure or a subagent", () => {
  const before = buildBandModel({ snapshot: reviewSnapshot({ goal: "pass", quality: "pass", security: "pass", qa: "pass", context: "running" }), now: NOW, isWorking: true });
  const after = buildBandModel({ snapshot: reviewSnapshot({ goal: "pass", quality: "pass", security: "pass", qa: "pass", context: "pass" }), now: NOW + 1000, isWorking: true });
  const finish = workflowFinish(before, after);
  assert.ok(finish && /review/u.test(finish.detail), JSON.stringify(finish));
  assert.equal(workflowFinish(after, after), null, "no burst on a routine refresh");
  assert.equal(workflowFinish(null, after), null);
  const ok = { result: { stdout: "+ @litfamily/litclaude@2.3.4" }, isError: false };
  assert.ok(releaseFinish({ tool: "Bash", command: "npm publish --access public" }, ok));
  assert.equal(releaseFinish({ tool: "Bash", command: "npm publish --dry-run" }, ok), null);
  assert.equal(releaseFinish({ tool: "Bash", command: "npm publish" }, { isError: true }), null);
  assert.equal(releaseFinish({ tool: "Bash", command: "npm publish", agentId: "a1" }, ok), null);
  assert.equal(releaseFinish({ tool: "Bash", command: "npm test" }, ok), null);
});

test("done burst: the last lane passing while a side frame pauses review-work still bursts", () => {
  // On the host a lane's reviewer loaded another skill, which pushed a side frame over review-work;
  // the last verdict then landed under it and the paused map, which drops its lanes, never burst.
  const under = (verdicts) => {
    const at = iso(NOW - 2000);
    const stack = parseWorkflowStack({ version: 1, sessionId: SID, frames: [
      { skill: "review-work", family: "main", stage: "review", role: "spine", status: "paused", verdicts, at },
      { skill: "frontend-ui-ux", role: "side", status: "active", verdicts: {}, at },
    ], history: [] }, SID);
    return { ...idle(), workflow: { stack, record: stack.record } };
  };
  const before = buildBandModel({ snapshot: under({ goal: "pass", quality: "pass", security: "pass", qa: "running", context: "pass" }), now: NOW, isWorking: true });
  assert.ok(before.workflow.paused, "the review is paused under the side frame");
  const after = buildBandModel({ snapshot: under({ goal: "pass", quality: "pass", security: "pass", qa: "pass", context: "pass" }), now: NOW + 1000, isWorking: true });
  assert.ok(workflowFinish(before, after), "the review finishing under a side frame bursts");
  assert.equal(workflowFinish(after, after), null);
});

test("the burst is one short spray: under a third of the row, gone once the moment ends", () => {
  const model = buildBandModel({ snapshot: idle(), now: NOW, completion: { id: "goal:x", detail: "goal met · 3/3 criteria" } });
  assert.equal(model.look, "done");
  const profile = motionProfile("full");
  const timeline = createTimeline(model, 0, profile);
  let sprayed = 0;
  for (let t = 0; t <= TIMINGS.completion; t += 33) {
    const frame = composeBand(model, sampleTimeline(timeline, t, profile), { columns: 100, glyphs: "basic", accent: ACCENT });
    const row = rowText(frame.rows[3]);
    const confetti = [...row].filter((ch) => /[.*+']/u.test(ch)).length;
    sprayed = Math.max(sprayed, confetti);
    assert.ok(confetti <= 0.3 * (frame.width - 4), `${confetti} cells at ${t} ms`);
  }
  assert.ok(sprayed >= 5, "a visible spray");
  const settled = composeBand(model, sampleTimeline(timeline, TIMINGS.completion + 200, profile), { columns: 100, glyphs: "basic", accent: ACCENT });
  assert.doesNotMatch(rowText(settled.rows[3]).replace(/COMPLETE.*$/u, ""), /[*+']/u, "the spray has settled");
});

// The mods host, cut down to what the looks touch (the same shape as mod-threads.test.mjs).
const hookHost = async ({ env = {} } = {}) => {
  const hooks = [];
  register((event, matcher, hook) => {
    hooks.push(typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook });
    return { catch: () => undefined };
  }, { glyphs: "basic", motion: "full" });
  const now = NOW;
  const timers = [];
  const $ = {
    fs: { stat: async () => null, read: async () => { throw new Error("ENOENT"); } },
    session: { cwd: async () => "/nowhere/project", id: async () => SID, usage: async () => null, surfaces: async () => ["terminal"] },
    agent: { list: async () => [] },
    clock: { now: async () => now, after: (ms, fn) => { timers.push(fn); }, every: () => () => undefined },
    env: { get: async (name) => env[name] },
    settings: { read: async () => null },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, resolve: () => elements, notify: async () => ({}) },
  };
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: (props) => ({ kind: "text", text: props.children, props }),
  };
  const fire = async (event, e, matcher = {}, core = undefined) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const step = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => step(index + 1, next)) : typeof core === "function" ? core() : core);
    return step(0, e);
  };
  const flush = async () => {
    while (timers.length) await timers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const texts = (node) => (node.kind === "text" ? [node] : node.children.flatMap(texts));
  const card = async () => {
    const drawn = await fire("ui.render", { surface: "terminal", props: { bodyColumns: 100 } }, { component: "AbovePrompt" });
    return drawn.children.map((row) => texts(row));
  };
  const lines = async () => (await card()).map((row) => row.map(({ text }) => text).join(""));
  await fire("session.start", {});
  return { fire, flush, card, lines };
};

test("the mod: YOUR TURN after a question, gone the moment the user types; and while AskUserQuestion waits", async () => {
  const host = await hookHost();
  await host.fire("turn.start", {});
  await host.fire("turn.complete", { answer: "Two ways to do it.\n\nShould I keep the old flag?", durationMs: 2000 });
  await host.flush();
  assert.match((await host.lines())[0], /YOUR TURN/u);
  await host.fire("prompt.edit", { text: "y", cursor: 1 }, {}, { text: "y", cursor: 1 });
  await host.flush();
  assert.doesNotMatch((await host.lines())[0], /YOUR TURN/u, "typing ends it");
  await host.fire("turn.start", {});
  let inFlight = null;
  await host.fire("tool.call", { tool: "AskUserQuestion", questions: [] }, {}, async () => {
    inFlight = (await host.lines())[0];
    return { result: { answers: {} } };
  });
  assert.match(inFlight, /YOUR TURN/u, "while the question is on screen");
  await host.fire("turn.complete", { answer: "Done. Every gate passed.", durationMs: 2000 });
  await host.flush();
  assert.doesNotMatch((await host.lines())[0], /YOUR TURN/u, "a plain answer is not waiting");
});

test("the mod: a published release plays the burst once; NO_COLOR draws no colour and keeps the labels", async () => {
  const seen = await hookHost();
  await seen.fire("turn.start", {});
  await seen.fire("tool.call", { tool: "Bash", command: "npm publish --access public", description: "Publish" }, {}, { result: { stdout: "+ pkg@2.3.4" }, isError: false });
  assert.match((await seen.lines()).join("\n"), /COMPLETE · released/u);
  await seen.flush();
  assert.doesNotMatch((await seen.lines()).join("\n"), /COMPLETE/u, "the burst plays once and the card settles");
  const plain = await hookHost({ env: { NO_COLOR: "1" } });
  await plain.fire("turn.complete", { answer: "Which file should I start with?", durationMs: 1000 });
  await plain.flush();
  const rows = await plain.card();
  assert.match(rows[0].map(({ text }) => text).join(""), /YOUR TURN/u);
  for (const row of rows) for (const { props } of row) assert.ok(!props.color && !props.backgroundColor, JSON.stringify(props));
});
