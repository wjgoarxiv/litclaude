# LitClaude Migration

LitClaude maps workflow disciplines into Claude Code-native surfaces. The goal
is behavior parity where Claude Code exposes the same kind of surface, and a
conservative local fallback where it does not.

> **Older local install?** See [Local State Refresh](#local-state-refresh) at
> the bottom. This public tree intentionally avoids tracking retired brand,
> path, and vocabulary tokens.

| Reference surface | Claude Code surface | LitClaude implementation |
| --- | --- | --- |
| CLI prompt engineering | Claude Code skills | `plugins/litclaude/skills/*/SKILL.md` |
| Auxiliary skill packs | Claude Code skill auxiliary files | `lit-code/references`, `lit-code/scripts`, and `debugging/references` are included where portable |
| Litwork plan mode | Claude Code skill plus planner agent | `lit-plan` and `lit-planner` |
| Clarification interview | Claude Code skill plus command | `deep-interview` asks one Socratic question per round, persists exactly four per-project artifacts under `.litclaude/deep-interview/`, and hands a spec to planning or execution |
| Execution loop | Claude Code skill plus executor agent | `lit-loop`, `start-work`, and `lit-executor` |
| 5-lane review | Claude Code command, skill, and agents | `review-work` runs scope/diff verification, tests/evidence execution, package/payload and code quality, security/provenance, and real-surface/docs readiness |
| Durable goal runtime | Package CLI plus local state | `litgoal` writes criteria, evidence, checkpoints, steering, and blockers under `.litclaude/litgoal/` |
| Goal-tool guidance | Claude Code native goal surface | `/goal` when user-selected, or model-facing `get_goal`, `create_goal`, and verified-final `update_goal` guidance when exposed |
| Parallel orchestration | Claude Code Dynamic workflow and Dynamic worktree surfaces | Call `Workflow` for broad independent work when exposed; use `EnterWorktree` or the CLI worktree path for risky or parallel edits |
| Dynamic workflow readiness | Claude Code command plus package diagnostic | `/litclaude:lit-loop` and `workflow-check --json` verify goal, Dynamic workflow, and subagent delegation surfaces |
| Hooks | Claude Code hooks | `plugins/litclaude/hooks/hooks.json` |
| MCP helpers | Claude Code plugin MCP config | `plugins/litclaude/.mcp.json` |
| LSP integration | Claude Code plugin LSP config | `plugins/litclaude/.lsp.json` |
| Package alias | npm package bin alias | `litclaude-ai` |
| Review/research agents | Claude Code agents | `quality-reviewer`, `lit-verifier`, `librarian-researcher` |

## Local Plugin Flow

Use the local plugin path while developing from this checkout:

```bash
claude --plugin-dir ./plugins/litclaude
```

After the scoped candidate is publicly released, the quiet npm distribution path is:

```bash
npm exec --yes --package @litfamily/litclaude -- litclaude install
npm exec --yes --package @litfamily/litclaude -- litclaude doctor
```

Launch Claude Code normally after install:

```bash
claude
```

The installer writes the user plugin cache, `plugins/installed_plugins.json`,
the `settings.json` `enabledPlugins` entry for `litclaude@litclaude-ai`, and
a LitClaude-managed local marketplace entry in `known_marketplaces.json`.
This keeps installation convenient without requiring public repo promotion,
manual `--plugin-dir` launch commands, or a remote Claude marketplace entry.

## Goal And Dynamic Workflow Parity

Reference goal integration is an honest native-binding attempt around goal
tools; it does not type a `/goal` slash command for the user. LitClaude mirrors
that contract: lit hook context and lit skills mention Claude Code's native goal
surface, ask Claude to inspect `get_goal`, create a goal with `create_goal` only
when no matching active goal exists, refuse to clobber a different active goal
without explicit replacement, and defer `update_goal` until the evidence gate
has passed or a real blocker is recorded.

Current Claude Code sessions may not expose model-facing goal tools to the
model. The observed hook output schema can add context or block; it cannot run
another slash command. When goal tools are unavailable or not exposed, LitClaude
returns explicit `BLOCKED:` / degraded-mode guidance, should not pretend the
native goal was bound, keeps the local evidence ledger authoritative, and may
suggest `/goal <completion condition>` or `claude -p "/goal <completion
condition>"` before long-running lit execution without repeatedly printing
fallback chatter.

When the user explicitly chooses Claude Code `/goal`, that native session goal
remains user-visible and user-controlled. LitClaude does not auto-type
`/goal`. For multi-lane work, LitClaude follows the same model-facing tool
principle where Claude Code exposes it: call the `Workflow` tool before serial
execution, bind each lane to criteria and evidence, and use `EnterWorktree` for
isolated model-facing worktree lanes. When only the CLI surface is available,
the concrete isolated-lane launch form is `claude --worktree <short-name> --tmux`.

`/litclaude:lit-loop`, `$lit-loop`, `lit workflow`, `lit dynamic
workflow`, and `lit ultracode` consolidate that
behavior into one route. The route keeps `/goal` user-controlled, calls
model-facing goal tools only when exposed, reports `CLAUDE_CODE_DISABLE_WORKFLOWS=1`
as a setup gate, and maps subagent delegation to `lit-planner`, `lit-executor`,
`lit-verifier`, `qa-runner`, `quality-reviewer`, and `librarian-researcher`.
Child assignments use `TASK:`, `DELIVERABLE`, `SCOPE`, and `VERIFY`;
`workflow-check --json` now verifies both subagent reliability and command/hook
agreement. Operators can verify availability with:

```bash
litclaude-ai workflow-check --json
```

Long `$start-work` runs can also use `litclaude-ai start-work-next --session-id <claude-session> --json` to
recover the active plan, ledger path, and first unchecked top-level task from
local `.litclaude` state after a compacted or interrupted session.

Native agent teams remain experimental and disabled unless
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is present. The natural routes `lit
team`, `lit team mode`, and `lit teammates` steer Claude to request approved
teammates with roles, boundaries, acceptance criteria, wait, and synthesis; when
the env gate is absent, LitClaude falls back to subagents or Dynamic workflow.
Optional display setup is `claude --teammate-mode auto` or `"teammateMode":
"auto"`.

## Review And Litgoal Parity

The workflow parity surface is local-first and evidence-bound. It does not imply
that an npm publish or remote marketplace publication has happened.
`/review-work`, `$review-work`, and `/litclaude:review-work` first classify the
input. A draft plan receives a read-only objective-achievability audit with
`PASS`, `ITERATE`, or `NEEDS-CONTEXT`; the route must not implement it. Completed
work receives the 5-lane contract: scope/diff verification, tests/evidence
execution, package/payload and code quality, security/provenance, and
real-surface/docs readiness. Applicable Manual-QA channels must
produce artifacts, and all spawned sessions, servers, ports, browser tabs, and
temp directories need a cleanup receipt before completion.

`/litgoal`, `$litgoal`, and `/litclaude:litgoal` bind long work to the
litgoal runtime in `plugins/litclaude/lib/litgoal/`. The local state lives
under `.litclaude/litgoal/`, and current docs/test reads are the authority if
stale state contradicts the checkout.

Use these CLI commands for durable state:

```bash
litclaude litgoal create-goals --brief "<brief>" --json
litclaude litgoal record-evidence --criterion <id> --status pass --json '{"artifact":"...","cleanup":"..."}'
litclaude litgoal checkpoint --status active --note "<progress>" --json
litclaude litgoal steer --kind scope --note "<what changed and why>" --json
```

Malformed evidence JSON, unknown criteria, corrupt state, or invalid steering
kinds must fail with a controlled error.

If OMC/omc is already installed in Claude Code, keep it disabled or start a
separate Claude Code session without OMC while testing LitClaude. The root marketplace now exposes only the native LitClaude plugin; direct
`--plugin-dir` loading remains available for checkout development. If a user-level OMC plugin still runs, it may
create `.omc/` local state in the checkout; LitClaude treats that as quarantined
external state and keeps it ignored and outside packaged artifacts.

Reload plugin metadata after changing skills, agents, hooks, MCP, or LSP:

```text
/reload-plugins
```

## Publication Boundary

LitClaude may be prepared as a quiet public npm package for personal install
convenience, but any `npm publish`, marketplace registration, or remote
distribution step requires explicit user approval. Until that approval exists,
uninstalling is either `litclaude uninstall` for npm-installed copies or
removing the local `--plugin-dir` usage and reloading Claude Code.

## Local State Refresh

LitClaude's tracked docs and package payload use only the current LitClaude and
lit-family surfaces. If you are carrying private pre-LitClaude local state,
perform that migration from your private notes outside this repository; this
public tree intentionally does not track retired identifiers.

Current install and state surfaces are:

| Surface | Current LitClaude value |
| --- | --- |
| npm package | `@litfamily/litclaude` (unpublished candidate) |
| bins | `litclaude` / `litclaude-ai` |
| installer state dir | `~/.litclaude` (`LITCLAUDE_HOME`) |
| per-project runtime state | `.litclaude/` |
| slash commands | `/litclaude:<cmd>` |
| plugin key | `litclaude@litclaude-ai` |

The host config dir `~/.claude` and `CLAUDE_*` host variables are unchanged —
those are owned by Claude Code, not by this plugin.

The current workflow vocabulary is the lit family: `lit`, `litwork`, `lit-loop`,
`lit-plan`, and `litgoal`. The `lit` keyword fires `lit-loop` via the hook.
Typing `litwork` also fires it. The bare `lit` trigger includes a soft-confirm
step so a stray English "lit" is recoverable.

## One-release rename aliases

| Previous typed name | Current id |
| --- | --- |
| `hyperplan` | `lit-crucible` |
| `init-deep` | `lit-init` |
| `git-master` | `lit-commit` |
| `teammode` | `lit-team` |
| `remove-ai-slops` | `lit-burnoff` |
| `ai-slop-remover` | `lit-burnoff-file` |
| `korean-ai-slop-remover` | `lit-humanizer` |
| `lit-korean` | `lit-humanizer` |
| `text-naturalization` | `lit-humanizer` |
| `programming` | `lit-code` |
| `prometheus-planner` | `lit-planner` agent |
| `boulder-executor` | `lit-executor` agent |
| `oracle-verifier` | `lit-verifier` agent |
| `dynamic-workflow` | `lit-loop` |

For exactly one release, old bare and dollar-prefixed names route to the current
skill or agent guidance and inject one line:
`Note: <old> was renamed to <new>; the old name is removed in the next minor.`
The emitted line encloses both ids in backticks. Leading-only routes remain
leading-only; the established trailing planning and cleanup routes also accept
their old names. Quoted, fenced, and compound-word mentions stay inert.

The existing `/litclaude:init-deep`, `/litclaude:lit-korean`, and
`/litclaude:korean-ai-slop-remover` command files are one-paragraph redirects.
They pass through the original scope
and print the same note once. Their `user-invocable: false` metadata hides them
from the command menu, and `disable-model-invocation: true` keeps them out of
automatic skill selection. Current listings and recommendations use the new ids.
The `dynamic-workflow` command file is removed; its bare/dollar alias loads
`lit-loop`, and `/litclaude:lit-loop` is the native slash route.

Agent aliases in typed prompts name the new native agent and its existing skill
contract. They do not launch or switch agents. In particular, the executor alias
keeps the explicit `/litclaude:start-work` gate; the planner remains read-only.
Native Agent-tool callers must use the new agent ids. Saved review receipts may
keep the old verifier capability for this release without changing their bytes
or hashes. The validator treats both spellings as one reviewer identity, so two
alias spellings cannot satisfy the independent-review requirement.

Install and update replace the version's entire managed plugin directory before
copying the current payload, then verify its canonical resource hashes. This
removes old skill directories from the active installation; no duplicate skill
folders or old native agent exports ship. User-owned skills outside the managed
plugin remain untouched. Older inactive version caches remain host-owned.

Lane-local `npm test` validates the current payload against the committed parity
manifest. Live sibling freshness is explicit: use
`LITCLAUDE_TEST_FAMILY_FRESHNESS=1 npm test` only from an authorized family run,
or pass `--family-root` to the payload checker. This check runs sibling packaging
hooks and must not activate merely because sibling directories are present.

## Scoped npm migration

The scoped npm candidate is `@litfamily/litclaude`. This local major-version candidate remains
unpublished; remote release requires separate approval. The executable aliases `litclaude`
and `litclaude-ai` remain unchanged. Existing installations do not automatically
switch package names: an old updater still follows its old registry identity.
After the scoped release is publicly verified, explicitly install it:

```bash
npm exec --yes --package @litfamily/litclaude@latest -- litclaude install --yes --no-auto-update
npm exec --yes --package @litfamily/litclaude@latest -- litclaude doctor --no-auto-update
```

For local candidate testing, replace the package argument with the absolute path
to the reviewed tarball. npm installs the module under `node_modules/@litfamily/litclaude`;
it still exposes both original executable aliases. Do not delete the old host
installation before migration. The new installer reuses `litclaude@litclaude-ai`,
`plugins/cache/litclaude-ai/litclaude`, `.litclaude/litclaude-ai` and the
`litclaude-ai` marketplace/installer receipt identity. Unrelated Claude settings,
permission collisions, custom status lines and output-style selections remain
user-owned. Installation and removal refuse modified or foreign managed trees
before changing host settings. Follow [ownership conflicts](#ownership-conflicts)
when that preflight refuses an existing installation; moving only the named tree
is not a complete migration. Keep custom skills outside the installer-managed
plugin tree. Pristine receipt-less migration is supported only for the explicitly
verified legacy baseline; unknown older trees require manual review. New installations
record tree hashes
under `.litclaude-install-receipt.json`. These are same-user integrity records,
not protection against another process that can rewrite both data and receipt.

An older CLI refuses `install`, `update`, and `uninstall` when the active current
pointer, native registration, shared marketplace receipt, or managed HUD belongs
to a newer version. Use a CLI at least as new as the active installation; these
commands do not downgrade or detach it. Inactive newer cache directories alone
do not block management of the current installation and remain preserved.

Old update-cache records naming `litclaude-ai` are ignored by the new updater;
only exact `@litfamily/litclaude` registry metadata can select a new candidate.
A failed install or doctor/version verification follows the existing transaction
rollback, including the legacy cache and marketplace paths. This rename does not
make scoped registry availability, authentication or host UI acceptance a fact.

Once the scoped install and doctor succeed, a globally installed old npm package
may be removed with `npm uninstall -g litclaude-ai`; that removes the old npm
package, not the shared Claude integration. Do not run the old product CLI's
`uninstall` after migration because both names manage the same integration.
Use the scoped package's `litclaude uninstall` when intentionally removing it.

### Ownership conflicts

`INSTALL_OWNERSHIP_CONFLICT` means the installer could not establish ownership
for the reported path or registration. It does not prove that you changed or
corrupted the installation. A receiptless tree can come from an unsupported older
build even when its version label looks familiar. Only the exact bundled pristine
legacy baseline is accepted without a receipt. A missing receipt is not permission
to create one by hand; edited, foreign, symlinked, or newer active state remains
protected.

**Do not move only the reported directory.** The first reported conflict may be
one part of a connected installation. Before any migration, review these surfaces
together using your selected `LITCLAUDE_HOME` and `CLAUDE_CONFIG_DIR` (or
`CLAUDE_HOME`) roots:

| Surface | What must agree |
| --- | --- |
| Marketplace | `marketplaces/litclaude-ai` under the installer root and the native source registration |
| Current installation | `current` and its target under `litclaude-ai/<version>` |
| Native registry | `plugins/installed_plugins.json`, including `litclaude@litclaude-ai`, its version and install path |
| Plugin cache | `plugins/cache/litclaude-ai/litclaude/<version>` under the host root and its ownership receipt |
| Known marketplace | `plugins/known_marketplaces.json` and its local source path |
| HUD and settings | `settings.json`: the managed HUD command/version, enabled plugin and marketplace entries, permissions and output style |

Stop the installer and keep the original state. For help, provide the CLI version,
error prefix, reported path with private parts redacted, and whether this is a
repeat install, upgrade, or removal. Do not post whole settings files or credentials.
Use a compatible CLI only when its supported state is established. Restoring exact
known bytes or preparing a coordinated backup/migration requires a reviewed plan
covering all affected paths; this diagnostic does not perform or authorize it.

For a trial, use the separate profile below. It leaves the old integration selected
in your original terminal. Successful trial installation proves nothing about
whether the old state can be migrated.

### Separate trial profile

Use a **new terminal** and a reviewed local tarball. Run each command separately;
replace the package placeholder with the archive's actual absolute path. Keep the
same terminal open for installation, doctor and Claude. No global npm installation
or removal of existing plugin directories is needed.

```bash
LITCLAUDE_PACK='/absolute/path/to/reviewed-package.tgz'
```

Create a new directory rather than reusing an old trial profile:

```bash
LITCLAUDE_TRIAL=$(mktemp -d "$HOME/litclaude-trial.XXXXXX")
```

If that command fails or prints an error, stop. Do not continue with an empty path.

```bash
export LITCLAUDE_HOME="$LITCLAUDE_TRIAL/lit-state"
export CLAUDE_CONFIG_DIR="$LITCLAUDE_TRIAL/claude-config"
export CLAUDE_HOME="$CLAUDE_CONFIG_DIR"
export NO_UPDATE_NOTIFIER=1
```

```bash
mkdir -p "$LITCLAUDE_TRIAL/project"
```

```bash
cd "$LITCLAUDE_TRIAL/project"
```

Only continue when the directory change succeeds:

```bash
npm exec --yes --package "$LITCLAUDE_PACK" -- litclaude install --yes --no-auto-update
```

If installation fails, keep the output and stop. After success:

```bash
npm exec --yes --package "$LITCLAUDE_PACK" -- litclaude doctor --no-auto-update
```

After doctor succeeds:

```bash
claude
```

A fresh host profile may need its own sign-in. Do not copy private configuration
or credentials into the trial. Check the plugin in this session, then follow the
README first-use task. Installation and doctor success do not prove that an
interactive task has completed.

To return, close the trial Claude session and terminal, then launch Claude as you
did before from the original terminal with its original environment. This switches
profiles; it does not downgrade either installation. Keep the trial directory while
collecting feedback. If you later choose to remove the trial integration, run the
same reviewed package's `litclaude uninstall --no-auto-update` while those trial
variables are still set. Do not use the old CLI to remove a newer shared install.

### Marketplace choices

The repository `.claude-plugin/marketplace.json` retains marketplace name
`litclaude-ai` and plugin source `./plugins/litclaude`. It is a native plugin-only
entry point; it does not run the npm installer's HUD/permission setup.
The separate family hub candidate uses marketplace name `litfamily` and points
to the same native plugin in its Git subdirectory. Its installed key becomes
`litclaude@litfamily`. Choose one marketplace route: enabling both keys can load
the same hooks twice. npm migration does not rewrite or remove the hub key.
Remote marketplace registration and public URLs still need release verification.
