# Artifact template — sections, diagrams, quiz markup

Read this when composing the explainer. It pairs with
`assets/explainer-scaffold.html`, which already contains the CSS, the quiz
engine, and the diagram classes referenced below. Copy the scaffold, replace
`__TITLE__`, `__SUBTITLE__`, `__TOC__`, and `__CONTENT__`, and write only the
content — reinventing the boilerplate per invocation wastes tokens and produces
a different-looking artifact every time.

```bash
SKILL_DIR="$(dirname "$0")/.."            # or the resolved skill path
OUT=~/.litclaude/lit-comprehend/$(date +%F)-<slug>.html
mkdir -p ~/.litclaude/lit-comprehend
cp "$SKILL_DIR/assets/explainer-scaffold.html" "$OUT"
# then edit $OUT, replacing the four placeholders
```

The TOC is an `<ol>` of `<li><a href="#s1">한눈에</a></li>` entries; give each
`<h2>` a matching `id`.

## Section contract

Headers are byte-identical across every LitFamily harness. Keep the Korean
header text exactly as written even when the body is English.

### 1. 한눈에

One tight paragraph. The reader should be able to stop here and still be better
off. Say what changed, why it was done, and what to look at first. Avoid a fixed
confidence or verification callout; keep detailed checks in the internal record.

### 2. 이미 알고 있던 것

The delta anchor. Restate, in the reader's own terms, the objective they set and
the state the system was in when they last had a clear picture. Quote the
objective from `goals.json` verbatim — it is literally their sentence.

If the change required machinery the reader has genuinely not met, introduce it
here inside `.skippable`, so someone who already knows it can move past without
wondering what they missed:

```html
<div class="skippable">
  <p><strong>배경 (이미 아는 내용이면 건너뛰세요)</strong> — …</p>
</div>
```

### 3. 직관

One subsection per theme. Essence before mechanism: the problem, one concrete
piece of toy data moving through, and why the obvious alternative fails. Reuse
the same toy data across the whole document.

### 4. 바뀐 것

The literate walkthrough, in conceptual order. Prose leads; each excerpt lands
where the reader has just been given a reason to care.

Every code block carries `data-src` so the verifier can confirm the quote is
real. Add a line anchor when it helps the reader navigate:

```html
<pre data-src="src/ledger.mjs:88-104">export function appendEvent(event) {
  const line = JSON.stringify(event) + '\n';
  <span class="add">const tmp = LEDGER + '.tmp';
  writeFileSync(tmp, readIfExists(LEDGER) + line);
  renameSync(tmp, LEDGER);</span>
}</pre>
```

`.add` and `.del` shade inserted and removed lines. The verifier skips `.del`
content when checking quotes against the current file, since deleted lines are
correctly absent.

### 5. 직접 만져보기

The micro-world. See `micro-worlds.md`. Omit the section for purely structural
changes rather than inventing a pointless widget.

### 6. 퀴즈

Five questions (three for a small change). Open with one sentence framing it as
a throttle, not a grade, and include the score element the engine updates:

```html
<div class="quiz-q" data-answer="2">
  <p class="q"><span class="n">1.</span> 원장 쓰기가 rename 기반으로 바뀐 뒤,
     쓰기 도중 프로세스가 죽으면 <code>ledger.jsonl</code>은 어떤 상태인가?</p>
  <button class="opt" data-i="0">마지막 줄이 잘린 채 남는다</button>
  <button class="opt" data-i="1">빈 파일이 된다</button>
  <button class="opt" data-i="2">직전 상태 그대로 남는다</button>
  <button class="opt" data-i="3">tmp 파일과 함께 병합된다</button>
  <div class="fb" data-i="0">이전 구현의 동작입니다. append 중 죽으면 부분 줄이 남았고, 그게 이 변경의 이유입니다.</div>
  <div class="fb" data-i="1">쓰기는 tmp에서 일어나므로 원본은 비워지지 않습니다.</div>
  <div class="fb" data-i="2">정답입니다. rename은 원자적이라 성공 아니면 무변경 둘 중 하나입니다.</div>
  <div class="fb" data-i="3">병합 로직은 없습니다. tmp는 고아로 남고 원본은 그대로입니다.</div>
</div>
<p class="quiz-score" id="quiz-score">— 문항을 눌러 확인하세요.</p>
```

Two tells to design out, both of which readers learn faster than the material:

- **위치** — vary the correct slot; never three in a row in the same position.
  The verifier fails the artifact for this.
- **길이** — keep all options within a similar length. If the correct option is
  the longest every time, that is the answer key. Detail belongs in the
  feedback, which is where the reader is already looking.

Every option gets feedback, including the correct one, and each explains *why*.
A wrong click is the only moment in the document where you know exactly what the
reader misunderstood; spending a sentence there is worth more than a paragraph
anywhere else.

### 7. 다음

Three concrete entry points — a file to open, a question worth asking, a risk
worth closing. Not "consider adding tests"; name the test.

## Diagram families

Pick two or three and reuse them. A new visual language per section costs the
reader more than it teaches.

**Pipeline** — stages and data flow. Always show the example datum changing.

```html
<figure>
  <div class="pipe">
    <div class="box"><span class="t">입력</span><span class="d">{id:7}</span></div>
    <span class="arrow">→</span>
    <div class="box hi"><span class="t">정규화</span><span class="d">신규</span></div>
    <span class="arrow">→</span>
    <div class="box"><span class="t">원장</span><span class="d">1줄 추가</span></div>
  </div>
  <figcaption>이벤트 하나가 원장에 닿기까지. 강조된 단계가 이번에 추가됐습니다.</figcaption>
</figure>
```

**Before / after** — usually the right first diagram. Same structure twice, only
the changed element highlighted.

```html
<figure>
  <div class="ba">
    <div class="side"><h4>이전</h4>
      <div class="pipe"><div class="box">append</div><span class="arrow">→</span><div class="box ghost">부분 줄</div></div>
    </div>
    <div class="side after"><h4>이후</h4>
      <div class="pipe"><div class="box">tmp 쓰기</div><span class="arrow">→</span><div class="box hi">rename</div></div>
    </div>
  </div>
  <figcaption>실패 지점이 "쓰는 중"에서 "이름 바꾸기 직전"으로 옮겨갔습니다.</figcaption>
</figure>
```

**State / timeline** — for anything ordering-sensitive: what is true after each
step. A table with a step column reads better than boxes here.

**Simplified UI** — a stripped rendering of what the user sees, for surface
changes. Two or three `.box` elements in a frame beat a screenshot you cannot
take.

Never ASCII art. It collapses on wrap, cannot carry color or emphasis, and the
verifier fails on box-drawing characters outside code blocks.

## Language

Korean prose by default; English on `--en` or an English request. Headers stay
Korean either way. Technical tokens — paths, commands, identifiers, versions,
error strings — stay verbatim in every mode. Never translate an error message;
the reader needs to be able to grep for it.

## Markdown fallback

`--md`, or any environment where HTML cannot be opened. Same nine headers as
`##` sections. Quizzes become `<details>` blocks with the answer and all
per-option feedback inside. Micro-worlds become a worked example that shows
every intermediate value, since the reader cannot poke it. Keep `data-src`
information as a path line above each fenced block so quotes stay traceable.
