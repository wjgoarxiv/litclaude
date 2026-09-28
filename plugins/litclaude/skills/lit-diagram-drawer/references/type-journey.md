# User journey map

Catalog ID: journey

## Purpose and selection

Use a journey map to explain one persona's actions across stages of an experience and how those stages feel. The sentiment curve is the defining evidence; without a meaningful sentiment for each stage, this is a process or timeline, not a journey. Show the experience from the person's perspective, not an internal system sequence.

## Exclusions

Use swimlane or process for operational handoffs, timeline for dated events, and a service blueprint when frontstage and backstage responsibilities are both required. Never overlay multiple personas or use a fabricated sentiment score as if it were measured research. If the user has no sentiment evidence, use a neutral stage map or ask for research.

## Content schema

Provide one named persona and goal; 3–6 ordered stages; one qualitative sentiment level per stage from high, medium-high, neutral, medium-low, or low; one short user action per stage; a touchpoint per stage; and optionally one metric or owner row. Identify the lowest meaningful stage and up to two concrete pain markers. State whether ratings are observed, reported, or illustrative. Include an adjacent legend defining the sentiment levels.

## Deterministic layout recipe

Use a horizontal stage grid, with a 64px left label gutter and equal 200px columns separated by 24px. Keep the canvas wide enough for all columns; for the canonical five-stage case, the first stage starts at x=64 and subsequent columns advance by 224px. Place stage number and name in a compact header above a 160px sentiment band. Draw high, neutral, and low reference lines 80px apart and map the five named levels to fixed ordinal y positions; place each point at the center of its stage. Connect the points with a 1.5px polyline. Below the plot, add action and touchpoint rows separated by full-width hairlines, then an optional third row and the legend. Allocate enough height for pain-marker tags without letting them collide with the row beneath.

## Encoding rules

Sentiment is ordinal, not a continuous numerical scale; never print a 0–100 axis. Use muted for the whole curve and highlight the trough point plus its incoming segment with accent. Allow up to two small dashed pain tags at the friction stage; do not tag every stage. Keep actions in sans text and touchpoints/row labels in mono. The sentiment curve is a data line, not a connector; any additional connector obeys the shared routing rules.

## Korean behavior

Use a Korean persona label and action phrases when the intended audience is Korean. Preserve first-person phrasing if it carries the participant's perspective. Use named ordinal terms rather than unlabeled numeric scores; translate all five consistently. Keep Korean short enough to scan per column, wrap at phrase boundaries, and do not use emoji as emotion markers. Pretendard carries the Hangul; use mono only for stage IDs or touchpoint codes.

## Light, dark, and full variants

Light and dark variants preserve all stage order, sentiment values, content, and trough selection. Re-map neutral and accent tokens, then re-check curve contrast against reference lines. Full editorial may add the research context, persona, one-sentence takeaway, and source/date note around the map. Distinguish measured research from an illustrative exercise in the visible caption, not only in a note file.

## Accessibility

The SVG description must name the persona, stage order, sentiment trend, trough, and whether evidence is measured or illustrative. Do not rely on curve hue alone: provide ordinal labels in the key and a concise text summary. Use point markers and a line style or label to keep the trough clear in grayscale. Ensure action, touchpoint, and pain text is large and has sufficient contrast.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for page bounds, text collision, clipping, contrast, skin polarity, SVG title/description, and humanizer checks. Run scripts/verify-type.mjs --type=journey to confirm one persona, 3–6 stages, ordinal values, curve-to-stage binding, trough highlighting, maximum pain-tag count, and evidence-status labeling. Inspect the plot and row alignment at the final presentation size.

## Anti-patterns

- A journey without a person or sentiment evidence.
- Numeric sentiment that implies unsupported measurement precision.
- Multiple personas on one curve or pane.
- Emoji faces, gradients, or saturated sentiment bands.
- Pain tags on every stage.
- A curve whose focal segment does not point into the trough.
- An internal platform flow relabeled as a customer journey.
- A full version that makes invented sentiment sound researched.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Annotation primitive](primitive-annotation.md)
