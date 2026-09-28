import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseRules, scanText } from "../plugins/litclaude/skills/lit-humanizer/scripts/core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(root, "plugins", "litclaude", "skills", "lit-humanizer");
const fixtureRoot = join(root, "test", "fixtures", "lit-humanizer");
const rules = parseRules(readFileSync(join(skillRoot, "rules.json"), "utf8"));
const cases = JSON.parse(readFileSync(join(fixtureRoot, "rule-cases.json"), "utf8"));
const negativeExamples = JSON.parse(readFileSync(join(fixtureRoot, "negative-examples.json"), "utf8"));

describe("lit-humanizer canonical detector", () => {
  it("keeps all 51 rule ids, tiers, and positive/negative decisions", () => {
    assert.equal(rules.length, 51);
    assert.equal(rules.filter((rule) => rule.severity === "block").length, 24);
    assert.equal(rules.filter((rule) => rule.severity === "warn").length, 27);
    for (const rule of rules) {
      assert.ok(rule.fixture_ids.includes(`${rule.id}:positive`));
      assert.ok(rule.fixture_ids.includes(`${rule.id}:negative`));
      const positive = scanText(cases.positive[rule.id], [rule], `${rule.id}-positive.txt`);
      const negative = scanText(cases.negative[rule.id], [rule], `${rule.id}-negative.txt`);
      assert.ok(positive.some((hit) => hit.severity === rule.severity), `${rule.id} positive`);
      assert.deepEqual(negative, [], `${rule.id} negative`);
    }
  });

  it("preserves quote, code, caption, language, and tier exceptions", () => {
    const plainSource = rules.find((rule) => rule.id === "en-plain-meta-label");
    assert.equal(scanText("> Source: quoted wording\n", [plainSource], "quote.md").length, 0);
    assert.equal(scanText("```text\nSource: sample\n```\n", [plainSource], "fence.md").length, 0);
    assert.equal(scanText("Figure 3. Results\nSource: dataset\n", [plainSource], "caption.md").length, 0);
    assert.equal(scanText("Figure 3. Results\n```text\ncaption\n```\nSource: note\n", [plainSource], "fence-caption.md").length, 1);
    for (const fixture of cases.contextCases.plainSourceAttached) {
      const hits = scanText(fixture.text, rules.filter((rule) => ["ko-plain-meta-label", "en-plain-meta-label"].includes(rule.id)), `${fixture.name}.md`);
      assert.equal(hits.length === 0, fixture.clean, fixture.name);
    }
    for (const fixture of cases.contextCases.tierRegressions) {
      const rule = rules.find((item) => item.id === fixture.rule);
      const hits = scanText(fixture.text, [rule], `${fixture.name}.txt`);
      assert.equal(hits.some((hit) => hit.severity === fixture.expect), fixture.expect !== "clean", fixture.name);
    }
    const softWrap = scanText("The proposal is robust,\nintuitive, and scalable.", [rules.find((rule) => rule.id === "en-forced-triad")], "wrap.md");
    assert.equal(softWrap[0]?.line, 1);
  });

  it("keeps the real-positive recall floor and has no block hits in negative corpora", () => {
    const positives = readFileSync(join(fixtureRoot, "pos-real.txt"), "utf8").split(/\r?\n/u).filter(Boolean);
    const blockRules = rules.filter((rule) => rule.severity === "block");
    const warnRules = rules.filter((rule) => rule.severity === "warn");
    const recalled = positives.filter((line, index) => scanText(line, [...blockRules, ...warnRules], `positive-${index + 1}.txt`).length > 0).length;
    assert.ok(recalled >= 19, `combined recall ${recalled}/${positives.length}`);

    assert.equal(negativeExamples.length, 7, "keep a compact set of hand-written public prose negatives");
    for (const example of negativeExamples) {
      const hits = scanText(example.text, [...blockRules, ...warnRules], `${example.name}.md`);
      assert.deepEqual(hits.filter((hit) => hit.severity === "block"), [], example.name);
    }
  });

  it("does not scan internal paths and extracts DOCX/PPTX with the standard-library adapter", () => {
    const blockRule = rules.find((rule) => rule.id === "en-bold-deliverable-label");
    assert.deepEqual(scanText("**Evidence:** private", [blockRule], ".litclaude/evidence/report.md"), []);
    assert.deepEqual(scanText("**Evidence:** private", [blockRule], ".hermes/state/README.md"), []);
    const extractor = join(skillRoot, "scripts", "extract_office_text.py");
    for (const [name, expected] of [["minimal.docx", "I hope this helps."], ["minimal.pptx", "Source: report table 4."]]) {
      const path = join(fixtureRoot, "office", name);
      const extracted = spawnSync("python3", [extractor, path], { encoding: "utf8", timeout: 5000 });
      assert.equal(extracted.status, 0, extracted.stderr);
      assert.equal(extracted.stdout.trim(), expected);
    }
  });
});
