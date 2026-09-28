---
description: Create and verify a publication-ready figure with the bundled LitClaude scientific visualization capability.
argument-hint: '<figure request, data path, journal, or output formats>'
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: command
surface: Claude Code plugin slash-command markdown
host_event: Claude Code command router
owner: LitClaude
route_namespace: /litclaude:*
verdicts: [PASS, DEGRADED, FAIL, BLOCKED]
```

| Field | Obligation | Evidence |
| --- | --- | --- |
| banner | Begin with exactly `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`. | First visible response line. |
| skill | Load `Skill(lit-scientific-visualization)`. | Route receipt. |
| runtime | Preflight without silent dependency installation. | PASS or DEGRADED report. |

## #contract.inputs

- Command arguments, dataset paths, target journal, output formats, chart semantics, and required visual constraints.
- Installed vendor source, scripts, assets, and references resolved through the loaded Skill.

## #contract.mode_matrix

| Mode | Use when | Boundary |
| --- | --- | --- |
| ready | Core Python and matplotlib are available. | Generate and inspect real artifacts. |
| degraded | Core or requested optional dependencies are unavailable. | Name the missing capability and request approval before installation. |

## #contract.procedure

1. Print the exact lit-scientific-visualization banner.
2. Load and follow `Skill(lit-scientific-visualization)`.
3. Read the complete canonical source skill and required references.
4. Preflight dependencies without mutating the environment.
5. Generate, export, and visually inspect the requested artifact.

## #contract.outputs

- Figure artifacts, reproducible source, and concise QA receipt.
- `PASS`, `FAIL`, `DEGRADED:`, or `BLOCKED:`.

## #contract.output_channels

Reader mode is the default conversational projection: return the requested figure,
result, material risk, required action, and explicitly requested detail. Keep exact
paths, checks, dependency diaries, and routine QA receipts internal unless requested
or material; material failure and degradation remain visible. Technical and audit
detail requires the current authoritative request, while requested artifacts retain
their full scientific content.

## #contract.evidence

- Cite exact file paths, formats, DPI/vector checks, visual inspection, and dependency status.

## #contract.hard_stops

- Do not silently install packages, invent scientific results, or claim uninspected output is publication-ready.
- Do not publish, commit, push, tag, bump, delete shared skills, or alter live host configuration without approval.

## #contract.anti_patterns

- Do not bypass the complete bundled source or use generic plotting defaults.
- Do not connect independent scatter observations with lines.

Use `Skill(lit-scientific-visualization)` now. The first visible response line must be exactly:

`🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`
