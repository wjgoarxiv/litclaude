import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checklistUrl = new URL("../RELEASE_CHECKLIST.md", import.meta.url);

test("release checklist documents the current release candidate and blocks accidental future publication", async () => {
  const checklist = await readFile(checklistUrl, "utf8");

  assert.match(checklist, /@litfamily\/litclaude@1\.0\.18/u);
  assert.match(checklist, /lit-crucible/u);
  assert.match(checklist, /public-source\s+reader\s+runtime/i);
  assert.match(checklist, /5-lane review/i);
  assert.match(checklist, new RegExp("litgoal\\s+runtime", "i"));
  assert.match(checklist, /0\.1\.16/u);
  assert.match(checklist, /next publishable target/u);
  assert.match(checklist, /NO_UPDATE_NOTIFIER/u);
  assert.match(checklist, /SKILL_CATALOG_PASS/u);
  assert.match(checklist, /DOCTOR_FAIL/u);
  assert.match(checklist, /2,277-record/u);
  assert.match(checklist, /zero independent review receipts/iu);
  assert.match(checklist, /exactly two independent receipts/iu);
  assert.match(checklist, /1 MiB/u);
  assert.match(checklist, /4,096 lines/u);
  assert.match(checklist, /source-checkout-only/u);
  assert.doesNotMatch(checklist, /next `0\.1\.2` patch/u);
  assert.match(checklist, /explicit user approval/i);
  assert.match(checklist, /DO NOT publish a new version/i);
  assert.match(checklist, /npm publish/);
  assert.match(checklist, /marketplace/i);
});

test("release checklist gates v0.2.2 dynamic workflow hardening artifacts", async () => {
  const checklist = await readFile(checklistUrl, "utf8");

  for (const required of [
    /package\.json.*1\.0\.18/is,
    /plugin\.json.*1\.0\.18/is,
    /litclaude-mcp\.js.*1\.0\.18/is,
    /lit search/u,
    /lit query/u,
    /validator-first/i,
    /public-read/u,
    /public_source_read/u,
    /plugins\/litclaude\/commands\/lit-loop\.md/u,
    /node bin\/litclaude-ai\.js workflow-check --json/u,
    /subagentReliability/u,
    /commandHookAgreement/u,
    /node bin\/litclaude-ai\.js start-work-next --session-id <claude-session> --json/u,
    /context-pressure/u,
    /mutated-file/u,
    /plugins\/litclaude\/commands\/review-work\.md/u,
    new RegExp("plugins/litclaude/commands/litgoal\\.md", "u"),
    new RegExp("plugins/litclaude/lib/litgoal/", "u"),
    new RegExp("node bin/litclaude-ai\\.js litgoal --help", "u"),
    /--dry-run install --permission-mode balanced/u,
    /npm pack --dry-run --json/u,
    /v020-red-contracts\.txt/u,
  ]) {
    assert.match(checklist, required, `release checklist should include ${required}`);
  }

  assert.match(checklist, /explicit user approval/i);
  assert.match(checklist, /DO NOT publish a new version/i);
});

test("release checklist defines quiet public npm package gates", async () => {
  const checklist = await readFile(checklistUrl, "utf8");

  assert.match(checklist, /quiet public npm package/i);
  assert.match(checklist, /advertisement|promotion/i);
  assert.match(checklist, /public repo/i);
  assert.match(checklist, /npm whoami/i);
  assert.match(checklist, /npm publish --access public/i);
  assert.match(checklist, /package name/i);
  assert.match(checklist, /version/i);
  assert.match(checklist, /explicit user approval/i);
  assert.match(checklist, /same-name source checkout/i);
  assert.match(checklist, /fresh directory/i);
});
