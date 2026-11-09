---
name: autoconference:survey
description: |
  Systematic multi-database literature survey. 3 researchers cover non-overlapping
  sources (databases, time periods, or methodologies) with citation-chain knowledge transfer.
  TRIGGER when: user wants a literature survey, systematic review, paper survey,
  wants to cover multiple databases or time periods.
  DO NOT TRIGGER when: user wants to optimize a metric (use autoconference) or
  read a single paper (use scientific-reading).
allowed-tools:
  - Agent
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebSearch
  - WebFetch
---

# autoconference:survey — Systematic Literature Survey

*Run a multi-researcher literature survey where each researcher covers non-overlapping sources, then synthesizes findings via citation-chain knowledge transfer.*

---

## Survey Persistence Directive

**The Session Chair is relentless.** Once the survey begins:

1. **NEVER STOP** a round prematurely. Each round runs all 4 phases to completion.
2. **NEVER ASK** "should I continue to the next round?" Advance automatically.
3. **Use the full budget.** If `max_rounds` is 2, run 2 complete rounds.
4. **The survey runs until one of these conditions is met:**
   - All taxonomy categories have >= minimum papers (coverage target met)
   - `max_rounds` exhausted (budget spent — this is normal, not failure)
   - The user manually interrupts
5. **If none of these conditions are true, begin the next round immediately.**

---

## Pre-Survey Setup (Mandatory)

Before launching any survey, the Session Chair MUST ask the user these questions. Do NOT assume defaults — present options and wait for the user's answers.

### Question 1: Survey Topic / Research Question

Ask: "What is the topic or research question for this literature survey?"

Accept a free-form description. This becomes the lens for all searches and the basis for auto-generating taxonomy categories.

### Question 2: Partitioning Strategy

Ask: "How should researchers divide their search coverage?"

Present options:

- **By database** (recommended for broad coverage):
  - Researcher A → PubMed / bioRxiv
  - Researcher B → arXiv / Semantic Scholar
  - Researcher C → Google Scholar / ACM Digital Library

- **By time period** (recommended for tracking evolution of a field):
  - Researcher A → 2020–2022
  - Researcher B → 2023–2024
  - Researcher C → 2025–present

- **By methodology** (recommended for contrasting research designs):
  - Researcher A → RCTs / experimental studies
  - Researcher B → Observational studies / surveys
  - Researcher C → Reviews / meta-analyses

- **Custom**: User defines their own partitioning scheme (e.g., by language, geography, or application domain)

Record the confirmed partitioning before proceeding.

### Question 3: Minimum Papers per Researcher

Ask: "What is the minimum number of papers each researcher should find per taxonomy category? (Default: 5)"

If the user accepts the default, use 5. Record this as `min_papers`.

### Question 4: Taxonomy Categories

Ask: "What categories should papers be organized into? You can provide a list, or I can auto-generate categories from your research topic."

- If the user provides categories: use them exactly.
- If the user asks for auto-generation: generate 5–8 categories that carve up the topic space without overlap. Present the generated categories for confirmation before proceeding.

Record the confirmed taxonomy as a numbered list.

### Question 5: Max Rounds

Ask: "How many survey rounds should be run? (Default: 2 — surveys usually need fewer rounds than optimization loops)"

If the user accepts the default, set `max_rounds = 2`. Record this value.

---

## Session Chair Responsibilities

The Session Chair (you, the orchestrating agent) owns the survey lifecycle:

1. Conducts pre-survey setup (above)
2. Launches parallel researcher agents each round
3. Collects and analyzes results at each poster session
4. Tracks coverage metrics across taxonomy categories
5. Assigns gap-filling tasks for subsequent rounds
6. Produces the final `survey-report.md`

---

## Round Structure

Each round consists of 4 phases executed in sequence. Do not skip phases.

---

### Phase 1: Independent Search (Parallel)

Spawn 3 researcher agents in parallel. Each agent receives:
- The research topic / research question
- Their specific source partition assignment
- The full taxonomy (list of categories)
- The minimum papers target (`min_papers`)
- Any citation leads from previous rounds (empty on Round 1)

Each researcher MUST:

1. **Search their assigned sources** using the research topic. Use `WebSearch` and `WebFetch` to find papers. Try multiple search queries — not just the exact topic phrase. Use synonyms, sub-topics, and related terms to maximize coverage.

2. **For each paper found**, extract and record:
   - Title
   - Authors (first author + et al. if > 3)
   - Year of publication
   - Venue / journal / preprint server
   - Abstract summary (2–3 sentences in the researcher's own words)
   - Key findings (bullet list, max 5 points)
   - Methodology used
   - Which taxonomy category this paper belongs to (assign to exactly one)
   - Papers this work cites that seem highly relevant (citation leads)
   - Papers that cite this work, if discoverable

3. **Organize findings into the taxonomy.** Produce a table or structured list grouped by category.

4. **Self-assess coverage** using a qualitative 1–10 score per category:
   - 1–3: Very sparse (< 2 papers found)
   - 4–6: Partial (2–4 papers found)
   - 7–9: Good (5–7 papers found)
   - 10: Comprehensive (8+ papers, confident no major gaps)

5. **Log results** to `researcher_{ID}_results.tsv` in the conference working directory. Format:

   ```
   category\ttitle\tauthors\tyear\tvenue\tsummary\tkey_findings\tcoverage_score
   ```

6. **Report citation leads** — a list of papers encountered in references or related work sections that the researcher could not access from their assigned sources but may be findable by other researchers.

---

### Phase 2: Citation Chain Poster Session

The Session Chair collects all researcher outputs and runs the poster session analysis:

**2a. Aggregate results**

Build a unified table: for each taxonomy category, list all papers found across all researchers, with researcher ID noted.

**2b. Citation overlap analysis**

Identify papers that appear in multiple researchers' results (cited by multiple researchers or independently discovered). These high-overlap papers are likely foundational — flag them as **anchor papers**.

**2c. Coverage gap analysis**

For each taxonomy category:
- Count total papers found
- Flag categories where count < `min_papers` as **coverage gaps**
- Record which researcher(s) have coverage in each category

**2d. Citation chain knowledge transfer**

This is the key differentiator from independent search. The Session Chair synthesizes citation leads across researcher boundaries:

- "Researcher A found paper X (in PubMed) which cites paper Y — Researcher B should search for paper Y in arXiv/Semantic Scholar"
- "Researcher C's meta-analysis references a 2021 RCT — Researcher A should search for it in their time period"
- "Category Z has no coverage from Researcher B's database — Researcher B should try alternative search terms: [suggest 3 terms]"

Produce a **Citation Lead Dossier** listing:
- For each gap category: 2–3 specific papers to chase or search queries to try
- For each citation lead: which researcher should pursue it in the next round and why

**2e. Print summary to terminal:**

```
=== POSTER SESSION: ROUND {N} ===
Papers found this round: {total}
Anchor papers (multi-researcher): {count}
Coverage gaps: {list of categories below min_papers}
Citation leads generated: {count}
Coverage metric: {categories_at_or_above_min} / {total_categories}
```

---

### Phase 3: Peer Review

Spawn a Reviewer agent (use highest available model for rigor) to review the accumulated findings:

The Reviewer checks:

1. **Accuracy of summaries** — spot-check 3–5 papers by fetching their abstracts directly. Do the researcher summaries accurately reflect the paper content? Flag any misrepresentation.

2. **Categorization correctness** — are papers assigned to the right taxonomy category? Flag any papers that seem miscategorized.

3. **Obvious missing papers** — given the research topic and taxonomy, are there well-known papers or research groups that should appear but don't? List up to 5 specific suggestions.

4. **Balance across categories** — is coverage suspiciously skewed? (e.g., one category has 20 papers while others have 0) If so, flag it.

5. **Quality of citation leads** — are the citation lead dossier suggestions actionable and relevant?

The Reviewer produces a short `peer-review-round-{N}.md` with:
- Accuracy issues found (with paper titles)
- Miscategorization flags
- Missing paper suggestions
- Balance observations
- Citation lead quality assessment

---

### Phase 4: Coverage Transfer

The Session Chair processes the peer review and prepares for the next round:

1. **Update the shared citation graph** — merge all newly discovered papers and citation relationships into a running graph (text format):
   ```
   [Paper A] --cites--> [Paper B]
   [Paper C] --cites--> [Paper A]
   ```

2. **Incorporate peer review flags** — if accuracy issues were found, add a correction task for the next round. If miscategorizations were found, move papers to correct categories now.

3. **Assign gap-filling tasks** — based on the Citation Lead Dossier and peer review missing-paper suggestions, assign specific search tasks to each researcher for the next round:
   ```
   Researcher A (next round): Chase citation lead [Paper Y]; try search query "[alternative term]" in PubMed
   Researcher B (next round): Investigate Category Z gap; search for [specific suggested papers]
   Researcher C (next round): Verify claim in [Paper X]; search for RCT cited in [meta-analysis title]
   ```

4. **Compute convergence metric:**
   ```
   coverage_metric = (categories with >= min_papers) / total_categories
   ```
   If `coverage_metric == 1.0`, the coverage target is met. Note this — the survey may conclude after this round completes.

5. **Print status:**
   ```
   === ROUND {N} COMPLETE ===
   Coverage metric: {coverage_metric:.2f} ({categories_at_min}/{total})
   Target met: YES / NO
   Budget remaining: {max_rounds - N} rounds
   Next round: AUTO-STARTING
   ```

   If target met AND budget exhausted, or if target met early: proceed to Final Output.
   If budget remains and target not met: begin Round N+1 immediately with the gap-filling assignments.

---

## Convergence Conditions

Stop the survey when ANY of the following is true:

1. `coverage_metric == 1.0` (all categories have >= `min_papers` papers) — **coverage target met**
2. `N == max_rounds` — **budget exhausted** (this is a normal, expected stopping point)
3. User interrupts

On stopping, proceed immediately to Final Output.

---

## Final Output: survey-report.md

Write `survey-report.md` to the conference working directory. The report must contain all of the following sections:

---

### Section 1: Executive Summary

3–5 paragraphs covering:
- The research question this survey addressed
- The partitioning strategy used and why
- The total number of papers found and across how many rounds
- The 3–5 most important findings across all researchers
- The most significant gaps that remain

### Section 2: Taxonomy Table

A complete table with one row per paper, organized by category. Columns:

| Category | Title | Authors | Year | Venue | Key Findings | Methodology |
|---|---|---|---|---|---|---|

Sort within each category by year (descending).

### Section 3: Citation Graph

Text-format citation graph showing the key citation chains discovered across researchers. Format:

```
[CATEGORY: {name}]
  [Paper A (Year)] --cites--> [Paper B (Year)] --cites--> [Paper C (Year)]
  [Paper D (Year)] --cites--> [Paper A (Year)]

[CROSS-CATEGORY LINKS]
  [Paper E (Category 1)] --cites--> [Paper F (Category 3)]
```

List anchor papers (cited by 2+ researchers or discovered via multiple chains) with a note: `(ANCHOR)`.

### Section 4: Coverage Heatmap

A text-format table showing coverage per category per researcher:

| Category | Researcher A | Researcher B | Researcher C | Total |
|---|---|---|---|---|
| Category 1 | 5 | 3 | 4 | 12 |
| Category 2 | 2 | 6 | 1 | 9 |
| ... | | | | |

Color coding (in markdown bold/italics):
- **Bold**: >= `min_papers` (coverage target met)
- *Italic*: < `min_papers` (gap)
- Empty cell: 0 papers

### Section 5: Gaps and Recommendations

A structured list of:

1. **Uncovered categories** (if any remain below `min_papers`) — with specific search suggestions
2. **Citation leads not yet chased** — papers identified in citation chains but not yet retrieved
3. **Peer review flags** — accuracy issues or miscategorizations flagged across rounds
4. **Recommended next steps** — if the user wants to deepen coverage, what should they do next?

### Section 6: Methodology Note

Brief description of the survey protocol used:
- Partitioning strategy
- Rounds run
- Total papers considered
- Peer review process used

---

## Chaining

This skill produces a literature foundation that feeds naturally into other skills:

- **`autoconference:survey` → `autoconference`**: Use the survey's taxonomy and anchor papers as the `background` section of a `conference.md` to bootstrap an optimization conference with an established literature base.
- **`autoconference:survey` → `autoconference:ship`**: Pass `survey-report.md` to the ship skill to format the survey findings as a publication-ready systematic review.

When chaining, note which papers are anchor papers — these are the highest-priority references to include in the downstream conference or publication.
