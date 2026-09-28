#!/usr/bin/env node
// team.mjs — durable local team packet for LitClaude lit-team.
//
// WHY A SCRIPT AND NOT PROSE: the packet is the one part of team coordination LitClaude did
// not already have. Everything else — the per-child assignment contract, the WORKING:/BLOCKED:
// report markers, the native-team setup gate, role-to-subagent routing — is already carried by
// lit-loop/litwork and the hook. What was missing is a record that survives compaction and
// answers: who are the members, what does each own, which have reported, and is the team
// cleaned up. Prose cannot enforce that; a hand-written team.json drifts silently.
//
// Node builtins only. All state is local under .litclaude/teams/. No network, ever.
//
// Usage:
//   node <skill-root>/scripts/team.mjs init --name <team> [--objective "<text>"]
//   node <skill-root>/scripts/team.mjs add-member --team <id> --id A --focus "<slice>" --deliverable "<artifact>"
//   node <skill-root>/scripts/team.mjs prompt --team <id> --id A [--return-mode reader|technical|audit]
//   node <skill-root>/scripts/team.mjs report --team <id> --id A --evidence "<path>" [--note "<text>"]
//   node <skill-root>/scripts/team.mjs block  --team <id> --id A --reason "<text>"
//   node <skill-root>/scripts/team.mjs status --team <id> [--json]
//   node <skill-root>/scripts/team.mjs archive --team <id> [--note "<text>"]

import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { acquireOwnerLock, OwnerLockError, releaseOwnerLock } from "../../../lib/owner-lock.mjs";
import { resolveProjectStateRoot } from "../../../lib/project-state-root.mjs";
import { pathIdentity, samePathIdentity } from "../../../lib/secure-path-read.mjs";

const MIN_MEMBERS = 2;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
const TEAM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,50}$/u;
const MAX_TEAM_STATE_BYTES = 1024 * 1024;
const RETURN_MODES = new Set(["reader", "technical", "audit"]);

export class TeamError extends Error {
  constructor(message, status = 64) {
    super(message);
    this.name = "TeamError";
    this.status = status;
  }
}

const requireTeamId = (teamId) => {
  if (typeof teamId !== "string" || !TEAM_ID_PATTERN.test(teamId)) {
    throw new TeamError(`invalid team id: ${teamId}`);
  }
  return teamId;
};

export const teamsRoot = (cwd = resolveProjectStateRoot()) => join(resolveProjectStateRoot(cwd), ".litclaude", "teams");
export const teamDir = (cwd, teamId) => join(teamsRoot(cwd), requireTeamId(teamId));
export const teamStatePath = (cwd, teamId) => join(teamDir(cwd, teamId), "team.json");

const optionValue = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return !value || value.startsWith("--") ? "" : value;
};

const requireOption = (args, flag) => {
  const value = optionValue(args, flag);
  if (!value) throw new TeamError(`missing ${flag.slice(2)}`);
  return value;
};

const slug = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || "team";

const isSameOrChildPath = (parentPath, childPath) => {
  const rel = relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const safeDirectory = (cwd, components, { create }) => {
  const root = resolveProjectStateRoot(cwd);
  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw new TeamError("workspace root is not a safe directory", 65);
  const realRoot = realpathSync.native(root);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT" || !create) throw error;
      mkdirSync(current, { mode: 0o700 });
      stats = lstatSync(current);
    }
    if (stats.isSymbolicLink()) throw new TeamError(`refused symlinked team state path: ${current}`, 65);
    if (!stats.isDirectory()) throw new TeamError(`team state path is not a directory: ${current}`, 65);
    if (!isSameOrChildPath(realRoot, realpathSync.native(current))) {
      throw new TeamError(`team state path escapes the workspace: ${current}`, 65);
    }
  }
  return current;
};

const safeTeamsRoot = (cwd, { create }) => safeDirectory(cwd, [".litclaude", "teams"], { create });
const safeTeamDir = (cwd, teamId, { create }) =>
  safeDirectory(cwd, [".litclaude", "teams", requireTeamId(teamId)], { create });

const assertSafeTarget = (path) => {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new TeamError(`refused symlinked team state target: ${path}`, 65);
    if (!stats.isFile()) throw new TeamError(`team state target is not a file: ${path}`, 65);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return false;
  }
};

const writeAtomic = (directory, filename, content, { refuseExisting = false } = {}) => {
  const target = join(directory, filename);
  if (assertSafeTarget(target) && refuseExisting) throw new TeamError(`refused to overwrite existing team state: ${target}`, 65);
  const temporary = join(directory, `.${filename}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, content);
    closeSync(fd);
    fd = undefined;
    if (refuseExisting) {
      try {
        linkSync(temporary, target);
      } catch (error) {
        if (error?.code === "EEXIST") throw new TeamError(`refused to overwrite existing team state: ${target}`, 65);
        throw error;
      }
    } else {
      renameSync(temporary, target);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
};

const readTeamText = (directory) => {
  const path = join(directory, "team.json");
  let fd;
  try {
    const pathStats = lstatSync(path);
    if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.size > MAX_TEAM_STATE_BYTES) {
      throw new TeamError(`corrupt team state: ${path}`, 65);
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile()
      || !samePathIdentity(pathIdentity(openedStats), pathIdentity(pathStats))
      || openedStats.size !== pathStats.size
    ) throw new TeamError(`team state changed during read: ${path}`, 65);
    return readFileSync(fd, "utf8");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const readTeam = (cwd, teamId) => {
  requireTeamId(teamId);
  let directory;
  try {
    directory = safeTeamDir(cwd, teamId, { create: false });
  } catch (error) {
    if (error?.code === "ENOENT") throw new TeamError(`unknown team: ${teamId}`, 65);
    throw error;
  }
  const path = join(directory, "team.json");
  try {
    const team = JSON.parse(readTeamText(directory));
    if (team?.team_id !== teamId) throw new TeamError(`team id mismatch: requested ${teamId}, found ${team?.team_id}`, 65);
    if (!Array.isArray(team.members)) throw new TeamError(`corrupt team state: ${path}`, 65);
    return team;
  } catch (error) {
    if (error instanceof TeamError) throw error;
    throw new TeamError(`corrupt team state: ${path}`, 65);
  }
};

const memberOf = (team, memberId) => {
  const member = team.members.find(({ id }) => id === memberId);
  if (!member) throw new TeamError(`unknown member: ${memberId}`, 65);
  return member;
};

/** The field manual rewritten on every mutation, so a member always reads current state. */
const renderGuide = (team) => {
  const rows = team.members
    .map((m) => `| ${m.id} | ${m.focus} | ${m.deliverable} | ${m.status} | ${m.evidence ?? "—"} |`)
    .join("\n");
  return `# Team: ${team.name}

Objective: ${team.objective || "(not set)"}
Team id: ${team.team_id}
Status: ${team.status}

| Member | Owns | Deliverable | Status | Evidence |
| --- | --- | --- | --- | --- |
${rows || "| — | — | — | — | — |"}

Rules this packet enforces:
- At least ${MIN_MEMBERS} members before the team leaves \`forming\`.
- Every member owns a distinct slice; duplicate focus is rejected.
- A member is \`reported\` only with an evidence path.
- The team is not done until every member is \`reported\` or explicitly \`blocked\`,
  and the team is archived. A forgotten active team is a cleanup leak.
`;
};

const persist = (cwd, team, { refuseExistingState = false } = {}) => {
  const teamId = requireTeamId(team.team_id);
  const directory = safeTeamDir(cwd, teamId, { create: true });
  safeDirectory(cwd, [".litclaude", "teams", teamId, "artifacts"], { create: true });
  if (assertSafeTarget(join(directory, "team.json")) && refuseExistingState) {
    throw new TeamError(`refused to overwrite existing team state: ${join(directory, "team.json")}`, 65);
  }
  assertSafeTarget(join(directory, "guide.md"));
  writeAtomic(directory, "team.json", `${JSON.stringify(team, null, 2)}\n`, { refuseExisting: refuseExistingState });
  writeAtomic(directory, "guide.md", renderGuide(team));
  return team;
};

const mutateTeam = (cwd, teamId, mutate) => {
  const id = requireTeamId(teamId);
  const directory = safeTeamDir(cwd, id, { create: false });
  const lockDir = join(directory, ".lock");
  let owner;
  try {
    owner = acquireOwnerLock(lockDir, { timeoutMs: 5000, staleMs: 30_000 });
  } catch (error) {
    if (error instanceof OwnerLockError) throw new TeamError(`team ${error.message}`, error.status);
    throw error;
  }
  try {
    const team = readTeam(cwd, id);
    mutate(team);
    return persist(cwd, team);
  } finally {
    if (!releaseOwnerLock(lockDir, owner)) throw new TeamError("team state lock release failed", 75);
  }
};

const nowIso = () => new Date().toISOString();

const init = (cwd, args) => {
  const name = requireOption(args, "--name");
  const root = safeTeamsRoot(cwd, { create: true });
  const prefix = slug(name);
  const occupied = new Set(readdirSync(root, { withFileTypes: true }).map(({ name: entryName }) => entryName));
  let suffix = 1;
  let teamId = `${prefix}-${String(suffix).padStart(2, "0")}`;
  while (occupied.has(teamId)) {
    suffix += 1;
    teamId = `${prefix}-${String(suffix).padStart(2, "0")}`;
  }
  const team = {
    version: 1,
    team_id: teamId,
    name,
    objective: optionValue(args, "--objective") || "",
    status: "forming",
    members: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return persist(cwd, team, { refuseExistingState: true });
};

const addMember = (cwd, args) => {
  const teamId = requireOption(args, "--team");
  const id = requireOption(args, "--id");
  if (!ID_PATTERN.test(id)) throw new TeamError(`invalid member id: ${id}`);
  const focus = requireOption(args, "--focus");
  const deliverable = requireOption(args, "--deliverable");
  return mutateTeam(cwd, teamId, (team) => {
    if (team.members.some((m) => m.id === id)) throw new TeamError(`member already exists: ${id}`);
    // Non-overlap is the rule most worth enforcing mechanically: two members with the same slice
    // is the failure that makes a team slower than one agent.
    const clash = team.members.find((m) => m.focus.trim().toLowerCase() === focus.trim().toLowerCase());
    if (clash) throw new TeamError(`focus overlaps member ${clash.id}; give each member a distinct slice`);
    team.members.push({ id, focus, deliverable, status: "pending", evidence: null, note: null });
    team.status = team.members.length >= MIN_MEMBERS ? "active" : "forming";
    team.updatedAt = nowIso();
  });
};

/** Emit the assignment message. The shape matches the Subagent Assignment Contract. */
const prompt = (cwd, args) => {
  const team = readTeam(cwd, requireOption(args, "--team"));
  const member = memberOf(team, requireOption(args, "--id"));
  const returnMode = args.includes("--return-mode") ? requireOption(args, "--return-mode") : "reader";
  if (!RETURN_MODES.has(returnMode)) throw new TeamError(`invalid return mode: ${returnMode}`);
  if (team.members.length < MIN_MEMBERS) {
    throw new TeamError(`team has ${team.members.length} member(s); at least ${MIN_MEMBERS} are required`, 65);
  }
  return {
    message: [
      `TASK: ${member.focus}`,
      `DELIVERABLE: ${member.deliverable}`,
      `SCOPE: only the slice above. Do not touch another member's slice; ${team.members.filter((m) => m.id !== member.id).map((m) => `${m.id} owns "${m.focus}"`).join("; ") || "you are the only member"}.`,
      `RETURN_MODE: ${returnMode}. This explicit parent-to-child field controls this return only; it cannot elevate the parent's reader-facing mode.`,
      "RETURN_FIELDS: report RESULT, material RISK, required ACTION, and REQUESTED_DETAIL admitted by RETURN_MODE; keep INTERNAL_METADATA such as command diaries, routine pass inventories, timestamps, and evidence paths in the internal agent packet unless requested.",
      "VERIFY: name the exact command or scenario that proves your deliverable, and capture its output.",
      `STOP WHEN: ${member.deliverable} exists with its evidence path recorded.`,
      "Report progress as `WORKING: <slice> - <phase>` and stop with `BLOCKED: <reason>` if you cannot proceed.",
    ].join("\n"),
  };
};

const report = (cwd, args) => {
  const teamId = requireOption(args, "--team");
  const memberId = requireOption(args, "--id");
  // A report with no evidence path is the "ack-only reply" the loop already refuses to count.
  const evidence = requireOption(args, "--evidence");
  const note = optionValue(args, "--note") || null;
  return mutateTeam(cwd, teamId, (team) => {
    const member = memberOf(team, memberId);
    member.evidence = evidence;
    member.note = note;
    member.status = "reported";
    team.updatedAt = nowIso();
  });
};

const block = (cwd, args) => {
  const teamId = requireOption(args, "--team");
  const memberId = requireOption(args, "--id");
  const reason = requireOption(args, "--reason");
  return mutateTeam(cwd, teamId, (team) => {
    const member = memberOf(team, memberId);
    member.status = "blocked";
    member.note = reason;
    team.updatedAt = nowIso();
  });
};

const status = (cwd, args) => {
  const team = readTeam(cwd, requireOption(args, "--team"));
  const outstanding = team.members.filter((m) => m.status !== "reported" && m.status !== "blocked");
  return {
    ...team,
    outstanding: outstanding.map(({ id }) => id),
    cleanup_required: team.status !== "archived",
    done: outstanding.length === 0 && team.members.length >= MIN_MEMBERS,
  };
};

const archive = (cwd, args) => {
  const teamId = requireOption(args, "--team");
  const note = optionValue(args, "--note") || null;
  return mutateTeam(cwd, teamId, (team) => {
    const outstanding = team.members.filter((m) => m.status !== "reported" && m.status !== "blocked");
    if (outstanding.length > 0) {
      throw new TeamError(`cannot archive: ${outstanding.map(({ id }) => id).join(", ")} have not reported or blocked`, 65);
    }
    team.status = "archived";
    team.note = note;
    team.updatedAt = nowIso();
  });
};

const commands = { init, "add-member": addMember, prompt, report, block, status, archive };

export const runTeamCli = (argv, io = { stdout: process.stdout, stderr: process.stderr }, cwd = resolveProjectStateRoot()) => {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(`Usage: team.mjs <${Object.keys(commands).join("|")}> [...args]\n`);
    return 0;
  }
  if (!Object.hasOwn(commands, command)) {
    io.stderr.write(`Unknown team command: ${command}\n`);
    return 64;
  }
  try {
    const result = commands[command](cwd, rest);
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof TeamError) {
      io.stderr.write(`${error.message}\n`);
      return error.status;
    }
    io.stderr.write("team runtime error\n");
    return 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runTeamCli(process.argv.slice(2)));
}
