import { resolve } from "node:path";

import { resolveProjectStateRoot } from "./project-state-root.mjs";
import {
  captureKnowledgeEvent,
  queryKnowledge,
  reviewKnowledgeRecord,
  WikifyKnowledgeError,
  writeCaptureSettings,
} from "./wikify-knowledge.mjs";

const helpText = `Usage: litclaude-ai wikify <command> [...args]

Commands:
  capture  Capture one structured fact, decision, failure, risk, rule, or checkpoint.
  save     Explicitly promote one review-needed record to accepted.
  review   Set one record to accepted, rejected, or stale.
  query    Print a bounded accepted-only local knowledge block.
  config   Set default-on capture with --capture on|off.

Boundary:
  Wikify state is user-owned local state with cooperative writers.
  The same uid is not a tamper-proof or confidential boundary.
`;

class WikifyCliError extends Error {
  constructor(message, status = 64) {
    super(message);
    this.name = "WikifyCliError";
    this.status = status;
  }
}

const optionValue = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new WikifyCliError(`${flag} requires a value`);
  return value;
};

const requireOption = (args, flag) => optionValue(args, flag) ?? (() => {
  throw new WikifyCliError(`missing ${flag.slice(2)}`);
})();

const allowedOptions = {
  capture: new Set(["--event-json", "--root", "--json"]),
  save: new Set(["--id", "--root", "--json"]),
  review: new Set(["--id", "--state", "--root", "--json"]),
  query: new Set(["--text", "--budget", "--root"]),
  config: new Set(["--capture", "--root", "--json"]),
};

const assertOptions = (command, args) => {
  const allowed = allowedOptions[command];
  if (!allowed) throw new WikifyCliError(`Unknown wikify command: ${command ?? "(missing)"}`);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag)) throw new WikifyCliError(`unknown wikify option: ${flag}`);
    if (flag === "--json") continue;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new WikifyCliError(`${flag} requires a value`);
    index += 1;
  }
};

const parseEvent = (args) => {
  try {
    return JSON.parse(requireOption(args, "--event-json"));
  } catch (error) {
    if (error instanceof WikifyCliError) throw error;
    throw new WikifyCliError("invalid event JSON");
  }
};

const parseBudget = (args) => {
  const value = optionValue(args, "--budget");
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new WikifyCliError("budget must be an integer");
  return Number.parseInt(value, 10);
};

const execute = (root, command, args) => {
  switch (command) {
    case "capture":
      return captureKnowledgeEvent(root, parseEvent(args), { surface: "cli" });
    case "save":
      return reviewKnowledgeRecord(root, requireOption(args, "--id"), "accepted", { surface: "save" });
    case "review":
      return reviewKnowledgeRecord(root, requireOption(args, "--id"), requireOption(args, "--state"));
    case "query":
      return queryKnowledge(root, requireOption(args, "--text"), { budget: parseBudget(args) });
    case "config": {
      const value = requireOption(args, "--capture");
      if (!new Set(["on", "off"]).has(value)) throw new WikifyCliError("capture must be on or off");
      return writeCaptureSettings(root, value === "on");
    }
    default:
      throw new WikifyCliError(`Unknown wikify command: ${command ?? "(missing)"}`);
  }
};

const emitError = (io, error, command, outputJson) => {
  const status = Number.isInteger(error.status) ? error.status : 1;
  const message = error.message || "wikify knowledge runtime error";
  if (outputJson) {
    io.stdout.write(`${JSON.stringify({
      ok: false,
      status: "error",
      command: command ?? null,
      error: { name: error.name || "Error", message, exitCode: status },
    }, null, 2)}\n`);
  } else {
    io.stderr.write(`${message}\n`);
  }
  return status;
};

export const runWikifyKnowledgeCli = (
  argv,
  io = { stdout: process.stdout, stderr: process.stderr },
  defaultRoot = resolveProjectStateRoot(),
) => {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText);
    return command ? 0 : 64;
  }
  const outputJson = args.includes("--json");
  try {
    assertOptions(command, args);
    const root = resolve(optionValue(args, "--root") ?? defaultRoot);
    const result = execute(root, command, args);
    if (typeof result === "string") io.stdout.write(result);
    else io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof WikifyCliError || error instanceof WikifyKnowledgeError) {
      return emitError(io, error, command, outputJson);
    }
    return emitError(io, new WikifyCliError("wikify knowledge runtime error", 1), command, outputJson);
  }
};
