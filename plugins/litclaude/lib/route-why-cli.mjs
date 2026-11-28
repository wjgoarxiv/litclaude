// `litclaude-ai why "<prompt>"`: which workflow a prompt routes to and why, as one short block. The
// prompt is shown only as its first 80 characters, with control characters blanked.
import { explainRoute, findWorkflowTrigger, hasLitTrigger, litPlanCompanions, normalizedTriggerText, rawTriggerText } from "./route-match.mjs";
import { buildSkillPlan, parseSkillHatch } from "./skill-plan.mjs";

// The bare-lit skill plan the prompt hook would build, before it checks what is installed.
const planOf = (prompt) => {
  if (parseSkillHatch(rawTriggerText(prompt), prompt)) return null;
  const trigger = findWorkflowTrigger(prompt);
  if (!trigger || trigger.source !== "natural-language" || trigger.safetyBlock || !hasLitTrigger(rawTriggerText(prompt))) return null;
  const normalized = normalizedTriggerText(prompt);
  return buildSkillPlan({ primary: trigger.skillId, ...litPlanCompanions(normalized, trigger.skillId), normalized, loopBase: true });
};

const USAGE = 'Usage: litclaude-ai why "<prompt>"\n';
const SHOWN_CHARS = 80;

const preview = (prompt) => {
  const chars = Array.from(prompt);
  const shown = chars.slice(0, SHOWN_CHARS).join("").replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ");
  return chars.length > SHOWN_CHARS ? `${shown}…` : shown;
};

export const runWhyCli = (args, out = process.stdout, err = process.stderr) => {
  if (args[0] === "--help" || args[0] === "-h") {
    out.write(USAGE);
    return 0;
  }
  const prompt = args.join(" ");
  if (prompt.trim() === "") {
    err.write(USAGE);
    return 64;
  }
  const { route, ruleId, runnerUp, inert } = explainRoute(prompt);
  const plan = planOf(prompt);
  out.write(`${[
    `prompt  ${preview(prompt)}`,
    `route   ${route ?? "none"}`,
    `rule    ${ruleId ?? "none"}`,
    `runner  ${runnerUp ? `${runnerUp.route} (${runnerUp.ruleId})` : "none"}`,
    `inert   ${inert ? "yes" : "no"}`,
    `plan    ${plan ? plan.entries.map(({ id }) => id).join(" → ") : "none"}`,
    `cut     ${plan && plan.dropped.length ? plan.dropped.map(({ id, why }) => `${id} (${why})`).join("; ") : "none"}`,
  ].join("\n")}\n`);
  return 0;
};
