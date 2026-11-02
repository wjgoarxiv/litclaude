# Developing LitClaude

[README](../README.md) · [Guide](./guide.md) · [Contributing](../CONTRIBUTING.md) · [한국어](./development_ko-KR.md)

This page is for people working on LitClaude itself: what the package guards promise, the
checks to run before a pull request, how to load the plugin from a checkout, and where things
live.

## Integrity boundaries

A passing scanner speaks for one snapshot. It reports how many files it captured and a
SHA-256 digest of those bytes, and it does not prove that the mutable live tree stayed
clean afterwards; if files change, run it again. Legal companion files sit outside the
generated manifest and are scanned normally.
Canonical and runtime captures are capped at 8 MiB per file and 32 MiB in total. The
package guards compare each immutable expected file map across the
verifier-to-capture interval and against the produced tarball, and secure non-executable
entries such as `0600` stay valid.

## Checkout gates

From this checkout, the main gates are:

```bash
npm test
npm run validate:plugin
npm run doctor
npm run check:version
npm run scan:legacy-tokens
npm run check:skill-resources
npm run check:runtime-closures
npm run pack:payload-guard
npm run pack:dry-run
```

Everyday work runs the fast tier (`npm test`): everything except the render/Chrome/ffmpeg/motion
files in `tools/test-tiers.json`, about 13 minutes locally. The heavy tier (`npm run test:heavy`)
runs when those areas change; the release checklist runs both (`npm run test:all`).
`test/test-tiers.test.mjs` proves every file sits in exactly one tier. CI runs the fast tier on
every push and PR (macOS and Linux) and the heavy tier as four parallel shards
(`npm run test:shard -- --tier heavy <i>/4`), split by the measured seconds in
`tools/test-shard-timings.json`; `test/test-shards.test.mjs` proves the shards together are each
tier, each file once. A new test file lands in the fast tier with no table entry; add its measured
time to the timings table when it is slow, and move it to the tiers table when it is heavy.

## Local development

Load the plugin directly from this checkout while editing it:

```bash
claude --plugin-dir ./plugins/litclaude
```

Reload plugin metadata inside Claude Code with:

```text
/reload-plugins
```

## Project map

| Surface | Path |
| --- | --- |
| CLI | `bin/litclaude-ai.js` |
| Claude plugin | `plugins/litclaude/` |
| Skills | `plugins/litclaude/skills/` |
| Agents | `plugins/litclaude/agents/` |
| Hooks | `plugins/litclaude/hooks/hooks.json` |
| MCP | `plugins/litclaude/.mcp.json` |
| LSP | `plugins/litclaude/.lsp.json` |

The npm package page shows a shorter README. Its source is `README_npm.md` (Korean:
`README_npm_ko-KR.md`); `node tools/readme-for-npm.mjs apply` swaps it in before a pack
or publish and `restore` puts the GitHub README back. The release steps are in
[`RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md).

`docs/assets/cover.svg` stays as an editable, low-bandwidth fallback. The static product
emphasis export `docs/assets/cover.webp`, the wordmark `docs/assets/litclaude-wordmark.svg`
and the clay mark `docs/assets/litclaude-clay-icon.png` still ship in the package but are no
longer shown on the README.
