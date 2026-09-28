A design system is three token layers, a finite primitive set, and a gate that proves both. Build it in that order; a skipped gate pushes cost into feature work.

## Audit before authoring anything

Write nothing until the audit shows no existing token or primitive fits.

- List tokens, primitives with their variants, and duplicate components.
- Count raw one-off values per file; that is the migration size.
- Mark each primitive keep, extend, or replace, with its replacement cost.
- Every proposed primitive names the existing one it cannot reuse.

## Split the three token layers

Layers exist so a value change and a meaning change land in different diffs.

1. Foundation: raw values with no meaning — `color.slate.700`, `space.16`, `duration.150`.
2. Semantic roles: meaning per theme — `color.text.muted`, `color.border.strong`, `radius.control`.
3. Component decisions: `button.primary.bg`, resolving to a semantic role and nothing else.

## Keep components behind the semantic layer

A component reads layer 3 or 2. One reach into layer 1 breaks every theme at once.

- No component references a foundation value, even via an alias chain.
- No cross-component reads; a button never reads card tokens.
- Name roles by function, never appearance: `text.muted`, not `text.gray`.

## Complete component anatomy before styling

Declare the whole component up front. A state found in review is a defect, not feedback.

- Purpose, semantic element, and the source of its accessible name.
- Enumerated variants and sizes; open-ended variant sets are rejected.
- States: default, hover, active, focus-visible, disabled, selected, loading, error, empty, overflow.
- Keyboard model, including escape and return-focus behavior.
- Content limits: min and max characters, wrap or truncate, CJK and RTL.
- Ownership of validation, async progress, retry, and destructive confirmation.

## Pass the primitive showcase gate

Build one route rendering every primitive, variant, and state before feature work.

- Every state visible without interaction: error, empty, overflow included.
- Longest real label, a CJK sample, and an expanded string in each text slot.
- One keyboard pass reaches every control in linear order with a visible focus ring.
- The gate passes only when no state is missing, raw values are zero, and contrast is measured per theme.

## Architect themes, not overrides

A theme is a complete semantic role set. Partial overrides are how theming rots.

- Define every role in every theme; a missing role fails, it does not fall back.
- Dark is not inverted lightness: raise surface lightness, weaken shadow, strengthen border.
- Follow `prefers-color-scheme`; an explicit user choice overrides it.
- Under `forced-colors: active`, use system keywords and keep borders load-bearing.

## Align an existing system in sequence

Alignment is ordered. Mixing a reference migration with a value change kills review.

1. Stop accepting one-off values; anything new enters as a semantic role.
2. Map existing raw values to the nearest role; list what has no match.
3. Introduce roles as aliases of current values, so this step changes nothing.
4. Confirm parity, then move components onto roles, one primitive at a time.
5. Change the values last, as one diff a reviewer can read end to end.

## Record the system where reviewers read it

The system lives in the contract, not in tribal knowledge.

- Write tokens, components, and inventory into the contract; keep `omissions` and `accepted_exceptions` filled.
- Validate from the plugin root: `node skills/frontend-ui-ux/scripts/validate-design-contract.mjs <path>`.
- Record the contract hash so the independent review pass binds its receipt to those bytes.
- Shipping inside this plugin also requires `npm run validate:plugin` and `claude plugin validate ./plugins/litclaude`.

## Governance reject-list

Reject:

- A component reaching past the semantic layer to a foundation value.
- A primitive or variant introduced for exactly one screen.
- A state surfaced by review rather than declared in the anatomy.
- A dark theme assembled from per-component overrides.
- A value change bundled into the same diff as a reference migration.
