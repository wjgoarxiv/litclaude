---
description: "Moved: lit-scientific-visualization makes publication plots of measured data and now ships as the `figures` plugin of the wjgoarxiv-skills marketplace. Use for 'plot this data', 'publication figure'; 그래프 그려줘, 논문용 그림. Loads Skill(figures:lit-scientific-visualization) when installed; otherwise gives the install line."
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
moved_to: "figures@wjgoarxiv-skills → Skill(figures:lit-scientific-visualization)"
verdicts: [PASS, BLOCKED]
```

| Field | Obligation | Evidence |
| --- | --- | --- |
| banner | Begin with exactly `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`. | First visible response line. |
| skill | Follow the `lit-scientific-visualization` stub the prompt hook injects. | Route receipt. |
| moved skill | When `figures:lit-scientific-visualization` is in the skills list, load `Skill(figures:lit-scientific-visualization)` and follow it. | The figures skill's own outputs. |
| pointer | When it is not listed, give the update or install lines; plot nothing. | The reply. |

## #contract.inputs

- Command arguments: the figure request, kept as inert data and never echoed into hook context.

## #contract.mode_matrix

| Mode | Use when | Boundary |
| --- | --- | --- |
| installed | `figures:lit-scientific-visualization` is in the skills list | Hand the whole request to that skill. |
| older copy | Another `figures:` skill is listed, this one is not (figures 0.1.0) | Give the update lines; `/figures:lit-scientific-visualization` runs it meanwhile. |
| not installed | No `figures:` skill is listed | Say what moved and give the install lines. |

## #contract.procedure

1. Print the exact lit-scientific-visualization banner.
2. If `figures:lit-scientific-visualization` is in this session's skills list, load
   `Skill(figures:lit-scientific-visualization)` with the same arguments and follow it for the whole figure.
3. If another `figures:` skill is listed but this one is not, the figures plugin is the 0.1.0 copy: give
   `claude plugin marketplace update wjgoarxiv-skills` and `claude plugin update figures@wjgoarxiv-skills`, then
   `/reload-plugins`, and say `/figures:lit-scientific-visualization` with the same arguments runs it meanwhile.
4. Otherwise follow the stub: say what moved (the skill that makes a publication-ready figure of measured data),
   give the install lines `claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills` and
   `claude plugin install figures@wjgoarxiv-skills`, then `/reload-plugins`, and ask the user to send the request again.

## #contract.outputs

- Installed: the figures skill's own outputs. Otherwise one short reply with the update or install lines, and no file.
- `PASS` or `BLOCKED:`.

## #contract.output_channels

Reader mode is the default conversational projection: the figure when the moved skill runs, otherwise what moved,
where, and the lines to run. Keep exact paths, routing checks and evidence receipts internal unless requested; a
material failure or risk stays visible, for example when the figures plugin is listed but fails to load. Technical
and audit detail requires the current authoritative request.

## #contract.evidence

- `test/figures-stubs.test.mjs` checks this command and the hook route.

## #contract.hard_stops

- Never run the install lines yourself, install Python packages, or plot the data by other means.
- Do not publish, commit, push, tag, bump, delete shared skills, or alter live host configuration without approval.

## #contract.anti_patterns

- Writing a matplotlib script by hand because the moved skill is not installed.

The first visible response line must be exactly:

`🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`
