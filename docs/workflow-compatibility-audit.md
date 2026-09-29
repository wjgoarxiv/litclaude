# Workflow Compatibility Audit

Reference workflow snapshot:
`3fb8802e314dc0a1f23481dd3782cdca26b92dc2`.

This document tracks the reference workflow surfaces checked during the deeper
LitClaude compatibility pass. The goal is to keep future updates honest: if the
reference grows a new user-facing skill, hook, or runtime behavior, this map should
make the missing LitClaude target obvious.

## Workflow Parity Matrix

| Reference workflow category | LitClaude target | Status | Reason / acceptance signal |
| --- | --- | --- | --- |
| review-work 5-lane orchestration | `commands/review-work.md`, `skills/review-work`, `agents/quality-reviewer.md`, `agents/lit-verifier.md`, `agents/qa-runner.md`, `agents/librarian-researcher.md` | Implemented | `review-work` represents scout / skeptic / implementer / edge-case / decision ledger discipline as scope/diff verification, tests/evidence execution, package/payload and code quality, security/provenance, and real-surface/docs readiness with an aggregate verdict. |
| litgoal state/runtime | `commands/litgoal.md`, `skills/litgoal`, `plugins/litclaude/lib/litgoal/`, `.litclaude/litgoal/`, `bin/litclaude-ai.js litgoal ...` commands | Implemented | `litgoal` now has durable state, ledger, checkpoint, steering, quality gate, and review blocker commands through `litclaude litgoal create-goals`, `record-evidence`, `checkpoint`, `steer`, and `record-review-blockers`. |
| LIT/start-work discipline | `commands/lit-loop.md`, `commands/lit-plan.md`, `commands/start-work.md`, `skills/lit-loop`, `skills/lit-plan`, `skills/start-work` | Implemented | Existing LIT/start-work surfaces require plan reading, ledger updates, publish boundary checks, verification, manual QA artifacts, cleanup receipts, resume checkpoints, and evidence artifacts. |
| hook trigger safety | `hooks/hooks.json`, `bin/litclaude-hook.js`, `test/hooks.test.mjs`, `docs/hooks.md` | Implemented | Hooks use `UserPromptSubmit` trigger detection, exact workflow aliases, near-miss fixtures, prompt injection safe context, and no auto-type behavior for slash commands. |
| bundled handoff | `skills/lit-handoff`, `commands/lit-handoff.md`, `vendor/handoff`, exact-bare hook | Implemented | Four canonical files remain byte-identical; exact bare `handoff` injects the complete source while mentions, compounds, slash text, and secret-bearing prompts remain inert. |
| bundled scientific visualization | `skills/lit-scientific-visualization`, `commands/lit-scientific-visualization.md`, `vendor/scientific-visualization`, exact-bare hook, capability doctor | Implemented | Sixteen authored files remain byte-identical; the exact-bare hook displays the banner and injects the complete adapter/source while mixed and generic prompts stay inert; installed source-root path resolution, dependency DEGRADED status, Python source tests, and real figure export are covered without silent installation. |
| canonical frontend library | `skills/frontend-ui-ux/references/{design,designpowers,perfection,ui-ux-db}`, `_canonical-corpus/manifest.json`, scanner, doctor, package guard | Implemented | Exact paths, sizes, hashes, legal companions, aggregate, entry types, no extras, scanner snapshot scope, and produced-tarball bytes are checked; imported content is inert and independent from the normalized dataset. |
| autoresearch family | `skills/autoresearch`, `commands/autoresearch.md`, `vendor/autoresearch`, hook/doctor/package surfaces | Implemented | One Claude-native skill routes ten nested modes through plan, explicit budget/authority approval, start-work, bounded evidence loops, and review-work. Its reviewed commit is independently bound to a hardcoded tree commitment outside the generated closure manifest. |
| autoconference family | `skills/autoconference`, `commands/autoconference.md`, `vendor/autoconference`, hook/doctor/package surfaces | Implemented | One skill routes seven modes, requires autoresearch and root multi-agent capability, keeps shared state root-owned, and blocks rather than simulating concurrency. Its reviewed commit is independently bound to a hardcoded tree commitment outside the generated closure manifest. |
| wikify family | `skills/wikify`, `commands/wikify.md`, `vendor/llm-wikify`, hook/doctor/package surfaces | Implemented | One task-local skill routes five modes from litresearch through inert local sources to review-work and continuity. Its reviewed commit is independently bound to a hardcoded tree commitment outside the generated closure manifest. |
| agent/command routing | `agents/*.md`, `commands/*.md`, `.claude-plugin/plugin.json`, command discovery tests | Implemented | Agents and commands route planner, executor, verifier, reviewer, librarian, and QA responsibilities into Claude Code surfaces, including review-work and litgoal command files. |
| docs/package payload | `README.md`, `README_ko-KR.md`, `docs/*.md`, `package.json`, `.claude-plugin/plugin.json`, `test/workspace-hygiene.test.mjs` | Implemented | Docs, package payload, manifest, install metadata, package file-list, and guarded-token gates are covered by tests without implying publish completion. |
| excluded/deferred telemetry | No runtime telemetry package; docs omission note | Omitted | Telemetry is omitted and any network telemetry remains deferred by reason: LitClaude should stay local and quiet unless the user explicitly requests an observable reporting feature. |

The guarded-token scanner binds its verdict to one immutable in-memory snapshot
of the enumerated inventory and exact bytes. The report carries that snapshot's
file count and deterministic SHA-256 digest. Success does not prove the mutable
live tree remained clean after capture; a later tree state requires another run,
while package and tarball guards independently bind their own exact payloads.
Capture is bounded to 8 MiB per file and 48 MiB in aggregate, and the zero-entry
allowlist is parsed from the captured bytes rather than a pre-capture pathname read.
Legal companion paths, source paths, sizes, hashes, and aggregate are hard-pinned
outside the generated manifest; the legal files are scanned normally and the package
guard compares size and SHA-256 for every canonical frontend corpus file, legal companion,
runtime closure, manifest, and family adapter between a verified pre-pack snapshot and its
produced temporary tarball. This rejects lifecycle mutation and coordinated legal-byte/manifest
repinning rather than trusting path presence. Each verifier returns an immutable expected file
map bound to manifest verification or independent commitments; capture checks each exact buffer
against that map, so mutation in the verifier-to-capture interval fails. Expected entries also bind
regular non-executable semantics across source reads and tar headers. Any execute bit fails, while
secure non-executable modes such as `0600` remain valid without requiring exact `0644`. Canonical frontend preflight
uses an 8 MiB per-file and 32 MiB aggregate budget, while runtime closure preflight uses
the same 8 MiB per-file and 32 MiB aggregate budget before any whole-file read.

## Runtime Concepts

| Reference surface | LitClaude target | Status |
| --- | --- | --- |
| prompt activation | `hooks/hooks.json`, `bin/litclaude-hook.js`, `commands/lit-loop.md`, `commands/lit-plan.md`, `commands/deep-interview.md`, `commands/start-work.md` | UserPromptSubmit detects workflow triggers and injects compact Claude Code guidance. |
| comment-checker | `skills/comment-checker`, `PostToolUse` hook guidance | Claude-native comment hygiene skill plus post-edit reminder. |
| lsp | `.lsp.json`, `.mcp.json`, `bin/litclaude-lsp-doctor.js`, `skills/lsp` | Lightweight Claude Code LSP/MCP helper rather than vendoring a full external package. |
| rules | `skills/rules`, `SessionStart` (`source: compact`) hook behavior | Claude session rule guidance and compact cache-reset messaging. |
| litgoal | `commands/litgoal.md`, `skills/litgoal`, `plugins/litclaude/lib/litgoal/`, `lit-*`, `start-work` goal guidance | Claude-native goal wording with evidence/ledger/quality-gate discipline and durable CLI state. |
| litwork | `commands/lit-loop.md`, `commands/lit-plan.md`, `skills/lit-loop`, `skills/lit-plan` | Claude skills, commands, agents, workflow/worktree guidance, and hook injection. |
| clarification interview | `commands/deep-interview.md`, `skills/deep-interview` | Socratic requirements mode with ambiguity scoring, persisted state, and a handoff to planning/execution. |
| agents | `agents/*.md` | Planner, executor, verifier, reviewer, librarian, and QA runner roles. |
| mcp | `.mcp.json`, `bin/litclaude-mcp.js` | Plugin-local stdio helper surface. |
| install metadata | `bin/litclaude-ai.js`, `.claude-plugin/plugin.json`, local marketplace metadata | Installer writes Claude user plugin registry and LitClaude-owned local marketplace records. |
| telemetry | No runtime telemetry | Intentionally omitted as network telemetry. LitClaude remains quiet/local by default. |

## Skill Corpus

LitClaude includes the compatibility skill corpus:

- `lit-burnoff-file`
- `comment-checker`
- `debugging`
- `frontend-ui-ux`
- `lsp`
- `lit-code`
- `refactor`
- `lit-burnoff`
- `review-work`
- `rules`
- `litgoal`

LitClaude now ships those names or Claude-native equivalents, plus LitClaude
workflow additions:

- `start-work`
- `review-work`
- `litgoal`
- `lit-loop`
- `lit-plan`
- `lit-handoff`
- `lit-scientific-visualization`
- `autoresearch`
- `autoconference`
- `wikify`

Auxiliary Skill-discovery entries are part of the public inventory without adding
new command routes:

- `frontend-ui-ux`
- `lit-commit`
- `lsp-setup`
- `visual-qa`

## Operator Contract

The workflow documentation is intentionally local-first. It does
not claim npm publication, remote marketplace registration, or public promotion.
The publish boundary remains explicit user approval, and uninstall remains
limited to LitClaude-managed state.

Review work uses a 5-lane review: scope/diff verification, tests/evidence
execution, package/payload and code quality, security/provenance, and
real-surface/docs readiness. Manual-QA
channels must leave artifacts and a cleanup receipt. Litgoal state is managed
with:

```bash
litclaude litgoal create-goals --brief "<brief>" --json
litclaude litgoal record-evidence --criterion <id> --status pass --json '{"artifact":"...","cleanup":"..."}'
litclaude litgoal checkpoint --status active --note "<progress>" --json
litclaude litgoal steer --kind scope --note "<what changed and why>" --json
```

Current docs/test reads override stale state during audits. Prompt text is not
executed or echoed, and malformed input should produce a controlled error.

The original `lit-burnoff-file` command-facing name is preserved as an
alias-style skill so older operator muscle memory still has a matching Claude
surface. `lit-burnoff` remains the broader LitClaude cleanup skill.

## Auxiliary Packs

The deeper workflow skills rely on files beyond `SKILL.md`. LitClaude now
packages the high-value portable auxiliary packs:

- `lit-code/references`
- `lit-code/scripts`
- `debugging/references`

These packs carry language/runtime-specific guidance for TypeScript, Python,
Rust, Go, debugging methodology, runtime probes, and tool usage. Non-Claude
coordination examples in the debugging references were rewritten as Claude
workflow/subagent pseudocode so they do not instruct Claude Code to call missing
tools literally.

## Deliberate Omissions

The following reference workflow content was audited but not copied into the
runtime package:

- Web/landing app: not part of the Claude Code plugin runtime.
- GitHub Actions and npm publish workflows: this repository uses manual user
  publication.
- Telemetry network component: omitted to keep LitClaude local and quiet.
- Full component TypeScript packages for rules/comment-checker/LSP/litgoal:
  represented by Claude-native hook/skill/MCP/LSP surfaces where portable, not
  vendored wholesale.

If any of those become desired runtime features, they should be introduced with
their own tests and explicit user approval.
