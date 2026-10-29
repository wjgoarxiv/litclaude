// The lit-adhd record collector behind `litclaude-ai rewind` (plans/lit-adhd.md todo 10). It reads
// what is on disk for every worktree of this repo (Claude transcripts, the litgoal ledger, plan
// rows, handoff headings, git log, workflow stacks, start-work state, and herdr when HERDR_ENV=1)
// and returns one redacted, capped JSON brief. A source that is not there reads `unknown`; nothing
// is inferred. It writes one file only: this session's next-step record for `go`.

import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parsePlanTaskRows } from "../plan-task-rows.mjs";
import { resolveProjectStateRoot } from "../project-state-root.mjs";
import { renderBrief } from "./brief.mjs";
import { aggregateProgress, clipToWidth, displayWidth, progressOf } from "./gauge.mjs";
import { chooseNextStep, writeNextStep } from "./next-step.mjs";
import { makeRedactor } from "./redact.mjs";
import { findTranscripts, makeBudget, readTranscriptLines, sessionRecord } from "./transcripts.mjs";

const SMALL_FILE_BYTES = 1024 * 1024;
const HERDR_TIMEOUT_MS = 2000;
const GIT_TIMEOUT_MS = 5000;
const DEFAULT_SINCE = "7d";
const DEFAULT_MAX = 12;
const NAME_MAX = 90;
const PLAN_LIMIT = 8;

/** `7d`, `12h`, `30m` in milliseconds, or null. */
export const parseSince = (text) => {
  const match = /^(\d{1,4})([dhm])$/u.exec(String(text ?? ""));
  if (!match) return null;
  return Number(match[1]) * { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[2]];
};

const readSmallFile = (path, budget) => {
  let fd;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const { size } = fstatSync(fd);
    const length = Math.min(size, SMALL_FILE_BYTES, budget.limit - budget.used);
    if (length < size) budget.exhausted = budget.exhausted || length < Math.min(size, SMALL_FILE_BYTES);
    const buffer = Buffer.alloc(Math.max(0, length));
    const read = length > 0 ? readSync(fd, buffer, 0, length, 0) : 0;
    budget.used += read;
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};
const readJson = (path, budget) => {
  const text = readSmallFile(path, budget);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const entries = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
};

const defaultExec = (file, args, options) => execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options });

const worktreesOf = (cwd, exec) => {
  try {
    const out = exec("git", ["worktree", "list", "--porcelain"], { cwd, timeout: GIT_TIMEOUT_MS });
    const paths = out.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9).trim()).filter(Boolean);
    return paths.length ? paths : null;
  } catch {
    return null;
  }
};

// A plan scaffold nobody filled in: a row that is still a `<placeholder>`, or every row the same.
const isTemplate = (rows) => rows.some((row) => /<[^<>]{1,40}>/u.test(row.text)) || (rows.length > 1 && new Set(rows.map((row) => row.text.trim())).size === 1);
const mtimeOf = (path) => {
  try {
    return lstatSync(path).mtimeMs;
  } catch {
    return null;
  }
};

// A plan run by a lane is ticked in the lane's worktree: its copy of the plan and its start-work
// ledger. A record counts for this plan only when the plan names that worktree (`.worktrees/<dir>`
// or `.claude/worktrees/<dir>`) and the ledger's plan file is this plan, by its name or its name
// without the `YYYY-MM-DD-` prefix. The best-progressed record wins; ties and worse keep the plan's own.
const WORKTREE_MENTION = /(?<![A-Za-z0-9_/-])((?:\.claude\/)?\.?worktrees\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79})/gu;
const MENTIONS_MAX = 12;
const isDirectory = (path) => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};
const laneRecordsOf = (root, name, text, budget, redact) => {
  const stem = name.replace(/^\d{4}-\d{2}-\d{2}-/u, "");
  const mentions = [...new Set([...text.matchAll(WORKTREE_MENTION)].map((match) => match[1].replace(/\.+$/u, "")))].slice(0, MENTIONS_MAX);
  return mentions.flatMap((mention) => {
    const tree = join(root, mention);
    if (!isDirectory(tree)) return [];
    const state = readJson(join(tree, ".litclaude", "boulder.json"), budget);
    if (!state || typeof state.works !== "object" || state.works === null) return [];
    return Object.values(state.works).flatMap((work) => {
      const planName = work?.plan_name;
      if (typeof planName !== "string" || !/^[A-Za-z0-9._-]+\.md$/u.test(planName) || (planName !== name && planName !== stem)) return [];
      const copy = readSmallFile(join(tree, "plans", planName), budget);
      const rows = copy === null ? [] : parsePlanTaskRows(copy);
      if (rows.length) {
        const open = rows.filter((row) => !row.checked);
        return [{
          recordedIn: `${mention}/plans/${planName}`,
          rows: rows.map((row) => ({ checked: row.checked, title: clipToWidth(redact(row.text), NAME_MAX) })),
          current: open.length ? clipToWidth(redact(open[0].text), NAME_MAX) : null,
          progress: progressOf(rows.length - open.length, rows.length, open.map((row) => clipToWidth(redact(row.text), NAME_MAX))),
        }];
      }
      const { checked, total, next_task: next } = work.progress ?? {};
      if (!Number.isInteger(checked) || !Number.isInteger(total) || total <= 0 || checked < 0 || checked > total) return [];
      const named = typeof next === "string" && next.trim() ? clipToWidth(redact(next), NAME_MAX) : null;
      const current = checked < total ? named ?? "unknown" : null;
      return [{ recordedIn: `${mention}/.litclaude/boulder.json`, current, progress: progressOf(checked, total, named ? [named] : undefined) }];
    });
  });
};
const share = (progress) => progress.done / progress.total;

// A plan met after the read budget ran out is counted in `skipped.count`, so the brief can say so.
const plansIn = (root, budget, redact, local, skipped = { count: 0 }) => {
  const list = entries(join(root, "plans"));
  if (!list) return null;
  return list.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    if (budget.used >= budget.limit) {
      skipped.count += 1;
      return [];
    }
    const text = readSmallFile(join(root, "plans", entry.name), budget);
    if (text === null) return [];
    const rows = parsePlanTaskRows(text);
    if (!rows.length || isTemplate(rows)) return [];
    const open = rows.filter((row) => !row.checked);
    const done = rows.length - open.length;
    const own = {
      rows: rows.map((row) => ({ checked: row.checked, title: clipToWidth(redact(row.text), NAME_MAX) })),
      current: open.length ? clipToWidth(redact(open[0].text), NAME_MAX) : null,
      progress: progressOf(done, rows.length, open.map((row) => clipToWidth(redact(row.text), NAME_MAX))),
    };
    const best = laneRecordsOf(root, entry.name, text, budget, redact)
      .reduce((top, record) => (share(record.progress) > share(top.progress) ? record : top), own);
    // A plan with every row ticked is kept, marked complete: it is finished work, not roadmap.
    return [{
      worktree: redact(root),
      plan: `plans/${entry.name}`,
      local,
      complete: best.progress.done === best.progress.total,
      changedMs: mtimeOf(join(root, "plans", entry.name)),
      rows: best.rows ?? own.rows,
      current: best.current,
      progress: best.progress,
      ...(best.recordedIn ? { recordedIn: best.recordedIn } : {}),
    }];
  });
};

const litgoalOf = (root, budget, redact) => {
  const goals = readJson(join(root, ".litclaude", "litgoal", "goals.json"), budget);
  if (!goals || !Array.isArray(goals.criteria)) return null;
  const passed = goals.criteria.filter((criterion) => criterion?.status === "passed");
  const remaining = goals.criteria.filter((criterion) => criterion?.status !== "passed").map((criterion) => clipToWidth(redact(String(criterion?.description ?? criterion?.id ?? "unknown")), NAME_MAX));
  return {
    worktree: redact(root),
    status: typeof goals.status === "string" ? goals.status : "unknown",
    objective: clipToWidth(redact(String(goals.objective ?? "unknown").split("\n")[0]), 120),
    progress: progressOf(passed.length, goals.criteria.length, remaining),
  };
};

// The first list item or line of text under a `## Next` or `## Next Steps` heading, without its marker.
const handoffNext = (text) => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s+Next(?:\s+Steps)?\s*$/iu.test(line.trim()));
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/u.test(line.trim())) return null;
    const item = line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/u, "");
    if (item) return item;
  }
  return null;
};

// Only this worktree's own HANDOFF files give a next step (`next`); another worktree's never does.
const handoffsOf = (root, budget, redact, local = false) => (entries(root) ?? [])
  .filter((entry) => entry.isFile() && /^HANDOFF.*\.md$/u.test(entry.name))
  .map((entry) => {
    const text = readSmallFile(join(root, entry.name), budget) ?? "";
    const headings = text.split("\n").slice(0, 40).filter((line) => /^#{1,3} /u.test(line)).map((line) => clipToWidth(redact(line), 100));
    const next = local ? handoffNext(text) : null;
    return { worktree: redact(root), file: entry.name, headings, local, next: next ? clipToWidth(redact(next), 120) : null };
  });

const commitsOf = (root, sinceMs, now, exec, redact) => {
  try {
    const since = new Date(now - sinceMs).toISOString();
    const branch = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeout: GIT_TIMEOUT_MS }).trim();
    const out = exec("git", ["log", `--since=${since}`, "--max-count=20", "--format=%H%x09%cI%x09%s"], { cwd: root, timeout: GIT_TIMEOUT_MS });
    return out.split("\n").filter(Boolean).map((line) => {
      const [hash, at, ...subject] = line.split("\t");
      return { worktree: redact(root), branch: redact(branch), hash: hash.slice(0, 7), at, atMs: Date.parse(at), subject: clipToWidth(redact(subject.join("\t")), 100) };
    });
  } catch {
    return null;
  }
};

const stacksOf = (root, budget, redact) => {
  const directory = join(root, ".litclaude", "workflow-stack");
  const list = entries(directory);
  if (!list) return null;
  return list.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).flatMap((entry) => {
    const stack = readJson(join(directory, entry.name), budget);
    if (!stack || !Array.isArray(stack.frames)) return [];
    return stack.frames.slice(0, 3).map((frame) => ({
      worktree: redact(root),
      sessionId: typeof stack.sessionId === "string" ? stack.sessionId : null,
      id8: typeof stack.sessionId === "string" ? stack.sessionId.slice(0, 8) : "unknown",
      skill: typeof frame.skill === "string" ? frame.skill : "unknown",
      stage: typeof frame.stage === "string" ? frame.stage : "unknown",
      role: frame.role === "spine" ? "spine" : "side",
      status: frame.status === "paused" ? "paused" : "active",
      at: typeof frame.at === "string" ? frame.at : "unknown",
      progress: progressOf(frame.n, frame.total, Array.isArray(frame.remaining) ? frame.remaining.map((name) => clipToWidth(redact(String(name)), NAME_MAX)) : undefined),
    }));
  });
};

const startWorkOf = (root, budget, redact) => {
  const state = readJson(join(root, ".litclaude", "boulder.json"), budget);
  if (!state || typeof state.works !== "object" || state.works === null) return null;
  const work = state.active_work_id ? state.works[state.active_work_id] : null;
  if (!work) return [];
  // The plan's own checkboxes are current; the stored snapshot only moves at a Stop.
  const planText = typeof work.plan_name === "string" && /^[A-Za-z0-9._-]+\.md$/u.test(work.plan_name) ? readSmallFile(join(root, "plans", work.plan_name), budget) : null;
  const rows = planText === null ? [] : parsePlanTaskRows(planText);
  const open = rows.filter((row) => !row.checked);
  const progress = rows.length
    ? progressOf(rows.length - open.length, rows.length, open.map((row) => clipToWidth(redact(row.text), NAME_MAX)))
    : progressOf(work.progress?.checked, work.progress?.total, work.progress?.next_task ? [clipToWidth(redact(work.progress.next_task), NAME_MAX)] : undefined);
  return [{
    worktree: redact(root),
    workId: work.work_id,
    plan: typeof work.plan_name === "string" ? `plans/${work.plan_name}` : "unknown",
    status: work.status,
    sessionId: work.root_session_id ?? null,
    id8: typeof work.root_session_id === "string" ? work.root_session_id.slice(0, 8) : "unknown",
    ...(work.pending_boundary ? { pendingBoundary: { action: work.pending_boundary.action, root: redact(work.pending_boundary.root) } } : {}),
    progress,
  }];
};

// start-work runs this lifecycle completed, from its history: which plan, which session, and when.
const completedRunsOf = (root, budget, redact) => {
  const state = readJson(join(root, ".litclaude", "boulder.json"), budget);
  if (!state || !Array.isArray(state.history)) return null;
  return state.history.filter((entry) => entry?.status === "completed" && typeof entry.plan === "string").map((entry) => ({
    worktree: redact(root),
    plan: `plans/${basename(entry.plan)}`,
    sessionId: state.works?.[entry.work_id]?.root_session_id ?? null,
    atMs: Date.parse(entry.terminal_at),
  })).filter((run) => Number.isFinite(run.atMs));
};

// Each session's last hook event (session-liveness.mjs): `alive`, `idle` or `ended`, newest first.
const LIVENESS_FILES = 24;
const livenessOf = (root, budget) => {
  const directory = join(root, ".litclaude", "liveness");
  const list = entries(directory);
  if (!list) return null;
  return list.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => ({ entry, at: mtimeOf(join(directory, entry.name)) ?? 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, LIVENESS_FILES)
    .flatMap(({ entry }) => {
      const record = readJson(join(directory, entry.name), budget);
      const atMs = Date.parse(record?.at);
      return typeof record?.sessionId === "string" && ["alive", "idle", "ended"].includes(record.state) && Number.isFinite(atMs)
        ? [{ sessionId: record.sessionId, state: record.state, atMs }]
        : [];
    });
};

const herdrOf = (env, exec, redact) => {
  if (env.HERDR_ENV !== "1") return { status: "unknown", agents: [] };
  try {
    const out = exec("herdr", ["agent", "list"], { timeout: HERDR_TIMEOUT_MS });
    return { status: "ok", agents: out.split("\n").filter((line) => line.trim()).slice(0, 20).map((line) => clipToWidth(redact(line.trim()), 120)) };
  } catch {
    return { status: "unknown", agents: [] };
  }
};

const known = (list) => (list === null ? "unknown" : "ok");
const statusRank = { "waiting-on-user": 0, active: 1, idle: 2, done: 2, ended: 3, unknown: 4 };
// The Stop hook writes `idle` just after the turn's last transcript line, so a record this much older
// than that line still describes it; anything older predates a newer prompt.
const LIVENESS_SLACK_MS = 5000;

/**
 * Collects the brief. Options: `cwd`, `here` (cwd only), `since` (`7d`), `max` (12), `sessionId`
 * (this session, for the next step and waiting state), `env`, `now`, `exec` (git/herdr runner).
 */
export const collectRewind = ({
  cwd = process.cwd(),
  here = false,
  since = DEFAULT_SINCE,
  max = DEFAULT_MAX,
  sessionId = null,
  env = process.env,
  now = Date.now(),
  exec = defaultExec,
  record = true,
} = {}) => {
  const home = env.HOME || homedir();
  const redact = makeRedactor({ env, home });
  const budget = makeBudget();
  const sinceMs = parseSince(since) ?? parseSince(DEFAULT_SINCE);
  const limit = Number.isInteger(max) && max > 0 ? Math.min(max, 50) : DEFAULT_MAX;
  const start = resolve(cwd);
  const stateRoot = resolveProjectStateRoot(start);
  const listed = here ? null : worktreesOf(start, exec);
  const roots = [...new Set([start, ...(here ? [] : listed ?? [stateRoot])])];

  // The small records first: plans, litgoal, handoffs and stacks cost little, and the transcripts
  // after them may use up the read budget.
  const collectEach = (read) => {
    const results = roots.map(read);
    return results.every((value) => value === null) ? null : results.flatMap((value) => value ?? []);
  };
  const plansSkipped = { count: 0 };
  const plans = collectEach((root) => plansIn(root, budget, redact, resolve(root) === stateRoot || resolve(root) === start, plansSkipped));
  const litgoal = collectEach((root) => {
    const goal = litgoalOf(root, budget, redact);
    return goal ? [{ ...goal, local: resolve(root) === stateRoot || resolve(root) === start }] : null;
  });
  const handoffs = roots.flatMap((root) => handoffsOf(root, budget, redact, resolve(root) === start));
  const workflows = collectEach((root) => stacksOf(root, budget, redact));
  const startWork = collectEach((root) => startWorkOf(root, budget, redact));
  const runs = collectEach((root) => completedRunsOf(root, budget, redact));
  const liveness = collectEach((root) => livenessOf(root, budget));

  const rootSet = new Set(roots.map((root) => resolve(root).normalize("NFC")));
  const transcripts = findTranscripts(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), roots);
  const sessions = [];
  for (const file of transcripts.files) {
    if (sessions.length >= limit || budget.exhausted) break;
    const lines = readTranscriptLines(file, budget);
    const session = lines ? sessionRecord(lines, { redact, now }) : null;
    if (!session || (session.lastMs !== null && now - session.lastMs > sinceMs)) continue;
    // Claude's folder slug maps every non-alphanumeric to `-`, so `client_a` and `client-a` share one
    // folder; a session counts only when the cwd it recorded is one of the folders asked about.
    const recorded = session.cwd ? resolve(session.cwd).normalize("NFC") : null;
    if (here ? recorded && recorded !== start.normalize("NFC") : !recorded || !rootSet.has(recorded)) continue;
    sessions.push(session);
  }

  const commits = collectEach((root) => commitsOf(root, sinceMs, now, exec, redact));
  const herdr = herdrOf(env, exec, redact);

  // A session waits on the user when it asked something, or holds a paused frame or boundary.
  for (const session of sessions) {
    const frames = (workflows ?? []).filter((frame) => frame.sessionId === session.sessionId);
    const top = frames.at(-1);
    const work = (startWork ?? []).find((item) => item.sessionId === session.sessionId);
    if (frames.some((frame) => frame.status === "paused") && session.status !== "waiting-on-user") {
      session.status = "waiting-on-user";
      session.waitingReason = "paused workflow";
    }
    if (work?.status === "paused") {
      session.status = "waiting-on-user";
      session.waitingReason = "start-work boundary";
    }
    session.progress = top?.progress ?? work?.progress ?? progressOf(null, null);
    session.done.commits = (commits ?? [])
      .filter((commit) => session.lastMs !== null && Date.parse(session.started) <= commit.atMs && commit.atMs <= session.lastMs + 5 * 60_000
        && (session.branch === "unknown" || commit.branch === session.branch))
      .slice(0, 5)
      .map(({ hash, subject }) => ({ hash, subject }));
  }
  // A transcript only says when a session last moved. Its own hook record and its start-work run say
  // more: a run it completed (and did not move past) makes it done; an idle or ended record at least
  // as new as its last transcript line makes it idle or ended. This session is running the brief,
  // whatever its last Stop wrote, and a session that asked the user something still waits.
  const newestLiveness = new Map();
  for (const record of liveness ?? []) {
    if ((newestLiveness.get(record.sessionId)?.atMs ?? -Infinity) < record.atMs) newestLiveness.set(record.sessionId, record);
  }
  const recentRuns = (runs ?? []).filter((run) => now - run.atMs <= sinceMs).sort((a, b) => b.atMs - a.atMs);
  for (const session of sessions) {
    if ((sessionId && session.sessionId === sessionId) || session.status === "waiting-on-user") continue;
    const live = newestLiveness.get(session.sessionId);
    const run = recentRuns.find((item) => item.sessionId === session.sessionId);
    if (run && !(live?.state === "alive" && live.atMs > run.atMs)) {
      session.status = "done";
      session.finishedPlan = run.plan;
    } else if (live && live.state !== "alive" && live.atMs >= (session.lastMs ?? 0) - LIVENESS_SLACK_MS) {
      session.status = live.state === "ended" ? "ended" : "idle";
    }
  }
  sessions.sort((a, b) => statusRank[a.status] - statusRank[b.status] || (b.lastMs ?? 0) - (a.lastMs ?? 0));

  // Open plans changed inside the window are listed, this worktree's first, then the most recently
  // changed, up to a short cap; a stale plan is left out, here or elsewhere. The roadmap gauge
  // counts this worktree only, since a sum over unrelated branches measures nothing.
  const recent = (plan) => plan.changedMs !== null && now - plan.changedMs <= sinceMs;
  const orderedPlans = (plans ?? []).filter((plan) => !plan.complete && recent(plan)).sort((a, b) => Number(b.local) - Number(a.local) || (b.changedMs ?? 0) - (a.changedMs ?? 0));
  const shownPlans = orderedPlans.slice(0, PLAN_LIMIT);
  const localGoals = (litgoal ?? []).filter((goal) => goal.local);
  const roadmapItems = [...orderedPlans.filter((plan) => plan.local).map((plan) => plan.progress), ...localGoals.map((goal) => goal.progress)];
  const data = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    scope: { here, since: sinceMs === parseSince(since) ? since : DEFAULT_SINCE, max: limit, worktrees: roots.map(redact) },
    sources: {
      transcripts: transcripts.status,
      litgoal: known(litgoal),
      plans: known(plans),
      handoffs: handoffs.length ? "ok" : "unknown",
      git: known(commits),
      workflowStack: known(workflows),
      startWork: known(startWork),
      herdr: herdr.status,
    },
    budget: { bytesRead: budget.used, limit: budget.limit, exhausted: budget.exhausted },
    summary: {
      sessions: sessions.length,
      waitingOnUser: sessions.filter((session) => session.status === "waiting-on-user").length,
      active: sessions.filter((session) => session.status === "active").length,
    },
    sessions: sessions.map(({ cwd: _cwd, lastMs: _lastMs, sessionId: id, ...rest }) => ({ ...rest, self: Boolean(sessionId) && id === sessionId })),
    roadmap: {
      plans: shownPlans,
      plansOmitted: orderedPlans.length - shownPlans.length,
      plansSkipped: plansSkipped.count,
      // Another worktree's finished objective is history, not roadmap.
      litgoal: (litgoal ?? []).filter((goal) => goal.local || goal.status !== "complete"),
      progress: roadmapItems.length ? aggregateProgress(roadmapItems) : progressOf(null, null),
    },
    // Finished inside the window: completed start-work runs and plans with every row ticked.
    finished: {
      runs: recentRuns.map(({ worktree, plan, atMs }) => ({ worktree, plan, at: new Date(atMs).toISOString() })),
      plans: (plans ?? []).filter((plan) => plan.complete && recent(plan)).map(({ worktree, plan, local, progress, recordedIn }) => ({ worktree, plan, local, gauge: progress.gauge, ...(recordedIn ? { recordedIn } : {}) })),
    },
    workflows: (workflows ?? []).map((frame) => ({ ...frame, self: Boolean(sessionId) && frame.sessionId === sessionId })),
    startWork: startWork ?? [],
    handoffs,
    commits: (commits ?? []).slice(0, 20).map(({ atMs: _atMs, ...commit }) => commit),
    herdr,
  };
  const next = chooseNextStep(data, sessionId);
  data.next = next;
  data.nextRecorded = false;
  if (record && sessionId) {
    try {
      writeNextStep(stateRoot, sessionId, next, new Date(now));
      data.nextRecorded = true;
    } catch {
      data.nextRecorded = false;
    }
  }
  for (const frame of data.workflows) delete frame.sessionId;
  for (const work of data.startWork) {
    work.self = Boolean(sessionId) && work.sessionId === sessionId;
    delete work.sessionId;
  }
  return data;
};

const line = (text, width) => clipToWidth(text, width);
const remainingLine = (names, width) => {
  if (!names.length || (names.length === 1 && names[0] === "unknown")) return null;
  let out = "  left:";
  for (const [index, name] of names.entries()) {
    const piece = ` ${name}${index < names.length - 1 ? "," : ""}`;
    if (displayWidth(out + piece) > width - 4) return `${out} …(+${names.length - index})`;
    out += piece;
  }
  return out;
};

// A gauge with its leading space, or nothing: an unknown total has no gauge to print.
const shown = (progress) => (progress?.gauge ? ` ${progress.gauge}` : "");

/** Plain-text rendering: every gauge with its remaining names under it, clipped to `width`. */
export const renderRewind = (data, width = 100) => {
  const out = [];
  const push = (text) => out.push(line(text, width));
  push(`lit-adhd: ${data.summary.sessions} session(s), ${data.summary.waitingOnUser} waiting on you, ${data.summary.active} active`);
  push(`roadmap here${shown(data.roadmap.progress)}`);
  for (const plan of data.roadmap.plans) {
    push(`  ${plan.local ? "" : `${basename(plan.worktree)}: `}${plan.plan}${shown(plan.progress)} now: ${plan.current}`);
    const left = remainingLine(plan.progress.remaining, width);
    if (left) push(`  ${left}`);
  }
  if (data.roadmap.plansOmitted) push(`  …(+${data.roadmap.plansOmitted} more open plans)`);
  for (const goal of data.roadmap.litgoal) push(`  litgoal${shown(goal.progress)} ${goal.objective}`);
  for (const session of data.sessions) {
    push(`${session.id8} ${session.status}${shown(session.progress)} ${session.title}`);
    const left = remainingLine(session.progress.remaining, width);
    if (left) push(left);
  }
  for (const frame of data.workflows) push(`  ${frame.id8} ${frame.skill} ${frame.stage} ${frame.status}${shown(frame.progress)}`);
  push(`next: ${data.next.kind}${data.next.say ? ` (say "${data.next.say}")` : ""}`);
  const unknown = Object.entries(data.sources).filter(([, status]) => status !== "ok").map(([name]) => name);
  if (unknown.length) push(`unknown: ${unknown.join(", ")}`);
  return `${out.join("\n")}\n`;
};

/**
 * `litclaude-ai rewind [--brief [--lang ko|en] | --json] [--here] [--since 7d] [--max 12] [--session <id>] [--width N]`.
 * `--brief` prints the Markdown brief the lit-adhd skill copies; `--json` the data under it.
 */
export const runRewindCli = (args, cwd = process.cwd(), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) => {
  const options = { cwd, env, here: false, since: DEFAULT_SINCE, max: DEFAULT_MAX, sessionId: env.CLAUDE_CODE_SESSION_ID || null };
  let json = false;
  let brief = false;
  let lang = "en";
  let width = Number(stdout.columns) || 100;
  const usage = "Usage: litclaude-ai rewind [--brief [--lang ko|en] | --json] [--here] [--since 7d] [--max 12] [--session <id>] [--width N]";
  if (args.some((arg) => arg === "--help" || arg === "-h")) {
    stdout.write(`${usage}\n`);
    return 0;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--brief") brief = true;
    else if (arg === "--lang" && ["ko", "en"].includes(args[index + 1])) lang = args[++index];
    else if (arg === "--here") options.here = true;
    else if (arg === "--since" && parseSince(args[index + 1])) options.since = args[++index];
    else if (arg === "--max" && /^\d{1,2}$/u.test(args[index + 1] ?? "")) options.max = Number(args[++index]);
    else if (arg === "--session" && /^[A-Za-z0-9._:-]{1,160}$/u.test(args[index + 1] ?? "")) options.sessionId = args[++index];
    else if (arg === "--width" && /^\d{2,3}$/u.test(args[index + 1] ?? "")) width = Number(args[++index]);
    else {
      stderr.write(`litclaude-ai rewind: unknown argument ${JSON.stringify(basename(String(arg)))}. ${usage}\n`);
      return 64;
    }
  }
  const data = collectRewind(options);
  stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : brief ? renderBrief(data, { lang }) : renderRewind(data, width));
  return 0;
};
