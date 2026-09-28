# Privacy and data flows

This page describes the shipped LitClaude code paths. Claude Code, its configured
model provider, npm, and separately enabled tools have their own processing and
retention behavior. Local package tests do not establish those services' policies.
LitClaude's local records and redaction checks are not a guarantee that a
transcript, model request, or diagnostic report contains no sensitive information.

## Network activity

| Surface | Destination and data | Controls and limits |
| --- | --- | --- |
| Package installation | npm and its configured registry retrieve package metadata and package bytes; ordinary package-manager connection metadata is visible to those services. Global installation can run LitClaude's postinstall setup. | `LITCLAUDE_AUTO_INSTALL=0` or `LITCLAUDE_POSTINSTALL_SKIP=1` skips automatic plugin/HUD setup. It does not stop npm from fetching the package. |
| Update notice | Interactive `install`, `update`, and `doctor` can schedule an HTTPS GET to `registry.npmjs.org` for the package's latest-version metadata. The request identifies the package and sends an update-notifier user-agent; the request body does not contain project files or prompts. | Attempts are throttled using a 24-hour local cache. `NO_UPDATE_NOTIFIER` or `LITCLAUDE_NO_UPDATE_CHECK` disables the notice/check path, even when the variable is empty. CI, JSON, dry-run, and non-TTY management calls are gated. |
| Automatic update | An eligible cached newer version can trigger npm to fetch and run the installer, then doctor. This can occur on `SessionStart` or interactive management commands. | `LITCLAUDE_NO_AUTO_UPDATE` disables automatic installation but leaves update checks eligible. `LITCLAUDE_NO_UPDATE_CHECK` or `NO_UPDATE_NOTIFIER` disables both paths. SessionStart is a piped host hook, so it does not use the management TTY requirement. |
| Jev skill hint | Off by default. With `LITCLAUDE_JEV=1` and your own `TYPESAFE_API_KEY`, the `UserPromptSubmit` hook sends one HTTPS POST per eligible prompt to `api.typesafe.ai`. The body holds the prompt truncated to 2,000 characters with home paths, e-mail addresses, and token-shaped strings redacted, plus the list of LitClaude skill names and descriptions. Anything in the prompt without a token shape, such as a hostname, a customer name, or a password not written as `password=…`, is sent as written. No files, tool output, or history are sent. TypeSafe bills the request to your account (about $0.04 per million input tokens). | Unset `LITCLAUDE_JEV` to turn it off. Slash commands, routed prompts, and prompts that name a skill are never sent. Each request has a 1.5-second timeout, no retry, no redirect, and a per-session cap of 200. Because `TYPESAFE_API_KEY` is exported in the shell that starts Claude Code, the agent's own tools can read it; use a key dedicated to this feature, with a low spend limit. |
| Public source reader | `litclaude public-read` resolves DNS and sends HTTP(S) GET requests to the supplied public URL and validated redirects. Plain search text becomes a query to `duckduckgo.com/html/`. Requests use a LitClaude user-agent and Accept header. The destination sees the requested path and query, plus normal connection metadata. | The reader rejects credential-bearing URLs and private-network targets, revalidates redirects, and stops at detected authentication/paywall barriers. It does not use a browser login or cookie jar. Redacting a URL in returned evidence does not remove query values from the actual request. |

For a process that should avoid LitClaude background update traffic, set
`LITCLAUDE_NO_UPDATE_CHECK=1`. This is not an offline mode: it does not block an
explicit install, `public-read`, or any network tool Claude Code runs. Select host/tool permissions and network controls appropriate
to the project; do not place secrets in a prompt on the assumption that a local
plugin keeps all model processing on your computer.

The scoped npm target is `@litfamily/litclaude`. The executable aliases `litclaude`
and `litclaude-ai`, existing marketplace registration, and ownership identifiers
remain separate. This is a local candidate identity; its presence in these docs
does not prove public registry availability. See [migration](migration.md).

## Local state

The default product home is `~/.litclaude`, overridden by `LITCLAUDE_HOME`.
Claude settings normally live under `~/.claude`; `CLAUDE_CONFIG_DIR` (or the
supported `CLAUDE_HOME` fallback) selects that home. Installation changes plugin
registration and supported HUD, output-style, or permission settings and records
the values it owns. Automatic-update cache, journals, receipts, and rollback
backups live under the product home's `update-notifier` directory. Backups may
contain host settings, so handle them as private files.

Project-local `.litclaude/` state is distinct from the product home. Depending on
the features used, it contains session/rule receipts, plan and goal state, work
ledgers, saved knowledge, and other feature-specific records. SessionStart
context-pressure detection can inspect a supplied transcript path up to 256 KiB
for a fixed set of pressure markers; it returns only a bounded advisory. No skill
review reads transcript excerpts or sends them to a model. The optional Jev skill hint keeps
per-session request counts, the current turn's hinted skill ID and latency (shown by the
HUD), and whether the once-per-session "on" line was shown in `.litclaude/jev/` and, only with `LITCLAUDE_JEV_TRACE=1`, a trace
of hashes of the redacted prompt, timings, and status codes without prompt text. Existing
`pending-review.json` and `skill-loop-state.json` files are inert after the
automatic review feature's removal and may be deleted. No other state is affected.

There is no universal automatic expiry policy for all these files. A bounded log
or cache TTL is not a deletion promise. Local files are not an
encrypted vault and are not confidential against another process running with
your user permissions.

## Removal and sharing

`litclaude uninstall` removes supported installer-owned registration/settings
according to ownership checks. Modified or foreign managed payload refuses
removal. Nonempty `update-notifier` state, including automatic-update backups,
and unrelated cached versions are retained for explicit review and cleanup. It is not a comprehensive
data-erasure command: it does not erase project ledgers, host transcript copies,
or provider records. Stop active sessions before reviewing retained
state. Back up what you need, identify the exact project/product directories you
own, and remove selected local records manually only after considering recovery
and rollback needs. Do not remove your entire Claude settings directory as a
privacy cleanup shortcut.

Before sharing a support report, inspect and redact the smallest useful excerpt.
Do not upload full transcripts, environment dumps, settings, private URLs,
credentials, or entire state directories. Use the [security process](../SECURITY.md)
for sensitive reports and [support guidance](../SUPPORT.md) for routine issues.

## Source references

- [Postinstall setup](../scripts/postinstall.mjs) and
  [update notifier](../bin/update-notifier.mjs).
- [Automatic update gating, backups, and npm environment](../plugins/litclaude/lib/automatic-update.mjs).
- [Public requests and redirects](../plugins/litclaude/lib/public-source-reader/routes.mjs),
  [target validation](../plugins/litclaude/lib/public-source-reader/validator.mjs), and
  [receipt redaction](../plugins/litclaude/lib/public-source-reader/receipts.mjs).
- [Jev skill hint request, redaction, and validation](../plugins/litclaude/lib/jev-skill-hint.mjs).
- [Project state-root resolution](../plugins/litclaude/lib/project-state-root.mjs),
  [rules session receipts](../plugins/litclaude/lib/rules/session-state.mjs), and
  [litgoal state](../plugins/litclaude/lib/litgoal/state.mjs).
