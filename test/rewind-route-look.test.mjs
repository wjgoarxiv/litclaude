// Every route that runs lit-adhd or lit-rewind switches the LIT card to the rewind look.
// Before this fix a bare `lit adhd` did, but a typed `/lit-adhd` ran the brief under the normal look
// (`WORK ●`): the prompt hook recorded no discipline for the slash form, and a Skill tool load,
// which never reaches the prompt hook, lit only a chip. Each case drives the real prompt hook and
// reads its record through the card's own parser before it composes a frame.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { motionProfile } from "../plugins/litclaude/lib/mod/motion.mjs";
import { parseIgnition } from "../plugins/litclaude/lib/mod/state.mjs";
import { createTimeline, sampleTimeline } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins", "litclaude", "bin", "litclaude-hook.js");
const SESSION = "rewind-route-01";
const snapshotOf = (ignition) => ({ ignition, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const frameOf = (model) => {
  const profile = motionProfile("full");
  return composeBand(model, sampleTimeline(createTimeline(model, 0, profile), 1000, profile), { columns: 100, glyphs: "basic", accent: "#5fd7ff" });
};

const withHook = (body) => {
  const tmp = mkdtempSync(join(tmpdir(), "litclaude-rewind-route-"));
  try {
    mkdirSync(join(tmp, "workspace"));
    const env = { ...process.env, HOME: tmp, LITCLAUDE_HUD_STATE_ROOT: join(tmp, "hud") };
    body((prompt) => {
      const run = spawnSync(process.execPath, [hookPath, "user-prompt-submit"], { cwd: root, encoding: "utf8", env, input: JSON.stringify({ session_id: SESSION, cwd: join(tmp, "workspace"), prompt, hook_event_name: "UserPromptSubmit" }) });
      assert.equal(run.status, 0, run.stderr);
      return parseIgnition(JSON.parse(readFileSync(join(tmp, "hud", `${SESSION}.json`), "utf8")), SESSION);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

test("a typed /lit-adhd or /lit-rewind, with or without the plugin prefix, turns the card to the rewind look", () => {
  withHook((submit) => {
    for (const [prompt, discipline] of [["lit adhd", "lit-adhd"], ["/lit-adhd", "lit-adhd"], ["/litclaude:lit-adhd", "lit-adhd"], ["/lit-adhd --here", "lit-adhd"], ["/lit-rewind", "lit-rewind"], ["/litclaude:lit-rewind --since 2d", "lit-rewind"]]) {
      const ignition = submit(prompt);
      assert.equal(ignition?.discipline, discipline, prompt);
      for (const isWorking of [true, false]) {
        const model = buildBandModel({ snapshot: snapshotOf(ignition), now: ignition.at + 1000, isWorking });
        assert.equal(model.rewind, true, `${prompt} working=${isWorking}`);
        const frame = frameOf(model);
        assert.equal(frame.look, "rewind", prompt);
        assert.match(rowText(frame.rows[0]), /REWIND <</u, prompt);
        assert.doesNotMatch(rowText(frame.rows[0]), /WORK/u, prompt);
      }
    }
  });
});

test("only the typed command routes: a near name or a later mention keeps the normal look", () => {
  withHook((submit) => {
    for (const prompt of ["/lit-adhdx", "/litclaude:lit-adhd-notes", "please explain /lit-adhd to me", "/lit-loop"]) {
      const ignition = submit(prompt);
      assert.notEqual(ignition?.discipline, "lit-adhd", prompt);
      assert.notEqual(ignition?.discipline, "lit-rewind", prompt);
      if (ignition) assert.equal(buildBandModel({ snapshot: snapshotOf(ignition), now: ignition.at + 1000, isWorking: true }).rewind, false, prompt);
    }
  });
});

test("a Skill tool load of lit-adhd in this turn turns the look on, and the next turn ends it", () => {
  const turnStartedAt = 5_000_000;
  const fired = turnStartedAt + 2000;
  for (const id of ["lit-adhd", "lit-rewind"]) {
    const during = buildBandModel({ snapshot: snapshotOf(null), now: fired + 500, isWorking: true, turnStartedAt, skills: [{ id, at: fired, state: "current" }], lastDiscipline: id });
    assert.equal(during.rewind, true, id);
    assert.equal(frameOf(during).look, "rewind");
    assert.match(rowText(frameOf(during).rows[0]), /REWIND <</u);
    const read = buildBandModel({ snapshot: snapshotOf(null), now: fired + 60_000, isWorking: false, turnStartedAt, skills: [{ id, at: fired, state: "recent" }], lastDiscipline: id });
    assert.equal(read.rewind, true, "the look stays while the user reads the brief");
    const nextTurn = buildBandModel({ snapshot: snapshotOf(null), now: fired + 90_000, isWorking: true, turnStartedAt: fired + 80_000, skills: [{ id, at: fired, state: "recent" }], lastDiscipline: id });
    assert.equal(nextTurn.rewind, false, "the next prompt ends it");
  }
  const other = buildBandModel({ snapshot: snapshotOf(null), now: fired + 500, isWorking: true, turnStartedAt, skills: [{ id: "lit-loop", at: fired, state: "current" }] });
  assert.equal(other.rewind, false, "another skill keeps its look");
});
