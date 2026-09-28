Bootstrap a local llm-wikify knowledge wiki in the **current working directory**, following the llm-wikify skill.

Apply **minimal-first** discipline (skill: Bootstrap mode + Bootstrap posture):

1. Inspect what already exists (docs, configs, code, notes, `raw/`). Do not duplicate existing docs — point to them.
2. Create the **smallest useful** structure only: `raw/`, `wiki/home.md`, `wiki/index.md`, `schema/wiki-rules.md`, `log/log.md`. Add `wiki/topics/` when there is real material for it.
3. Do **not** auto-create the richer category palette (`decisions/ errors/ projects/ design/ dev-tasks/`). Those are documented in `schema/wiki-rules.md` as evidence-gated options, added later only when material justifies them.
4. Record the locality boundary and conventions in `schema/wiki-rules.md`.
5. Log the bootstrap in `log/log.md`.

If the folder is empty or near-empty, offer a starter direction (personal / research / project-handoff / notes / business-team) and ask for the first three things the wiki should remember — then act.

Arguments: $ARGUMENTS (optional scope hint, e.g. a subfolder for monorepos). Default scope = current directory only; never widen scope without explicit approval.
