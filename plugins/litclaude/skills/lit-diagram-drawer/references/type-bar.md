# Bar and Column Chart

**Catalog ID:** bar

## Purpose and selection

Use bars when a small set of discrete categories must be compared on one quantitative scale. Columns suit short labels; horizontal bars suit longer Korean or Latin category names. A grouped bar handles two comparable series. A stacked bar answers composition-to-total questions. The dumbbell form is reserved for exactly two values per category when the gap itself matters.

This guide covers explanatory diagrams and product-level comparisons. Route measured scientific data analysis to the dedicated scientific-visualization skill. Use a line chart for a continuous trend, a scatter plot for two continuous variables, and a table when exact lookup matters more than visual comparison.

## Content schema

Provide unit, category label, value, and optional series. Declare a meaningful zero baseline and axis maximum. Include 4–8 categories; above eight, group or split. Grouped form permits at most two series. Stacked form requires components that sum to a stated total. For dumbbell, supply exactly two values per row, one shared domain, names for both endpoints, and the row-order rule. Declare the focal category separately from the raw values.

## Deterministic layout recipe

Use a 1000 × 500 viewBox. Reserve plot bounds x=80..960 and y=40..420; provide 60px below for category labels and a source or legend line. Draw 4–6 evenly spaced horizontal grid rules and a stronger zero baseline. Derive each bar height from the same linear scale that begins at zero. For N categories, divide the plot width into N equal pitches, center a bar in each pitch, and make its width at least half the pitch while retaining clear gaps.

Choose vertical bars for concise labels. If labels would wrap more than two lines or exceed the available width, switch to horizontal bars and give the label rail at least 200px. Place value labels outside the mark with enough clearance to survive 3× export. In dumbbell form, use horizontal rows and one common axis; locate both dots from their actual values and place value labels outside the pair according to left/right geometry, not series identity.

## Encoding rules

Length encodes the numeric value; all categories share one scale and unit. Do not truncate the value axis. A maximum of one category receives the accent. In grouped charts use consistent series identity and a compact legend. In stacked charts name each segment and show the stack total. In dumbbell charts use one solid and one hollow endpoint, label both, and use a connector that remains distinguishable from the axis. State the data period and source when supplied.

## Korean behavior

Use Pretendard for Korean labels and mono for ticks and compact numeric values. Prefer short noun phrases over rotated text. Use Korean number grouping and include the unit in the axis title or once in the subtitle, not on every bar. Preserve zero and sign meaning when rendering negative values. If a Korean category wraps, increase row height or use horizontal bars rather than compressing line height.

## Light, dark, and full variants

Light uses a quiet paper background, faint grid, and strong zero rule. Dark redraws the grid and baseline with a light-on-dark ramp and rechecks mark contrast; never carry dark ink transparencies from light. Full adds title, takeaway, source, and a concise legend only when multiple series exist. All versions retain identical values, axis domain, and mark geometry.

## Accessibility

Include the axis unit and baseline in the description. Provide a nearby data table when precise values or category-by-category lookup is important. Distinguish series by label and shape/pattern as well as color. Do not use small accent-colored text as the only value cue. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for global layout and accessibility checks. Run scripts/verify-type.mjs --type=bar for category count, shared scale, zero baseline, series limits, and numeric label consistency. The dumbbell variant also checks its shared domain and endpoint contrast under this type gate. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Starting the value axis above zero to exaggerate a difference.
- Using more than one focal accent or adding 3D depth and shadows.
- Rotating long labels instead of changing to horizontal bars.
- Comparing stacked values without naming the total.
- Resizing dumbbell endpoints independently or moving them to open space.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
