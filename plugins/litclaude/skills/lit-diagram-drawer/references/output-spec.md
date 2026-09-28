# Diagram output specification

The editable source is a self-contained HTML file with one inline SVG as the primary diagram. Keep text as text, not as a raster image. A standalone SVG is also a supported source when there is no surrounding editorial header or control.

## Canvas presets

| Preset | ViewBox | Safe inset | Typical use |
|---|---:|---:|---|
| slide-16x9 | 1280 × 720 | 64px horizontal, 48px vertical | Widescreen presentation |
| slide-4x3 | 960 × 720 | 48px | Standard presentation |
| doc-inline | 960 × 600 | 40px | Word body column |
| doc-wide | 1200 × 675 | 48px | Landscape report or wide page |
| social-square | 1080 × 1080 | 64px | Square post |
| fit | Content-derived, then snapped to 4px | 5% of each edge | One-off canvas |

These are pixel-space SVG coordinates, not physical print dimensions. For print, choose the page ratio first and render at a resolution suitable for the final page size.

Use a fixed viewBox and preserve its ratio. Keep titles and captions inside the safe inset. Do not shrink the complete SVG to make an overloaded layout fit.

## Content contract

- Root SVG has a unique id, viewBox, role=img, aria-labelledby, a first-child title, and a useful desc.
- Prefix title, description, marker, clip, and filter IDs with the diagram slug and variant.
- Put title, groups, connectors, nodes, labels, and legend in reading order. Connectors should appear before the nodes they join.
- Include a visible key when line types, symbols, colors, or abbreviations need explanation.
- Preserve units, signs, date range, uncertainty, and source meaning. Do not invent data or imply precision absent from the brief.
- Provide an accessible description for the diagram; do not rely on a surrounding paragraph to name it.

## Variants

- light: paper canvas, dark ink, neutral marks, and a restrained warm accent.
- dark: dark paper, light ink, theme-specific rule and connector values, and a readable accent.
- full: a title, concise context, optional key, and takeaway around the same layout. Keep the content footprint within the selected canvas.

The full variant is still a single diagram. It does not mean a dashboard or a denser version.

## File expectations

- HTML contains inline CSS and SVG. Avoid script elements unless a requested motion example needs the one documented controller.
- Use local bundled font URLs only. Static review examples must work offline.
- Use SVG 1.1-compatible shapes and attributes for Office export. Do not rely on filters, CSS variables in presentation attributes, blend modes, external images, external stylesheets, or network-loaded fonts.
- Keep source SVG accessible even when a PNG is delivered.
- PNG scale is 1×, 2×, or 3×. A 3× export is the default for placing the canvas at native size in a slide or document.
- Keep review and example PNGs small enough to inspect and share; the eight pair exports are capped at 400 KB each.

## Layout admission

If labels collide, trim their wording only when meaning survives. Otherwise widen the layout or make a second diagram. If a long connector obscures the reading path, reroute it or introduce a labeled boundary. Never hide information behind a hover state or require motion to understand sequence.
