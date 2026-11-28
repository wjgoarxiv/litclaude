import assert from "node:assert/strict";
import test from "node:test";

import { canRunParked } from "../plugins/litclaude/lib/parked-step.mjs";

test("canRunParked: a path grant and an unheld command can run; a held command cannot", () => {
  assert.equal(canRunParked({ kind: "command", hold_reason: "it expands a shell variable or substitution" }), false);
  assert.equal(canRunParked({ kind: "command" }), true);
  assert.equal(canRunParked({ kind: "command", tier: "X", command: "git tag v1" }), true);
  assert.equal(canRunParked({ action: "read", root: "/x" }), true);
  assert.equal(canRunParked(null), false);
  assert.equal(canRunParked(undefined), false);
});
