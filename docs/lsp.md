# LitClaude LSP

LitClaude includes a Claude Code plugin LSP config and a local doctor command
for TypeScript-family projects.

## Configuration

`plugins/litclaude/.lsp.json` declares a TypeScript language server command:

```json
["typescript-language-server", "--stdio"]
```

It covers `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs` files.

## Doctor

Run the doctor locally:

```bash
node plugins/litclaude/bin/litclaude-lsp-doctor.js
```

If `typescript-language-server` is unavailable, the doctor exits successfully
with installation guidance so local smoke tests can distinguish an environment
gap from a plugin failure.

`litclaude doctor` also prints the LitClaude LSP server names from the
installed `.lsp.json`. If Claude Code reports load errors for official LSP
plugins such as `rust-analyzer-lsp`, `pyright-lsp`, or `gopls-lsp`, LitClaude
reports those as external binary warnings rather than LitClaude plugin errors.

## Claude Code Reload

After changing `.lsp.json`, restart Claude Code with the local plugin directory
or use:

```text
/reload-plugins
```
