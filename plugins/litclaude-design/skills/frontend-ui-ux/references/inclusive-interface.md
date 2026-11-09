Access is a property of the markup and the flow, not a layer applied at the end. Every rule here
belongs in `accessibility` or `localization` with a proof channel attached.

## Structure before styling

Build the outline first and read it as a plain document. A correct outline removes most ARIA.

- one `h1` per view, then ranks in order with no level skipped
- landmarks present and unique: banner, navigation, one `main`, complementary, contentinfo
- native `button`, `a`, `input`, `dialog`, `table` before any composite widget
- an element needing `role`, `tabindex`, and three key handlers is the wrong element

## Visual access

Measure contrast against the pixels actually painted behind the text, in every theme and state.

- 4.5:1 body text, 3:1 at 24px or 19px bold, 3:1 for icons and control boundaries
- focus indicator 2px or thicker, at 3:1 against control and surroundings
- state never carried by hue alone; add a label, glyph, shape, or position
- 200% zoom reflows without loss; 400% must not require scrolling on two axes

## Cognitive access

Cut what the user must remember, infer, or type twice.

- one primary action per view, everything else visibly subordinate
- say what happened, what it means now, and what to do next, in that order

## Names, errors, and announcements

Write names and messages that survive being heard alone, with no screen.

- the accessible name contains the visible label; on conflict the visible label wins
- an error names the field, the problem, and the correction
- bind errors with `aria-describedby`; focus the first invalid control
- announce async results through a live region; a visual change alone is silent

## Localization

Assume translation and mirroring from the first commit.

- interpolate whole sentences; never assemble copy from fragments
- logical properties (`margin-inline`, `inset-inline`) so `dir="rtl"` mirrors
- locale-aware dates, numbers, currency, pluralization, and collation
- `lang` on the root element and at every inline language change

## CJK and IME checklist

Latin-only testing hides these defects. Exercise Korean, Japanese, and Chinese copy.

- Korean prose: `word-break: keep-all` with `overflow-wrap: anywhere` for long tokens
- declare a per-script font stack; check for tofu, synthetic bold, shifted baselines
- read `event.isComposing`; hold validation, filtering, and submit until `compositionend`
- accept full-width digits and Latin in inputs; normalize with NFKC before comparison

## Adaptive preferences

Each preference is a stated requirement, not a hint. Verify all four.

- `prefers-reduced-motion: reduce` removes travel and parallax, keeps state
- `forced-colors: active` yields to system keywords; no hardcoded background survives
- `prefers-contrast: more` strengthens text and boundaries, not only the accent
- size in `rem` so OS text scaling applies; never pin the root to `px`

## Proof channels

Each channel finds defects the others cannot. Run all four and name them in `evidence_policy`
with the route and state each covered.

1. `keyboard`: full traversal, no trap, visible focus, every action reachable.
2. `screen-reader`: name, role, value, state, announcement order on one real reader.
3. `accessibility-tree`: the repository's automated audit per route and critical state.
4. `localization`: a second locale at 200% zoom, under forced colors and reduced motion.

## Severity ladder

Triage by what the user can no longer do, then order the queue.

- S1: a keyboard or screen-reader user cannot finish. Report `FAIL`; blocks release.
- S2: the task finishes with wrong or missing information. Fix before merge.
- S3: finishes at unreasonable cost. Record in `accepted_exceptions` with an owner.
- S4: cosmetic or preference-level. Record in `omissions` with a reason and owner.

## Failure patterns

Reject:

- an overlay widget or audit score offered in place of evidence
- `outline: none` with no replacement indicator reaching 3:1
- `aria-hidden` on anything focusable, or a role restating the native element
- a positive `tabindex`, or focus order diverging from reading order
- validation fired mid-composition, or CJK copy verified only with Latin strings
