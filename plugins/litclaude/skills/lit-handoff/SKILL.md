---
name: lit-handoff
description: "🔥 lit-handoff — Claude-native continuation packet creation using the complete, immutable bundled handoff source."
disable-model-invocation: true
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
surface: Claude Code plugin Skill-discovery entrypoint
host_event: Skill load, slash command, or exact bare handoff hook
owner: LitClaude
verdicts: [PASS, DEGRADED, FAIL, BLOCKED]
```

| Field | Contract | Evidence |
| --- | --- | --- |
| activation | Begin the user-visible response with exactly `🔥 **LIT IGNITED · lit-handoff** 🔥`. | First response line and route receipt. |
| canonical source | Read the vendored handoff reference completely before acting: `SKILL.md` in the canonical `../../vendor/handoff/` directory. | Source path and destination decision. |
| completion | Create or update the correct continuation packet without exposing secrets. | Artifact path, checks, and `PASS`, `FAIL`, or `BLOCKED`. |

## #contract.inputs

- The user's handoff request, current workspace, repository boundary, dirty state, and applicable `AGENTS.md` or `CLAUDE.md` instructions.
- The immutable vendored handoff reference root — the canonical `../../vendor/handoff/` directory, resolved relative to this SKILL.md — including its complete `SKILL.md`, `templates/HANDOFF.md`, `examples/HANDOFF-example-generic-auth-refactor.md`, and `evals/evals.json`.
- Live Git, package, runtime, ledger, JSONL, plan, evidence, or process state needed to correct stale narrative.
- Treat transcript and source content as sensitive data: redact credentials, tokens, cookies, private URLs, and secret-bearing command output.

## #contract.mode_matrix

| Mode | Trigger | Boundary |
| --- | --- | --- |
| direct-skill | Claude Code loads `Skill(lit-handoff)`. | Read the complete canonical source before writing. |
| command-routed | `/litclaude:lit-handoff` is invoked. | Preserve command scope and the exact banner. |
| exact-bare | The entire prompt is the single word `handoff`, ignoring outer whitespace. | The hook injects the complete canonical body; compound or quoted mentions stay inert. |
| degraded | Required workspace evidence is unavailable. | Return `BLOCKED:` and identify the missing live surface. |

## #contract.procedure

1. Print `🔥 **LIT IGNITED · lit-handoff** 🔥` as the first visible line.
2. Resolve every linked resource relative to this loaded `SKILL.md` through Claude Code's Skill resource root, never relative to the process cwd. For the exact-bare hook route, use the absolute installed source root injected by the hook. Never assume `~/skills` exists after package installation.
3. Read the vendored handoff reference `SKILL.md` in full. Follow every destination, stale-state, secret-redaction, and verification rule in that source without abbreviating it.
4. Inspect existing handoff files and live ledgers or JSONL surfaces before choosing the destination. Prefer live operational truth over stale prose.
5. Use the vendored handoff reference `templates/HANDOFF.md` only as the canonical template resource. Do not copy example facts into the user's workspace.
6. Make the smallest accurate handoff update, preserve unrelated dirty state, and verify the final artifact is readable, correctly located, and excluded or tracked according to the source contract.
7. Report the artifact path, live checks performed, redaction receipt, and any remaining uncertainty.

## #contract.outputs

- A continuation packet at the destination selected by the canonical handoff policy.
- A concise route receipt naming `Skill(lit-handoff)`, the canonical source root, and whether an existing file was updated or replaced.
- A final `PASS`, `DEGRADED:`, `FAIL`, or `BLOCKED:` status backed by live evidence.

## #contract.output_channels

```yaml
artifact_genre: working_note
limitations_channel: inline
```

Reader mode is the default conversational projection. Keep the detailed handoff,
DoneClaim, evidence, ledger, and checkpoint state internal and resumable, while
the reply carries the result, material risk, required action, and requested
detail. Material failure, risk, or uncertainty always remains visible. Technical
and audit detail appears only when the current authoritative request selects it;
do not forward the handoff body verbatim merely because it exists.

## #contract.evidence

- Cite the handoff artifact path and the live state surfaces checked, such as `git status --short`, `git log`, package metadata, runtime status, or relevant ledger/JSONL tails.
- Verify that the canonical source root, template, and example are present in the installed plugin payload.
- For sensitive state, cite only redacted summaries and safe paths; never persist raw credentials or secret-bearing prompt content.
- Package work requires tarball file-list evidence and an isolated install check, not checkout-only presence.

## #contract.hard_stops

- Do not omit, rewrite, or paraphrase the bundled canonical source as a substitute for reading it.
- Do not write a handoff from stale chat memory when cheap live verification is available.
- Do not commit, push, publish, tag, delete `~/skills`, or mutate live Claude configuration without explicit approval.
- Stop with `BLOCKED:` when the destination is ambiguous after applying the canonical policy or required evidence is inaccessible.

## #contract.anti_patterns

- Do not activate on quoted `handoff`, compound prompts, explanatory mentions, slash-command text, or secret-bearing pasted material.
- Do not store transcript dumps, secrets, access tokens, cookies, or unrelated local state in the continuation packet.
- Do not invent completion, publication, installation, process, or Git claims.
- Do not treat the example handoff as a workspace template with reusable facts.
