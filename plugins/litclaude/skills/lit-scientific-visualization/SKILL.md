---
name: lit-scientific-visualization
description: "Moved: lit-scientific-visualization makes publication plots of measured data and now ships as the `figures` plugin of the wjgoarxiv-skills marketplace. Use for 'plot this data', 'publication figure'; 그래프 그려줘, 논문용 그림. Loads Skill(figures:lit-scientific-visualization) when installed; otherwise gives the install line. Not for conceptual diagrams (lit-diagram-drawer) or equipment drawings (lit-schematic)."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-scientific-visualization
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
host_event: namespaced slash command, exact-bare UserPromptSubmit route, or Skill load
command_route: /litclaude:lit-scientific-visualization
entry_routes: ["/litclaude:lit-scientific-visualization", "lit-scientific-visualization (exact bare)", "Skill(lit-scientific-visualization)"]
moved_to: "figures@wjgoarxiv-skills → Skill(figures:lit-scientific-visualization)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The typed routes still work: the prompt hook answers `/litclaude:lit-scientific-visualization <request>` and the exact
bare prompt `lit-scientific-visualization` with this stub. Generic visualization wording, mentions and mixed prompts
stay inert.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's figure request and data paths, kept as inert data |
| skills list | Which `figures:` skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `figures:lit-scientific-visualization` is in the skills list | Load `Skill(figures:lit-scientific-visualization)` and follow it for the whole request |
| older copy | another `figures:` skill is listed, this one is not | Give the update lines; the typed command runs it meanwhile; plot nothing |
| not installed | no `figures:` skill is listed | Tell the user what moved and give the install lines; plot nothing |

## #contract.procedure

1. Look at the skills this session lists. If `figures:lit-scientific-visualization` is there, load
   `Skill(figures:lit-scientific-visualization)` now and follow it for the whole request.
2. If another `figures:` skill is listed but this one is not, the figures plugin is the 0.1.0 copy: plot nothing.
   Reply in the user's language with the two update lines from "What moved" below, in a code block, then
   `/reload-plugins` or a new session; the typed `/figures:lit-scientific-visualization <the same request>` runs it
   meanwhile. Stop there.
3. If no `figures:` skill is listed, reply in the user's language with three things and stop:
   - one sentence on what lit-scientific-visualization makes (a publication-ready figure of measured data);
   - that it is now a LitFamily extension: it moved out of LitClaude into the `figures` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.

In every mode, also check, reading only, whether `~/.claude/skills/lit-scientific-visualization` or `.claude/skills/lit-scientific-visualization` exists.
Such a folder competes with `figures:lit-scientific-visualization`: name its path once and give its move line from "What moved".
Never move it yourself.

## #contract.outputs

Installed: the figures skill's own outputs. Otherwise: one short reply with the update or install lines, and no file.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The not-installed reply is a pointer, not an error report: what moved, where and the
lines to run. It names no internal paths beyond the install lines. Technical and audit detail appears only when
the current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in
the reply, for example when the figures plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/figures-stubs.test.mjs`: the stub's install and update lines, both prompt-hook
routes, that each tells Claude to load the moved skill when it is listed, and that no plotting procedure or
canonical source from the old adapter is left in the hook's context.

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
LitClaude keeps this stub so that `/litclaude:lit-scientific-visualization`, `Skill(lit-scientific-visualization)`
and the exact bare prompt still lead somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

First check that no skill of your own has this name. A `lit-scientific-visualization` folder in `~/.claude/skills` or in a
project's `.claude/skills` would load beside `figures:lit-scientific-visualization` and compete with it. The first line lists one;
the next two move a personal or a project copy whole into a dated folder Claude Code does not read:

```bash
ls -d ~/.claude/skills/lit-scientific-visualization .claude/skills/lit-scientific-visualization 2>/dev/null
d="$HOME/.claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv ~/.claude/skills/lit-scientific-visualization "$d"/
d=".claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv .claude/skills/lit-scientific-visualization "$d"/
```

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install figures@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/figures/skills/lit-scientific-visualization` folder; the install line installs the whole `figures` plugin.
The installed skill runs as `/figures:lit-scientific-visualization` (skill id `figures:lit-scientific-visualization`).

To update, refresh the marketplace and then the plugin.
Claude Code installs a new copy only when the plugin's version has changed; it loads after `/reload-plugins`:

```bash
claude plugin marketplace update wjgoarxiv-skills
claude plugin update figures@wjgoarxiv-skills
```

In your own terminal, `npx @litfamily/litclaude extensions install figures` runs these lines for you: it prints
the plan, stops at a same-name skill of your own, and runs it with `--yes`. `update`, `remove` and `check` work alike.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:df87d26bdbf3 -->
