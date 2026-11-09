# Gap analysis and port design

The gap analysis decides which mechanisms the target needs; the port design decides what each one
becomes inside the target. Both are written against the target as it was at the base revision.

## Read the target first

Before judging any gap, read:

- the target's `AGENTS.md`, `CLAUDE.md` and README, for its rules and its voice;
- every file of the skill or module being changed: the entrypoint, every reference, every script,
  every asset that carries behaviour;
- every test that names the target, and the guards that pin its files (payload pins, corpus floors,
  route tests);
- for a plugin, how a neighbouring skill of similar weight is enrolled, so you know which surfaces a
  complete port must touch.

For a new target (`init --new`), read the neighbouring skills of the product it will join instead,
and treat every mechanism as `lacks` with `gap.searched` naming what you compared against.

## Gap fields

```json
"gap": {
  "status": "weak",
  "refs": ["skills/motion/SKILL.md:120-134", "skills/motion/scripts/render.mjs:88"],
  "note": "The skill asks for a treatment in prose; the render script starts without one."
}
```

- `status` is `has`, `weak` or `lacks`.
- `refs` are `path:line` or `path:start-end`, relative to the target root. The gate resolves each
  one at the base revision (`git show <base>:<path>`) and fails when the file or the line is
  missing, so a gap claim always points at text that existed when you judged it.
- A `lacks` claim with empty refs needs `searched`: the terms and places you searched
  ("grep for brief|treatment in skills/motion/ and its tests; no gate before render").
- `note` is one sentence a reviewer can check against the refs.

How to judge the status:

| Status | The target… |
| --- | --- |
| `has` | does it, and something enforces it: a script, a hook, a test, a gate |
| `weak` | does part of it, does it only sometimes, or states it in prose with nothing enforcing it |
| `lacks` | neither does nor states it |

Prose that tells the model to do something, with no mechanism behind it, is usually `weak`. In this
product, measured A/B runs found contract prose alone left behaviour unchanged, while mechanical
checks moved it. A gap that a gate would close is often the most valuable port.

## Port decisions

```json
"port": { "decision": "adapt", "reason": "Strengthen the existing treatment step with a render gate." }
```

- `take`: the target lacks it and should gain it.
- `adapt`: the target has part of it; strengthen or complete it.
- `leave`: keep it out, with the reason. Good reasons: the target already has it; the base model
  already does it unaided; the licence gate forbids it; it conflicts with the target's design; its
  evidence is too thin for its cost; the target lacks a surface it needs.

The gate rejects `take` on a `has` gap (use `adapt` or `leave`) and any taken mechanism whose only
sources are `no-go`.

## Re-expressing in the target's idiom

A port lands well when a reader of the target cannot tell which parts came from elsewhere, because
everything is in the target's own terms. For each taken mechanism decide:

| Question | Answer from the target, not the source |
| --- | --- |
| What is it called? | The target's naming pattern and vocabulary |
| Where does it live? | The file the target would naturally put it in |
| What enforces it? | The target's own script, hook, gate or test style |
| How is it invoked? | The target's routes, commands, flags or events |
| How is it tested? | The target's test framework and fixtures |
| How does it ship? | The target's manifest, payload pins and package rules |
| How do users learn of it? | The target's help, listing, README and docs |

Map the source's idea onto the target's surfaces; never carry the source's surfaces across. When a
source describes a folder layout or a file format, design the target's own, shaped by the target's
existing conventions.

## Enrollment surfaces for a Claude Code plugin target

A capability in a Claude Code plugin is reachable only through the surfaces the host and the plugin
read. When the target is a plugin skill, list every surface the port touches:

- the skill entrypoint (`skills/<id>/SKILL.md`) and its references, scripts and assets;
- the plugin's skill catalog and any resource or payload pins the plugin keeps;
- the slash command file, when the capability has a command;
- the prompt hook's routes and mode contract, when it has a natural-language route;
- agents, settings defaults and MCP or LSP config, when the capability uses them;
- user-facing listings: README skill tables, guides, help or doctor output;
- the package's file list and pack guard, so the installed copy carries the new files;
- tests that fail when any of the above loses the capability (an orphan test).

For other systems, find the equivalent list first: the registry, the router, the config, the
installer, the docs and the tests. A port that skips one of them is a ghost: the file exists and
nothing reaches it.

Each product in a family is its own target. A port into one product never copies files into a
sibling and never adds a dependency between them; when the user wants the same capability elsewhere,
each sibling gets its own run and its own re-expression.

## SPEC.md template

```markdown
# <target>: <one-line purpose of this port>

Target root: <path> · base revision: <rev>
Taken: M1, M4 · left: M2, M3, M5 (see the run report)

## M1 <title in the target's words>

Behaviour: <what the target will do afterwards, observable>
Lives in: <files and surfaces in the target>
Enforced by: <script, hook, gate or test>
Acceptance:
- <check 1, runnable>
- <check 2, runnable>
Parity: <criterion> · marker: <text the new behaviour leaves in its output>
Enrollment: <catalog, route, docs, pins, tests this section touches>
Out of scope: <what this section leaves alone>

## M4 <title>
…
```

Write the spec from the mechanism cards and the target, with the sources closed. Use the target's
examples and the target's order. The spec gate rejects a section-less mechanism, a path into
`sources/`, a source URL, and any run of 12 or more words shared with a capture; it warns when three
or more headings match a source's headings, because copied structure is still copying.

## Fields the parity step needs from the spec

Fill these while writing the spec, so the proof is designed before the build:

```json
"parity": {
  "criterion": "A brief from the skill names the takeaway and the rejection condition.",
  "red": "Old skill: brief has neither field.",
  "green": "New skill: brief has both fields in every run.",
  "surface": "claude -p in a throwaway workspace, old and new skill loaded the same way",
  "artifact": "parity/contact-sheet.png"
}
```

and on the ledger, `parity.markers`: short strings the new behaviour leaves in its output and the
old behaviour does not. Pick markers that only the mechanism produces (a field name, a gate's
refusal line, a file the new step writes), so a marker in a baseline output means contamination.
