# Exporting diagrams

Export only after the HTML/SVG source passes verification. Export the diagram itself, not the page gallery, editor controls, or a full-editorial browser frame.

## PNG

Use scripts/export.mjs with a source HTML or SVG and a requested scale of 1, 2, or 3. The script needs agent-browser 0.38.1 or newer and Chrome for Testing 154 or newer, both installed by the user. It waits for document.fonts.ready, confirms the local Pretendard face is loaded and computed, captures a static state, and does not install software. Without `--out` it writes to `diagram-exports/` in the current working directory, never inside the installed plugin. `--allow-font-fallback` exists only to render a deliberately broken comparison image; it never makes a source pass verification.

If the browser or font is unavailable, the exporter stops before writing anything and prints the user-run setup steps. `scripts/doctor.mjs` reports the same state without trying an export. Do not download tools from the skill.

For `tree-block-decomposition`, pass `--registry` only when a traceability sidecar was requested. The exporter writes `<diagram-basename>.registry.json` beside the other exports. It projects `data-block-id`, `data-block-parent`, `data-block-name`, `data-block-input`, `data-block-output`, `data-block-constraint`, `data-block-assumption`, and `data-block-impl` in source-document order. It omits absent values and a root parent, and rejects blank or duplicate IDs, missing parents, multiple roots, and cycles. It never infers missing fields or creates this sidecar by default.

## Standalone SVG

- Preserve the root viewBox, title, description, and referenced IDs.
- Add the SVG namespace when absent.
- Use explicit hexadecimal fill and stroke values. Convert supported alpha colors to a hex value plus fill-opacity or stroke-opacity.
- Convert transparent paint to none.
- Keep IDs unique and local. Reject external images, fonts, stylesheets, scripts, CSS imports, and every CSS `url()` reference except a local fragment such as `url(#marker)`. Scheme URLs (`file:`, `ftp:`, `https:`, and others), protocol-relative URLs, relative resource URLs, escaped URL tokens, and malformed URL functions fail closed. Office mode injects its own embedded Pretendard data URL only after this input check.
- Office-safe mode uses only conservative SVG elements and embeds the bundled Pretendard font when the source contains Korean text.
- Do not claim text has been outlined unless the exported SVG contains paths in place of those text nodes.

## Office proof

Insert the Office-safe SVG into a real PowerPoint or Word file together with the 2× PNG as its fallback picture, then open or render that file in an available Office renderer (PowerPoint or LibreOffice) and inspect the resulting slide or page. Compare Korean text, mono labels, geometry, colors, and margins to the browser image. A structurally valid ZIP alone is not visual proof. If a renderer is unavailable, say exactly which part remains unverified.

## Failure behavior

Reject a missing source, an SVG without viewBox, an unsupported scale, a malformed HTML file without an SVG, or a PNG request without the required renderer. Do not write partial outputs on a failed preflight. Report actual paths and byte sizes after successful export.
