import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const agentsRoot = join(root, "plugins", "litclaude", "agents");
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
const expectedAgents = [
  "lit-planner",
  "lit-executor",
  "lit-verifier",
  "quality-reviewer",
  "librarian-researcher",
  "qa-runner",
];

const reviewLaneAgents = [
  {
    lane: "scope/diff verification",
    agent: "lit-verifier",
    skills: ["review-work", "rules"],
  },
  {
    lane: "tests/evidence execution",
    agent: "qa-runner",
    skills: ["start-work", "review-work"],
  },
  {
    lane: "package/payload and code quality",
    agent: "quality-reviewer",
    skills: ["review-work", "lit-code"],
  },
  {
    lane: "security/provenance",
    agent: "quality-reviewer",
    skills: ["review-work", "lit-code"],
  },
  {
    lane: "real-surface/docs readiness",
    agent: "librarian-researcher",
    skills: ["rules"],
  },
];

const frontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---/u.exec(text);
  assert.ok(match, "agent must have YAML frontmatter");
  return match[1];
};

const bodyWithoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n?/u, "");

const assertLlmAgentContract = (text, label) => {
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
    /```yaml\n[\s\S]*?contract_schema_version:\s*litclaude\.llm-contract\.v1[\s\S]*?artifact_type:\s*agent[\s\S]*?```/u,
    `${label} should expose the stable agent contract schema as fenced yaml`,
  );
  assert.match(text, /^\|[^\n]+\|\n\|[-:| ]+\|/mu, `${label} should contain a markdown contract table`);
  assert.match(text, /TASK:|DELIVERABLE|SCOPE|VERIFY/u, `${label} should expose assignment vocabulary`);
};

describe("Claude agents", () => {
  it("ships every bounded workflow agent", () => {
    for (const agentName of expectedAgents) {
      const path = join(agentsRoot, `${agentName}.md`);
      assert.equal(existsSync(path), true, `${agentName}.md must exist`);

      const meta = frontmatter(readFileSync(path, "utf8"));
      assert.match(meta, new RegExp(`name:\\s*${agentName}`, "u"));
      assert.match(meta, /description:/u);
      assert.match(meta, /tools:/u);
      assert.match(meta, /permissionMode:/u);
      assert.match(meta, /skills:/u);
    }
  });

  it("uses the stable LLM contract schema in every shipped agent", () => {
    const agentFiles = [
      "lit-planner",
      "lit-executor",
      "lit-verifier",
      "quality-reviewer",
      "librarian-researcher",
      "qa-runner",
      "korean-style-analyzer",
      "korean-prose-editor",
      "meaning-preservation-auditor",
      "native-flow-reviewer",
      "polish-orchestrator",
    ];

    for (const agentName of agentFiles) {
      const text = readFileSync(join(agentsRoot, `${agentName}.md`), "utf8");
      assertLlmAgentContract(text, `Agent(${agentName})`);
    }
  });

  it("keeps the planner read-only", () => {
    const text = readFileSync(join(agentsRoot, "lit-planner.md"), "utf8");
    const meta = frontmatter(text);

    assert.match(meta, /permissionMode:\s*plan/u);
    assert.doesNotMatch(meta, /\bWrite\b|\bEdit\b|\bMultiEdit\b/u);
  });

  it("documents the primary workflow order and approved-plan executor boundary", () => {
    const docs = readFileSync(join(root, "docs", "agents.md"), "utf8");
    const planner = readFileSync(join(agentsRoot, "lit-planner.md"), "utf8");
    const executor = readFileSync(join(agentsRoot, "lit-executor.md"), "utf8");

    assert.match(docs, /Primary order:[\s\S]*1\. `lit-loop`[\s\S]*2\. `lit-plan` → `lit-planner`[\s\S]*3\. `start-work` → `lit-executor`/u);
    assert.match(planner, /planning-only/u);
    assert.match(planner, /must not implement/u);
    assert.match(planner, /\/start-work/u);
    assert.match(executor, /approved plan/u);
    assert.match(executor, /do not redesign/iu);
    assert.match(executor, /DoneClaim/u);
  });

  it("maps every review lane to a declared agent with usable skills", () => {
    for (const { lane, agent, skills } of reviewLaneAgents) {
      const path = join(agentsRoot, `${agent}.md`);
      const text = readFileSync(path, "utf8");
      const meta = frontmatter(text);

      assert.match(text, new RegExp(lane, "iu"), `${agent} should name the ${lane} lane`);
      for (const skill of skills) {
        assert.match(meta, new RegExp(`-\\s*${skill}\\b`, "u"), `${agent} should declare ${skill}`);
      }
    }
  });

  it("visualqa.review-independence", () => {
    const visualQaRoot = join(root, "plugins", "litclaude", "skills", "visual-qa");
    const visualQa = [
      readFileSync(join(visualQaRoot, "SKILL.md"), "utf8"),
      readFileSync(join(visualQaRoot, "references", "complete-contract.md"), "utf8"),
    ].join("\n");
    const qualityReviewer = readFileSync(join(agentsRoot, "quality-reviewer.md"), "utf8");
    const oracleVerifier = readFileSync(join(agentsRoot, "lit-verifier.md"), "utf8");

    assert.match(visualQa, /\bquality-reviewer\b/u);
    assert.match(visualQa, /\blit-verifier\b/u);
    assert.match(visualQa, /same immutable inputs/iu);
    assert.match(visualQa, /separate fresh contexts/iu);
    assert.match(visualQa, /do not receive each other's (?:draft|verdict)/iu);
    assert.match(visualQa, /maximum concurrent reviewers?:\s*two/iu);
    assert.match(visualQa, /ten minutes? per reviewer/iu);
    assert.match(visualQa, /maximum fresh-review rounds?:\s*two/iu);
    assert.match(visualQa, /\bBLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE\b/u);

    for (const [name, text] of [
      ["quality-reviewer", qualityReviewer],
      ["lit-verifier", oracleVerifier],
    ]) {
      const meta = frontmatter(text);
      assert.doesNotMatch(
        meta,
        /\b(?:Write|Edit|MultiEdit|Bash)\b/u,
        `${name} must remain read-only for visual review`,
      );
      assert.match(meta, /\bRead\b/u, `${name} must be able to inspect immutable evidence`);
    }
  });

  it("gives librarian-researcher a resilient public-source retrieval contract", () => {
    const text = readFileSync(join(agentsRoot, "librarian-researcher.md"), "utf8");

    for (const contract of [
      /public API|public feed/i,
      /route trace/i,
      /validator-first/i,
      /FetchAttempt/u,
      /FetchVerdict/u,
      /claim\/source\/confidence\/uncertainty/i,
      /HTTP 200/u,
      /authentication|paywall/i,
      /prompt injection/i,
    ]) {
      assert.match(text, contract, `librarian-researcher should document ${contract}`);
    }
  });
});
