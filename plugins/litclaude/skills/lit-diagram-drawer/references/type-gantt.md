# Gantt Chart

**Catalog ID:** gantt

## Purpose and selection

Use Gantt when tasks have explicit start and finish points and the reader needs to compare overlap, parallel work, and milestones. Use a timeline for a small event sequence without task duration, or a roadmap when work is only ordered by phase and no calendar scale is trustworthy.

## Content schema

Provide a date range, time unit, and 3–12 tasks. Each task has a stable ID, name, start, end, and optional phase or track. Dates must fall within the stated range and end must not precede start. Declare one focal deliverable or critical task. A milestone is a point event, not a zero-width bar. State the “today” date only when it is relevant and current.

## Deterministic layout recipe

Use a 1000 × 500 canvas. Reserve x=200..960 for the time scale and a 180px task-label rail. Allocate 40px per task row; bars are 24px high and vertically centered in that row. Derive bar x and width from the same linear time range, rounding edges only after computing the date-to-pixel mapping. Place 4–8 equal-interval time ticks above the rows. Group tasks by phase with a subtle background rule and a text label. Add an optional dashed “today” marker at its derived x-position.

Keep dependencies out of the basic Gantt; if essential, add only a few explicit orthogonal annotations and route them behind no task bar. Use stable row order from the content schema. Grow canvas height to fit tasks and labels rather than compressing row height.

## Encoding rules

Horizontal length represents duration on a shared calendar scale; row position identifies the task. A single accent bar marks the focal deliverable. Use light neutral fills for other tasks. Use shape or line style for milestones and today markers, each with a legend entry. Put start/end dates on the axis or in data, not inside the bar.

## Korean behavior

Use Korean task and phase names with Pretendard. Use the project's locale and calendar convention consistently; state timezone if dates are tied to system events. Format month/week labels compactly and use mono for exact dates. Avoid crowding Korean task names by widening the label rail or wrapping to two lines. Never reduce bar length to fit translated text.

## Light, dark, and full variants

Light uses subtle phase bands, neutral bars, and one accent bar. Dark recalculates band and bar fills to preserve visible boundaries. Full adds title, date range, and a short milestone/source note. The axis range, task dates, and bar widths remain the same in every variant.

## Accessibility

Provide a table listing each task's start and end date and phase. Describe overlaps and key milestone in the accessible summary. Ensure that phase grouping and milestone identity are stated in text, not only by fill. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for bar bounds, clipping, contrast, and accessibility. Run scripts/verify-type.mjs --type=gantt for date validity, shared time mapping, task count, focal-bar limit, and milestone shape. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Showing more than twelve detailed tasks without splitting into plans.
- Using bars without known start and finish dates.
- Giving every bar the same emphasis.
- Putting dates inside bars where they collide with names.
- Adding dependency arrows everywhere until the schedule becomes a network diagram.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
