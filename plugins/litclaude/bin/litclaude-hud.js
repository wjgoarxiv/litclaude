#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accentCodeForName,
  ansi16CodeForAccent,
  hudColorDepth,
  litBrandPrefix,
  normalizeHudAppearance,
} from "../lib/hud-accent-palette.mjs";
import { latestUsageTokens } from "../lib/cache-measurement.mjs";
import { readIgnitionState, renderIgnitionSegment } from "../lib/hud-ignition.mjs";

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

const latestUserMessage = (transcriptPath) => {
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  const lines = readFileSync(transcriptPath, "utf8").split(/\r?\n/u).filter(Boolean);
  const ignoredPrefixes = ["[Request interrupted", "[Request cancelled", "<local-command-stdout>", "<local-command-stderr>"];
  const hasCommandXml = (text) => /<(?:command-name|command-message|command-args)\b[^>]*>/u.test(text);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]);
      if (event.type !== "user") continue;
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
  if (days > 0) return `↻${days}d${hours % 24}h`;
  if (hours > 0) return `↻${hours}h${minutes % 60}m`;
  return `↻${minutes}m`;
};

const coloredText = appearance === "dark";
const text = (value) => (coloredText ? accent(value) : value);

const formatUsageSegment = (label, value, reset) => {
  const labelText = text(label);
  if (value === null) {
    return coloredText
      ? `${labelText} ${accent("[")}${colors.accent}░░${colors.reset}${accent("]")} ${accent("--%")}`
      : `${labelText} [${makeBlockBar(0, 2)}] --%`;
  }
  const pct = displayPercent(value);
  const resetText = formatReset(reset);
  const pctText = coloredText ? `${barColor(pct)}${pct}%${colors.reset}` : `${pct}%`;
  return `${labelText} ${accent("[")}${makeBlockBar(pct, 2)}${accent("]")} ${pctText}${resetText ? ` ${text(resetText)}` : ""}`;
};

const main = async () => {
  const input = await readStdin();
  const status = input.trim() ? JSON.parse(input) : {};
  const version = readVersion();
  const model = shortModel(status.model?.display_name ?? status.model?.id);
  const maxContext = Number(status.context_window?.context_window_size ?? 200000);
  const maxK = Math.max(1, Math.round(maxContext / 1000));
  const tokens = latestUsageTokens(status.transcript_path);
  const estimatedTokens = tokens > 0 ? tokens : 20000;
  const statusContextPct = firstNumber(status.context_window?.used_percentage, status.context_window?.usage_percentage);
  const rawContextPct = statusContextPct === null ? Math.floor((estimatedTokens * 100) / maxContext) : statusContextPct;
  const contextPct = displayPercent(rawContextPct);
  const usage = parseUsage(status);
  const usageText = ` ${accent(sep)} ${formatUsageSegment("5h", usage.fiveHour, usage.fiveHourReset)} ${accent(sep)} ${formatUsageSegment("1w", usage.weekly, usage.weeklyReset)}`;
  const git = gitStatus(status.cwd);
  const prefix = litBrandPrefix(version, {
    noColor: plainOutput,
    depth: colorDepth,
    appearance,
  });
  const contextText = `${text("ctx")} ${accent("[")}${makeContextBar(contextPct)}${accent("]")} ${text(`${contextPct}%/${maxK}k`)}`;
  const ignition = renderIgnitionSegment(readIgnitionState(status.session_id), {
    depth: plainOutput ? "plain" : colorDepth,
  });
  const line = `${prefix}${ignition ? ` ${ignition}` : ""} ${accent("|")} ${text(model)} ${accent(sep)} ${contextText}${usageText}${git ? ` ${accent(sep)} ${text("git")} ${text(git)}` : ""}`;
  process.stdout.write(`${line}\n`);

  const lastMessage = latestUserMessage(status.transcript_path);
  if (lastMessage) {
    const trimmed = lastMessage.length > 120 ? `${lastMessage.slice(0, 117)}...` : lastMessage;
    process.stdout.write(`└─ ${trimmed}\n`);
  }
};

main().catch((error) => {
  process.stdout.write(`[🔥LITCLAUDE v${readVersion()}] | HUD unavailable: ${error.message}\n`);
  process.exit(0);
});
