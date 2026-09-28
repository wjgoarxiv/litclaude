Layout adaptation is a finite list of named transformations, each triggered by a measured failure
in real content. Register every width you cover as an `inventory.viewports` entry.

## Signals the layout answers to

Width is one axis among several. Enumerate every signal the surface reacts to.

- container inline size rather than window width; prefer a container query
- viewport height, including a 375px-tall landscape phone
- user font size and page zoom at 200% and 400%
- pointer precision and whether hover genuinely exists
- translated string length: budget 1.35x for European locales, wider glyph advance for CJK
- soft-keyboard occlusion, notch and home-indicator insets
- record count at zero, one, typical, and the enforced maximum

## Deriving boundaries from content pressure

Find the width where content stops working and put the boundary there. A device name is not a
measurement.

1. Load the longest realistic content at 320px, then widen in 8px steps.
2. Note the first defect: truncation, a two-word orphan, a target under 44px, page scroll.
3. Snap that width up to the nearest value already on the spacing or grid scale.
4. Name the boundary after the transformation it triggers: `rail-collapse`, `grid-to-list`.
5. Stop at five structural boundaries per route; more than that is an unresolved layout.

## Transformation verbs

State a verb, its subject, and the resulting arrangement. "Goes responsive" cannot be reviewed.

- reflow: identical elements, different track count or axis
- stack: a row becomes a column in a declared order
- collapse: peer regions merge behind a single selector
- reveal: an overlay region becomes permanently visible
- defer: content moves behind a disclosure inside the same view
- relocate: a control moves to a bottom bar, sheet, or overflow menu
- freeze: a header row or leading column pins while the rest scrolls

## Priority when space runs out

Rank content once per route and apply that ranking at every width. Carry it on
`inventory.regions` so review can compare it against the design contract hash.

- P0: the answer the user came for, plus the primary action. Never deferred.
- P1: navigation and status. May relocate; may not disappear.
- P2: metadata, counts, secondary detail. May defer behind disclosure.
- P3: decoration. Removed first, with no replacement.
- If P0 will not fit at 320px under 200% zoom, split the task into steps rather than shrink it.

## Type and spacing across widths

Scale by role. Multiplying every value by one factor destroys rhythm.

- body copy holds at 16px at every width and on every platform
- headings may use `clamp()`; write out minimum, preferred, and maximum
- line length 45-75 characters for Latin, 30-45 for CJK
- line height at least 1.5 for Latin body, 1.7 for CJK body
- move gutters and section padding one scale step per boundary

## Targets by pointer class

Size for the coarsest pointer that reaches the surface. Fine-pointer density is opt-in per
region.

- coarse pointer: 44x44px activation area, 8px of clear space between neighbours
- fine pointer: 24x24px minimum, clear space may drop to 4px
- destructive controls keep the coarse minimum under every input mode
- anything driven by hover, drag, or swipe also needs a visible discrete control

## Test matrix

Check one width below and above each boundary, then sweep the other axes. Log every cell you ran
in the verification receipt.

| Axis | Cells |
|---|---|
| Width | 320, 360, 768, 1024, 1280, 1920 |
| Zoom | 100%, 200%, 400% at 1280 |
| Height | 640 portrait, 375 landscape |
| Input mode | touch, pointer, keyboard |
| Content | empty, single, typical, maximum, longest translated label |
| Preference | dark, forced colors, reduced motion |

## Failure patterns

Reject:

- boundary values inherited from a framework default with no measurement behind them
- content that disappears below a boundary with no named place it stays reachable
- page-level horizontal scrolling at 320px, or a scroll region with no visible edge
- `100vh` on a surface that browser chrome or the soft keyboard overlays
- a density increase that pushes targets under 44px or suppresses the focus ring
