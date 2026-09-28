import { spawnSync } from "node:child_process";

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/u,
  /(?:api[_-]?key|token|secret|password)\s*=\s*\S+/iu,
];

const allowedModes = new Set(["print", "bg"]);

export class NativeWorkerError extends Error {
  constructor(message, status = 64) {
    super(message);
    this.name = "NativeWorkerError";
    this.status = status;
  }
}

const hasFlag = (args, flag) => args.includes(flag);

const optionValue = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return "";
  return value;
};

const normalizeSpaces = (value) => value.replace(/\s+/gu, " ").trim();

export const normalizeNativeWorkerCondition = (value) => {
  if (typeof value !== "string") return "";
  return normalizeSpaces(value);
};

export const validateNativeWorkerCondition = (condition) => {
  if (typeof condition !== "string" || condition.trim() === "") {
    throw new NativeWorkerError("missing condition");
  }
  if (/[\r\n]/u.test(condition)) {
    throw new NativeWorkerError("condition must be a single line");
  }
  const normalized = normalizeNativeWorkerCondition(condition);
  if (!normalized) throw new NativeWorkerError("missing condition");
  if (normalized.startsWith("/")) {
    throw new NativeWorkerError("condition must not start with a slash command");
  }
  if (secretPatterns.some((pattern) => pattern.test(normalized))) {
    throw new NativeWorkerError("condition contains secret-like material");
  }
  return normalized;
};

export const buildNativeWorkerCommand = (args) => {
  const condition = validateNativeWorkerCondition(optionValue(args, "--condition") ?? "");
  const mode = optionValue(args, "--mode") || "print";
  if (!allowedModes.has(mode)) {
    throw new NativeWorkerError("--mode must be one of print, bg");
  }

  const goalPrompt = `/goal ${condition}`;
  const commandArgs = mode === "bg"
    ? ["--bg", "--name", optionValue(args, "--name") || "", goalPrompt]
    : ["-p", goalPrompt];

  if (mode === "bg" && !commandArgs[2]) {
    throw new NativeWorkerError("--name is required for --mode bg");
  }

  return {
    status: hasFlag(args, "--execute") ? "ready" : "dry-run",
    mode,
    command: "claude",
    args: commandArgs,
    prompt: goalPrompt,
    message: hasFlag(args, "--execute")
      ? `Native /goal worker ready (${mode}).`
      : `DRY_RUN: would launch native /goal worker (${mode}).`,
  };
};

export const runNativeWorker = (args, { cwd = process.cwd(), env = process.env } = {}) => {
  const plan = buildNativeWorkerCommand(args);
  if (!hasFlag(args, "--execute")) return plan;

  const child = spawnSync(plan.command, plan.args, {
    cwd,
    env,
    encoding: "utf8",
  });

  return {
    ...plan,
    status: child.status === 0 ? "executed" : "failed",
    exitCode: child.status,
    signal: child.signal,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? (child.error ? String(child.error) : ""),
    message: child.status === 0
      ? `Native /goal worker launched (${plan.mode}).`
      : `Native /goal worker failed (${plan.mode}).`,
  };
};
