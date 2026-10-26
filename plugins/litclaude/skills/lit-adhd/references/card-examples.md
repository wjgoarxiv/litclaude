# lit-adhd brief examples

The collector draws the brief (`litclaude-ai rewind --brief --lang en|ko`), and the skill prints it
exactly as drawn. Both examples below come from the same three sessions: one paused lit-loop that
waits on the user, one pptx lane still running with no recorded total, and one finished schematic
lane, which collapses into the ended table. Gauges, ids, titles, dates and names come from the records; only the connecting words change
with the language.

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

```text
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

```text
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
