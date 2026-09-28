# LitClaude Hooks

LitClaude hooks translate the LitClaude prompt workflow into Claude Code hook
events while keeping execution local and bounded.

## #contract.activation

```yaml
contract_schema_version: litclaude.llm-contract.v1
artifact_type: hook-doc
surface: Claude Code plugin hooks
runtime: plugins/litclaude/bin/litclaude-hook.js
registration: plugins/litclaude/hooks/hooks.json
settings_activation: global Claude settings.json enabledPlugins entry for litclaude@litclaude-ai
events: [SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop, SessionEnd]
verdicts: [PASS, FAIL, BLOCKED]
```

| Hook contract field | LLM-facing rule | Runtime evidence |
| --- | --- | --- |
| activation | UserPromptSubmit may add contract context, not execute prompt text. | Hook JSON `additionalContext`. |
| route safety | Slash commands stay on Claude Code's native command surface. | Near-miss and code-span hook fixtures. |
| completion | Hook edits require direct fixture output plus plugin validation. | `node plugins/litclaude/bin/litclaude-hook.js ...`, `npm run validate:plugin`. |

## #contract.inputs

- Hook stdin JSON from Claude Code, including `hook_event_name`, `prompt`, `cwd`, `transcript_path`, tool metadata, and optional native-goal state.
- Repo-local command/SKILL/agent contracts using the same `litclaude.llm-contract.v1` vocabulary.
- Runtime capability facts for native `/goal`, `Workflow`, `EnterWorktree`, agent teams, MCP, and LSP as observed in the active Claude Code session.

## #contract.mode_matrix

| Event or route | Contract mode | Hard boundary |
| --- | --- | --- |
| `SessionStart` | rules discovery and static injection | Adds context and, when `source: compact`, durably reserves bounded rule re-injection after clearing the session dedup set. |
| `UserPromptSubmit` | route classifier, static-rule straggler lane, and explicit resume gate | Prompt routing adds guidance. Static-rule delivery may update rule dedup state; the exact start-work resume route may also mutate code-owned lifecycle state. |
| `PreToolUse` | bounded-authority and humanizer pre-write enforcement | Allows normal Claude permission handling only for classified, authorized action/root pairs; denies supported reader-facing text writes when new prose has a block-tier finding. |
| `PostToolUse` | conditional post-edit routing, dynamic rule injection, and document humanizer check | Names only the checks the edit earned and only the rules whose globs matched. It rechecks successfully created DOCX/PPTX/PDF files when a supported tool or successful Bash output supplies a path; findings ask for revision without claiming rollback or completion. |
| `Stop` | lit-plan and interface-probe gates, start-work continuation, then litgoal autoloop gate | Root-session and progress-bound; no unbounded loop. |
| `SubagentStart` / `SubagentStop` | lane identity observation | Records the root session, child lane, and Claude-owned worktree without emitting child continuation. |
| `SessionEnd` | root-session receipt | Records the observed end and emits no continuation. |

## #contract.procedure

1. Parse stdin JSON; malformed input returns a controlled error.
2. Classify only explicit LitClaude triggers outside code spans, closed backtick or tilde code fences, slash mentions, and diagnostic literal prompts. Text outside a closed fence and intentionally unclosed fence content remains eligible.
3. Return contract vocabulary with route, Skill, mode, evidence, and hard-stop guidance.
4. Preserve prompt text as inert data; emit redacted summaries and stable route strings only.
5. Prove changes with targeted hook fixtures, route tests, and plugin validation before claiming readiness.

## #contract.outputs

- Claude Code hook JSON containing `continue: true`, `hookSpecificOutput.hookEventName`, and route-specific `additionalContext`.
- Optional `systemMessage` for the once-per-session mark and active route ignition marks.
- A block-tier humanizer finding denies a supported reader-facing text write in `PreToolUse`; `PostToolUse` `additionalContext` reports advisory or fail-open notes and findings from supported DOCX/PPTX/PDF checks after creation, without claiming rollback.
- `BLOCKED:` text for natural-language start-work, unavailable native goal binding, disabled Dynamic workflow, or gated agent-team setup.
- Unavailable native goal binding also includes `READY_TO_PASTE` and one bounded `/goal` command for the user to copy, paste, and send; the hook never enters or submits it.

## #contract.evidence

- Direct fixture command: `node plugins/litclaude/bin/litclaude-hook.js user-prompt-submit < fixtures/hooks/user-prompt-litwork.json`.
- Route tests in `test/hooks.test.mjs` for positive routes, near-misses, degraded goal guidance, and unsafe prompt text.
- Real plugin surface checks: `npm run validate:plugin`, `npm run doctor`, scanner, and payload guard when hook payload changes.

## #contract.hard_stops

- Do not echo dangerous prompt substrings, secrets, or command text into hook output.
- Do not claim native `/goal`, Dynamic workflow, EnterWorktree, MCP, LSP, or agent-team success unless Claude Code exposes and confirms that surface.
- Prompt route classification does not mutate host settings, registries, or remote state. The static-rule lane may write only project-local `.litclaude/rules/session-<id>.json` dedup state, and the exact trusted start-work resume route may mutate only code-owned schema-3 lifecycle state after identity checks.

## #contract.anti_patterns

- Do not convert a natural-language trigger into a hidden slash-command dispatch.
- Do not treat a hook context injection as proof that a Skill, agent, Workflow, or `/goal` actually ran.
- Do not broaden route detection to substrings, code blocks, command mentions, or documentation examples.
- Do not replace Claude Code plugin terminology with another harness's routing model.

## Hook Events

The plugin declares these events in `plugins/litclaude/hooks/hooks.json`. Claude Code
loads that manifest only when install has enabled `litclaude@litclaude-ai` in the global
Claude `settings.json` `enabledPlugins` map. The hook runner itself does not edit those
settings. Separately, installer permission modes mutate global Claude settings
`permissions.allow` and `permissions.deny`, preserve pre-existing entries, track only
entries LitClaude inserted, and remove only those tracked entries on mode change or
uninstall.

For `SessionStart` with `source: compact`, the **2-per-session** budget reservation must
be durably persisted before static rule text is emitted. A failed reservation keeps the hook alive
for diagnostics but does not re-inject rules as if a budget unit had been reserved.
Reservation uses a per-session exclusive filesystem lock around strict state read,
increment, fsynced temporary write, atomic rename, and directory fsync where supported. Known
unsupported directory-sync errors preserve portability; genuine I/O failures report an
uncertain reservation, while renamed state still suppresses duplicate emission. Genuinely
missing state may initialize at count 0. Existing malformed, unreadable, oversized, symlinked,
or otherwise uncertain state fails closed without replacement. Lock uncertainty also fails
closed; ordinary owners remove their lock artifact, and only a stale valid nonce/PID owner
whose process is no longer alive may be replaced through a fenced takeover. Live or malformed
incumbents are not silently removed. Claude Code does not collect model context from its
`PostCompact` stdout, so LitClaude does not register that event; the legacy runner is a
silent no-op for callers that still invoke it directly.

| Event | Runner | Purpose |
| --- | --- | --- |
| `SessionStart` | `plugins/litclaude/bin/litclaude-hook.js session-start` | Runs the bounded foreground automatic-update barrier on a fresh session, discovers repo-local rule files, names the newest valid `plans/<slug>.md`, and on `source: compact` spends one of two durable re-injection reservations at reduced caps. |
| `UserPromptSubmit` | `plugins/litclaude/bin/litclaude-hook.js user-prompt-submit` | Detects prompt routes and injects workflow context; independently delivers static rules not already recorded for this session; with `LITCLAUDE_JEV=1` and `TYPESAFE_API_KEY` set, adds at most one Jev skill hint line to an unrouted turn. |
| `PreToolUse` | `plugins/litclaude/bin/litclaude-hook.js pre-tool-use` | Enforces semantic action/root grants before Write, Edit, MultiEdit, NotebookEdit, Bash, Agent, and bounded read tools execute; denies supported reader-facing text writes with a humanizer block-tier finding. |
| `PostToolUse` | `plugins/litclaude/bin/litclaude-hook.js post-tool-use` | Names the post-edit checks the edit actually earned, injects any glob-scoped rule matching the edited paths, and checks successfully created DOCX/PPTX/PDF files for humanizer findings, including paths reported by Bash output. |
| `Stop` | `plugins/litclaude/bin/litclaude-hook.js stop` | Holds a lit-plan turn with no persisted plan and a lit workflow turn that edited interface files without a clean interface-probe run (each at most twice per turn), emits bounded start-work continuation on new progress, otherwise applies the opt-in litgoal autoloop gate. |
| `SubagentStart` | `plugins/litclaude/bin/litclaude-hook.js subagent-start` | Registers child-lane and Claude-owned worktree identity. |
| `SubagentStop` | `plugins/litclaude/bin/litclaude-hook.js subagent-stop` | Finalizes the lane without child continuation. |
| `SessionEnd` | `plugins/litclaude/bin/litclaude-hook.js session-end` | Records root-session end without blocking Claude. |

### Changed-text humanizer guard

`PreToolUse` checks every supported reader-facing text write in `Write`, `Edit`,
and `MultiEdit`; it does not depend on a loaded skill or declared artifact genre.
Path extensions and README-family names determine whether the target is supported
reader-facing text. The guard ignores paths outside the current working root and
internal paths such as plans, evidence, handoffs, ledgers, and tool-state directories.

The guard compares submitted text with the prior text when the host provides it
or the existing file can be read safely, then scans the added or changed lines.
It excludes quoted user text and fenced code. A block-tier finding denies the
pre-write operation and asks for a rewrite; a warn-tier finding adds advisory
context and leaves the write allowed. A clean result adds no extra message.

After a successful tool call, `PostToolUse` checks newly created DOCX, PPTX, and
PDF files. It uses paths reported by document-aware tools or extracted from
successful Bash output; the `stdout` and `stderr` streams can report the new
document path. It reads the created file through a bounded stable-file check
before extracting text. DOCX/PPTX extraction uses the bundled helper. PDF
text extraction depends on `pdftotext`; without it the guard reports a
limitation. A block-tier result arrives after file creation, so it cannot deny
or roll back that operation; it asks the model to revise and rebuild. Warn-tier
results remain advisory.

The guard fails open when inputs, diffs, files, extraction, or the detector
exceed supported bounds or cannot be checked safely. It adds a visible one-line
note explaining that the check was skipped and the write was allowed. The
pre-write path accepts at most 16 paths, 512 KiB per file, and 2 MiB in
aggregate; the post-create path checks at most two documents and 8 MiB in total.
The direct driver and regression fixtures live in
`test/deliverable-hedge-guard.test.mjs` and `test/lit-humanizer-hook.test.mjs`.

### Cross-session plan discovery

The scaffold writer remains the only plan write surface. It writes through a same-directory
temporary file, fsyncs the file, and commits atomically. A new target uses a no-clobber
create step. Existing no-op, `--reset`, `--force`, hand-edit, and symlink checks remain in
force. A slug-scoped lock serializes paired writers. A concurrent writer fails closed instead
of replacing an in-flight pair. A failed paired write removes only files created by that
invocation. Temporary files and lock files are verified after cleanup. Residue is reported
on the write error instead of being hidden.

`SessionStart` and the non-resume `$start-work` prompt routes perform discovery only. The
resolver walks upward from the hook `cwd` to the nearest project marker. It never crosses that
boundary. Without a project marker, the supplied `cwd` is the boundary. It returns a path
relative to the supplied `cwd`, so a nested hook receives a usable `../plans/<slug>.md` path.
It rejects symlinked parents and directories. It ignores symlinked files, unreadable or
changing entries, files over 256 KiB, and plans that fail the scaffold's canonical
`checkPlanStructure()` check. An unfilled or stale scaffold therefore stays silent. The
notice does not echo plan text, create `.litclaude` lifecycle state, or grant start-work
authority. The exact resume route remains the only lifecycle mutation path. `--check` uses
the same bounded, no-follow regular-file read boundary.

Node's path-based `rename()` has no compare-and-swap primitive. The writer therefore combines
the slug lock with parent and target identity checks before and after the commit. A
non-cooperating process can still race the final path operation. The writer reports a changed
identity and fails closed when it observes that race. It does not claim an atomic
compare-and-swap guarantee that Node's standard library does not provide.

### Foreground automatic-update barrier

The SessionStart hook waits for one bounded automatic-update transaction when a
fresh product-owned cache entry names a newer strict stable package version. The
transaction uses a separate install lock, credential-free npm environment, exact
`npm exec --yes --package @litfamily/litclaude@<version> -- litclaude-ai` arguments, a backup/journal,
post-install doctor, and rollback before the hook emits its rules context. The
same lane is available to interactive TTY `install`, `update`, and `doctor`
commands. `--no-auto-update`, `LITCLAUDE_NO_AUTO_UPDATE`,
`NO_UPDATE_NOTIFIER`, and `LITCLAUDE_NO_UPDATE_CHECK` disable it. CI, JSON,
dry-run, non-TTY management commands, import, and tool surfaces remain no-op;
the host-owned SessionStart hook is the lifecycle exception to the TTY check.
The detached registry cache refresh described in the update-notifier section is
advisory and never performs an install.

### Jev skill hint (optional)

`plugins/litclaude/lib/jev-skill-hint.mjs` is off unless both `LITCLAUDE_JEV=1` and a
non-empty `TYPESAFE_API_KEY` are in the hook's environment. The key is read from the
environment only; the hook never reads a key file and never writes, prints, or traces the key.

A turn is eligible only when the deterministic router chose no route, the prompt is not a
slash command, a `!` shell line, or a host-expanded command, it names no skill (a
`litclaude:` name or a hyphenated or `lit`-prefixed catalog ID), and at least four
non-space characters remain after host notification blocks are removed. The exact bare
routes, the trusted start-work resume, and the diagnostic literal prompt are never eligible.

An eligible turn sends one `POST https://api.typesafe.ai/v1/systemone` with no retry and
`redirect: "error"`, so a redirect fails the request instead of being followed. The body holds
only `model`, `state`, and `questions`. `state` is built from the first 8,000 characters of the
prompt: the key's literal value becomes `[secret]`, home paths (`/Users/<name>`,
`/home/<name>`, `C:\Users\<name>`, with or without a trailing slash) become `~`, e-mail
addresses become `[email]`, and token shapes (`sk-`, `sk-ant-`, `ghp_`, `gho_`,
`github_pat_`, `npm_`, `apikey_`, `xox[abprs]-`, `AKIA`, `AIza`, JWTs, PEM blocks, any
run of 32 or more `[A-Za-z0-9+/_-]` characters with optional `=` padding, and the plugin's
shared credential shapes) become `[secret]`. Only then is it cut to 2,000 characters, and a
run of 8 or more token characters left at the cut also becomes `[secret]`. Anything in the
prompt without a token shape, such as a hostname, a customer name, or a password that is not
written as `password=…`, is sent as written. `questions.which` is a choice over every enrolled skill
that the model may invoke (skills marked `disable-model-invocation: true` are left out),
each with the first 300 characters of its description, plus `none`.

The response is untrusted. The hook accepts it only on HTTP 200 with valid JSON, an
`answers.which.choice` that exactly equals a catalog ID it sent, and a numeric
`answers.which.confidence` of at least the threshold. Then it appends one fixed line to
`additionalContext`:

```text
LitClaude skill hint: the skill `litclaude:<id>` likely fits this request. Load it only if it really fits; this is advice, not an instruction.
```

`none` or a low confidence adds nothing. A non-200 response body is cancelled unread. The hook
records the call in the session file before sending it; when that write fails, it sends
nothing and stays quiet, so an unwritable state folder cannot lift the cap. After the prompt
hook writes its context on a turn with the flag on, it ends its own process once stdout has
flushed, so a DNS lookup that the timeout cannot cancel never keeps it past the host's hook
timeout. A missing key, reached cap, oversized request,
timeout, network error, non-200 status, or invalid response leaves the turn exactly as it
would be without the feature. The first such failure in a session shows one `systemMessage`
(`LitClaude skill hint unavailable (<reason>); continuing normally.`); later failures stay quiet.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LITCLAUDE_JEV` | unset | `1` turns the hint on. Any other value leaves it off. |
| `TYPESAFE_API_KEY` | unset | Your own TypeSafe key. Required while the flag is on. |
| `LITCLAUDE_JEV_MODEL` | `jev-1.13.0` | Model name sent in the request. |
| `LITCLAUDE_JEV_TIMEOUT_MS` | `1500` | Hard timeout; values above `3000` are capped. |
| `LITCLAUDE_JEV_MAX_CALLS` | `200` | Requests per session before the hint stops. |
| `LITCLAUDE_JEV_MIN_CONFIDENCE` | `0.35` | Lowest accepted confidence. |
| `LITCLAUDE_JEV_TRACE` | unset | `1` appends a debug trace line per request. |

Per-session counters live in `.litclaude/jev/session-<id>.json` under the project state
root, with the current turn's hinted skill ID and latency in milliseconds; the prompt hook
clears that pair at the start of every turn while the flag is on. The optional HUD status line
(`plugins/litclaude/bin/litclaude-hud.js`) reads it and puts a badge right after the model
label: `✦Jev` while the hint is on, `✦Jev → <skill>` on a hinted turn, or `✦Jev ⚠ key` when
the flag is on without a key; it shows nothing while the flag is off, never shows the latency,
and never shows the key or its length. While on, the HUD paints `✦` gold, the hinted skill green
and the missing-key badge amber, and paints `Jev` as a rainbow whose starting hue follows the
clock, so each refresh shifts it slightly (truecolor, 256- and 16-colour tiers; plain under
`NO_COLOR` or the HUD's no-colour switch; a light or unknown appearance keeps the words on the
default foreground and colours only the marks). The session file also records that the
once-per-session `✦ Jev skill hint ON ✦` `systemMessage` was shown; the prompt hook writes that
mark before it emits the line on the first turn with the flag and key set, puts the line ahead
of any other visible message that turn, and shows no line when the mark cannot be written. The opt-in trace, `.litclaude/jev/trace.jsonl`, records the timestamp, the SHA-256 of the
redacted `state` (never of the raw prompt), chosen ID, confidence, latency, HTTP status, and fallback reason; it holds no prompt text,
key, or response body. Session and trace files are opened with `O_NOFOLLOW` (an `lstat` check
where the platform lacks it), so a symlink planted at either path is refused rather than written
through. The `.litclaude` and `.litclaude/jev` folders must be real folders too: when either one
is a symlink, the hint reads and writes nothing there, sends no request, and shows no hint or note. Because `TYPESAFE_API_KEY` is exported in the shell that starts Claude Code, the
agent's own tools can read it too; use a key dedicated to this feature, with a low spend limit.
`litclaude doctor` prints `Jev skill hint: off`, `Jev skill hint: on`,
or `Jev skill hint: flag on but TYPESAFE_API_KEY missing`. The offline regression tests,
which replace `fetch` in the real hook process, live in `test/jev-skill-hint.test.mjs`.

## Bounded-authority start-work lifecycle

The hook and CLI share `plugins/litclaude/lib/start-work-lifecycle.mjs`.
Schema-3 `.litclaude/boulder.json` owns active work/session identity, monotonic
revision, canonical roots, semantic action/root grants, consumed grants,
fenced-safe progress, bounded events/history, and terminal state. CLI mutations
use exact idempotency keys, exclusive locks, and ledger reconciliation.
PreToolUse Bash handling recognizes only a small command grammar: every
permitted path operand is canonicalized and checked against the matching
semantic grant, while relocation flags, shell syntax that would require a
speculative parser, and unverified or outside targets are denied without
creating an approval boundary.

Resume is the only mutating `UserPromptSubmit` exception. It accepts only the
complete prompt below, with no surrounding explanation or extra arguments:

```text
/litclaude:start-work resume --work-id <id> --revision <n> --boundary-id <id> --prompt-id <id> --grant-id <id>
```

The hook matches the owning Claude session and exact paused boundary before
recording the grant. There is no generic CLI resume or agent-callable approval
bypass. Returned `<litclaude-start-work-context>` JSON is bounded structured
data and contains no raw prompt. Stop ignores subagents and stale work/revision
events; each normal Stop re-evaluates progress, a new fingerprint emits once,
and `stop_hook_active: true` re-entry stays silent so stale output cannot block
again. Later unchanged turns are silent. Transcript pressure checks read only regular,
non-symlink files at or below 256 KiB.
Continuation receipts use the same bounded window as retained state events.
They remain bounded audit receipts, not re-entry instructions; neither retained
nor evicted receipts reconstructs a blocking continuation.

LitClaude intentionally does not register `WorktreeCreate` or `WorktreeRemove`.
Registering `WorktreeCreate` replaces Claude Code's native git-worktree
implementation and obligates the hook to create and return the worktree itself.
Instead, `SubagentStart.cwd` observes each Claude-owned worktree and binds it to
the root session and lane; `SubagentStop` marks host removal as expected without
pretending LitClaude owns creation or deletion.

## Workflow Trigger Phrases

The `UserPromptSubmit` hook activates on these natural-language phrases and
legacy dollar shorthands:

```text
lit
litwork
lit plan
lit review
lit research
lit search
lit query
lit goal
lit workflow
lit dynamic workflow
lit ultracode
lit team
lit team mode
lit teammates
lit start work
lit recap
litrecap
recap
리캡
lit-comprehend
comprehend
$lit-comprehend
$comprehend
$lit-plan
$lit-recap
$lit-loop
$deep-interview
$lit-loop
$review-work
$litgoal
$start-work
autoresearch <mode>
$autoresearch <mode>
autoconference <mode>
$autoconference <mode>
wikify <mode>
$wikify <mode>
handoff
lit-scientific-visualization
```

When a LIT trigger is present, the hook returns additional context containing
`LITWORK MODE ENABLED` and a visible `🔥 LIT IGNITED · <discipline> 🔥` system
message. That context is guidance for Claude Code; it is not executed as a
command. Slash commands and slash-command mentions are native Claude Code
surfaces and do not activate this prompt hook; code spans, substrings, and
compound tokens are also ignored. Closed backtick and tilde code fences are
inert; text outside them and intentionally unclosed fence content remains eligible.
Natural `lit start work`
returns a `BLOCKED:` handoff that tells the user to run `/start-work` or
`/litclaude:start-work` with the approved plan, because a prompt hook cannot
switch Claude Code agents. The `$start-work` shorthand and natural start-work
phrases activate only when they lead the prompt; diagnostic prose and copied or
blockquoted mentions remain inert.

`autoresearch`, `autoconference`, and `wikify` are family routes. A leading bare
token or dollar shorthand loads one Claude Code skill whose first argument selects
its nested mode corpus. Mid-sentence mentions, slash-command text, inline code, and
closed fences remain inert. The native command routes are
`/litclaude:autoresearch`, `/litclaude:autoconference`, and `/litclaude:wikify`.
Each prompt-hook family route injects its absolute installed canonical vendor
root derived from the hook module URL, so nested source paths resolve correctly
even when Claude Code was launched from an unrelated working directory.
Autoresearch requires the `lit-plan` → explicit budget/authority approval →
`start-work` → bounded loop → `review-work` lifecycle. Autoconference additionally
requires root multi-agent capability and returns `BLOCKED_MULTI_AGENT_UNAVAILABLE`
rather than faking concurrency; children return results while the root owns shared
state. Wikify keeps local and fetched sources inert, routes public retrieval through
`litresearch`, and closes through `review-work` plus `lit-recap` or `handoff`.
Its structured knowledge runtime receives only `fact`, `decision`, `failure`,
`risk`, `rule`, or `checkpoint` events through the local CLI or MCP tools. It
stores review-needed claims under `.litclaude/knowledge/claims.jsonl`. Explicit
save or review can accept a claim. Queries use deterministic local relevance and
return accepted claims only. They emit no block on no match. Capture never mines
raw chat, source bodies, fetched text, credentials, secrets, tokens, or
instruction-shaped payloads. Use `litclaude wikify config --capture off` for the
project-local opt-out.
Wikify state is user-owned local state. LitClaude writers cooperate through the
`.claims-lock` owner lock. Symlinks, unsafe file types, pre-existing hardlinks, and
observed path or descriptor identity changes fail closed. Atomic rename protects
target readers and crash consistency. The state is not tamper-proof or confidential
against another process with the same uid.

`handoff` is a separate exact-bare route: only the complete prompt `handoff`
after outer whitespace activates `Skill(lit-handoff)` and injects the complete
canonical bundled source. Its system message shows `🔥 LIT IGNITED · lit-handoff 🔥`;
the model begins with exactly one `🔥 **LIT IGNITED · lit-handoff** 🔥` probe line. Explanatory mentions, quoted or fenced
text, compound prompts, `/litclaude:lit-handoff`, and secret-bearing multiline
content do not activate the hook. The slash command remains a native Claude
Code command surface.

Scientific visualization has one exact-bare UserPromptSubmit route: only the
complete prompt `lit-scientific-visualization` after outer whitespace activates
`Skill(lit-scientific-visualization)`, injects the full adapter and canonical
source, and shows `🔥 LIT IGNITED · lit-scientific-visualization 🔥` in its system
message. The model begins with exactly one `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥` probe line.
Generic visualization, plot, chart, figure, and scientific visualization prose,
mentions, quoted or fenced text, mixed prompts, near misses, and
`/litclaude:lit-scientific-visualization` text do not activate the prompt hook.
The slash command remains a native Claude Code command surface.

LitClaude follows the LitClaude goal pattern as an honest native-binding attempt,
not as slash-command injection. If Claude Code exposes native goal tools, the
guidance tells Claude to inspect `get_goal`, call `create_goal` only when no
matching goal is active, and delay `update_goal` until verified completion or a
genuine blocker. The hook also refuses to clobber a different active goal
without explicit replacement.

Source-backed capability note: the observed `UserPromptSubmit` hook surface can
add `additionalContext` or block; it cannot replace the prompt or run another
slash command. If goal tools are unavailable or not exposed in the running
Claude Code session, the hook returns explicit `BLOCKED:` / degraded-mode
guidance plus a `READY_TO_PASTE` command, does not claim native goal success,
keeps the local `litgoal` evidence ledger authoritative, and may suggest
`/goal <completion condition>` or
`claude -p "/goal <completion condition>"` for the native user surface.
For a separate worker session, `litclaude-ai litgoal native-worker --condition
"<completion condition>"` builds a dry-run native `/goal` worker command; adding
`--execute` starts a print/background Claude Code worker whose first prompt begins
with `/goal`. This worker launcher is not current-TUI auto-arm and must not be
described as hook-driven slash-command dispatch.

For broad work, the same context ports the LitClaude model-facing principle to
Claude Code's exposed orchestration surfaces: `lit workflow`, `lit dynamic
workflow`, and `lit ultracode` prefer current `ultracode` or explicit “run a
workflow” / “use a workflow” wording, not casual mentions. If `Workflow` is
available, propose it first and call the `Workflow` tool only after user opt-in
or existing session permission, binding every lane to evidence and cleanup. If
`CLAUDE_CODE_DISABLE_WORKFLOWS=1` is set, report the setup gate and fall back to
normal LitClaude planning/subagent delegation. If isolated edits need a
model-facing worktree lane, use `EnterWorktree`; when only the CLI surface is
available, the actionable launch form is `claude --worktree <short-name> --tmux`.

For native agent teams, `lit team`, `lit team mode`, and `lit teammates` are
setup-gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. When enabled, steer
Claude to spawn named teammates only after user approval, with roles, file-scope
boundaries, acceptance criteria, wait instructions, and final synthesis. When
disabled, say so and offer subagent/Dynamic workflow fallback. Optional display
setup is `claude --teammate-mode auto` or `"teammateMode": "auto"`.

`/litclaude:lit-loop` and `$lit-loop` are the consolidated route
for that behavior. They load `/litclaude:lit-loop` / `Skill(lit-loop)`,
then map subagent delegation to `lit-planner`, `lit-executor`,
`lit-verifier`, `qa-runner`, `quality-reviewer`, and `librarian-researcher`.
The hook also reminds child assignments to use `TASK:`, `DELIVERABLE`, `SCOPE`,
and `VERIFY`, with short wait cycles and fallback only after missing
deliverables, acknowledgement-only replies, or `BLOCKED:` reports. Run
`litclaude-ai workflow-check --json` to verify the hook route, goal guidance,
Dynamic workflow guidance, subagent reliability, and command/hook agreement
before full QA.

When SessionStart sees transcript context-pressure markers, the hook adds a
bounded resume reminder to reread `HANDOFF.md`, the active plan, the start-work
ledger, Boulder state, and `git status --short` before edits.

Plain `lit` therefore activates hook context, not a visible Skill tool call.
For a visible LitClaude command/skill invocation, use the namespaced Claude
Code commands:

```text
/litclaude:lit-loop <goal or delegated objective>
/litclaude:lit-plan <planning brief>
/litclaude:start-work plans/example-plan.md
```

These are real Claude Code command files in `plugins/litclaude/commands/`.

`/deep-interview` is the clarification route. It loads
`/litclaude:deep-interview` / `Skill(deep-interview)` guidance and should run
before `/lit-plan` when a request lacks non-goals, decision boundaries, or
acceptance criteria.

`/review-work` and `$review-work` load `/litclaude:review-work` /
`Skill(review-work)`. For a draft plan, that route performs a read-only
objective-achievability audit and returns `PASS`, `ITERATE`, or `NEEDS-CONTEXT`
without implementing. For completed work it runs the 5-lane review: scope/diff
verification, tests/evidence execution, package/payload and code quality,
security/provenance, and real-surface/docs readiness. `/litgoal` and `$litgoal` load
`/litclaude:litgoal` / `Skill(litgoal)` for durable local goal state and
the litgoal CLI.

`recap`, `lit recap`, `litrecap`, `리캡`, and `$lit-recap` load
`/litclaude:lit-recap` / `Skill(lit-recap)` for a read-only session recap built
from `.litclaude/litgoal/goals.json`, `ledger.jsonl`, `brief.md`, and
current-session context. Recap activation is side-effect-free: it never writes
ledgers or files and forbids mutating `litgoal` subcommands. Near-miss tokens
(`recapture`, `recaptcha`, `리캡처`) and slash forms (`/lit-recap`, `/litrecap`,
`/lit recap`) do not activate the hook. The recap answers in Korean with fixed
headers by default, switches the body to English on `--en`, and emits the brief
`## ⚡ 요약` digest on `--brief` / `짧게`.

`lit-comprehend`, bare `comprehend`, `lit comprehend`, `$lit-comprehend`, and
`$comprehend` load `/litclaude:lit-comprehend` / `Skill(lit-comprehend)` for a self-contained explainer artifact aimed at
understanding rather than status: it anchors on what the reader already knew,
explains the intuition before the code, walks the change in conceptual order
instead of file order, offers an interactive micro-world, discloses what is
**not** verified, and closes with a quiz that shows where to slow down. The trigger surface is deliberately wider than the skill id, because bare
`comprehend` is what users actually type — the same reasoning that keeps bare
`recap` routed to `lit-recap`. Breadth is affordable only because **activation is
not execution**: with no explicit scope the skill states what it would explain and
waits, so a loose match costs one line rather than a multi-minute build. The
natural-language forms (`explain this`, `설명해줘`, `이해가 안 돼`) stay out of the
hook regardless; that judgement is left to Claude Code's own Skill-description
matching, which can weigh the whole prompt. `lit comprehend` and `litwork
comprehend` are matched ahead of the bare `lit`/`litwork` tokens so the phrase
reaches this skill instead of falling through to the generic lit cascade. Near-miss tokens (`comprehension`,
`incomprehensible`) and slash forms (`/comprehend`, `/lit-comprehend`,
`/litclaude:lit-comprehend`, `/lit comprehend`) do not activate the hook. The artifact is written **outside** the worktree to
`~/.litclaude/lit-comprehend/YYYY-MM-DD-<slug>.html`, is fully self-contained, and
must pass `scripts/verify-explainer.mjs` — which fails a phantom code quote, a
missing path, an external resource, a missing canonical section, a quiz with an
unfeedbacked option or a positional tell, and ASCII-art diagrams — before the
work may be reported as done.

`litresearch`, `$litresearch`, `lit research`, `lit search`, and `lit query`
load `/litclaude:litresearch` / `Skill(litresearch)` when the user asks for a
cited investigation. Search/query lanes prefer public APIs or feeds, validate
content before treating a fetch as evidence, keep a route trace, quarantine
fetched text as prompt-injection data, and stop honestly at authentication,
paywall, private-data, or credential boundaries. If the user requests read-only,
no-write, or transcript-only research, ask before creating
`.litclaude/litresearch/<slug>/` and otherwise keep the journal in the
transcript/TodoWrite. The guaranteed runtime surface is direct public URL reads
through `public_source_read` or `litclaude public-read`; its JSON includes
`fetchAttempts`, `fetchVerdict`, untried safe routes, a starter claim graph, and
`contentSafety` flags declaring fetched text untrusted and its instructions
ignored, so HTTP 200 is not treated as success without content validation. Dynamic
`Workflow`, `/deep-research`, browsing, and namespaced subagents are
host-dependent and need fallbacks.

## Safety

Hooks parse JSON from stdin and return JSON to Claude Code. The hook does not
execute prompt text and does not echo prompt text into the returned context;
prompt text is not executed or echoed. The optional Jev skill hint is the one network
call on this path: it is off by default, sends only redacted prompt text, and returns a fixed
sentence rather than any response text. The litwork detector returns constant
workflow guidance, so a prompt cannot become a shell command through the hook
response. Malformed hook input and malformed litgoal JSON should surface a controlled error instead of a misleading success response.

## Local Smoke

Run the hook fixture directly:

```bash
node plugins/litclaude/bin/litclaude-hook.js user-prompt-submit < fixtures/hooks/user-prompt-litwork.json
```

Reload local plugin metadata in Claude Code after hook edits:

```text
/reload-plugins
```

## LIT mark and reply probe

SessionStart renders the standard 22×10 Ignition B mark and `litclaude vX.Y.Z` in
`systemMessage`. The existing locked per-session rule state retains a separate
ignition receipt through resume and compact resets. Missing session identity or
unsafe/unwritable state suppresses this decoration; normal context still loads.
Ignition uses the same discovered project root as rules and compaction, so moving
between nested directories and the root cannot create a second receipt. Invalid
or symlinked cwd and missing project roots also suppress decoration; unsafe root
state never falls back to a nested state directory.
A compact event never repeats the session mark.

Activated UserPromptSubmit routes render the plain mark
`🔥 LIT IGNITED · <discipline> 🔥` in `systemMessage`. Inactive prompts stay silent.
`additionalContext` requires the model's reply to begin with exactly one
`🔥 **LIT IGNITED · <discipline>** 🔥` line. The system mark and reply probe are
separate outputs; the model must not draw ASCII art or emit a second probe.

Hook JSON uses uncolored rows. CLI output uses the 44×20 Ignition B banner and
native product column inside the existing installer frame; `--help` and doctor
share that mark. The micro envelope remains 16×5, with eleven active columns.
Interactive terminals paint each symbol cell with orange `#FF6337`, lime
`#D7F75B`, or ivory `#F2EFDF` (fixed 256-color fallback: 203/191/230). The symbol
has no row gradient, extrusion, or forced background; product labels remain plain.
NO_COLOR and CI presence (including empty values), non-TTY, and JSON suppress ANSI.
A non-UTF-8 locale or TERM=dumb uses a plain `LIT` line. Functional install-step
colors and progress behavior retain their existing policy.

The plugin-local `lib/lit-mark.mjs` owns all three row exports and per-cell color
maps. The package CLI re-exports that module, and installed hooks import it from
their own plugin payload. `canonical-skill-resources.mjs` pins its bytes for the
installer and doctor. The test fixture `test/fixtures/litmark/ignition.json` pins
the selected rows independently; historical round6 fixtures no longer define the
current logo. `colorize()` accepts the three marks, native lockups with arbitrary
valid product labels, and their trimmed row copies; unrelated block rows use ivory.
The former `shadow` option is accepted but has no effect on this flat design.


### Design production skills

Leading `frontend-ui-ux` / `$frontend-ui-ux` and the existing interface-intent route
supply action guidance: implement an authorized build, resolve material ambiguity,
then inspect actual renders. The evolving beta2 contract supports execution; it is
not a contract-only stopping point. Review-only and plan-only requests remain read-only.
PostToolUse reminders never widen the requested design scope.

The same route also fires on polish, audit and harden wording (polish, tighten up, 다듬어;
audit, read-only, just check, 점검, 검토만; harden, stress-test, hold up under, 튼튼하게,
견고하게) when the prompt names an interface surface. `lib/interface-mode.mjs` picks the mode
(`build` by default), and the activation context names it together with
`references/craft-floor.md`, `references/slop-register.md` and the
`scripts/interface-probe.mjs` loop. `audit` stays read-only and hands its findings table to
`visual-qa`, which keeps the verdict. Prose, documents, servers and pipelines never match, and
video, 영상, 모션 and 발표 wording never widens the route.

UI work inside the other lit workflows reaches the same skill. A lit-loop, litwork,
litgoal, native-workflow or frontend-ui-ux turn is armed at UserPromptSubmit
(`lib/interface-probe-gate.mjs`); PostToolUse records every edit to a file a browser renders
as the interface (`.html`, `.css` and its preprocessors, `.vue`, `.svelte`, `.astro`, `.tsx`,
`.jsx`) and every `node … interface-probe.mjs` run. The Stop hook then holds the turn until a
clean run follows the last interface edit, and its reason hands the interface part to
`frontend-ui-ux`. A clean run shows `Verdict: Approve (0 HIGH)` and no `BLOCKED:` line, or, when
its output went to a file, leaves an `--out` manifest newer than the edit with exit code 0, all
seven matrix rows and no HIGH finding. Empty output, a BLOCKED run and anything unreadable are
not clean. The gate
blocks at most twice per turn, then warns once and allows; unreadable state allows. Edits to
scripts, servers, command-line tools or docs, and turns outside a lit workflow, are never held.
lit-loop's SURFACE step and lit-plan's Verification rows say the same in prose.

Leading `readme-studio` / `$readme-studio` selects the plugin's README skill and embeds
its body. Incidental, quoted and near-miss tokens do not enroll that route. There is
no dedicated command file, new hook event or bundled image-generation service.
Actual Claude Code capability governs generation; absent tools produce
`IMAGE_GENERATION_UNAVAILABLE`, followed by composition from a supplied inspected
background if available. Integrity checks include its nested templates and helpers.

Leading `lit-diagram-drawer` / `$lit-diagram-drawer` selects the diagram skill. The
hook adds its mode contract and the exact installed `SKILL.md` path, whose directory
anchors the verifier, export, doctor, and importer scripts. `/litclaude:lit-diagram-drawer`
is Claude Code's own skill route and does not pass through the hook. The words
"diagram", "chart", or "visualization" alone activate nothing, so interface requests
keep reaching `frontend-ui-ux` and the exact bare `lit-scientific-visualization` route
is unchanged. Quoted, fenced, mid-sentence, and near-miss tokens stay inert.

Leading `lit-pptx` / `$lit-pptx` and `lit-docx` / `$lit-docx` select the office skills, and
so does a bare `lit` whose prompt both asks to make something (만들, 작성, 써줘, 정리해,
준비, 초안, make, write, draft, prepare, build, …) and names slides (발표자료, 발표, 슬라이드,
덱, PPT, 피피티, slides, deck, presentation, pptx) or a document (보고서, 리포트, 기획서,
제안서, 계획서, 문서, 워드, report, doc, docx, document, proposal, memo). A prompt that names
both activates both skills. This check runs before the research, goal, and plan routes,
because the prompt asks for a file. Code documentation (README, API docs, docstrings,
`.md` files) and tool reports (bug, test, coverage, error) never take this route. The hook
adds each skill's mode contract, the exact installed `SKILL.md` path, and the lit defaults
(AZURE-PRO with Pretendard; `korean-generic` for Korean text, plain styling otherwise; no
style questions). An explicit token keeps the one-question style gate instead.

Leading `lit-typographic-motion` / `$lit-typographic-motion` selects the film-director skill,
and so does a bare `lit` whose prompt asks to make something (the office and interface verbs, plus
제작, 렌더링, render, produce, animate) and names a film: a compound (모션그래픽, 타이포 모션,
키네틱 타이포, 타이포그래피 영상, 가사 영상, 뮤직비디오, 오프닝 타이틀, 타이틀 시퀀스, motion
graphics, kinetic type, typographic motion, lyric video, music video, title sequence, opening
titles) or a bare 영상 / 비디오 / 동영상 / 클립 / video / clip. This check runs before the office
and interface routes, so "발표 영상" and "타이포그래피 영상" reach the film skill while "발표자료" and
"타이포그래피 정리" keep theirs. It does not fire for editing, trimming or captioning existing
footage, a video placed in a page or in slides, a script, thumbnail or summary about a video, UI
motion (hover, motion tokens), video as a software feature (a player, an upload), or a bare 모션 /
motion / 인트로 / intro. There is no token-free motion route, and the token-free interface fallback
no longer claims a video prompt. The hook adds a neutral film context (a film request, the
treatment first, the path rule between the type and stage renderers, never which path applies),
the exact installed `SKILL.md` path and the installed `motion.mjs` named once with its `stage`,
`make`, `sound`, `look` and `gate` subcommands, within 4,096 bytes. A type-led cue (a type
compound, a kinetic-type or lyric request, or a quoted span of two or more words) adds one
`type-led cue found` hint line. PostToolUse records every `motion.mjs` run, and the Stop hook holds
the turn until the film is done: a valid treatment, gate PASS, at least two look rounds (a stills
round with its change, then a round stamped with the final render's stills manifest), and every
frame of that last round opened with Read. A missing or unreadable `treatment.json` or `look.json`
blocks with a named reason. After two reminders the hook tells the model to say in the reply that
the film is not done and why.
