# Repository evidence and readable assembly

Start at the package that users actually install. Inspect its manifest, executable entry point, installation scripts, license and current README. Check git state before editing. A monorepo root may not be the product root. Package name, version and install syntax must agree with those files. Preserve useful anchors and bilingual text; change only content needed for this task.

For each reader-visible claim, write an id, exact proposed value and a relative source in `readme-facts.json`. Reopen the source and compare semantics. The checker only validates shape and safe existing file paths, including path traversal and symlink rejection. It deliberately returns factual_accuracy=not-checked even for successful input; false prose citing a real file still passes structure validation. A status badge additionally needs an inspected real status endpoint. The checker performs no fetch and makes no availability or truth claim.

Use the helper under the directory containing Claude's selected SKILL.md, not the shell cwd:

```bash
node "$README_STUDIO_SKILL_ROOT/scripts/validate-readme-facts.mjs" \
  --project-root "$README_STUDIO_PROJECT_ROOT" \
  --facts "$README_STUDIO_PROJECT_ROOT/.readme-studio/readme-facts.json"
```

Badge URLs must be absolute HTTP(S), credential-free and free of raw whitespace/control characters. Omit unverifiable badges rather than guessing. Add docs, support, contribution and license links only after checking the actual target. Do not assume a conventional filename exists.

Keep one clear cover, a small relevant badge row, concise purpose and an immediately usable quick start. Follow with demonstrated capabilities, a useful screenshot/demo and navigation when the document needs it. Preserve semantic headings and selectable install commands. Choose alignment with the project's voice; center can suit a cover while body prose remains left aligned. Emoji should aid scanning, not substitute for labels.

Use `templates/readme-cover-section.md` only after all named artifacts exist. Reduced-motion static branches precede animation branches because picture uses the first matching source. Mobile and dark branches are conditional on actual output, not speculative paths. The static img is always present. Record GIF and WebP support separately; an MP4 link does not count as an inline animated preview. New assets must not point at an old immutable published package version. Hosted display stays POST_PUBLICATION_UNVERIFIED until separately authorized release and verification.
