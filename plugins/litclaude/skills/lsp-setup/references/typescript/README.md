# TypeScript / JavaScript — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `typescript-language-server --stdio`
- **Extensions:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts`
- **Install hint:** `npm install -g typescript-language-server typescript@6`

## Install

- **macOS:** `npm install -g typescript-language-server typescript@6`
- **Linux:** `npm install -g typescript-language-server typescript@6`
- **Windows:** `npm install -g typescript-language-server typescript@6` (PowerShell or cmd)

`typescript-language-server` is only a thin wrapper — it needs the `typescript`
package (`tsserver`) present too, either globally or in the project's
`node_modules`. Always install both. Pin `typescript@6`: TypeScript 7 ships no
`lib/tsserver.js`, which `typescript-language-server` loads.

Confirm it resolves:

```bash
command -v typescript-language-server
```

## Configure

LitClaude declares language servers in `plugins/litclaude/.lsp.json`. Each entry
is keyed by language name and holds a `command` string, an `args` array and an
`extensionToLanguage` map. TypeScript/JavaScript already ships in the default
config:

```json
{
  "typescript": {
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "extensionToLanguage": {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".mts": "typescript",
      ".cts": "typescript"
    }
  }
}
```

Claude Code resolves the server for an edited file by matching its extension
against these maps.

## Alternatives

Swap `command` and `args` for your toolchain. Keep the same `.lsp.json` shape and adjust
`extensionToLanguage` to cover the extensions that server should own:

| `command` + `args`                        | when to choose                          |
| ----------------------------------------- | --------------------------------------- |
| `"deno"` + `["lsp"]` | Deno projects (handles `.ts/.tsx/.js`)  |
| `"biome"` + `["lsp-proxy", "--stdio"]` | Biome lint/format as the LSP            |
| `"vscode-eslint-language-server"` + `["--stdio"]` | ESLint diagnostics                 |
| `"oxlint"` + `["--lsp"]` | fast Oxc-based linting                  |
| `"vue-language-server"` + `["--stdio"]` | `.vue` single-file components           |
| `"svelteserver"` + `["--stdio"]` | `.svelte` files                         |
| `"astro-ls"` + `["--stdio"]` | `.astro` files                          |

`eslint` install: `npm i -g vscode-langservers-extracted`. To run Deno instead
of the default, set the `typescript` entry's `command` to `"deno"` and `args` to `["lsp"]`.

## Troubleshooting
- **PATH:** `typescript-language-server` must be on PATH; reopen shell after `npm i -g`. Check your global bin with `npm bin -g`.
- **Missing tsserver:** errors like "Could not find tsserver" mean the `typescript` package is absent — install it globally or in the project.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.ts
# or: bun ../../scripts/verify-lsp.ts path/to/file.ts
```
