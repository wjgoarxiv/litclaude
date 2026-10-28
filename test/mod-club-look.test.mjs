// plans/invite-pilot.md todo 5: once `lit invite` recorded an inviter, the idle card wears the club
// look, unless the `club` card option is off. Every other look still wins over it, and a card at
// work keeps its working look.
import assert from "node:assert/strict";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { LOOKS } from "../plugins/litclaude/lib/mod/looks.mjs";
import { motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { MOD_CHOICES, normalizeModSettings } from "../plugins/litclaude/lib/mod/settings.mjs";
import { inviteRoot, parseWorkflowStack, readInvited } from "../plugins/litclaude/lib/mod/state.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { createTimeline, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 30_000_000;
const SID = "club-look-01";
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const usage = { context: { percent: 42 }, rateLimits: [{ kind: "five_hour", percentUsed: 31 }] };
const model = (extra = {}) => buildBandModel({ snapshot: idle(), now: NOW, usage, git: "feat/invite", ...extra });
const draw = (m, motion = "full", t = 1000, opts = {}) => {
  const profile = motionProfile(motion);
  return composeBand(m, sampleTimeline(createTimeline(m, 0, profile), t, profile), { columns: 100, glyphs: "basic", accent: "#5fd7ff", ...opts });
};

test("club is a registered look with its own label", () => {
  assert.equal(LOOKS.club.label, "CLUB");
});

test("no invite keeps the old ready look; an invite turns the idle card to club", () => {
  assert.equal(model().look, null);
  assert.equal(model({ club: true }).look, "club");
  assert.match(rowText(draw(model({ club: true })).rows[0]), /CLUB/u);
  assert.doesNotMatch(rowText(draw(model()).rows[0]), /CLUB/u);
});

test("club off draws the ready card byte for byte", () => {
  for (const motion of ["full", "off"]) {
    assert.deepEqual(draw(model({ club: false }), motion), draw(model(), motion));
  }
  assert.equal(composeSvgCard(model({ club: false })).source, composeSvgCard(model()).source);
});

test("done, your turn, rewind and review all win over club", () => {
  assert.equal(model({ club: true, completion: { id: "goal:x", detail: "goal met" } }).look, "done");
  assert.equal(model({ club: true, waiting: { reason: "question" } }).look, "turn");
  const rewind = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "lit-adhd", at: NOW - 1000 } }, now: NOW, usage, isWorking: true, club: true });
  assert.equal(rewind.look, "rewind");
  const stack = parseWorkflowStack({ version: 1, sessionId: SID, frames: [{ skill: "review-work", family: "main", stage: "review", role: "spine", status: "active", verdicts: { goal: "pass", qa: "running" }, at: new Date(NOW - 2000).toISOString() }], history: [] }, SID);
  const review = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "review-work", at: NOW - 1000 }, workflow: { stack, record: stack.record } }, now: NOW, usage, isWorking: true, club: true });
  assert.equal(review.look, "review");
});

test("a card at work keeps its working look", () => {
  const working = buildBandModel({ snapshot: { ...idle(), ignition: { discipline: "start-work", at: NOW - 1000 } }, now: NOW, usage, isWorking: true, club: true });
  assert.equal(working.look, null);
});

test("club does not make the band show under band auto", () => {
  assert.equal(model({ club: true, band: "auto" }).visible, false);
  assert.equal(model({ club: true, band: "auto" }).look, "club");
});

test("the svg card wears club too", () => {
  const svg = composeSvgCard(model({ club: true })).source;
  assert.match(svg, />CLUB/u);
  assert.match(svg, /lit-club/u);
  assert.doesNotMatch(composeSvgCard(model()).source, /CLUB/u);
});

test("club is the fifth card option, on by default", () => {
  assert.deepEqual(MOD_CHOICES.club, ["on", "off"]);
  assert.equal(normalizeModSettings({}).club, "on");
  assert.equal(normalizeModSettings({ club: "OFF" }).club, "off");
  assert.equal(normalizeModSettings({ club: "maybe" }).club, "on");
});

const mapIo = (files, links = new Set()) => ({
  stat: async (path) => {
    if (Object.hasOwn(files, path)) return { kind: "file", size: files[path].length, isLink: links.has(path), realPath: path };
    if (Object.keys(files).some((name) => name.startsWith(`${path}/`))) return { kind: "directory", size: 0, isLink: false, realPath: path };
    return null;
  },
  read: async (path) => files[path],
});

test("the band reads invite.json from LITCLAUDE_HOME, else ~/.litclaude, and skips links", async () => {
  const record = JSON.stringify({ version: 1, invitedBy: "octocat", at: "2026-10-28T00:00:00.000Z" });
  assert.equal(inviteRoot({ LITCLAUDE_HOME: "/x/lh", HOME: "/u" }), "/x/lh");
  assert.equal(inviteRoot({ HOME: "/u" }), "/u/.litclaude");
  assert.equal(inviteRoot({}), null);
  assert.equal(await readInvited(mapIo({ "/u/.litclaude/invite.json": record }), { HOME: "/u" }), "octocat");
  assert.equal(await readInvited(mapIo({ "/x/lh/invite.json": record }), { LITCLAUDE_HOME: "/x/lh", HOME: "/u" }), "octocat");
  assert.equal(await readInvited(mapIo({}), { HOME: "/u" }), null);
  assert.equal(await readInvited(mapIo({ "/u/.litclaude/invite.json": record }, new Set(["/u/.litclaude/invite.json"])), { HOME: "/u" }), null);
  assert.equal(await readInvited(mapIo({ "/u/.litclaude/invite.json": JSON.stringify({ version: 1, invitedBy: "-x", at: "y" }) }), { HOME: "/u" }), null);
});
