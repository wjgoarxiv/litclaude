# Korean Prose Rewrite Rules

These rules guide a restrained rewrite. The goal is not to make every sentence stylish; it is to make the prose sound like careful Korean written for the user's situation while preserving the original meaning.

## Rewrite Order

1. Lock meaning first: facts, numbers, names, claims, citations, quotes, and requested tone are constraints.
2. Fix unclear logic before fixing rhythm.
3. Replace generic phrasing with concrete wording only when the source already supports it.
4. Reduce repetition where it is accidental.
5. Stop when the passage becomes natural enough for the context.

## Meaning-Safe Editing

- Keep all numbers, units, dates, ranges, percentages, grades, model names, organization names, and person names unchanged unless the user asks for correction.
- Do not upgrade a possibility into a fact, a correlation into a cause, or a limited result into a universal claim.
- Preserve uncertainty markers such as "가능성이 있다", "추정된다", "일부", "대체로", and "현재로서는" when they carry evidentiary meaning.
- Keep citations, footnote markers, document titles, quoted strings, and bracketed references in place.
- If a sentence is factually ambiguous, rewrite for clarity without inventing missing information.
- If the user supplied a required tone, treat it as part of meaning.

## Sentence-Level Moves

- Change passive or noun-heavy phrasing into direct predicates when the actor is known.
- Split a long sentence when it contains two different claims or a claim plus a caveat.
- Merge short repetitive sentences when they merely restate the same topic.
- Move the main point earlier when the sentence hides it behind setup language.
- Replace filler openings with the actual subject or action.
- Use connectors only when they name a real relation: addition, contrast, cause, condition, sequence, or summary.
- Prefer Korean word order that lets the reader reach the predicate without carrying too many modifiers.

## Paragraph-Level Moves

- Give each paragraph one job: context, claim, evidence, implication, limitation, or next step.
- Put the strongest sentence where it guides the rest of the paragraph.
- Remove repeated framing if adjacent paragraphs already establish the topic.
- Keep lists parallel only when the items are truly comparable.
- When the paragraph contains a warning or limitation, make that boundary visible rather than smoothing it away.

## Tone Controls

- Formal report: concise, evidence-aware, low drama, stable endings.
- Professional email: clear action, respectful phrasing, no inflated praise.
- Academic or technical note: preserve terms, hedge only where evidence requires it, avoid promotional adjectives.
- Public-facing explanation: shorter sentences, concrete nouns, gentle transitions.
- Personal voice: keep idiosyncratic but clear phrasing; do not over-standardize.

## Handling Common Machine-Prose Habits

- Replace repeated "중요합니다" with the reason it matters.
- Replace repeated "도움이 됩니다" with the actual benefit or action.
- Replace vague "부분" with the specific object, step, issue, or condition.
- Replace "다양한" only when the source names the variety; otherwise remove it.
- Replace "효율적" only when the text explains time, cost, effort, accuracy, or reliability.
- Keep "전반적으로" only when the passage really summarizes the whole.
- Keep "따라서" only when the previous sentence proves the next sentence.

## No-Op And Minimal-Edit Rule

Choose a no-op or minimal edit when rewriting would mainly change taste.

- If the text is already natural, say so and provide either the unchanged text or a lightly corrected version.
- If only one sentence is awkward, edit that sentence instead of rewriting the whole passage.
- If the user asks for strict preservation, prefer smaller changes and include a short note about what was left untouched.
- If a quote, citation, legal phrase, or named label sounds awkward but must remain exact, leave it unchanged and polish around it.

## Output Discipline

For each completed pass, provide:

- the revised Korean text,
- a short summary of what changed,
- any fidelity notes for preserved facts, names, numbers, citations, quotes, or tone,
- unresolved questions only when the text cannot be safely improved without user input.
