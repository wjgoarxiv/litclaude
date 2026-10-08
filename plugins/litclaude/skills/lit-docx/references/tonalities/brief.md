# Brief

Brief is the briefing written for a person who has to decide something today: one to three pages,
conclusion first. The reader takes in the decision request under the title, reads three or four
numbered points that each open with a bold sentence, checks one table, and stops. Everything on the
page serves that single pass. The look is plain: near-black headings that part from the text by
weight and by a full-width ink hairline above each section, one deep green rule under the title block,
one request between two green rules, and the folio alone at the foot. Nothing is
shaded, numbered for show or repeated in a header.

## When to use it

Choose Brief for 현황 보고, 검토 보고, 결과 보고 for an executive, a decision request with options, a
one-page incident summary, a pre-meeting note, or any document under about three pages whose reader
decides rather than studies. It is the first candidate for the itemised briefing type and the second
for reports and proposals. It moves up when the source is under about 900 words, when the brief says
"한두 장", or when the request names a decision maker and a date. It is also the right home for a
Korean 개조식 briefing: write the lines yourself under the unnumbered sections when the user asks for
that form.

## When it is the wrong choice

- More than three pages, or sections that need running paragraphs to argue a point: use Report.
- A notice or a letter addressed to many people: Memo's To / From / Date / Subject block is the right
  shape.
- A proposal asking for approval of money and a schedule: Proposal carries the cover, the budget table
  and the decision box.
- A procedure: Manual.

## Structure

Brief differs from Report in its title block, its summary form, its numbering, its running head and
its absence of contents, which keeps any two renders of one source clearly apart
(`qa_docx.py a.docx --compare b.docx`, check `tonality.structure`).

- **Page 1: a compact title block, then the decision.** The label and date line, the title, the
  subtitle, the byline, one green rule and the notice once in small muted text. Directly under it
  stands the decision request: the first `::: callout kind=key` in the source is moved there wherever
  it was written. `variant=` on a cover is accepted and ignored; Brief has no cover page.
- **Summary form: numbered points.** The paragraphs of the first section become points ① ② ③ ④. The
  first sentence of each paragraph is set bold as its lead, the rest stays plain. Write the summary as
  three or four short paragraphs, each opening with a complete sentence that carries the point (the
  situation, the number that matters, the option recommended, what is asked). A fifth paragraph stays
  unnumbered.
- **Numbering.** Sections are unnumbered. Each h1 opens under a full-width ink hairline, which is how
  a reader finds the next part without numerals.
- **Components and their purpose.** Two kinds are allowed: `callout` (one box at most, the decision
  request, because that is the one thing the reader must not miss) and `columns` (two options of
  nearly equal length set side by side for comparison). Brief has no key-figure strip; the numbers live
  in the points and in the one table. Key figures written in a cover stay out, with a note on stdout,
  so state those numbers in the summary text as well.
- **Tables.** One small booktabs table per part at most, `<표 n>` above, `(단위: …)` when the numeric
  columns share a unit, `주:` then `자료:` below.
- **Running head.** The folio alone at the foot, right, from page 2. No header, no short title.
- **Contents.** None; a briefing is too short to need one.

## Tokens

Values at the pack default (density 9, variance 3), from `templates/tonalities/brief.yaml`.

| Token | Value |
|---|---|
| Paper, margins | A4; top 25, bottom 27, left 25, right 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt; Korean justified, English ragged right |
| Line pitch | Hangul 175 % (Word multiple 1.14), Latin 133 % (0.87) |
| Paragraph spacing | 6 pt after (5 pt English), no indent |
| Scale | h1 13.5 pt (1.3x), h2 12 pt (1.15x), h3 10.5 pt bold; title 26.5 pt (2.5x) |
| h1 | unnumbered, under a full-width 0.5 pt ink hairline; 22 pt above, 9 pt below |
| Ink | body and headings `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | green `2D5A47`, on the title rule and the callout rule only |
| Tables | booktabs, 9.5 pt, header bold, numbers right-aligned |
| Running head | folio only, footer right, 8.5 pt muted |
| Components | callout (one at most), columns |
| Figures | at most 0.40 of the frame height |
| Fill | no body page under 0.35 except the last; median target 0.80 |

**Dials.** Density 9 is the pack's working point. Density 10 closes the top margin to 24 mm, which buys
a few lines for a brief that spills onto an extra page; cutting a sentence is usually better. Density 7
opens the margins to 27/29/27/27 mm with a 180 % Hangul pitch, for a brief that will be printed and
annotated. Variance changes nothing visible: the one-box limit holds at every setting.

## Worked source

```markdown
::: cover kicker="검토 보고"
:::

# 요약

3분기 민원 처리 기간이 평균 4.2일로 목표 3일을 넘었다. 접수 창구가 둘로 나뉜 뒤 이관 대기가 길어진 것이 주된 원인이다.

담당 인력 2명이 결원 상태다. 9월 이후 1인당 처리 건수가 18% 늘었다(예시).

온라인 접수 일원화와 임시 인력 2명 배치를 함께 추진하는 안이 가장 빠르다. 두 조치를 합치면 처리 기간을 3일 안으로 줄일 수 있다고 본다.

::: callout kind=key title="결정 요청"
온라인 접수 일원화와 임시 인력 2명 배치를 10월 운영 회의에서 승인해 주시기 바랍니다.
:::

# 처리 현황

표 1. 분기별 민원 처리 현황 (예시)

| 구분 | 2분기 | 3분기 |
|---|---|---|
| 접수 건수 | 1,020 | 1,180 |
| 평균 처리 기간 (일) | 3.1 | 4.2 |

자료: 민원 관리 시스템 (예시)
```

The callout moves above `# 요약` in the output, and the three summary paragraphs become ① ② ③ with
their first sentences bold. The frontmatter date prints in the label line in the Korean form
(`2026. 10. 2.`).

## Headings

| Use | Not |
|---|---|
| 민원 처리 지연 현황 | 민원 처리가 지연되고 있음 |
| 온라인 접수 일원화 방안 | 온라인 접수를 일원화해야 한다 |
| 건의 사항 | 다음과 같이 건의드립니다 |

Body lines may end in `-음/-함` when the user wants 개조식; headings, the title and the subtitle may not
end that way. `heading.declarative` reads every heading, the title and the subtitle.

## Numbers

A number sits inside its sentence with its unit and period. Estimates say (추정) or (예시); a figure a
reader cannot trace to a source does not go into a briefing. Korean bullets print as a plain dash, and
a list of one item becomes a plain paragraph.

## Failure patterns

- The decision request written at the end and not as a callout: write it as `kind=key` and the engine
  lifts it to the top.
- Summary paragraphs that open with a fragment ("배경:") instead of a sentence, so the bold lead reads
  as a label.
- A second callout: only the first by priority (decision request, then warning, then note) is boxed;
  the others print as text under a bold lead line.
- Glyph markers (filled squares, check marks, arrows) typed into headings or list heads.
- A table split over two pages in a two-page brief (`table.split`); shorten the cells or move the
  table up.
