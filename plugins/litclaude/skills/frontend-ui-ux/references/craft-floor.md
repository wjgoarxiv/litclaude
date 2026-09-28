# Craft floor, responsive matrix and the probe loop

This reference and `references/slop-register.md` load whenever `frontend-ui-ux` activates, in
every mode. They are the numbered rule catalogue the interface probe measures and the review
table cites. Rule ids (`CF-*`, `RS-*`, `SLOP-*`) are stable family ids; cite the id, not a
paraphrase of the number. Thresholds live once, as data, in `scripts/interface-probe-rules.mjs`;
the tables below restate them for reading, and the rule table wins if the two ever differ.

## 1. Run the probe

Run the probe from the exact installed skill directory against the page you built or were asked
to review. It accepts an HTML file, a project directory (it prefers `dist/`, `build/` or `out/`
over an unbuilt source page) or an `http(s)` URL:

```bash
FRONTEND_UIUX_SKILL_ROOT="<directory containing the selected installed SKILL.md>"
node "$FRONTEND_UIUX_SKILL_ROOT/scripts/interface-probe.mjs" "<page.html | project dir | URL>" --out "<evidence dir>"
```

What it does, in order:

1. Asks the `browser-drive` capability probe for a verified `agent-browser`. It never installs,
   downloads or updates a browser. A missing, unidentified or uncleaned driver is a `BLOCKED`
   run, not a pass.
2. Serves a local page from `127.0.0.1` on a free port (never `file://`), then opens it once per
   matrix row: 320, 390, 768 and 1440 px in light mode; 390 px dark; 390 px with reduced motion;
   and 1440 px at 200 % zoom, emulated as a 720 × 450 CSS px viewport at double scale
   (`zoom_emulation: viewport-halved`, which reproduces reflow but not zoomed text rasterising).
3. Waits 1200 ms, checks that the page finished loading (one extra wait, then the viewport is
   recorded as not settled), runs the in-page measurement module, and saves one screenshot per
   row under `<evidence dir>/screenshots/`. At 1440 px it then hovers up to five repeated list
   controls for real (CF-506). It never clicks, presses or submits anything; `alert`, `confirm`
   and `prompt` are stubbed before the first read, and content behind closed disclosures is
   counted under Not verified instead of being opened.
4. Writes `<evidence dir>/findings.json` (`{ manifest, findings }`, each finding naming exactly
   one rule id) and prints the review table below.

Exit codes are the contract: **0** all seven matrix rows ran and no measured or derived HIGH
finding remains; **1** at least one measured or derived HIGH finding remains (this wins over a
missing row); **2** `BLOCKED: <reason>` on one line (`browser unavailable`, `browser identity
unverified`, `browser cleanup failed`, `no entry page found`, `matrix incomplete (<rows>)`). A
`not_verified` finding never sets exit 1. A blocked run still reads the source files for the
rules a file can show on its own (a literal match keeps its own tier, with `viewport: static` and
a `file:line`), and lists every rendered rule under "Not verified". Say `BLOCKED` in the reply;
never describe it as a pass.

Rules marked *judgment* below are DET-assist: a hit is printed under "Judgment calls" as a
candidate, never as a finding, and its severity applies only after you confirm it with a stated
reason (tag it Inferred).

Budget: at most 20 s per viewport and 180 s per run; 12 findings per rule per viewport; 3,000
elements and 4,000 characters of copy sampled; five controls per viewport for the focus, press
and hover samples. A viewport the budget skips is not verified.

## 2. The loop

Every mode that edits runs the same loop:

```
build (or baseline) -> probe -> fix -> probe -> fix -> probe -> fix -> final probe
                      \__________ at most three fix rounds __________/
```

- **Fix in the cheaper order.** Delete the offending element or rule first; then use a platform
  feature instead of custom code; then reuse a token or component the project already has; then
  correct the value in place; add new code last.
- **Re-run the whole probe** after each round, not only the rules you touched. A fix that clears
  one HIGH and adds another is caught by the same battery.
- **HIGH blocks "done".** Fix every HIGH first, then MEDIUM. A HIGH still present after three
  rounds may only ship as a limitation stated once in the reply, with its reason (for example
  "hero heading over a photograph, CF-204 not verified, no safe repaint"). MEDIUM and LOW never
  block by themselves.
- **Thresholds do not move.** Never edit a number, add an exception or change a fixture to make a
  page pass; fix the page or state the limitation. A reviewer's or judge's wording never drives a
  fix round.
- **Tier every claim.** *Measured* means read straight off the render (a computed style, a
  bounding box, a scroll width). *Derived* means computed from measured values (a WCAG ratio from
  two sampled colours) or read through a named approximation (a stylesheet `:active` rule instead
  of a real press). *Inferred* is a judgment (every `judgment:` note and every checklist row
  below). Never phrase an inferred value as measured. A derived value built on a missing or stale
  measurement drops to inferred. *Not verified* is its own state: the check did not run.
- **Look at the screenshots** for 320, 390 and 1440 before claiming the page works; the probe
  measures rules, it does not see a composition.

## 3. Modes

`build` is the default. The other three are opt-in by wording and nest inside this skill's
existing mode matrix: `polish` and `harden` are scoped kinds of `build`; `audit` is a probe-driven
kind of the read-only review row.

| Mode | Edits | Probe | Deliverable |
|---|---|---|---|
| `build` | Full authoring of the requested surface | At least the final round; after every round is better | Working source, the inspected matrix, the review table, a tiered summary |
| `polish` | Values only (spacing, colour, radius, type size, a motion token); no new component, no changed layout or information architecture | Once as a baseline, once after the fixes | A value-only diff and the before and after tables |
| `audit` | None, not even a "quick" fix | The probe run is the deliverable | The review table, the Not verified list and the Block or Approve line |
| `harden` | Only to repair a break the stress pass found; three rounds at most | At every harden axis that applies | A table per axis with the columns Scenario, Observed and Owner, plus the fixes |

Mode words (the hook names the mode it detected; the wording and the boundary decide together):

- `polish`: *polish*, *clean up the styling*, *tighten up*, *다듬어*, or an explicit "keep the
  layout / 구조는 그대로" scope, when the object is an interface surface. A request that asks for
  a new component or a changed layout under polish wording is a `build`.
- `audit`: *audit*, *read-only*, *just check*, *tell me what's wrong*, *점검*, *검토만* on an
  interface surface, with no fix requested in the same breath. The route words alone select it;
  no memory of earlier work is needed. `audit` produces the review table as evidence and hands
  the acceptance verdict to `visual-qa`; it never issues that verdict itself. A request that only
  needs proof and carries no audit word still belongs to `visual-qa` directly.
- `harden`: *harden*, *stress-test*, *hold up under / with*, *robust to*, *튼튼하게*,
  *견고하게* on an interface surface.
- Never widened toward video, 영상, 모션 or 발표 wording; those belong to other skills. Prose,
  documents, servers and pipelines never trigger polish, audit or harden.

**Harden axes.** Name each axis and either run it or write "not applicable: <reason>":
content length (empty, one word, typical, several sentences, one unbreakable string); content
shape (emoji, right-to-left, mixed direction, diacritics and tall scripts, aligned numbers);
quantity (zero, one, realistic, about ten times realistic); container (320 px, squeezed by a
sibling, very wide); state (loading, error, disabled); environment (dark mode, zoom, reduced
motion, each toggled live).

## 4. Review format

One table, exact column order, every row a real measurement:

| Severity | Rule | Where | Measured | Fix |
|---|---|---|---|---|
| HIGH, MEDIUM or LOW | a `CF-*`, `RS-*` or `SLOP-*` id | `selector @ viewport` (or `file:line` for a static finding) | the read value and its tier, e.g. `2.9:1 [derived]`, `18×18px [measured]` | the cheapest fix; only `build`, `polish` and `harden` may apply it |

Then a **Not verified** list naming every rule that did not run and why (blocked browser, image
under text, another element painted over text, cross-origin stylesheet or iframe, closed
disclosures, a lazy image not fetched, a harden axis without a cue). A rule missing from both the table and the list is a defect in the review itself. End with
**Block** (a HIGH remains that is neither fixed nor stated as a limitation) or **Approve**.

These HIGH/MEDIUM/LOW labels only grade probe findings. When a finding moves into
`references/evidence-review.md` or `references/inclusive-interface.md`, a HIGH maps to at least
P1 or S2 there; the probe does not rename those ladders. The table is evidence for `visual-qa`,
never its verdict.

**Always HIGH once confirmed**, never downgraded for a small surface or a prototype: a control
with no accessible name; a keyboard-reachable control with no visible focus; a pointer-only
control; motion that ignores reduced motion; content clipped, overlapped or unreachable at 320 px
or 200 % zoom; text under its contrast floor; page-level sideways scrolling; a fake text, nav or
call-to-action link (`href="#"`, `javascript:`; a logo or icon-only social link is MEDIUM); a
scroll rail whose next item shows 0 px with no controls, pager or fade. Four more are judgment calls, stated as *Inferred*: meaning carried
by colour alone; a destructive action with no confirmation or undo; an error that names no way to
recover; a semantic colour token used for an unrelated meaning. Truncated text is HIGH only when
the hidden value is needed for a task. The probe opens nothing; open drawers, accordions, tabs and
dialogs yourself before calling content unreachable.

**Reviewing a change.** Read the removed side of each hunk first: a dropped `aria-label`,
`aria-labelledby` or `role`; a `button`, `nav` or `label` turned into a `div`; a removed
`:focus-visible` rule, outline or `tabindex`; a token swapped for a literal colour; a shortened
user-facing string; a removed `prefers-reduced-motion` guard; a `will-change` left behind. Each
one re-opens the matching always-HIGH item until the added side restores it.

## 5. Responsive matrix (RS)

| Id | Rule | Threshold | Severity | Probe |
|---|---|---|---|---|
| RS-001 | Canonical widths | 320, 390, 768, 1440 px light, all recorded in `viewports_run` | run completeness: a missing row is `BLOCKED: matrix incomplete`, never a finding | driver |
| RS-002 | Dark pass at 390 px | a real dark path with mean surface luminance < 0.35, and no new HIGH contrast finding against the light 390 pass; a page whose only dark path is a theme control is not verified (the probe never clicks it) | MEDIUM once the pass ran; an unrun pass is exit 2 | measured (derived for "no dark path") |
| RS-003 | Reduced motion at 390 px | the query matches, videos paused, no transition or animation over 250 ms per iteration on a motion property (transform, translate, scale, rotate, offsets, inset, size, margin, background-position, `all`); opacity and colour fades and progress or status motion are exempt | HIGH | measured |
| RS-004 | 1440 px at 200 % zoom (720 CSS px) | RS-006 and RS-007's clipped and offscreen checks re-run there (overlap there stays RS-007) | HIGH | derived |
| RS-005 | Content-derived breakpoints | a layout change sits where content breaks, not at a bare framework default | LOW, advisory | checklist |
| RS-006 | No page-level sideways scroll | `scrollWidth ≤ innerWidth + 8px` at every row | HIGH | measured |
| RS-007 | No clipped, offscreen or overlapping text | nothing cut without `text-overflow` or a line clamp (prefixed or not); no text past the viewport's side edges by more than 8 px outside a sideways scroller (below the fold never counts); overlap < 0.45 of the smaller box; only elements with their own text, accessibility-only spans excluded | clipped or offscreen HIGH; overlap MEDIUM | measured |
| RS-008 | Mobile input text | text-entry controls (text-like inputs, `textarea`, `select`, `contenteditable`) ≥ 16 px on touch widths (≤ 768 px, the zoom row included) | MEDIUM | measured |
| RS-009 | Safe-area offsets | only with `viewport-fit=cover`: a fixed or sticky control touching an edge carries `env(safe-area-inset-<edge>)` in its authored offset or padding | MEDIUM | derived (authored declarations; a cross-origin sheet is not verified) |
| RS-010 | Scroll-rail peek | 16 to 32 px of the next item visible, required only when the rail has no prev/next control, pager, tab or counter | LOW; HIGH when the next item shows 0 px with no cue or fade | measured |
| RS-011 | RTL pass | only when real content or locales are right-to-left; logical properties throughout | MEDIUM | checklist |
| RS-012 | Re-check at a second state | a lone-state pass is not verified until re-sampled at another width, theme or focus | downgrade only | checklist |

## 6. Craft floor (CF)

Every DOM rule samples only what a person can see: `checkVisibility`, no accessibility-only
1 × 1 or `clip` spans, nothing parked off canvas.

**Typography**

| Id | Rule | Threshold | Severity | Probe |
|---|---|---|---|---|
| CF-101 | Body measure | target 60 to 75 characters per line; flagged when a prose block of two or more lines has a longest line over 90 (Latin) or 60 (CJK-majority) in real prose (`p`, long `li`, `blockquote`, `dd`, long `td`; never `nav`, footer or tickers) | MEDIUM, never HIGH | derived |
| CF-102 | Heading line-height | 1.2 to 1.35 once a heading wraps to two lines; display type ≥ 40 px may go to 1.05 | MEDIUM | measured |
| CF-103 | Body line-height | flagged below 1.4 (Latin) or 1.5 (CJK) on wrapped prose; 1.5 and 1.6 are the targets; no upper bound | MEDIUM | measured |
| CF-104 | Wrapped-row floor | ≥ 1.4 for anything that wraps to three or more lines | MEDIUM | measured |
| CF-105 | Balanced headings | a heading that wraps uses `text-wrap: balance` (`pretty` suits body); a last line under 20 % of the mean of the lines before it is a judgment candidate | LOW | measured; orphans judgment |
| CF-106 | Tabular figures | numeric table columns and KPIs use `tabular-nums` or `tnum` (monospace passes) | LOW | measured |
| CF-107 | Sentence case | buttons, links, labels and tabs are not Title Case: every content word after the first capitalised; labels mostly in uncased scripts (Hangul, kana, CJK) are skipped; function words, 2 to 5 letter acronyms, inner capitals, digits and the page's own brand words are exempt; one-word labels never fire | LOW (derived when only one word is capitalised) | measured |
| CF-108 | Type roles and families | ≤ 7 roles (first family, size to 1 px, weight bucket, form controls excluded) at 390 px; ≤ 2 families plus 1 mono | MEDIUM | judgment (a recorded exception clears it) |
| CF-109 | Weight by size | ≥ 400 below 18 px; 100 to 300 only for display ≥ 28 px | MEDIUM | checklist |

**Colour and contrast**

| Id | Rule | Threshold | Severity | Probe |
|---|---|---|---|---|
| CF-201 | WCAG 2 contrast | 4.5:1 body; 3:1 for text ≥ 24 px or ≥ 18.5 px bold, and for component edges; background read from the paint stack under the text; disabled controls skipped; another element painted on top is not verified; placeholders belong to CF-807 | HIGH body, MEDIUM large | derived |
| CF-202 | Focus indicator | in-page focus confirmed as `:focus-visible`, then focused and resting styles compared: outline, shadow, border or background must change; the browser's own `auto` ring passes; a custom ring needs ≥ 2 px and ≥ 3:1 against the colour just outside it | HIGH when focus changes nothing; MEDIUM for a weak custom ring | measured |
| CF-203 | APCA | advisory Lc figure beside every CF-201 finding (body 75, non-body 60, large 45, components 30) | information | in the note |
| CF-204 | Text over image or gradient | on a CSS gradient the text clears CF-201's floor against its worst colour stop; text over an image is not verified | HIGH | derived |
| CF-205 | One accent per view | ≤ 1 saturated hue cluster (±15°) among filled surfaces ≥ 24 × 24 px; status roles, live regions, `aria-invalid`, success/warning/error/danger/info-style class tokens and pills ≤ 32 px tall excluded | MEDIUM | measured |
| CF-206 | Hue tolerance | hues within 15° count as one meaning | LOW | inside CF-205 |
| CF-207 | Not colour alone | state carries text, an icon or a pattern too | HIGH | checklist (Inferred) |

**Spacing and surfaces**

| Id | Rule | Threshold | Severity | Probe |
|---|---|---|---|---|
| CF-301 | One spacing scale | padding, gap and margin within ±1 px of a 4 px multiple; values under 4 px and centred auto margins skipped | LOW for 1 to 3 off-scale values, MEDIUM above | measured |
| CF-302 | Grouping ratio | gap between groups ≥ 2 × the gap inside a group | MEDIUM | checklist |
| CF-303 | Room between blocks | ≥ 12 px between bordered or filled blocks, ≥ 24 px around borderless ones (non-interactive only) | MEDIUM | checklist |
| CF-304 | Heading rhythm | target about twice the space above a heading as below; flagged only on a clear inversion (above < 0.75 × below and 12 px short), measured on rendered boxes; a heading that opens a card is not scored | LOW | measured |
| CF-305 | Full-width control inset | about 16 px from the viewport edge at 320 and 390 px | LOW | checklist |
| CF-306 | Container `gap` | rhythm from the parent's `gap`, not child margins | LOW | checklist |
| CF-401 | Concentric radius | inner = outer − padding, ±2 px, compared per corner where the child reaches that corner, radii capped at half the short side, padding ≤ 24 px | LOW | measured |
| CF-402 | Elevation once | no hard ≤ 2 px shadow retracing a border | LOW | checklist |
| CF-403 | Hard offset shadow | a zero-blur shadow offset past a hairline, unless the direction records a neo-brutalist register (the probe's proxy for one: the same shadow on ≥ 3 elements that each carry a ≥ 2 px solid border) | MEDIUM | measured |
| CF-404 | No glow on the primary action | no ≤ 2 px offset, ≥ 16 px blur, saturation > 0.4 shadow on the primary action or a heading; the same glow on ≥ 2 unrelated elements is reported once, as SLOP-010 | LOW | measured |
| CF-405 | Neutral image outline | ~1 px, low opacity, saturation < 15 % | LOW | checklist |
| CF-406 | Solid scrim | no `backdrop-filter: blur` on a full-viewport overlay | LOW | measured |
| CF-407 | Decorative patterns | grids, halos, marquees and stripes need a real referent (see the slop register) | LOW to MEDIUM | via SLOP rows |

**Motion**

| Id | Rule | Threshold | Severity | Probe |
|---|---|---|---|---|
| CF-501 | Motion tokens | `enter` 420 ms, `ui` 180 ms, `exit` 160 ms as `references/motion-guide.md` defines | LOW | checklist |
| CF-502 | Press feedback | the `:active` rule scales to 0.95 to 0.96 over ≤ 150 ms, read from the stylesheet (never pressed) | LOW | derived; no readable rule is not verified |
| CF-503 | Entrance scale | an entrance starts at ≥ 0.95 scale, never from 0 (icon cross-fades excepted) | MEDIUM when running, LOW when only declared; never HIGH | measured or derived |
| CF-504 | Exit shorter than entrance | same path reversed | LOW | checklist |
| CF-505 | No bounce on feedback | cubic-bezier y values and `linear()` stops inside −0.1 to 1.1, also on running Web Animations; an `animation-name` token bounce, elastic, wobble, jiggle or spring (a per-frame script spring stays invisible to the probe) | MEDIUM | measured (derived for a name) |
| CF-506 | High-frequency motion | ≤ 150 ms for controls repeated ≥ 5 times in a list, table or scroller, read after a real hover at 1440 px | LOW | measured |
| CF-507 | `will-change` | only `transform`, `opacity`, `filter` (state rules included), only while animating; "at rest" read in the resting pass only | LOW; MEDIUM at rest | measured |
| CF-508 | No layout animation | never animate width, height, padding, margin or offsets (disclosure height excepted) | MEDIUM | measured |
| CF-509 | Reduced-motion path works | every state and control stays reachable with reduce on | HIGH | via RS-003 plus judgment |
| CF-510 | Slow replay | replay entrances and feedback slowly before sign-off | LOW | checklist |

**Icons, targets, microcopy**

| Id | Rule | Threshold | Severity | Probe |
|---|---|---|---|---|
| CF-601 | One icon system | one grid, one stroke weight per set | MEDIUM | checklist |
| CF-602 | Icon size | about 1 to 1.25 × the adjacent cap height, legible at 16 px | LOW | checklist |
| CF-603 | Named controls | every focusable control, `[tabindex]` ≥ 0 included, has an accessible name; never an unlabeled destructive icon | HIGH | measured |
| CF-604 | Optical alignment | icon-side padding about 2 px tighter | LOW | checklist |
| CF-701 | Target size | < 24 px HIGH unless the WCAG 2.5.8 spacing exception holds; under 44 px on touch widths (≤ 768 px) MEDIUM, HIGH for the primary action (a form's sole submit, or the first filled button or button link in the first viewport); inline prose links exempt | HIGH or MEDIUM | measured |
| CF-702 | Target clearance | ≥ 8 px between touch targets (≤ 768 px), ≥ 4 px at 1440 px | MEDIUM | measured |
| CF-703 | Destructive targets | 44 px on every pointer type | HIGH | measured |
| CF-704 | Pointer-only actions | no control revealed only by an ancestor `:hover` rule without a matching `:focus-within` or `:focus-visible` reveal; other drag and long-press cases are judgment | HIGH | measured (stylesheet); rest Inferred |
| CF-801 | Verb-first labels | actions start with a verb in plain words | LOW to MEDIUM | checklist |
| CF-802 | Tone by stakes | warm for success, neutral for routine, calm for errors, serious for data loss | checklist | checklist |
| CF-803 | Useful errors | say what happened and how to recover | MEDIUM | checklist |
| CF-804 | One capitalisation policy | sentence case throughout, or a written exception list | LOW | via CF-107 |
| CF-805 | Toggle labels | name the state that turns on | checklist | checklist |
| CF-806 | Real labels | a placeholder is never the only label | MEDIUM | measured |
| CF-807 | Placeholder contrast | ≥ 4.5:1 against the field | MEDIUM | derived |

A *checklist* row has no DET method in this probe; review it by eye and tag the claim Inferred.
The office and diagram skills carry their own subset of these rules in their QA scripts.
