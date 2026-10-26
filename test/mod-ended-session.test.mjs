import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { readLitSnapshot } from "../plugins/litclaude/lib/mod/state.mjs";
import { settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";

// On the real host, after /exit or /clear, the next session's card kept a row
// `review-work review ━━ running 4m · other session 62776141` for the ended session's unfinished
// review, until its stack file was 15 minutes old. SessionEnd now marks that stack ended.

const hookPath = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));
const ENDED = "62776141-aaaa-bbbb-cccc-000000000001";
const VIEWER = "944bd38d-aaaa-bbbb-cccc-000000000002";

const runHook = (project, env, sessionId, event, input = {}) => {
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd: project,
    encoding: "utf8",
    env,
    input: JSON.stringify({ cwd: project, session_id: sessionId, prompt_id: "prompt-1", hook_event_name: event, ...input }),
  });
  assert.equal(result.status, 0, `${event}: ${result.stderr}`);
};

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

// The viewer's card as Claude Code draws it, one string per row.
const cardRows = async (project) => {
  const snapshot = await readLitSnapshot(io, { cwd: project, sessionId: VIEWER, env: {} });
  const model = buildBandModel({ snapshot, now: Date.now(), isWorking: true });
  return composeBand(model, settledSample(model), { columns: 120, glyphs: "basic", accent: "#5fd7ff" }).rows.map(rowText);
};

const withProject = async (body) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-ended-")));
  const env = { ...process.env, LITCLAUDE_HUD_STATE_ROOT: join(project, ".hud"), LITCLAUDE_DISABLE_UPDATE_CHECK: "1" };
  try {
    mkdirSync(join(project, ".git"));
    runHook(project, env, VIEWER, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "litclaude:lit-loop" } });
    runHook(project, env, ENDED, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "litclaude:review-work" } });
    return await body(project, env);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
};

const otherRow = (rows) => rows.find((row) => row.includes("other session 62776141"));

test("a live other session's unfinished review shows on this project's card", () => withProject(async (project) => {
  assert.match(otherRow(await cardRows(project)) ?? "", /review-work .*running/u);
}));

test("an ended session's unfinished review leaves the other cards at once", () => withProject(async (project, env) => {
  runHook(project, env, ENDED, "session-end", { reason: "clear" });
  assert.equal(otherRow(await cardRows(project)), undefined, (await cardRows(project)).join("\n"));
}));

test("an ended session that is resumed and moves again shows again", () => withProject(async (project, env) => {
  runHook(project, env, ENDED, "session-end", { reason: "prompt_input_exit" });
  runHook(project, env, ENDED, "pre-tool-use", { tool_name: "Skill", tool_input: { skill: "litclaude:review-work" } });
  assert.match(otherRow(await cardRows(project)) ?? "", /review-work/u);
}));

test("SessionEnd for a session with no stack writes none", () => withProject(async (project, env) => {
  runHook(project, env, "55555555-no-stack", "session-end", { reason: "other" });
  const stacks = readdirSync(join(project, ".litclaude", "workflow-stack")).filter((name) => name.startsWith("55555555"));
  assert.deepEqual(stacks, []);
}));
