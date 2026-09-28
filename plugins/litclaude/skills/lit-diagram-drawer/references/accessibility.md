# Accessible diagrams

Treat accessibility as part of the diagram grammar. A picture can be visually clear and still fail if it has no accessible name, its labels are too small, or color is its only code.

## SVG semantics

- Use role=img and aria-labelledby on the root SVG.
- Put a unique title and a concise description first in document order.
- Keep visible names in live text. Do not convert ordinary labels into images.
- Give meaningful groups a stable reading order. Hide a purely decorative icon from assistive technology when its neighboring label already carries the same meaning.
- If the drawing contains complex relations, describe the important direction and grouping in the SVG description or adjacent text.

## Contrast and redundant cues

- Check text contrast against the fill actually behind each label: at least 4.5:1 for ordinary text and 3:1 for large text and essential non-text marks.
- Use a distinct line pattern, shape, word, or position alongside color-coded meaning.
- Check focus and selection states when the diagram is interactive. Do not add focusability to a static export.
- Ensure arrowheads, boundaries, and symbols remain visible in both themes and in grayscale.

## Reading order and sizing

- Keep DOM order aligned with the intended visual reading path.
- Use a short title before detail. Group related content with clear labels and spacing.
- Use at least 12px for Korean names. Do not compress Hangul to make it fit.
- Preserve readable line-height and avoid overlays that cover text.
- Test the final image at the size where it will appear in the document or slide.

## Motion and alternate presentation

- A complete static state is the default and must remain available when scripts do not run.
- Do not make state, sequence, or completion depend on color changes or animation.
- Follow references/motion.md for reduced-motion, keyboard controls, and timing.
- For a dense or complex diagram, add a concise text summary or a companion table rather than making the image itself smaller.

## Manual checks

Inspect the accessibility tree, confirm the name and description, traverse any controls with a keyboard, and compare light/dark at presentation size. Include mixed Hangul and Latin labels in visual inspection.
