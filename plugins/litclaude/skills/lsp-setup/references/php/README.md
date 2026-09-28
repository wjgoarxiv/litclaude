# PHP — LSP setup (Claude Code / LitClaude)

- **Recommended server:** `intelephense --stdio`
- **Extensions:** `.php`
- **Install hint:** `npm install -g intelephense`

## Install

Intelephense is a Node package, so Node.js (and npm) must be installed first.

- **macOS:** `npm install -g intelephense`
- **Linux:** `npm install -g intelephense`
- **Windows:** `npm install -g intelephense`

Confirm it resolves:

```bash
command -v intelephense
```

## Configure

Add a `php` entry to `plugins/litclaude/.lsp.json`:

```json
{
  "php": {
    "command": ["intelephense", "--stdio"],
    "extensionToLanguage": {
      ".php": "php"
    }
  }
}
```

Claude Code routes `.php` edits to `intelephense` via the map. Intelephense's
premium features (rename, find-all-implementations, etc.) require a licence key,
which is passed through the editor's LSP `initializationOptions` rather than
`.lsp.json`. Without a key the server runs fine in free mode.

## Alternatives

**phpactor** — pure-PHP, no Node dependency. Set the `command` to
`["phpactor", "language-server"]`.

## Troubleshooting
- **PATH:** `intelephense` must be on PATH; reopen the shell after a global npm install. If missing, check `npm bin -g` is on PATH.
- **No Node:** Intelephense fails to start without Node.js. Install Node, then reinstall.
- **Wrong PHP version inference:** set `intelephense.environment.phpVersion` (via your editor's init options) to match your project.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.php
# or: bun ../../scripts/verify-lsp.ts path/to/file.php
```
