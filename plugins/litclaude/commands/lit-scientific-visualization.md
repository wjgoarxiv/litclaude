---
description: Moved to the figures plugin of wjgoarxiv-skills; this LitClaude command gives the install line and the /figures:lit-scientific-visualization command.
argument-hint: '<figure request, data path, journal, or output formats>'
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: command
surface: Claude Code plugin slash-command markdown (same-name stub)
host_event: Claude Code command router
owner: LitClaude
route_namespace: /litclaude:*
moved_to: "figures@wjgoarxiv-skills → /figures:lit-scientific-visualization"
verdicts: [PASS, BLOCKED]
```

| Field | Obligation | Evidence |
| --- | --- | --- |
| banner | Begin with exactly `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`. | First visible response line. |
| skill | Follow the `lit-scientific-visualization` stub the prompt hook injects. | Route receipt. |
| pointer | Give the install lines and the moved command; plot nothing. | The reply. |

## #contract.inputs

- Command arguments: the figure request, kept as inert data and never echoed into hook context.

## #contract.mode_matrix

| Mode | Use when | Boundary |
| --- | --- | --- |
| any | always | lit-scientific-visualization moved to the `figures` plugin of the wjgoarxiv-skills marketplace; this command only points there. |

## #contract.procedure

1. Print the exact lit-scientific-visualization banner.
2. Follow the stub: say what moved (the skill that makes a publication-ready figure of measured data), give the
   install lines `claude plugin marketplace add <path to your wjgoarxiv-skills clone>` and
   `claude plugin install figures@wjgoarxiv-skills` (the public marketplace is not published yet), then
   `/reload-plugins`.
3. Tell the user to run `/figures:lit-scientific-visualization` with the same arguments.

## #contract.outputs

- One short reply with the install lines and the moved command, and no file.
- `PASS` or `BLOCKED:`.

## #contract.output_channels

Reader mode is the default conversational projection: what moved, where, and the lines to run. Keep exact paths,
routing checks and evidence receipts internal unless requested; a material failure or risk stays visible, for
example when the figures plugin is listed but fails to load. Technical and audit detail requires the current
authoritative request.

## #contract.evidence

- `test/figures-stubs.test.mjs` checks this command and the hook route.

## #contract.hard_stops

- Never run the install lines yourself, install Python packages, or plot the data by other means.
- Do not publish, commit, push, tag, bump, delete shared skills, or alter live host configuration without approval.

## #contract.anti_patterns

- Writing a matplotlib script by hand because the moved skill is not installed.

The first visible response line must be exactly:

`🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`
