# Lua — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `lua-language-server`
- **Extensions:** `.lua`
- **Install hint:** `https://github.com/LuaLS/lua-language-server`

## Install

See `https://github.com/LuaLS/lua-language-server`.

- **macOS:** `brew install lua-language-server`
- **Linux:** download a release from GitHub, or `pacman -S lua-language-server` (Arch) / AUR
- **Windows:** download a release from the GitHub releases page and add its `bin` to PATH

Confirm it resolves:

```bash
command -v lua-language-server
```

## Configure

Add a `lua` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "lua": {
    "command": ["lua-language-server"],
    "extensionToLanguage": {
      ".lua": "lua"
    }
  }
}
```

Claude Code routes `.lua` edits to `lua-language-server` via the map. Deeper
behavior (Neovim runtime libraries, the Lua runtime version, allowed globals)
is configured through a project `.luarc.json` rather than `.lsp.json`. For
Neovim config work, a `.luarc.json` like the following resolves `vim` globals and
the stdlib:

```json
{
  "runtime": { "version": "LuaJIT" },
  "workspace": { "library": ["/usr/share/nvim/runtime/lua"] },
  "diagnostics": { "globals": ["vim"] }
}
```

## Alternatives

None.

## Troubleshooting
- **PATH:** `lua-language-server` must be on PATH; reopen the shell after install.
- **Undefined `vim` global:** add `vim` to `diagnostics.globals` and set `workspace.library` in `.luarc.json` (see above) for Neovim work.
- **Wrong runtime version:** set `runtime.version` (`LuaJIT`, `Lua 5.4`, etc.) to match your interpreter, or stdlib functions report as undefined.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.lua
# or: bun ../../scripts/verify-lsp.ts path/to/file.lua
```
