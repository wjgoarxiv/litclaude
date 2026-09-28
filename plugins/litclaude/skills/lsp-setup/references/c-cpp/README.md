# C / C++ — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `clangd --background-index --clang-tidy`
- **Extensions:** `.c .cpp .cc .cxx .c++ .h .hpp .hh .hxx .h++`
- **Install hint:** `https://clangd.llvm.org/installation`

## Install

- **macOS:** `brew install llvm` (clangd ships in the LLVM keg; add its `bin` to PATH)
- **Linux:** `apt install clangd` (Debian/Ubuntu); use your distro package elsewhere
- **Windows:** install LLVM from `https://releases.llvm.org` or `winget install LLVM.LLVM`

See `https://clangd.llvm.org/installation` for other platforms.

Confirm it resolves:

```bash
command -v clangd
```

## Configure

Add a `c-cpp` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "c-cpp": {
    "command": ["clangd", "--background-index", "--clang-tidy"],
    "extensionToLanguage": {
      ".c": "c",
      ".h": "c",
      ".cpp": "cpp",
      ".cc": "cpp",
      ".cxx": "cpp",
      ".hpp": "cpp",
      ".hh": "cpp",
      ".hxx": "cpp"
    }
  }
}
```

Claude Code routes these extensions to `clangd` via the map. clangd reads
build flags from a project `.clangd` file, not from `.lsp.json`; the `command`
above already passes `--background-index --clang-tidy`.

## Compile commands

clangd needs a `compile_commands.json` at the project root (or in `build/`) for
accurate diagnostics and cross-file navigation. Generate it with:

- **CMake:** `cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` (symlink/copy `build/compile_commands.json` to the root)
- **Make / other:** `bear -- make`

Without it, clangd falls back to heuristic flags and reports spurious errors.

## Alternatives

`ccls` exists as a third-party server — set the `command` to `["ccls"]` in the
`c-cpp` entry if you prefer it.

## Troubleshooting
- **PATH:** `clangd` must be on PATH; reopen shell after install. Homebrew LLVM is keg-only — add `$(brew --prefix llvm)/bin` to PATH.
- **Spurious "file not found" / unknown flags:** missing or stale `compile_commands.json` — regenerate it after changing the build.
- **Header-only diagnostics wrong:** ensure the header's translation unit appears in the compile database, or add a `.clangd` `CompileFlags` block.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.cpp
# or: bun ../../scripts/verify-lsp.ts path/to/file.cpp
```
