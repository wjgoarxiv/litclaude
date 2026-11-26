import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestionCatalogLine } from "../../plugins/litclaude/lib/skill-plan.mjs";

const NO_WORKFLOW_ACTIVATION = "LitClaude prompt hook checked: no workflow activation.";
// An unrouted prompt that is not a typed slash command and fires no suggestion rule gets the compact catalog line.
export const SKILL_FIRST_NOTICE = suggestionCatalogLine();
// An unrouted prompt whose suggestion rules fired gets the candidate list plus "none" instead.
export const SUGGESTION_NOTICE = /^LitClaude prompt hook checked: no workflow activation\. Skill candidates the hook matched: [^\n]+; none\. Decide yes or no for each, then load the ones that fit with the Skill tool before reading files or running commands; if none fits, work without a skill\.$/u;

export function assertNoWorkflowActivationContext(context, label = "hook context") {
  const [notice] = context.split("\n\n## Project Instructions\n", 1);
  assert.ok(
    notice === NO_WORKFLOW_ACTIVATION || notice === SKILL_FIRST_NOTICE || SUGGESTION_NOTICE.test(notice),
    `${label} should keep the no-activation result ahead of any always-on project rules`,
  );
}

// A route context names its installed SKILL.md instead of inlining it. Return the text the model
// loads from that path, so a test can check what the route makes reachable.
export function pointedSkillBody(context, label = "hook context") {
  const match = /<litclaude-skill-body name="[a-z-]+">\s*Load this exact installed entrypoint "([^"]+\/SKILL\.md)"/u.exec(context);
  assert.ok(match, `${label} should name its installed SKILL.md`);
  return readFileSync(match[1], "utf8");
}
