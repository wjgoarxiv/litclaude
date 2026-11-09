# Engine contract (scene author ↔ engine)

The engine renders any output frame from its time `t` and the run's fixed parameters (seed,
samples, shutter, scale, preset). Nothing else may change a pixel: no clock, no unseeded random,
no network, no file read during the render. This is what makes a still you looked at in round 1 the
same frame the film contains, and what the determinism gate hashes.

## Pipeline

1. **Plan (Node).** The brief becomes shots and the canonical timeline (`engine/core/timeline.mjs`).
2. **Page (headless Chrome).** `engine/web/` is served from disk through DevTools Fetch
   interception; Chrome runs on the pipe transport, so no control port listens. The page gets the
   plan and the fonts (bundled, reused lit-pptx files, or the pre-warmed cache).
3. **Frame n.** For each of `samples` sub-frames at `t = max(0, n/fps + (shutter/fps)((i+0.5)/N − 0.5))`
   the shot active at that time is composited in linear HDR: background pass, grid rules or window
   chrome, the scene's marks, the glyph layer, then the filter passes in preset order. The
   sub-frames are averaged, then the post chain runs once with the middle sub-frame's overrides,
   with grain keyed to the frame's own time.
4. **Egress.** The final RGBA8 frame (rows top to bottom; alpha carries the glyph-coverage mask) is
   read back through a fenced pixel-pack buffer and sent over a WebSocket on 127.0.0.1:0. If the
   host refuses `listen`, the same buffer is pulled over CDP instead, and the report says so.
5. **Node.** Each frame is analysed (ink pixels from the mask, then alpha forced to 255), hashed
   (`rgbaSha256`), audited for flashes, logged, and piped to ffmpeg. The bytes hashed, audited and
   encoded are the same bytes.

## Scene API (`engine/web/scene.mjs`)

A scene is constructed once per shot with `ctx` (shot, preset, palette, voices, grid, terminal,
fps, total frames, seed, stroke fonts, accent window) and implements:

| Member | Contract |
| --- | --- |
| `render(f, stage)` | Draw frame `f` and return post overrides. Pure given `f` (and state, below). |
| `stateful`, `prerollMax` | Set when the scene keeps state between frames. The state must have finite memory no longer than `prerollMax`. |
| `advance(f)` | The only place state changes. Called for every sub-frame, including preroll replays. |
| `reset()` | Restore the initial state. Called when the shot is entered and after a seek. |

`f` carries `t`, `lt` (time since the shot started), `p` (0..1 progress), `start`, `end`. Beats in
a scene are anchored to `lt`, `p` or the shot's reveal steps, never a literal frame number.

`stage` provides `type` (the type kit), `glyphs` (the glyph layer; its alpha becomes the mask),
`lines` (instanced hairlines), `mark(rect, hex, id, kind)` (a filled non-glyph mark, recorded for the
action-safe and accent checks) and `record` (the frame's element and fill log).

After a seek the engine resets a stateful shot and replays `advance` over the frames inside
`prerollMax` with the same sub-frame pattern, so a seeked still equals the sequential frame.

## Post chain (fixed order)

bloom + halation → chromatic aberration → tone shoulder → grain → vignette → fade → flash →
shake/zoom → invert. All maths in linear light; the sRGB transfer happens once, in the last pass.
Scenes may override any field for their frame, never the order.

| Field | Range | Neutral |
| --- | --- | --- |
| `exposure` | > 0 | 1 |
| `bloom`, `halation`, `grain`, `vignette` | 0–1 | 0 |
| `bloomThreshold` | 0–1 | 0.85 |
| `bloomKnee`, `bloomRadius` | 0–1 | 0 |
| `ca` | px at 1080p | 0 |
| `fade` | 0–1 (opacity) | 1 |
| `flash` | 0–1; each rise above 0.1 is an event | 0 |
| `shake` | [x, y] px | [0, 0] |
| `zoom` | > 0 | 1 |
| `invert` | boolean; only on a cut, held >= 2 beats | false |

## Look-library passes

| Pass | Kind | Seed | Hard limits |
| --- | --- | --- | --- |
| `swiss-grid` | layout (hairline rules) | none | guides off in any export |
| `dither` | filter | only blue-noise mode | seed fixed for the whole shot |
| `tidal-gradient` | background | noise origin per shot | surges <= 2/s, attack and decay >= 0.1 s |
| `crt` | filter | static triad grain | flicker <= 0.06 peak-to-peak; persistence only on stateful shots |
| `glitch` | filter | hit schedule per shot | <= 2.0 hits/s, band <= 20% of the frame, one displace + one restore |
| `terminal-ui` | background (Canvas2D chrome) | cosmetic readout digit | <= 2 layers per scene |

Every pass seed is `fnv1a32("<runSeed>:<sceneId>:<shotIndex>:<pass>")` as an unsigned integer.
Across all sources a shot has at most two events (glitch hits, surges, flash rises, invert changes,
boot flickers) in any one second; the schedule is built before the first frame.

Every draw goes through one uniform-setter wrapper that logs `{frame, pass, draws, uniforms}` to
`render.jsonl`. A frame counts as covered by the look library only when some pass issued a draw.

## Software GL

If the WebGL2 renderer string contains swiftshader, llvmpipe, softpipe, lavapipe, apple software
renderer or microsoft basic render driver, the engine lowers `--samples` to 1, the tidal octaves to
max(3, floor(octaves/2)), turns crt persistence off, marks those passes `downgraded: true`, and the
report says so.

## Outputs and logs

`manifest.json` holds the canonical fields (schemaVersion, engineCredit, presetId, seed, fps,
resolution, scale, samples, shutter, renderer, softwareRenderer, chromeFlags, previewEncoder,
audioTier, bpm or beatGrid, durationSec, generatedAt, passRanges, timeline, warnings) plus
`frameCount`, `round` and the poster/still overrides. `render.jsonl` has one line per pass per frame
and one frame line (`pass: null`) with `rgbaSha256`, `textBoxes`, ink pixels, elements, fills, post
values and the frame's flash-audit transitions.

A textBoxes entry is `{elementId, text, voice, fontFile, fontSizePx, capHeightPx, weight, fill,
bbox}` plus `script`, `trackingEm`, `widthPct` and, for multi-line blocks, `lineCount`,
`lineHeight`, `cjk`, `paragraph`, `measureCh`. The bbox comes from the real glyph outlines under
the scene's transform, in logical 1920x1080 px.
