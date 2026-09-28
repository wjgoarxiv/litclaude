# Data Platform Security Matrix

**Catalog ID:** dp-security-matrix

## Purpose and selection

Use a permissions matrix to audit which roles can perform which actions on data-platform components. Rows are resources; columns are roles or groups. Choose DP integration when the question is which systems connect and by what protocol. Choose a process or sequence type when explaining how access is granted.

## Content schema

Declare 2–6 ordered roles and 2–14 ordered components. Each role has a visible name and optional group identifier. Each component has a name and optional short hint. Supply a complete permission for every role/resource pair; omitted cells mean the declared “no access” state only when that is factually correct. Use a closed permission class: full/admin, read-write, read, or none. Display text can be “SELECT”, “Login”, or a domain term, but its class must remain explicit. Mark zero or one focal cell and optionally add a short explanation line.

## Deterministic layout recipe

Place the resource-name column first, then role columns. Reserve 208px for resources, 148px for each role column, 16px column gaps, 12px left padding, and 48px right padding. Role header height is 52px. Start resource rows at y=140; use 40px row pitch and 36px cell height. Derive width from the role count and height from the resource count, then place the legend below the final row. Keep values centered in cells and component names left aligned.

Each cell uses the same border and text alignment. Differentiate permission classes with a restrained fill and explicit displayed permission words. Draw no arrows. If six roles or fourteen resources are exceeded, split the matrix by role family or platform domain.

## Encoding rules

Cell text is the policy; tone is only reinforcement. Use the same class-to-style mapping in every row and every theme. Accent a single critical rule, not a whole row or column. Show a legend only for permission classes present. Distinguish unknown or unreviewed access from “none”; never turn missing evidence into an implied denial.

## Korean behavior

Use Korean role names and resource hints where the organization uses them. Preserve group IDs, database permissions, and exact role names as technical identifiers. Use Pretendard for Korean headers and mono only for literal group or permission codes. Keep all cells tall enough for Hangul; if labels need two lines, increase the shared row height rather than shrinking one cell's text.

## Light, dark, and full variants

Light uses neutral cells and one accent focal cell. Dark uses a dark surface with distinct permission-class tones, visible cell boundaries, and readable text; check all classes for contrast instead of reusing light fills. Full adds a title, scope, and a concise legend; it must not imply unlisted permissions. Keep matrix dimensions and all values fixed between variants.

## Accessibility

Expose the matrix as a semantic table or provide an equivalent table next to the SVG. Give column/row headers proper associations. Permission meaning must appear as text and not color alone. The description should name the focal access rule and state how “no access” is represented. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for contrast, text clipping, accessibility, and theme checks. Run scripts/verify-type.mjs --type=dp-security-matrix for complete cell coverage, closed permission classes, matrix bounds, and focal-cell limits. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Drawing connectors between cells.
- Treating an omitted or unknown permission as “no access”.
- Highlighting whole rows or columns when one intersection is the claim.
- Adding unrestricted free-form categories that make styles incomparable.
- Cramming an organization-wide role list into unreadable columns.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
