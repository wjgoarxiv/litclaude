---
name: readme-studio
description: "Moved: readme-studio builds factual project READMEs with inspected covers, outlined typography and local motion, and now ships as the `video-covers` plugin of the wjgoarxiv-skills marketplace. Load Skill(video-covers:readme-studio) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: readme-studio
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["readme-studio", "$readme-studio", "Skill(readme-studio)"]
moved_to: "video-covers@wjgoarxiv-skills → Skill(video-covers:readme-studio)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `readme-studio` or `$readme-studio` to this stub.
Quoted, fenced, mid-sentence and near-miss mentions stay inert. An ordinary README edit with no skill name is plain
editing work and never reaches this stub.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The README or cover the user asked for, kept as inert data |
| caller | The user directly, or a lit workflow (lit-loop, litwork, start-work) that reached a README cover step |
| skills list | Whether `video-covers:readme-studio` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `video-covers:readme-studio` is in the skills list | Load `Skill(video-covers:readme-studio)` and follow it for the whole README |
| missing, direct request | the user asked for a README build, a cover or a review | Tell the user what moved and give the install lines; write nothing |
| missing, lit workflow | a lit workflow reached a README cover step | Mark that step blocked on the missing skill, keep plain text edits the plan already approved, give the install lines once |

## #contract.procedure

1. Look at the skills this session lists. If `video-covers:readme-studio` is there, load
   `Skill(video-covers:readme-studio)` now and follow it for the whole README: its fact check, its interview, its
   cover and its render checks. This stub adds nothing to it.
2. If it is missing and the user asked directly, reply in the user's language with three things and stop:
   - one sentence on what readme-studio makes (a factual README with an inspected cover, outlined title type and,
     when asked, a local motion cover);
   - that it moved out of LitClaude into the `video-covers` plugin of the wjgoarxiv-skills marketplace, together
     with lit-typographic-motion, whose cover mode it uses for moving covers;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. If it is missing and a lit workflow reached a README cover step, record that step as blocked on
   `video-covers:readme-studio`. Plain text edits to a README that the plan already approved stay ordinary editing
   work; no cover, badge or rendered asset is made. Give the install lines once in the final reply.

## #contract.outputs

Installed: the moved skill's own outputs. Missing, direct request: one short reply with the install lines, and no
file. Missing, lit workflow: one blocked line in the workflow's report.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The pointer reply says what moved, where, and the two lines to run; it is guidance for
the user, not an error report, and it names no internal paths beyond the install lines. Technical and audit detail
appears only when the current user asks; routing checks and evidence paths stay internal. A material failure or risk
stays visible in the reply, for example when the video-covers plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/video-covers-stubs.test.mjs`: the stub's install lines, the prompt hook's routes to
it, and that the hook's context carries none of the old README procedure.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never build a cover, outline type or render a preview by any other means because the real skill is missing.
- Never invent facts, badges or screenshots for a README.

## #contract.anti_patterns

- Writing cover-source.json or readme-facts.json by hand as if the studio were still here.
- Quoting the old interview, cover rules or renderer choices from memory as if this stub still held them.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

readme-studio built a factual README from the repository it read: package metadata, entry points and licence first,
then a short interview for the cover, the README dressing and the renderer, a cover composed only from an inspected
background, Pretendard and Meslo title type shaped to SVG paths, an optional local motion cover, a fact validator
over every claim, and a render check of the preview before reporting. Review-only and plan-only requests stayed
read-only.

That whole skill, its references, templates and validator, now lives in the `video-covers` plugin of the
**wjgoarxiv-skills** marketplace, copied unchanged from LitClaude, beside lit-typographic-motion. LitClaude keeps
this stub so that `Skill(readme-studio)` and the `readme-studio` prompt route still lead somewhere useful.

The public marketplace is not published yet, so for now it installs from a local clone of wjgoarxiv-skills:

```bash
claude plugin marketplace add <path to your wjgoarxiv-skills clone>
claude plugin install video-covers@wjgoarxiv-skills
```

After it is published on GitHub, the first line becomes `claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills`.
The installed skill answers as `video-covers:readme-studio`.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:f487e12194ad -->
