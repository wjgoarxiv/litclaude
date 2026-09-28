# LIT mark fixtures

`ignition.json` is the current accepted Ignition B geometry and per-cell color
fixture. Its exact SHA-256 is
`e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec`.
The standard 22×10, banner 44×20 and micro 16×5 rows preserve every selected
trailing space. The native implementation lives in
`plugins/litclaude/lib/lit-mark.mjs`; runtime never reads this test fixture or a
sibling package. `lit-mark-render.test.mjs` checks all row and color cells, the
selected fixture hash, native lockups, byte-preserving plain mode and fallback.

The selection came from the LitFamily Ignition vector symbol on 2026-09-06.
Quadrant cells retain the predominant filled color: orange `#FF6337`, lime
`#D7F75B`, or ivory `#F2EFDF`. Fixed ANSI256 approximations are 203/191/230.
No background, gradient or extrusion is applied to the current logo.

`round6.txt` and its paired `litmark6.mjs` remain unchanged historical fixtures.
The historical generator test only proves their mutual reproducibility; it does
not define the current exported rows or artwork. Do not regenerate current
runtime marks from that historical source.
