import { resolveProjectStateRoot } from "./project-state-root.mjs";
import {
  cancelStartWork,
  completeStartWork,
  handleStartWorkPreToolUse,
  initializeStartWork,
  pauseStartWork,
  readStartWorkStatus,
  recordStartWorkProgress,
  StartWorkLifecycleError,
} from "./start-work-lifecycle.mjs";

const helpText = `Usage: litclaude-ai start-work <command> [...args]

Commands:
  init       Initialize schema-3 bounded-authority state for an approved plan.
  status     Read and reconcile the durable lifecycle state.
  progress   Record fenced-checkbox-safe top-level plan progress.
  pre-tool-use Classify one Claude PreToolUse JSON input against active authority.
  pause      Pause only at a new non-forbidden authority boundary.
  cancel     Cancel the active work as a terminal transition.
  complete   Complete active verified work; paused work cannot complete.

Resume is intentionally not a generic CLI mutation. A user must submit exactly:
  /litclaude:start-work resume --work-id <id> --revision <n> --boundary-id <id> --prompt-id <id> --grant-id <id>
Claude Code's UserPromptSubmit hook validates and applies that trusted grant.
`;

class StartWorkCliError extends Error {
  constructor(message, status = 64) {
    super(message);
    this.name = "StartWorkCliError";
    this.status = status;
  }
}

const values = (args, flag) => {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new StartWorkCliError(`${flag} requires a value`);
    output.push(value);
    index += 1;
  }
  return output;
};

const value = (args, flag) => values(args, flag).at(-1);
const required = (args, flag) => value(args, flag) ?? (() => { throw new StartWorkCliError(`missing ${flag.slice(2)}`); })();
const integer = (args, flag) => {
  const raw = required(args, flag);
  if (!/^\d+$/u.test(raw)) throw new StartWorkCliError(`invalid ${flag.slice(2)}`);
  return Number.parseInt(raw, 10);
};

const commonMutation = (args) => ({
  workId: required(args, "--work-id"),
  sessionId: required(args, "--session-id"),
  expectedRevision: integer(args, "--expected-revision"),
  idempotencyKey: required(args, "--idempotency-key"),
});

const optionsByCommand = {
  init: new Set(["--plan", "--work-id", "--session-id", "--worktree", "--authority-root", "--grant", "--idempotency-key", "--root", "--json"]),
  status: new Set(["--root", "--json"]),
  progress: new Set(["--work-id", "--session-id", "--expected-revision", "--idempotency-key", "--root", "--json"]),
  "pre-tool-use": new Set(["--input-json", "--root", "--json"]),
  pause: new Set(["--work-id", "--session-id", "--expected-revision", "--idempotency-key", "--action", "--target-root", "--root", "--json"]),
  cancel: new Set(["--work-id", "--session-id", "--expected-revision", "--idempotency-key", "--root", "--json"]),
  complete: new Set(["--work-id", "--session-id", "--expected-revision", "--idempotency-key", "--root", "--json"]),
};

const assertExactOptions = (command, args) => {
  if (command === "resume") return;
  const allowed = optionsByCommand[command];
  if (!allowed) return;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag)) throw new StartWorkCliError(`unknown start-work option: ${flag}`);
    if (flag === "--json") continue;
    const option = args[index + 1];
    if (!option || option.startsWith("--")) throw new StartWorkCliError(`${flag} requires a value`);
    index += 1;
  }
};

const execute = (root, command, args) => {
  switch (command) {
    case "init":
      return initializeStartWork(root, {
        plan: required(args, "--plan"),
        workId: required(args, "--work-id"),
        sessionId: required(args, "--session-id"),
        worktree: value(args, "--worktree") ?? null,
        authorityRoot: value(args, "--authority-root"),
        grants: values(args, "--grant"),
        idempotencyKey: required(args, "--idempotency-key"),
      });
    case "status":
      return readStartWorkStatus(root);
    case "progress":
      return recordStartWorkProgress(root, commonMutation(args));
    case "pre-tool-use": {
      let input;
      try {
        input = JSON.parse(required(args, "--input-json"));
      } catch {
        throw new StartWorkCliError("input-json must be valid JSON");
      }
      return handleStartWorkPreToolUse(root, input);
    }
    case "pause":
      return pauseStartWork(root, {
        ...commonMutation(args),
        action: required(args, "--action"),
        targetRoot: required(args, "--target-root"),
      });
    case "cancel":
      return cancelStartWork(root, commonMutation(args));
    case "complete":
      return completeStartWork(root, commonMutation(args));
    case "resume":
      throw new StartWorkCliError("resume requires the exact trusted explicit UserPromptSubmit route; no generic agent-callable resume bypass exists", 77);
    default:
      throw new StartWorkCliError(`Unknown start-work command: ${command ?? "(missing)"}`);
  }
};

const emitError = (io, error, command) => {
  const status = Number.isInteger(error.status) ? error.status : 1;
  io.stdout.write(`${JSON.stringify({
    ok: false,
    operation: command ?? null,
    error: {
      name: error.name || "StartWorkRuntimeError",
      message: error.message || "start-work runtime error",
      exitCode: status,
    },
  }, null, 2)}\n`);
  return status;
};

export const runStartWorkCli = (argv, io = { stdout: process.stdout, stderr: process.stderr }, defaultRoot = resolveProjectStateRoot()) => {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") {
    io.stdout.write(helpText);
    return command ? 0 : 64;
  }
  try {
    assertExactOptions(command, args);
    const root = resolveProjectStateRoot(value(args, "--root") ?? defaultRoot);
    const result = execute(root, command, args);
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof StartWorkCliError || error instanceof StartWorkLifecycleError) {
      return emitError(io, error, command);
    }
    return emitError(io, new StartWorkCliError("start-work runtime error", 1), command);
  }
};
