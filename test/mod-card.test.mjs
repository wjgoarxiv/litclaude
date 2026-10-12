import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HUD_ACCENT_THEMES } from "../plugins/litclaude/lib/hud-accent-palette.mjs";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { CARD_MAX, composeBand, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { TIMINGS, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { ACCENT_CODES, accentFromSettings, accentHex, normalizeModSettings, xterm256Hex } from "../plugins/litclaude/lib/mod/settings.mjs";
import { LIT_SKILL_IDS, chipStates, litSkillId, noteSkill } from "../plugins/litclaude/lib/mod/skills.mjs";
import { readGitBranch } from "../plugins/litclaude/lib/mod/state.mjs";
import { advanceTimeline, createTimeline, sampleTimeline, settledSample, timelineBusy } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { STALL_MS, buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";
import { register } from "../plugins/litclaude/hooks/lit-mod.mjs";

const NOW = 10_000_000;
const CYAN = "#5fd7ff";
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const goalOf = (passed, total, status = "active") => ({
  objective: "ship the card",
  status,
  autoloop: false,
  criteria: Array.from({ length: total }, (_, i) => ({ id: `C${i + 1}`, description: `criterion ${i + 1}`, status: i < passed ? "pass" : "pending", attempts: 0, lastAt: null })),
  blockers: [],
  lastCheckpoint: null,
  createdAt: 1,
});
const lit = (overrides = {}) => ({ ...idle(), ignition: { discipline: "lit-loop", at: NOW - 1000 }, goal: goalOf(2, 5), ...overrides });
const usage = { context: { percent: 42 }, rateLimits: [{ kind: "seven_day", percentUsed: 12 }, { kind: "five_hour", percentUsed: 31 }] };
const chips = (current, recent = []) => [
  ...current.map((id, i) => ({ id, at: NOW - 100 - i, state: "current" })),
  ...recent.map((id, i) => ({ id, at: NOW - 60_000 - i, state: "recent" })),
];
const draw = (model, columns, glyphs = "basic", sample = settledSample(model)) => composeBand(model, sample, { columns, glyphs, accent: CYAN });
const texts = (frame) => frame.rows.map(rowText);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test("the band shows by default: an idle session still draws the card, auto and off remain", () => {
  assert.equal(normalizeModSettings({}).band, "always");
  assert.equal(normalizeModSettings({ band: "auto" }).band, "auto");
  assert.equal(normalizeModSettings({ band: "nonsense" }).band, "always");
  const resting = buildBandModel({ snapshot: idle(), now: NOW });
  assert.equal(resting.visible, true, "the default keeps the card up with nothing running");
  assert.equal(resting.idle, true);
  assert.equal(buildBandModel({ snapshot: idle(), now: NOW, band: "auto" }).visible, false);
  assert.equal(buildBandModel({ snapshot: lit(), now: NOW, band: "off" }).visible, false);
  const fired = buildBandModel({ snapshot: idle(), now: NOW, band: "auto", skills: chips(["lit-plan"]) });
  assert.equal(fired.visible, true, "auto shows the card while a skill of this request is lit");
});

test("the working card reads like the chosen sketch, every row exactly the card width", () => {
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main", skills: chips(["lit-plan", "litresearch", "lit-docx"]) });
  assert.equal(model.idle, false);
  const frame = draw(model, 64);
  assert.equal(frame.rows.length, 4);
  for (const row of frame.rows) assert.equal(rowWidth(row), 64, rowText(row));
  const [top, phases, skills, bottom] = texts(frame);
  assert.match(top, /^╭─ {2}🔥 LIT {2}· lit-loop ─+ WORK ● ─╮$/u);
  assert.match(phases, /^│ ● PLAN ━+ {2}WORK {2}━+ ○ REVIEW +goal [ ░]+ 2\/5 │$/u);
  assert.match(skills, /^│ skills {2}⚡ lit-plan {3}⚡ litresearch {3}⚡ lit-docx +│$/u);
  assert.match(bottom, /^╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · git main ─+╯$/u);
  const name = frame.rows[2].find(({ text }) => text === "lit-plan");
  assert.equal(name.bg, CYAN, "a skill of this request is a pill on the HUD accent");
  assert.equal(name.bold, true);
  assert.ok(luminance(name.fg) < 0.2, "with dark text");
  const work = frame.rows[1].find(({ text }) => text === "WORK");
  assert.equal(work.bg, CYAN, "the active phase is a filled pill");
  assert.equal(work.bold, true);
  assert.ok(luminance(work.fg) < 0.2);
  const label = frame.rows[2].find(({ text }) => text.startsWith("skills"));
  assert.equal(label.bg, undefined, "the skills label is plain dim text");
  const discipline = frame.rows[0].find(({ text }) => text === "lit-loop");
  assert.equal(discipline.fg, CYAN);
  assert.equal(discipline.bold, true);
});

test("idle keeps the same height and says something useful: last discipline, goal and recent skills", () => {
  const done = { ...idle(), goal: goalOf(5, 5, "complete") };
  const model = buildBandModel({ snapshot: done, now: NOW, lastDiscipline: "lit-loop", usage, git: "main", skills: chips([], ["lit-plan", "litresearch"]) });
  assert.equal(model.idle, true);
  const frame = draw(model, 64);
  assert.equal(frame.rows.length, 4);
  for (const row of frame.rows) assert.equal(rowWidth(row), 64);
  const [top, phases, skills] = texts(frame);
  assert.match(top, /^╭─ {2}🔥 LIT {2}· lit-loop ─+ idle ─╮$/u);
  assert.match(phases, /goal ✓ 5\/5 │$/u);
  assert.match(skills, /^│ skills {2}↯ lit-plan {3}↯ litresearch +│$/u);
  const recent = frame.rows[2].find(({ text }) => text === "lit-plan");
  assert.ok(recent.bg && recent.bg !== CYAN && luminance(recent.bg) < 0.25, "a skill from an earlier request is a muted dark pill");
  assert.ok(luminance(recent.fg) > 0.35, "with light grey text");
  const discipline = frame.rows[0].find(({ text }) => text === "lit-loop");
  assert.notEqual(discipline.bold, true, "the last discipline is shown quietly while idle");

  const fresh = draw(buildBandModel({ snapshot: idle(), now: NOW }), 64);
  assert.equal(fresh.rows.length, 4);
  assert.match(texts(fresh)[0], /^╭─ {2}🔥 LIT {2}· ready ─+ idle ─╮$/u);
  assert.match(texts(fresh)[2], /no LitFamily skill yet/u);
});

test("too many chips collapse to +N and the narrow card drops git, then the rate window, never wrapping", () => {
  const many = ["lit-plan", "litresearch", "lit-docx", "lit-pptx", "review-work", "lit-humanizer", "deep-interview"];
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "feat/lit-humanizer", skills: chips(many) });
  const narrow = texts(draw(model, 44));
  assert.match(narrow[2], /\+\d+ +│$/u);
  assert.doesNotMatch(narrow[3], /git/u);
  assert.match(narrow[3], /ctx 42%/u);
  const tiny = texts(draw(model, 24));
  assert.doesNotMatch(tiny[3], /5h/u);
  assert.ok(CARD_MAX >= 64 && CARD_MAX <= 100, "a wide terminal does not stretch the card thin");
  for (const columns of [20, 24, 44, 64, 100, 160]) {
    for (const glyphs of ["basic", "nerd"]) {
      const frame = draw(model, columns, glyphs);
      for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(columns, CARD_MAX), `${glyphs} ${columns}: ${rowText(row)}`);
    }
  }
});

test("every row of every frame fits the card width from 20 to 200 columns", () => {
  const snapshot = lit({
    work: { id: "w1", status: "active", planName: "demo.md", total: 7, checked: 4, nextTask: "5. README 데모 GIF 교체", lanes: [] },
    autoloop: { blockCount: 3, firstBlockAt: NOW - 60_000 },
    probe: { editAt: 1, probeAt: null, issue: "a HIGH finding remains in the 화면 layout", issueAt: 2, paths: [], blockCount: 1 },
    handoff: { percent: 80, firedAt: null, firedAtPercent: null, pending: false },
  });
  const agents = [{ id: "a1", status: "running", name: "리드미-한국어" }, { id: "a2", status: "idle", name: "demo-gif" }];
  const notice = { id: "n", tone: "amber", title: "interface probe pending", detail: "run the interface probe before finishing · stop 1/2" };
  const variants = [
    { notice: null, completion: null },
    { notice, completion: null },
    { notice: null, completion: { id: "c", detail: "7/7 tasks" } },
  ];
  for (const glyphs of ["basic", "nerd"]) {
    for (const extra of variants) {
      const model = buildBandModel({ snapshot, agents, activity: { last: { a2: NOW - STALL_MS - 1 }, first: {} }, usage: { ...usage, context: { percent: 77 } }, now: NOW, isWorking: true, git: "main", skills: chips(["lit-plan", "litresearch"], ["lit-docx"]), ...extra });
      const profile = motionProfile("full");
      const timeline = createTimeline(model, 0, profile);
      for (let columns = 20; columns <= 200; columns += 3) {
        for (const t of [0, 90, 200, 400, 700, 2000]) {
          const frame = composeBand(model, sampleTimeline(timeline, t, profile), { columns, glyphs, accent: CYAN });
          assert.equal(frame.rows.length, 4);
          for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(columns, CARD_MAX), `${glyphs} ${columns} t=${t}: "${rowText(row)}"`);
        }
      }
    }
  }
});

test("a warning turns the border amber or red and takes the bottom edge", () => {
  const stalled = buildBandModel({ snapshot: lit(), agents: [{ id: "a1", status: "idle", name: "demo-gif" }], activity: { last: { a1: NOW - 12 * 60_000 }, first: {} }, now: NOW, usage });
  const frame = draw(stalled, 80);
  assert.equal(frame.border, "#ffaf3c");
  assert.match(texts(frame)[3], /^╰─ ⚠ demo-gif quiet for 12m/u);
  assert.equal(frame.rows[1][0].fg, "#ffaf3c", "the side edges take the border colour");
  const failed = buildBandModel({ snapshot: lit({ probe: { editAt: 10, probeAt: null, issue: "a HIGH finding remains", issueAt: 12, paths: [], blockCount: 1 } }), now: NOW });
  assert.equal(draw(failed, 80).border, "#ff5f5f");
});

test("notices and the completion moment play in the chips row without changing the height", () => {
  const notice = { id: "n1", tone: "pink", title: "lit-plan is not saved yet", detail: "stop 1/2" };
  const noticed = draw(buildBandModel({ snapshot: lit(), now: NOW, notice, skills: chips(["lit-plan"]) }), 90);
  assert.equal(noticed.rows.length, 4);
  assert.match(texts(noticed)[2], /^│ ▎ 🔥 lit-plan is not saved yet {2}· stop 1\/2 +│$/u);
  const finished = buildBandModel({ snapshot: lit(), now: NOW, completion: { id: "c", detail: "goal met · 5/5 criteria" } });
  const quiet = composeBand(finished, sampleTimeline(createTimeline(finished, 0, motionProfile("subtle")), 400, motionProfile("subtle")), { columns: 90, glyphs: "basic", accent: CYAN });
  assert.match(texts(quiet)[2], /^│ ✦ COMPLETE · goal met · 5\/5 criteria +│$/u);
  assert.match(texts(quiet)[0], /DONE ✓ ─╮$/u);
});

test("pills: rounded caps in the pill colour with Nerd glyphs, one cell of padding with basic, same widths", () => {
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main", skills: chips(["lit-plan", "litresearch"], ["lit-docx", "lit-pptx", "review-work", "lit-humanizer", "deep-interview", "lit-init"]) });
  const nerd = draw(model, 64, "nerd");
  const basic = draw(model, 64, "basic");
  for (const frame of [nerd, basic]) for (const row of frame.rows) assert.equal(rowWidth(row), 64, rowText(row));
  const caps = (row) => row.filter(({ text }) => text === "\ue0b6" || text === "\ue0b4");
  const [top, phases, skills] = nerd.rows;
  for (const row of [top, phases, skills]) assert.ok(caps(row).length >= 2, `nerd pills have caps: ${rowText(row)}`);
  const work = phases.findIndex(({ text }) => text === "WORK");
  assert.equal(phases[work - 1].text, "\ue0b6");
  assert.equal(phases[work - 1].fg, phases[work].bg, "the left cap takes the pill colour on the terminal background");
  assert.equal(phases[work - 1].bg, undefined);
  assert.equal(phases[work + 1].text, "\ue0b4");
  assert.equal(phases[work + 1].fg, CYAN);
  assert.match(rowText(phases), /● PLAN ━+ \ue0b6WORK\ue0b4 ━+ ○ REVIEW/u, "nerd uses ○ and ●, never the eye icon");
  for (const row of basic.rows) assert.equal(caps(row).length, 0, "basic needs no icon font");
  const plain = basic.rows[1].findIndex(({ text }) => text === "WORK");
  assert.deepEqual([basic.rows[1][plain - 1], basic.rows[1][plain + 1]].map(({ text, bg }) => [text, bg]), [[" ", CYAN], [" ", CYAN]], "basic pads the pill with one cell of its colour");
  assert.match(rowText(basic.rows[1]), /● PLAN ━+ {2}WORK {2}━+ ○ REVIEW/u);
  const brand = basic.rows[0].filter(({ bg }) => bg === "#ff2d95");
  assert.equal(brand.map(({ text }) => text).join(""), " 🔥 LIT ", "the brand is a small pink pill");
  const overflow = basic.rows[2].find(({ text }) => /^\+\d+$/u.test(text));
  assert.ok(overflow && overflow.bg && overflow.bg !== CYAN, "+N is a muted pill");
  const connector = basic.rows[1].find(({ text }) => text.includes("━"));
  assert.ok(luminance(connector.fg) > 0.12, "connectors stay visible");
  for (const columns of [20, 30, 44, 80]) {
    assert.deepEqual(draw(model, columns, "nerd").rows.map(rowWidth), draw(model, columns, "basic").rows.map(rowWidth), `${columns}`);
  }
});

test("chips: LitFamily skills only, newest first, a refire within the same moment is one firing", () => {
  assert.deepEqual([...LIT_SKILL_IDS].sort(), [...canonicalSkillIds].sort(), "the mod's skill list follows the catalog");
  assert.equal(litSkillId("litclaude:lit-plan"), "lit-plan");
  assert.equal(litSkillId("lit-plan"), "lit-plan");
  assert.equal(litSkillId("litclaude:lit-korean"), "lit-korean", "a LitClaude slash command is ours too");
  assert.equal(litSkillId("superpowers:brainstorming"), null);
  assert.equal(litSkillId("commit"), null);
  assert.equal(litSkillId("native-workflow"), null);
  assert.equal(litSkillId(""), null);
  assert.equal(litSkillId(undefined), null);

  let fired = [];
  fired = noteSkill(fired, "lit-plan", 1000);
  fired = noteSkill(fired, "litresearch", 2000);
  fired = noteSkill(fired, "lit-plan", 2500);
  assert.deepEqual(fired.map(({ id }) => id), ["lit-plan", "litresearch"]);
  assert.equal(fired[0].at, 2500, "a new firing brightens the chip again");
  assert.equal(noteSkill(fired, "lit-plan", 3000)[0].at, 2500, "the Skill call and its prompt expansion are one firing");
  for (let i = 0; i < 20; i += 1) fired = noteSkill(fired, canonicalSkillIds[i], 10_000 + i * 5000);
  assert.ok(fired.length <= 12, "only a short history is kept");

  const states = chipStates([{ id: "a", at: 3000 }, { id: "b", at: 1000 }, { id: "c", at: 2500 }], 2000);
  assert.deepEqual(states.map(({ id, state }) => `${id}:${state}`), ["a:current", "c:current", "b:recent"]);
  assert.deepEqual(chipStates([{ id: "a", at: 3000 }], 3500).map(({ state }) => state), ["recent"], "a finished request dims its chips");
});

test("a chip shimmers on arrival in full motion, fades in under subtle, and dims when the turn completes", () => {
  const before = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, skills: chips(["litresearch"]) });
  const after = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, skills: [{ id: "lit-plan", at: NOW + 5, state: "current" }, ...chips(["litresearch"])] });
  const colours = (timeline, t, profile) => composeBand(after, sampleTimeline(timeline, t, profile), { columns: 90, glyphs: "basic", accent: CYAN })
    .rows[2].filter(({ text }) => /^[a-z-]$/u.test(text) || text === "lit-plan").map(({ bg }) => bg).join(",");
  const full = motionProfile("full");
  let timeline = createTimeline(before, 0, full);
  timeline = advanceTimeline(timeline, after, 1000, full);
  assert.equal(timelineBusy(timeline, 1000 + TIMINGS.shimmer - 1, full), true);
  assert.equal(timelineBusy(timeline, 1000 + TIMINGS.shimmer, full), false);
  const frames = [1100, 1200, 1300].map((t) => colours(timeline, t, full));
  assert.equal(new Set(frames).size, 3, "the light moves along the name");
  assert.notEqual(frames[0], colours(timeline, 1000 + TIMINGS.shimmer, full));

  const subtle = motionProfile("subtle");
  const soft = advanceTimeline(createTimeline(before, 0, subtle), after, 1000, subtle);
  const name = (t) => composeBand(after, sampleTimeline(soft, t, subtle), { columns: 90, glyphs: "basic", accent: CYAN }).rows[2].find(({ text }) => text === "lit-plan");
  assert.ok(name(1050), "subtle never splits the name into a moving light");
  assert.notEqual(name(1050).bg, name(1400).bg, "but it still fades in");

  const off = motionProfile("off");
  assert.equal(timelineBusy(advanceTimeline(createTimeline(before, 0, off), after, 1000, off), 1000, off), false);

  const dimmed = buildBandModel({ snapshot: lit(), now: NOW, skills: after.skills.map((chip) => ({ ...chip, state: "recent" })) });
  timeline = advanceTimeline(timeline, dimmed, 5000, full);
  assert.equal(timelineBusy(timeline, 5000 + TIMINGS.crossfade - 1, full), true, "the dim crossfades");
  const settled = composeBand(dimmed, sampleTimeline(timeline, 5000 + TIMINGS.crossfade, full), { columns: 90, glyphs: "basic", accent: CYAN });
  assert.match(rowText(settled.rows[2]), /↯ lit-plan/u);
});

test("the card takes the HUD accent: the same ten names and xterm colours as the status line", () => {
  assert.deepEqual(Object.entries(ACCENT_CODES), HUD_ACCENT_THEMES.map(({ name, code }) => [name, code]));
  assert.equal(xterm256Hex(81), CYAN);
  assert.equal(xterm256Hex(231), "#ffffff");
  assert.equal(xterm256Hex(245), "#8a8a8a");
  assert.equal(accentHex("rose"), "#ff0087");
  assert.equal(accentHex("unknown"), CYAN);
  const command = "LITCLAUDE_HUD_ACCENT=gold node \"/x/bin/litclaude-hud.js\"";
  assert.equal(accentFromSettings({ statusLine: { type: "command", command }, litclaude: { hudAccent: "rose" } }), "#ffd700", "the status line's own accent wins");
  assert.equal(accentFromSettings({ litclaude: { hudAccent: "rose" } }), "#ff0087");
  assert.equal(accentFromSettings({}, "green"), "#87ff00");
  assert.equal(accentFromSettings(null), CYAN);
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, skills: chips(["lit-plan"]) });
  const rose = composeBand(model, settledSample(model), { columns: 80, glyphs: "basic", accent: "#ff0087" });
  assert.equal(rose.rows[2].find(({ text }) => text === "lit-plan").bg, "#ff0087");
});

test("the git branch comes from HEAD, across a linked worktree, read-only", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-card-"));
  const io = {
    stat: async (path) => {
      try {
        const info = statSync(path);
        return { kind: info.isFile() ? "file" : "dir", size: info.size, isLink: false };
      } catch {
        return null;
      }
    },
    read: async (path) => readFileSync(path, "utf8"),
  };
  try {
    mkdirSync(join(tmp, "repo", ".git", "worktrees", "wt"), { recursive: true });
    mkdirSync(join(tmp, "repo", "src"), { recursive: true });
    writeFileSync(join(tmp, "repo", ".git", "HEAD"), "ref: refs/heads/main\n");
    assert.equal(await readGitBranch(io, join(tmp, "repo", "src")), "main");
    mkdirSync(join(tmp, "wt"));
    writeFileSync(join(tmp, "wt", ".git"), `gitdir: ${join(tmp, "repo", ".git", "worktrees", "wt")}\n`);
    writeFileSync(join(tmp, "repo", ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/feat/lit-humanizer\n");
    assert.equal(await readGitBranch(io, join(tmp, "wt")), "feat/lit-humanizer");
    writeFileSync(join(tmp, "repo", ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    assert.equal(await readGitBranch(io, join(tmp, "repo")), "0123456");
    assert.equal(await readGitBranch(io, tmpdir() === "/" ? "/nonexistent" : join(tmp, "elsewhere")), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// A stand-in for Claude Code's mods host: enough of `on` and `$` to drive the hooks module the way a
// session does, and an element table that records the drawn text.
const harness = async (options = {}) => {
  const hooks = [];
  const on = (event, matcher, hook) => {
    const entry = typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook };
    hooks.push(entry);
    return { catch: () => undefined };
  };
  register(on, options);
  let now = NOW;
  const timers = [];
  const $ = {
    fs: { stat: async () => null, read: async () => { throw new Error("ENOENT"); } },
    session: { cwd: async () => "/nowhere/project", id: async () => "card-session", usage: async () => usage },
    agent: { list: async () => [] },
    clock: { now: async () => now, after: (ms, fn) => timers.push(fn), every: () => () => undefined },
    env: { get: async () => undefined },
    settings: { read: async () => ({ statusLine: { type: "command", command: "LITCLAUDE_HUD_ACCENT=rose node hud.js" } }) },
    command: { register: async () => undefined },
    ui: { invalidate: () => undefined, toast: () => undefined, open: async () => undefined, resolve: () => elements },
  };
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: ({ children, color, backgroundColor }) => ({ kind: "text", text: children, color, backgroundColor }),
  };
  const fire = async (event, e, matcher = {}) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const run = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => run(index + 1, next)) : undefined);
    return run(0, e);
  };
  const flush = async () => {
    while (timers.length) await timers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const flatten = (node) => (node.kind === "text" ? [node] : node.children.flatMap(flatten));
  const band = async () => {
    const drawn = await fire("ui.render", { surface: "terminal", props: { bodyColumns: 80 } }, { component: "AbovePrompt" });
    if (!drawn || !drawn.children) return { lines: [], spans: [] };
    const rows = drawn.children.map((row) => flatten(row));
    return { lines: rows.map((row) => row.map(({ text }) => text).join("")), spans: rows.flat() };
  };
  return { fire, flush, band, tick: (ms) => { now += ms; } };
};

test("the mod lights a chip for a LitClaude Skill call or slash command and dims it when the turn completes", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.flush();
  let { lines } = await host.band();
  assert.equal(lines.length, 4, "the card is up before anything runs");
  assert.match(lines[0], /🔥 LIT {2}· ready/u);

  host.tick(1000);
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
  await host.fire("tool.call", { tool: "Skill", skill: "superpowers:brainstorming" });
  host.tick(1000);
  await host.fire("skill.prompt", { skill: "litclaude:litresearch", text: "body" });
  await host.flush();
  let spans;
  ({ lines, spans } = await host.band());
  assert.match(lines[2], /skills {2}⚡ litresearch {3}⚡ lit-plan/u);
  assert.match(lines[0], /🔥 LIT {2}· litresearch/u, "with no ignited discipline the title names the newest skill");
  assert.doesNotMatch(lines[2], /brainstorming/u);
  assert.equal(spans.find(({ text }) => text === "lit-plan").backgroundColor, "#ff0087", "chips take the accent the status line was installed with");

  host.tick(1000);
  await host.fire("turn.complete", { reason: "end" });
  await host.flush();
  ({ lines } = await host.band());
  assert.equal(lines.length, 4, "the card stays after the work ends");
  assert.match(lines[2], /skills {2}↯ litresearch {3}↯ lit-plan/u);
  assert.match(lines[0], /🔥 LIT {2}· litresearch ─+ idle/u);
});
