# Story map

**Catalog ID:** `story-map`

## Purpose and selection

Use a story map to show one persona's end-to-end narrative and how user-visible stories are sliced into releases. The release cut is required: without it, the figure is a backlog grid rather than a planning map. Use Kanban for work state, a user journey for stages and sentiment, and a timeline for dated milestones.

## Content schema

Provide one persona, up to five ordered activities, one or two walking-skeleton user steps under each activity, and up to three release slices. Each story card describes a user-visible outcome and belongs to one activity and one slice. Identify the single highest-risk story. Include a release cut after the first slice and a short source/context note.

## Deterministic layout recipe

1. Lay out activity headers from left to right in the persona's narrative order. Use a consistent 200 px card width, 24 px gutters, and equal baselines; avoid ordering by priority.
2. Directly below, align each activity's user steps on one walking-skeleton row. Use 32 px step cards and reserve two step slots per activity so the row stays level when an activity has only one step.
3. Add release bands underneath and label them in a fixed 96 px left margin. Use 48 px story cards and place each in its activity column. Use a subtle vertical column rule wherever a release row has gaps so empty space still reads as part of that activity.
4. Draw one horizontal release-cut rule immediately after the first slice and label it `RELEASE CUT`. Use it as accent target one. Give only the highest-risk story card the second accent treatment and an explicit `RISK` tag.
5. Finish with a compact legend and a source/context line. Keep the entire map within five activities, three slices, twelve story cards total, and four cards per slice. Collapse the long tail into a named “Later” slice or split the map by persona when needed.

## Visual encoding

Backbone cards are wider than story cards; steps form the thin row between them. Release bands use low-contrast backgrounds or hairlines, and the release cut is a strong rule. Card text, activity-column position, and row label carry meaning. Use exactly two accent targets: the release cut and the single highest-risk story card; its `RISK` tag belongs to that same cue. Stories describe user outcomes rather than implementation chores. Slice names describe scope (`MVP`, `Next`, `Later`) rather than dates that can slip.

## Korean text

Use short Korean activity and story phrases written from one persona's perspective, with Pretendard. Keep each story outcome concrete and user-visible. Use the same vocabulary for activity names across the backbone and related documents. If ticket IDs or estimates appear, render them in mono and preserve them exactly. Prefer outcome-based slice labels such as `첫 출시`, `다음`, `이후`; follow [Korean typography](korean-typography.md) for spacing and line breaks.

## Light, dark, and full variants

The map's column order, story placement, and cut position are identical in light, dark, and full variants. Switch semantic tokens for light/dark and confirm the release rule remains visible. The full variant may add a title, a brief takeaway, and a source note around the same map; it does not add a card grid or change the release cut.

## Accessibility

Add a title and description that state the persona, narrative direction, slices, and location of the release cut. Label all activity columns and release rows. The cut remains identifiable by both a line and text; risk uses a tag and border as well as color. Maintain readable contrast on band fills and ensure the row/column relationship is apparent without relying on card color.

## Verifier gates

Run `scripts/verify-diagram.mjs` for geometry, overlap, clipping, contrast, skin, visible-text, and a11y. Run `scripts/verify-type.mjs --type=story-map` for activity/slice/card caps, alignment, release-cut presence, and accent budget. Review at PPTX and DOCX target dimensions; small cards that pass the layout check may still need shorter text.

## Anti-patterns

- No release cut, more than three slices, or date-named slices standing in for scope.
- Activities ordered by priority instead of narrative sequence.
- Stories that describe internal refactoring rather than a user outcome.
- Multiple personas, Kanban state columns, or a sentiment curve in one map.
- Cards floating without an activity column when a slice has gaps.
- More than two accent targets or a release cut encoded by color alone.

## Related references

[Kanban](type-kanban.md) · [User journey](type-journey.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
