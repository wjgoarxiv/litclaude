// The lit-adhd collector (plans/lit-adhd.md todo 10): transcripts are found by slug or by the cwd
// they record, read head and tail under one budget without following links, and turned into
// redacted records; every other source reads `ok` or `unknown`; the next step follows its fixed
// priority; gauges are drawn by code (D9) and never guess a total.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { renderBrief } from "../plugins/litclaude/lib/rewind/brief.mjs";
import { collectRewind, parseSince, renderRewind, runRewindCli } from "../plugins/litclaude/lib/rewind/collect.mjs";
import { aggregateProgress, clipToWidth, displayWidth, gauge, progressOf } from "../plugins/litclaude/lib/rewind/gauge.mjs";
import { chooseNextStep, nextStepPath } from "../plugins/litclaude/lib/rewind/next-step.mjs";
import { makeRedactor } from "../plugins/litclaude/lib/rewind/redact.mjs";
import { findTranscripts, makeBudget, projectSlug, readTranscriptLines, sessionRecord } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});
const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rewind-")));
  cleanups.push(dir);
  return dir;
};

const userLine = (sessionId, cwd, text, minutesAgo, extra = {}) => ({
  type: "user", sessionId, cwd, gitBranch: "lane/x", timestamp: iso(minutesAgo), promptId: `p-${minutesAgo}`,
  message: { role: "user", content: text }, ...extra,
});
const assistantLine = (sessionId, content, minutesAgo, extra = {}) => ({
  type: "assistant", sessionId, timestamp: iso(minutesAgo), message: { role: "assistant", content }, ...extra,
});
const writeTranscript = (configDir, cwd, sessionId, lines, folder = projectSlug(cwd)) => {
  const dir = join(configDir, "projects", folder);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`);
  return path;
};
const noGit = () => {
  throw new Error("no git");
};
const fixture = () => {
  const home = scratch();
  const repo = join(home, "repo");
  mkdirSync(repo, { recursive: true });
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
  return { home, repo, env, configDir: env.CLAUDE_CONFIG_DIR };
};

test("gauges: one cell per item up to ten, scaled above, unknown totals never guessed", () => {
  assert.equal(gauge(3, 5), "[▉▉▉░░] 3/5");
  assert.equal(gauge(0, 3), "[░░░] 0/3");
  assert.equal(gauge(5, 5), "[▉▉▉▉▉] 5/5");
  assert.equal(gauge(1, 40), "[▉░░░░░░░░░] 1/40");
  assert.equal(gauge(39, 40), "[▉▉▉▉▉▉▉▉▉░] 39/40");
  assert.equal(gauge(40, 40), "[▉▉▉▉▉▉▉▉▉▉] 40/40");
  assert.equal(gauge(2, null), null);
  assert.equal(gauge(null, null), null);
  assert.deepEqual(progressOf(2, null).remaining, ["unknown"]);
  assert.deepEqual(progressOf(3, 3).remaining, []);
  assert.equal(aggregateProgress([progressOf(1, 2), progressOf(2, 3)]).gauge, "[▉▉▉░░] 3/5");
  assert.equal(aggregateProgress([progressOf(1, 2), progressOf(2, null)]).gauge, null);
});

test("display width counts Hangul as two columns and clips at 60, 80 and 100", () => {
  assert.equal(displayWidth("가나다"), 6);
  assert.equal(displayWidth("가"), 2);
  assert.equal(displayWidth("abc"), 3);
  const long = "남은 작업: 세션 브리핑을 렌더링하고 게이지를 그린 다음 검증합니다 ".repeat(6);
  for (const width of [60, 80, 100]) {
    const clipped = clipToWidth(long, width);
    assert.ok(displayWidth(clipped) <= width, `width ${width}`);
    assert.ok(clipped.endsWith("…"));
  }
  assert.equal(clipToWidth("short", 60), "short");
});

test("redaction masks credential shapes, secret assignments, env values and URI userinfo", () => {
  const injected = "s3cr3t-value-from-env-9921";
  const redact = makeRedactor({ env: { HOME: "/Users/someone", MY_SERVICE_VALUE: injected, LANG: "ko_KR.UTF-8", PWD: "/Users/someone/repo" }, home: "/Users/someone" });
  const text = redact(`key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and OPENAI_API_KEY=abc123def456 and ${injected} at https://user:pw@host.example/x in /Users/someone/repo`);
  assert.doesNotMatch(text, /sk-proj-ABCDEF/u);
  assert.doesNotMatch(text, /abc123def456/u);
  assert.doesNotMatch(text, new RegExp(injected, "u"));
  assert.doesNotMatch(text, /user:pw/u);
  assert.match(text, /\/\/\[redacted\]@host\.example/u);
  assert.match(text, /in ~\/repo/u);
  assert.equal(redact("ko_KR.UTF-8 stays"), "ko_KR.UTF-8 stays");
});

test("transcripts are found by slug, or by the cwd they record when the slug folder is missing", () => {
  const { repo, configDir } = fixture();
  assert.equal(projectSlug("/Users/a b/라이프.x"), "-Users-a-b-----x");
  const bySlug = writeTranscript(configDir, repo, "aaaa1111", [userLine("aaaa1111", repo, "hello", 10)]);
  assert.deepEqual(findTranscripts(configDir, [repo]).files, [bySlug]);
  const other = join(repo, "..", "other");
  const byCwd = writeTranscript(configDir, other, "bbbb2222", [userLine("bbbb2222", other, "hi", 5)], "renamed-folder");
  assert.deepEqual(findTranscripts(configDir, [other]).files, [byCwd]);
  assert.equal(findTranscripts(join(configDir, "missing"), [repo]).status, "unknown");
});

test("a session record skips sidechains and malformed lines, prefers the custom title, and spots a question", () => {
  const { repo, configDir } = fixture();
  const path = writeTranscript(configDir, repo, "cccc3333", [
    userLine("cccc3333", repo, "build the brief", 30),
    "{not json",
    { type: "ai-title", sessionId: "cccc3333", aiTitle: "AI named it" },
    { type: "custom-title", sessionId: "cccc3333", customTitle: "Named by the user" },
    userLine("cccc3333", repo, "sidechain prompt", 29, { isSidechain: true }),
    assistantLine("cccc3333", [{ type: "tool_use", name: "Write", input: { file_path: join(repo, "a.txt") } }], 20),
    assistantLine("cccc3333", [{ type: "text", text: "Done. Should I commit this now?" }], 5),
  ]);
  const record = sessionRecord(readTranscriptLines(path, makeBudget()), { now: NOW });
  assert.equal(record.title, "Named by the user");
  assert.deepEqual(record.asked, ["build the brief"]);
  assert.deepEqual(record.done.files, ["a.txt"]);
  assert.equal(record.done.tools.Write, 1);
  assert.equal(record.status, "waiting-on-user");
  assert.equal(record.branch, "lane/x");

  const titled = sessionRecord([userLine("dddd", repo, "first", 400), { type: "ai-title", sessionId: "dddd", aiTitle: "AI named it" }], { now: NOW });
  assert.equal(titled.title, "AI named it");
  assert.equal(titled.status, "ended");
  assert.equal(sessionRecord([userLine("eeee", repo, "p", 3, { isSidechain: true })]), null);
});

// Real-session QA (plans/lit-adhd.md todo 14, S4): a session opened with a typed slash command
// stores the command in tags, and the brief showed it as untitled with nothing asked.
test("a typed slash command is read as the session's ask and title; a bare built-in is not", () => {
  const { repo } = fixture();
  const slash = "<command-message>litclaude:start-work</command-message>\n<command-name>/litclaude:start-work</command-name>\n<command-args>plans/add-multiply.md</command-args>";
  const record = sessionRecord([
    userLine("ffff6666", repo, slash, 9),
    userLine("ffff6666", repo, [{ type: "text", text: "## #contract.activation expanded command body" }], 9, { isMeta: true }),
    userLine("ffff6666", repo, "<command-name>/exit</command-name>\n<command-args></command-args>", 2),
  ], { now: NOW });
  assert.equal(record.title, "/litclaude:start-work plans/add-multiply.md");
  assert.deepEqual(record.asked, ["/litclaude:start-work plans/add-multiply.md"]);
  assert.equal(sessionRecord([userLine("gggg", repo, "<local-command-stdout>bye</local-command-stdout>", 2)], { now: NOW }).title, "unknown");
});

test("a linked transcript is refused and the shared budget caps 50 MB of transcripts at 8 MiB", () => {
  const { repo, configDir, env } = fixture();
  const real = writeTranscript(configDir, repo, "ffff0000", [userLine("ffff0000", repo, "x", 1)]);
  const link = join(configDir, "projects", projectSlug(repo), "link.jsonl");
  symlinkSync(real, link);
  assert.equal(readTranscriptLines(link, makeBudget()), null);
  rmSync(link);

  const filler = `${JSON.stringify(assistantLine("big", [{ type: "text", text: "y".repeat(900) }], 2))}\n`;
  for (let index = 0; index < 50; index += 1) {
    const id = `big${String(index).padStart(5, "0")}`;
    const head = `${JSON.stringify(userLine(id, repo, "big one", 2))}\n`;
    writeTranscript(configDir, repo, id, [head.trim(), ...Array(Math.ceil((1024 * 1024) / filler.length)).fill(filler.trim())]);
  }
  const data = collectRewind({ cwd: repo, env, now: NOW, exec: noGit, max: 50 });
  assert.ok(data.budget.bytesRead <= 8 * 1024 * 1024);
  assert.equal(data.budget.limit, 8 * 1024 * 1024);
  assert.ok(data.sessions.length >= 1);
});

test("missing sources read unknown and an empty HOME still returns a brief", () => {
  const home = scratch();
  const data = collectRewind({ cwd: home, env: { HOME: home }, now: NOW, exec: noGit });
  assert.equal(data.sessions.length, 0);
  for (const name of ["transcripts", "litgoal", "plans", "handoffs", "git", "workflowStack", "startWork", "herdr"]) {
    assert.equal(data.sources[name], "unknown", name);
  }
  assert.equal(data.roadmap.progress.gauge, null);
  assert.equal(data.next.kind, "none");
  assert.match(renderRewind(data), /unknown: transcripts/u);
});

// Real-session QA (plans/lit-adhd.md todo 14, S5): the brief showed a running start-work at the
// lifecycle's last stored snapshot (0/3) while its plan was fully checked (3/3).
test("a running start-work's gauge reads its plan's checkboxes, not the stored snapshot", () => {
  const { repo, env } = fixture();
  mkdirSync(join(repo, "plans"));
  writeFileSync(join(repo, "plans", "p.md"), "# P\n- [x] 1. a\n- [x] 2. b\n- [ ] 3. c\n");
  mkdirSync(join(repo, ".litclaude"), { recursive: true });
  const work = { work_id: "work-p", status: "active", plan_name: "p.md", root_session_id: "owner-1", progress: { checked: 0, total: 3, next_task: "1. a" } };
  writeFileSync(join(repo, ".litclaude", "boulder.json"), JSON.stringify({ active_work_id: "work-p", works: { "work-p": work } }));
  const [entry] = collectRewind({ cwd: repo, env, now: NOW, exec: noGit, here: true }).startWork;
  assert.equal(entry.progress.gauge, "[▉▉░] 2/3");
  assert.deepEqual(entry.progress.remaining, ["3. c"]);
  writeFileSync(join(repo, ".litclaude", "boulder.json"), JSON.stringify({ active_work_id: "work-p", works: { "work-p": { ...work, plan_name: "../outside.md" } } }));
  assert.equal(collectRewind({ cwd: repo, env, now: NOW, exec: noGit, here: true }).startWork[0].progress.gauge, "[░░░] 0/3", "an odd plan name falls back to the snapshot");
});

test("plans, litgoal, handoffs, stacks and git all feed the brief with redacted text", () => {
  const { repo, configDir, env, home } = fixture();
  mkdirSync(join(repo, "plans"));
  writeFileSync(join(repo, "plans", "one.md"), "# One\n- [x] first\n- [ ] second with OPENAI_API_KEY=abc123def456\n- [ ] third\n");
  writeFileSync(join(repo, "plans", "done.md"), "- [x] all\n");
  mkdirSync(join(repo, ".litclaude", "litgoal"), { recursive: true });
  writeFileSync(join(repo, ".litclaude", "litgoal", "goals.json"), JSON.stringify({ objective: "ship it", status: "active", criteria: [{ id: "c1", status: "passed" }, { id: "c2", description: "two", status: "pending" }] }));
  writeFileSync(join(repo, "HANDOFF.md"), "# Handoff\n## Now\nbody\n");
  mkdirSync(join(repo, ".litclaude", "workflow-stack"), { recursive: true });
  writeFileSync(join(repo, ".litclaude", "workflow-stack", "s-self.json"), JSON.stringify({ version: 1, sessionId: "s-self", frames: [{ skill: "lit-loop", stage: "verify", role: "spine", status: "paused", n: 2, total: 4, at: iso(3) }, { skill: "lit-recap", role: "side", status: "active", at: iso(1) }] }));
  writeTranscript(configDir, repo, "s-self", [userLine("s-self", repo, "go on", 4), assistantLine("s-self", [{ type: "text", text: "working" }], 2)]);
  const exec = (file, args) => {
    assert.equal(file, "git");
    if (args[0] === "worktree") return `worktree ${repo}\nHEAD abc\nbranch refs/heads/lane/x\n`;
    if (args[0] === "rev-parse") return "lane/x\n";
    return `abcdef1234\t${iso(3)}\tfeat: thing\n`;
  };
  const data = collectRewind({ cwd: repo, env, now: NOW, exec, sessionId: "s-self" });
  assert.deepEqual(Object.entries(data.sources).filter(([, status]) => status !== "ok").map(([name]) => name), ["startWork", "herdr"]);
  assert.equal(data.roadmap.plans.length, 1);
  const [plan] = data.roadmap.plans;
  assert.equal(plan.progress.gauge, "[▉░░] 1/3");
  assert.match(plan.current, /^second with .*\[redacted\]$/u);
  assert.equal(data.roadmap.litgoal[0].progress.gauge, "[▉░] 1/2");
  assert.equal(data.roadmap.progress.gauge, "[▉▉░░░] 2/5");
  assert.deepEqual(data.handoffs[0].headings, ["# Handoff", "## Now"]);
  assert.equal(data.workflows[0].progress.gauge, "[▉▉░░] 2/4");
  const [session] = data.sessions;
  assert.equal(session.self, true);
  assert.equal(session.status, "waiting-on-user");
  assert.deepEqual(session.done.commits, [{ hash: "abcdef1", subject: "feat: thing" }]);
  assert.equal(data.next.kind, "resume-frame");
  assert.equal(data.next.say, "lit continue");
  assert.ok(data.nextRecorded);
  const recorded = JSON.parse(readFileSync(nextStepPath(repo, "s-self"), "utf8"));
  assert.equal(recorded.kind, "resume-frame");
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /abc123def456/u);
  assert.ok(!text.includes(home));
  assert.equal(data.workflows[0].sessionId, undefined);
});

test("next step priority: frame, boundary, own work, single plan, none", () => {
  const base = { workflows: [], startWork: [], roadmap: { plans: [] } };
  const frame = { sessionId: "s1", role: "spine", status: "paused", skill: "lit-loop", stage: "verify", progress: progressOf(1, 2) };
  const boundary = { status: "paused", workId: "w", plan: "plans/a.md", pendingBoundary: { action: "read", root: "/x" }, sessionId: "s2" };
  const ownWork = { status: "active", workId: "w2", plan: "plans/b.md", sessionId: "s1" };
  const plan = { plan: "plans/c.md", local: true, progress: progressOf(0, 2) };
  assert.equal(chooseNextStep({ ...base, workflows: [frame], startWork: [boundary] }, "s1").kind, "resume-frame");
  const approve = chooseNextStep({ ...base, startWork: [boundary] }, "s1");
  assert.equal(approve.kind, "approve-boundary");
  assert.equal(approve.automatic, false);
  assert.equal(chooseNextStep({ ...base, startWork: [ownWork] }, "s1").kind, "continue-work");
  const start = chooseNextStep({ ...base, roadmap: { plans: [plan] } }, "s1");
  assert.equal(start.kind, "start-plan");
  assert.equal(start.command, "/litclaude:start-work plans/c.md");
  assert.equal(chooseNextStep({ ...base, roadmap: { plans: [plan, { ...plan, plan: "plans/d.md" }] } }, "s1").kind, "none");
  assert.equal(chooseNextStep({ ...base, workflows: [frame] }, null).kind, "none");
});

test("--here keeps to this folder, herdr is asked only under HERDR_ENV=1, and the CLI rejects unknown flags", () => {
  const { repo, configDir, env } = fixture();
  const other = join(repo, "..", "sibling");
  mkdirSync(other);
  writeTranscript(configDir, repo, "here0001", [userLine("here0001", repo, "mine", 4)]);
  writeTranscript(configDir, other, "else0001", [userLine("else0001", other, "theirs", 4)]);
  const calls = [];
  const exec = (file, args) => {
    calls.push([file, ...args].join(" "));
    if (file === "herdr") return `${JSON.stringify({ result: { agents: [{ agent: "claude", agent_status: "working", pane_id: "pane-1", cwd: repo }] } })}\n`;
    if (args[0] === "worktree") return `worktree ${repo}\n\nworktree ${other}\n`;
    throw new Error("no log");
  };
  const all = collectRewind({ cwd: repo, env, now: NOW, exec });
  assert.deepEqual(all.sessions.map((session) => session.id8).sort(), ["else0001", "here0001"]);
  assert.equal(all.sources.herdr, "unknown");
  assert.ok(!calls.some((call) => call.startsWith("herdr")));

  const here = collectRewind({ cwd: repo, env: { ...env, HERDR_ENV: "1" }, now: NOW, exec, here: true });
  assert.deepEqual(here.sessions.map((session) => session.id8), ["here0001"]);
  assert.equal(here.sources.herdr, "ok");
  assert.deepEqual(here.herdr.agents.map(({ pane, agent, status }) => [pane, agent, status]), [["pane-1", "claude", "working"]]);
  assert.equal(calls.filter((call) => call.startsWith("git worktree")).length, 1);

  assert.equal(parseSince("7d"), 7 * 86_400_000);
  assert.equal(parseSince("soon"), null);
  const out = [];
  const err = [];
  const sink = (list) => ({ write: (chunk) => list.push(chunk), columns: 80 });
  assert.equal(runRewindCli(["--bogus"], repo, { env, stdout: sink(out), stderr: sink(err) }), 64);
  assert.match(err.join(""), /unknown argument/u);
  assert.equal(runRewindCli(["--json", "--here"], repo, { env, stdout: sink(out), stderr: sink(err) }), 0);
  assert.equal(JSON.parse(out.join("")).scope.here, true);
});

test("open plans list this worktree first under a cap, and the roadmap gauge counts this worktree only", () => {
  const { repo, env } = fixture();
  const other = join(repo, "..", "far");
  mkdirSync(join(other, "plans"), { recursive: true });
  mkdirSync(join(repo, "plans"));
  writeFileSync(join(repo, "plans", "zz-local.md"), "- [x] a\n- [ ] b\n");
  for (let index = 0; index < 10; index += 1) {
    const path = join(other, "plans", `p${index}.md`);
    writeFileSync(path, "- [ ] x\n- [ ] y\n- [ ] z\n");
    utimesSync(path, new Date(NOW - (index + 1) * 60_000), new Date(NOW - (index + 1) * 60_000));
  }
  // Another worktree's stale plan and an unfilled scaffold are left out, not counted.
  writeFileSync(join(other, "plans", "old.md"), "- [ ] stale\n");
  utimesSync(join(other, "plans", "old.md"), new Date(NOW - 30 * 86_400_000), new Date(NOW - 30 * 86_400_000));
  writeFileSync(join(other, "plans", "template.md"), "- [ ] 1. <title>\n- [ ] 2. <title>\n");
  const exec = (file, args) => {
    if (args[0] === "worktree") return `worktree ${repo}\n\nworktree ${other}\n`;
    throw new Error("no log");
  };
  const data = collectRewind({ cwd: repo, env, now: NOW, exec });
  assert.equal(data.roadmap.plans.length, 8);
  assert.equal(data.roadmap.plansOmitted, 3);
  assert.equal(data.roadmap.plans[0].plan, "plans/zz-local.md");
  assert.equal(data.roadmap.progress.gauge, "[▉░] 1/2");
  assert.equal(data.next.kind, "start-plan");
  assert.match(renderRewind(data, 80), /…\(\+3 more open plans\)/u);
  assert.match(renderRewind(data, 80), /far: plans\/p0\.md/u, "the most recently changed plan elsewhere comes first");
  assert.ok(data.roadmap.plans.every((plan) => !["plans/old.md", "plans/template.md"].includes(plan.plan)));
});

// plans/litclaude-1042.md todo 8 (E2, E3): every plan is held to the window, plans are read before
// transcripts can spend the read budget, and a plan the budget did skip is counted, not dropped.
test("(a) a local plan last changed 9 days ago is not listed and is not the next step", () => {
  const { repo, env } = fixture();
  mkdirSync(join(repo, "plans"));
  writeFileSync(join(repo, "plans", "stale.md"), "- [ ] 1. old work\n");
  utimesSync(join(repo, "plans", "stale.md"), new Date(NOW - 9 * 86_400_000), new Date(NOW - 9 * 86_400_000));
  const data = collectRewind({ cwd: repo, env, now: NOW, exec: noGit, since: "7d" });
  assert.deepEqual(data.roadmap.plans, []);
  assert.notEqual(data.next.kind, "start-plan");
});

const bigTranscripts = (configDir, repo, count) => {
  const filler = `${JSON.stringify(assistantLine("big", [{ type: "text", text: "y".repeat(900) }], 2))}\n`;
  for (let index = 0; index < count; index += 1) {
    const id = `big${String(index).padStart(5, "0")}`;
    writeTranscript(configDir, repo, id, [JSON.stringify(userLine(id, repo, "big one", 2)), ...Array(Math.ceil((1024 * 1024) / filler.length)).fill(filler.trim())]);
  }
};

test("(b) plans are read even when transcripts would use up the read budget", () => {
  const { repo, env, configDir } = fixture();
  mkdirSync(join(repo, "plans"));
  writeFileSync(join(repo, "plans", "fresh.md"), "- [x] 1. done\n- [ ] 2. next\n");
  // Each transcript costs its head and tail, 320 KiB, so 30 of them pass the 8 MiB budget.
  bigTranscripts(configDir, repo, 30);
  const data = collectRewind({ cwd: repo, env, now: NOW, exec: noGit, max: 50 });
  assert.equal(data.budget.exhausted, true, "the transcripts did use the budget up");
  assert.deepEqual(data.roadmap.plans.map(({ plan }) => plan), ["plans/fresh.md"]);
  assert.equal(data.roadmap.plansSkipped, 0);
});

test("this worktree's HANDOFF.md gives its first Next item; another worktree's and a file without one give none", () => {
  const { repo, env } = fixture();
  const other = join(repo, "..", "far");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(repo, "HANDOFF.md"), "# Handoff\n\n## Done\n\n- shipped\n\n## Next Steps\n\n1. Re-run the gates\n2. Then the docs\n");
  writeFileSync(join(other, "HANDOFF.md"), "# Elsewhere\n\n## Next\n\n- not this worktree's\n");
  const exec = (file, args) => {
    if (args[0] === "worktree") return `worktree ${repo}\n\nworktree ${other}\n`;
    throw new Error("no log");
  };
  const handoffs = collectRewind({ cwd: repo, env, now: NOW, exec }).handoffs;
  assert.deepEqual(handoffs.map(({ local, next }) => ({ local, next })), [{ local: true, next: "Re-run the gates" }, { local: false, next: null }]);
  writeFileSync(join(repo, "HANDOFF.md"), "# Handoff\n\n## Done\n\n- shipped\n");
  assert.equal(collectRewind({ cwd: repo, env, now: NOW, exec: noGit, here: true }).handoffs[0].next, null);
});

// Host QA round 3 (2026-10-27, host/b-lit-adhd.ansi): A had finished its start-work over a 2/2 plan
// and gone idle, yet the brief labelled it ACTIVE, recommended "Check on A, now Bash “Mark the
// start-work run complete”", and opened with "Done so far: nothing finished in this window".
const roundThree = ({ completedRun = true } = {}) => {
  const { repo, env, configDir } = fixture();
  const A = "38960b3c-aaaa-bbbb-cccc-000000000001";
  const B = "cde57584-aaaa-bbbb-cccc-000000000002";
  mkdirSync(join(repo, ".litclaude", "liveness"), { recursive: true });
  mkdirSync(join(repo, "plans"));
  writeFileSync(join(repo, "plans", "qa-tiny2.md"), "# QA\n\n## Todos\n\n- [x] 1. write c.txt\n- [x] 2. write d.txt\n");
  utimesSync(join(repo, "plans", "qa-tiny2.md"), new Date(NOW - 12 * 60_000), new Date(NOW - 12 * 60_000));
  writeTranscript(configDir, repo, A, [
    userLine(A, repo, "/litclaude:start-work plans/qa-tiny2.md", 30),
    assistantLine(A, [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: join(repo, "c.txt"), content: "c" } }], 20),
    assistantLine(A, [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "litclaude-ai start-work complete", description: "Mark the start-work run complete" } }], 11),
    assistantLine(A, [{ type: "text", text: "Both rows are done and the run is complete." }], 11),
  ]);
  writeTranscript(configDir, repo, B, [
    userLine(B, repo, "lit adhd", 1),
    assistantLine(B, [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "litclaude-ai rewind --brief", description: "Generate cross-session brief" } }], 0),
  ]);
  writeFileSync(join(repo, ".litclaude", "liveness", `${A}.json`), JSON.stringify({ version: 1, sessionId: A, state: "idle", at: iso(11), herdrPane: "w2B:p9G" }));
  writeFileSync(join(repo, ".litclaude", "liveness", `${B}.json`), JSON.stringify({ version: 1, sessionId: B, state: "idle", at: iso(3), herdrPane: "w2B:p9H" }));
  if (completedRun) {
    writeFileSync(join(repo, ".litclaude", "boulder.json"), JSON.stringify({
      schema_version: 3,
      active_work_id: null,
      works: { "work-qa": { work_id: "work-qa", status: "completed", plan_name: "qa-tiny2.md", root_session_id: A, session_ids: [A] } },
      history: [{ work_id: "work-qa", status: "completed", plan: join(repo, "plans", "qa-tiny2.md"), terminal_at: iso(11) }],
    }));
  }
  return { data: collectRewind({ cwd: repo, env, now: NOW, exec: noGit, sessionId: B, record: false }), A, B };
};

test("(round 3) a session whose run completed reads done, not ACTIVE, and never repeats its finished step", () => {
  const { data } = roundThree();
  const a = data.sessions.find((session) => session.id8 === "38960b3c");
  const b = data.sessions.find((session) => session.self);
  assert.equal(a.status, "done");
  assert.equal(b.status, "active", "this session is running the brief, whatever its last Stop wrote");
  assert.equal(data.summary.active, 1);
  for (const lang of ["en", "ko"]) {
    const text = renderBrief(data, { lang, now: NOW });
    assert.doesNotMatch(text, /Mark the start-work run complete/u, lang);
    assert.match(text.split("\n").find((line) => line.startsWith("## 🧭")), lang === "en" ? / 1 active /u : / 진행 중 1 /u, lang);
  }
  const en = renderBrief(data, { lang: "en", now: NOW });
  const card = en.split("\n\n").find((block) => block.startsWith("> ") && block.includes("38960b3c"));
  assert.match(card, /^> ✅ done · `38960b3c`/u);
  assert.match(card, /▶ Next: start-work finished `plans\/qa-tiny2\.md`/u);
  assert.equal(en.split("\n")[0].trimEnd(), "Done so far: `plans/qa-tiny2.md` (start-work complete)");
  assert.equal(renderBrief(data, { lang: "ko", now: NOW }).split("\n")[0].trimEnd(), "지금까지: `plans/qa-tiny2.md` (start-work 완료)");
});

test("(round 3) with sessions listed but none active, the step points at the newest one, never 'no session'", () => {
  const { data } = roundThree();
  for (const [lang, empty, review] of [
    ["en", /No session or plan in this window/u, /next: Review what 38960b3c finished in repo: `?plans\/qa-tiny2\.md`?$/u],
    ["ko", /이 기간에 세션·계획이 없습니다/u, /다음: repo의 38960b3c가 끝낸 `?plans\/qa-tiny2\.md`?/u],
  ]) {
    const text = renderBrief(data, { lang, now: NOW });
    assert.doesNotMatch(text, empty, lang);
    assert.match(text.split("\n").find((line) => line.startsWith("## 🧭")), review, lang);
  }
});

test("(round 3) an idle liveness record labels the session idle, and a k/k plan counts as done so far", () => {
  const { data } = roundThree({ completedRun: false });
  const a = data.sessions.find((session) => session.id8 === "38960b3c");
  assert.equal(a.status, "idle");
  assert.equal(data.summary.active, 1);
  const en = renderBrief(data, { lang: "en", now: NOW });
  assert.doesNotMatch(en, /Mark the start-work run complete/u);
  assert.match(en.split("\n\n").find((block) => block.startsWith("> ") && block.includes("38960b3c")), /^> 💤 idle · `38960b3c`/u);
  assert.equal(en.split("\n")[0].trimEnd(), "Done so far: `plans/qa-tiny2.md` `[▉▉] 2/2`");
  assert.deepEqual(data.roadmap.plans, [], "a finished plan is not on the roadmap of open work");
});

test("(c) a plan the budget skipped is counted and named in the brief's notes", () => {
  const { repo, env } = fixture();
  mkdirSync(join(repo, "plans"));
  const filler = `${"x".repeat(1023)}\n`.repeat(1024);
  for (let index = 0; index < 9; index += 1) writeFileSync(join(repo, "plans", `p${index}.md`), `- [ ] 1. item ${index}\n${filler}`);
  const data = collectRewind({ cwd: repo, env, now: NOW, exec: noGit });
  assert.ok(data.roadmap.plansSkipped >= 1, `${data.roadmap.plansSkipped}`);
  assert.match(renderBrief(data, { lang: "en", now: NOW }), new RegExp(`${data.roadmap.plansSkipped} plans? (?:was|were) not read`, "u"));
  assert.match(renderBrief(data, { lang: "ko", now: NOW }), new RegExp(`계획 ${data.roadmap.plansSkipped}개는 읽지 못했습니다`, "u"));
});

// A plan run by a lane in a worktree is ticked there, in the lane's copy and its start-work ledger.
// The umbrella plan's gauge takes that record only when the plan names the worktree and the ledger's
// plan file is the same plan (its name, or its name without the date prefix); nothing else is bound.
test("a plan's gauge takes the start-work record of the worktree it names, and never a guess", () => {
  const { repo, env } = fixture();
  const lane = (name, planName, work, rows) => {
    const tree = join(repo, ".worktrees", name);
    mkdirSync(join(tree, ".litclaude"), { recursive: true });
    if (rows) {
      mkdirSync(join(tree, "plans"), { recursive: true });
      writeFileSync(join(tree, "plans", planName), rows);
    }
    writeFileSync(join(tree, ".litclaude", "boulder.json"), JSON.stringify({ active_work_id: null, works: { w: { work_id: "w", plan_name: planName, ...work } } }));
  };
  mkdirSync(join(repo, "plans"));
  // Finished in its lane: the copy has every row ticked (and one row the lane added).
  writeFileSync(join(repo, "plans", "2026-10-28-pilot.md"), "# Pilot\nLane: worktree `.worktrees/lane-a`.\n- [ ] 1. a\n- [ ] 2. b\n- [ ] 3. c\n");
  lane("lane-a", "pilot.md", { status: "completed", progress: { checked: 4, total: 4 } }, "# Pilot\n- [x] 1. a\n- [x] 2. b\n- [x] 2b. extra\n- [x] 3. c\n");
  // Under way in its lane: the copy is gone, so the ledger's own snapshot is the record.
  writeFileSync(join(repo, "plans", "2026-10-28-two.md"), "# Two\nRun in .worktrees/lane-c.\n- [ ] 1. a\n- [ ] 2. b\n- [ ] 3. c\n- [ ] 4. d\n");
  lane("lane-c", "two.md", { status: "active", progress: { checked: 2, total: 4, next_task: "3. c" } });
  // Not bound: a lane the plan never names, and a named lane whose ledger runs another plan.
  writeFileSync(join(repo, "plans", "2026-10-28-three.md"), "# Three\nSee `.worktrees/lane-d`.\n- [x] 1. a\n- [ ] 2. b\n");
  lane("lane-b", "three.md", { status: "completed", progress: { checked: 2, total: 2 } }, "- [x] 1. a\n- [x] 2. b\n");
  lane("lane-d", "other.md", { status: "completed", progress: { checked: 2, total: 2 } }, "- [x] 1. a\n- [x] 2. b\n");

  const data = collectRewind({ cwd: repo, env, now: NOW, exec: noGit, here: true });
  const open = Object.fromEntries(data.roadmap.plans.map((plan) => [plan.plan, plan]));
  assert.equal(open["plans/2026-10-28-pilot.md"], undefined, "a plan its lane finished is not open roadmap");
  const finished = data.finished.plans.find((plan) => plan.plan === "plans/2026-10-28-pilot.md");
  assert.equal(finished?.gauge, "[▉▉▉▉] 4/4");
  assert.equal(finished.recordedIn, ".worktrees/lane-a/plans/pilot.md");
  assert.equal(open["plans/2026-10-28-two.md"].progress.gauge, "[▉▉░░] 2/4");
  assert.equal(open["plans/2026-10-28-two.md"].current, "3. c");
  assert.equal(open["plans/2026-10-28-two.md"].recordedIn, ".worktrees/lane-c/.litclaude/boulder.json");
  assert.equal(open["plans/2026-10-28-three.md"].progress.gauge, "[▉░] 1/2", "an unnamed or unrelated ledger is never used");
  assert.equal(open["plans/2026-10-28-three.md"].recordedIn, undefined);
  assert.match(renderBrief(data, { lang: "en", now: NOW }), /2026-10-28-two\.md` `\[▉▉░░\] 2\/4`/u);
});
