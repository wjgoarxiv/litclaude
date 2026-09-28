# Korean and mixed-script labels

Use the bundled Pretendard variable font for sans text and Hangul. Keep a separate monospace role for code-like values. The font is pinned and licensed in assets/fonts; do not fetch a web font at render time.

## Weight and size

- Use 400 for supporting text, 500 for ordinary node labels, 600 for emphasis, and 700 for the diagram title.
- Hangul node names should be at least 12px; 14–18px is a better working range.
- Set Hangul line-height around 1.45–1.55. Allow two lines before widening or shortening a node.
- If a Korean label does not fit, rewrite it without losing the concept, widen the layout, or split the diagram. Do not reduce it below the legibility floor.

## Mixed Hangul and Latin

- Keep a normal word space where Korean prose meets a Latin name, version, or acronym: 결제 API v2.
- Keep official identifiers, endpoints, ports, field names, and commands in their exact Latin form and in the mono role.
- Use word-break: keep-all with overflow-wrap: anywhere as a safety fallback. Do not apply letter-spacing to Hangul.
- Avoid inserting spaces inside a Korean noun phrase just to make a label fit.
- Set lang=ko on Korean-only text and use a language span for mixed passages when it improves speech.

## Numbers and dates

- Use comma grouping for large counts: 12,500건. Keep decimal points and signs exact.
- Use a nonbreaking space between a value and a Latin unit where line wrapping would separate them: 18 ms, 2.4 GB.
- Use a consistent Korean date such as 2026. 9. 25. or a full ISO date when machine ordering matters. Do not mix formats within one diagram.
- Align comparable quantities with tabular numerals. Keep units on axis ticks or labels rather than repeating them in every cell.
- Preserve a user's supplied number format when it carries source meaning.

## Measure labels per glyph

Hangul syllables and wide punctuation usually occupy one em. Latin letters and digits occupy narrower advances, and spaces and punctuation still take width. Estimate mixed strings by their actual characters, then confirm the rendered label in a browser. Never count by script and silently omit digits or punctuation.

## Review

Inspect uncommon syllables, 받침, Latin acronyms, numbers, and punctuation in light and dark. Check for missing glyph boxes, fallback-font jumps, baseline shifts, clipping, and line wraps. The bundled full variable font keeps the complete Hangul repertoire available offline.
