import { lstatSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { findProjectRoot } from "./rules/discovery.mjs";
import { readDirectoryStable, readRegularStable } from "./secure-path-read.mjs";
import {
  checkPlanStructure,
  isValidPlanSlug,
  MAX_PLAN_BYTES,
} from "../scripts/scaffold-plan.mjs";

const PLAN_DIRECTORY = "plans";
export { MAX_PLAN_BYTES };

const toPosix = (value) => value.replaceAll("\\", "/");

const validPlanCandidate = (projectRoot, directory, entry, ancestors) => {
  const name = entry.name;
  if (!entry.isFile() || !name.endsWith(".md") || !isValidPlanSlug(name.slice(0, -3))) return undefined;

  const absolutePath = join(directory, name);
  const stored = readRegularStable(
    projectRoot,
    absolutePath,
    { ancestors },
    { maxBytes: MAX_PLAN_BYTES },
  );
  if (stored.failure) return undefined;

  const text = stored.bytes.toString("utf8");
  try {
    if (!checkPlanStructure(text).ok) return undefined;
  } catch {
    return undefined;
  }
  return {
    name,
    absolutePath,
    text,
    mtimeMs: stored.stat.mtimeMs,
  };
};

const plansFromDirectory = (projectRoot, directory) => {
  let directoryStat;
  try {
    directoryStat = lstatSync(directory, { throwIfNoEntry: false });
  } catch {
    return { failure: "UNREADABLE" };
  }
  if (!directoryStat) return { failure: "UNREADABLE" };
  const read = readDirectoryStable(projectRoot, directory);
  if (read.failure) return read;

  const candidates = [];
  for (const entry of read.entries) {
    const candidate = validPlanCandidate(projectRoot, directory, entry, read.ancestors);
    if (candidate) candidates.push(candidate);
  }
  return { candidates };
};

export const resolveLatestDurablePlan = (root) => {
  if (typeof root !== "string" || root.length === 0) return undefined;

  let start;
  try {
    start = resolve(root);
  } catch {
    return undefined;
  }

  const projectRoot = findProjectRoot(start) ?? start;
  const startingDirectory = readDirectoryStable(projectRoot, start);
  if (startingDirectory.failure) return undefined;

  let current = start;
  while (true) {
    const result = plansFromDirectory(projectRoot, join(current, PLAN_DIRECTORY));
    if (result.failure && result.failure !== "UNREADABLE") return undefined;
    if (!result.failure) {
      result.candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
      const selected = result.candidates[0];
      if (selected) {
        return {
          relativePath: toPosix(relative(start, selected.absolutePath)),
          text: selected.text,
        };
      }
    }

    const parent = dirname(current);
    if (parent === current || current === projectRoot) return undefined;
    current = parent;
  }
};

export const formatResolvedPlanNotice = (plan) =>
  `Durable plan: ${plan.relativePath}. Discovery only. This does not grant start-work authority.`;
