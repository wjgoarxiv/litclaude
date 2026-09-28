# Zig — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `zls`
- **Extensions:** `.zig .zon`
- **Install hint:** `https://github.com/zigtools/zls`

## Install

ZLS (the Zig Language Server) must be built against the **same Zig version** you use.
See `https://github.com/zigtools/zls`.

- **macOS:** `brew install zls`
- **Linux:** download a prebuilt release matching your Zig version, or `zig build -Doptimize=ReleaseSafe` from the zls source
- **Windows:** download the matching release from the zls GitHub releases, or build from source

Confirm it resolves:

```bash
command -v zls
```

## Configure

Add a `zig` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "zig": {
    "command": ["zls"],
    "extensionToLanguage": {
      ".zig": "zig",
      ".zon": "zig"
    }
  }
}
```

Claude Code routes `.zig`/`.zon` edits to `zls` via the map. No extra
configuration is normally required.

## Alternatives

None.

## Troubleshooting
- **VERSION MATCH (critical):** zls version MUST match your zig version — build/install zls against the exact same Zig. A mismatch causes crashes, parse errors, or silent failures. After upgrading Zig, upgrade/rebuild zls too.
- **PATH:** `zls` must be on PATH; reopen the shell after install.
- **zig not found:** zls invokes `zig` for builds — make sure `zig` itself is also on PATH.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.zig
# or: bun ../../scripts/verify-lsp.ts path/to/file.zig
```
