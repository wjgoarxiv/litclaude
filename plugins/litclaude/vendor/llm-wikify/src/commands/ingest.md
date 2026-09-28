Ingest new source material into the local llm-wikify wiki, following the llm-wikify skill (Ingest mode; Scientific-paper ingest sub-mode when the source is a paper/TeX/bib).

1. Read the new source from `raw/` (or the path/URL in arguments). Treat `raw/` as **immutable** — never rewrite it.
2. Classify the source (article, paper, transcript, meeting notes, product doc, code, export, mixed notes).
3. Create or update **one stable source note** in `wiki/sources/`; keep ingestion idempotent (no duplicate notes for re-processed sources).
4. Route only **durable** knowledge into topic/entity pages with provenance backlinks. Deduplicate against existing pages before creating new ones.
5. Mark uncertainty, contradictions, and weak provenance explicitly.
6. For scientific papers: capture metadata (title/authors/venue/year/DOI/arXiv), preserve the research map where extraction allows, apply an importance budget, and optionally update local graph/citation/gap artifacts if the wiki already uses them.
7. Update `wiki/index.md` only for real new persistent pages; append an ingest record to `log/log.md`.

Arguments: $ARGUMENTS (optional path or URL). If empty, scan `raw/` for unprocessed material.
