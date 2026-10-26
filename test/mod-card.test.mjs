import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { HUD_ACCENT_THEMES } from "../plugins/litclaude/lib/hud-accent-palette.mjs";
import { canonicalSkillIds } from "../plugins/litclaude/lib/canonical-skill-catalog.mjs";
import { CARD_MAX, composeBand, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { TIMINGS, lerpColor, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { ACCENT_CODES, accentFromSettings, accentHex, normalizeModSettings, xterm256Hex } from "../plugins/litclaude/lib/mod/settings.mjs";
import { LIT_SKILL_IDS, chipStates, litSkillId, noteSkill } from "../plugins/litclaude/lib/mod/skills.mjs";
import { readGitBranch, readLitSnapshot } from "../plugins/litclaude/lib/mod/state.mjs";
import { parseStageRecord } from "../plugins/litclaude/lib/mod/workflow.mjs";
import { recordWorkflowStage, runWorkflowStageCli, startWorkflowStage } from "../plugins/litclaude/lib/workflow-stage.mjs";
import { readStack } from "../plugins/litclaude/lib/workflow-stack.mjs";
import { advanceTimeline, ambientActive, createTimeline, sampleTimeline, settledSample, timelineBusy } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { AGENT_STALE_MS, STALL_MS, buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";
import { SVG_CARD, composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { TOAST_GAP_MS, gateToast, mergeToasts, statusChanges, statusOf } from "../plugins/litclaude/lib/mod/toasts.mjs";
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
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main", skills: chips(["lit-loop", "lit-docx", "lit-pptx"]) });
  assert.equal(model.idle, false);
  const frame = draw(model, 80);
  assert.equal(frame.rows.length, 5);
  for (const row of frame.rows) assert.equal(rowWidth(row), 80, rowText(row));
  const [top, map, detail, skills, bottom] = texts(frame);
  assert.match(top, /^╭─ {2}🔥 LIT {2}· lit-loop ─+ PIN ● ─╮$/u);
  assert.match(map, /^│ {2}PIN {2}━━ RED · ── GREEN · ── VERIFY · ── REVIEW · ── RECORD · +│$/u);
  assert.match(detail, /^│ └ criterion 2\/5 [ ░]+ · next ▸ criterion 3 +│$/u);
  assert.match(skills, /^│ skills {2}⚡ lit-loop {3}⚡ lit-docx {3}⚡ lit-pptx +│$/u);
  assert.match(bottom, /^╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · 1w 12% · git main ─+╯$/u);
  const name = frame.rows[3].find(({ text }) => text === "lit-docx");
  assert.equal(name.bg, CYAN, "a skill of this request is a pill on the HUD accent");
  assert.equal(name.bold, true);
  assert.ok(luminance(name.fg) < 0.2, "with dark text");
  const pin = frame.rows[1].find(({ text }) => text === "PIN");
  assert.equal(pin.bg, CYAN, "the current stage is a filled pill");
  assert.equal(pin.bold, true);
  assert.ok(luminance(pin.fg) < 0.2);
  const label = frame.rows[3].find(({ text }) => text.startsWith("skills"));
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
  assert.equal(frame.rows.length, 5);
  for (const row of frame.rows) assert.equal(rowWidth(row), 64);
  const [top, map, detail, skills] = texts(frame);
  assert.match(top, /^╭─ {2}🔥 LIT {2}· lit-loop ─+ idle ─╮$/u);
  assert.match(map, /^│ interview ✓ ━━ plan ✓ ━━ work ✓ ━━ review ✓ ━━ done ✓ +│$/u, "a met goal reads as the whole main chain done");
  assert.match(detail, /^│ └ complete +│$/u);
  assert.match(skills, /^│ skills {2}↯ lit-plan {3}↯ litresearch +│$/u);
  const recent = frame.rows[3].find(({ text }) => text === "lit-plan");
  assert.ok(recent.bg && recent.bg !== CYAN && luminance(recent.bg) < 0.25, "a skill from an earlier request is a muted dark pill");
  assert.ok(luminance(recent.fg) > 0.35, "with light grey text");
  const discipline = frame.rows[0].find(({ text }) => text === "lit-loop");
  assert.notEqual(discipline.bold, true, "the last discipline is shown quietly while idle");

  const fresh = draw(buildBandModel({ snapshot: idle(), now: NOW }), 64);
  assert.equal(fresh.rows.length, 5);
  assert.match(texts(fresh)[0], /^╭─ {2}🔥 LIT {2}· ready ─+ idle ─╮$/u);
  assert.match(texts(fresh)[1], /○ PLAN ━━ ○ WORK ━━ ○ REVIEW/u, "with nothing to place the session, the old track stays");
  assert.match(texts(fresh)[3], /no LitFamily skill yet/u);
});

test("too many chips collapse to +N and the narrow card drops git, then the rate window, never wrapping", () => {
  const many = ["lit-plan", "litresearch", "lit-docx", "lit-pptx", "review-work", "lit-humanizer", "deep-interview"];
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "feat/lit-humanizer", skills: chips(many) });
  const narrow = texts(draw(model, 44));
  assert.match(narrow[3], /\+\d+ +│$/u);
  assert.doesNotMatch(narrow[4], /git/u);
  assert.match(narrow[4], /ctx 42%/u);
  const tiny = texts(draw(model, 24));
  assert.doesNotMatch(tiny[4], /5h/u);
  assert.match(narrow[4], /5h 31% · 1w 12%/u, "both usage windows, as the status line shows them");
  assert.ok(CARD_MAX >= 110 && CARD_MAX <= 140, "the card spans a wide terminal but stops before it stretches thin");
  for (const columns of [20, 24, 44, 64, 100, 120, 160, 200]) {
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
          // Its two agents are two live threads, so the thread rows sit between the detail and the chips.
          assert.equal(frame.rows.length, 5 + model.threads.reserve);
          for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(columns, CARD_MAX), `${glyphs} ${columns} t=${t}: "${rowText(row)}"`);
        }
      }
    }
  }
});

test("a warning turns the border amber or red and takes the bottom edge", () => {
  const stalled = buildBandModel({ snapshot: lit(), agents: [{ id: "a1", status: "running", name: "demo-gif" }], activity: { last: { a1: NOW - 12 * 60_000 }, first: {} }, now: NOW, usage });
  const frame = draw(stalled, 80);
  assert.equal(frame.border, "#ffaf3c");
  assert.match(texts(frame)[4], /^╰─ ⚠ demo-gif quiet for 12m/u);
  assert.equal(frame.rows[1][0].fg, "#ffaf3c", "the side edges take the border colour");
  const failed = buildBandModel({ snapshot: lit({ probe: { editAt: 10, probeAt: null, issue: "a HIGH finding remains", issueAt: 12, paths: [], blockCount: 1 } }), now: NOW });
  assert.equal(draw(failed, 80).border, "#ff5f5f");
});

test("notices and the completion moment play in the chips row without changing the height", () => {
  const notice = { id: "n1", tone: "pink", title: "lit-plan is not saved yet", detail: "stop 1/2" };
  const noticed = draw(buildBandModel({ snapshot: lit(), now: NOW, notice, skills: chips(["lit-plan"]) }), 90);
  assert.equal(noticed.rows.length, 5);
  assert.match(texts(noticed)[3], /^│ ▎ 🔥 lit-plan is not saved yet {2}· stop 1\/2 +│$/u);
  const finished = buildBandModel({ snapshot: lit(), now: NOW, completion: { id: "c", detail: "goal met · 5/5 criteria" } });
  const quiet = composeBand(finished, sampleTimeline(createTimeline(finished, 0, motionProfile("subtle")), 400, motionProfile("subtle")), { columns: 90, glyphs: "basic", accent: CYAN });
  assert.match(texts(quiet)[3], /^│ ✦ COMPLETE · goal met · 5\/5 criteria +│$/u);
  assert.match(texts(quiet)[0], /DONE ✓ ─╮$/u);
});

test("pills: rounded caps in the pill colour with Nerd glyphs, one cell of padding with basic, same widths", () => {
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main", skills: chips(["lit-loop", "lit-docx"], ["lit-plan", "lit-pptx", "review-work", "lit-humanizer", "deep-interview", "lit-init"]) });
  const nerd = draw(model, 64, "nerd");
  const basic = draw(model, 64, "basic");
  for (const frame of [nerd, basic]) for (const row of frame.rows) assert.equal(rowWidth(row), 64, rowText(row));
  const caps = (row) => row.filter(({ text }) => text === "\ue0b6" || text === "\ue0b4");
  const [top, map, , skills] = nerd.rows;
  for (const row of [top, map, skills]) assert.ok(caps(row).length >= 2, `nerd pills have caps: ${rowText(row)}`);
  const pin = map.findIndex(({ text }) => text === "PIN");
  assert.equal(map[pin - 1].text, "\ue0b6");
  assert.equal(map[pin - 1].fg, map[pin].bg, "the left cap takes the pill colour on the terminal background");
  assert.equal(map[pin - 1].bg, undefined);
  assert.equal(map[pin + 1].text, "\ue0b4");
  assert.equal(map[pin + 1].fg, CYAN);
  assert.match(rowText(map), /\ue0b6PIN\ue0b4 ━+ RED · /u);
  for (const row of basic.rows) assert.equal(caps(row).length, 0, "basic needs no icon font");
  const plain = basic.rows[1].findIndex(({ text }) => text === "PIN");
  assert.deepEqual([basic.rows[1][plain - 1], basic.rows[1][plain + 1]].map(({ text, bg }) => [text, bg]), [[" ", CYAN], [" ", CYAN]], "basic pads the pill with one cell of its colour");
  assert.match(rowText(basic.rows[1]), /^│ {2}PIN {2}━+ RED · /u);
  const brand = basic.rows[0].filter(({ bg }) => bg === "#ff2d95");
  assert.equal(brand.map(({ text }) => text).join(""), " 🔥 LIT ", "the brand is a small pink pill");
  const overflow = basic.rows[3].find(({ text }) => /^\+\d+$/u.test(text));
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

test("the chip history keeps the twelve newest skills, so a busy request still has older chips to fold into +N", () => {
  let fired = [];
  for (let i = 0; i < 14; i += 1) fired = noteSkill(fired, canonicalSkillIds[i], 10_000 + i * 5000);
  assert.deepEqual(fired.map(({ id }) => id), canonicalSkillIds.slice(2, 14).reverse());
});

test("a chip that fired at the very moment the request settled is already recent", () => {
  assert.deepEqual(chipStates([{ id: "a", at: 2000 }, { id: "b", at: 2001 }], 2000).map(({ id, state }) => `${id}:${state}`), ["b:current", "a:recent"]);
});

test("a chip shimmers on arrival in full motion, fades in under subtle, and dims when the turn completes", () => {
  const before = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, skills: chips(["litresearch"]) });
  const after = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, skills: [{ id: "lit-plan", at: NOW + 5, state: "current" }, ...chips(["litresearch"])] });
  const colours = (timeline, t, profile) => composeBand(after, sampleTimeline(timeline, t, profile), { columns: 90, glyphs: "basic", accent: CYAN })
    .rows[3].filter(({ text }) => /^[a-z-]$/u.test(text) || text === "lit-plan").map(({ bg }) => bg).join(",");
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
  const name = (t) => composeBand(after, sampleTimeline(soft, t, subtle), { columns: 90, glyphs: "basic", accent: CYAN }).rows[3].find(({ text }) => text === "lit-plan");
  assert.ok(name(1050), "subtle never splits the name into a moving light");
  assert.notEqual(name(1050).bg, name(1400).bg, "but it still fades in");

  const off = motionProfile("off");
  assert.equal(timelineBusy(advanceTimeline(createTimeline(before, 0, off), after, 1000, off), 1000, off), false);

  const dimmed = buildBandModel({ snapshot: lit(), now: NOW, skills: after.skills.map((chip) => ({ ...chip, state: "recent" })) });
  timeline = advanceTimeline(timeline, dimmed, 5000, full);
  assert.equal(timelineBusy(timeline, 5000 + TIMINGS.crossfade - 1, full), true, "the dim crossfades");
  const settled = composeBand(dimmed, sampleTimeline(timeline, 5000 + TIMINGS.crossfade, full), { columns: 90, glyphs: "basic", accent: CYAN });
  assert.match(rowText(settled.rows[3]), /↯ lit-plan/u);
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
  assert.equal(rose.rows[3].find(({ text }) => text === "lit-plan").bg, "#ff0087");
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
const harness = async (options = {}, agents = [], files = new Map(), { client = false } = {}) => {
  const hooks = [];
  const on = (event, matcher, hook) => {
    const entry = typeof matcher === "function" ? { event, matcher: {}, hook: matcher } : { event, matcher, hook };
    hooks.push(entry);
    return { catch: () => undefined };
  };
  register(on, options);
  let now = NOW;
  const timers = [];
  const notified = [];
  const played = [];
  const invalidations = [];
  const polls = [];
  const toasts = [];
  const delays = [];
  const roster = ["terminal"];
  const $ = {
    fs: {
      stat: async (path) => (files.has(path) ? { kind: "file", size: files.get(path).length, isLink: false } : null),
      read: async (path) => {
        if (!files.has(path)) throw new Error("ENOENT");
        return files.get(path);
      },
    },
    session: { cwd: async () => "/nowhere/project", id: async () => "card-session", usage: async () => usage, surfaces: async () => [...roster] },
    agent: { list: async () => agents },
    clock: { now: async () => now, after: (ms, fn) => { delays.push(ms); timers.push(fn); }, every: (ms, fn) => { polls.push(fn); return () => undefined; } },
    env: { get: async () => undefined },
    settings: { read: async () => ({ statusLine: { type: "command", command: "LITCLAUDE_HUD_ACCENT=rose node hud.js" } }) },
    command: { register: async () => undefined },
    ui: {
      invalidate: (what) => { invalidations.push(what); },
      toast: (text) => { toasts.push(text); },
      open: async () => undefined,
      resolve: () => elements,
      notify: async (text, notifyOptions) => {
        notified.push({ text, ...notifyOptions });
        return { isSent: true, channel: "terminal" };
      },
    },
    audio: { play: async (clip) => { played.push(clip); } },
  };
  const elements = {
    Box: ({ children = [] }) => ({ kind: "box", children }),
    Text: ({ children, color, backgroundColor }) => ({ kind: "text", text: children, color, backgroundColor }),
    Svg: (props) => ({ kind: "svg", ...props }),
    ...(client ? { Client: (props) => ({ kind: "client", ...props }) } : {}),
  };
  const fire = async (event, e, matcher = {}, core = undefined) => {
    const chain = hooks.filter((entry) => entry.event === event && Object.entries(matcher).every(([key, value]) => entry.matcher[key] === value));
    const run = async (index, input) => (index < chain.length ? chain[index].hook($, input, (next) => run(index + 1, next)) : core);
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
  const drawOn = (surface) => fire("ui.render", { surface, props: { bodyColumns: 80 } }, { component: "AbovePrompt" });
  // A streaming event's hook is a generator over the stream beneath; `core` stands for that stream.
  const stream = (event, e, core) => hooks.find((entry) => entry.event === event).hook($, e, () => core);
  // The session's every-two-seconds poll, as the host's clock fires it.
  const poll = async () => {
    for (const fn of polls) fn();
    await flush();
  };
  return { fire, stream, flush, band, drawOn, poll, invalidations, roster, notified, played, toasts, delays, tick: (ms) => { now += ms; } };
};

test("the mod lights a chip for a LitClaude Skill call or slash command and dims it when the turn completes", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.flush();
  let { lines } = await host.band();
  assert.equal(lines.length, 5, "the card is up before anything runs");
  assert.match(lines[0], /🔥 LIT {2}· ready/u);

  host.tick(1000);
  await host.fire("turn.start", {});
  // A typed `/litclaude:litresearch` expands before the turn's first tool call.
  await host.fire("skill.prompt", { skill: "litclaude:litresearch", text: "body" });
  host.tick(1000);
  await host.fire("tool.call", { tool: "Skill", skill: "superpowers:brainstorming" });
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
  await host.flush();
  let spans;
  ({ lines, spans } = await host.band());
  assert.match(lines[3], /skills {2}⚡ lit-plan {3}⚡ litresearch/u);
  assert.match(lines[0], /🔥 LIT {2}· lit-plan/u, "with no ignited discipline the title names the newest skill");
  assert.doesNotMatch(lines[3], /brainstorming/u);
  assert.equal(spans.find(({ text }) => text === "litresearch").backgroundColor, "#ff0087", "chips take the accent the status line was installed with");

  host.tick(1000);
  await host.fire("turn.complete", { reason: "end" });
  await host.flush();
  ({ lines } = await host.band());
  assert.equal(lines.length, 5, "the card stays after the work ends");
  assert.match(lines[3], /skills {2}↯ lit-plan {3}↯ litresearch/u);
  assert.match(lines[0], /🔥 LIT {2}· lit-plan ─+ idle/u);
});

// A workflow script's agents never appear in `$.agent.list()`; `agent.spawn` names them and their
// own `turn.complete` (carrying `agentId`) ends them.
const spawnWorkflowAgent = (host, agentId, description = "sleep probe") => host.fire(
  "agent.spawn",
  { tool_use_id: "toolu_wf", prompt: "Run the tests.", description, subagentType: "general-purpose", background: true, fork: false, workflow: { runId: "wf_probe", agentIndex: 1 } },
  {},
  { model: "claude-opus-5-5", agentId },
);

test("the card stays at work while a background agent runs after the main turn, and settles when the last one ends", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "run it", turnId: "t1" });
  await spawnWorkflowAgent(host, "wf-agent-1");
  await spawnWorkflowAgent(host, "wf-agent-2", "lint");
  host.tick(1000);
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "Started.", durationMs: 1000, isAborted: false });
  await host.flush();
  let { lines } = await host.band();
  assert.doesNotMatch(lines[0], /idle|DONE/u, "two agents still run, so the card is not idle");
  assert.match(lines[0], /LIVE/u);
  assert.match(lines[1], /2 lanes/u, "the phase row counts the running agents");

  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "done", durationMs: 9000, isAborted: false, agentId: "wf-agent-1" });
  await host.flush();
  ({ lines } = await host.band());
  assert.match(lines[0], /LIVE/u, "one agent is left");
  assert.match(lines[1], /1 lane\b/u);

  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "done", durationMs: 9000, isAborted: false, agentId: "wf-agent-2" });
  await host.flush();
  ({ lines } = await host.band());
  assert.match(lines[0], /─ idle ─╮/u, "the last agent ended, so the card settles");
  assert.doesNotMatch(lines[1], /lane/u);
});

test("a subagent's turn ending inside the main turn neither idles the card nor dims this request's chips", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  host.tick(1000);
  await host.fire("turn.start", { text: "plan it", turnId: "t1" });
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
  await spawnWorkflowAgent(host, "helper-1");
  host.tick(1000);
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "report", durationMs: 1000, isAborted: false, agentId: "helper-1" });
  await host.flush();
  const { lines } = await host.band();
  assert.match(lines[3], /skills {2}⚡ lit-plan/u, "the chip stays bright: the request is still running");
  assert.doesNotMatch(lines[0], /idle/u);
});

test("an agent that never reports back cannot pin the card: it is dropped once it has been quiet past the stale limit", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "go", turnId: "t1" });
  await spawnWorkflowAgent(host, "lost-1");
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "Started.", durationMs: 1000, isAborted: false });
  host.tick(AGENT_STALE_MS / 2);
  await host.fire("tool.call", { tool: "Bash", agentId: "lost-1" });
  host.tick(AGENT_STALE_MS / 2);
  await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
  await host.flush();
  let { lines } = await host.band();
  assert.match(lines[1], /1 lane\b/u, "a tool call from the agent keeps it alive");

  host.tick(AGENT_STALE_MS + 1000);
  await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
  await host.flush();
  ({ lines } = await host.band());
  assert.match(lines[0], /─ idle ─╮/u, "quiet past the stale limit, the agent no longer holds the card");
});

test("an agent the host lists as ended is not counted, even before its turn.complete arrives", async () => {
  const listed = [];
  const host = await harness({ glyphs: "basic", motion: "off" }, listed);
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "go", turnId: "t1" });
  await host.fire("agent.spawn", { tool_use_id: "toolu_a", prompt: "x", description: "review", subagentType: "general-purpose", background: true, fork: false }, {}, { model: "m", agentId: "bg-1" });
  listed.push({ id: "bg-1", description: "review", type: "general-purpose", status: "running" });
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "Started.", durationMs: 1000, isAborted: false });
  await host.flush();
  let { lines } = await host.band();
  assert.match(lines[1], /1 lane\b/u, "the listed agent and its spawn record count once");
  listed[0] = { ...listed[0], status: "completed" };
  await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
  await host.flush();
  ({ lines } = await host.band());
  assert.match(lines[0], /─ idle ─╮/u);
});

test("the top edge never reads DONE while an agent is still running", () => {
  const model = buildBandModel({
    snapshot: lit({ goal: goalOf(5, 5, "complete") }),
    agents: [{ id: "a", description: "reviewer", type: "general-purpose", status: "running" }],
    now: NOW,
  });
  assert.doesNotMatch(texts(draw(model, 80))[0], /DONE/u, "the goal is met but a lane still works");
  assert.match(texts(draw(model, 80))[0], /LIVE/u);
  const settled = buildBandModel({ snapshot: lit({ goal: goalOf(5, 5, "complete") }), now: NOW, isWorking: true });
  assert.match(texts(draw(settled, 80))[0], /DONE/u, "with no lane left the finished goal reads DONE");
});

test("while LitClaude works the card keeps moving: the brand breathes, a light sweeps the phase pill, a comet runs the rules", () => {
  const full = motionProfile("full");
  const model = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main", skills: chips(["lit-loop"]) });
  const timeline = createTimeline(model, 0, full);
  const settled = 2000;
  assert.equal(timelineBusy(timeline, settled, full), false, "the entry transitions have settled");
  assert.equal(ambientActive(timeline, full), true, "but the ambient loop keeps running while work is live");
  const at = (t) => composeBand(model, sampleTimeline(timeline, t, full), { columns: 80, glyphs: "basic", accent: CYAN });
  const brandFill = (frame) => frame.rows[0].find(({ text }) => text.includes("LIT")).bg;
  const fills = new Set([0, 300, 600, 900, 1200].map((dt) => brandFill(at(settled + dt))));
  assert.ok(fills.size >= 3, `the brand pill breathes through several colours, saw ${[...fills]}`);
  const sweeps = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600].map((dt) => at(settled + dt).rows[1].filter(({ text, bg }) => /^[PIN]$/u.test(text) && bg && bg !== CYAN).length);
  assert.ok(sweeps.some((n) => n > 0), "a light crosses the current stage's pill at some point of the loop");
  const chipLight = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600].some((dt) => at(settled + dt).rows[3].some(({ text, bg }) => text.length === 1 && /[a-z-]/u.test(text) && bg && bg !== CYAN));
  assert.ok(chipLight, "and over this request's skill chip");
  const ruleColours = (frame, row) => frame.rows[row].filter(({ text }) => /^─+$/u.test(text)).map(({ fg }) => fg);
  const loop = TIMINGS.comet;
  assert.ok(new Set(ruleColours(at(2 * loop + loop * 0.25), 0)).size >= 2, "a quarter into its loop the comet lights the top rule");
  assert.equal(new Set(ruleColours(at(2 * loop + loop * 0.25), 4)).size, 1, "and leaves the bottom rule alone");
  assert.ok(new Set(ruleColours(at(2 * loop + loop * 0.75), 4)).size >= 2, "three quarters in it runs back along the bottom rule");
  for (const dt of [0, 500, 1000, 1500]) for (const row of at(settled + dt).rows) assert.equal(rowWidth(row), 80, "ambient motion never changes the card's width");
});

test("ambient motion stops when the card is idle, is breath-only under subtle and absent with motion off", () => {
  const full = motionProfile("full");
  const resting = buildBandModel({ snapshot: idle(), now: NOW, usage, git: "main" });
  assert.equal(resting.idle, true);
  const quiet = createTimeline(resting, 0, full);
  assert.equal(ambientActive(quiet, full), false, "an idle card stays still so motion means work");
  const frameAt = (model, timeline, profile, t) => JSON.stringify(composeBand(model, sampleTimeline(timeline, t, profile), { columns: 80, glyphs: "basic", accent: CYAN }));
  assert.equal(frameAt(resting, quiet, full, 3000), frameAt(resting, quiet, full, 3700));

  const working = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main" });
  const subtle = motionProfile("subtle");
  const soft = createTimeline(working, 0, subtle);
  assert.equal(ambientActive(soft, subtle), true);
  const soft1 = composeBand(working, sampleTimeline(soft, 2100, subtle), { columns: 80, glyphs: "basic", accent: CYAN });
  assert.equal(new Set(soft1.rows[0].filter(({ text }) => /^─+$/u.test(text)).map(({ fg }) => fg)).size, 1, "subtle runs no comet");
  assert.notEqual(frameAt(working, soft, subtle, 2000), frameAt(working, soft, subtle, 2900), "but the brand still breathes");

  const off = motionProfile("off");
  const still = createTimeline(working, 0, off);
  assert.equal(ambientActive(still, off), false);
  assert.equal(frameAt(working, still, off, 2000), frameAt(working, still, off, 2900));
  assert.equal(settledSample(working).ambient, null, "the static fallback draws one still frame");

  const finished = advanceTimeline(createTimeline(working, 0, full), resting, 5000, full);
  assert.equal(ambientActive(finished, full), false, "the loop ends with the work");
});

test("the surface module keeps a slower timer running through work and stops it once the card idles", async () => {
  const { default: LitBand } = await import("../plugins/litclaude/hooks/lit-band-client.mjs");
  const timers = [];
  const surface = {
    state: undefined,
    elements: { Box: (props) => ({ type: "Box", props }), Text: (props) => ({ type: "Text", props }) },
    every: (ms, fn) => {
      const timer = { ms, fn, stopped: false };
      timers.push(timer);
      return () => { timer.stopped = true; };
    },
    setState(next) { this.state = { ...this.state, ...next }; },
  };
  const running = () => timers.filter((timer) => !timer.stopped);
  const tick = (n) => { for (let i = 0; i < n; i += 1) for (const timer of running()) timer.fn(); };
  const working = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main" });
  const props = { model: working, columns: 80, glyphs: "basic", motion: "full", accent: CYAN };
  LitBand(props, surface);
  assert.equal(running().length, 1);
  assert.equal(running()[0].ms, TIMINGS.frame, "transitions run on the fast frame");
  tick(120);
  assert.equal(running().length, 1, "after the entry settles a timer still runs while work is live");
  assert.equal(running()[0].ms, TIMINGS.ambientFrame, "on the slower ambient frame");
  const resting = buildBandModel({ snapshot: idle(), now: NOW, usage, git: "main" });
  LitBand({ ...props, model: resting }, surface);
  tick(120);
  assert.equal(running().length, 0, "an idle card stops every timer");
});

const svgModel = (overrides = {}) => ({
  visible: true, idle: false, title: "lit-loop", phases: { plan: "done", work: "now", review: "todo" },
  progress: { done: 2, total: 5, unit: "tasks" }, lanes: { count: 1, list: [] }, autoloop: null, ctxWarning: null, warnings: [], goal: null,
  skills: [{ id: "lit-loop", state: "current" }, { id: "litresearch", state: "recent" }],
  figures: { context: 42, rates: [{ label: "5h", percent: 31 }, { label: "1w", percent: 12 }], git: "main" },
  notice: null, completion: null, next: null, ...overrides,
});

test("the SVG card carries the same rows as the terminal card and stays inside the Svg limit", () => {
  const { source, alt, animated } = composeSvgCard(svgModel(), { accent: "#ff0087" });
  assert.match(source, /^<svg [^>]*width="880" height="160"/u);
  assert.ok(source.length < 131072);
  assert.doesNotMatch(source, /<script|\son[a-z]+=/iu, "no script or handler attributes");
  for (const words of ["LIT", "lit-loop", "WORK", "REVIEW", "litresearch", "tasks", "5h", "31%", "1w", "12%", "main"]) assert.ok(source.includes(`>${words}`) || source.includes(words), words);
  assert.match(alt, /LIT working · lit-loop · phase WORK · skills lit-loop, litresearch · context 42% · 5h 31% · 1w 12%/u);
  assert.equal(animated, true);
  assert.equal(SVG_CARD.width, 880);
});

test("the SVG card moves only while LitClaude works, and as much as the motion setting allows", () => {
  const full = composeSvgCard(svgModel(), { motion: "full" }).source;
  assert.match(full, /attributeName="stroke-dashoffset"/u, "full: the comet runs around the border");
  assert.match(full, /lit-sweep/u, "full: a light crosses the active phase and this request's chips");
  assert.match(full, /attributeName="opacity" values="0;0.85;0"/u, "full: the brand pill breathes");
  const subtle = composeSvgCard(svgModel(), { motion: "subtle" }).source;
  assert.match(subtle, /values="0;0.85;0"/u, "subtle keeps the breathing");
  assert.doesNotMatch(subtle, /stroke-dashoffset|lit-sweep/u, "subtle drops the comet and the light");
  for (const still of [composeSvgCard(svgModel(), { motion: "off" }), composeSvgCard(svgModel({ idle: true }), { motion: "full" })]) {
    assert.doesNotMatch(still.source, /<animate/u);
    assert.equal(still.animated, false);
  }
});

test("on the desktop surface the mod draws the card as one Svg, and keeps the cell card for the terminal", async () => {
  const host = await harness({ glyphs: "basic", motion: "full" });
  await host.fire("session.start", {});
  await host.flush();
  const idle = await host.drawOn("desktop");
  assert.equal(idle.kind, "svg");
  assert.match(idle.alt, /^LIT idle/u);
  assert.equal(idle.isInteractive, undefined, "an idle card is a still image");
  assert.notEqual((await host.drawOn("terminal")).kind, "svg");

  host.tick(1000);
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
  await host.flush();
  const working = await host.drawOn("desktop");
  assert.equal(working.kind, "svg");
  assert.equal(working.isInteractive, true, "a moving card is drawn in the sandboxed frame so SMIL runs");
  assert.match(working.source, /lit-plan/u);
});

// Each looping animation of a drawing: what it moves, its values, and how far into its cycle it opens.
const loopsOf = (source) => [...source.matchAll(/<(animate|animateTransform|animateMotion)\b([^>]*)>/gu)].map(([, tag, attrs]) => {
  const attr = (name) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "u"))?.[1];
  const dur = Number.parseFloat(attr("dur"));
  const begin = attr("begin");
  return { tag, name: attr("attributeName"), values: attr("values").split(";").map((v) => v.trim()), begin, phase: begin ? -Number.parseFloat(begin) / dur : 0 };
});
// The value a loop shows at `phase`, its values spread evenly over the cycle.
const valueAt = (values, phase) => {
  const at = phase * (values.length - 1);
  const i = Math.min(values.length - 2, Math.floor(at));
  const [a, b] = [Number.parseFloat(values[i]), Number.parseFloat(values[i + 1])];
  return a + (b - a) * (at - i);
};

test("the desktop's moving card opens every loop mid-cycle, already visible, so a fresh load never starts dim or with the comet at the corner", async () => {
  const host = await harness({ glyphs: "basic", motion: "full" });
  await host.fire("session.start", {});
  await host.flush();
  host.tick(1000);
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
  await host.flush();
  const desktop = await host.drawOn("desktop");
  assert.equal(desktop.kind, "svg");
  assert.equal(desktop.isInteractive, true);
  const extra = composeSvgCard(svgModel({ step: { name: "WebSearch", elapsedMs: 0 } }), { motion: "full", accent: CYAN }).source;
  const loops = [...loopsOf(desktop.source), ...loopsOf(extra)];
  for (const name of ["opacity", "stroke-opacity", "stroke-dashoffset", "gradientTransform", "transform"]) {
    assert.ok(loops.some((loop) => loop.name === name), `the card animates ${name}`);
  }
  for (const loop of loops) {
    const label = `${loop.tag} ${loop.name} values=${loop.values.join(";")} begin=${loop.begin}`;
    assert.match(loop.begin ?? "", /^-\d+ms$/u, `${label}: opens with a negative begin`);
    assert.ok(loop.phase > 0 && loop.phase < 1, `${label}: opens mid-cycle, not on its first frame`);
    if (/opacity$/u.test(loop.name)) assert.ok(valueAt(loop.values, loop.phase) > 0, `${label}: opens visible, never at opacity 0`);
  }
  const comet = loops.find((loop) => loop.name === "stroke-dashoffset");
  assert.notEqual(valueAt(comet.values, comet.phase), 0, "the comet opens part way round the border, not parked at the top-left");
  const sweep = loops.find((loop) => loop.name === "gradientTransform");
  assert.ok(Math.abs(valueAt(sweep.values.map((v) => v.split(" ")[0]), sweep.phase)) < 1, "the light opens over its pill, not off its edge");
  const frame = loops.find((loop) => loop.name === "stroke-opacity");
  assert.ok(valueAt(frame.values, frame.phase) > 0.45, "the border opens brighter than its dimmest breath");
});

test("while only the clock moves, the desktop card is not redrawn: no invalidation, the same SVG source", async () => {
  const host = await harness({ glyphs: "basic", motion: "full" });
  await host.fire("session.start", {});
  await host.flush();
  host.tick(1000);
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-loop" }, {}, {});
  await host.flush();
  let release;
  const call = host.fire("tool.call", { tool: "WebSearch" }, {}, new Promise((resolve) => { release = resolve; }));
  await host.flush();
  const first = await host.drawOn("desktop");
  assert.match(first.source, />WebSearch</u);
  assert.equal(first.isInteractive, true);
  host.invalidations.length = 0;
  for (let i = 0; i < 5; i += 1) {
    host.tick(2000);
    await host.poll();
    assert.equal((await host.drawOn("desktop")).source, first.source, `poll ${i + 1}: the drawing is byte-identical`);
  }
  assert.deepEqual(host.invalidations, [], "a poll that changes nothing but the clock leaves the desktop frame alone");
  assert.doesNotMatch(first.source, /\b\d+:\d\d\b/u, "the desktop card carries no running clock");

  release({});
  await call;
  await host.flush();
  assert.ok(host.invalidations.length > 0, "a new step is a real change and redraws");
  const after = await host.drawOn("desktop");
  assert.notEqual(after.source, first.source);
  assert.match(after.source, />thinking</u);
  assert.doesNotMatch(after.source, />WebSearch</u);
});

test("the terminal card keeps its live clock: each poll still redraws it", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.fire("turn.start", {});
  const call = host.fire("tool.call", { tool: "WebSearch" }, {}, new Promise(() => undefined));
  await host.flush();
  assert.match((await host.band()).lines[2], /WebSearch · 0:00 │$/u);
  host.invalidations.length = 0;
  host.tick(2000);
  await host.poll();
  assert.ok(host.invalidations.length > 0, "the terminal card is redrawn as its clock moves");
  assert.match((await host.band()).lines[2], /WebSearch · 0:02 │$/u);
  void call;
});

// A session drawn on the terminal and on a remote desktop at once: one invalidation redraws both.
const heldWebSearch = async (hostExtras) => {
  const host = await harness({ glyphs: "basic", motion: "full" }, [], new Map(), hostExtras);
  await host.fire("session.start", {});
  await host.flush();
  host.tick(1000);
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-loop" }, {}, {});
  await host.flush();
  let release;
  const call = host.fire("tool.call", { tool: "WebSearch" }, {}, new Promise((resolve) => { release = resolve; }));
  await host.flush();
  return { host, release, call };
};
const clockOnlyPolls = async (host, surfaces, n = 5) => {
  host.invalidations.length = 0;
  const sources = new Set();
  for (let i = 0; i < n; i += 1) {
    host.tick(2000);
    await host.poll();
    for (const surface of surfaces) {
      const drawn = await host.drawOn(surface);
      if (drawn?.kind === "svg") sources.add(drawn.source);
    }
  }
  return { invalidations: host.invalidations.length, sources: sources.size };
};

test("with the terminal's surface module and a desktop both attached, a clock-only poll redraws neither", async () => {
  const { host, release, call } = await heldWebSearch({ client: true });
  host.roster.push("desktop");
  assert.equal((await host.drawOn("terminal")).kind, "client");
  const first = await host.drawOn("desktop");
  assert.deepEqual(await clockOnlyPolls(host, ["terminal", "desktop"]), { invalidations: 0, sources: 1 }, "the surface module counts the clock on by itself");
  release({});
  await call;
  await host.flush();
  assert.ok(host.invalidations.length > 0, "a new step still redraws both");
  assert.notEqual((await host.drawOn("desktop")).source, first.source);
});

test("a terminal that drew once does not keep the desktop redrawing, and a desktop that detaches gives the terminal its clock back", async () => {
  const { host } = await heldWebSearch();
  host.roster.push("desktop");
  await host.drawOn("terminal");
  await host.drawOn("desktop");
  assert.deepEqual(await clockOnlyPolls(host, ["desktop"]), { invalidations: 0, sources: 1 }, "while a desktop shows the card, time alone never re-delivers it");
  host.roster.pop();
  await host.fire("session.detach", { surface: "desktop", clientId: "desktop:default", reason: "detach" }, {}, { clientId: "desktop:default" });
  host.invalidations.length = 0;
  host.tick(2000);
  await host.poll();
  assert.ok(host.invalidations.length > 0, "the terminal alone gets its clock redrawn again");
  assert.match((await host.band()).lines[2], /WebSearch · 0:1\d │$/u);
});

test("the SVG card leaves out the step clock and the loop countdown, so time alone never changes its source", () => {
  const at = (elapsedMs, leftMs, n = 2) => composeSvgCard(svgModel({ step: { name: "WebSearch", elapsedMs }, autoloop: { n, max: 5, leftMs } }), { accent: CYAN });
  const early = at(2000, 600_000);
  const later = at(9000, 540_000);
  assert.equal(later.source, early.source);
  assert.equal(later.alt, early.alt);
  assert.match(early.source, />WebSearch</u);
  assert.match(early.source, />↻ 2\/5</u, "the loop count stays");
  assert.doesNotMatch(early.source, /0:0\d|\b\d+m\b|\b\d+s\b/u, "no clock or countdown");
  assert.notEqual(at(9000, 540_000, 3).source, early.source, "a new loop round still changes the drawing");
});

// The workflow map: one snapshot per family, as the state files and hooks leave them.
const MAP_COLUMNS = 100;
const atWork = (checked = 3) => ({ ignition: { discipline: "start-work", at: NOW - 5000 }, work: { id: "w1", status: "active", planName: "demo.md", total: 7, checked, nextTask: "4. README demo GIF", lanes: [], lastEvent: null } });
const recorded = (fields) => ({ record: { step: fields.stage, n: null, total: null, unit: null, verdicts: {}, at: NOW - 1000, ...fields } });
const flowModel = (snapshot, extra = {}) => buildBandModel({ snapshot: { ...idle(), ...snapshot }, now: NOW, isWorking: true, usage, git: "main", ...extra });
const FAMILY_CASES = [
  {
    name: "main · work",
    snapshot: atWork(),
    top: /WORK ● ─╮$/u,
    map: /^│ interview ✓ ━━ plan ✓ ━━ {2}work 3\/7 {2}━━ review · ── done · +│$/u,
    detail: /^│ └ task 3\/7 [ ░]{8} · next ▸ 4\. README demo GIF +│$/u,
    svg: ["work 3/7", "review ·", "task", "4. README demo GIF"],
  },
  {
    name: "main · interview",
    snapshot: { ignition: { discipline: "deep-interview", at: NOW - 5000 }, workflow: { interview: { active: true, round: 3, max: 12, ambiguity: 0.42, threshold: 0.2, at: NOW - 1000 } } },
    top: /INTERVIEW ● ─╮$/u,
    map: /^│ {2}interview {2}━━ plan · ── work · ── review · ── done · +│$/u,
    detail: /^│ └ round 3\/12 · ambiguity 42% → 20% +│$/u,
    svg: ["interview", "round 3/12", "ambiguity 42% → 20%"],
  },
  {
    name: "main · plan",
    snapshot: { ignition: { discipline: "lit-plan", at: NOW - 5000 }, workflow: { draft: { slug: "demo", status: "awaiting-approval", at: NOW - 1000 } } },
    top: /PLAN ● ─╮$/u,
    map: /^│ interview ✓ ━━ {2}plan {2}━━ work · ── review · ── done · +│$/u,
    detail: /^│ └ awaiting approval +│$/u,
    svg: ["plan", "awaiting approval"],
  },
  {
    name: "main · crucible",
    snapshot: { ignition: { discipline: "lit-crucible", at: NOW - 5000 }, workflow: recorded({ family: "main", stage: "plan", verdicts: { crucible: "pass" } }) },
    map: /^│ interview ✓ ━━ {2}plan {2}━━ work · /u,
    detail: /^│ └ crucible ✓ +│$/u,
    svg: ["crucible ✓"],
  },
  {
    name: "main · review",
    snapshot: { ignition: { discipline: "review-work", at: NOW - 5000 }, workflow: recorded({ family: "main", stage: "review", verdicts: { goal: "pass", tests: "fail", security: "running" } }) },
    top: /REVIEW 2\/5 ─╮$/u,
    map: /^│ interview ✓ ━━ plan ✓ ━━ work ✓ ━━ {2}review {2}━━ done · +│$/u,
    detail: /^│ └ goal ✓ quality · security ● qa ✗ context · +│$/u,
    svg: ["goal ✓", "qa ✗", "security ●", "context ·"],
  },
  {
    name: "main · autoresearch iterations",
    snapshot: { ignition: { discipline: "autoresearch", at: NOW - 5000 }, workflow: recorded({ family: "main", stage: "work", n: 3, total: 8, unit: "iteration" }) },
    map: /━━ {2}work 3\/8 {2}━━/u,
    detail: /^│ └ iteration 3\/8 [ ░]{8} +│$/u,
    svg: ["work 3/8", "iteration"],
  },
  {
    name: "research",
    snapshot: { ignition: { discipline: "litresearch", at: NOW - 5000 }, workflow: { research: { slug: "s1", wave: 2, digests: 7, verified: 0, synthesis: false, at: NOW - 1000 } } },
    top: /EXPAND ● ─╮$/u,
    map: /^│ decompose ✓ ━━ wave 2 ✓ ━━ {2}expand {2}━━ verify · ── synthesis · +│$/u,
    detail: /^│ └ 7 digests +│$/u,
    svg: ["wave 2 ✓", "expand", "7 digests"],
  },
  {
    name: "loop",
    snapshot: { ignition: { discipline: "lit-loop", at: NOW - 5000 }, workflow: recorded({ family: "loop", stage: "VERIFY", step: "SURFACE", n: 2, total: 5, unit: "criterion" }) },
    top: /VERIFY ● ─╮$/u,
    map: /^│ PIN ✓ ━━ RED ✓ ━━ GREEN ✓ ━━ {2}VERIFY {2}━━ REVIEW · ── RECORD · +│$/u,
    detail: /^│ └ criterion 2\/5 [ ░]{8} · surface +│$/u,
    svg: ["VERIFY", "criterion", "surface"],
  },
];

test("the workflow map places each LIT family on its stages, with the stage's detail below, on the terminal", () => {
  for (const { name, snapshot, top, map, detail } of FAMILY_CASES) {
    const frame = draw(flowModel(snapshot), MAP_COLUMNS);
    assert.equal(frame.rows.length, 5, name);
    for (const row of frame.rows) assert.equal(rowWidth(row), MAP_COLUMNS, `${name}: ${rowText(row)}`);
    const lines = texts(frame);
    if (top) assert.match(lines[0], top, name);
    assert.match(lines[1], map, name);
    assert.match(lines[2], detail, name);
  }
  const work = draw(flowModel(atWork()), MAP_COLUMNS);
  const done = work.rows[1].filter(({ text }) => /✓$/u.test(text)).map(({ fg }) => fg);
  assert.equal(done[0], "#ff6337", "the first done stage starts the rail's flame orange");
  assert.notEqual(done[0], done[1], "and the colour grades along the rail");
  assert.equal(work.rows[1].find(({ text }) => text === "work 3/7").bg, CYAN, "the current stage is a pill on the accent");
  assert.ok(work.rows[1].filter(({ text }) => text === "━").length >= 4, "rails behind the current stage are cells graded one by one");
  assert.equal(work.rows[1].find(({ text }) => text === "review ·").fg, "#6e7681", "stages ahead are dim");
});

test("the desktop card draws the same map and detail line as one Svg", () => {
  for (const { name, snapshot, svg } of FAMILY_CASES) {
    const { source, alt } = composeSvgCard(flowModel(snapshot), { accent: CYAN });
    assert.match(source, /height="160"/u);
    for (const words of svg) assert.ok(source.includes(`>${words}<`) || source.includes(`>${words} <`) || source.includes(words), `${name}: ${words}`);
    assert.match(alt, /stage /u, name);
  }
});

test("a session no family places keeps the PLAN / WORK / REVIEW track, on both surfaces", () => {
  const model = flowModel({ ignition: { discipline: "lit-docx", at: NOW - 5000 } });
  assert.equal(model.workflow, null);
  assert.match(texts(draw(model, MAP_COLUMNS))[1], /^│ ○ PLAN ━━ ○ WORK ━━ ○ REVIEW +│$/u);
  const { source } = composeSvgCard(model, { accent: CYAN });
  assert.match(source, />PLAN</u);
  assert.doesNotMatch(source, /interview/u);
});

test("a narrow card drops the rails, then shortens the names, then keeps the current stage and its neighbours", () => {
  const model = flowModel(atWork());
  const forms = [];
  for (let columns = 100; columns >= 20; columns -= 1) {
    const frame = draw(model, columns);
    for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(columns, CARD_MAX), `${columns}: ${rowText(row)}`);
    const map = texts(frame)[1];
    const form = map.includes("…") ? "window" : /int ✓ pla ✓/u.test(map) ? "short" : / ━━ /u.test(map) ? "rail 2" : / ━ /u.test(map) ? "rail 1" : "no rails";
    if (forms.at(-1) !== form) forms.push(form);
  }
  assert.deepEqual(forms, ["rail 2", "rail 1", "no rails", "short", "window"]);
  assert.match(texts(draw(model, 30))[1], /^│ … pla ✓ {2}wor 3\/7 {2}rev · … +│$/u);
});

test("the map and the count bar move by colour alone: the glyphs stay while the rail head and the bar shimmer travel", () => {
  const full = motionProfile("full");
  const model = flowModel(atWork(), { step: { name: "Bash", at: NOW - 12_000 } });
  const timeline = createTimeline(model, 0, full);
  const frames = [2000, 2200, 2400, 2600, 2800].map((t) => composeBand(model, sampleTimeline(timeline, t, full), { columns: MAP_COLUMNS, glyphs: "basic", accent: CYAN }));
  assert.equal(new Set(frames.map((frame) => rowText(frame.rows[1]))).size, 1, "the map's text never changes while it moves");
  const railColours = (frame) => frame.rows[1].filter(({ text }) => text === "━").map(({ fg }) => fg).join(",");
  assert.ok(new Set(frames.map(railColours)).size >= 2, "the bright head travels the rail leaving the current stage");
  const bar = (frame) => frame.rows[2].filter(({ text, bg }) => text === " " && bg).map(({ bg }) => bg).join(",");
  assert.ok(new Set(frames.map(bar)).size >= 2, "the count bar's head shimmers");
  const masked = (frame) => rowText(frame.rows[2]).replace(/[-\\|/] Bash/u, "* Bash");
  assert.equal(new Set(frames.map(masked)).size, 1, "on the detail line only the ASCII spinner turns");
  assert.ok(new Set(frames.map((frame) => /([-\\|/]) Bash/u.exec(rowText(frame.rows[2]))[1])).size >= 2);
  for (const frame of frames) {
    const glyphs = frame.rows[1].flatMap(({ text }) => [...text].filter((ch) => /[^\x20-\x7e]/u.test(ch)));
    assert.deepEqual([...new Set(glyphs)].filter((ch) => !"│━─✓·".includes(ch)), [], "the map's only glyphs are rails, borders, checks and dots");
  }
  const idleCard = flowModel(atWork(), { isWorking: false });
  assert.equal(idleCard.idle, false, "an active start-work keeps the card at work between turns");
});

test("the surface counts the step clock on between models", () => {
  const full = motionProfile("full");
  const model = flowModel(atWork(), { step: { name: "Bash", at: NOW - 12_000 } });
  let timeline = createTimeline(model, 0, full);
  const detail = (m, t) => rowText(composeBand(m, sampleTimeline(timeline, t, full), { columns: MAP_COLUMNS, glyphs: "basic", accent: CYAN }).rows[2]);
  assert.match(detail(model, 3000), /Bash · 0:15 │$/u);
  const later = flowModel(atWork(), { step: { name: "Read", at: NOW - 2000 } });
  timeline = advanceTimeline(timeline, later, 4000, full);
  assert.match(detail(later, 4500), /Read · 0:02 │$/u, "a new step starts its own clock");
  assert.equal(flowModel(atWork(), { step: { name: "Bash", at: NOW }, isWorking: false }).step, null, "no step once the turn is over");
});

test("the detail line names the running tool and how long it runs, never its arguments, on both surfaces", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "go", turnId: "t1" });
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const call = host.fire("tool.call", { tool: "Bash", tool_use_id: "toolu_1", command: "cat /Users/someone/secret-notes.txt && rm -rf build" }, {}, pending);
  await new Promise((resolve) => setTimeout(resolve, 0));
  host.tick(65_000);
  await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
  await host.flush();
  const { lines } = await host.band();
  assert.match(lines[2], /- Bash · 1:05 │$/u);
  const desktop = await host.drawOn("desktop");
  for (const shown of [lines.join("\n"), desktop.source, desktop.alt]) {
    assert.match(shown, /Bash/u);
    assert.doesNotMatch(shown, /secret|rm -rf|notes|\/Users/u, "no argument of the call reaches the card");
  }
  finish({ result: "ok" });
  await call;
  await host.fire("tool.call", { tool: "mcp__plugin_litclaude_litclaude__wikify_query", tool_use_id: "toolu_2", query: "private question" }, {}, { result: "ok" });
  const steps = [];
  const between = host.fire("tool.call", { tool: "Read", tool_use_id: "toolu_3", file_path: "/private/x" }, {}, new Promise((resolve) => setTimeout(() => resolve({}), 5)));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
  await host.flush();
  steps.push((await host.band()).lines[2]);
  await between;
  assert.match(steps[0], /Read · 0:00 │$/u);
  host.tick(1000);
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "done", durationMs: 70_000, isAborted: false });
  await host.flush();
  assert.doesNotMatch((await host.band()).lines[2], /Bash|Read|thinking/u, "the step clears when the turn ends");
});

test("the mod reads a model request on the main loop as thinking", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "go", turnId: "t1" });
  const stream = host.stream("turn.step", { turnId: "t1", index: 0, model: "m", messageCount: 3 }, (async function* core() {
    return { stop: "end" };
  })());
  await stream.next();
  await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
  await host.flush();
  assert.match((await host.band()).lines[2], /- thinking · 0:00 │$/u);
});

const boulderWith = (checked) => JSON.stringify({
  active_work_id: "w1",
  works: { w1: { work_id: "w1", status: "active", root_session_id: "card-session", plan_name: "demo.md", progress: { total: 7, checked, next_task: "7. ship" }, lanes: {}, events: [] } },
});

test("notify is off by default; finish notifies when LIT work completes and when a LIT turn over three minutes ends; no sound ships", async () => {
  for (const notify of [undefined, "finish", "finish+sound"]) {
    const files = new Map([["/nowhere/project/.litclaude/boulder.json", boulderWith(6)]]);
    const host = await harness({ glyphs: "basic", motion: "off", ...(notify ? { notify } : {}) }, [], files);
    await host.fire("session.start", {});
    await host.fire("turn.start", { text: "go", turnId: "t1" });
    files.set("/nowhere/project/.litclaude/boulder.json", boulderWith(7));
    await host.fire("session.measure", { context: null, rateLimits: [], changed: ["context"] });
    await host.flush();
    await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "done", durationMs: 4 * 60_000, isAborted: false });
    await host.flush();
    await host.fire("turn.start", { text: "again", turnId: "t2" });
    await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
    host.tick(1000);
    await host.fire("turn.complete", { reason: "answer", turnId: "t2", answer: "planned", durationMs: 3 * 60_000 + 1, isAborted: false });
    await host.fire("turn.start", { text: "short", turnId: "t3" });
    await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
    await host.fire("turn.complete", { reason: "answer", turnId: "t3", answer: "planned", durationMs: 30_000, isAborted: false });
    await host.flush();
    if (!notify) {
      assert.deepEqual(host.notified, [], "off is the default");
      continue;
    }
    assert.deepEqual(host.notified.map(({ text }) => text), ["LIT complete · 7/7 tasks", "LIT turn finished · lit-plan · 3m"], `${notify}: one notice for the completed work, one for the long turn, none for the short one`);
    assert.ok(host.notified.every(({ title }) => title === "LitClaude"));
    assert.deepEqual(host.played, [], `${notify}: LitClaude ships no sound yet, so nothing plays`);
  }
  assert.deepEqual(normalizeModSettings({ notify: "FINISH+SOUND" }).notify, "finish+sound");
  assert.equal(normalizeModSettings({ notify: "loud" }).notify, "off");
});

// A real directory read through the same { stat, read, list } shape the mod gives state.mjs.
const diskIo = {
  stat: async (path) => {
    try {
      const link = lstatSync(path).isSymbolicLink();
      const info = statSync(path);
      return { kind: info.isFile() ? "file" : "dir", size: info.size, isLink: link, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  },
  read: async (path) => readFileSync(path, "utf8"),
  list: async (path) => readdirSync(path, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    kind: entry.isSymbolicLink() ? "other" : entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
    isLink: entry.isSymbolicLink(),
    size: entry.isFile() ? statSync(join(path, entry.name)).size : 0,
    mtimeMs: entry.isFile() ? statSync(join(path, entry.name)).mtimeMs : 0,
  })),
};

test("the map reads the durable state LitClaude already writes: interview rounds, the draft's gate, research waves and the workflow stack", async () => {
  const project = mkdtempSync(join(tmpdir(), "litclaude-map-"));
  try {
    mkdirSync(join(project, ".git"));
    const state = join(project, ".litclaude");
    for (const dir of ["deep-interview", "drafts", "litresearch/s1"]) mkdirSync(join(state, dir), { recursive: true });
    writeFileSync(join(state, "deep-interview", "demo-state.json"), JSON.stringify({ active: true, state: { rounds: [{}, {}, {}], current_ambiguity: 0.42, threshold: 0.2, max_rounds: 12 } }));
    writeFileSync(join(state, "drafts", "demo.md"), "---\nslug: demo\nstatus: drafting\n---\n\n## Approval gate\nstatus: awaiting-approval\n");
    for (const name of ["wave-1-web-a.md", "wave-1-code-b.md", "wave-2-web-c.md", "verify-claim.md", "expansion-log.md"]) writeFileSync(join(state, "litresearch", "s1", name), "x\n");
    startWorkflowStage(project, { sessionId: "map-session", skill: "review-work" });
    recordWorkflowStage(project, { sessionId: "map-session", family: "main", stage: "review", verdicts: { scope: "pass" } });
    recordWorkflowStage(project, { sessionId: "map-session", family: "main", stage: "review", verdicts: { tests: "fail" } });
    const snapshot = await readLitSnapshot(diskIo, { cwd: project, sessionId: "map-session" });
    const { interview, draft, research, record } = snapshot.workflow;
    assert.deepEqual({ ...interview, at: null }, { active: true, round: 3, max: 12, ambiguity: 0.42, threshold: 0.2, at: null });
    assert.deepEqual({ slug: draft.slug, status: draft.status }, { slug: "demo", status: "awaiting-approval" }, "the approval gate's status wins over the header's");
    assert.deepEqual({ ...research, at: null }, { slug: "s1", wave: 2, digests: 3, verified: 1, synthesis: false, at: null });
    assert.deepEqual(record.verdicts, { scope: "pass", tests: "fail" }, "lane verdicts accumulate on the same stage");
    assert.equal(record.family, "main");
    const other = await readLitSnapshot(diskIo, { cwd: project, sessionId: "another-session" });
    assert.equal(other.workflow.record, null, "another session's stack is not ours");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("the stack's frames are small and checked: known families and stages, bounded verdicts, lit-loop's eight steps on six stages", () => {
  const project = mkdtempSync(join(tmpdir(), "litclaude-stage-"));
  const out = { text: "", write(chunk) { this.text += chunk; } };
  const err = { text: "", write(chunk) { this.text += chunk; } };
  try {
    mkdirSync(join(project, ".git"));
    startWorkflowStage(project, { sessionId: "s", skill: "review-work" });
    startWorkflowStage(project, { sessionId: "s", skill: "start-work" });
    assert.deepEqual(readStack(project, "s").frames.map(({ skill, status }) => `${skill}:${status}`), ["review-work:paused", "start-work:active"], "every discipline gets a frame; an unfinished review is paused under it");
    startWorkflowStage(project, { sessionId: "s", skill: "lit-plan", restart: true });
    assert.equal(readStack(project, "s").frames.at(-1).stage, "plan", "lit-plan starts at plan so its saved plan can check the stage");
    startWorkflowStage(project, { sessionId: "s", skill: "lit-loop" });
    assert.equal(runWorkflowStageCli(["loop", "SURFACE", "--n", "2", "--total", "5", "--session", "s", "--json"], project, out, err), 0, err.text);
    const written = readStack(project, "s").frames.at(-1);
    assert.deepEqual({ ...written, at: null }, { skill: "lit-loop", family: "loop", stage: "SURFACE", role: "spine", status: "active", verdicts: {}, n: 2, total: 5, at: null });
    const parsed = parseStageRecord(written, "s");
    assert.equal(parsed.stage, "VERIFY");
    assert.equal(parsed.step, "SURFACE");
    for (const args of [["loop", "LINT"], ["galaxy", "work"], ["main", "review", "--verdict", "__proto__=pass"], ["main", "review", "--verdict", "scope=maybe"], ["main", "work", "--n", "-1"], ["main", "work", "--unit", "lines"], ["main", "work", "--bogus", "1"]]) {
      err.text = "";
      assert.equal(runWorkflowStageCli(args, project, out, err), 64, args.join(" "));
      assert.match(err.text, /Usage: litclaude-ai workflow-stage/u);
    }
    const many = Array.from({ length: 9 }, (_, i) => ["--verdict", `lane-${i}=pass`]).flat();
    assert.equal(runWorkflowStageCli(["main", "review", ...many], project, out, err), 64, "at most eight verdicts");
    assert.equal(parseStageRecord({ ...written, verdicts: { "BAD NAME": "pass", ok: "pass" } }, "s").verdicts.ok, "pass");
    assert.equal(Object.keys(parseStageRecord({ ...written, verdicts: { "BAD NAME": "pass" } }, "s").verdicts).length, 0);
    assert.equal(parseStageRecord({ ...written, family: "elsewhere" }, "s"), null);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("the prompt and Skill hooks push a stack frame, and each skill tells the model how to move it", () => {
  const project = mkdtempSync(join(tmpdir(), "litclaude-stage-hook-"));
  const hook = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));
  try {
    mkdirSync(join(project, ".git"));
    const result = spawnSync(process.execPath, [hook, "pre-tool-use"], {
      cwd: project,
      encoding: "utf8",
      input: JSON.stringify({ cwd: project, hook_event_name: "PreToolUse", session_id: "hook-session", tool_name: "Skill", tool_input: { skill: "litclaude:review-work" } }),
    });
    assert.equal(result.status, 0, result.stderr);
    const frames = readStack(project, "hook-session").frames;
    assert.deepEqual(frames.map((frame) => ({ ...frame, at: null })), [{ skill: "review-work", family: "main", stage: "review", role: "spine", status: "active", verdicts: {}, at: null }]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
  const skills = new URL("../plugins/litclaude/skills/", import.meta.url);
  for (const [skill, call] of [["review-work", "workflow-stage main review --verdict"], ["lit-loop", "workflow-stage loop"], ["lit-crucible", "workflow-stage main plan --verdict crucible="]]) {
    assert.match(readFileSync(new URL(`${skill}/SKILL.md`, skills), "utf8"), new RegExp(`litclaude-ai ${call}`, "u"), skill);
  }
});

// Status toasts: one per real change of the LIT state, none on a refresh that changes nothing.
const statusModel = (overrides = {}) => ({ lanes: { count: 0, list: [] }, workflow: null, ...overrides });

test("status changes: a discipline starts or switches, a stage moves, a goal is set or met, a lane starts or finishes", () => {
  const first = statusOf({ discipline: null, model: statusModel(), snapshot: idle() });
  assert.deepEqual(statusChanges(null, first), [], "the first look at a session announces nothing");
  assert.deepEqual(statusChanges(first, statusOf({ discipline: null, model: statusModel(), snapshot: idle() }, first)), [], "nothing changed, nothing said");

  const planning = statusOf({ discipline: "lit-plan", model: statusModel({ workflow: { family: "main", current: 1, stages: [{ id: "interview" }, { id: "plan" }] } }), snapshot: idle() }, first);
  assert.equal(mergeToasts(statusChanges(first, planning)), "🔥 lit-plan started", "the stage the discipline enters is not said twice");
  const research = statusOf({ discipline: "litresearch", model: statusModel(), snapshot: idle() }, planning);
  assert.equal(research.discipline, "litresearch");
  const notDiscipline = statusOf({ discipline: "lit-docx", model: statusModel(), snapshot: idle() }, planning);
  assert.equal(notDiscipline.discipline, "lit-plan", "a skill that is not a discipline keeps the last discipline");
  const brainstorm = statusOf({ discipline: "lit-brainstorm", model: statusModel(), snapshot: idle() }, planning);
  assert.equal(mergeToasts(statusChanges(planning, brainstorm)), "🔥 lit-plan → lit-brainstorm", "starting lit-brainstorm raises a toast like any discipline");
  const quiet = statusOf({ discipline: null, model: statusModel(), snapshot: idle() }, planning);
  assert.equal(quiet.discipline, "lit-plan", "a prompt that names no discipline keeps the last one");

  const red = statusOf({ discipline: "lit-loop", model: statusModel({ workflow: { family: "loop", current: 1, stages: [{ id: "PIN" }, { id: "RED" }] } }), snapshot: idle() }, planning);
  const green = statusOf({ discipline: "lit-loop", model: statusModel({ workflow: { family: "loop", current: 2, stages: [{ id: "PIN" }, { id: "RED" }, { id: "GREEN" }] } }), snapshot: idle() }, red);
  assert.equal(mergeToasts(statusChanges(planning, red)), "🔥 lit-plan → lit-loop");
  assert.equal(mergeToasts(statusChanges(red, green)), "🔥 stage · GREEN");

  const goalSet = statusOf({ discipline: "lit-loop", model: statusModel(), snapshot: lit() }, red);
  assert.match(mergeToasts(statusChanges({ ...red, stage: null }, { ...goalSet, stage: null })), /goal set · ship the card/u);
  const goalMet = statusOf({ discipline: "lit-loop", model: statusModel(), snapshot: lit({ goal: goalOf(5, 5, "complete") }) }, goalSet);
  assert.equal(mergeToasts(statusChanges(goalSet, goalMet)), "🔥 goal met · 5/5");

  const oneLane = statusOf({ discipline: "lit-loop", model: statusModel({ lanes: { count: 1, list: [{ id: "a1", name: "review" }] } }), snapshot: lit() }, goalSet);
  const twoMore = statusOf({ discipline: "lit-loop", model: statusModel({ lanes: { count: 3, list: [{ id: "a1", name: "review" }, { id: "a2", name: "lint" }, { id: "a3", name: "qa" }] } }), snapshot: lit() }, oneLane);
  assert.equal(mergeToasts(statusChanges(goalSet, oneLane)), "🔥 lane started · review");
  assert.equal(mergeToasts(statusChanges(oneLane, twoMore)), "🔥 2 lanes started");
  assert.equal(mergeToasts(statusChanges(twoMore, goalSet)), "🔥 3 lanes finished");
});

test("the toast gate shows at most one toast per three seconds and merges what waited into one line", () => {
  let gate = { lastAt: -Infinity, pending: [] };
  let step = gateToast(gate, [{ kind: "discipline", from: null, to: "lit-plan" }], 1000);
  assert.equal(step.show, "🔥 lit-plan started");
  gate = step.gate;
  step = gateToast(gate, [], 1500);
  assert.equal(step.show, null, "nothing waiting, nothing shown");
  step = gateToast(gate, [{ kind: "discipline", from: "lit-plan", to: "start-work" }], 1500);
  assert.equal(step.show, null, "inside the gap the toast waits");
  assert.equal(step.waitMs, TOAST_GAP_MS - 500);
  step = gateToast(step.gate, [{ kind: "lane-start", text: "lane started · lint" }, { kind: "discipline", from: "start-work", to: "review-work" }], 2000);
  assert.equal(step.show, null);
  step = gateToast(step.gate, [], 1000 + TOAST_GAP_MS);
  assert.equal(step.show, "🔥 lit-plan → review-work · lane started · lint", "a burst arrives as one line, a switch chain as its ends");
  assert.deepEqual(step.gate.pending, []);
  assert.equal(mergeToasts([1, 2, 3, 4, 5].map((n) => ({ kind: "note", text: `n${n}` }))), "🔥 n1 · n2 · n3 · +2 more");
  assert.equal(mergeToasts([{ kind: "discipline", from: "lit-plan", to: "start-work" }, { kind: "discipline", from: "start-work", to: "lit-plan" }]), null, "a switch there and back says nothing");
});

test("the mod toasts LIT status changes on the host, once each, and stays silent on polls that change nothing", async () => {
  const listed = [];
  const host = await harness({ glyphs: "basic", motion: "off" }, listed);
  await host.fire("session.start", {});
  await host.flush();
  assert.deepEqual(host.toasts, [], "opening the session raises no toast");
  host.tick(5000);
  await host.fire("turn.start", {});
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:lit-plan" });
  await host.flush();
  assert.deepEqual(host.toasts, ["🔥 lit-plan started"]);
  for (let i = 0; i < 3; i += 1) {
    host.tick(2000);
    await host.poll();
  }
  assert.equal(host.toasts.length, 1, "polls that change nothing stay silent");

  host.tick(5000);
  listed.push({ id: "a1", description: "review", type: "general-purpose", status: "running" });
  await host.poll();
  assert.equal(host.toasts.at(-1), "🔥 lane started · review");
  host.tick(5000);
  listed[0] = { ...listed[0], status: "completed" };
  await host.poll();
  assert.equal(host.toasts.at(-1), "🔥 lane finished · review");
  assert.equal(host.toasts.length, 3);

  host.tick(5000);
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:start-work" });
  host.tick(500);
  await host.fire("tool.call", { tool: "Skill", skill: "litclaude:review-work" });
  assert.equal(host.toasts.at(-1), "🔥 lit-plan → start-work");
  assert.ok(host.delays.includes(TOAST_GAP_MS - 500), "the second switch waits out the gap");
  await host.flush();
  assert.equal(host.toasts.at(-1), "🔥 start-work → review-work");
  assert.equal(host.toasts.length, 5);
});

test("a lane stays on the card while the host lists its agent alive, however long it is quiet", async () => {
  const listed = [{ id: "a1", description: "long build", type: "general-purpose", status: "running" }];
  const host = await harness({ glyphs: "basic", motion: "off" }, listed);
  await host.fire("session.start", {});
  await host.flush();
  host.tick(AGENT_STALE_MS + 60_000);
  await host.poll();
  const { lines } = await host.band();
  assert.match(lines[1], /1 lane\b/u, "alive by the host's word, so still listed");
  assert.doesNotMatch(lines[0], /─ idle ─╮/u);

  const model = buildBandModel({ snapshot: idle(), agents: listed, activity: { last: { a1: NOW }, first: { a1: NOW } }, now: NOW + AGENT_STALE_MS + 60_000 });
  assert.equal(model.lanes.count, 1);
  assert.equal(model.lanes.list[0].status, "stalled", "a quiet live lane is marked, not dropped");
  assert.equal(model.lanes.list[0].id, "a1");
});

test("a workflow agent inside one long tool call is not dropped as lost", async () => {
  const host = await harness({ glyphs: "basic", motion: "off" });
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "go", turnId: "t1" });
  await spawnWorkflowAgent(host, "wf-long", "long build");
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "Started.", durationMs: 1000, isAborted: false });
  let release;
  const call = host.fire("tool.call", { tool: "Bash", agentId: "wf-long" }, {}, new Promise((resolve) => { release = resolve; }));
  await host.flush();
  host.tick(AGENT_STALE_MS + 60_000);
  await host.poll();
  assert.match((await host.band()).lines[1], /1 lane\b/u, "a call in flight means the agent is alive");
  release({});
  await call;
  await host.flush();
  host.tick(AGENT_STALE_MS + 60_000);
  await host.poll();
  assert.match((await host.band()).lines[0], /─ idle ─╮/u, "quiet past the limit with nothing in flight, it is let go");
});

test("lane timers keep counting on the terminal while a desktop drawing is attached", async () => {
  const { default: LitBand } = await import("../plugins/litclaude/hooks/lit-band-client.mjs");
  const host = await harness({ glyphs: "basic", motion: "full" }, [], new Map(), { client: true });
  await host.fire("session.start", {});
  await host.fire("turn.start", { text: "go", turnId: "t1" });
  await spawnWorkflowAgent(host, "wf-1", "lint");
  await host.fire("turn.complete", { reason: "answer", turnId: "t1", answer: "Started.", durationMs: 1000, isAborted: false });
  await host.flush();
  await host.drawOn("desktop");
  const client = await host.drawOn("terminal");
  assert.equal(client.kind, "client");
  host.invalidations.length = 0;
  host.tick(2000);
  await host.poll();
  assert.deepEqual(host.invalidations, [], "with a drawing attached, time alone does not redraw");

  const timers = [];
  const surface = {
    state: undefined,
    elements: { Box: (props) => ({ type: "Box", props }), Text: (props) => ({ type: "Text", props }) },
    every: (ms, fn) => {
      const timer = { ms, fn, stopped: false };
      timers.push(timer);
      return () => { timer.stopped = true; };
    },
    setState(next) { this.state = { ...this.state, ...next }; },
  };
  const flatten = (node) => (node.type === "Text" ? [node.props.children] : (node.props.children ?? []).flatMap(flatten));
  const clockOf = () => {
    const rows = LitBand(client.props, surface).props.children.map((row) => flatten(row).join(""));
    return /1 lane (\d+:\d\d)/u.exec(rows[1])?.[1];
  };
  const advance = (ms) => {
    let left = ms;
    while (left > 0) {
      const timer = timers.find((candidate) => !candidate.stopped);
      assert.ok(timer, "a timer keeps running while a lane runs");
      timer.fn();
      left -= timer.ms;
    }
  };
  LitBand(client.props, surface);
  advance(1000);
  assert.equal(clockOf(), "0:01", "past the entry the lane clock shows");
  advance(5000);
  assert.equal(clockOf(), "0:06", "and counts on with no new model");
});

test("the motion-off surface still ticks its clocks once a second, and stops when nothing runs", async () => {
  const { default: LitBand } = await import("../plugins/litclaude/hooks/lit-band-client.mjs");
  const timers = [];
  const surface = {
    state: undefined,
    elements: { Box: (props) => ({ type: "Box", props }), Text: (props) => ({ type: "Text", props }) },
    every: (ms, fn) => {
      const timer = { ms, fn, stopped: false };
      timers.push(timer);
      return () => { timer.stopped = true; };
    },
    setState(next) { this.state = { ...this.state, ...next }; },
  };
  const agents = [{ id: "a1", description: "lint", type: "general-purpose", status: "running" }];
  const running = buildBandModel({ snapshot: idle(), agents, activity: { last: { a1: NOW }, first: { a1: NOW } }, now: NOW });
  LitBand({ model: running, columns: 80, glyphs: "basic", motion: "off", accent: CYAN }, surface);
  const live = timers.filter((timer) => !timer.stopped);
  assert.equal(live.length, 1);
  assert.equal(live[0].ms, 1000, "a clock on the card ticks each second even with motion off");
  LitBand({ model: buildBandModel({ snapshot: idle(), now: NOW }), columns: 80, glyphs: "basic", motion: "off", accent: CYAN }, surface);
  assert.equal(timers.filter((timer) => !timer.stopped).length, 0, "an idle card with no clock keeps no timer");
});

test("running lanes move while the main turn waits: the lane dots carry a light", () => {
  const agents = [{ id: "a1", description: "lint", type: "general-purpose", status: "running" }, { id: "a2", description: "qa", type: "general-purpose", status: "running" }];
  const model = buildBandModel({ snapshot: idle(), agents, activity: { last: { a1: NOW, a2: NOW }, first: { a1: NOW - 65_000, a2: NOW } }, now: NOW });
  assert.equal(model.step, null, "the main turn is not running a tool");
  const full = motionProfile("full");
  const timeline = createTimeline(model, 0, full);
  const dots = (t) => composeBand(model, sampleTimeline(timeline, t, full), { columns: 100, glyphs: "basic", accent: CYAN }).rows[1].filter(({ text }) => text === "●").map(({ fg }) => fg).join(",");
  const seen = new Set([2000, 2300, 2600, 2900, 3200].map(dots));
  assert.ok(seen.size > 1, "the dots change colour from frame to frame");
  assert.match(rowText(composeBand(model, sampleTimeline(timeline, 2000, full), { columns: 100, glyphs: "basic", accent: CYAN }).rows[1]), /2 lanes 1:07/u, "the longest lane's clock shows and counts on");
});

test("the border glows brighter and breathes while LIT is active, and stays calm while idle", () => {
  const working = buildBandModel({ snapshot: lit(), now: NOW, isWorking: true, usage, git: "main" });
  const resting = buildBandModel({ snapshot: idle(), now: NOW, usage, git: "main" });
  const full = motionProfile("full");
  const borderAt = (model, t) => composeBand(model, sampleTimeline(createTimeline(model, 0, full), t, full), { columns: 80, glyphs: "basic", accent: CYAN }).border;
  const active = [2000, 2600, 3200, 3800].map((t) => borderAt(working, t));
  assert.ok(new Set(active).size > 1, "the active border pulses");
  assert.ok(active.every((color) => luminance(color) >= luminance(CYAN) - 1e-9), "never dimmer than the accent while active");
  assert.ok(Math.max(...active.map(luminance)) > luminance(CYAN) + 0.05, "at its peak clearly brighter than the accent");
  const calm = [2000, 2600, 3200, 3800].map((t) => borderAt(resting, t));
  assert.equal(new Set(calm).size, 1, "idle, the border does not move");
  assert.ok(luminance(calm[0]) < luminance(CYAN), "idle, it is dimmer than the accent");
  assert.equal(draw(working, 80).border, lerpColor(CYAN, "#ffffff", 0.15), "at rest (and under motion off) the active border sits a step above the accent");
  const peak = composeBand(working, { ...settledSample(working), ambient: { breath: 1, sweep: null, comet: null, flow: null } }, { columns: 80, glyphs: "basic", accent: CYAN }).border;
  assert.equal(peak, lerpColor(CYAN, "#ffffff", 0.45), "its breathing peak is brighter too");
  const svg = composeSvgCard(svgModel(), { motion: "full", accent: CYAN }).source;
  assert.match(svg, /rx="14" fill="[^"]+" stroke="#5fd7ff" stroke-width="2.5">/u, "the desktop card's border is heavier while active");
  assert.match(svg, /attributeName="stroke-opacity" values="0.85;1;0.85"/u, "and breathes high");
});
