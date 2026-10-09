# Page composition

A document is judged page by page. A reader who turns to a page that is half empty, or that ends with
a heading whose text is overleaf, or that shows the top of a table and leaves its last two rows for
the next page, reads the document as unfinished, whatever its content. The same reader reads a page
with coloured headings, tinted boxes and a figure tile on every spread as machine-made. This file says
how a page is filled at the density the user asked for, what the converter already does to keep pages
whole and quiet, what the gate measures, and how to fix each failure in the Markdown source. Shrinking
type, squeezing leading or loosening a gate threshold is never the fix.

## Density by default

The user's standing preference is high density: pages carry information to the bottom and there are
no airy layouts unless the user asks for one. Every pack's default density is between 8 and 9 (Report
9, Brief 9, Manual 9, Proposal 8, Memo 9, Journal 9), and body pages aim at a median fill of 0.80
(0.75 in a Proposal, because a proposal may give a page to a figure). The skill may move density by up to 2
from the pack default without asking and writes the move on the direction card; going below 7 needs
the user's word.

Density comes from three things: the measure, the leading and the structure. The measure is an A4 page
with 25 mm side margins, a text block of 160 mm, wide enough for a full line of Korean or English
prose without the eye losing its place. The leading is calibrated on rendered pages (next section).
The structure is sections that carry their own tables and lists, so the page holds evidence rather
than space. Density never comes from type under 10.5 pt, from side margins under 25 mm, or from boxes
packed with text; a page made dense that way is hard to read and looks crowded.

## Leading, calibrated

Line pitch is the distance from one baseline to the next, given as a share of the type size. Hangul
needs more of it than Latin because its syllable blocks fill the whole em square: a Korean body reads
well at a pitch of 175-185 % of the size, a Latin body at 130-140 %.

Word does not take the pitch directly. It takes a "multiple" of the face's single line, and a single
line of Pretendard is not 1.0 em: measured on rendered pages it is 1.55 em in Word and 1.51 em in
LibreOffice. The converter uses the mean of the two, so the Word multiple is the pitch divided by
1.53. A Korean body at 175 % is set at a multiple of about 1.14; an English body at 133 % at about
0.87. A multiple of 1.5 or 1.6 copied from a style guide written for another face gives a pitch near
240 %, and the page turns to stripes of white. Times New Roman (Journal's Latin body) has a single
line of about 1.15 em and is computed the same way. A paragraph that holds a picture is single spaced
so the picture does not float in an oversized line.

| Density | Margins top / bottom / left / right (mm) | Text block width (mm) | Body size | Pitch Korean / English | Word multiple Korean / English |
|---|---|---|---|---|---|
| 1-2 | 30 / 32 / 30 / 30 | 150 | pack + 0.5 pt | 185 % / 140 % | 1.21 / 0.92 |
| 3-4 | 28 / 30 / 28 / 28 | 154 | pack + 0.5 pt at 3, pack at 4 | 185 % / 140 % | 1.21 / 0.92 |
| 5-6 | 27 / 29 / 27 / 27 | 156 | pack | 180 % / 137 % | 1.18 / 0.90 |
| 7 | 26 / 28 / 26 / 26 | 158 | pack | 180 % / 137 % | 1.18 / 0.90 |
| 8 | 26 / 28 / 26 / 26 | 158 | pack | 175 % / 133 % | 1.14 / 0.87 |
| 9 | 25 / 27 / 25 / 25 | 160 | pack | 175 % / 133 % | 1.14 / 0.87 |
| 10 | 24 / 26 / 25 / 25 | 160 | pack | 175 % / 133 % | 1.14 / 0.87 |

The bottom margin is never smaller than the top. Body text never goes under 10.5 pt (Proposal and
Memo set English at 11 pt); table text is 9.5 pt at a 140 % pitch. Paragraphs part by 6 pt of space
(5 pt in English) and never by space and a first-line indent together. Korean body text is justified;
Latin body text is ragged right.

**Hangul line breaks.** Word, with word wrap on and the eastAsia language set to ko-KR (every pack's
styles carry both), breaks Korean lines between words (어절). LibreOffice ignores that setting and
breaks between syllables, so a LibreOffice preview, including the page images `visual_audit.py` and
the `--layout` gate render, shows words split across lines. That is expected and is not a defect in
the document; check line breaks in Word when they matter, and judge fill and pagination from the
preview, which runs slightly shorter than Word.

## What the converter already does

- Every heading keeps with the next paragraph, and a paragraph under a heading that is shorter than
  about two lines keeps with what follows it, so a heading always carries some of its section. Space
  above a heading is about twice the space below it.
- No h1 forces a page break. A new part starts where the last one ended; a page that ends early
  because a part ended is a short page and is fixed in the source (below).
- A table caption (`<표 1>` / `Table 1.`) keeps with its table; an image caption keeps with its image.
  A Korean source may write the caption as `표 1. 제목`; the converter sets it as `<표 1> 제목`, moves a
  unit shared by the numeric headers to a right-aligned `(단위: …)` line above the table, and writes
  `출처:` lines as `자료:`, after any `주:` line.
- A table estimated to fit in nine tenths of the text frame keeps its rows on one page; a longer one
  (header and six or more body rows) may break between rows with its header repeated and three body
  rows on each side.
- Text under a table stands 8 pt clear of its bottom rule; a `주:` or `자료:` line stands 3 pt clear.
- A closing paragraph of up to about four lines keeps the paragraph before it company, so the last
  page never holds one orphaned paragraph.
- A list of up to six items keeps together: every item but the last keeps with the next, and a
  lead-in of a line or two right before it ("다음 단계는 아래와 같다.") keeps with the list. In a
  column body a list of five or six items keeps its lead-in with its first two items and its last two
  items together, and may break once between them: moved whole, it left the column before it a third
  empty.
- The last section of a single-column document, when it has no table or picture and comes to about
  twelve lines or fewer, keeps whole, so its paragraph travels with its list to the last page instead of
  leaving the list and a closing line alone there.
- In a column body (Journal) a `자료:` or `주:` line under a page-wide table spans with the table, so the
  heading after it opens the column section with its first lines; the column body ends with a continuous
  section break, so the last page sets its columns to an even depth instead of one column beside an
  empty one (its last paragraph may break across the two columns).
- A heading whose first paragraph opens a table keeps both with the table (and its caption and units
  line), so the heading and its sentence never wait at a page foot.
- A source of about one page (by the converter's estimate) is set with tight spacing in any
  tonality, as a memo is, so it does not spill a few lines onto a second page.
- A section that opens under a hairline right after a ruled box draws no second rule.
- Table columns: no column narrower than its longest word; a text column that wraps while the others
  hold their longest cell with room to spare takes that room when it is enough to set its longest
  cell on one line. Negative figures in tables take the minus sign (−), Korean tables too. A sentence
  right above a table without a caption keeps 6 pt under itself.
- Under a publisher profile the paragraph after a table stands three quarters of a body line clear,
  a paragraph after a list 6 pt, and a list of up to six items keeps together.
- Callouts keep their paragraphs together; a sidebar's row cannot split.
- Figures are scaled to the container width and at most the pack's share of the frame height
  (0.40-0.45, Proposal 0.60).

The converter does not lay pages out, so these are instructions to the renderer. The rendered pages
are the evidence.

## What the gate measures

`qa_docx.py --layout` renders the document and adds page checks to the structural gate. Each one fails
the gate on a tonality document:

| Check | Rule |
|---|---|
| `fill.page` | no body page has less than 0.35 of its frame height filled (from the top of the frame to the lowest ink), except the last page and a cover page |
| `heading.stranded` | no page ends with a heading line |
| `page.spill` | a two-page document fills its second page to at least 0.4 of the frame, and no document ends on a page filled under an eighth (a paragraph or two) |
| `list.split` | a list of up to six items stands on one page and in one column; in a column body a list of five or six may break once, two items or more on each side |
| `heading.apart` | a heading and its lead sentence stand on the page where the table they open starts |
| `heading.column` | in a column body a heading never ends a column while its first lines open the next one |
| `columns.balance` | in a column body no column stops a quarter of the frame short (under 0.75) beside one that runs to the foot, and the last page sets its columns to about the same depth (the shorter at least half the longer) |
| `notice.dash` | the frontmatter notice joins its label and line with a colon (`예시 데이터: …`), not a spaced dash (structural; FAIL on a tonality run, advice on the plain and publisher paths) |
| `table.split` | a table that fits in one frame is on one page and with its caption, except a long table (header and six or more body rows) that breaks between rows with its header repeated, three or more body rows on each side, where moving it whole would leave the page under 0.75 filled; a key-figure, callout or sidebar box is never split |
| `title.lines` | the title takes at most three lines (the converter balances it and steps the size down) |
| `folio.total` | a "page / total" folio counts the pages the reader has |
| `sidebar.overlap` | a floating sidebar ends before the next heading starts beside it |
| `heading.wrap` | the title, the subtitle and every heading break between words, never inside one (제/안서); the converter sets title lines at word boundaries itself |
| `figure.split` | an image and its caption are on the same page |
| `heading.order` | heading levels never skip downward (h1 to h3 with no h2); the first heading is h1 or h2 |
| `component.variety` | a document of four or more pages built with a tonality uses at least two component kinds (a cover or title-block directive counts) |
| `heading.declarative` | headings, the title and the subtitle are noun-phrase labels, not sentences (structural; runs without `--layout` too) |

The median fill is reported (`fill_median`), not failed. A page found by a check is named
with its number; open that page before changing anything.

### The restraint checks (A4.11)

These read the Word file itself. They fail a tonality document and are advice on the plain and
publisher paths, except `date.iso`, which holds everywhere. Most of them catch something the
converter no longer produces on its own, so a failure usually means a hand-made directive attribute,
an edited template or an old source pattern.

| Check | What it catches | Fix in the Markdown |
|---|---|---|
| `color.accent-kinds` | more than one hue outside the ink, or the accent on more than two element kinds (figures aside) | remove colour from the source: no coloured spans, no HTML colour, no attribute that asks for a colour; the pack's accent is already placed |
| `heading.ink` | a heading set in colour | drop the colour from the heading; levels part by weight and space |
| `heading.ratio` | an h1 more than 1.5 times the body size | remove any size override on headings; the pack ramp (h1 about 1.4×) is the size |
| `table.fill` | a shaded data-table cell, or a component tint darker than L 95 % | remove cell shading and zebra rows; tables are booktabs, three rules and a bold ink header |
| `component.budget` | more than three component kinds, more than one key-figure strip, any pull quote, or key figures on the cover | delete the `::: pullquote`, merge or drop the second `::: keyfigures`, move key figures from `::: cover` into the summary, and cut the kind with the weakest purpose on the direction card |
| `cover.block` | a filled shape over more than 25 % of the cover page | use `variant=typographic` (or `masthead`) and no picture on the cover unless the user supplied one |
| `furniture.chip` | a coloured or shaded notice in a page header | keep the sample-data line in frontmatter `notice:`; it prints once under the title block, and nothing goes in the header by hand |
| `date.iso` | an ISO date (2026-06-30) in the text of a Korean document | write `2026. 6. 30.` or `2026년 6월 30일` in body text, captions and tables; the frontmatter `date:` may stay ISO, the converter rewrites it |
| `tonality.structure` | two tonalities of one source that differ in fewer than three structural features (title block, summary form, numbering, component set, running head, contents) | run `qa_docx.py a.docx --compare b.docx`; if it fails, the alternative is the wrong one to offer, or the source flattens the difference (a Brief summary written as one long paragraph cannot become numbered points) |

## Fixing a short page

A page under 0.35, or a run of pages under the 0.80 median, almost always has one of four causes.
Find which on the rendered page, then fix the source.

1. **A large block jumped to the next page.** A table or figure that did not fit under the text left
   the page short. Move the block earlier, to a point where it starts a page or fits; split a long
   table at a natural group (by region, by quarter) into two captioned tables; or shorten its cells by
   moving explanations into the sentence after it.
2. **A part ended early.** The page holds the end of one part and nothing else because the next part
   opens with a long block. Put the next part's opening sentences first, so text fills the space and
   the block follows.
3. **The content is thin.** A section that says two sentences where the reader needs the basis. Add
   what is missing from the sources: the table that backs a claim, the definitions the method relies
   on, a `자료:` or Source line. Never add filler sentences and never add a box to take up room.
4. **The density is lower than the material.** Raise density one step. This is the last resort.

## Fixing a stranded heading

The converter keeps headings with their next paragraph, so a stranded heading usually follows a
component or a table: the heading is the last line of the page and the block after it moved over.
Put one or two sentences of text between the heading and the block; the claim the heading only names
belongs there anyway.

## Fixing a split table or figure

- Shorten the table: fewer columns (six at most), shorter cells, units in the header.
- Move it so it starts a page, or put the paragraph that reads it before it rather than after.
- For a table that is genuinely longer than a page, split it into two captioned tables at a natural
  group; the gate measures each.
- A figure split from its caption is a figure too tall for the space left: reduce its height in the
  source image's proportions, or place it at a page start.

## Heading order and labels

Number the outline before writing: `#` parts, `##` sections, `###` items, three levels at most. Never
jump from `#` to `###`. Leave at least one paragraph between an h1 and its first h2. Every heading, the
title and the subtitle are noun phrases ("1년 운영 결과", "Cost per order by site"), never declarative
sentences ("1년 동안 목표를 달성했다", "Costs fell at every site"); the claim goes in the first
sentence under the heading. A question is allowed when the section answers it. No glyph markers
(■ ✓ ▶) in headings or list heads, and no zero-padded numerals; the pack numbers the headings.

## Component variety and budget

A document of four pages or more needs two component kinds for `component.variety`, and no document
may use more than three. Both limits are met by planning components from the content: a cover or
title-block directive and a callout for the decision request, or key figures in the summary and the
callout. Each planned component has a one-line purpose on the direction card, the out-of-sequence
content it carries. A component that carries nothing is worse than none; the check counts kinds, a
reader judges content. A short document (a memo, a two-page brief) needs no component at all.

## Numbers on the page

Key figures sit at the h2 size with a label and a basis line, once, in the summary. Numbers in tables
are right-aligned, with units in the header or the `(단위: …)` line and a source line under the
table. The figures in the summary, the strip and the tables agree with each other and are rounded
honestly. No figure is set larger to fill a page.

## Typeface

Pretendard is the default face for every pack and the plain profile, for Latin and Hangul, headings
and body. Journal sets Latin body text in Times New Roman and everything else in Pretendard. The
document declares its faces but does not embed them; the rendering machine needs Pretendard installed,
and a substituted face changes line breaks and therefore page fill.
