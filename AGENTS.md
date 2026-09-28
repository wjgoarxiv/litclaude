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
npm test                      # node --test; ~833 pass as of 2026-08-01
npm run validate:plugin
npm run doctor
npm run check:version         # package.json / plugin.json / MCP lockstep
npm run scan:legacy-tokens
npm run check:skill-resources
```

Do not pipe a suite through `| tail` — `$?` then reports tail's exit code, not the suite's,
and the failure detail is truncated away. Redirect to a file instead.

## Adding a skill

A new skill that ships executable assets **must be listed in `PINNED_TREES`** inside
`tools/gen-canonical-skill-resources.mjs`. Without that entry the installer silently never
copies the assets, and every test still passes.

## Do not touch

- `HANDOFF_litclaude.md` is local, git-ignored continuation state (untracked since the 2026-09-05
  public-release hygiene pass). Never `git add -A` here; stage explicit paths.
- `HANDOFF.md` in this directory is **deprecated**. The authoritative handoff is
  `../HANDOFF.md` at the family root.
- `evidence/` is git-ignored and is overwritten by the `qa:*` scripts.

## Packaging

`package.json` has a `files` allowlist that does not include `AGENTS.md`, so this file is
tracked in git but never published. Verified with `npm pack --dry-run`.

The npm-rendered `README.md` uses version-pinned jsDelivr URLs because the source repository is
private. Every file referenced by its images, film/poster links, and local document links must
ship in npm: see the explicit README resource entries in `package.json`, the exact-path exceptions
in `tools/check-pack-payload.mjs`, and the packed-reference assertions in
`test/workspace-hygiene.test.mjs`. Keep unrelated repository artwork under `docs/assets/` and
`RELEASE_CHECKLIST.md` out of tarballs. Obsolete `cover.png` and `generate_cover.py` sources are
archived outside the product root. The pack guard checks this boundary.
