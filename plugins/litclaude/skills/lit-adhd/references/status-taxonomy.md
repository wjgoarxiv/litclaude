# lit-adhd status taxonomy

The collector assigns every session exactly one status. The brief renders it in the user's language
with the words below and never invents a fifth.

| Status | Set when | English | 한국어 |
| --- | --- | --- | --- |
| `waiting-on-user` | The last transcript entry is the assistant asking something (a closing `?`, `lit approve`, `확인해 주세요`, `할까요`…), or the session holds a paused workflow frame or a start-work boundary | waiting on you | 나를 기다림 |
| `active` | A transcript write within the last 15 minutes and not waiting | active | 진행 중 |
| `ended` | Quiet for longer than 15 minutes | ended | 끝남 |
| `unknown` | The transcript held no timestamp | unknown | 모름 |

`waitingReason` says why a session waits: `asked the user`, `paused workflow` or
`start-work boundary`. Name it in the card's status cell when present: `waiting on you (paused
workflow)` / `나를 기다림 (멈춘 워크플로)`.

Order in the brief: waiting sessions first, then active, ended and unknown; newest first inside each group.

## Sources

Each entry of `sources` is `ok` or `unknown`. An `unknown` source is named once on the brief's last
line and never filled in from memory.

| Key | Source |
| --- | --- |
| `transcripts` | Claude Code `projects/<slug>/*.jsonl` |
| `plans` | `plans/*.md` checkbox rows |
| `litgoal` | `.litclaude/litgoal/goals.json` |
| `handoffs` | `HANDOFF*.md` headings |
| `git` | `git log --since` |
| `workflowStack` | `.litclaude/workflow-stack/*.json` |
| `startWork` | `.litclaude/boulder.json` |
| `herdr` | `herdr agent list`, only with `HERDR_ENV=1` |

## Next-step kinds

| `next.kind` | Say | English | 한국어 |
| --- | --- | --- | --- |
| `resume-frame` | `lit continue` | resume the paused <skill> at <stage> | 멈춘 <skill>(<stage>)을 이어서 |
| `approve-boundary` | `lit approve` | start-work wants <action> access to <root> | start-work가 <root> <action> 권한을 기다림 |
| `continue-work` | `go` | keep running <plan> | <plan> 계속 진행 |
| `start-plan` | `go` | start <plan> with start-work | <plan>을 start-work로 시작 |
| `none` | — | no next step on record | 기록된 다음 단계 없음 |
