# Visual reconstruction from references

A reference image shows one state at one viewport, rendered by a stack you may not know.
Rebuild semantic, responsive markup and tune it toward the reference. Never use a screenshot
as the page background or as a substitute for real content.

## Measure the frame

Record the image dimensions and device scale. Measure the main content width, outer margins,
columns, type sizes, baseline spacing, and large color regions before coding. Sample flat
interior pixels, not edges or gradients. Use the smallest spacing scale that explains the
measured gaps; do not choose values only because they look close.

Keep an internal note that separates direct observations from responsive or behavior
assumptions and states that other states are not shown. A reference does not establish
hover, focus, error, loading, or narrower layouts. Add those states from the product's
interaction contract or ask about a material unknown. Do not place observation labels on
the interface itself.

## Rebuild meaning and assets

- Use heading elements in outline order, real navigation lists, and selectable text.
- Do not reproduce contrast failures or suppress visible keyboard focus.
- Recreate permitted geometry, rules, simple icons, and gradients.
- Extract only assets the project is allowed to use; preserve their source resolution.
- Substitute an unavailable permitted asset at the same dimensions, or omit decoration
  that carries no information. Never recreate a logo, wordmark, or licensed photograph.

When the reference font is unavailable or unlicensed, choose a metric-compatible fallback.
Compare cap height, x-height, and advance width; adjust line-box metrics only when needed;
then verify that the longest real label still fits.

## Infer responsive behavior

One frame proves one width. Classify regions as fixed rail, fluid column, or centered max
width. Set breakpoints where measured content stops fitting. Decide what wraps, stacks,
collapses, or scrolls, and inspect the narrowest supported width plus one width around each
breakpoint. Keep these assumptions in the Design Contract until the user or another source
confirms them.

## Iterate against the capture

Capture the build at the reference dimensions and device scale. Compare structure, spacing,
type, then color. Fix the largest measured mismatch and recapture. Stop after three passes
that do not reduce the overall difference. A fidelity review record can retain per-region
measurements, source and output paths, unconfirmed states, and asset decisions; the normal
reader reply needs only the result and a material limitation once.

Use “pixel perfect” only when dimensions and scale match, every visible state is compared,
no unexplained measured gap remains, and the typeface and assets are approved. Otherwise
describe the measured result and the remaining mismatch plainly.
