import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveProjectStateRoot } from "./project-state-root.mjs";
import { isStale } from "./start-work-peek.mjs";

// The main checkout's run governs a linked worktree only when the run is active or paused and its
// own worktree covers the session's cwd, or the session is one of the run's sessions; a sibling
// worktree, or a main checkout with no running work, leaves the worktree its own lifecycle. A
// session that holds a `lit cancel` notice there stays governed until its next prompt lifts it.
const governsLinkedCwd = (mainRoot, cwd, sessionId) => {
  try {
    const path = join(mainRoot, ".litclaude", "boulder.json");
    if (statSync(path).size > 4 * 1024 * 1024) return true;
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (typeof sessionId === "string" && state?.cancel_notices?.[sessionId]) return true;
    const work = state?.active_work_id ? state.works?.[state.active_work_id] : null;
    if (!work || !["active", "paused"].includes(work.status)) return false;
    if (typeof sessionId === "string" && (work.session_ids ?? []).includes(sessionId)) return true;
    const scope = work.effective_worktree_root ?? work.worktree_path ?? mainRoot;
    const inside = relative(scope.normalize("NFC"), realpathSync(resolve(cwd)).normalize("NFC"));
    return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
  } catch {
    // An unreadable record keeps today's fail-closed lookup.
    return true;
  }
};

const MAX_RECORD_BYTES = 4 * 1024 * 1024;

// The lifecycle record at `root`: null when there is none, "unreadable" for one that cannot be trusted.
const readRecord = (root) => {
  const path = join(root, ".litclaude", "boulder.json");
  try {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) return null;
    if (stats.size > MAX_RECORD_BYTES) return "unreadable";
    const state = JSON.parse(readFileSync(path, "utf8"));
    return state?.schema_version === 3 && state.works && typeof state.works === "object" ? state : "unreadable";
  } catch {
    return "unreadable";
  }
};

const runningWork = (state) => {
  const work = state?.active_work_id ? state.works?.[state.active_work_id] : null;
  return work && ["active", "paused"].includes(work.status) ? work : null;
};

// A session is governed by a record when it owns the running work or holds a `lit cancel` notice there.
const governs = (state, sessionId) => Boolean(state.cancel_notices?.[sessionId]) || runningWork(state)?.root_session_id === sessionId;

export const sessionOwnsRun = (root, sessionId) => {
  if (typeof sessionId !== "string") return false;
  const state = readRecord(root);
  return Boolean(state) && state !== "unreadable" && runningWork(state)?.root_session_id === sessionId;
};

const within = (root, path) => {
  const inside = relative(root.normalize("NFC"), path.normalize("NFC"));
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};

// The walk ends at the project's own git root: a lifecycle in a folder that merely contains the
// repository (a workspace of several checkouts) never governs it. Without git it goes to the top.
const walkFor = (cwd, sessionId) => {
  const stateRoot = resolveProjectStateRoot(cwd);
  const gitRoot = existsSync(join(stateRoot, ".git")) ? stateRoot : null;
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".litclaude", "boulder.json"))) return current;
    const gitMarker = join(current, ".git");
    try {
      if (lstatSync(gitMarker).isFile()) {
        const marker = readFileSync(gitMarker, "utf8");
        if (marker.length <= 4096) {
          const match = /^gitdir:\s*(.+?)\s*$/mu.exec(marker);
          if (match) {
            const gitDir = resolve(current, match[1]);
            const worktreesDir = dirname(gitDir);
            if (worktreesDir.split(/[\\/]/u).at(-1) === "worktrees") {
              const mainRoot = dirname(dirname(worktreesDir));
              if (existsSync(join(mainRoot, ".litclaude", "boulder.json")) && governsLinkedCwd(mainRoot, cwd, sessionId)) return mainRoot;
            }
          }
        }
      }
    } catch {
      // Not a linked git worktree marker; continue walking parents.
    }
    if (current === gitRoot) return stateRoot;
    const parent = dirname(current);
    if (parent === current) return stateRoot;
    current = parent;
  }
};

// The folder's own lifecycle, unless it does not govern this session and a run further out does: the
// run's owner (or a session holding that run's cancel notice) stays governed after a `cd` into a nested
// checkout, or into a folder the run was granted outside the project. Any other session, a run that
// is not running, and a live run of another session in the folder keep the folder's own answer.
export const lifecycleRootFor = (cwd, sessionId = null) => {
  const local = walkFor(cwd, sessionId);
  if (typeof sessionId !== "string") return local;
  const record = readRecord(local);
  if (record === "unreadable") return local;
  if (record) {
    if (governs(record, sessionId)) return local;
    const work = runningWork(record);
    if (work && !isStale(work, Date.now())) return local;
  }
  const here = resolve(cwd);
  for (let current = here; ; current = dirname(current)) {
    if (current !== local) {
      const outer = readRecord(current);
      if (outer && outer !== "unreadable" && governs(outer, sessionId)) return current;
    }
    if (dirname(current) === current) break;
  }
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (typeof projectDir !== "string" || projectDir.length === 0 || !statSync(projectDir).isDirectory()) return local;
    const project = walkFor(projectDir, sessionId);
    if (project === local || within(project, here)) return local;
    const state = readRecord(project);
    if (!state || state === "unreadable" || !governs(state, sessionId)) return local;
    const noticed = state.cancel_notices?.[sessionId];
    const works = [runningWork(state), noticed ? state.works?.[noticed.work_id] : null].filter(Boolean);
    const real = realpathSync(here);
    const granted = works.some((work) => (work.authority?.grants ?? []).some(({ root }) => typeof root === "string" && within(root, real)));
    return granted ? project : local;
  } catch {
    return local;
  }
};
