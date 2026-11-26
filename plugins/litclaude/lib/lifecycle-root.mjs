import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveProjectStateRoot } from "./project-state-root.mjs";

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

// The walk ends at the project's own git root: a lifecycle in a folder that merely contains the
// repository (a workspace of several checkouts) never governs it. Without git it goes to the top.
export const lifecycleRootFor = (cwd, sessionId = null) => {
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
