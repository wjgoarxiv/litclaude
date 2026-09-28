# Brief schema (`litclaude.motion-brief/v1`, type path)

On the type path the brief is what the engine renders. Write it after `treatment.json` (which sets
`path: type`, the length, the beats and the copy) as plain JSON next to the output directory. The
engine reads the treatment and the brief, builds the timeline, checks it before the first frame,
and renders. Text in the brief is the film's content; nothing in it is ever executed.

## Two shapes

**Lines only** — the engine composes the film: the first line (or `title`) becomes a title slam,
each middle line with two or more words becomes a karaoke line (single words become title slams),
and the last line becomes the end card.

```json
{
  "schema": "litclaude.motion-brief/v1",
  "lines": ["<first copy line>", "<a middle copy line>", "<last copy line>"]
}
```

**Explicit shots** — the agent chooses each scene. Use this when the copy has a list, a number, a
signature or a credit line. The values are placeholders; the engine refuses a brief that still
shows one.

```json
{
  "schema": "litclaude.motion-brief/v1",
  "style": "<preset>",
  "bpm": "<tempo>",
  "shots": [
    { "scene": "title-slam", "text": "<opening line>", "sub": "<small machine-voice line>" },
    { "scene": "karaoke-line", "text": "<a line read eojeol by eojeol>" },
    { "scene": "kinetic-list", "heading": "<list heading>", "items": ["<item>", "<item>", "<item>"] },
    { "scene": "number-counter", "from": 0, "to": "<figure>", "label": "<what the figure counts>" },
    { "scene": "signature", "text": "<a Latin line to write by pen>", "font": "<stroke font>" },
    { "scene": "end-card", "text": "<closing line>", "sub": "<credit line>" }
  ]
}
```

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | string | `litclaude.motion-brief/v1` |
| `title` | string | Working title; never drawn on screen |
| `label` | string | The film's own name, drawn as the terminal window label; omit it and no label is drawn |
| `request` | string | The user's request, verbatim; read only by the preset auto-pick (the treatment's copy wins) |
| `style` | `auto` \| `swiss-signal` \| `terminalcore` \| `tidal` | Explicit style wins over the auto-pick; the report calls it user-specified only when the request names it, otherwise agent default |
| `signalHue` | `green` \| `blue` | terminalcore only: one signal hue per film |
| `bpm` | number | Tier-1 beat grid; default 100 |
| `seed` | integer | Run seed for every pass (default 20260926) |
| `audio` | path | Tier 2 beat grid when the librosa venv is pre-warmed; the track itself comes from `treatment.sound` and is always muxed |
| `wordTiming` | boolean | Tier 3 opt-in; exits 14 until its runtime exists |
| `lines` | string[] | Lines-only shape |
| `shots` | object[] | Explicit shape (below) |
| `posterFrame` | integer | Frame for the poster; default the middle of the first text shot |
| `post`, `passParams` | object | Expert overrides; the gate still applies every cap |

## Shots

| `scene` | Fields | What it shows |
| --- | --- | --- |
| `title-slam` | `text`, `sub` | Display type landing on the beat; `sub` is a small machine-voice line |
| `karaoke-line` | `text` | The line revealed eojeol by eojeol; nothing reflows |
| `kinetic-list` | `heading`, `items[]` | A heading and items that arrive one per reveal step |
| `number-counter` | `from`, `to`, `prefix`, `suffix`, `label` | A figure counting up in the machine voice |
| `signature` | `text` (Latin only), `font` | A pen writing the line in an EMS single-stroke font |
| `end-card` | `text`, `sub` | The closing statement; its last frame is the reduced-motion still |

Stroke fonts: `ems-allure` (connected script), `ems-felix` (brush), `ems-osmotron` (geometric),
`ems-readability` (clean sans, default), `ems-tech` (hand lettering). They have no Hangul; a
`signature` shot with Hangul is refused before rendering.

Optional per shot: `hold` (seconds, only ever lengthens), `post` (MO-A-58 overrides for that shot).

## Writing text for motion

- Length comes from the treatment. The engine gives every unit at least 1.25 x its reading floor,
  then scales the holds up until the film reaches `durationSec`; it never holds a unit under its
  floor. When the floors alone make the film longer than the treatment asked, the render warns and
  the reply says so.
- One idea per shot. A shot that needs a paragraph is a card, not a slam; give it a `kinetic-list`
  or split it across shots.
- Keep the user's words when they supplied words, and never change what they mean. When the
  treatment's copy is invented, write it from `subject.specifics`, never from the request.
  Punctuation is made typographic for display voices automatically (`...` becomes an ellipsis,
  straight quotes become curly); the terminal look keeps typewriter punctuation.
- A running index ("01 / 05") appears only when `typePlan.index` is true; the engine refuses one
  otherwise. The working title is never drawn; only `label`, the film's own name, is.
- Never put lyrics or other text the user does not own into a film as its content.
