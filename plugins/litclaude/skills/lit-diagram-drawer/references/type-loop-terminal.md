# Loop in terminal frame

Catalog ID: loop-terminal

## Purpose and selection

Choose this variant when a loop is being presented as a command-line or developer-tool concept and a restrained terminal window helps identify that context. The diagram inside remains the canonical Loop: an actual clockwise cycle, one shared-state hub, and optional dashed write-backs. The terminal chrome is a frame around the same diagram, not a new diagram grammar.

## Exclusions

Use plain [Loop](type-loop.md) for reports, slides, or audiences that do not benefit from the terminal metaphor. Do not use this frame to imply that a command was run, a log was captured, or output is executable. Use the terminal primitive for actual short command/output excerpts; do not replace a technical diagram with a fake shell transcript.

## Content schema

Accept the Loop schema unchanged: five to eight ordered stations, exactly one hub, a true closing transition, optional station-to-hub write-backs, and no more than one focal station. Add a short window title or filename-like context string and an optional single prompt line that describes the diagram concept. The prompt is decorative framing text, never a command to copy or execute.

## Deterministic layout recipe

Use a dark terminal frame with a 12px outer corner radius, 1px border, and a narrow title bar. Place three small neutral window marks at the leading edge; they are decorative. Center a compact terminal-title string in the header. In the content area, put one subdued prompt line, then the diagram title, then the unchanged 1040 × 680 Loop SVG. At a 1200px maximum frame width, preserve the SVG's 900px minimum width and give the SVG container local horizontal scrolling on narrow screens. Keep the title bar, prompt, heading, and diagram in fixed vertical order. The diagram geometry is produced by [Loop](type-loop.md); never rescale its labels independently.

## Encoding rules

Use the shared dark semantic tokens rather than a neon terminal palette. The shell frame uses restrained borders; the diagram keeps the Loop's neutral ring, dashed write-backs, one hub, and optional one focal station. Use a monospace face for prompt and window label only. Keep prose and station labels in the sans role, with Pretendard for Korean. The prompt glyph and window marks are decorative and must not take part in the graph's meaning.

## Korean behavior

Keep all station and hub text in Hangul when requested and do not transliterate it to make the terminal frame look more technical. The window label can remain a product name or use a short Korean topic label. The prompt line should be removed if it makes the Korean title wrap awkwardly. Use Pretendard for the title and graph labels; apply mono only to the brief frame metadata.

## Light, dark, and full variants

This is intentionally a dark-frame presentation variant. If a light deliverable is required, remove the shell and use the plain Loop's requested skin instead of building a light terminal skin. The full version may add outside framing text and a source note; its terminal window remains a single frame and the internal graph stays unchanged. Hide terminal window dots and prompt ornament from assistive technology.

## Accessibility

Give the inner SVG its own title and description. The document title describes the subject, not a fake command. Mark decorative window dots and prompt glyphs as hidden from screen readers. Preserve a linear station list after the graph, and keep local scrolling keyboard-accessible with a visible focus indicator. Do not use the frame's color or monospace face as a substitute for an explicit diagram description.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for frame bounds, inner SVG clipping, mobile overflow, contrast, semantic title/description, reading order, and visible-text checks. Run scripts/verify-type.mjs --type=loop-terminal to confirm the inner loop satisfies the Loop contract and the frame does not alter geometry. Inspect desktop and narrow viewport screenshots; run humanizer checks over the prompt, title, and diagram text. If the user requested a light skin, verify that the shell has been omitted and plain Loop tokens used.

## Anti-patterns

- Adding a glowing cyan/purple shell or a fake syntax-highlighted log.
- Presenting an invented command as though it ran.
- Putting terminal controls or a caret into the graph's semantics.
- Reflowing loop stations to fit the frame instead of preserving the base geometry.
- Using a light terminal theme when the plain light Loop is clearer.
- Making every text role monospace.
- Letting frame ornament alter screen-reader reading order.

## Related references

[Loop](type-loop.md) · [Terminal primitive](primitive-terminal.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md) · [Motion guide](motion.md)
