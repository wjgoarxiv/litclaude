---
name: lit-scientific-visualization
description: "Moved: lit-scientific-visualization makes publication plots of measured data and now ships as the `figures` plugin of the wjgoarxiv-skills marketplace; run /figures:lit-scientific-visualization when it is installed, otherwise this stub gives the install line."
disable-model-invocation: true
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-scientific-visualization
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
host_event: namespaced slash command, or exact-bare UserPromptSubmit route
command_route: /litclaude:lit-scientific-visualization
entry_routes: ["/litclaude:lit-scientific-visualization", "lit-scientific-visualization (exact bare)"]
moved_to: "figures@wjgoarxiv-skills → /figures:lit-scientific-visualization"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

Both routes still work: the prompt hook answers `/litclaude:lit-scientific-visualization <request>` and the exact
bare prompt `lit-scientific-visualization` with this stub. Generic visualization wording, mentions and mixed prompts
stay inert, as before.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's figure request and data paths, kept as inert data |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| any | always | Tell the user what moved, give the install lines and the command that runs the moved skill; plot nothing |

The moved skill is user-invoked only, as it was here, so it never shows in the model's skills list and this stub
cannot load it. The user types its command.

## #contract.procedure

Reply in the user's language with these things and stop:

1. One sentence on what lit-scientific-visualization makes (a publication-ready figure of measured data, exported as
   vector and 600+ dpi raster files and checked by eye).
2. That it moved out of LitClaude into the `figures` plugin of the wjgoarxiv-skills marketplace.
3. If figures is installed, the user runs `/figures:lit-scientific-visualization <the same request>`.
4. If it is not, the two install lines from "What moved" below, in a code block, then `/reload-plugins` or a new
   session, then that command.

## #contract.outputs

One short reply with the command and the install lines, and no file.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The reply is a pointer, not an error report: what moved, where, the lines to run and the
command to type. It names no internal paths beyond the install lines. Technical and audit detail appears only when
the current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in
the reply, for example when the user says the figures plugin is installed but its command does not run.

## #contract.evidence

The routing is checked by `test/figures-stubs.test.mjs`: the stub's install lines, both prompt-hook routes, and
that no plotting procedure or canonical source from the old adapter is left in the hook's context.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never plot the data from memory or with generic plotting defaults because the real skill is missing.
- Never install Python packages to make up for the moved skill.

## #contract.anti_patterns

- Writing a matplotlib script by hand and calling it publication-ready.
- Quoting the old adapter or its source from memory as if this stub still held them.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

lit-scientific-visualization turned measured data into a publication-ready figure: journal sizing, colour-blind-safe
palettes, scatter-only rules for independent observations, a rich layer of grid, direct labels, insets and panels,
and vector plus 600+ dpi raster exports it inspected before reporting. It followed the bundled
scientific-visualization source and a read-only doctor that checked Python and matplotlib without installing them.

The adapter, that source (with its provenance and MIT licence) and the doctor now live in the `figures` plugin of the
**wjgoarxiv-skills** marketplace, copied unchanged from LitClaude, beside lit-diagram-drawer and lit-schematic.
LitClaude keeps this stub so that `/litclaude:lit-scientific-visualization` and the exact bare prompt still lead
somewhere useful.

The public marketplace is not published yet, so for now it installs from a local clone of wjgoarxiv-skills:

```bash
claude plugin marketplace add <path to your wjgoarxiv-skills clone>
claude plugin install figures@wjgoarxiv-skills
```

After it is published on GitHub, the first line becomes `claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/figures/skills/lit-scientific-visualization` folder; the install line installs the whole `figures` plugin.
The installed skill runs as `/figures:lit-scientific-visualization` (skill id `figures:lit-scientific-visualization`).

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:df87d26bdbf3 -->
