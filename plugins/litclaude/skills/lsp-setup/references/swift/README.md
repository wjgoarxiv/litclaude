# Swift — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `sourcekit-lsp`
- **Extensions:** `.swift .objc .objcpp`
- **Install hint:** `Included with Xcode or the Swift toolchain`

## Install

`sourcekit-lsp` ships with the Swift toolchain — no separate install.

- **macOS:** `xcode-select --install` (or install full Xcode). It resolves to the active toolchain selected by `xcode-select`.
- **Linux:** Install a swift.org toolchain (`sourcekit-lsp` ships inside it); add the toolchain's `usr/bin` to PATH.
- **Windows:** Install the swift.org Windows toolchain; `sourcekit-lsp` is bundled.

Confirm it resolves:

```bash
command -v sourcekit-lsp
```

## Configure

Add a `swift` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "swift": {
    "command": ["sourcekit-lsp"],
    "extensionToLanguage": {
      ".swift": "swift",
      ".objc": "objective-c",
      ".objcpp": "objective-cpp"
    }
  }
}
```

Claude Code routes these extensions to `sourcekit-lsp` via the map. For best
results the project needs a **SwiftPM `Package.swift`** or a
`compile_commands.json` compilation database so the server can resolve modules.

## Alternatives

**No mainstream alternative.** `sourcekit-lsp` is the official Apple/swift.org
server and the only practical choice.

## Troubleshooting

- **PATH:** `sourcekit-lsp` on PATH; reopen shell after install (or after `xcode-select -s`).
- **Wrong toolchain (macOS):** point `xcode-select` at the right Xcode/toolchain; mismatches cause stale or missing results.
- **No `Package.swift` / compile db:** add a SwiftPM manifest or generate `compile_commands.json` for accurate indexing.
- **Objective-C (`.objc`/`.objcpp`):** needs a compilation database to resolve headers and frameworks.
- **First build slow:** the server builds the module graph on first open; wait for it.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/File.swift
# or: bun ../../scripts/verify-lsp.ts path/to/File.swift
```
