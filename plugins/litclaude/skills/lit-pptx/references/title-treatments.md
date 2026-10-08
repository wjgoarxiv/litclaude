# Title treatments

A title treatment decides where a slide's title sits, how large it is, what colour it takes and what
comes with it (a rule, a band, a rail, a numeral, a panel). The engine knows eight. Each one has a
fixed frame, so every slide that uses a treatment puts its title in exactly the same place; the deck
gets its variety from using three to five treatments for different slide jobs. A reader learns a
handful of positions as quickly as one, provided each position always means the same kind of slide.

Two rules hold for all eight. The title is a topic label, never a sentence: a noun phrase that names
the subject, the measure and, where it matters, the period ("분기별 방문·대출 추이", "Loans per visit by
branch, 2026"), with the claim in the body as the first takeaway. It never gets an eyebrow or kicker
word above it. A numeral beside a title is a real part number, step or figure at title size at most,
never decoration. The gate fails a declarative title or cover subtitle (OF-114): a Korean title that
ends in -다, -니다, -요 or a nominalised claim (-음, -함, -됨), an English title with a finite verb or
a final period.

## How a slide gets its treatment

The pack maps each slide role to a default treatment (`role-defaults` in the pack, listed in every
tonality sheet). Roles come from the family: text families are `content`, tables and KPI rows are
`data`, charts and big numbers are `data-takeaway`, processes and timelines are `sequence`, picture
families are `image`, statements and quotes are `statement`, methods are `definition`, references
are `reference`. A pack may also name a family's own title under `structure` (Paper draws a comparison
under `top-rule`, Chalk on its board rail under `side-rail`): that title comes before the role default
and is kept even when the deck already leans on it, so two tonalities of one source differ in
structure, not only in colour. When the role default is a bottom title the slide may not take (a
table), the pack's next treatment in order stands in for it.

The engine then lays the slide out under every treatment the family and the pack both allow. It
keeps the role default when the body fills to the density band; otherwise it takes the treatment
that leaves the smallest empty band, with a cost for repeating the previous slide's treatment and a
cap so that no fill-chosen treatment covers more than about a third of the deck. The variance dial
caps how many distinct treatments one deck mixes. The compile log names every slide whose
treatment moved away from the role default.

To pin one slide, put a `title:` key on the line after `layout:`. It must name a treatment the pack
and the family both allow, or the compile stops with the allowed list:

```markdown
---
layout: chart-insight
title: bottom-anchor

## 피크 시간대 처리량은 오후 3시에 가장 낮다
…
---
```

Covers, sections and closings take their own variant's title and refuse a `title:` key.

## The eight

Geometry is for the standard 16:9 grid (48 pt margins, 74 pt column pitch); the dense and airy grids
keep the same columns and y values. Glyph budgets are for Korean at the presented ramp; Latin text
takes about twice as many characters.

| Treatment | Where the title sits | Comes with | Body | Fits | Budget |
|---|---|---|---|---|---|
| `top-rule` | columns 1-12 at the top (y 36), title size | a short accent rule or a full hairline 6 pt under it | y 120-486 under it | content and data pages that are read | one line, about 27 glyphs |
| `top-plain-large` | columns 1-10 at the top, display size | nothing | starts 24 pt under the title | comparison, image-split, pages that open on one claim | two lines of about 16 glyphs |
| `side-rail` | columns 1-4 down the left, title size | an optional tinted rail or a hairline at column 4 | columns 5-12, top-aligned with the title; the rail under the title holds criteria labels, takeaways and the source | a chart or picture with its takeaways, a comparison with labelled criteria | four lines of about 8 glyphs |
| `band` | inside a full-width band 108 pt tall | the band in the field colour, the title on it | y 132-486 | Korean briefing pages, data pages on a dark deck | one line, about 25 glyphs |
| `statement` | columns 1-10, centred between y 120 and 486, display size | an optional support line under it | none: the text is the content | a pull quote, or a display-led deck the user asked for | three lines of about 16 glyphs |
| `overlay` | a dark panel at the lower left over a full-bleed picture | the panel at 88 % opacity, a caption on it | none: the picture is the content | full-picture slides | two lines of about 15 glyphs |
| `kicker-numeral` | columns 3-12 at the top, with a large numeral in columns 1-2 | the numeral in the accent colour (the part number; never an agenda's row count) | y 132-486 | steps, numbered recommendations | one line, about 23 glyphs |
| `bottom-anchor` | columns 1-9, the title frame's bottom edge on the body floor (y 486), so no band is left under it | an optional hairline 12 pt above the title | y 36 to 24 pt above the title for the visual | chart-led, figure-led and big-picture slides | two lines of about 20 glyphs |

Over budget, the engine moves the slide to another allowed treatment and says so in a `note:` line;
a `title:` key that asks for an over-budget treatment stops the compile, because a pinned choice
that cannot hold the title is an authoring error. Shorten the title or pick another treatment.

## Choosing well

- **Data with a takeaway** reads best under `side-rail` or `bottom-anchor`: the title sits beside or
  under the chart and explains it, and the chart gets the full height.
- **A claim** is not a title. It opens the body under a label: a boxed summary over its reasons, a
  data panel of the figures behind it, or the first takeaway beside a table or chart. `statement`
  stays for pull quotes and decks the user asks to be display-led; a lone sentence on a page holds
  too little.
- **A sequence** wants `kicker-numeral` when the number is real: the step, the part, the
  recommendation. A numeral on a list that has no order is a defect.
- **Korean briefing pages** use `band`: the strong repeated head tells a desk reader where each page
  starts, and the body under it can be dense.
- **Pictures** use `overlay` only on a full-bleed image, and `bottom-anchor` when a large picture
  sits above its title.

Keep within one treatment's frame. Never move a title by hand with a free box: the frame is the
treatment, and a nudged title is a second, broken treatment.

## How the gate reads it

`qa_deck.py` classifies every title from the compiled file by geometry and companions, in this order:
overlay, band, statement, bottom-anchor, side-rail, kicker-numeral, top-plain-large, top-rule. The
engine also writes the intended treatment into the title shape's name, and the gate compares the
two; the written name alone is never taken as evidence.

- **OF-110** fails on a deck of eight or more slides when fewer than three treatments are used
  (cover and section titles not counted) or more than the variance dial allows. On a deck of any
  length it fails when a title fits none of the eight, or when a title is drawn as a different
  treatment than its name says.
- **OF-113** fails when two slides with the same treatment place their title frames more than 1 pt
  apart (a statement only compares x and width, because it is centred on its own line count; a bottom
  title compares x, width and its bottom edge, because it stands on the floor).
- **OF-115** fails a bottom title that ends more than 12 pt above the body floor and a side rail more
  than 40 % empty under its title. Text in the rail under the title is the rail's: it neither changes
  the side-rail reading nor counts as a body column.

On a legacy template the variety checks report as advisories, because the user asked for that
template's single title position.
