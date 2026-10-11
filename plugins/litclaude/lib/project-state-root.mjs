import { closeSync, constants, existsSync, lstatSync, openSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { findProjectRoot } from "./rules/discovery.mjs";

const outermostGitRoot = (startDir) => {
  let root = null;
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, ".git"))) root = current;
    const parent = dirname(current);
    if (parent === current) return root;
    current = parent;
  }
};

// State placement is intentionally separate from nearest-marker rule discovery: a nested
// package.json is a valid rules boundary, but .litclaude belongs at the outer Git root.
export const resolveProjectStateRoot = (startDir = process.cwd()) => {
  const start = resolve(startDir);
  return outermostGitRoot(start) ?? findProjectRoot(start) ?? start;
};

export const PROJECT_STATE_DIR = ".litclaude";
const STATE_GITIGNORE = "# Created by LitClaude: local session state, not for commits.\n*\n";

// Git skips the state folder through a `.gitignore` inside it (the pattern pytest and ruff
// caches use), so the user's own .gitignore and .git/info/exclude stay untouched. Call it with
// any path inside the project's state folder after creating that path. It never replaces an
// existing file, never writes through a symlinked folder, and a failure leaves state writes alone.
export const ensureStateDirIgnored = (pathInsideState) => {
  let stateDir = resolve(pathInsideState);
  while (basename(stateDir) !== PROJECT_STATE_DIR) {
    const parent = dirname(stateDir);
    if (parent === stateDir) return false;
    stateDir = parent;
  }
  let fd;
  try {
    const stats = lstatSync(stateDir);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
    fd = openSync(
      join(stateDir, ".gitignore"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    writeSync(fd, STATE_GITIGNORE);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};
