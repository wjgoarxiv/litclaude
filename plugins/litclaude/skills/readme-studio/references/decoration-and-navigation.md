# README decoration and navigation

## Inspection notes

Inspected public repositories on 2026-09-21. GitHub star totals and other live counters change over time; no count below is a product claim or a reason to add a popularity badge. Read the README source and its repository page, not copied examples or asset files.

| Repository inspected | What was visible in its README on the inspection date |
| --- | --- |
| [react/react](https://github.com/react/react) | Kept the opening plain: one-sentence purpose, short capability bullets, a quick documentation link and a runnable example before the longer contributor material. The repository page showed a high, changing star total. |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | Centered the project mark and one-line description, grouped workflow, coverage and package badges in a centered row, then moved into explanatory prose and linked examples. Used `<details>` for an alternate code path and command explanation. |
| [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | Used a centered light/dark logo block, a short centered descriptor and a compact badge row before the quickstart; the main body then favored named sections and direct documentation links. Its repository page also displayed a high, changing star total. |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Placed a centered banner and several labeled release, platform, package, community and license badges above a brief description. The README source marks a bounded section that a separate manpage process excludes, illustrating that decorative blocks can have renderer-specific limits. |
| [cli/cli](https://github.com/cli/cli) | Opened with a short product explanation and a real interface screenshot, then linked installation, usage and contribution guidance. The screenshot had descriptive alt text and did not replace the quick description. |

These are structural observations only. No repository copy, wording, logo, screenshot or badge asset is included here. The star totals shown on repository pages are transient and must not be copied into README prose. Every pattern below remains bound to repository-backed facts and verified endpoints.

## Assembly rules

Start with repository facts and useful navigation. Decoration may change hierarchy and scanning speed; it cannot imply a feature, release, quality level, community size, passing check or support promise that the authorized source set does not establish. A facts checker validates structure and paths only. Reopen each source and compare the claim yourself.

### Hero and badge/logo row composition

- A centered hero can combine one locally verified cover, the exact repository name, a short source-backed purpose line and a small navigation row. Keep the main prose left-aligned for reading.
- If the renderer supports responsive HTML, use `<picture>` for inspected dark/light, mobile and reduced-motion variants. Keep a plain Markdown image line ready for renderers that strip HTML; retain meaningful alt text and a working asset path.
- Place a project-owned logo beside only a few useful badges. Prefer badges for real package, license or workflow endpoints that belong to this repository. Check both the image URL and its linked destination; omit the badge if either endpoint is absent, unrelated, stale or unverifiable.
- Do not bake a star count, download count, version, build state, benchmark or endorsement into text or a static image. If a value is live, the endpoint must be live and repository-specific.

### Section iconography and emoji section headers

Use a small, consistent emoji at the start of selected section headings when it helps readers scan a long document: for example, one cue for setup, one for capabilities and one for community. Keep the words in each heading so meaning survives when emoji are unavailable or read aloud. Do not decorate every paragraph or use an icon as the only label.

Icons in a feature list should distinguish categories, not encode unsupported status. Keep text labels and meaningful alt text. Use decorative images with empty alt text only when the same meaning is already written nearby.

### Feature grids and collapsible detail

A Markdown table works for a small, comparable feature set: keep columns short, each row one capability, and each link aimed at the real implementation or documentation. On narrow screens, a short bullet list is often easier to read; do not force a wide table when its cells become prose blocks.

Use `<details><summary>…</summary>` for optional depth such as advanced setup, full examples, contributor recognition or a long compatibility list. Keep install requirements, primary usage and important limitations outside a collapsed region. Give every summary a clear label. When the target strips HTML, turn the same material into ordinary headings and lists rather than hiding it.

### Contributors, history and showcase

- A contributor image may be linked to this repository's verified `graphs/contributors` page. Include it only when the image endpoint returns a real image for the exact public repository and has useful alt text; always leave a text link to the contributor page.
- A star-history chart is optional. Prefer a checked-in chart generated for this repository or a live endpoint that currently resolves for this repository. Third-party services can change access rules, caching or response shape; fetch/preview the exact URL before use and remove a broken chart. A chart describes observed history, not future growth or project quality.
- A showcase should link to an actual public demo or a locally checked-in screenshot/movie that belongs to this project. Describe what the viewer will see. Do not use a remote embed as proof that the program works or that a deployment is current.
- Embed blocks are supplemental. Keep the underlying destination as selectable text so a registry that strips HTML still provides a useful route.

### Footer navigation and plain-Markdown fallback

Finish with a short row of links to headings that exist in this README and to inspected project resources such as documentation, discussions, contributing guidance and license. Check case-sensitive fragment targets after headings are final; omit any target that does not exist.

Some registry renderers remove raw HTML. For that branch, use a standard Markdown heading, a local Markdown image for the static cover, ordinary links instead of badge-only navigation, and normal headings/lists in place of `<details>`. Keep the quickstart, core facts, limitations and license in Markdown so stripping decoration never removes essential information.

## Final checks

Before producing the README, verify every claim against its repository source, every badge against its exact endpoint and destination, every local image against the selected package/repository root, and every anchor against a real heading. Remove empty optional sections and unresolved placeholders. The decoration reference is not evidence that any claim or endpoint is true.
