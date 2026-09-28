# Rust — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `rust-analyzer`
- **Extensions:** `.rs`
- **Install hint:** `rustup component add rust-analyzer`

## Install

- **macOS:** `rustup component add rust-analyzer` (or `brew install rust-analyzer`)
- **Linux:** `rustup component add rust-analyzer`
- **Windows:** `rustup component add rust-analyzer`

The rustup component is the recommended path — it stays pinned to your toolchain.
`rust-analyzer` also needs the `rust-src` component to index the standard library
(`rustup component add rust-src`).

Confirm it resolves:

```bash
command -v rust-analyzer
```

## Configure

Add a `rust` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "rust": {
    "command": ["rust-analyzer"],
    "extensionToLanguage": {
      ".rs": "rust"
    }
  }
}
```

Claude Code routes `.rs` edits to `rust-analyzer` via the extension map. Options
such as switching the check command to clippy live in `rust-analyzer` settings
consumed by your editor, not in `.lsp.json`.

## Alternatives

None — `rust-analyzer` is the official and sole Rust language server.

## Troubleshooting
- **PATH:** `rust-analyzer` must be on PATH; reopen shell after install. The rustup shim lives in `~/.cargo/bin`.
- **Exits while loading rust-src:** if rust-analyzer crashes during stdlib indexing, reinstall the source component:

  ```bash
  rustup component remove rust-src && rustup component add rust-src
  ```

- **No proc-macro / build script support:** ensure the project builds with `cargo check`; rust-analyzer reuses the same toolchain.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.rs
# or: bun ../../scripts/verify-lsp.ts path/to/file.rs
```
