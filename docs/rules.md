# Rules engine

LitClaude discovers repo-local rule files and injects the ones that apply, instead of
telling the model to go read them. This document is the contract: what is discovered,
how it is ordered and capped, when it is injected, and — most importantly — exactly
where the glob matcher **diverges** from the `.cursor/rules` dialect.

Implementation: `plugins/litclaude/lib/rules/*.mjs`. No runtime dependencies.

Claude Code reaches the engine through the event registrations in
`plugins/litclaude/hooks/hooks.json`, after the installer enables
`litclaude@litclaude-ai` in the global Claude `settings.json` `enabledPlugins` map.
The engine does not mutate that settings surface. Its only rule-owned mutation is the
project-local session file described below.

## Discovery

Walk up from the working directory until a directory contains one of
`.git`, `pnpm-workspace.yaml`, `package.json`, `pyproject.toml`, `Cargo.toml`,
`go.mod`, `.venv`. That directory is the project root. If none is found there is no
project root and only bundled rules apply.

Scanned at every walked directory (`.md` and `.mdc`, recursive, `node_modules`/`.git`/
`dist`/`build`/`.turbo`/`.next`/`coverage`/`vendor` skipped, depth ≤ 10, ≤ 1000 files):

| Source | Kind |
| --- | --- |
| `.litcodex/rules` | directory |
| `.claude/rules` | directory |
| `.cursor/rules` | directory |
| `.github/instructions` | directory |
| `.github/copilot-instructions.md` | single file, always applies |
| `CONTEXT.md` | single file, always applies |
| `~/.litclaude/rules`, `~/.claude/rules`, `~/.cursor/rules` | user home |
| `plugins/litclaude/bundled-rules/` | shipped with the plugin |

## Ordering

Local before global → nearer the edited file before farther → source priority →
relative path → real path. The order is a total order, and it decides which rules
survive the character budget, so nothing is left to filesystem scan order.

Source priority: `.litcodex/rules` 0, `.claude/rules` 1, `.cursor/rules` 2,
`.github/instructions` 3, `.github/copilot-instructions.md` 4, `CONTEXT.md` 7,
user-home 100–102, `plugin-bundled` 200.

## Frontmatter

A hand-rolled parser reads exactly three keys. Anything else is ignored, and a file
that cannot be parsed degrades to a body-only rule with a diagnostic — it never fails
the hook.

- `description` — string. A rule with *only* a description is **agent-requested**: it is
  never auto-injected.
- `alwaysApply` — `true` / `false`.
- `globs` (aliases `paths`, `applyTo`) — one glob, a comma list, an inline `[a, b]`
  array, or a `- item` block. A quoted scalar keeps its commas.

## Injection lanes

| Lane | Event | Carries | Per-rule cap | Total cap |
| --- | --- | --- | --- | --- |
| static | SessionStart | single-file + `alwaysApply` rules | 12,000 | 40,000 |
| static | UserPromptSubmit | the same, minus anything already injected this session | 6,000 | 16,000 |
| dynamic | PostToolUse | glob rules matching the paths the edit touched | 4,000 | 10,000 |
| re-inject | SessionStart (`source: compact`) | static set again, at a small budget | 3,500 | 4,000 |

The UserPromptSubmit static lane runs whether or not a workflow prompt route activates.
It is a straggler lane for static rules created after SessionStart, and session dedup
normally makes it empty. Prompt text never selects a glob-scoped rule; those rules enter
only through a successful matching PostToolUse edit event.

Per-session dedup is keyed on `relativePath + sha256(body)[0:16]` and stored under the
project's own git-ignored `.litclaude/rules/session-<id>.json`. No user profile is
touched. With no session id, dedup is a no-op and nothing is written.

Compact-sourced `SessionStart` clears the dedup set and spends one unit of a
**2-per-session** re-injection allowance; past that it says the budget is spent instead
of re-injecting. The reservation must be durably persisted before any rule body is emitted.
If that write fails, the hook keeps the cache-reset diagnostic, reports that re-injection
was skipped, and does not re-inject an unreserved rule set. Claude Code does not collect
model context from `PostCompact` stdout, so that event is not registered.

The state mutation is exact: successful static or dynamic delivery updates `injected`,
and a successful compact-sourced `SessionStart` reservation resets `injected` and
increments `postCompactCount` in `.litclaude/rules/session-<id>.json`. No session id means
no dedup, no compact reservation, and no rule-owned write.

Every session-state read/modify/write uses the same per-session exclusive lock, including
dedup updates, so another hook cannot roll a reserved count backward. A missing state file
may initialize from count 0. Any existing malformed, unreadable, oversized, symlinked, or
otherwise uncertain state fails closed and is not replaced. The temporary file is fsynced
before atomic rename, then the containing directory is fsynced where the filesystem supports
it. Only known unsupported directory-open/fsync errors permit success without that final
sync; an `EIO` or other genuine I/O failure reports the write as uncertain while the renamed
state remains authoritative enough to suppress duplicate rule emission.
Ordinary transactions remove their lock directory. A valid nonce/PID owner receipt that is
old enough and whose process is no longer alive may be recovered through unique claimant
receipts and a fenced takeover. The earliest live claimant wins; stale dead claimant receipts
may be removed, while malformed, young, or otherwise uncertain owner or claimant receipts
remain in place and cause bounded fail-closed reservation. A legacy fixed plain-PID claim is
accepted only as a migration receipt, with its age taken from the regular file's mtime.

Rule bodies are injected under a header that names them as project instructions and as
**untrusted data** — text inside a rule file is never treated as a command from the user.

## Glob matcher — divergences from `.cursor/rules`

The matcher is hand-rolled (`lib/rules/glob.mjs`) because vendoring picomatch would be
this repo's first runtime dependency. It supports `**`, `*`, `?`, `{a,b}` and a leading
`!`. It is **not** a picomatch replacement.

Effective basename matching is broader than passing only a project-relative path to that
compiler: a rule glob `*.md` applied to `docs/README.md` does match because the rule matcher
also evaluates the basename `README.md`. The differential table below describes the raw
glob compiler result for the one path shown, before project-relative, scope-relative, and
basename results are combined.

Every row below was **measured** against real picomatch 4.0.4, not asserted. The
differential harness and its output are in
`.litcodex/evidence/.../probes/litclaude/rules-glob-picomatch-differential.txt`, and each
row is pinned by a test in `test/rules-glob.test.mjs`.

### Group 1 — unsupported syntax (LitClaude matches less than picomatch)

A pattern using any of these will simply not match where picomatch would. Rewrite it
with `*`, `**`, `?` or `{a,b}`.

| ID | Syntax | Example | picomatch | LitClaude |
| --- | --- | --- | --- | --- |
| D1 | character classes | `[ab].md` vs `a.md` | match | no match (brackets literal) |
| D2 | extglobs | `@(a\|b).md` vs `a.md` | match | no match |
| D3 | POSIX classes | `[[:digit:]].md` vs `1.md` | match | no match |
| D4 | brace ranges | `v{1..3}.md` vs `v2.md` | match | no match (only comma alternation) |
| D5 | backslash escape | `a\*.md` vs `a*.md` | match | no match — `\` is a path separator |
| D6 | dir self-match | `src/**` vs `src` | match | no match — needs a segment below |
| D7 | regex-style groups | `(a\|b).md` vs `a.md` | match | no match |

D5 is a deliberate trade: rule paths arriving from a Windows host matter more than
escaping a literal asterisk in a glob.

### Group 2 — divergence from the LitCodex donor's configuration

The donor compiles every pattern with `picomatch(pattern, { bash: true, dot: true })`.
Measured effect of `bash: true`: **a trailing `*` behaves like `**`**.

| ID | Example | donor (`bash:true`) | standard (`dot:true`) | LitClaude |
| --- | --- | --- | --- | --- |
| D8 | `*.md` vs `docs/README.md` | match | no match | no match |
| D8 | `src/*` vs `src/a/b` | match | no match | no match |
| D9 | `a**b` vs `ax/xb` | match | no match | no match |

LitClaude follows the standard meaning. Under the donor's setting a rule scoped
`globs: src/*.ts` silently widens to the entire `src` subtree, which is not what a
`.cursor/rules` author writes it to mean. **This is a defect worth reporting upstream to
LitCodex**, not a LitClaude limitation.

### Group 3 — measured parity (pinned so it stays that way)

`*` and `?` stop at `/`; `**` spans zero or more segments in the middle and matches
leading segments; `{a,b}` expands, including nested groups; a single-alternative `{a}`
stays literal in both; a mid-pattern `!` is literal in both; dotfiles match without an
opt-in; matching is case-sensitive; regex metacharacters in a pattern are literal.

### Negation

A leading `!` is handled by the **rule matcher**, not the glob compiler: patterns are
split into a positive list and a negative list, and a negative match vetoes the rule for
that path. `!` anywhere else is a literal character.

## Failure behavior

Every lane is wrapped. An unreadable directory, a malformed rule, a symlink loop, or a
pattern that cannot compile results in fewer rules injected — never a failed hook. A
rule file over 256 KB is truncated before parsing. Compact-sourced `SessionStart` is
stricter about its safety budget: a failed state write keeps the hook alive but fails
closed for re-injection.
