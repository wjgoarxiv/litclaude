Persist the current working context into the local llm-wikify wiki **only if it is worth keeping**, following the llm-wikify skill (Save Filters + Session Handoff).

First apply the **5 save-filters**. Save only if **at least one** is true:

1. Reusable — will this be reused in future work?
2. Handoff — must another agent/teammate read it to continue the project?
3. Decision — is there a decision + rationale + owner worth tracing later?
4. Failure-risk — is this a failed approach that must not be retried?
5. Shared rule — is this a team-wide rule, convention, or design guide?

If none hold, **do not save**; briefly say why it was skipped.

If it passes:

1. Route it to the right durable page (topic/decision/error/etc.) with provenance and the standard frontmatter (`type/date/status/source`).
2. Write or update a **session handoff note** under `wiki/conversations/` capturing: what was done, key decisions, what's unresolved, and which pages the next agent should read first.
3. Update `wiki/index.md` for any new persistent page and append a record to `log/log.md`.

Arguments: $ARGUMENTS (optional hint of what to save).
