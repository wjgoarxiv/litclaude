# Proposal

Proposal is the plan or proposal as a document (제안서, 기획서, 사업 계획서): something a reader is asked
to approve, fund or join. It is the only pack with a cover page of its own, and that cover is
typographic: a label, a large title set left in the upper third of the page, one short wine-coloured
rule, the subtitle and a lead paragraph, with the byline, date and notice at the foot. The body that
follows is as plain as a report's: near-black headings without numbers, booktabs tables, one decision
box and one key-figure strip. A proposal persuades through a clear request, an honest budget and a
schedule a reader can check; the pages carry no brochure devices.

## When to use it

Choose Proposal for 사업 제안서, 기획서, 계획서, a grant or budget request, a partnership proposal written
as a document, or a project plan with costs and a schedule. It is the first candidate for the proposal
type. It moves up when the source asks the reader to approve an amount, when it holds a budget and a
timeline, or when the document is sent ahead of a meeting where the decision will be taken.

## When it is the wrong choice

- A results report with a decision at the end: Report reads as evidence, Proposal as a request.
- A one-to-three page decision request: Brief or Memo; a cover page on a two-page document wastes a
  page.
- A technical procedure: Manual.
- A document whose reader expects no cover and numbered parts (a regulator, an audit): Report.

## Structure

Proposal differs from the other packs in its cover page, its unnumbered sections with a centred folio,
and its budget-led body; any other tonality rendered from the same source differs from it in at least
three structural features (`qa_docx.py a.docx --compare b.docx`, check `tonality.structure`).

- **Page 1: a typographic cover page.** The label (`kicker=`, for example `사업 제안서`), the title
  left-aligned about a fifth of the way down the page, a short rule in the accent, the subtitle, and
  the lead paragraph written inside `::: cover`. The byline, the date in the form `2026. 6. 30.` and the
  frontmatter `notice:` stand at the foot of the cover. There is no colour block and no figure on the
  cover; `variant=` is accepted and ignored. The body starts on the next page, numbered 1.
- **Summary.** `# 제안 요약` / `# Summary` as prose: the request in one sentence, then why now. The
  key-figure strip (cost, time, result) is set after the summary's first paragraph; figures written
  inside the cover block are moved there automatically.
- **Numbering.** Sections are unnumbered. Levels part by weight and the space above.
- **Components and their purpose.** Three kinds are allowed: `keyfigures` (one strip of three
  comparable numbers the reader will be asked to approve), `callout` (one box at most, the decision
  asked and its date), and `columns` (two blocks of nearly equal length, such as quantitative and
  qualitative effects). Every component needs its purpose line on the direction card.
- **Budget and schedule.** `# 소요 예산` and `# 추진 일정` as booktabs tables, a total row in bold under
  a thin rule, the unit hoisted to a `(단위: 백만 원)` line when every amount column shares it.
- **Running head.** The folio alone, centred at the foot; nothing on the cover. No header.
- **Contents.** None by default; a proposal long enough to need contents is usually a report.

## Tokens

Values at the pack default (density 8, variance 6), from `templates/tonalities/proposal.yaml`.

| Token | Value |
|---|---|
| Paper, margins | A4; top 26, bottom 28, left 26, right 26 mm; text block 158 mm |
| Body | Pretendard 10.5 pt Korean / 11 pt English; Korean justified, English ragged right |
| Line pitch | Hangul 175 % (Word multiple 1.14), Latin 133 % (0.87) |
| Paragraph spacing | 6 pt after (5 pt English), no indent |
| Scale (Korean) | h1 14.5 pt (1.4x), h2 12.5 pt (1.2x), h3 10.5 pt bold; cover title 28.5 pt (2.7x) |
| Scale (English) | h1 15.5, h2 13, h3 11 pt bold; cover title 29.5 pt |
| Ink | body and headings `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | wine `6E2639`, on the cover title rule and the callout rule only |
| Tables | booktabs, 9.5 pt Korean / 10 pt English, header bold, numbers right-aligned |
| Key figure | h2 size, bold, in ink over an ink hairline, three per row |
| Running head | folio centred at the foot, 8.5 / 9 pt muted; none on the cover |
| Components | keyfigures, callout (one at most), columns |
| Figures | at most 0.60 of the frame height |
| Fill | no body page under 0.35; median target 0.75 |

**Dials.** Density 6 or 7 opens the margins to 27/29/27/27 mm and the Hangul pitch to 180 %, for a
printed proposal handed over in a meeting. Density 10 closes them to 24/26/25/25 mm for a proposal held
to a page limit by a call for proposals; the body never drops below 10.5 pt. Variance no longer adds
kinds, table styles or cover looks.

## Worked source

```markdown
::: cover kicker="사업 제안서"
예시 기관의 창고 두 곳에 재고 자동 추적을 도입하는 계획이다. 실사 시간과 출고 오류를 함께 줄이는 것이 목표다.
:::

# 제안 요약

창고 두 곳에 재고 자동 추적 장비를 도입하는 사업비 4.2억 원의 승인을 요청한다.

::: keyfigures cols=3
- **4.2억 원** 총사업비 (예시)
  - 2027년 1-12월, 장비와 구축 포함
- **11개월** 투자 회수 기간 (예시)
  - 연간 절감액 4.6억 원 기준, 내부 추정
- **38%** 재고 실사 시간 감소 (예시)
  - 시범 창고, 2026년 3-5월 측정
:::

::: callout kind=key title="결정 요청"
2027년 예산 편성 전, 2026. 11. 30.까지 사업 추진 여부를 결정해 주시기 바랍니다.
:::

# 소요 예산

표 1. 항목별 소요 예산 (예시)

| 항목 | 상반기 (백만 원) | 하반기 (백만 원) |
|---|---|---|
| 장비 | 180 | 60 |
| 구축 | 70 | 50 |
| 합계 | 250 | 110 |

자료: 공급사 견적, 내부 추정 (예시)
```

## Headings

| Use | Not |
|---|---|
| 재고 자동 추적 도입 계획 | 재고 자동 추적을 도입하면 비용이 줄어든다 |
| 소요 예산과 회수 기간 | 11개월이면 투자금을 회수할 수 있다 |
| Expected benefits | This plan pays for itself in a year |

The title and subtitle are labels too; the persuasive sentence goes in the cover's lead paragraph and
the first sentence of the summary. `heading.declarative` fails a heading, title or subtitle written as
a sentence.

## Numbers

Key figures sit at the h2 size in the summary, never on the cover. Each carries a label and a basis
line (period, scope, source). Estimates say (추정), (예시) or (estimate) in the label, and a payback or
saving shows the assumption it rests on. A figure without a basis is written into a sentence.

## Failure patterns

- A cover holding six figures: none stays on the cover, only the first strip is drawn in the summary,
  and the rest belong in the budget table.
- A second callout for a risk: only one box is drawn (decision request first); write the risk as a
  short part with its own heading.
- Every part opened with a full-page picture: the median fill drops below 0.75 and the argument
  disappears; one picture per part at most.
- A budget table split over two pages (`table.split`); start it at the top of a page or shorten it.
- Expecting each part to start on a new page: there is no forced break before an h1.
