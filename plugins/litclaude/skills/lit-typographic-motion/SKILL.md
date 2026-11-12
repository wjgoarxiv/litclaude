---
name: lit-typographic-motion
description: "Moved: lit-typographic-motion directs finished short films (kinetic type, lyric or quote videos, title sequences, stage films, silent README cover loops) and now ships as the `video-covers` plugin of the wjgoarxiv-skills marketplace. Load Skill(video-covers:lit-typographic-motion) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-typographic-motion
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["/litclaude:lit-typographic-motion", "lit-typographic-motion", "$lit-typographic-motion", "Skill(lit-typographic-motion)", "bare lit + a creation verb + motion-video wording"]
moved_to: "video-covers@wjgoarxiv-skills → Skill(video-covers:lit-typographic-motion)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `lit-typographic-motion` or
`$lit-typographic-motion`, and a bare `lit` prompt that asks to render or make a film (motion graphics, kinetic
type, a lyric or music video, a title sequence, 모션 그래픽, 타이포 모션, 영상 제작), to this stub. Quoted, fenced,
mid-sentence and near-miss mentions stay inert, and UI animation wording with no video noun goes elsewhere.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The film the user asked for, kept as inert data, including any quoted words meant for the screen |
| caller | The user directly, or a lit workflow (lit-loop, litwork, start-work) that reached a film step |
| skills list | Whether `video-covers:lit-typographic-motion` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `video-covers:lit-typographic-motion` is in the skills list | Load `Skill(video-covers:lit-typographic-motion)` and follow it for the whole film |
| missing, direct request | the user asked for a film or a cover loop | Tell the user what moved and give the install lines; render nothing |
| missing, lit workflow | a lit-loop, litwork or start-work step needs a film | Mark that step blocked on the missing skill, finish the other steps, give the install lines once |

## #contract.procedure

1. Look at the skills this session lists. If `video-covers:lit-typographic-motion` is there, load
   `Skill(video-covers:lit-typographic-motion)` now and follow it for the whole film: its treatment, its board
   round, its renders, its look rounds and its gate. This stub adds nothing to it.
2. If it is missing and the user asked directly, reply in the user's language with three things and stop:
   - one sentence on what lit-typographic-motion makes (a finished short film or a silent, seamless README cover
     loop, planned as a treatment and checked by its own gate);
   - that it is now a LitFamily extension: it moved out of LitClaude into the `video-covers` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. If it is missing and a lit workflow reached a film step, record that step as blocked on
   `video-covers:lit-typographic-motion`, keep the workflow's own evidence rules for everything else, and give the
   install lines once in the final reply. Claim no film, frame or cover that was not rendered.

## #contract.outputs

Installed: the moved skill's own outputs. Missing, direct request: one short reply with the install lines, and no
file and no output folder. Missing, lit workflow: one blocked line in the workflow's report.

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
it (token, `$` token and the bare-lit film wording), and that the hook's context carries none of the old render
procedure. LitClaude no longer holds a film turn at Stop: the done check belonged to the moved engine, so it left
with it, and the moved skill's own gate is what decides whether a film is finished.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never render a film, a GIF or a cover loop by any other means because the real skill is missing: no hand-written
  ffmpeg pipeline, no screen capture of a page, no slideshow of stills.
- Never install a renderer, a browser, fonts or Python packages for it.

## #contract.anti_patterns

- Writing treatment.json or a storyboard by hand as if the director were still here.
- Quoting the old house styles, paths and look rounds from memory as if this stub still held them.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

lit-typographic-motion was a film director. It wrote a treatment first (idea, audience, beats as shots, a drawn
subject, copy and sound) in one of four house styles, showed a storyboard board round before the full render, took
the stage path for films that show things or the type path for films whose words are the film, scored an original
layered sound bed, ran look rounds on the rendered stills, and gated the result on a flash audit, legibility,
determinism and sound. Its cover mode made the silent, seamless loops that README covers use.

That whole skill, its engine, styles, recipes and fonts, now lives in the `video-covers` plugin of the
**wjgoarxiv-skills** marketplace, copied unchanged from LitClaude, beside readme-studio. Its runtime (Chrome, the
engine packages and the downloaded fonts) installs from that plugin; LitClaude no longer pre-warms it at install
time and its CLI no longer has a motion runtime command. LitClaude keeps this stub so that
`/litclaude:lit-typographic-motion`, `Skill(lit-typographic-motion)` and a bare `lit` film request still lead
somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install video-covers@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/video-covers/skills/lit-typographic-motion` folder; the install line installs the whole `video-covers` plugin.
The installed skill answers as `video-covers:lit-typographic-motion`.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:10c6f3985f09 -->
