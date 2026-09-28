import assert from "node:assert/strict";

const NO_WORKFLOW_ACTIVATION = "LitClaude prompt hook checked: no workflow activation.";

export function assertNoWorkflowActivationContext(context, label = "hook context") {
  assert.ok(
    context === NO_WORKFLOW_ACTIVATION
      || context.startsWith(`${NO_WORKFLOW_ACTIVATION}\n\n## Project Instructions\n`),
    `${label} should keep the no-activation result ahead of any always-on project rules`,
  );
}
