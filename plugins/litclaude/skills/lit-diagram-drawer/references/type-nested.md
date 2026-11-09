# Nested containment

**Catalog ID:** `nested`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Nested when meaning comes from one boundary being inside another: scope inheritance, trust zones, blast radius, workspace ownership, or a document/configuration cascade. The outside ring is the broadest scope; each inward ring narrows it. Select this only when every level has exactly one child scope. For branching parent/child structures, use Tree or Org chart; for broad, non-nested infrastructure zones, use Architecture.

## Exclusions

Do not use concentric rings to show steps, quantities, cross-links, peer groups, or several children of one parent. Do not put unrelated facts inside a ring merely to fill space. If a boundary has a side branch, split the diagram or switch to a grammar that supports branching.

## Content schema

```yaml
title: "Which policy applies here?"
levels:                         # outermost to innermost; 2–6, preferably 3–5
  - { id: org, label: Organization, detail: "Baseline controls" }
  - { id: team, label: Team, detail: "Team overrides" }
  - { id: repo, label: Repository, detail: "Local configuration" }
  - { id: task, label: Task, detail: "Current request" }
focal_id: task                  # optional; at most one
annotations: []                 # optional; at most two short callouts
```

Every level needs a stable ID and concise name. `detail` is optional and must fit inside that level without shrinking the text. A level may contain a single short example or file marker; it may not introduce another hierarchy.

## Deterministic layout recipe

Use a 1000×600 SVG viewBox. Place the outer boundary at `(40, 56)` with width `920` and height `488`. For `n` levels, use an inset of 32px horizontally and 28px vertically per level: level `i` has `x=40+32i`, `y=56+28i`, `w=920−64i`, `h=488−56i`. Draw outer-to-inner so later rings sit above earlier strokes. Put each label in a small paper-backed tab on the top-left border, aligned to a common x inset; center one short detail line inside the remaining clear region. Keep text and any icon away from the next ring. At 6 levels, omit inner detail rather than overlap it. Place up to two annotations outside the rings and connect with a thin leader that touches no other boundary.

## Encoding rules

Containment is position and enclosure only. Use a consistent gap between rings, a quiet neutral stroke ramp from outer to inner, and one accent boundary at most for the selected focal scope. Do not vary ring width, area, or opacity to imply size or importance. Use a simple folded-corner/file mark only when the enclosed item is genuinely a document or configuration. The output remains static.

## Korean behavior

Use the same ring geometry for Korean and English. Prefer short Korean scope nouns; keep product names, paths, and identifiers unbroken. Center text in the available interior and use the Korean reference's line height. If a Korean label needs a second line, wrap at a word boundary and keep the label tab on one line; shorten or omit secondary detail before reducing type size.

## Light, dark, and full variants

Light and dark variants use identical coordinates, labels, and hierarchy; switch only the shared surface, ink, rule, and accent tokens. Keep the accent on the same level in both. The full variant may place the unchanged ring diagram in the editorial frame with one title, a short reading note, and no more than two callouts. Do not add extra rings to use the frame.

## Accessibility

Give the SVG a concise title and a description that names the containment order from broadest to narrowest. Provide a text outline in DOM order matching outer-to-inner order. Each boundary must remain distinguishable without color through labels, enclosure, and stroke contrast. Decorative icons are hidden from assistive technology. Keep labels in reading order and preserve visible focus only if an interactive host adds controls; the diagram itself has none.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for geometry, label bounds, off-canvas content, contrast, skin consistency, SVG accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=nested` to validate the catalog marker. No specialized numeric contract is registered; review containment order, level budget, bounds, and label tabs here. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- More than six rings, or inconsistent gaps that make nesting look accidental.
- Branches or cross-links represented by squeezing sibling scopes into one ring.
- A title or detail that crosses a boundary or sits over the next label tab.
- Accent on multiple levels; it erases the hierarchy of attention.
- Fill gradients, shadows, or oversized nested cards that compete with the boundaries.
