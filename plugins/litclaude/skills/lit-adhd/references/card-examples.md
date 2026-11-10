# lit-adhd brief examples

The collector draws the brief (`litclaude-ai rewind --brief --lang en|ko`), and the skill prints it
exactly as drawn. Both examples below come from the same three sessions: one paused lit-loop that
waits on the user, one pptx lane still running with no recorded total, and one finished schematic
lane, which collapses into the ended table. Gauges, ids, titles, dates and names come from the records; only the connecting words change
with the language.

## The KPI board (the default reply)

`litclaude-ai rewind --brief` draws the board below; the per-session brief further down appears
under it only with `--detail`. Both boards come from one throwaway repository: a finished
four-row plan, a plan at 3 of 8, a plan nobody touched for 13 days, one session that asked a
question, two uncommitted changes and one commit not pushed yet. Nothing in them is typed by
hand: the counts, bars, lists and reminders are the collector's.

How to read it in ten seconds:

1. **🎯** says the one thing to do now, why, and after 👉 exactly what to type, or where to go
   when nothing runs on `go` (here: answer the question in that session).
2. **📊** gives the four buckets (✅ done, 🔄 in progress, ⏳ waiting on you, ⬜ left) and one
   overall bar over every milestone row.
3. **🏁** lists each plan or goal with its status, bar and last change.
4. **✅** and **⬜** are the latest finished rows and what is left, in plan order.
5. **🔔** is what not to forget, each `thing → what to do`.

### Korean

````markdown
## 🎯 지금 할 일
**demo 세션의 질문에 답하기** — “Should I also retry on cellular, or only on wifi?”  
👉 그 세션(demo)으로 가서 답하기

## 📊 한눈에 보기
| ✅ 끝남 | 🔄 진행 중 | ⏳ 나를 기다림 | ⬜ 남음 |
|:--:|:--:|:--:|:--:|
| 7 | 1 | 1 | 4 |

전체 진행  █████░░░░░ 7/12 (58%)

## 🏁 마일스톤
| 마일스톤 | 상태 | 진행 | 최근 |
|---|---|---|---|
| Mobile sync | 🔄 진행 중 | ███░░░░░░░ 3/8 | 방금 |
| Search API | ✅ 끝남 | ██████████ 4/4 | 방금 |

## ✅ 최근 끝낸 일
- M3. Send changes in batches
- M2. Store a change log per device
- M1. Pick the conflict rule
- S4. Write the API docs
- S3. Wire the HTTP handler

## ⬜ 남은 일
1. 🔄 M4. Retry when the network drops
2. M5. Show sync status in the app
3. M6. Add an offline test suite
4. M7. Measure battery use
5. M8. Write the release notes

## 🔔 잊지 말 것
- 💾 커밋 안 된 변경 2개 (demo) → 확인하고 커밋하거나 정리하기
- ⬆️ 푸시 안 된 커밋 1개 (demo) → 준비되면 `git push`
- 🕰️ 13일째 멈춘 계획: Dark theme → 이어 할지, 접을지 정하기

*세션별 자세한 내용: `lit adhd 자세히`*
````

### English

````markdown
## 🎯 Do this now
**Answer the question in the demo session** — “Should I also retry on cellular, or only on wifi?”  
👉 Go to that session (demo) and answer there

## 📊 At a glance
| ✅ Done | 🔄 In progress | ⏳ Waiting on you | ⬜ Left |
|:--:|:--:|:--:|:--:|
| 7 | 1 | 1 | 4 |

Overall  █████░░░░░ 7/12 (58%)

## 🏁 Milestones
| Milestone | Status | Progress | Last change |
|---|---|---|---|
| Mobile sync | 🔄 In progress | ███░░░░░░░ 3/8 | just now |
| Search API | ✅ Done | ██████████ 4/4 | just now |

## ✅ Done lately
- M3. Send changes in batches
- M2. Store a change log per device
- M1. Pick the conflict rule
- S4. Write the API docs
- S3. Wire the HTTP handler

## ⬜ Still to do
1. 🔄 M4. Retry when the network drops
2. M5. Show sync status in the app
3. M6. Add an offline test suite
4. M7. Measure battery use
5. M8. Write the release notes

## 🔔 Don't forget
- 💾 2 uncommitted changes (demo) → review, then commit or clean up
- ⬆️ 1 unpushed commit (demo) → `git push` when ready
- 🕰️ A plan untouched for 13 days: Dark theme → decide to resume or drop it

*Per-session detail: `lit adhd detail`*
````

The 13-day-old plan is not a milestone (it is outside the 7-day window), so it is not counted
in the overall bar; it shows up once, as a 🕰️ reminder to decide on.

## The per-session brief (`--detail`)

## How to read it in ten seconds

1. **Headline** (`## 🧭 …`): how many sessions, how many wait on you, how many are active, and the
   next step in plain words.
2. **One card per live session** (waiting or active), under a `### 🌿 branch · worktree` group:
   - badge: 🟠 waiting on you, 🟢 active, ⚪ ended, ⚫ unknown, with the reason it waits;
   - the goal in bold, from the session's title or its first ask;
   - a gauge only when both numbers are recorded (`[▉▉▉░░░░] 3/7` plus what is left), otherwise
     the known facts after ⏳ (how long it ran and its last ask), never a question-mark gauge;
   - ✅ what was done (edited files, commits, or the tools used before any edit) and ▶ what is next
     for that session, or what it is doing now.
3. **Ended sessions**, one table row each.
4. **Roadmap** timeline: ✓ finished commits with their dates, ▶ the current item of each open plan
   with its gauge, ○ the items after it.
5. **One recommended next step** in a box, and the word to type.

## English

````markdown
## 🧭 3 sessions · 1 waits on you · 1 active · next: Resume the paused lit-loop at verify
*last 7d · 2 worktrees*

### 🌿 `main` · repo

> 🟠 **WAITING ON YOU** (paused workflow) · `655f39d3` · 25m ago · this session  
> **ADHD lane**  
> `[▉▉▉░░░░] 3/7` · later: 4. verify, 5. docs (+2)  
> ✅ Done: edited `collect.mjs` · 1 commit: `bdea372` feat(rewind): collect cross-session records  
> ▶ Next: resume lit-loop at verify (`lit continue`)

### 🌿 `lane/pptx` · pptx

> 🟢 **ACTIVE** · `f06fb727` · 2m ago  
> **pptx lane**  
> ⏳ 46m of work · last ask: “fix the deck QA”  
> ✅ Done: no edits yet; used Read, Bash  
> ▶ Next: now: Bash “Render the deck”

### ⚪ Ended · 1

| id | where | goal | ago | done |
|---|---|---|---|---|
| `2fad84a7` | repo | schematic lane | 6h | 1 file |

### 🗺️ Roadmap `[▉▉▉▉▉░░░░░] 10/19`

- ✓ 10-26 14:30 · `main` feat(rewind): collect cross-session records
- ▶ **now** · `plans/lit-adhd.md` `[▉▉▉▉▉░░░░░] 10/19` → 11. Skill lit-adhd
  - ○ later · 12. go continues
  - ○ later · 13. card

```
╭─ RECOMMENDED NEXT STEP ──────────────╮
│ Resume the paused lit-loop at verify │
│ type: lit continue                   │
╰──────────────────────────────────────╯
```

Type **`lit continue`** to continue.

*Not read: herdr.*
````

## 한국어

````markdown
## 🧭 세션 3개 · 나를 기다리는 것 1 · 진행 중 1 · 다음: 멈춘 lit-loop(verify) 이어가기
*최근 7d · 워크트리 2개*

### 🌿 `main` · repo

> 🟠 **나를 기다림** (멈춘 워크플로) · `655f39d3` · 25m 전 · 이 세션  
> **ADHD lane**  
> `[▉▉▉░░░░] 3/7` · 이후: 4. verify, 5. docs (+2)  
> ✅ 한 일: 수정 `collect.mjs` · 커밋 1개: `bdea372` feat(rewind): collect cross-session records  
> ▶ 다음: lit-loop(verify) 이어가기 (`lit continue`)

### 🌿 `lane/pptx` · pptx

> 🟢 **진행 중** · `f06fb727` · 2m 전  
> **pptx lane**  
> ⏳ 46m 작업 · 마지막 요청: “fix the deck QA”  
> ✅ 한 일: 아직 수정 없음, 쓴 도구 Read, Bash  
> ▶ 다음: 지금: Bash “Render the deck”

### ⚪ 끝난 세션 · 1

| id | 위치 | 목표 | 끝난 지 | 한 일 |
|---|---|---|---|---|
| `2fad84a7` | repo | schematic lane | 6h | 파일 1개 |

### 🗺️ 로드맵 `[▉▉▉▉▉░░░░░] 10/19`

- ✓ 10-26 14:30 · `main` feat(rewind): collect cross-session records
- ▶ **지금** · `plans/lit-adhd.md` `[▉▉▉▉▉░░░░░] 10/19` → 11. Skill lit-adhd
  - ○ 이후 · 12. go continues
  - ○ 이후 · 13. card

```
╭─ 추천하는 다음 단계 ───────────╮
│ 멈춘 lit-loop(verify) 이어가기 │
│ 입력: lit continue             │
╰────────────────────────────────╯
```

**`lit continue`** 라고 입력하면 이어갑니다.

*읽지 못함: herdr.*
````

## What the examples do not do

- They do not estimate the pptx lane's progress. Its total is not recorded, so its card says how long
  it has run and what it was last asked, and shows no gauge.
- They do not describe work the records do not show: the pptx lane has no edit or commit yet, so its
  done line names the tools it used and its next line what it is doing now.
- They offer one next step only, and do not start it; the user's `lit continue` does.
