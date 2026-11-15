// What the pre-compaction handoff records about the work in progress: the plan's row state and the
// working tree. Read only, bounded, and never throws: a part that cannot be read is left out.
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { MAX_PLAN_BYTES, resolveLatestDurablePlan } from "./durable-plan.mjs";
import { parsePlanTaskRows } from "./plan-task-rows.mjs";

const GIT_LINE_LIMIT = 25;

export const clipText = (text, limit) => {
  const plain = String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
};

// The running start-work plan is a real path the lifecycle already vetted; it is still read as a
// plain regular file under the plan size cap, and a symlink is never followed.
const readPlanFile = (path) => {
  let fd;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PLAN_BYTES) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd, "utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

// Also the plan part of the check-back report (check-back.mjs).
export const planSnapshot = ({ cwd, activePlanPath }) => {
  let source = null;
  if (typeof activePlanPath === "string" && activePlanPath) {
    const text = readPlanFile(activePlanPath);
    if (text !== null) {
      const rel = relative(resolve(cwd), activePlanPath);
      source = { path: rel.startsWith("..") || isAbsolute(rel) ? activePlanPath : rel, text, origin: "the running start-work" };
    }
  }
  if (!source) {
    const latest = resolveLatestDurablePlan(cwd);
    if (latest) source = { path: latest.relativePath, text: latest.text, origin: "the newest plan" };
  }
  if (!source) return null;
  const rows = parsePlanTaskRows(source.text);
  const open = rows.filter((row) => !row.checked);
  return {
    path: clipText(source.path, 200),
    origin: source.origin,
    total: rows.length,
    done: rows.length - open.length,
    current: open[0] ? clipText(open[0].text, 160) : null,
    next: open[1] ? clipText(open[1].text, 160) : null,
    blocked: open.filter((row) => row.blocked).slice(0, 3).map((row) => clipText(row.text, 120)),
  };
};

const gitSnapshot = (cwd) => {
  const result = spawnSync("git", ["status", "--short", "--branch"], {
    cwd,
    encoding: "utf8",
    timeout: 3000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  const lines = result.stdout.split("\n").filter(Boolean).map((line) => clipText(line, 200));
  return lines.length > GIT_LINE_LIMIT
    ? [...lines.slice(0, GIT_LINE_LIMIT), `… and ${lines.length - GIT_LINE_LIMIT} more lines`]
    : lines;
};

export const collectCompactSnapshot = ({ cwd, activePlanPath = null }) => {
  const parts = { plan: null, git: [] };
  try {
    parts.plan = planSnapshot({ cwd, activePlanPath });
  } catch {
    // No plan part; the handoff says so.
  }
  try {
    parts.git = gitSnapshot(cwd);
  } catch {
    // No working-tree part.
  }
  return parts;
};
