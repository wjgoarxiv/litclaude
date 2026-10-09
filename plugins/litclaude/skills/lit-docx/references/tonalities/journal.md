# Journal

Journal is long-form reading set in two columns: an essay, a newsletter, a white paper, a research
summary for colleagues that is not bound for a named journal. It sits close to a publisher profile. A
masthead with authors, affiliations, an abstract and keywords opens page 1, the body runs in two
ragged-right columns with a 6 mm gutter, sections carry decimal numbers so that "Section 2.4" in the
text points somewhere, and the header holds the short title and the folio. Latin body text is set in
Times New Roman for its narrow measure; Hangul, headings and every other element stay in Pretendard.
The pack has no accent colour: rules, headings and the one callout style are all near-black ink.

## When to use it

Choose Journal for 칼럼, 뉴스레터, 백서, 연구 요약, a long explainer, or an English essay of three pages
and more with few tables. It is the first candidate for essays and white papers and moves up when the
source is mostly running prose in English, when it cites sections and references, or when the reader
is expected to read from start to finish rather than look things up.

## When it is the wrong choice

- A journal submission or a named publisher's format: use that publisher profile (`--publisher
  elsevier`, `acs`, `ieee`, `nature`); a tonality never stands in for a journal's rules.
- A document of wide tables: every table of more than three columns spans the page, and a run of those
  reads as Report with extra gutters.
- A briefing or a memo: two columns on a two-page memo slow the reader down.
- A procedure: steps in narrow columns wrap badly; Manual.

## Structure

Journal is the only pack with two columns, an abstract in its title block and Times New Roman body
text, so any other tonality rendered from the same source differs from it in at least three structural
features (`qa_docx.py a.docx --compare b.docx`, check `tonality.structure`).

- **Page 1: the masthead.** An optional label line with the Korean date on the right (`2026. 6. 30.`),
  the title, the subtitle as a standfirst in muted ink, the authors and organisation, numbered
  affiliations and a corresponding address when the frontmatter has them, one ink rule, the notice once
  in small muted text, then the abstract and keywords (초록 / 주요어 or Abstract / Keywords) from the
  frontmatter. The two-column body starts under the masthead on the same page. `variant=` on a cover is
  accepted and ignored.
- **Summary form.** The abstract is the summary. There is no summary section and no key-figure strip;
  the first paragraph of the body states what the piece argues and for whom.
- **Numbering.** Decimal: h1 `1`, h2 `1.1`, in plain ink at heading size, so cross-references resolve.
  References or further reading close the piece as a numbered list; that back-matter heading is left
  unnumbered.
- **Components and their purpose.** One kind only: `callout`, for a definition, a caveat or a method
  note that sits outside the line of argument, at about one per four pages. It is drawn as a 1 pt ink
  rule down its left side with a bold title, no fill. A `::: sidebar`, `::: keyfigures` or `::: columns`
  written in the source keeps its content as ordinary text with its title as a bold lead line, and
  stdout says so.
- **Wide material.** A table of four or more columns spans both columns with its caption; a table of up
  to three columns stays in the column at column width. Figures take the column width.
- **Running head.** From page 2, the short title at the top left and the folio at the top right, small
  and muted. No
  section name in the header.
- **Contents.** None.

## Tokens

Values at the pack default (density 9, variance 6), from `templates/tonalities/journal.yaml`. The pack
has no accent: `accent_on` is empty, so the title rule and the callout rule are drawn in ink.

| Token | Value |
|---|---|
| Paper, margins | A4; top 25, bottom 27, left 25, right 25 mm; two columns, 6 mm gutter |
| Body | Times New Roman for Latin, Pretendard for Hangul, 10.5 pt, ragged right |
| Line pitch | Latin 133 % of the size (Word multiple about 1.16 in Times New Roman), Hangul 175 % (1.14 in Pretendard) |
| Paragraph spacing | 6 pt after (5 pt English), no indent |
| Scale | h1 13.5 pt (1.3x), h2 12 pt (1.15x), h3 10.5 pt bold, in Pretendard; title 26.5 pt (2.5x) |
| Ink | body and headings `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | no accent |
| Tables | booktabs, 9.5 pt, header bold, numbers right-aligned |
| Running head | header: short title left, folio right, 8.5 pt muted |
| Components | callout only |
| Figures | at most 0.40 of the frame height, sized to the column width |
| Fill | no body page under 0.35 (`fill.page`) |

**Dials.** Density 7 opens the margins to 27/29/27/27 mm and the pitch to 137 % Latin and 180 % Hangul,
for a white paper meant to be printed; the columns get narrower, so check that three-column tables
still fit. Density 10 closes the top margin to 24 mm for a newsletter with a fixed page count. Variance
no longer adds component kinds.

## Worked source

```markdown
---
title: 재택근무 1년의 협업 비용
subtitle: 4개 본부 설문으로 본 회의 시간 변화
authors: [김연구, 이분석]
organization: 예시연구소
date: 2026-09-30
abstract: 재택근무 도입 1년 뒤 본부별 회의 시간과 응답 지연을 비교했다. (예시)
keywords: [재택근무, 협업, 회의 시간]
tonality: journal
---

# 조사 방법

2026년 7-8월에 4개 본부 612명에게 설문을 보냈고 523명이 응답했다(예시). 응답자 구성은 2.2절에서 다룬다.

::: callout kind=note title="응답률 주의"
개발 본부의 응답률이 다른 본부보다 낮아 본부 간 비교에는 오차가 크다.
:::

표 1. 본부별 주간 회의 시간 (예시)

| 본부 | 2025년 9월 (시간) | 2026년 9월 (시간) | 변화 (시간) |
|---|---|---|---|
| 개발 | 3.9 | 5.1 | +1.2 |
| 영업 | 4.4 | 4.8 | +0.4 |

자료: 사내 설문 (예시)
```

The four-column table spans the page with its caption, set as `<표 1>` above and the hoisted
`(단위: 시간)` line. The frontmatter date prints as `2026. 9. 30.`.

## Headings

| Use | Not |
|---|---|
| 재택근무 1년의 협업 비용 | 재택근무는 협업 비용을 키웠다 |
| Meeting time after remote work | Remote work doubled our meetings |
| 조사 방법과 한계 | 조사에는 몇 가지 한계가 있음 |

The standfirst under the title is a subtitle and follows the same rule; the argument starts in the
first paragraph. `heading.declarative` fails a heading, title or subtitle written as a sentence.

## Numbers

Journal leans on prose, and figures belong in sentences or tables with their period and source. There
is no key-figure strip and never a large number across both columns. Example data says (예시) or
(sample).

## Failure patterns

- A sidebar, key-figure strip or quotation box planned on the direction card: none is drawn; plan the
  callout alone.
- Five-column tables in a row, each spanning the page: the columns lose their rhythm; move them to an
  appendix part.
- Bullet lists of single words in a column: they leave half of each column empty; write them as a
  sentence.
- Section numbers typed into headings, which doubles the decimal numbering.
- Using Journal as a stand-in for a publisher's manuscript format.
