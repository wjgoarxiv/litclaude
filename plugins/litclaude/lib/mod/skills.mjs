// Which LitFamily skills fired in this session, for the chips row of the LIT card. The mod notes a
// firing from a Skill tool call, a skill prompt expansion (a typed `/litclaude:<name>` or the Skill
// tool) and a new ignition record from the prompt hook (bare `lit` routing); only LitClaude's own
// skills and commands become chips. Pure: the mod keeps the list, the card draws it.

// canonical-skill-catalog.mjs canonicalSkillIds, kept equal by a test; the catalog pulls in the
// resource manifest, which the mod has no reason to load.
export const LIT_SKILL_IDS = Object.freeze([
  "autoconference",
  "autoresearch",
  "browser-drive",
  "comment-checker",
  "debugging",
  "deep-interview",
  "frontend-ui-ux",
  "lit-adhd",
  "lit-brainstorm",
  "lit-burnoff",
  "lit-burnoff-file",
  "lit-code",
  "lit-commit",
  "lit-comprehend",
  "lit-crucible",
  "lit-diagram-drawer",
  "lit-docx",
  "lit-handoff",
  "lit-hijack",
  "lit-humanizer",
  "lit-init",
  "lit-loop",
  "lit-plan",
  "lit-pptx",
  "lit-recap",
  "lit-schematic",
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

const KNOWN = new Set(LIT_SKILL_IDS);
const PLUGIN_PREFIX = "litclaude:";
const KEEP = 12;
// A Skill call and the prompt expansion it causes arrive moments apart; they are one firing.
const SAME_FIRING_MS = 1500;

/** The chip id for a skill or command name, or null when it is not LitClaude's. */
export const litSkillId = (name) => {
  const raw = typeof name === "string" ? name.trim() : "";
  if (raw.startsWith(PLUGIN_PREFIX)) {
    const id = raw.slice(PLUGIN_PREFIX.length);
    return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(id) ? id : null;
  }
  return KNOWN.has(raw) ? raw : null;
};

/** Notes one firing at `at`: newest first, one entry per skill, a short history. */
export const noteSkill = (fired, id, at) => {
  const previous = fired.find((entry) => entry.id === id);
  if (previous && at >= previous.at && at - previous.at < SAME_FIRING_MS) return fired;
  return [{ id, at }, ...fired.filter((entry) => entry.id !== id)].slice(0, KEEP);
};

/**
 * Each chip's state: `current` when it fired after `settledAt` (the end of the last finished
 * request), `recent` otherwise. Current chips come first; each group keeps newest first.
 */
export const chipStates = (fired, settledAt) => {
  const ordered = [...fired].sort((a, b) => b.at - a.at);
  const current = ordered.filter(({ at }) => at > settledAt).map((entry) => ({ ...entry, state: "current" }));
  const recent = ordered.filter(({ at }) => at <= settledAt).map((entry) => ({ ...entry, state: "recent" }));
  return [...current, ...recent];
};
