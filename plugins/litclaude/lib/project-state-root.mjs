import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
