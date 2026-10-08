# Memo

Memo is the short document: an internal memo, a notice, a decision request, a letter of one or two
pages. It has no cover and no components. Page 1 opens with a small label, the subject as the title,
and To / From / Date / Subject rows between two hairlines; the body follows at once. The pack has no
accent colour at all: everything is near-black ink, with muted grey only for the label, the notice and
the folio. The memo should look like something a person wrote and sent, and its authority comes from
the clarity of the first two sentences.

## When to use it

Choose Memo for 메모, 공지, 안내문, 협조 요청, a short decision request, a meeting follow-up, a cover letter
for another document, or any English or Korean text under about 900 words. It is the first candidate
for the memo type and the second for the itemised briefing. It moves up when the brief says one or two
pages, when the source names recipients, or when the content is a single request or a single piece of
news.

## When it is the wrong choice

- More than about two pages: without parts and a title block the text becomes a wall; use Report or
  Brief.
- A briefing for an executive who reads numbered points and a boxed request: Brief.
- A document with several tables or figures that need captions and a summary strip: Report.
- A proposal asking for money: Proposal carries the cover, budget and schedule.

## Structure

Memo has the fewest structural features of any pack, and that is its signature: a memo block instead
of a title block, no components, no numbering, no contents and no running head on page 1. Rendered
from the same source, any other tonality differs from it in at least three of those features
(`qa_docx.py a.docx --compare b.docx`, check `tonality.structure`).

- **Page 1: the memo block.** A small bold label in muted ink (the `kicker=` of `::: cover`, or 메모 /
  Memo by default), the subject as the title at about 1.8 times the body, then the recipient rows
  between two ink hairlines. Write those rows inside `::: cover` as lines of `Key: value` pairs
  separated by ` · `. Recognised keys: `To`, `From`, `Date`, `Subject`, `Cc`, `받는 사람`, `보내는 사람`,
  `날짜`, `제목`, `참조`. When no date row is written, the frontmatter date is inserted after the sender
  in the Korean form `2026. 6. 30.`. English values start with a capital. Other lines in the block
  render as an opening paragraph under the rows. The frontmatter `notice:` prints once under the block
  in small muted text. `variant=` on the cover is accepted and ignored.
- **Summary form.** No summary section: the opening paragraph is the summary. State the request or the
  news and its date in the first two sentences.
- **Numbering.** None. Short memos often need no headings at all; two to four parts under plain
  headings (`# 배경`, `# 요청 사항`, `# 일정`) are the most a memo carries.
- **Components.** None. A `::: callout` keeps its content as text, its title as a bold lead line with a
  heading's space above it (12 pt), and stdout says so; that bold line is the memo's natural way to mark the request. Key figures become a
  plain list with the basis in brackets. Do not plan components on the direction card; the purpose
  line for each is "none".
- **Tables.** One booktabs table at most, `<표 1>` above, `주:` and `자료:` under it.
- **Running head.** The folio alone at the foot, right, from page 2. Nothing in the header.
- **Contents.** None.

## Tokens

Values at the pack default (density 9, variance 2), from `templates/tonalities/memo.yaml`. The pack has
no accent: the palette is ink, muted ink and a grey rule only.

| Token | Value |
|---|---|
| Paper, margins | A4; top 25, bottom 27, left 25, right 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt Korean / 11 pt English; Korean justified, English ragged right |
| Line pitch | tight spacing: Hangul 165 % (Word multiple 1.08), Latin 120 % (0.78), the low ends of A4.3 |
| Paragraph spacing | 5 pt after (4 pt English), no indent; a paragraph after a list stands 6 pt clear of it |
| Heading space | h1 12 pt above, 5 below; h2 10 / 4; h3 9 / 3 (other packs 22 / 9, 15 / 6, 11 / 4) |
| Scale (Korean) | h1 12.5 pt (1.2x), h2 11.5 pt (1.1x), h3 10.5 pt bold; subject title 19 pt (1.8x) |
| Scale (English) | h1 13, h2 12, h3 11 pt bold; subject title 20 pt |
| Ink | body and headings `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | no accent |
| Memo block | 9.5 pt Korean / 10 pt English, labels bold, between two 0.5 pt ink hairlines |
| Tables | booktabs, 9.5 / 10 pt, header bold, numbers right-aligned; cells 2 pt above and below |
| Running head | folio from page 2, footer right, muted |
| Components | none |
| Figures | at most 0.40 of the frame height |
| Fill | no page under 0.35 except the last; median target 0.80; a memo never spills onto a second page it fills under a quarter of the frame (`memo.fit`) |

A memo stays on one page when its content allows: the pack's `spacing: tight` sets the tokens above,
and the page check `memo.fit` (qa_docx.py --layout) fails a memo that spills less than a quarter of a
page onto page 2; a longer second page is a two-page memo, which the pack allows. When it still spills, cut the lines that spill before reaching for the dials.

**Dials.** Density 7 opens the margins to 27/29/27/27 mm, for a letter that is printed and signed. Density 10 closes the top margin to 24 mm, which may pull a memo that spills three
lines onto page 3 back to two; cutting a sentence first is usually better. Variance changes nothing:
the pack never gains a cover or a component.

## Worked source

```markdown
---
title: 회의실 예약 방식 변경 안내
date: 2026-10-06
tonality: memo
---

::: cover kicker="공지"
받는 사람: 각 팀장 · 보내는 사람: 총무팀
참조: 경영지원실장
:::

11월 1일부터 회의실은 사내 예약 시스템으로만 예약할 수 있습니다. 팀별 고정 예약 시간은 10월 17일(금)까지 알려 주시기 바랍니다.

# 변경 내용

종이 예약 대장은 10월 31일에 폐지합니다. 시스템 예약은 2주 앞까지 가능하며, 고정 예약은 팀당 주 2회로 제한합니다.

# 문의

총무팀 내선 1234
```

The frontmatter date appears as a `날짜` row reading `2026. 10. 6.` right after the sender. No ISO date
is left in the Korean text; the gate check `date.iso` fails one.

## Headings

| Use | Not |
|---|---|
| 회의실 예약 방식 변경 안내 | 회의실 예약 방식이 바뀝니다 |
| 요청 사항과 기한 | 17일까지 회신해 주세요 |
| Room booking change | We are changing room booking |

Write the subject row the same way as the title. `heading.declarative` reads headings, the title and
the subtitle; the memo rows are not read by the gate, so the subject row depends on the writer.

## Numbers

A memo rarely needs a key figure. A deadline, an amount or a count goes into its sentence with its unit
and date; example values carry (예시) or (sample).

## Failure patterns

- A memo written with a cover page or a decorative cover variant: Memo has none and sets the memo block
  regardless.
- Recipient lines written as running text ("To all team leads from …"); use `Key: value` pairs so they
  become rows.
- A callout or key-figure strip planned on the direction card: neither is drawn.
- Headings at every second paragraph; a memo under a page often needs none.
- A second page holding three lines: tighten the prose before raising density; the last page is exempt
  from `fill.page`, so this is the reader's problem, not the gate's.
