# Image input, typography and safe local assets

Inspect native tool availability in Claude Code, not the capabilities of a different assistant running the task. Only a real supported generator invocation plus inspected output establishes generated imagery. Record its tool identity, prompt, returned asset, hash and copied project path. If unavailable, state IMAGE_GENERATION_UNAVAILABLE and retain that result before continuing with an explicitly supplied background. Facts and README text can proceed without the missing image; full cover delivery cannot. Do not author a procedural substitute, even with a provenance disclaimer. Await an explicit supplied image before background composition or rendering. Keep the original input and a manifest with created paths and stages so an interrupted composition never repeats generation blindly.

Backgrounds should contain no words, logos or baked-in captions. Examine the wide and mobile crop before composition. Treat blur, grain, glow and depth as deterministic composition layers, not evidence of generation. Keep foreground pixel art original and sharp. Untrusted SVG images may carry scripts, foreignObject, external references or event handlers; reject them or safely rasterize through a supported isolated tool. Do not embed arbitrary SVG markup into a document.

Resolve local Pretendard for Korean/display/prose and Meslo LGS NF for technical text. Inspect the actual family/style/version and applicable license notice; record hashes and upstream provenance. A similarly named file is insufficient. Font files must be regular, bounded, non-symlink inputs; missing glyphs, wrong family and uncertain license are blockers. Never install system fonts or add font bytes to the plugin package. Keep a redistribution license next to any authorized project-local font copy.

Copy `templates/typography/` from the exact selected skill directory into a fresh output workspace. Its lockfile pins fontkit 2.0.4; run `npm ci --ignore-scripts --no-audit --no-fund` there. The helper reads a bounded descriptor, shapes glyph runs with advances and offsets, and computes a padded union of actual transformed glyph bounds. Whitespace may have an empty outline but still carries an advance. Missing-glyph id zero is rejected. Output creation is exclusive within an explicit existing root, with non-symlink parent checks.

```bash
node "$README_STUDIO_PROJECT_ROOT/.readme-studio/typography/shape-text-to-svg.mjs" \
  --font "/explicit/task-font/Pretendard-Regular.otf" \
  --family "Pretendard" --text "연구 노트 / Research notes" \
  --output-root "$README_STUDIO_PROJECT_ROOT" --output "assets/title-dark.svg" \
  --font-size 84 --fill '#18272b'
```

Create each revision under a fresh filename. For dark fields repeat with light ink and a different output. Ink names describe the glyph fill: `title-dark.svg` belongs on a light field; `title-light.svg` on a dark field. Require at least 4.5:1 for the actual text/field pair, including the darkest/lightest moving backgrounds. Use a solid or near-opaque text field if art makes contrast uncertain.

Retain the helper's font/hash/geometry result and editable text in cover-source.json. Verify the SVG has path geometry and no text element or external font reference; compare the displayed wording character by character. An SVG title is semantic metadata, not outlined geometry. Keep the same exact title in Markdown for accessibility. Raster background plus SVG text is honestly a hybrid cover.

Primary API reference: https://github.com/foliojs/fontkit (layout glyphs/positions, path and bounding box). Font choice and license remain the user's explicit project inputs.
