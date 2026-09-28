# Julia — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `julia --startup-file=no --history-file=no -e "using LanguageServer; runserver()"`
- **Extensions:** `.jl`
- **Install hint:** `julia -e 'using Pkg; Pkg.add("LanguageServer")'`

The PATH executable is `julia`; LanguageServer.jl is launched through the `-e` snippet, not as its own binary.

## Install

Install Julia (juliaup recommended), then add the `LanguageServer` package:

- **macOS:** `brew install juliaup && juliaup add release`
- **Linux:** `curl -fsSL https://install.julialang.org | sh` (installs juliaup)
- **Windows:** `winget install julia -s msstore` (installs juliaup)

Then add the package — ideally into a shared `@lsp` environment so it is not tied to one project:

```bash
julia --project=@lsp -e 'using Pkg; Pkg.add("LanguageServer")'
```

Confirm Julia resolves (the LSP binary IS `julia`):

```bash
command -v julia
```

## Configure

Add a `julia` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "julia": {
    "command": ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
    "extensionToLanguage": {
      ".jl": "julia"
    }
  }
}
```

Claude Code routes `.jl` edits to the Julia language server via the map. To pin
which environment hosts LanguageServer.jl, export `JULIA_PROJECT=@lsp` in the
shell that launches Claude Code.

## Alternatives

- The VS Code Julia extension bundles the same LanguageServer.jl server.

## Troubleshooting
- **PATH:** `julia` on PATH (not a `julials` binary); reopen shell after juliaup install.
- **First run precompiles — be patient:** the initial launch compiles LanguageServer.jl and may take minutes with no output; do not kill it. Subsequent starts are fast.
- **Package not found:** `LanguageServer` must be installed in the environment the server runs in (e.g. `@lsp`); add it there and set `JULIA_PROJECT`.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.jl
# or: bun ../../scripts/verify-lsp.ts path/to/file.jl
```
