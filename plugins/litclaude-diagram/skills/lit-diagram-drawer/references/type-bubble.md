# Bubble Chart

**Catalog ID:** bubble

## Purpose and selection

Choose bubbles only when each item has three meaningful numeric values and the combined reading matters: x-position, y-position, and magnitude by area. If size is merely decorative, use the ordinary scatter type. If the third value is a category, facet or label it instead. Do not use bubbles when magnitudes span orders of magnitude and small marks would disappear. If the task is analysis of measured scientific data, route it to the dedicated scientific-visualization skill.

## Content schema

Each item has a stable name, finite x and y values, and a strictly positive size value. Supply explicit units and bounds for both axes, tick values, and one area-scale constant. Include 5–15 items. Declare at most one focal item and no more than three visible point labels. Count any omitted items in the source note.

## Deterministic layout recipe

Use a 1000 × 500 viewBox with plot bounds x=80..960 and y=40..420. Draw equal-interval ticks on each linear axis and bind each tick to its value. Compute center coordinates independently from the shared x and y scales. Compute radius as one constant multiplied by the square root of the size value so circle area, not radius, tracks magnitude. Round once, then use the same rounded values in the visible label and geometry binding.

Paint circles largest to smallest so smaller values remain visible. Add a same-radius paper underlay immediately before each mark to keep gridlines from showing through translucent fill. Keep point labels outside the bubble when possible and connect them to their mark with a short leader. Put verified geometry directly on each mark's coordinates; do not position marks or bound labels with transforms or CSS geometry, since that can make the rendered position disagree with the checked value. Never reposition a center to avoid overlap; disclose unavoidable occlusion or change the chart.

## Encoding rules

Position encodes x and y; area encodes the third measure. Use a neutral fill ramp to balance ink mass, not as a fourth data channel. One accent identifies the editorially focal item. Keep stroke contrast strong enough to define each circle edge. Bind each rendered mark to its name, x, y, and size; bind each text label and tick to the mark or value it describes. State scale bounds and whether the axes include zero.

## Korean behavior

Use Pretendard for names and Korean explanations, with mono for numeric ticks and IDs. Put units in axis titles and format labels with Korean locale conventions. Keep underlying values exact in bindings even if display labels round. Avoid rotating Korean axis titles; wrap or use a concise horizontal axis caption. Explain in Korean that area, rather than diameter, represents magnitude.

## Light, dark, and full variants

Light uses paper underlays, quiet gridlines, and stroked neutral bubbles. Dark has a dark paper underlay and recalculated neutral/accent strokes; don't reuse light-mode alpha values blindly. Full adds title, key interpretation, and source text around the same plot. Maintain the same scales, point order, and geometry in every variant.

## Accessibility

Describe the two positional measures, area measure, bounds, and focal item in the accessible description. Provide a data table for exact values. Do not rely on hue or area alone to identify a focal point; label it. Keep all axis and point labels legible at presentation size. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for shared contrast, clipping, overlap, and accessibility checks. Run scripts/verify-type.mjs --type=bubble for shared scales, area-proportional radii, positive sizes, draw order, and mark/label/tick bindings. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Making radius directly proportional to the third value.
- Moving centers to make the layout look cleaner or using CSS transforms to move a bound mark after verification.
- Assigning a unique hue to each item.
- Hiding values behind larger bubbles or quietly omitting an extreme.
- Using a logarithmic or truncated axis without stating it plainly.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
