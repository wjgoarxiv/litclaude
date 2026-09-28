# Micro-worlds — patterns for making behavior touchable

A micro-world is a small interactive thing that exists for one reason: so the
reader can develop a feel for a mechanism instead of taking your word for it.
Reading "the retry backs off exponentially and gives up after five attempts"
produces a sentence the reader can repeat. Watching the delays stretch out and
the fifth one turn red produces an intuition they can reason with.

Build it inside the scaffold's `.world` container; the CSS is already there.
Keep it under about forty lines of JavaScript — this is a teaching aid, not a
second implementation, and every line beyond the idea is a line that can drift
from the real code.

## Choosing a pattern

| The thing you are teaching | Pattern |
| --- | --- |
| A function's input/output relationship | Faithful miniature |
| Sensitivity to one number or threshold | Slider |
| A multi-stage pipeline, or ordering | Step-through |
| A behavior change, where old vs new is the point | Old/new toggle |
| A pure rename, a move, a formatting pass | None — skip the section |

## 1. Faithful miniature

The strongest form. Port the changed logic to a few lines of JavaScript, wire it
to an editable input, and let the reader poke it until it stops surprising them.

```html
<div class="world">
  <span class="label">직접 해보기 — 슬러그 생성기</span>
  <input type="text" id="mw-in" value="Ledger: atomic rename (v2)">
  <div class="out" id="mw-out"></div>
  <p class="muted" style="margin:.6rem 0 0">
    실제 <code>slugify()</code>를 단순화한 모형입니다. 유니코드 정규화는 생략했습니다.
  </p>
</div>
<script>
(function () {
  var inp = document.getElementById('mw-in'), out = document.getElementById('mw-out');
  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  function run() { out.textContent = slugify(inp.value) || '(빈 문자열)'; }
  inp.addEventListener('input', run); run();
})();
</script>
```

The caption is not decoration. A reader who mistakes the miniature for the real
implementation will later be confident about behavior that does not exist, which
is worse than the confusion you started with. Always name what you simplified.

## 2. Slider

For a threshold, a timeout, a batch size — any number where the interesting
thing is how output responds as it moves.

```html
<div class="world">
  <span class="label">직접 해보기 — 재시도 백오프</span>
  <div class="row">
    <label for="mw-n">시도 횟수</label>
    <input type="range" id="mw-n" min="1" max="8" value="5" style="flex:1">
    <output id="mw-n-v">5</output>
  </div>
  <div class="out" id="mw-delays"></div>
</div>
<script>
(function () {
  var n = document.getElementById('mw-n'), v = document.getElementById('mw-n-v'),
      out = document.getElementById('mw-delays');
  function run() {
    var k = +n.value, rows = [], total = 0;
    for (var i = 0; i < k; i++) {
      var d = Math.min(200 * Math.pow(2, i), 5000);
      total += d;
      rows.push((i + 1) + '회 → ' + d + 'ms' + (d === 5000 ? '  (상한)' : ''));
    }
    v.textContent = k;
    out.textContent = rows.join('\n') + '\n총 대기 ' + (total / 1000).toFixed(1) + '초';
  }
  n.addEventListener('input', run); run();
})();
</script>
```

Set the initial value to whatever the code actually uses, so the default view
shows real behavior and moving the slider explores alternatives.

## 3. Step-through

For pipelines and anything ordering-sensitive. One button advances one stage and
shows the state after it. The reader controls the pace, which is the whole point
— a static diagram of six stages gets skimmed, six clicks do not.

```html
<div class="world">
  <span class="label">직접 해보기 — 이벤트가 원장에 닿기까지</span>
  <div class="out" id="mw-state"></div>
  <button id="mw-next">다음 단계</button>
  <button id="mw-reset">처음부터</button>
</div>
<script>
(function () {
  var steps = [
    ['입력',      'event = {id:7, kind:"evidence"}'],
    ['정규화',    'event.ts = "2026-08-01T09:00:00Z" 추가'],
    ['tmp 쓰기',  'ledger.jsonl.tmp = 기존 12줄 + 신규 1줄'],
    ['rename',    'ledger.jsonl ← tmp   (원자적)'],
    ['완료',      'ledger.jsonl 13줄. 크래시해도 12줄 또는 13줄, 중간 없음'],
  ];
  var i = -1, st = document.getElementById('mw-state');
  function draw() {
    st.textContent = i < 0
      ? '시작 전: ledger.jsonl 12줄'
      : steps.slice(0, i + 1).map(function (s, n) {
          return (n === i ? '▶ ' : '  ') + s[0] + ': ' + s[1];
        }).join('\n');
  }
  document.getElementById('mw-next').addEventListener('click', function () {
    if (i < steps.length - 1) i++; draw();
  });
  document.getElementById('mw-reset').addEventListener('click', function () { i = -1; draw(); });
  draw();
})();
</script>
```

## 4. Old / new toggle

When the change itself is the lesson, run the same input through both and show
them side by side. This is the interactive form of the before/after diagram, and
it is the most persuasive way to explain why a change was necessary.

```html
<div class="world">
  <span class="label">직접 해보기 — 크래시 지점 바꿔보기</span>
  <div class="row">
    <label><input type="radio" name="mw-impl" value="old" checked> 이전 (append)</label>
    <label><input type="radio" name="mw-impl" value="new"> 이후 (tmp + rename)</label>
  </div>
  <div class="row" style="margin-top:.5rem">
    <label for="mw-crash">크래시 시점</label>
    <input type="range" id="mw-crash" min="0" max="100" value="50" style="flex:1">
  </div>
  <div class="out" id="mw-result"></div>
</div>
<script>
(function () {
  var pct = document.getElementById('mw-crash'), out = document.getElementById('mw-result');
  function impl() {
    var r = document.querySelector('input[name="mw-impl"]:checked');
    return r ? r.value : 'old';
  }
  function run() {
    var p = +pct.value, line = '{"id":7,"kind":"evidence"}';
    if (impl() === 'old') {
      var kept = line.slice(0, Math.round(line.length * p / 100));
      out.textContent = p >= 100
        ? '12줄 + 완전한 13번째 줄 — 정상'
        : '12줄 + 잘린 줄: ' + kept + '\n→ 다음 읽기에서 JSON 파싱 실패';
    } else {
      out.textContent = p >= 100
        ? '13줄 — rename 완료'
        : '12줄 — rename 전이라 원본 무변경. tmp 파일만 고아로 남음';
    }
  }
  pct.addEventListener('input', run);
  document.querySelectorAll('input[name="mw-impl"]').forEach(function (r) {
    r.addEventListener('change', run);
  });
  run();
})();
</script>
```

## Rules that keep a micro-world honest

- **Label it as a model.** Every micro-world states what it simplified. This is
  not modesty; it is the difference between building intuition and installing a
  false belief.
- **Be faithful on the dimension you are teaching.** Simplify anything else
  freely, but if the reader will walk away with a rule about backoff timing,
  the timing must match the real code.
- **Use the document's toy data.** The same three rows and one malformed record
  that appear in 직관 should appear here, so the reader is deepening one mental
  model rather than starting a new one.
- **Show the interesting range by default.** A slider parked where nothing
  changes teaches nothing; start it where the behavior is about to break.
- **No network, no dependencies.** Inline everything. The artifact has to work
  on a plane and in two years.
- **Degrade honestly in `--md` mode.** A micro-world becomes a worked example
  with every intermediate value written out, not a description of a widget the
  reader cannot use.
