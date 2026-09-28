# Architecture

**Catalog ID:** architecture

## Purpose and selection

Choose an architecture diagram to explain the principal parts of a logical system and the relationships between them. It is suited to service boundaries, request or data paths, and the few external systems that make the design legible. Keep the drawing focused on the question the reader must answer.

Choose deployment when placement on hosts, environments, replicas, or network zones is the claim. Choose dependency when shared prerequisites or cycles matter. Choose data flow when ownership roles and payload changes dominate. Choose the high-level or data-lake type for a broad stage-by-stage platform overview.

## Content schema

Record an ordered list of groups or trust zones; each group has an ID and a short visible name. Record nodes with stable ID, group, name, optional role or technical sublabel, and an optional focal flag. Record directed edges with source ID, destination ID, relationship meaning, optional protocol or payload label, and optional/dashed state. Every edge endpoint must resolve. State which direction the reader should follow. Keep the overview within 9 nodes and 12 edges; use no more than 3 true boundary groups.

## Deterministic layout recipe

Use a 1000 × 560 viewBox with 32px outer margins. Lay out the main path left-to-right unless the supplied content is inherently top-down. Preserve the user-provided group order; assign one column per group. Within each column, order nodes by declared sequence and distribute centers evenly between y=156 and y=420. For a top-down view, exchange the row and column roles. Do not move an element by eye after applying the formula; change its declared rank or order instead.

Draw boundary regions first, then connectors, then node shapes and text. Route every off-axis connector as a rounded orthogonal elbow with an 8px bend. A shared-axis relationship may be a straight segment. Resolve unavoidable crossings with one small bridge on the less important path. Reserve the same explicit route slot for parallel edges and space attach points by at least 12px. Put short labels on an opaque paper mask and leave a visible gap from the stroke.

## Encoding rules

Use a single accent on one focal component or on the primary path. Use a dashed boundary only when it represents an actual trust or ownership boundary. Use a dashed edge only for a named optional, asynchronous, or return relationship; explain that meaning in a compact legend. Keep ordinary edges neutral. Technical protocols and ports use the mono role; names and explanations use Pretendard sans.

## Korean behavior

Set the document language to Korean when Korean is primary. Use Pretendard for Hangul, keep Korean words intact at line breaks, and allow long mixed-script identifiers to break at safe boundaries. Keep protocol names, API paths, and system product names exact; explain uncommon English abbreviations once in Korean. Use locale-appropriate grouping for quantities and avoid shrinking type to fit a long node name: wrap or shorten with the user's approval.

## Light, dark, and full variants

Light is the default paper-and-ink treatment. Dark is a separately checked token set with a paper-equivalent text surface, visible boundaries, and recalculated text and stroke contrast; never create it by inverting a finished screenshot. Full adds a title, one-sentence takeaway, and a short legend or note outside the drawing. Keep the same graph, scale, and node positions across all three variants.

## Accessibility

Give the SVG an accessible name and concise description that state the system scope and principal path. Use a short text alternative or adjacent table when exact edge detail matters. Pair edge style with a legend label so meaning does not depend on color. Keep reading order aligned with the visual route. Follow [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for geometry, overlaps, clipping, off-canvas content, contrast, theme polarity, accessibility, and visible-text checks. Run scripts/verify-type.mjs --type=architecture for graph budgets, endpoint integrity, boundary limits, and routing semantics. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Turning every service into an equally weighted card.
- Using accent for every boundary or every connector.
- Drawing deployment detail into a logical overview without a placement question.
- Adding decorative arrows between components when no relationship was supplied.
- Letting a node name or edge label collide with a connector.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [PPTX and DOCX](office-pptx-docx.md)
