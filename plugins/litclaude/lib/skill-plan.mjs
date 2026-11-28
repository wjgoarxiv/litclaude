// The skill plan of a bare-lit prompt (S1). The prompt hook's cascade still picks ONE primary route, first
// match wins, exactly as before. This module adds the companions: every other content route the same prompt
// matched, in the cascade's priority order, deduplicated and capped, plus lit-crucible when the ask is a large
// or risky design. The model confirms or drops each companion against a short catalog of the skills that are
// installed here and states the final plan before it works. `lit +viz +ui <task>` names the plan outright.
//
// An extension skill (the ten on the wjgoarxiv-skills marketplace) is offered under its plugin's
// name only when that plugin is installed for this project; otherwise the plan names it once with its install
// line. Read-only primaries (lit-adhd, review-work, litresearch, the brainstorms) never gain a companion that
// can write. Pure apart from `installedExtensionPlugins`, which reads Claude Code's own plugin records.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { EXTENSION_SKILLS } from "./extensions-notice.mjs";

// No fixed cap on a matched plan: every skill whose detector fired joins it. Two backstops remain, and each
// cut is listed in the plan block with its reason: at most PLAN_BACKSTOP companions, and a block over
// PLAN_CONTEXT_BYTES drops its catalog first. A `lit +…` plan the user typed keeps its own limit.
export const PLAN_BACKSTOP = 8;
export const PLAN_CONTEXT_BYTES = 3000;
const FORCED_CAP = 3;

// Pairs that never both join: when the first is in the plan, the second leaves with the reason given.
export const PLAN_VETOES = Object.freeze([
  ["lit-schematic", "lit-diagram-drawer", "the drawing is a physical schematic"],
]);

// `lit +<alias>` names. Short words a user can type without looking anything up.
export const SKILL_ALIASES = Object.freeze({
  viz: "lit-scientific-visualization",
  plot: "lit-scientific-visualization",
  ui: "frontend-ui-ux",
  design: "frontend-ui-ux",
  qa: "visual-qa",
  crucible: "lit-crucible",
  plan: "lit-plan",
  research: "litresearch",
  review: "review-work",
  debug: "debugging",
  deck: "lit-pptx",
  slides: "lit-pptx",
  pptx: "lit-pptx",
  doc: "lit-docx",
  docx: "lit-docx",
  xlsx: "lit-xlsx",
  excel: "lit-xlsx",
  diagram: "lit-diagram-drawer",
  schematic: "lit-schematic",
  motion: "lit-typographic-motion",
  video: "lit-typographic-motion",
  readme: "readme-studio",
  ast: "structural-search",
  refactor: "refactor",
  brainstorm: "lit-brainstorm",
  ultra: "ultra-brainstorm",
  humanize: "lit-humanizer",
  commit: "lit-commit",
});

// Routes that only read. A plan led by one of these keeps only companions from this set.
export const READ_ONLY_SKILLS = Object.freeze(new Set(["lit-adhd", "lit-rewind", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm", "lit-crucible"]));
const READ_ONLY_PRIMARIES = new Set(["lit-adhd", "lit-rewind", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm"]);

// Skills the model cannot load (disable-model-invocation); the user types them. The figures copy of
// lit-scientific-visualization is model-invocable, so it is offered like any other extra.
const USER_INVOKED = new Set([]);

// One "use when" line per skill the catalog may offer. Extension skills appear only when installed.
export const CATALOG = Object.freeze({
  "lit-plan": "a decision-complete plan before code",
  "lit-crucible": "pressure-test a large or risky design before planning",
  "lit-brainstorm": "options for an open question, scored to a short list",
  "ultra-brainstorm": "hundreds of cheap idea agents, then a judged top list",
  litresearch: "prior work and primary sources, with references",
  "review-work": "findings-first review of a diff or branch",
  debugging: "reproduce, localize and fix a failure",
  refactor: "behaviour-preserving restructure",
  "structural-search": "syntax-shaped search or codemod",
  "lit-humanizer": "rewrite prose in the writer's own voice",
  "lit-commit": "commits and git history work",
  "browser-drive": "act in a real browser page",
  "lit-pptx": "a finished .pptx deck",
  "lit-docx": "a finished .docx document",
  "lit-xlsx": "a finished .xlsx workbook with live formulas",
  "lit-diagram-drawer": "a conceptual diagram (architecture, flow, timeline)",
  "lit-schematic": "a physical schematic (P&ID, PFD, apparatus, cutaway)",
  "lit-scientific-visualization": "a publication figure of measured data",
  "frontend-ui-ux": "build or restyle an interface",
  "visual-qa": "check a built interface at several sizes",
  "lit-typographic-motion": "a short kinetic-type film or README cover loop",
  "readme-studio": "a factual README with an inspected cover",
});

const realpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const appliesHere = (entry, cwd) => {
  if (!entry || typeof entry !== "object") return false;
  if (entry.scope === "user" || !entry.projectPath) return true;
  const project = realpath(entry.projectPath);
  const here = realpath(cwd);
  return Boolean(project && here && (here === project || here.startsWith(`${project}${sep}`)));
};

const present = (path) => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The wjgoarxiv-skills plugins Claude Code has installed and not disabled for `cwd`, from its own
 * `plugins/installed_plugins.json` and `settings.json` records. Any unreadable record reads as none.
 */
export const installedExtensionPlugins = ({ configDir, cwd }) => {
  const root = configDir || join(homedir(), ".claude");
  const registry = readJson(join(root, "plugins", "installed_plugins.json"))?.plugins ?? {};
  const enabled = readJson(join(root, "settings.json"))?.enabledPlugins ?? {};
  const found = new Set();
  for (const plugin of new Set(Object.values(EXTENSION_SKILLS))) {
    const key = `${plugin}@wjgoarxiv-skills`;
    if (enabled[key] === false) continue;
    const entries = Array.isArray(registry[key]) ? registry[key] : [];
    if (entries.some((entry) => appliesHere(entry, cwd) && (typeof entry.installPath !== "string" || present(entry.installPath)))) found.add(plugin);
  }
  return found;
};

const HATCH = /(?:^|\s)lit(?:work)?((?:\s+\+[a-z][a-z-]{0,30})+)(?=\s|$)/u;

/** `lit +viz +ui <task>`: the forced skills in the user's order, unknown names, and the prompt without them. */
export const parseSkillHatch = (text, prompt = text) => {
  const match = HATCH.exec(typeof text === "string" ? text : "");
  if (!match) return null;
  const names = match[1].trim().split(/\s+/u).map((token) => token.slice(1));
  const skills = [];
  const unknown = [];
  for (const name of names) {
    const id = SKILL_ALIASES[name] ?? (Object.hasOwn(CATALOG, name) ? name : null);
    if (!id) unknown.push(name);
    else if (!skills.includes(id)) skills.push(id);
  }
  const rest = typeof prompt === "string" ? prompt.replace(/((?:^|\s)lit(?:work)?)(?:\s+\+[A-Za-z][A-Za-z-]{0,30})+(?=\s|$)/u, "$1") : prompt;
  return { skills: skills.slice(0, FORCED_CAP), extra: skills.slice(FORCED_CAP), unknown, rest };
};

// Large or risky design asks: lit-crucible joins as the first companion. A request to explain or describe stays out.
const riskyDesignAsk = /\b(?:redesign(?:ing)?|re-?architect(?:ure|ing)?|architecture|migrat(?:e|ion|ing)|overhaul(?:ing)?)\b|설계|아키텍처|마이그레이션|전면\s?개편/u;
const explainAsk = /\b(?:explain|describe|summari[sz]e|what\s+is)\b|설명|요약/u;
export const DELIVERABLES = new Set(["lit-pptx", "lit-docx", "lit-xlsx", "frontend-ui-ux", "lit-scientific-visualization", "lit-diagram-drawer", "lit-schematic", "lit-typographic-motion", "readme-studio"]);

// Routes that do one part of the work rather than run it. Under a bare `lit` they sit after lit-loop, which
// stays the base loop of the turn; workflow routes (lit-plan, start-work, the brainstorms, lit-adhd, ...) keep
// their own lead because each one is the whole turn.
export const LOOP_BASE = "lit-loop";
export const UNDER_LOOP = Object.freeze(new Set([...DELIVERABLES, "litresearch", "review-work", "debugging", "refactor", "structural-search", "lit-humanizer", "visual-qa"]));

export const wantsCrucible = (normalized, ids) => {
  if (explainAsk.test(normalized)) return false;
  return riskyDesignAsk.test(normalized) || ids.filter((id) => DELIVERABLES.has(id)).length >= 3;
};

/**
 * The ordered plan. `primary` is the cascade's skill id; `companions` are the other matched route ids in
 * priority order; `forced` (from parseSkillHatch) replaces the companions. Returns null when the plan is the
 * primary alone, so an ordinary prompt's context stays exactly as it was.
 */
export const buildSkillPlan = ({ primary, companions = [], mentioned = [], forced = null, normalized = "", installed = new Set(), loopBase = false }) => {
  if (typeof primary !== "string" || !primary) return null;
  // A read-only route keeps its rule under lit-loop too: a review or research ask gains no companion that writes.
  const readOnly = READ_ONLY_PRIMARIES.has(primary);
  const dropped = [];
  if (loopBase && !forced && primary !== LOOP_BASE && UNDER_LOOP.has(primary)) {
    if (mentioned.includes(primary)) dropped.push({ id: primary, why: "named but not asked for" });
    companions = [...new Set([...(mentioned.includes(primary) ? [] : [primary]), ...companions])];
    primary = LOOP_BASE;
  }
  let picked;
  if (forced) {
    picked = forced.skills.filter((id) => id !== primary);
  } else {
    picked = companions.filter((id) => id !== primary);
    if (!readOnly && primary !== "lit-crucible" && !picked.includes("lit-crucible") && wantsCrucible(normalized, [primary, ...picked])) picked.unshift("lit-crucible");
  }
  picked = [...new Set(picked)].filter((id) => {
    if (readOnly && !READ_ONLY_SKILLS.has(id)) {
      dropped.push({ id, why: `${primary} is read-only` });
      return false;
    }
    return true;
  });
  if (!forced) {
    const all = new Set([primary, ...picked]);
    for (const [keep, leave, why] of PLAN_VETOES) {
      if (all.has(keep) && picked.includes(leave)) {
        picked = picked.filter((id) => id !== leave);
        dropped.push({ id: leave, why });
      }
    }
  }
  const cap = forced ? FORCED_CAP : PLAN_BACKSTOP;
  for (const id of picked.slice(cap)) dropped.push({ id, why: forced ? "over the cap" : "over the plan backstop" });
  picked = picked.slice(0, cap);
  if (picked.length === 0 && !forced && dropped.length === 0) return null;
  const entries = [primary, ...picked].map((id) => {
    const plugin = EXTENSION_SKILLS[id] ?? null;
    return { id, plugin, installed: plugin ? installed.has(plugin) : true, userInvoked: USER_INVOKED.has(id) };
  });
  return { entries, dropped, forced: Boolean(forced), unknown: forced?.unknown ?? [], readOnly };
};

const entryLabel = (entry, named, primary) => {
  const lead = primary ? " (primary)" : "";
  if (!entry.plugin) return `${entry.id}${lead}`;
  if (entry.installed) return `${entry.plugin}:${entry.id}${lead}${entry.userInvoked ? ` (user types /${entry.plugin}:${entry.id})` : ""}`;
  if (named.has(entry.plugin)) return `${entry.id}${lead} (not installed)`;
  named.add(entry.plugin);
  return `${entry.id}${lead} (not installed: npx @litfamily/litclaude extensions install ${entry.plugin})`;
};

/** The plan line, e.g. `Skill plan: 1 lit-loop (primary) → 2 figures:lit-scientific-visualization`. */
export const skillPlanLine = (plan) => {
  const named = new Set();
  return `Skill plan: ${plan.entries.map((entry, index) => `${index + 1} ${entryLabel(entry, named, index === 0)}`).join(" → ")}`;
};

/** The skill ids of a plan, bare, for the LIT card's chips. */
export const skillPlanIds = (plan) => (plan ? plan.entries.map(({ id }) => id) : []);

const catalogLines = (plan, installed) => {
  const inPlan = new Set(plan.entries.map(({ id }) => id));
  return Object.entries(CATALOG)
    .filter(([id]) => !inPlan.has(id))
    .filter(([id]) => !plan.readOnly || READ_ONLY_SKILLS.has(id))
    .filter(([id]) => !EXTENSION_SKILLS[id] || installed.has(EXTENSION_SKILLS[id]))
    .map(([id, use]) => `${EXTENSION_SKILLS[id] ? `${EXTENSION_SKILLS[id]}:${id}` : id} — ${use}`);
};

// The no-`lit` suggestion tier (route-match.mjs suggestedSkills). Both lines are fixed text plus skill ids;
// nothing from the prompt is echoed. The catalog line is what a prompt gets when no rule fired.
export const NO_ACTIVATION = "LitClaude prompt hook checked: no workflow activation.";
export const SUGGESTION_CATALOG = Object.freeze(["lit-plan", "review-work", "debugging", "refactor", "litresearch", "lit-brainstorm", "deep-interview", "lit-humanizer", "lit-commit", "frontend-ui-ux", "lit-docx", "lit-pptx", "lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"]);
export const suggestionCatalogLine = () => `${NO_ACTIVATION} No skill rule matched. If one of these fits, load it with the Skill tool before reading files or running commands; otherwise none: ${SUGGESTION_CATALOG.join(", ")}.`;

// A core skill the model cannot load is named with what the user types instead.
const USER_TYPED = Object.freeze({ "lit-handoff": "handoff" });

const suggestionLabel = (id, installed, named) => {
  if (Object.hasOwn(USER_TYPED, id)) return `${id} (user types \`${USER_TYPED[id]}\`)`;
  const plugin = EXTENSION_SKILLS[id];
  if (!plugin) return id;
  if (installed.has(plugin)) return `${plugin}:${id}`;
  if (named.has(plugin)) return `${id} (not installed)`;
  named.add(plugin);
  return `${id} (not installed: npx @litfamily/litclaude extensions install ${plugin})`;
};

/** The candidate list for the skills whose suggestion rule fired, plus "none"; null for an empty list. */
export const suggestionContext = (ids, installed = new Set(), lead = `${NO_ACTIVATION} Skill candidates the hook matched:`) => {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const named = new Set();
  return `${lead} ${ids.map((id) => suggestionLabel(id, installed, named)).join("; ")}; none. Decide yes or no for each, then load the ones that fit with the Skill tool before reading files or running commands; if none fits, work without a skill.`;
};

/** The model-facing block. Fixed text around the plan; nothing from the prompt is echoed. */
export const skillPlanContext = (plan, installed = new Set()) => {
  const lines = [skillPlanLine(plan)];
  // lit-loop plus the one route the request matched: that route's own context already describes it, so the
  // block only states the obligation.
  if (!plan.forced && plan.dropped.length === 0 && plan.entries.length === 2 && plan.entries[0].id === LOOP_BASE) {
    const { id } = plan.entries[1];
    lines.push(`Load ${id} with the Skill tool when its part starts, or write one line \`SKIP ${id}: <reason>\`; at turn end LitClaude stops once if it was neither.`);
    return `<litclaude-skill-plan>\n${lines.join("\n")}\n</litclaude-skill-plan>`;
  }
  if (plan.forced) {
    lines.push("The user named this plan with `lit +…`: keep it exactly, add nothing and drop nothing.");
    if (plan.unknown.length > 0) lines.push(`Ignored unknown plan names: ${plan.unknown.map((name) => `+${name}`).join(" ")}.`);
  } else {
    lines.push("Every skill after the primary is required, not a suggestion: load it, or write one line `SKIP <skill-id>: <reason>` when it truly does not fit. Add one catalog skill only when the work clearly needs it.");
  }
  for (const { id, why } of plan.dropped) lines.push(`Left out: ${id} (${why}).`);
  lines.push("State the final plan right after the probe line in the same `Skill plan: 1 … → 2 …` form. The primary is active; load each other skill with the Skill tool when its part starts, never all up front. Not installed: give its install line once and go on. User-typed: tell the user its command when its part starts. At turn end LitClaude stops once to name a planned skill neither loaded nor skipped.");
  const wrap = (body) => `<litclaude-skill-plan>\n${body.join("\n")}\n</litclaude-skill-plan>`;
  const catalog = plan.forced ? [] : catalogLines(plan, installed);
  if (catalog.length === 0) return wrap(lines);
  const full = wrap([...lines, `Catalog (installed here): ${catalog.join("; ")}.`]);
  if (Buffer.byteLength(full, "utf8") <= PLAN_CONTEXT_BYTES) return full;
  return wrap([...lines, "Catalog left out: the plan block is over its size budget."]);
};
