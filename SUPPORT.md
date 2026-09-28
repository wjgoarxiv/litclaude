# Support

Start with [installation and usage](README.md), the
[한국어 guide](README_ko-KR.md), and [migration notes](docs/migration.md).
LitClaude is a Claude Code plugin; a package CLI check does not verify a logged-in
host session. Consult [privacy guidance](docs/privacy.md) before sharing diagnostics.

Use the [issue tracker](https://github.com/wjgoarxiv/litclaude/issues) for a
reproducible bug, feature request, or non-sensitive usage question. These links
follow the repository metadata; access depends on the repository's visibility
and your permissions. There is no guaranteed response time or paid support
channel promised here. Vulnerabilities follow [SECURITY.md](SECURITY.md), not a
public bug report. Community behavior concerns follow the
[code of conduct](CODE_OF_CONDUCT.md).

## Include enough to reproduce

- Package version, install source (published package or local candidate), and
  whether this was a fresh install, upgrade, or repeated install.
- Node and Claude Code versions, operating system, and the exact command or hook
  that failed. Say whether it ran interactively, with `CI`, or with `--json`.
- Expected behavior, observed behavior, the direct exit status, and a minimal
  example using synthetic project data.
- Redacted doctor output, plus any missing optional tool or scientific dependency.
  State whether the result came from the real host, an isolated profile, or a stub.

For diagnostics using the installed CLI, `litclaude doctor --json` avoids the
interactive update path. To disable both background checks and automatic updates
while reproducing, set `LITCLAUDE_NO_UPDATE_CHECK=1` in that process environment.
This does not disable deliberate network commands or host/model-provider traffic.

Do not attach raw session transcripts, `.claude` settings, `.litclaude` state,
environment dumps, credentials, cookies, or private project files. Redact personal
paths, account names, private URLs, and sensitive content from the smallest
relevant excerpt. Automated redaction may miss content. A fresh disposable
profile with fake settings is preferable when the problem involves ownership or
uninstall behavior; do not delete your real settings to obtain a clean result.

For a code fix, follow [CONTRIBUTING.md](CONTRIBUTING.md).
