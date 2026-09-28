# Database Schema

**Catalog ID:** db-schema

## Purpose and selection

Use a database-schema diagram for physical tables, columns, SQL types, constraints, indexes, and foreign keys anchored to particular columns. It helps review a migration or explain deletion and nullability behavior. Use ER when the discussion is about conceptual entities and relationship cardinalities rather than real columns and types.

## Content schema

Supply 2–5 tables. Each has a schema-qualified name, ordered column list, exact SQL type, and optional constraint flags such as primary key, foreign key, unique, and not-null. Include at most 8 displayed columns per table, with an explicit “N more” row if the table is shortened. Declare foreign-key source and target column IDs and the referential action. Optionally list only story-relevant indexes. Keep names distinct and preserve the actual database spelling.

## Deterministic layout recipe

Use a 1000px-wide canvas with a 24px table gutter and a fixed table width derived from the longest displayed identifier, capped at 260px. Put tables in stable schema and table-name order, then place related tables in nearby columns. Each header is 40px; each column row is 24px. Use these fixed row centers as connector anchors. Draw schema boundaries first, then FK routes, then table surfaces, rows, constraints, and labels.

Foreign-key lines connect the center of the actual source column row to the center of the referenced row. Use rounded orthogonal routes with an 8px bend and reserve 12px separation for multiple edges. When edges share a column-row anchor, fan their starting points symmetrically within that row. Give each edge a short referential-action label with an opaque background mask. Grow the canvas or split the schema rather than allowing routes to cross table text.

## Encoding rules

Use typography and constraint labels, not color, to distinguish column roles. Keep SQL types in a mono role aligned to the right. Show PK, FK, UQ, and NN tags only where they help the review. Accent only one consequential delete action and its affected table header, if the schema contains such a rule. Indexes belong in a separate final compartment and are limited to those relevant to the claim.

## Korean behavior

Keep physical table, column, constraint, and SQL type names exact; do not translate identifiers. Use Korean notes for business meaning and explain database-specific abbreviations once. Use Pretendard for explanatory labels and mono for SQL. Do not force Hangul into narrow type/name columns; grow table width or wrap only descriptive text. Use the literal SQL action spelling in FK labels.

## Light, dark, and full variants

Light uses clear row separators and a subtle alternating row tint. Dark rebuilds table, row, and connector contrast with dark-surface tokens and preserves the same schema. Full adds title, migration context, and a brief impact note outside the tables. It must not silently add columns or relationships.

## Accessibility

Include a textual schema summary and a table representation with column names, types, and constraints. The SVG description should identify the tables and important FK actions. Ensure PK/FK meaning is available as text rather than hue. Keep row labels and action labels readable at export scale. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for table clipping, route collisions, contrast, accessibility, and visible text. Run scripts/verify-type.mjs --type=db-schema for row-anchor alignment, FK resolution, constraint labels, and table/column budgets. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Drawing every column from a large production database.
- Connecting table boxes instead of the specific foreign-key rows.
- Omitting SQL types or referential actions that are the subject of the review.
- Mixing conceptual entity names with physical table names.
- Coloring every table or listing every index.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
