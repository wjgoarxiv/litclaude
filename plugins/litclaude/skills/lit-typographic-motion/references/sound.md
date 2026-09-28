# Sound

Every film gets a sound plan in `treatment.json` (`sound: { mode, plan, palette }`), on both render
paths. The renderer muxes whatever track the plan names, then audits the decoded stream after the
encode. Nothing here downloads a sample, a model or a library: the bed is synthesized in product
code, deterministically, from the treatment.

## Modes

| `sound.mode` | What is muxed | When |
| --- | --- | --- |
| `generated` | A bed built by the product from the treatment: tempo, pulse, a pad chord progression and the accents the beats ask for | The default under a bare `lit`, on the type path and the stage path alike |
| `supplied` | The user's own audio file (`sound.file`), padded or trimmed to the film | The user gave a track |
| `authored` | A WAV the model wrote itself into the stage dir (`sound.file`) | The treatment calls for sound the bed cannot make |
| `none` | No audio stream | Only when the user asked for silence, or the `channel` plays muted by design |

A supplied or authored track is always muxed, whatever the state of the optional audio-analysis
tier; that tier only adds a beat grid for timing. Say in the reply that a generated bed is
generated, in plain words ("a generated music bed"), and name any supplied track by its file name.
Never switch a film to `none` to get past a check: that is a downgrade and the done-check records it.

## Palettes

`sound.palette` is `{ "timbre": "<timbre>", "key": "<pitch class>", "mode": "<major|minor>", "tempo": <60-160> }`.
The key is one of the twelve pitch classes (sharps or flats), the mode sets the chord
progression (major: I–V–vi–IV; minor: i–VI–III–VII, always resolving home on the last chord), and
the tempo sets the pulse grid in BPM. Pick them for the film, not by habit: two films should not
sound alike.

| Timbre | Character | Pad | Pulse | Accents |
| --- | --- | --- | --- | --- |
| `soft-keys` | Warm, close, unhurried | Rounded electric-piano partials, gently detuned, low-passed | A felt kick on every beat | Felt piano strike for cadences; a soft noise-and-thump hit |
| `glass` | Bright, airy, precise | Bell-like odd partials with an octave shimmer, wide detune | A small tick on every beat and a sub note every bar | Inharmonic bell partials for hits and cadences |
| `pulse-synth` | Driving, graphic | Filtered saw pad | Eighth-note bass on the chord root under a firm kick | Plucked saw cadence; a noise snap hit; a pitched riser |
| `felt-strings` | Slow, tender, wide | Bowed-string partials with vibrato | A brushed noise pulse on every beat | A felt strike for cadences; a soft hit |

`soft-keys` and `felt-strings` suit reflective or intimate films; `glass` suits clean diagrams,
precise explainers and cool palettes; `pulse-synth` suits graphic, fast-cut motion pieces.

## Cues

Accents appear only where a beat's free-text `sound` field asks for one. The words that ask are:

- **hit** — hit, impact, cut, stab, accent, 타격, 히트, 컷, 강세. The hit lands on the cut nearest
  the beat's start when one is within 0.5 s, otherwise on the beat's start.
- **rise** — rise, riser, swell, build, build-up, lift, 상승, 고조, 빌드업. A filtered noise swell
  that ends exactly on the beat's end boundary (the next change) and starts up to 1 s before it.
- **cadence** — cadence, resolve, resolution, close, ending, final chord, 종지, 마무리, 해결. A struck
  tonic chord at the start of the beat's last 40 %, ringing into the film's end on the last beat.

A beat whose `sound` field names none of these gets pad and pulse only. `sound-cues.json` lists
every cue with `kind`, `t` (seconds), `beatIndex`, `target` (the beat boundary or cut it serves)
and `delta` (`t − target`), plus the palette, key, tempo, loudness, peak, sample count and the
bed's sha256. Look question 6 ("does the sound follow the cuts?") is answered from this file: each
asked-for accent should sit on its cut with a delta within one frame, and every cut the treatment
marks for sound should have a cue.

## Loudness and limits

- 48 kHz, 16-bit, stereo WAV of exactly `round(frameCount × 48000 / fps)` samples.
- Integrated loudness −16 LUFS ± 2, measured in product code per ITU-R BS.1770-4 (K-weighting at
  48 kHz, 400 ms blocks with 75 % overlap, −70 LUFS absolute and −10 LU relative gates). A
  deterministic soft limiter keeps the bed's sample peak at or under −2 dBFS.
- The pad is audible from the first quarter second, so the bed never opens on silence.
- The muxed stream is decoded and gated when `mode` is not `none`: a stream is present, its
  duration is within ±0.1 s of the video, and its sample peak is at or under −0.5 dBFS. For a
  generated bed, no stretch below −50 dBFS RMS (50 ms windows) may last longer than 1.5 s in the
  first 3 s; that failure, or a missing stream when sound was planned, is exit 20
  (`SOUND_INVALID`). For a supplied or authored track the head rule only warns.
- Audio is encoded as AAC at 256 kb/s. A supplied or authored track is padded or trimmed to the
  video's duration with a 50 ms fade; the encode never uses `-shortest`, so the audio can never cut
  the film short.

## Commands

```bash
node "$SKILL_ROOT/scripts/motion.mjs" sound --out <dir>
```

reads `<dir>/treatment.json` and writes `<dir>/sound/bed.wav` and `<dir>/sound-cues.json`, so the
bed can be heard and its cues checked before a render. The render rebuilds the bed itself whenever
the film's frame count or cut times differ from the ones the bed was built for, so the muxed bed
always matches the film sample for sample. Two builds from the same treatment give the same bytes.
