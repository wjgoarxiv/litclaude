// The pure prompt router of the UserPromptSubmit hook (bin/litclaude-hook.js imports it): the trigger
// table, the inert-text helpers that set fenced, backtick-quoted and host-authored text aside, and the
// cascade that picks one route. Nothing here reads files, the environment or the clock.
// explainRoute() at the end says which rule picked the route, for `litclaude-ai why`.

import { renameAliases } from "./rename-aliases.mjs";
import { hasInterfaceModeWord } from "./interface-mode.mjs";
import { DELIVERABLES, LOOP_BASE, UNDER_LOOP, parseSkillHatch } from "./skill-plan.mjs";

const plainWordBoundary = /^[A-Za-z0-9]$/u;
const compoundWordBoundary = /^[A-Za-z0-9_-]$/u;

const triggerByToken = {
  "deep-interview": { command: "/litclaude:deep-interview", skill: "Skill(deep-interview)", skillId: "deep-interview", discipline: "deep-interview" },
  "native-workflow": { command: "/litclaude:lit-loop", skill: "Skill(lit-loop)", skillId: "lit-loop", discipline: "native-workflow" },
  // Team phrases and the named skill share the same native setup gate.
  "agent-team": { command: "/litclaude:lit-loop", skill: "Skill(lit-team)", skillId: "lit-team", discipline: "agent-team" },
  "lit-team": { command: "/litclaude:lit-loop", skill: "Skill(lit-team)", skillId: "lit-team", discipline: "agent-team" },
  // Named-only, like refactor and debugging: a user reaches for structural search when a text
  // search already failed them, so they name it. No NL route — "search" and "find" are far too
  // common to gate on, and a wrong activation here sends the model after a parser it may not have.
  "structural-search": { command: "structural-search", skill: "Skill(structural-search)", skillId: "structural-search", discipline: "structural-search" },
  "browser-drive": { command: "browser-drive", skill: "Skill(browser-drive)", skillId: "browser-drive", discipline: "browser-drive" },
  "lit-crucible": { command: "/litclaude:lit-plan", skill: "Skill(lit-crucible)", skillId: "lit-crucible", discipline: "lit-plan" },
  // Open ideation. The natural routes (`lit brainstorm …`, `lit ideation …`, `lit idea …`) are in
  // hasExplicitBrainstormRoute; the bare skill name is the leading-token form. It carries no goal line.
  "lit-brainstorm": { command: "/litclaude:lit-brainstorm", skill: "Skill(lit-brainstorm)", skillId: "lit-brainstorm", discipline: "lit-brainstorm" },
  // Ideation at scale: `ultra-brainstorm <topic>` (leading token), `lit ultra-brainstorm <topic>` (hasExplicitUltraBrainstormRoute)
  // and /litclaude:ultra-brainstorm. Read-only apart from its .litclaude/brainstorm/ notes; it carries no goal line.
  "ultra-brainstorm": { command: "/litclaude:ultra-brainstorm", skill: "Skill(ultra-brainstorm)", skillId: "ultra-brainstorm", discipline: "ultra-brainstorm" },
  // Porting someone else's published technique into the user's own skill or system. The natural
  // routes (`lit hijack …`, `lit 하이재킹 …`) are in hasExplicitHijackRoute; the skill name leads.
  "lit-hijack": { command: "/litclaude:lit-hijack", skill: "Skill(lit-hijack)", skillId: "lit-hijack", discipline: "lit-hijack" },
  "lit-init": { command: "/litclaude:lit-init", skill: "Skill(lit-init)", skillId: "lit-init", discipline: "lit-init" },
  "lit-plan": { command: "/litclaude:lit-plan", skill: "Skill(lit-plan)", skillId: "lit-plan", discipline: "lit-plan" },
  // lit-recap moved into lit-adhd: `lit recap`, `litrecap` and /litclaude:lit-recap open lit-adhd's recap view.
  "lit-recap": { command: "/litclaude:lit-adhd", skill: "Skill(lit-adhd)", skillId: "lit-adhd", discipline: "lit-adhd", view: "recap", movedFrom: "lit-recap" },
  // The trigger surface is deliberately wider than the skill id. `lit-comprehend` is the
  // canonical name, but bare `comprehend` stays a route for the same reason bare `recap`
  // does — it is what a user actually types. Breadth is safe here only because activation
  // no longer implies execution: with no explicit scope the skill states what it would
  // explain and waits, so a loose match costs one line, not a multi-minute artifact build.
  // The natural-language forms ("설명해줘", "explain this", "이해가 안 돼") stay out of the
  // hook regardless — those are left to Claude Code's own Skill-description matching.
  "lit-comprehend": { command: "/litclaude:lit-comprehend", skill: "Skill(lit-comprehend)", skillId: "lit-comprehend", discipline: "lit-comprehend" },
  comprehend: { command: "/litclaude:lit-comprehend", skill: "Skill(lit-comprehend)", skillId: "lit-comprehend", discipline: "lit-comprehend" },
  // The cross-session brief. `lit-rewind` is a permanent alias with the same skill and discipline,
  // so the card's rewind look and the read-only stack rule key on one name.
  "lit-adhd": { command: "/litclaude:lit-adhd", skill: "Skill(lit-adhd)", skillId: "lit-adhd", discipline: "lit-adhd" },
  "lit-rewind": { command: "/litclaude:lit-rewind", skill: "Skill(lit-adhd)", skillId: "lit-adhd", discipline: "lit-adhd" },
  "lit-loop": { command: "/litclaude:lit-loop", skill: "Skill(lit-loop)", skillId: "lit-loop", discipline: "lit-loop" },
  "start-work": { command: "/litclaude:start-work", skill: "Skill(start-work)", skillId: "start-work", discipline: "start-work" },
  "review-work": { command: "/litclaude:review-work", skill: "Skill(review-work)", skillId: "review-work", discipline: "review-work" },
  // The plan review as a route of its own: `review-plan <plan>` (leading token), `$review-plan`, the typed
  // /litclaude:review-plan page and the phrases in isReviewPlanPhrase. Same skill and discipline as
  // review-work, so the card's review look and the read-only rules key on one name; `view` forces the mode.
  "review-plan": { command: "/litclaude:review-plan", skill: "Skill(review-work)", skillId: "review-work", discipline: "review-work", view: "plan" },
  litgoal: { command: "/litclaude:litgoal", skill: "Skill(litgoal)", skillId: "litgoal", discipline: "litgoal" },
  litresearch: { command: "/litclaude:litresearch", skill: "Skill(litresearch)", skillId: "litresearch", discipline: "litresearch" },
  // `litwork` is a documented trigger (README, docs/hooks.md) that previously had no route of its own: it fell
  // through the natural-language cascade to lit-loop and picked up a soft-confirm meant for a stray English
  // "lit". `command` stays on lit-loop because there is no commands/litwork.md — the exact `commands/`
  // listing is asserted by test/plugin-manifest.test.mjs — but the skill body is now litwork's own.
  litwork: { command: "/litclaude:lit-loop", skill: "Skill(litwork)", skillId: "litwork", discipline: "litwork" },
  // Intent-shaped skills. A user names these directly, so a bare token is the whole route; they carry no
  // slash command, and `command` is the bare word the user typed.
  debugging: { command: "debugging", skill: "Skill(debugging)", skillId: "debugging", discipline: "debugging" },
  refactor: { command: "refactor", skill: "Skill(refactor)", skillId: "refactor", discipline: "refactor" },
  "lit-burnoff": { command: "lit-burnoff", skill: "Skill(lit-burnoff)", skillId: "lit-burnoff", discipline: "lit-burnoff" },
  "lit-burnoff-file": { command: "lit-burnoff-file", skill: "Skill(lit-burnoff-file)", skillId: "lit-burnoff-file", discipline: "lit-burnoff" },
  // Previously reachable ONLY through a post-edit event, which for a design skill is
  // backwards: the guidance is needed when someone says they are designing a UI, not after
  // the CSS is written. Opening the chat routes is additive — the PostToolUse/PreToolUse
  // event routes stay exactly as they were.
  "frontend-ui-ux": { command: "frontend-ui-ux", skill: "Skill(frontend-ui-ux)", skillId: "frontend-ui-ux", discipline: "frontend-ui-ux" },
  "readme-studio": { command: "readme-studio", skill: "Skill(readme-studio)", skillId: "readme-studio", discipline: "readme-studio" },
  // Leading token only. The words "diagram" or "chart" alone must not pull interface or
  // measured-data work away from frontend-ui-ux and lit-scientific-visualization.
  "lit-diagram-drawer": { command: "/litclaude:lit-diagram-drawer", skill: "Skill(lit-diagram-drawer)", skillId: "lit-diagram-drawer", discipline: "lit-diagram-drawer" },
  // Physical schematics: P&IDs, PFDs, apparatus figures, isometric cutaways. A leading token names
  // the skill; a bare `lit` plus schematic wording reaches it through hasSchematicIntent below.
  "lit-schematic": { command: "/litclaude:lit-schematic", skill: "Skill(lit-schematic)", skillId: "lit-schematic", discipline: "lit-schematic" },
  // Office deliverables. A leading token names the skill; a bare `lit` plus report or slide
  // wording reaches them through hasOfficeIntent below.
  "lit-pptx": { command: "/litclaude:lit-pptx", skill: "Skill(lit-pptx)", skillId: "lit-pptx", discipline: "lit-pptx" },
  "lit-docx": { command: "/litclaude:lit-docx", skill: "Skill(lit-docx)", skillId: "lit-docx", discipline: "lit-docx" },
  "lit-xlsx": { command: "/litclaude:lit-xlsx", skill: "Skill(lit-xlsx)", skillId: "lit-xlsx", discipline: "lit-xlsx" },
  // Film requests. A leading token names the skill; a bare `lit` plus a creation verb and
  // motion-video wording reaches it through hasMotionVideoIntent, ahead of office and UI.
  "lit-typographic-motion": { command: "/litclaude:lit-typographic-motion", skill: "Skill(lit-typographic-motion)", skillId: "lit-typographic-motion", discipline: "lit-typographic-motion" },
  "visual-qa": { command: "visual-qa", skill: "Skill(visual-qa)", skillId: "visual-qa", discipline: "visual-qa" },
  "lit-commit": { command: "lit-commit", skill: "Skill(lit-commit)", skillId: "lit-commit", discipline: "lit-commit" },
  "lsp-setup": { command: "lsp-setup", skill: "Skill(lsp-setup)", skillId: "lsp-setup", discipline: "lsp-setup" },
  autoresearch: { command: "/litclaude:autoresearch", skill: "Skill(autoresearch)", skillId: "autoresearch", discipline: "autoresearch" },
  autoconference: { command: "/litclaude:autoconference", skill: "Skill(autoconference)", skillId: "autoconference", discipline: "autoconference" },
  wikify: { command: "/litclaude:wikify", skill: "Skill(wikify)", skillId: "wikify", discipline: "wikify" },
};

// Canonical agent prompts keep their native tool and permission contracts.
Object.assign(triggerByToken, {
  "lit-code": { command: "lit-code", skill: "Skill(lit-code)", skillId: "lit-code", discipline: "lit-code" },
  "lit-humanizer": { command: "/litclaude:lit-humanizer", skill: "Skill(lit-humanizer)", skillId: "lit-humanizer", discipline: "lit-humanizer" },
  "lit-planner": { ...triggerByToken["lit-plan"], agentId: "lit-planner" },
  "lit-executor": { ...triggerByToken["start-work"], agentId: "lit-executor", safetyBlock: true },
  "lit-verifier": { ...triggerByToken["review-work"], agentId: "lit-verifier" },
});
for (const [oldId, newId] of Object.entries(renameAliases)) {
  triggerByToken[oldId] = { ...triggerByToken[newId], renameFrom: oldId };
}

const withoutClosedCodeFences = (text) => {
  const lines = text.split(/\r\n|[\n\r]/u);
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/u.exec(lines[index]);
    if (!opening) continue;
    const marker = opening[1][0];
    const minimumLength = opening[1].length;
    let closingIndex = index + 1;
    while (closingIndex < lines.length) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(lines[closingIndex]);
      if (closing && closing[1][0] === marker && closing[1].length >= minimumLength) break;
      closingIndex += 1;
    }
    if (closingIndex === lines.length) continue;
    lines.fill("", index, closingIndex + 1);
    index = closingIndex;
  }
  return lines.join("\n");
};

const withoutCode = (text) => withoutClosedCodeFences(text).replace(/`[^`]*`/gu, " ");

// Claude Code (and herdr, which relays pane events the same way) can deliver a
// UserPromptSubmit turn whose `prompt` is host-generated background content rather
// than something the user typed — observed 3x on 2026-09-17 as a `<task-notification>`
// block reporting a finished background agent, which happened to contain UI-shaped
// prose ("dashboard", "configure", ...) and fired the frontend-ui-ux route. A
// `<system-reminder>` block is the same class of host-authored wrapper and is stripped
// for the same reason, even though only `<task-notification>` has been directly
// observed here. Only WELL-FORMED, fully-closed blocks are stripped — same rule as
// `withoutClosedCodeFences` for fences — so a bare, unclosed opening tag (accidental or
// not) stays visible and eligible rather than silently swallowing real user text.
// Genuine user prose outside (or between) these blocks is untouched and still routes
// normally; a prompt that consists ONLY of host-generated blocks reduces to nothing and
// therefore activates no route, which is the intended fix.
// A `<cross-session-message>` block (another session's message relayed into this one, observed
// 2026-10-27 firing the lit-adhd route on test names it mentioned) is someone else's text too;
// its opening tag may carry attributes.
// A `<teammate-message …>` block (another agent's message relayed into this session) is someone else's text
// too; its opening tag must carry attributes, so a bare tag typed in prose stays visible.
// A prompt that OPENS with an unclosed `<task-notification>` (a hand-back cut off by the host) or
// with the host's `[SYSTEM NOTIFICATION - NOT USER INPUT]` banner is host text from its first
// character, so the whole prompt is inert (observed 2026-11-15 firing lit-adhd and frontend-ui-ux).
// A tag mentioned later in a typed prompt is still left alone.
const HOST_NOTIFICATION_OPENING = /^\s*(?:\[SYSTEM NOTIFICATION - NOT USER INPUT\]|<task-notification>(?![\s\S]*<\/task-notification>))/u;
// A forwarded message nests one block in another; the innermost closes first, so repeat until none is left.
const withoutTeammateMessages = (text) => {
  const stripped = text.replace(/<teammate-message\s[^>]*>(?:(?!<teammate-message\s)[\s\S])*?<\/teammate-message>/gu, " ");
  return stripped === text ? text : withoutTeammateMessages(stripped);
};
const withoutHostNotifications = (text) => HOST_NOTIFICATION_OPENING.test(text) ? " " : withoutTeammateMessages(text
  .replace(/<task-notification>[\s\S]*?<\/task-notification>/gu, " ")
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gu, " ")
  .replace(/<cross-session-message(?:\s[^>]*)?>[\s\S]*?<\/cross-session-message>/gu, " "));
const rawTriggerText = (text) => withoutCode(withoutHostNotifications(text)).toLowerCase();
const normalizedTriggerText = (text) => rawTriggerText(text).replace(/[_-]+/gu, " ");

const isPlainWordBoundary = (value) => value === undefined || !plainWordBoundary.test(value);
const isCompoundWordBoundary = (value) => value === undefined || !compoundWordBoundary.test(value);

const containsPlainWord = (text, word) => {
  for (let index = 0; index < text.length; index += 1) {
    if (!text.startsWith(word, index)) continue;
    const previous = index === 0 ? undefined : text[index - 1];
    const next = text[index + word.length];
    if (isPlainWordBoundary(previous) && isPlainWordBoundary(next)) return true;
  }
  return false;
};

const containsCompoundBoundedWord = (text, word) => {
  for (let index = 0; index < text.length; index += 1) {
    if (!text.startsWith(word, index)) continue;
    const previous = index === 0 ? undefined : text[index - 1];
    const next = text[index + word.length];
    if (isCompoundWordBoundary(previous) && isCompoundWordBoundary(next)) return true;
  }
  return false;
};

const slashCommandMentions = [
  "/autoconference",
  "/autoresearch",
  "/comprehend",
  "/lit-comprehend",
  "/litclaude:lit-comprehend",
  "/deep-interview",
  "/goal",
  "/lit-crucible",
  "/lit-init",
  "/lit-loop",
  "/lit-plan",
  "/lit-recap",
  "/litclaude:deep-interview",
  "/litclaude:autoconference",
  "/litclaude:autoresearch",
  "/litclaude:lit-init",
  "/litclaude:lit-handoff",
  "/litclaude:lit-loop",
  "/litclaude:lit-plan",
  "/litclaude:lit-recap",
  "/litclaude:litgoal",
  "/litclaude:litresearch",
  "/litclaude:review-work",
  "/litclaude:start-work",
  "/litclaude:wikify",
  "/litgoal",
  "/litrecap",
  "/litresearch",
  "/review-work",
  "/start-work",
  "/wikify",
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

slashCommandMentions.push(...Object.keys(triggerByToken).flatMap((id) => [`/${id}`, `/litclaude:${id}`]));

const namedTriggerTokens = Object.keys(triggerByToken)
  .filter((id) => !["agent-team", "native-workflow"].includes(id))
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp).join("|");
const dollarCommandPattern = new RegExp(`(?:^|\\s)\\$(${namedTriggerTokens})(?=$|[^\\w-])`, "u");
const leadingBareCommandPattern = new RegExp(`^\\s*(${namedTriggerTokens})(?=$|[^\\w-])`, "u");

const slashCommandMentionPattern = new RegExp(
  `(^|\\s)(?:${slashCommandMentions.map(escapeRegExp).join("|")})(?=$|[\\s.,;:!?)}\\]])`,
  "u",
);
const slashLitPhrasePattern = /(^|\s)\/lit(?:work)?\s+(?:plan|recap|comprehend|adhd|rewind|review|research|search|query|goal|workflow|dynamic\s+workflow|ultracode|team|team\s+mode|teammates|start\s+work|ultra[\s-]?brainstorm(?:ing)?|brainstorm(?:ing)?|ideation|ideas?|hijack(?:ing)?)(?=$|[\s.,;:!?)}\]])/u;

const containsSlashCommandMention = (text) => slashCommandMentionPattern.test(text) || slashLitPhrasePattern.test(text);

const familyTriggerTokens = new Set(["autoconference", "autoresearch", "wikify"]);
const hasSafeFamilyArgumentBoundary = (raw, match) => {
  if (!familyTriggerTokens.has(match[1])) return true;
  const next = raw[match.index + match[0].length];
  return next === undefined || /\s/u.test(next);
};

const findDollarCommandTrigger = (raw) => {
  const match = dollarCommandPattern.exec(raw);
  if (!match) return undefined;
  if (!hasSafeFamilyArgumentBoundary(raw, match)) return undefined;
  if (match[1] === "start-work" && !/^\s*\$start-work(?=$|[^\w-])/u.test(raw)) return undefined;
  return { ...triggerByToken[match[1]], source: "dollar-command" };
};

const findLeadingBareCommandTrigger = (raw) => {
  // LEADING-position only, deliberately — not anywhere-tokens. The repo's own negative
  // controls treat "plain review-work discussion" as a non-activation, and an anywhere-token
  // would make "plain lit-commit discussion" fire. Keep named routes leading-only unless
  // the explicit trailing-token table below admits them.
  const match = leadingBareCommandPattern.exec(raw);
  if (!match) return undefined;
  if (!hasSafeFamilyArgumentBoundary(raw, match)) return undefined;
  return { ...triggerByToken[match[1]], source: "bare-command" };
};

// The trailing-token table: a run word that ends a request ("fix the login button lit-loop") routes
// like the same word at the start. A closing question mark keeps "how do I use lit-loop?" unrouted.
const trailingRunTokenPattern = /(?:^|\s)(lit-loop|litwork|lit-hijack)[\s.!]*$/u;
const findTrailingRunTokenTrigger = (raw) => {
  const match = trailingRunTokenPattern.exec(raw);
  return match ? { ...triggerByToken[match[1]], source: "bare-command" } : undefined;
};

// A bare `lit` carries no task. `lit continue` asks to carry on what exists. `lit new` and
// `lit restart` ask for a fresh start, so the session's earlier activation does not count.
const bareLitPattern = /^\s*lit(?:work)?[\s.!?]*$/u;
const resumeLitPattern = /^\s*lit(?:work)?\s+(?:continue|resume|계속)[\s.!?]*$/u;
const restartLitPattern = /(?:^|\s)lit(?:work)?\s+(?:new|restart)(?=$|[^\w-])/u;

const hasLitTrigger = (raw) => containsCompoundBoundedWord(raw, "lit") || containsCompoundBoundedWord(raw, "litwork");
const hasTrailingLitInvocation = (raw) => /(?:^|\s)lit(?:work)?\s*$/u.test(raw);

const hangulSyllable = /^[가-힣]$/u;

const containsKoreanRecap = (raw) => {
  for (let index = 0; index < raw.length; index += 1) {
    if (!raw.startsWith("리캡", index)) continue;
    const previous = index === 0 ? undefined : raw[index - 1];
    const next = raw[index + 2];
    if (previous !== undefined && hangulSyllable.test(previous)) continue;
    if (next === "처" || next === "쳐") continue;
    return true;
  }
  return false;
};

const findRecapTrigger = (raw) => {
  if (containsCompoundBoundedWord(raw, "litrecap")) return { ...triggerByToken["lit-recap"], source: "bare-command" };
  if (containsPlainWord(raw, "recap")) return { ...triggerByToken["lit-recap"], source: "natural-language" };
  if (containsKoreanRecap(raw)) return { ...triggerByToken["lit-recap"], source: "natural-language" };
  return undefined;
};

// `lit comprehend` used to fall through to the generic lit cascade and land on lit-loop —
// the bare `lit` token caught it, so the route looked alive while injecting the wrong body.
// This is the same shape of defect the litwork and lit-team comments above describe.
const findComprehendPhraseTrigger = (raw) =>
  (/(?:^|\s)lit(?:work)?[\s-]comprehend(?=$|[^\w-])/u.test(raw)
    ? { ...triggerByToken["lit-comprehend"], source: "bare-command" }
    : undefined);

// `lit adhd` / `lit rewind` name the brief as two tokens, like `lit comprehend`; without this the
// bare `lit` would catch them and start a loop. The word must end at a boundary, so `lit adhder`
// and `lit rewinding` keep their ordinary routes.
const findAdhdPhraseTrigger = (raw) => {
  if (!/(?:^|\s)lit(?:work)?[\s-](?:adhd|rewind)(?=$|[^\w-])/u.test(raw)) return undefined;
  // `lit adhd recap [session]` is the per-session recap view (it replaced lit-recap).
  const recap = /(?:^|\s)lit(?:work)?[\s-](?:adhd|rewind)\s+(?:recap|리캡)(?:\s+([A-Za-z0-9][A-Za-z0-9._:-]{3,63}))?(?=$|\s)/u.exec(raw);
  const detail = !recap && /(?:자세히|상세|\bdetails?\b|\bper[\s-]session\b)/iu.test(raw);
  return { ...triggerByToken["lit-adhd"], source: "bare-command", ...(recap ? { view: "recap", recapSession: recap[1] ?? null } : detail ? { view: "detail" } : {}) };
};

const hasExplicitWorkflowRoute = (normalized) => /\blit(?:work)?\s+(?:dynamic\s+workflow|workflow|ultracode)\b/u.test(normalized);
// Open ideation. A route word must sit directly after `lit` (`lit brainstorm a name`), or the stronger
// verbs may lead a prompt that carries `lit` anywhere (`brainstorm a name for my app lit`). `idea` and
// `ideas` are common nouns, so they count only directly after `lit`: "lit review the brainstorm notes" and
// "lit fix the idea generator" keep their own routes.
const hasExplicitBrainstormRoute = (normalized) => /\blit(?:work)?\s+(?:brainstorm(?:ing)?|ideation|ideate|ideas?|브레인스토밍|아이디어)(?=$|[^\w-])/u.test(normalized)
  || /^\s*(?:brainstorm(?:ing)?|ideation|ideate)(?=$|[^\w-])/u.test(normalized);
// Porting a published technique. The route word must sit directly after `lit`: "lit debug the session
// hijack" and "lit review the hijack ledger" keep their own routes, and the bare word never activates.
// `lit ultra-brainstorm <topic>` (the hyphen reads as a space here); ahead of the plain brainstorm route.
const hasExplicitUltraBrainstormRoute = (normalized) => /\blit(?:work)?\s+ultra\s?brainstorm(?:ing)?(?=$|[^\w-])/u.test(normalized);
// `lit deep interview <idea>`, `lit deep-interview <idea>`, `lit interview <idea>`: the clarifying interview
// before a plan. The route word must sit directly after `lit`, so "lit fix the interview scheduler" stays a
// loop. Ahead of plan and review: "lit deep interview a plan for the launch" asks to be interviewed.
const hasExplicitInterviewRoute = (normalized) => /\blit(?:work)?\s+(?:deep\s?interview|interview|인터뷰|딥\s?인터뷰)(?=$|[^\w-])/u.test(normalized);
// A whole prompt of `handoff` or `lit handoff` (outer whitespace aside). The hook answers it before the
// cascade below with the handoff payload; explainRoute reports it as `exact:handoff`.
const isExactBareHandoff = (prompt) => typeof prompt === "string" && /^\s*(?:lit\s+)?handoff\s*$/iu.test(prompt);
const hasExplicitHijackRoute = (normalized) => /\blit(?:work)?\s+(?:hijack(?:ing)?|하이재킹|하이잭)(?=$|[^\w-])/u.test(normalized);
// `lit crucible <idea>` and adversarial wording after `lit` ("lit stress-test this plan", "lit 압박 테스트") ask for
// lit-crucible; without this the plain word `plan` pulled them to lit-plan and `crucible` fell to lit-loop.
const hasExplicitCrucibleRoute = (normalized) => /\blit(?:work)?\s+crucible\b/u.test(normalized)
  || /\b(?:pressure|stress)\s?test\b[^.?!]{0,40}\b(?:plan|design|proposal|idea|spec|requirements?|architecture)\b|\bpoke\s+holes\b|\bred\s?team\b|\bdevil'?s\s+advocate\b|압박\s?테스트|허점/u.test(normalized);
// Korean forms of the plan, review and debug words, which the English word boundaries never matched.
const koreanPlanWord = /계획\s?(?:을\s?)?(?:세워|세우|짜|부터|먼저)|계획서\s?(?:쓰|작성)|플랜\s?(?:을\s?)?짜/u;
// "review plan" and "plan review" count only as an adjacent pair after `lit`, so "lit review the plan" and
// "lit review plans/x.md" keep the artifact-picked review. The Korean pair counts when the request ends there,
// asks (해, 좀, 부탁) or names a path, so "계획 검토 결과를 반영해서 구현해줘" stays ordinary work.
const isReviewPlanPhrase = (text) => /(?:^|\s)lit(?:work)?\s+(?:review\s+plan|plan\s+review)(?=$|[^\w-])|(?:계획|플랜)\s?(?:리뷰|검토)(?=\s*(?:$|해|좀|부탁|[A-Za-z0-9./~_-]))/u.test(typeof text === "string" ? text : "");
const koreanReviewWord =/리뷰\s?(?:해|좀|부탁)|코드\s?리뷰|검토해\s?줘/u;
const koreanDebugWord = /디버깅|디버그/u;
const hasExplicitTeamRoute = (normalized) => /\blit(?:work)?\s+(?:team(?:\s+mode)?|teammates)\b/u.test(normalized);
// A casual one-line request ends with `lit` ("… 조사해줘 lit"), so the research verb is not next to
// the token. Korean stems are bare substrings for the reason given at the UI route below; 조사를 and
// a bare 조사 are left out because 조사 is also the grammatical particle ("조사 분리 함수").
const hasExplicitResearchRoute = (normalized) => /\blit(?:work)?\s+(?:research|search|query)\b/u.test(normalized)
  || /^\s*research\b/u.test(normalized)
  || /조사해|조사하|조사\s?좀|리서치/u.test(normalized);

// The ONE new natural-language surface. `design` alone is far too common ("database design",
// "by design", "design the API"), so this requires BOTH a design-shaped verb AND an interface
// noun. That conjunction is what keeps it off non-UI work; a single-word trigger here would be
// the highest false-positive route in the hook.
// Inflections matter: "add dark mode styling to the settings view" is a design request, and a
// bare-stem list silently misses it.
//
// BOUNDARY RULES, which differ by script and were measured before being relied on:
//   Latin terms keep \b. With the /u flag Hangul is a NON-word character, so \bui\b correctly
//     matches "UI를" (space | 를 are both boundaries) while still rejecting "build" and
//     "guide", where 'ui' sits between word characters.
//   Hangul terms use a BARE SUBSTRING. \b is inert between two non-word characters, so
//     /\b페이지\b/ does not match "페이지를" at all. Korean is agglutinative — particles
//     (를/을/의/에서) and verb endings attach with no delimiter — so matching the STEM and
//     letting the ending follow is the only correct approach: 디자인 covers 디자인해줘,
//     디자인하고, 디자인할, 디자인했다 and 리디자인 in one term.
//   ACCEPTED RISK: a bare substring fires if a listed Hangul term appears inside an unrelated
//     word. Mitigated by preferring terms of two or more syllables and by dropping ambiguous
//     ones. REJECTED BY NAME, each for a measured collision with a sentence that already
//     clears the verb half:
//       카드  — "신용카드 결제를 만들어줘" is a payment feature, not a UI request.
//       메뉴  — a restaurant/domain menu is as common as a UI menu.
//       폼    — one syllable; too easy to hit inside an unrelated word.
//       헤더  — the worst of them. "HTTP 헤더를 만들어줘", "요청 헤더를 구성해줘" and
//               "응답 헤더를 배치해줘" all match a verb already in the list (만들 / 구성 /
//               배치), so adding 헤더 would fire on all three. 푸터 is kept because it has no
//               equivalent high-frequency protocol meaning — there is no HTTP footer.
const uiDesignVerb = /\b(?:re)?(?:design(?:ing|ed)?|styl(?:e|ing|ed)|skin(?:ning)?|theme|theming)\b|\b(?:mock\s?-?up|lay\s?out|polish(?:ing)?|revamp)\b|디자인|만들|만드|개편|꾸미|꾸며|다듬|배치|구성/u;
const uiSurfaceNoun = /\b(?:ui|ux|interface|screen|page|view|component|layout|button|form|modal|dialog|dashboard|css|styling|stylesheet|typography|spacing|palette|dark\s?mode|responsive)\b|화면|페이지|인터페이스|레이아웃|버튼|모달|팝업|대시보드|컴포넌트|스타일|테마|다크\s?모드|반응형|아이콘|타이포그래피|여백|색상|컬러|폰트|디자인\s?시스템|사이드바|푸터|툴바|위젯|[내네]비게이션/u;

// The conjunction is the whole safety mechanism, and it carries MORE weight in Korean than in
// English. English can rely on `design` being specific, so `build` and `make` were deliberately
// left out of the verb list. Korean has no such option: 만들다 is the natural verb for creating
// a UI, so it must be present, which means every Korean sentence containing 만들어줘 reaches the
// verb half. The noun half is therefore the only thing separating "디자인 시스템을 만들어줘"
// from "API 클라이언트를 만들어줘". The Korean negative tests exist to prove it still does.
// English build verbs route only with a page-shaped noun. `build`, `create` and `make` are far too
// common to join uiDesignVerb, but "build the landing page" is the most common way an interface is
// requested, and leaving it unrouted meant the skill activated only when the model happened to
// load it. The noun list names whole interface surfaces, never a part a backend also has; the
// exclusion list catches the build objects that share those nouns (BI dashboards, backends, APIs).
const uiBuildVerb = /\b(?:build|create|make(?!\s+sure\b)|implement|code|develop)\b/u;
const uiPageNoun = /\b(?:landing\s?page|web\s?page|website|web\s?site|homepage|home\s?page|dashboard|admin\s?(?:panel|console|ui)|settings\s?(?:page|screen)|(?:sign\s?up|log\s?in|checkout|pricing|profile|onboarding)\s?(?:page|screen|form|flow)|user\s?interface|web\s?ui|front\s?end|ui)\b/u;
const nonInterfaceBuild = /\b(?:grafana|kibana|datadog|metabase|looker|tableau|power\s?bi|backend|back\s?end|api|endpoint|docker|image|cli|migration|schema)\b/u;
const hasUiBuildIntent = (normalized) => uiBuildVerb.test(normalized) && uiPageNoun.test(normalized) && !nonInterfaceBuild.test(normalized);
const hasUiDesignIntent = (normalized) => (uiDesignVerb.test(normalized) && uiSurfaceNoun.test(normalized)) || hasUiBuildIntent(normalized);
// Polish, audit and harden wording (lib/interface-mode.mjs) reaches the interface skill through the
// same noun half, so "이 문단 다듬어줘" and "서버 상태 점검" stay inert.
const hasUiModeIntent = (normalized) => hasInterfaceModeWord(normalized) && uiSurfaceNoun.test(normalized);

// Office deliverables under a bare `lit`. Same conjunction shape as the UI route: a making
// verb AND a document or slide noun, because each noun alone is common in engineering talk
// ("the report says", "deck of cards", "문서 참고"). Hangul terms are bare substrings for the
// reason given above, except 덱, which would match inside 인덱스 and so needs a non-Hangul
// neighbour. Code documentation and tool reports are excluded by name: a README, API docs,
// a docstring, a bug, test, coverage or error report are not Word files. A Markdown file is
// excluded only when it is a named project document or sits under docs/; any other `.md` is
// usually the source of the deck or report ("turn notes.md into slides").
const officeVerb = /\b(?:make|making|made|create|creating|write|writing|draft|drafting|prepare|preparing|build|building|generate|generating|produce|producing|put\s+together|turn\b.*\binto|compile)\b|만들|만드|작성|써\s?줘|써\s?주|써서|써봐|쓰고|정리해|정리하|준비|초안|뽑아|짜\s?줘|구성해/u;
const slideNoun = /\b(?:slides?|slide\s?deck|deck|presentation|pptx?|powerpoint|keynote)\b|발표|슬라이드|피피티|파워포인트|(?<![가-힣])덱(?![가-힣])|(?<![가-힣])덱을|(?<![가-힣])덱으로/u;
const documentNoun = /\b(?:reports?|docx|doc|documents?|word\s+(?:doc(?:ument)?|file)|ms\s?word|white\s?papers?|proposals?|memos?)\b|보고서|리포트|기획서|제안서|계획서|문서|워드|백서/u;
const codeDocumentation = /readme|changelog|버그\s?리포트|이슈로|contributing|api\s?(?:문서|docs?\b|reference)|docstrings?|jsdoc|javadoc|주석|\b(?:agents|claude|gemini|skill|security|code_of_conduct|license|authors|architecture|support|governance)\.md\b|\bdocs\/|\b(?:bug|test|coverage|error|crash|lint|issue|incident)\s+reports?\b|\breport\s+(?:a|the|this|that)\s+(?:bug|issue|error|problem)/u;

// "each document", "all documents", "these docs" spread a task over many files that already exist; one
// Word deliverable is "a document", "the report", "a docx". A quantified mention is not a deliverable noun.
const quantifiedDocument = /\b(?:each|every|all|any|both|these|those|other|existing|per)\s+(?:\w+\s+)?(?:documents?|docs?)\b/gu;

// A slide count beside a slide noun ("덱 10장", "a 10-slide deck") asks for the deck without a making verb.
const slideCount = /\d+\s?장|\b\d+[\s-]?slides?\b/u;

// "an xlsx report" or "엑셀 보고서" is a workbook (lit-xlsx), not a Word document.
const sheetReport = /\b(?:xlsx|excel|spreadsheet)\s+reports?\b|엑셀\s?(?:보고서|리포트)/gu;
const sheetNoun = /\b(?:xlsx|excel|spreadsheets?)\b|엑셀|스프레드\s?시트|표\s?계산/u;

// Returns the office skills a bare-lit prompt asks for: slides, then a Word document, then a workbook.
const officeIntent = (normalized) => {
  const counted = slideCount.test(normalized) && slideNoun.test(normalized);
  if ((!officeVerb.test(normalized) && !counted) || codeDocumentation.test(normalized)) return [];
  const skills = [];
  if (slideNoun.test(normalized)) skills.push("lit-pptx");
  if (documentNoun.test(normalized.replace(/\b(?:slide|presentation)\s+(?:doc|document)\b/gu, " ").replace(sheetReport, " ").replace(quantifiedDocument, " "))) skills.push("lit-docx");
  if (sheetNoun.test(normalized)) skills.push("lit-xlsx");
  return skills;
};

// Film requests under a bare `lit` (MO-C-18..23). A creation verb plus either a compound
// motion-video noun or a bare video noun fires, unless one of the exclusions names another job:
// editing existing footage, a video placed inside a page, a video placed inside slides or a
// report, a text or image artifact about a video, UI motion with no video noun, or video as a
// software feature (a player, an upload). Bare 모션 / motion / 인트로 / intro never fire alone.
// Hangul terms are bare substrings for the reason given at the UI route.
const motionVerb = /\b(?:render|rendering|produce|producing|animate|animating)\b|제작|렌더링|렌더해|영상화/u;
const motionVideoCompound = /모션\s?그래픽|타이포\s?모션|키네틱\s?타이포|타이포그래피\s?(?:영상|비디오)|(?:가사|리릭)\s?(?:영상|비디오)|뮤직\s?비디오|오프닝\s?타이틀|타이틀\s?시퀀스|\bmotion\s?graphics?\b|\bkinetic\s+(?:type|typography)\b|\btypographic\s+motion\b|\b(?:lyric|music)\s+videos?\b|\btitle\s+sequences?\b|\bopening\s+titles?\b/u;
const bareVideoNoun = /영상|비디오|동영상|클립(?!보드)|\bvideos?\b|\bclips?\b(?!\s?(?:path|board))/u;
const footageEdit = /편집|자막|색\s?보정|트리밍|잘라|자르|\b(?:edit|editing|caption|captions|captioning|subtitles?|trim|trimming|crop|cropping|colou?r\s?grad(?:e|ing))\b/u;
const existingFootage = /(?:이|그|기존|찍은|녹화한|촬영한)\s?(?:영상|클립|동영상|비디오)|\b(?:this|that|the|my|our|existing|recorded)\s+(?:videos?|clips?|footage|recordings?)\b|\bfootage\b/u;
const webContainer = /페이지|웹사이트|랜딩|화면|컴포넌트|버튼|\b(?:page|pages|website|landing|screen|component|button)\b/u;
const embedVerb = /넣|삽입|임베드|깔아|깔고|\b(?:embed|embedding|insert|inserting|autoplay)\b/u;
const backgroundVideo = /배경\s?(?:영상|비디오|동영상)|\b(?:background|hero)\s+videos?\b/u;
const officeContainer = /발표\s?자료|슬라이드|피피티|보고서|문서|(?<![가-힣])덱(?![가-힣])|\b(?:slides?|deck|pptx?|report|document)\b/u;
const videoArtifact = /스크립트|대본|썸네일|요약|기획안|\b(?:script|transcript|thumbnails?|summary|summarize|storyboard)\b/u;
const uiMotionWord = /모션|애니메이션|\bmotion\b|\banimations?\b/u;
const videoSoftware = /플레이어|업로드|스트리밍|인코딩|\b(?:player|upload|uploader|streaming|playback|encoder|encoding|codec|transcod\w*)\b/u;

// Schematic requests under a bare `lit`. A strong noun (P&ID, PFD, cutaway, 계장도, 모식도, 장치도…)
// is enough; a weak one (schematic, isometric, apparatus) also needs a drawing verb and no
// web-interface noun, so "an isometric hero for the landing page" stays with the interface route.
// Hangul terms are bare substrings for the reason given at the UI route.
const schematicStrongNoun = /\bp\s?&\s?i\s?ds?\b|\bpfds?\b|\bbfds?\b|piping\s+(?:and|&)\s+instrumentation|process\s+flow\s+(?:diagram|sheet)s?|block\s+flow\s+diagrams?|\bplot\s+plans?\b|equipment\s+layouts?|experimental\s+(?:set\s?up|apparatus)|\bcut\s?aways?\b|컷어웨이|배관\s?계장도|계장도|공정\s?흐름도|공정도|모식도|장치도|실험\s?장치|피앤아이디|배치도|계통도|단면도/u;
// 도면 alone also names a document topic ("도면 번호 체계 정리"), so it needs a drawing verb.
const schematicWeakNoun = /\bschematics?\b|\bisometric\b|\bapparatus\b|사시도|개략도|아이소메트릭|도면/u;
// A chart or graph of data belongs to the data-visualization skill even when it names a drawing
// ("단면도 데이터로 그래프"); "plot plan" is a drawing and stays out.
const schematicChartNoun = /차트|그래프|\b(?:charts?|graphs?|plots?(?!\s+plans?\b))\b/u;
// A drawing verb names a picture; a generic making verb ("make", "만들") counts only when no
// office deliverable is named, so "lit make a report on the P&ID" stays a document request.
const schematicDrawVerb = /\b(?:draw|drawing|drew|sketch|sketching|illustrate|illustrating|render|rendering|redraw)\b|그려|그리|그림|도식|작도/u;
// Whole interfaces a schematic can sit inside. "레이아웃" and "layout" stay out: an equipment layout
// is a drawing.
const schematicInterfaceNoun = /\b(?:dashboards?|landing\s?pages?|web\s?pages?|websites?|homepages?|web\s?apps?|apps?|screens?|admin\s?(?:panel|console)|user\s?interface|ui)\b|대시보드|웹사이트|랜딩|페이지|화면|앱/u;
const schematicMakeVerb =/\b(?:make|making|create|creating|design|designing|build|lay\s?out)\b|만들|만드/u;
const hasSchematicIntent = (normalized) => {
  if (schematicStrongNoun.test(normalized)) return true;
  return schematicWeakNoun.test(normalized) && (schematicDrawVerb.test(normalized) || schematicMakeVerb.test(normalized)) && !webContainer.test(normalized);
};

const hasMotionVideoIntent = (normalized) => {
  if (!(officeVerb.test(normalized) || uiDesignVerb.test(normalized) || motionVerb.test(normalized))) return false;
  const bare = bareVideoNoun.test(normalized);
  if (!motionVideoCompound.test(normalized) && !bare) return false;
  if (footageEdit.test(normalized) && existingFootage.test(normalized)) return false;
  if (backgroundVideo.test(normalized) || (webContainer.test(normalized) && embedVerb.test(normalized))) return false;
  if (officeContainer.test(normalized) && embedVerb.test(normalized)) return false;
  if (videoArtifact.test(normalized)) return false;
  if (!bare && uiMotionWord.test(normalized) && uiSurfaceNoun.test(normalized)) return false;
  return !videoSoftware.test(normalized);
};

// Structural search intent. Same conjunction shape as the UI route, but the discriminating half
// is the OBJECT, not the verb: whether the thing being searched is a syntax construct or a
// string. "find the login handler" stays inert because a handler is not a syntax shape; "find
// every call site" fires because a call site is. Either half alone is far too common.
const structuralVerb = /\b(?:find|locate|search|rewrite|replace|migrate|codemod)\b/u;
// ADAPTED from the sibling's list after measuring it here. Dropped bare `signatures?` — it fired
// on "search the changelog for signatures" (cryptographic, not code) — keeping the qualified
// `function|method signatures?`. Dropped `references to` — "find references to this symbol" is a
// SEMANTIC question this skill explicitly routes to Skill(lsp), so matching it here would
// contradict the skill's own boundary. Added `syntax shape`.
// THE LINE: ask the language server WHO and WHAT; ask a structural engine WHAT SHAPE.
// A call site is a syntax node — the `foo($$$ARGS)` expression. A CALLER is the enclosing
// function that contains it, and naming that requires scope and symbol resolution. Same for
// `usages of X` and `references to X`: deciding which `X` is *this* X is symbol resolution,
// which a tree matcher cannot do and will silently over-match on same-named symbols.
// So every WHO/WHICH-SYMBOL term is excluded and routed to Skill(lsp) by the body:
//   callers · call graph · invocations · references to · usages of · every/all usages
// This is also why the near-synonym objection is retired: "find every call site" and "find all
// the callers" were never one intent split by wording — they are two different skills' work.
const structuralShape = /\b(?:call ?sites?|callsites?|declarations?|import statements?|imports|(?:function|method) signatures?|syntax (?:tree|shape)|ast)\b/u;
// KNOWN over-fires, kept on purpose: "find the imports in this file" and "locate the AST dump
// file" both match. The cost is asymmetric — a false fire ends in "probe -> unavailable ->
// labelled textual", which is what the model would have done anyway, while a MISS on "replace
// all imports of lodash" produces a naive text replace that breaks code.
// A web search for tutorials about a structural tool ("search the web for ast-grep tutorials") is research, not a code search.
const hasStructuralSearchIntent = (normalized) => structuralVerb.test(normalized) && structuralShape.test(normalized) && !/\bsearch\s+the\s+web\b|\btutorials?\b/u.test(normalized);

// Companion-only detectors (S1). Neither ever becomes the primary route: "chart" and "diagram" alone must
// not pull interface or loop work away (see the lit-diagram-drawer row above). A figure of data needs a
// plot noun plus measured data or a plotting verb; a diagram needs a diagram noun plus a drawing or making verb.
const vizNoun = /\b(?:plots?(?!\s+plans?\b)|charts?|graphs?|figures?|histograms?|heat\s?maps?|scatter\s?plots?|box\s?plots?)\b|그래프|차트|플롯|히스토그램|산점도|시각화|그림\s?\d/u;
const vizCue = /\b(?:data|dataset|csv|xlsx|measure(?:d|ments?)|results?|experiments?|publication|paper|journal)\b|데이터|측정|실험|결과|논문|저널|\b(?:plot|visuali[sz]e)\b/u;
const hasDataVizIntent = (normalized) => vizNoun.test(normalized) && vizCue.test(normalized);
const diagramNoun = /\b(?:diagrams?|flow\s?charts?|sequence\s+diagrams?|architecture\s+(?:diagram|map)|system\s+map|timeline\s+(?:diagram|graphic))\b|다이어그램|도식|흐름도|구성도|순서도/u;
const hasDiagramIntent = (normalized) => diagramNoun.test(normalized) && (schematicDrawVerb.test(normalized) || schematicMakeVerb.test(normalized) || officeVerb.test(normalized));

// Every content route a bare-lit prompt matches, in the cascade's own priority order (S1). The cascade
// still chooses the primary; lib/skill-plan.mjs turns the rest into companions.
const naturalLitCompanions = (normalized) => {
  const routes = [];
  if (hasMotionVideoIntent(normalized)) routes.push(schematicStrongNoun.test(normalized) ? "lit-schematic" : "lit-typographic-motion");
  if (hasSchematicIntent(normalized) && !schematicChartNoun.test(normalized)) routes.push("lit-schematic");
  routes.push(...officeIntent(normalized));
  if (hasExplicitResearchRoute(normalized)) routes.push("litresearch");
  if (hasUiDesignIntent(normalized) || hasUiModeIntent(normalized)) routes.push("frontend-ui-ux");
  if (hasDataVizIntent(normalized)) routes.push("lit-scientific-visualization");
  if (hasDiagramIntent(normalized)) routes.push("lit-diagram-drawer");
  if (hasStructuralSearchIntent(normalized)) routes.push("structural-search");
  return [...new Set(routes)];
};

// The bare-lit companion layer (plans/2026-11-28-lit-auto-invoke). Three steps, all on the normalized prompt:
//   1. Set aside what is not asked for: a deliverable named only to refuse it ("PPT 말고", "no slides", "before
//      any charts"), one that already exists or is being quoted ("예전에 만든 발표자료", "the deck I made",
//      "as the diagram shows"), a question about ability or meaning ("피피티 만들 수 있어?", "뭐 하는 거야"),
//      talk about a skill or the router itself, quoted text, and code words ("함수 이름", "dependency graph").
//   2. Read the request stance in what is left. Korean asks with a desire or instrument frame as often as with a
//      verb ("~하고 싶어", "~면 좋겠어", "피피티로 표현", "슬라이드로 바꿔"), and English with "I'd like", "need"
//      or a bare noun phrase ("lit a 12-slide keynote"); any of these makes a deliverable noun count.
//   3. Cue lanes for skills that have no deliverable noun: refactor, lit-humanizer, deep-interview,
//      readme-studio, debugging and research, each a short cue list behind the same set-aside step.
// Hangul terms are bare substrings for the reason given at the UI route.
const quotedSpan = /"[^"\n]{1,200}"|“[^”\n]{1,200}”|'[^'\n]{3,200}'|「[^」\n]{1,200}」/gu;
const clauseBreak = /[,.;!?\n]|\s(?:but|then|and then|now)\s|(?:고\s?나서|인데|지만)\s/u;
const refusedMention = /(?<![^\s,.;])[^\s,.;]{0,40}(?:\s[^\s,.;]{1,40})?\s?(?:말고|빼고|없이|은\s?아니고|는\s?아니고|은\s?나중에|는\s?나중에|건드리지\s?말고|하지\s?말고|그대로\s?두고)|\b(?:no|not|without|never|before\s+any)\s+(?!chang|behaviou?r)(?:\w+\s+)?\w+(?:\s+(?:or|and)\s+\w+)?|\b(?:don'?t|do\s+not)\s+\w+(?:\s+(?:me\s+)?\w+)?|\bkeep\s+the\s+wording\b[^,.;]*/gu;
const mentionClause = /예전에|지난번|이전에|이미\s?있|에\s?나온|적혀|어디\s?있|뭐\s?하는|뭐야|무슨\s?뜻|할\s?수\s?있어|만들\s?수\s?있어|가능해\?|라우터|스킬이|스킬\s|설치돼|\b(?:i|we)\s+made\b|\blast\s+week\b|\bwent\s+well\b|\bwas\s+accepted\b|\bas\s+the\s+[\w\s-]{1,40}?\s(?:shows|says)\b|\bthe\s+(?:report|deck|document|diagram)\s+(?:says|shows)\b|\bin\s+docs\b|\bcan\s+you\s+make\b|\bjust\s+asking\b|\brouter\b|\bexplain\s+how\b|\bwhat\s+was\b|\bis\s+outdated\b/u;
const codeClause = /함수|변수|이름을|라이브러리|버전|데이터베이스|의존성|순환|파서|임포트|크래시|\b(?:rename|function|variable|library|version|database|dependency|dependencies|call\s+graph|chart\.js|import|imports|parser|crash|uploader|cycles?)\b|\bfrom\s+(?:that|the|this)\s+\w+\s+file\b|읽는|읽어/u;
const requestStance = /싶어|싶다|좋겠|줬으면|주면|해\s?줘|해\s?주|해줄래|해주라|부탁|필요해|필요한|보여\s?줘|보여주|표현|바꿔|남기|뽑아|그려|만들|만드|작성|정리|준비|(?:로|으로)\s?(?:\S{1,20}\s?)?(?:줘|해|봐|보고)|\d+\s?장|\b(?:i'?d\s+like|i\s+want|we\s+want|would\s+love|i\s+need|we\s+need|need|want|please|make|create|write|draft|prepare|build|turn|plot|draw|sketch|visuali[sz]e|render|redo|restyle|put)\b|\b\d+[\s-]?slides?\b|^\s*(?:lit\s+)?(?:an?|both|some|graphs?|charts?|plots?)\b|\bas\s+(?:a|an)\s+\w+/u;

const activeText = (normalized, keepCode = false) => normalized
  .replace(quotedSpan, " ")
  .split(clauseBreak)
  .map((clause) => clause.replace(refusedMention, " "))
  .filter((clause) => !mentionClause.test(clause) && (keepCode || !codeClause.test(clause)))
  .join(" , ");

const measuredData = /데이터|측정|결과|\b(?:data|dataset|csv|measure(?:d|ments?)|results?)\b/u;
const wordNoun = /\bword\s+(?:document|file|doc)\b|워드\s?(?:파일|문서|로)|\bdocx\b/u;
const deliverableNouns = (active) => {
  if (!requestStance.test(active) || codeDocumentation.test(active)) return [];
  const found = [];
  if (slideNoun.test(active)) found.push("lit-pptx");
  if (wordNoun.test(active) || documentNoun.test(active.replace(sheetReport, " ").replace(quantifiedDocument, " "))) found.push("lit-docx");
  if (sheetNoun.test(active)) found.push("lit-xlsx");
  const schematic = schematicStrongNoun.test(active);
  // "flow chart" is a diagram, and a journal figure of an apparatus is a schematic unless measured data is named.
  const withoutDiagrams = active.replace(new RegExp(diagramNoun.source, "gu"), " ");
  const figureAsk = vizNoun.test(withoutDiagrams) || /\bfig(?:ure)?\.?\s?\d|그림\s?\d|범례|\blegend\b|축\s?라벨|\baspect\b|\btoo\s+tall\b/u.test(withoutDiagrams);
  if (figureAsk && !(schematic && !measuredData.test(active))) found.push("lit-scientific-visualization");
  if (diagramNoun.test(active)) found.push("lit-diagram-drawer");
  return found;
};

const CUE_LANES = [
  ["refactor", /리팩터|리팩토링|god\s?class|쪼개|(?:기능|동작)\s?(?:은|이)?\s?(?:안\s?바뀌|그대로|바뀌지\s?않)|구조(?:만|를|도)?\s?정리|중복\s?코드\s?정리|\brefactor\w*|\brestructur\w*|without\s+changing\s+(?:any\s+)?behaviou?r|no\s+behaviou?r\s+change|keep\s+the\s+api\s+the\s+same|clean\s+up\s+the\s+structure|split\s+(?:this|the)\s+[\w-]+\s+(?:file|module|class)/u],
  ["lit-humanizer", /자연스럽게|ai\s?티|기계\s?같|사람이\s?쓴\s?것처럼|humaniz|de[-\s]?template|sound\s+less\s+like\s+ai|less\s+(?:like\s+ai|robotic)|reads?\s+naturally|polish\s+the\s+wording|(?:문장|문구)\S{0,10}\s?(?:\S{1,20}\s)?(?:다듬|고쳐)/u],
  ["deep-interview", /질문하면서|물어봐|물어보면서|하나씩\s?물어|interview\s+me|ask\s+me\s+questions|요구사항이?\s?(?:불분명|애매)|아직\s?애매|모르겠어,?\s?(?:먼저|같이)|not\s+sure\s+what\s+(?:i\s+want|it\s+should)|스펙이\s?없|requirements\s+are\s+fuzzy/u],
  ["readme-studio", /readme\S{0,20}\s?(?:\S{1,20}\s){0,2}?(?:커버|cover|새로|다시|제대로)|(?:redo|rewrite|write\s+a\s+proper|write)\s+(?:the\s+|a\s+proper\s+)?readme|readme\s+(?:with|for)\s+(?:a\s+)?(?:cover|the\s+launch)|공개\s?전에\s?readme/u],
  ["debugging", /원인\s?(?:을\s?)?(?:찾|분석|파악)|root\s+cause|figure\s+out\s+why|find\s+out\s+why|재현부터|버그\s?잡|왜\s?\S{1,20}\s?(?:계속\s?)?(?:멈|실패|안\s?보|깨)|\bwhy\s+\w+\s+(?:hangs?|fails?|crash\w*)|something\s+is\s+wrong/u],
  ["litresearch", /prior\s+work|선행\s?연구|\bsurvey\s+(?:how|what|the\s+(?:field|literature|landscape))\b|with\s+sources|리서치|조사해|조사하|\bresearch\b/u],
];

// Refactor and debugging asks name code by nature, so only talk about a skill sets them aside; the other cue
// lanes also drop clauses about code ("the research script import bug" is not a research ask).
const CODE_LANES = new Set(["refactor", "debugging"]);
const cueCompanions = (normalized) => {
  const clauses = normalized.replace(quotedSpan, " ").split(clauseBreak).map((clause) => clause.replace(refusedMention, " ")).filter((clause) => !mentionClause.test(clause));
  const codeFree = clauses.filter((clause) => !codeClause.test(clause)).join(" , ");
  const all = clauses.join(" , ");
  return CUE_LANES.filter(([id, cue]) => cue.test(CODE_LANES.has(id) ? all : codeFree)).map(([id]) => id);
};

// Companion detection reads at most this many characters, so a long paste costs the prompt hook no more than
// a short prompt does; the cascade itself still reads the whole prompt.
export const PLAN_TEXT_CHARS = 4000;

/**
 * The companions a bare-lit prompt asks for, and the deliverable routes it only mentions. `primary` is the
 * cascade's route; when it is a deliverable the prompt only mentions, it is returned in `mentioned` so the plan
 * can list it as left out instead of running it.
 */
const litPlanCompanions = (fullText, primary = null) => {
  // The ask often follows a long paste, so a long prompt is read as its head and its tail.
  const half = PLAN_TEXT_CHARS / 2;
  const normalized = fullText.length <= PLAN_TEXT_CHARS ? fullText : `${fullText.slice(0, half)} , ${fullText.slice(-half)}`;
  const active = activeText(normalized);
  let found = [...new Set([...naturalLitCompanions(active), ...deliverableNouns(active), ...cueCompanions(normalized)])];
  if (found.includes("lit-schematic") && !measuredData.test(active)) found = found.filter((id) => id !== "lit-scientific-visualization");
  // The cascade read the whole prompt; when this read was cut, its route may sit in the part not read here,
  // so it is never called a mere mention.
  const cut = fullText.length > PLAN_TEXT_CHARS;
  // The code-word filter keeps false companions out; it never demotes the cascade's own route. That route is
  // a mere mention only when it is gone once refusals, quotes and mention clauses alone are set aside.
  const stillAsked = DELIVERABLES.has(primary) && naturalLitCompanions(activeText(normalized, true)).includes(primary);
  const mentioned = !cut && DELIVERABLES.has(primary) && !found.includes(primary) && !stillAsked ? [primary] : [];
  return { companions: found, mentioned };
};

const findNaturalLitTrigger = (prompt) => {
  const raw = rawTriggerText(prompt);
  if (containsSlashCommandMention(raw)) return undefined;
  if (containsCompoundBoundedWord(raw, "litresearch")) return { ...triggerByToken.litresearch, source: "bare-command" };
  if (!hasLitTrigger(raw)) return undefined;

  const normalized = normalizedTriggerText(prompt);
  if (hasExplicitTeamRoute(normalized)) return { ...triggerByToken["agent-team"], source: "natural-language" };
  if (hasExplicitWorkflowRoute(normalized)) return { ...triggerByToken["native-workflow"], source: "natural-language" };
  // Ahead of the plan and review words: "lit brainstorm a plan for the launch" asks for options, and the
  // word `plan` inside it must not pull the prompt to lit-plan.
  if (hasExplicitUltraBrainstormRoute(normalized)) return { ...triggerByToken["ultra-brainstorm"], source: "natural-language" };
  if (hasExplicitBrainstormRoute(normalized)) return { ...triggerByToken["lit-brainstorm"], source: "natural-language" };
  // Ahead of plan, review and research for the same reason: "lit hijack the review lanes into my plan
  // skill" names other skills as material, not as the route.
  if (hasExplicitHijackRoute(normalized)) return { ...triggerByToken["lit-hijack"], source: "natural-language" };
  if (hasExplicitInterviewRoute(normalized)) return { ...triggerByToken["deep-interview"], source: "natural-language" };
  if (hasExplicitCrucibleRoute(normalized)) return { ...triggerByToken["lit-crucible"], source: "natural-language" };
  if (containsPlainWord(normalized, "plan") && hasReviewModifier(prompt)) {
    return { ...triggerByToken["lit-plan"], source: "natural-language" };
  }
  if (isReviewPlanPhrase(normalized)) return { ...triggerByToken["review-plan"], source: "natural-language" };
  if (containsPlainWord(normalized, "review") || koreanReviewWord.test(normalized)) return { ...triggerByToken["review-work"], source: "natural-language" };
  // Above the lit-loop fallthrough: "lit debug the hang" should reach the debugging methodology rather
  // than a generic loop. Both stems are checked because the word boundary makes "debug" miss "debugging".
  if (containsPlainWord(normalized, "debug") || containsPlainWord(normalized, "debugging") || koreanDebugWord.test(normalized)) {
    return { ...triggerByToken.debugging, source: "natural-language" };
  }
  if (/^\s*lit(?:work)?\s+start\s+work(?=$|[^\w-])/u.test(normalized)) {
    return { ...triggerByToken["start-work"], source: "natural-language", safetyBlock: true };
  }
  // A cutaway, P&ID or apparatus asked for as a film ("lit 컷어웨이를 모션 영상으로") stays with
  // lit-schematic, which draws the equipment and renders its loop itself; a film about anything
  // else keeps going to the motion route below.
  if (schematicStrongNoun.test(normalized) && hasMotionVideoIntent(normalized)) {
    return { ...triggerByToken["lit-schematic"], source: "natural-language" };
  }
  // Above office and UI (MO-C-18): once the motion trigger matched, a video noun wins over 발표 or
  // 타이포그래피 also in the prompt. "발표자료 만들어줘 lit" (no video noun) still reaches lit-pptx.
  if (hasMotionVideoIntent(normalized)) {
    return { ...triggerByToken["lit-typographic-motion"], source: "natural-language", styleGate: false };
  }
  // Above office, research, goal and plan: "lit 논문용 실험 장치 모식도 그려줘" and "lit draw the
  // plot plan" ask for a drawing. A schematic word in a request to write a report ("lit P&ID 설명
  // 보고서 작성") has no drawing verb and still reaches the office route below.
  // When the deliverable is an interface ("lit build a dashboard showing the P&ID"), frontend-ui-ux
  // owns it and lit-schematic draws only the drawing inside; a drawing verb keeps the drawing here.
  const office = officeIntent(normalized);
  const interfaceDeliverable = hasUiDesignIntent(normalized) && schematicInterfaceNoun.test(normalized) && !schematicDrawVerb.test(normalized);
  if (hasSchematicIntent(normalized) && !interfaceDeliverable && !schematicChartNoun.test(normalized) && (schematicDrawVerb.test(normalized) || office.length === 0)) {
    return { ...triggerByToken["lit-schematic"], source: "natural-language" };
  }
  // Above research, goal and plan: "조사해서 보고서로 만들어줘 lit" and "write a project plan
  // document lit" ask for a file, and the office skill covers the gathering step itself.
  if (office.length > 0) {
    return { ...triggerByToken[office[0]], source: "natural-language", officeSkills: office };
  }
  if (hasExplicitResearchRoute(normalized)) return { ...triggerByToken.litresearch, source: "natural-language" };
  if (containsPlainWord(normalized, "goal")) return { ...triggerByToken.litgoal, source: "natural-language" };
  if (containsPlainWord(normalized, "plan") || koreanPlanWord.test(normalized)) return { ...triggerByToken["lit-plan"], source: "natural-language" };
  // Above the lit-loop fallthrough, same position as the debugging route: "lit restyle the
  // dashboard" should reach the interface skill rather than a generic loop.
  if (hasUiDesignIntent(normalized) || hasUiModeIntent(normalized)) return { ...triggerByToken["frontend-ui-ux"], source: "natural-language" };
  if (hasStructuralSearchIntent(normalized)) return { ...triggerByToken["structural-search"], source: "natural-language" };
  if (containsPlainWord(normalized, "start") && containsPlainWord(normalized, "work") && !hasTrailingLitInvocation(normalized)) return undefined;
  return { ...triggerByToken["lit-loop"], source: "natural-language", softConfirm: bareLitPattern.test(raw) };
};

const findWorkflowTrigger = (prompt) => {
  const raw = rawTriggerText(prompt);
  const dollarTrigger = findDollarCommandTrigger(raw);
  if (dollarTrigger) return dollarTrigger;
  if (/(?:^|\s)\$start-work(?=$|[^\w-])/u.test(raw) && !hasTrailingLitInvocation(raw)) return undefined;
  if (containsSlashCommandMention(raw)) return undefined;
  // Ahead of the leading-bare check on purpose: `litwork comprehend` would otherwise match
  // the bare `litwork` token first and inject the wrong body. A two-token phrase names the
  // route more specifically than either token alone, so it wins.
  const comprehendPhraseTrigger = findComprehendPhraseTrigger(raw);
  if (comprehendPhraseTrigger) return comprehendPhraseTrigger;
  const adhdPhraseTrigger = findAdhdPhraseTrigger(raw);
  if (adhdPhraseTrigger) return adhdPhraseTrigger;
  const bareCommandTrigger = findLeadingBareCommandTrigger(raw);
  if (bareCommandTrigger) return bareCommandTrigger;
  const trailingRunTrigger = findTrailingRunTokenTrigger(raw);
  if (trailingRunTrigger) return trailingRunTrigger;
  for (const token of ["lit-crucible", "lit-init", "lit-burnoff", "lit-burnoff-file"]) {
    if (containsCompoundBoundedWord(raw, token)) return { ...triggerByToken[token], source: "bare-command" };
    const oldId = Object.keys(renameAliases).find((id) => renameAliases[id] === token);
    if (oldId && containsCompoundBoundedWord(raw, oldId)) return { ...triggerByToken[oldId], source: "bare-command" };
  }
  const recapTrigger = findRecapTrigger(raw);
  if (recapTrigger) return recapTrigger;
  const naturalTrigger = findNaturalLitTrigger(prompt);
  if (naturalTrigger) return naturalTrigger;
  // Last resort, and the only route that fires with no lit-family token at all. A design
  // request is the one case where waiting for the user to name LitClaude defeats the point:
  // by the time they know to ask for the interface skill, the CSS is already written.
  // Runs AFTER the whole lit cascade, so it can never hijack an explicit lit route.
  // A motion-video request is not an interface request; with no `lit` it activates nothing, since
  // there is deliberately no token-free motion route.
  if ((hasUiDesignIntent(normalizedTriggerText(prompt)) || hasUiModeIntent(normalizedTriggerText(prompt))) && !hasMotionVideoIntent(normalizedTriggerText(prompt))) {
    return { ...triggerByToken["frontend-ui-ux"], source: "natural-language" };
  }
  if (hasStructuralSearchIntent(normalizedTriggerText(prompt))) {
    return { ...triggerByToken["structural-search"], source: "natural-language" };
  }
  return undefined;
};

// The suggestion tier (no `lit` needed). It never starts a workflow and never changes the route above: for a
// prompt without `lit` it returns every skill whose rule fires, in table order, with no cap, and the hook
// offers them as candidates plus "none" for the model to accept or drop one by one. Each rule is a
// conjunction or a strong phrase, kept only while test/fixtures/routing-eval scores it at recall >= 0.85
// and near-miss false positives <= 0.10 on both halves (tools/routing-eval.mjs). Korean stems are bare
// substrings, as at the UI route.
const knowledgeQuestion = /^\s*(?:what\s+(?:is|are|does)|what's|how\s+(?:does|do)|explain|define)\b|\b(?:explain|difference\s+between|definition)\b|뭐야|뭔지|무슨\s?뜻|뜻이|설명해|설명만|차이가?\s?뭐|어떻게\s?(?:동작|돌아가|진행해|시작해)/u;
const webArtifact = /\b(?:react|component|web\s?app|website|dashboard|landing\s?page)\b|컴포넌트|웹앱|웹\s?화면|대시보드/u;

// Shipped rules only. Rules that missed recall >= 0.85 or near-miss FP <= 0.10 on either half were dropped
// (.litclaude/evidence/2026-11-26-autopilot-routing-xlsx/task-7.json lists them); a new rule joins only after it
// passes both halves.
const SUGGESTION_RULES = [
  ["wikify", (n) => !knowledgeQuestion.test(n) && !/wikipedia|mediawiki|위키\s?백과/u.test(n) && /\bwiki\b|\bknowledge\s+base\b|위키/u.test(n)],
  ["visual-qa", (n) => !knowledgeQuestion.test(n) && !/용량|\bfile\s+size\b|\bcompress\b/u.test(n)
    && /\bscreenshots?\b|\bbreakpoints?\b|\bviewports?\b|\bmobile\b[^.?!]{0,40}\bdesktop\b|\blayout\s+breakage\b|\bon\s+(?:mobile|phone|tablet)\b[^.?!]{0,30}\b(?:check|looks?|broken)\b|\b(?:check|looks?|broken)\b[^.?!]{0,30}\bon\s+(?:mobile|phone|tablet)\b|모바일에서\s?(?:확인|깨지)|반응형\s?(?:확인|점검)|\bclipped\s+text\b|스크린샷|캡처|시각적으로\s?검수|텍스트\s?잘림|깨지는\s?(?:거|데)/u.test(n)],
  ["lit-typographic-motion", (n) => hasMotionVideoIntent(n) || /\bshort\s+(?:kinetic\s+type\s+)?film\b|\bkinetic\s+(?:type|typography)\b|키네틱|루프\s?커버\s?영상/u.test(n)],
  ["lit-diagram-drawer", (n) => !schematicStrongNoun.test(n) && (diagramNoun.test(n) || /\bconceptual\s+figure\b|개요도|개념도/u.test(n))
    && (schematicDrawVerb.test(n) || schematicMakeVerb.test(n) || officeVerb.test(n))],
  ["lit-scientific-visualization", (n) => vizNoun.test(n) && (vizCue.test(n) || schematicDrawVerb.test(n)) && !webArtifact.test(n) && !diagramNoun.test(n)],
];

/** Every skill id the suggestion tier offers for a prompt without `lit`, in table order; [] when none fires. */
const suggestedSkills = (prompt) => {
  if (typeof prompt !== "string") return [];
  const raw = rawTriggerText(prompt);
  if (hasLitTrigger(raw) || containsSlashCommandMention(raw)) return [];
  const normalized = normalizedTriggerText(prompt);
  if (!normalized.trim()) return [];
  return SUGGESTION_RULES.filter(([, fires]) => fires(normalized)).map(([id]) => id);
};

// A review modifier anywhere in the prompt makes dual plan review REQUIRED, not optional.
// Korean "고정밀" is included because the trigger vocabulary is bilingual; the match runs on
// code-stripped text so a quoted example in a fence cannot arm the gate.
const reviewModifierPattern = /high[-\s]?accuracy|고정밀|deep\s+review|rigorous\s+review|strict\s+review/iu;

const hasReviewModifier = (prompt) => reviewModifierPattern.test(withoutCode(typeof prompt === "string" ? prompt : ""));

// explainRoute mirrors the findWorkflowTrigger cascade as an ordered rule list so it can name the rule
// that won and the next rule that also matched. The route itself always comes from findWorkflowTrigger;
// the rule list only explains it, and test/route-why.test.mjs holds the two together. A stop rule ends
// the cascade (`all`) or only the bare-lit part of it (`natural`) without choosing a route. Rules marked
// `lit` run only when the prompt carries `lit`/`litwork`, as findNaturalLitTrigger requires.
const routeOf = (token) => triggerByToken[token];
const namedRuleId = (prefix, trigger) => `${prefix}:${trigger.renameFrom ?? trigger.agentId ?? trigger.movedFrom ?? trigger.skillId}`;
const ROUTE_RULES = [
  { id: (trigger) => namedRuleId("dollar-command", trigger), match: ({ raw }) => findDollarCommandTrigger(raw) },
  { id: "stop:start-work-not-leading", stop: "all", match: ({ raw }) => /(?:^|\s)\$start-work(?=$|[^\w-])/u.test(raw) && !hasTrailingLitInvocation(raw) },
  { id: "stop:slash-command-mention", stop: "all", match: ({ raw }) => containsSlashCommandMention(raw) },
  { id: "phrase:lit-comprehend", match: ({ raw }) => findComprehendPhraseTrigger(raw) },
  { id: "phrase:lit-adhd", match: ({ raw }) => findAdhdPhraseTrigger(raw) },
  { id: (trigger) => namedRuleId("bare-command", trigger), match: ({ raw }) => findLeadingBareCommandTrigger(raw) },
  { id: (trigger) => namedRuleId("trailing-command", trigger), match: ({ raw }) => findTrailingRunTokenTrigger(raw) },
  {
    id: (trigger) => namedRuleId("token", trigger),
    match: ({ raw }) => {
      for (const token of ["lit-crucible", "lit-init", "lit-burnoff", "lit-burnoff-file"]) {
        if (containsCompoundBoundedWord(raw, token)) return routeOf(token);
        const oldId = Object.keys(renameAliases).find((id) => renameAliases[id] === token);
        if (oldId && containsCompoundBoundedWord(raw, oldId)) return routeOf(oldId);
      }
      return undefined;
    },
  },
  { id: "recap:lit-recap", match: ({ raw }) => findRecapTrigger(raw) },
  { id: "token:litresearch", match: ({ raw }) => containsCompoundBoundedWord(raw, "litresearch") && routeOf("litresearch") },
  { id: "natural:team", lit: true, match: ({ normalized }) => hasExplicitTeamRoute(normalized) && routeOf("agent-team") },
  { id: "natural:workflow", lit: true, match: ({ normalized }) => hasExplicitWorkflowRoute(normalized) && routeOf("native-workflow") },
  { id: "natural:ultra-brainstorm", lit: true, match: ({ normalized }) => hasExplicitUltraBrainstormRoute(normalized) && routeOf("ultra-brainstorm") },
  { id: "natural:brainstorm", lit: true, match: ({ normalized }) => hasExplicitBrainstormRoute(normalized) && routeOf("lit-brainstorm") },
  { id: "natural:hijack", lit: true, match: ({ normalized }) => hasExplicitHijackRoute(normalized) && routeOf("lit-hijack") },
  { id: "natural:deep-interview", lit: true, match: ({ normalized }) => hasExplicitInterviewRoute(normalized) && routeOf("deep-interview") },
  { id: "natural:crucible", lit: true, match: ({ normalized }) => hasExplicitCrucibleRoute(normalized) && routeOf("lit-crucible") },
  { id: "natural:plan-review-modifier", lit: true, match: ({ normalized, prompt }) => containsPlainWord(normalized, "plan") && hasReviewModifier(prompt) && routeOf("lit-plan") },
  { id: "natural:review-plan", lit: true, match: ({ normalized }) => isReviewPlanPhrase(normalized) && routeOf("review-plan") },
  { id: "natural:review", lit: true, match: ({ normalized }) => (containsPlainWord(normalized, "review") || koreanReviewWord.test(normalized)) && routeOf("review-work") },
  { id: "natural:debug", lit: true, match: ({ normalized }) => (containsPlainWord(normalized, "debug") || containsPlainWord(normalized, "debugging") || koreanDebugWord.test(normalized)) && routeOf("debugging") },
  { id: "natural:start-work", lit: true, match: ({ normalized }) => /^\s*lit(?:work)?\s+start\s+work(?=$|[^\w-])/u.test(normalized) && routeOf("start-work") },
  { id: "natural:schematic-film", lit: true, match: ({ normalized }) => schematicStrongNoun.test(normalized) && hasMotionVideoIntent(normalized) && routeOf("lit-schematic") },
  { id: "natural:motion", lit: true, match: ({ normalized }) => hasMotionVideoIntent(normalized) && routeOf("lit-typographic-motion") },
  {
    id: "natural:schematic",
    lit: true,
    match: ({ normalized }) => {
      const interfaceDeliverable = hasUiDesignIntent(normalized) && schematicInterfaceNoun.test(normalized) && !schematicDrawVerb.test(normalized);
      return hasSchematicIntent(normalized) && !interfaceDeliverable && !schematicChartNoun.test(normalized)
        && (schematicDrawVerb.test(normalized) || officeIntent(normalized).length === 0) && routeOf("lit-schematic");
    },
  },
  { id: "natural:office", lit: true, match: ({ normalized }) => routeOf(officeIntent(normalized)[0]) },
  { id: "natural:research", lit: true, match: ({ normalized }) => hasExplicitResearchRoute(normalized) && routeOf("litresearch") },
  { id: "natural:goal", lit: true, match: ({ normalized }) => containsPlainWord(normalized, "goal") && routeOf("litgoal") },
  { id: "natural:plan", lit: true, match: ({ normalized }) => (containsPlainWord(normalized, "plan") || koreanPlanWord.test(normalized)) && routeOf("lit-plan") },
  { id: "natural:interface", lit: true, match: ({ normalized }) => (hasUiDesignIntent(normalized) || hasUiModeIntent(normalized)) && routeOf("frontend-ui-ux") },
  { id: "natural:structural-search", lit: true, match: ({ normalized }) => hasStructuralSearchIntent(normalized) && routeOf("structural-search") },
  { id: "stop:start-work-words", stop: "natural", lit: true, match: ({ normalized }) => containsPlainWord(normalized, "start") && containsPlainWord(normalized, "work") && !hasTrailingLitInvocation(normalized) },
  { id: "natural:lit-loop", lit: true, fallback: true, match: () => routeOf("lit-loop") },
  { id: "untokened:interface", match: ({ normalized }) => (hasUiDesignIntent(normalized) || hasUiModeIntent(normalized)) && !hasMotionVideoIntent(normalized) && routeOf("frontend-ui-ux") },
  { id: "untokened:structural-search", match: ({ normalized }) => hasStructuralSearchIntent(normalized) && routeOf("structural-search") },
];

// `{route, ruleId, runnerUp, inert}` for one prompt. route is the discipline the hook ignites (null for
// none); runnerUp is the next non-fallback rule that matched a different route. inert is true when no
// route fired because text was set aside (a fence, inline code, a host block) or a stop rule held.
// An exact `handoff` / `lit handoff` is reported as the hook answers it. Other routes the hook decides
// before this cascade (a `lit +…` skill plan, start-work invocations and replies) are outside it.
// A bare-lit route that does one part of the work runs as lit-loop, the route the cascade chose becoming the
// plan's first companion (lib/skill-plan.mjs); `cascadeRoute` keeps that route, and ruleId still names its rule.
export const explainRoute = (prompt) => {
  const explained = explainCascade(prompt);
  if (typeof prompt !== "string" || !explained.route || parseSkillHatch(rawTriggerText(prompt), prompt)) return explained;
  const trigger = findWorkflowTrigger(prompt);
  if (trigger?.source !== "natural-language" || trigger.safetyBlock || !hasLitTrigger(rawTriggerText(prompt)) || !UNDER_LOOP.has(trigger.skillId)) return explained;
  return { ...explained, route: LOOP_BASE, cascadeRoute: explained.route };
};

const explainCascade = (prompt) => {
  if (typeof prompt !== "string") return { route: null, ruleId: null, runnerUp: null, inert: false };
  if (isExactBareHandoff(prompt)) return { route: "lit-handoff", ruleId: "exact:handoff", runnerUp: null, inert: false };
  const route = findWorkflowTrigger(prompt)?.discipline ?? null;
  const raw = rawTriggerText(prompt);
  const context = { prompt, raw, normalized: normalizedTriggerText(prompt), lit: hasLitTrigger(raw) };
  let winner = null;
  let runnerUp = null;
  let stopId = null;
  let naturalStopped = false;
  for (const rule of ROUTE_RULES) {
    if (rule.lit && !context.lit) continue;
    const hit = rule.match(context);
    if (!hit) continue;
    if (rule.stop) {
      if (!winner && !stopId) {
        if (rule.stop === "all") stopId = rule.id;
        else naturalStopped = true;
      }
      continue;
    }
    const found = { route: hit.discipline, ruleId: typeof rule.id === "function" ? rule.id(hit) : rule.id };
    if (!winner && !stopId && !(naturalStopped && rule.lit)) winner = found;
    else if (!runnerUp && !rule.fallback && found.route !== (winner?.route ?? null)) runnerUp = found;
  }
  const setAside = withoutCode(withoutHostNotifications(prompt)) !== prompt.replace(/\r\n|\r/gu, "\n");
  if (route !== null) return { route, ruleId: winner?.route === route ? winner.ruleId : "unattributed", runnerUp, inert: false };
  if (winner) return { route, ruleId: "unattributed", runnerUp, inert: false };
  const held = stopId ?? (naturalStopped ? "stop:start-work-words" : null);
  return { route, ruleId: held ?? (setAside ? "inert:set-aside" : null), runnerUp, inert: held !== null || setAside };
};

export {
  bareLitPattern,
  containsSlashCommandMention,
  findNaturalLitTrigger,
  findWorkflowTrigger,
  hasLitTrigger,
  hasReviewModifier,
  isExactBareHandoff,
  isReviewPlanPhrase,
  litPlanCompanions,
  naturalLitCompanions,
  normalizedTriggerText,
  rawTriggerText,
  restartLitPattern,
  resumeLitPattern,
  suggestedSkills,
  triggerByToken,
  withoutCode,
  withoutHostNotifications,
  withoutTeammateMessages,
};
