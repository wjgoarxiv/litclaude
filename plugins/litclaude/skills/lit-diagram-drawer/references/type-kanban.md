# Kanban board

Catalog ID: kanban

## Purpose and selection

Use a Kanban board for a snapshot of work in progress by state: queued, active, blocked, review, and complete. Its message is state distribution and WIP pressure at one point in time. A Kanban board intentionally has no arrows.

## Exclusions

Use a swimlane or process when the path and handoffs matter; use an org chart for ownership; use a timeline when dates dominate. Do not turn a status board into a flow map by adding arrows. If more than a dozen work items must be individually named, split the board or show a count summary.

## Content schema

Supply a snapshot date, title, 2–5 ordered columns, and up to 12 work cards. Each column has a state label, current count, and a limit when it is an in-process state; entry and terminal columns may show count without a limit. Each card has a short title, stable work ID, owner, state, optional one-line detail, and blocked reason when blocked. Define four card states: default, blocked, waiting/external, and done.

## Deterministic layout recipe

Use equal-width columns with a constant 32px gutter; canonical column width is 240px. Each column has a quiet 2% ink wash with no enclosing border. Reserve a fixed header band: state name left-aligned, rectangular WIP chip right-aligned, and a full-width hairline beneath. Inside the column, inset cards 16px from the sides. Cards are 56px high with 12px vertical gaps; arrange them top-down in stable order (priority, then ID) and reserve a fixed legend and timestamp band below. For fewer columns, retain the same column width and center the board; do not stretch one or two columns until they resemble a generic dashboard.

## Encoding rules

Show counts as plain numbers for the entry queue and terminal column; show n/limit for every constrained in-process column. When count exceeds limit, accent the chip's border and text. Default cards are plain paper with ink outline; blocked cards use a thin accent edge and dashed accent border; waiting/external cards use a faint fill and dashed border; done cards use a quiet neutral fill. Use a small rectangular tag, radius 2px. The over-limit chip and at most one blocked card form the full accent budget.

## Korean behavior

Keep state names short and familiar: use concise Korean columns with optional English in parentheses when the team uses English states. Cards preserve Korean task names and owner names, with IDs in mono. Wrap task titles to at most two lines; never replace an owner's Korean name with a transliteration. Apply Korean rules for dates, counts, and mixed-script separators.

## Light, dark, and full variants

Light and dark variants retain column widths, card order, WIP values, and the snapshot date. In dark mode invert fills and outlines semantically and preserve dashed distinctions. Full editorial adds the board's scope, one-line status summary, and snapshot date outside the board. Do not add summary cards that duplicate the exact same counts; the board is the data.

## Accessibility

Give the board a title and description stating the snapshot date, columns, counts, limits, and any over-limit state. Cards need visible titles and IDs; the state is conveyed both by its column and by a non-color treatment. Provide a linear text list for assistive technology in the same order as the columns and cards. Keep the WIP chip shape rectangular so it reads as a count, not an unrelated pill badge.

## Verifier gates

Run scripts/verify-diagram.mjs, the shared diagram verifier for clipping, overlap, contrast, skin polarity, SVG accessibility, and visible-text checks. Run scripts/verify-type.mjs --type=kanban to check that every card belongs to one column, counts match card inventory, limits are stated for constrained states, total card and column budgets hold, and no connectors exist. Inspect the final screenshot at the target size and run humanizer checks on all card text.

## Anti-patterns

- Arrows between columns or cards.
- In-process columns without a WIP limit.
- More than four visible cards in one column or more than 12 total.
- Accent on every blocked card or every column.
- Pill-shaped WIP chips.
- A Done column that grows forever with no archive point.
- One card per employee.
- Omitting a blocked reason when the blocked styling makes a claim.

## Related references

[Style guide](style-guide.md) · [Output spec](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Office delivery](office-pptx-docx.md) · [Export](export.md) · [Verifier guide](verifier-guide.md)
