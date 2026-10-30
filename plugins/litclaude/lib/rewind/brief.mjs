// The lit-adhd brief as Markdown, drawn by code from the collector's data (collect.mjs) so a tired
// reader gets the same shape every time and the model only copies it: a one-line headline, one card
// per session grouped by worktree and branch (status badge, goal, a real gauge or the known facts,
// done, next), a roadmap timeline (done ✓ / now ▶ / later ○ with dates), one recommended next step
// in a box, and the word to type. Every string in `data` is already redacted and clipped; this file
// adds layout and words only, never a number the data does not hold.

import { basename } from "node:path";

import { clipToWidth, displayWidth } from "./gauge.mjs";
import { stripControls } from "./redact.mjs";

const WORDS = {
  en: {
    sessions: (n) => `${n} ${n === 1 ? "session" : "sessions"}`,
    waiting: (n) => `${n} ${n === 1 ? "waits" : "wait"} on you`,
    active: (n) => `${n} active`,
    next: "next",
    window: (since, trees) => `last ${since} · ${trees} ${trees === 1 ? "worktree" : "worktrees"}`,
    badge: { "waiting-on-user": "🟠 **WAITING ON YOU**", active: "🟢 **ACTIVE**", idle: "💤 idle", done: "✅ done", ended: "⚪ ended", unknown: "⚫ unknown" },
    runDone: (plan) => `start-work finished ${plan}`,
    reason: { "asked the user": "it asked you something", "paused workflow": "paused workflow", "start-work boundary": "start-work needs approval" },
    ago: (text) => `${text} ago`,
    justNow: "just now",
    goal: "Goal",
    done: "Done",
    nextLabel: "Next",
    noneDone: "no file edits or commits on record",
    toolsUsed: (list) => `no edits yet; used ${list}`,
    doing: (what) => `now: ${what}`,
    endedTitle: (n) => `Ended · ${n}`,
    endedHead: ["id", "where", "goal", "ago", "done"],
    fileCount: (n) => `${n} ${n === 1 ? "file" : "files"}`,
    moreEnded: (n) => `…and ${n} more ended`,
    files: "edited",
    commits: (n) => `${n} ${n === 1 ? "commit" : "commits"}`,
    worked: (d) => `${d} of work`,
    lastAsk: (q) => `last ask: “${q}”`,
    working: "still working in that session",
    self: "this session",
    answer: (q) => `answer its question: “${q}”`,
    resume: (skill, stage, self) => `resume ${skill} at ${stage} (\`lit continue\`${self ? "" : " there"})`,
    approve: "approve or deny the start-work boundary (`lit approve` / `lit deny`)",
    planNow: (plan, item) => `${plan} → ${item}`,
    nothing: "nothing pending on record",
    roadmap: "Roadmap",
    now: "now",
    later: "later",
    milestoneDone: "done",
    noRoadmap: "No open plan, goal or commit in this window.",
    morePlans: (n) => `…and ${n} more open ${n === 1 ? "plan" : "plans"}`,
    recommended: "RECOMMENDED NEXT STEP",
    type: "type",
    stepKind: {
      "resume-frame": ({ skill, stage }) => `Resume the paused ${skill} at ${stage}`,
      "approve-boundary": ({ plan, action, root }) => `start-work (${plan}) waits for ${action} access to ${root}`,
      "continue-work": ({ plan }) => `Keep running ${plan}`,
      "start-plan": ({ plan }) => `Start ${plan} with start-work`,
      none: () => "No next step on record",
    },
    suggest: {
      answer: ({ id8, where, question }) => `Answer ${id8} in ${where}${question ? `: “${question}”` : ""}`,
      resume: ({ id8, skill, stage, where }) => `Resume ${skill} at ${stage} in ${id8} (${where})`,
      plan: ({ plan, item }) => `Next in ${plan}: ${item}`,
      check: ({ id8, goal, where, doing }) => `Check on ${id8} in ${where} (${goal})${doing ? `, now ${doing}` : ""}`,
      pickUp: ({ id8, goal, where }) => `Pick up ${id8} in ${where}: ${goal}`,
      review: ({ id8, where, plan }) => `Review what ${id8} finished in ${where}: ${plan}`,
      start: () => "No session or plan in this window: say what to start",
    },
    goLine: (say) => `Type **\`${say}\`** to continue.`,
    noGo: "Nothing runs on its own here: open that session, or say what to do.",
    lanesAtWork: (n) => `${n} other ${n === 1 ? "lane is" : "lanes are"} still at work: wait for ${n === 1 ? "it" : "them"} to finish`,
    noGoWhileLanes: "Do not type **`go`** now: run `lit adhd` again once the lanes finish.",
    unknownSources: (list) => `Not read: ${list}.`,
    older: "Older sessions were not read (read budget used up).",
    plansSkipped: (n) => `${n} ${n === 1 ? "plan was" : "plans were"} not read (read budget used up).`,
    noSessions: "No Claude Code session records in this window.",
    opener: { done: "Done so far", doing: "Doing now", next: "Next", nothingDone: "nothing finished in this window", nothingRunning: "nothing running", type: (say) => `(type ${say})`, finishedRun: (plan) => `${plan} (start-work complete)` },
  },
  ko: {
    sessions: (n) => `세션 ${n}개`,
    waiting: (n) => `나를 기다리는 것 ${n}`,
    active: (n) => `진행 중 ${n}`,
    next: "다음",
    window: (since, trees) => `최근 ${since} · 워크트리 ${trees}개`,
    badge: { "waiting-on-user": "🟠 **나를 기다림**", active: "🟢 **진행 중**", idle: "💤 쉬는 중", done: "✅ 완료", ended: "⚪ 끝남", unknown: "⚫ 모름" },
    runDone: (plan) => `${plan} start-work 완료`,
    reason: { "asked the user": "질문에 답을 기다림", "paused workflow": "멈춘 워크플로", "start-work boundary": "start-work 승인 대기" },
    ago: (text) => `${text} 전`,
    justNow: "방금",
    goal: "목표",
    done: "한 일",
    nextLabel: "다음",
    noneDone: "기록된 파일 수정·커밋 없음",
    toolsUsed: (list) => `아직 수정 없음, 쓴 도구 ${list}`,
    doing: (what) => `지금: ${what}`,
    endedTitle: (n) => `끝난 세션 · ${n}`,
    endedHead: ["id", "위치", "목표", "끝난 지", "한 일"],
    fileCount: (n) => `파일 ${n}개`,
    moreEnded: (n) => `…끝난 세션 ${n}개 더`,
    files: "수정",
    commits: (n) => `커밋 ${n}개`,
    worked: (d) => `${d} 작업`,
    lastAsk: (q) => `마지막 요청: “${q}”`,
    working: "그 세션에서 작업 중",
    self: "이 세션",
    answer: (q) => `질문에 답하기: “${q}”`,
    resume: (skill, stage, self) => `${skill}(${stage}) 이어가기 (${self ? "" : "그 세션에서 "}\`lit continue\`)`,
    approve: "start-work 경계 승인 또는 거절 (`lit approve` / `lit deny`)",
    planNow: (plan, item) => `${plan} → ${item}`,
    nothing: "기록된 남은 일 없음",
    roadmap: "로드맵",
    now: "지금",
    later: "이후",
    milestoneDone: "완료",
    noRoadmap: "이 기간에 열린 계획·목표·커밋이 없습니다.",
    morePlans: (n) => `…열린 계획 ${n}개 더`,
    recommended: "추천하는 다음 단계",
    type: "입력",
    stepKind: {
      "resume-frame": ({ skill, stage }) => `멈춘 ${skill}(${stage}) 이어가기`,
      "approve-boundary": ({ plan, action, root }) => `start-work(${plan})가 ${root} ${action} 권한을 기다림`,
      "continue-work": ({ plan }) => `${plan} 계속 진행`,
      "start-plan": ({ plan }) => `${plan}을 start-work로 시작`,
      none: () => "기록된 다음 단계 없음",
    },
    suggest: {
      answer: ({ id8, where, question }) => `${where}의 ${id8}에 답하기${question ? `: “${question}”` : ""}`,
      resume: ({ id8, skill, stage, where }) => `${where}의 ${id8}에서 ${skill}(${stage}) 이어가기`,
      plan: ({ plan, item }) => `${plan} 다음 항목: ${item}`,
      check: ({ id8, goal, where, doing }) => `${where}의 ${id8} 확인 (${goal})${doing ? `, 지금 ${doing}` : ""}`,
      pickUp: ({ id8, goal, where }) => `${where}의 ${id8} 이어받기: ${goal}`,
      review: ({ id8, where, plan }) => `${where}의 ${id8}가 끝낸 ${plan} 검토하기`,
      start: () => "이 기간에 세션·계획이 없습니다. 시작할 일을 말해 주세요",
    },
    goLine: (say) => `**\`${say}\`** 라고 입력하면 이어갑니다.`,
    noGo: "저절로 실행되는 단계는 아닙니다. 그 세션을 열거나 할 일을 말해 주세요.",
    lanesAtWork: (n) => `다른 레인 ${n}개가 아직 일하는 중이에요. 끝날 때까지 기다리세요`,
    noGoWhileLanes: "지금은 **`go`는 입력하지 마세요.** 레인이 끝나면 `lit adhd`로 다시 확인하세요.",
    unknownSources: (list) => `읽지 못함: ${list}.`,
    older: "오래된 세션은 읽지 않았습니다(읽기 예산 소진).",
    plansSkipped: (n) => `계획 ${n}개는 읽지 못했습니다(읽기 예산 소진).`,
    opener: { done: "지금까지", doing: "지금", next: "다음", nothingDone: "이 기간에 끝낸 일 없음", nothingRunning: "실행 중인 일 없음", type: (say) => `(${say} 입력)`, finishedRun: (plan) => `${plan} (start-work 완료)` },
    noSessions: "이 기간의 Claude Code 세션 기록이 없습니다.",
  },
};

const duration = (ms) => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};
const when = (iso, now, w) => {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return now - at < 60_000 ? w.justNow : w.ago(duration(now - at));
};
// `10-25 14:02`, in the machine's local time: a milestone's date.
const stamp = (iso) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const two = (n) => String(n).padStart(2, "0");
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
};
// Inline code that cannot be broken by a backtick inside the data.
const code = (text) => `\`${stripControls(text).replace(/`/gu, "'")}\``;
// One line of data as Markdown text: no line breaks, no tags, and its emphasis marks escaped.
// Every value printed passes through here or `code`, so a control sequence the collector missed
// (an older record, a hand-made fixture) still cannot reach the terminal.
const bare = (text) => stripControls(text).replace(/\s+/gu, " ").trim();
const plain = (text) => bare(text).replace(/[<>`]/gu, (ch) => ({ "<": "‹", ">": "›", "`": "'" }[ch])).replace(/[*_|[\]\\]/gu, (ch) => `\\${ch}`);

// The last question the session asked, from its last assistant words.
const lastQuestion = (result, escape = plain) => {
  const text = String(result ?? "");
  const found = [...text.matchAll(/[^.!?。？\n]{4,}[?？]/gu)].at(-1)?.[0];
  return found ? escape(clipToWidth(bare(found), 90)) : null;
};

const progressLine = (session, w) => {
  if (session.progress?.gauge) {
    const left = (session.progress.remaining ?? []).filter((name) => name !== "unknown");
    return `${code(session.progress.gauge)}${left.length ? ` · ${w.later}: ${plain(left.slice(0, 2).join(", "))}${left.length > 2 ? ` (+${left.length - 2})` : ""}` : ""}`;
  }
  // A long transcript is read as its head and tail only, so counts of its calls would undercount;
  // its first and last times and its last ask are exact.
  const span = Date.parse(session.last) - Date.parse(session.started);
  const ask = (session.asked ?? []).filter((text) => text && text !== "unknown").at(-1);
  const facts = [
    Number.isFinite(span) && span > 0 ? w.worked(duration(span)) : null,
    ask ? w.lastAsk(plain(clipToWidth(bare(ask), 70))) : null,
  ].filter(Boolean);
  return facts.length ? `⏳ ${facts.join(" · ")}` : null;
};

const doneLine = (session, w) => {
  const files = (session.done?.files ?? []).slice(0, 3).map((file) => code(basename(String(file))));
  const commits = (session.done?.commits ?? []).slice(0, 2).map(({ hash, subject }) => `${code(hash)} ${plain(clipToWidth(subject, 60))}`);
  const parts = [files.length ? `${w.files} ${files.join(", ")}` : null, commits.length ? `${w.commits(session.done.commits.length)}: ${commits.join("; ")}` : null].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  // Head-and-tail reads undercount calls, so tools are named, never counted.
  const tools = Object.entries(session.done?.tools ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => plain(name));
  return tools.length ? w.toolsUsed(tools.join(", ")) : w.noneDone;
};

// What a session's last tool call was about, as `Bash “Run the gates”`.
const actionOf = (session, escape = plain) => {
  const action = session.lastAction;
  if (!action?.tool) return null;
  return action.target ? `${escape(action.tool)} “${escape(clipToWidth(bare(action.target), 50))}”` : escape(action.tool);
};

const nextOf = (session, data, w) => {
  const frames = (data.workflows ?? []).filter((frame) => frame.id8 === session.id8);
  const paused = frames.find((frame) => frame.status === "paused");
  if (paused) return w.resume(paused.skill, paused.stage, session.self);
  if (session.waitingReason === "start-work boundary") return w.approve;
  if (session.status === "waiting-on-user") {
    const question = lastQuestion(session.result);
    if (question) return w.answer(question);
  }
  const work = (data.startWork ?? []).find((item) => item.id8 === session.id8);
  const plan = work ? (data.roadmap?.plans ?? []).find((item) => item.plan === work.plan) : null;
  if (plan && plan.current) return w.planNow(code(plan.plan), plain(plan.current));
  // A finished or idle session's last tool call is history, never its next step.
  if (session.status === "done") return session.finishedPlan ? w.runDone(code(session.finishedPlan)) : w.nothing;
  if (session.status === "active") {
    if (frames.length) return `${frames.at(-1).skill} · ${frames.at(-1).stage}`;
    const doing = actionOf(session);
    return doing ? w.doing(doing) : w.working;
  }
  return w.nothing;
};

const sessionCard = (session, data, now, w) => {
  const reason = session.waitingReason ? ` (${w.reason[session.waitingReason] ?? plain(session.waitingReason)})` : "";
  const ago = when(session.last, now, w);
  const head = `${w.badge[session.status] ?? w.badge.unknown}${reason} · ${code(session.id8)}${ago ? ` · ${ago}` : ""}${session.self ? ` · ${w.self}` : ""}`;
  const goal = session.title && session.title !== "unknown" ? plain(session.title) : plain(session.asked?.[0] ?? "unknown");
  const lines = [head, `**${goal}**`];
  const progress = progressLine(session, w);
  if (progress) lines.push(progress);
  lines.push(`✅ ${w.done}: ${doneLine(session, w)}`);
  lines.push(`▶ ${w.nextLabel}: ${nextOf(session, data, w)}`);
  return lines.map((line) => `> ${line}`).join("  \n");
};

const groupKey = (session) => `${session.worktree}\u0000${session.branch}`;
const placeOf = (session) => (session.worktree && session.worktree !== "unknown" ? basename(String(session.worktree)) : "unknown");
const goalOf = (session) => (session.title && session.title !== "unknown" ? session.title : session.asked?.[0] ?? "unknown");

// Ended sessions, one table row each, newest first: they are history, not something to read now.
const ENDED_ROWS = 8;
const endedTable = (sessions, now, w) => {
  const cell = (text) => plain(text) || "·";
  const rows = sessions.slice(0, ENDED_ROWS).map((session) => {
    const commits = session.done?.commits?.length ?? 0;
    const files = session.done?.files?.length ?? 0;
    // Short cells, so a row stays one line in a 120-column terminal: the age to the largest unit.
    const done = commits ? w.commits(commits) : files ? w.fileCount(files) : "·";
    const at = Date.parse(session.last);
    const age = Number.isFinite(at) ? duration(now - at).split(" ")[0] : "·";
    return `| ${code(session.id8)} | ${cell(clipToWidth(placeOf(session), 20))} | ${cell(clipToWidth(goalOf(session), 44))} | ${cell(age)} | ${cell(done)} |`;
  });
  const head = `| ${w.endedHead.join(" | ")} |`;
  const rule = `|${w.endedHead.map(() => "---").join("|")}|`;
  const more = sessions.length > ENDED_ROWS ? ["", `*${w.moreEnded(sessions.length - ENDED_ROWS)}*`] : [];
  return [head, rule, ...rows, ...more];
};

// When no step can run on `go`, the brief still recommends one from what it read, in this order:
// a session that waits on the user, a paused workflow, the next item of an open plan,
// the most recent other active session, the most recent ended one. It is shown, never recorded.
const suggestion = (data, w) => {
  // Raw text: the headline escapes it once, the box shows it inside a code block.
  const sessions = data.sessions ?? [];
  const where = (session) => bare(placeOf(session));
  const goal = (session) => clipToWidth(bare(goalOf(session)), 50);
  const waiting = sessions.find((session) => session.status === "waiting-on-user" && !session.self);
  if (waiting) return w.suggest.answer({ id8: waiting.id8, where: where(waiting), question: lastQuestion(waiting.result, bare) });
  const paused = (data.workflows ?? []).find((frame) => frame.status === "paused");
  const owner = paused ? sessions.find((session) => session.id8 === paused.id8) : null;
  if (paused) return w.suggest.resume({ id8: paused.id8, skill: paused.skill, stage: paused.stage, where: owner ? where(owner) : basename(String(paused.worktree)) });
  // A plan in the worktree of a live session comes first, then this worktree's, then the newest.
  const liveTrees = new Set(sessions.filter((session) => session.status !== "ended").map((session) => session.worktree));
  const open = (data.roadmap?.plans ?? []).filter((item) => item.current);
  const plan = open.find((item) => liveTrees.has(item.worktree)) ?? open.find((item) => item.local) ?? open[0];
  if (plan) return w.suggest.plan({ plan: plan.local ? plan.plan : `${basename(String(plan.worktree))}/${plan.plan}`, item: clipToWidth(bare(plan.current), 60) });
  const active = sessions.find((session) => session.status === "active" && !session.self);
  if (active) return w.suggest.check({ id8: active.id8, goal: goal(active), where: where(active), doing: actionOf(active, bare) });
  // Otherwise the newest listed session that is not running: review what a done one finished, or pick
  // up an idle or ended one. Only an empty window says there is nothing.
  const settled = sessions.find((session) => ["done", "idle", "ended"].includes(session.status) && !session.self);
  if (settled?.status === "done") return w.suggest.review({ id8: settled.id8, where: where(settled), plan: settled.finishedPlan ? bare(settled.finishedPlan) : goal(settled) });
  if (settled) return w.suggest.pickUp({ id8: settled.id8, goal: goal(settled), where: where(settled) });
  return w.suggest.start();
};

// The roadmap timeline: finished commits with their dates, then the current item and gauge of each
// open plan of this worktree or one under way elsewhere (an untouched plan of another worktree is
// only counted), then what comes after it, then litgoal objectives.
const ROADMAP_PLANS = 4;
const roadmapLines = (data, w) => {
  const lines = [];
  for (const commit of (data.commits ?? []).slice(0, 5).reverse()) {
    lines.push(`- ✓ ${stamp(commit.at)} · ${code(commit.branch)} ${plain(clipToWidth(commit.subject, 70))}`);
  }
  const plans = data.roadmap?.plans ?? [];
  const shownPlans = plans.slice(0, ROADMAP_PLANS);
  const omitted = plans.length - shownPlans.length + (data.roadmap?.plansOmitted ?? 0);
  for (const plan of shownPlans) {
    const where = plan.local ? "" : `${code(basename(String(plan.worktree)))} `;
    lines.push(`- ▶ **${w.now}** · ${where}${code(plan.plan)} ${plan.progress?.gauge ? code(plan.progress.gauge) : ""} → ${plain(plan.current)}`);
    const later = (plan.progress?.remaining ?? []).filter((name) => name !== "unknown" && name !== plan.current).slice(0, 2);
    for (const item of later) lines.push(`  - ○ ${w.later} · ${plain(item)}`);
  }
  if (omitted > 0) lines.push(`- ${w.morePlans(omitted)}`);
  for (const goal of data.roadmap?.litgoal ?? []) {
    const mark = goal.status === "complete" ? "✓" : "▶";
    lines.push(`- ${mark} litgoal ${goal.progress?.gauge ? code(goal.progress.gauge) : ""} ${plain(goal.objective)}`);
  }
  return lines.length ? lines : [w.noRoadmap];
};

// A box the width of its longest line, padded by display width so Hangul keeps the right edge.
const box = (title, body) => {
  const width = Math.max(displayWidth(title) + 2, ...body.map((line) => displayWidth(line))) + 2;
  const pad = (line) => `${line}${" ".repeat(Math.max(0, width - 2 - displayWidth(line)))}`;
  return ["```", `╭─ ${title} ${"─".repeat(Math.max(1, width - displayWidth(title) - 3))}╮`, ...body.map((line) => `│ ${pad(line)} │`), `╰${"─".repeat(width)}╯`, "```"].join("\n");
};

// Wraps a step to the box at word breaks, three lines at most, the last one clipped.
const wrap = (text, width, lines = 3) => {
  const out = [""];
  for (const word of bare(text).split(" ")) {
    const joined = out.at(-1) ? `${out.at(-1)} ${word}` : word;
    if (displayWidth(joined) <= width || !out.at(-1)) out[out.length - 1] = joined;
    else out.push(word);
  }
  const kept = out.slice(0, lines);
  if (out.length > lines) kept[lines - 1] = `${kept[lines - 1]} ${out.slice(lines).join(" ")}`;
  return kept.map((line) => clipToWidth(line, width));
};

const stepText = (next, w) => {
  const target = next?.target ?? {};
  const describe = w.stepKind[next?.kind] ?? w.stepKind.none;
  return bare(describe({ skill: target.skill, stage: target.stage, plan: target.plan, action: target.action, root: target.root }));
};

// The three lines that open the brief, from records only. Done: this worktree's newest commits in
// the window (two at most), then its completed start-work runs and its plans with every row ticked
// (three items at most), else its finished litgoal. Doing: this session's top frame, else its
// running start-work, else the newest active session's title. Next: the step and the word to type.
const openerLines = (data, step, w) => {
  const local = data.scope?.worktrees?.[0];
  const subjects = (data.commits ?? []).filter((commit) => commit.worktree === local).slice(0, 2).map((commit) => plain(commit.subject));
  const runs = (data.finished?.runs ?? []).filter((run) => run.worktree === local);
  const runPlans = new Set(runs.map((run) => run.plan));
  const finished = [
    ...runs.map((run) => w.opener.finishedRun(code(run.plan))),
    ...(data.finished?.plans ?? []).filter((plan) => plan.worktree === local && !runPlans.has(plan.plan)).map((plan) => `${code(plan.plan)}${plan.gauge ? ` ${code(plan.gauge)}` : ""}`),
  ];
  const items = [...subjects, ...[...new Set(finished)]].slice(0, 3);
  const finishedGoal = (data.roadmap?.litgoal ?? []).find((goal) => goal.local && goal.status === "complete");
  const done = items.length ? items.join("; ") : finishedGoal ? plain(finishedGoal.objective) : w.opener.nothingDone;
  const sessions = data.sessions ?? [];
  const selfId = sessions.find((session) => session.self)?.id8 ?? null;
  const frame = (data.workflows ?? []).filter((item) => item.self || (selfId && item.id8 === selfId)).at(-1);
  const work = (data.startWork ?? []).find((item) => item.self && item.status === "active");
  const active = sessions.find((session) => session.status === "active");
  const gaugeOf = (progress) => (progress?.gauge ? code(progress.gauge) : null);
  const doing = frame
    ? [frame.skill, frame.stage, gaugeOf(frame.progress)].filter((part) => part && part !== "unknown").join(" · ")
    : work
      ? ["start-work", work.plan, gaugeOf(work.progress)].filter(Boolean).join(" · ")
      : active ? plain(clipToWidth(goalOf(active), 80)) : w.opener.nothingRunning;
  const say = data.next?.say ?? null;
  return [
    `${w.opener.done}: ${done}  `,
    `${w.opener.doing}: ${doing}  `,
    `${w.opener.next}: ${plain(step)}${say ? ` ${w.opener.type(say)}` : ""}`,
  ];
};

/** The brief as Markdown. `lang` is `ko` or `en`; `now` the clock the relative times use. */
export const renderBrief = (data, { lang = "en", now = Date.parse(data.generatedAt) || Date.now(), width = 72 } = {}) => {
  const w = WORDS[lang] ?? WORDS.en;
  const sessions = data.sessions ?? [];
  const summary = data.summary ?? { sessions: sessions.length, waitingOnUser: 0, active: 0 };
  // With no step for `go`, this worktree's HANDOFF.md Next item comes before the generic suggestion.
  // While other lanes work, the step is to answer the one waiting on the user, or else to wait.
  const handoffNext = (data.handoffs ?? []).find((handoff) => handoff.local && handoff.next)?.next ?? null;
  const lanes = data.next?.wait?.lanes ?? 0;
  const waiting = sessions.some((session) => session.status === "waiting-on-user" && !session.self);
  const step = data.next?.kind && data.next.kind !== "none"
    ? stepText(data.next, w)
    : lanes ? bare(waiting ? suggestion(data, w) : w.lanesAtWork(lanes)) : bare(handoffNext ?? suggestion(data, w));
  const out = [...openerLines(data, step, w), ""];
  out.push(`## 🧭 ${[w.sessions(summary.sessions), w.waiting(summary.waitingOnUser), w.active(summary.active)].join(" · ")} · ${w.next}: ${plain(step)}`);
  out.push(`*${w.window(data.scope?.since ?? "7d", (data.scope?.worktrees ?? []).length || 1)}*`);
  if (!sessions.length) out.push("", w.noSessions);
  // Sessions that are live or wait on the user come first, as full cards grouped by worktree.
  const live = sessions.filter((session) => session.status !== "ended");
  const ended = sessions.filter((session) => session.status === "ended");
  const groups = new Map();
  for (const session of live) {
    const key = groupKey(session);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  for (const list of groups.values()) {
    const { worktree, branch } = list[0];
    const name = worktree && worktree !== "unknown" ? basename(String(worktree)) : "unknown";
    out.push("", `### 🌿 ${code(branch ?? "unknown")} · ${plain(name)}`);
    for (const session of list) out.push("", sessionCard(session, data, now, w));
  }
  if (ended.length) out.push("", `### ⚪ ${w.endedTitle(ended.length)}`, "", ...endedTable(ended, now, w));
  out.push("", `### 🗺️ ${w.roadmap}${data.roadmap?.progress?.gauge ? ` ${code(data.roadmap.progress.gauge)}` : ""}`, "", ...roadmapLines(data, w));
  const say = data.next?.say ?? null;
  const body = wrap(step, width - 4);
  if (data.next?.command) body.push(clipToWidth(data.next.command, width - 4));
  if (say) body.push(`${w.type}: ${say}`);
  out.push("", box(w.recommended, body));
  out.push("", say ? w.goLine(say) : lanes ? w.noGoWhileLanes : w.noGo);
  const unknown = Object.entries(data.sources ?? {}).filter(([, status]) => status !== "ok").map(([name]) => name);
  const notes = [
    unknown.length ? w.unknownSources(unknown.join(", ")) : null,
    data.budget?.exhausted ? w.older : null,
    data.roadmap?.plansSkipped > 0 ? w.plansSkipped(data.roadmap.plansSkipped) : null,
  ].filter(Boolean);
  if (notes.length) out.push("", `*${notes.join(" ")}*`);
  return `${out.join("\n")}\n`;
};
