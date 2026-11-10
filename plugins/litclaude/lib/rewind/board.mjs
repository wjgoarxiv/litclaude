// The lit-adhd KPI board (lit-adhd v2): what a returning reader sees first. Code computes every
// count, bar, list and reminder from the collector's records (buildBoard) and draws the Markdown
// (renderBoard), so the model only copies it. Six sections in a fixed order: the one thing to do now
// and what to type, four bucket counts with an overall bar, a milestone table, the latest finished
// items, what is left in plan order, and action-shaped reminders. The board never shows a session
// id, a commit hash, a raw status code or an internal record path; the per-session cards
// (brief.mjs) stay available under it on request.

import { basename } from "node:path";

import { bare, code, lastQuestion, plain } from "./brief.mjs";
import { clipToWidth } from "./gauge.mjs";

const CELLS = 10;
const LIMITS = { milestones: 5, done: 5, remaining: 7, reminders: 5 };
const LINE_CAP = 40;
// An open plan nobody changed for this many days is a reminder: resume it or drop it.
export const STALE_PLAN_DAYS = 7;
const TEXT_MAX = 80;
const known = (value) => Number.isInteger(value) && value >= 0;

/**
 * `█████░░░░░ 9/18 (50%)`: ten cells, floored, one cell for any progress and never a full bar
 * before the end. Null unless both numbers are real and the total is above zero.
 */
export const bar = (done, total, { percent = true } = {}) => {
  if (!known(done) || !known(total) || total === 0) return null;
  const k = Math.min(done, total);
  let filled = Math.floor((k * CELLS) / total);
  if (k > 0 && filled === 0) filled = 1;
  if (k < total && filled === CELLS) filled = CELLS - 1;
  const cells = `${"█".repeat(filled)}${"░".repeat(CELLS - filled)} ${k}/${total}`;
  return percent ? `${cells} (${Math.floor((k * 100) / total)}%)` : cells;
};

// A plan's name for a person: its first `# ` heading, else its file name without the date prefix.
const humanize = (plan) => basename(String(plan ?? "")).replace(/\.md$/u, "").replace(/^\d{4}-\d{2}-\d{2}-/u, "").replace(/[-_]+/gu, " ").trim() || "plan";
const planName = (plan) => (plan?.title ? plan.title : humanize(plan?.plan));
const placeOf = (worktree) => (worktree && worktree !== "unknown" ? basename(String(worktree)) : null);
// A row's words without its Markdown emphasis, so `**T3** add it` reads `T3 add it`.
const sentence = (text) => clipToWidth(bare(String(text ?? "").replace(/\*\*|__|`/gu, "")), TEXT_MAX);

// Lanes at work: another live session that is working, or a herdr agent working or blocked here.
// A session that waits for an answer is not working; it is a reminder of its own.
const workingLanes = (data) => {
  const lanes = new Set((data.sessions ?? []).filter((session) => !session.self && session.status === "active").map((session) => session.id8));
  for (const agent of data.herdr?.agents ?? []) {
    if (!agent.self && ["working", "blocked"].includes(agent.status)) lanes.add(agent.id8 ?? agent.pane);
  }
  return lanes.size;
};

const milestonesOf = (data) => {
  const works = data.startWork ?? [];
  const workOf = (plan) => works.find((work) => work.plan === plan.plan && work.worktree === plan.worktree);
  const plans = [...(data.roadmap?.plans ?? []), ...(data.finished?.plans ?? [])];
  const seen = new Set();
  const list = [];
  for (const plan of plans) {
    const key = `${plan.worktree}\u0000${plan.plan}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { done, total } = plan.progress ?? {};
    if (!known(done) || !known(total) || total === 0) continue;
    const work = workOf(plan);
    const status = done >= total ? "done" : work?.status === "paused" ? "waiting" : work?.status === "active" || done > 0 ? "doing" : "todo";
    list.push({
      kind: "plan",
      name: sentence(planName(plan)),
      where: plan.local ? null : placeOf(plan.worktree),
      status,
      done,
      total,
      atMs: Number.isFinite(plan.changedMs) ? plan.changedMs : null,
      current: Boolean(work?.self),
      local: Boolean(plan.local),
      rows: (plan.rows ?? []).map((row) => ({ checked: Boolean(row.checked), text: sentence(row.title) })),
    });
  }
  // A running start-work whose plan is not listed above is a milestone of its own.
  for (const work of works) {
    if (seen.has(`${work.worktree}\u0000${work.plan}`) || !["active", "paused"].includes(work.status)) continue;
    const { done, total } = work.progress ?? {};
    if (!known(done) || !known(total) || total === 0) continue;
    list.push({
      kind: "run", name: sentence(humanize(work.plan)), where: null, status: work.status === "paused" ? "waiting" : "doing", done, total, atMs: null, current: Boolean(work.self), local: true,
      rows: (work.progress.remaining ?? []).filter((name) => name !== "unknown").map((name) => ({ checked: false, text: sentence(name) })),
    });
  }
  for (const goal of data.roadmap?.litgoal ?? []) {
    const { done, total } = goal.progress ?? {};
    if (!known(done) || !known(total) || total === 0) continue;
    const status = goal.status === "complete" || done >= total ? "done" : done > 0 ? "doing" : "todo";
    list.push({
      kind: "goal", name: sentence(goal.objective), where: goal.local ? null : placeOf(goal.worktree), status, done, total, atMs: null, current: false, local: Boolean(goal.local),
      rows: (goal.progress.remaining ?? []).filter((name) => name !== "unknown").map((name) => ({ checked: false, text: sentence(name) })),
    });
  }
  const rank = (item) => (item.current ? -1 : { waiting: 0, doing: 0, todo: 1, done: 2 }[item.status]);
  return list.sort((a, b) => rank(a) - rank(b) || Number(b.local) - Number(a.local) || (b.atMs ?? 0) - (a.atMs ?? 0));
};

// The one thing to do now. The step itself is the collector's (`next`, the same record `go`
// continues), then the brief's own fallback order; only the words change: an action, a reason, and
// what to type, or where to go when nothing runs on `go`.
const doNowOf = (data) => {
  const next = data.next ?? {};
  const target = next.target ?? {};
  const sessions = data.sessions ?? [];
  const nameOfPlan = (path) => {
    const plan = [...(data.roadmap?.plans ?? []), ...(data.finished?.plans ?? [])].find((item) => item.plan === path);
    return sentence(plan ? planName(plan) : humanize(path));
  };
  if (next.kind === "resume-frame") return { kind: "resume", skill: target.skill, stage: target.stage, type: next.say ?? "lit continue" };
  if (next.kind === "approve-boundary") return { kind: "approve", plan: nameOfPlan(target.plan), action: target.action ?? null, root: placeOf(target.root), type: next.say ?? "lit approve", alt: "lit cancel" };
  if (next.kind === "continue-work") {
    const work = (data.startWork ?? []).find((item) => item.plan === target.plan);
    return { kind: "continue", plan: nameOfPlan(target.plan), done: work?.progress?.done ?? null, total: work?.progress?.total ?? null, type: next.say ?? "go" };
  }
  if (next.kind === "start-plan") return { kind: "start-plan", plan: nameOfPlan(target.plan), type: next.say ?? "go" };
  const waiting = sessions.find((session) => session.status === "waiting-on-user" && !session.self && session.waitingReason !== "paused workflow");
  const answer = (session) => ({ kind: "answer", id8: session.id8, where: placeOf(session.worktree) ?? "?", question: lastQuestion(session.result, bare), type: null });
  const lanes = next.wait?.lanes ?? 0;
  if (lanes) return waiting ? answer(waiting) : { kind: "wait", lanes, type: null };
  const handoff = (data.handoffs ?? []).find((item) => item.local && item.next)?.next;
  if (handoff) return { kind: "handoff", item: sentence(handoff), type: null };
  if (waiting) return answer(waiting);
  const paused = (data.workflows ?? []).find((frame) => frame.status === "paused");
  if (paused) {
    const owner = sessions.find((session) => session.id8 === paused.id8);
    return { kind: "resume-there", id8: paused.id8, skill: paused.skill, stage: paused.stage, where: placeOf(owner?.worktree ?? paused.worktree) ?? "?", type: "lit continue" };
  }
  const liveTrees = new Set(sessions.filter((session) => session.status !== "ended").map((session) => session.worktree));
  const open = (data.roadmap?.plans ?? []).filter((item) => item.current);
  const plan = open.find((item) => liveTrees.has(item.worktree)) ?? open.find((item) => item.local) ?? open[0];
  if (plan) return { kind: "plan-item", item: sentence(plan.current), plan: sentence(planName(plan)), where: plan.local ? null : placeOf(plan.worktree), type: plan.local ? `/litclaude:start-work ${plan.plan}` : null };
  const active = sessions.find((session) => session.status === "active" && !session.self);
  if (active) return { kind: "check", id8: active.id8, where: placeOf(active.worktree) ?? "?", goal: sentence(active.title && active.title !== "unknown" ? active.title : active.asked?.[0] ?? ""), type: null };
  const settled = sessions.find((session) => ["done", "idle", "ended"].includes(session.status) && !session.self);
  if (settled?.status === "done") return { kind: "review", id8: settled.id8, where: placeOf(settled.worktree) ?? "?", plan: settled.finishedPlan ? nameOfPlan(settled.finishedPlan) : sentence(settled.title), type: "/litclaude:review-work" };
  if (settled) return { kind: "pick-up", id8: settled.id8, where: placeOf(settled.worktree) ?? "?", goal: sentence(settled.title && settled.title !== "unknown" ? settled.title : settled.asked?.[0] ?? ""), type: null };
  return { kind: "start", type: null };
};

const remindersOf = (data, doNow) => {
  const list = [];
  for (const session of data.sessions ?? []) {
    if (session.status !== "waiting-on-user") continue;
    const where = placeOf(session.worktree) ?? "?";
    if (session.waitingReason === "start-work boundary") {
      if (doNow.kind === "approve") continue;
      const work = (data.startWork ?? []).find((item) => item.id8 === session.id8);
      list.push({ kind: "approve", plan: sentence(work ? humanize(work.plan) : session.title), type: "lit approve", alt: "lit cancel" });
    } else if (session.waitingReason === "paused workflow") {
      if ((session.self && doNow.kind === "resume") || (doNow.kind === "resume-there" && doNow.id8 === session.id8)) continue;
      const frame = (data.workflows ?? []).find((item) => item.id8 === session.id8 && item.status === "paused");
      list.push({ kind: "paused", where, self: Boolean(session.self), skill: frame?.skill ?? "workflow", stage: frame?.stage ?? null });
    } else if (!session.self && !(doNow.kind === "answer" && doNow.id8 === session.id8)) {
      list.push({ kind: "answer", where, question: lastQuestion(session.result, bare) });
    }
  }
  for (const tree of data.git ?? []) {
    if (tree.dirty > 0) list.push({ kind: "dirty", where: tree.name, count: tree.dirty });
  }
  for (const tree of data.git ?? []) {
    if (tree.ahead > 0) list.push({ kind: "unpushed", where: tree.name, count: tree.ahead });
  }
  const lanes = workingLanes(data);
  if (lanes) list.push({ kind: "lanes", count: lanes });
  const stale = [...(data.stalePlans ?? [])].sort((a, b) => b.days - a.days);
  if (stale.length) list.push({ kind: "stale", name: sentence(planName(stale[0])), days: stale[0].days, more: stale.length - 1 });
  const handoff = (data.handoffs ?? []).find((item) => item.local && item.next)?.next;
  if (handoff && doNow.kind !== "handoff") list.push({ kind: "handoff", item: sentence(handoff) });
  return { reminders: list.slice(0, LIMITS.reminders), remindersOmitted: Math.max(0, list.length - LIMITS.reminders) };
};

/** The board's structured fields, from the collected records alone. */
export const buildBoard = (data) => {
  const milestones = milestonesOf(data);
  const done = milestones.reduce((sum, item) => sum + item.done, 0);
  const total = milestones.reduce((sum, item) => sum + item.total, 0);
  const inProgress = milestones.filter((item) => item.status === "doing").length;
  const waitingItems = milestones.filter((item) => item.status === "waiting").length;
  // Sessions that wait on the user count once each; one parked at a start-work boundary is
  // already its milestone's waiting item.
  const waitingSessions = (data.sessions ?? []).filter((session) => session.status === "waiting-on-user" && session.waitingReason !== "start-work boundary").length;
  const remainingRows = [];
  for (const item of milestones) {
    if (item.status === "done") continue;
    item.rows.filter((row) => !row.checked).forEach((row, index) => {
      remainingRows.push({ text: row.text, state: index === 0 && item.status !== "todo" ? item.status : "todo" });
    });
  }
  const finished = [
    ...(data.finished?.runs ?? []).map((run) => ({ kind: "run", text: sentence(planName([...(data.finished?.plans ?? []), ...(data.roadmap?.plans ?? [])].find((plan) => plan.plan === run.plan && plan.worktree === run.worktree) ?? run)), atMs: Date.parse(run.at) })),
    ...milestones.filter((item) => item.kind === "plan").flatMap((item) => item.rows.filter((row) => row.checked).reverse().map((row) => ({ kind: "row", text: row.text, atMs: item.atMs ?? 0 }))),
  ].sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
  const doNow = doNowOf(data);
  return {
    version: 1,
    doNow,
    counts: { done, inProgress, waiting: waitingItems + waitingSessions, remaining: Math.max(0, total - done - inProgress - waitingItems) },
    overall: { done, total, percent: total ? Math.floor((done * 100) / total) : null, bar: bar(done, total) },
    milestones: milestones.slice(0, LIMITS.milestones).map(({ rows: _rows, current: _current, local: _local, ...item }) => item),
    milestonesOmitted: Math.max(0, milestones.length - LIMITS.milestones),
    doneLately: finished.slice(0, LIMITS.done).map(({ kind, text }) => ({ kind, text })),
    doneOmitted: Math.max(0, finished.length - LIMITS.done),
    remaining: remainingRows.slice(0, LIMITS.remaining),
    remainingOmitted: Math.max(0, remainingRows.length - LIMITS.remaining),
    ...remindersOf(data, doNow),
  };
};

const WORDS = {
  ko: {
    heads: ["🎯 지금 할 일", "📊 한눈에 보기", "🏁 마일스톤", "✅ 최근 끝낸 일", "⬜ 남은 일", "🔔 잊지 말 것"],
    buckets: ["✅ 끝남", "🔄 진행 중", "⏳ 나를 기다림", "⬜ 남음"],
    status: { done: "✅ 끝남", doing: "🔄 진행 중", waiting: "⏳ 나를 기다림", todo: "⬜ 남음" },
    tableHead: ["마일스톤", "상태", "진행", "최근"],
    overall: "전체 진행",
    noItems: "기록된 계획 항목이 없어요",
    more: (n) => `…외 ${n}개`,
    empty: { milestones: "열린 계획이나 목표가 없어요", done: "아직 끝낸 일이 없어요", remaining: "남은 일이 없어요", reminders: "잊지 말 일이 없어요" },
    goal: (name) => `목표: ${name}`,
    runDone: (name) => `${name}: start-work로 끝까지 실행함`,
    type: (text) => `👉 입력: ${code(text)}`,
    typeOr: (text, alt) => `👉 입력: ${code(text)} (끝내려면 ${code(alt)})`,
    typeThere: (text, where) => `👉 ${plain(where)} 세션에서 입력: ${code(text)}`,
    goThere: (where) => `👉 그 세션(${plain(where)})으로 가서 답하기`,
    wait: (n) => `👉 기다리기: 레인 ${n}개가 끝날 때까지 (끝나면 ${code("lit adhd")})`,
    sayIt: "👉 저절로 실행되지 않아요: 시작하라고 직접 말해 주세요",
    openThere: (where) => `👉 ${plain(where)} 세션 화면을 열어 확인하기`,
    pickThere: (where) => `👉 ${plain(where)} 세션을 다시 열거나, 이어 할 일을 말해 주세요`,
    tellMe: "👉 할 일을 말해 주세요",
    workTree: (where) => `👉 ${plain(where)} 워크트리에서 이어 하기`,
    doNow: {
      resume: ({ skill, stage }) => [`멈춘 ${skill}를 ${stage} 단계부터 이어 하기`, "이 세션에서 하던 일이 그 단계에서 멈춰 있어요"],
      approve: ({ plan, action, root }) => [`${plan}: 보류된 단계를 허용할지 정하기`, `남은 일이 모두 ${[root, action].filter(Boolean).join(" ")} 권한을 기다려요`],
      continue: ({ plan, done, total }) => [`${plan} 이어서 진행하기`, known(done) && known(total) ? `이 세션의 start-work가 ${done}/${total}까지 왔어요` : "이 세션의 start-work가 진행 중이에요"],
      "start-plan": ({ plan }) => [`${plan} 시작하기`, "열린 계획이 이것 하나이고 돌고 있는 작업이 없어요"],
      answer: ({ where, question }) => [`${where} 세션의 질문에 답하기`, question ? `“${question}”` : "그 세션이 답을 기다려요"],
      wait: ({ lanes }) => ["다른 레인이 끝날 때까지 기다리기", `레인 ${lanes}개가 아직 일하는 중이라 지금 시작하면 겹칠 수 있어요`],
      handoff: ({ item }) => [item, "HANDOFF에 적어 둔 다음 할 일이에요"],
      "resume-there": ({ where, skill, stage }) => [`${where} 세션의 ${skill} 이어 하기${stage ? ` (${stage})` : ""}`, "그 세션이 그 단계에서 멈춰 있어요"],
      "plan-item": ({ item, plan }) => [item, `${plan}의 다음 항목이에요`],
      check: ({ where, goal }) => [`${where} 세션 확인하기`, goal ? `“${goal}” 작업이 아직 돌고 있어요` : "그 세션이 아직 일하는 중이에요"],
      review: ({ where, plan }) => [`${where} 세션이 끝낸 ${plan} 검토하기`, "start-work가 끝까지 실행했어요"],
      "pick-up": ({ where, goal }) => [`${where} 세션의 일 이어받기${goal ? `: ${goal}` : ""}`, "가장 최근에 멈춘 세션이에요"],
      start: () => ["시작할 일 정하기", "이 기간에 세션도 계획도 없어요"],
    },
    reminder: {
      approve: ({ plan, type, alt }) => `⏳ ${plain(plan)}: start-work가 보류한 단계 → ${code(type)} 또는 ${code(alt)}`,
      paused: ({ where, self, skill, stage }) => `⏳ ${self ? "이 세션" : `${plain(where)} 세션`}의 ${plain(skill)}${stage ? `(${plain(stage)})` : ""}가 멈춰 있음 → ${self ? "레인이 끝나면" : "그 세션에서"} ${code("lit continue")}`,
      answer: ({ where, question }) => `⏳ ${plain(where)} 세션이 묻고 있어요${question ? `: “${plain(question)}”` : ""} → 그 세션으로 가서 답하기`,
      dirty: ({ where, count }) => `💾 커밋 안 된 변경 ${count}개 (${plain(where)}) → 확인하고 커밋하거나 정리하기`,
      unpushed: ({ where, count }) => `⬆️ 푸시 안 된 커밋 ${count}개 (${plain(where)}) → 준비되면 ${code("git push")}`,
      lanes: ({ count }) => `🏃 아직 일하는 레인 ${count}개 → 끝날 때까지 ${code("go")} 치지 않기`,
      stale: ({ name, days, more }) => `🕰️ ${days}일째 멈춘 계획: ${plain(name)}${more ? ` (외 ${more}개)` : ""} → 이어 할지, 접을지 정하기`,
      handoff: ({ item }) => `📝 HANDOFF의 다음 항목: ${plain(item)} → 오늘 할 일인지 정하기`,
    },
    moreReminders: (n) => `…알림 ${n}개 더`,
    when: { now: "방금", minutes: (n) => `${n}분 전`, today: (t) => `오늘 ${t}`, yesterday: (t) => `어제 ${t}`, days: (n) => `${n}일 전`, none: "—" },
    unread: (list) => `읽지 못함: ${list}.`,
    sources: { transcripts: "세션 기록", plans: "계획", git: "git" },
    budget: "오래된 기록 일부는 읽지 않았어요(읽기 예산 소진).",
    detail: `세션별 자세한 내용: ${code("lit adhd 자세히")}`,
  },
  en: {
    heads: ["🎯 Do this now", "📊 At a glance", "🏁 Milestones", "✅ Done lately", "⬜ Still to do", "🔔 Don't forget"],
    buckets: ["✅ Done", "🔄 In progress", "⏳ Waiting on you", "⬜ Left"],
    status: { done: "✅ Done", doing: "🔄 In progress", waiting: "⏳ Waiting on you", todo: "⬜ Not started" },
    tableHead: ["Milestone", "Status", "Progress", "Last change"],
    overall: "Overall",
    noItems: "no plan items on record",
    more: (n) => `…and ${n} more`,
    empty: { milestones: "No open plan or goal", done: "Nothing finished yet", remaining: "Nothing left", reminders: "Nothing to remember" },
    goal: (name) => `Goal: ${name}`,
    runDone: (name) => `${name}: start-work ran it to the end`,
    type: (text) => `👉 Type: ${code(text)}`,
    typeOr: (text, alt) => `👉 Type: ${code(text)} (or ${code(alt)} to end the run)`,
    typeThere: (text, where) => `👉 In the ${plain(where)} session, type: ${code(text)}`,
    goThere: (where) => `👉 Go to that session (${plain(where)}) and answer there`,
    wait: (n) => `👉 Wait: until the ${n} ${n === 1 ? "lane finishes" : "lanes finish"} (then ${code("lit adhd")})`,
    sayIt: "👉 Nothing runs on its own here: say that you want to start it",
    openThere: (where) => `👉 Open the ${plain(where)} session and look`,
    pickThere: (where) => `👉 Reopen the ${plain(where)} session, or say what to continue`,
    tellMe: "👉 Say what to work on",
    workTree: (where) => `👉 Continue in the ${plain(where)} worktree`,
    doNow: {
      resume: ({ skill, stage }) => [`Resume the paused ${skill} at ${stage}`, "This session stopped there and waits for you"],
      approve: ({ plan, action, root }) => [`${plan}: decide on the parked steps`, `Every open task waits for ${[action, root ? `access to ${root}` : "access"].filter(Boolean).join(" ")}`],
      continue: ({ plan, done, total }) => [`Keep going with ${plan}`, known(done) && known(total) ? `This session's start-work is at ${done}/${total}` : "This session's start-work is running"],
      "start-plan": ({ plan }) => [`Start ${plan}`, "It is the only open plan and nothing else is running"],
      answer: ({ where, question }) => [`Answer the question in the ${where} session`, question ? `“${question}”` : "That session waits for your answer"],
      wait: ({ lanes }) => ["Wait for the other lanes to finish", `${lanes} ${lanes === 1 ? "lane is" : "lanes are"} still working, so starting now could collide`],
      handoff: ({ item }) => [item, "It is the next item in your HANDOFF"],
      "resume-there": ({ where, skill, stage }) => [`Resume ${skill} in the ${where} session${stage ? ` (${stage})` : ""}`, "That session stopped there"],
      "plan-item": ({ item, plan }) => [item, `It is next in ${plan}`],
      check: ({ where, goal }) => [`Check on the ${where} session`, goal ? `“${goal}” is still running` : "It is still working"],
      review: ({ where, plan }) => [`Review what the ${where} session finished: ${plan}`, "start-work ran it to the end"],
      "pick-up": ({ where, goal }) => [`Pick up the ${where} session${goal ? `: ${goal}` : ""}`, "It is the most recent session that stopped"],
      start: () => ["Decide what to start", "No session or plan in this window"],
    },
    reminder: {
      approve: ({ plan, type, alt }) => `⏳ ${plain(plan)}: start-work parked some steps → ${code(type)} or ${code(alt)}`,
      paused: ({ where, self, skill, stage }) => `⏳ ${plain(skill)}${stage ? ` (${plain(stage)})` : ""} is paused in ${self ? "this session" : `the ${plain(where)} session`} → ${self ? "once the lanes finish," : "there,"} ${code("lit continue")}`,
      answer: ({ where, question }) => `⏳ The ${plain(where)} session asks${question ? `: “${plain(question)}”` : " you something"} → answer it there`,
      dirty: ({ where, count }) => `💾 ${count} uncommitted ${count === 1 ? "change" : "changes"} (${plain(where)}) → review, then commit or clean up`,
      unpushed: ({ where, count }) => `⬆️ ${count} unpushed ${count === 1 ? "commit" : "commits"} (${plain(where)}) → ${code("git push")} when ready`,
      lanes: ({ count }) => `🏃 ${count} ${count === 1 ? "lane is" : "lanes are"} still working → do not type ${code("go")} until ${count === 1 ? "it finishes" : "they finish"}`,
      stale: ({ name, days, more }) => `🕰️ A plan untouched for ${days} days: ${plain(name)}${more ? ` (+${more} more)` : ""} → decide to resume or drop it`,
      handoff: ({ item }) => `📝 Next in your HANDOFF: ${plain(item)} → decide if it is today's work`,
    },
    moreReminders: (n) => `…${n} more ${n === 1 ? "reminder" : "reminders"}`,
    when: { now: "just now", minutes: (n) => `${n}m ago`, today: (t) => `today ${t}`, yesterday: (t) => `yesterday ${t}`, days: (n) => `${n}d ago`, none: "—" },
    unread: (list) => `Not read: ${list}.`,
    sources: { transcripts: "session records", plans: "plans", git: "git" },
    budget: "Some older records were not read (read budget used up).",
    detail: `Per-session detail: ${code("lit adhd detail")}`,
  },
};

// `10분 전`, `오늘 14:02`, `어제 09:30`, `3일 전`, in the machine's local time.
const whenOf = (atMs, now, w) => {
  if (!Number.isFinite(atMs)) return w.when.none;
  const minutes = Math.max(0, Math.floor((now - atMs) / 60_000));
  if (minutes < 1) return w.when.now;
  if (minutes < 60) return w.when.minutes(minutes);
  const at = new Date(atMs);
  const today = new Date(now);
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (atMs >= dayStart) return w.when.today(hhmm);
  if (atMs >= dayStart - 86_400_000) return w.when.yesterday(hhmm);
  return w.when.days(Math.max(1, Math.round((dayStart - atMs) / 86_400_000)));
};

const typeLine = (doNow, w) => {
  if (doNow.kind === "approve") return w.typeOr(doNow.type, doNow.alt);
  if (doNow.kind === "resume-there") return w.typeThere(doNow.type, doNow.where);
  if (doNow.kind === "answer") return w.goThere(doNow.where);
  if (doNow.kind === "wait") return w.wait(doNow.lanes);
  if (doNow.kind === "plan-item" && !doNow.type) return w.workTree(doNow.where ?? "?");
  if (doNow.type) return w.type(doNow.type);
  if (doNow.kind === "handoff") return w.sayIt;
  if (doNow.kind === "check") return w.openThere(doNow.where);
  if (doNow.kind === "pick-up") return w.pickThere(doNow.where);
  return w.tellMe;
};

const draw = (board, data, now, w, limits) => {
  const out = [];
  const [action, why] = w.doNow[board.doNow.kind](board.doNow);
  out.push(`## ${w.heads[0]}`, `**${plain(action)}** — ${plain(why)}  `, typeLine(board.doNow, w), "");
  const { done, inProgress, waiting, remaining } = board.counts;
  out.push(`## ${w.heads[1]}`, `| ${w.buckets.join(" | ")} |`, "|:--:|:--:|:--:|:--:|", `| ${done} | ${inProgress} | ${waiting} | ${remaining} |`, "", `${w.overall}  ${board.overall.bar ?? w.noItems}`, "");
  out.push(`## ${w.heads[2]}`);
  const milestones = board.milestones.slice(0, limits.milestones);
  if (milestones.length) {
    out.push(`| ${w.tableHead.join(" | ")} |`, "|---|---|---|---|");
    for (const item of milestones) {
      const name = item.kind === "goal" ? w.goal(item.name) : item.name;
      out.push(`| ${plain(item.where ? `${name} (${item.where})` : name)} | ${w.status[item.status]} | ${bar(item.done, item.total, { percent: false })} | ${whenOf(item.atMs, now, w)} |`);
    }
    const omitted = board.milestonesOmitted + board.milestones.length - milestones.length;
    if (omitted > 0) out.push(`| ${w.more(omitted)} | | | |`);
  } else out.push(w.empty.milestones);
  out.push("", `## ${w.heads[3]}`);
  const finished = board.doneLately.slice(0, limits.done);
  if (finished.length) for (const item of finished) out.push(`- ${plain(item.kind === "run" ? w.runDone(item.text) : item.text)}`);
  else out.push(w.empty.done);
  out.push("", `## ${w.heads[4]}`);
  const left = board.remaining.slice(0, limits.remaining);
  if (left.length) {
    left.forEach((item, index) => out.push(`${index + 1}. ${item.state === "doing" ? "🔄 " : item.state === "waiting" ? "⏳ " : ""}${plain(item.text)}`));
    const omitted = board.remainingOmitted + board.remaining.length - left.length;
    if (omitted > 0) out.push(w.more(omitted));
  } else out.push(w.empty.remaining);
  out.push("", `## ${w.heads[5]}`);
  if (board.reminders.length) {
    for (const item of board.reminders) out.push(`- ${w.reminder[item.kind](item)}`);
    if (board.remindersOmitted > 0) out.push(`- ${w.moreReminders(board.remindersOmitted)}`);
  } else out.push(w.empty.reminders);
  // Only a source whose absence changes what the board can say is named; the full list is in the detail.
  const unread = Object.entries(w.sources).filter(([key]) => data.sources?.[key] && data.sources[key] !== "ok").map(([, label]) => label);
  const notes = [unread.length ? w.unread(unread.join(", ")) : null, data.budget?.exhausted || data.roadmap?.plansSkipped > 0 ? w.budget : null].filter(Boolean);
  out.push("", ...notes.map((note) => `*${note}*`), `*${w.detail}*`);
  return out;
};

/**
 * The board as Markdown, at most forty lines: when every list is full, still-to-do, then done
 * lately, then the milestone table give up rows (counted in their `…외 N개`) until it fits.
 */
export const renderBoard = (data, { lang = "en", now = Date.parse(data.generatedAt) || Date.now() } = {}) => {
  const w = WORDS[lang] ?? WORDS.en;
  const board = buildBoard(data);
  const limits = { ...LIMITS };
  let lines = draw(board, data, now, w, limits);
  while (lines.length > LINE_CAP) {
    if (limits.remaining > 3) limits.remaining -= 1;
    else if (limits.done > 3) limits.done -= 1;
    else if (limits.milestones > 3) limits.milestones -= 1;
    else break;
    lines = draw(board, data, now, w, limits);
  }
  return `${lines.join("\n")}\n`;
};
