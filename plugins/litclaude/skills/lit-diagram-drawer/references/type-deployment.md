# Deployment

**Catalog ID:** deployment

## Purpose and selection

Use deployment to show where software runs: environments, network zones, hosts, pods, managed services, artifacts, versions, replicas, and protocol paths. The placement decision must be visible. Use architecture when only logical communication matters and deployment placement adds no answer.

## Content schema

Declare up to 3 actual zones, each with an environment or network-boundary meaning. Each infrastructure node has a stable ID, type (host, VM, pod, managed service, CDN), zone, and name. Each artifact has a deployed version. A node may have a replica count. Edges record protocol and port, and optionally mark asynchronous or replication traffic. Limit the drawing to 6 infrastructure nodes, 9 artifact labels, and 8 network paths.

## Deterministic layout recipe

Use three nested levels in a 1000px-wide viewBox: outer zone, infrastructure node, then artifact chips within a node. Preserve zone order from public/edge to private/data unless the brief specifies another direction. Divide the interior of each zone into columns by declared node order; center nodes in their column and distribute vertically with fixed 24px gaps. Keep artifact chips in a stable version/name order, with 8px spacing. Put a replica badge inside the owning node.

Draw zone boundaries first, then orthogonal network routes, then node frames and artifact rows. Use right/left ports for mostly horizontal paths and top/bottom ports for vertical paths. Label each path with protocol and port on a masked paper strip. A route crossing a zone boundary can use the link color; within-zone traffic remains neutral. Async or replication paths use a dashed stroke.

## Encoding rules

The boundary represents a real environment/network boundary, not just grouping. Node type is stated with a small text tag; artifact names carry explicit version values. Replicas are shown as one node plus a count, never cloned cards. Use at most two accent targets for a new component or a single point of failure and its consequential replication route.

## Korean behavior

Use Korean zone captions if the deployment audience works in Korean. Preserve cloud regions, hostnames, ports, image tags, and protocol names exactly; explain abbreviations in Korean nearby. Use Pretendard for descriptions and mono for versions, ports, and image identifiers. Keep counts as numerals and format dates/versions as technical tokens, not localized prose.

## Light, dark, and full variants

Light uses quiet zone fills with dashed boundary strokes. Dark redraws the zone tint and network paths for clear separation; never simply invert the light SVG. Full adds a title, deployment scope, and short legend outside the nested zones. Node count, zone placement, versions, and path endpoints must remain unchanged.

## Accessibility

Describe each zone's meaning, hosts/artifacts, replica counts, and the important network paths. Keep a text list of deployments and protocol/port values available. Every host icon has an adjacent name; boundary meaning is expressed with a label and line pattern, not hue alone. See [Accessibility](accessibility.md).

## Verifier gates

Run scripts/verify-diagram.mjs for nested-boundary geometry, rendered clipping, contrast, accessibility, and text. Run scripts/verify-type.mjs --type=deployment for node/artifact/path limits, version tags, replica counts, and endpoint placement. See [Verifier guide](verifier-guide.md).

## Anti-patterns

- Repeating a logical architecture and sprinkling hostnames on top.
- Drawing a zone without a real trust or environment meaning.
- Omitting versions from deployed artifacts.
- Drawing one node for each replica.
- Replacing named infrastructure with a wall of vendor logos.

## Shared references

[Style guide](style-guide.md) · [Output specification](output-spec.md) · [Icons](primitive-icons.md) · [Korean typography](korean-typography.md) · [Accessibility](accessibility.md) · [Verifier guide](verifier-guide.md) · [PPTX and DOCX](office-pptx-docx.md)
