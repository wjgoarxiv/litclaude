// Interleaved workflows on the LIT card, driven through the real hook binary and the model's
// `litclaude-ai workflow-stage` call: a lit command asked for in the middle of a lit-loop pauses the
// loop with its stage and count instead of erasing it, asking for the loop again resumes it, a
// read-only recap changes nothing, `lit new` still starts clean, and two sessions in one project keep
// separate stacks. The card is read the way the mod reads it (readLitSnapshot → buildBandModel →
// composeBand) with a private HOME and HUD roots.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { CARD_MAX, composeBand, composeEvidence, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { readLedgerTail, readLitSnapshot } from "../plugins/litclaude/lib/mod/state.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { createTimeline, sampleTimeline, settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { statusChanges, statusOf } from "../plugins/litclaude/lib/mod/toasts.mjs";
import { buildWorkflow } from "../plugins/litclaude/lib/mod/workflow.mjs";
import { buildBandModel, buildEvidenceModel, spinnerSuffix } from "../plugins/litclaude/lib/mod/view.mjs";
import { readStack } from "../plugins/litclaude/lib/workflow-stack.mjs";

const PLUGIN = join(import.meta.dirname, "..", "plugins", "litclaude");
const CLI = join(import.meta.dirname, "..", "bin", "litclaude-ai.js");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-interleave-")));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;

const io = {
  stat: async (path) => {
    const stats = statSync(path);
    return { kind: stats.isDirectory() ? "dir" : "file", isLink: lstatSync(path).isSymbolicLink(), size: stats.size, mtimeMs: stats.mtimeMs, realPath: realpathSync(path) };
  },
  read: async (path) => readFileSync(path, "utf8"),
  list: async (path) => readdirSync(path).map((name) => {
    const stats = lstatSync(join(path, name));
    return { name, kind: stats.isDirectory() ? "dir" : "file", isLink: stats.isSymbolicLink(), mtimeMs: stats.mtimeMs };
  }),
};

const project = () => {
  const root = join(scratch, `p${counter += 1}`);
  const ws = join(root, "proj");
  const hud = join(root, "hud");
  for (const dir of [ws, hud, join(ws, ".git"), join(ws, "plans"), join(ws, "test")]) mkdirSync(dir, { recursive: true });
  const env = { ...process.env, HOME: join(root, "home"), LITCLAUDE_HUD_STATE_ROOT: hud, LITCLAUDE_ACTIVATION_STATE_ROOT: hud };
  for (const key of ["CLAUDE_CODE_SESSION_ID", "TYPESAFE_API_KEY", "LITCLAUDE_JEV", "LITCODEX_JEV", "LITOPENCODE_JEV", "LITHERMES_JEV", "OPENAI_API_KEY"]) delete env[key];
  return { root, ws, hud, env };
};

const session = (where = project(), sid = `interleave-${counter += 1}`) => {
  const { ws, hud, env } = where;
  const hook = (event, payload) => {
    const run = spawnSync(process.execPath, [join(PLUGIN, "bin", "litclaude-hook.js"), event], {
      cwd: ws,
      env,
      encoding: "utf8",
      input: JSON.stringify({ session_id: sid, cwd: ws, prompt_id: `p${counter += 1}`, hook_event_name: event, ...payload }),
    });
    assert.equal(run.status, 0, run.stderr);
    try {
      return JSON.parse(run.stdout).hookSpecificOutput?.additionalContext ?? "";
    } catch {
      return run.stdout;
    }
  };
  return {
    sid,
    ws,
    prompt: (text) => hook("user-prompt-submit", { prompt: text }),
    skill: (name) => hook("pre-tool-use", { tool_name: "Skill", tool_input: { skill: `litclaude:${name}` } }),
    write: (rel, body) => {
      const path = join(ws, rel);
      writeFileSync(path, body);
      hook("post-tool-use", { tool_name: "Write", tool_input: { file_path: path, content: body }, tool_response: { filePath: path } });
    },
    stage: (...args) => spawnSync(process.execPath, [CLI, "workflow-stage", ...args], { cwd: ws, env, encoding: "utf8" }),
    card: async (columns = 100) => {
      const snapshot = await readLitSnapshot(io, { cwd: ws, sessionId: sid, env: { LITCLAUDE_HUD_STATE_ROOT: hud } });
      const model = buildBandModel({ snapshot, now: Date.now(), isWorking: true, git: "main" });
      const frame = composeBand(model, settledSample(model), { columns, glyphs: "basic" });
      const rows = frame.rows.map((row) => row.map(({ text }) => text).join(""));
      return { snapshot, model, frame, top: rows[0], map: rows[1], detail: rows[2] };
    },
  };
};

// lit-plan saved, then lit-loop at RED on criterion 1 of 4: the place the user had before interjecting.
const loopAtRed = (s, extra = []) => {
  s.prompt("lit plan add a slugify helper");
  s.skill("lit-plan");
  s.write("plans/slugify.md", "# Slugify\n\n## Tasks\n\n- [ ] 1. test\n- [ ] 2. impl\n");
  s.prompt("lit implement plans/slugify.md");
  s.skill("lit-loop");
  const run = s.stage("loop", "RED", "--n", "1", "--total", "4", "--unit", "criterion", ...extra);
  assert.equal(run.status, 0, run.stderr);
};

test("the loop shows RED and criterion 1/4 before any interjection", async () => {
  const s = session();
  loopAtRed(s);
  const card = await s.card();
  assert.match(card.map, /RED/u);
  assert.match(card.detail, /criterion 1\/4/u);
});

test("an interjected lit brainstorm pauses the loop and keeps its stage and count on the card", async () => {
  const s = session();
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  s.skill("lit-brainstorm");
  const card = await s.card();
  assert.deepEqual(card.snapshot.workflow.stack.frames.map(({ skill, status }) => `${skill}:${status}`), ["lit-loop:paused", "lit-brainstorm:active"]);
  assert.match(card.map, /RED/u, "the parent's map stays, frozen at RED");
  assert.match(`${card.map} ${card.detail}`, /1\/4/u, "the parent's count stays visible");
});

test("the model loading Skill(lit-brainstorm) mid-loop does not erase the loop's place", async () => {
  const s = session();
  loopAtRed(s);
  s.skill("lit-brainstorm");
  const card = await s.card();
  assert.match(card.map, /RED/u);
  assert.match(`${card.map} ${card.detail}`, /1\/4/u);
});

test("asking for lit-loop again by name resumes its frame at RED 1/4 instead of restarting at PIN", async () => {
  const s = session();
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  s.prompt("lit implement the rest of plans/slugify.md");
  s.skill("lit-loop");
  const card = await s.card();
  assert.match(card.map, / RED /u);
  assert.match(card.map, /PIN ✓/u, "PIN shows as passed, not as the open step");
  assert.equal(card.snapshot.workflow.record.stage, "RED");
  assert.match(card.detail, /criterion 1\/4/u);
  assert.deepEqual(readStack(s.ws, s.sid).frames.map(({ skill }) => skill), ["lit-loop"], "the brainstorm side frame is closed");
});

test("a read-only recap leaves the running loop's map alone", async () => {
  const s = session();
  loopAtRed(s);
  s.prompt("recap where we are");
  const card = await s.card();
  assert.match(card.map, /RED/u);
  assert.match(card.detail, /criterion 1\/4/u);
});

test("lit new still starts clean", async () => {
  const s = session();
  loopAtRed(s);
  s.prompt("lit new implement a different helper");
  s.skill("lit-loop");
  const card = await s.card();
  assert.doesNotMatch(card.detail, /1\/4/u);
});

test("two sessions in one project keep separate stacks, and the stage call writes only the named session", async () => {
  const where = project();
  const first = session(where, "first-session");
  const second = session(where, "second-session");
  loopAtRed(first, ["--session", first.sid]);
  second.prompt("lit brainstorm names for a different thing");
  assert.equal(second.stage("main", "interview", "--n", "2", "--total", "3", "--unit", "round", "--session", second.sid).status, 0);
  assert.deepEqual(readStack(where.ws, first.sid).frames.map(({ skill, stage, n }) => `${skill}:${stage}:${n}`), ["lit-loop:RED:1"]);
  assert.deepEqual(readStack(where.ws, second.sid).frames.map(({ skill, stage, n }) => `${skill}:${stage}:${n}`), ["lit-brainstorm:interview:2"]);
  assert.match((await first.card()).map, /RED/u);
  assert.doesNotMatch((await second.card()).map, /RED/u);
});

const ledgerEvents = (ws) => {
  try {
    return readFileSync(join(ws, ".litclaude", "litgoal", "ledger.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .filter(({ event }) => event.startsWith("workflow."));
  } catch {
    return [];
  }
};

test("D1 (A): lit continue after an interjected brainstorm resumes the paused lit-loop at RED 1/4", async () => {
  const s = session();
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  const context = s.prompt("lit continue");
  assert.match(context, /lit-loop/u);
  assert.match(context, /1\/4/u, "the context names the resumed count");
  assert.doesNotMatch(context, /lit-brainstorm is already active/u);
  const card = await s.card();
  assert.match(card.map, /RED/u);
  assert.match(card.detail, /criterion 1\/4/u);
  assert.deepEqual(readStack(s.ws, s.sid).frames.map(({ skill, status }) => `${skill}:${status}`), ["lit-loop:active"]);
});

test("lit brainstorm continue stays in the brainstorm side frame", () => {
  const s = session();
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  const context = s.prompt("lit brainstorm continue");
  assert.match(context, /lit-brainstorm is already active/u);
  assert.deepEqual(readStack(s.ws, s.sid).frames.map(({ skill, status }) => `${skill}:${status}`), ["lit-loop:paused", "lit-brainstorm:active"]);
});

test("a lit-loop resumed by name gets the short continue note, and its frame resumes", () => {
  const s = session();
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  const context = s.prompt("lit implement the rest of plans/slugify.md");
  assert.ok(Buffer.byteLength(context) <= 600, `${Buffer.byteLength(context)} bytes`);
  assert.match(context, /lit-loop is already active/u);
  assert.deepEqual(readStack(s.ws, s.sid).frames.map(({ skill, status, stage }) => `${skill}:${status}:${stage}`), ["lit-loop:active:RED"]);
});

test("pause, side-done and resume reach the litgoal ledger only while a goal is open", () => {
  const open = session();
  mkdirSync(join(open.ws, ".litclaude", "litgoal"), { recursive: true });
  writeFileSync(join(open.ws, ".litclaude", "litgoal", "goals.json"), JSON.stringify({ version: 1, objective: "slugify", status: "active", criteria: [] }));
  loopAtRed(open);
  open.prompt("lit brainstorm better names for the helper");
  open.prompt("lit continue");
  const events = ledgerEvents(open.ws);
  assert.deepEqual(events.map(({ event, skill }) => `${event}:${skill}`), ["workflow.paused:lit-loop", "workflow.side.done:lit-brainstorm", "workflow.resumed:lit-loop"]);
  assert.deepEqual({ stage: events[0].stage, n: events[0].n, total: events[0].total }, { stage: "RED", n: 1, total: 4 });
  assert.ok(events.every((entry) => Object.keys(entry).every((key) => ["timestamp", "event", "skill", "stage", "n", "total"].includes(key))), "no prompt or path");
  const none = session();
  loopAtRed(none);
  none.prompt("lit brainstorm better names for the helper");
  none.prompt("lit continue");
  assert.deepEqual(ledgerEvents(none.ws), []);
});

// The three situations of plans/lit-adhd.md todo 5: (a) a running loop, (b) the loop paused under an
// interjected brainstorm, (c) the loop resumed. The paused map is the loop's, frozen at RED with its
// count and an ASCII pause mark; the title and the detail row belong to the brainstorm.
const withHangulGoal = (s) => {
  mkdirSync(join(s.ws, ".litclaude", "litgoal"), { recursive: true });
  writeFileSync(join(s.ws, ".litclaude", "litgoal", "goals.json"), JSON.stringify({
    version: 1,
    objective: "slugify",
    status: "active",
    criteria: [{ id: "c1", description: "빈 입력은 빈 문자열을 돌려준다", status: "pending", evidence: [] }],
  }));
};

test("(b) the paused loop's map stays frozen under the brainstorm, with a breadcrumb title and a way back", async () => {
  const s = session();
  withHangulGoal(s);
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  const card = await s.card();
  assert.match(card.top, /lit-loop \|\| > lit-brainstorm/u, "the breadcrumb names the paused parent and the child");
  assert.match(card.map, /\|\| RED 1\/4/u, "the parent's map is frozen at RED with its count");
  assert.match(card.top, /RED \|\|/u, "the indicator shows the pause, not the live dot");
  assert.match(card.detail, /↳ lit-brainstorm · back: lit continue/u);
  assert.match(card.detail, /빈 입력은/u, "the paused work's next step stays in view");
  assert.equal(spinnerSuffix(card.model), "… · lit-brainstorm (|| lit-loop 1/4)");
  for (const columns of [60, 80, 100, 20]) {
    const { frame } = await s.card(columns);
    for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(columns, CARD_MAX), `${columns}: ${rowText(row)}`);
  }
  const at60 = await s.card(60);
  assert.match(at60.top, /lit-loop/u, "the parent survives a narrow card");
  const full = motionProfile("full");
  const timeline = createTimeline(card.model, 0, full);
  const frames = [2000, 2300, 2600, 2900].map((t) => composeBand(card.model, sampleTimeline(timeline, t, full), { columns: 100, glyphs: "basic" }));
  assert.equal(new Set(frames.map((frame) => rowText(frame.rows[1]))).size, 1, "the frozen map's text never changes");
  for (const frame of frames) {
    const glyphs = frame.rows[1].flatMap(({ text }) => [...text].filter((ch) => /[^\x20-\x7e]/u.test(ch)));
    assert.deepEqual([...new Set(glyphs)].filter((ch) => !"│━─✓·".includes(ch)), [], "the pause mark is ASCII");
  }
  const svg = composeSvgCard(card.model).source;
  assert.match(svg, /lit-loop \|\| &gt; lit-brainstorm/u, "the SVG card carries the same breadcrumb");
  assert.match(svg, /\|\| RED 1\/4/u);
  assert.ok(svg.length < 131072);
  assert.equal(composeSvgCard(card.model).source, svg, "the drawing does not depend on the time it is drawn");
  assert.match(svg, /RED \|\|/u, "the SVG indicator shows the pause");
});

test("(a) and (c): a running loop has no pause marks, and after lit continue the loop is live again with a resume toast", async () => {
  const s = session();
  loopAtRed(s);
  const running = await s.card();
  assert.doesNotMatch(`${running.top}${running.map}${running.detail}`, /\|\||↳/u);
  s.prompt("lit brainstorm better names for the helper");
  const paused = await s.card();
  s.prompt("lit continue");
  const resumed = await s.card();
  assert.match(resumed.top, /· lit-loop /u);
  assert.doesNotMatch(`${resumed.top}${resumed.map}${resumed.detail}`, /\|\||↳/u);
  assert.match(resumed.detail, /criterion 1\/4/u);
  const before = statusOf({ discipline: "lit-brainstorm", model: paused.model, snapshot: paused.snapshot });
  const after = statusOf({ discipline: "lit-loop", model: resumed.model, snapshot: resumed.snapshot }, before);
  assert.deepEqual(statusChanges(before, after).filter(({ kind }) => kind === "resumed"), [{ kind: "resumed", text: "resumed lit-loop · RED 1/4" }]);
});

test("the evidence timeline shows the pause and the resume from the goal's ledger", async () => {
  const s = session();
  withHangulGoal(s);
  loopAtRed(s);
  s.prompt("lit brainstorm better names for the helper");
  s.prompt("lit continue");
  const { snapshot } = await s.card();
  const ledger = await readLedgerTail(io, snapshot.stateRoot);
  const rows = composeEvidence(buildEvidenceModel({ snapshot, ledger, now: Date.now() }), "goal", { columns: 100 }).map(rowText).join("\n");
  assert.match(rows, /workflow\.paused\s+lit-loop RED 1\/4/u);
  assert.match(rows, /workflow\.resumed\s+lit-loop RED 1\/4/u);
});

test("root cause 6: an open work keeps its task count on the main map while another stage is current", () => {
  const now = Date.now();
  const snapshot = { ignition: { discipline: "lit-plan", at: now }, work: { checked: 1, total: 3, nextTask: "impl" }, goal: null, completedWorkIds: [], workflow: {} };
  const flow = buildWorkflow({ snapshot, now });
  assert.equal(flow.stages[flow.current].id, "plan");
  assert.equal(flow.stages.find(({ id }) => id === "work").label, "work 1/3");
});
