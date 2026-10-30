## LitFamily · LitClaude

LitClaude adds the lit workflows to Claude Code (lit-plan, start-work, lit-loop, review-work, lit-adhd,
litresearch). Its hooks load the full rules on each turn, so this block only sets the ground rules.

- `lit` at the start of a prompt is LitClaude's activation word, not the Lit web library.
- Plans live in `plans/`, the session handoff in `HANDOFF.md`, run state in `.litclaude/`. Read them
  before resuming work in a repo.
- Never push, publish, tag or bump a version without the user's explicit yes for that action.
- Call work done only after its tests pass and the changed surface was checked for real.
- In a new repo, `lit init` writes a short project `AGENTS.md` with these conventions.
- Turn this block off with `litclaude-ai config agentFile off`.
