#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accentCodeForName,
  ansi16CodeForAccent,
  hudColorDepth,
  litBrandPrefix,
  normalizeHudAppearance,
} from "../lib/hud-accent-palette.mjs";
import { latestUsageTokensCached } from "../lib/cache-measurement.mjs";
import { xterm256Hex } from "../lib/mod/settings.mjs";
import { lerpColor } from "../lib/mod/motion.mjs";
import { roundCapsHere } from "../lib/round-caps.mjs";
import { ignitionStatePath } from "../lib/hud-ignition.mjs";
import { resolveProjectStateRoot } from "../lib/project-state-root.mjs";
import { recordContextUsage, resolveAutoHandoff } from "../lib/auto-handoff.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginManifestPath = join(pluginRoot, ".claude-plugin", "plugin.json");
const noColor = Object.hasOwn(process.env, "NO_COLOR") || process.env.LITCLAUDE_HUD_NO_COLOR === "1";
const sep = process.env.LITCLAUDE_HUD_SEP || "│";
const configuredAccent = String(process.env.LITCLAUDE_HUD_ACCENT || "cyan").toLowerCase();
const accentCode = accentCodeForName(configuredAccent);
const appearance = normalizeHudAppearance(process.env.LITCLAUDE_HUD_APPEARANCE);
const colorDepth = noColor ? "plain" : hudColorDepth(process.env);
const ansi = (ansi16, ansi256) => {
  if (colorDepth === "plain") return "";
  if (colorDepth === "16") return `\x1b[${ansi16}m`;
  return `\x1b[38;5;${ansi256}m`;
};

const plainOutput = noColor || colorDepth === "plain";
const colors = plainOutput
  ? { reset: "", bold: "", dim: "", accent: "", empty: "", green: "", yellow: "", red: "" }
  : {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: ansi(90, 245),
      accent: ansi(ansi16CodeForAccent(configuredAccent), accentCode),
      empty: ansi(90, 238),
      green: ansi(32, 71),
      yellow: ansi(33, 178),
      red: ansi(31, 167),
    };

const accent = (text) => `${colors.accent}${text}${colors.reset}`;

// Round gauges and badge on a dark truecolor terminal that can draw round caps (lib/mod/round.mjs).
// LITCLAUDE_HUD_GLYPHS=basic keeps the square bars.
const round = colorDepth === "truecolor" && appearance === "dark" && await roundCapsHere({ cached: true });
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const fg = (hex) => `\x1b[38;2;${rgb(hex).join(";")}m`;
const bg = (hex) => `\x1b[48;2;${rgb(hex).join(";")}m`;
const TRACK = "#2a2340";
const RAMP = { green: ["#2fd6a0", "#6bf0c8"], yellow: ["#ffcc44", "#ff8833"], red: ["#ff5566", "#ff2d95"] };
const NEON = ["#ff2d95", "#ff66bb", "#b48cff", "#8fb0ff", "#00e5ff"];
// The dividers run pink to cyan from left to right.
const joinSegments = (segments) => segments.reduce((line, segment, i) => `${line} ${round ? `${fg(NEON[(i - 1) % NEON.length])}${sep}${colors.reset}` : accent(sep)} ${segment}`);

const readStdin = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const readVersion = () => {
  if (process.env.LITCLAUDE_VERSION) return process.env.LITCLAUDE_VERSION;
  try {
    return JSON.parse(readFileSync(pluginManifestPath, "utf8")).version ?? "?";
  } catch {
    return "?";
  }
};

const shortModel = (raw) => {
  const compact = String(raw || "?")
    .replace(/\([^)]*\)/gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const number = compact.match(/[0-9]+(?:\.[0-9]+)?/u)?.[0] ?? "";
  if (/opus/iu.test(compact)) return `O${number}`;
  if (/sonnet/iu.test(compact)) return `S${number}`;
  if (/haiku/iu.test(compact)) return `H${number}`;
  return compact.slice(0, 10) || "?";
};

// A million-token window reads as 1m, and smaller ones keep their k count.
const formatWindow = (size) => {
  if (size >= 1000000 && size % 100000 === 0) return `${size / 1000000}m`;
  return `${Math.max(1, Math.round(size / 1000))}k`;
};

// Claude Code sends effort.level only for models that take the effort parameter.
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const effortLabel = (status) => {
  const level = status.effort?.level;
  return EFFORT_LEVELS.has(level) ? `[${level}]` : "";
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const displayPercent = (value) => Math.round(clamp(value));

const barColor = (value) => {
  if (value >= 90) return colors.red;
  if (value >= 70) return colors.yellow;
  return colors.green;
};

const makeBlockBar = (value, width = 3, color = null) => {
  const pct = clamp(Math.round(value));
  const exact = (pct * width) / 100;
  const filled = Math.floor(exact);
  const partial = exact - filled;
  const partialBlocks = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  const partialIndex = filled < width && partial > 0 ? Math.max(1, Math.min(7, Math.round(partial * 8))) : 0;
  const empty = width - filled - (partialIndex > 0 ? 1 : 0);
  return `${color ?? barColor(pct)}${"█".repeat(filled)}${partialBlocks[partialIndex]}${colors.empty}${"░".repeat(empty)}${colors.reset}`;
};

const makeContextBar = (value, width = 3) => {
  const pct = clamp(Math.round(value));
  return makeBlockBar(pct, width, colors.accent);
};

// The same cells as `[` + makeBlockBar + `]`, with round caps in the bracket cells.
const roundBar = (value, width, [from, to]) => {
  const pct = clamp(Math.round(value));
  const exact = (pct * width) / 100;
  const full = Math.floor(exact);
  const eighth = exact > full ? Math.max(1, Math.min(7, Math.round((exact - full) * 8))) : 0;
  let out = `${fg(exact > 0 ? from : TRACK)}\ue0b6${bg(TRACK)}`;
  for (let i = 0; i < width; i += 1) {
    out += `${fg(lerpColor(from, to, width < 2 ? 0 : i / (width - 1)))}${i < full ? "█" : i === full && eighth ? "▏▎▍▌▋▊▉"[eighth - 1] : " "}`;
  }
  return `${out}${colors.reset}${fg(full >= width ? to : TRACK)}\ue0b4${colors.reset}`;
};

// Milliseconds until a window runs out at its average pace so far; null when it lasts to its reset.
const runsOutIn = (pct, reset, spanMs) => {
  const left = parseResetTarget(reset) - Date.now();
  const elapsed = spanMs - left;
  if (!Number.isFinite(left) || left <= 0 || elapsed < spanMs * 0.1 || pct <= 0 || pct >= 100) return null;
  const out = ((100 - pct) / pct) * elapsed;
  return out < left ? out : null;
};

const latestUserMessage = (transcriptPath) => {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  const lines = readFileSync(transcriptPath, "utf8").split(/\r?\n/u).filter(Boolean);
  // A background task's `<task-notification>` is written as a user entry too; it is the host talking, not a prompt.
  const ignoredPrefixes = ["[Request interrupted", "[Request cancelled", "<local-command-stdout>", "<local-command-stderr>", "<task-notification>"];
  const hasCommandXml = (text) => /<(?:command-name|command-message|command-args)\b[^>]*>/u.test(text);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]);
      // Loaded skill bodies and compaction summaries are host-written user entries, not prompts.
      if (event.type !== "user" || event.isMeta === true || event.isCompactSummary === true) continue;
      // Notifications, peer messages and scheduled firings carry `promptSource: "system"`; only typed prompts count.
      if (event.promptSource === "system") continue;
      const content = event?.message?.content;
      const text = Array.isArray(content)
        ? content.filter((part) => part?.type === "text").map((part) => part.text).join(" ")
        : content;
      const normalized = String(text || "").replace(/\s+/gu, " ").trim();
      if (normalized && !ignoredPrefixes.some((prefix) => normalized.startsWith(prefix)) && !hasCommandXml(normalized)) {
        return normalized;
      }
    } catch {
    }
  }
  return "";
};

const gitStatus = (cwd) => {
  if (!cwd || !existsSync(cwd)) return "";
  try {
    const branch = execFileSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!branch) return "";
    const status = execFileSync("git", ["-C", cwd, "--no-optional-locks", "status", "--porcelain", "-uall"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const count = status ? status.split(/\r?\n/u).length : 0;
    let sync = "✓";
    try {
      execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "@{upstream}"], { stdio: "ignore" });
      const [ahead, behind] = execFileSync("git", ["-C", cwd, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().split(/\s+/u).map(Number);
      sync = `${ahead > 0 ? `↑${ahead}` : ""}${behind > 0 ? `↓${behind}` : ""}` || "✓";
    } catch {
      sync = "✓";
    }
    return `${branch}${count > 0 ? ` +${count}` : ""} ${sync}`;
  } catch {
    return "";
  }
};

const firstNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
};

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

const parseUsage = (status) => {
  const raw = process.env.LITCLAUDE_HUD_TEST_USAGE || process.env.CLAUDE_HUD_TEST_USAGE || "";
  const values = {};
  for (const part of raw.split(",")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined) continue;
    values[key.trim()] = value.trim();
  }
  const fiveHour = status.rate_limits?.five_hour ?? status.rate_limits?.["5_hour"] ?? {};
  const sevenDay = status.rate_limits?.seven_day ?? status.rate_limits?.["7_day"] ?? status.rate_limits?.weekly ?? {};
  const fiveHourPct = firstNumber(values["5h"], values.five_hour, fiveHour.used_percentage, fiveHour.percentage, fiveHour.usedPercent);
  const weeklyPct = firstNumber(values["1w"], values.wk, values.seven_day, sevenDay.used_percentage, sevenDay.percentage, sevenDay.usedPercent);
  return {
    fiveHour: fiveHourPct === null ? null : clamp(fiveHourPct),
    fiveHourReset: firstString(
      values.reset5,
      values.reset5h,
      fiveHour.resets_at,
      fiveHour.reset_at,
      fiveHour.reset_time,
      fiveHour.resetAt,
      fiveHour.resetTime,
      fiveHour.next_reset,
      fiveHour.nextReset,
    ),
    weekly: weeklyPct === null ? null : clamp(weeklyPct),
    weeklyReset: firstString(
      values.reset1,
      values.resetw,
      values.reset7,
      values.reset7d,
      sevenDay.resets_at,
      sevenDay.reset_at,
      sevenDay.reset_time,
      sevenDay.resetAt,
      sevenDay.resetTime,
      sevenDay.next_reset,
      sevenDay.nextReset,
    ),
  };
};

const parseResetTarget = (value) => {
  if (!value) return NaN;
  const raw = String(value).trim();
  if (/^\d+(?:\.\d+)?$/u.test(raw)) {
    const epoch = Number(raw);
    return epoch < 100000000000 ? epoch * 1000 : epoch;
  }
  return Date.parse(raw);
};

const formatReset = (value) => {
  const target = parseResetTarget(value);
  if (!Number.isFinite(target)) return "";
  const minutes = Math.max(0, Math.floor((target - Date.now()) / 60000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `↻ ${days}d${hours % 24}h`;
  if (hours > 0) return `↻ ${hours}h${minutes % 60}m`;
  return `↻ ${minutes}m`;
};

const coloredText = appearance === "dark";
const text = (value) => (coloredText ? accent(value) : value);

const HOUR = 3_600_000;

const formatUsageSegment = (label, value, reset, spanMs) => {
  const labelText = text(label);
  if (value === null && round) return `${labelText} ${roundBar(0, 2, RAMP.green)}${accent("--%")}`;
  if (value === null) {
    return coloredText
      ? `${labelText} ${accent("[")}${colors.accent}░░${colors.reset}${accent("]")}${accent("--%")}`
      : `${labelText} [${makeBlockBar(0, 2)}]--%`;
  }
  const pct = displayPercent(value);
  const resetText = formatReset(reset);
  // At this pace the window runs out before its reset: the figure warns, and the reset time gives way to when.
  const out = runsOutIn(pct, reset, spanMs);
  const level = pct >= 90 ? "red" : pct >= 70 || out !== null ? "yellow" : "green";
  const tone = round ? fg(RAMP[level][0]) : colors[level];
  const pctText = coloredText ? `${tone}${pct}%${colors.reset}` : `${pct}%`;
  const bar = round ? roundBar(pct, 2, RAMP[level]) : `${accent("[")}${makeBlockBar(pct, 2, tone)}${accent("]")}`;
  const tail = out === null ? text(resetText) : `${coloredText ? tone : ""}! out ${formatReset(Date.now() + out).slice(2)}${coloredText ? colors.reset : ""}`;
  return `${labelText} ${bar}${pctText}${resetText ? ` ${tail}` : ""}`;
};

// Automatic handoff: while it is on, leave the percent for the Stop hook and show the setting.
// A setting that was asked for but does not add up shows a warning mark instead.
const autoHandoffSegment = (status, contextPercent) => {
  try {
    const cwd = typeof status.cwd === "string" && status.cwd ? status.cwd : null;
    if (!cwd) return null;
    const stateRoot = resolveProjectStateRoot(cwd);
    const setting = resolveAutoHandoff({ env: process.env, stateRoot });
    if (setting.enabled) {
      recordContextUsage({
        stateRoot,
        sessionId: status.session_id,
        percent: contextPercent,
        window: Number(status.context_window?.context_window_size),
      });
      return { text: text(`handoff@${setting.percent}%`), percent: setting.percent };
    }
    return setting.requested ? { text: text("handoff ⚠"), percent: null } : null;
  } catch {
    return null;
  }
};

const main = async () => {
  const input = await readStdin();
  const status = input.trim() ? JSON.parse(input) : {};
  const version = readVersion();
  const model = shortModel(status.model?.display_name ?? status.model?.id);
  const maxContext = Number(status.context_window?.context_window_size ?? 200000);
  const windowText = formatWindow(maxContext);
  const statusContextPct = firstNumber(status.context_window?.used_percentage, status.context_window?.usage_percentage);
  const usageCachePath = join(dirname(ignitionStatePath(status.session_id)), `usage-${basename(ignitionStatePath(status.session_id))}`);
  const tokens = statusContextPct === null ? latestUsageTokensCached(status.transcript_path, usageCachePath) : 0;
  // Without a host percent or a transcript usage record the size is unknown, and the line says so.
  const knownContextPct = statusContextPct !== null ? statusContextPct : tokens > 0 ? Math.floor((tokens * 100) / maxContext) : null;
  const usage = parseUsage(status);
  const git = gitStatus(status.cwd);
  const prefix = litBrandPrefix(version, {
    noColor: plainOutput,
    depth: colorDepth,
    appearance,
    roundCaps: round,
  });
  const contextPct = knownContextPct === null ? null : displayPercent(knownContextPct);
  const autoHandoff = autoHandoffSegment(status, knownContextPct);
  // The context gauge turns yellow within ten points of the automatic handoff and red past it.
  const limit = autoHandoff?.percent ?? 90;
  const contextRamp = contextPct >= limit ? RAMP.red : contextPct >= limit - 10 ? RAMP.yellow : ["#b48cff", xterm256Hex(accentCode)];
  const contextText = contextPct === null
    ? `${text("ctx")} ${text(`?/${windowText}`)}`
    : `${text("ctx")} ${round ? roundBar(contextPct, 3, contextRamp) : `${accent("[")}${makeContextBar(contextPct)}${accent("]")}`} ${text(`${contextPct}%/${windowText}`)}`;
  const effort = effortLabel(status);
  const line = joinSegments([
    `${prefix} ${accent("|")} ${text(model)}${effort ? ` ${text(effort)}` : ""}`,
    contextText,
    ...(autoHandoff ? [autoHandoff.text] : []),
    formatUsageSegment("5h", usage.fiveHour, usage.fiveHourReset, 5 * HOUR),
    formatUsageSegment("1w", usage.weekly, usage.weeklyReset, 168 * HOUR),
    ...(git ? [`${text("git")} ${text(git)}`] : []),
  ]);
  process.stdout.write(`${line}\n`);

  const lastMessage = latestUserMessage(status.transcript_path);
  if (lastMessage) {
    const trimmed = lastMessage.length > 120 ? `${lastMessage.slice(0, 117)}...` : lastMessage;
    process.stdout.write(`└─ ${trimmed}\n`);
  }
};

main().catch((error) => {
  process.stdout.write(`[🔥LIT v${readVersion()}] | HUD unavailable: ${error.message}\n`);
  process.exit(0);
});
