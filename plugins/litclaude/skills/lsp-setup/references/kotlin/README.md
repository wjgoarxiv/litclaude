# Kotlin — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `kotlin-lsp`
- **Extensions:** `.kt .kts`
- **Install hint:** `https://github.com/Kotlin/kotlin-lsp`

## Install

The official **JetBrains Kotlin LSP** is pre-release. Download a build from the [Kotlin/kotlin-lsp](https://github.com/Kotlin/kotlin-lsp) releases and put the `kotlin-lsp` launcher on PATH.

- **macOS:** Download the release archive, extract, then symlink the launcher: `ln -s /path/to/kotlin-lsp/kotlin-lsp.sh /usr/local/bin/kotlin-lsp`
- **Linux:** Same as macOS — extract the release and place/symlink `kotlin-lsp` on PATH.
- **Windows:** Extract the release and add the directory containing `kotlin-lsp.bat` to PATH (invoke as `kotlin-lsp`).

Requires a **JDK** on the machine to run the server.

Confirm it resolves:

```bash
command -v kotlin-lsp
```

## Configure

Add a `kotlin` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "kotlin": {
    "command": ["kotlin-lsp"],
    "extensionToLanguage": {
      ".kt": "kotlin",
      ".kts": "kotlin"
    }
  }
}
```

Claude Code routes `.kt`/`.kts` edits to `kotlin-lsp` via the map. If the server
cannot find a Java runtime, export `JAVA_HOME` in the launching shell:

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
```

The server resolves classpath from Gradle/Maven; keep the build descriptor
importable.

## Alternatives

**`fwcd/kotlin-language-server`** — older community server. Still usable but less
actively maintained than the official JetBrains one; set the `command` to its
launcher if you prefer it.

## Troubleshooting

- **PATH:** `kotlin-lsp` on PATH; reopen shell after install.
- **Pre-release churn:** the JetBrains server is early; pin a known-good release and expect occasional breakage.
- **No JDK:** server fails to start — install a JDK and/or set `JAVA_HOME`.
- **Slow first import:** Gradle resolution on first open can be slow on large projects; let it complete.
- **`.kts` scripts:** build/script files resolve more slowly than `.kt` sources; this is expected.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/File.kt
# or: bun ../../scripts/verify-lsp.ts path/to/File.kt
```
