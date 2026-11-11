import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skillsRoot = join(root, "plugins", "litclaude", "skills");
const topLevelSkillCorpusWordFloor = 41_270;
const contractHeadings = [
  "## #contract.activation",
  "## #contract.inputs",
  "## #contract.mode_matrix",
  "## #contract.procedure",
  "## #contract.outputs",
  "## #contract.evidence",
  "## #contract.hard_stops",
  "## #contract.anti_patterns",
];
const expectedSkills = [
  "lit-burnoff-file",
  "autoconference",
  "autoresearch",
  "browser-drive",
  "comment-checker",
  "debugging",
  "deep-interview",
  "frontend-ui-ux",
  "readme-studio",
  "lit-commit",
  "lit-crucible",
  "lit-diagram-drawer",
  "lit-schematic",
  "lit-docx",
  "lit-init",
  "lsp",
  "lsp-setup",
  "lit-code",
  "refactor",
  "lit-burnoff",
  "review-work",
  "rules",
  "start-work",
  "structural-search",
  "lit-team",
  "litgoal",
  "litresearch",
  "litwork",
  "lit-loop",
  "lit-plan",
  "lit-pptx",
  "lit-recap",
  "lit-typographic-motion",
  "lit-comprehend",
  "lit-adhd",
  "lit-brainstorm",
  "lit-handoff",
  "lit-hijack",
  "lit-humanizer",
  "lit-scientific-visualization",
  "visual-qa",
  "wikify",
];
const bannedPatterns = [/spawn_agent/u, /apply_patch/u, new RegExp(`codex-${"ultra"}${"work"}`, "u"), /Codex Harness/u];

const bodyWithoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n?/u, "");

const assertLlmContract = (text, label) => {
  const body = bodyWithoutFrontmatter(text).trimStart();
  assert.ok(body.startsWith("## #contract.activation"), `${label} should be contract-first after frontmatter`);

  let previousIndex = -1;
  for (const heading of contractHeadings) {
    const index = text.indexOf(heading);
    assert.notEqual(index, -1, `${label} missing ${heading}`);
    assert.ok(index > previousIndex, `${label} should keep ${heading} in schema order`);
    previousIndex = index;
  }

  assert.match(
    text,
    /```yaml\n[\s\S]*?contract_schema_version:\s*litclaude\.llm-contract\.v1[\s\S]*?artifact_type:\s*skill[\s\S]*?```/u,
    `${label} should expose the stable skill contract schema as fenced yaml`,
  );
  assert.match(text, /^\|[^\n]+\|\n\|[-:| ]+\|/mu, `${label} should contain a markdown contract table`);
  assert.match(text, /PASS|FAIL|BLOCKED/u, `${label} should declare machine-readable verdict terms`);
};

describe("Claude skills", () => {
  it("litresearch.phase-3b-and-attribution-move-together", () => {
    // The licence coupling is the point of this test. The repo was self-consistent while
    // NEITHER was present; shipping the gate without the notice is an MIT violation, and
    // shipping the notice without the gate leaves a dead credit. Either both or neither.
    const skillPath = join(skillsRoot, "litresearch", "SKILL.md");
    const attributionPath = join(skillsRoot, "litresearch", "ATTRIBUTION.md");
    const skill = readFileSync(skillPath, "utf8");
    const hasGate = /## Phase 3b/u.test(skill);
    const hasAttribution = existsSync(attributionPath);

    assert.equal(
      hasGate,
      hasAttribution,
      hasGate
        ? "Phase 3b ships without ATTRIBUTION.md — that is a licence violation"
        : "ATTRIBUTION.md ships without Phase 3b — remove the notice or restore the gate",
    );

    if (!hasGate) return;

    // The gate's four load-bearing conditions.
    assert.match(skill, /2 independent source domains/u);
    assert.match(skill, /2 independent observation groups/u);
    assert.match(skill, /counter-search/u);
    assert.match(skill, /primary source/iu);
    assert.match(skill, /Unresolved/u);
    assert.match(skill, /Refuted/u);
    assert.match(skill, /claim-graph\.md/u);
    // Root-owned: subagents return message text, never write the graph.
    assert.match(skill, /read-only.*never by writing a file|never by writing a file/isu);
    // The gate must point at its own notice.
    assert.match(skill, /ATTRIBUTION\.md/u);

    // The notice must carry the credit, the source, and the licence text itself.
    const attribution = readFileSync(attributionPath, "utf8");
    assert.match(attribution, /fivetaku/u);
    assert.match(attribution, /insane-research/u);
    assert.match(attribution, /github\.com\/fivetaku\/insane-research/u);
    assert.match(attribution, /MIT License/u);
    assert.match(attribution, /Copyright \(c\) 2026 fivetaku/u);
    assert.match(attribution, /permission notice shall be included/u);
    assert.match(attribution, /THE SOFTWARE IS PROVIDED "AS IS"/u);
    // It must be honest that only an idea was adapted, with no vendored code.
    assert.match(attribution, /no third-party source code is vendored/iu);

    // The deliberate-non-port list must no longer imply the gate was dropped.
    assert.match(skill, /Phase 3b claim-graph gate is \*\*not\*\* on this list/u);
  });

  it("ships every MVP skill with Claude-compatible frontmatter", () => {
    for (const skillName of expectedSkills) {
      const path = join(skillsRoot, skillName, "SKILL.md");
      assert.equal(existsSync(path), true, `${skillName} must have SKILL.md`);

      const text = readFileSync(path, "utf8");
      assert.match(text, /^---\n[\s\S]*description:/u, `${skillName} must declare a description`);
      assert.match(text, new RegExp(`name:\\s*${skillName}`, "u"), `${skillName} must declare its name`);
    }
  });

  it("does not contain incompatible tool instructions", () => {
    for (const skillName of expectedSkills) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      for (const pattern of bannedPatterns) {
        assert.equal(pattern.test(text), false, `${skillName} contains banned pattern ${pattern}`);
      }
    }
  });

  it("ships a substantive LitClaude skill corpus instead of short placeholders", () => {
    let totalLines = 0;

    for (const skillName of expectedSkills) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      const lines = text.trim().split(/\r?\n/u).length;
      totalLines += lines;

      assert.ok(lines >= 30, `${skillName} should carry substantive guidance, got ${lines} lines`);
      assert.match(text, /## /u, `${skillName} should be structured with actionable sections`);
      assert.match(text, /Claude Code|LitClaude|Manual QA|TDD|diagnostics|workflow|evidence|rules|review|refactor|comments/iu, `${skillName} should be adapted to Claude/LitClaude execution`);
    }

    assert.ok(totalLines >= 1000, `LitClaude skills should be richly developed, got only ${totalLines} total lines`);
  });

  it("uses the stable LLM contract schema in every plugin skill entrypoint", () => {
    for (const skillName of expectedSkills) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");
      assertLlmContract(text, `Skill(${skillName})`);
    }
  });

  it("keeps the top-level skill word corpus above the reference floor", () => {
    const skillFiles = readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(skillsRoot, entry.name, "SKILL.md"))
      .filter((path) => existsSync(path));

    const totalWords = skillFiles.reduce((total, path) => {
      const words = readFileSync(path, "utf8").trim().split(/\s+/u).filter(Boolean).length;
      return total + words;
    }, 0);

    assert.ok(
      totalWords >= topLevelSkillCorpusWordFloor,
      `LitClaude top-level SKILL.md corpus should have at least ${topLevelSkillCorpusWordFloor} whitespace-token words, got ${totalWords}`,
    );
  });

  it("ships auxiliary reference packs and original skill aliases", () => {
    const programmingReferenceFiles = [
      "references/typescript/README.md",
      "references/python/README.md",
      "references/rust/README.md",
      "references/go/README.md",
      "scripts/typescript/check-no-excuse-rules.ts",
      "scripts/python/check-no-excuse-rules.py",
      "scripts/rust/check-no-excuse-rules.py",
      "scripts/go/check-no-excuse-rules.sh",
    ];
    const debuggingReferenceFiles = [
      "references/methodology/00-setup.md",
      "references/methodology/02-investigate.md",
      "references/methodology/04-oracle-triple.md",
      "references/methodology/08-qa.md",
      "references/runtimes/node.md",
      "references/runtimes/python.md",
      "references/tools/playwright-cli.md",
    ];

    for (const relativePath of programmingReferenceFiles) {
      assert.equal(existsSync(join(skillsRoot, "lit-code", relativePath)), true, `missing programming ${relativePath}`);
    }
    for (const relativePath of debuggingReferenceFiles) {
      assert.equal(existsSync(join(skillsRoot, "debugging", relativePath)), true, `missing debugging ${relativePath}`);
    }

    const alias = readFileSync(join(skillsRoot, "lit-burnoff-file", "SKILL.md"), "utf8");
    assert.match(alias, /name:\s*lit-burnoff-file/u);
    assert.match(alias, /SINGLE file/u);
  });

  it("preserves the core workflow disciplines in Claude-native wording", () => {
    const programming = readFileSync(join(skillsRoot, "lit-code", "SKILL.md"), "utf8");
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");
    const refactor = readFileSync(join(skillsRoot, "refactor", "SKILL.md"), "utf8");
    const litgoalSkill = readFileSync(join(skillsRoot, "litgoal", "SKILL.md"), "utf8");
    const rules = readFileSync(join(skillsRoot, "rules", "SKILL.md"), "utf8");

    assert.match(programming, /Parse, don't validate/u);
    assert.match(programming, /TDD DISCIPLINE/u);
    assert.match(programming, /250.*LOC/u);
    assert.match(programming, /BUILD-DECISION GATE/u);
    assert.match(programming, /does this need to exist at all/iu);
    assert.match(reviewWork, /Findings first/u);
    assert.match(reviewWork, /Manual QA/u);
    assert.match(refactor, /characterization/i);
    assert.match(refactor, /behavior-preserving/i);
    assert.match(litgoalSkill, /success criteria/i);
    assert.match(litgoalSkill, /ledger/i);
    assert.match(litgoalSkill, /Manual-QA channels/u);
    assert.match(rules, /lit search/u);
    assert.match(rules, /lit query/u);
  });

  it("requires review-work to orchestrate five evidence lanes with aggregation", () => {
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");

    for (const lane of [
      /scope\/diff verification/i,
      /tests\/evidence execution/i,
      /package\/payload and code quality/i,
      /security\/provenance/i,
      /real-surface\/docs readiness/i,
    ]) {
      assert.match(reviewWork, lane, `review-work should define lane ${lane}`);
    }

    assert.match(reviewWork, /5-lane|five-lane/i);
    assert.match(reviewWork, /verdict table/i);
    assert.match(reviewWork, /aggregation rules?/i);
    assert.match(reviewWork, /launch prompts?/i);
    assert.match(reviewWork, /local-only readiness mining/i);
    assert.match(reviewWork, /external connector opt-in/i);
    assert.match(reviewWork, /PASS|FAIL|BLOCKED/u);
  });

  it("requires litgoal to define durable runtime file contracts", () => {
    const litgoalText = readFileSync(join(skillsRoot, "litgoal", "SKILL.md"), "utf8");

    for (const contract of [
      /plugins\/litclaude\/lib\/litgoal\//u,
      /\.litclaude\/litgoal\/brief\.md/u,
      /\.litclaude\/litgoal\/goals\.json/u,
      /\.litclaude\/litgoal\/ledger\.jsonl/u,
      /atomic/i,
      /lock-safe|concurrent/i,
      /quality gate/i,
      /checkpoint/i,
      /steer/i,
    ]) {
      assert.match(litgoalText, contract, `litgoal should document ${contract}`);
    }
  });

  it("ships Claude-native goal integration in lit skills", () => {
    for (const skillName of ["lit-loop", "lit-plan", "start-work", "litgoal"]) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      assert.match(text, /get_goal/u, `${skillName} should inspect native goal state when available`);
      assert.match(text, /create_goal/u, `${skillName} should create native goal state when available`);
      assert.match(text, /update_goal/u, `${skillName} should defer goal completion until verification passes`);
      assert.match(text, /\/goal/u, `${skillName} should mention Claude Code's native goal surface`);
      assert.match(text, /goal tools are unavailable|goal tools are not exposed|not expose model-facing goal tools/iu, `${skillName} should define a no-goal-tool fallback`);
      assert.match(text, /BLOCKED:/u, `${skillName} should report degraded mode explicitly`);
      assert.match(text, /degraded mode|degraded-mode/i, `${skillName} should name degraded mode`);
      assert.match(text, /without\s+explicit replacement/i, `${skillName} should avoid goal clobbering`);
      // lit-plan and start-work no longer offer a /goal line before execution (plans/lit-adhd.md todo 9).
      if (["lit-loop", "litgoal"].includes(skillName)) {
        assert.match(text, /claude -p "\/goal/u, `${skillName} should document native non-interactive goal surface`);
      }
      if (skillName !== "litgoal") {
        assert.match(text, /Dynamic workflow/u, `${skillName} should guide Claude Code Dynamic workflows`);
        assert.match(text, /Dynamic worktree/u, `${skillName} should guide worktree isolation`);
        assert.match(text, /call `Workflow`|call the `Workflow` tool/u, `${skillName} should call Workflow when Claude Code exposes it`);
        assert.match(text, /EnterWorktree/u, `${skillName} should mention the model-facing worktree tool when exposed`);
        assert.match(text, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1|native agent teams/i, `${skillName} should gate native team mode`);
        assert.match(text, /claude --worktree/u, `${skillName} should give an actionable Dynamic worktree launch path`);
        assert.match(text, /--tmux/u, `${skillName} should mention the tmux native workflow path`);
      }
      assert.doesNotMatch(text, /auto-?type\s+\/goal/iu, `${skillName} must not claim LitClaude types /goal`);
      assert.doesNotMatch(text, /send\s+\/goal/iu, `${skillName} must not tell Claude to send /goal text`);
    }
  });

  it("requires lit execution skills to preserve strict evidence discipline", () => {
    for (const skillName of ["lit-loop", "lit-plan", "start-work"]) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      for (const contract of [
        /Bootstrap/u,
        /PIN/u,
        /RED/u,
        /GREEN/u,
        /SURFACE/u,
        /Manual-QA/u,
        /cleanup receipt/u,
        /reviewer/i,
        /Stop rules/u,
        /stale state/i,
        /dirty worktree/i,
        /resume/i,
        /bounded/i,
        /commit\/push/i,
        /publish/i,
      ]) {
        assert.match(text, contract, `${skillName} should document strict lit contract ${contract}`);
      }
    }
  });

  it("pins the latest prompt and mode contract across lit workflow skills", () => {
    const litLoop = readFileSync(join(skillsRoot, "lit-loop", "SKILL.md"), "utf8");
    const litPlan = readFileSync(join(skillsRoot, "lit-plan", "SKILL.md"), "utf8");
    const startWork = readFileSync(join(skillsRoot, "start-work", "SKILL.md"), "utf8");
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");
    const litresearch = readFileSync(join(skillsRoot, "litresearch", "SKILL.md"), "utf8");
    const litgoal = readFileSync(join(skillsRoot, "litgoal", "SKILL.md"), "utf8");

    assert.match(litLoop, /durable, evidence-driven execution loop/i);
    assert.match(litLoop, /tests are necessary but not\s+sufficient/i);
    assert.match(litLoop, /dirty worktree/i);
    assert.match(litLoop, /prompt injection/i);
    assert.match(litLoop, /repeated interruptions/i);

    assert.match(litPlan, /planning-only/i);
    assert.match(litPlan, /must not implement/i);
    assert.match(litPlan, /must not edit files/i);
    assert.match(litPlan, /Do not call[\s\S]*start-work\s+tool/i);
    assert.match(litPlan, /\/start-work/u);

    assert.match(startWork, /approved plan/i);
    assert.match(startWork, /execution-only/i);
    assert.match(startWork, /do not redesign/i);
    assert.match(startWork, /DoneClaim/u);

    assert.match(reviewWork, /scope\/diff/i);
    assert.match(reviewWork, /tests\/evidence/i);
    assert.match(reviewWork, /package\/payload/i);
    assert.match(reviewWork, /security\/provenance/i);
    assert.match(reviewWork, /real-surface\/docs/i);

    assert.match(litresearch, /material findings[\s\S]*internal journal/i);
    assert.match(litresearch, /verified facts/i);
    assert.match(litresearch, /hypotheses/i);
    assert.match(litresearch, /decision-changing uncertainty once/i);
    assert.match(litresearch, /artifact_genre: client_deliverable[\s\S]*limitations_channel: reply/i);
    assert.match(litresearch, /validator-first/i);
    assert.match(litresearch, /route trace/i);
    assert.match(litresearch, /public API|public feed/i);
    assert.match(litresearch, /SSRF/i);
    assert.match(litresearch, /A\/B/i);
    assert.match(litresearch, /FetchAttempt/u);
    assert.match(litresearch, /FetchVerdict/u);
    assert.match(litresearch, /HTTP 200 is not enough/u);
    assert.match(litresearch, /claim\/source\/confidence\/uncertainty/i);
    assert.match(litresearch, /untried routes/i);
    assert.match(litresearch, /read-only/i);
    assert.match(litresearch, /transcript-only/i);
    assert.match(litresearch, /ask before writing/i);
    assert.match(litresearch, /host-dependent/i);
    assert.match(litresearch, /guaranteed runtime surface/i);
    assert.match(litresearch, /agent-level guidance/i);
    assert.match(litresearch, /names an item without explaining it[\s\S]{0,240}live lead on every tier/i);
    assert.match(litresearch, /uncertainty line is for a gap you tried to close and could not/i);

    assert.match(litgoal, /one outcome-shaped objective/i);
    assert.match(litgoal, /checkable criteria/i);
    assert.match(litgoal, /scenario/i);
    assert.match(litgoal, /observable evidence/i);
  });

  it("hardens orchestration skills with a Claude subagent assignment contract", () => {
    for (const skillName of ["lit-loop", "lit-plan", "start-work", "review-work"]) {
      const text = readFileSync(join(skillsRoot, skillName, "SKILL.md"), "utf8");

      for (const contract of [
        /TASK:/u,
        /DELIVERABLE/u,
        /SCOPE/u,
        /VERIFY/u,
        /background/i,
        /short wait/i,
        /timeout/i,
        /missing deliverable/i,
        /BLOCKED:/u,
        /fallback/i,
        /reviewer role/i,
        /not a generic worker/i,
      ]) {
        assert.match(text, contract, `${skillName} should document subagent reliability contract ${contract}`);
      }
    }
  });

  it("keeps litresearch command aligned with read-only and host-boundary safeguards", () => {
    const command = readFileSync(new URL("../plugins/litclaude/commands/litresearch.md", import.meta.url), "utf8");

    assert.match(command, /read-only/i);
    assert.match(command, /transcript-only/i);
    assert.match(command, /ask before writing/i);
    assert.match(command, /host-dependent/i);
    assert.match(command, /guaranteed runtime surface/i);
    assert.match(command, /Keep exact files inspected[\s\S]*internal evidence packet/i);
    assert.match(command, /decision-changing uncertainty once/i);
    assert.match(command, /internal synthesis[\s\S]*reader-facing answer/i);
  });

  it("requires LitResearch scientific records, root ownership, coverage, and deliberate non-ports", () => {
    const skill = readFileSync(join(skillsRoot, "litresearch", "SKILL.md"), "utf8");
    const command = readFileSync(new URL("../plugins/litclaude/commands/litresearch.md", import.meta.url), "utf8");

    for (const [surface, text] of [["skill", skill], ["command", command]]) {
      assert.match(text, /root-owned|main session owns/iu, `${surface} should keep the research journal root-owned`);
      assert.match(text, /sequential fallback/iu, `${surface} should define a root sequential fallback`);
      assert.match(text, /stable claim ID/iu, `${surface} should require stable claim identifiers`);
      for (const edge of ["supports", "contradicts", "depends_on", "duplicates"]) {
        assert.match(text, new RegExp(`\\b${edge}\\b`, "u"), `${surface} should define the ${edge} evidence edge`);
      }
      assert.match(text, /DOI normalization/iu, `${surface} should normalize DOI identities`);
      assert.match(text, /deduplicat/iu, `${surface} should deduplicate scientific records`);
      assert.match(text, /%PDF/u, `${surface} should require PDF byte proof`);
      for (const state of ["metadata", "acquisition", "conversion", "review"]) {
        assert.match(text, new RegExp(`\\b${state}\\b`, "iu"), `${surface} should keep ${state} state explicit`);
      }
      assert.match(text, /needs_review/u, `${surface} should retain deterministic-output review debt`);
      assert.match(text, /routeCoverageComplete/u, `${surface} should distinguish route exhaustion from access failure`);
      assert.match(text, /Deliberate non-port contract/iu, `${surface} should name the intentional compatibility boundary`);
      assert.match(text, /client or TLS identity/iu, `${surface} should refuse identity mutation`);
      assert.match(text, /proxy rotation/iu, `${surface} should refuse proxy rotation`);
      assert.match(text, /credential replay/iu, `${surface} should refuse credential replay`);
      assert.match(text, /cross-package runtime/iu, `${surface} should preserve package independence`);
    }
  });

  it("requires lit-plan and review surfaces to enforce minimum-first planning", () => {
    const litPlan = readFileSync(join(skillsRoot, "lit-plan", "SKILL.md"), "utf8");
    const reviewWork = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8");
    const qualityReviewer = readFileSync(join(root, "plugins", "litclaude", "agents", "quality-reviewer.md"), "utf8");

    assert.match(litPlan, /minimum-first/i);
    assert.match(litPlan, /reuse existing code/i);
    assert.match(litPlan, /single-task or few-task/i);
    assert.doesNotMatch(litPlan, /fewer than 3 means under-splitting/i);

    for (const text of [reviewWork, qualityReviewer]) {
      assert.match(text, /minimum-first/i);
      assert.match(text, /avoidable custom code/i);
      assert.match(text, /unnecessary helpers?|unnecessary helper/i);
      assert.match(text, /external-source/i);
    }
  });

});


describe("design-production enrollment", () => {
  it("enrolls README Studio with pinned executable and template closure", async () => {
    const { canonicalSkillIds, canonicalSkillResourceFiles } = await import("../plugins/litclaude/lib/canonical-skill-catalog.mjs");
    assert.ok(canonicalSkillIds.includes("readme-studio"), "README Studio must be discoverable by the installed catalog");
    const body = readFileSync(join(skillsRoot, "readme-studio", "SKILL.md"), "utf8");
    assertLlmContract(body, "readme-studio");
    assert.match(body, /^name: readme-studio$/mu);
    for (const leaf of ["scripts/validate-readme-facts.mjs", "templates/typography/shape-text-to-svg.mjs", "templates/typography/package-lock.json", "templates/remotion-cover/package-lock.json", "templates/remotion-cover/src/index.tsx", "templates/hyperframes-cover/index.motion.json"]) {
      assert.ok(canonicalSkillResourceFiles.includes(`skills/readme-studio/${leaf}`), `uninstalled resource: ${leaf}`);
    }
  });
});

