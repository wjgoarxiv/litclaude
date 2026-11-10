# lit-adhd status taxonomy

The collector assigns every session exactly one status. The brief renders it in the user's language
with the words below and never invents another.

| Status | Set when | English | 한국어 |
| --- | --- | --- | --- |
| `waiting-on-user` | The last transcript entry is the assistant asking something (a closing `?`, `lit approve`, `확인해 주세요`, `할까요`…), or the session holds a paused workflow frame or a start-work whose open tasks all wait on parked steps | waiting on you | 나를 기다림 |
| `active` | A transcript write within the last 15 minutes and not waiting | active | 진행 중 |
| `done` | Its start-work run completed inside the window (boulder history) and its liveness record shows no activity after that | done | 완료 |
| `idle` | Another session whose newest liveness record is `idle`, at least as new as its last transcript line | idle | 쉬는 중 |
| `ended` | Quiet for longer than 15 minutes, or its newest liveness record is `ended` | ended | 끝남 |
| `unknown` | The transcript held no timestamp | unknown | 모름 |

The session running the brief is always `active`, and a `waiting-on-user` session keeps that status
whatever its liveness record says.

`waitingReason` says why a session waits: `asked the user`, `paused workflow` or
`start-work boundary`. Name it in the card's status cell when present: `waiting on you (paused
workflow)` / `나를 기다림 (멈춘 워크플로)`.

Order in the brief: waiting sessions first, then active, then idle and done, then ended and unknown; newest first inside each group.

## Board buckets

The KPI board never prints a status code. It sorts everything into four buckets, with these icons
only:

| Bucket | 한국어 | English | What lands there |
| --- | --- | --- | --- |
| ✅ | 끝남 | Done | ticked plan rows, passed litgoal criteria, plans and runs finished inside the window |
| 🔄 | 진행 중 | In progress | the current row of a milestone that is under way (some rows ticked, or its start-work active) |
| ⏳ | 나를 기다림 | Waiting on you | a milestone whose start-work waits on parked steps, and each `waiting-on-user` session |
| ⬜ | 남음 / 시작 전 | Left / Not started | every other open row; a milestone with nothing ticked reads `⬜ 남음` / `⬜ Not started` |

`active`, `idle`, `done`, `ended` and `unknown` sessions are not counted as items: the board counts
plan rows and criteria, and a session reaches it only as the thing to do now or as a reminder.

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
| `approve-boundary` | `lit approve` (or `lit cancel`) | start-work waits on a parked step: <action> access to <root> | start-work가 보류한 단계를 기다림: <root> <action> 권한 |
| `continue-work` | `go` | keep running <plan> | <plan> 계속 진행 |
| `start-plan` | `go` | start <plan> with start-work | <plan>을 start-work로 시작 |
| `none` | — | no next step on record | 기록된 다음 단계 없음 |
