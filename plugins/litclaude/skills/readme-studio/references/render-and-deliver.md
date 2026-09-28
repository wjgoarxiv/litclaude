# Local motion production

Choose an engine before rendering. Inspect the pinned package's CLI help and license, Chrome and encoding prerequisites. Do not silently install globally or switch engines after a failure. Keep dependencies and outputs in the authorized project. If a sandbox cannot launch Chrome, preserve source and report the exact boundary; an authorized outer process may render that same source with the boundary recorded, without weakening the sandbox.

## Remotion

`templates/remotion-cover/` pins Remotion and its CLI to 4.0.526 with React/React DOM 19.3.0. Prefer it when compatible with the user's license situation. Its license has eligibility conditions; it is not the plugin's MIT license. Check https://www.remotion.dev/license for the actual use case before choosing it. If eligibility is unknown, keep this choice pending and select the Apache-2.0 alternative only as an explicit initial decision.

Copy the full template to a new project directory, then `npm ci`. Place inspected `background.png`, title and subtitle SVG ink variants and label variants under public/. Compose from editable cover-source.json records. Run the project-local commands, each with a fresh output:

```bash
npm run compositions
npm run render -- src/index.tsx CoverWideLight out/wide-light-v01.mp4
npm run still -- src/index.tsx CoverWideLight out/wide-light-v01.png --frame 90
```

Other IDs are CoverWideDark, CoverMobileLight and CoverMobileDark. All are 60fps, 300 frames / 5 seconds; mobile is 800x1000, wide 1600x800. Use frame-driven motion only. The template exposes blur, grain and expressive treatment props; adjust them without blurring text. Static grain and a deterministic eased cycle prevent random flicker. Read https://www.remotion.dev/docs/animating-properties for the frame-driven requirement.

## HyperFrames

`templates/hyperframes-cover/` pins the published `hyperframes@0.8.51` package, Apache-2.0, Node >=22. Copy it into a fresh workspace, `npm ci`, then inspect `./node_modules/.bin/hyperframes render --help`. Set HYPERFRAMES_NO_TELEMETRY=1 for task-local rendering. Keep the root composition timing and data-no-timeline marker: this template deliberately uses finite CSS animations, not a missing GSAP timeline. Retain index.motion.json and test that timeline before rendering.

```bash
./node_modules/.bin/hyperframes check . --samples 60 --no-contrast --json
./node_modules/.bin/hyperframes render . -c index.html --fps 60 --workers 1 --output wide-light-v01.mp4
```

The positional argument is the project directory; `-c` names the composition. Use one worker for this recipe; inspect the bottom edge in decoded frames to catch clipping. Use a separate project directory per light/dark and wide/mobile variant, each with exactly one root index.html. Multiple root compositions fail the native lint check. Configure the theme ink paths and dimensions before rendering. Keep each composition's own dimensions, duration and matching sidecar. The HTML's data attributes are editable source, not proof that a movie was produced. Primary package/source: https://registry.npmjs.org/hyperframes/0.8.51 and https://github.com/heygen-com/hyperframes . Do not substitute an unpublished CLI name or unpinned latest.

## Delivery and inspection

Keep recognizable type on frame zero, a brief eased typographic movement, a readable hold and a return with matching endpoints. Inspect frames 0/150/299 as well as playback; check full-height output, dark/light ink pairing, original pixel motif, contrast, crops and seam. Use ffprobe to verify master dimensions, fps and duration. A missing movie or failed encoder remains MOTION_RENDER_BLOCKED even when the tool printed a success-like message.

Create posters and <=2.5 MiB inline GIFs. A useful starting encoder profile is 6fps, wide 560x280 or mobile 384x480, 64 colors, 30 frames for five seconds. Lower preview fps is distinct from the 60fps master. Example with local FFmpeg, keeping existing outputs safe:

```bash
ffmpeg -n -i out/wide-light-v01.mp4 -filter_complex '[0:v]fps=6,scale=560:280:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer' out/wide-light-v01.gif
```

If over budget, optimize and inspect readability again. If still too large, record INLINE_PREVIEW_SIZE_BLOCKED and obtain an explicit delivery choice. Never quietly omit a required animation and claim the full set. A static fallback remains mandatory even when playback works.

Static posters are still frames from the layered composition: keep the sharp foreground plane, depth-staged background blur and directional rim-light band visible in each poster. The image is motionless while both depth and light effects remain present; do not remove them for reduced-motion output.

Record actual tool version/license choice, commands, exit statuses, dimensions, frame count, fps, byte sizes, source paths and inspection judgments. Test local picture selection at 320/390/1440px and both color schemes, including reduced motion. This is local evidence only; GitHub, npm/CDN and their actual accessibility settings remain POST_PUBLICATION_UNVERIFIED. No remote publication is part of this skill.
