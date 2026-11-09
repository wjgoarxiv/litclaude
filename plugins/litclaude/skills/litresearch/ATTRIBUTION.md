# ATTRIBUTION / NOTICE — litresearch

The `litresearch` skill is authored for LitClaude. One design idea in it is adapted from a
third-party project and is credited below. **No third-party source code is vendored, copied,
or redistributed here** — only a verification concept is adapted into this skill's prompt
contract.

This file exists because the Phase 3b claim-graph gate ships. If that gate is ever removed,
this notice may be removed with it; while the gate is present, this notice must stay.

---

## 1. insane-research (fivetaku) — inspiration for the claim-graph verification gate

The claim-graph verification gate in `SKILL.md` (Phase 3b: a data-flow lock in which the
synthesis may assert a high-risk non-code claim only after it clears
`>= 2 independent source domains + 1 counter-search + a primary source`, and anything failing
is abstained into an Unresolved or Refuted annex) is inspired by the data-flow-lock
verification design in **insane-research** by fivetaku.

- Source: https://github.com/fivetaku/insane-research
- Licence: MIT (declared in that project's `README.md`).

**What is adapted:** the idea only — a verification gate whose output is the sole allowlist
the synthesis may draw from, so skipping verification leaves nothing to synthesize. The
upstream implementation is a Python checker (`validate_ledger.py`). LitClaude does not vendor
or invoke it: this skill translates the concept into a runtime-agnostic prompt contract,
because LitClaude ships zero runtime dependencies and cannot assume Python is present.

**What is not adapted:** no upstream code, file layout, data format, or wording is reused.

The MIT licence requires that its copyright notice and permission notice travel with any
adaptation, so the licence text is reproduced in full:

```
MIT License

Copyright (c) 2026 fivetaku

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
