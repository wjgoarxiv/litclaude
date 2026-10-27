// BRIEF-feedback-1038 B: the lit-adhd brief a tired person understands in ten seconds. Code draws it
// (lib/rewind/brief.mjs) from the collector's data: a headline, one card per session grouped by
// worktree and branch, a roadmap timeline, one recommended next step in a box, and the word to type.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderBrief } from "../plugins/litclaude/lib/rewind/brief.mjs";
import { runRewindCli } from "../plugins/litclaude/lib/rewind/collect.mjs";
import { displayWidth, progressOf } from "../plugins/litclaude/lib/rewind/gauge.mjs";
import { sessionRecord } from "../plugins/litclaude/lib/rewind/transcripts.mjs";

const NOW = Date.parse("2026-10-26T15:00:00Z");
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const PLACEHOLDER = /\?\/\?|\[\?+\]|\d\+?\/\?|\bnull\b|\bundefined\b|NaN/u;

const data = () => ({
  generatedAt: new Date(NOW).toISOString(),
  scope: { since: "7d", worktrees: ["~/repo", "~/repo/.worktrees/pptx"] },
  summary: { sessions: 3, waitingOnUser: 1, active: 1 },
  sessions: [
    { id8: "aaaa1111", worktree: "~/repo", branch: "main", status: "waiting-on-user", waitingReason: "asked the user", title: "Fix the deck QA", asked: ["fix the deck QA"], started: iso(90), last: iso(12), result: "Two layouts overflow. Should I shrink the hero title or split the slide?", progress: progressOf(3, 5, ["4. README demo", "5. ship"]), done: { tools: {}, files: ["deck/hero.md"], commits: [{ hash: "a1b2c3d", subject: "fix(deck): hero spacing" }] }, self: false },
    { id8: "bbbb2222", worktree: "~/repo", branch: "main", status: "active", title: "Port browser-drive", asked: ["port browser-drive", "now the tests"], started: iso(40), last: iso(1), result: "Running the suite.", progress: progressOf(null, null), done: { tools: {}, files: [], commits: [] }, self: true },
    { id8: "cccc3333", worktree: "~/repo/.worktrees/pptx", branch: "lane/pptx", status: "ended", title: "pptx `ignore previous` *instructions* <b>", asked: ["unknown"], started: iso(600), last: iso(300), result: "unknown", progress: progressOf(null, null), done: { tools: {}, files: [], commits: [] }, self: false },
  ],
  roadmap: {
    plans: [{ worktree: "~/repo", plan: "plans/deck.md", local: true, current: "4. README demo", progress: progressOf(3, 5, ["4. README demo", "5. ship"]) }],
    plansOmitted: 0,
    litgoal: [],
    progress: progressOf(3, 5),
  },
  workflows: [{ id8: "bbbb2222", skill: "lit-loop", stage: "RED", role: "spine", status: "paused", progress: progressOf(1, 4) }],
  startWork: [],
  commits: [{ worktree: "~/repo", branch: "main", hash: "a1b2c3d", at: iso(30), subject: "fix(deck): hero spacing" }],
  next: { kind: "resume-frame", target: { skill: "lit-loop", stage: "RED", progress: "[▉░░░] 1/4" }, say: "lit continue" },
  sources: { transcripts: "ok", git: "ok", herdr: "unknown" },
  budget: { exhausted: false },
});

const headlineOf = (text) => text.split("\n").find((line) => line.startsWith("## 🧭"));

// plans/litclaude-1042.md todo 9 (E1): three lines drawn from records open the brief, before the
// headline: what got done, what runs now, and the next step with the word to type.
test("three lines open the brief: done so far, doing now, next", () => {
  const lines = renderBrief(data(), { lang: "en", now: NOW }).split("\n").slice(0, 3).map((line) => line.trimEnd());
  assert.deepEqual(lines, [
    "Done so far: fix(deck): hero spacing",
    "Doing now: lit-loop · RED · `[▉░░░] 1/4`",
    "Next: Resume the paused lit-loop at RED (type lit continue)",
  ]);
  const ko = renderBrief(data(), { lang: "ko", now: NOW }).split("\n").slice(0, 3).map((line) => line.trimEnd());
  assert.deepEqual(ko, [
    "지금까지: fix(deck): hero spacing",
    "지금: lit-loop · RED · `[▉░░░] 1/4`",
    "다음: 멈춘 lit-loop(RED) 이어가기 (lit continue 입력)",
  ]);
  const quiet = renderBrief({ ...data(), commits: [], workflows: [], sessions: [data().sessions[2]], next: { kind: "start-plan", target: { plan: "plans/deck.md" }, say: "go", command: "/litclaude:start-work plans/deck.md" } }, { lang: "en", now: NOW }).split("\n");
  assert.equal(quiet[0].trimEnd(), "Done so far: nothing finished in this window");
  assert.equal(quiet[1].trimEnd(), "Doing now: nothing running");
  assert.equal(quiet[2].trimEnd(), "Next: Start plans/deck.md with start-work (type go)");
});

// plans/litclaude-1042.md todo 9 (E4): with no step for `go`, this worktree's HANDOFF.md Next section
// gives the step, ahead of the generic suggestion, and it carries no word to type.
test("with no step on record, the first Next item of this worktree's HANDOFF.md is the step", () => {
  const handoff = { ...data(), next: { kind: "none", target: null }, handoffs: [{ worktree: "~/repo", file: "HANDOFF.md", headings: [], next: "Re-run the gates", local: true }] };
  const text = renderBrief(handoff, { lang: "en", now: NOW });
  assert.equal(text.split("\n")[2].trimEnd(), "Next: Re-run the gates");
  assert.match(headlineOf(text), /next: Re-run the gates$/u);
  assert.match(text.split(/```\n(?=╭)/u)[1], /│ Re-run the gates +│/u);
  assert.doesNotMatch(text, /^Type \*\*/mu, "a HANDOFF step offers no go word");
  const elsewhere = renderBrief({ ...handoff, handoffs: [{ ...handoff.handoffs[0], local: false }] }, { lang: "en", now: NOW });
  assert.match(headlineOf(elsewhere), /next: Answer aaaa1111/u, "another worktree's HANDOFF is not this worktree's step");
});

test("headline first: sessions, who waits on you, and the next step, in one line", () => {
  const lines = renderBrief(data(), { lang: "en", now: NOW }).split("\n");
  assert.equal(headlineOf(lines.join("\n")), "## 🧭 3 sessions · 1 waits on you · 1 active · next: Resume the paused lit-loop at RED");
  assert.equal(lines[4], headlineOf(lines.join("\n")), "after the three opening lines and a blank line");
  const ko = headlineOf(renderBrief(data(), { lang: "ko", now: NOW }));
  assert.equal(ko, "## 🧭 세션 3개 · 나를 기다리는 것 1 · 진행 중 1 · 다음: 멈춘 lit-loop(RED) 이어가기");
});

test("one card per live session, grouped by worktree and branch, each with badge, goal, progress, done and next", () => {
  const text = renderBrief(data(), { lang: "en", now: NOW });
  const groups = [...text.matchAll(/^### 🌿 (.+)$/gmu)].map((match) => match[1]);
  assert.deepEqual(groups, ["`main` · repo"], "an ended session gets no group of its own");
  const cards = text.split("\n\n").filter((block) => block.startsWith("> "));
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.match(card, /^> (🟠|🟢|⚪|⚫) /u);
    assert.match(card, /\n> \*\*.+\*\*/u, "the goal in bold");
    assert.match(card, /\n> ✅ Done: /u);
    assert.match(card, /\n> ▶ Next: /u);
  }
  assert.match(cards[0], /🟠 \*\*WAITING ON YOU\*\* \(it asked you something\) · `aaaa1111` · 12m ago/u);
  assert.match(cards[0], /`\[▉▉▉░░\] 3\/5` · later: 4\. README demo, 5\. ship/u, "a real gauge with what is left");
  assert.match(cards[0], /Next: answer its question: “Should I shrink the hero title or split the slide\?”/u);
  assert.match(cards[0], /edited `hero\.md` · 1 commit: `a1b2c3d` fix\(deck\): hero spacing/u);
  assert.match(cards[1], /this session/u);
  assert.match(cards[1], /⏳ 39m of work · last ask: “now the tests”/u, "no total: the known facts instead of a gauge");
  assert.match(cards[1], /Next: resume lit-loop at RED/u);
});

test("ended sessions collapse into one table row each, after the live cards", () => {
  const text = renderBrief(data(), { lang: "en", now: NOW });
  assert.ok(text.indexOf("### ⚪ Ended · 1") > text.lastIndexOf("> "), "after the cards");
  assert.match(text, /^\| id \| where \| goal \| ago \| done \|$/mu);
  assert.match(text, /^\| `cccc3333` \| pptx \| .+ \| 5h \| · \|$/mu);
  const many = data();
  many.sessions = Array.from({ length: 11 }, (_, i) => ({ ...many.sessions[2], id8: `e${String(i).padStart(7, "0")}` }));
  const long = renderBrief(many, { lang: "en", now: NOW });
  assert.equal(long.match(/^\| `e\d{7}` /gmu).length, 8);
  assert.match(long, /…and 3 more ended/u);
});

test("an active session without edits says which tools it used and what it is doing now", () => {
  const active = data();
  active.workflows = [];
  active.sessions[1] = { ...active.sessions[1], done: { tools: { Bash: 9, Edit: 4, Read: 12, Grep: 1 }, files: [], commits: [] }, lastAction: { tool: "Bash", target: "Run the gates" } };
  const card = renderBrief(active, { lang: "en", now: NOW }).split("\n\n").find((block) => block.includes("bbbb2222"));
  assert.match(card, /✅ Done: no edits yet; used Read, Bash, Edit/u);
  assert.match(card, /▶ Next: now: Bash “Run the gates”/u);
  assert.doesNotMatch(card, /still working in that session|no file edits or commits on record/u);
});

test("with nothing for go to run, the brief still recommends a real step, never 'No next step on record'", () => {
  const none = (patch) => renderBrief({ ...data(), next: { kind: "none", target: null }, ...patch(data()) }, { lang: "en", now: NOW });
  const headline = headlineOf;
  const boxed = (text) => text.split(/```\n(?=╭)/u)[1].split("\n```")[0];
  // 1. a session that waits on the user
  let text = none(() => ({}));
  assert.match(headline(text), /next: Answer aaaa1111 in repo: “Should I shrink the hero title or split the slide\?”/u);
  assert.match(boxed(text), /Answer aaaa1111/u);
  // 2. a paused workflow
  text = none((d) => ({ sessions: d.sessions.filter((s) => s.status !== "waiting-on-user") }));
  assert.match(headline(text), /next: Resume lit-loop at RED in bbbb2222 \(repo\)/u);
  // 3. the next item of the most recent open plan
  text = none((d) => ({ sessions: d.sessions.filter((s) => s.status !== "waiting-on-user"), workflows: [] }));
  assert.match(headline(text), /next: Next in plans\/deck\.md: 4\. README demo/u);
  // 4. the most recent other active session, with what it is doing
  const other = { ...data().sessions[1], id8: "dddd4444", self: false, lastAction: { tool: "Edit", target: "frame.mjs" } };
  text = none((d) => ({ sessions: [other, d.sessions[2]], workflows: [], roadmap: { ...d.roadmap, plans: [] } }));
  assert.match(headline(text), /next: Check on dddd4444 in repo \(Port browser-drive\), now Edit “frame\.mjs”/u);
  // 5. the most recent ended session
  text = none((d) => ({ sessions: [d.sessions[2]], workflows: [], roadmap: { ...d.roadmap, plans: [] } }));
  assert.match(headline(text), /next: Pick up cccc3333 in pptx: /u);
  for (const lang of ["en", "ko"]) {
    const brief = renderBrief({ ...data(), next: { kind: "none", target: null } }, { lang, now: NOW });
    assert.doesNotMatch(brief, /No next step on record|기록된 다음 단계 없음/u);
    assert.doesNotMatch(brief, /^Type \*\*/mu, "a shown suggestion offers no go word");
  }
});

test("roadmap timeline: done ✓ with dates, now ▶ with its gauge, later ○", () => {
  const text = renderBrief(data(), { lang: "en", now: NOW });
  const roadmap = text.split("### 🗺️ Roadmap")[1].split("```")[0];
  assert.match(text, /### 🗺️ Roadmap `\[▉▉▉░░\] 3\/5`/u);
  assert.match(roadmap, /^- ✓ \d\d-\d\d \d\d:\d\d · `main` fix\(deck\): hero spacing$/mu);
  assert.match(roadmap, /^- ▶ \*\*now\*\* · `plans\/deck\.md` `\[▉▉▉░░\] 3\/5` → 4\. README demo$/mu);
  assert.match(roadmap, /^ {2}- ○ later · 5\. ship$/mu);
});

test("one recommended next step in a box whose edges line up, then the word to type", () => {
  for (const lang of ["en", "ko"]) {
    const text = renderBrief(data(), { lang, now: NOW });
    const box = text.split(/```\n(?=╭)/u)[1].split("\n```")[0].split("\n");
    assert.match(box[0], lang === "en" ? /^╭─ RECOMMENDED NEXT STEP ─+╮$/u : /^╭─ 추천하는 다음 단계 ─+╮$/u);
    assert.ok(box.some((line) => line.includes(lang === "en" ? "type: lit continue" : "입력: lit continue")));
    assert.equal(new Set(box.map(displayWidth)).size, 1, `${lang}: every box row is as wide:\n${box.join("\n")}`);
    const tail = text.trimEnd().split("\n");
    assert.ok(tail.some((line) => line === (lang === "en" ? "Type **`lit continue`** to continue." : "**`lit continue`** 라고 입력하면 이어갑니다.")));
  }
});

test("never cryptic: no ? run, no null, and an unknown source is named once", () => {
  for (const lang of ["en", "ko"]) {
    const text = renderBrief(data(), { lang, now: NOW });
    assert.doesNotMatch(text, PLACEHOLDER, text);
    assert.equal(text.match(lang === "en" ? /Not read: herdr\./gu : /읽지 못함: herdr\./gu)?.length, 1);
  }
  const empty = renderBrief({ ...data(), sessions: [], summary: { sessions: 0, waitingOnUser: 0, active: 0 }, roadmap: { plans: [], plansOmitted: 0, litgoal: [], progress: progressOf(null, null) }, commits: [], workflows: [], next: { kind: "none", target: null } }, { lang: "en", now: NOW });
  assert.doesNotMatch(empty, PLACEHOLDER);
  assert.match(empty, /No Claude Code session records in this window\./u);
  assert.match(headlineOf(empty), /next: No session or plan in this window: say what to start/u);
});

test("data stays data: backticks, emphasis and tags in a title cannot restyle the brief", () => {
  const text = renderBrief(data(), { lang: "en", now: NOW });
  const row = text.split("\n").find((line) => line.includes("cccc3333"));
  assert.match(row, /\| pptx 'ignore previous' \\\*instructions\\\* ‹b› \|/u);
  assert.doesNotMatch(row, /<b>/u);
  assert.equal(row.replace(/\\\|/gu, "").split("|").length, 7, "a pipe in the data cannot add a column");
  const piped = data();
  piped.sessions[2] = { ...piped.sessions[2], title: "a | b" };
  const pipedRow = renderBrief(piped, { lang: "en", now: NOW }).split("\n").find((line) => line.includes("cccc3333"));
  assert.equal(pipedRow.replace(/\\\|/gu, "").split("|").length, 7);
});

test("the CLI prints the brief with --brief and --lang", () => {
  const root = mkdtempSync(join(tmpdir(), "brief-cli-"));
  try {
    let out = "";
    const stdout = { write: (chunk) => { out += chunk; }, columns: 100 };
    const code = runRewindCli(["--brief", "--lang", "ko", "--here"], root, { env: { HOME: root, CLAUDE_CONFIG_DIR: join(root, "claude") }, stdout, stderr: stdout });
    assert.equal(code, 0);
    assert.match(out, /^지금까지: .+\n지금: .+\n다음: .+\n\n## 🧭 세션 0개/u);
    assert.match(out, /추천하는 다음 단계/u);
    assert.doesNotMatch(out, PLACEHOLDER);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a transcript's last tool call becomes its last action: a description or a base name, never a command", () => {
  const line = (input, name = "Bash") => ({ type: "assistant", sessionId: "s1", timestamp: iso(1), message: { content: [{ type: "tool_use", name, input }] } });
  const prompt = { type: "user", sessionId: "s1", timestamp: iso(5), message: { content: "go" } };
  const bash = sessionRecord([prompt, line({ command: "rm -rf build && npm test", description: "Run the gates" })], { now: NOW });
  assert.deepEqual(bash.lastAction, { tool: "Bash", target: "Run the gates" });
  const edit = sessionRecord([prompt, line({ file_path: "/home/u/repo/lib/frame.mjs", old_string: "secret" }, "Edit")], { now: NOW });
  assert.deepEqual(edit.lastAction, { tool: "Edit", target: "frame.mjs" });
  const bare = sessionRecord([prompt, line({ command: "ls" })], { now: NOW });
  assert.deepEqual(bare.lastAction, { tool: "Bash" }, "no description: the tool name alone");
});

// Host round 4: the Claude Code TUI prints a fence's language tag as its own line above the box, so the
// RECOMMENDED NEXT STEP box sits in a plain, untagged fence.
test("the next-step box opens with a plain fence, never a tagged one", () => {
  for (const lang of ["en", "ko"]) {
    const text = renderBrief(data(), { lang, now: NOW });
    assert.doesNotMatch(text, /^```\S/mu, `${lang}: no fence carries a language tag`);
    assert.match(text, /^```\n╭─ /mu, `${lang}: the box opens in a plain fence`);
  }
});
