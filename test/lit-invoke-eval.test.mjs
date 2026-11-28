import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { heldoutDigest, litFixtureDir, loadSet, main, score, sealedDigest } from "../tools/routing-eval.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "plugins", "litclaude", "skills");
const KEYS = ["expect", "id", "lang", "near_miss_of", "prompt"];
const both = () => [...loadSet("dev", litFixtureDir), ...loadSet("heldout", litFixtureDir)];

const sink = () => {
  let text = "";
  return { write: (chunk) => { text += chunk; }, get text() { return text; } };
};

test("lit-invoke fixtures have the item schema and every prompt carries lit", () => {
  for (const item of both()) {
    assert.deepEqual(Object.keys(item).sort(), KEYS, `${item.id} keys`);
    assert.match(item.prompt, /(?:^|\s)lit(?:\s|$)/u, `${item.id} carries lit`);
    assert.ok(["en", "ko"].includes(item.lang), `${item.id} lang`);
    assert.ok(!item.expect.some((id) => item.near_miss_of.includes(id)), `${item.id} expect and near_miss_of overlap`);
    for (const id of [...item.expect, ...item.near_miss_of]) assert.ok(existsSync(join(SKILLS, id, "SKILL.md")), `${item.id} names a real skill: ${id}`);
  }
});

test("lit-invoke ids and prompts are unique and the halves are balanced", () => {
  const all = both();
  assert.equal(new Set(all.map(({ id }) => id)).size, all.length, "duplicate id");
  assert.equal(new Set(all.map(({ prompt }) => prompt.trim().toLowerCase())).size, all.length, "duplicate prompt");
  assert.ok(all.length >= 240, `at least 240 items, got ${all.length}`);
  assert.ok(all.filter((item) => item.lang === "ko").length * 2 >= all.length, "at least half Korean");
  const dev = loadSet("dev", litFixtureDir).length;
  assert.ok(Math.abs(dev * 2 - all.length) <= 4, "halves within two items of each other");
});

test("lit-invoke prompts hold no private paths or addresses", () => {
  for (const { id, prompt } of both()) {
    assert.doesNotMatch(prompt, /\/Users\/|\/home\/|[\w.+-]+@[\w-]+\.[\w.]+/u, `${id} has a private path or address`);
  }
});

test("lit-invoke held-out half is sealed and scores only while the seal matches", () => {
  assert.equal(heldoutDigest(litFixtureDir), sealedDigest(litFixtureDir));
  const out = sink();
  assert.equal(main(["--route", "--lit"], out, sink()), 0);
  assert.match(out.text, /lit dev: \d+ items/u);
  assert.match(out.text, /lit-loop first/u);
});

test("lit-invoke dev half keeps its floor: lit-loop leads every prompt, recall and near-miss false positives hold", () => {
  const { overall } = score(loadSet("dev", litFixtureDir));
  assert.equal(overall.litLoopFirst, 1);
  assert.ok(overall.recall >= 0.95, `dev recall ${overall.recall}`);
  assert.ok(overall.nearMissFpRate <= 0.05, `dev near-miss false positives ${overall.nearMissFpRate}`);
});
