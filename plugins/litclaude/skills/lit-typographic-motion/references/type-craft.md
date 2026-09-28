# Type craft for Korean and Latin in motion

Rules the type kit enforces and the gate checks. Where the kit enforces a rule by construction the
gate still measures it from the log, so a custom scene cannot quietly break it.

## Script runs (MO-FT-04)

A string is split into script runs before layout. Digits, punctuation and spaces are not a script:
they join the run beside them, the left one when they sit between two scripts, the right one before
the first letter. "2026년" is one Hangul run; "LIT팀" is a Latin run and a Hangul run split exactly
at the script boundary. Each run gets its voice's font for that script.

- Latin runs may track and step width (Archivo 75 / 100 / 125).
- Hangul runs are forced to tracking 0 and width 100, even inside a mixed line whose Latin run is
  animating. Emphasis on Hangul is weight only, and only between the two files lit-pptx already
  ships (Pretendard Regular 400 and Bold 700). Nothing is synthesized: no fake bold, no horizontal
  scale, no condensed Hangul (MO-A-33).

## Line breaks and reveals (MO-A-13, MO-FT-05)

Korean breaks only at whitespace between eojeol (a word with its attached particles). A karaoke
reveal step is one eojeol; a list reveal step is one whole item. The engine wraps lines by eojeol
and shrinks the size until a block fits, rather than breaking inside a word.

## Kerning and split words (MO-A-32)

A word drawn in pieces (a colour split, a letter-by-letter reveal) places piece i at the kerned
position of glyph i in the whole run (`glyphX`), never at the width of the text before it, which
drops the kerning pair at the split and shows as a hairline gap.

## Punctuation (MO-A-34)

Display text goes through `smart()`: `...` to an ellipsis, straight quotes to curly, leading
elisions (’cause, ’90s) to an apostrophe. The machine voice and the terminal look keep typewriter
punctuation through `plain()`, because they show typed input.

## No outline, no halo (MO-A-35)

Never stroke glyph outlines or add a halo to make type legible. Fix legibility with the palette,
size or weight. The kit has no outline API; the single-stroke plotter fonts are strokes by design
and are the one exception.

## Sizes and weights at 1080p (MO-FT-07)

- Pretendard Regular for held type up to about 32 px cap height; slams and large kinetic type use
  Bold, because thin strokes break up under motion blur from the sub-frame samples.
- Galmuri9 only at whole multiples of its 9 px grid and at least 36 px (4x).
- VT323 and Galmuri never share a readout cell for cell; give each its own line.
- Contrast floors are by rendered font size: at least 32 px (or 25 px at weight 700) is large and
  needs 3:1; anything smaller needs 4.5:1 (MO-C-06).

## Tracking (MO-C-25)

Display type may tighten to -0.04 em and no further. The machine voice and small type never go
negative: a monospace grid with negative tracking fights itself.

## Multi-line blocks (MO-C-26, MO-C-27)

A block of two or more lines keeps a line height of at least 1.5 (Latin) or 1.6 (Korean). A
paragraph card of running Latin text keeps 60–75 characters per line; a Korean card gets an
advisory 30–45 characters.

## Reading time (MO-C-07, MO-C-08)

One floor function for every unit:

- line or scene with text: `max(1.0 if any Hangul else 0.9, 0.2 x Hangul syllables + Latin words / 3.3)`
  and no more than 17 Latin characters per second;
- a word shown alone: `max(0.5, 0.2 x H + W / 3.3)`;
- a reveal step inside a line that stays up: 0.35 s.

The engine generates holds at 1.25 x the floor, so its own timeline always clears the gate; a
4-eojeol line with 14 syllables floors at 2.8 s and gets 3.5 s before beat snapping.

## Glyph coverage (MO-D-04)

Before the first frame every character is looked up in the cmap of the font its run resolves to.
A missing glyph stops the render with the font and character named; change the text or the style.
The stroke fonts cover Latin only.
