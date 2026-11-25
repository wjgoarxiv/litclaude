// The card's sunset (plans/2026-11-24-litfamily-hud): a sun, stars and a sea in the cells no text uses.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText, rowWidth } from "../plugins/litclaude/lib/mod/frame.mjs";
import { TIMINGS, motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { glyphSet, resolveGlyphs } from "../plugins/litclaude/lib/mod/settings.mjs";
import { drawsRoundCaps } from "../plugins/litclaude/lib/mod/round.mjs";
import { parseWorkflowStack } from "../plugins/litclaude/lib/mod/state.mjs";
import { createTimeline, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";
import { clearSky } from "./helpers/clear-sky.mjs";

const NOW = 10_000_000;
const ACCENT = "#5fd7ff";
const full = motionProfile("full");
const none = { ignition: null, work: null, completedWorkIds: [], goal: null, workflow: {} };
const working = (agents = [], extra = {}) => {
  const frame = { skill: "start-work", family: "main", stage: "work", role: "spine", status: "active", verdicts: {}, at: new Date(NOW - 2000).toISOString(), n: 3, total: 7 };
  const stack = parseWorkflowStack({ version: 1, sessionId: "s", frames: [frame], history: [] }, "s");
  return buildBandModel({ snapshot: { ...none, ignition: { discipline: "start-work", at: NOW - 1000 }, workflow: { stack, record: stack.record } }, now: NOW, isWorking: true, skills: [{ id: "start-work", at: NOW - 100, state: "current" }], agents: agents.map((name) => ({ id: name, name, type: "executor", status: "running" })), ...extra });
};
const idle = () => buildBandModel({ snapshot: none, now: NOW });
const at = (model, t, { columns = 112, profile = full, glyphs = "basic", color = true } = {}) => composeBand(model, sampleTimeline(createTimeline(model, 0, profile), t, profile), { columns, glyphs, accent: ACCENT, color });
const sunRow = (frame) => frame.rows.findIndex((row) => /▇{10}/u.test(rowText(row)));
const sunInk = (frame) => JSON.stringify(frame.rows.map((row) => row.filter(({ text }) => /[▁-█]/u.test(text)).map(({ text, fg }) => [text, fg])));

test("the sun stands on a wide card and stays away where it has no room", () => {
  assert.ok(sunRow(at(working(), 2000)) > 0);
  assert.equal(sunRow(at(working(), 2000, { columns: 80 })), -1, "not under 90 columns");
  const long = working([], { step: { name: "x".repeat(60), at: NOW - 1000 } });
  for (const row of at(long, 2000, { columns: 92 }).rows) assert.equal(rowWidth(row), 92);
  assert.equal(sunRow(at({ ...working(), completion: { id: "c", title: "COMPLETE", detail: "7/7" } }, 1000)), -1, "nor over COMPLETE");
});

test("the scene never covers a word or changes a width, with or without lanes", () => {
  for (const agents of [[], ["executor"], ["executor", "reviewer", "verifier"]]) {
    for (const columns of [20, 44, 60, 80, 90, 100, 112, 120, 160]) {
      const words = at(working(agents), 2000, { columns, profile: motionProfile("off"), color: false }).rows.map(rowText);
      for (const t of [1500, 2000, 9300, 9600]) {
        const frame = at(working(agents), t, { columns });
        for (const row of frame.rows) assert.equal(rowWidth(row), Math.min(120, columns));
        assert.equal(frame.rows.length, words.length);
        frame.rows.forEach((row, i) => assert.equal(clearSky(rowText(row)).replace(/[-\\|/] (?=Bash)/u, ""), clearSky(words[i]).replace(/[-\\|/] (?=Bash)/u, ""), `${columns} columns, ${t} ms, row ${i}`));
      }
    }
  }
});

test("lanes push the sun down to the last rows; it comes back up when they end", () => {
  const one = at(working(), 2000);
  const many = at(working(["executor", "reviewer", "verifier"]), 2000);
  assert.equal(one.rows.length, 5);
  assert.ok(many.rows.length > 5);
  assert.equal(sunRow(one), one.rows.length - 3);
  assert.equal(sunRow(many), many.rows.length - 3);
});

test("full motion: the sun's colours ripple while its glyphs stay, and the sea and stars are ASCII", () => {
  const frames = [2000, 2400, 2800, 3200].map((t) => at(working(), t));
  assert.ok(new Set(frames.map(sunInk)).size >= 3, "the light moves");
  const shape = (frame) => frame.rows.map((row) => [...rowText(row)].map((ch, x) => (/[▁-█]/u.test(ch) ? `${x}${ch}` : "")).join(""));
  for (const frame of frames) assert.deepEqual(shape(frame), shape(frames[0]), "no block glyph changes");
  const sea = frames.map((frame) => rowText(frame.rows[3]).replace(/[▁-█]/gu, " ").split("start-work").at(-1));
  assert.equal(new Set(sea).size, frames.length, "the sea moves");
});

test("the scene holds still while idle, under subtle motion and with motion off", () => {
  assert.equal(JSON.stringify(at(idle(), 2000).rows), JSON.stringify(at(idle(), 3000).rows));
  for (const mode of ["subtle", "off"]) {
    const profile = motionProfile(mode);
    assert.equal(sunInk(at(working(), 2000, { profile })), sunInk(at(working(), 2700, { profile })), mode);
    const rule = (t) => JSON.stringify(at(working(), t, { profile }).rows.at(-1).filter(({ text }) => /^─+$/u.test(text)));
    assert.equal(rule(2000), rule(2700), `${mode}: the rule under the sun`);
  }
});

test("NO_COLOR draws no scene", () => {
  assert.doesNotMatch(at(working(), 2000, { color: false }).rows.map(rowText).join("\n"), /[▁-█~]/u);
});

test("the invited card's scene moves only while a glint passes", () => {
  const club = buildBandModel({ snapshot: none, now: NOW, club: true, invitedBy: "friend" });
  assert.equal(club.look, "club");
  const ink = (t) => JSON.stringify(at(club, t).rows.slice(1, -1));
  const start = TIMINGS.clubGlintRest;
  assert.equal(ink(start - 400), ink(start - 200), "still before the glint");
  assert.notEqual(ink(start + TIMINGS.clubGlint * 0.4), ink(start + TIMINGS.clubGlint * 0.6));
});

test("terminals that draw round caps themselves get them without the icon font", () => {
  assert.equal(drawsRoundCaps({ WT_SESSION: "x" }), true);
  assert.equal(drawsRoundCaps({ TERM_PROGRAM: "vscode" }), true);
  assert.equal(drawsRoundCaps({ TERM_PROGRAM: "Apple_Terminal" }), false);
  assert.equal(drawsRoundCaps(undefined), false);
  assert.equal(resolveGlyphs("auto", "terminal", false, true), "round");
  assert.equal(resolveGlyphs("auto", "terminal", true, true), "nerd");
  assert.equal(resolveGlyphs("basic", "terminal", false, true), "basic");
  assert.equal(resolveGlyphs("auto", "desktop", false, true), "basic");
  const round = glyphSet("round");
  assert.deepEqual([round.capLeft, round.capRight], ["\ue0b6", "\ue0b4"]);
  assert.equal(round.branch, "git");
  for (const columns of [60, 112]) assert.deepEqual(at(working(), 2000, { columns, glyphs: "round" }).rows.map(rowWidth), at(working(), 2000, { columns }).rows.map(rowWidth));
});
