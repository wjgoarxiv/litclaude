// lit-adhd v2 (plans/2026-11-10-lit-adhd-kpi spec): the brief opens on a KPI board the collector
// computes and draws (lib/rewind/board.mjs): the one thing to do now and what to type, four bucket
// counts with an overall bar, a milestone table, the latest finished items, what is left in plan
// order, and action-shaped reminders. The per-session cards stay available under it on request.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { bar, buildBoard, renderBoard } from "../plugins/litclaude/lib/rewind/board.mjs";
import { collectRewind, runRewindCli } from "../plugins/litclaude/lib/rewind/collect.mjs";
import { progressOf } from "../plugins/litclaude/lib/rewind/gauge.mjs";
import { projectSlug } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

const NOW = Date.parse("2026-11-10T06:00:00.000Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const WAITER = "7f3a9c21-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});

const HEADINGS = {
  ko: ["## 🎯 지금 할 일", "## 📊 한눈에 보기", "## 🏁 마일스톤", "## ✅ 최근 끝낸 일", "## ⬜ 남은 일", "## 🔔 잊지 말 것"],
  en: ["## 🎯 Do this now", "## 📊 At a glance", "## 🏁 Milestones", "## ✅ Done lately", "## ⬜ Still to do", "## 🔔 Don't forget"],
};
// What the board never shows: session ids, commit hashes, raw status codes, internal record paths.
const INTERNAL = /[0-9a-f]{8}-[0-9a-f]{4}-|\b7f3a9c21\b|\bc0ffee1\b|waiting-on-user|\bidle\b|\bended\b|start-work boundary|paused workflow|boulder\.json|\.litclaude\//u;

const sectionOf = (text, heading) => {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  const next = text.indexOf("\n## ", start + heading.length);
  // The board's italic footer (unread sources, the detail hint) is not part of any section.
  return text.slice(start + heading.length, next === -1 ? undefined : next).trim().split("\n").filter((line) => !/^\*[^*]/u.test(line)).join("\n").trim().split("\n");
};

// Two plans (one fully ticked, one with 3 of 12 ticked), one stale plan, a session that asked the
// user something, three uncommitted changes and two unpushed commits.
const fixture = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "adhd-board-")));
  cleanups.push(home);
  const repo = join(home, "repo");
  const configDir = join(home, ".claude");
  mkdirSync(join(repo, "plans"), { recursive: true });
  writeFileSync(join(repo, "plans", "2026-11-01-alpha.md"), `# Alpha rollout\n\n${[1, 2, 3, 4, 5, 6].map((n) => `- [x] A${n}. alpha step ${n}`).join("\n")}\n`);
  writeFileSync(join(repo, "plans", "beta.md"), `# Beta port\n\n${Array.from({ length: 12 }, (_, i) => `- [${i < 3 ? "x" : " "}] B${i + 1}. beta step ${i + 1}`).join("\n")}\n`);
  const stale = join(repo, "plans", "old.md");
  writeFileSync(stale, "# Old cleanup\n\n- [x] O1. first\n- [ ] O2. second\n");
  utimesSync(stale, new Date(NOW - 10 * 86_400_000), new Date(NOW - 10 * 86_400_000));
  utimesSync(join(repo, "plans", "2026-11-01-alpha.md"), new Date(NOW - 120 * 60_000), new Date(NOW - 120 * 60_000));
  utimesSync(join(repo, "plans", "beta.md"), new Date(NOW - 10 * 60_000), new Date(NOW - 10 * 60_000));
  const dir = join(configDir, "projects", projectSlug(repo));
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: "user", sessionId: WAITER, cwd: repo, gitBranch: "main", timestamp: iso(30), message: { role: "user", content: "port the beta plan" } },
    { type: "assistant", sessionId: WAITER, timestamp: iso(20), message: { role: "assistant", content: [{ type: "text", text: "Two layouts overflow. Should I split the slide?" }] } },
  ];
  writeFileSync(join(dir, `${WAITER}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const exec = (file, args) => {
    assert.equal(file, "git");
    if (args[0] === "rev-parse") return "main\n";
    if (args[0] === "log") return `c0ffee1234567\t${iso(40)}\tfeat: beta step 3\n`;
    // LitClaude's own state folder is not the user's change, so it is not counted.
    if (args[0] === "status") return " M a.mjs\n M b.mjs\n?? c.md\n?? .litclaude/\n";
    if (args[0] === "rev-list") return "2\n";
    throw new Error("no such git command");
  };
  const data = collectRewind({ cwd: repo, here: true, env: { HOME: home, CLAUDE_CONFIG_DIR: configDir }, now: NOW, exec, record: false });
  return { home, repo, configDir, exec, data };
};

test("bars are ten cells of █ and ░ with k/n and a floored percentage", () => {
  assert.equal(bar(9, 18), "█████░░░░░ 9/18 (50%)");
  assert.equal(bar(6, 6), "██████████ 6/6 (100%)");
  assert.equal(bar(0, 4), "░░░░░░░░░░ 0/4 (0%)");
  assert.equal(bar(1, 40), "█░░░░░░░░░ 1/40 (2%)", "any progress shows one cell");
  assert.equal(bar(39, 40), "█████████░ 39/40 (97%)", "unfinished never shows a full bar");
  assert.equal(bar(3, 12, { percent: false }), "██░░░░░░░░ 3/12");
  assert.equal(bar(null, 4), null, "no bar without two real numbers");
  assert.equal(bar(2, 0), null);
});

test("the collector computes the board: buckets, overall bar, milestones, done, remaining, reminders", () => {
  const { board } = fixture().data;
  assert.deepEqual(board.counts, { done: 9, inProgress: 1, waiting: 1, remaining: 8 });
  assert.deepEqual(board.overall, { done: 9, total: 18, percent: 50, bar: "█████░░░░░ 9/18 (50%)" });
  assert.deepEqual(board.milestones.map(({ name, status, done, total }) => [name, status, done, total]), [
    ["Beta port", "doing", 3, 12],
    ["Alpha rollout", "done", 6, 6],
  ]);
  assert.equal(board.doneLately.length, 5, "done lately is capped at five");
  assert.equal(board.doneLately[0].text, "B3. beta step 3", "newest first: the most recently changed plan's last ticked row");
  assert.equal(board.remaining.length, 7, "remaining is capped at seven");
  assert.equal(board.remainingOmitted, 2);
  assert.equal(board.remaining[0].text, "B4. beta step 4");
  assert.equal(board.remaining[0].state, "doing");
  assert.deepEqual(board.reminders.map((item) => item.kind), ["dirty", "unpushed", "stale"], "a session that waits for an answer is not a lane at work");
  assert.equal(board.doNow.kind, "answer", "the waiting session is the thing to do now, so it is not repeated below");
  assert.equal(board.doNow.type, null, "an answer happens in that session, not on go");
});

test("sections come in the fixed order, in Korean and English, with the drawn numbers", () => {
  const { data } = fixture();
  for (const lang of ["ko", "en"]) {
    const text = renderBoard(data, { lang, now: NOW });
    const at = HEADINGS[lang].map((heading) => text.indexOf(heading));
    assert.ok(at.every((index) => index >= 0), `${lang}: every heading is drawn`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `${lang}: headings in order`);
    assert.ok(text.startsWith(HEADINGS[lang][0]), `${lang}: the board opens on what to do now`);
  }
  const ko = renderBoard(data, { lang: "ko", now: NOW });
  assert.deepEqual(sectionOf(ko, HEADINGS.ko[1]).slice(0, 3), ["| ✅ 끝남 | 🔄 진행 중 | ⏳ 나를 기다림 | ⬜ 남음 |", "|:--:|:--:|:--:|:--:|", "| 9 | 1 | 1 | 8 |"]);
  assert.match(ko, /^전체 진행 {2}█████░░░░░ 9\/18 \(50%\)$/mu);
  const milestones = sectionOf(ko, HEADINGS.ko[2]);
  assert.equal(milestones[0], "| 마일스톤 | 상태 | 진행 | 최근 |");
  assert.equal(milestones[2], "| Beta port | 🔄 진행 중 | ██░░░░░░░░ 3/12 | 10분 전 |");
  assert.match(milestones[3], /^\| Alpha rollout \| ✅ 끝남 \| ██████████ 6\/6 \| /u);
  const en = renderBoard(data, { lang: "en", now: NOW });
  assert.match(en, /^\| Beta port \| 🔄 In progress \| ██░░░░░░░░ 3\/12 \| 10m ago \|$/mu);
});

test("do this now: one plain action, one reason, and what to type or where to go", () => {
  const ko = sectionOf(renderBoard(fixture().data, { lang: "ko", now: NOW }), HEADINGS.ko[0]);
  assert.equal(ko.length, 2);
  assert.equal(ko[0], "**repo 세션의 질문에 답하기** — “Should I split the slide?”  ", "a hard break keeps the two lines apart");
  assert.equal(ko[1], "👉 그 세션(repo)으로 가서 답하기");
  assert.doesNotMatch(ko[1], /`go`/u, "an answer elsewhere is never offered on go");
});

test("done lately holds five, still to do seven plus …외 N개, in plan order", () => {
  const ko = renderBoard(fixture().data, { lang: "ko", now: NOW });
  const done = sectionOf(ko, HEADINGS.ko[3]);
  assert.equal(done.length, 5);
  assert.ok(done.every((line) => line.startsWith("- ")));
  const left = sectionOf(ko, HEADINGS.ko[4]);
  assert.equal(left.length, 8);
  assert.equal(left[0], "1. 🔄 B4. beta step 4");
  assert.equal(left[6], "7. B10. beta step 10");
  assert.equal(left[7], "…외 2개");
  assert.equal(sectionOf(renderBoard(fixture().data, { lang: "en", now: NOW }), HEADINGS.en[4]).at(-1), "…and 2 more");
});

test("reminders are action-shaped, from records only, most urgent first, five at most", () => {
  const ko = sectionOf(renderBoard(fixture().data, { lang: "ko", now: NOW }), HEADINGS.ko[5]);
  assert.deepEqual(ko, [
    "- 💾 커밋 안 된 변경 3개 (repo) → 확인하고 커밋하거나 정리하기",
    "- ⬆️ 푸시 안 된 커밋 2개 (repo) → 준비되면 `git push`",
    "- 🕰️ 10일째 멈춘 계획: Old cleanup → 이어 할지, 접을지 정하기",
  ]);
  for (const line of ko) assert.match(line, / → /u, "thing → what to do");
  const { data } = fixture();
  const working = { ...data, sessions: [...data.sessions, { id8: "lane0001", worktree: "~/repo/.worktrees/lane", branch: "lane", status: "active", title: "lane work", asked: [], done: { files: [], commits: [], tools: {} }, self: false }] };
  const lanes = sectionOf(renderBoard(working, { lang: "ko", now: NOW }), HEADINGS.ko[5]);
  assert.ok(lanes.includes("- 🏃 아직 일하는 레인 1개 → 끝날 때까지 `go` 치지 않기"), lanes.join("\n"));
  assert.ok(lanes.indexOf("- 🏃 아직 일하는 레인 1개 → 끝날 때까지 `go` 치지 않기") < lanes.findIndex((line) => line.includes("🕰️")));
  const many = buildBoard({
    ...fixture().data,
    git: Array.from({ length: 6 }, (_, i) => ({ name: `tree${i}`, dirty: i + 1, ahead: null })),
  }, { now: NOW });
  assert.equal(many.reminders.length, 5, "capped at five");
  assert.ok(many.remindersOmitted > 0);
});

test("the board never shows a session id, a commit hash, a raw status code or an internal path", () => {
  const { data } = fixture();
  for (const lang of ["ko", "en"]) assert.doesNotMatch(renderBoard(data, { lang, now: NOW }), INTERNAL, lang);
});

test("empty sections print one plain line", () => {
  const empty = { generatedAt: new Date(NOW).toISOString(), scope: { worktrees: ["~/repo"] }, sessions: [], roadmap: { plans: [], litgoal: [] }, finished: { runs: [], plans: [] }, workflows: [], startWork: [], handoffs: [], commits: [], git: [], stalePlans: [], next: { kind: "none", target: null }, sources: { transcripts: "ok", plans: "ok", git: "ok" }, herdr: { agents: [] } };
  const ko = renderBoard(empty, { lang: "ko", now: NOW });
  assert.deepEqual(sectionOf(ko, HEADINGS.ko[2]), ["열린 계획이나 목표가 없어요"]);
  assert.deepEqual(sectionOf(ko, HEADINGS.ko[3]), ["아직 끝낸 일이 없어요"]);
  assert.deepEqual(sectionOf(ko, HEADINGS.ko[4]), ["남은 일이 없어요"]);
  assert.deepEqual(sectionOf(ko, HEADINGS.ko[5]), ["잊지 말 일이 없어요"]);
  assert.match(ko, /^전체 진행 {2}기록된 계획 항목이 없어요$/mu);
  const en = renderBoard(empty, { lang: "en", now: NOW });
  assert.deepEqual(sectionOf(en, HEADINGS.en[4]), ["Nothing left"]);
  assert.doesNotMatch(`${ko}${en}`, /\bnull\b|\bundefined\b|NaN|\?\/\?/u);
});

test("the board stays at forty lines or fewer, even with every list full", () => {
  const { data } = fixture();
  const crowded = {
    ...data,
    roadmap: {
      ...data.roadmap,
      plans: Array.from({ length: 8 }, (_, p) => ({ worktree: "~/repo", plan: `plans/p${p}.md`, title: `Plan ${p}`, local: true, changedMs: NOW - p * 60_000, current: "x1", rows: Array.from({ length: 9 }, (_, r) => ({ checked: r < 2, title: `p${p} row ${r}` })), progress: progressOf(2, 9) })),
    },
    git: Array.from({ length: 4 }, (_, i) => ({ name: `tree${i}`, dirty: 2, ahead: 1 })),
  };
  for (const lang of ["ko", "en"]) {
    const lines = renderBoard(crowded, { lang, now: NOW }).trimEnd().split("\n");
    assert.ok(lines.length <= 40, `${lang}: ${lines.length} lines`);
  }
});

test("the CLI prints the board by default and the per-session detail only with --detail", () => {
  const { repo, home, configDir } = fixture();
  const run = (args) => {
    let out = "";
    const stdout = { write: (chunk) => { out += chunk; }, columns: 100 };
    assert.equal(runRewindCli(args, repo, { env: { HOME: home, CLAUDE_CONFIG_DIR: configDir }, stdout, stderr: stdout }), 0);
    return out;
  };
  const board = run(["--brief", "--lang", "ko", "--here"]);
  assert.ok(board.startsWith("## 🎯 지금 할 일"));
  assert.doesNotMatch(board, /^## 🧭/mu, "the session cards are not the default");
  assert.match(board, /`lit adhd 자세히`/u, "the board says how to see the detail");
  const detail = run(["--brief", "--detail", "--lang", "ko", "--here"]);
  assert.ok(detail.startsWith("## 🎯 지금 할 일"), "the board still comes first");
  assert.ok(detail.indexOf("## 🧭") > detail.indexOf("## 🔔 잊지 말 것"), "the detail sits under the board");
  const json = JSON.parse(run(["--json", "--here"]));
  assert.ok(json.board && json.board.counts, "--json carries the board's structured fields");
});
