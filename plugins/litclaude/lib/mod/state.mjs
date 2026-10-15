// Read-only view of LitClaude's own state (and the Git HEAD it works on) for the LIT band. Nothing here writes, spawns, fetches or
// follows a link: every read goes through an injected `io` ({ stat, read }) that the mod backs with
// `$.fs.stat(path, { resolve: true })` and `$.fs.read`, and the tests back with a map. A file is read
// only when it is a regular file, under its size cap, not itself a link, and lands exactly where its
// spelled path says once every link is resolved, so a symlinked `.litclaude` or state file is skipped.
//
// The workflow map's sources are read the same way: the newest deep-interview state, the newest
// lit-plan draft, the newest litresearch session folder and the stage record. A folder is listed
// through `io.list` when the host offers it; without it the map falls back to the other sources.
//
// The two roots mirror the hook: `.litclaude` sits at the outermost Git root (project-state-root.mjs),
// while boulder.json is found the way `lifecycleRootFor` in bin/litclaude-hook.js finds it, walking up
// from the working directory and across a linked Git worktree to its main checkout.

import { parseStageRecord } from "./workflow.mjs";

export const STATE_CAPS = Object.freeze({
  boulder: 2 * 1024 * 1024,
  goals: 512 * 1024,
  ledger: 512 * 1024,
  small: 64 * 1024,
  gitMarker: 4096,
});

// Mirrors PROJECT_MARKERS in rules/constants.mjs, the fallback when no Git root exists.
const PROJECT_MARKERS = Object.freeze([".git", "pnpm-workspace.yaml", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", ".venv"]);
export const AUTOLOOP_LIMITS = Object.freeze({ blocks: 8, ms: 30 * 60 * 1000 });
export const GATE_LIMITS = Object.freeze({ litPlan: 2, probe: 2, motion: 2 });

const splitPath = (path) => String(path).replaceAll("\\", "/").split("/").filter((part, index) => part !== "" || index === 0);

export const normalizePath = (path) => {
  const parts = [];
  const raw = String(path).replaceAll("\\", "/");
  const absolute = raw.startsWith("/");
  const drive = /^[A-Za-z]:/u.exec(raw)?.[0] ?? "";
  for (const part of raw.slice(drive.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${drive}${absolute || drive ? "/" : ""}${parts.join("/")}`;
};

export const joinPath = (...parts) => normalizePath(parts.filter((part) => part !== "").join("/"));

export const parentOf = (path) => {
  const normalized = normalizePath(path);
  const cut = normalized.lastIndexOf("/");
  if (cut <= 0) return normalized.slice(0, cut + 1) || normalized;
  const parent = normalized.slice(0, cut);
  return /^[A-Za-z]:$/u.test(parent) ? `${parent}/` : parent;
};

const isAbsolute = (path) => /^(?:[A-Za-z]:)?[\\/]/u.test(String(path));
export const resolvePath = (base, path) => (isAbsolute(path) ? normalizePath(path) : joinPath(base, path));

const ancestors = (start) => {
  const list = [];
  let current = normalizePath(start);
  for (;;) {
    list.push(current);
    const parent = parentOf(current);
    if (parent === current) return list;
    current = parent;
  }
};

const statOf = async (io, path) => {
  try {
    return (await io.stat(path)) ?? null;
  } catch {
    return null;
  }
};

export const resolveStateRoot = async (io, cwd) => {
  const chain = ancestors(cwd);
  let outermostGit = null;
  for (const directory of chain) if (await statOf(io, joinPath(directory, ".git"))) outermostGit = directory;
  if (outermostGit) return outermostGit;
  for (const directory of chain) {
    for (const marker of PROJECT_MARKERS) if (await statOf(io, joinPath(directory, marker))) return directory;
  }
  return normalizePath(cwd);
};

export const resolveLifecycleRoot = async (io, cwd, stateRoot) => {
  for (const directory of ancestors(cwd)) {
    if (await statOf(io, joinPath(directory, ".litclaude", "boulder.json"))) return directory;
    const marker = joinPath(directory, ".git");
    const stat = await statOf(io, marker);
    if (stat?.kind === "file" && !stat.isLink && stat.size <= STATE_CAPS.gitMarker) {
      let text = "";
      try {
        text = await io.read(marker);
      } catch {
        text = "";
      }
      const match = /^gitdir:\s*(.+?)\s*$/mu.exec(text);
      if (match) {
        const worktreesDir = parentOf(resolvePath(directory, match[1]));
        if (splitPath(worktreesDir).at(-1) === "worktrees") {
          const mainRoot = parentOf(parentOf(worktreesDir));
          if (await statOf(io, joinPath(mainRoot, ".litclaude", "boulder.json"))) return mainRoot;
        }
      }
    }
  }
  return stateRoot;
};

// One guarded read. `root` is the directory the file must stay under; the comparison is made on
// resolved paths so a link anywhere between the root and the file shows up as a mismatch.
export const readGuarded = async (io, root, relative, cap) => {
  const path = joinPath(root, relative);
  const stat = await statOf(io, path);
  if (!stat || stat.isLink || stat.kind !== "file" || !(stat.size <= cap)) return null;
  if (stat.realPath !== undefined) {
    const rootStat = await statOf(io, root);
    const realRoot = rootStat?.realPath;
    if (realRoot === undefined || normalizePath(stat.realPath) !== joinPath(realRoot, relative)) return null;
  }
  try {
    const text = await io.read(path);
    return typeof text === "string" && text.length <= cap ? text : null;
  } catch {
    return null;
  }
};

export const readGuardedJson = async (io, root, relative, cap) => {
  const text = await readGuarded(io, root, relative, cap);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

const str = (value, max = 400) => (typeof value === "string" && value.length > 0 ? value.slice(0, max) : null);
const int = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const num = (value) => (Number.isFinite(value) ? value : null);
const time = (value) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// Per-session file names, spelled as hud-ignition.mjs (ignition) and auto-handoff.mjs (session) do.
export const ignitionFileName = (sessionId) => {
  const raw = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "unknown-session";
  return `${raw.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "_")}.json`;
};
const handoffSessionId = (sessionId) => (typeof sessionId === "string" ? sessionId.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 64) : "");

export const ignitionRoot = (env) => {
  const override = env?.LITCLAUDE_HUD_STATE_ROOT?.trim();
  if (override) return normalizePath(override);
  return joinPath(env?.TMPDIR?.trim() || "/tmp", "litclaude-hud");
};

export const parseIgnition = (record, sessionId) => {
  if (!record || (record.sessionId !== null && record.sessionId !== sessionId)) return null;
  const discipline = str(record.discipline, 80);
  return discipline ? { discipline, at: time(record.at) } : null;
};

const workBelongs = (work, sessionId) =>
  work.root_session_id === sessionId
  || work.active_session_id === sessionId
  || (Array.isArray(work.session_ids) && work.session_ids.includes(sessionId));

const laneList = (lanes) => Object.values(lanes && typeof lanes === "object" ? lanes : {})
  .filter((lane) => lane && typeof lane === "object")
  .map((lane) => ({
    id: str(lane.agent_id, 120) ?? "lane",
    type: str(lane.agent_type, 80) ?? "agent",
    status: str(lane.status, 40) ?? "unknown",
    startedAt: time(lane.started_at),
  }))
  .slice(0, 32);

export const parseBoulder = (state, sessionId) => {
  if (!state || !state.works || typeof state.works !== "object") return { work: null, completed: [] };
  const completed = Object.values(state.works)
    .filter((work) => work && work.status === "completed" && workBelongs(work, sessionId))
    .map((work) => str(work.work_id, 120))
    .filter(Boolean);
  const active = state.active_work_id ? state.works[state.active_work_id] : null;
  if (!active || !["active", "paused"].includes(active.status) || !workBelongs(active, sessionId)) return { work: null, completed };
  const progress = active.progress && typeof active.progress === "object" ? active.progress : {};
  const total = int(progress.total);
  return {
    work: {
      id: str(active.work_id, 120) ?? String(state.active_work_id),
      status: active.status,
      planName: str(active.plan_name, 200),
      total,
      checked: Math.min(int(progress.checked), total),
      nextTask: str(progress.next_task, 400),
      lanes: laneList(active.lanes),
      lastEvent: str(Array.isArray(active.events) ? active.events.at(-1)?.event : null, 60),
    },
    completed,
  };
};

const CRITERION_STATUSES = new Set(["pass", "fail", "blocked", "pending"]);

export const parseGoals = (state, sessionId) => {
  if (!state || typeof state.status !== "string") return null;
  if (typeof state.sessionId === "string" && state.sessionId !== sessionId) return null;
  const criteria = (Array.isArray(state.criteria) ? state.criteria : []).slice(0, 40).map((criterion, index) => {
    const evidence = Array.isArray(criterion?.evidence) ? criterion.evidence : [];
    const status = CRITERION_STATUSES.has(criterion?.status) ? criterion.status : "pending";
    return {
      id: str(criterion?.id, 80) ?? `criterion-${index + 1}`,
      description: str(criterion?.description, 300) ?? "",
      status,
      attempts: evidence.length,
      lastAt: time(evidence.at(-1)?.recordedAt),
    };
  });
  return {
    objective: str(state.objective, 400) ?? "",
    status: state.status,
    autoloop: state.autoloop === true,
    criteria,
    blockers: (Array.isArray(state.blockers) ? state.blockers : []).slice(0, 10)
      .map((blocker) => str(typeof blocker === "string" ? blocker : blocker?.note ?? blocker?.description, 300))
      .filter(Boolean),
    lastCheckpoint: str(Array.isArray(state.checkpoints) ? state.checkpoints.at(-1)?.status : null, 40),
    createdAt: time(state.createdAt),
    // When the goal was finished: its last `complete` checkpoint, else its last update.
    completedAt: state.status === "complete"
      ? time((Array.isArray(state.checkpoints) ? state.checkpoints : []).findLast((entry) => entry?.status === "complete")?.createdAt) ?? time(state.updatedAt)
      : null,
  };
};

export const parseAutoloop = (state) => {
  if (!state || !Number.isInteger(state.blockCount) || state.blockCount < 0 || !Number.isFinite(state.firstBlockAt)) return null;
  return { blockCount: state.blockCount, firstBlockAt: state.firstBlockAt };
};

const forSession = (state, sessionId) => (state && state.sessionId === sessionId ? state : null);

export const parseLitPlanTurn = (state, sessionId) => {
  const turn = forSession(state, sessionId);
  return turn ? { blockCount: int(turn.blockCount), warned: turn.warned === true, promptAt: num(turn.promptAt) } : null;
};

export const parseProbeTurn = (state, sessionId) => {
  const turn = forSession(state, sessionId);
  if (!turn) return null;
  return {
    editAt: num(turn.editAt),
    probeAt: num(turn.probeAt),
    issue: str(turn.issue, 160),
    issueAt: num(turn.issueAt),
    paths: (Array.isArray(turn.paths) ? turn.paths : []).map((path) => str(path, 200)).filter(Boolean).slice(0, 5),
    blockCount: int(turn.blockCount),
  };
};

export const parseMotionTurn = (state, sessionId) => {
  const turn = forSession(state, sessionId);
  return turn ? { blockCount: int(turn.blockCount), runs: Array.isArray(turn.runs) ? turn.runs.length : 0, notified: turn.notified === true } : null;
};

const percentOf = (raw) => {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^(?:[1-9]\d?)$/u.test(text.trim())) return null;
  return Number(text.trim());
};

// The environment wins over the saved choice, as resolveAutoHandoff in auto-handoff.mjs decides.
export const parseAutoHandoff = (settings, session, env) => {
  const flag = env?.LITCLAUDE_AUTO_HANDOFF;
  const enabled = flag !== undefined ? flag === "1" : settings?.enabled === true;
  const percent = percentOf(env?.LITCLAUDE_AUTO_HANDOFF_PERCENT !== undefined ? env.LITCLAUDE_AUTO_HANDOFF_PERCENT : settings?.percent ?? null);
  if (!enabled || percent === null) return null;
  return {
    percent,
    firedAt: num(session?.firedAt),
    firedAtPercent: num(session?.firedAtPercent),
    pending: session?.pending === true,
  };
};

const listOf = async (io, path) => {
  if (typeof io.list !== "function") return [];
  try {
    const entries = await io.list(path);
    return Array.isArray(entries) ? entries.slice(0, 400) : [];
  } catch {
    return [];
  }
};

const newestFile = (entries, pattern) => entries
  .filter((entry) => entry?.kind === "file" && !entry.isLink && pattern.test(entry.name))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;

export const parseInterviewState = (state, at) => {
  const inner = state?.state && typeof state.state === "object" ? state.state : null;
  if (!inner) return null;
  return {
    active: state.active === true,
    round: Array.isArray(inner.rounds) ? inner.rounds.length : null,
    max: Number.isInteger(inner.max_rounds) && inner.max_rounds > 0 ? inner.max_rounds : null,
    ambiguity: num(inner.current_ambiguity),
    threshold: num(inner.threshold),
    at,
  };
};

// The draft's resume gate: the last `status:` line wins, as the approval gate sits below the header.
export const parseDraftStatus = (text, slug, at) => {
  const statuses = [...String(text).matchAll(/^status:\s*([a-z-]+)\s*$/gmu)].map((match) => match[1]);
  return statuses.length ? { slug, status: statuses.at(-1), at } : null;
};

export const summarizeResearchFiles = (entries, slug) => {
  const files = entries.filter((entry) => entry?.kind === "file" && !entry.isLink);
  const waves = files.map(({ name }) => /^wave-(\d{1,3})-.*\.md$/u.exec(name)).filter(Boolean).map((match) => Number(match[1]));
  return {
    slug,
    wave: waves.length ? Math.max(...waves) : 0,
    digests: waves.length,
    verified: files.filter(({ name }) => /^verify-.*\.md$/u.test(name)).length,
    synthesis: files.some(({ name }) => name === "SYNTHESIS.md"),
    at: files.reduce((latest, { mtimeMs }) => Math.max(latest, Number.isFinite(mtimeMs) ? mtimeMs : 0), 0) || null,
  };
};

const readWorkflowSources = async (io, stateRoot, sessionId) => {
  const dir = (name) => joinPath(stateRoot, ".litclaude", name);
  const [interviews, drafts, researches, record] = await Promise.all([
    listOf(io, dir("deep-interview")),
    listOf(io, dir("drafts")),
    listOf(io, dir("litresearch")),
    readGuardedJson(io, stateRoot, ".litclaude/workflow-stage.json", STATE_CAPS.small),
  ]);
  const interviewFile = newestFile(interviews, /^[A-Za-z0-9._-]+-state\.json$/u);
  const draftFile = newestFile(drafts, /^[A-Za-z0-9._-]+\.md$/u);
  let research = null;
  const sessions = researches.filter((entry) => entry?.kind === "dir" && !entry.isLink && /^[A-Za-z0-9._-]+$/u.test(entry.name)).slice(0, 30);
  if (sessions.length) {
    const stamped = await Promise.all(sessions.map(async ({ name }) => ({ name, at: (await statOf(io, joinPath(dir("litresearch"), name)))?.mtimeMs ?? 0 })));
    const newest = stamped.sort((a, b) => b.at - a.at)[0];
    research = summarizeResearchFiles(await listOf(io, joinPath(dir("litresearch"), newest.name)), newest.name);
  }
  const [interview, draft] = await Promise.all([
    interviewFile ? readGuardedJson(io, stateRoot, `.litclaude/deep-interview/${interviewFile.name}`, STATE_CAPS.small) : null,
    draftFile ? readGuarded(io, stateRoot, `.litclaude/drafts/${draftFile.name}`, STATE_CAPS.goals) : null,
  ]);
  return {
    record: parseStageRecord(record, sessionId),
    interview: interview ? parseInterviewState(interview, interviewFile.mtimeMs) : null,
    draft: draft === null ? null : parseDraftStatus(draft, draftFile.name.replace(/\.md$/u, ""), draftFile.mtimeMs),
    research,
  };
};

export const readLitSnapshot = async (io, { cwd, sessionId, env = {} }) => {
  const stateRoot = await resolveStateRoot(io, cwd);
  const lifecycleRoot = await resolveLifecycleRoot(io, cwd, stateRoot);
  const state = (relative, cap = STATE_CAPS.small) => readGuardedJson(io, stateRoot, joinPath(".litclaude", relative), cap);
  const handoffId = handoffSessionId(sessionId);
  const [ignition, boulder, goals, autoloop, litPlan, probe, motion, handoffSettings, handoffSession] = await Promise.all([
    readGuardedJson(io, ignitionRoot(env), ignitionFileName(sessionId), STATE_CAPS.small),
    readGuardedJson(io, lifecycleRoot, joinPath(".litclaude", "boulder.json"), STATE_CAPS.boulder),
    state("litgoal/goals.json", STATE_CAPS.goals),
    state("litgoal/autoloop.json"),
    state("lit-plan/turn.json"),
    state("interface-probe/turn.json"),
    state("motion/turn.json"),
    state("auto-handoff/settings.json"),
    handoffId ? state(`auto-handoff/session-${handoffId}.json`) : null,
  ]);
  const { work, completed } = parseBoulder(boulder, sessionId);
  const workflow = await readWorkflowSources(io, stateRoot, sessionId);
  return {
    stateRoot,
    lifecycleRoot,
    ignition: parseIgnition(ignition, sessionId),
    work,
    completedWorkIds: completed,
    goal: parseGoals(goals, sessionId),
    autoloop: parseAutoloop(autoloop),
    litPlan: parseLitPlanTurn(litPlan, sessionId),
    probe: parseProbeTurn(probe, sessionId),
    motion: parseMotionTurn(motion, sessionId),
    handoff: parseAutoHandoff(handoffSettings, handoffSession, env),
    workflow,
  };
};

const readSmall = async (io, path, cap) => {
  const stat = await statOf(io, path);
  if (!stat || stat.kind !== "file" || !(stat.size <= cap)) return null;
  try {
    const text = await io.read(path);
    return typeof text === "string" && text.length <= cap ? text : null;
  } catch {
    return null;
  }
};

/**
 * The branch the working directory is on, for the card's bottom edge: the nearest `.git` above
 * `cwd`, followed through a linked worktree's `gitdir:` file, and its HEAD read as text. A
 * detached HEAD gives the short commit; anything unreadable gives null.
 */
export const readGitBranch = async (io, cwd) => {
  for (const directory of ancestors(cwd)) {
    const marker = joinPath(directory, ".git");
    const stat = await statOf(io, marker);
    if (!stat) continue;
    let gitDir = marker;
    if (stat.kind === "file") {
      const pointer = await readSmall(io, marker, STATE_CAPS.gitMarker);
      const match = pointer === null ? null : /^gitdir:\s*(.+?)\s*$/mu.exec(pointer);
      if (!match) return null;
      gitDir = resolvePath(directory, match[1]);
    }
    const head = (await readSmall(io, joinPath(gitDir, "HEAD"), STATE_CAPS.gitMarker))?.trim();
    if (!head) return null;
    const ref = /^ref:\s*refs\/heads\/(.+)$/u.exec(head);
    if (ref) return ref[1].slice(0, 120);
    return /^[0-9a-f]{7,64}$/u.test(head) ? head.slice(0, 7) : null;
  }
  return null;
};

// The icon font the installer's opt-in step writes (bin/icon-font.mjs), or the proportional
// symbols font a person installed some other way, in each per-user font folder.
const ICON_FONT_NAMES = Object.freeze(["SymbolsNerdFontMono-Regular.ttf", "SymbolsNerdFont-Regular.ttf"]);

export const iconFontCandidates = (env) => {
  const home = env?.HOME?.trim();
  const folders = [];
  if (home) folders.push(joinPath(home, "Library", "Fonts"));
  const data = env?.XDG_DATA_HOME?.trim() || (home ? joinPath(home, ".local", "share") : "");
  if (data) folders.push(joinPath(data, "fonts"));
  const local = env?.LOCALAPPDATA?.trim();
  if (local) folders.push(joinPath(local, "Microsoft", "Windows", "Fonts"));
  return folders.flatMap((folder) => ICON_FONT_NAMES.map((name) => joinPath(folder, name)));
};

/**
 * Whether the icon font is installed, by stat alone (the font is never read). `note` says what
 * the band decided and why, for the evidence pane; a folder that cannot be checked counts as no
 * font, so the band falls back to basic glyphs rather than drawing boxes.
 */
export const detectIconFont = async (io, env) => {
  const candidates = iconFontCandidates(env);
  if (candidates.length === 0) return { present: false, path: null, note: "basic: no home folder to look in for the icon font" };
  let unreadable = false;
  for (const path of candidates) {
    try {
      const stat = await io.stat(path);
      if (stat?.kind === "file") return { present: true, path, note: `nerd: Symbols Nerd Font found at ${path}` };
    } catch (error) {
      if (!/ENOENT|no such file|not found/iu.test(String(error?.message ?? error))) unreadable = true;
    }
  }
  return unreadable
    ? { present: false, path: null, note: "basic: the font folders could not be checked from the band" }
    : { present: false, path: null, note: "basic: Symbols Nerd Font not found (litclaude-ai install --icon-font)" };
};

// The litgoal ledger's newest entries for the evidence pane, newest first. Lines that are not JSON
// objects are skipped; the file is read only under its cap.
export const readLedgerTail = async (io, stateRoot, limit = 8) => {
  const text = await readGuarded(io, stateRoot, ".litclaude/litgoal/ledger.jsonl", STATE_CAPS.ledger);
  if (text === null) return [];
  const entries = [];
  for (const line of text.split("\n").reverse()) {
    if (entries.length >= limit) break;
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      entries.push({
        event: str(entry.event, 60) ?? "event",
        at: time(entry.timestamp),
        detail: str(entry.criterionId ?? entry.note ?? entry.objective ?? entry.status, 120) ?? "",
        status: str(entry.status, 40),
      });
    } catch {
      // A torn final line from a concurrent append; the next refresh reads it whole.
    }
  }
  return entries;
};
