# Manual

Manual is the technical guide: an installation procedure, an operating manual, an onboarding guide, a
reference for people who look things up while their hands are busy. Its pages are built for finding and
citing. A document-control block under the title tells the reader which document this is, who owns it
and from when it applies; decimal section numbers let a step be cited as "4.2"; numbered steps hold one
action each; every warning has the same quiet form, slate-blue rules above and below it and a bold
title. The page itself stays in near-black ink with no fills, so a sheet photocopied for the workbench
loses nothing.

## When to use it

Choose Manual for 가이드, 매뉴얼, 절차서, 운영 지침, setup and maintenance instructions, API or tool usage
guides delivered as a document, and training material read step by step. It is the first candidate for
the guide type and the third for reports. Move it up when the source holds numbered procedures, several
warnings or cautions, reference tables of settings, codes and limits, or a revision history that a
document-control block should carry.

## When it is the wrong choice

- A report of results: numbered steps and warning boxes make an analysis read like instructions. Use
  Report.
- A decision paper or a briefing: Brief puts the decision first; Manual puts the procedure first.
- A text with no steps and no reference tables: the control block and the decimal numbering add
  weight without helping anyone find anything; Report or Journal.
- A two-page notice of a procedure change: Memo, with the change stated in its opening paragraph.

## Structure

Manual is the only pack with a document-control block, a sidebar and a short title in the header, so it
differs from every other tonality in at least three structural features
(`qa_docx.py a.docx --compare b.docx`, check `tonality.structure`).

- **Page 1: title over a document-control block.** An optional label line (the `kicker=` of
  `::: cover`, for example `설치 안내서`), the title, the subtitle in muted ink, then a two-column block
  between two ink hairlines: 문서 / 작성 부서 / 기관 / 시행일 (English: Document / Owner / Organisation /
  Issued). The values come from frontmatter `short_title` (or `title`), `author`, `organization` and
  `date`, the date in the Korean form `2026. 6. 30.`. The notice follows once in small muted text. No
  cover page; the body starts on page 1.
- **Contents.** From about five pages, a short contents list of the h1 parts with page numbers stands
  under the control block.
- **Summary form.** Prose: `# 개요` / `# Overview` states scope, audience and what the reader needs
  before starting (permissions, tools, time).
- **Numbering.** Decimal: h1 `1`, h2 `1.1`, in plain ink at heading size. Procedures are ordered lists,
  one action per item, the expected result in the next sentence.
- **Components and their purpose.** Three kinds are allowed. `callout` carries a warning placed
  immediately before the step it protects; every kind (key, warning, note) is drawn in the same single
  style, and only about one per four pages is boxed, decision request first, then warning, then note.
  `sidebar` holds definitions or a method note beside the text it explains; it floats right at a third
  of the width with a hairline down its left side, and when the paragraphs beside it are shorter than
  the box it is set full width so the next heading never starts next to it (`sidebar.overlap`).
  `columns` sets two symptom-and-action groups of nearly equal length side by side. There is no
  key-figure strip in this pack.
- **Reference tables.** Settings, error codes and limits in booktabs tables with units; a long table
  (a header and six or more body rows) may break between rows with its header repeated.
- **Running head.** From page 2, the short title at the top left and the folio at the foot right, both
  small and muted.
  The header never carries the current section name: a page field showed the first section starting on
  a page, not the one the page opens in.

## Tokens

Values at the pack default (density 9, variance 6), from `templates/tonalities/manual.yaml`.

| Token | Value |
|---|---|
| Paper, margins | A4; top 25, bottom 27, left 25, right 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt, ragged right in both languages (steps and codes read better unjustified) |
| Line pitch | Hangul 175 % (Word multiple 1.14), Latin 133 % (0.87) |
| Paragraph spacing | 6 pt after (5 pt English), no indent |
| Scale | h1 14 pt (1.35x), h2 12 pt (1.15x), h3 10.5 pt bold; title 26.5 pt (2.5x) |
| Ink | body and headings `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | slate blue `2E4A66`, on the callout rule and the sidebar rule only |
| Control block | 9.5 pt, labels bold, between two 0.5 pt ink hairlines |
| Tables | booktabs, 9.5 pt, header bold, numbers right-aligned |
| Running head | header: short title left; footer: folio right; 8.5 pt muted |
| Components | callout, sidebar, columns (three kinds at most) |
| Figures | at most 0.45 of the frame height |
| Fill | no body page under 0.35 (`fill.page`) |

**Dials.** Density 7 opens the margins to 27/29/27/27 mm and the Hangul pitch to 180 %: for a guide used
at a bench, where a looser line helps the reader find their place again. Density 10 closes the top
margin to 24 mm for a long reference held to a page count. The type does not shrink. Variance no longer
adds kinds or table styles.

## Worked source

```markdown
::: cover kicker="설치 안내서"
:::

# 개요

이 안내서는 현장 게이트웨이를 처음 설치하는 운영 담당자를 위한 것이다. 작업에는 관리자 계정과 약 40분이 필요하다.

::: sidebar title="용어"
**게이트웨이**: 센서 신호를 모아 서버로 보내는 장치

**펌웨어**: 장치에 들어 있는 제어 프로그램
:::

# 설치 순서

::: callout kind=warning title="전원 차단 후 작업"
배터리를 교체하기 전에 차단기를 내리고 잔류 전압이 0 V인지 확인한다.
:::

1. 차단기를 내린다. 상태 표시등이 꺼진다.
2. 전면 덮개의 나사 4개를 푼다.
3. 배터리를 교체하고 덮개를 닫는다.

표 1. 오류 코드와 조치 (예시)

| 코드 | 증상 | 조치 |
|---|---|---|
| E01 | 서버 연결 실패 | 네트워크 케이블 확인 |
| E07 | 펌웨어 불일치 | 최신 펌웨어로 갱신 |

자료: 제조사 기술 문서 (예시)
```

The sidebar floats beside the overview only if the overview is longer than the box; otherwise it is set
full width under it. The caption prints as `<표 1>`, and `출처:` would be rewritten `자료:`.

## Headings

| Use | Not |
|---|---|
| 게이트웨이 설치 순서 | 게이트웨이를 설치한다 |
| 펌웨어 갱신 전 확인 사항 | 갱신 전에 반드시 확인하세요 |
| Error codes and actions | Fix errors before restarting |

Steps inside a list are imperatives or plain statements; the headings above them stay noun phrases.
`heading.declarative` reads headings, the title and the subtitle, not list items.

## Numbers

Limits, voltages and times sit in tables with their units and a source line. A duration or a count in
the overview is written into its sentence ("약 40분"). Example values carry (예시) or (sample).

## Failure patterns

- Warnings collected in a list at the end, away from the steps they protect.
- Headings typed with their own numbers (`1.1 준비물`), which doubles the decimal numbering.
- Steps written as paragraphs; a reader at a bench needs one action per numbered item.
- A sidebar longer than the text beside it, or a sidebar used for content the reader must follow in
  order; move that content into the steps.
- Reference tables with prose cells; move the explanation to a sentence under the table.
