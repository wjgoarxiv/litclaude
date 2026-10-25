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
events: [SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStart, SubagentStop, SessionEnd]
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
- `BLOCKED:` text for a longer natural-language start-work phrasing, unavailable native goal binding, disabled Dynamic workflow, or gated agent-team setup.
- Unavailable native goal binding on lit-loop, litgoal, litwork and workflow routes also includes `READY_TO_PASTE` and one bounded `/goal` command for the user to copy, paste, and send; the hook never enters or submits it. lit-plan carries none.

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
| `SessionStart` | `plugins/litclaude/bin/litclaude-hook.js session-start` | Runs the bounded foreground automatic-update barrier on a fresh session (or starts the detached version-cache refresh when the cache is stale), discovers repo-local rule files, names the newest valid `plans/<slug>.md`, and on `source: compact` spends one of two durable re-injection reservations at reduced caps and, with automatic handoff on, reloads the fresh handoff once. |
| `UserPromptSubmit` | `plugins/litclaude/bin/litclaude-hook.js user-prompt-submit` | Detects prompt routes and injects workflow context; independently delivers static rules not already recorded for this session; answers the exact prompts `lit-handoff auto on <percent>`, `lit-handoff auto off` and `lit-handoff auto status` by changing or reporting the automatic handoff setting. |
| `PreToolUse` | `plugins/litclaude/bin/litclaude-hook.js pre-tool-use` | Enforces semantic action/root grants before Write, Edit, MultiEdit, NotebookEdit, Bash, Agent, and bounded read tools execute; denies supported reader-facing text writes with a humanizer block-tier finding. |
| `PostToolUse` | `plugins/litclaude/bin/litclaude-hook.js post-tool-use` | Moves the LIT card's stage record on from what the tool did (plan saved, task checked, lit-loop step, a reviewer's verdict from an `Agent` result). Names the post-edit checks the edit actually earned, injects any glob-scoped rule matching the edited paths, and checks successfully created DOCX/PPTX/PDF files for humanizer findings, including paths reported by Bash output. |
| `PostToolUseFailure` | `plugins/litclaude/bin/litclaude-hook.js post-tool-use-failure` | For a Bash command that exits non-zero, such as a bare failing `npm test`, moves the LIT card's lit-loop map from what the command wrote and from its failing test run, which never counts as VERIFY. Nothing else runs on a failed tool. |
| `Stop` | `plugins/litclaude/bin/litclaude-hook.js stop` | Holds a lit-plan turn with no persisted plan and a lit workflow turn that edited interface files without a clean interface-probe run (each at most twice per turn), emits bounded start-work continuation on new progress, otherwise applies the opt-in litgoal autoloop gate, and last of all, with automatic handoff on, blocks once per crossing of the chosen percent to have the handoff written. |
| `SubagentStart` | `plugins/litclaude/bin/litclaude-hook.js subagent-start` | Registers child-lane and Claude-owned worktree identity. |
| `SubagentStop` | `plugins/litclaude/bin/litclaude-hook.js subagent-stop` | Finalizes the lane without child continuation, and gives a background review-work reviewer's verdict to the LIT card's stage record. |
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

SessionStart also keeps that cache fresh. When the cache is missing or older than
24 hours, and no attempt was recorded in the last 24 hours, the hook records the
attempt and starts a detached child
(`plugins/litclaude/lib/automatic-update-refresh.mjs`) that makes one GET for the
package's latest version, with a 3-second limit, no redirect and a 64 KiB cap. The
hook does not wait for it. The child writes `latest.json` only if its attempt still
owns the cache, and never installs anything. A cache file that is not LitClaude's own record, such as another package's, is left untouched; the next fresh session applies the
version through the transaction above. The request goes to the registry in
`npm_config_registry` when that is a plain origin, the same registry the install
uses, and to `registry.npmjs.org` otherwise. Every opt-out above stops the request
too. Offline, the attempt fails quietly and the next try waits a day.

Before installing, the hook reads `installed_plugins.json` under the Claude home. If
the registered LitClaude version is already the cached version or newer, it skips the
install. A long-lived Claude Code process keeps running the hook from the version
folder it started with, so without this check every new session in that process
would install the same version again. The hook also skips a version whose latest receipt
under `update-notifier/automatic/` is `rolled-back` or `failed` and less than 24 hours old,
so a version that just failed is retried once a day, not on every session. A newer version
is tried at once.

When the refresh child learns of a version newer than the one the session runs, it also
downloads that version with `npm cache add`, with the same HOME and the same empty npmrc
the install uses, so both read one npm cache. The package is about 18 MB. Over a 500 kB/s
link a cold download alone outlasts the 30-second install limit, and the install then rolls
back and waits a day; with the tarball already cached, the install only unpacks it. The
download has a 10-minute limit, nothing waits for it, and it records `prefetch-finished` in
`journal.jsonl`. If it has not finished, the install downloads the package as before.

An update takes three sessions: one learns of the version, the next installs it, and the
one after that is the first to run it, because Claude Code keeps running the plugin folder a
session started with. The first session that runs the installed version writes
`firstSessionAt` into the receipt.

`litclaude doctor` (and `--dry-run doctor`) reports this as `AUTO_UPDATE:` lines, read from
files only:

| Line | Meaning |
|---|---|
| `AUTO_UPDATE: installed <new>, running <old>: takes effect in the next session` | The receipt names the install and no session has run it yet. |
| `AUTO_UPDATE: running <new> since <time>` | A session has started on the installed version. |
| `AUTO_UPDATE: <version> was not applied (<status> at <time>)` | The last attempt rolled back or failed. |
| `AUTO_UPDATE_CHECK:` | The last registry answer and when the next check may run. |
| `AUTO_UPDATE_REMEDY: <cause>: <remedy>` | One row per cause that applies. |
| `AUTO_UPDATE_LIMIT:` | The doctor cannot see which version an open session has loaded. |

| Cause | When | Remedy |
|---|---|---|
| `next-session` | installed, not yet run | Start a new Claude Code session. |
| `offline` | the last registry check got no answer | Check the network or `npm_config_registry`, or update by hand. |
| `backoff` | the target failed less than 24 hours ago | Wait for the time shown, or update by hand. |
| `install-timeout` | npm did not finish in 30 seconds | Update by hand; it has no time limit. |
| `ownership-conflict` | the install met a file LitClaude did not write | Update by hand to see the path, move the file aside, retry. |
| `install-failed` | npm or the post-install doctor failed | Update by hand to see the error. |
| `rollback-failed` | the old install could not be restored | Update by hand before relying on the install. |
| `opted-out` | one of the opt-out names is set | Unset it, or update by hand after a release. |
| `directory-source` | the marketplace is a local directory | Informational: Claude Code does not update it, so this hook is the only automatic path. |

"Update by hand" is `npx @litfamily/litclaude@latest update`.

## Automatic handoff

Automatic handoff is off until the user turns it on and picks a percent. It has no default
percent. The setting comes from the exact prompts `lit-handoff auto on <percent>`,
`lit-handoff auto off` and `lit-handoff auto status` (the prompt hook answers them with one
line and starts no workflow), or from the environment:

| Variable | Meaning |
| --- | --- |
| `LITCLAUDE_AUTO_HANDOFF` | `1` turns it on, `0` keeps it off whatever was saved. Any other value is treated as off and the doctor says so. |
| `LITCLAUDE_AUTO_HANDOFF_PERCENT` | The percent, a whole number from 1 to 99. It wins over the saved percent. A value outside that range, or an on flag with no percent anywhere, leaves the feature off and adds a doctor warning. |
| `LITCLAUDE_AUTO_HANDOFF_WINDOW` | The model's context window in tokens. Only needed when the LitClaude status line is not installed: the Stop hook then turns the last assistant usage in the transcript into a percent. Without a window and without the status line the percent is unknown and nothing happens. |

`lit-handoff auto on` with no number reuses the last percent the user saved and asks for one
when none exists. `off` keeps the saved percent. A route with an invalid percent changes
nothing and says so.

The pieces, in the order they run:

1. The status line (`plugins/litclaude/bin/litclaude-hud.js`) writes the session's
   `context_window.used_percentage` and window size to
   `.litclaude/auto-handoff/context-<session>.json` after each refresh, only while the feature is on.
   It shows `handoff@<percent>%`, or `handoff ⚠` when the setting was asked for but is invalid.
2. The `Stop` hook runs this check after every other gate allowed the stop, and never when
   `stop_hook_active` is set, so it cannot loop. When the percent is at or above the chosen
   one and this session's crossing is unspent, it records the crossing in
   `.litclaude/auto-handoff/session-<session>.json` first (a folder it cannot write means no
   block) and then returns a block reason. The reason tells the model to read the bundled
   `vendor/handoff/SKILL.md` and follow it (the lit-handoff skill cannot be invoked by a hook,
   because it is marked `disable-model-invocation: true`), to write the line
   `Auto-handoff id: <id>` into the handoff file, and to end with the single line
   `Handoff saved. Run /compact now.` A reading below the chosen percent re-arms the crossing,
   so the next rise past it fires again.
3. Claude Code offers a plugin no way to start compaction. The user runs `/compact`, or
   Claude Code compacts on its own: its `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` variable (1 to 100)
   lowers the percent of the auto-compact window at which it does, and
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (100000 to 1000000) sets that window. The doctor warns when
   the override is at or below the chosen percent, and notes that the status line percent stops
   matching the compaction point once the window variable is set.
4. On `SessionStart` with `source: compact`, the hook reloads the handoff once for the session
   that fired. It looks for `.handoff/HANDOFF.md` and `HANDOFF.md` from the session's
   working directory up to the project state root, and accepts a regular, non-symlink file of at
   most 256 KiB that was modified after the trigger and contains that trigger's id line. The
   context then holds the path and the first 4,000 characters, marked as data. Another
   session, an older file, a file without the id, a trigger more than six hours old, and a
   second compaction all get no digest; when the trigger is pending and no file qualifies, one line says
   that nothing was reloaded. The stored percent is cleared at the same time, so the pre-compaction
   reading cannot keep the crossing spent.

`litclaude doctor` prints `Auto-handoff: off` or `Auto-handoff: on at <percent>%` for the
project it runs in. The model still has to follow the block reason to write the file; the hook
can require nothing more than that.

## The LIT band (Claude Code mod)

From Claude Code 2.1.287 a plugin can ship a mod: a hooks module that draws inside Claude Code
itself. LitClaude's is `plugins/litclaude/hooks/lit-mod.mjs`, named under `modules` in
`hooks/hooks.json` next to the settings hooks above. It installs with the plugin and needs no
setup. The status line stays as it is; the band adds a live layer above the prompt.

From the first prompt to the end of the session a LIT card sits above the prompt. It keeps the
same five rows whether LitClaude is working or idle (thread rows, below, are the one addition),
and takes the status line's accent
(`LITCLAUDE_HUD_ACCENT`, read from the installed status line command), so the card and the
status line read as one family:

```
╭─ [🔥 LIT] · start-work ───────────────────────────────── WORK ● ─╮
│ interview ✓ ━━ plan ✓ ━━ [work 3/7] ━━ review · ── done ·  1 lane │
│ └ task 3/7 ███░░░░░ · next ▸ 4. README demo        - Bash · 0:12 │
│ skills [⚡ start-work] [↯ lit-plan]                               │
╰─ ctx 42% ▰▰▱▱▱ · 5h 31% · 1w 12% · git main ─────────────────────╯
```

The brackets stand for the ends of filled pills: rounded caps from the icon font with `nerd`
glyphs, one cell of the pill's colour with `basic`. The brand is a pink pill, the current stage
and the skills of this request are pills on the accent with dark text, and skills from earlier
requests are muted grey pills.

- The top edge names the discipline the prompt hook ignited (the last one, dimmed, while the
  session is idle; `ready` before any) and, on the right, the current stage: `WORK ●`, `RED ●`,
  `idle`, or `DONE ✓` during the finish. While a subagent is still running the card stays at
  work (`LIVE ●` when no stage is current) and never reads `DONE`, even after the main turn ended.
- The second row is the workflow map: where the session stands in its LIT family
  (`lib/mod/workflow.mjs`). The main chain is `interview › plan › work n/m › review › done`
  (litgoal criteria and autoresearch iterations ride the work stage); litresearch is
  `decompose › wave n › expand › verify › synthesis`; a lit-loop criterion cycles
  `PIN › RED › GREEN › VERIFY › REVIEW › RECORD` (SURFACE shows on VERIFY, CLEAN on RECORD).
  Done stages carry `✓` in a colour graded along the rail from flame orange through pink to the
  accent, the current stage is a pill, the stages ahead are dim `name ·`. The rail into the
  current stage is solid `━`; the rail leaving it fills with the stage's count and, while
  LitClaude works, carries a bright head; the rails ahead are dim `─`. On its right the row keeps
  the live subagents (`● 2 lanes`), the autoloop count and its time left, and `ctx 76% → 80%` when
  the context nears the auto-handoff percent. A session no family places (a lit-docx request, a
  fresh session) keeps the old `PLAN ━━ WORK ━━ REVIEW` track there.
- When more than one thread is live (the session's stack frames, its running subagents, its
  background shells and monitors, and another session of this project whose stack moved in the
  last 15 minutes), rows under the detail row list them, one each: name, stage, a `[▉▉░░] k/n`
  gauge and `running`, `paused`, `blocked`, `idle` (a teammate waiting for a message) or
  `done`. A child hangs under its paused parent with `└─`, parallel lanes and tasks sit under a fork line (`┬ 3 lanes in parallel`,
  `┬ 2 lanes · 1 task in parallel`) with `├─`/`└─`, a background task is marked `$` (shell) or
  `~` (monitor) with its kind as its stage, and another session is marked
  `· other session <id>`. At most four rows show, with `+N more` on the last; the active frame
  and its parents are never cut, and under a deeper chain three rows are still kept for lanes
  and tasks (lanes first). The rows stay reserved while more than one thread is live, so
  the card does not change height as lanes come and go. The desktop SVG card draws the same
  rows and grows by them.
- Each row's `k/n` comes from the first source that knows it. A frame: the count it recorded
  (`litclaude-ai workflow-stage --n --total`), the start-work run it drives, the checkboxes of
  the plan it works from (a saved lit-plan hands its plan to the lit-loop or start-work that
  follows), the open litgoal criteria for a loop, and for the frame on top the main loop's own
  TodoWrite or task list. A subagent: its own TodoWrite or task list, else the tool calls it has
  finished over an unknown total (`[???] 7/?`; the desktop card counts those by tens past ten so
  its drawing does not reload on every call). Only statuses are kept, never a todo's or a task's
  text. A background task has no count (`[???] ?/?`). It ends with its task notification (read
  for the task's id and status only), a TaskStop, a monitor's own deadline, or after 12 hours
  with no ending seen. Its command is never shown.
- The stage comes from the session's workflow stack when it has a fresh frame, and otherwise
  from the newest of the ignited discipline and a LitClaude skill this request fired; with none
  of those, from the state that says work is under way.
  The detail comes from files LitClaude already writes: the deep-interview state
  (`round 3/12 · ambiguity 42% → 20%`), the lit-plan draft's approval gate (`drafting`,
  `awaiting approval`), the start-work plan's tasks and next task, the litgoal criteria and the
  litresearch session folder (`wave-*.md`, `verify-*.md`, `SYNTHESIS.md`). What no file
  records goes into the session's workflow stack, `.litclaude/workflow-stack/<session>.json`,
  which LitClaude's hooks keep moving without the model's help. The prompt and PreToolUse hooks
  push a frame when a discipline starts. A discipline asked for in the middle of another pauses
  it as a side frame, keeping its stage and count; a successor in the main chain (plan after
  interview, work after plan, review after work) or anything after a finished frame replaces it;
  asking for a skill already on the stack resumes its frame; `lit new` starts over; read-only
  disciplines (lit-recap, lit-comprehend, lit-handoff, lit-adhd) change nothing. Each session has its own
  file, at most three frames deep. A record from before the stack is read only while the
  session has no stack file. PostToolUse checks the plan stage when lit-plan saves
  `plans/<slug>.md` (`plan ✓`, detail `plan saved`), counts the tasks each time the active
  start-work plan is edited (`work 1/2`), and steps a lit-loop criterion to RED when a test
  file is written, GREEN when the code changes after it, VERIFY when the tests run and RECORD
  when `litgoal record-evidence` runs. For review-work, PreToolUse marks a lane running when a
  prompt titled `Review lane: <lane>.` is spawned, and the lane's `verdict:` line, read by
  PostToolUse for a foreground reviewer and by SubagentStop for a background one, marks it
  passed or failed. The card names the lanes `goal`, `quality`, `security`, `qa` and `context`
  (review-work's scope/diff, package/payload, security/provenance, tests/evidence and
  real-surface/docs lanes); five passes finish the review. The hooks keep only the stage, the
  lane, the counts and a project-relative plan name, never another path, a command or a prompt. The model can still refine the top frame
  with `litclaude-ai workflow-stage <family> <stage> [--n --total --unit --verdict
  name=pass|fail|pending|running]` for what the hooks cannot see: a lane run without a child
  agent, a loop step such as SURFACE, an autoresearch iteration, the crucible verdict. Another
  session's record is ignored and a source older than six hours no longer counts.
- The third row is the detail line: `└` and the current stage's detail (a pink-to-cyan bar for a
  count, the lane verdicts as `✓`, `✗`, `●` while a reviewer runs, or `·`, the next task), and on the right the live step,
  the tool the main loop is running and for how long (`- Bash · 0:12`, `thinking` between tool
  calls). The step shows the tool's name and its clock only, never its arguments, command,
  prompt or paths.
- The fourth row shows each LitFamily skill that fired as a pill: a Skill tool call naming a LitClaude
  skill, a typed `/litclaude:<name>`, or bare `lit` routing seen through the ignition record.
  A skill fired in the current request is bright, with a short light passing over its name as
  it arrives; when the turn completes it dims into the `recent` list, and a new firing brightens
  it again. Chips follow a dim `skills` label; those that do not fit collapse into a muted `+N`. Skills of other plugins never get a chip.
  With no chip yet, the row shows the next task while work runs (when the detail line does not),
  or how to start (`lit <task>`) while idle.
- The bottom edge carries the live figures from the status line: context fill, the five-hour
  and weekly rate windows and the Git branch (read from `HEAD`, across a linked worktree).
- A notice takes the chips row for a few seconds, with a toast, when a gate fires: lit-plan not
  saved, interface probe pending or failed, motion gate, context near the auto-handoff percent,
  auto-handoff fired. The completion moment takes it when the last task is checked, the work
  completes or the goal is met: a light passes over the brand, embers scatter, and `COMPLETE`
  shows for about a second.
- Amber or red when something needs attention: a lane quiet for more than 10 minutes turns the
  border amber and puts `⚠ <lane> quiet for 12m` on the bottom edge; a failed interface probe
  turns it red. Otherwise the border is a calm, dim accent while idle and the full accent while
  LIT is active, a step above the accent and breathing brighter toward white every 2.4 s.
- Running lanes show on the map row's right as a dot each, the count and the longest lane's clock
  (`●● 2 lanes 1:07`). While they run a light walks across the dots (they breathe under
  `subtle`), so the card moves while the main turn waits for them.

A toast in the top-right corner says when the LIT status really changes: a discipline starts or
switches (`lit-plan started`, `lit-plan → start-work`), the workflow stage moves (`stage ·
GREEN`), a goal is set or met, a lane starts or finishes (`lane started · review`, `2 lanes
finished`). The gate notices above use the same toasts. The mod compares each refresh with the
last status it saw, so a refresh that changes nothing raises nothing, and what was already there
when the session opened is not announced. At most one toast shows every three seconds; changes in
between wait and arrive together as one line, and a chain of switches shows only its two ends.

Subagents and teammates come from Claude Code's agent list. A workflow script's agents never
appear there, so the mod also records every agent at `agent.spawn` and counts it until that
agent's own `turn.complete` arrives. A subagent's turn ending does not end the main turn: the
chips of the current request stay bright until the main turn completes. An agent the list shows
as ended stops counting at once. One the list shows as running stays on the card however quiet it
is (it turns amber as above). A workflow agent the list never shows stops counting once it has
been quiet for 30 minutes with no tool call in flight, so a crashed or lost agent cannot hold the
card at work while one inside a long build still counts.

The card is the terminal's width up to 120 columns and every row is fitted to it, with Hangul and
emoji counted as two cells. Nothing wraps: on a narrow terminal the Git branch goes first, then
the weekly and five-hour windows, the lanes and the autoloop count. The map drops its rails, then
shortens the names (`int ✓ pla ✓ [wor 3/7] rev ·`), then shows only the current stage and its
neighbours; the review verdicts shorten to three letters and then to their marks.

The spinner gains ` · <discipline> · n/m` after its ellipsis. `/lit-evidence` opens a pane with
three tabs (keys `1`, `2`, `3`): the goal's criteria with their last evidence, blockers and the
newest litgoal ledger entries; the lanes; and the gates.

Motion: entrances pop in 60 ms apart with a slight overshoot (160 ms each), fills and colour
changes ease in and out (300 ms and 140 ms), notices slide in over 220 ms and leave over 150 ms,
a chip's arrival light runs 400 ms (a plain fade under `subtle`, nothing under `off`), and the
finish lasts at most 1.2 s. While LitClaude is at work the card keeps moving so you can tell it
is active at a glance: the LIT pill breathes from pink to flame orange every 2.4 s, a light sweeps
across the current stage and this request's skill chips every 1.8 s, a bright head runs the rail
leaving the current stage every 1.4 s, the count bar's head shimmers, and a comet runs along the
top rule and back along the bottom one every 2.6 s. Under `subtle` only the breathing stays; under `off` nothing moves. An
idle card holds still. The band's `Client` element animates on Claude Code's frame clock, every
33 ms while a transition plays and every 66 ms during work, once a second while only a clock (the
step's or the lanes') moves, including under `off`, and stops its timer once the card is idle and
settled. In Claude
Code 2.1.292 a terminal row whose only change is a non-ASCII glyph is not repainted, so every
moving part changes ASCII text or colour: bar cells are coloured spaces, embers are ASCII sparks,
a chip's light moves over its ASCII name, the map's `━` and `─` cells move by colour alone, the
step's spinner (`- \ | /`) and clock are ASCII, and a glyph swaps only together with its words.

The desktop app's Code tab, and the other surfaces that are not a terminal, draw a mod's `Text` in
a proportional font and cut each span to the cells it was laid out for, so the card above comes
apart there. On those surfaces the mod draws the same five rows as one `Svg` element instead
(`lib/mod/svg-card.mjs`): monospace text placed by counted cells, real pills and a rounded border.
It shows the settled state, with no entrances or crossfades. While LitClaude works it moves with
SMIL animation inside the drawing, which the surface runs in a script-less sandboxed frame: the
pill and the border breathe and the step's spinner turns, and on `full` a light crosses the
current stage and the current chips, a head runs the rail leaving it, the count bar's head
shimmers and a comet runs around the border. An idle card is a still image. The app loads each new
drawing from scratch and restarts its animation, so this card names the running tool without its
clock and shows the loop round without its countdown. Each animation starts part way through its
cycle, so a freshly loaded card already looks like the running one: the border and the pill are
lit, the light sits on its pill and the comet is part way round, not parked at the top-left
corner. The app still blanks the card for a moment while it loads a new drawing; the mod cannot
prevent that. It is redrawn only when something you would
notice changes, such as the stage, the tool, a skill, a usage figure or the goal. While the card
shows in a terminal and the app at once, the terminal's loop countdown waits for such
a change too; its step and lane clocks keep counting on their own.

Options, in `/config` under LitClaude (stored in `pluginConfigs` in `~/.claude/settings.json`,
which the terminal and the desktop app's Code tab both read). The installer writes each default
you have not set, so the desktop app, which has no editor for them, starts with all four;
`litclaude-ai config` prints them and `litclaude-ai config <option> <value>` changes one.
Uninstall removes only the defaults it wrote that are still unchanged.

| Option | Values | Default |
| --- | --- | --- |
| `motion` | `full`, `subtle` (no overshoot, shimmer, embers, sweep or comet, shorter; the LIT pill still breathes during work), `off` (final frames only) | `full` |
| `glyphs` | `auto` (Nerd glyphs when the icon font is installed), `nerd`, or `basic` | `auto` |
| `band` | `always` (the whole session, idle included), `auto` (only while work is active or a skill of this request is lit), `off` | `always` |
| `notify` | `off`, `finish` (a notification through your own notification channel, `$.ui.notify`, when LIT work completes or a LIT turn longer than three minutes ends), `finish+sound` (the same; a sound is added once LitClaude ships one, and none ships yet) | `off` |

Unknown values fall back to the default. The fields are plain strings with no `options` list on
purpose: Claude Code 2.1.270 and older refuse to load a plugin whose `userConfig` has one, and
that would take every LitClaude hook down with it. Nerd glyphs reach only the terminal; the
desktop app and the other surfaces always get the basic set.

The icons on `nerd` (the rounded pill caps U+E0B6 and U+E0B4, the chip bolt and the branch mark)
come from a Nerd Font. `litclaude-ai install
--icon-font`, or a Yes to the install question (default No), adds the symbols-only Nerd Font,
Symbols Nerd Font Mono (MIT), to the per-user font folder (`~/Library/Fonts` on macOS,
`~/.local/share/fonts` on Linux, then `fc-cache -f` if present; on Windows it prints how to
install it by hand). Your terminal font stays as it is: most macOS terminals take the missing
icons from the installed font through system font fallback, and the installer prints one line for
your terminal (from `TERM_PROGRAM`) in case it does not. The archive is the pinned Nerd Fonts
release asset, refused unless its SHA-256 matches; `LITCLAUDE_ICON_FONT_SOURCE` names an offline
copy of the same archive. The licence goes next to the font, a manifest under `~/.litclaude`
records the two files, `uninstall` removes only those (and only while unchanged), and `doctor`
prints `ICON_FONT:`. With `glyphs` on `auto`, the band checks those font folders by stat at session
start and says what it decided on the `/lit-evidence` gates tab.

The mod is read-only. It reads LitClaude's own state, the Git `HEAD` of the working directory and
the merged settings (for the status line's accent) and nothing else: the ignition record in the
per-user temp folder, `.litclaude/boulder.json` (found the way the hooks find it, across a
linked worktree), and under the outermost Git root's `.litclaude/` the litgoal goal, autoloop
counter and ledger, the lit-plan, interface-probe and motion turn records, and the auto-handoff
settings and session record. Each file must be a regular file under its size cap that resolves
exactly where its path says, so a symlinked file or state folder is skipped. It writes nothing,
starts no process, uses no network and calls no model. Its pure parts live in
`plugins/litclaude/lib/mod/` and are tested under Node.

On Claude Code releases before 2.1.287 the `modules` key is ignored and every settings hook runs
as before; there is no band.

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

A typed start-work and its boundary answers are the only mutating
`UserPromptSubmit` exceptions, and each must be the whole prompt. The prompt
`/litclaude:start-work <plan>` (or `/start-work <plan>`, natural `lit start work`, or no
plan with exactly one open plan) initializes the work with code-derived grants. `lit approve` / `lit 승인`
grants the one pending boundary of the session's own work, and `lit deny` / `lit 거절`
clears it and keeps that path refused. The exact route below is still accepted,
with no surrounding explanation or extra arguments:

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

## Repeating `lit` in one session

The first `lit` of a discipline in a session sends its full activation. After that the
hook keeps a small per-session record (beside the HUD record in the temp directory, never
in the repository) and answers a repeat as follows:

| Prompt | What the hook sends |
| --- | --- |
| `lit ...` for the discipline already active | A note of about 400 bytes: already active, continue under the earlier contract. No skill re-read line, no `/goal` line, no new run or plan, and the LIT card keeps its stage. |
| `lit plan ...` or another discipline | The full activation for that discipline, once. |
| Bare `lit` or `lit continue` with a start-work run for this session | One resume line naming the work. No new plan. |
| Bare `lit` or `lit continue` while a discipline is active in this session | The continue note for that discipline (for `lit-plan`, plus its planning-only line and the plan path; the plan gate stays armed). |
| Bare `lit` or `lit continue` with an open plan and nothing active | One resume line naming the plan. No new plan. |
| `lit new ...` or `lit restart ...` | The full activation again. |
| Bare `lit` with no task, nothing active and nothing to resume | The full activation with a confirmation question. |

A different session id starts fresh. A compaction or clear removes the record, and a
missing or unreadable record falls back to the full activation, so a lost record costs
bytes and never a safety line. Static rules are claimed once per session also in a
directory with no project marker.

## Workflow Trigger Phrases

The `UserPromptSubmit` hook activates on these natural-language phrases and
legacy dollar shorthands:

```text
lit
litwork
lit plan
lit review
lit review plan
lit review work
lit research
lit search
lit query
lit goal
lit brainstorm <topic>
lit ideation <topic>
lit idea <topic>
lit hijack <sources> into <target>
lit 하이재킹 <sources>
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
lit adhd
lit rewind
lit-adhd
lit-rewind
$lit-adhd
$lit-rewind
$lit-plan
$lit-recap
$lit-loop
$deep-interview
$lit-brainstorm
$lit-hijack
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
Natural `lit start work` as the whole prompt starts the one open plan the way
`/litclaude:start-work` does; with several open plans it lists them, and longer
phrasings keep the `BLOCKED:` handoff to `/litclaude:start-work`, because a prompt
hook cannot switch Claude Code agents. The `$start-work` shorthand and natural start-work
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
text, compound prompts and secret-bearing multiline content do not activate the hook.
A prompt that starts with the typed `/litclaude:lit-handoff` command gets the adapter
and the same canonical source: the adapter is `disable-model-invocation`, so the
command's `Skill(lit-handoff)` step would only reopen the command. The arguments stay
with the command and are never echoed.

Scientific visualization has one exact-bare UserPromptSubmit route: only the
complete prompt `lit-scientific-visualization` after outer whitespace activates
`Skill(lit-scientific-visualization)`, injects the full adapter and canonical
source, and shows `🔥 LIT IGNITED · lit-scientific-visualization 🔥` in its system
message. The model begins with exactly one `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥` probe line.
Generic visualization, plot, chart, figure, and scientific visualization prose,
mentions, quoted or fenced text, mixed prompts and near misses do not activate the
prompt hook. A prompt that starts with the typed `/litclaude:lit-scientific-visualization`
command gets the same adapter and canonical source: the adapter is
`disable-model-invocation`, so the command's `Skill(lit-scientific-visualization)` step
would only reopen the command. The arguments stay with the command and are never echoed.

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

`lit brainstorm <topic>`, `lit brainstorming`, `lit ideation`, `lit ideate`, `lit idea` and
`lit ideas`, `$lit-brainstorm` and `/litclaude:lit-brainstorm` load
`Skill(lit-brainstorm)`: open-ended ideation that diverges into many options, scores them
against stated criteria, converges on a short list, and hands the pick to
`deep-interview` (still vague) or `lit-plan` (concrete). It never implements. The route word
must sit directly after `lit`; `brainstorm`, `brainstorming`, `ideation` and `ideate` may also
lead a prompt that carries `lit`. `lit review the brainstorm notes` and `lit fix the idea
generator` keep their own routes, and the prompt hook adds no `/goal` line for an ideation turn.

`lit hijack <sources> into <target>`, `lit hijacking`, `lit 하이재킹`, `lit 하이잭`, the leading
skill name `lit-hijack`, `$lit-hijack` and `/litclaude:lit-hijack` load `Skill(lit-hijack)`: a
port of someone else's published technique (posts, articles, repos, PDFs, transcripts) into the
user's own skill or system. It captures sources with provenance, gates the licence, writes a
source-free spec, hands it to `lit-plan` and `start-work`, proves the change against an isolated
baseline, and checks every phase with its bundled `hijack.mjs`. The route word must sit directly
after `lit`, so `lit debug the session hijack` and `lit review the hijack ledger` keep their own
routes. Because a port is a long run, the prompt hook adds a ready-to-paste `/goal` line.

`/review-work` and `$review-work` load `/litclaude:review-work` /
`Skill(review-work)` and have two named modes, announced on the first line of the report.
Plan review (after `lit-plan`, before `start-work`) is a read-only audit of whether the plan
is complete, ordered and verifiable; it returns `PASS`, `ITERATE`, or `NEEDS-CONTEXT`
without implementing. Work review (after `lit-loop` or `start-work`) runs the 5-lane review of
the diff, tests and evidence: scope/diff verification, tests/evidence execution,
package/payload and code quality, security/provenance, and real-surface/docs readiness. The
mode is auto-picked from what exists (a named PR or diff, ticked plan rows or a start-work
run mean work review; a plan with no ticked rows and no diff means plan review; neither means
the skill asks). `lit review plan` or `lit review work` forces the mode, and the hook then
adds `Review mode forced by the user: plan review.` (or `work review.`). Without a forced
mode and with a plan on disk, it adds `Review-mode signals:` with that plan's ticked and open
row counts.

litgoal sets and keeps the finish line; lit-loop and start-work run toward it. `/litgoal` and `$litgoal` load
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

`lit adhd`, `lit rewind`, `lit-adhd`, `lit-rewind`, `$lit-adhd` and `$lit-rewind` load
`/litclaude:lit-adhd` / `Skill(lit-adhd)` for a read-only brief across every recent session of
the repository's worktrees. `lit-rewind` is a permanent alias with the same skill and discipline.
The context tells the model to run `litclaude-ai rewind --json` once and compose only from it:
the collector reads transcripts, plans, litgoal, handoff headings, git log, workflow stacks,
start-work state and herdr (with `HERDR_ENV=1`) under one byte budget, redacts secrets, and
draws every progress gauge itself (`[▉▉▉░░] 3/5`, or `[???] k/?` for an unknown total) so the
model copies them. A brief is read-only on the workflow stack. Near-miss words (`lit adhder`,
`lit rewinding`, bare `adhd`) and the slash forms do not activate the hook; `recap` stays with
lit-recap.

The collector also records this session's one next step under `.litclaude/adhd/`. When the whole
next prompt is `go`, `lit go`, `ㄱㄱ`, `고` or `진행` and that record is at most 30 minutes old, the
hook deletes it and acts on that step alone: a single open plan starts through the same typed-start
path as `/litclaude:start-work plans/<plan>.md` (the path is re-checked against `plans/*.md` with an
open task), a paused frame or this session's start-work resumes, and a boundary still answers only to
`lit approve` or `lit deny`. Without a fresh record of this session, `go` is ordinary text.

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
prompt text is not executed or echoed. The litwork detector returns constant
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

Claude Code shows a hook's `additionalContext` inline only while it stays under 10,000
characters; a longer block reaches the model as a saved-file stub with a preview of about
2 KB. Each activated route therefore keeps its whole context under that limit and puts the
probe line, the activation-word note, the reply language, the `Skill(<route>)` request and
the mode contract first. The route's SKILL.md is named by its installed path inside
`<litclaude-skill-body>`, and the model loads it from there. `lit-recap` keeps its skill
body inline because it fits; the exact bare `handoff` and `lit-scientific-visualization`
prompts still carry their canonical sources inline. The per-route byte budgets live in
`test/prompt-context-budget.test.mjs`.

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

Leading `lit-schematic` / `$lit-schematic` selects the schematic skill, and a `lit` prompt
with schematic wording selects it too: a strong noun (P&ID, PFD, BFD, plot plan, cutaway,
experimental setup, 계장도, 공정도, 모식도, 장치도, 실험 장치) is enough, while a weak noun
(schematic, isometric, apparatus, 사시도, 단면도) also needs a drawing or making verb and no
web-interface noun, so an isometric hero image for a landing page stays with `frontend-ui-ux`.
Ahead of the office route, a schematic request wins when it carries a drawing verb (그려, draw,
sketch); "lit P&ID 설명 보고서 작성해줘" asks for a document and still reaches `lit-docx`. The
hook adds the mode contract and the exact installed `SKILL.md` path on every such prompt.

Leading `lit-pptx` / `$lit-pptx` and `lit-docx` / `$lit-docx` select the office skills, and
so does a bare `lit` whose prompt both asks to make something (만들, 작성, 써줘, 정리해,
준비, 초안, make, write, draft, prepare, build, …) and names slides (발표자료, 발표, 슬라이드,
덱, PPT, 피피티, slides, deck, presentation, pptx) or a document (보고서, 리포트, 기획서,
제안서, 계획서, 문서, 워드, report, doc, docx, document, proposal, memo). A prompt that names
both activates both skills. This check runs before the research, goal, and plan routes,
because the prompt asks for a file. Code documentation (README, API docs, docstrings,
`.md` files) and tool reports (bug, test, coverage, error) never take this route. The hook
adds each skill's mode contract, the exact installed `SKILL.md` path, and the lit defaults
(a deck or a document takes the tonality its direction step picks, and the reply names it with
two alternatives; no style questions). An explicit token keeps the one-question style gate
instead, whose first option is the direction step's choice.

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
treatment first, the path rule between the type and stage renderers, never which path applies, the
house style, format and length fixed by the treatment's rules, the scaffold, and the board round),
the exact installed `SKILL.md` path and the installed `motion.mjs` named once with its `scaffold`,
`stage`, `cover`, `make`, `sound`, `look` and `gate` subcommands, within 4,096 bytes, plus one line that
sends a README, hero, banner or cover loop to cover mode. A type-led cue (a type
compound, a kinetic-type or lyric request, or a quoted span of two or more words) adds one
`type-led cue found` hint line. PostToolUse records every `motion.mjs` run, and the Stop hook holds
the turn until the film is done: a valid treatment, gate PASS, at least two look rounds (the board
round with its change, then a round stamped with the final render's stills manifest), and every
frame of that last round, the storyboard included, opened with Read. A treatment with `preview: true`
is done at a passed, viewed board. A cover (treatment `mode: cover`) is done when the
decoded cover reached every TARGET gate and the last of at least two look rounds viewed the contact
sheet, the poster and the seam pair. A missing or unreadable `treatment.json` or `look.json`
blocks with a named reason. After two reminders the hook tells the model to say in the reply that
the film is not done and why.
