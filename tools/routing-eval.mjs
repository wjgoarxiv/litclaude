#!/usr/bin/env node
// Trigger eval for LitClaude skill routing. Each fixture item is a plain prompt (no `lit`) with the skills
// that SHOULD be offered (`expect`) and the skills that must NOT be (`near_miss_of`).
//
//   node tools/routing-eval.mjs --route [--heldout] [--json <file>]
//   node tools/routing-eval.mjs --model [--heldout] [--yes]
//
// --route scores the hook's own router with no model: the route `findWorkflowTrigger` picks, the skill plan
// companions the hook adds for a bare-lit natural-language prompt, and the no-`lit` suggestion tier
// (`suggestedSkills`), exactly as bin/litclaude-hook.js does.
// --model is a stub: it prints the planned session count and stops; with --yes it still runs nothing yet.
// The held-out half is sealed: it is scored only with --heldout, and only while its sha256 matches.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { explainRoute, findWorkflowTrigger, hasLitTrigger, isExactBareHandoff, naturalLitCompanions, normalizedTriggerText, rawTriggerText, suggestedSkills } from "../plugins/litclaude/lib/route-match.mjs";
import { buildSkillPlan, skillPlanIds } from "../plugins/litclaude/lib/skill-plan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test", "fixtures", "routing-eval");
const USAGE = "Usage: node tools/routing-eval.mjs --route|--model [--heldout] [--json <file>] [--yes]\n";

export const heldoutDigest = () => createHash("sha256").update(readFileSync(join(FIXTURES, "heldout.json"))).digest("hex");
export const sealedDigest = () => readFileSync(join(FIXTURES, "heldout.sha256"), "utf8").trim().split(/\s+/u)[0];

export const loadSet = (split) => JSON.parse(readFileSync(join(FIXTURES, `${split}.json`), "utf8"));

/** The skill ids the hook would offer for this prompt, primary first. */
export const offeredSkills = (prompt) => {
  if (isExactBareHandoff(prompt)) return ["lit-handoff"];
  const trigger = findWorkflowTrigger(prompt);
  const lit = hasLitTrigger(rawTriggerText(prompt));
  // A prompt without `lit` that no named route took (or only a token-free route took) gets the suggestion
  // tier as well: every skill whose rule fires, exactly the list bin/litclaude-hook.js offers.
  if (!lit && (!trigger || trigger.source === "natural-language")) return [...new Set([...(trigger?.skillId ? [trigger.skillId] : []), ...suggestedSkills(prompt)])];
  if (!trigger?.skillId) return [];
  if (!lit || trigger.source !== "natural-language") return [trigger.skillId];
  const normalized = normalizedTriggerText(prompt);
  const plan = buildSkillPlan({ primary: trigger.skillId, companions: naturalLitCompanions(normalized), normalized });
  return plan ? skillPlanIds(plan) : [trigger.skillId];
};

const ratio = (num, den) => (den === 0 ? null : Number((num / den).toFixed(3)));

export const score = (items, offer = offeredSkills) => {
  const perSkill = new Map();
  const stat = (id) => {
    if (!perSkill.has(id)) perSkill.set(id, { should: 0, hit: 0, nearMiss: 0, falsePositive: 0 });
    return perSkill.get(id);
  };
  const results = [];
  let noneItems = 0;
  let noneOffered = 0;
  let routedItems = 0;
  let exact = 0;
  for (const item of items) {
    const offered = offer(item.prompt);
    const got = new Set(offered);
    for (const id of item.expect) {
      const s = stat(id);
      s.should += 1;
      if (got.has(id)) s.hit += 1;
    }
    for (const id of item.near_miss_of) {
      const s = stat(id);
      s.nearMiss += 1;
      if (got.has(id)) s.falsePositive += 1;
    }
    if (item.expect.length === 0) {
      noneItems += 1;
      if (offered.length > 0) noneOffered += 1;
    }
    if (offered.length > 0) routedItems += 1;
    if (offered.length === item.expect.length && item.expect.every((id) => got.has(id))) exact += 1;
    const { ruleId } = explainRoute(item.prompt);
    results.push({ id: item.id, lang: item.lang, expect: item.expect, near_miss_of: item.near_miss_of, offered, ruleId });
  }
  const skills = Object.fromEntries([...perSkill.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, s]) => [id, { ...s, recall: ratio(s.hit, s.should), nearMissFpRate: ratio(s.falsePositive, s.nearMiss) }]));
  const sum = (key) => Object.values(skills).reduce((total, s) => total + s[key], 0);
  const withExpect = items.filter((item) => item.expect.length > 0).length;
  const overall = {
    items: items.length,
    itemsWithExpect: withExpect,
    noneItems,
    routedItems,
    unroutedWithExpect: results.filter((r) => r.expect.length > 0 && r.offered.length === 0).length,
    recall: ratio(sum("hit"), sum("should")),
    nearMissFpRate: ratio(sum("falsePositive"), sum("nearMiss")),
    noneFpRate: ratio(noneOffered, noneItems),
    exactSetRate: ratio(exact, items.length),
  };
  return { overall, skills, results };
};

const pct = (value) => (value === null ? "   -  " : `${(value * 100).toFixed(1).padStart(5)}%`);

const printReport = (split, { overall, skills }, out) => {
  out.write(`routing-eval --route on ${split}: ${overall.items} items (${overall.itemsWithExpect} with expect, ${overall.noneItems} expect none)\n`);
  out.write(`${"skill".padEnd(30)} ${"recall".padStart(7)} ${"hit/n".padStart(7)} ${"nm-FP".padStart(7)} ${"fp/n".padStart(7)}\n`);
  for (const [id, s] of Object.entries(skills)) {
    out.write(`${id.padEnd(30)} ${pct(s.recall).padStart(7)} ${`${s.hit}/${s.should}`.padStart(7)} ${pct(s.nearMissFpRate).padStart(7)} ${`${s.falsePositive}/${s.nearMiss}`.padStart(7)}\n`);
  }
  out.write(`overall recall ${pct(overall.recall)}  near-miss FP ${pct(overall.nearMissFpRate)}  none FP ${pct(overall.noneFpRate)}  exact set ${pct(overall.exactSetRate)}\n`);
  out.write(`unrouted: ${overall.unroutedWithExpect} of ${overall.itemsWithExpect} prompts that expect a skill got no route; ${overall.routedItems} of ${overall.items} prompts routed at all\n`);
};

export const main = (argv, out = process.stdout, err = process.stderr) => {
  const args = new Set(argv);
  const jsonAt = argv.indexOf("--json");
  const jsonPath = jsonAt >= 0 ? argv[jsonAt + 1] : null;
  if (args.has("--help") || (!args.has("--route") && !args.has("--model")) || (jsonAt >= 0 && !jsonPath)) {
    (args.has("--help") ? out : err).write(USAGE);
    return args.has("--help") ? 0 : 64;
  }
  const split = args.has("--heldout") ? "heldout" : "dev";
  if (split === "heldout" && heldoutDigest() !== sealedDigest()) {
    err.write("routing-eval: heldout.json does not match heldout.sha256; the sealed half was edited. Refusing to score it.\n");
    return 65;
  }
  const items = loadSet(split);
  if (args.has("--model")) {
    out.write(`routing-eval --model on ${split}: planned ${items.length} Claude Code sessions (one throwaway-home session per prompt, no lit token, scored by which Skill() calls fire).\n`);
    if (!args.has("--yes")) {
      out.write("Nothing run. Pass --yes to confirm the budget.\n");
      return 0;
    }
    err.write("routing-eval: --model execution is not implemented yet; no session was started.\n");
    return 2;
  }
  const report = score(items);
  printReport(split, report, out);
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify({ split, mode: "route", ...report }, null, 2)}\n`);
    out.write(`wrote ${jsonPath}\n`);
  }
  return 0;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
