# TypeScript / JavaScript — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `typescript-language-server --stdio`
- **Extensions:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts`
- **Install hint:** `npm install -g typescript-language-server typescript`

## Install

- **macOS:** `npm install -g typescript-language-server typescript`
- **Linux:** `npm install -g typescript-language-server typescript`
- **Windows:** `npm install -g typescript-language-server typescript` (PowerShell or cmd)

`typescript-language-server` is only a thin wrapper — it needs the `typescript`
package (`tsserver`) present too, either globally or in the project's
`node_modules`. Always install both.

Confirm it resolves:

```bash
command -v typescript-language-server
```

## Configure

LitClaude declares language servers in `plugins/litclaude/.lsp.json`. Each entry
is keyed by language name and holds a `command` array plus an
`extensionToLanguage` map. TypeScript/JavaScript already ships in the default
config:

```json
{
  "typescript": {
    "command": ["typescript-language-server", "--stdio"],
    "extensionToLanguage": {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript"
    }
  }
}
```

Add `.mts`/`.cts` to `extensionToLanguage` if your project uses them. Claude Code
resolves the server for an edited file by matching its extension against these
maps.

## Alternatives

Swap the `command` for your toolchain. Keep the same `.lsp.json` shape and adjust
`extensionToLanguage` to cover the extensions that server should own:

| command                                   | when to choose                          |
| ----------------------------------------- | --------------------------------------- |
| `["deno", "lsp"]`                         | Deno projects (handles `.ts/.tsx/.js`)  |
| `["biome", "lsp-proxy", "--stdio"]`       | Biome lint/format as the LSP            |
| `["vscode-eslint-language-server", "--stdio"]` | ESLint diagnostics                 |
| `["oxlint", "--lsp"]`                     | fast Oxc-based linting                  |
| `["vue-language-server", "--stdio"]`      | `.vue` single-file components           |
| `["svelteserver", "--stdio"]`             | `.svelte` files                         |
| `["astro-ls", "--stdio"]`                 | `.astro` files                          |

`eslint` install: `npm i -g vscode-langservers-extracted`. To run Deno instead
of the default, replace the `typescript` entry's `command` with `["deno", "lsp"]`.

## Troubleshooting
- **PATH:** `typescript-language-server` must be on PATH; reopen shell after `npm i -g`. Check your global bin with `npm bin -g`.
- **Missing tsserver:** errors like "Could not find tsserver" mean the `typescript` package is absent — install it globally or in the project.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.ts
# or: bun ../../scripts/verify-lsp.ts path/to/file.ts
```
