# Elixir — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `elixir-ls`
- **Extensions:** `.ex .exs`
- **Install hint:** `https://github.com/elixir-lsp/elixir-ls`

## Install

ElixirLS needs Erlang/OTP and Elixir installed first. Build the release from
`https://github.com/elixir-lsp/elixir-ls` and put the `elixir-ls` launcher script on PATH.

- **macOS:** `brew install elixir-ls` (Homebrew provides the launcher), or build the release manually
- **Linux:** clone elixir-ls, run `mix deps.get && mix compile && mix elixir_ls.release2 -o release`, then add `release/` to PATH
- **Windows:** build the release and add the `release` dir (use the `.bat` launcher) to PATH

Confirm it resolves:

```bash
command -v elixir-ls
```

## Configure

Add an `elixir` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "elixir": {
    "command": ["elixir-ls"],
    "extensionToLanguage": {
      ".ex": "elixir",
      ".exs": "elixir"
    }
  }
}
```

Claude Code routes `.ex`/`.exs` edits to `elixir-ls` via the map. No extra
configuration is normally required.

## Alternatives

- **lexical**: set the `command` to `["lexical"]` — fast, modern alternative LSP.
- **next-ls**: set the `command` to `["nextls", "--stdio"]` — from the elixir-tools project.

## Troubleshooting
- **PATH:** `elixir-ls` must be on PATH; reopen the shell after install.
- **asdf users:** the launcher is a shim — after `asdf install`, run `asdf reshim elixir` so the `elixir-ls` shim resolves, and ensure the Erlang/Elixir versions match the build.
- **First start is slow:** ElixirLS compiles your deps on first run; initial diagnostics can take a while on large projects.
- **OTP mismatch:** build elixir-ls with the same Erlang/Elixir versions you use for the project to avoid bytecode errors.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.ex
# or: bun ../../scripts/verify-lsp.ts path/to/file.ex
```
