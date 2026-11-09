Health-check and maintain the local llm-wikify wiki, following the llm-wikify skill (Lint / maintain mode).

Check for:

- broken or stale links, orphan pages with no inbound path
- duplicate or near-duplicate topics
- weak page openings that don't say what the page is for
- source notes never integrated into topic pages
- index drift (`index.md` no longer reflects reality)
- taxonomy/schema drift (pages inventing incompatible types/labels)
- contradiction drift (conflicts noted in sources but not surfaced on topic pages)
- source drift (raw/source files changed since the note, when hashes/timestamps exist)
- bridge drift (candidates exported/rejected but not marked)

Then run the lightweight health gates (Boundary / Navigation / Provenance / Contradictions / Drift). Fix what is clearly safe; flag what needs human judgement. Always leave a concise maintenance report and append a `lint` record to `log/log.md`.

Arguments: $ARGUMENTS (optional focus area). Never widen scope beyond the current working directory while linting.
