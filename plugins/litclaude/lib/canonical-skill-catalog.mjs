import { canonicalSkillResourceManifest } from "./canonical-skill-resources.mjs";

export const canonicalSkillIds = Object.freeze([
  "autoconference",
  "autoresearch",
  "browser-drive",
  "comment-checker",
  "debugging",
  "deep-interview",
  "frontend-ui-ux",
  "lit-burnoff",
  "lit-burnoff-file",
  "lit-code",
  "lit-commit",
  "lit-comprehend",
  "lit-crucible",
  "lit-diagram-drawer",
  "lit-docx",
  "lit-handoff",
  "lit-humanizer",
  "lit-init",
  "lit-loop",
  "lit-plan",
  "lit-pptx",
  "lit-recap",
  "lit-scientific-visualization",
  "lit-team",
  "lit-typographic-motion",
  "litgoal",
  "litresearch",
  "litwork",
  "lsp",
  "lsp-setup",
  "readme-studio",
  "refactor",
  "review-work",
  "rules",
  "start-work",
  "structural-search",
  "visual-qa",
  "wikify",
]);

export const canonicalSkillFiles = Object.freeze(
  canonicalSkillIds.map((skillId) => `skills/${skillId}/SKILL.md`),
);

export { canonicalSkillResourceManifest };

export const canonicalSkillResourceFiles = Object.freeze([
  ...new Set([...canonicalSkillFiles, ...canonicalSkillResourceManifest.keys()]),
]);
