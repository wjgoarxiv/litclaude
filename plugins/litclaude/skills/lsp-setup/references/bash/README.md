# Bash — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `bash-language-server start`
- **Extensions:** `.sh .bash .zsh .ksh`
- **Install hint:** `npm install -g bash-language-server`

## Install

- **macOS:** `npm install -g bash-language-server`
- **Linux:** `npm install -g bash-language-server`
- **Windows:** `npm install -g bash-language-server` (PowerShell)

For real diagnostics, also install `shellcheck`:

- **macOS:** `brew install shellcheck`
- **Linux:** `apt install shellcheck` (or `dnf install ShellCheck`)
- **Windows:** `scoop install shellcheck`

Confirm it resolves:

```bash
command -v bash-language-server
command -v shellcheck
```

## Configure

Add a `bash` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "bash": {
    "command": ["bash-language-server", "start"],
    "extensionToLanguage": {
      ".sh": "shellscript",
      ".bash": "shellscript",
      ".zsh": "shellscript",
      ".ksh": "shellscript"
    }
  }
}
```

Claude Code routes these extensions to `bash-language-server` via the map.
`bash-language-server` discovers `shellcheck` on PATH automatically; to point at a
non-PATH binary, export `SHELLCHECK_PATH` in the launching shell.

## Alternatives

- `shellcheck` standalone as a linter-only flow (no LSP).
- `shfmt` for formatting (complements, does not replace, the LSP).

## Troubleshooting
- **PATH:** `bash-language-server` on PATH; reopen shell after `npm -g` install.
- **No diagnostics:** `shellcheck` missing — diagnostics are powered by it; install and reopen.
- **Wrong shell dialect:** `.zsh`/`.ksh` are linted as bash; shellcheck may flag shell-specific syntax.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.sh
# or: bun ../../scripts/verify-lsp.ts path/to/file.sh
```
