// The lit-adhd collector (plans/lit-adhd.md todo 10): transcripts are found by slug or by the cwd
// they record, read head and tail under one budget without following links, and turned into
// redacted records; every other source reads `ok` or `unknown`; the next step follows its fixed
// priority; gauges are drawn by code (D9) and never guess a total.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

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
  assert.equal(gauge(2, null), "[???] 2/?");
  assert.equal(gauge(null, null), "[???] ?/?");
  assert.deepEqual(progressOf(2, null).remaining, ["unknown"]);
  assert.deepEqual(progressOf(3, 3).remaining, []);
  assert.equal(aggregateProgress([progressOf(1, 2), progressOf(2, 3)]).gauge, "[▉▉▉░░] 3/5");
  assert.equal(aggregateProgress([progressOf(1, 2), progressOf(2, null)]).gauge, "[???] 3/?");
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
  assert.equal(data.roadmap.progress.gauge, "[???] ?/?");
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
    if (file === "herdr") return "pane-1 claude working\n";
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
  assert.deepEqual(here.herdr.agents, ["pane-1 claude working"]);
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
  for (let index = 0; index < 10; index += 1) writeFileSync(join(other, "plans", `p${index}.md`), "- [ ] x\n- [ ] y\n- [ ] z\n");
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
  assert.match(renderRewind(data, 80), /far: plans\/p0\.md/u);
});
