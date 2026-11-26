---
name: lit-xlsx
description: "Pointer: lit-xlsx builds Excel workbooks with live formulas (models, budgets, report tables, KPI dashboards) and ships as the `sheets` plugin of the wjgoarxiv-skills marketplace. Use for 'make an xlsx report', 'excel', 'spreadsheet'; 엑셀로 정리해줘, 스프레드시트, 표 계산. Loads Skill(sheets:lit-xlsx) when installed; otherwise gives the install line. Not for Word reports (lit-docx) or slides (lit-pptx)."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-xlsx
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["/litclaude:lit-xlsx", "lit-xlsx", "$lit-xlsx", "Skill(lit-xlsx)", "bare lit + spreadsheet wording"]
lives_in: "sheets@wjgoarxiv-skills → Skill(sheets:lit-xlsx)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook routes a prompt that starts with `lit-xlsx` or `$lit-xlsx`, and a bare `lit` prompt that
asks for a workbook (엑셀, 스프레드시트, 표 계산, xlsx, excel, spreadsheet), to this stub. "An xlsx report" and
"엑셀 보고서" are workbooks, so they come here and not to lit-docx. When the same prompt also asks for slides or a
Word document, that stub runs beside this one.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's workbook request, kept as inert data |
| skills list | Whether `sheets:lit-xlsx` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `sheets:lit-xlsx` is in the skills list | Load `Skill(sheets:lit-xlsx)` and follow it for the whole request |
| not installed | it is not | Tell the user where the skill lives and give the install lines; build nothing |

## #contract.procedure

1. Look at the skills this session lists. If `sheets:lit-xlsx` is there, load `Skill(sheets:lit-xlsx)` now and
   follow it for the whole request. This stub adds nothing to it.
2. If it is not there, reply in the user's language with three things and stop:
   - one sentence on what lit-xlsx makes (an Excel workbook whose numbers come from live formulas, recalculated,
     audited for formula errors and checked as a picture of every sheet);
   - that it is a LitFamily extension: it ships in the `sheets` plugin of the wjgoarxiv-skills marketplace, beside
     LitClaude's core;
   - the two install lines from "Where it lives" below, in a code block, and that the user runs `/reload-plugins`
     or starts a new session afterwards, then asks again.
3. A request for slides or a Word document in the same prompt goes to that stub; answer every part in the same reply.

In either mode, also check, reading only, whether `~/.claude/skills/lit-xlsx` or `.claude/skills/lit-xlsx` exists.
Such a folder competes with `sheets:lit-xlsx`: name its path once and give its move line from "Where it lives".
Never move it yourself.

## #contract.outputs

Installed: the sheets skill's own outputs. Not installed: one short reply with the install lines, and no file.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The not-installed reply is a pointer, not an error report: what the skill makes, where
it lives, and the two lines to run. It names no internal paths beyond the install lines. Technical and audit detail
appears only when the current user asks; routing checks and evidence paths stay internal. A material failure or risk
stays visible in the reply, for example when the sheets plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/lit-xlsx-stub.test.mjs`: the stub's install lines, the workbook route of the prompt
hook, and that a Word request still reaches lit-docx.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never build a workbook from memory, from another skill or with a library the stub does not ship: a sheet written
  without the recalculation and audit can hold `#REF!` or hardcoded numbers nobody sees.
- Never edit an existing .xlsx by hand in its place.

## #contract.anti_patterns

- Writing an .xlsx with openpyxl, pandas or a CSV renamed to .xlsx because the real skill is missing.
- Treating the stub as an error: the user gets a working install line, not a failure.

## Where it lives

lit-xlsx turns a request, a CSV or an existing workbook into a finished Excel file: a financial model, a budget with
scenarios, a cleaned table with a pivot, a Korean report table or a KPI dashboard. Inputs and formulas are told apart
by colour, the numbers stay live formulas, LibreOffice recalculates the file in a throwaway profile, an audit looks
for formula errors and hardcoded results, and every sheet is rendered to a PNG and looked at before delivery. The
default look is restrained; a `dashboard` preset adds a KPI band and charts.

The skill, its templates and its own Python runtime live in the `sheets` plugin of the **wjgoarxiv-skills**
marketplace. LitClaude keeps this stub so that `/litclaude:lit-xlsx`, `Skill(lit-xlsx)` and a bare `lit` workbook
request lead somewhere useful.

That makes it a LitFamily extension. LitClaude's core works on its own; install the extensions you use
beside it to get the full LitFamily experience.

First check that no skill of your own has this name. A `lit-xlsx` folder in `~/.claude/skills` or in a
project's `.claude/skills` would load beside `sheets:lit-xlsx` and compete with it. The first line lists one;
the next two move a personal or a project copy whole into a dated folder Claude Code does not read:

```bash
ls -d ~/.claude/skills/lit-xlsx .claude/skills/lit-xlsx 2>/dev/null
d="$HOME/.claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv ~/.claude/skills/lit-xlsx "$d"/
d=".claude/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$d" && mv .claude/skills/lit-xlsx "$d"/
```

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install sheets@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/sheets/skills/lit-xlsx` folder; the install line installs the whole `sheets` plugin.
The installed skill answers as `sheets:lit-xlsx`.

To update, refresh the marketplace and then the plugin.
Claude Code installs a new copy only when the plugin's version has changed; it loads after `/reload-plugins`:

```bash
claude plugin marketplace update wjgoarxiv-skills
claude plugin update sheets@wjgoarxiv-skills
```

In your own terminal, `npx @litfamily/litclaude extensions install sheets` runs these lines for you: it prints
the plan, stops at a same-name skill of your own, and runs it with `--yes`. `update`, `remove` and `check` work alike.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:edaa0dfebc6d -->
