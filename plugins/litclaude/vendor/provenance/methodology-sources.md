# Methodology source provenance

This record covers external work that informed LitFamily **methodology only**. It is categorically
different from the snapshot closures recorded elsewhere in this directory.

**No upstream implementation bytes are included.** No source file, fragment, or verbatim sentence
from any repository below is redistributed in LitFamily product surfaces. This record intentionally
retains source identifiers, repository names, pinned commits, and license information for attribution.
What was taken is the shape of an approach, re-expressed in LitFamily's own vocabulary against
LitFamily's own surfaces. Nothing here creates a runtime, build, or retrieval dependency on these
repositories.

Because nothing is copied, this record exists for honesty and traceability, not for license
compliance of redistributed material. Each entry is pinned so a future reader can diff our
expression against the source state that informed it.

## Sources

| Source | License | Pinned commit | Resolved |
| --- | --- | --- | --- |
| `vercel-labs/agent-browser` | Apache-2.0 | `548b159b30eef119ccf6846c8bc807d0eaa3f6f8` | 2026-08-18 |
| `Leonxlnx/taste-skill` | MIT | `dfb6f9f9e93a39f673b1827c0889cc28326d1800` | 2026-08-18 |
| `rebelytics/one-skill-to-rule-them-all` | CC-BY-4.0 | `281f13466cd3a73e9ebc9d210907748e1941a3dd` | 2026-08-18 |
| `AllstarGER/one-skill-to-rule-them-all` | CC-BY-4.0 | `764d8ebea9c74c669eb8e0e98051300d499efbc9` | 2026-08-18 |

The fourth entry is a fork of the third that targets a different host family. It is pinned
separately because the two diverge in where session observations are stored and which instruction
file activates them.

## What was taken, per source

### `vercel-labs/agent-browser`

Taken: the idea that an agent should drive a browser through a compact accessibility snapshot rather
than raw page markup, that element handles from a snapshot go stale the instant the page changes and
must be re-acquired, and that a skill describing a versioned CLI should defer to that CLI at runtime
instead of embedding a copy of its guide that silently rots.

Not taken: the CLI, its command surface, its snapshot format, its reference identifiers, and its
skill text. LitFamily's adapter delegates to the upstream CLI when the operator has installed it and
returns `BLOCKED:` when they have not. LitFamily neither vendors nor reimplements that CLI.

### `Leonxlnx/taste-skill`

Taken: the position that generic-looking output is a describable failure rather than a matter of
taste, and that direction is more controllable when exposed as a small number of explicit numeric
dials than as adjectives in prose.

Not taken: the dial names, their scales, the prompt text, the animation skeletons, the variant
skills, and the installer. LitFamily expresses its own dials inside its existing design contract,
where its own validator enforces them.

### `rebelytics/one-skill-to-rule-them-all` and its fork

Taken: the position that a skill library should improve from observed use rather than only from
deliberate authoring; that the signals worth capturing are user corrections, repeated patterns that
imply a missing skill, and gaps in a skill that was active; and the discipline that such an observer
proposes edits for human review and never edits a skill itself.

Not taken: the skill text, the reference files, the helper script, the storage layout, and the
observation log format. LitFamily writes observations into its own state root under its own schema,
with its own redaction boundary.

## Verification

- Every commit value above is a full 40-character hexadecimal SHA, not a branch name or short hash.
- `npm run scan:legacy-tokens` must exit 0 with an empty allowlist after any edit to this file.
- `npm run check:runtime-closures` must exit 0; this record adds no closure and must not change one.
