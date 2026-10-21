<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: seven armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">A Claude Code plugin that helps every session plan the work, build it, check it, and leave a note the next session can pick up.</p>

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litclaude"><img src="https://img.shields.io/npm/v/@litfamily/litclaude?color=FF6337&amp;label=npm" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litclaude"><img src="https://img.shields.io/npm/dm/@litfamily/litclaude?color=D7F75B" alt="npm downloads per month" /></a>
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/litclaude/stargazers"><img src="https://img.shields.io/github/stars/wjgoarxiv/litclaude?style=flat" alt="GitHub stars" /></a>
</p>

Add `lit` to a Claude Code prompt and Claude pins the goal, writes a failing test first, checks
the real result and writes down what it found. Type `handoff` when you stop, and the next session
starts from that note instead of from scratch. To try it, install once and give Claude a task:

```bash
npx @litfamily/litclaude@latest install   # then open a new Claude Code session
```

```text
lit fix the date parsing bug in src/dates.js, with a test
```

<p align="center"><a href="#install">Install</a> &nbsp; <a href="#quick-start">Quick start</a> &nbsp; <a href="./docs/guide.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Guide</a> &nbsp; <a href="./docs/skills.md">Skills</a> &nbsp; <a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Film</a> &nbsp; <a href="./docs/guide.md#safety"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> Safety</a> &nbsp; <a href="./README_ko-KR.md">한국어</a></p>

<!-- demo-gif --><p align="center"><img src="./docs/assets/demo.webp" width="960" alt="The film opens on a title card with the LIT mark, LitClaude and The lit workflow for Claude Code, then cuts to a Claude Code session in a small Node project with LitClaude installed, where a numbered two-line caption names each step. The prompt &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot; is sent, and the hook answers with the LIT mark and LIT IGNITED · lit-loop. The LIT card above the prompt switches from ready to lit-loop and draws its workflow map, PIN, RED, GREEN, VERIFY, REVIEW and RECORD, with PIN lit. Claude appends the new test through the shell and runs it; the test fails and the map turns RED. While Claude changes greet.js, the live step on the card names the running tool and how long it has run, Bash · 0:00. When the command finishes the tests pass, and the map checks GREEN and lights VERIFY. The live step clears, the card goes idle, and the film ends on the LitClaude mark and the install command npx @litfamily/litclaude@latest install." /></p>

## Why LitClaude

You ask Claude Code for something: a bug fixed, a screen built, a project finished. Starting
takes one sentence. The trouble comes later. The conversation grows, the context gets
compacted, the session ends, and next time you have to work out where you left off: what you
decided, what you checked, what comes next. And "done" often means the model said so.

LitClaude gives each session a routine to follow. Add `lit` to a request and Claude pins the
goal, writes a failing test first, checks the real thing it built, and records what it found.
For a bigger change, `lit plan` writes a plan you approve before anything is edited. When you
stop, a handoff file keeps the goal, the results and the next step in your project, where the
next session can read them. Claude Code still runs the session and picks the model, and
LitClaude adds the way of working on top.

In one line, for a friend: *put `lit` in front of a Claude Code task and it writes the failing
test first, checks the result, and leaves tomorrow's session a note.*

### Who it's for

LitClaude suits people who already use Claude Code on real projects and want two things from
it: proof before "done", and a session that can pick up where the last one stopped. It helps
most on work that runs longer than one sitting, such as a feature with tests, a refactor or a
research question. It also builds slides and Word reports and cleans up stiff Korean or English
prose, so it is useful outside code as well.

### What a session looks like

This is the demo above in three lines. You type the first one, LitClaude's prompt hook answers
with the second, and the card above the prompt walks the third as the work happens:

```text
lit add a --shout flag that prints the greeting in capitals, with a test
LIT IGNITED · lit-loop
PIN → RED (the new test fails) → GREEN (the tests pass) → VERIFY
```

## Install

You need Node.js with npm, and Claude Code. Run this in any terminal:

```bash
npx @litfamily/litclaude@latest install
```

The first time, npx asks whether to install the package; answer `y`. The installer registers
the plugin, adds the LitClaude status line, and asks you two things: the status-line colour and
an optional output style. A new install starts in the `safe` permission mode, which adds no
permission rules, and leaves the rest of your Claude settings as they are. It also downloads
the rendering engine and fonts the video skill needs, so the first install takes a little
longer. Quit Claude Code and start it again afterwards so the plugin loads.

Two switches change how the install runs:

- `--yes` after `install` keeps the default colour and style, for when you would rather not
  answer questions.
- `--dry-run` before `install` prints every change and makes none, for when you want to look
  first: `npx @litfamily/litclaude@latest --dry-run install`.

[Permission modes, version pins, global installs and every other switch](./docs/guide.md#installation-reference).

If you only want the plugin, without the status line or the installer, Claude Code can add it
from the LitFamily marketplace:

```text
/plugin marketplace add wjgoarxiv/litfamily
/plugin install litclaude@litfamily
```

Pick one of the two routes. Enabling the plugin both ways loads its hooks twice.
[Choosing between the npm and marketplace routes](./docs/migration.md#scoped-npm-migration).

You can also hand the install to a coding agent. Paste this prompt into it; the agent checks
your setup, shows you what would change and waits for your yes before it installs anything:

```text
Please install LitClaude, a plugin for Claude Code, on this computer.

- Use only the official npm package @litfamily/litclaude. Do not clone repositories or
  install anything else.
- Before you change anything, check that Node.js, npm and Claude Code are installed, then run
  npx @litfamily/litclaude@latest --dry-run install --yes
  Show me what it would change and ask whether to go ahead. Wait for my answer.
- When I say yes, run npx @litfamily/litclaude@latest install --yes
  (--yes keeps the default status-line colour and output style; I can run the install again
  in my own terminal later to pick them.)
- Then run npx @litfamily/litclaude@latest doctor and tell me the result. It should end in
  DOCTOR_PASS. If it does not, show me the lines that failed and stop there.
- Finally, remind me to quit Claude Code and start it again so the plugin loads.
```

## Quick start

Start Claude Code in a project folder the usual way, then type `lit`:

```bash
claude
```

```text
lit
```

You will see the activation notice from the picture above. Now hand it one small task:

```text
Build a to-do list in a single HTML file with no external dependencies.
Implement add, complete, and delete. Record what you checked and the next step.
```

Claude's reply opens with **🔥 LIT IGNITED · lit-loop 🔥**, works through the goal and its
checks, and ends with what it checked and what comes next. Then open the HTML yourself and
click through all three actions; that is the only way to know the buttons work. If Claude
had no browser to test with, ask it to mark the look and the clicks as unverified.
[Pictures of the installer, doctor and status line](./docs/guide.md#what-you-will-see-on-screen).

When you stop for the day, type `handoff` and keep the file path it gives you. In the next
session, open the same project and ask Claude to read that file, check the current state and
name the next step.

## The LIT card

While you work, LitClaude keeps a small card just above the prompt. It shows where you are in
the LIT workflow, what Claude is doing at this moment and which skills it has used, so you can
follow Claude without scrolling back through the conversation.

Read it from top to bottom:

- The top edge names the workflow and its stage.
- The first row is a map of that workflow. A request runs from the interview through the plan,
  the work and the review to done, a research run goes wave by wave, and a lit-loop criterion
  steps from PIN through RED and GREEN to RECORD. Stages behind you carry a check and the one
  you are in is lit. A request that fits none of these keeps the simpler PLAN, WORK and REVIEW
  track.
- The second row says more about that stage: the task count and the next task, the review
  lanes that have passed, or the interview round. On its right sits the tool Claude is running
  and for how long. Only the tool's name appears there; what the tool was given stays out.
- The third row holds a chip for each LitFamily skill that fired.
- The bottom edge repeats the context, the five-hour and weekly usage and the Git branch from
  the status line.

Before anything runs, the card rests and tells you how to begin:

<p align="center"><img src="./docs/assets/card/idle.webp" width="960" alt="The LIT card above an empty Claude Code prompt. The top edge reads LIT · ready with idle on the right, the first row shows PLAN, WORK and REVIEW as empty rings, the detail row is empty, the skills row reads no LitFamily skill yet · type lit &lt;task&gt; to start one, and the bottom edge shows 5h 17%, 1w 52% and the branch main." /></p>

Give it a request with `lit`, and the card names the workflow, lights the stage it is in and a
chip for the skill that took the request. LitClaude's own hooks move the map on as the work
happens, when the plan is saved, a task is ticked or a reviewer reports, so it keeps up without
Claude having to report each step:

<p align="center"><img src="./docs/assets/card/working.webp" width="960" alt="The LIT card in the middle of a start-work run. The top edge reads LIT · start-work with WORK ● on the right, the map shows interview and plan checked in orange and pink, work 1/2 as a filled cyan pill and review and done still dim, the detail row reads task 1/2 with a half-filled pink bar and next ▸ Task 2: GREEN, implement shout and verify, with thinking · 0:02 on its right, the skills row holds start-work, and the bottom edge shows ctx 9%, 5h 20%, 1w 53% and the branch main." /></p>

While Claude is busy, the card does not sit still. The LIT pill slowly glows from pink to
orange and back, a light passes over the stage it is in and over the skill chip, a bright point
travels along the map toward the next stage, and a spark runs along the top edge and back along
the bottom. A glance is enough to tell that LitClaude is still at work.

When the turn ends, the card goes back to idle and stops moving. The map keeps where the work got to,
and the chip turns grey and stays as a recent skill, so you can still see what ran last:

<p align="center"><img src="./docs/assets/card/after.webp" width="960" alt="The LIT card after the review. The top edge reads LIT · review-work in a dim colour with idle on the right, every stage of the map from interview through work and review to done carries a check, the detail row reads complete, the skills row keeps review-work as a grey chip, and the bottom edge shows ctx 16%, 5h 21%, 1w 53% and the branch main." /></p>

The card needs Claude Code 2.1.287 or later, in the terminal or in the Code tab of the Claude
desktop app. The installer sets up both, since the app reads the same settings; open a new
session in the app after installing. The app draws the card as a picture with the same rows and
motion, because it sets mod text in a proportional font.

By default the card stays for the whole session and moves while Claude works. Three options in
`/config`, under LitClaude, change that:

- `band` set to `auto` shows the card only while work runs, if you like a clean prompt between
  tasks; `off` hides it.
- `motion` set to `subtle` gives a quieter card, and `off` keeps it still.
- `notify` set to `finish` is for when you step away during long work. LitClaude then sends a
  notification through your terminal when the work completes or a LIT turn longer than three
  minutes ends. It stays off until you turn it on.

The desktop app has no editor for these options, so change them from a terminal there:

```bash
npx @litfamily/litclaude@latest config             # show the options
npx @litfamily/litclaude@latest config band auto   # or motion subtle, glyphs basic, notify finish
```

[Everything the card can show](./docs/hooks.md#the-lit-band-claude-code-mod).

## Automatic handoff

A long session fills Claude's context window, and when Claude Code compacts it, details of your
work can drop out of the summary. Automatic handoff has Claude write a handoff file while there
is still room, then reads it back after the compaction, so the rest of the session picks up from
your own notes.

It stays off until you turn it on and choose the percent. Type `lit-handoff auto on 65` as your
whole prompt, with any whole number from 1 to 99, and LitClaude answers with a single line
without starting any other work. Later, `status` tells you
what is in force, and `off` turns it off while keeping your percent for next time:

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/handoff/settings-dark.webp" /><img src="./docs/assets/handoff/settings-light.webp" width="686" alt="Terminal window titled claude. The prompt lit-handoff auto on 65, the hook line UserPromptSubmit says: Automatic handoff is on at 65%. and Claude replying Automatic handoff is on at 65%. Then lit-handoff auto status, answered with Automatic handoff is on at 65%. again, and lit-handoff auto off, answered with Automatic handoff is off." /></picture></p>

The setting belongs to the project folder you start Claude Code in, so each project keeps its
own. Choose a percent below the point where Claude Code compacts by itself; if the compaction
comes first, there is no handoff to bring back. While it is on, the status line shows
`handoff@65%`.

When a turn ends with the context at or past your percent, the Stop hook asks Claude to write
the handoff before it stops. Claude Code gives a plugin no way to start a compaction, so
Claude ends with a one-line reminder and you run `/compact`. When the compaction is done,
LitClaude reads the fresh handoff back into the conversation:

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/handoff/compact-dark.webp" /><img src="./docs/assets/handoff/compact-light.webp" width="686" alt="Terminal window titled claude. Claude ends its turn with Handoff saved. Run /compact now. The user types /compact, and Claude Code reports Compacted (ctrl+o to see full summary) and Read .handoff/HANDOFF.md (44 lines). The status line below reads ctx 0%/1m │ handoff@65%." /></picture></p>

You can also switch it on from the shell before you start Claude Code. The two variables win
over the saved setting, and the doctor shows what is in force:

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/handoff/env-dark.webp" /><img src="./docs/assets/handoff/env-light.webp" width="686" alt="Terminal window titled zsh. The commands export LITCLAUDE_AUTO_HANDOFF=1, export LITCLAUDE_AUTO_HANDOFF_PERCENT=65 and npx @litfamily/litclaude@latest doctor, then among the doctor lines Auto-handoff: on at 65% and, last, DOCTOR_PASS." /></picture></p>

[How automatic handoff works, step by step](./docs/guide.md#automatic-handoff).

## What you get

LitClaude ships 36 skills you can start, three that run on their own, 17 slash commands and
11 agents. Most days you will use a handful of them.

### The work loop

Add `lit` to any request. Claude pins the goal, writes a failing test first, makes the
smallest change that passes it, checks the real result, and leaves a record in the project.

```text
Fix the date parsing bug in src/dates.js and add a test that fails without the fix. lit
```

### Plan first, then build

For a larger change, `lit plan` writes a plan with numbered tasks and a yes-or-no check for
each one, and edits nothing yet. Once you approve it, `/litclaude:start-work` runs it task by
task and ticks a box only after its checks pass.

```text
lit plan Add CSV export to the reports page, with tests.
/litclaude:start-work <the plan file it wrote>
```

### A second look before you merge

`lit review` picks a mode from what exists: plan review for a plan that has not started, work
review for a finished change. Work review sends five independent review lanes over the same
change and its evidence. They report findings first; fixing them is a separate step. `lit review
plan` or `lit review work` forces a mode.

```text
lit review the changes on this branch
```

### Research with sources

`lit research` splits a question, sends parallel searchers over public sources, and keeps
facts and uncertainty apart in the answer. It stops at logins and paywalls.

```text
lit research Which SQLite settings matter most for write speed in a small web app?
```

### Slides, reports and Korean prose

Ask for slides or a report and end the prompt with `lit`: you get an editable `.pptx` deck
with native charts or a styled `.docx` document, set in Pretendard and checked page by page
as rendered. `lit-humanizer` rewrites stiff English or Korean prose and keeps the facts.

```text
팀 워크숍 발표자료 만들어줘 lit
write a two-page project proposal for the new onboarding flow lit
lit-humanizer docs/intro.md
```

### Carry work into the next session

`handoff` writes a continuation file with the goal, what was checked and what is left.
Automatic handoff can write it for you before Claude Code compacts a long session; it stays
off until you pick a percent with `lit-handoff auto on 60`.

[All routes](./docs/guide.md#what-to-type) and [all skills, with a picture of each](./docs/skills.md).

## How it works

```mermaid
flowchart LR
    P["lit prompt"] --> H["UserPromptSubmit hook<br/>picks the workflow"]
    C["/litclaude:* command"] --> S["Claude reads the skill"]
    H --> S
    S --> W["plan · build · check · review"]
    W --> F["project files and checked results"]
    W --> L[".litclaude/<br/>goal and record"]
    L --> N["handoff file for the next session"]
```

The installer copies the plugin into Claude Code's plugin folder and registers it. When you
send a plain prompt, a hook reads it and adds a short note telling Claude which workflow fits;
a slash command goes straight to its skill. Other hooks load your project rules at session
start and remind Claude what to check after an edit. Goal-bound work keeps its record in the
project's `.litclaude/` folder, which carries its own `.gitignore` (containing `*`), so Git
skips it without any change to your own ignore files. Nothing runs between sessions.
[The hooks in detail](./docs/hooks.md) and [what goes over the network](./docs/privacy.md).

## Requirements, update and uninstall

You need Node.js with npm, and Claude Code. Slides and documents install their pinned tools
into `~/.cache/litclaude/office-runtime` the first time you use them.

Three commands look after an npm install:

```bash
npx @litfamily/litclaude@latest doctor      # check the plugin, status line and permission mode
npx @litfamily/litclaude@latest update      # install the latest release now
npx @litfamily/litclaude@latest uninstall   # remove what LitClaude installed
```

A healthy `doctor` run ends in `DOCTOR_PASS`. You rarely need `update` by hand: once a day at
most, a new Claude Code session checks npm for a newer version in the background, and a later
session installs it before it starts work. `uninstall` removes only the plugin, status
line, permission and local state entries LitClaude manages. If an install was changed by hand,
it leaves it alone and points you to the
[ownership guidance](./docs/migration.md#ownership-conflicts).

If you added the plugin through the marketplace, it has no LitClaude status line, and you
update or remove it from Claude Code's `/plugin` menu.

## Learn more

- [Guide](./docs/guide.md): install options, what you will see on screen, the promo film,
  every route, automatic handoff, slides and documents, the status line, safety, and the
  Claude Code integration in depth.
- [All skills](./docs/skills.md): the 36 skills and the automatic checks, one row each.
- [Hooks](./docs/hooks.md), [agents](./docs/agents.md), [privacy and network behavior](./docs/privacy.md),
  [migration and ownership conflicts](./docs/migration.md),
  [package-name migration and marketplace choices](./docs/migration.md#scoped-npm-migration), [native `/goal` surface](./docs/native-goal-surface.md)
  and the [workflow compatibility audit](./docs/workflow-compatibility-audit.md).
- [Development](./docs/development.md): checkout gates, local plugin loading and the project map.
- [Release history](./CHANGELOG.md) and the [Korean README](./README_ko-KR.md).
- [LitFamily](https://github.com/wjgoarxiv/litfamily): the same way of working for other coding agents.

## LITFAMILY

The seven armored robots on the cover stand for the seven LitFamily products. Each one runs on
its own in its own host, so install just the one you use. The cover is brand motion, and the
[Ignition film](./docs/assets/readme/ignition-film.mp4) is a short brand film in the same
spirit. The demo near the top of this page is the one that shows a real Claude Code session.

<p align="center"><img src="./docs/assets/readme/ascii-readme.svg" width="480" alt="LitClaude ASCII logo" /></p>

<details>
<summary>Copy ASCII logo</summary>

```text
                             ▄▄▄▄
                   ▗███▌   ▗██████▖
 ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘
 ▐█████        ▗▟██████▌    ▝▀▜█▀▘
 ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 ▐█████    ▗▟█████████████████████████ ▐█▀
 ▐█████    ████████████████████████████▀
 ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖
 ▐█████    ▀    ▄██ ████▌█████████████▌
 ▐█████       ▄████ ████▌█████████████▌
 ▐█████     ▄█████▛                                 claude
 ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖               ──────────────
 ▐█████ ▐█████▀          █████     ▐▛▀              hermes · codex
 ▐█████ ▐███▀            █████                      opencode · grok
 ▐█████ ▐█▀              █████                      muse · gravity
 ▐█████ ▝                █████
 ▐█████▄▄▄▄▄▄▄▖          █████
 ▐███████████▛           █████
 ▐██████████▀            █████

```

</details>

If LitClaude saves you from explaining the same project twice, a star on GitHub helps other
Claude Code users find it.

To contribute, start with the [contributing guide](./CONTRIBUTING.md); questions go to
[support](./SUPPORT.md), security reports follow [security](./SECURITY.md), and the
[code of conduct](./CODE_OF_CONDUCT.md) applies to everyone. LitClaude is released under the
[MIT license](./LICENSE).
