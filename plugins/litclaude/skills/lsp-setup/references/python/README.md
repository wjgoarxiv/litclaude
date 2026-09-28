# Python — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `basedpyright-langserver --stdio`
- **Extensions:** `.py .pyi`
- **Install hint:** `pip install basedpyright`

## Install

- **macOS:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Linux:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Windows:** `pip install basedpyright`

Prefer `uv tool install basedpyright` when the project uses uv — it keeps the
server isolated from project venvs and always on PATH.

Confirm it resolves:

```bash
command -v basedpyright-langserver
```

## Configure

Add a `python` entry to `plugins/litclaude/.lsp.json`. LitClaude keys each entry
by language name with a `command` array and an `extensionToLanguage` map:

```json
{
  "python": {
    "command": ["basedpyright-langserver", "--stdio"],
    "extensionToLanguage": {
      ".py": "python",
      ".pyi": "python"
    }
  }
}
```

Claude Code routes `.py`/`.pyi` edits to this server via the extension map.
Type-check strictness lives in `pyrightconfig.json` or `[tool.basedpyright]` in
`pyproject.toml`, not in `.lsp.json`.

## Choosing a server

Type checkers and the linter serve different roles. Run a type server, and
optionally `ruff` ALONGSIDE it (not instead). Set the `command` accordingly:

| command                              | install                | role                                    |
| ------------------------------------ | ---------------------- | --------------------------------------- |
| `["basedpyright-langserver", "--stdio"]` | `pip install basedpyright` | strictest types, **default**       |
| `["pyright-langserver", "--stdio"]`  | `pip install pyright`  | upstream Microsoft type checker         |
| `["ty", "server"]`                   | `pip install ty`       | Astral, very fast, pre-1.0/experimental |
| `["ruff", "server"]`                 | `pip install ruff`     | lint + format only, complements a type server |

Recommended: keep `basedpyright` as the `python` entry. `ruff` does not
type-check, so if you want lint diagnostics too run it as a separate tool rather
than replacing the type server.

## Troubleshooting
- **PATH:** `basedpyright-langserver` must be on PATH; reopen shell after install. `uv tool install` writes to `~/.local/bin`.
- **Wrong interpreter / missing imports:** the server must see the project venv. Set `python.pythonPath` / `venvPath` in `pyrightconfig.json`, or activate the venv before launching.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.py
# or: bun ../../scripts/verify-lsp.ts path/to/file.py
```
