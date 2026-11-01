// A session that finished its turn and sat idle must read as idle in the lit-adhd brief, not as a
// lane that is still at work. Real case 2026-11-01: lane "film" (401c4d9c) ended its turn, but a
// paused litresearch frame from a day earlier stayed in its workflow stack, the stack marked it
// waiting-on-user, and that status was exempt from the Stop hook's idle record, so the brief told
// the user to wait for a lane that was not running.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { renderBrief } from "../plugins/litclaude/lib/rewind/brief.mjs";
import { collectRewind } from "../plugins/litclaude/lib/rewind/collect.mjs";
import { projectSlug } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

const NOW = Date.parse("2026-11-01T07:12:00.000Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const FILM = "401c4d9c-b93c-477e-926e-2355f065c904";
const SELF = "99999999-aaaa-bbbb-cccc-000000000009";
const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});

const project = ({ livenessState, lastText = "다음 주문을 기다릴게요.", lastMinutesAgo = 6 }) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "adhd-idle-")));
  cleanups.push(home);
  const repo = join(home, "repo");
  mkdirSync(join(repo, ".litclaude", "workflow-stack"), { recursive: true });
  mkdirSync(join(repo, ".litclaude", "liveness"), { recursive: true });
  const configDir = join(home, ".claude");
  const folder = join(configDir, "projects", projectSlug(repo));
  mkdirSync(folder, { recursive: true });
  const transcript = (id, text, minutesAgo) => writeFileSync(join(folder, `${id}.jsonl`), [
    { type: "user", sessionId: id, cwd: repo, gitBranch: "main", timestamp: iso(minutesAgo + 3), message: { role: "user", content: "go" } },
    { type: "assistant", sessionId: id, timestamp: iso(minutesAgo), message: { role: "assistant", content: [{ type: "text", text }] } },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  transcript(FILM, lastText, lastMinutesAgo);
  transcript(SELF, "ok", 1);
  // The stale spine frame: paused yesterday, never resumed.
  writeFileSync(join(repo, ".litclaude", "workflow-stack", `${FILM}.json`), JSON.stringify({
    version: 1,
    sessionId: FILM,
    frames: [{ skill: "litresearch", family: "research", stage: "decompose", role: "spine", status: "paused", at: "2026-10-31T16:05:18.205Z" }],
  }));
  if (livenessState) {
    writeFileSync(join(repo, ".litclaude", "liveness", `${FILM}.json`), JSON.stringify({ version: 1, sessionId: FILM, state: livenessState, at: iso(lastMinutesAgo - 0.05), herdrPane: "w2B:pAF" }));
  }
  const noExec = () => {
    throw new Error("no git");
  };
  return collectRewind({ cwd: repo, here: true, env: { HOME: home, CLAUDE_CONFIG_DIR: configDir }, now: NOW, exec: noExec, sessionId: SELF, record: false });
};
const film = (data) => data.sessions.find((session) => session.id8 === "401c4d9c");

test("an idle session with a stale paused frame is idle, not a lane at work", () => {
  const data = project({ livenessState: "idle" });
  assert.equal(film(data).status, "idle");
  assert.equal(data.next.wait, undefined, JSON.stringify(data.next));
  const ko = renderBrief(data, { lang: "ko", now: NOW });
  assert.doesNotMatch(ko, /아직 일하는 중/u);
  assert.doesNotMatch(renderBrief(data, { lang: "en", now: NOW }), /still at work/u);
});

test("an ended session with a stale paused frame is ended, not a lane at work", () => {
  const data = project({ livenessState: "ended" });
  assert.equal(film(data).status, "ended");
  assert.equal(data.next.wait, undefined);
});

test("control: the same session still counts as a lane while its hook record says alive, or there is none", () => {
  for (const livenessState of ["alive", null]) {
    const data = project({ livenessState });
    assert.equal(film(data).status, "waiting-on-user", String(livenessState));
    assert.deepEqual(data.next.wait, { lanes: 1 }, String(livenessState));
  }
});

test("control: a session that asked the user a question stays waiting even when its turn ended", () => {
  const data = project({ livenessState: "idle", lastText: "어느 쪽으로 할까요?" });
  assert.equal(film(data).status, "waiting-on-user");
  assert.deepEqual(data.next.wait, { lanes: 1 });
});
