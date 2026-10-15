<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitClaude robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<h1 align="center">LitClaude</h1>
<p align="center"><strong>Keep the work lit.</strong></p>
<p align="center">A Claude Code plugin that helps every session plan the work, build it, check it, and leave a note the next session can pick up.</p>
<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/readme/badge-version.svg" alt="1.0.28" />
  <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>
<p align="center">
  <a href="https://github.com/wjgoarxiv/litclaude#readme">Full guide and skills gallery on GitHub</a> · <a href="https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/README_ko-KR.md">한국어</a>
</p>

Add `lit` to a Claude Code prompt and Claude pins the goal, writes a failing test first,
checks the real result and leaves a record in your project. Type `handoff` when you stop, and
the next session reads that record and picks up where this one left off.

## Install

You need Node.js with npm, and Claude Code.

```bash
npx @litfamily/litclaude@latest install
```

On the first run npx asks whether to install the package; answer `y`. The installer registers
the plugin, adds the LitClaude status line and asks for its colour and an optional output style.
`install --yes` keeps the defaults, and `npx @litfamily/litclaude@latest --dry-run install` only
prints the changes. A
new install uses the `safe` permission mode, which adds no permission rules, and leaves your
other Claude settings as they are. It also fetches the video skill's rendering engine and
fonts up front. The [guide](https://github.com/wjgoarxiv/litclaude/blob/main/docs/guide.md#installation-reference)
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

The optional Jev skill hint is off by default; turning it on sends your prompts to a third
party, TypeSafe, so read [its page](https://github.com/wjgoarxiv/litclaude/blob/main/docs/jev.md) first.

## Check, update and remove

```bash
npx @litfamily/litclaude@latest doctor
npx @litfamily/litclaude@latest update
npx @litfamily/litclaude@latest uninstall
```

LitClaude keeps project state in `.litclaude/`, which carries its own `.gitignore` so Git skips
it, and that state never goes into the npm package. `uninstall` removes only the entries
LitClaude manages and refuses to touch an install that was changed by hand. A plugin added
through the Claude Code marketplace instead has no status line and is updated or removed from
the `/plugin` menu.

## More

- [Full guide and skills gallery on GitHub](https://github.com/wjgoarxiv/litclaude#readme)
- [Privacy and network behavior](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/privacy.md)
- [Migration and ownership conflicts](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/docs/migration.md)
- [Release history](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/CHANGELOG.md)
- [MIT license](https://cdn.jsdelivr.net/npm/@litfamily/litclaude@1.0.28/LICENSE)
