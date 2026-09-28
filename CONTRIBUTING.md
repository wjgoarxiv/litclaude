# Contributing to LitClaude

LitClaude is a Claude Code plugin and Node ESM command-line distribution. Start
with the [README](README.md), [support guide](SUPPORT.md), and
[code of conduct](CODE_OF_CONDUCT.md). Contributions use the existing
[MIT license](LICENSE), whose holder is LitClaude contributors; retain applicable
third-party notices when changing bundled resources.

## Prepare a reproducible change

Use Node.js 22 to match CI. The package has no npm runtime or development
dependencies and no lockfile, so a source checkout does not require an install
step before the Node tests. Claude Code is required for authenticated host
checks, but the ordinary suite uses local fixtures for those boundaries.
Scientific skills can require separate Python packages or native tools; an
optional dependency skip does not prove that capability works on your machine.

Describe the user-visible problem and the smallest reproducer before changing
code. Keep CLI, hook, manifest, and documentation behavior consistent. Use
`node:test` and the existing `.mjs` helpers; add a regression that fails for the
reported defect and tests the corrected behavior. Keep unrelated formatting and
generated corpus changes out of the patch. Do not modify vendor resources as a
shortcut around their provenance or integrity checks.

The CLI is `bin/litclaude-ai.js`; hook routing is in
`plugins/litclaude/bin/litclaude-hook.js`. Skills live under
`plugins/litclaude/skills/`. A skill with executable assets must be enrolled in
`PINNED_TREES` in `tools/gen-canonical-skill-resources.mjs`; regenerate its native
manifest after intentional changes. Adding a directory alone does not prove the
installer will copy its assets.

## Validate the change

Run a focused test first, then these checkout gates:

```bash
node --test test/community-docs.test.mjs
npm test
npm run validate:plugin
npm run doctor
npm run check:skill-resources
npm run check:runtime-closures
npm run check:version
npm run assert:ci
npm run scan:legacy-tokens
npm run pack:dry-run
npm run pack:payload-guard
```

For a CLI, installer, or shipped-payload change, also exercise the packed package
in disposable `HOME`, `CLAUDE_CONFIG_DIR`, `LITCLAUDE_HOME`, `TMPDIR`, and npm cache
directories. Disable implicit installation with `LITCLAUDE_AUTO_INSTALL=0` and
background update checks with `LITCLAUDE_NO_UPDATE_CHECK=1`; invoke the intended
installer explicitly inside that profile. Verify fresh install, repeat install,
upgrade from the supported baseline, doctor, and removal. Preserve unrelated
settings and modified files. Remove only the temporary directories you created.

The [CI workflow](https://github.com/wjgoarxiv/litclaude/blob/main/.github/workflows/ci.yml) also runs the isolated negative gate
matrix and installed tamper/repair checks. It documents the host-dependent QA
commands it excludes. Test fixtures and a successful doctor are local evidence;
they do not establish an authenticated Claude Code session or registry
availability. Record missing host prerequisites and optional skips explicitly.

Capture each command's exit status directly. Do not pipe a test suite through a
truncating filter: that loses failures and can report the filter's status.

## Submit for review

Use the [pull request template](https://github.com/wjgoarxiv/litclaude/blob/main/.github/PULL_REQUEST_TEMPLATE.md). Explain the
behavior change, relevant tests and direct exit results, limitations, and cleanup.
Redact diagnostic output following [privacy guidance](docs/privacy.md). Do not
include raw transcripts, credentials, local settings, generated evidence,
handoffs, package tarballs, or private paths in a commit. Stage explicit paths.

Package identity, executable aliases, and Claude marketplace/ownership IDs are
different contracts; consult [migration guidance](docs/migration.md) before
changing them. A candidate package reference is not evidence it is publicly
available. Version changes and release actions require separate maintainer
approval. CI validates changes and has no automatic publication step; keep its
read-only permissions and release-command guard intact.
