## LitFamily · project conventions

This repo is worked with LitClaude's lit workflows (lit-plan, start-work, lit-loop, review-work).

- Plans live in `plans/`, the session handoff in `HANDOFF.md`, run state in `.litclaude/` (keep it out
  of commits). Read the handoff and the active plan before resuming.
- Never push, publish, tag or bump a version without the user's explicit yes for that action.
- Pair every behaviour change with a test that failed first, and check the changed surface for real
  before calling it done.
