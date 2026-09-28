# Entity–Relationship Model

**Catalog ID:** er

## Purpose and selection

Use ER for conceptual or logical data models where entities, attributes, and relationship cardinality are the core message. The edges connect entity boxes and state multiplicity at each end. Use database schema when actual SQL types, indexes, constraints, delete actions, or column-to-column foreign keys matter.

## Content schema

Each entity has a stable ID, visible name, and a short list of fields. Mark the key field and distinguish foreign-key references when useful. Each relationship has source entity, target entity, cardinality at both ends, and an optional verb phrase. Limit the view to a readable domain slice; if the drawing contains dozens of entities, split by bounded context rather than omit relationships silently.

## Deterministic layout recipe

Use a 1000px canvas with 32px margins. Place a central aggregate or focal entity near the horizontal center. Place directly related entities in the nearest surrounding columns; use a stable order by domain or name to position peers. Entity boxes have a header band and a naturally sized field list; do not pad all boxes to equal height. Draw relationship lines before entity surfaces. Route edges with rounded orthogonal elbows where possible, and use straight horizontal or vertical routes for aligned entities. Put cardinalities just outside each entity boundary and labels near the line midpoint with an opaque background.

When relationships exceed the available space, use clusters and a legend or split the domain. Use arrows only if direction has actual domain meaning; cardinality is required whether or not an arrow is present.

## Encoding rules

The entity name is primary; fields are secondary. Use explicit PK and FK text markers rather than color. Cardinality values must use one notation consistently and appear at both ends. One central entity may receive accent emphasis. Relationship names are optional but should be concise verbs such as “places” or “belongs to”.

## Korean behavior

Use Korean for domain names and relationship verbs when the team models in Korean. Keep database/API identifiers exact in parentheses or technical sublabels. Use Pretendard for entity names and Korean descriptions, mono for field IDs and key markers. Do not translate cardinality symbols; accompany them with a Korean accessible explanation if the audience needs it. Wrap Korean fields at safe word boundaries.

## Light, dark, and full variants

Light uses a quiet field, crisp entity dividers, and one focal entity. Dark uses separate text, field, and connector tokens with verified contrast. Full adds a short model scope and a note describing any omitted subdomain; it does not add decorative cards behind every entity. Entity placement and relationship semantics remain identical.

## Accessibility

Provide a text or table alternative listing entities, fields, and each relationship's two cardinalities. Include an accessible description of the model boundary and focal entity. Ensure key status is stated textually and not only through color or position. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for edge overlaps, clipping, contrast, labels, and accessibility. Run scripts/verify-type.mjs --type=er for entity/relationship reference integrity and cardinality presence and consistency. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Drawing every foreign key as an edge on a very large model.
- Mixing physical SQL details with a conceptual domain model.
- Using inconsistent cardinality notation across related edges.
- Filling entity boxes with padding just to make their heights match.
- Omitting one endpoint cardinality or relying on line shape to imply it.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
