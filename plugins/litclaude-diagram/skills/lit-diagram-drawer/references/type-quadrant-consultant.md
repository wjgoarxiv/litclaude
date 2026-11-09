# Quadrant consultant: scenario matrix

**Catalog ID:** `quadrant-consultant`  
**Parent grammar:** [Quadrant](type-quadrant.md).  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use this 2×2 scenario layout for four named futures, archetypes, or strategic options defined by two independent drivers. The cell is the conclusion; text inside each cell explains the scenario. Select standard `quadrant` when an item's exact point location within a cell carries information. This variant has no point cloud and does not imply a score.

## Exclusions

Exactly two drivers and four cells. Do not use it for prioritization, density, measured coordinates, three-by-three grids, or a matrix where points cluster inside cells. It is not a replacement for a risk heatmap or a ranking table.

## Content schema

```yaml
title: "Four operating futures"
x_axis: { low: Local, high: Global }
y_axis: { low: Stable, high: Volatile }
scenarios:
  - { id: "01", x: low, y: high, name: "Rapid fragmentation", description: "Regional platforms set the rules.", focal: true }
  - { id: "02", x: high, y: high, name: "Open competition", description: "Shared standards coexist with volatility." }
  - { id: "03", x: low, y: low, name: "Steady federation", description: "Local systems change slowly." }
  - { id: "04", x: high, y: low, name: "Managed scale", description: "A few stable global platforms dominate." }
```

Every cell needs a distinct scenario name and a 1–3 line description. Each scenario records its high/low combination explicitly; do not calculate an interior position. Exactly one focal scenario receives accent treatment. Axis names and cell tags must use the same driver terms.

## Deterministic layout recipe

Use a 1000×620 canvas. Place four equal 280×180 cells in a 2×2 arrangement around an open 48px central axis gap; center their shared axes at the canvas midpoint. Extend both axes beyond the outer cell edges by 24–36px, with arrowheads at both ends. Put the single-word endpoint labels beyond the arrow tips with fixed offsets: top/bottom centered, left right-aligned, right left-aligned. Inside each cell, place a small numbered corner tag, a left-aligned scenario title, then a description constrained to three lines. Cell text starts from the same inset in all four quadrants. Add the standard bottom legend rule and two neutral/accent swatches. If localized text does not fit, grow the canvas or abbreviate; do not resize one cell.

## Encoding rules

Cells encode only the two high/low combinations. One scenario may use a light accent tint, accent border, and accent corner tag; the other three use a neutral treatment. No dot position, cell area, opacity ramp, or fill color represents a quantity. The label tag states the matching x/y combination so readers can verify axis polarity without inferring it from color.

## Korean behavior

Keep axis endpoints to concise Korean terms whose polarity is unambiguous. Cell titles may wrap once; descriptions use at most three balanced lines and the shared Korean line-height. Keep the scenario number adjacent to its name and preserve any Latin acronym as a whole. Localize all four cells together; do not leave one quadrant in a different language unless it is a proper name.

## Light, dark, and full variants

Keep cells, axis directions, labels, scenario mapping, and focal choice identical across skins. The full variant may add an editorial title and a short “decision to watch” note outside the matrix. Do not convert the layout into a branded whiteboard: retain the shared paper, rule, and typography system.

## Accessibility

The SVG description identifies both drivers and the four high/low combinations. Provide a text alternative listing cells in reading order (top-left, top-right, bottom-left, bottom-right), each with its driver combination, title, and description. State the focal scenario in words. Arrow directions and printed endpoint labels must survive grayscale output.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for cell/label overlap, bounds, clipped text, contrast, skin polarity, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=quadrant-consultant` to validate the catalog marker; manually check the four cell assignments and focal scenario. Cell narratives are not quantitative points. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Empty “Scenario 1–4” placeholders in a finished diagram.
- Unequal cells, dot clouds, or invented numerical placement within cells.
- One-way axes, missing endpoint labels, arrow glyphs in the labels, or tags inconsistent with the axes.
- Multiple focal cells, bold axis labels, extra colors, or a 3×3 layout.
- Long consulting prose that forces tiny type or abandons the common visual system.
