import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { heldoutDigest, main, offeredSkills, sealedDigest } from "../tools/routing-eval.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test", "fixtures", "routing-eval");
const SKILLS = join(ROOT, "plugins", "litclaude", "skills");
const KEYS = ["expect", "id", "lang", "near_miss_of", "prompt"];

const load = (split) => JSON.parse(readFileSync(join(FIXTURES, `${split}.json`), "utf8"));
const isSkill = (id) => existsSync(join(SKILLS, id, "SKILL.md"));

const sink = () => {
  let text = "";
  return { write: (chunk) => { text += chunk; }, get text() { return text; } };
};

test("routing-eval fixtures parse and every item has the item schema", () => {
  for (const split of ["dev", "heldout"]) {
    const items = load(split);
    assert.ok(Array.isArray(items) && items.length > 0, `${split} is a non-empty array`);
    for (const item of items) {
      assert.deepEqual(Object.keys(item).sort(), KEYS, `${split} ${item.id} keys`);
      assert.equal(typeof item.prompt, "string");
      assert.ok(item.prompt.trim().length > 0, `${item.id} has a prompt`);
      assert.ok(["en", "ko"].includes(item.lang), `${item.id} lang`);
      assert.ok(Array.isArray(item.expect) && Array.isArray(item.near_miss_of), `${item.id} lists`);
      assert.ok(!item.expect.some((id) => item.near_miss_of.includes(id)), `${item.id} expect and near_miss_of overlap`);
    }
  }
});

test("routing-eval ids and prompts are unique across both halves", () => {
  const all = [...load("dev"), ...load("heldout")];
  const ids = all.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  const prompts = all.map(({ prompt }) => prompt.trim().toLowerCase());
  assert.equal(new Set(prompts).size, prompts.length, "duplicate prompt");
});

test("routing-eval names only real skill dirs", () => {
  for (const item of [...load("dev"), ...load("heldout")]) {
    for (const id of [...item.expect, ...item.near_miss_of]) assert.ok(isSkill(id), `${item.id} names unknown skill ${id}`);
  }
});

test("routing-eval prompts are plain: no standalone lit token", () => {
  for (const item of [...load("dev"), ...load("heldout")]) {
    assert.doesNotMatch(item.prompt, /(?:^|[^\w-])lit(?:work)?(?=$|[^\w-])/iu, `${item.id} carries lit`);
  }
});

test("routing-eval dev covers both languages and has at least 15 no-skill prompts", () => {
  const dev = load("dev");
  assert.ok(dev.some(({ lang }) => lang === "en") && dev.some(({ lang }) => lang === "ko"));
  assert.ok(dev.filter(({ expect }) => expect.length === 0).length >= 15);
});

test("routing-eval heldout hash matches the sealed digest", () => {
  assert.match(sealedDigest(), /^[0-9a-f]{64}$/u);
  assert.equal(heldoutDigest(), sealedDigest());
});

test("routing-eval --route scores dev, refuses no mode, and the model stub runs nothing", () => {
  const out = sink();
  assert.equal(main(["--route"], out, sink()), 0);
  assert.match(out.text, /overall recall/u);
  assert.doesNotMatch(out.text, /on heldout/u);
  assert.equal(main([], sink(), sink()), 64);
  const model = sink();
  assert.equal(main(["--model"], model, sink()), 0);
  assert.match(model.text, /planned \d+ Claude Code sessions/u);
  assert.match(model.text, /Nothing run/u);
});

test("routing-eval offers what the hook router picks", () => {
  assert.deepEqual(offeredSkills("build a landing page for my product"), ["frontend-ui-ux"]);
  assert.deepEqual(offeredSkills("fix this failing test"), []);
});

test("routing-eval scores the no-lit suggestion tier: every fired rule, no cap", () => {
  assert.deepEqual(offeredSkills("이 csv로 그래프 그려줘"), ["lit-scientific-visualization"]);
  // Rules that failed the held-out gate (schematic, the vague-prompt detector and others) offer nothing.
  assert.deepEqual(offeredSkills("P&ID 그려줘"), []);
  assert.deepEqual(offeredSkills("뭘 만들지 잘 모르겠어"), []);
  assert.deepEqual(offeredSkills("draw an architecture diagram of our services and make a kinetic typography video of the launch quote"), ["lit-typographic-motion", "lit-diagram-drawer"]);
  assert.deepEqual(offeredSkills("lit 이 csv로 그래프 그려줘").includes("lit-scientific-visualization"), true);
});
