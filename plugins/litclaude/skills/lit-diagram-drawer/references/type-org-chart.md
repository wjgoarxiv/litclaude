# Org chart and responsibility map

**Catalog ID:** `org-chart`  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use Org chart when the reader needs to know who owns work, how to invoke an owner, where escalation goes, or which responsibility is still unstaffed. It supports people, teams, agents, queues, and accountable roles. Use Tree for a generic hierarchy where ownership and invocation are irrelevant; use Swimlane or Process for work that moves over time.

## Exclusions

This grammar shows one reporting or responsibility parent per node. It does not show arbitrary dependencies, many-to-many assignments, timelines, or task steps. A missing owner is not an ordinary active node: represent it as a visibly optional/setup gap. Cross-functional routing belongs in a separate flow diagram.

## Content schema

```yaml
title: "Support ownership"
nodes:
  - { id: intake, name: Support desk, kind: front-door, invocation: "/help", scope: "Triage · routing" }
  - { id: platform, parent: intake, name: Platform pod, kind: team, invocation: "#platform", scope: "Runtime · deploys" }
  - { id: identity, parent: platform, name: Identity owner, kind: owner, invocation: "IAM queue", scope: "Login · access", status: active }
  - { id: after-hours, parent: intake, name: After-hours owner, kind: owner, invocation: "—", scope: "Not assigned", status: gap }
escalations: ["Security approval required for production access"]
```

Each node has a stable ID, visible name, parent (except the single root), role kind, concise scope, and optional invocation route. `status` is `active`, `optional`, or `gap`; never imply a gap is staffed. Use at most two short escalation notes outside the tree.

## Deterministic layout recipe

Use a top-down layout. Put the root at the first tier, then children in stable input order at each next tier. Place every tier on a shared y baseline and distribute its node centers evenly from the left safe margin to the right safe margin; compute each tier's x positions from its child count, not from manual nudges. Draw connectors first: vertical drop from each parent to a horizontal bus, then vertical drops to its children. Use right-angle paths and leave enough space between tiers for the bus and labels. Keep nodes the same width within a tier; size the canvas from the largest measured label plus fixed padding. Cap the view at 12 visible nodes, 4 tiers, and 5 direct reports per parent. Group larger teams into a pod node and link a second detail chart.

## Encoding rules

Give one root/front door the focal treatment. Team/pod nodes use the neutral team treatment; owner nodes use the owner treatment; approval gates use the security treatment but remain separate from reporting lines. Dashed outlines distinguish optional or unconfigured roles. Each node should answer name, invocation, and scope in that order; omit an unavailable invocation as an explicit unavailable marker. Put escalation notes in a side callout or footer, never as phantom reports. No arrows or connector labels are needed for a pure org chart.

## Korean behavior

Use Korean role names and scope words where that is the team's language. Keep handles, slash commands, queue names, and IDs in their original spelling and do not break them across lines. Use one or two intentional name lines and no more than two short scope lines. Keep labels centered in identical node geometry across languages; if the text does not fit, shorten the role or split the chart by pod.

## Light, dark, and full variants

Light and dark share the same tree, node dimensions, and status encoding. Change only shared tokens; keep dashed gaps dashed and keep the single focal owner consistent. The full variant may add an editorial heading and a compact escalation note or coverage summary below the same chart. It must not add people or alter responsibility to fill the frame.

## Accessibility

Use a titled SVG with a description of the root, reporting direction, and any visible coverage gap. Provide a linear text list in DOM order: parent before children, with each node's name, invocation, scope, and status. Do not encode active/gap distinctions by color alone. Connector contrast must meet the shared non-text contrast rule, and node text must remain readable at slide scale.

## Verifier gates

Run `node scripts/verify-diagram.mjs` for overlaps, label clipping, canvas bounds, contrast/skin polarity, SVG title/description, and visible-text checks. Run `node scripts/verify-type.mjs --type=org-chart` to validate the catalog marker. Review root/parent links, tier and report limits, node status, and orthogonal ownership connectors against this guide. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Using a process lane when the question is ownership, or a reporting tree when the question is sequence.
- More than 12 nodes, 4 tiers, or 5 reports under one parent without splitting.
- Treating an unconfigured owner as active or hiding the gap entirely.
- Identical boxes for the front door, team, owner, and approval role.
- Job-description paragraphs, repeated handles in callouts, diagonal lines, or floating legends.
