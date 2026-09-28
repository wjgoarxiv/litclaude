# Anti-Slop Checklist for PPTX Outputs

Run after building any deck. Brand specifics (palette, fonts) come from the chosen enrolled template — this checklist is template-agnostic.

## Automated checks
- `python3 "$SKILL_ROOT/scripts/qa_deck.py" output.pptx` — honest gate: overflow/overlap/off-slide + WCAG contrast + anti-slop terms + objective executive/research OOXML checks (exit non-zero = FAIL).
- `python3 "$SKILL_ROOT/scripts/layout_inventory.py" output.pptx --issues-only` — geometry issues only.
- A clean gate means **no known defects, not that the deck looks good** — render and eyeball every slide (next section).

## Human-eye checks

### Slide-level
- Every slide has a real, specific title (not placeholder text).
- Accent colors are semantic, not decorative.
- No slide looks like a spreadsheet pasted without editing.

### Table-level
- Header row visually distinct; numeric columns right-aligned.
- Units in headers, not repeated per row; totals obvious but not over-decorated.

### KPI / metrics
- Primary metric is the largest element; delta color is consistent deck-wide; labels are secondary. ≤ 1 accent + optional delta color.

### Text hygiene
- No `TBD`/`TODO`/placeholder/AI-hype wording (gated by `scripts/forbidden-terms.json`).
- Source notes exist for external numbers/charts. Headers are specific (avoid bare "Value"/"Metric"/"Score").

### Executive/research copy: hard fail vs review-only

- **Hard fail:** authoring/process trace (`본 슬라이드는…`, `슬라이드 7은…`, `최종본에서 걸러냈다`) and unresolved placeholders (`[자사 확인 필요]`, `[출처 확인 필요]`, `[작성 중]`).
- **Review-only:** unsupported absolutes (`논문이 없다`, `없다는 것이 발견`), empty rhetoric (`판이 굳었다`, `전제로 깐다`), command-like planning (`닫아야 할 게이트`, `역전 금지`), unexplained RAM/FTO/CNKI/코퍼스/전이원, and arbitrary dates or day counts without an approved source.
- Review-only findings must be recorded and rewritten where warranted, but they do not become brittle automated failures. Prefer “검토한 데이터베이스 범위에서는 확인되지 않았다” and expand specialist terms on first use.

## Visual design laws (impeccable-adapted)
Apply with a human eye AFTER automated checks. Targets a static export (no motion/gradients; no borders/shadows on text).

### Anti-slop visual bans (absolute)
- [ ] No side-stripe accents (colored `border-left/right` > 1px) — use a 1px hairline, a flat tint, a leading numeral, or an icon on a wrapper `<div>`.
- [ ] No ghost cards: one box = a 1px border OR a ≤8px shadow, never both; no empty outlined boxes as decoration.
- [ ] One corner-radius law deck-wide (default sharp); pills only for tags/chips.
- [ ] No identical card grid — vary span/size or mix card with non-card.
- [ ] No eyebrow reflex / `01·02·03` on every slide unless it genuinely is an ordered sequence.
- [ ] No hero-metric ornament — a big number only when it IS the slide's data.
- [ ] No card-everything / card-in-card — group with spacing and hairline dividers.
- [ ] No gradients, blobs, mesh/noise, or sketchy SVG (pptxgenjs has no native gradient; decorations are bundled PNGs); flat ground only.

### Contrast & color (within the template's palette)
- [ ] Body/running text ≥ 4.5:1; large text (≥18pt, or bold ≥14pt) and structural lines ≥ 3:1 — measure the pair (`qa_deck.py` enforces this).
- [ ] No gray text on a colored fill; darken the fill's own hue instead. Color is never the sole signal — deltas carry a ▲/▼ glyph + sign.
- [ ] Accent coverage ≤ ~10% of the slide; one color = one meaning deck-wide. Use the template palette; invent no inline one-off hex.

### Typography
- [ ] One family in ≤ 3–4 weights, one role each; body never set in a display cut. For per-weight-family fonts (에이투지체/Brand Sans) pick weight by family name, never a bold flag.
- [ ] ≤ 3–4 distinct sizes per slide on one ramp; no muddy near-equal sizes. Display ≤ ~40pt for the boilerplate templates.
- [ ] UPPERCASE labels take positive tracking (override the narrow body default). Headings line-height 1.1–1.2; body 1.3–1.7 (Korean body looser).
- [ ] No single-word widow on a heading's last line (author manual breaks — `text-wrap` does not survive export). Numeric columns right-aligned.

### Layout & hierarchy
- [ ] Squint test passes: the one primary element + the groupings are obvious at a blur.
- [ ] Exactly one primary element per slide (≥ 2:1 to the next level); ≤ 4 items per group; even density across the deck.
- [ ] One 4pt spacing scale (4/8/12/16/24/32/48); vary gaps for rhythm; one alignment axis per region.
- [ ] Every border/divider/box earns its place — remove anything carrying no information before export.

### Craft-floor checks (enforced by `scripts/craft_extras.py` through `qa_deck.py`)

- [ ] OF-101: at most one accent hue family on a content slide (two is advisory; display slides allow one more).
- [ ] OF-102: wrapped body lines stay at or under 90 characters (38 for Korean); a column under 10 characters over 3+ lines is advisory.
- [ ] OF-103: every numeric table column is right-aligned; an inherited alignment is advisory.
- [ ] OF-104: a symmetric nested frame keeps inner radius = outer radius minus padding.
- [ ] OF-105: the gap between cards is at least twice the smallest gap between two shapes inside a card (a shape's inset to its own card edge is padding and does not count). Advisory (MEDIUM) until the family's calibration re-run promotes it.
- [ ] OF-106 / OF-107 / OF-108: no gradient-filled text, no glow, no emoji bullets.
- [ ] OF-109: no single empty band over 35% of the content area or of a card (25 to 35% is advisory); in a row of equal-height cards the row counts its smallest trailing band. Fill it, shrink the region, or merge slides.

### Objective evidence checks

- [ ] No explicit run is below the absolute 6pt floor. Primary reading text remains ≥12pt; captions/sources may use 6–10.5pt.
- [ ] No colored vertical side-stripe is attached to a card. A full-width structural rule is not a side stripe.
- [ ] A picture or table is not materially covered by a later text/image/table object.
- [ ] A picture declared as `figure`, `evidence`, or `source capture` has a visible adjacent numbered caption and `Source:`/`출처:`.
- [ ] Every appendix DOI, canonical-link, or raw-URL field contains an actual external OOXML hyperlink relationship; detection does not depend on a special “link available” phrase.
- [ ] Thumbnail review still judges hierarchy, whitespace, chart intuitiveness, executive tone, and whether caption/source/interpretation read as one group.
