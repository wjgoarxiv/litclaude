import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const NO_WORKFLOW_ACTIVATION = "LitClaude prompt hook checked: no workflow activation.";
// An unrouted prompt that is not a typed slash command also points the model at the skill list.
export const SKILL_FIRST_NOTICE = `${NO_WORKFLOW_ACTIVATION} If this request asks for work that a listed litclaude skill covers, load that skill with the Skill tool before reading files or running commands; a question answered from knowledge needs no skill.`;

export function assertNoWorkflowActivationContext(context, label = "hook context") {
  const [notice] = context.split("\n\n## Project Instructions\n", 1);
  assert.ok(
    notice === NO_WORKFLOW_ACTIVATION || notice === SKILL_FIRST_NOTICE,
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
