<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">Plan, build, and check your work in Claude Code. Leave the next session a place to begin.</p>
<p align="center">
  <a href="#why-litclaude">Why</a> · <a href="#install">Install</a> · <a href="#quick-start">Quick start</a> · <a href="#what-to-type">What to type</a> · <a href="#skills-at-a-glance">Skills</a> · <a href="#ab-results">A/B results</a> · <a href="#learn-more">Learn more</a> · <a href="./README_ko-KR.md">한국어</a>
</p>

<p align="center"><img src="./docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>

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
 ▐█████ ▐█▀              █████
 ▐█████ ▝                █████
 ▐█████▄▄▄▄▄▄▄▖          █████
 ▐███████████▛           █████
 ▐██████████▀            █████

```

</details>

<p align="center"><img src="./docs/assets/litclaude-wordmark.svg" width="480" alt="LITCLAUDE display type" /></p>
<p align="center"><img src="./docs/assets/litclaude-clay-icon.png" width="160" alt="LitClaude clay mark" /></p>

<p align="center">
  <img src="./docs/assets/readme/badge-version.svg" alt="1.0.15" />
  <a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#deeper-docs"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Docs</a> · <a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Ignition</a> · <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

## Why LitClaude

You ask Claude Code for something: a bug fixed, a screen built, a project finished.
Starting takes one sentence. The trouble comes later. The conversation grows, the
session ends, and next time you have to work out where you left off: what you
decided, what you checked, what comes next.

LitClaude keeps that spark with the work. Add `lit` to a request and Claude pins the
goal, writes a failing test first, checks the real surface and leaves a record. The
goal, the plan, the results you checked and the next step stay in the project, where
the next session can read them.

LitClaude adds evidence-first execution, planning, research and review to Claude Code.
Install its plugin and managed HUD once, then work in ordinary `claude` sessions.

## Install

`@litfamily/litclaude` is a scoped package. You need Node.js with npm, and Claude Code. One
command sets everything up:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yes
```

`--yes` skips the install questions and keeps the defaults. A new install starts in the
`safe` permission mode, which adds no permission rules. The rest of your Claude settings
stay as they are: permissions, the HUD color and the output style change only when you
pick them. The [installation reference](#installation-reference) covers those choices and
how to pin a version. If you want to try LitClaude before it touches your usual setup,
start with a [separate trial profile](./docs/migration.md#separate-trial-profile).

The install downloads a little more than the plugin. The video skill,
lit-typographic-motion, needs a rendering engine and fonts, and it never downloads them in
the middle of a render, so the installer fetches them up front. Once the plugin is registered, it
runs `npm ci` for the pinned engine packages and downloads pinned fonts, checking each one
against its sha256. Everything goes into `$LITCLAUDE_MOTION_RUNTIME`, or into
`${XDG_CACHE_HOME:-~/.cache}/litclaude/motion-runtime` if that variable isn't set. If the
download fails, the install still finishes and prints the command to run later.

`npm install -g @litfamily/litclaude` does all of this by itself: its
`scripts/postinstall.mjs` hook runs `litclaude install`, download included. Only a global
install runs that hook. A local install, a `CI` environment or a source checkout skips it.
If you'd rather not have the automatic setup, you have two ways out:

- To put off just the video tools, set `LITCLAUDE_MOTION_PREWARM=0`. When you need them,
  run `litclaude-ai motion-runtime install`.
- To switch off the whole automatic setup of a global install, set
  `LITCLAUDE_AUTO_INSTALL=0` (or `LITCLAUDE_POSTINSTALL_SKIP=1`), or add `--ignore-scripts`
  to the npm command. npm still downloads the package, and you run `litclaude install`
  yourself when you're ready.

## Quick start

Start Claude Code the usual way:

```bash
claude
```

Then type:

```text
lit
```

You will see an activation notice. Now hand it one small task:

```text
Build a to-do list in a single HTML file with no external dependencies.
Implement add, complete, and delete. Record what you checked and the next step.
```

When it finishes, open the HTML yourself and click through all three actions; that is the
only way to know the buttons work. If Claude has no browser to test with, ask it to mark
the look and the clicks as unverified so you know what is left to try. The logo you saw at
the start only tells you the loop began.

## What to type

### Start with one task

End a prompt with `lit` and LitClaude adds a short note telling Claude which workflow to
follow. Claude Code still does the work.

| Prompt or route | Effect |
| --- | --- |
| `lit` | Activate the evidence-first work loop in the current Claude Code conversation. |
| `handoff` | Carry the checked result and next step into another session. |
| `lit-plan` | Write a bounded plan and its checks before implementation. |
| `/litclaude:start-work <approved-plan>` | Execute a plan that has already been approved. |
| `review-work` | Read the change and evidence, then report remaining work. |
| `litresearch` | Research with sources; this route records facts and uncertainty separately. |

When the activation mark shows, the work has started. Look at the result yourself before
you trust it.

LitClaude reads a plain prompt such as `lit` when you send it. Slash commands go straight
to Claude Code's own command handling, so a command like `/litclaude:lit-loop` starts its
skill once and the hook stays out of the way. Use that form when you want to call a skill
by name.

<p align="center"><a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/ignition-poster.png" width="720" alt="Ignition motion poster" /></a></p>

The poster opens the Ignition film, which plays only when you choose it.

### Carry work into the next session

```text
Plan → Build → Check → Hand off
```

| When you want to | In Claude Code | Leave behind |
| --- | --- | --- |
| Define the work | `lit plan <what>` | A plan and success criteria |
| Execute an approved plan | Give that plan to `/litclaude:start-work` | Changes and checked results |
| Review the result | `lit review <scope>` | Findings and remaining work |
| Finish the session | `/litclaude:lit-handoff` | A continuation file and its path |

Goal-bound work records its state under the project's `.litclaude/litgoal/`. When you
hand off, keep the **actual file path** the handoff gives you. In a new session, open
the same project and ask Claude to read that file, check the current state and name the
next action. Then decide what to continue. The
[goal and ledger reference](./docs/migration.md#review-and-litgoal-parity) explains the
recording commands and host boundaries.

"Keep the work lit" means leaving work another session can pick up. When a session
closes, everything stops; the next one starts only when you open it. Read the record,
compare it with the files as they are now, and then carry on.

### Every route

| Type this | Purpose |
| --- | --- |
| `lit`, `litwork` | Evidence-first, test-first execution loop; also `$lit-loop`, `/lit-loop`, and `/litclaude:lit-loop` |
| `lit plan <what>` | Planning only; also `$lit-plan` and `/lit-plan` |
| `lit review <scope>` | Review a plan or completed work; also `$review-work` and `/review-work` |
| `lit research <question>` | Cited public-source research; also `$litresearch` and `/litclaude:litresearch` |
| `lit search <question>` | Public-source retrieval |
| `lit query <question>` | Evidence lookup against durable local state |
| `lit goal <outcome>` | Bind one objective and checkable criteria; also `$litgoal` and `/litgoal` |
| `lit workflow <objective>` | Propose a Dynamic workflow for broad delegated work |
| `lit team`, `lit teammates` | Propose native agent teams when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is enabled and the user approves |
| `$deep-interview`, `/deep-interview` | Turn an underspecified request into a decision-complete brief |
| `lit recap`, `litrecap`, `$lit-recap`, `/lit-recap`, `/litclaude:lit-recap` | Read-only session recap |
| `handoff`, `/litclaude:lit-handoff` | Write a verified continuation packet |
| `lit-scientific-visualization` | Prepare publication figures; also `/litclaude:lit-scientific-visualization` |
| `/litclaude:lit-diagram-drawer <brief>` | Draw, check, and export a conceptual diagram; also `lit-diagram-drawer` and `$lit-diagram-drawer` |
| `<make slides …> lit`, `/litclaude:lit-pptx` | Build a `.pptx` deck from a request or sources; also `lit-pptx` and `$lit-pptx` |
| `<write a report …> lit`, `/litclaude:lit-docx` | Build a `.docx` report, plan, proposal, or manuscript; also `lit-docx` and `$lit-docx` |
| `litclaude wikify <capture/save/review/query/config>` | Manage reviewed local structured knowledge |
| `browser-drive`, `$browser-drive` | Drive a real page. It first checks for `vercel-labs/agent-browser` 0.34.0 or later; anything newer than 0.34.0 still works and is marked `beyond-verified`. If the driver is missing or older, it names the install commands and leaves running them to you |

Some skills are called by name: `lit-crucible` (adversarial planning), `lit-init`
(repository guidance), `lit-commit` (Git history), `lit-team` (native teams),
`lit-burnoff` (change-set cleanup), `lit-burnoff-file` (single-file cleanup),
`lit-humanizer` (Korean and English prose) and `lit-code` (implementation discipline).
Start the prompt with the bare name or with `$<skill-id>`. Older names still work for one
release and print a deprecation note; see
[the alias migration table](./docs/migration.md#one-release-rename-aliases).

## Skills at a glance

One row per skill: what it looks like, the route that starts it, and what you get.

<table>
<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>
<tr>
<td><img src="./docs/assets/skills/lit-loop.webp" width="240" alt="Add lit to any request. Claude pins the goal, writes a failing test first, checks the real surface and leaves a record." /></td>
<td><code>lit-loop</code><br /><sub><code>lit</code></sub></td>
<td>Add <code>lit</code> to any request. Claude pins the goal, writes a failing test first, checks the real surface and leaves a record.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litwork.webp" width="240" alt="Ship with proof. A notepad tracks every criterion from failing test to cleanup." /></td>
<td><code>litwork</code><br /><sub><code>litwork &lt;task&gt;</code></sub></td>
<td>Ship with proof. A notepad tracks every criterion from failing test to cleanup.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-plan.webp" width="240" alt="A plan file with numbered task rows that start-work can execute. Nothing is edited yet." /></td>
<td><code>lit-plan</code><br /><sub><code>lit plan &lt;what&gt;</code></sub></td>
<td>A plan file with numbered task rows that <code>start-work</code> can execute. Nothing is edited yet.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/start-work.webp" width="240" alt="Runs a plan row by row. A box is checked only after all five gates pass." /></td>
<td><code>start-work</code><br /><sub><code>start-work &lt;plan&gt;</code></sub></td>
<td>Runs a plan row by row. A box is checked only after all five gates pass.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/review-work.webp" width="240" alt="Five independent review lanes read the same change and report findings first." /></td>
<td><code>review-work</code><br /><sub><code>lit review &lt;scope&gt;</code></sub></td>
<td>Five independent review lanes read the same change and report findings first.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litgoal.webp" width="240" alt="One objective with checkable criteria, kept on disk so the next session can pick it up." /></td>
<td><code>litgoal</code><br /><sub><code>lit goal &lt;outcome&gt;</code></sub></td>
<td>One objective with checkable criteria, kept on disk so the next session can pick it up.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-recap.webp" width="240" alt="A read-only summary: done, in progress, blocked, where the evidence is, what comes next." /></td>
<td><code>lit-recap</code><br /><sub><code>lit recap</code> · <code>litrecap</code></sub></td>
<td>A read-only summary: done, in progress, blocked, where the evidence is, what comes next.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-handoff.webp" width="240" alt="Type handoff to get a continuation file the next session can read and resume from." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code></sub></td>
<td>Type <code>handoff</code> to get a continuation file the next session can read and resume from.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/deep-interview.webp" width="240" alt="One question at a time until the idea is clear enough to build. A meter shows how much is still vague." /></td>
<td><code>deep-interview</code><br /><sub><code>deep-interview &lt;idea&gt;</code></sub></td>
<td>One question at a time until the idea is clear enough to build. A meter shows how much is still vague.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litresearch.webp" width="240" alt="Splits a research question, sends parallel searchers and follows every lead before answering with sources." /></td>
<td><code>litresearch</code><br /><sub><code>lit research &lt;question&gt;</code> · <code>lit search</code></sub></td>
<td>Splits a research question, sends parallel searchers and follows every lead before answering with sources.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-crucible.webp" width="240" alt="Pressure-tests a brief before planning. Only the risks that survive critique reach the plan." /></td>
<td><code>lit-crucible</code><br /><sub><code>lit-crucible &lt;brief&gt;</code></sub></td>
<td>Pressure-tests a brief before planning. Only the risks that survive critique reach the plan.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-init.webp" width="240" alt="Maps a repository into a root AGENTS.md and short guides for the folders that need one." /></td>
<td><code>lit-init</code><br /><sub><code>lit-init</code></sub></td>
<td>Maps a repository into a root AGENTS.md and short guides for the folders that need one.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-comprehend.webp" width="240" alt="An explainer page for agent-written work: intuition first, then the walkthrough, then a short quiz." /></td>
<td><code>lit-comprehend</code><br /><sub><code>lit-comprehend &lt;target&gt;</code></sub></td>
<td>An explainer page for agent-written work: intuition first, then the walkthrough, then a short quiz.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-humanizer.webp" width="240" alt="Rewrites stiff model prose in English or Korean. Facts and hedges stay; filler goes." /></td>
<td><code>lit-humanizer</code><br /><sub><code>lit-humanizer &lt;text&gt;</code></sub></td>
<td>Rewrites stiff model prose in English or Korean. Facts and hedges stay; filler goes.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-diagram-drawer.webp" width="240" alt="A checked, editable diagram for slides and documents, with PNG and Office-safe SVG exports." /></td>
<td><code>lit-diagram-drawer</code><br /><sub><code>/litclaude:lit-diagram-drawer &lt;brief&gt;</code></sub></td>
<td>A checked, editable diagram for slides and documents, with PNG and Office-safe SVG exports.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-pptx.webp" width="240" alt="Ask for slides with lit and get an editable PowerPoint deck with native charts and embedded fonts. Each slide passes a layout gate and is checked as rendered." /></td>
<td><code>lit-pptx</code><br /><sub><code>/litclaude:lit-pptx &lt;request&gt;</code></sub></td>
<td>Ask for slides with <code>lit</code> and get an editable PowerPoint deck with native charts and embedded fonts. Each slide passes a layout gate and is checked as rendered.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-docx.webp" width="240" alt="Ask for a report with lit and get a styled Word file with its Markdown source. Korean text is set in Pretendard, and the pages are rendered and read before delivery." /></td>
<td><code>lit-docx</code><br /><sub><code>/litclaude:lit-docx &lt;request&gt;</code></sub></td>
<td>Ask for a report with <code>lit</code> and get a styled Word file with its Markdown source. Korean text is set in Pretendard, and the pages are rendered and read before delivery.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/frontend-ui-ux.webp" width="240" alt="Builds a working interface, then a measured probe renders it in seven views: 320, 390, 768 and 1440 px, dark, reduced motion and 200% zoom." /></td>
<td><code>frontend-ui-ux</code><br /><sub><code>frontend-ui-ux build &lt;target&gt;</code></sub></td>
<td>Builds a working interface, then a measured probe renders it in seven views: 320, 390, 768 and 1440 px, dark, reduced motion and 200% zoom.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/readme-studio.webp" width="240" alt="A factual README with a moving cover, checked at phone and desktop widths in light and dark." /></td>
<td><code>readme-studio</code><br /><sub><code>readme-studio &lt;scope&gt;</code></sub></td>
<td>A factual README with a moving cover, checked at phone and desktop widths in light and dark.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-typographic-motion.webp" width="240" alt="Ask for a video with lit. It writes a treatment, draws the scenes or sets the words in motion, adds a sound bed, and checks flashes, legibility and sound before handing over the film." /></td>
<td><code>lit-typographic-motion</code><br /><sub><code>/litclaude:lit-typographic-motion &lt;request&gt;</code></sub></td>
<td>Ask for a video with <code>lit</code>. It writes a treatment, draws the scenes or sets the words in motion, adds a sound bed, and checks flashes, legibility and sound before handing over the film.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-scientific-visualization.webp" width="240" alt="A journal-sized figure with vector and 600 DPI exports. The chart type follows the data." /></td>
<td><code>lit-scientific-visualization</code><br /><sub><code>lit-scientific-visualization</code></sub></td>
<td>A journal-sized figure with vector and 600 DPI exports. The chart type follows the data.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/visual-qa.webp" width="240" alt="Checks a real screen at each viewport and returns an honest verdict, or names exactly what blocked it." /></td>
<td><code>visual-qa</code><br /><sub><code>visual-qa &lt;target&gt;</code></sub></td>
<td>Checks a real screen at each viewport and returns an honest verdict, or names exactly what blocked it.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/browser-drive.webp" width="240" alt="Drives a real page after verifying the browser driver. If there is none, it says so." /></td>
<td><code>browser-drive</code><br /><sub><code>browser-drive &lt;task&gt;</code></sub></td>
<td>Drives a real page after verifying the browser driver. If there is none, it says so.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/structural-search.webp" width="240" alt="Finds code by its syntax shape, not its text, and previews rewrites before applying them." /></td>
<td><code>structural-search</code><br /><sub><code>structural-search &lt;pattern&gt;</code></sub></td>
<td>Finds code by its syntax shape, not its text, and previews rewrites before applying them.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-team.webp" width="240" alt="Coordinates several workers with separate slices, each reporting back with evidence." /></td>
<td><code>lit-team</code><br /><sub><code>lit team</code> · <code>lit teammates</code></sub></td>
<td>Coordinates several workers with separate slices, each reporting back with evidence.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/autoresearch.webp" width="240" alt="An approved, budgeted experiment loop. Each round changes one thing and keeps or reverts it." /></td>
<td><code>autoresearch</code><br /><sub><code>autoresearch &lt;mode&gt;</code></sub></td>
<td>An approved, budgeted experiment loop. Each round changes one thing and keeps or reverts it.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/autoconference.webp" width="240" alt="A budgeted research conference: separate researchers, reviewers, and a synthesis that keeps disagreement." /></td>
<td><code>autoconference</code><br /><sub><code>autoconference &lt;mode&gt;</code></sub></td>
<td>A budgeted research conference: separate researchers, reviewers, and a synthesis that keeps disagreement.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/wikify.webp" width="240" alt="Keeps reviewed project knowledge on disk and answers later questions from it, with sources." /></td>
<td><code>wikify</code><br /><sub><code>litclaude wikify capture|save|review|query|config</code></sub></td>
<td>Keeps reviewed project knowledge on disk and answers later questions from it, with sources.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/debugging.webp" width="240" alt="Reproduces the bug, tests at least three explanations, and fixes only the confirmed cause." /></td>
<td><code>debugging</code><br /><sub><code>debugging &lt;symptom&gt;</code></sub></td>
<td>Reproduces the bug, tests at least three explanations, and fixes only the confirmed cause.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/refactor.webp" width="240" alt="Restructures code while tests pin its behavior before and after every step." /></td>
<td><code>refactor</code><br /><sub><code>refactor &lt;target&gt;</code></sub></td>
<td>Restructures code while tests pin its behavior before and after every step.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-burnoff.webp" width="240" alt="Cleans AI-written bloat out of a change set after tests lock what it does." /></td>
<td><code>lit-burnoff</code><br /><sub><code>lit-burnoff &lt;scope&gt;</code></sub></td>
<td>Cleans AI-written bloat out of a change set after tests lock what it does.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-burnoff-file.webp" width="240" alt="The same cleanup for one file: fewer narrating comments, less defensive noise, flatter code." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>lit-burnoff-file &lt;path&gt;</code></sub></td>
<td>The same cleanup for one file: fewer narrating comments, less defensive noise, flatter code.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-code.webp" width="240" alt="Strict implementation rules: tests first, typed boundaries, small files." /></td>
<td><code>lit-code</code><br /><sub><code>lit-code &lt;task&gt;</code></sub></td>
<td>Strict implementation rules: tests first, typed boundaries, small files.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-commit.webp" width="240" alt="Splits your changes into atomic commits in the repo's own style and leaves unrelated work alone." /></td>
<td><code>lit-commit</code><br /><sub><code>lit-commit</code></sub></td>
<td>Splits your changes into atomic commits in the repo's own style and leaves unrelated work alone.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lsp-setup.webp" width="240" alt="Sets up a language server for your language and proves diagnostics really work." /></td>
<td><code>lsp-setup</code><br /><sub><code>lsp-setup &lt;language&gt;</code></sub></td>
<td>Sets up a language server for your language and proves diagnostics really work.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/automatic-checks.webp" width="240" alt="Runs on its own: loads your project rules, asks for diagnostics after edits, and reviews new comments." /></td>
<td><code>rules</code> · <code>lsp</code> · <code>comment-checker</code><br /><sub>runs on its own</sub></td>
<td>Runs on its own: loads your project rules, asks for diagnostics after edits, and reviews new comments.</td>
</tr>
</table>

## A/B results

We gave Claude Code the same casual Korean one-liners twice: once as typed, and once
with ` lit` added to the end and nothing else. Both sides ran in Claude Code 2.1.283
with Opus 5.5 (`opus[1m]`) at high effort on 2026-09-26, one trial per side. The
baseline is Claude Code without LitClaude; the LitClaude side used a local pre-release
build.

A blind judge, Claude Opus 5.5 without LitClaude, saw the two outputs only as A and B,
with any word that could name the tool removed. We asked it twice with the order swapped,
and a side wins only when both orders agree. Then the maintainer looked at both outputs
side by side and made the final call. Where the maintainer did not review a pair, the
judge's verdict stands and the row says so.

S3 and S4 come from a UI round that re-ran them after the interface update and added
S11. S5 comes from an office round that re-ran it with `lit-pptx` and `lit-docx` and
added S8 and S9. Some LitClaude runs were repeated after fixes, and we threw out any run
whose fix copied a judge's reasons. Each row compares the latest kept LitClaude run with
the one baseline run.

| Task | Prompt | Final verdict | Blind judge (same round) |
| --- | --- | --- | --- |
| S1 · Terminal to-do CLI | `터미널에서 쓰는 할 일 관리 CLI 만들어줘` | LitClaude won | Tie |
| S2 · API server bugs | `이 API 서버 가끔 이상하게 동작하는데 고쳐줘` | LitClaude won (blind judge; not reviewed by eye) | LitClaude won |
| S3 · Personal budget dashboard (UI round) | `개인 가계부 대시보드 웹페이지 만들어줘` | LitClaude won | Baseline won |
| S4 · Neighbourhood café landing page (UI round) | `동네 카페 브랜드 랜딩페이지 만들어줘` | LitClaude won | LitClaude won |
| S5 · Report and slides from sources (office round) | `sources 폴더 자료로 보고서랑 발표자료 만들어줘` | LitClaude won | Baseline won |
| S6 · Node 22 to 24 research | `Node 22에서 24로 올릴 때 달라지는 거 조사해줘` | LitClaude won | Tie |
| S7 · Order, payment and shipping diagram | `주문-결제-배송 서비스 구조도 그려줘` | LitClaude won (blind judge; not reviewed by eye) | LitClaude won |
| S8 · Quarterly results deck (office round) | `분기 실적 발표자료 만들어줘` | LitClaude won | Baseline won |
| S9 · New product plan (office round) | `신제품 기획서 써줘` | LitClaude won | LitClaude won |
| S11 · Meeting-room booking web app (UI round) | `회의실 예약 웹앱 만들어줘` | LitClaude won | LitClaude won |
| Total | | LitClaude 10 won | LitClaude 5 won, 2 ties, 3 lost |

The motion skill, `lit-typographic-motion`, was rebuilt after its first A/B and has no A/B result yet. The cover at the top of this page was made with it.

### S1 · Terminal to-do CLI

The baseline built more features (due dates, tags, filters, stats) but wrote no tests; LitClaude kept to priorities and shipped 12 passing tests and a pip-installable package. The blind judge called it a tie. The maintainer gave it to LitClaude because its own tests ran and passed.

### S2 · API server bugs

LitClaude fixed all six hidden bugs (the baseline fixed five), added a regression test for every fix, and also fixed a startup failure on symlinked paths and a wrong start command in the README. The baseline added no tests. The maintainer did not review this pair, so the blind judge's verdict stands.

### S3 · Personal budget dashboard

The blind judge preferred the baseline: a fuller dashboard (six-month bars, a running-total chart, top-5 expenses) on a balanced grid, where LitClaude left an empty column beside its long transaction list. LitClaude tried every action in a real browser and checked 320 to 1440 px, dark mode and 200% zoom; the automatic checks were mixed, with 6 accessibility violations against the baseline's 730 but more clipped text (51 against 30). The maintainer looked at both screens and chose LitClaude.

| Baseline | LitClaude |
| --- | --- |
| <a href="./docs/ab/S3-baseline-desktop.webp"><img src="./docs/ab/S3-baseline-desktop.webp" alt="Baseline budget dashboard, desktop: balance, monthly bar chart and category budgets" width="400" /></a> | <a href="./docs/ab/S3-litclaude-desktop.webp"><img src="./docs/ab/S3-litclaude-desktop.webp" alt="LitClaude budget dashboard, desktop: pixel piggy bank, balance, entry form and category budgets" width="400" /></a> |

<details>
<summary>Phone view</summary>

| Baseline | LitClaude |
| --- | --- |
| <a href="./docs/ab/S3-baseline-phone.webp"><img src="./docs/ab/S3-baseline-phone.webp" alt="Baseline budget dashboard, phone" width="180" /></a> | <a href="./docs/ab/S3-litclaude-phone.webp"><img src="./docs/ab/S3-litclaude-phone.webp" alt="LitClaude budget dashboard, phone" width="180" /></a> |

</details>

### S4 · Neighbourhood café landing page

LitClaude's page has a restrained design with hand-drawn pixel art and a dark mode, and its reply lists what it checked (opening-hours logic, keyboard tabs, four widths, dark mode). The baseline leans on emoji, made-up five-star reviews and a scrolling banner, and its full-page capture shows blank sections below the banner. The blind judge and the maintainer both chose LitClaude.

| Baseline | LitClaude |
| --- | --- |
| <a href="./docs/ab/S4-baseline-desktop.webp"><img src="./docs/ab/S4-baseline-desktop.webp" alt="Baseline café landing page, desktop: headline and a drawn coffee cup" width="400" /></a> | <a href="./docs/ab/S4-litclaude-desktop.webp"><img src="./docs/ab/S4-litclaude-desktop.webp" alt="LitClaude café landing page, desktop: headline and a pixel-art storefront" width="400" /></a> |

<details>
<summary>Phone view</summary>

| Baseline | LitClaude |
| --- | --- |
| <a href="./docs/ab/S4-baseline-phone.webp"><img src="./docs/ab/S4-baseline-phone.webp" alt="Baseline café landing page, phone" width="180" /></a> | <a href="./docs/ab/S4-litclaude-phone.webp"><img src="./docs/ab/S4-litclaude-phone.webp" alt="LitClaude café landing page, phone" width="180" /></a> |

</details>

### S5 · Report and slides from sources

The blind judge preferred the baseline: it added its own clearly labelled analysis (a Monday and weekend service gap, different data cut-off dates) and kept its 11-slide deck restrained, while LitClaude's 9-slide deck used decorative gradient circles, numbered badges and a closing thank-you slide. Both were accurate and checked; LitClaude's deck and 5-page Word report read their numbers from one data file, and the deck shows the budget as a doughnut chart. The maintainer judged LitClaude's files far more usable for real work.

Baseline slides:

<a href="./docs/ab/S5-baseline-slides.webp"><img src="./docs/ab/S5-baseline-slides.webp" alt="First five slides of the baseline deck: cover, summary cards, program table, visit and boarding counts, on-site notes" width="100%" /></a>

LitClaude slides:

<a href="./docs/ab/S5-litclaude-slides.webp"><img src="./docs/ab/S5-litclaude-slides.webp" alt="First five slides of the LitClaude deck: cover, KPI cards, key figures, a units table, observation cards" width="100%" /></a>

<details>
<summary>Report pages</summary>

Baseline:

<a href="./docs/ab/S5-baseline-pages.webp"><img src="./docs/ab/S5-baseline-pages.webp" alt="First three pages of the baseline Word report" width="100%" /></a>

LitClaude:

<a href="./docs/ab/S5-litclaude-pages.webp"><img src="./docs/ab/S5-litclaude-pages.webp" alt="First three pages of the LitClaude Word report" width="100%" /></a>

</details>

### S6 · Node 22 to 24 research

LitClaude marked SlowBuffer correctly as runtime-deprecated where the baseline listed it as removed, and added the Node 24.11.0 `Buffer.allocUnsafe` issue, build toolchain requirements and a full LTS table. The baseline matched more of the reference facts (4 of 10 against 2) and gave a fuller codemod list, and the blind judge called it a tie. The maintainer gave it to LitClaude because far more of its links were official sources (86% against 43%).

### S7 · Order, payment and shipping diagram

LitClaude drew a real diagram and saved it as HTML/SVG and PNG, with a boundary box, a legend, solid lines for calls and dashed lines for events; it checked the export and listed what it left out. The baseline gave ASCII art in chat and saved no file. The maintainer did not review this pair, so the blind judge's verdict stands.

<a href="./docs/ab/S7-litclaude-diagram.webp"><img src="./docs/ab/S7-litclaude-diagram.webp" alt="LitClaude diagram: customer app, API gateway, order service, event broker, payment and shipping services, with PG and courier outside the service boundary" width="640" /></a>

### S8 · Quarterly results deck

Both sides invented sample figures and marked them as samples on every slide. The blind judge preferred the baseline: its 9 slides follow the usual Korean earnings-deck order (a legal notice, year-on-year and quarter-on-quarter comparisons, Q&A), while LitClaude's 8-slide deck has decorative gradient circles on the cover and no notice slide; the layout check found 16 overlapping text pairs in the baseline deck and none in LitClaude's, which had one overflowing text box. The maintainer found LitClaude's deck clearly better.

Baseline slides:

<a href="./docs/ab/S8-baseline-slides.webp"><img src="./docs/ab/S8-baseline-slides.webp" alt="First five slides of the baseline earnings deck: cover, legal notice, KPI cards, income statement, revenue chart" width="100%" /></a>

LitClaude slides:

<a href="./docs/ab/S8-litclaude-slides.webp"><img src="./docs/ab/S8-litclaude-slides.webp" alt="First five slides of the LitClaude earnings deck: cover, KPI cards, quarterly chart, segment chart, income table" width="100%" /></a>

### S9 · New product plan

LitClaude wrote a 5-page Word plan for an example product it labels as one, with financials that add up; the baseline wrote only a Markdown file, with no financials and blank market-size figures. The maintainer found the first LitClaude run in this round weak (it returned a template of bracketed blanks) and the later runs a clear win. The blind judge also chose LitClaude.

LitClaude pages (the baseline made no Word file):

<a href="./docs/ab/S9-litclaude-pages.webp"><img src="./docs/ab/S9-litclaude-pages.webp" alt="First three pages of the LitClaude product plan: summary, target customer and spec table, competitor and unit-economics tables" width="100%" /></a>

### S11 · Meeting-room booking web app

LitClaude shipped unit and API tests and tried booking, conflicts, cancelling and keyboard-only use in a real browser; the baseline has no tests and says it never submitted its own booking form. LitClaude also adds dark mode and a room picker for phones. The blind judge and the maintainer both chose LitClaude.

The screenshot check served only the page files, without each app's own server, so both screens show how the app reports a failed load.

| Baseline | LitClaude |
| --- | --- |
| <a href="./docs/ab/S11-baseline-desktop.webp"><img src="./docs/ab/S11-baseline-desktop.webp" alt="Baseline booking app, desktop: empty page with a raw 404 error toast" width="400" /></a> | <a href="./docs/ab/S11-litclaude-desktop.webp"><img src="./docs/ab/S11-litclaude-desktop.webp" alt="LitClaude booking app, desktop: a plain Korean message that the room list could not load, beside the booking form" width="400" /></a> |

<details>
<summary>Phone view</summary>

| Baseline | LitClaude |
| --- | --- |
| <a href="./docs/ab/S11-baseline-phone.webp"><img src="./docs/ab/S11-baseline-phone.webp" alt="Baseline booking app, phone" width="180" /></a> | <a href="./docs/ab/S11-litclaude-phone.webp"><img src="./docs/ab/S11-litclaude-phone.webp" alt="LitClaude booking app, phone" width="180" /></a> |

</details>

## How it works

A plain prompt and a slash command come in through different doors. For a plain prompt,
the hook tells Claude which workflow fits; after an edit, it reminds Claude what to check.
Claude then follows the skill you asked for.

```mermaid
flowchart TD
    P["lit prompt"] --> H["UserPromptSubmit hook<br/>routing guidance"]
    C["/litclaude:* command"] --> S["Claude Code reads the requested skill"]
    H --> S
    R["SessionStart<br/>project rules"] --> S
    S --> W["Plan · execute approved work · review"]
    T["PreToolUse / PostToolUse<br/>authority checks / post-edit guidance"] -.-> W
    W --> F["Project files and checked results"]
    W --> L["When a goal is bound<br/>litgoal CLI → .litclaude/litgoal/"]
    F --> Q["Requested lit-handoff"]
    L --> Q
    Q --> N["Continuation file"]
    N -. "user asks the new session to read it" .-> S
```

The hook only suggests; what counts is what Claude actually did. So the next session
reads the saved file and checks the project as it is now. The
[hook reference](./docs/hooks.md) and the
[goal recording reference](./docs/migration.md#review-and-litgoal-parity) go into the
details.

Work is done when you can see that it works. A plan stays open until every item has a
yes-or-no check. As the diagram below shows, each slice of work runs the same way: a failing test, the smallest fix
that passes it, a run of the real thing in Claude Code that leaves evidence, and a
clean-up of anything temporary it created. A passing test is only the second of those
four steps.

```mermaid
flowchart TD
    R["a request<br/>make it better"] --> DI["<b>deep-interview</b><br/>turn it into a decision-complete brief"]
    DI --> P["<b>lit-plan</b><br/>objective · non-goals<br/>action / output / <b>binary verification</b>"]
    P --> GATE{"user approves?"}
    GATE -->|no| P
    GATE -->|yes| SW["<b>start-work</b><br/>execute one slice"]

    subgraph LOOP["each slice: RED to GREEN to SURFACE to CLEAN"]
        SW --> RED["failing test first"]
        RED --> GREEN["smallest change that passes"]
        GREEN --> SURF["exercise the <b>real surface</b><br/>not just the test"]
        SURF --> CLEAN["tear down · cleanup receipt"]
    end

    CLEAN --> EV{"evidence complete?"}
    EV -->|"tests only"| SW
    EV -->|"artifact + receipt"| RW["<b>review-work</b><br/>scope · evidence · payload<br/>security · real surface"]
    RW -->|findings| SW
    RW -->|clean| HO["<b>lit-handoff</b><br/>resumable packet"]

    style GATE fill:#fff3cd,stroke:#856404
    style EV fill:#fff3cd,stroke:#856404
    style SURF fill:#d4edda,stroke:#155724
    style RW fill:#d1ecf1,stroke:#0c5460
```

Claude Code runs the hook and the model, so permissions, browser access and screen checks
are whatever your Claude Code setup allows. To see what actually finished, read the record
in your project; the hook mark and the two pictures below only show that work began and
what the idea looks like.

<p align="center"><img src="./docs/assets/litclaude-ignition-1600.webp" width="49%" alt="LitClaude ignition editorial cue" /> <img src="./docs/assets/litclaude-continuity-1600.webp" width="49%" alt="LitClaude continuity editorial cue" /></p>

<details>
<summary>LITFAMILY · five armored machines</summary>

![Concept art showing the five LIT products as armored machines](./docs/assets/litfamily-machines.png)

Five armored machines: LitClaude, LitHermes, LitCodex, LitOpenCode, and LitGrok.
Concept art; each product runs in its own host.

</details>

## Slides, reports, diagrams and READMEs

Ask for slides or a report and end the prompt with `lit`, for example
`팀 워크숍 발표자료 만들어줘 lit` or `write a project proposal lit`, and you get Office
files, not Markdown. `lit-pptx` writes the slide source in Markdown and compiles it
through designed templates: AZURE-PRO blue and white by default, plus A2Z and plain 4:3
variants. Numbers become native charts and KPI cards you can still edit, and Pretendard is
embedded. Before you get the deck, a QA gate looks for text that overflows, weak contrast,
slides that are half empty or only a table, cropped decorations and blanks nobody filled.
Then it renders the pages and checks them by eye.

`lit-docx` writes a Word document with the Korean-first `korean-generic` profile: plain
styling for other languages, or Elsevier, ACS, IEEE and Nature profiles on request. It
gates the document and renders its pages. It also converts DOCX or PDF to Markdown and
edits an existing `.docx`.

When the request gives no data, both skills build a complete file around a realistic
example and label it as one instead of stopping to ask. Under a bare `lit`, neither asks
style questions. Their Node and Python packages install on first use from pinned
lockfiles into `~/.cache/litclaude/office-runtime`, and `litclaude doctor` shows whether
that runtime and the optional LibreOffice, pandoc and XeLaTeX tools are ready.

For architecture, process, schema, timeline and other conceptual diagrams meant for
slides and documents, use `/litclaude:lit-diagram-drawer <brief>`, or start a prompt with
`lit-diagram-drawer` or `$lit-diagram-drawer`. It writes editable HTML/SVG with the
bundled Pretendard font and uses bundled scripts to check overlaps, label placement,
routes, contrast, accessibility and visible text. With agent-browser 0.38.1 or newer
installed on your machine, it exports 1×–3× PNG and an Office-safe SVG; without it, you
get the setup commands and the verified source. Interface work stays with
`frontend-ui-ux`, and plots of measured data stay with `lit-scientific-visualization`.

`frontend-ui-ux build <target>` builds an interface you have authorized and inspects it
rendered. When a choice that matters is unclear, it asks one targeted question and
carries the answer into the build. A request to only review or plan stays read-only.

`readme-studio <repository or README scope>`, or `$readme-studio`, writes a README from
facts it checks in the repository and makes a cover on your machine. Whether it can
generate images depends on the tools your Claude Code has. Without one it says
`IMAGE_GENERATION_UNAVAILABLE`; give it a background image instead and it inspects that
and builds the rest of the cover on top. Bundled helpers turn Pretendard and Meslo text
into outlines and run pinned motion recipes locally. It checks the font and renderer
licenses and looks at the real output. How GitHub and npm finally show the page is
something to check after you publish. Both skills start from a leading word in your
prompt, and neither adds a slash command.

## Jev skill hint (optional)

LitClaude has 35 skills, and Jev, a choice model hosted by TypeSafe, can suggest which one
fits a prompt. When Jev names a skill, the `UserPromptSubmit` hook adds one line with that
name for Claude to consider. It is only a suggestion: Claude still decides whether to load
the skill, and the line cannot grant a permission or start a tool.

Jev is off by default. To try it, set both variables in the environment that launches
Claude Code:

```bash
export LITCLAUDE_JEV=1
export TYPESAFE_API_KEY=<your own TypeSafe key>
```

Turning it on sends your prompts off your machine, so here is exactly what goes out. Each
eligible prompt goes to TypeSafe (typesafe.ai), cut to 2,000 characters, with home paths,
e-mail addresses and token-shaped strings redacted. The rest of the prompt goes as you
wrote it, including a hostname, a customer name or a password that isn't written as
`password=…`. Slash commands, prompts the `lit` router already handled and prompts that
name a skill stay on your machine, and so does everything else from the session: files,
tool output and history.

Two more things before you switch it on. The key lives in the shell that starts Claude
Code, where the agent's own tools can read it as well, so give this feature a key of its
own with a low spend limit. And TypeSafe bills your account for every request, at about
$0.04 per million input tokens. Each request waits at most 1.5 seconds. If one fails, the
turn carries on as usual and you see one short note, the first time it happens in a
session.

To check that it is on, run `litclaude doctor`. It prints `Jev skill hint: off`, `on`, or
`flag on but TYPESAFE_API_KEY missing`. The LitClaude HUD status line shows it too: `✦Jev`
right after the model name (`O5.5 ✦Jev`), the suggested skill on a turn that got one
(`O5.5 ✦Jev → lit-humanizer`), and `O5.5 ✦Jev ⚠ key` when the key is missing. When colour
is allowed, `Jev` there shimmers in rainbow colours, and the first prompt of each session
with the flag and key set shows one `✦ Jev skill hint ON ✦` line (plain text under
`NO_COLOR`). To turn it off, unset `LITCLAUDE_JEV` or set it to anything other than `1`.
`docs/hooks.md` covers the tuning variables and the local debug trace.

## Safety

LitClaude runs inside your Claude Code session. Here is what it touches and where it stops.

- The hooks read only the limited event data Claude Code passes them. Your prompt text is
  something to route, never something to run.
- The planner agent is read-only. The review routes read the change and its evidence and
  report what they find; fixing it is a separate step.
- `public-read`, the web reader, fetches public http(s) pages only. It refuses localhost
  and private-network addresses, and at a login or paywall it stops instead of using any
  site credentials.
- LitClaude's state and evidence folders in your project are gitignored and never go into
  the npm package.
- Update checks happen in front of you. If a check can't tell what it found, sees a
  rollback, or can't verify the new version, it stops without updating. To turn the
  automatic check off, use `--no-auto-update`, `LITCLAUDE_NO_AUTO_UPDATE`,
  `NO_UPDATE_NOTIFIER` or `LITCLAUDE_NO_UPDATE_CHECK`.
- Publishing, version changes, tags and remote marketplace changes always wait for
  explicit user approval.

Claude Code picks the model, and LitClaude leaves that choice to it. It applies no OpenAI
routes of its own.

The OpenAI details that follow are for reference, from the LitFamily products that do
route OpenAI models. Those products default new installs to GPT-6: `gpt-6-astra` for
planning, review and lead roles, `gpt-6-sol` as the other choice for a coding lead, and
`gpt-6-luna` for helpers and ordinary workers. GPT-6 Luna supports `xhigh` effort but not
`ultra`, and ordinary workers keep the approved default of `max`. The live host catalog
still offers `gpt-5.6-sol`, `gpt-5.6-terra` and `gpt-5.6-luna`, with no retirement date for
any of them. The catalog allows `xhigh` for `gpt-5.6-luna` too, but LitClaude keeps an
older policy rule that blocks that one combination. Install and update leave a model you
already selected unchanged.

Claude Code's native `Workflow` and its experimental agent teams stay off until you opt
in. When Claude Code has no native goal tools, the durable `litgoal` ledger in your project
is the record to trust. LitClaude never sends `/goal` for you.

## Check, update or remove

The installed package gives you a few commands for checking and maintenance:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude doctor
npm exec --yes --package @litfamily/litclaude@latest -- litclaude --version
npm exec --yes --package @litfamily/litclaude@latest -- litclaude path
npm exec --yes --package @litfamily/litclaude@latest -- litclaude workflow-check --json
npm exec --yes --package @litfamily/litclaude@latest -- litclaude update
npm exec --yes --package @litfamily/litclaude@latest -- litclaude uninstall
```

`uninstall` removes only the plugin, HUD, permission and local state entries that
LitClaude manages, and leaves the rest of your Claude settings in place. If an
installation was changed by hand or doesn't look like one LitClaude made, it refuses to
touch it; the [ownership guidance](./docs/migration.md#ownership-conflicts) explains what
to do.

If an existing installation reports `INSTALL_OWNERSHIP_CONFLICT`, stop there. Before you
retry or move any folders, read the same
[ownership guidance](./docs/migration.md#ownership-conflicts).

After a separate-profile trial, close that Claude session and terminal and go back to your
original terminal environment. Your previous installation needs no downgrade or reinstall.

## Learn more

<a id="deeper-docs"></a>

- [Reference: install options, the HUD, host boundaries and development](#operational-reference)
- [Hook triggers and activation boundaries](./docs/hooks.md)
- [Agent and orchestration guidance](./docs/agents.md)
- [Workflow migration table](./docs/migration.md)
- [Native `/goal` surface matrix](./docs/native-goal-surface.md)
- [Workflow compatibility audit](./docs/workflow-compatibility-audit.md)
- [Package-name migration and marketplace choices](./docs/migration.md#scoped-npm-migration)
- [Release history](./CHANGELOG.md)
- [Korean README](./README_ko-KR.md)

Want to help? Read [Contributing](./CONTRIBUTING.md) first. For questions, see
[Support](./SUPPORT.md), and report security issues as [Security](./SECURITY.md) describes.
The [Code of conduct](./CODE_OF_CONDUCT.md) applies to everyone, and
[Privacy and network behavior](./docs/privacy.md) explains what goes over the network.

<details>
<summary>Reference: install options, the HUD, host boundaries and development</summary>

<a id="operational-reference"></a>

## What ships

- Evidence-first execution, planning, review, research, and handoff workflows.
- Claude-native skills such as `lit-loop`, `lit-plan`, `review-work`,
  `deep-interview`, `litresearch`, `litgoal`, `lit-handoff`, and
  `lit-scientific-visualization`.
- **Claude skills** also include `litwork`, `structural-search`, `lit-team`,
  `autoresearch`, and `autoconference`. The core sequence is
  `lit-plan`, `lit-recap`, `lit-loop`.
- Auxiliary Skill-discovery entries `frontend-ui-ux`, `readme-studio`, `lit-commit`, `lsp-setup`,
  and `visual-qa` start when their name is the first word of the prompt (a bare token) or
  in the `$` form, such as `$frontend-ui-ux`. The same name later in a sentence does
  nothing; they are not anywhere-tokens.
- Bundled reference packs include `lit-code/references`,
  `lit-code/scripts`, and `debugging/references`.
- Dynamic workflow and worktree guidance, with explicit opt-in for native
  `Workflow` and experimental agent teams.
- **Resilient public-source research** and public-source reading with SSRF,
  private-host, authentication, and paywall boundaries.
- Local MCP/LSP helpers, structured Wikify knowledge, and a managed HUD that
  can be safely removed with `uninstall`.

## Installation reference

The plain install command is:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install
```

For a reproducible install, pin the current package version:

```bash
npm view @litfamily/litclaude@1.0.15 version
```

If that lookup returns `1.0.15`, the exact install is available:

```bash
npm exec --yes --package @litfamily/litclaude@1.0.15 -- litclaude install
```

Otherwise, wait for explicit human publication before using that pin. Check the
installed surface with:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude doctor
```

The installer sets up the Claude Code plugin and the LitClaude status-line HUD. You pick
the permission mode yourself:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --permission-mode safe
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --permission-mode balanced
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yolo
```

The mode decides how much Claude may do without asking you first. `safe` adds no
permission rules. `balanced` allows limited reading and searching plus routine Git, npm
and Node commands. `yolo` also allows broad edit and write patterns. Each mode writes a
limited set of entries under Claude's `permissions.allow` and `permissions.deny`.

Other ways in:

```bash
npm exec --yes --package @litfamily/litclaude -- litclaude install
npm install -g @litfamily/litclaude
litclaude install
```

### Install-time questions

In an interactive terminal the installer asks two things: the HUD brand color and the
LitClaude output style. For the style you can choose `None / keep current`, ASD-STE100 or
ELI5, each in English and 한국어. LitClaude writes a style to Claude's global
`outputStyle` only when you pick one, and never over a value you set yourself.
`uninstall` takes it out again only if it is still the value LitClaude wrote.

To answer ahead of time, from a script for example, set `LITCLAUDE_OUTPUT_STYLE` and
`LITCLAUDE_HUD_ACCENT`. `--yes` skips every question and uses today's shipped defaults:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yes
```

When the terminal may not handle color, the installer turns off colors, cursor updates
and styled prompts. That happens when `CI` or `NO_COLOR` is set (even to an empty value),
with `TERM=dumb` or a non-UTF-8 locale, and when output is redirected. If you still want
to see progress there, `LITCLAUDE_SPINNER=1` prints it as plain structured lines. Settings
you pass explicitly, and `--yes`, still apply.

The installer never asks for a model or reasoning effort, because Claude Code picks the
model; the summary prints `Model selection: host-owned`. Existing settings are preserved:
LitClaude keeps track of the rules it inserted and removes only those.

### The HUD

Interactive installation previews the available HUD accents. The LitClaude HUD
uses `[🔥LITCLAUDE vX.Y.Z]`, a compact `ctx [▎░░]` bar, and a `5h [▏░] 4% ↻`
rate-limit reset countdown. Set `LITCLAUDE_HUD_ACCENT` before installation to
choose an accent.

When a prompt starts a LitClaude workflow, the HUD shows a bold, ignition-orange
`🔥 LIT IGNITED · lit-loop 🔥` mark right after the brand. It stays until a turn comes
along that starts nothing. To remember which workflow is active, the hook writes a small
note per session under `litclaude-hud/` in your per-user temp directory, never in the
repository or your home directory; `LITCLAUDE_HUD_STATE_ROOT` moves it elsewhere. Claude's
reply opens with `🔥 **LIT IGNITED · <discipline>** 🔥`, and the hook system message and
the HUD show the same mark without Markdown.

Two separate settings decide how the HUD looks: whether your terminal background is dark
or light, and how many colors the terminal can show.

- The background setting defaults to `dark`. The model, context, usage, reset and Git text
  take your accent, usage percentages change color with the level, and the brand uses
  the neon gradient. On a light background, or if you are not sure, set
  `LITCLAUDE_HUD_APPEARANCE=light` or `unknown`. That text and the brand then use the
  terminal's default foreground, and only the bar shapes and separators carry the accent.
- The color depth is detected for you, including truecolor under WSL. If the guess is
  wrong, set `LITCLAUDE_HUD_COLOR_DEPTH=truecolor|256|16|plain`; it wins over detection.
- To switch color off, set `NO_COLOR`: it removes every HUD escape even when its value is
  empty. `TERM=dumb` also keeps the HUD plain, whatever another signal or depth override
  says. The older `LITCLAUDE_HUD_NO_COLOR=1` still works.

The HUD never forces a background color. When Claude reports `--` for a rate limit, the
HUD shows it as is and invents no value.

## Claude Code integration

Claude Code tells the plugin when things happen: a session starts, you send a prompt, a
tool runs, a subagent starts or stops, the session ends. Those events feed four parts of the plugin: the rules that load project
guidance, the routing that picks a workflow, the authority checks, and the ledger that
keeps the record. Through them, the package's 35 skills, 16 current commands, three hidden
compatibility redirects, and 11 agents reach you inside Claude Code, and whatever Claude
Code allows or blocks still applies.

```mermaid
flowchart LR
    subgraph CC["Claude Code"]
        H1["SessionStart"]; H2["UserPromptSubmit"]; H3["PreToolUse"]
        H4["PostToolUse"]; H5["Stop"]; H6["SubagentStart / SubagentStop"]; H7["SessionEnd"]
    end
    subgraph LC["LitClaude plugin"]
        RULES["rules engine<br/>project rules into context"]
        ROUTE["trigger routing<br/><code>lit</code> · <code>/litclaude:*</code>"]
        AUTH["bounded authority<br/>pause on a new boundary"]
        LEDGER[("durable ledger<br/><code>.litclaude/</code>")]
    end
    H1 --> RULES --> LEDGER
    H2 --> ROUTE --> LEDGER
    H3 --> AUTH
    H4 --> LEDGER
    H5 --> LEDGER
    H6 --> LEDGER
    H7 --> LEDGER
    LC --> S["35 skills · 16 commands · 11 agents"]
```

Every skill works on a fresh install because the package carries what each skill needs.
The release checks make sure of it. A skill that needs reference material must find it
inside the packed tarball, and a skill that needs none must give a written reason in an
allowlist. That way a file that exists only in a developer's checkout can't turn into a
failure on your machine.

```mermaid
flowchart LR
    SK["a skill"] --> Q{"does it declare<br/>a capability?"}
    Q -->|"self-contained<br/>procedure"| AL["explicit allowlist entry<br/>with a written reason"]
    Q -->|"needs a corpus"| C["corpus must resolve<br/>inside the <b>packed payload</b>"]
    AL --> G1
    C --> G1["<b>payload-substance</b>"]
    G1 --> G2["<b>cross-product parity</b><br/>one product cannot ship a stub<br/>where the family ships substance"]
    G2 --> G3["<b>referenced-path resolution</b><br/>every path in a SKILL.md<br/>must exist in the tarball"]
    G3 --> OK["installs and works<br/>on a machine that has<br/>nothing else"]
    style C fill:#d4edda,stroke:#155724
    style OK fill:#d4edda,stroke:#155724
```

Running an approved plan always goes through a slash command. Typing
`lit start work <plan>` gets you a `BLOCKED:` handoff on purpose, pointing you to
`/start-work` or `/litclaude:start-work` with the approved plan. `lit workflow` also
waits for you: it proposes a native `Workflow` and calls it only after you opt in. Set
`CLAUDE_CODE_DISABLE_WORKFLOWS=1` to turn that route off. When Claude Code gives the model
a worktree tool, use `EnterWorktree`.

Goals follow one rule: LitClaude does not auto-type `/goal` or send slash-command text for
you. The route attempts native goal binding: it looks for goal tools such as `get_goal`,
`create_goal` and `update_goal`, and never replaces a different goal that is already
active. If Claude Code doesn't offer those tools, LitClaude reports degraded mode and keeps
the local `litgoal` ledger as the record. It then gives you a `READY_TO_PASTE` message
with one short `/goal` line to copy, paste and send in the current session yourself.

`/start-work` runs the schema-3 bounded-authority start-work lifecycle. An approved plan
can resume only through this exact route:

`/litclaude:start-work resume --work-id <id> --revision <n> --boundary-id <id> --prompt-id <id> --grant-id <id>`

When `stop_hook_active` is `true`, the hook stays silent, so an old prompt never gets
replayed.

From chat, the hook starts the figure skill only on the exact bare `lit-scientific-visualization`
prompt. It leaves the name alone when it is quoted, mixed into a sentence, slash-prefixed
or slightly off.

For public-source work, `lit research`, `lit search`, `lit query` and `public-read` stay
on the open web. They stop at a login, a paywall or a request for credentials, and they
refuse localhost and private-network addresses:

```bash
litclaude public-read https://example.com/article --json
```

`lit-humanizer` edits your prose as text. Instructions written inside that prose are
treated as content, never followed. It preserves facts, numbers, names, claims, scope and
uncertainty, and adds outside facts only when you ask for research. An always-on rule
guides new prose. Before a write, a check blocks clear drafting residue; its warnings are
advice you can ignore. New code blocks, quoted text and internal project records are
skipped. DOCX, PPTX and PDF files get a scan right after they are created, when their text
can be extracted.

Wikify keeps reviewed project knowledge. A new claim starts as `review-needed`, and
`save` and `review` move it through its states. A query returns the accepted claims that
match, within a 2048-byte normal budget and a 4096-byte hard limit. The local state is
user-owned and cooperative. Another process running as the same uid can read or change
it, so it is neither tamper-proof nor confidential against that process. Atomic rename
protects readers and crash consistency, and symlinks, unsafe file types,
pre-existing hardlinks and observed identity changes are refused.

The package CLI form is:

`npm exec --yes --package @litfamily/litclaude -- litclaude wikify <capture|save|review|query|config>`

## Integrity boundaries

A passing scanner speaks for one snapshot. It reports how many files it captured and a
SHA-256 digest of those bytes, and it does not prove that the mutable live tree stayed
clean afterwards; if files change, run it again. Legal companion files sit outside the
generated manifest and are scanned normally.
Canonical and runtime captures are capped at 8 MiB per file and 32 MiB in total. The
package guards compare each immutable expected file map across the
verifier-to-capture interval and against the produced tarball, and secure non-executable
entries such as `0600` stay valid.

## Checkout gates

From this checkout, the main gates are:

```bash
npm test
npm run validate:plugin
npm run doctor
npm run check:version
npm run scan:legacy-tokens
npm run check:skill-resources
npm run check:runtime-closures
npm run pack:payload-guard
npm run pack:dry-run
```

## Local development

Load the plugin directly from this checkout while editing it:

```bash
claude --plugin-dir ./plugins/litclaude
```

Reload plugin metadata inside Claude Code with:

```text
/reload-plugins
```

## Project map

| Surface | Path |
| --- | --- |
| CLI | `bin/litclaude-ai.js` |
| Claude plugin | `plugins/litclaude/` |
| Skills | `plugins/litclaude/skills/` |
| Agents | `plugins/litclaude/agents/` |
| Hooks | `plugins/litclaude/hooks/hooks.json` |
| MCP | `plugins/litclaude/.mcp.json` |
| LSP | `plugins/litclaude/.lsp.json` |

The npm package page shows a shorter README. Its source is `README_npm.md` (Korean:
`README_npm_ko-KR.md`); `node tools/readme-for-npm.mjs apply` swaps it in before a pack
or publish and `restore` puts this page back.

`docs/assets/readme/ascii-readme.svg` and `docs/assets/cover.svg` stay as editable or
low-bandwidth fallbacks. The static product emphasis export, `docs/assets/cover.webp`,
still ships in the package but is no longer shown on this page.

</details>

## Ignition

A short brand film rather than a screen recording. Select the static poster to play it.

[![Ignition motion graphic](./docs/assets/readme/ignition-poster.png)](./docs/assets/readme/ignition-film.mp4)

[Animated version (GIF)](./docs/assets/readme/ignition-readme.gif) · [Lucide icon license (ISC)](./docs/assets/readme/Lucide-LICENSE.txt) · [JetBrains Mono font license (OFL)](./docs/assets/readme/JetBrainsMono-OFL.txt)
