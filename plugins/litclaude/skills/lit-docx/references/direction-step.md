# The direction step

A Word document gets its shape decided before its first heading is written. The shape is a
tonality: a pack file in `templates/tonalities/<name>.yaml` that fixes the page, the type ramp, what
stands on page 1, how the summary is set, how headings are numbered, which page components the
document may use and what the running head carries. Six tonalities ship with the skill. The
converter reads the pack as data; nothing in it forks per look. Skipping this step brings back the
old failure: every report, memo and proposal came out as the same plain page.

What sets one tonality apart from another is its structure. Every pack sets body text and every heading in the same
near-black ink and declares at most one accent, which the converter puts on at most two element
kinds (a title rule and a callout rule, for instance). The build never picks a colour, a coloured
cover, a figure tile or a tinted box; those choices are not on the card because they no longer exist.

The step takes a few minutes of reading and needs no conversation. Close the brief, rank the candidates
for the document type, let the source reorder them, write a direction card, then say the choice
and two alternatives in the reply. The skill picks the tonality itself. It never falls back to a
silent default, and under a bare `lit` request it asks nothing at all.

## 1. Close the brief

Write down five facts. When the request does not state one, infer it from the wording and the
source files and put the inference on the card, where the user can correct it later.

- **Document type.** One of the rows in the table below, or "other, nearest to …".
- **Reader.** Who opens the file and what they do with it: a director deciding on a budget, a new
  operator following a procedure at the machine, a committee reading before a meeting.
- **Delivery.** Printed and handed out, read on screen, or sent ahead and read alone. A printed
  briefing tolerates denser pages than a document read once on a laptop, but both stay dense.
- **Language.** Korean, English or mixed. It sets the body size of the pack (`body_pt_ko`,
  `body_pt_en`), the caption convention (`<표 1>` or `Table 1.`) and the callout labels.
- **Length.** Pages the reader will accept. One to two pages points to Memo or Brief whatever the
  topic.

## 2. Start from the document type

Each type lists two or three candidates in order. The first is the choice when no signal moves it.
The dials are the pack defaults from the yaml files (density, variance).

| Document type | Candidates in order | Dials of the first (density, variance) |
|---|---|---|
| Report, results, analysis (보고서, 결과 보고, 분석) | Report, Brief, Manual | 9, 5 |
| Korean itemised briefing for a decision maker, one to three pages (개조식, 현황 보고, 검토 보고) | Brief, Memo, Report | 9, 3 |
| Guide, procedure, operating manual, onboarding (가이드, 매뉴얼, 절차서) | Manual, Report, Brief | 9, 6 |
| Proposal, plan, pitch as a document (제안서, 기획서, 계획서) | Proposal, Report, Brief | 8, 6 |
| Memo, notice, letter, one or two pages (메모, 공지, 안내문) | Memo, Brief, Report | 9, 2 |
| Essay, newsletter, white paper, research summary not bound for a journal | Journal, Report, Proposal | 9, 6 |
| Journal submission, or a publisher named by the user | that publisher profile, no tonality | profile rules |

**A Korean report is institute prose by default.** Report writes the way a central-bank or
think-tank issue note does: full sentences in paragraphs, sections numbered Ⅰ. / 1. / 가., tables
carrying the evidence. Government 개조식 (□ ○ - lines ending in ~함/~임) is not a built-in variant
of any tonality. When the reader wants an itemised briefing, that is Brief; write 개조식 lines
yourself only when the user asks for them in so many words.

**Publisher profiles stay outside this step.** When the user names Elsevier, ACS, IEEE, Nature or
`korean-generic`, or the document is a manuscript for submission, convert with `--publisher` and
no tonality; the converter refuses the two together. The same holds for `--template <file.docx>`:
the user's own Word template is a request for that look. In both cases the card still records the
choice, and the reply mentions that a tonality (name one) is available if the file is not bound
for the journal or the house template.

### The structure each tonality sets (A4.6)

This is what actually changes when the tonality changes. Read the row of the chosen tonality before
outlining, because the outline has to fit it: a Brief summary is written as separate paragraphs
that each open with a lead sentence, a Report needs its decision request in a callout under the
summary, a Memo has no room for any component at all.

| Tonality | Page 1 | Summary form | Numbering | Components allowed (budget) | Running head |
|---|---|---|---|---|---|
| Report | title block: kind label left and date right on one line, title, subtitle, author and organisation, one accent rule, the notice; a short contents list from about five pages | prose; one key-figure strip under its first paragraph | Ⅰ. / 1. / 가. (English 1 / 1.1) | key figures, callout, columns; about one callout per four pages, the decision request first | footer: short title left, folio right |
| Brief | compact title block, then the decision box straight under it | numbered points ① ② ③ ④, each a bold lead sentence then plain text | none; each h1 under a full-width ink hairline | callout (one at most), columns | folio alone at the foot, right |
| Proposal | a typographic cover page: label, title left-aligned in the upper third, one short accent rule, subtitle, lead paragraph; byline, date and notice at its foot | prose; key figures once under the summary | none | key figures, callout (one at most), columns | folio centred at the foot |
| Manual | title over a document-control block (문서 / 작성 부서 / 기관 / 시행일), the notice; a short contents list from about five pages | prose | 1 / 1.1, numbered procedure steps | callout (one warning style for all), sidebar, columns | header: short title; footer: folio right |
| Memo | no cover: a label, the subject as title, To / From / Date / Subject rows between two hairlines, the notice | prose | none | none (a callout reads as a bold lead line) | folio from page 2 |
| Journal | masthead with authors, affiliations, abstract and keywords, then two columns | prose | 1 / 1.1, so "Section 2.4" resolves | callout | header: short title and folio |

Two tonalities rendered from the same source differ in at least three of these features. The
direction strip in section 7 shows that difference, and the gate proves it with
`qa_docx.py a.docx --compare b.docx` (check `tonality.structure`).

The running head carries the short title and the folio, never the section name: a field that
repeats the section showed the first section that starts on a page, not the one the page opens
in, so no pack uses it.

## 3. Let the source reorder the candidates

Draft the outline first: headings, which sections carry a table, a warning, a list of steps, key
figures. Then count on the outline. A signal moves a candidate within the set; it never brings in a
tonality from outside the row. Apply the signals in this order, and keep the table order on a tie,
so the same source always gives the same choice.

| Signal | When it fires | Effect |
|---|---|---|
| The user names a tonality, or picked one earlier in the conversation | always | use it; still write the card |
| Tables make up 30 % or more of the body blocks, or there are four or more tables | counted on the outline | Report or Manual to the front |
| Three or more images | counted | Proposal or Journal to the front |
| Under about 900 words, or the brief says one or two pages | counted or stated | Memo or Brief to the front |
| English long-form prose with few tables (at most one per three pages) | counted | Journal to the front |
| Numbered procedures, or three or more warnings or cautions | counted | Manual to the front |
| The document asks the reader for a decision (승인 요청, 결정 사항) | stated in the source | Brief or Proposal up one place; plan a `key` callout for the request |
| A pack does not allow a component the outline needs (only Manual has a sidebar; Brief and Memo have no key figures; Memo has no components; Journal has callouts only) | any section | move that pack down, or write that content as ordinary text and say so on the card |

A worked case. The request is a six-page Korean review of a warehouse automation pilot, with five
tables and a decision at the end. The type row gives Report, Brief, Manual. Five tables fire the
table signal, which keeps Report first. The decision request moves Brief up one place, but it is
already second. Report stays; Brief and Manual are the alternatives, and the card says Brief would
fit better if the director reads only the first page.

## 4. Write the direction card

The card is the record of the decision. Keep it in the build log and summarise it in the reply.
Fill every field; a build that cannot name the tonality and the reason stops there.

Each planned component gets its own line with a one-line purpose: what out-of-sequence content it
carries, the thing a reader needs that does not belong in the running text at that point. A
decision request the director must find without reading, a warning the operator must see before
the step, the three numbers the summary rests on. A component without a purpose is left out of the
card and out of the source. "Breaks up the page" or "adds visual interest" is not a purpose.

```text
Direction card
  Document type     report (결과 보고), 6 pages expected
  Reader            logistics director and two plant managers, printed for the monthly review
  Tonality          report   alternatives: brief, manual
  Reason            5 tables in 14 body blocks (36 %); one decision request at the end
  Signals fired     table share, decision request
  Dials             density 9, variance 5 (pack defaults)
  Page 1            report title block (kind label, date, title, subtitle, byline, one rule, notice once)
  Headings          Ⅰ. / 1. / 가., ink, weight and space only; every heading a noun phrase
  Components        keyfigures (summary)   the three results the summary rests on, each with its basis
                    callout key            the 2.1억 원 approval request, findable without reading
  Left out          sidebar of terms (Report has none; the definitions go in the method paragraph)
  Fonts             Pretendard (pack default)
  Wrong if          the director reads only page one; Brief's conclusion-first points fit that better
```

The "wrong if" line is checked first in review. If it turns out true, the direction was mis-chosen
and the document is rebuilt under the alternative it names, with the card updated.

**Component budget.** The card stays inside these limits whatever the pack allows; the converter
enforces the same limits and the gate's `component.budget` check fails a document past them.

- At most three component kinds in one document, beyond headings, paragraphs, lists, tables and
  figures. A cover or title block is not counted.
- One key-figure strip at most, in the summary (under its first paragraph or right after it), three
  or four comparable metrics, each with a label and a basis line. Never on a cover: figures written
  inside `::: cover` are moved into the summary, or kept in the summary text by a pack without key
  figures.
- Callouts about one per four pages, and only for out-of-sequence content: a decision request, a
  warning, a definition. The converter boxes the decision request first, then warnings, then notes,
  and writes the rest as text. Brief and Proposal box one callout at most.
- Pull quotes are off in every tonality. A pull quote repeats a sentence the reader has just read;
  the converter leaves it out with a note.
- A sidebar only in a Manual, beside enough text to float, or full width.
- `::: columns` only when the parts are within about 20 % of each other in length; unequal parts
  are read in sequence.

**The notice.** The frontmatter `notice:` (the sample-data or confidentiality line) is printed once,
in small muted text under the title block, or at the foot of a Proposal cover. It never goes in a
page header and never becomes a coloured chip; do not repeat it in the body.

**Dials.** Density (1-10) sets the margins (sides never under 25 mm), the leading and the page fill
the document aims for; variance (1-10) sets how many component kinds and table styles one document
may mix, inside the budget above. The skill may move either dial by up to 2 from the pack default
without asking and says so on the card. A larger move needs the user's word. Dials go in the
frontmatter (`density:`, `variance:`) or on the command line (`--density`, `--variance`).

## 5. Four rules every card carries

These come from the user and bind every tonality. The card names them so the build cannot drift.

1. **Headings, the title and the subtitle are noun-phrase labels.** "1년 운영 결과", "Commissioning
   checklist", never "1년 동안 목표를 달성했다" or "Costs fell by a third". The claim goes in the first
   sentence under the heading. The gate's `heading.declarative` check fails a heading, title or
   subtitle that reads as a sentence; reword the label, never the gate.
2. **No exaggerated numbers.** Every figure traces to a source and is rounded honestly; the
   numbers in the summary, the key figures and the tables agree with each other. A key figure is
   set no larger than the pack's h2 size and carries a label and a basis line (the period and the
   source) written as an indented list item under it. Invented figures carry (예시) or (sample).
3. **Pretendard by default.** Every pack declares Pretendard for Latin and Hangul in the document
   defaults, the styles, the theme and the bullet glyphs. Journal keeps Times New Roman for Latin
   body text only. Another face appears only when the user asks for it or the template brings it.
4. **Dense by default.** Body pages carry information to the bottom (no body page under 0.35 of the
   frame, a median near 0.80). The density comes from the measure, the leading and the structure:
   a 160 mm text block, calibrated line pitch, sections that carry their tables. It never comes
   from type under 10.5 pt, narrow margins or boxes crammed with text. An airy page is built only
   when the user asks for one.

## 6. Say it and record it

In the reply, with the delivered files, say in plain words which tonality was chosen, why, and the
two alternatives. For example: "Report 방향으로 만들었습니다. 표가 본문의 3분의 1이 넘고 마지막에
승인 요청이 있어서입니다. 첫 장만 읽힐 문서라면 Brief, 절차 안내가 중심이면 Manual도 맞습니다."
One sentence each for choice, reason and alternatives; no design lecture.

Under a bare `lit` request the same sentence goes in the reply and nothing is asked before the
build. Under an explicit request the skill still decides; it asks only when the brief leaves the
look open on purpose (then it builds the strip below) or a dial must move by more than 2.

Write the build log beside the source. It holds the card, the converter's stdout notes (a directive
the pack does not use kept as text, a callout past the budget written as text, a pull quote left
out, columns read in sequence because the parts were unequal), and the gate result. It is working
evidence and never part of the document.

```text
<name>.md          the source, with tonality: (and any dials) in its frontmatter
<name>.build.md    the direction card, converter notes, qa_docx result, pages looked at
<name>.docx        the converted document
```

## 7. The direction strip

When the user asks to compare looks, or the brief says the look is open ("어떤 느낌이 좋을지
모르겠다", "show me a few options"), convert the same source under the chosen tonality and the two
alternatives, render the first three pages of each, and show three labelled rows before writing
the rest. The text stays the same in every row; only `tonality:` changes. The user's pick replaces
the reason on the card ("chosen by the user from the strip").

```bash
for t in Report Brief Manual; do
  sed "s/^tonality: .*/tonality: $t/" strip.md > "strip-$t.md"
  python3 "$SKILL_ROOT/scripts/convert_md_to_docx.py" "strip-$t.md" "strip-$t.docx"
  python3 "$SKILL_ROOT/scripts/visual_audit.py" "strip-$t.docx" --out-dir "strip-$t" --pages 3
done
python3 "$SKILL_ROOT/scripts/qa_docx.py" strip-Report.docx --source strip-Report.md --compare strip-Brief.docx
```

The rows should differ in what stands on page 1, how the summary reads, how headings are numbered
and what runs at the foot. If two rows look alike apart from a rule colour, the `--compare` run
fails `tonality.structure` and the strip is not worth showing. A component one pack does not allow
is kept as text in that row (the converter says so); that is expected and part of what the strip
shows.

## 8. Failure patterns

- Choosing by topic alone ("a factory, so Manual") without counting the outline.
- No tonality and no publisher on a document that is not a manuscript: the plain profile used as a
  silent default.
- A reply that names one direction with no alternatives, or none at all.
- A reason that restates the document type instead of the signals that fired.
- Asking a style question under a bare `lit` request.
- Moving a dial by three or more without the user's word.
- Headings written as conclusions, or a key figure without a basis line, because an older habit
  said headings should state findings.
- A component on the card with no purpose, or a callout holding text that belongs in the running
  paragraph; a pull quote; a sidebar outside a Manual; key figures on the cover or a second strip.
- Choosing a tonality for its colour, or asking for a coloured cover, a band or figure tiles.
- Writing a Korean report in 개조식 lines because it is Korean; that is Brief's form or the user's
  explicit request.
- The notice repeated in the body or in a header.
- A tonality and `--publisher` together, or a tonality forced onto a journal manuscript.
- Swapping the tonality after the build without updating the card and the reply.

## 9. The example library

Each file in `examples/` converts under the tonality in its frontmatter and passes `qa_docx.py
--layout`. Read the one closest to the job before writing a new source; copy its structure and write
your own text. Each one stays inside the component budget, uses only components its pack draws, keeps its
numbers consistent across summary, figures and tables, and writes Korean dates as `2026. 6. 30.`
in the body.

| File | Document type | Tonality | Alternatives |
|---|---|---|---|
| `examples/01-report-ko.md` | results report with tables | Report | Brief, Manual |
| `examples/02-brief-ko.md` | itemised briefing with a decision | Brief | Memo, Report |
| `examples/03-manual-ko.md` | operating procedure | Manual | Report, Brief |
| `examples/04-proposal-ko.md` | project proposal | Proposal | Report, Brief |
| `examples/05-memo-en.md` | internal notice | Memo | Brief, Report |
| `examples/06-journal-en.md` | white paper in two columns | Journal | Report, Proposal |
| `examples/07-report-en.md` | quarterly operations report | Report | Brief, Manual |
| `examples/08-proposal-en.md` | funding proposal | Proposal | Report, Brief |
| `examples/09-memo-ko.md` | 안내문 (one-page notice) | Memo | Brief, Report |

All figures in the examples are invented and labelled as examples; the organisations are
placeholders. None of them places an image, so they convert without asset files.
