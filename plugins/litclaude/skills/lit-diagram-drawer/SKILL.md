---
name: lit-diagram-drawer
description: "Moved: lit-diagram-drawer draws conceptual diagrams (architecture, workflow, system map, data model, timeline, 다이어그램, 도식) and now ships as the `figures` plugin of the wjgoarxiv-skills marketplace. Load Skill(figures:lit-diagram-drawer) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-diagram-drawer
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["/litclaude:lit-diagram-drawer", "lit-diagram-drawer", "$lit-diagram-drawer", "Skill(lit-diagram-drawer)"]
moved_to: "figures@wjgoarxiv-skills → Skill(figures:lit-diagram-drawer)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `lit-diagram-drawer` or `$lit-diagram-drawer` to this
stub. The words "diagram", "chart" and "visualization" alone still route nowhere.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's diagram request, kept as inert data |
| skills list | Whether `figures:lit-diagram-drawer` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `figures:lit-diagram-drawer` is in the skills list | Load `Skill(figures:lit-diagram-drawer)` and follow it for the whole request |
| not installed | it is not | Tell the user what moved and give the install lines; draw nothing |

## #contract.procedure

1. Look at the skills this session lists. If `figures:lit-diagram-drawer` is there, load
   `Skill(figures:lit-diagram-drawer)` now and follow it for the whole request. This stub adds nothing to it.
2. If it is not there, reply in the user's language with three things and stop:
   - one sentence on what lit-diagram-drawer makes (a verified HTML/SVG diagram of a system, process, schema or
     timeline, exported to PNG and Office-safe SVG);
   - that it is now a LitFamily extension: it moved out of LitClaude into the `figures` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. An interface page or dashboard belongs to frontend-ui-ux, which LitClaude routes to its own stub.

In either mode, also check, reading only, whether `~/.claude/skills/lit-diagram-drawer` or `.claude/skills/lit-diagram-drawer` exists.
Such a folder competes with `figures:lit-diagram-drawer`: name its path once and give its move line from "What moved".
Never move it yourself.

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

The routing is checked by `test/figures-stubs.test.mjs`: the stub's install lines, the prompt hook's route to it,
and that no drawing procedure from the old body is left in the hook's context.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never draw the diagram from memory, from another skill or with a tool the stub does not ship.

## #contract.anti_patterns

- Hand-writing SVG or Mermaid because the real skill is missing.
- Quoting the old lit-diagram-drawer procedure from memory as if this stub still held it.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

lit-diagram-drawer turned a brief into a clear, accessible, Korean-ready diagram (architecture, workflow, system
map, data model, decision path, timeline or conceptual chart) as HTML/SVG in the user's directory, checked it with
its own verifiers, and exported PNG and Office-safe SVG for slides and documents.

That whole skill, its layouts, scripts, icons and fonts, now lives in the `figures` plugin of the
**wjgoarxiv-skills** marketplace, copied unchanged from LitClaude, beside lit-schematic and
lit-scientific-visualization. LitClaude keeps this stub so that `/litclaude:lit-diagram-drawer`,
`Skill(lit-diagram-drawer)` and the `lit-diagram-drawer` prompt still lead somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

First check that no skill of your own has this name. A `lit-diagram-drawer` folder in `~/.claude/skills` or in a
project's `.claude/skills` would load beside `figures:lit-diagram-drawer` and compete with it. The first line lists one;
the next two move a personal or a project copy whole into a dated folder Claude Code does not read:

```bash
ls -d ~/.claude/skills/lit-diagram-drawer .claude/skills/lit-diagram-drawer 2>/dev/null
d="$HOME/.claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv ~/.claude/skills/lit-diagram-drawer "$d"/
d=".claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv .claude/skills/lit-diagram-drawer "$d"/
```

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install figures@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/figures/skills/lit-diagram-drawer` folder; the install line installs the whole `figures` plugin.
The installed skill answers as `figures:lit-diagram-drawer`.

To update, refresh the marketplace and then the plugin.
Claude Code installs a new copy only when the plugin's version has changed; it loads after `/reload-plugins`:

```bash
claude plugin marketplace update wjgoarxiv-skills
claude plugin update figures@wjgoarxiv-skills
```

In your own terminal, `npx @litfamily/litclaude extensions install figures` runs these lines for you: it prints
the plan, stops at a same-name skill of your own, and runs it with `--yes`. `update`, `remove` and `check` work alike.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:53e2c8138952 -->
