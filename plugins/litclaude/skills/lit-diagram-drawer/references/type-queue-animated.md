# Fan-in queue and bottleneck

**Catalog ID:** `queue-animated`  
**Semantic pattern:** fan-in queue / bottleneck; visual grammar: data flow.  
**Common references:** [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Semantic patterns](semantic-patterns.md) · [Motion](motion.md) · [Korean typography](korean-typography.md) · [PPTX/DOCX](office-pptx-docx.md) · [Verifier guide](verifier-guide.md)

## Purpose and selection

Use this pattern when several sources compete for one limited service point and arrival rate, queue depth, capacity, waiting, or backpressure explains the outcome. It combines a static capacity diagram with an optional step reveal. Use Process when successive service stages dominate and source contention is secondary; use Sankey when conserved quantity splitting/merging is the central claim.

## Exclusions

Budget: at most five sources, five visible queue slots, one bottleneck, two outcomes, and nine primary nodes. Aggregate extra sources into a named cohort. The queue is ordered FIFO unless the input explicitly says otherwise. Animation may reveal events but may not reorder items. Do not animate purely decorative traffic or imply capacity only through box size.

## Content schema

```yaml
title: "Ingress under a burst"
producers:
  - { id: web, label: Web client, rate: 4, unit: "requests/s", pattern: steady }
  - { id: webhook, label: Payment hook, rate: 8, unit: "requests/s", pattern: burst }
queue: { label: Ingress buffer, discipline: FIFO, capacity: 5, unit: slots }
slots: [{ id: q1, item: "GET /orders", step: 1 }, { id: q2, item: "POST /auth", step: 1 }, { id: q3, item: "POST /payment", step: 2 }, { id: q4, item: "ERP batch A", step: 2 }, { id: q5, item: "ERP batch B", step: 2 }]
static_occupancy: 5
overflow_rate: { value: 4, unit: "requests/s" }
service: { label: Worker, capacity: 8, unit: "requests/s" }
outcomes: [{ id: admitted, label: Admitted }, { id: shed, label: "429 · backpressure" }]
steps: ["arrivals", "queue full", "backpressure", "service", "equilibrium"]
```

Include rates with units, queue capacity and discipline, a constrained service rate, each outcome, and the static queue state. Each step must be derived from the scenario; all slot states and occupancy counts must agree. Keep status words such as `FULL` or `SHED` alongside the numeric count.

## Deterministic layout recipe

Use a wide 1160×640 canvas. Reserve a left column for distinct producer cards, a central column for a bounded queue with one visible slot per unit of capacity, and a right column for the constrained worker and downstream destination. Place an overflow/backpressure sink above or below the worker, outside the queue's main route. Producers enter at separate fixed y coordinates; route each ingress line to its assigned slot so fan-in remains traceable. Use a single queue-depth badge aligned to the full slot stack. Add an equilibrium summary below the queue and a compact legend along the footer. Step groups may add arrivals, fill slots, activate the overflow route, and show service, but every frame uses the same positions and item order. Keep a complete final frame as the default export.

## Encoding rules

Label every flow rate and capacity with units. Distinguish admitted traffic, overload traffic, and rejected/deferred output using line style and text as well as color. The queue's count is `occupied/capacity`, not a decorative badge. Show a visible sink for rejected work and a path for admitted work. Use one accent to direct attention to the bottleneck or overload path; do not color every producer. Static fallback shows the representative queue state, capacity, service rate, and both outcomes at once.

## Korean behavior

Keep API paths, HTTP codes, rate units, and queue policies intact. Korean captions should use compact verbs and nouns, with the count and unit kept together (for example, `5/5칸`, `초당 8건`). Avoid line breaks inside identifiers. The accessible summary must explain steady versus burst arrivals in Korean and preserve item order.

## Light, dark, and full variants

Light/dark retain identical sources, rates, queue occupancy, routes, step sequence, and final frame. Change only shared tokens. The full variant may add one editorial frame and a short operational takeaway outside the queue drawing. Static, reduced-motion, and print/export views show all essential routes and the final queue state; no conclusion may depend on animation.

## Accessibility

The SVG description states source count, queue discipline/capacity, service limit, and admitted/rejected outcomes. Include a linear reading list of producers, ordered slots, service rate, and outcomes. Step controls must be keyboard-accessible and announce the current event. Status uses text plus shape/border; color alone never means full, blocked, or overloaded. Follow the full keyboard, reduced-motion, focus, and no-JS contract in [Motion](motion.md).

## Verifier gates

Run `node scripts/verify-diagram.mjs` for node/arrow overlap, clipping, bounds, contrast, skin, accessibility, and visible-text checks. Run `node scripts/verify-type.mjs --type=queue-animated` for the registered fan-in contract: producer/service units, queue occupancy/capacity, outcomes, and route semantics. Run `node scripts/verify-motion.mjs` for ordered deterministic steps, complete static frame, reduced-motion behavior, and working controls. See [Verifier guide](verifier-guide.md). See that the gallery wrapper’s `data-type` value matches this exact Catalog ID; a missing or mismatched marker is not a passing type check.

## Anti-patterns

- Equal-width pipeline that hides fan-in or arrows merged before their sources can be traced.
- Queue occupancy inferred from box size, a count above capacity, or capacity without units.
- Decorative pile-up, changing FIFO order, or a blocked path that rejoins the admitted route.
- More than five sources/slots, one or more hidden outcomes, or red as the only overload cue.
- An animation whose static frame does not explain why work waits.
