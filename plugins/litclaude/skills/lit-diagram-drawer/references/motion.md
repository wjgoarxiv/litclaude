# Motion for diagrams

Static output is the default. Add motion only when it clarifies origin, order, or a meaningful state change. If removing motion loses no information, leave it out.

## Motion contract

For every transition, record its trigger, property, duration, easing, interruption behavior, and reduced-motion result. Prefer transform and opacity. Do not animate layout geometry continuously or delay access to the final state.

- Direct feedback: 100–150ms.
- Entry or exit: 200–300ms.
- Layout transition: 300–400ms.
- Stagger: 20–40ms, at most five items.
- Keep at most two elements moving at once.
- Allow replay, pause, and keyboard operation for user-controlled sequences.
- Never autoplay a loop that competes with reading.

Use the named curves from the humanizer motion guide when appropriate: enter cubic-bezier(0.16, 1, 0.3, 1), UI cubic-bezier(0.2, 0.8, 0.2, 1), exit cubic-bezier(0.4, 0, 1, 1). A diagram does not need motion simply because these values exist.

If a viewport reveal is useful, trigger near 15% visibility with about a 10% bottom root margin, play once, and keep the final content visible when observation is unavailable.

## Reduced motion and exports

Under prefers-reduced-motion: reduce, show the complete final state immediately. Remove travel, parallax, tilt, flashing, and looping. An instant state change or brief opacity change is acceptable.

The initial HTML must be complete without JavaScript. Print, screenshots, PNG exports, and Office SVG exports capture the final static state. No label, relationship, or result may appear only during animation.

## Proof

Check the motion verifier and test with reduced motion enabled. Confirm keyboard focus and control labels. Export at least one frame after fonts load, and confirm that export forces the static final state.
