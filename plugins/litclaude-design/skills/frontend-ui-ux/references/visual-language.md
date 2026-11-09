Visual language is a closed set of named roles with fixed values. What a component cannot name in that set is drift, not creativity.

## Name type by role, not by family

Decide the roles the product needs, bind values to each, and choose a family last.

- Cap at 7 roles: display, page title, section title, body, body-strong, meta, label. Add mono only for code.
- Every role fixes size, weight, line height, tracking, and wrapping behavior.
- Line height 1.5 for body, 1.2-1.3 for headings, 1.6 for CJK body copy.
- Use tabular numerals anywhere a number updates in place.
- Two families plus one mono. A third family requires a named exception.

## Bind color to semantic roles

Components consume roles. A numbered palette scale is a foundation value, never a component decision.

- Roles: canvas, surface, surface-raised, text, text-muted, border, border-strong, accent, accent-text, positive, warning, negative, focus, selection, overlay.
- Ship each role as a foreground/background pair, so contrast belongs to the pair.
- Ship a state ladder for interactive roles: default, hover, active, disabled.
- Raw scales fail: `gray-500` carries no meaning, cannot invert per theme, cannot be audited, and multiplies one-offs.

## State contrast as numbers

Contrast is measured per theme against the painted background, never judged by eye.

- Body and small text: 4.5:1 minimum.
- Text at 24 px, or 19 px at bold and above: 3:1 minimum.
- Meaningful icons, chart marks, and control boundaries: 3:1 minimum.
- Focus indicator: 2 px minimum thickness at 3:1 against both adjacent colors.
- Measure placeholder, muted metadata, and disabled labels explicitly; those fail first.

## Keep one icon system

One geometry, one weight, one metaphor vocabulary. An icon sharpens a label; it never replaces one.

- Single grid at 24 px, one stroke weight, one corner and terminal treatment.
- Name every meaningful icon, hide decorative ones from assistive technology, and never leave a destructive action on an icon alone.
- Metaphor risk: obsolete objects, hand gestures, animals, and local symbols shift meaning by locale. Verify each shipped locale.

## Treat imagery as tokens

Imagery inherits system values. Undecided imagery becomes layout instability at load.

- Aspect-ratio tokens, a declared focal point, and a reserved box before the asset lands.
- Never bake text into an image; it cannot translate, zoom, or be announced.
- Text over imagery needs a scrim that restores the measured contrast minimum.

## Run surface, depth, and elevation as one ladder

Surface color, border, and shadow move together. Three systems produce three mismatched hierarchies.

- At most three levels above canvas: raised, overlay, modal.
- Each level defines its surface color, border, and shadow in one entry.
- Never nest more than two surfaces; a third means the structure is wrong.
- Radius is a system value with two or three options, not a per-component choice.

## Pick the data display from the question

Choose the form from the question, then check that the encoding carries it.

- Comparing a few categories: bar, ordered by value unless the axis is time.
- Change over time: line, one unit per axis, no second axis without a stated reason.
- Part of a whole: stacked bar; a circular form only at two or three parts.
- One value against a target: large numeral with the target and a signed delta.
- Add a non-hue channel — position, label, or pattern — to every color encoding.

## Catch drift before review

Drift is mechanically detectable. Run these before the independent review pass.

1. Search components for raw hex, `rgb(`, and hardcoded px spacing. Expect zero hits.
2. Count type roles, elevation levels, and radius values against the direction card.
3. Re-measure contrast in light theme, dark theme, and forced colors.
4. Record every accepted deviation in `accepted_exceptions` with an owner and expiry.

## Failure patterns

Reject:

- A component importing a palette scale directly.
- Status carried by hue alone.
- Contrast reported as "looks fine" with no ratio.
- Two icon families on one surface.
- A pie chart with seven slices, or a chart where a table answers the question.
