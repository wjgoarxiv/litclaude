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

`balanced` adds bounded read/search and routine Git, npm and Node rules; `yolo` adds broader
edit/write patterns. LitClaude tracks the rules it inserted and removes only those.

The install also uses the network: it pre-warms the motion runtime with `npm ci` for
pinned engine packages and pinned, sha256-checked fonts. If that step fails, the install
still succeeds and tells you what to run later. To skip it, set `LITCLAUDE_MOTION_PREWARM=0`
and run `litclaude-ai motion-runtime install` when you want it. A global
`npm install -g @litfamily/litclaude` runs the same setup from its postinstall hook; set
`LITCLAUDE_AUTO_INSTALL=0` or `LITCLAUDE_POSTINSTALL_SKIP=1`, or pass `--ignore-scripts`, to
skip that.

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

Then open the file and try it yourself. A file that exists has not yet shown that it works.

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
- Work bound to a goal keeps its state in the project's `.litclaude/litgoal/`. Nothing keeps
  running or resumes on its own after a session closes.

The optional Jev skill hint is off by default. If you turn it on with `LITCLAUDE_JEV=1` and
your own `TYPESAFE_API_KEY`, each eligible prompt goes to TypeSafe, truncated to 2,000
characters with home paths, e-mail addresses and token-shaped strings redacted. Anything
else in the prompt is sent as written, and TypeSafe bills your account. The agent's own
tools can read the exported key too, so use a key kept for this feature with a low spend
limit. Read the GitHub guide before you enable it.

## Safety and uninstall

Hooks read bounded Claude Code event JSON and do not execute your prompt text. Project-local
LitClaude state is gitignored and never part of the npm package. To turn off automatic update
checks, use `--no-auto-update`, `LITCLAUDE_NO_AUTO_UPDATE`, `NO_UPDATE_NOTIFIER` or
`LITCLAUDE_NO_UPDATE_CHECK`.

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude doctor
npm exec --yes --package @litfamily/litclaude@latest -- litclaude uninstall
```

`uninstall` removes only the plugin, HUD, permission and local state entries that LitClaude
manages. It leaves unrelated Claude settings alone, and it refuses an installation that was
modified or cannot be recognized.

## More

- [Full guide, skills gallery and A/B results on GitHub](https://github.com/wjgoarxiv/litclaude#readme)
- [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/privacy.md)
- [Migration and ownership conflicts](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/docs/migration.md)
- [Release history](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/CHANGELOG.md)
- [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.14/LICENSE)
