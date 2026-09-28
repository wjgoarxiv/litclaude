#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const planPath = process.argv[2];

if (!planPath) {
  process.stderr.write("usage: audit-plan-checkboxes.mjs <plan.md>\n");
  process.exit(64);
}

const text = await readFile(planPath, "utf8");
const taskPattern = /^- \[[ x]\] (?:\d+\.|F\d\.) .+$/gm;
const tasks = [...text.matchAll(taskPattern)];

assert.ok(tasks.some((task) => /^- \[[ x]\] \d+\./.test(task[0])), "expected implementation task checkboxes");
assert.ok(tasks.some((task) => /^- \[[ x]\] F\d\./.test(task[0])), "expected final verification checkboxes");

for (let index = 0; index < tasks.length; index += 1) {
  const start = tasks[index].index;
  const end = tasks[index + 1]?.index ?? text.length;
  const block = text.slice(start, end);
  const title = tasks[index][0];

  if (/^- \[[ x]\] F\d\./.test(title)) {
    assert.match(block, /(?:Commands?|Tool):/, `${title} missing command or tool`);
    assert.match(block, /(?:Expected|Pass):/, `${title} missing expected result`);
  } else {
    assert.match(title, /^- \[x\]/, `${title} is not complete`);
    assert.match(block, /\*\*References\*\*:/, `${title} missing references`);
    assert.match(block, /\*\*Acceptance Criteria\*\*:/, `${title} missing acceptance criteria`);
    assert.match(block, /\*\*QA Scenarios\*\*:/, `${title} missing QA scenarios`);
    assert.match(block, /\*\*Commit\*\*:/, `${title} missing commit metadata`);
  }
}

process.stdout.write(`PLAN_AUDIT_PASS: ${tasks.length} checked items complete\n`);
