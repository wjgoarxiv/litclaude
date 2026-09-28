Answer a question against the local llm-wikify wiki, following the llm-wikify skill (Query mode).

1. Read `wiki/index.md` first, then follow the most relevant topic/entity/source pages.
2. Check whether the maintained wiki is actually sufficient. If not, read the missing `raw/`/source material, update the wiki first, then answer.
3. Answer with citations to wiki pages and raw sources where appropriate. Surface contradictions and confidence honestly.
4. If the answer produces a valuable durable artifact (comparison, synthesis, decision memo, glossary, timeline), file it back into `wiki/` — but only if it passes the save-filters (see the skill's Save Filters). Otherwise keep it in the reply.
5. Log the query in `log/log.md` only if it materially changed the wiki.

Arguments: $ARGUMENTS (the question). High-value answers should compound into the wiki, not vanish into chat history.
