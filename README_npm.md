<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: a terminal in a sunset look. LitClaude's round-cornered LIT card frames the screen with its stage map, task gauge, skill pills, lanes and context gauge, a pixel LITFAMILY wordmark and a striped half-sunk sun fill the middle, the row of seven product names lights LITCLAUDE, and a Claude Code prompt types a request at the bottom." /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">LitClaude is an add-on for Claude Code. It makes Claude check its own work before it says "done", and leaves a note so the next session starts where this one stopped.</p>
<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/readme/badge-version.svg" alt="1.0.69" />
  <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>
<p align="center">
  <a href="https://github.com/wjgoarxiv/litclaude#readme">Full guide and skills gallery on GitHub</a> · <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/README_ko-KR.md">한국어</a>
</p>

You ask Claude for a feature. It writes the code and says it is finished, and a day later you find the tests
never ran. You open a new session and explain the whole project again.

With LitClaude you add `lit` to the same request. Claude first writes down what "finished" means for this
task, adds a test that fails, makes it pass, and ends by telling you what it checked and what it could not.
When you stop, type `handoff`. Claude saves a note, and the next session reads it and carries on.

## Two ways to use it

**The easy way.** Write your request as usual and put `lit` at the start or at the end:

```text
fix the date parsing bug in src/dates.js lit
```

Claude sets the goal, writes a failing test, fixes the bug, checks the result and tells you what it checked.
Most tasks need nothing more. The end of the request works just like the start: Claude asks once whether to
set the goal to the words before `lit`, and `lit-loop` or `litwork` at the end start their own workflow.

**The full workflow.** For a bigger job, go one step at a time. Each step leaves a file the next step reads,
and you can skip any step you do not need.

| Step | Type | What happens |
| --- | --- | --- |
| 1. Explore | `/litclaude:lit-brainstorm <question>` | Many options, scored, cut to a short list |
| 2. Clarify | `/litclaude:deep-interview <idea>` | Claude asks questions until the goal is clear |
| 3. Plan | `lit-crucible <approach>` or `/litclaude:lit-plan <task>` | Crucible attacks the approach first, then plans; lit-plan writes the steps and waits for your yes |
| 4. Build | `yes` to the plan, or `/litclaude:lit-loop <task>` | Claude works through it with tests and checks |
| 5. Review | `/litclaude:review-work` | A review in five lanes, findings first |
| 6. Hand off | `handoff` | Decisions and the next step, saved to a file |

Install with one line (the next section has the details), then start Claude Code in your project.

## Install

You need Node.js with npm, and Claude Code.

```bash
npx @litfamily/litclaude@latest install
```

On the first run npx asks whether to install the package; answer `y`. The installer registers
the plugin, adds the LitClaude status line and asks up to five short questions on cards (its colour,
an output style, the icon font, the Co-Authored-By line and the `CLAUDE.md` block); Enter takes the
marked default.
A new install uses the `safe` permission mode, which adds no permission rules, and leaves your
other Claude settings as they are. It also fetches the video skill's rendering engine and
fonts up front. Start Claude Code again afterwards so the plugin loads.

Add `--yes` after `install` when you want the defaults without questions, or put `--dry-run`
before it (`npx @litfamily/litclaude@latest --dry-run install`) when you want to see the
changes first. The [guide](https://github.com/wjgoarxiv/litclaude/blob/main/docs/guide.md#installation-reference)
covers permission modes, version pins, global installs and every switch.

## First steps

Start `claude` in a project, type `lit`, and after the activation notice give it something small:

```text
Build a to-do list in a single HTML file with no external dependencies.
Implement add, complete, and delete. Record what you checked and the next step.
```

Then open the file and try the three actions yourself. That is how you find out it works.

| Type this | What you get |
| --- | --- |
| `lit`, or end any prompt with `lit` | The evidence-first work loop |
| `lit plan <what>` | A plan and its checks, before anything is edited |
| `/litclaude:start-work <approved-plan>` | Your approved plan, carried out |
| `lit review <scope>` | Findings and the work that remains |
| `lit research <question>` | Cited public-source research |
| `handoff` | A continuation file for the next session |
| `<make slides …> lit`, `<write a report …> lit` | Editable `.pptx` and `.docx` files |
| `lit draw a P&ID …`, `lit 장치도 그려줘` | A checked equipment drawing as SVG, PDF and PNG |
| `lit hijack <sources> into <skill>` | Someone's published technique, ported into your own skill and proven |
| `lit ultra-brainstorm <topic>` | A scored top 10 from 30 to 300 idea agents |
| `lit team <goal>` | This session runs a team for you and reports back |
| `lit adhd` (or `lit rewind`), then `go` | A six-line card with the one thing to do now, then that step |
| `lit 엑셀로 정리해줘`, `lit make an xlsx report` | An Excel workbook with live formulas (the `sheets` extension) |
| `lit approve`, `lit approve x`, `lit deny`, `lit skip-row` | Answers to a long run's inbox of parked steps |
| `lit pause`, `lit resume` | A long run held where it is, then let go on |

A plan you approve runs to its last row and closes itself when its `## Done when` check passes. A step
that needs your yes is parked and the run goes on; at the end one inbox lists what waits, and rows Claude
could not do carry `IMPOSSIBLE: <reason>`. A `Run charter: commit on <branch> in <repo>` line in the plan
lets the run commit on that branch, and `yes goal` at the approval question adds Claude Code's `/goal`,
which always ends by itself. Without `lit`, Claude is offered the skills that fit a request and decides whether to load them.

In the Claude desktop and mobile apps (Claude Code 2.1.325 or later), LitClaude also dresses the app in the
Ignition look: LitFamily colours and a synthwave sunset backdrop that rests, burns, signals and bursts with the LIT state.
`npx @litfamily/litclaude@latest config look still` keeps it without motion; `look off` gives the app its own look back.

## Check, update and remove

```bash
npx @litfamily/litclaude@latest doctor
npx @litfamily/litclaude@latest update
npx @litfamily/litclaude@latest uninstall
```

A new Claude Code session checks for a newer version at most once a day, and a later session
installs it, so `update` is there for when you want it now. LitClaude keeps project state in `.litclaude/`, which carries its own `.gitignore` so Git skips
it, and that state never goes into the npm package. `uninstall` removes only the entries
LitClaude manages and refuses to touch an install that was changed by hand. A plugin added
through the Claude Code marketplace instead has no status line and is updated or removed from
the `/plugin` menu.

These commands open with the synthwave LIT mark; a terminal without colour gets it in plain glyphs, and one
without UTF-8, or piped output, gets the single line `LIT · claude code`. While you work, a card above the prompt shows the
stage, and a moving sunset fills its free space. A lock left by a crashed
session clears itself. If `state lock timed out` still appears, close the project's Claude Code sessions and delete
the lock folder the message names.

## More

- [Full guide and skills gallery on GitHub](https://github.com/wjgoarxiv/litclaude#readme)
- [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/privacy.md)
- [Migration and ownership conflicts](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/docs/migration.md)
- [Release history](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/CHANGELOG.md)
- [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.69/LICENSE)
