# Loop

Catalog ID: loop

## Purpose and selection

Use a loop when stages form a real recurring cycle and the last step returns to the first. A central hub represents shared state accumulated by the cycle: policy, memory, evidence, or a common record. Solid clockwise ring arrows show operating flow; optional inward dashed spokes show station write-backs to the hub.

## Exclusions

Use a flowchart when the process can terminate or branch without returning, a lifecycle state diagram when a subject transitions between states, and process when the sequence is one-way. Do not force a terminal step into a cycle or add a hub just to occupy the center.

## Content schema

Provide 5–8 ordered stations in clockwise order; each station has a name and optional sublabel, short write-back label, and at most one focal flag. Provide exactly one hub with a name and one concise explanation. State that the last station truly returns to the first. Any spoke must identify what shared state its station writes. Add an optional title and subtitle.

## Deterministic layout recipe

Use a centered 1040 × 680 viewBox with hub center C=(520,340), ring radius R=240, station boxes 160 × 64, and a 200 × 104 hub. For N stations, place station k at angle -90° + k·360°/N, so station 0 is at top and subsequent stations proceed clockwise. Compute ring/box intersections and connect adjacent stations with same-radius clockwise circle arcs; the final arc closes to station 0. Calculate the inward radial spoke endpoints from the station and hub rectangle boundaries, leaving a 6px gap before the hub. The outer margin must include station boxes, strokes, marker tips, and at least 64px clear space. Snap boxes to the 4px grid while preserving symmetry; keep circle intersections to consistent precision.

## Encoding rules

Stations use paper fill and ink border. The hub alone may use a solid ink fill with paper text. At most one focal station uses accent tint and outline. Ring flow is solid muted and clockwise; write-back spokes are dashed and visually lighter. Keep spokes radial and distinct from ring arcs. Optional spoke labels stay beside the path with a paper mask and 6–10px visible gap. The circular arcs and radial spokes are documented type-specific exceptions to the usual orthogonal connector rule; never mix connector grammars around the ring.

## Korean behavior

Use short Korean station names and sublabels, preserving the domain meaning and clockwise order. Make the hub subtitle a plain phrase, not a sentence fragment with unexplained acronyms. Use Pretendard for all Hangul. Mono is limited to short IDs and technical labels. Do not rotate station text; when it cannot fit, shorten with user approval or divide the cycle into overview and detail.

## Light, dark, and full variants

Keep positions and semantics identical across skins. The hub remains the highest-contrast shared-state element in both; write-back spokes remain dashed and secondary. Full editorial adds a framing title, purpose sentence, and optional source note outside the SVG. It does not add a second hub or more stations. Static is the default; motion requires an explicit request and must follow the motion guide's reduced-motion rules.

## Accessibility

Describe station order, cycle closure, hub meaning, focal station, and write-back direction in SVG text. Provide a linear ordered list as an alternative to the circle. Distinguish the return edge by arrow direction and the write-backs by dash, not color alone. Ensure labels do not collide with the hub or spokes.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for circle bounds, arrow intersections, spoke overlap, clipped labels, contrast, dark-skin polarity, SVG semantics, and visible text. Run scripts/verify-type.mjs --type=loop to check 5–8 stations, one hub, equal angular intervals, closure, marker landing, radial spoke clearance, focal count, and viewBox margin. Inspect the screenshot at final output size and run humanizer checks on every visible label.

## Anti-patterns

- A cycle with no true return edge.
- Two hubs or no named hub meaning.
- Uneven station angles with no semantic reason.
- Straight spokes with solid styling or ring paths that cross the hub.
- Orthogonal sections mixed into the circular ring.
- More than eight stations or long paragraphs inside station cards.
- Multiple focal stations that compete for the first read.
- Movement or animation used to hide a confusing static layout.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Motion guide](motion.md) · [Terminal frame variant](type-loop-terminal.md) · [Semantic patterns](semantic-patterns.md)
