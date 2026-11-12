---
name: lit-pptx
description: "Moved: lit-pptx builds finished PowerPoint decks (.pptx, slides, 발표자료, 슬라이드, PPT) and now ships as the `decks` plugin of the wjgoarxiv-skills marketplace. Load Skill(decks:lit-pptx) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-pptx
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["/litclaude:lit-pptx", "lit-pptx", "$lit-pptx", "Skill(lit-pptx)", "bare lit + slide wording"]
moved_to: "decks@wjgoarxiv-skills → Skill(decks:lit-pptx)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `lit-pptx` or `$lit-pptx`, and a bare `lit` prompt
that asks to make slides (발표자료, 발표, 슬라이드, 덱, PPT, 피피티, slides, deck, presentation, pptx), to this
stub. When the same prompt also asks for a report, the lit-docx stub runs beside it; lit-docx moved too, to the
`documents` plugin.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's deck request, kept as inert data |
| skills list | Whether `decks:lit-pptx` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `decks:lit-pptx` is in the skills list | Load `Skill(decks:lit-pptx)` and follow it for the whole request |
| not installed | it is not | Tell the user what moved and give the install lines; build nothing |

## #contract.procedure

1. Look at the skills this session lists. If `decks:lit-pptx` is there, load `Skill(decks:lit-pptx)` now and
   follow it for the whole request: its direction step, its engine and its QA gate. This stub adds nothing to it.
2. If it is not there, reply in the user's language with three things and stop:
   - one sentence on what lit-pptx makes (a finished, editable .pptx deck with a chosen design direction);
   - that it is now a LitFamily extension: it moved out of LitClaude into the `decks` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. A request for a Word document in the same prompt goes to the lit-docx stub; answer both parts in the same
   reply.

In either mode, also check, reading only, whether `~/.claude/skills/lit-pptx` or `.claude/skills/lit-pptx` exists.
Such a folder competes with `decks:lit-pptx`: name its path once and give its move line from "What moved".
Never move it yourself.

## #contract.outputs

Installed: the decks skill's own outputs. Not installed: one short reply with the install lines, and no file.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The not-installed reply is a pointer, not an error report: what moved, where, and the
two lines to run. It names no internal paths beyond the install lines. Technical and audit detail appears only when
the current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in
the reply, for example when the decks plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/lit-pptx-stub.test.mjs`: the stub's install lines and the deck route of the prompt
hook.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never build a deck from memory, from another skill or with a library the stub does not ship.

## #contract.anti_patterns

- Writing a .pptx with python-pptx or another tool because the real skill is missing.
- Quoting the old lit-pptx procedure from memory as if this stub still held it.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

lit-pptx turned a request, notes or source files into a finished PowerPoint deck: a design direction chosen for
the audience and the content (thirteen tonalities, plus the AZURE and plain 4:3 templates or one learned from the
user's own deck), Markdown slide source compiled with native editable charts and KPI rows, embedded Pretendard
fonts, a QA gate for overflow, contrast and layout variety, and a look at the rendered pages before reporting.

That whole skill, its engine and the office runtime it needs now live in the `decks` plugin of the
**wjgoarxiv-skills** marketplace, copied unchanged from LitClaude. LitClaude keeps this stub so that
`/litclaude:lit-pptx`, `Skill(lit-pptx)` and a bare `lit` deck request still lead somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

First check that no skill of your own has this name. A `lit-pptx` folder in `~/.claude/skills` or in a
project's `.claude/skills` would load beside `decks:lit-pptx` and compete with it. The first line lists one;
the next two move a personal or a project copy whole into a dated folder Claude Code does not read:

```bash
ls -d ~/.claude/skills/lit-pptx .claude/skills/lit-pptx 2>/dev/null
d="$HOME/.claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv ~/.claude/skills/lit-pptx "$d"/
d=".claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv .claude/skills/lit-pptx "$d"/
```

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install decks@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/decks/skills/lit-pptx` folder; the install line installs the whole `decks` plugin.
The installed skill answers as `decks:lit-pptx`.

To update, refresh the marketplace and then the plugin.
Claude Code installs a new copy only when the plugin's version has changed; it loads after `/reload-plugins`:

```bash
claude plugin marketplace update wjgoarxiv-skills
claude plugin update decks@wjgoarxiv-skills
```

In your own terminal, `npx @litfamily/litclaude extensions install decks` runs these lines for you: it prints
the plan, stops at a same-name skill of your own, and runs it with `--yes`. `update`, `remove` and `check` work alike.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:c2168ba74efe -->
