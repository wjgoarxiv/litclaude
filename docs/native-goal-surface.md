# Native `/goal` Surface Matrix

This matrix separates who owns a Claude Code session from what the LitClaude
plugin can do. It is capability guidance only: there is no runtime bridge from
LitClaude into another session.

## Prerequisites

- Use Claude Code >=2.1.139; older clients do not provide the native `/goal`
  surface described here.
- Complete workspace trust before relying on project-local plugin behavior.
- Confirm hooks are enabled and that user, project, organization, and managed policy
  do not block the session or command surface. Hook context is still not
  slash-command dispatch.
- For an SDK-owned session, inspect the system/init `slash_commands` list and
  submit `/goal` only when that initialized session advertises the command. The
  SDK client must own the target session and its input channel.

| Surface owner | Can submit `/goal`? | Which session changes? | LitClaude boundary |
| --- | --- | --- | --- |
| User / Remote Control | Yes, by submitting `/goal <condition>` through that user-controlled input surface. | The session receiving that input. | LitClaude may provide a condition, but does not submit it for the user. |
| SDK-owned session | Yes, when the SDK client submits `/goal <condition>` to the session it created and owns. | That SDK-owned session only. | The SDK client is the submitter; the installed plugin is not a cross-session controller. |
| Separate `claude -p` session | Yes, by starting a separate print session whose prompt begins with `/goal`. | The new print session, not an arbitrary already-open TUI. | `litclaude litgoal native-worker` can build or launch this separate process explicitly. |
| LitClaude plugin in an arbitrary already-open TUI | No supported binding path. | None. | A skill, command body, MCP server, or hook cannot claim that it armed the open TUI. |

## Ready to paste

After creating and reviewing the durable criteria, the user or owner of the
target session can paste this condition there:

```text
/goal Finish only when every criterion in .litclaude/litgoal/goals.json is pass, required evidence is recorded in .litclaude/litgoal/ledger.jsonl, targeted verification passes, and .litclaude/litgoal contains no unresolved review blocker.
```

Adapt filenames only when the local ledger reports a different authoritative
path. The condition does not make the ledger self-validating; recorded evidence
still needs the normal LitClaude review gates.

## Hook runtime contract

When the current session does not expose model-facing goal tools, the native
binding helper returns `status: "blocked-unavailable"` with
`nextAction: "ready-to-paste"`, a bounded `condition`, and the exact `command`.
UserPromptSubmit includes a `READY_TO_PASTE` instruction containing that command.
The model should show the unchanged line and ask the user to copy, paste, and
send it as a new message in the current session. This is a user-confirmed
submission, not automatic invocation: LitClaude cannot enter the command,
replace the current prompt, or turn it into a tool call.

This documentation does not add a fake command, MCP method, or hook dispatch.
The native-goal binding itself does not auto-install a goal, mutate a transcript,
inject keystrokes, or claim success based on prompt context alone. Package
updates, when eligible, follow the separate bounded transaction documented in
[`docs/hooks.md`](hooks.md#foreground-automatic-update-barrier).
