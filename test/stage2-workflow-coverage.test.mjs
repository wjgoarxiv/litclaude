import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const readSkill = (id) => readFileSync(`${root}/plugins/litclaude/skills/${id}/SKILL.md`, "utf8");

describe("bounded task workflow coverage", () => {
  it("keeps finite implementation tasks small while checking defect contracts", () => {
    const skill = readSkill("lit-loop");

    assert.match(skill, /finite-task fast lane/i);
    assert.match(skill, /for each defect[^\n]*one focused regression assertion/i);
    assert.match(skill, /success\s+and error status codes/i);
    assert.match(skill, /after the last behavior change[\s\S]*inspect every\s+named deliverable/i);
  });

  it("maps every multi-item UI brief to independently verified acceptance criteria", () => {
    const skill = readSkill("frontend-ui-ux");

    assert.match(skill, /prompt-to-implementation coverage/i);
    assert.match(skill, /every enumerated requirement/i);
    assert.match(skill, /component or behavior and a direct verification action/i);
    assert.match(skill, /recheck each requirement in the actual render and\s+interaction/i);
    assert.match(skill, /feature-first build order/i);
    assert.match(skill, /before\s+detailed visual\s+polish/i);
    assert.match(skill, /observable state change triggered by real scroll/i);
  });

  it("carries every material source fact into source-based deliverables", () => {
    const skill = readSkill("lit-humanizer");

    assert.match(skill, /source-based deliverables/i);
    assert.match(skill, /before drafting[^\n]*list each material fact/i);
    assert.match(skill, /source's own unit noun and denominator/i);
    assert.match(skill, /state a limitation or denial as its own sentence/i);
    assert.match(skill, /after drafting[\s\S]*check each listed fact against every deliverable/i);
  });

  it("keeps fixed-format research complete against a source-backed coverage matrix", () => {
    const skill = readSkill("litresearch");

    assert.match(skill, /exact-output fact research/i);
    assert.match(skill, /coverage matrix before drafting/i);
    assert.match(skill, /every\s+requested fact or subtopic/i);
    assert.match(skill, /each required search query to close a remaining matrix gap/i);
    assert.match(skill, /final artifact's exact line count[\s\S]*each statement has its required direct source link on the requested line/i);
    assert.match(skill, /transcribe the prompt's named categories as separate\s+checkboxes/i);
    assert.match(skill, /reserve output slots for every required\s+category/i);
    assert.match(skill, /before adding secondary or adjacent facts/i);
  });
});
