// lit-typographic-motion completion gate. A turn routed to the film skill is done only when the
// skill's done-check says so, not when a command ran: UserPromptSubmit arms the turn, PostToolUse
// records every run of the skill's `motion.mjs` (its subcommand, output dir, round and exit line),
// and the Stop hook refuses to end the turn until the last output directory is done
// (engine/node/done.mjs: a valid treatment, gate PASS, two look rounds, the last one on the final
// render's stills, every listed frame opened with Read according to the session transcript).
//
// A missing, unparsable or outdated treatment.json or look.json is a block with a named reason.
// Only this hook's own state file fails open. After MOTION_MAX_BLOCKS reminders the hook blocks
// once more to tell the model to say, in the reply, that the film is not done and why; a blocked
// environment (exit 10-12, 14, 15) goes straight to that notice. A done film with a downgrade, open
// look items or no image tool blocks once so the reply says so.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { resolveProjectStateRoot } from "./project-state-root.mjs";

export const MOTION_MAX_BLOCKS = 2;
export const MOTION_DISCIPLINE = "lit-typographic-motion";
const COMMAND = /\bmotion\.mjs["']?\s+(stage|make|gate|sound|look|stills|sheet|video|perf)\b([^\n;&|]*)/u;
const BLOCKED_EXITS = new Set([10, 11, 12, 14, 15]);
const DONE_MODULE = new URL("../skills/lit-typographic-motion/engine/node/done.mjs", import.meta.url);

export const motionTurnPath = (cwd = resolveProjectStateRoot()) => join(resolveProjectStateRoot(cwd), ".litclaude", "motion", "turn.json");

const readTurn = (cwd) => {
  const path = motionTurnPath(cwd);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || typeof parsed.sessionId !== "string" || !Number.isInteger(parsed.blockCount)) throw new Error("invalid motion turn state");
  return parsed;
};

const writeTurn = (cwd, state) => {
  const target = motionTurnPath(cwd);
  mkdirSync(join(target, ".."), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, target);
  return state;
};

export const recordMotionTurn = (cwd, { sessionId, discipline, now = Date.now() }) => {
  if (discipline !== MOTION_DISCIPLINE) {
    rmSync(motionTurnPath(cwd), { force: true });
    return null;
  }
  return writeTurn(cwd, { sessionId: typeof sessionId === "string" ? sessionId : "", promptAt: now, runs: [], blockCount: 0, warned: false, notified: false });
};

const unquote = (value) => value?.replace(/^["']|["']$/gu, "");

/** Parse one `motion.mjs <subcommand> ...` command line into { mode, out, brief, round, stillsOnly }. */
export function parseMotionCommand(command, workdir) {
  const match = COMMAND.exec(command);
  if (!match) return null;
  const tokens = [...match[2].matchAll(/"[^"]*"|'[^']*'|[^\s]+/gu)].map((m) => unquote(m[0]));
  const values = {};
  const positional = [];
  let stillsOnly = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--stills-only") stillsOnly = true;
    else if (t.startsWith("--")) {
      if (["--out", "--round", "--answers", "--blocked", "--viewed"].includes(t)) {
        values[t] = tokens[i + 1];
        i += 1;
      }
    } else if (!t.startsWith(">") && !t.startsWith("2>")) positional.push(t);
  }
  const abs = (p) => (p ? (isAbsolute(p) ? p : join(workdir, p)) : null);
  const mode = match[1];
  if (mode === "gate") return { mode, out: abs(positional[0]), brief: null, round: null, stillsOnly: false };
  const round = values["--round"] === undefined ? null : Number(values["--round"]);
  return { mode, brief: ["make", "stills", "sheet", "video", "perf"].includes(mode) ? abs(positional[0]) : null, out: abs(values["--out"]), round, stillsOnly };
}

/** The exit line the CLI prints last: `exit <code> <NAME>`. */
export function exitCodeOf(output) {
  const matches = [...String(output ?? "").matchAll(/^exit (\d+)\b/gmu)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

const toolOutput = (input) => {
  const response = input.tool_response;
  if (!response || typeof response !== "object") return typeof response === "string" ? response : "";
  return [response.stdout, response.stderr, response.output].filter((part) => typeof part === "string").join("\n");
};

export const observeMotionTool = (cwd, { input, now = Date.now() }) => {
  let turn;
  try {
    turn = readTurn(cwd);
  } catch {
    return null;
  }
  if (!turn || turn.sessionId !== input.session_id) return null;
  const workdir = typeof input.cwd === "string" ? input.cwd : cwd;
  const command = input.tool_name === "Bash" && typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  const parsed = parseMotionCommand(command, workdir);
  if (!parsed) return null;
  const run = { ...parsed, exitCode: exitCodeOf(toolOutput(input)), at: now };
  return writeTurn(cwd, { ...turn, runs: [...turn.runs, run].slice(-12) });
};

/** Every file the Read tool opened in this session's transcript (Claude Code JSONL). */
export function readsFromTranscript(transcriptPath) {
  const files = new Set();
  if (typeof transcriptPath !== "string" || !existsSync(transcriptPath)) return files;
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.includes('"Read"')) continue;
    try {
      const entry = JSON.parse(line);
      for (const part of entry?.message?.content ?? []) {
        if (part?.type === "tool_use" && part.name === "Read" && typeof part.input?.file_path === "string") files.add(resolve(part.input.file_path));
      }
    } catch {
      // A partial or foreign line is not a tool event.
    }
  }
  return files;
}

const notDoneNotice = (reasons) => `lit-typographic-motion: the film is not done (${reasons.join("; ")}). Stop rendering now and say in the reply, in plain words, that the film is not done and why, and what the user can run to finish it.`;

export const evaluateMotionStop = async ({ cwd, sessionId, transcriptPath = null, now = Date.now() }) => {
  let turn;
  try {
    turn = readTurn(cwd);
  } catch {
    return { action: "allow", why: "unreadable-turn-state" };
  }
  if (!turn || turn.sessionId !== sessionId) return { action: "allow", why: "not-a-motion-turn" };
  if (turn.notified) return { action: "allow", why: "notified" };
  const last = [...turn.runs].reverse().find((r) => r.out) ?? null;
  let verdict;
  if (!last) verdict = { status: "NOT_DONE", reasons: ["no render command ran in this turn"], downgraded: [], openItems: [] };
  else if (BLOCKED_EXITS.has(last.exitCode)) verdict = { status: "BLOCKED", reasons: [`the render is BLOCKED (exit ${last.exitCode}); report the blocked state and its fix command`], downgraded: [], openItems: [] };
  else {
    const { evaluateDone } = await import(DONE_MODULE.href);
    const viewedFiles = readsFromTranscript(transcriptPath);
    verdict = evaluateDone({ out: last.out, viewedFiles });
  }
  if (verdict.status === "DONE" || verdict.status === "DONE_UNVIEWED") {
    const say = [
      ...(verdict.status === "DONE_UNVIEWED" ? ["nobody viewed the frames (no image tool could be reached)"] : []),
      ...verdict.downgraded.map((d) => `downgraded: ${d}`),
      ...verdict.openItems.map((o) => `open item: ${o}`),
    ];
    if (!say.length) return { action: "allow", why: "done" };
    writeTurn(cwd, { ...turn, notified: true });
    return { action: "block", why: verdict.status, reason: `lit-typographic-motion: the film is finished. The reply must say plainly: ${say.join("; ")}.` };
  }
  if (verdict.status === "BLOCKED" || turn.blockCount >= MOTION_MAX_BLOCKS) {
    writeTurn(cwd, { ...turn, notified: true, warned: true });
    return { action: "block", why: "not-done-notice", reason: notDoneNotice(verdict.reasons) };
  }
  writeTurn(cwd, { ...turn, blockCount: turn.blockCount + 1, lastBlockAt: now });
  return {
    action: "block",
    why: "not-done",
    reason: `lit-typographic-motion is not done: ${verdict.reasons.join("; ")}. Finish the loop in references/look.md: render, open every listed still with Read, record the look round, and render again when the gate or a look answer asks for it.`,
  };
};
