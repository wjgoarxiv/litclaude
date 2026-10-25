# lit-adhd brief examples

Both examples render the same collector JSON. Gauges, ids, titles and names are copied from it
verbatim; only the connecting words change with the language. The JSON excerpt comes first.

```json
{
  "summary": { "sessions": 3, "waitingOnUser": 1, "active": 1 },
  "sessions": [
    { "id8": "655f39d3", "title": "ADHD lane", "asked": ["build the collector"], "done": { "files": ["lib/rewind/collect.mjs"], "commits": [{ "hash": "bdea372", "subject": "feat(rewind): collect cross-session records" }] }, "result": "Collector committed; the skill comes next. Shall I continue?", "status": "waiting-on-user", "waitingReason": "asked the user", "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/19", "remaining": ["11. Skill lit-adhd", "12. go continues", "…(+7)"] } },
    { "id8": "f06fb727", "title": "pptx lane", "asked": ["fix the deck QA"], "done": { "files": [], "commits": [] }, "result": "unknown", "status": "active", "progress": { "gauge": "[???] ?/?", "remaining": ["unknown"] } },
    { "id8": "2fad84a7", "title": "schematic lane", "asked": ["render the figure"], "done": { "files": ["fig.svg"], "commits": [] }, "result": "Figure rendered.", "status": "ended", "progress": { "gauge": "[▉▉▉] 3/3", "remaining": [] } }
  ],
  "roadmap": { "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/20" }, "plans": [{ "plan": "plans/lit-adhd.md", "local": true, "current": "11. Skill lit-adhd", "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/19" } }], "plansOmitted": 0 },
  "workflows": [{ "id8": "655f39d3", "skill": "lit-loop", "stage": "verify", "status": "paused", "progress": { "gauge": "[▉▉▉░░░░] 3/7", "remaining": ["unknown"] } }],
  "next": { "kind": "resume-frame", "say": "lit continue" },
  "sources": { "herdr": "unknown" }
}
```

## English

> 3 sessions · 1 waiting on you · 1 active
>
> | Session | Asked | Done | What it means | Status |
> | --- | --- | --- | --- | --- |
> | 655f39d3 ADHD lane | build the collector | `lib/rewind/collect.mjs`, commit bdea372 | collector landed; it asked whether to go on | waiting on you |
> | f06fb727 pptx lane | fix the deck QA | unknown | unknown | active |
> | 2fad84a7 schematic lane | render the figure | `fig.svg` | figure is done | ended |
>
> 655f39d3 `[▉▉▉▉░░░░░░] 10/19`, left: 11. Skill lit-adhd, 12. go continues, …(+7)
> f06fb727 `[???] ?/?`
> 2fad84a7 `[▉▉▉] 3/3`
>
> **Roadmap here** `[▉▉▉▉░░░░░░] 10/20`. `plans/lit-adhd.md` `[▉▉▉▉░░░░░░] 10/19`, now: 11. Skill lit-adhd
>
> **Paused:** lit-loop `[▉▉▉░░░░] 3/7` at verify, resume?
>
> **Next:** resume the paused lit-loop at verify. Say `lit continue`.
>
> unknown: herdr

## 한국어

> 세션 3개 · 나를 기다리는 것 1 · 진행 중 1
>
> | 세션 | 요청 | 한 일 | 결과의 뜻 | 상태 |
> | --- | --- | --- | --- | --- |
> | 655f39d3 ADHD lane | build the collector | `lib/rewind/collect.mjs`, 커밋 bdea372 | 수집기가 들어갔고 계속할지 물음 | 나를 기다림 |
> | f06fb727 pptx lane | fix the deck QA | 모름 | 모름 | 진행 중 |
> | 2fad84a7 schematic lane | render the figure | `fig.svg` | 그림 완료 | 끝남 |
>
> 655f39d3 `[▉▉▉▉░░░░░░] 10/19`, 남은 것: 11. Skill lit-adhd, 12. go continues, …(+7)
> f06fb727 `[???] ?/?`
> 2fad84a7 `[▉▉▉] 3/3`
>
> **이 워크트리 로드맵** `[▉▉▉▉░░░░░░] 10/20`. `plans/lit-adhd.md` `[▉▉▉▉░░░░░░] 10/19`, 지금: 11. Skill lit-adhd
>
> **멈춘 작업:** lit-loop `[▉▉▉░░░░] 3/7` (verify), 이어갈까요?
>
> **다음:** 멈춘 lit-loop을 verify부터 이어서. `lit continue`라고 입력하세요.
>
> 모름: herdr

## What the examples do not do

- They do not estimate the pptx lane's progress: its gauge is `[???] ?/?`, copied as is.
- They do not describe work the records do not show: the pptx lane's "done" is `unknown`.
- They offer one next step only, and do not start it.
