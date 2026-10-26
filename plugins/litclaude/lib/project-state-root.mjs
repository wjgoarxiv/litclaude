import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

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

// Creates `dir` inside a project's state folder one level at a time and returns false, creating
// nothing more, when `.litclaude` or any folder below it is a symlink or not a folder: a cloned
// repository can carry such a link, and following it would write LitClaude state anywhere the user
// can write. Every state writer calls this before writing and gives up on false.
export const prepareStateDir = (dir) => {
  const target = resolve(dir);
  const parts = target.split(sep);
  const at = parts.indexOf(PROJECT_STATE_DIR);
  if (at <= 0) return false;
  try {
    mkdirSync(parts.slice(0, at).join(sep) || sep, { recursive: true });
    let current = parts.slice(0, at).join(sep) || sep;
    for (const part of parts.slice(at)) {
      current = join(current, part);
      try {
        mkdirSync(current);
      } catch (error) {
        if (error?.code !== "EEXIST") return false;
      }
      const stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  ensureStateDirIgnored(target);
  return true;
};

// Open flags for a state file write that fails on a symlink at the file itself instead of following it.
export const STATE_WRITE_FLAG = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
export const STATE_APPEND_FLAG = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);

/** `prepareStateDir` for writers that must stop: throws on a refused state folder. */
export const requireStateDir = (dir) => {
  if (!resolve(dir).split(sep).includes(PROJECT_STATE_DIR)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (!prepareStateDir(dir)) throw new Error("the LitClaude state folder is a symlink or not a folder; refusing to write");
};
