// `agent-file project [--dir <path>]`, shared by the npm CLI and the plugin's in-session `litclaude-ai`
// (lit-init runs it inside a session): the project block in the repo's AGENTS.md, plus a CLAUDE.md that
// imports it when the repo has none. An existing CLAUDE.md is the user's and is left alone.

import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { markLitHome } from "../mark.mjs";
import { AGENT_FILE_ID, agentFileBody, applyAgentFile } from "./apply.mjs";
import { readAttributionMode } from "./attribution.mjs";

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude-plugin", "plugin.json");
const pluginVersion = () => JSON.parse(readFileSync(manifestPath, "utf8")).version;

export const agentFileLine = (result) => `AGENT_FILE: ${result.status} ${result.path}${result.backup ? ` (backup: ${result.backup})` : ""}`;

/** Returns the exit code; prints `AGENT_FILE:` lines. */
export const runAgentFileCli = (rest, { cwd = process.cwd(), dryRun = false, out = process.stdout, err = process.stderr } = {}) => {
  const [sub, ...args] = rest;
  if (sub === "--help" || sub === "-h") {
    out.write("Usage: litclaude-ai agent-file project [--dir <path>]\n");
    return 0;
  }
  if (sub !== "project") {
    err.write("Usage: litclaude-ai agent-file project [--dir <path>]\n");
    return 64;
  }
  let dir = cwd;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dir" && args[index + 1]) {
      dir = resolve(cwd, args[index + 1]);
      index += 1;
      continue;
    }
    err.write(`Unknown agent-file option: ${args[index]}\n`);
    return 64;
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    // Missing: reported below, never created.
  }
  if (!isDirectory) {
    err.write(`agent-file: ${dir} is not an existing folder\n`);
    return 64;
  }
  const body = agentFileBody("project", { attribution: readAttributionMode({ litHome: markLitHome() }) });
  // No backup copy here: in a repo it would sit untracked beside AGENTS.md and could be committed.
  const agents = applyAgentFile({ path: join(dir, "AGENTS.md"), id: AGENT_FILE_ID, version: pluginVersion(), body, action: "install", dryRun, backup: false, createParent: false });
  out.write(`${agentFileLine(agents)}\n`);
  if (agents.status.startsWith("refused")) return 1;
  const claude = join(dir, "CLAUDE.md");
  let claudeKind = "missing";
  try {
    const stats = lstatSync(claude);
    claudeKind = stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
  } catch {
    // Missing.
  }
  if (claudeKind === "missing") {
    if (!dryRun) writeFileSync(claude, "@AGENTS.md\n", { flag: "wx" });
    out.write(`AGENT_FILE: ${dryRun ? "dry-run" : "created"} ${claude} (imports AGENTS.md)\n`);
  } else if (claudeKind !== "file") {
    out.write(`AGENT_FILE: ${claudeKind === "symlink" ? "refused-symlink" : "refused-not-file"} ${claude}; left as it is\n`);
  } else if (!readFileSync(claude, "utf8").includes("@AGENTS.md")) {
    out.write(`AGENT_FILE: kept ${claude}; add \`@AGENTS.md\` to it so Claude Code loads the project block\n`);
  }
  return 0;
};
