# Interaction states

Use `references/motion-guide.md` for animation choices. This guide covers what a control
does, how it reports state, and where keyboard focus goes.

## State inventory

For each interactive element, name only the states it can actually reach:

- pointer and keyboard: default, hover, pressed, focus-visible, disabled
- selection: selected, expanded, current, checked, indeterminate
- async work: loading, retrying, succeeded, failed
- content: empty, partial, truncated, stale, overflowing

Map each state to its visual treatment, accessible announcement, and transition. The
Design Contract owns the state inventory; an unlisted state is a coverage gap.

## Feedback follows consequence

| Action | Feedback |
| --- | --- |
| Reversible local change | Apply immediately; avoid a confirmation step. |
| Remote action | Show pending state and offer undo when the operation supports it. |
| Work taking over a second | Keep progress in place and preserve the current layout. |
| Irreversible action | Name the object and effect before confirmation. |
| Failure | Keep the user's input, explain the next step, and make retry reachable. |

Validate a single field on blur and cross-field rules on submit. After an error, revalidate
as the user edits. Debounce remote checks and cancel requests made stale by newer input.

## Focus and keyboard paths

1. On open, focus the first meaningful control.
2. Keep focus inside a modal; Escape closes it when that does not discard unsaved work.
3. On dismissal, return focus to the opener or its nearest surviving control.
4. After removing a row, move focus to the next row or the list when empty.
5. After navigation, focus the new heading or skip target.

Treat gestures as shortcuts. Swipe-to-dismiss needs a close control; drag-to-reorder needs
keyboard controls or a position field; pull-to-refresh needs a visible refresh action.

## Review record

For each interaction, retain an internal Design Contract or QA record keyed to its hash:
the trigger, accessible name, reachable states, keyboard path, async failure and retry
behavior, and how QA reached the state. Keep this record detailed. In the chat reply,
mention only the limitation that changes the user's next decision.
