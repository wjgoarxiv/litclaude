# Secure paved-road architecture

**Catalog ID:** `paved-road-animated`  
**Semantic pattern:** secure paved road; visual grammar: Architecture.  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Semantic patterns](semantic-patterns.md) · [Motion](motion.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use this pattern when a supported deployment route must be distinguished from forbidden ingress or bypass attempts. Make trust boundaries, actor identities, the privileged approval gate, isolated runtime, and audit destination explicit. It is an Architecture diagram with optional step reveal; it is not a new free-form flowchart. Use a regular Architecture figure when trust enforcement and allowed/blocked routes are not the point.

## Exclusions

Keep to at most three trust zones, eight components, ten paths, two blocked paths, and one privileged gate. Do not show credentials or secret values. A denied path must stop at the boundary; it must not reach the protected runtime or rejoin the authorized route. Use a separate governance/control catalog when detailed controls and exceptions exceed the one-gate overview.

## Content schema

```yaml
title: "Secure deployment route"
zones:
  - { id: public, label: Public ingress }
  - { id: build, label: Build and governance }
  - { id: production, label: Isolated runtime }
components:
  - { id: developer, zone: public, label: Developer, identity: Signed commit }
  - { id: attacker, zone: public, label: Untrusted client }
  - { id: pipeline, zone: build, label: CI pipeline }
  - { id: gate, zone: build, label: Policy gate, role: privileged-gate }
  - { id: audit-log, zone: build, label: Audit log }
  - { id: api, zone: production, label: Production gateway }
  - { id: db, zone: production, label: Core database }
  - { id: soc, zone: production, label: Security monitoring }
paths:
  - { id: deploy, from: gate, to: api, kind: permitted, label: Approved artifact }
  - { id: bypass, from: attacker, to: production-boundary, kind: blocked, label: Denied at boundary }
  - { id: audit, from: gate, to: audit-log, kind: audit }
  - { id: monitoring, from: audit-log, to: soc, kind: audit }
steps: ["signed intake", "build and sign", "gate approval", "blocked bypass", "audit record"]
```

Every component belongs to one labeled zone. Each path declares endpoints, permitted/blocked/audit meaning, and a text label where the meaning is not self-evident. Keep identities as roles or claims, never secret values. `steps` are a reveal order over existing facts, not a second data model.

## Deterministic layout recipe

Use a wide 1160×620 canvas. Allocate three equal vertical trust-zone bands from left to right, separated by strong, labeled boundary rules; if a design has fewer zones, distribute them evenly and keep zone width equal. Put public actors in the first band, build/approval components in the middle, and runtime/data components in the last. Place the privileged gate before the production boundary. Route authorized deployment through that gate and across the boundary; route each blocked attempt to a stop marker just before the boundary. Place audit logging as a separate destination reachable from the approval gate and relevant boundary event, with the monitoring consumer downstream. Draw zone surfaces first, then connectors, then components and labels. Fix component positions across all variants and motion steps. Motion groups reveal the signed input, build/sign, approval/deployment, blocked attempt, and audit event in that order; the final static frame contains all routes.

## Encoding rules

Permitted paths are solid and labeled; blocked attempts use a contrasting dash pattern plus a stop symbol and label; audit events use their own consistent line style. The route and wording carry status as well as color. Accent the single enforcement focus (gate or blocked result), keeping the remaining components neutral. The trust-zone boundary is a structural line, not a decorative container. Show no connector crossing that suggests an unauthorized route entered production.

## Korean behavior

Use short Korean zone titles and actor names; preserve security terms, identity claims, product names, API names, and protocol codes. Keep positive route text distinct from blocked route text with direct verbs. The final description should summarize both approved and rejected paths in Korean. If a Korean note is longer than the available band, move it to a callout outside the zones instead of reducing type.

## Light, dark, and full variants

Light and dark preserve zone order, paths, stop points, and focus; only shared palette tokens change. The full variant may add a compact “why this route is trusted” note outside the architecture bands. All static exports show every boundary and both route classes. Optional motion must use the same final geometry and must not animate a blocked path through a boundary.

## Accessibility

Give the SVG title and description that identify the trusted path, the blocking boundary, the privileged gate, and audit destination. Provide a text alternative listing each permitted and blocked route as `from → to → result`. Patterns, stop symbols, and labels distinguish route classes without color. Step controls are keyboard-operable, announce their state, and preserve a complete no-motion rendering; follow [Motion](motion.md).

## Verifier gates

Run `node scripts/verify-diagram.mjs` for geometry/overlap, boundary/path bounds, clipping, contrast, skin, accessible SVG, and visible-text checks. Run `node scripts/verify-type.mjs --type=paved-road-animated` for the registered secure-route contract: zone/path budgets and allowed-versus-blocked boundary semantics. Run `node scripts/verify-motion.mjs` for static-first output, ordered deterministic reveals, reduced-motion fallback, and final-frame parity. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- A box labeled “security” with no route or enforcement meaning.
- A blocked arrow that crosses into production or visually rejoins an allowed path.
- Unlabeled actor identity, an implied secret, or every component styled as equally trusted.
- More than three zones, eight components, ten paths, or one privileged gate in the overview.
- A color-only denied state, decorative motion, or an animated final state unavailable in a still/export.
