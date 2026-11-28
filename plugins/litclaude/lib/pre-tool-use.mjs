// The PreToolUse decision (bin/litclaude-guard.js, and bin/litclaude-hook.js for a manual run). It runs
// before every file read and edit, so everything past the cheap questions is imported only when asked:
// a scanner on a managed PC inspects each module a process opens, and loading the whole hook for a call
// no run governs took it to the host's timeout. test/hook-hot-path.test.mjs counts the modules.
import { lstatSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkBackDenial, timerStartedTurn } from "./check-back-mark.mjs";
import { lifecycleRootFor } from "./lifecycle-root.mjs";
import { resolveProjectStateRoot } from "./project-state-root.mjs";
import { readerFacing } from "./reader-facing-path.mjs";
import { startWorkCannotApply } from "./start-work-peek.mjs";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));

// A session whose Bash cwd was deleted would otherwise have every tool denied by the
// fail-closed lifecycle check. Only a missing cwd moves to the project root; a cwd that
// exists, even a symlink or a file, keeps today's evaluation, and no existing root keeps
// the fail-closed deny.
const missingCwdFallback = async (input) => {
  let cwd;
  try {
    cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  } catch {
    cwd = undefined;
  }
  if (typeof cwd === "string" && lstatSync(resolve(cwd), { throwIfNoEntry: false }) !== undefined) return null;
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (typeof projectDir !== "string" || projectDir.length === 0) return null;
  if (statSync(resolve(projectDir), { throwIfNoEntry: false })?.isDirectory() !== true) return null;
  const { serializeUntrustedData } = await import("./mutated-file-paths.mjs");
  const inert = (value) => `untrusted inert filesystem data ${serializeUntrustedData(value)}`;
  return {
    input: { ...input, cwd: projectDir },
    advisory: `The working directory ${inert(cwd ?? "unknown")} no longer exists; LitClaude evaluated this tool call at the project root ${inert(projectDir)}. Run \`cd\` back to the project before continuing.`,
  };
};

// A Bash command that commits or rewrites history is the moment lit-commit exists for. Read-only
// inspection (status, diff, log without -S/-G) is deliberately excluded — it needs no guidance.
const gitHistoryCommand = /^\s*git\s+(?:commit|rebase|cherry-pick|reset|revert|bisect|blame|reflog|filter-branch|push|stash)\b/u;
const isGitHistoryCommand = (input) =>
  input?.tool_name === "Bash" && typeof input?.tool_input?.command === "string" && gitHistoryCommand.test(input.tool_input.command);

const toolInputOf = (input) => (input.tool_input && typeof input.tool_input === "object" ? input.tool_input : null);

// Whether the humanizer guard has anything to look at. A shape it would report as unreadable still
// goes to it, so its "check skipped" line is kept.
const mayHoldProse = (input) => {
  const tool = typeof input.tool_name === "string" ? input.tool_name.toLowerCase() : "";
  if (tool === "multiedit" || tool === "multi_edit") return true;
  if (tool !== "write" && tool !== "edit") return false;
  const fields = toolInputOf(input);
  const path = fields && [fields.file_path, fields.filePath, fields.path].find((value) => typeof value === "string" && value.length > 0);
  const text = tool === "write" ? fields?.content : fields?.new_string ?? fields?.newString;
  return !path || typeof text !== "string" || readerFacing(resolve(path));
};

// Only a piped or `;`-chained check is rewritten (lib/receipts.mjs names the same six commands).
const mayBePipedCheck = (input) => {
  const command = input.tool_name === "Bash" ? toolInputOf(input)?.command : null;
  return typeof command === "string" && /[|;]/u.test(command) && /npm|node|pytest|cargo|go/u.test(command);
};

const print = (output) => console.log(JSON.stringify(output));
const preToolUse = (fields) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", ...fields } });

// The host prints `PreToolUse:Bash hook error:` before a deny's reason; this says what follows is the guard working.
export const GUARD_LEAD = "Not a crash: LitClaude's start-work guard stopped this call on purpose, so it did not run.";

// A turn a check-back timer started only reports: everything but reading is denied.
const checkBackReason = (input) => {
  try {
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    if (!timerStartedTurn({ stateRoot: resolveProjectStateRoot(cwd), sessionId: input.session_id })) return null;
    return checkBackDenial(typeof input.tool_name === "string" ? input.tool_name : "this tool");
  } catch {
    // No readable mark: the ordinary checks decide.
    return null;
  }
};

const startWorkDecision = async (root, input) => {
  if (startWorkCannotApply(root, input.session_id)) return { decision: "allow-normal" };
  const { handleStartWorkPreToolUse } = await import("./start-work-lifecycle.mjs");
  return handleStartWorkPreToolUse(root, input);
};

const humanizerVerdict = async (input) => {
  if (!mayHoldProse(input)) return { context: "" };
  try {
    const { evaluateDeliverableHedgeGuard, formatDeliverableHedgeContext, formatHumanizerBlockReason } = await import("./deliverable-hedge-guard.mjs");
    const result = evaluateDeliverableHedgeGuard({ input, pluginRoot, projectDir: process.env.CLAUDE_PROJECT_DIR });
    if (result.status === "block") return { block: formatHumanizerBlockReason(result) };
    return { context: formatDeliverableHedgeContext(result) };
  } catch {
    return { context: "lit-humanizer check skipped; the write was allowed (guard could not complete)." };
  }
};

const decide = async (input) => {
  const fallback = await missingCwdFallback(input);
  const guardInput = fallback ? fallback.input : input;
  const fallbackContext = fallback ? { additionalContext: fallback.advisory } : {};
  const cwd = typeof guardInput.cwd === "string" ? guardInput.cwd : process.cwd();
  const root = lifecycleRootFor(cwd, guardInput.session_id);
  const decision = await startWorkDecision(root, guardInput);
  if (decision.decision === "deny") {
    // The opt-in park ping (plugin option park_ping): only a first park carries `parked`.
    let terminalSequence = null;
    if (decision.parked) {
      const { claimParkPing } = await import("./park-ping.mjs");
      terminalSequence = claimParkPing({ stateRoot: root, workId: decision.parked.workId, steps: [decision.parked] });
    }
    print({
      ...(terminalSequence ? { terminalSequence } : {}),
      ...preToolUse({ permissionDecision: "deny", permissionDecisionReason: `${GUARD_LEAD} ${decision.reason}`, ...fallbackContext }),
    });
    return;
  }
  // The LIT card's stage record: a workflow skill starts it, a review lane's reviewer marks its lane
  // running.
  if (["Skill", "Agent", "Task"].includes(guardInput.tool_name)) {
    try {
      const { observeWorkflowPreTool } = await import("./workflow-stage.mjs");
      observeWorkflowPreTool(cwd, guardInput);
    } catch {
      // The stage record only feeds the card; a failed write never changes the tool decision.
    }
  }
  const humanizer = await humanizerVerdict(guardInput);
  if (humanizer.block) {
    print(preToolUse({ permissionDecision: "deny", permissionDecisionReason: humanizer.block, ...fallbackContext }));
    return;
  }
  const contexts = [
    fallback?.advisory ?? "",
    decision.context ?? "",
    isGitHistoryCommand(input)
      ? "Skill(lit-commit): this is a commit or history operation. Read the ground truth before acting, keep unrelated dirty state intact, and never rewrite published history without explicit approval."
      : "",
    humanizer.context,
  ].filter(Boolean);
  // A piped or `;`-chained check records its own exit. No permissionDecision: the user's
  // normal permission prompt stays in place, and updatedInput only replaces the command.
  let rewrittenCommand = null;
  if (mayBePipedCheck(guardInput)) {
    const { planCheckRewrite } = await import("./receipts.mjs");
    rewrittenCommand = planCheckRewrite({
      cwd,
      sessionId: guardInput.session_id,
      command: guardInput.tool_input.command,
      runInBackground: guardInput.tool_input.run_in_background === true,
    });
  }
  if (contexts.length > 0 || rewrittenCommand) {
    print(preToolUse({
      ...(contexts.length > 0 ? { additionalContext: contexts.join("\n\n") } : {}),
      ...(rewrittenCommand ? { updatedInput: { ...guardInput.tool_input, command: rewrittenCommand } } : {}),
    }));
  }
};

/**
 * Answers one `pre-tool-use` event, or `check-back-guard`: the timer check alone, for the network and
 * schedule tools.
 */
export const runPreToolUse = async (eventName, input) => {
  const reason = checkBackReason(input);
  if (reason) {
    print(preToolUse({ permissionDecision: "deny", permissionDecisionReason: reason }));
    return;
  }
  if (eventName === "check-back-guard") return;
  try {
    await decide(input);
  } catch (error) {
    print(preToolUse({
      permissionDecision: "deny",
      permissionDecisionReason: `start-work authority check failed closed: ${error instanceof Error ? error.message : "unknown lifecycle error"}`,
    }));
  }
};
