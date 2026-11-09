# Data Lake Overview

**Catalog ID:** datalake

## Purpose and selection

Use this high-level architecture variant to explain an unclustered data-lake stack from external sources through ingestion and storage to query and consumers. It is suited to an end-to-end orientation where the lake is the central point of the story and no container-orchestrator boundary is needed. Use the high-level architecture type when deployment cluster and cross-cutting concern strips are essential. Use DP integration when each integration endpoint and protocol must be inventoried.

## Content schema

Declare ordered phases, normally Sources → Ingest → Data Lake → Query → Consume. List external inputs, ingestion components, the lake/store, query or transform tools, and downstream consumers. Each component has a stable ID, phase, visible name, optional sublabel, and optional icon key. Declare directed connections, label the important data transfer, and identify one focal lake/store. Include only the systems needed to explain this path; record any omitted platform services in a caption.

## Deterministic layout recipe

Use a 1000 × 488 viewBox. Place five phase zones at y=32: Sources x=4 w=160, Ingest x=176 w=160, Data Lake x=380 w=184, Query x=600 w=168, and Consume x=804 w=164. These fixed gutters leave room for orthogonal routes. Put phase names at each zone center near y=44. Use 56px-high component nodes; align the common node rows at y=60, 164, and 268, leaving an 8px gap within the 104px pitch. The consumer zone may use all three rows, source and query zones generally use two, and the lake zone holds one focal storage node. If node counts exceed these slots, split the overview instead of compressing them.

Draw zone surfaces first, then arrows, then nodes. Use straight segments only for aligned endpoints; otherwise use rounded right-angle paths. Sort routes by source then destination ID. The central storage node is the single accent target. Reserve the lower band below y=312 for the occasional return/write-back path and the legend. Do not change phase widths to emphasize a vendor; use focal styling for the store.

## Encoding rules

Phase position carries sequence. A boundary distinguishes outside data sources from the platform. Neutral connectors represent movement; dashed routes are reserved for explicitly asynchronous or scheduled transfers. One accent marks the lake/store. Use icons as recognition aids only; every component still has a text name. Do not imply raw/curated quality states unless those states are supplied and named.

## Korean behavior

Use Korean phase names when useful, but retain exact product and service names. Explain “data lake” once as “데이터 레이크” or use the project's chosen term consistently. Use Pretendard for labels, mono for file formats and protocol identifiers, and keep Hangul line-height generous enough for two-line node titles. Format counts and units for ko-KR; preserve exact storage units in the data/caption.

## Light, dark, and full variants

Light uses a pale source boundary and one quiet phase rail. Dark uses a separate set of boundary and connector colors with verified contrast. Full adds one title, a one-sentence reading, and a compact legend or source note. The stack, lake focal point, scale, and system placement remain unchanged.

## Accessibility

Name the source region, central lake, and end consumers in the SVG description. Make the reading order follow the phase sequence. Icons must have adjacent text labels; don't encode source, storage, and consumer roles with icon shape alone. Provide a short text path for readers who cannot inspect the routes. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for the standard geometry, rendered clipping, contrast, accessibility, skin, and text checks. Run scripts/verify-type.mjs --type=datalake for five-phase order, focal-store uniqueness, endpoint validity, and route semantics. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Adding a Kubernetes boundary or a vertical concern strip when the brief does not need one.
- Making every phase a decorative chevron with equal visual emphasis.
- Treating the data lake as a generic database symbol without naming its role.
- Showing a source-to-consumer bus when specific paths are known.
- Introducing bronze/silver/gold semantics without evidence they exist in the system.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Semantic patterns](semantic-patterns.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
