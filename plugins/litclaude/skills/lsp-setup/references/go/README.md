# Go — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `gopls`
- **Extensions:** `.go`
- **Install hint:** `go install golang.org/x/tools/gopls@latest`

## Install

- **macOS:** `go install golang.org/x/tools/gopls@latest` (or `brew install gopls`)
- **Linux:** `go install golang.org/x/tools/gopls@latest`
- **Windows:** `go install golang.org/x/tools/gopls@latest`

Requires the Go toolchain. `go install` drops the binary in `$GOPATH/bin`
(default `~/go/bin`) — that directory must be on PATH.

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

Confirm it resolves:

```bash
command -v gopls
```

## Configure

Add a `go` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "go": {
    "command": ["gopls"],
    "extensionToLanguage": {
      ".go": "go"
    }
  }
}
```

Claude Code routes `.go` edits to `gopls` via the extension map. Analyses such as
`staticcheck` are configured in `gopls` settings (e.g. a workspace `settings.json`
consumed by your editor) rather than in `.lsp.json`.

## Alternatives

None — `gopls` is the official and de facto sole Go language server.

## Troubleshooting
- **PATH:** `gopls` must be on PATH; ensure `$(go env GOPATH)/bin` is exported, then reopen the shell.
- **No diagnostics / "no required module":** open the directory containing `go.mod` as the workspace root. Outside a module, gopls degrades. Run `go mod tidy` if dependencies are unresolved.
- **Stale toolchain:** reinstall with `go install golang.org/x/tools/gopls@latest` after upgrading Go.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.go
# or: bun ../../scripts/verify-lsp.ts path/to/file.go
```
