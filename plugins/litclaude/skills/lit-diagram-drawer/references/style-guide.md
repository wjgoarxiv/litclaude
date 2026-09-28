# LitFamily diagram style

This guide sets a quiet editorial skin for diagrams that must explain structure before decoration. Use it as the shared default; replace the accent only when the user supplies a brand palette.

## Composition

- Start with the reader's question. Group related elements and set their reading order before drawing connectors or choosing colors.
- Delete repeated, implied, decorative, or low-value content. Merge nodes that always move together. Do not draw a connector when position already makes the relationship clear.
- Aim for density around 4 on a 10-point scale. Keep a standard overview to roughly 9 nodes and 12 connectors. If more detail is load-bearing, zone the layout or split it into an overview and detail views.
- Use empty space to establish groups. Avoid card grids, generic rounded boxes, shadows, glow, gradient wash, ornamental dots, fake precision, and floating legends.
- Use one or two focal accent targets. All other nodes use the neutral ramp. Color never carries state or category by itself.

## Color roles

| Role | Light | Dark | Use |
|---|---|---|---|
| paper | #F7F7F3 | #172327 | Canvas |
| paper-raised | #ECEEE8 | #223136 | Secondary surface |
| ink | #202C2F | #F1F3EE | Main text and strong strokes |
| muted | #536268 | #BAC4C1 | Secondary labels and connectors |
| quiet | #748084 | #8A9998 | Tertiary labels |
| rule | #CCD2CE | #3B4A4D | Dividers and boundaries |
| accent | #B85C42 | #E39373 | One or two focal marks |
| accent-wash | #F4E7E0 | #3B2B28 | Focal fill |

Choose a different accent only when the user provides a brand source. Check all pairs after replacement. Do not add unrelated hues to create visual variety.

## Shape, stroke, and spacing

- Use a 4px base grid for coordinates, gaps, and padding. Common steps are 4, 8, 12, 16, 24, 32, 48, and 64.
- Keep corners modest, typically 2–6px. Use square geometry when it better describes a table, lane, boundary, or technical object.
- Use 1–1.5px strokes at the reference canvas size. Raise contrast or weight for meaningful boundaries, not decoration.
- Draw connectors behind nodes. Prefer horizontal or vertical routes with clean elbows. Keep the arrowhead body outside its destination box and place its tip on the box edge within 2px. At the 1080px reference width, the projected head length is at least 12px and at least five times the connector stroke width; scale the canvas term as `12 × viewBox-width / 1080`. Keep routes clear of boundary edges.
- Bind each connector label to its declared source and destination. At the 1080×640 reference, its SVG text anchor sits within 24px of that route and is nearer to it than to any other connector. Give the text box clear space from every route.
- Name each trust boundary or group in visible text. Keep its label at least 13px and 4.5:1 contrast; outline strokes must not cross labels. Never route alongside an outline within 4px for 12px or more.
- Use line style, shape, position, or text alongside color whenever a distinction matters.
- Do not put shadows under nodes. Depth belongs in nesting, order, or a labeled boundary.

## Typography roles

| Role | Treatment |
|---|---|
| Diagram title | Pretendard 600–700, at least 28px at 1080×640 |
| Node name | Pretendard 500–650, at least 15px at 1080×640 |
| Connector label | Pretendard 500–600, at least 13px at 1080×640 |
| Supporting text | Pretendard 400–500, usually 13–16px |
| Technical token | A system monospace stack, at least 13px at 1080×640 |
| Korean label | Pretendard with line-height 1.45–1.55 |

Use the bundled Pretendard variable font for sans roles and Hangul. Keep a separate monospace role for commands, identifiers, field types, and ports. Do not add a serif role by habit; the diagram has no proven need for one.

Never solve a label-fit problem by reducing Korean below 12px. Shorten copy without changing its meaning, widen the node, or split the diagram.

Scale the title, node, connector, and technical-token floors by `min(viewBox.width/1080, viewBox.height/640)` for other canvas presets. For a standard slide, keep the bounding box of meaningful nodes at least 68% of the canvas width and 40% of its height. At normal presentation zoom, the title remains scannable and the smallest semantic labels remain readable; if the content cannot fit, group or split it instead of shrinking it.

Visible text belongs to the subject. Do not print the product or generator name, source or notes metadata, variant labels, or instructions about the diagram's design (including accessibility, static-first, or accent rules).

## Theme behavior

- Light and dark are separate complete themes, not partial color swaps. Every label, line, focus cue, and boundary must retain contrast.
- Full-editorial adds a title, brief, legend, or takeaway around the same diagram. It does not add cards, shadows, or a second competing accent.
- Keep diagram semantics and reading order identical across variants.
- Print and export must show the full final state without relying on a dark-mode preference, animation, or remote font.

## Unbranded identity

Use plain geometric marks when a logo would help. Never invent or approximate an organization's logo. Real brand marks require a clear user need, lawful source, source-specific attribution, and the trademark note in NOTICE.
