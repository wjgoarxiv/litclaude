---
name: visual-qa
description: Verify an observable interface with material evidence, or return an exact blocked capability receipt; load detailed LitClaude guidance lazily.
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: visual-qa
automatic_synthetic_pointer_injection: true
automatic_complete_contract_injection: false
command_route: none
entry_routes: ["$visual-qa", "Skill(visual-qa)", "PostToolUse advisory"]
```

This LitClaude surface validates evidence; it does not create a browser or prove appearance from prose.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| target | Exact route, state, viewport, interaction, and binary observable |
| artifacts | Bounded captures plus an evidence-eligible beta design hash, source hash, and freshness |
| reviewer | Host-proven independent identity for tiers that require review |

## #contract.mode_matrix

| Mode | Contract | Outcome |
| --- | --- | --- |
| smoke | Critical route, negative/empty state when declared, interaction, and viewport evidence | Public pathname validation is BLOCKED until host capture/root provenance exists |
| full | Complete inventory and independent review | Also requires host-owned capture and reviewer provenance |
| reference-fidelity | Full evidence plus reference targets | Also requires host-owned capture and reviewer provenance |

## #contract.procedure

1. Probe callable current-session capability before promising capture.
2. Prefer the project's existing Playwright path; otherwise use only an explicitly user-enabled Claude Chrome capability with session binding and verified PID, port, and command ownership.
3. Capture bounded material artifacts and validate hashes, dimensions, freshness, inventory, cleanup, and receipts.
4. Use separate fresh reviewer contexts over the same immutable inputs. A self-attested reviewer is not independent.
5. Emit the highest-precedence honest verdict; BLOCKED outranks FAIL, and neither can become PASS by prose.

## #contract.outputs

Return FAIL with measured findings or exact blockers such as `BLOCKED_RENDERER_UNAVAILABLE`, `BLOCKED_AUTH_UNAVAILABLE`, `BLOCKED_EVIDENCE_STALE`, `BLOCKED_EVIDENCE_FRESHNESS_UNPROVEN`, `BLOCKED_EVIDENCE_ROOT_UNPROVEN`, and `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE` plus cleanup status. Public JSON, touched mtimes, and caller-provided source strings cannot establish host capture or root provenance, so the current pathname CLI cannot return evidence-eligible PASS. v1alpha1 always returns a blocked legacy diagnostic; full and reference-fidelity additionally require host-owned reviewer provenance.

## #contract.output_channels

```yaml
artifact_genre: audit_report
limitations_channel: methodology_paragraph
```

Reader mode is the default conversational projection: return result, material risk,
required action, and requested detail. Keep operational metadata internal unless the
current authoritative request selects technical or audit detail. Material failures and
exact blockers always remain visible. Protected evidence JSON and explicitly requested
audit artifacts retain their complete schemas and traceability fields.

## #contract.evidence

Require the canonical `litfamily.design-contract/v1beta2` from `schemas/design-contract-v1beta2.schema.json` and validate material evidence with the unchanged `schemas/evidence-manifest-v1beta1.schema.json`. A valid `litfamily.design-contract/v1beta1` document remains an explicit compatibility input. Alpha's legacy disposition is never evidence-eligible. Read `references/capture-playbook.md` for channel capture and `references/complete-contract.md` only for detailed schemas, tiers, reviewer rules, commands, and failures.

## #contract.hard_stops

- No cookie or profile sharing. No dependency install or host config mutation is allowed.
- Metrics are advisory unless hardened by a named acceptance threshold.
- Missing renderer, authentication, reviewer provenance, timeout, or cleanup evidence is BLOCKED with a cleanup receipt.
- Missing host-owned capture freshness or a stable authorized evidence-root descriptor is BLOCKED; do not treat path checks as race proof.

## #contract.anti_patterns

Never substitute HTTP success for rendering, a file path for verified image bytes, similarity for semantics, or same-context review for independence.
