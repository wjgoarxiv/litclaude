# Security reports

Do not disclose credentials, private project content, or an exploitable
reproducer in a public issue or pull request. Start from the repository's
[Security page](https://github.com/wjgoarxiv/litclaude/security). If **Report a
vulnerability** is available, use that private reporting route. Its availability
depends on the repository settings; this document does not establish that it is
enabled.

There is no dedicated private contact published in this repository. If private
reporting is unavailable, use a minimal, non-sensitive
[issue](https://github.com/wjgoarxiv/litclaude/issues) to ask maintainers to arrange
a private channel. Include no exploit details, attachments, affected private
URLs, or secrets in that request. Wait for a confirmed private route before
sending sensitive evidence. If you cannot access the repository, retain the
details privately until an appropriate route is available.

## Useful information for private triage

Provide the affected package version and install method, Claude Code and Node
versions, operating system, impacted CLI/hook surface, expected boundary, and a
minimal reproduction using synthetic data. Explain the impact and any known
workaround. Inspect logs before sharing them, even if a tool redacted some fields.
See [privacy and data flows](docs/privacy.md) for local state and external requests.

Security-sensitive surfaces include public URL and redirect validation, handling
of untrusted prompt/transcript content, installer ownership and deletion,
symlink/path checks, skill application, and package integrity. A report about
host behavior should distinguish the LitClaude code path from Claude Code or a
separately configured tool. Do not test against systems or projects you are not
authorized to assess.

## Maintenance scope

Report the exact affected version, including older versions when relevant.
Maintainers assess fixes against the current maintained source; this project
does not promise a fixed response time, security backports for every old version,
or a support lifetime for unreleased candidates. Coordinate disclosure after a
fix and distribution path have been assessed. Regular usage questions belong in
[support](SUPPORT.md).
