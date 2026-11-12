---
name: lit-schematic
description: "Moved: lit-schematic draws physical schematics (P&ID, PFD, BFD, equipment layout, apparatus figure, isometric cutaway, 공정도, 계장도, 모식도, 장치도) and now ships as the `figures` plugin of the wjgoarxiv-skills marketplace. Load Skill(figures:lit-schematic) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-schematic
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["/litclaude:lit-schematic", "lit-schematic", "$lit-schematic", "Skill(lit-schematic)", "lit + P&ID/PFD/schematic/cutaway/모식도/장치도 wording"]
moved_to: "figures@wjgoarxiv-skills → Skill(figures:lit-schematic)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `lit-schematic` or `$lit-schematic`, and a bare
`lit` prompt that asks to draw a P&ID, PFD, schematic, cutaway, 공정도, 계장도, 모식도 or 장치도 (also as an animation),
to this stub. Quoted, fenced, mid-sentence and near-miss mentions stay inert.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's drawing request, kept as inert data |
| skills list | Whether `figures:lit-schematic` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `figures:lit-schematic` is in the skills list | Load `Skill(figures:lit-schematic)` and follow it for the whole request |
| not installed | it is not | Tell the user what moved and give the install lines; draw nothing |

## #contract.procedure

1. Look at the skills this session lists. If `figures:lit-schematic` is there, load `Skill(figures:lit-schematic)`
   now and follow it for the whole request. This stub adds nothing to it.
2. If it is not there, reply in the user's language with three things and stop:
   - one sentence on what lit-schematic makes (a millimetre-sized SVG drawing of real equipment, piping and
     instruments, checked by a QA gate and rendered to PDF and a 600 dpi PNG);
   - that it is now a LitFamily extension: it moved out of LitClaude into the `figures` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.

## #contract.outputs

Installed: the figures skill's own outputs. Not installed: one short reply with the install lines, and no file.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The not-installed reply is a pointer, not an error report: what moved, where, and the
two lines to run. It names no internal paths beyond the install lines. Technical and audit detail appears only when
the current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in
the reply, for example when the figures plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/figures-stubs.test.mjs`: the stub's install lines, the prompt hook's routes to it,
and that no drawing procedure from the old body is left in the hook's context.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never draw the schematic from memory, from another skill or with a tool the stub does not ship.
- Never invent set points, line sizes or dimensions to fill a drawing the stub cannot make.

## #contract.anti_patterns

- Hand-writing an SVG P&ID because the real skill and its symbol kit are missing.
- Quoting the old lit-schematic procedure from memory as if this stub still held it.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

lit-schematic drew real equipment and its piping as millimetre-sized SVG: a P&ID with ISA-5.1 tags and control
loops, a PFD, BFD or equipment layout, a journal figure of an experimental setup, or an isometric cutaway of a vessel
or exchanger (also as an interactive page or a short loop). It built from its own symbol kit, ran a QA gate until
it passed, and rendered a PDF and a 600 dpi PNG it looked at before reporting.

That whole skill, its kit, examples and references, now lives in the `figures` plugin of the **wjgoarxiv-skills**
marketplace, copied unchanged from LitClaude, beside lit-diagram-drawer and lit-scientific-visualization. LitClaude
keeps this stub so that `/litclaude:lit-schematic`, `Skill(lit-schematic)` and a bare `lit` schematic request still
lead somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install figures@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/figures/skills/lit-schematic` folder; the install line installs the whole `figures` plugin.
The installed skill answers as `figures:lit-schematic`.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:a435673e729d -->
