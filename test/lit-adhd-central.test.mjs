// BRIEF-feedback-1038 C: lit-adhd is offered where a returning user looks. The idle card names it
// after a break, a SessionStart in a repo with other recent sessions suggests it once a day, and
// the handoff skill points at it as the way to read every session at once.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { composeBand, rowText } from "../plugins/litclaude/lib/mod/frame.mjs";
import { composeSvgCard } from "../plugins/litclaude/lib/mod/svg-card.mjs";
import { settledSample } from "../plugins/litclaude/lib/mod/timeline.mjs";
import { BREAK_MS, buildBandModel } from "../plugins/litclaude/lib/mod/view.mjs";
import { projectSlug } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "plugins", "litclaude");
const NOW = 50_000_000;
const idle = { ignition: null, work: null, completedWorkIds: [], goal: null, autoloop: null, litPlan: null, probe: null, motion: null, handoff: null };
const cardAfter = (awayMs, columns = 100) => {
  const model = buildBandModel({ snapshot: idle, now: NOW, skills: [{ id: "lit-loop", at: NOW - awayMs, state: "recent" }], lastDiscipline: "lit-loop" });
  return { model, text: composeBand(model, settledSample(model), { columns, glyphs: "basic", accent: "#5fd7ff" }).rows.map(rowText).join("\n") };
};

test("the idle card offers lit adhd after a break, and not while the work is fresh", () => {
  for (const columns of [60, 100]) {
    const { text } = cardAfter(BREAK_MS + 60_000, columns);
    assert.match(text, /lit adhd/u, `${columns} columns:\n${text}`);
    assert.match(text, /lit-loop/u, "the chips stay");
  }
  assert.doesNotMatch(cardAfter(60_000).text, /lit adhd/u);
  const { model } = cardAfter(BREAK_MS + 60_000);
  assert.match(composeSvgCard(model, { motion: "off" }).source, /lit adhd/u);
  assert.ok(BREAK_MS >= 15 * 60_000 && BREAK_MS <= 2 * 60 * 60_000);
});

const hook = (cwd, configDir, sessionId) => {
  const result = spawnSync(process.execPath, [join(plugin, "bin", "litclaude-hook.js"), "session-start"], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({ cwd, session_id: sessionId, source: "startup" }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CI: "1", LITCLAUDE_NO_AUTO_UPDATE: "1", CLAUDE_CODE_SESSION_ID: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("SessionStart suggests lit adhd once a day in a repo with other recent sessions", () => {
  const base = mkdtempSync(join(tmpdir(), "litclaude-adhd-central-"));
  try {
    const cwd = join(base, "repo");
    const configDir = join(base, "claude");
    mkdirSync(join(cwd, ".git"), { recursive: true });
    const folder = join(configDir, "projects", projectSlug(cwd));
    mkdirSync(folder, { recursive: true });
    const quiet = hook(cwd, configDir, "s-0");
    assert.doesNotMatch(`${quiet.systemMessage ?? ""}${quiet.hookSpecificOutput.additionalContext}`, /lit adhd/u, "no other session, no suggestion");

    const old = join(folder, "11111111-0000-0000-0000-000000000000.jsonl");
    writeFileSync(old, `${JSON.stringify({ cwd, type: "user" })}\n`);
    const stale = (Date.now() - 10 * 24 * 3600_000) / 1000;
    utimesSync(old, stale, stale);
    assert.doesNotMatch(hook(cwd, configDir, "s-1").systemMessage ?? "", /lit adhd/u, "a session from ten days ago is not recent");

    for (const id of ["22222222", "33333333"]) writeFileSync(join(folder, `${id}-0000-0000-0000-000000000000.jsonl`), `${JSON.stringify({ cwd, type: "user" })}\n`);
    const first = hook(cwd, configDir, "s-2");
    assert.match(first.systemMessage ?? "", /2 other recent sessions here · type `lit adhd` for a one-screen brief/u);
    assert.match(first.hookSpecificOutput.additionalContext, /lit adhd/u);
    const second = hook(cwd, configDir, "s-3");
    assert.doesNotMatch(`${second.systemMessage ?? ""}${second.hookSpecificOutput.additionalContext}`, /lit adhd/u, "once a day");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the handoff skill points at lit adhd for reading every session at once", () => {
  const body = readFileSync(join(plugin, "skills", "lit-handoff", "SKILL.md"), "utf8");
  assert.match(body, /`lit adhd`/u);
});
