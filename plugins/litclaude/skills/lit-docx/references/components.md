# Page components

The converter reads a small set of fenced directives in the Markdown source and turns each into real
Word structure: a title block or cover page, ruled one-cell tables, column sections, styled paragraphs.
A pre-pass splits them out before the Markdown is rendered, so no fence ever reaches the page; an
unknown name, an unknown attribute or an unclosed fence stops the build with the line number. This file
is the contract for every directive: its syntax, what it produces today, which tonalities use it, and
how it is misused.

Components exist to carry content that plain paragraphs carry badly: a decision that must not be
missed, a warning placed before the step it protects, a definition beside the text, three comparable
numbers that set the scale of a summary, two options of equal weight read side by side. They are never
decoration, and the restraint rules keep them scarce. Every component on the direction card needs a
one-line purpose ("callout: the decision request for the October meeting"); a component without one is
left out of the source.

## The component budget

Three rules hold in every tonality run, and the gate check `component.budget` fails a document that
breaks them:

- **At most three component kinds** per document, beyond headings, paragraphs, lists, tables and
  figures. Kinds are admitted in the order they first appear; a fourth kind keeps its content as text.
- **One key-figure strip**, in the summary only.
- **No pull quote.**

On top of that, each pack names the kinds it uses at all, and callouts are rationed by length. A
directive the pack does not use, or one past the budget, keeps its content as ordinary text, its
`title` as a bold lead line, and the converter's stdout says so. Nothing is dropped silently, so read
that output after every build. `component.variety` still fails a tonality document of four or more
pages that shows fewer than two component kinds. Memo uses none and Journal one, so when that check
fires on either, the document is usually too long for its pack; reconsider the tonality before adding
a component without a purpose.

## Grammar

```text
::: <name> [<positional>] [<key>=<value> ...]
<Markdown: paragraphs, lists, tables, nested directives where allowed>
:::
```

- The opening line starts at column 0: three or more colons, a space, the name. The block closes at the
  next line made only of the same number of colons.
- **Nesting needs a longer outer fence.** Key figures inside a cover are written with `::::` outside
  and `:::` inside. Two `:::` fences in a row are read as "close, then a stray closing fence", which is
  an error.
- Values are bare tokens (`kind=warning`, `cols=3`, `gap=8`) or double-quoted strings
  (`title="비용 가정"`, with `\"` as the only escape). Keys are lower case; a repeated key is an error.
- Fences inside fenced code blocks are text.
- `<!-- column-break -->` on its own line is allowed only inside `::: columns`.
- Names: `cover`, `callout`, `sidebar`, `pullquote`, `keyfigures`, `columns`.

## Who uses what

| Tonality | Kinds it uses (`components.allowed`) | Callouts | Key figures |
|---|---|---|---|
| Report | keyfigures, callout, columns | about one per four pages | one strip, in the summary |
| Brief | callout, columns | one at most, moved under the title block | none |
| Proposal | keyfigures, callout, columns | one at most | one strip, in the summary |
| Manual | callout, sidebar, columns | about one per four pages, one style | none |
| Memo | none | none (a bold lead line) | none |
| Journal | callout | about one per four pages, ink rule | none |
| plain (no tonality) | every kind except pullquote | every callout | as written |

## `::: cover`

```markdown
::: cover variant=typographic kicker="사업 제안서"
한두 문장의 리드 문단.
:::
```

- Attributes: `variant` (`typographic`, `band`, `split` or `masthead`), `kicker` (the small label of the
  title block, such as 현안 분석, 검토 보고, 공지, Issue note). `image=` is accepted by the parser and draws
  nothing.
- Must stand first in the document. Title, subtitle, author, organisation, date and notice come from
  frontmatter; a cover without `title:` is an error.
- **The variant no longer changes the look.** Every value is accepted so that one source converts under
  any tonality, but each tonality sets its own typographic title block: Report and Brief a title block
  with a label-and-date line, a title, a byline and one rule; Manual the title over a document-control
  block; Memo a label, the subject and To / From / Date / Subject rows; Journal a masthead with
  affiliations, abstract and keywords; Proposal a cover page with the title left-aligned in the upper
  third, one short rule, and the byline, date and notice at its foot. No colour block, no full-bleed
  field, no figures on any of them.
- The block holds an optional lead paragraph (Memo: the `Key: value · Key: value` rows) and an optional
  nested `keyfigures` strip. **Key figures never stay on a cover**: in a pack that uses them they move to
  just after the first paragraph of the summary; in a pack without them they are left out with a note,
  so the summary text must state those numbers itself.
- The frontmatter `notice:` prints once, in small muted text under the title block (Proposal: at the
  foot of the cover). It never appears in a page header and never as a coloured label.
- Dates become the Korean form `2026. 6. 30.` in Korean documents, frontmatter date included.

## `::: callout kind=<note|key|warning> [title="…"]`

A one-cell table across its container, ruled like a booktabs table: a 0.75 pt rule above and a 0.5 pt rule
below in the pack's accent (Journal: ink), no side stripe, no fill and no other border, a bold title line (참고 / 핵심 / 주의, Note / Key point / Warning, or
`title`), then the content at body size. The cell does not split across pages. Every kind is drawn in
this one style; the kind decides priority, not colour.

Callouts are rationed: about one per four pages of the document (Brief and Proposal: one at most). When
the source holds more, the boxes go to the decision request (`key`) first, then warnings, then notes,
in source order within each kind; the others keep their content as text under a bold lead line. In
Brief the first `key` callout is moved right under the title block, which is how its conclusion comes
first.

Use `key` for the decision or the request, `warning` for a risk tied to an action (placed before the
step it protects), `note` for a definition or an assumption that sits outside the line of argument.
Content may be paragraphs, a short list or one small table. Do not use a callout to frame ordinary
text, and never put a box inside a box.

## `::: sidebar [title="…"] [width=third|half] [float=right|left|none]`

**Manual only.** A one-cell table with a hairline down its left side in the accent, no fill, text at the
table size. It floats right at a third of the width beside the paragraphs it explains (`width=half` and
`float=left|none` are accepted). When the paragraphs between it and the next heading are shorter than
the box, the converter sets it full width under them instead, so the next heading never starts beside
it (gate check `sidebar.overlap`). In every other tonality a sidebar keeps its content as text with its
title as a bold lead line. Use it for terms, a method note or a short precedent, and keep it shorter
than the text beside it.

## `::: pullquote [cite="…"]`

Pull quotes are off. The directive still parses, but no tonality draws one, and the gate fails any pull
quote that reaches the page. What happens to the block depends on its text: a pull quote that repeats a
sentence already in the body is left out entirely, with a note on stdout; one that says anything else
stays in the document as an ordinary paragraph, because it is content the body would otherwise lose.
Write that sentence into the body where it belongs and delete the directive.

## `::: keyfigures [cols=2|3|4]`

```markdown
::: keyfigures cols=3
- **+12%** 출고 처리량 (예시)
  - 2026년 2분기, 전년 동기 대비
- **96.4%** 당일 출고율 (예시)
  - 2026년 6월, 창고 관리 시스템
- **3.1억 원** 2분기 운영비 (예시)
  - 2026년 4-6월 합계, 내부 결산
:::
```

One list of one to eight items. Each item is `**<figure>** <label>`, and the figure must contain a digit;
an indented item under it is its basis line (period, scope, source). The strip is a borderless row, each
cell under an ink hairline: the figure bold in ink at the h2 size, the label at the table size, the
basis in muted ink.

Report and Proposal use **one strip per document, in the summary only**: write it after the summary's
first paragraph (a strip written inside the cover is moved there). A second strip prints as a plain list
with the basis in brackets, as does any strip in a pack without key figures. Three or four real,
comparable metrics make a strip; a non-metric ("고객 만족 향상") or a figure without a basis does not
belong in one. Example values say (예시) or (sample) in the label, and every number is rounded honestly.

## `::: columns <1|2|3> [gap=<mm>] [rule=true]`

The content becomes its own section with that many columns, opened and closed by continuous section
breaks. `<!-- column-break -->` ends a part early, which is how two options are set side by side: each
part goes into its own cell of one borderless row, tops aligned. `gap` defaults to 6 mm; `rule=true`
draws a line between the parts. Top level only.

Two parts are set side by side only when their lengths are within about 20 % of each other; otherwise
the block is read in sequence as ordinary text, because one long column next to three lines leaves a
hole on the page. Report, Brief, Proposal and Manual use columns; Journal, already in two columns, and
Memo do not.

## Table captions and table styles

Every tonality draws booktabs tables: a 1 pt rule above and below, 0.5 pt under the header, no vertical
rules, no fills, no banding. The header is bold ink, numeric columns are right-aligned in tabular
figures (clock times count as numbers), and no column is narrower than its longest word. Table text is
9.5 pt at a 140 % pitch. A last row whose first cell is 합계, 총계, 소계, 계, Total or Sum is set bold
under a 0.5 pt rule.

A caption is the paragraph right before a table that starts with `표 <n>.` or `Table <n>.`. A trailing
`{style=…}` is accepted and removed; every tonality still draws booktabs and stdout says so.

**Korean conventions.** Write `표 1. 제목`; it prints above the table as `<표 1> 제목` with the label
bold. When every numeric header cell carries the same unit in brackets (`2분기 (억 원)`), the unit leaves
the headers for one right-aligned `(단위: 억 원)` line above the table. Under the table come notes first,
then the source: `주:` lines, then `자료:` (a `출처:` line is rewritten `자료:`). A figure's alt text
`그림 1. 제목` prints as `[그림 1] 제목`.

**English conventions.** `Table 1.` above the table and `Figure 1.` below the figure, the label bold;
`Note:` and `Source:` lines under the table.

A table that fits keeps its rows on one page (gate check `table.split`). A long table (a header and six
or more body rows) may break between rows with the header repeated and at least three body rows on each
side. Text under a table stands 8 pt clear; a `주:` or `자료:` line follows at 3 pt.

## Source and note lines

A paragraph that opens with `출처:`, `자료:`, `주:`, `Source:`, `Sources:`, `Note:` or `Notes:` takes the
`Source Note` style (note size, muted ink). Put one under every table and figure that holds data.

## Misuse

- A component used to fill a page or decorate a paragraph; fill comes from content (see
  `page-composition.md`).
- A fourth component kind, a second key-figure strip, or a pull quote; each prints as text or is left
  out. Read the converter output and the page.
- A component on the direction card without a purpose line.
- Key figures without basis lines, or with adjectives instead of numbers ("대폭 개선").
- A sidebar outside Manual, or a sidebar holding steps the reader must follow in order.
- A `columns` block holding one long part and one line; balance the parts or write them in sequence.
- Nested directives with equal fences.
- Component titles written as sentences; they follow the same noun-phrase rule as headings, the title
  and the subtitle (`heading.declarative`).
