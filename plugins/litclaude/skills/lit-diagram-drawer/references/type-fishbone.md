# Fishbone Root-Cause Diagram

**Catalog ID:** fishbone

## Purpose and selection

Use a fishbone to organize investigated candidate causes of one observed effect. It helps a postmortem show how evidence was grouped and where a confirmed cause sits. Use a timeline or sequence when events happened in order. Use a causal graph if causes form a directed chain or interact across branches.

## Content schema

State one observable effect, phrased as a symptom or measurement rather than a fix. Provide 3–5 investigation categories, each with 1–3 specific sub-causes. Mark at most one confirmed root cause and distinguish it from candidates that remain unconfirmed. Category names must come from the actual investigation, not a blank “6M” checklist. Add evidence status in a short note when it affects interpretation.

## Deterministic layout recipe

Use a 1480 × 600 viewBox starting at x=−40, with the spine centered at y=320 and the effect box starting at x=1200. For bone k from 1 through 5, place its spine attachment at x=1200−160−160k. Alternate bones above and below the spine. Its category endpoint is 96px left and 168px above or below its attachment. These 60-degree diagonals are the defining grammar and the only exception to orthogonal routing. Put the category label at the far endpoint. Place two sub-cause ticks at one-third and two-thirds of each bone; with one item, use the midpoint; keep each tick 32px long and place one concise label beyond its open end. The default five-bone frame is already at its left bound for an extra bone. To add a sixth, widen both effect position and viewBox by at least 160px, or split the analysis.

Draw the spine first, then category bones, ticks, labels, and the effect box. Use consistent geometry per category and stable category order. Highlight only the confirmed cause branch and effect using the two-item accent budget; candidate branches stay neutral. Ensure the outer category tags and effect box remain within the declared viewBox.

## Encoding rules

The spine points toward the observed effect. Each large bone represents a cause category; short ticks are sub-causes. Candidate and confirmed findings must be textually distinguished. Accent is reserved for one confirmed branch and the effect. Do not make all category lines different colors.

## Korean behavior

Use Korean for the observed effect and category/sub-cause labels when appropriate. Keep metric names and units exact, e.g. p95/p99, latency, or error rate. Use Pretendard for cause text and mono for measurements. Give diagonal labels room to remain horizontal where possible; do not rotate Korean text along a bone. Keep evidence status concise and avoid internal ticket syntax in visible text.

## Light, dark, and full variants

Light uses a clear neutral spine and quiet candidate bones; the confirmed branch uses a single accent. Dark changes the spine and labels to an accessible light-on-dark ramp. Full may add a compact summary of confirmed versus open causes below the same drawing. It must not imply that an unconfirmed hypothesis was established.

## Accessibility

Describe the effect first, then enumerate categories and sub-causes in a logical reading order. State which cause is confirmed. Do not rely on accent to separate confirmed from candidate causes. Offer the cause list as adjacent text or a table. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for bounds, overlaps, text fit, contrast, and accessibility. Run scripts/verify-type.mjs --type=fishbone for bone and sub-cause counts, branch geometry, confirmed-cause budget, and effect-box bounds. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Treating a timeline as a fishbone.
- Phrasing the effect as a remedy.
- Adding empty generic cause categories to satisfy a template.
- Marking multiple causes as confirmed with one focal treatment.
- Overrunning the canvas with a sixth diagonal branch and a clipped effect box.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Annotation primitives](primitive-annotation.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
