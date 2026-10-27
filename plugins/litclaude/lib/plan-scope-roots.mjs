// Outside folders a plan's todos name must be granted before the work starts, so a lane never stops
// to ask the user for them. start-work reads `Scope roots:` lines with SCOPE_LINE; lit-plan's checks
// use uncoveredScopePaths to name each todo path no such line covers, with the line to paste.
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { planLinesOutsideFences } from "./plan-task-rows.mjs";

// `Scope roots: <path> (<action>, <action>)` lines in the plan widen the grants it starts with.
// Global, for `matchAll` only: `.test()` or `.exec()` on this shared object would carry `lastIndex`.
export const SCOPE_LINE = /^Scope roots?:[ \t]*(\S+)[ \t]*\(([a-z, -]+)\)[ \t]*$/gmu;

// An absolute path of two or more segments. A command quoted in an inline code span (it holds a
// space) is data, not a folder the work reaches, so only spans that are one path count.
const PATH_TOKEN = /(?<![\w.~\/-])\/[\w.@+%,=~-]+(?:\/[\w.@+%,=~-]+)+\/?/gu;
const pathMentions = (line) => line.replace(/`([^`]*)`/gu, (_, span) => (/\s/u.test(span.trim()) ? " " : ` ${span.trim()} `)).match(PATH_TOKEN) ?? [];

const covers = (root, path) => {
  const inside = relative(root, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
const nearestDirectory = (path) => {
  for (let at = path; ; at = dirname(at)) {
    try {
      if (statSync(at).isDirectory()) return at;
    } catch {
      // Not there yet; climb.
    }
    if (dirname(at) === at) return at;
  }
};

/**
 * Each absolute path under `## Todos` (before `## Final verification wave`, outside fences) that
 * lies outside the project and outside every `Scope roots:` line, as `{ path, suggestion }` with
 * the line to paste, or `{ path, problem }` when the nearest existing folder is too broad to grant.
 * One entry per folder.
 */
export const uncoveredScopePaths = (planText, projectRoot) => {
  const project = real(resolve(projectRoot));
  const scoped = [...planText.matchAll(SCOPE_LINE)].map(([, path]) => real(isAbsolute(path) ? path : resolve(project, path)));
  let inTodos = false;
  const found = new Map();
  for (const { line } of planLinesOutsideFences(planText)) {
    const heading = line.trimEnd();
    if (heading === "## Todos") inTodos = true;
    else if (heading === "## Final verification wave") inTodos = false;
    if (!inTodos) continue;
    for (const mention of pathMentions(line)) {
      const path = mention.replace(/[.,:;)]+$/u, "");
      const directory = real(nearestDirectory(path));
      if ([path, directory].some((candidate) => covers(project, real(candidate)) || scoped.some((root) => covers(root, real(candidate))))) continue;
      if (found.has(directory)) continue;
      // The filesystem root, a top-level folder or the home folder itself is never suggested.
      const parent = dirname(directory);
      const tooBroad = parent === dirname(parent) || directory === real(homedir());
      found.set(directory, tooBroad
        ? { path, problem: `${path} is outside the project; name a narrower existing folder on a Scope roots line` }
        : { path, suggestion: `Scope roots: ${directory} (read)` });
    }
  }
  return [...found.values()];
};

export const describeScopePath = (entry) => entry.suggestion
  ? `${entry.path} is outside the project and no Scope roots line covers it; add: ${entry.suggestion}`
  : entry.problem;

