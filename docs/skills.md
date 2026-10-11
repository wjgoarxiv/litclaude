# LitClaude skills

[README](../README.md) · [Guide](./guide.md) · [한국어](./skills_ko-KR.md)

LitClaude ships 35 skills you start yourself and three that run on their own. Each row shows
a picture of what the skill gives you, the prompt or command that starts it, and the result.

## Skills at a glance

One row per skill: what it looks like, the route that starts it, and what you get.

<table>
<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>
<tr>
<td><img src="./assets/skills/lit-loop.webp" width="240" alt="Add lit to any request. Claude pins the goal, writes a failing test first, checks the real surface and leaves a record." /></td>
<td><code>lit-loop</code><br /><sub><code>lit</code></sub></td>
<td>Add <code>lit</code> to any request. Claude pins the goal, writes a failing test first, checks the real surface and leaves a record.</td>
</tr>
<tr>
<td><img src="./assets/skills/litwork.webp" width="240" alt="Ship with proof. A notepad tracks every criterion from failing test to cleanup." /></td>
<td><code>litwork</code><br /><sub><code>litwork &lt;task&gt;</code></sub></td>
<td>Ship with proof. A notepad tracks every criterion from failing test to cleanup.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-plan.webp" width="240" alt="A plan file with numbered task rows that start-work can execute. Nothing is edited yet." /></td>
<td><code>lit-plan</code><br /><sub><code>lit plan &lt;what&gt;</code></sub></td>
<td>A plan file with numbered task rows that <code>start-work</code> can execute. Nothing is edited yet.</td>
</tr>
<tr>
<td><img src="./assets/skills/start-work.webp" width="240" alt="Runs a plan row by row. A box is checked only after all five gates pass." /></td>
<td><code>start-work</code><br /><sub><code>start-work &lt;plan&gt;</code></sub></td>
<td>Runs a plan row by row. A box is checked only after all five gates pass.</td>
</tr>
<tr>
<td><img src="./assets/skills/review-work.webp" width="240" alt="Five independent review lanes read the same change and report findings first." /></td>
<td><code>review-work</code><br /><sub><code>lit review &lt;scope&gt;</code></sub></td>
<td>Five independent review lanes read the same change and report findings first.</td>
</tr>
<tr>
<td><img src="./assets/skills/litgoal.webp" width="240" alt="One objective with checkable criteria, kept on disk so the next session can pick it up." /></td>
<td><code>litgoal</code><br /><sub><code>lit goal &lt;outcome&gt;</code></sub></td>
<td>One objective with checkable criteria, kept on disk so the next session can pick it up.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-recap.webp" width="240" alt="A read-only summary: done, in progress, blocked, where the evidence is, what comes next." /></td>
<td><code>lit-recap</code><br /><sub><code>lit recap</code> · <code>litrecap</code></sub></td>
<td>A read-only summary: done, in progress, blocked, where the evidence is, what comes next.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-handoff.webp" width="240" alt="Type handoff to get a continuation file the next session can read and resume from." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code></sub></td>
<td>Type <code>handoff</code> to get a continuation file the next session can read and resume from.</td>
</tr>
<tr>
<td><img src="./assets/skills/deep-interview.webp" width="240" alt="One question at a time until the idea is clear enough to build. A meter shows how much is still vague." /></td>
<td><code>deep-interview</code><br /><sub><code>deep-interview &lt;idea&gt;</code></sub></td>
<td>One question at a time until the idea is clear enough to build. A meter shows how much is still vague.</td>
</tr>
<tr>
<td><img src="./assets/skills/litresearch.webp" width="240" alt="Splits a research question, sends parallel searchers and follows every lead before answering with sources." /></td>
<td><code>litresearch</code><br /><sub><code>lit research &lt;question&gt;</code> · <code>lit search</code></sub></td>
<td>Splits a research question, sends parallel searchers and follows every lead before answering with sources.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-crucible.webp" width="240" alt="Pressure-tests a brief before planning. Only the risks that survive critique reach the plan." /></td>
<td><code>lit-crucible</code><br /><sub><code>lit-crucible &lt;brief&gt;</code></sub></td>
<td>Pressure-tests a brief before planning. Only the risks that survive critique reach the plan.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-init.webp" width="240" alt="Maps a repository into a root AGENTS.md and short guides for the folders that need one." /></td>
<td><code>lit-init</code><br /><sub><code>lit-init</code></sub></td>
<td>Maps a repository into a root AGENTS.md and short guides for the folders that need one.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-comprehend.webp" width="240" alt="An explainer page for agent-written work: intuition first, then the walkthrough, then a short quiz." /></td>
<td><code>lit-comprehend</code><br /><sub><code>lit-comprehend &lt;target&gt;</code></sub></td>
<td>An explainer page for agent-written work: intuition first, then the walkthrough, then a short quiz.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-humanizer.webp" width="240" alt="Rewrites stiff model prose in English or Korean. Facts and hedges stay; filler goes." /></td>
<td><code>lit-humanizer</code><br /><sub><code>lit-humanizer &lt;text&gt;</code></sub></td>
<td>Rewrites stiff model prose in English or Korean. Facts and hedges stay; filler goes.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-diagram-drawer.webp" width="240" alt="A checked, editable diagram for slides and documents, with PNG and Office-safe SVG exports." /></td>
<td><code>lit-diagram-drawer</code><br /><sub><code>/litclaude:lit-diagram-drawer &lt;brief&gt;</code></sub></td>
<td>A checked, editable diagram for slides and documents, with PNG and Office-safe SVG exports.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-pptx.webp" width="240" alt="Ask for slides with lit and get an editable PowerPoint deck with native charts and embedded fonts. Each slide passes a layout gate and is checked as rendered." /></td>
<td><code>lit-pptx</code><br /><sub><code>/litclaude:lit-pptx &lt;request&gt;</code></sub></td>
<td>Ask for slides with <code>lit</code> and get an editable PowerPoint deck with native charts and embedded fonts. Each slide passes a layout gate and is checked as rendered.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-docx.webp" width="240" alt="Ask for a report with lit and get a styled Word file with its Markdown source. Korean text is set in Pretendard, and the pages are rendered and read before delivery." /></td>
<td><code>lit-docx</code><br /><sub><code>/litclaude:lit-docx &lt;request&gt;</code></sub></td>
<td>Ask for a report with <code>lit</code> and get a styled Word file with its Markdown source. Korean text is set in Pretendard, and the pages are rendered and read before delivery.</td>
</tr>
<tr>
<td><img src="./assets/skills/frontend-ui-ux.webp" width="240" alt="Builds a working interface, then a measured probe renders it in seven views: 320, 390, 768 and 1440 px, dark, reduced motion and 200% zoom." /></td>
<td><code>frontend-ui-ux</code><br /><sub><code>frontend-ui-ux build &lt;target&gt;</code></sub></td>
<td>Builds a working interface, then a measured probe renders it in seven views: 320, 390, 768 and 1440 px, dark, reduced motion and 200% zoom.</td>
</tr>
<tr>
<td><img src="./assets/skills/readme-studio.webp" width="240" alt="A factual README with a moving cover, checked at phone and desktop widths in light and dark." /></td>
<td><code>readme-studio</code><br /><sub><code>readme-studio &lt;scope&gt;</code></sub></td>
<td>A factual README with a moving cover, checked at phone and desktop widths in light and dark.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-typographic-motion.webp" width="240" alt="Ask for a video with lit. It writes a treatment, draws the scenes or sets the words in motion, adds a sound bed, and checks flashes, legibility and sound before handing over the film." /></td>
<td><code>lit-typographic-motion</code><br /><sub><code>/litclaude:lit-typographic-motion &lt;request&gt;</code></sub></td>
<td>Ask for a video with <code>lit</code>. It writes a treatment, draws the scenes or sets the words in motion, adds a sound bed, and checks flashes, legibility and sound before handing over the film.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-scientific-visualization.webp" width="240" alt="A journal-sized figure with vector and 600 DPI exports. The chart type follows the data." /></td>
<td><code>lit-scientific-visualization</code><br /><sub><code>lit-scientific-visualization</code></sub></td>
<td>A journal-sized figure with vector and 600 DPI exports. The chart type follows the data.</td>
</tr>
<tr>
<td><img src="./assets/skills/visual-qa.webp" width="240" alt="Checks a real screen at each viewport and returns an honest verdict, or names exactly what blocked it." /></td>
<td><code>visual-qa</code><br /><sub><code>visual-qa &lt;target&gt;</code></sub></td>
<td>Checks a real screen at each viewport and returns an honest verdict, or names exactly what blocked it.</td>
</tr>
<tr>
<td><img src="./assets/skills/browser-drive.webp" width="240" alt="Drives a real page after verifying the browser driver. If there is none, it says so." /></td>
<td><code>browser-drive</code><br /><sub><code>browser-drive &lt;task&gt;</code></sub></td>
<td>Drives a real page after verifying the browser driver. If there is none, it says so.</td>
</tr>
<tr>
<td><img src="./assets/skills/structural-search.webp" width="240" alt="Finds code by its syntax shape, not its text, and previews rewrites before applying them." /></td>
<td><code>structural-search</code><br /><sub><code>structural-search &lt;pattern&gt;</code></sub></td>
<td>Finds code by its syntax shape, not its text, and previews rewrites before applying them.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-team.webp" width="240" alt="Coordinates several workers with separate slices, each reporting back with evidence." /></td>
<td><code>lit-team</code><br /><sub><code>lit team</code> · <code>lit teammates</code></sub></td>
<td>Coordinates several workers with separate slices, each reporting back with evidence.</td>
</tr>
<tr>
<td><img src="./assets/skills/autoresearch.webp" width="240" alt="An approved, budgeted experiment loop. Each round changes one thing and keeps or reverts it." /></td>
<td><code>autoresearch</code><br /><sub><code>autoresearch &lt;mode&gt;</code></sub></td>
<td>An approved, budgeted experiment loop. Each round changes one thing and keeps or reverts it.</td>
</tr>
<tr>
<td><img src="./assets/skills/autoconference.webp" width="240" alt="A budgeted research conference: separate researchers, reviewers, and a synthesis that keeps disagreement." /></td>
<td><code>autoconference</code><br /><sub><code>autoconference &lt;mode&gt;</code></sub></td>
<td>A budgeted research conference: separate researchers, reviewers, and a synthesis that keeps disagreement.</td>
</tr>
<tr>
<td><img src="./assets/skills/wikify.webp" width="240" alt="Keeps reviewed project knowledge on disk and answers later questions from it, with sources." /></td>
<td><code>wikify</code><br /><sub><code>litclaude wikify capture|save|review|query|config</code></sub></td>
<td>Keeps reviewed project knowledge on disk and answers later questions from it, with sources.</td>
</tr>
<tr>
<td><img src="./assets/skills/debugging.webp" width="240" alt="Reproduces the bug, tests at least three explanations, and fixes only the confirmed cause." /></td>
<td><code>debugging</code><br /><sub><code>debugging &lt;symptom&gt;</code></sub></td>
<td>Reproduces the bug, tests at least three explanations, and fixes only the confirmed cause.</td>
</tr>
<tr>
<td><img src="./assets/skills/refactor.webp" width="240" alt="Restructures code while tests pin its behavior before and after every step." /></td>
<td><code>refactor</code><br /><sub><code>refactor &lt;target&gt;</code></sub></td>
<td>Restructures code while tests pin its behavior before and after every step.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-burnoff.webp" width="240" alt="Cleans AI-written bloat out of a change set after tests lock what it does." /></td>
<td><code>lit-burnoff</code><br /><sub><code>lit-burnoff &lt;scope&gt;</code></sub></td>
<td>Cleans AI-written bloat out of a change set after tests lock what it does.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-burnoff-file.webp" width="240" alt="The same cleanup for one file: fewer narrating comments, less defensive noise, flatter code." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>lit-burnoff-file &lt;path&gt;</code></sub></td>
<td>The same cleanup for one file: fewer narrating comments, less defensive noise, flatter code.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-code.webp" width="240" alt="Strict implementation rules: tests first, typed boundaries, small files." /></td>
<td><code>lit-code</code><br /><sub><code>lit-code &lt;task&gt;</code></sub></td>
<td>Strict implementation rules: tests first, typed boundaries, small files.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-commit.webp" width="240" alt="Splits your changes into atomic commits in the repo's own style and leaves unrelated work alone." /></td>
<td><code>lit-commit</code><br /><sub><code>lit-commit</code></sub></td>
<td>Splits your changes into atomic commits in the repo's own style and leaves unrelated work alone.</td>
</tr>
<tr>
<td><img src="./assets/skills/lsp-setup.webp" width="240" alt="Sets up a language server for your language and proves diagnostics really work." /></td>
<td><code>lsp-setup</code><br /><sub><code>lsp-setup &lt;language&gt;</code></sub></td>
<td>Sets up a language server for your language and proves diagnostics really work.</td>
</tr>
<tr>
<td><img src="./assets/skills/automatic-checks.webp" width="240" alt="Runs on its own: loads your project rules, asks for diagnostics after edits, and reviews new comments." /></td>
<td><code>rules</code> · <code>lsp</code> · <code>comment-checker</code><br /><sub>runs on its own</sub></td>
<td>Runs on its own: loads your project rules, asks for diagnostics after edits, and reviews new comments.</td>
</tr>
</table>
