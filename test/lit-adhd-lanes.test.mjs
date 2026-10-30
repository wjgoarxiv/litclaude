// lit-adhd with parallel lanes: while another session or herdr agent is still at work, the brief offers
// nothing for `go` and says not to type it; a HANDOFF Next item already marked done is never offered.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderBrief } from "../plugins/litclaude/lib/rewind/brief.mjs";
import { collectRewind } from "../plugins/litclaude/lib/rewind/collect.mjs";
import { progressOf } from "../plugins/litclaude/lib/rewind/gauge.mjs";
import { chooseNextStep } from "../plugins/litclaude/lib/rewind/next-step.mjs";

const NOW = Date.parse("2026-10-30T05:00:00Z");
const plan = { plan: "plans/c.md", local: true, current: "1. do it", progress: progressOf(0, 2) };
const base = { workflows: [], startWork: [], roadmap: { plans: [plan] }, sessions: [], herdr: { status: "ok", agents: [] } };
const lane = (over) => ({ agent: "claude", status: "working", pane: "w1:p2", id8: "lane0001", title: "lane", self: false, ...over });

test("a single open plan is offered for go only while no other lane is at work", () => {
  assert.equal(chooseNextStep(base, "s1").kind, "start-plan");
  const busySession = chooseNextStep({ ...base, sessions: [{ id8: "other001", status: "active", self: false }] }, "s1");
  assert.deepEqual(busySession, { kind: "none", target: null, wait: { lanes: 1 } });
  const busyAgent = chooseNextStep({ ...base, herdr: { status: "ok", agents: [lane(), lane({ pane: "w1:p3", id8: "lane0002", status: "blocked" })] } }, "s1");
  assert.deepEqual(busyAgent.wait, { lanes: 2 });
  assert.equal(chooseNextStep({ ...base, sessions: [{ id8: "lane0001", status: "active", self: false }], herdr: { status: "ok", agents: [lane()] } }, "s1").wait.lanes, 1, "one lane seen twice counts once");
  for (const quiet of [lane({ status: "idle" }), lane({ status: "done" }), lane({ self: true })]) {
    assert.equal(chooseNextStep({ ...base, herdr: { status: "ok", agents: [quiet] } }, "s1").kind, "start-plan", JSON.stringify(quiet));
  }
  assert.equal(chooseNextStep({ ...base, sessions: [{ id8: "self0001", status: "active", self: true }] }, "s1").kind, "start-plan");
});

test("while lanes work the brief says not to type go, in place of a stale handoff step", () => {
  const data = {
    generatedAt: new Date(NOW).toISOString(),
    sessions: [{ id8: "lane0001", worktree: "~/repo", branch: "main", status: "active", title: "lane", asked: ["x"], started: new Date(NOW - 60_000).toISOString(), last: new Date(NOW).toISOString(), result: "working", progress: progressOf(null, null), done: { tools: {}, files: [], commits: [] }, self: false }],
    roadmap: { plans: [plan], plansOmitted: 0 },
    handoffs: [{ local: true, next: "Ship the old release" }],
    next: { kind: "none", target: null, wait: { lanes: 1 } },
  };
  const ko = renderBrief(data, { lang: "ko", now: NOW });
  assert.match(ko, /`go`는 입력하지 마세요/u);
  assert.doesNotMatch(ko, /라고 입력하면 이어갑니다/u);
  assert.doesNotMatch(ko, /Ship the old release/u);
  assert.match(ko, /레인 1개가 아직 일하는 중/u);
  const en = renderBrief(data, { lang: "en", now: NOW });
  assert.match(en, /Do not type \*\*`go`\*\*/u);
  assert.doesNotMatch(en, /Ship the old release/u);
});

const withRepo = (fn) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "litclaude-adhd-lanes-")));
  const repo = join(home, "repo");
  mkdirSync(join(repo, "plans"), { recursive: true });
  try {
    return fn({ home, repo, env: { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") } });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};
const noGit = () => {
  throw new Error("no git");
};

test("a HANDOFF Next item already marked done is skipped for the first open one", () => withRepo(({ repo, env }) => {
  writeFileSync(join(repo, "HANDOFF.md"), "# Handoff\n\n## Next Steps\n1. **1.0.43 SHIPPED** with provenance\n2. Siblings DONE (pushed)\n3. ✅ hub bound\n4. ~~old idea~~\n- [x] ticked\n5. Run the Linux check\n");
  assert.equal(collectRewind({ cwd: repo, env, now: NOW, exec: noGit, here: true }).handoffs[0].next, "Run the Linux check");
}));

test("herdr's JSON agent list is read: this workspace or project only, own pane marked, and a working lane holds go", () => withRepo(({ home, repo, env }) => {
  writeFileSync(join(repo, "plans", "c.md"), "# C\n\n## TODOs\n\n- [ ] 1. do it\n- [ ] 2. then this\n");
  const agent = (pane, status, workspace, cwd, session) => ({ agent: "claude", agent_status: status, pane_id: pane, workspace_id: workspace, cwd, foreground_cwd: cwd, terminal_title_stripped: `t-${pane}`, agent_session: { value: session } });
  const list = { id: "cli:agent:list", result: { agents: [
    agent("w1:p1", "working", "w1", repo, "self0000-0000"),
    agent("w1:p2", "working", "w1", join(home, "elsewhere"), "lane0001-0000"),
    agent("w9:p1", "working", "w9", join(repo, "sub"), "lane0002-0000"),
    agent("w9:p2", "working", "w9", join(home, "unrelated"), "lane0003-0000"),
  ] } };
  const exec = (file) => {
    if (file === "herdr") return `${JSON.stringify(list)}\n`;
    throw new Error("no git");
  };
  const data = collectRewind({ cwd: repo, env: { ...env, HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, now: NOW, exec, here: true, sessionId: "self0000-0000" });
  assert.equal(data.sources.herdr, "ok");
  assert.deepEqual(data.herdr.agents.map(({ pane, status, self, id8 }) => ({ pane, status, self, id8 })), [
    { pane: "w1:p1", status: "working", self: true, id8: "self0000" },
    { pane: "w1:p2", status: "working", self: false, id8: "lane0001" },
    { pane: "w9:p1", status: "working", self: false, id8: "lane0002" },
  ]);
  assert.deepEqual(data.next.wait, { lanes: 2 });
  assert.equal(data.next.say, undefined);
}));
