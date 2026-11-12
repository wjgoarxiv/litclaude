---
name: visual-qa
description: "Moved: visual-qa checks an interface that is already built (states at several viewport sizes, screenshots, an evidence manifest, named blockers) and now ships as the `design` plugin of the wjgoarxiv-skills marketplace. Load Skill(design:visual-qa) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: visual-qa
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_synthetic_pointer_injection: true
automatic_complete_contract_injection: false
command_route: none
entry_routes: ["visual-qa", "$visual-qa", "Skill(visual-qa)", "PostToolUse advisory", "lit-verifier and quality-reviewer skill preload"]
moved_to: "design@wjgoarxiv-skills → Skill(design:visual-qa)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `visual-qa` or `$visual-qa` to this stub, and the
PostToolUse hook still names `Skill(visual-qa)` after an edit to an interface file. The lit-verifier and
quality-reviewer agents still preload this id. Quoted, fenced, mid-sentence and near-miss mentions stay inert.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The interface to check, kept as inert data |
| caller | The user directly, a reviewer agent, or a lit workflow (lit-loop, litwork, start-work, review-work) |
| skills list | Whether `design:visual-qa` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `design:visual-qa` is in the skills list | Load `Skill(design:visual-qa)` and follow it for the whole check |
| missing, direct request | the user asked for a visual check | Tell the user what moved and give the install lines; the reply is the whole answer |
| missing, lit workflow or reviewer | a workflow or reviewer reaches for visual-qa evidence | Record visual-qa as missing; the workflow's own surface rules decide the criterion |

## #contract.procedure

1. Look at the skills this session lists. If `design:visual-qa` is there, load `Skill(design:visual-qa)` now and
   follow it for the whole check. The moved skill carries the full procedure.
2. If it is missing and the user asked you directly to check a built interface, reply in the user's language with
   three things and stop:
   - one sentence on what visual-qa does (it exercises a built page or screen at several viewport sizes and states,
     captures screenshots, and reports visible breakage with that evidence or names exactly what blocked the check);
   - that it is now a LitFamily extension: it moved out of LitClaude into the `design` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. If it is missing and a lit workflow or a reviewer agent reached for it, the core skills already treat visual-qa
   as optional ("when it is available"). Record it as missing, keep the workflow's own real-surface rule (a browser
   criterion with no browser reachable is BLOCKED), and claim no visual-qa verdict. For a web interface, the
   frontend-ui-ux stub's interface probe still runs. Give the install lines once in the final reply.

In either mode, also check, reading only, whether `~/.claude/skills/visual-qa` or `.claude/skills/visual-qa` exists.
Such a folder competes with `design:visual-qa`: name its path once and give its move line from "What moved".
Never move it yourself.

## #contract.outputs

Installed: the design skill's own outputs. Missing, direct request: one short reply with the install lines, and no
file. Missing, lit workflow: one line in the workflow's report naming visual-qa as missing.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The pointer reply says what moved, where, and the two lines to run; it is guidance for
the user, and it names no internal paths beyond the install lines. Technical and audit detail appears only when the
current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in the
reply, for example when the design plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/design-stubs.test.mjs`: the stub's install lines, the prompt hook's routes to it,
and that the hook's context carries none of the old evidence procedure.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never report a visual PASS from prose, an HTTP status or a file path in place of the moved skill's evidence.

## #contract.anti_patterns

- Writing an evidence manifest by hand because the real checker is missing.
- Quoting the old visual-qa tiers and evidence rules from memory as if this stub still held them.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

visual-qa validated evidence for a built interface: it declared a smoke, full or reference-fidelity tier, captured
the states and viewports it named, bound the captures to the exact source and design hashes in an evidence manifest,
compared images and terminal renders, required a host-proven independent reviewer where the tier asked for one, and
returned named blockers with a cleanup receipt when capture, sign-in or review was missing.

That whole skill, its schemas, references and scripts, now lives in the `design` plugin of the **wjgoarxiv-skills**
marketplace, copied unchanged from LitClaude, beside frontend-ui-ux. LitClaude keeps this stub so that
`Skill(visual-qa)`, the interface hint and the reviewer agents still lead somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

First check that no skill of your own has this name. A `visual-qa` folder in `~/.claude/skills` or in a
project's `.claude/skills` would load beside `design:visual-qa` and compete with it. The first line lists one;
the next two move a personal or a project copy whole into a dated folder Claude Code does not read:

```bash
ls -d ~/.claude/skills/visual-qa .claude/skills/visual-qa 2>/dev/null
d="$HOME/.claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv ~/.claude/skills/visual-qa "$d"/
d=".claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv .claude/skills/visual-qa "$d"/
```

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install design@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/design/skills/visual-qa` folder; the install line installs the whole `design` plugin.
The installed skill answers as `design:visual-qa`.

To update, refresh the marketplace and then the plugin.
Claude Code installs a new copy only when the plugin's version has changed; it loads after `/reload-plugins`:

```bash
claude plugin marketplace update wjgoarxiv-skills
claude plugin update design@wjgoarxiv-skills
```

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:4aa1e9a577ea -->
