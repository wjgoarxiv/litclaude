const MAX_OBJECTIVE_CHARS = 180;

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/gu,
  /(?:api[_-]?key|token|secret|password)\s*=\s*\S+/giu,
];

const unsafeCommandPatterns = [
  /\b(?:rm|rmdir)\s+-r(?:f)?\b[^;&|\n]*/giu,
  /\b(?:sudo|eval|exec)\b[^;&|\n]*/giu,
  /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b[^;&|\n]*/giu,
  /\bgit\s+(?:push|reset|clean)\b[^;&|\n]*/giu,
];

const normalizeSpaces = (value) => value.replace(/\s+/gu, " ").trim();

export const normalizeGoalObjective = (value) => {
  if (typeof value !== "string") return "";
  const cleaned = value
    .split(/\r?\n/gu)
    .filter((line) => !line.trimStart().startsWith("/"))
    .join(" ");
  const redacted = secretPatterns.reduce(
    (text, pattern) => text.replace(pattern, "[REDACTED]"),
    cleaned,
  );
  const safe = unsafeCommandPatterns.reduce(
    (text, pattern) => text.replace(pattern, "[UNSAFE_COMMAND_REDACTED]"),
    redacted,
  );
  return normalizeSpaces(safe).slice(0, MAX_OBJECTIVE_CHARS).trim();
};

const canonical = (value) => normalizeGoalObjective(value).toLowerCase();

const activeGoalObjective = (activeGoal) => {
  if (!activeGoal || typeof activeGoal !== "object") return "";
  return normalizeGoalObjective(activeGoal.objective ?? activeGoal.goal ?? activeGoal.text ?? "");
};

const readyToPasteCondition = (objective) =>
  `Continue until this LitClaude objective is complete: ${objective}. Stop only after required evidence is recorded and no unresolved blocker remains.`;

const readyToPasteGuidance = (objective) => {
  const condition = readyToPasteCondition(objective);
  const command = `/goal ${condition}`;
  return {
    nextAction: "ready-to-paste",
    condition,
    command,
    message: [
      "Native goal binding attempt: BLOCKED: native `/goal` not programmatically bound.",
      "READY_TO_PASTE: LitClaude cannot enter or send a command to the current Claude Code session.",
      "Copy, paste, and send this line in the current Claude Code session:",
      command,
      "After sending it, keep the durable `litgoal` ledger authoritative for criteria, evidence, checkpoints, and blockers.",
      "Separate non-interactive fallback: run `claude -p \"/goal <completion condition>\"` in a new session.",
    ].join("\n"),
  };
};

export const buildNativeGoalBindingGuidance = ({ objective, activeGoal } = {}) => {
  const normalizedObjective = normalizeGoalObjective(objective);
  const activeObjective = activeGoalObjective(activeGoal);
  const activeStatus = typeof activeGoal?.status === "string" ? activeGoal.status.toLowerCase() : "";

  if (!normalizedObjective) {
    return {
      status: "blocked-missing-objective",
      message: "Native goal binding attempt: BLOCKED: missing objective. Provide one outcome-shaped objective with checkable evidence; keep the durable `litgoal` ledger authoritative until Claude Code exposes a supported programmatic goal surface.",
    };
  }

  if (activeObjective && (!activeStatus || activeStatus === "active") && canonical(activeObjective) !== canonical(normalizedObjective)) {
    return {
      status: "blocked-conflict",
      message: `Native goal binding attempt: BLOCKED: active native goal differs (${activeObjective}). LitClaude will not clobber it without explicit replacement; use Claude Code's user-visible /goal replacement flow or provide explicit replacement approval. Keep the durable \`litgoal\` ledger authoritative meanwhile.`,
    };
  }

  const ready = readyToPasteGuidance(normalizedObjective);
  return {
    status: "blocked-unavailable",
    ...ready,
    message: `${ready.message}\nEvidence: the supported UserPromptSubmit hook surface can add context or block, but does not expose a run-slash-command channel; this session exposes no callable get_goal/create_goal/update_goal tools to LitClaude.`,
  };
};
