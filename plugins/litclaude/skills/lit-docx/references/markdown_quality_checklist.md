# Markdown Quality Checklist

Use this pass after converting DOCX/PDF to Markdown.

1) Headings
- Correct hierarchy (H1 title once, then H2/H3…)
- Blank line before each heading
- No empty headings
- Promote bold section labels to real headings when the DOCX lacked heading styles (e.g., make **Abstract** into an H2)

2) Tables
- Pipe tables aligned; one blank line before/after
- Merged cells: manually rewrite or split into multiple rows
- Numeric columns: align consistently if needed

3) Lists
- Indentation consistent; no mixed tabs/spaces
- Avoid hard-wrapped bullets; keep one line per bullet unless intentional

4) Images & media
- Links relative to media/; add alt text
- Remove width/height clutter (cleaner handles)
- Captions: add below the image if needed
- If a single-file handoff is required, inline images with scripts/embed_images.py (note: increases file size)

5) Links & references
- Reference-style links OK; ensure targets exist
- Footnotes render and resolve; definitions at file end

6) Text hygiene
- Collapse excessive blank lines; strip trailing spaces
- Preserve math `$...$` / `$$...$$`
- Keep UTF-8; avoid accidental smart-quote loss

7) Sanity check
- Compare with source for missing sections
- Spot-check tables, equations, and figure placement
