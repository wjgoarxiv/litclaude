Brand and imagery are contract decisions, not taste. Every asset traces to an authorized input,
a written specification, and an `inventory.references` entry with its own `sha256` and
provenance.

## Authorized brand inputs

Use what the user handed you or what the repository already holds. Anything else is rework.

- tokens, theme files, or CSS custom properties already in the repository
- a brand guideline document or style page the user pointed at explicitly
- logo, icon, and font files present under the repository's asset paths

Report `BLOCKED` when a brand name, legal mark, asset license, or final identity decision needs
an approval you do not have.

## When no brand exists

Do not invent an identity. Build a neutral system a real brand can replace at one seam.

- a single accent role, defined once as a token and referenced everywhere
- a neutral ramp derived from one hue with fixed contrast steps
- a system font stack with an explicit per-script fallback
- geometric placeholder marks, never a wordmark that reads as a company name
- record the neutral choice under `accepted_exceptions` with an owner

## Qualities into interface decisions

Convert each adjective into something a reviewer can measure.

| Quality | Concrete expression |
|---|---|
| Precise | 4px grid, 2px radius, single-weight borders, tabular numerals |
| Calm | one accent, two type weights, motion at or under 200ms |
| Dense | 32px rows, 8px gutters, inline row actions, no nested cards |
| Authoritative | high contrast, wide margins, restrained accent, no gradient |

## Specifying a generated reference image

A generated image specifies intent. It is never evidence that an interface exists. Say so
wherever it appears.

- name the file `spec-*` or `reference-*`; never `screenshot-*`, `capture-*`, or `proof-*`
- state subject, framing, palette constraint, and the exact text that must be legible
- state what must not appear: logos, real people, trade dress, invented metrics
- record it as reference kind `generated`, with the tool and the date in its provenance
- keep it out of the verification receipt; only a real capture proves behavior

## Reference frames

Fix dimensions and a safe area before requesting or producing an image.

- hero 16:9, 8% inset on all sides kept clear for overlaid text
- card 4:3 or 4:5, subject centered, no text rendered into the raster
- diagram: fixed `viewBox`, no raster text, theme-following strokes

## Asset production record

Keep one row per asset so a reviewer can trace and reproduce it.

- path, pixel dimensions, format, byte size
- origin: repository, user-supplied, or generated
- the generating prompt or the source URL, plus tool and date
- license or permission basis, naming the party that granted it
- accessible name, plus a long description when the image carries information

## Identity safety

Never produce an asset or page that could pass for a real organization's own material.

- do not reproduce a third-party logo, wordmark, licensed typeface, or trade dress
- do not generate a likeness of a real person or an endorsement that was never given
- do not fabricate testimonials, review counts, certifications, or performance figures
- if the request is a lookalike of a real product, stop and confirm the intent first

## Validation before assets ship

Check each asset against the surface that will render it, not against the design file.

1. Contrast: overlaid text against the image's darkest and lightest regions.
2. Theme: render in light, dark, and forced colors.
3. Degradation: alt text, failed load, and slow-network placeholder.
4. Weight: hero under 200KB, card under 80KB, icon under 8KB.
5. Layout: intrinsic width and height declared, so loading causes no reflow.

## Failure patterns

Reject:

- a generated image filed, named, or captioned as a screenshot
- text baked into an image, where it cannot be translated, scaled, or read aloud
- decorative imagery given a descriptive alt string, or informative imagery given none
- an asset with no license basis, or a mark reused because it "looks generic"
- brand adjectives carried into implementation with no concrete expression behind them
