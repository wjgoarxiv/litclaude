// A work that start-work cancelled or finished is not running. Another session's stack keeps its
// start-work frame until that session ends, so a new session's card drew the frame of a cancelled
// work as `start-work · <pane> work 5/11 running`. The card reads boulder.json for the verdict.
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { parseWorkflowStack, readLitSnapshot, settledPlansOf } from "../plugins/litclaude/lib/mod/state.mjs";
import { settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

const NOW = 10_000_000;
const SID = "11111111-aaaa-bbbb-cccc-000000000001";
const OTHER = "22222222-aaaa-bbbb-cccc-000000000002";
const PLAN = "plans/2026-11-01-litclaude-lit-lanes.md";
const iso = (ms) => new Date(ms).toISOString();
const idle = () => ({ ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null });
const startWork = () => ({ skill: "start-work", family: "main", stage: "work", role: "side", status: "active", verdicts: {}, at: iso(NOW - 2000), ref: { plan: PLAN }, n: 5, total: 11 });
const otherSession = (extra = {}) => ({
  sessionId: OTHER,
  id8: "22222222",
  at: NOW - 5000,
  frames: parseWorkflowStack({ version: 1, sessionId: OTHER, frames: [startWork()], history: [] }, OTHER).frames,
  liveness: { state: "alive", at: NOW - 5000, herdrPane: "w2B:p61" },
  ...extra,
});
// The shape boulder.json keeps: absolute plan paths, one record per work, active_work_id null after a cancel.
const boulder = (works) => ({
  schema_version: 3,
  revision: 56,
  active_work_id: null,
  works: Object.fromEntries(works.map(([id, status, plan]) => [id, { work_id: id, status, active_plan: `/abs/root/${plan}`, plan_name: plan.split("/").at(-1) }])),
});
const cardRows = (snapshot) => composeBand(buildBandModel({ snapshot, now: NOW, isWorking: true }), settledSample(buildBandModel({ snapshot, now: NOW, isWorking: true })), { columns: 100, glyphs: "basic", accent: "#5fd7ff" }).rows.map(rowText);
const snapshotOf = (settledPlans, others = [otherSession()]) => ({
  ...idle(),
  settledPlans,
  workflow: { sessionId: SID, stack: null, record: null, others, liveness: { [OTHER]: { state: "alive", at: NOW - 5000, herdrPane: "w2B:p61" } } },
});

test("settledPlansOf: cancelled and completed works settle their plan; a plan with a live work does not", () => {
  const state = boulder([
    ["w-cancelled", "cancelled", PLAN],
    ["w-done", "completed", "plans/done.md"],
    ["w-old", "cancelled", "plans/again.md"],
    ["w-live", "active", "plans/again.md"],
    ["w-paused", "paused", "plans/waiting.md"],
  ]);
  assert.deepEqual([...settledPlansOf(state)].sort(), ["2026-11-01-litclaude-lit-lanes.md", "done.md"]);
  assert.deepEqual(settledPlansOf(null), []);
  assert.deepEqual(settledPlansOf({ works: "junk" }), []);
});

test("a cancelled work's start-work frame in another session's herdr pane is not drawn as running", () => {
  const rows = cardRows(snapshotOf(settledPlansOf(boulder([["w1", "cancelled", PLAN]]))));
  assert.doesNotMatch(rows.join("\n"), /start-work/u, rows.join("\n"));
  assert.doesNotMatch(rows.join("\n"), /5\/11/u, rows.join("\n"));
});

test("the same frame without a pane (an other-session row) is not drawn as running either", () => {
  const other = otherSession({ liveness: null });
  const rows = cardRows(snapshotOf(settledPlansOf(boulder([["w1", "completed", PLAN]])), [other]));
  assert.doesNotMatch(rows.join("\n"), /start-work/u, rows.join("\n"));
});

test("control: the same frame still runs while its work is active, or unknown to boulder", () => {
  for (const settled of [settledPlansOf(boulder([["w1", "active", PLAN]])), settledPlansOf(boulder([]))]) {
    const rows = cardRows(snapshotOf(settled));
    assert.match(rows.join("\n"), /● start-work · w2B:p61 +work +\[▉▉▉▉░░░░░░\] 5\/11 running/u, rows.join("\n"));
  }
});

test("readLitSnapshot reads boulder.json and hands the card the settled plans", async () => {
  const root = mkdtempSync(join(tmpdir(), "lit-cancelled-"));
  try {
    mkdirSync(join(root, ".litclaude"), { recursive: true });
    writeFileSync(join(root, ".litclaude", "boulder.json"), JSON.stringify(boulder([["w1", "cancelled", PLAN]])));
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
      list: async (path) => {
        try {
          return readdirSync(path).map((name) => {
            const s = lstatSync(join(path, name));
            return { name, kind: kindOf(s), isLink: s.isSymbolicLink(), mtimeMs: s.mtimeMs, size: s.size };
          });
        } catch {
          return [];
        }
      },
    };
    const snapshot = await readLitSnapshot(io, { cwd: root, sessionId: SID, env: {} });
    assert.deepEqual(snapshot.settledPlans, ["2026-11-01-litclaude-lit-lanes.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
