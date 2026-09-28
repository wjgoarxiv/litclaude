# Slopegraph

**Catalog ID:** `slopegraph`  
**Parent family:** [Line and quantitative chart guidance](type-line.md)

## Purpose and selection

Use a slopegraph to compare several named series across exactly two comparable states: before/after, two releases, or two scenarios. The line angle communicates direction and relative change; line crossings show rank changes. Every endpoint remains labeled so the reader can recover the values.

Use a line chart for three or more ordered states, a bar or dumbbell for a single-time comparison, and a scatter plot when the two endpoints use different units. A slopegraph does not reveal what happened between the endpoints; crossings are not dates or events.

## Content schema

Supply a dataset with:

- Two state captions in chronological or explicitly named order.
- One shared measurement name, unit, and linear numeric domain used by both vertical axes.
- Four to ten series, each with a stable display name and a value in each state.
- A note for excluded or missing series; do not interpolate a missing endpoint.
- The source, period, and domain bounds needed to interpret the comparison.

Each series record is `{name, from, to}`. Bind those values and endpoint labels to the same series identity in machine-readable SVG attributes so the rendered line, text, and metadata can be checked together. Round a value once and use that same value for the label and plotted coordinate.

## Deterministic layout recipe

1. Use a wide viewBox with a plotting region about as tall as it is wide. Place two vertical axes at fixed x positions with symmetric label gutters outside them; preserve enough room for the longest series name and the numeric value at each side.
2. Declare one round domain `[min, max]` and one scale function `y(v) = bottom - (v - min) × plotHeight / (max - min)`. Apply the identical function to both endpoint columns. Record the domain and unit in the source line.
3. Place each series as one straight segment from the left endpoint to the right endpoint. Draw dots at both ends. Do not add a mid-point, curve, gridline, or extra state axis.
4. Print each series name and complete value at both ends. Put state captions below their axes and the measurement/unit in a small axis caption. Use fixed gutters; if endpoint labels collide, reduce the series count or split the comparison rather than changing coordinates.
5. Give lines a stable ordering based on the left endpoint value. Preserve that order in the legend and source metadata. Keep labels paired to their actual endpoints even when line crossings change the order at the right side.

## Visual encoding

Use a restrained ink-opacity ramp for nonfocal series and one accent series chosen for the central finding, not automatically the best or worst result. Give the focal line additional weight and label it in the legend. Names and values stay in high-contrast text roles on all lines. Avoid a rainbow palette: names at both ends already identify each series. The axes and endpoint numbers carry the scale; no grid is needed.

Show direction through the actual slope and the printed values. State-neutral legend wording such as “strongest tone” avoids claiming that the ramp is darker in both skins. Never suggest a rate or trajectory at an intermediate point.

## Korean text

Use Pretendard for service or category names; use mono for short state captions, numeric labels, units, and source metadata. Choose short paired captions such as `이전` and `이후` only when they match the actual comparison. Preserve one unit and a consistent decimal/ thousands convention at both ends. If a Hangul series name is long, wrap it in its gutter or use an agreed short label with a mapping in the legend; never slide its endpoint vertically to create room. See [Korean typography](korean-typography.md).

## Light, dark, and full variants

The three skins use identical values, shared domain, coordinates, and series ordering. Only semantic colors, paper, and framing change. In the full editorial form, add a short headline, a single finding caption, and a source line that states the domain and period; keep the plot itself unchanged. Check ink opacity ramps after compositing in each skin, because their apparent lightness reverses.

## Accessibility

Include a title and description with the two state names, unit, domain, and main direction of change. Endpoint names and values are required redundant encodings, so color is never the sole identity cue. Keep the value labels on the correct row and maintain sufficient text and line contrast. A focal accent under 3:1 must not be the only cue; reinforce it with line weight, labels, and legend wording. Preserve legibility when printed in grayscale.

## Verifier gates

Run `scripts/verify-diagram.mjs` for rendered geometry, clipping, contrast, skin, visible-text, and a11y checks. Run `scripts/verify-type.mjs --type=slopegraph` to recompute both endpoint positions from the one declared scale and compare every line, name, value, and state caption with its binding. Review the endpoint gutters in exported 16:9 and 4:3 layouts.

## Anti-patterns

- Different scales, units, origins, or transforms on the two axes.
- Moving an endpoint or its printed value to reduce a collision.
- Three or more states, a single series, a line colored uniquely for every series, or a crowded legend.
- Missing values silently interpolated, unbound labels, or values omitted at either end.
- Gridlines that repeat the endpoint values, or a curved segment that implies an unobserved path.
- Calling a crossing a dated event or reading an intermediate value from the line.

## Related references

[Line chart](type-line.md) · [Scatter plot](type-scatter.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
