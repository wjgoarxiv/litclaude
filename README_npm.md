<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">Plan, build, and check your work in Claude Code. Leave the next session a place to begin.</p>
<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/readme/badge-version.svg" alt="1.0.14" />
  <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>
<p align="center">
  <a href="https://github.com/wjgoarxiv/litclaude#readme">Full guide, skills gallery and A/B results on GitHub</a> · <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/README_ko-KR.md">한국어</a>
</p>

LitClaude is a Claude Code plugin. Add `lit` to a request and Claude pins the goal, writes a
failing test first, checks the real surface and leaves a record in your project. The next
session reads that record and picks up where this one stopped.

## Install

You need Node.js with npm, and Claude Code.

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yes
```

`--yes` skips the install questions. A new install uses the `safe` permission mode, which
adds no permission rules, and leaves your other Claude settings as they are. If you want
Claude to ask less often, choose a wider mode yourself:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --permission-mode balanced
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yolo
```

`balanced` allows limited reading and searching plus routine Git, npm and Node commands;
`yolo` also allows broad edit and write patterns. LitClaude tracks the rules it inserted and
removes only those.

The install downloads a little more than the plugin. The video skill needs a rendering
engine and fonts and never downloads them mid-render, so the installer fetches them up
front: `npm ci` for the pinned engine packages, and pinned fonts checked against their
sha256. If that download fails, the install still finishes and tells you what to run later.

- To put off just the video tools, set `LITCLAUDE_MOTION_PREWARM=0` and run
  `litclaude-ai motion-runtime install` when you need them.
- `npm install -g @litfamily/litclaude` runs this whole setup by itself, from its
  postinstall hook. To switch that off, set `LITCLAUDE_AUTO_INSTALL=0` (or
  `LITCLAUDE_POSTINSTALL_SKIP=1`), or add `--ignore-scripts`; then run `litclaude install`
  yourself when you're ready.

## First steps

Start Claude Code as usual:

```bash
claude
```

Type `lit`. After the activation notice, give it something small:

```text
Build a to-do list in a single HTML file with no external dependencies.
Implement add, complete, and delete. Record what you checked and the next step.
```

Then open the file and try the three actions yourself. That is how you find out it works.

## What people type

| Type this | What you get |
| --- | --- |
| `lit`, or end any prompt with `lit` | The evidence-first work loop |
| `lit plan <what>` | A plan and its checks, before anything is edited |
| `/litclaude:start-work <approved-plan>` | Your approved plan, carried out |
| `lit review <scope>` | Findings and the work that remains |
| `lit research <question>` | Cited public-source research |
| `handoff` | A continuation file for the next session |
| `<make slides …> lit`, `<write a report …> lit` | Editable `.pptx` and `.docx` files |

At the end of a session, type `handoff` and keep the file path it gives you. Next time, open
the same project and ask Claude to read that file, check the current state and name the next
step.

LitClaude ships 35 skills you start yourself, from `deep-interview` and `lit-crucible` for
unclear briefs to `lit-diagram-drawer`, `lit-scientific-visualization`, `debugging`,
`refactor` and `lit-commit`, plus three that run on their own: `rules`, `lsp` and
`comment-checker`. The GitHub page shows each one with a picture, next to the A/B results.

## What changes after install

- Claude Code gets the LitClaude plugin: its skills, commands, agents and hooks.
- The status line shows the LitClaude HUD: `[🔥LITCLAUDE vX.Y.Z]`, a `ctx [▎░░]` context bar
  and a `5h [▏░] 4% ↻` rate-limit reset countdown.
- Permission rules change only if you choose `--permission-mode balanced` or `--yolo`. An
  output style is written only if you pick one.
- Work bound to a goal keeps its state in the project's `.litclaude/litgoal/`. When a
  session closes, everything stops; the next one starts when you open it.

There is also an optional Jev skill hint, which can suggest a skill that fits your prompt.
It is off by default, and turning it on sends your prompts off your machine. With `LITCLAUDE_JEV=1`
and your own `TYPESAFE_API_KEY` set, each eligible prompt goes to TypeSafe, cut to 2,000
characters, with home paths, e-mail addresses and token-shaped strings redacted. The rest
of the prompt goes as written, and TypeSafe bills your account. The agent's own tools can
read the exported key too, so give this feature a key of its own with a low spend limit.
Read the GitHub guide before you enable it.

## Safety and uninstall

The hooks read only the limited event data Claude Code passes them, and your prompt text is
something to route, never something to run. LitClaude's state in your project is gitignored
and never part of the npm package. Update checks run automatically; to turn them off, use
`--no-auto-update`, `LITCLAUDE_NO_AUTO_UPDATE`, `NO_UPDATE_NOTIFIER` or
`LITCLAUDE_NO_UPDATE_CHECK`.

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude doctor
npm exec --yes --package @litfamily/litclaude@latest -- litclaude uninstall
```

`uninstall` removes only the plugin, HUD, permission and local state entries that LitClaude
manages, and leaves the rest of your Claude settings in place. If an installation was
changed by hand or doesn't look like one LitClaude made, it refuses to touch it.

## More

- [Full guide, skills gallery and A/B results on GitHub](https://github.com/wjgoarxiv/litclaude#readme)
- [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/privacy.md)
- [Migration and ownership conflicts](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/migration.md)
- [Release history](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/CHANGELOG.md)
- [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/LICENSE)
