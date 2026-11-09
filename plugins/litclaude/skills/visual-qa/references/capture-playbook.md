A capture is an observation with an identity attached, not a picture. Each section names what to
record, what voids it, and the code for an unreachable channel. An absent channel blocks; a channel
that ran and showed a defect fails.

## Bind identity before capturing anything

Record these first. A capture made before they exist cannot be attributed later.

- The design-contract SHA-256 and the source revision the artifact was built from.
- Every `capture_environment` field the manifest schema requires, in full, never a subset.
- The accountable owner of any test authentication, as a role, never as a credential.
- One capability probe result per channel this run will use.

Name the renderer and its process owner concretely. A placeholder in either field means ownership was
never established: emit `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`.

## Web surfaces

Capture declared routes at declared widths, in each declared state, after the page settles.

- Capture: full-page and region artifacts per route, plus loading, empty, error, disabled, and
  recovery states; one per inventory entry.
- Invalid when: fonts or async data had not settled; an overlay or inspector panel is in frame; the
  crop excludes the defect; reused after a source, fixture, or viewport change.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when no approved renderer is callable this session. Static
  markup review never converts into a capture.

## Terminal and TUI surfaces

Capture the byte stream and the grid it rendered into. One without the other proves nothing.

- Capture: raw output plus exact columns, rows, locale, and color availability; selection, focus,
  status, error, and help states; the narrowest supported width.
- Invalid when: columns are unrecorded, so overflow cannot be computed; escapes were stripped before
  the analyzer saw them; the stream passed 1 MiB or 4,096 lines and was truncated.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when no terminal renderer is callable. Re-typing observed
  output is authorship, not capture.

Run each TUI artifact through `cli.mjs tui-check` at the recorded width before reading it.

## Reference-fidelity work

Capture a pair whose halves are genuinely comparable.

- Capture: the reference with provenance and hash; the actual at the same dimensions, state, color
  scheme, and font availability.
- Invalid when: dimensions differ, so no overlap metric exists; the reference is a shot of the build
  under test; provenance is unclear; the halves differ in state.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when the actual cannot be rendered. A dimension mismatch
  is not blocked; it fails, with explicit null metrics.

## Motion

Capture endpoints and the interruption, never a description of the feel.

- Capture: the state before the trigger, the settled state after it, the mid-flight interrupted
  state, and the same sequence under reduced motion.
- Invalid when: only the settled state exists; reduced motion was reasoned about, not captured;
  completion was inferred from the animation ending.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when the renderer cannot hold or step a transition. Do not
  call the endpoints motion coverage.

## Responsive width sweeps

Capture one width below and one above every structural boundary the contract declares.

- Capture: each declared viewport, both sides of each boundary, the longest realistic content, and a
  reduced-height landscape frame. Log every cell run.
- Invalid when: widths are device names rather than measured pixels; boundaries came from framework
  defaults; a swept cell is claimed with no artifact.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when the renderer cannot set a viewport. A resized window
  with an unrecorded scale factor is an unverifiable width.

## Accessibility channels

Capture operability, not appearance. Each criterion is its own result with its own artifact.

- Capture: keyboard traversal order, focus visibility at every stop, each programmatic name,
  error-to-field binding, measured contrast, forced-colors and zoom frames.
- Invalid when: a screenshot stands in for a name, role, or announcement; contrast was eyeballed; a
  criterion has no artifact identifier.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when the accessibility renderer channel is not callable. Mark the
  criterion blocked; never pass it on a visual capture.

## CJK and IME text

Capture composition, not only committed text. Width and commit behavior fail separately.

- Capture: Korean, mixed-script, and combining-mark content at the narrowest width; wide-glyph cell
  accounting; the pre-edit string mid-composition; the committed result; candidate overlap.
- Invalid when: only committed text exists, so composition is untested; a font fallback substituted
  glyphs with the font set unrecorded; wide characters counted as one cell.
- Blocked as: `BLOCKED_RENDERER_UNAVAILABLE` when no input-method renderer channel is callable. Pasting bypasses
  composition and cannot stand in for it.

## Authentication-limited surfaces

Capture protected routes only through an account that is safe to exercise and reversible.

- Capture: account class, scope, accountable owner, reset procedure, and a receipt for anything
  seeded.
- Invalid when: tokens, cookies, session identifiers, or private bodies land in evidence; a protected
  route was swapped for a public mock without the scope accepting it.
- Blocked as: `BLOCKED_AUTH_UNAVAILABLE` when approved authentication cannot reach the route.
  `BLOCKED_TEST_ACCOUNT_UNSAFE` when the only account is personal, production, privileged, or
  non-resettable. Never trade one code for the other.

## Closing every run

Release what the run created, then describe it accurately.

- Every server, browser process, profile, capture directory, trace, and seeded record carries an id,
  a state, and a receipt.
- `BLOCKED_CLEANUP_INCOMPLETE` when a resource leaked and cleanup could not finish.
- `BLOCKED_EVIDENCE_STALE` past the freshness bound or on a source-binding change, and
  `BLOCKED_EVIDENCE_FUTURE` when an artifact is dated ahead of the clock.
- `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE` when a tier requiring independence cannot get it.

## Failure patterns

Reject:

- A capture with no recorded viewport, width, locale, or renderer.
- An absent channel written up as a pass instead of its blocker code.
- A blocker chosen for being milder than the one the condition names.
- Cleanup declared complete while a named resource is still held.
