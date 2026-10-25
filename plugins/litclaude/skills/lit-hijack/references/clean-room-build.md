# Clean-room build

The build separates two roles. The spec writer reads the sources and writes `SPEC.md`. The
implementer reads `SPEC.md` and the target, and builds. The spec is the only artifact that crosses
from one role to the other. This mirrors the classic two-team method for compatible
reimplementation, where one team studied the original and wrote a functional specification and a
second team, with no exposure, built from that specification alone.

## Why the split matters

A writer who has just read a source reproduces its phrasing, its examples and its order without
noticing. A writer who never saw it cannot. The split does two things: it keeps expression out of
the target, and it forces the spec to be complete, because anything left out of the spec cannot
reach the implementer by memory.

Be honest about its limits. The model that implements may have met the source during training, the
person running the port has read it, and a skill-shaped source often states its mechanism in one
obvious way. The result is therefore described as *independently re-expressed*, with an exposure
note in the report, rather than as untouched by the source.

## Roles in a Claude Code session

| Role | Who | Sees | Writes |
| --- | --- | --- | --- |
| Spec writer | the root session that ran capture, distil and gap | sources, ledger, target | `SPEC.md`, the ledger |
| Planner | `lit-plan` | `SPEC.md`, the target | the plan file |
| Implementer | a fresh `litclaude:lit-executor` lane | the brief (spec + target root), the target | target files |
| Executor discipline | `start-work` | the plan, the ledger of rows | row evidence |
| Gatekeeper | `hijack.mjs check` | everything | pass or fail |

## Step 1: plan with lit-plan

Load `Skill(lit-plan)` and give it `SPEC.md` as the brief. Each plan row is a column-zero
`- [ ] N. <title>` row in lit-plan's grammar and names the SPEC section it implements (`M1`, `M4`),
the target files, the test it adds, and the real-surface check. The build gate requires at least one
such row and a citation of every taken mechanism. Plan rows
refer to the spec and the target, never to `sources/` or a source URL; the build gate reads the plan
file and fails when it names either. Record the path:

```json
"build": { "plan": "plans/<slug>.md" }
```

## Step 2: execute with start-work

Run the plan with `start-work`. For a small port (one or two SPEC sections in one or two files) a
short plan in the run folder, in the same row grammar, executed directly by the isolated
implementer lane is enough; the report says which path ran. Its per-row gates apply unchanged: a failing test first, the
smallest change that passes, a real-surface check, cleanup. `lit-hijack` adds one constraint: the
person or lane that edits target files works from the brief.

## Step 3: brief the implementer

```text
$H brief <run>
```

prints a packet that starts with `TASK:` and carries `DELIVERABLE`, `SCOPE` and `VERIFY`, then the
full text of `SPEC.md`. It names the target root and the sections to build, and it tells the
implementer to stay out of any `.litclaude/hijack/` folder, to leave the original material unsought,
and to return a question when a section is ambiguous. It refuses to print while the spec gate fails,
so a spec that leaks the sources never reaches an implementer.

Hand the packet to a fresh lane:

```text
Agent(subagent_type: "litclaude:lit-executor", isolation: "worktree", prompt: <the brief>)
```

With `isolation: "worktree"` the lane works in a new git worktree of the target. Tracked files are
there; your untracked run folder, with its captured sources, is not. When the change spans
independent areas, give each area its own lane and its own brief section.

Merge the lane's worktree changes back the way the target normally takes changes (a commit on a
branch, or a patch you review). Then list every changed file:

```json
"build": { "plan": "plans/<slug>.md", "changed": ["skills/<id>/SKILL.md", "skills/<id>/scripts/<tool>.mjs", "test/<id>.test.mjs"] }
```

## Degraded path

When the Agent tool or worktree isolation is unavailable, the separation cannot be enforced. Say so
once, then:

1. Close the sources. Work from `SPEC.md`, the mechanism cards' `what` and `why`, and the target.
2. Write in the target's order with the target's examples.
3. Rely on the overlap gate as the remaining fence, and record `build.separation: "single-context"`
   in the ledger so the report's exposure note is accurate.

## The overlap gate

`hijack.mjs overlap` and the spec and build phases of `check` compare text against every capture of
the run, including every text file of a captured repo.

- Text is normalised (Unicode compatibility form, lower case) and split into words of letters and
  digits, so punctuation, Markdown and line breaks do not hide a copy. Hangul and other scripts work
  the same way.
- Every run of `min_words` consecutive words (12 by default, kept in `ledger.min_words`) that also
  appears in a capture is reported with the file, the line, the length and the source id.
- Three or more identical headings between a target file and a source produce a warning: matching
  structure is copying too, even with new sentences.

How to respond to a hit:

| Hit | Response |
| --- | --- |
| A sentence or paragraph from the source | Rewrite from the mechanism card, in the target's order and with the target's example. |
| A long shared run inside code | Re-implement from the spec; do not rename variables over copied logic. |
| A standard phrase both texts need (a licence name, an API name, a protocol field) | Shorten the run below the threshold, or name it once and refer to it. Record the case in the report. |
| Headings that match | Restructure around the target's flow. |

Lowering `min_words` makes the gate stricter; raising it to silence a hit defeats it. Keep the
default unless the report explains why.

## What the gate cannot see

A paraphrase that follows the source sentence by sentence with synonyms passes a word-run check.
So does copied logic with renamed identifiers. Two habits close most of that gap: write from the
mechanism cards with the sources closed, and let the implementer be someone who never opened them.
For a high-stakes port, add a `litclaude:lit-verifier` lane that reads the source, the spec and the
diff side by side and reports structural echoes the script cannot detect.

## Attribution in the build

When any taken mechanism rests on an `ideas-credit` source, the build adds the target's attribution
notice. Follow the target's existing pattern first. A target that already keeps a methodology
provenance record (this plugin's `vendor/provenance/methodology-sources.md` pins each source's
commit and licence and says what was taken and what was not) gets a new entry there. Otherwise an
`ATTRIBUTION.md` beside `SKILL.md` names, per source: the work, the author, the URL, the licence, what idea was adapted, and
a sentence that no text or code was reused. Record its path in `ledger.attribution.path`; the report
gate checks it names every `ideas-credit` source that fed a taken mechanism. The notice is the one
file the overlap gate skips, because it must carry titles and URLs.
