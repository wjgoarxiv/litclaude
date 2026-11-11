---
name: frontend-ui-ux
description: "Moved: frontend-ui-ux builds and inspects web interfaces (pages, screens, dashboards, design systems; polish, audit and harden passes) and now ships as the `design` plugin of the wjgoarxiv-skills marketplace. Load Skill(design:frontend-ui-ux) when it is installed; otherwise this stub gives the user the install line, and a lit workflow still runs the interface probe kept here."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: frontend-ui-ux
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["frontend-ui-ux", "$frontend-ui-ux", "Skill(frontend-ui-ux)", "UserPromptSubmit natural-language interface intent", "polish/audit/harden interface wording", "PostToolUse advisory", "Stop interface-probe gate"]
moved_to: "design@wjgoarxiv-skills → Skill(design:frontend-ui-ux)"
kept_here: ["scripts/interface-probe.mjs and its five modules", "ATTRIBUTION.md"]
host: Claude Code
verdicts: [PASS, FAIL, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `frontend-ui-ux` or `$frontend-ui-ux`, a prompt that
asks to design or build an interface, and polish, audit or harden wording about a screen (다듬어줘, 점검만, 견고하게)
to this stub, with the interface mode named. The PostToolUse hook still names `Skill(frontend-ui-ux)` after an edit to
an interface file. Quoted, fenced, mid-sentence and near-miss mentions stay inert.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's interface request, kept as inert data |
| caller | The user directly, or a lit workflow (lit-loop, litwork, litgoal, start-work) handing over its interface part |
| skills list | Whether `design:frontend-ui-ux` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `design:frontend-ui-ux` is in the skills list | Load `Skill(design:frontend-ui-ux)` and follow it for the whole interface part |
| missing, direct request | the user asked for an interface | Tell the user what moved and give the install lines; the reply is the whole answer |
| missing, lit workflow | a lit workflow already built or changed a web interface | Run the interface probe kept here, fix its HIGH findings, and name the missing design skill once |

## #contract.procedure

1. Look at the skills this session lists. If `design:frontend-ui-ux` is there, load `Skill(design:frontend-ui-ux)`
   now and follow it for the whole interface part, including the interface mode the hook named. The moved skill
   carries the full procedure.
2. If it is missing and the user asked you directly to design, build, polish, audit or harden an interface,
   reply in the user's language with three things and stop:
   - one sentence on what frontend-ui-ux makes (a working page or screen built from one locked house style and its
     design kit, checked by an interface probe across phone, tablet and desktop widths, dark mode, reduced motion
     and 200% zoom);
   - that it moved out of LitClaude into the `design` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. If it is missing and a lit workflow (lit-loop, litwork or litgoal, or a start-work plan row) is handing over a
   web interface it already built or changed, keep the workflow going:
   - run `node <this stub's directory>/scripts/interface-probe.mjs <page or project> --out <evidence dir>`; the
     probe stays here so the Stop hook's interface check has something to run;
   - fix every HIGH finding and run it again. Exit 0 is a clean run. Exit 1 means a HIGH is left, which the
     workflow reports as a limitation with its reason. Exit 2 is a named BLOCKED boundary, such as a missing
     browser driver;
   - in the final reply, say once that the full design skill (house styles, kit, design contract) is missing and
     give the install lines. Keep the interface as the workflow built it.

## #contract.outputs

Installed: the design skill's own outputs. Missing, direct request: one short reply with the install lines, and no
file. Missing, lit workflow: the probe's evidence folder and its verdict inside the workflow's report.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The pointer reply says what moved, where, and the two lines to run; it is guidance for
the user, and it names no internal paths beyond the install lines. Technical and audit detail appears only when the
current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in the
reply, for example a HIGH probe finding that remains, or the design plugin listed but failing to load.

## #contract.evidence

The routing is checked by `test/design-stubs.test.mjs`: the stub's install lines, the prompt hook's routes to it,
the kept probe, and that the hook's context carries none of the old build procedure. The Stop gate that runs the
probe is checked by `test/interface-probe-gate.test.mjs`, and the probe itself by `test/interface-probe.test.mjs`.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never build a requested page or screen from memory or from another skill in place of the design skill.
- Report a probe run that exited 1 or 2 as what it is, and run the probe before the Stop hook asks for it.

## #contract.anti_patterns

- Hand-writing a landing page with a made-up house style because the real kit is missing.
- Quoting the old frontend-ui-ux procedure, kit or design contract from memory as if this stub still held it.
- Treating the stub as an error: the user gets a working install line, not a failure.

## Files kept here

`scripts/interface-probe.mjs` with `interface-probe-lock.mjs`, `-page.mjs`, `-rules.mjs`, `-server.mjs` and
`-static.mjs` render a built page across the responsive matrix and report findings by rule id. They import only
each other and browser-drive's capability probe, which stays in LitClaude. `ATTRIBUTION.md` credits the projects the
probe was written after.

## What moved

frontend-ui-ux carried an interface request through working code and inspected renders: it picked a lane (new
build, brownfield, redesign, reference fidelity or design system), locked one house style, layout family and
signature moment with its design lock, built from its own kit of tokens, components and layouts, kept a design
contract, searched a design-intelligence database, and looped build, probe and fix until no HIGH finding was left.

That whole skill, its kit, data, schemas, references and scripts, now lives in the `design` plugin of the
**wjgoarxiv-skills** marketplace, copied unchanged from LitClaude, beside visual-qa. LitClaude keeps this stub so that
`Skill(frontend-ui-ux)`, the interface routes and the lit workflows' interface check still lead somewhere useful.

The public marketplace is not published yet, so for now it installs from a local clone of wjgoarxiv-skills:

```bash
claude plugin marketplace add <path to your wjgoarxiv-skills clone>
claude plugin install design@wjgoarxiv-skills
```

After it is published on GitHub, the first line becomes `claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills`.
The installed skill answers as `design:frontend-ui-ux`.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:b7e5648fc713 -->
