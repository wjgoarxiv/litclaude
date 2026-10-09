# Report

Report is the working document of an organisation: a periodic result, a project report, an analysis
that a manager reads at a desk and comes back to. In Korean its default manner is institute prose, the
way a central-bank or think-tank issue note reads: full paragraphs that argue from evidence, numbered
sections, and tables that carry the numbers. The page is quiet on purpose. Every heading is set in the
same near-black ink as the body and stands out only by weight and the space above it; one navy rule
under the title block and the two rules of the decision callout are the only colour in the document.
What makes a report look finished here is its structure (a clear first page, honest tables, numbered
parts a reader can cite), never ornament.

## When to use it

Choose Report for results reports (분기 실적, 사업 결과), project close-outs, analyses with tables and
figures, audit and review reports, research notes for management, and any document of four to thirty
pages that is read section by section. It is the first candidate for the report type in the direction
table, and the one to move up when tables are more than a third of the blocks or the source holds four
or more tables. A Korean report and an English one use the same pack; the numbering style, captions and
leading follow the language.

## When it is the wrong choice

- A one-to-three page decision paper for an executive who reads the conclusion and stops: Brief puts
  the decision request first and sets the summary as numbered points.
- A memo, notice or letter under two pages: the title block and the numbered parts are too heavy; use
  Memo.
- A step-by-step procedure with warnings and a document-control block: Manual.
- Long continuous reading with few tables (an essay, a white paper): Journal's two columns hold the
  measure.
- A government itemised briefing written in 개조식 lines (□ ○ - with ~함/~임 endings): that is not a
  built-in Report variant. For an itemised briefing use Brief; write 개조식 lines inside a Report only
  when the user asks for them.
- A journal submission: use the named publisher profile, never a tonality.

## Structure

The structure is what tells Report apart from the other five packs; two tonalities rendered from one
source must differ in at least three of these features, and the gate checks it with
`qa_docx.py a.docx --compare b.docx` (`tonality.structure`).

- **Page 1: a title block above the body, no cover page.** One line holds the series or kind label on
  the left (the `kicker=` of `::: cover`, for example `현안 분석` or `Issue note`) and the Korean date
  on the right (`2026. 6. 30.`, converted from the frontmatter date). Under it come the title, the
  subtitle in muted ink, the author and organisation line, one navy rule, and the frontmatter
  `notice:` once in small muted text. The summary starts on the same page. `variant=` on the cover is
  accepted and ignored: every Report sets this typographic block.
- **Contents.** When the source runs to about five pages or more, a short contents list (each h1, a
  dotted leader, its page) stands between the title block and the summary. Shorter reports have none.
- **Summary.** `# 요약` (or `# Summary`) as running prose: the first paragraph states the result in two
  to four sentences. The single key-figure strip, if the report has one, is set right after that first
  paragraph; key figures written inside `::: cover` are moved there automatically.
- **Numbering.** Korean sections are numbered `Ⅰ.` (h1), `1.` (h2), `가.` (h3) in plain ink at heading
  size; English sections `1` and `1.1`. Write headings without numbers; the engine adds them.
- **Components and the purpose each serves.** Report allows three kinds: `keyfigures` (one strip of
  three or four comparable metrics in the summary, so the reader has the scale before the argument),
  `callout` (the decision request, then a warning, then a note, at about one per four pages), and
  `columns` (two options of nearly equal length side by side). The direction card names each one with
  a one-line purpose; a component without a purpose is left out.
- **Evidence.** Booktabs tables with `<표 n>` captions, a `(단위: …)` line, then `주:` and `자료:` lines
  under the table. A part usually holds a table, the sentence that reads it, and a short analysis.
- **Running head.** Footer only, from page 2: the short title on the left, the folio on the right,
  both small and muted. No section name in the running head, no notice in the header.
- **Close.** A `# 향후 과제` / `# Next steps` part with a table of owner, action and date when the report
  asks for follow-up.

## Tokens

Values at the pack default (density 9, variance 5), read from `templates/tonalities/report.yaml`.

| Token | Value |
|---|---|
| Paper, margins | A4; top 25, bottom 27, left 25, right 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt; Korean justified, English ragged right |
| Line pitch | Hangul 175 % of the size (Word multiple 1.14), Latin 133 % (0.87); a paragraph holding a picture is single spaced |
| Paragraph spacing | 6 pt after (5 pt English), no first-line indent |
| Scale | h1 14.5 pt (1.4x), h2 12.5 pt (1.2x), h3 10.5 pt bold; title 26.5 pt (2.5x) |
| Heading spacing | h1 22 pt above, 9 pt below; h2 15 / 6 pt; no rule under any heading |
| Ink | body and headings `#1A1A1A`; muted `#555555` (subtitle, captions, notes, running heads); rules `#8C8C8C` |
| Accent | navy `1F3A5F`, on two element kinds only: the title rule and the callout rule |
| Tables | booktabs, 9.5 pt at 140 % pitch, header bold, numbers right-aligned |
| Key figure | h2 size, bold, in ink, over an ink hairline; label 9.5 pt, basis muted |
| Running head | footer: short title left, folio right, 8.5 pt muted |
| Components | keyfigures, callout, columns (three kinds at most) |
| Figures | at most 0.45 of the text-frame height |
| Fill | no body page under 0.35 (`fill.page`) |

**Dials.** Density moves margins and leading together: density 10 closes the margins to 24/26/25/25 mm
for a report a page over its limit; density 7 opens them to 27/29/27/27 mm with a Hangul pitch of 180 %.
Body type never drops below 10.5 pt. Variance is recorded on the card but no longer widens the
component set or the table styles; the budget above is fixed.

## Worked source

```markdown
::: cover kicker="현안 분석"
:::

# 요약

2026년 2분기 출고 처리량은 전년 동기보다 12% 늘었고, 증가분의 대부분은 북부 창고 야간 교대에서 나왔다.

::: keyfigures cols=3
- **+12%** 출고 처리량 (예시)
  - 2026년 2분기, 전년 동기 대비, 운영 기록
- **3.1억 원** 2분기 운영비 (예시)
  - 2026년 4-6월 합계, 내부 결산
- **96.4%** 당일 출고율 (예시)
  - 2026년 6월, 창고 관리 시스템
:::

::: callout kind=key title="요청 사항"
북부 창고 야간 교대 1개 조 추가 여부를 7월 운영 회의에서 결정해 주시기 바랍니다.
:::

# 창고별 처리량과 비용

표 1. 창고별 분기 처리량 (예시)

| 창고 | 1분기 (천 건) | 2분기 (천 건) |
|---|---|---|
| 북부 | 412 | 486 |
| 남부 | 388 | 401 |
| 합계 | 800 | 887 |

자료: 창고 관리 시스템 (예시)
```

The caption becomes `<표 1> 창고별 분기 처리량 (예시)` with the label bold, the shared unit leaves the
headers for a right-aligned `(단위: 천 건)` line, and the 합계 row is set bold under a thin rule.

## Headings

| Use | Not |
|---|---|
| 2분기 처리량과 비용 | 2분기 처리량이 12% 늘었다 |
| 창고별 지연 원인 | 지연은 대부분 북부 창고에서 발생함 |
| Cost per order by site | Costs fell at every site |

The title and subtitle follow the same rule. `heading.declarative` fails a heading, title or subtitle
written as a sentence; the claim goes in the first sentence under the heading.

## Numbers

A key figure is set at the h2 size and never larger. Every figure carries a label and a basis line
(period, scope, source) and is rounded honestly; example data says (예시) or (sample) in the label. A
figure without a basis goes into a sentence. Data that needs more than four figures belongs in a table.

## Failure patterns

- A title block, a three-line summary, then a page holding one table: the summary should hold the
  first paragraph, the strip and the request (`fill.page`).
- A second key-figure strip lower in the report: only the first is drawn; the rest print as a list.
- Callouts used to decorate paragraphs: only about one per four pages is drawn as a box, decision
  request first; the rest keep their content as text with a bold lead line.
- Headings typed with their own numbers (`Ⅰ. 개요`), which doubles the numbering.
- Shrinking body type to meet a page limit; raise density one step instead.
