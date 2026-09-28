// Interface-probe hand-off gate. A lit workflow turn (lit-loop, litwork, litgoal, a native
// workflow, or frontend-ui-ux itself) that writes a user-facing web interface must run
// frontend-ui-ux's interface probe before it ends: UserPromptSubmit arms the turn, PostToolUse
// records interface edits and probe runs, and the Stop hook refuses to end the turn until a clean
// probe run follows the last edit. Clean means the run completed: its output shows the Approve
// verdict and no BLOCKED line, or, when the output went elsewhere, its --out manifest (written after
// the edit) has exit code 0, every matrix row and no HIGH finding. Empty output, a BLOCKED run and
// anything the hook cannot read are not clean. The block
// counter is the loop brake: at most INTERFACE_PROBE_MAX_BLOCKS blocks per turn, then the stop
// passes with a warning. Any unreadable state fails SAFE (allow).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";

import { resolveProjectStateRoot } from "./project-state-root.mjs";

export const INTERFACE_PROBE_MAX_BLOCKS = 2;
// start-work is left out: its prompt turn must stay side-effect-free, and the plan rows it runs
// already name frontend-ui-ux in their Verification.
export const INTERFACE_PROBE_WORKFLOWS = Object.freeze(["lit-loop", "litwork", "litgoal", "native-workflow", "frontend-ui-ux"]);
// Files a browser renders as the interface itself. Path segments alone (an `app/` directory) are
// not enough here: a backend-only change must never be held for a browser probe.
export const INTERFACE_FILE_EXTENSIONS = Object.freeze([".html", ".htm", ".css", ".scss", ".sass", ".less", ".vue", ".svelte", ".astro", ".tsx", ".jsx"]);

const PROBE_COMMAND = /\bnode\b[^\n;&|]*interface-probe\.mjs/u;
const OUT_ARGUMENT = /interface-probe\.mjs[^\n;&|]*?--out[=\s]+(?:"([^"]+)"|'([^']+)'|([^\s;&|>]+))/u;
const MATRIX_ROWS = 7;
const MAX_PATHS = 5;

export const interfaceProbeTurnPath = (cwd = resolveProjectStateRoot()) => join(resolveProjectStateRoot(cwd), ".litclaude", "interface-probe", "turn.json");

const readTurn = (cwd) => {
  const path = interfaceProbeTurnPath(cwd);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || typeof parsed.sessionId !== "string" || !Number.isInteger(parsed.blockCount) || parsed.blockCount < 0) {
    throw new Error("invalid interface-probe turn state");
  }
  return parsed;
};

const writeTurn = (cwd, state) => {
  const target = interfaceProbeTurnPath(cwd);
  mkdirSync(join(target, ".."), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, target);
  return state;
};

// Every prompt re-arms or clears the turn, so the gate never outlives the turn that armed it.
export const recordInterfaceProbeTurn = (cwd, { sessionId, discipline, now = Date.now() }) => {
  if (!INTERFACE_PROBE_WORKFLOWS.includes(discipline)) {
    rmSync(interfaceProbeTurnPath(cwd), { force: true });
    return null;
  }
  return writeTurn(cwd, { sessionId: typeof sessionId === "string" ? sessionId : "", discipline, promptAt: now, editAt: null, paths: [], probeAt: null, issue: null, issueAt: null, blockCount: 0, warned: false });
};

export const interfaceFilePaths = (filePaths) => filePaths.filter((path) => INTERFACE_FILE_EXTENSIONS.includes(extname(path).toLowerCase()));

const probeOutput = (input) => {
  const response = input.tool_response;
  if (!response || typeof response !== "object") return "";
  return [response.stdout, response.stderr, response.output].filter((part) => typeof part === "string").join("\n");
};

// Why a probe run is not clean, or null when it is.
const probeIssue = ({ output, command, workdir, editAt }) => {
  if (/BLOCKED:/u.test(output)) return (/BLOCKED:[^\n]*/u.exec(output)[0]).slice(0, 120);
  if (/Verdict: Block \(/u.test(output)) return "a HIGH finding remains";
  if (/Verdict: Approve \(0 HIGH\)/u.test(output)) return null;
  const out = OUT_ARGUMENT.exec(command);
  const dir = out && (out[1] ?? out[2] ?? out[3]);
  if (!dir || dir.includes("$")) return output.trim() ? "no verdict in its output" : "empty output and no readable --out manifest";
  try {
    const file = join(isAbsolute(dir) ? dir : join(workdir, dir), "findings.json");
    if (statSync(file).mtimeMs < (editAt ?? 0)) return "its --out manifest predates the last interface edit";
    const { manifest, findings } = JSON.parse(readFileSync(file, "utf8"));
    if (manifest?.exit_code !== 0 || (manifest.viewports_run ?? []).length < MATRIX_ROWS) return `its --out manifest shows exit ${manifest?.exit_code} with ${(manifest?.viewports_run ?? []).length} of ${MATRIX_ROWS} rows`;
    if ((findings ?? []).some((finding) => finding.severity === "HIGH" && finding.tier !== "not_verified")) return "a HIGH finding remains";
    return null;
  } catch {
    return "empty output and no readable --out manifest";
  }
};

export const observeInterfaceProbeTool = (cwd, { input, filePaths, now = Date.now() }) => {
  let turn;
  try {
    turn = readTurn(cwd);
  } catch {
    return null;
  }
  if (!turn || turn.sessionId !== input.session_id) return null;
  const edited = interfaceFilePaths(filePaths);
  const command = input.tool_name === "Bash" && typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  if (edited.length) {
    return writeTurn(cwd, { ...turn, editAt: now, paths: [...new Set([...edited, ...turn.paths])].slice(0, MAX_PATHS) });
  }
  if (PROBE_COMMAND.test(command)) {
    const workdir = typeof input.cwd === "string" ? input.cwd : cwd;
    const issue = probeIssue({ output: probeOutput(input), command, workdir, editAt: turn.editAt });
    return writeTurn(cwd, issue ? { ...turn, issue, issueAt: now } : { ...turn, probeAt: now, issue: null, issueAt: null });
  }
  return null;
};

export const evaluateInterfaceProbeStop = ({ cwd, sessionId, now = Date.now() }) => {
  const turn = readTurn(cwd);
  if (!turn || turn.sessionId !== sessionId || turn.editAt === null) return { action: "allow", why: "no-interface-edit" };
  if (turn.probeAt !== null && turn.probeAt >= turn.editAt) return { action: "allow", why: "probed" };
  const detail = turn.issue && turn.issueAt >= turn.editAt
    ? `the interface changed (${turn.paths.join(", ")}) and the last interface probe run after it was not clean: ${turn.issue}`
    : `the interface changed (${turn.paths.join(", ")}) and no clean run of frontend-ui-ux's interface probe followed it`;
  if (turn.blockCount >= INTERFACE_PROBE_MAX_BLOCKS) {
    if (turn.warned) return { action: "allow", why: "capped" };
    writeTurn(cwd, { ...turn, warned: true });
    return { action: "warn", why: "capped", systemMessage: `LitClaude interface probe: ${detail}; allowing the stop after ${INTERFACE_PROBE_MAX_BLOCKS} reminders.` };
  }
  writeTurn(cwd, { ...turn, blockCount: turn.blockCount + 1, lastBlockAt: now });
  return {
    action: "block",
    reason: `${detail}. Hand the interface part to Skill(frontend-ui-ux): run scripts/interface-probe.mjs from its skill directory on the built page across the full matrix, fix every HIGH finding, then run it again. If it cannot run, or a HIGH has to stay, say BLOCKED or state the limitation with its reason before finishing.`,
  };
};
