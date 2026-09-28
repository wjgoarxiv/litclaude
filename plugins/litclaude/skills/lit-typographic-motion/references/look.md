# Look rounds and Done

A gate PASS says the film is safe and legible. It does not say the film is good. The look rounds are
where you judge the pixels against the treatment, and the done-check will not accept a film nobody
looked at.

## Viewing pixels

Only files you open with the Read tool count as viewed. OCR, pixel statistics and file listings may
be written down as `aids`, but they never count as looking. Every render (stills-only or full)
writes the stills set into `<dir>/stills/`, listed in `stills/index.json`:

- `beat-NN.png`: the frame at each beat's midpoint, full size;
- `strip-NN.png`: one transition strip per cut, the frames 6 before, at and 6 after the cut;
- `sheet.png`: a 12-frame contact sheet across the film;
- after a full render, the delivered `poster.png` is listed too.

If no image tool can be reached, record the round with `look --round N --blocked no-vision-tool`.
The done-check then ends as `DONE_UNVIEWED`, and the reply must say in plain words that nobody
viewed the frames.

## Questions

Answer all nine every round. Each answer names the frame it is about and what you saw there.

1. A stranger would say this film is for: `<…>`. Ask a fresh subagent (the Agent tool) with only the
   contact sheet and the beat stills, never the request or the treatment, and record its sentence
   verbatim with `by: blind`. If no subagent can run, answer it yourself with `by: self`.
2. Does every beat show its `onScreen` plan?
3. Is the craft at the level `ambition` asks for (transitions, rhythm, depth, hierarchy)?
4. Is any request text, meta label, placeholder, file name or internal term on screen?
5. Does the ending land?
6. Does the sound follow the cuts? Answer it from `sound-cues.json`.
7. Name one thing a skilled motion designer, given only the request, would have shown that this film
   does not. If you can name one, revise.
8. Is any element on screen without a job in its beat?
9. Could every copy line be pasted unchanged into a film about a different subject? If yes, rewrite
   the copy from `subject.specifics`.

## Answers file

Write the answers to a JSON file and record them with
`node "$SKILL_ROOT/scripts/motion.mjs" look --out <dir> --round <N> --answers <file>`.
The values below are placeholders; `look` refuses them.

```json
{
  "viewed": ["stills/sheet.png", "stills/beat-01.png", "stills/strip-01.png"],
  "weakestBeat": "<beat index; round 1>",
  "change": "<what you changed after round 1>",
  "aids": ["<optional notes that are not looking>"],
  "answers": [
    { "q": 1, "verdict": "<yes or no: does the stranger's sentence match the film's audience and subject>", "by": "<blind or self>", "sentence": "<the stranger's sentence, verbatim>", "frame": "stills/sheet.png", "observed": "<a concrete visible detail in that frame>" },
    { "q": 7, "verdict": "<none or named>", "frame": "<a listed still>", "observed": "<what a skilled designer would have shown, or the detail that shows nothing is missing>" }
  ]
}
```

- `viewed` lists every stills file you opened with Read this round, paths relative to `<dir>`.
- `verdict` is `yes` or `no` for questions 1–6, 8 and 9, and `none` or `named` for question 7.
- `observed` is at least one sentence naming a concrete visible detail in `frame`; a bare yes or no
  is refused, and so is the same sentence used for two answers.
- `look` refuses a frame that is not in the latest stills set, and stamps the round with the SHA-256
  of `stills/index.json` and of every listed frame.

## Rounds

Rounds share one counter with the renders, 1 to 3.

- **Round 1** is always a stills round: render with `--stills-only`, look, and record `weakestBeat`
  and `change`, then make that change before the full render.
- A `no` on questions 1, 2, 3, 5 or 6, a `yes` on 4, 8 or 9, or a `named` question 7 needs another
  round: fix it, render again, look again.
- There are at most 3 rounds. After round 3, deliver with the open items stated plainly.

## Done

Done needs all of:

- a valid treatment;
- gate PASS;
- at least 2 look rounds: round 1 on a stills-only render with a `change`, then a last round;
- the last round stamped with the stills manifest of the final full render (`look` after the render,
  never before);
- the last round's `viewed` covering the poster, the contact sheet, every beat still and every
  transition strip, each of them opened with the Read tool in this session;
- the last round free of revise answers, or round 3 with its open items said in the reply.

The Stop hook checks every item and holds the turn with a named reason. A missing, unreadable or
outdated `treatment.json` or `look.json` is a named reason, never a pass.

## Never downgrade to pass

Do not answer a gate failure by shortening the film, removing a beat, removing the subject device,
switching `sound.mode` to `none`, switching `path` to `type`, or deleting effects. Fix the cause
instead: a scrim behind the text, a larger size, a placement inside the safe area, slower timing,
seeded randomness. The done-check compares the final treatment with the first valid one and records
`downgraded` when `durationSec` dropped by more than 20 %, the subject covers fewer beats, the sound
became `none` without a user request, or the path moved from stage to type. The reply must say so.

## Reply

Keep the activation line where it is; below it there is no second banner and no emoji. Plain words,
no internal names: one line on the defaults chosen; a label on every invention and on generated
sound; one plain line on what was checked (flash safety, legibility, the frames looked at); where the
copy lives and the one command that re-renders it; and any downgraded item or open look item.
