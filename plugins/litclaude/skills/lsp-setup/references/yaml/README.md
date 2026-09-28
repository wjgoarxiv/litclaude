# YAML — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `yaml-language-server --stdio`
- **Extensions:** `.yaml .yml`
- **Install hint:** `npm install -g yaml-language-server`

## Install

- **macOS:** `npm install -g yaml-language-server`
- **Linux:** `npm install -g yaml-language-server`
- **Windows:** `npm install -g yaml-language-server` (PowerShell)

Confirm it resolves:

```bash
command -v yaml-language-server
```

## Configure

Add a `yaml` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "yaml": {
    "command": ["yaml-language-server", "--stdio"],
    "extensionToLanguage": {
      ".yaml": "yaml",
      ".yml": "yaml"
    }
  }
}
```

Claude Code routes `.yaml`/`.yml` edits to `yaml-language-server` via the map.
Schema association is the main reason to tune the server, but those options
travel through the editor's LSP `initializationOptions` (`yaml.schemas`,
`yaml.schemaStore`), not `.lsp.json`. An inline
`# yaml-language-server: $schema=<url>` modeline works without any config:

```yaml
# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
```

## Alternatives

- `redhat.vscode-yaml` bundles the same server in editors.
- `yamllint` standalone for style/lint-only checks.

## Troubleshooting
- **PATH:** `yaml-language-server` on PATH; reopen shell after `npm -g` install.
- **No validation:** no schema matched — add a `$schema` modeline or a `yaml.schemas` mapping in your editor's init options.
- **Wrong schema applied:** SchemaStore guessed by filename; pin explicitly with a modeline.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.yaml
# or: bun ../../scripts/verify-lsp.ts path/to/file.yaml
```
