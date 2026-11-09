# Slop lint rules

This document defines the first-pass prose lint rules used by `scripts/slop_lint.py`.

## M4 scope

- rule-01-ai-phrase: banned phrase / AI-tell dictionary hits
- rule-02-em-dash-cluster: excessive em-dash usage within a paragraph
- rule-03-hedging-pileup: multiple hedging tokens in one sentence
- rule-04-stock-boundary: stock opener / closer at section boundaries
- rule-05-sentence-variance: low sentence-length variance in a section
- rule-06-passive-ratio: heuristic passive-voice overuse by section
- rule-07-citation-density: too few citations for a section type
- rule-08-structure-order: headings drift from publisher section order
- rule-09-section-balance: section length imbalance against rough IMRAD expectations
- rule-10-lexical-diversity: low type-token ratio report
- rule-11-heading-case: heading case mismatch vs publisher profile
- rule-12-adjective-stack: stacked promotional adjectives
- rule-13-redundant-qualifier: excessive filler qualifiers
- rule-19-fix-whitespace: safe autofix for quotes, dashes, ellipsis, and spacing
- rule-20-submission-checklist: emit a publisher-specific checklist markdown file

## Reporting shape

- deterministic stdout summary
- deterministic markdown report with line references
- no silent rewrites outside `--fix-whitespace`

## False-positive handling

- Phrase rules are warnings, not automatic blockers.
- Structural rules should prefer publisher order as a guideline and allow optional sections to be skipped.
- Citation density is heuristic and may warn on intentionally self-contained drafts.
- Sentence-variance and lexical-diversity checks should stay conservative on short sections.
- `--fix-whitespace` must stay limited to exact span-safe typography fixes.
