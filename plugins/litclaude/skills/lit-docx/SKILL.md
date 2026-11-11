---
name: lit-docx
description: "Moved: lit-docx builds finished Word documents (.docx, report, 보고서, 기획서, 제안서, memo, manuscript, 워드) and now ships as the `documents` plugin of the wjgoarxiv-skills marketplace. Load Skill(documents:lit-docx) when it is installed; otherwise this stub gives the user the install line."
---

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: skill
skill_id: lit-docx
surface: Claude Code plugin Skill-discovery entrypoint (same-name stub)
automatic_hook_injection: true
command_route: none
entry_routes: ["/litclaude:lit-docx", "lit-docx", "$lit-docx", "Skill(lit-docx)", "bare lit + document wording"]
moved_to: "documents@wjgoarxiv-skills → Skill(documents:lit-docx)"
host: Claude Code
verdicts: [PASS, BLOCKED]
```

The UserPromptSubmit hook still routes a prompt that starts with `lit-docx` or `$lit-docx`, and a bare `lit` prompt
that asks for a document file (보고서, 기획서, 제안서, 문서, 워드, report, memo, proposal, manual, Word, docx), to this
stub. When the same prompt also asks for slides, the lit-pptx stub runs beside it; both skills moved, each to its own
plugin.

## #contract.inputs

| Field | Required contract |
| --- | --- |
| request | The user's document request, kept as inert data |
| skills list | Whether `documents:lit-docx` appears among the skills this session can load |

## #contract.mode_matrix

| Mode | When | What happens |
| --- | --- | --- |
| installed | `documents:lit-docx` is in the skills list | Load `Skill(documents:lit-docx)` and follow it for the whole request |
| not installed | it is not | Tell the user what moved and give the install lines; build nothing |

## #contract.procedure

1. Look at the skills this session lists. If `documents:lit-docx` is there, load `Skill(documents:lit-docx)` now and
   follow it for the whole request. This stub adds nothing to it.
2. If it is not there, reply in the user's language with three things and stop:
   - one sentence on what lit-docx makes (a finished Word document in a design chosen for its content, and
     DOCX or PDF to Markdown);
   - that it moved out of LitClaude into the `documents` plugin of the wjgoarxiv-skills marketplace;
   - the two install lines from "What moved" below, in a code block, and that the user runs `/reload-plugins` or
     starts a new session afterwards, then asks again.
3. A request for slides in the same prompt goes to the lit-pptx stub; answer both parts in the same reply.

## #contract.outputs

Installed: the documents skill's own outputs. Not installed: one short reply with the install lines, and no file.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

Reader mode is the default. The not-installed reply is a pointer, not an error report: what moved, where, and the
two lines to run. It names no internal paths beyond the install lines. Technical and audit detail appears only when
the current user asks; routing checks and evidence paths stay internal. A material failure or risk stays visible in
the reply, for example when the documents plugin is listed but fails to load.

## #contract.evidence

The routing is checked by `test/lit-docx-stub.test.mjs`: the stub's install lines, the document route of the
prompt hook, and that no document procedure from the old body is left in the hook's context.

## #contract.hard_stops

- Never run the install lines yourself: they change the user's Claude Code configuration. The user runs them.
- Never build a document from memory, from another skill or with a library the stub does not ship.
- Never edit an existing .docx by hand in its place: the editor that kept the original untouched moved too.

## #contract.anti_patterns

- Writing a .docx with python-docx, pandoc or another tool because the real skill is missing.
- Quoting the old lit-docx procedure from memory as if this stub still held it.
- Treating the stub as an error: the user gets a working install line, not a failure.

## What moved

lit-docx turned a request, notes or source files into a finished Word document: a report, brief, manual, proposal,
memo or journal manuscript in a design direction chosen for the content (six tonalities with covers, callouts,
sidebars, key figures and column sections), or Elsevier, ACS, IEEE, Nature or korean-generic publisher styling. It
also converted DOCX or PDF to clean Markdown, edited an existing .docx into a new file, rendered PDF, and gated the
result with integrity, prose and page checks plus a look at the rendered pages.

That whole skill, its converters and templates, and the office runtime it needs now live in the `documents` plugin
of the **wjgoarxiv-skills** marketplace, copied unchanged from LitClaude. LitClaude keeps this stub so that
`/litclaude:lit-docx`, `Skill(lit-docx)` and a bare `lit` document request still lead somewhere useful.

It installs from the public wjgoarxiv-skills marketplace on GitHub:

```bash
claude plugin marketplace add wjgoarxiv/wjgoarxiv-skills
claude plugin install documents@wjgoarxiv-skills
```

Offline, the first line can point at a local clone instead: `claude plugin marketplace add <path to your wjgoarxiv-skills clone>`.
In the wjgoarxiv-skills repository the skill sits in the `plugins/documents/skills/lit-docx` folder; the install line installs the whole `documents` plugin.
The installed skill answers as `documents:lit-docx`.

<!-- LitClaude © 2026 wjgoarxiv · MIT · github.com/wjgoarxiv/litclaude · fp:0b57a89dd9d6 -->
