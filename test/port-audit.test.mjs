import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function workflowAudit() {
  return readFileSync(join(root, "docs", "workflow-compatibility-audit.md"), "utf8");
}

test("workflow compatibility audit records every reference component class", () => {
  const audit = workflowAudit();
  const requiredTerms = [
    "prompt activation",
    "comment-checker",
    "lsp",
    "rules",
    "telemetry",
    "litgoal",
    "litwork",
    "agents",
    "mcp",
    "install metadata",
    "lit-burnoff-file",
    "lit-code/references",
    "lit-code/scripts",
    "debugging/references",
  ];

  for (const term of requiredTerms) {
    assert.match(audit, new RegExp(escapeRegExp(term), "u"), `missing audit term ${term}`);
  }
  assert.doesNotMatch(audit, new RegExp(`${"Lazy"}${"Codex"}`, "iu"));
});

test("workflow parity matrix maps reference workflow categories to LitClaude targets", () => {
  const audit = workflowAudit();
  const matrixStart = audit.indexOf("## Workflow Parity Matrix");
  assert.notEqual(matrixStart, -1, "missing Workflow Parity Matrix section");

  const matrixEnd = audit.indexOf("\n## ", matrixStart + 1);
  const matrix = audit.slice(matrixStart, matrixEnd === -1 ? undefined : matrixEnd);
  const requiredColumns = ["Reference workflow category", "LitClaude target", "Status", "Reason / acceptance signal"];
  for (const column of requiredColumns) {
    assert.match(matrix, new RegExp(escapeRegExp(column), "u"), `missing matrix column ${column}`);
  }

  const categoryContracts = [
    {
      category: "review-work 5-lane orchestration",
      terms: ["review-work", "5-lane", "scout", "skeptic", "implementer", "edge-case", "decision ledger"],
    },
    {
      category: "litgoal state/runtime",
      terms: ["litgoal", "state", "ledger", "checkpoint", "steering", "quality gate"],
    },
    {
      category: "LIT/start-work discipline",
      terms: ["lit-loop", "lit-plan", "start-work", "plan", "ledger", "verification"],
    },
    {
      category: "hook trigger safety",
      terms: ["hooks", "UserPromptSubmit", "near-miss", "prompt injection", "no auto-type"],
    },
    {
      category: "agent/command routing",
      terms: ["agents", "commands", "planner", "executor", "verifier", "reviewer"],
    },
    {
      category: "docs/package payload",
      terms: ["docs", "package payload", "manifest", "install", "package"],
    },
    {
      category: "excluded/deferred telemetry",
      terms: ["telemetry", "omitted", "deferred", "reason", "local"],
    },
  ];

  for (const contract of categoryContracts) {
    const rowPattern = new RegExp(`^\\|\\s*${escapeRegExp(contract.category)}\\s*\\|(?<row>.+)$`, "imu");
    const match = matrix.match(rowPattern);
    assert.ok(match?.groups?.row, `missing matrix row for ${contract.category}`);
    const rowText = match[0];
    const cellCount = rowText.split("|").length - 1;
    assert.ok(cellCount >= 5, `${contract.category} row must include all matrix columns`);
    assert.match(rowText, /\|\s*(Implemented|Deferred|Omitted|Partial)\s*\|/u, `${contract.category} row needs a concrete status`);
    for (const term of contract.terms) {
      assert.match(rowText, new RegExp(escapeRegExp(term), "iu"), `${contract.category} row missing ${term}`);
    }
  }
});
