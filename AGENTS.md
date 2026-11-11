# AGENTS.md — LitClaude

Family-wide rules live in the umbrella `AGENTS.md` at the family root directory. Read that first if you
started here; an agent launched inside this directory does not see it automatically.

This file covers only what differs in this repository.

## What this is

LitClaude — the **Claude Code** port of the lit workflow family. npm package `@litfamily/litclaude` (local scoped candidate; CLI aliases stay `litclaude-ai` and `litclaude`).
Node ESM (`.mjs`) throughout, tests via `node --test`. Git root is this directory, branch `main`.

## Entry points

| Surface | Path |
|---|---|
| Plugin manifest | `plugins/litclaude/.claude-plugin/plugin.json` |
| All routing (triggers, mode contracts, dispatch) | `plugins/litclaude/bin/litclaude-hook.js` |
| Skills | `plugins/litclaude/skills/<id>/SKILL.md` |
| Slash commands | `plugins/litclaude/commands/<id>.md` |
| Skill catalog / resource lists | `plugins/litclaude/lib/canonical-skill-catalog.mjs`, `canonical-skill-resources.mjs` |

## Verification

Run from this directory:

```bash
npm test                      # fast tier only (render/heavy files excluded); ~15 min
npm run test:heavy          # render/Chrome/ffmpeg/motion tier; runs when those areas change
npm run test:all             # both tiers; what the release checklist runs
npm run validate:plugin
npm run doctor
npm run check:version         # package.json / plugin.json / MCP lockstep
npm run scan:legacy-tokens
npm run check:skill-resources
npm run check:skills-lock      # skills.lock.json: skill sizes, budgets, pack list
```

Do not pipe a suite through `| tail` — `$?` then reports tail's exit code, not the suite's,
and the failure detail is truncated away. Redirect to a file instead.

## Adding a skill

A new skill that ships executable assets **must be listed in `PINNED_TREES`** inside
`tools/gen-canonical-skill-resources.mjs`. Without that entry the installer silently never
copies the assets, and every test still passes.

## Skills lock

`skills.lock.json` (repository root, tracked, not packed) pins every skill under
`plugins/litclaude/skills` (SKILL.md size and hash, file count, folder bytes, one hash over all files)
and the `npm pack --dry-run --json --ignore-scripts` file list. `npm run gen:skills-lock` rewrites
those generated halves; `npm run check:skills-lock` and `test/skills-lock.test.mjs` only read.
`budgets` is hand-owned and never changed by a run: a new skill needs
`npm run gen:skills-lock -- --accept-new <id>`, a removed one `-- --drop <id>`, and while any skill
sits outside its budget nothing is written. Only Git-tracked files count, and an untracked file
npm would pack is refused, so `git add` a new file before regenerating. Raise a budget by hand when
a skill grows on purpose; lowering a floor (for example for a same-name stub) is a hand edit in the
same commit, never a regeneration.

## Do not touch

- `HANDOFF_litclaude.md` is local, git-ignored continuation state (untracked since the 2026-09-05
  public-release hygiene pass). Never `git add -A` here; stage explicit paths.
- `HANDOFF.md` in this directory is **deprecated**. The authoritative handoff is
  `../HANDOFF.md` at the family root.
- `evidence/` is git-ignored and is overwritten by the `qa:*` scripts.

## Packaging

`package.json` has a `files` allowlist that does not include `AGENTS.md`, so this file is
tracked in git but never published. Verified with `npm pack --dry-run`.

There are two READMEs. `README.md` / `README_ko-KR.md` are the GitHub landing pages and load every
image by a relative path; the detail they link to lives in `docs/guide*.md`, `docs/skills*.md`
and `docs/development*.md`, which are not packed. The npm page is `README_npm.md` / `README_npm_ko-KR.md`, a shorter card with
jsDelivr URLs pinned to the package version; `tools/readme-for-npm.mjs` swaps it in at `prepack`
and back at `postpack`, and a publish must wrap `npm publish` in an explicit `apply` / `restore`
(see `RELEASE_CHECKLIST.md`). The names avoid a `README.` prefix on purpose: npm always packs
root files matching `README.*`, and a `files` negation cannot exclude them. Every file the npm
card references must ship: see the explicit README resource entries in `package.json`, the
exact-path exceptions in `tools/check-pack-payload.mjs`, and the packed-reference assertions in
`test/workspace-hygiene.test.mjs`. Keep unrelated repository artwork under `docs/assets/` and
`RELEASE_CHECKLIST.md` out of tarballs. Obsolete `cover.png` and `generate_cover.py` sources are
archived outside the product root. The pack guard checks this boundary.
