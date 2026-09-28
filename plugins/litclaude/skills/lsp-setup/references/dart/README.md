# Dart — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `dart language-server --lsp`
- **Extensions:** `.dart`
- **Install hint:** `Included with the Dart/Flutter SDK`

## Install

The language server ships inside the Dart SDK (and the Flutter SDK, which bundles Dart). There is no separate package to install — just put `dart` (or `flutter`) on PATH.

- **macOS:** `brew install dart` (or install Flutter and use its bundled `dart`)
- **Linux:** install the Dart SDK from your package manager / `https://dart.dev/get-dart`, or install Flutter
- **Windows:** install the Dart SDK or Flutter SDK and add its `bin` to PATH

Confirm it resolves:

```bash
command -v dart
```

## Configure

Add a `dart` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "dart": {
    "command": ["dart", "language-server", "--lsp"],
    "extensionToLanguage": {
      ".dart": "dart"
    }
  }
}
```

Claude Code routes `.dart` edits to the Dart language server via the map. No
extra configuration is normally required.

## Alternatives

None.

## Troubleshooting
- **PATH:** `dart` must be on PATH; reopen the shell after installing the SDK. Flutter users: ensure `<flutter>/bin/cache/dart-sdk/bin` or the Flutter `bin` is exported.
- **Flutter vs Dart:** if you only have Flutter installed, the bundled `dart` works — make sure Flutter's `bin` is on PATH rather than relying on a separate Dart install.
- **SDK out of date:** run `dart --version` / `flutter upgrade` if analysis behaves oddly on newer language features.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.dart
# or: bun ../../scripts/verify-lsp.ts path/to/file.dart
```
