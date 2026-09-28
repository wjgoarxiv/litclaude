// One-release compatibility routes; remove with the next minor release.
export const skillRenameAliases = Object.freeze({
  hyperplan: "lit-crucible",
  "init-deep": "lit-init",
  "git-master": "lit-commit",
  teammode: "lit-team",
  "remove-ai-slops": "lit-burnoff",
  "ai-slop-remover": "lit-burnoff-file",
  "korean-ai-slop-remover": "lit-humanizer",
  "lit-korean": "lit-humanizer",
  "text-naturalization": "lit-humanizer",
  programming: "lit-code",
});

export const agentRenameAliases = Object.freeze({
  "prometheus-planner": "lit-planner",
  "boulder-executor": "lit-executor",
  "oracle-verifier": "lit-verifier",
});

export const renameAliases = Object.freeze({
  ...skillRenameAliases,
  ...agentRenameAliases,
  "dynamic-workflow": "lit-loop",
});

export const renameNote = (oldId) =>
  `Note: \`${oldId}\` was renamed to \`${renameAliases[oldId]}\`; the old name is removed in the next minor.`;
