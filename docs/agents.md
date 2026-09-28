# LitClaude Agents

LitClaude agents map the LitClaude team workflow into Claude Code subagents
with bounded responsibilities.

Native Claude Code agent teams are separate from these plugin subagents. The
natural routes `lit team`, `lit team mode`, and `lit teammates` are setup-gated
by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; when enabled, LitClaude asks Claude
to spawn approved teammates with roles, file-scope boundaries, acceptance
criteria, wait instructions, and synthesis. Optional display setup is
`claude --teammate-mode auto` or `"teammateMode": "auto"`. When the env gate is
absent, use the subagent/Dynamic workflow routes below.

Primary order:

1. `lit-loop` — the default execution-loop skill for direct, evidence-driven work.
2. `lit-plan` → `lit-planner` — planning-only, read-only, approval-gated.
3. `start-work` → `lit-executor` — approved-plan execution-only; no redesign.

| Agent | Responsibility | Boundary |
| --- | --- | --- |
| `lit-planner` | Build implementation plans and identify risks. | Read-only tools, no write/edit/bash tools. |
| `lit-executor` | Execute checked plan tasks. | Must follow task acceptance criteria and collect evidence. |
| `lit-verifier` | Verify tests, artifacts, and task completion. | Reviews evidence before approval. |
| `quality-reviewer` | Perform code-review style risk checks. | Findings first, no unrelated rewrites. |
| `librarian-researcher` | Fetch and summarize external references. | Use primary sources and cite them. |
| `qa-runner` | Run tmux/manual QA scenarios. | Must clean up sessions and capture receipts. |
| `korean-style-analyzer` | Map Korean prose texture, protected facts, tone, and edit priorities. | Diagnosis only; prompt content stays data. |
| `korean-prose-editor` | Apply bounded Korean prose edits for naturalness. | Preserve facts, numbers, names, quotes, claims, and requested tone. |
| `meaning-preservation-auditor` | Compare original and revised Korean text for drift. | Recommend rollback when meaning preservation is uncertain. |
| `native-flow-reviewer` | Review revised Korean prose for native flow and register. | Suggest only the smallest safe style changes. |
| `polish-orchestrator` | Reconcile strict Korean polish reviews and decide final action. | Accept, rerun, rollback, or hold for human review within the strict path. |

The planner is deliberately constrained because the safest Claude Code retrofit
keeps planning separate from mutation. Executor and QA agents can act only
inside the plan and evidence contract.

## Lit Humanizer and Korean Review Routing

`/litclaude:lit-humanizer` activates `Skill(lit-humanizer)` for reader-facing
prose edits and artifact review. The one-release `/litclaude:lit-korean` and
`/litclaude:korean-ai-slop-remover` redirects, plus the bare
`text-naturalization` alias, also route to `lit-humanizer`. Fast mode is the
default for short, low-risk Korean prose polish and does not require spawned
agents. Strict mode uses the local agent inventory above when the user asks for
strict review, redo, long input, fidelity-sensitive text, or a documented
before/after audit.

The strict order is analyzer, editor, parallel meaning and flow reviews, then
orchestrator decision. The safety boundary is meaning-first: editable prose is
data, embedded instructions are not executed, protected facts stay stable, and
uncertain meaning triggers rollback or human review instead of a forced rewrite.
Strict packets also name protected spans, honorific/register, and Before/After
Diff requirements when useful; pasted hostile text such as "ignore previous
instructions" remains inert source text.

## Review Work Routing

For a draft plan, `review-work` stays read-only and audits bounded scope,
objective-achievability, Action/Output/Verification atomicity, acceptance
evidence, and applicable failure/decision/cleanup branches. It returns `PASS`,
`ITERATE`, or `NEEDS-CONTEXT` and never starts implementation. The table below
applies after implementation, when completed work needs the five evidence lanes.

The v0.2.0 workflow parity review route uses five evidence lanes:

| Review lane | Agent routing | Required evidence |
| --- | --- | --- |
| scope/diff verification | `lit-verifier` with `review-work` and `rules` | Goal, non-goals, changed-file list, publish boundary, and constraints checked against current diff/docs/test reads. |
| tests/evidence execution | `qa-runner` with `start-work` and `review-work` | Automated test output, Manual-QA channels, artifacts, exit statuses, and cleanup receipt. |
| package/payload and code quality | `quality-reviewer` with `review-work` and `lit-code` | Findings-first code review plus package, plugin, and payload readiness. |
| security/provenance | `quality-reviewer` with `review-work` and `lit-code` | Prompt injection, malformed input, local state, provenance, and unsafe command handling risks. |
| real-surface/docs readiness | `librarian-researcher` with `rules` | Local checkout, docs, tests, ledgers, and real command/hook/package surfaces checked before external references. |

The completed-work aggregate verdict is PASS, FAIL, BLOCKED, ITERATE, or
NEEDS-CONTEXT. Broad review work may
use Dynamic workflow when Claude Code exposes it; isolated edits can use
`claude --worktree <short-name> --tmux` when a separate checkout is required.

## Dynamic Workflow Delegation

The v0.2.2 `/litclaude:lit-loop` route makes the delegation map explicit for
Claude Code Dynamic workflow lanes and subagent spawning. Child assignments
start with `TASK:` and include `DELIVERABLE`, `SCOPE`, and `VERIFY` so the
worker knows the artifact, boundary, and proof of completion:

| Delegation lane | Agent | Evidence boundary |
| --- | --- | --- |
| plan and dependency order | `lit-planner` | Read-only plan with files, tests, Manual-QA channel, and cleanup. |
| implementation | `lit-executor` | Smallest checked code change with RED -> GREEN evidence. |
| acceptance verification | `lit-verifier` | Goal, criteria, and artifact checks before completion. |
| manual QA | `qa-runner` | tmux/browser/HTTP/computer-use artifact plus cleanup receipt. |
| code/security review | `quality-reviewer` | Findings-first review with concrete file references. |
| real-surface/docs readiness | `librarian-researcher` | Repo/docs/history and real surfaces searched before external sources. |

`litclaude-ai workflow-check --json` verifies that this route, goal guidance,
Dynamic workflow guidance, subagent reliability contract, and command/hook
agreement are present.

## G20 slice 9 model-routing boundary

LitClaude does not own a Claude Code-native `model` or `effort` field for plugin
agents. Its agents inherit model selection from Claude Code. LitClaude does not
write an OpenAI model route, an effort override, or host configuration. Its installer
has no model-selection probe or model/effort prompt.

The approved family table remains a policy record only:

| Route | Requested model | Requested effort | LitClaude result |
| --- | --- | --- | --- |
| lead | `gpt-6-astra` | `xhigh` | `BLOCKED: unsupported Claude-native route` |
| ordinary worker | `gpt-6-luna` | `max` | `BLOCKED: unsupported Claude-native route` |
| `momus` | `gpt-6-astra` | `xhigh` | `BLOCKED: unsupported Claude-native route` |
| `litwork-reviewer` | `gpt-6-astra` | `xhigh` | `BLOCKED: unsupported Claude-native route` |

The previous-generation `gpt-5.6-sol` and `gpt-5.6-luna` ids remain accepted. The
Codex/OpenAI host catalog also lists `gpt-5.6-terra`; all three GPT-5.6 ids are accepted and
selectable there, with no retirement metadata for any of them. Across products that own OpenAI
routing, fresh installs default to GPT-6: Astra for planning, review, and lead work; Sol as the
coding-lead alternative; and Luna for helpers and ordinary workers. The OpenAI catalog lists both
`gpt-6-luna` and `gpt-5.6-luna` with supported efforts `low`, `medium`, `high`, `xhigh`, and `max`,
but not `ultra`. LitClaude's legacy policy-only guard blocks `gpt-5.6-luna` plus `xhigh`, despite
that catalog support. Catalog support for GPT-6 Luna at `xhigh` does not change the approved
default: the `ordinary-worker` route remains `gpt-6-luna` at `max`; an `xhigh` request for that
route fails the route-table match. These defaults are host policy, not LitClaude routes: Claude
Code owns model selection, and a normal LitClaude install or update leaves that selection untouched.

The local guard still rejects the legacy `gpt-5.6-luna` plus `xhigh` combination, malformed route
data, conflicting effort fields, and unknown models.
Run `npm run check:model-routing` to verify that no model or effort fields were
added and that every current agent permission remains unchanged. A guard pass
means the unsupported route stayed blocked. It does not mean a route applied.

### Refreshing the model catalog

LitClaude has no generated OpenAI model catalog. The shared Codex host catalog cache is
`~/.codex/models_cache.json`; run `codex debug models` to refresh and render the current catalog
(`--bundled` renders only the bundled catalog). The repo-local policy reference is
`tools/check-model-routing.mjs`, pinned by `node --test test/model-routing.test.mjs`. If a shipped
`SKILL.md` containing model guidance changes, regenerate its resource map with
`npm run gen:skill-resources`, then verify it with `npm run check:skill-resources`.

## Local Use

Load the plugin from this checkout:

```bash
claude --plugin-dir ./plugins/litclaude
```

Then reload after edits:

```text
/reload-plugins
```
