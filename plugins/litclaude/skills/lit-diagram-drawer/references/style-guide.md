# LitFamily diagram style

This guide sets a rich editorial skin: a diagram that rewards a second look, with zones, sub-parts, labelled relationships and a layered palette, while every safety floor below stays fixed. Use it as the shared default. A minimal, one-accent diagram is the opt-in variant, used only when the user asks for minimal, calm, quiet or sparse output; replace the palette only when the user supplies a brand source.

## Composition

- Start with the reader's question. Group related elements and set their reading order before drawing connectors or choosing colors.
- Show the system the way its owners know it. Keep the sub-components, protocols, data stores, queues, owners and boundary names that make the picture specific; merge only nodes that always move together, and drop only content that repeats something already on the canvas.
- Aim for density around 8 on a 10-point scale. A standard overview carries about 14–24 nodes and as many connectors as the real relationships need, arranged in named zones or tiers. When the content outgrows one view, enlarge the canvas preset or zone the layout; split into an overview and detail views only when a label would otherwise fall below its floor.
- Layer the composition: tinted zone bands behind groups, a sublabel or technical token under each node name, small primitive icons from `primitive-icons.md` beside names, numbered step badges on the main path, a legend that maps every accent family to its subject role in the subject's words ("payment path", not "accent" or "focal"), and one or two annotation callouts on the decisive edge or node. Every mark still names something real; avoid ornamental dots, fake precision, and glow or blur that lowers text contrast.
- Use a palette of 3–5 accent families, each bound to one role: a zone, a category of node, the critical path, a risk or a state. Neutrals carry the rest. Color never carries state or category by itself: pair each family with a label, legend entry, line style or icon.
- Minimal is opt-in. When the user asks for minimal, calm, quiet or sparse output, fall back to a 4/10 density, one or two focal accents and plain boxes; the floors and checks do not change.

## Color roles

| Role | Light | Dark | Use |
|---|---|---|---|
| paper | #F7F7F3 | #172327 | Canvas |
| paper-raised | #ECEEE8 | #223136 | Secondary surface |
| ink | #202C2F | #F1F3EE | Main text and strong strokes |
| muted | #536268 | #BAC4C1 | Secondary labels and connectors |
| quiet | #748084 | #8A9998 | Tertiary labels |
| rule | #CCD2CE | #3B4A4D | Dividers and boundaries |
| accent | #B85C42 | #E39373 | First role family: focal path or primary zone |
| accent-wash | #F4E7E0 | #3B2B28 | Fill for the first family |
| accent-2 | #2E7D7A | #6CC4BD | Second role family |
| accent-2-wash | #DDEFEC | #1F3B3A | Fill for the second family |
| accent-3 | #4A5BA8 | #9AA8EC | Third role family |
| accent-3-wash | #E3E7F6 | #2A3150 | Fill for the third family |
| accent-4 | #9A6B12 | #E0B456 | Fourth role family |
| accent-4-wash | #F3E9D2 | #3D3420 | Fill for the fourth family |
| accent-5 | #8C4A86 | #D493CB | Fifth role family |
| accent-5-wash | #F1E2EF | #3A2738 | Fill for the fifth family |

Every accent stroke clears 3:1 against its paper and every ink label clears 4.5:1 on its wash in both themes. Use the families in order and stop at the number of roles the subject has; three is the usual floor for a system overview. Six or more saturated families stop reading as roles and fail `ACCENT_COUNT` (OF-202). A brand source replaces these tokens one for one; check all pairs after replacement.

## Shape, stroke, and spacing

- Use a 4px base grid for coordinates, gaps, and padding. Common steps are 4, 8, 12, 16, 24, 32, 48, and 64.
- Keep corners modest, typically 2–6px. Use square geometry when it better describes a table, lane, boundary, or technical object.
- Use 1–1.5px strokes at the reference canvas size. Raise contrast or weight for meaningful boundaries, not decoration.
- Draw connectors behind nodes. Prefer horizontal or vertical routes with clean elbows. Keep the arrowhead body outside its destination box and place its tip on the box edge within 2px. At the 1080px reference width, the projected head length is at least 12px and at least five times the connector stroke width; scale the canvas term as `12 × viewBox-width / 1080`. Keep routes clear of boundary edges.
- Bind each connector label to its declared source and destination. At the 1080×640 reference, its SVG text anchor sits within 24px of that route and is nearer to it than to any other connector. Give the text box clear space from every route.
- Name each trust boundary or group in visible text. Keep its label at least 13px and 4.5:1 contrast; outline strokes must not cross labels. Never route alongside an outline within 4px for 12px or more.
- Use line style, shape, position, or text alongside color whenever a distinction matters.
- Show depth through nesting, tinted zone bands, order and labelled boundaries. A soft, consistent offset under one raised layer is allowed when it separates that layer; never let it touch a label or a route.

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
- Full-editorial adds a title, brief, legend, takeaway, and summary cards with already-declared facts around the same diagram, using the same accent families as the drawing.
- Keep diagram semantics and reading order identical across variants.
- Print and export must show the full final state without relying on a dark-mode preference, animation, or remote font.

## Unbranded identity

Use plain geometric marks when a logo would help. Never invent or approximate an organization's logo. Real brand marks require a clear user need, lawful source, source-specific attribution, and the trademark note in NOTICE.
