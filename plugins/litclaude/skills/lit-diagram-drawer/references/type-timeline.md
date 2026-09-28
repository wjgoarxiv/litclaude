# Timeline

**Catalog ID:** `timeline`

## Purpose and selection

Use a timeline for events whose position on a real or declared time scale is the main point: release history, incidents, milestones, or a roadmap of dated events. Use Gantt for task durations and dependencies, and use Swimlane when ownership and handoffs matter more than elapsed time.

## Content schema

Each event needs a stable id, label, exact date/time or honest date interval, optional owner/category, and source. Declare the time zone and granularity when relevant. Mark which event is editorially focal. If a date is approximate, preserve the uncertainty as a range or explicit qualifier instead of inventing a day.

## Deterministic layout recipe

1. Declare the time domain `[t0, t1]`, scale, and tick interval. Map each exact event time with `x(t) = plotLeft + (t − t0) × plotWidth / (t1 − t0)`. Unequal elapsed intervals therefore receive unequal spacing.
2. Draw one quiet horizontal baseline and ticks at meaningful calendar boundaries. Put date labels below the baseline in chronological order.
3. Place an event mark at its mapped x coordinate. Alternate event labels above and below the line and connect each label with a short hairline. For dense events, use a visible axis break, widen the plot, or split the time range; do not compress dates invisibly.
4. Draw a major milestone with a slightly larger mark and the single accent treatment. For a true interval, use a span with both endpoints or a band and label the interval; do not represent duration with an event dot.
5. Keep the timeline to a readable number of events. When the time unit changes, use separate clearly labeled panels rather than mixing scales on one baseline.

## Visual encoding

Position alone encodes time. Size and accent may mark editorial importance, never event duration. Use explicit text for event category, milestone status, or uncertainty. Draw axis breaks when a discontinuity changes the spacing. Avoid decorative icons unless they add a stable category cue with a text equivalent.

## Korean text

Use Pretendard for event labels and mono for dates, time codes, and source markers. Keep one date format throughout the figure; state the timezone where an hour could be ambiguous. Korean date labels such as `2026년 9월` should not be compressed into a slash form with an unstated locale. Put uncertainty in visible Korean text (`약`, `전후`, `범위`) or show an interval. Follow [Korean typography](korean-typography.md) for numerals and mixed text.

## Light, dark, and full variants

All variants retain exact event positions, tick intervals, and interval widths. Light and dark variants change semantic tokens only. The full editorial layout may add a title, a short time-range summary, and a source line; it must preserve the original temporal scale. Check the baseline and focal mark in grayscale and in both skins.

## Accessibility

Provide a title and description with the date range, scale, event order, and any uncertainty or axis break. Label ticks with units. Alternate label placement to reduce collision but preserve each label-to-event leader. Milestone status must be named in text as well as shown with an accent mark. Ensure markers and rules contrast against the paper.

## Verifier gates

Run `scripts/verify-diagram.mjs` for bounds, overlap, clipped labels, contrast, skin, visible text, and a11y. Run `scripts/verify-type.mjs --type=timeline` for monotonic event placement, time-to-x consistency, declared intervals, and axis breaks. Inspect the densest part of the timeline at the actual presentation width.

## Anti-patterns

- Equal spacing for events with unequal elapsed time.
- A missing time unit, timezone, range qualifier, or visible axis break.
- A dot used for an event with a meaningful duration.
- Labels colliding over the baseline or detached from their events.
- Using icon shape or color alone to identify milestone category.
- Reordering events to make the layout look balanced.

## Related references

[Gantt](type-gantt.md) · [Swimlane](type-swimlane.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
