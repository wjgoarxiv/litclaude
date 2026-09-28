# Beeswarm

**Catalog ID:** beeswarm

## Purpose and selection

Use a beeswarm when each observation should remain visible and the distribution's shape or tail is more important than a single summary. Each dot is one item on one shared value axis; the perpendicular spread only packs marks apart. Use a histogram for a broad distribution, a scatter plot for two variables, and a ridgeline for comparing several groups. A handful of values is better shown as a table; a crowd above roughly 300 items should be binned. If the task is analysis of measured scientific data, route it to the dedicated scientific-visualization skill.

## Content schema

Supply a stable item ID, one finite numeric value, unit, and a declared linear domain. Include 20–300 items. Mark at most one focal observation; name no more than six points in total. State the domain, sample count, omitted count if any, and explicitly say that the swarm offset carries no value. Do not supply a second visual variable through dot size, color, or vertical ordering.

## Deterministic layout recipe

Use a 1000 × 500 viewBox with plot x=80..960 and the horizontal value axis at y=420. Place 4–6 ticks at equal value intervals, bind each printed label to its numeric tick, and draw vertical guides only. Use one fixed radius for every dot. Map each value to x with the same linear formula; sort by value then stable ID and assign the first free vertical slot alternating above and below a centerline, with slot pitch at least two radii plus a gap. This produces a repeatable packing while leaving every x-position exact.

Check collisions after packing. If the band becomes too tall, split, use a histogram, or reduce the item set with an explicit omission note; never shift an item along the value axis to avoid a collision. Put any outlier label outside the cloud with a leader and a stable item binding. Store positions on each mark directly; don't move dots, bound labels, ticks, or their parent groups with SVG transforms or CSS positioning after verification.

## Encoding rules

Horizontal position is the only quantitative encoding. Vertical position is packing only; every dot has the same size and non-focal fill. Use one accent dot at most, with a label that names the observation. Preserve a data-to-mark binding for each circle and a data-to-text binding for every visible label and tick. Omitted observations must be counted in a note.

## Korean behavior

Use Korean for the title, axis explanation, and summary; keep IDs and exact service names intact. Use Pretendard for prose and a mono face for IDs and ticks. Apply Korean locale formatting to visible values, but retain unrounded machine values in data bindings. Give the axis unit once and keep each tick concise. The legend must explicitly state that the swarm thickness is not a scale.

## Light, dark, and full variants

Light uses one consistent ink fill for ordinary points, a clear stroke, and neutral gridlines. Dark uses a separately tested neutral point ramp and visible axis marks. Full may add the sample summary and a short note outside the plot; the point set, domain, radius, and packing algorithm stay unchanged in all variants.

## Accessibility

Provide a concise description of the distribution, sample count, axis bounds, and the fact that vertical spread is non-quantitative. Supply a downloadable or adjacent table when item-level access is required. Ensure no mark is distinguished by color alone. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for clipping, contrast, accessibility, and visible text. Run scripts/verify-type.mjs --type=beeswarm for one-value binding, shared scale, constant radius/fill, collision-free packing, point limits, label bindings, and tick fidelity. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Nudging a dot along the value axis to relieve crowding, or shifting a verified mark with CSS.
- Overprinting dots so density is encoded by darkness.
- Sorting the perpendicular dodge by a second quantity.
- Dropping or averaging observations without disclosure.
- Letting size or opacity imply another variable.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
