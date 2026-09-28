---
name: autoconference:ship
description: |
  8-phase pipeline to convert conference results into paper-ready output.
  Formats, verifies, and packages conference findings for publication.
  TRIGGER when: user wants to ship/publish/format conference results,
  create a paper/report/blog post from conference output.
  DO NOT TRIGGER when: user wants to run a conference (use autoconference).
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

# autoconference:ship — Conference Results Shipping

*Convert conference findings into publication-ready output through an 8-phase pipeline with a single human review gate.*

---

## Shipping Persistence Directive

This pipeline runs to completion autonomously. The **only** pause point is Phase 7 (CONFIRM), where the user reviews the draft and approves or requests changes. All other phases execute automatically in sequence without asking the user for permission to continue.

Do NOT ask "should I proceed to Phase N?" between phases. Execute each phase and immediately begin the next.

---

## Phase 1: Verify

Locate and validate the conference output directory.

**1a. Locate the conference directory.**

Try in order:
1. Check if the user specified a path in their request.
2. Auto-detect: search the current working directory and subdirectories for a `conference.md` file using `Glob`.
3. If multiple candidates are found, list them and ask the user to choose.
4. If no candidate is found, ask the user: "Where is your conference directory?"

**1b. Check required files.**

The following files are required for shipping. For each, check existence using `Glob` or `Bash`:

| File | Required? | Purpose |
|---|---|---|
| `conference.md` | Required | Original conference specification |
| `conference_results.tsv` | Required | Quantitative results per round |
| `synthesis.md` | Required | Cross-researcher synthesis |
| `final_report.md` | Required | Final conference report |
| `analysis-report.md` | Optional | Output from `:analyze` subskill |
| `conference_progress.png` | Optional | Progress visualization |
| `conference_events.jsonl` | Optional | Structured event log |

**1c. Check conference completion.**

If `conference_events.jsonl` exists, scan it for a `conference.completed` event:
```bash
grep '"event":"conference.completed"' conference_events.jsonl
```
If the event is present: proceed normally.
If absent but `final_report.md` exists: issue a warning — "Warning: No completion event found. Conference may not have finished. Proceeding with available files."
If `final_report.md` is missing: halt and tell the user: "Cannot ship — `final_report.md` is missing. Run the conference to completion first, or run `autoconference:resume` to finish an interrupted conference."

**1d. If `analysis-report.md` exists**, read it now and note its key insights. These will be incorporated into the output in Phase 5.

**1e. Print verification summary:**
```
=== PHASE 1: VERIFY ===
Conference directory: {path}
Required files: {found_count}/{required_count} present
Optional files: {optional_found}
Completion event: FOUND / NOT FOUND (warning issued)
Analysis report: PRESENT / ABSENT
Proceeding to Phase 2.
```

---

## Phase 2: Format Selection

Ask the user exactly once for their desired output format. Do not proceed until you have this answer.

Present the following options:

**A. Research report** (default)
Full formal report with methodology, results, and discussion sections. Structured like a technical paper but without the full formality of a journal submission. Appropriate for sharing with research teams, posting as a preprint, or as a basis for a formal paper.

**B. Blog post**
Accessible narrative format for a wider audience. Minimal jargon, strong narrative arc, lead with the most surprising or useful finding. Length: 800–1500 words. Appropriate for sharing on technical blogs, newsletters, or social media.

**C. Paper sections**
Methods + Results sections formatted to paste directly into a paper manuscript. Follows standard academic structure. Appropriate when the user already has a paper draft and needs these sections filled in.

**D. Executive summary**
1–2 page summary for stakeholders or collaborators who need the bottom line without details. Lead with recommendation, follow with supporting evidence. Appropriate for project sponsors, managers, or non-technical audiences.

If the user does not specify a preference, default to **A (Research report)** and note this in the output.

Record the chosen format and proceed immediately to Phase 3.

---

## Phase 3: Evidence Collection

Read all relevant files from the conference directory and extract the evidence base for the chosen format.

**3a. Quantitative results** — read `conference_results.tsv` in full. Extract:
- All numeric metrics tracked across rounds
- Best result achieved (peak value, at which round, by which researcher)
- Final result at conference end
- Improvement trajectory (how much did the metric improve from Round 1 to final?)
- Whether the target metric was met (check `conference.md` for the target)

**3b. Key findings** — read `synthesis.md` in full. Extract:
- The top 3–5 insights identified by the synthesis
- Any convergence observations (did researchers agree or diverge?)
- The winning approach(es) and why they succeeded

**3c. Reviewer verdicts** — if `final_report.md` contains reviewer scores or verdicts, extract:
- Each researcher's final score or ranking
- The specific reasons given for high/low scores
- Any minority opinions or dissenting views

**3d. Conference configuration** — read `conference.md` to extract:
- The research question / metric being optimized
- Number of researchers, rounds run, max rounds
- Whether convergence was achieved or budget exhausted

**3e. Convergence data** — from `conference_results.tsv` and `final_report.md`:
- How many rounds were run?
- Was the target met? At which round?
- What was the convergence pattern? (rapid early, gradual, plateau?)

**3f. Visualizations** — note which visual files exist (`conference_progress.png`, any per-example plots). These will be referenced in the output.

**3g. Analysis insights** — if `analysis-report.md` was found in Phase 1, re-read its key findings section now and incorporate them into the evidence base.

**3h. Print collection summary:**
```
=== PHASE 3: EVIDENCE COLLECTION ===
Metric tracked: {metric_name}
Best result: {value} (Round {N}, Researcher {ID})
Final result: {value}
Improvement: {delta} ({pct}%)
Target met: YES / NO
Key findings extracted: {count}
Visualizations available: {list}
```

---

## Phase 4: Citation Verification

If the conference involved web searches, paper references, or external claims, verify them now.

**4a. URL verification** — scan all required files for URLs using:
```bash
grep -oE 'https?://[^)> "]+' synthesis.md final_report.md
```
For each URL found:
- Use `WebFetch` to attempt access
- If accessible: mark as verified
- If inaccessible (404, timeout): mark as `[LINK BROKEN]` — do not remove, just flag

**4b. Citation formatting** — for any academic papers referenced by title or partial citation:
- Check that author, year, and title are present
- If a DOI or arXiv ID is present, verify it resolves
- If a paper is referenced only by title with no other metadata: mark as `[citation incomplete]`

**4c. Unsupported claims** — scan `synthesis.md` and `final_report.md` for qualitative claims that are not backed by data in `conference_results.tsv`. Examples:
- "Researcher A's approach was significantly better" — is this supported by a numeric comparison?
- "The method generalizes well" — is there evidence for this in the results?

For each unsupported claim found, add a `[citation needed]` marker inline in your working draft. Do not delete the claim — just flag it.

**4d. Print verification summary:**
```
=== PHASE 4: CITATION VERIFICATION ===
URLs checked: {count} ({verified} verified, {broken} broken)
Incomplete citations: {count}
Unsupported claims flagged: {count}
```

If no URLs or citations were found, print: "No external references to verify. Skipping URL checks."

---

## Phase 5: Abstract Draft

Write the abstract or executive summary that opens the output document.

The abstract must cover these four elements regardless of format:

1. **Problem statement** — What question or metric was the conference trying to address? Why does it matter?

2. **Method description** — Describe the multi-agent conference approach in 2–3 sentences. Name the number of researchers, the round structure, and the key mechanisms (poster sessions, peer review, cross-pollination).

3. **Key results** — Present the most important quantitative findings with actual numbers from the evidence collected in Phase 3. Do not use vague language like "improved significantly." Use: "improved from X to Y (Z% gain over N rounds)."

4. **Conclusion** — What is the takeaway? What should the reader do with this result?

Adjust tone and length based on the chosen format:
- Research report: formal, ~200 words, past tense
- Blog post: conversational, ~100 words, present tense, start with a hook
- Paper sections: formal, ~150 words, follows standard abstract structure
- Executive summary: direct, ~80 words, lead with the recommendation

Write the abstract to a scratch variable — it will be incorporated into the full draft in Phase 6.

---

## Phase 6: Peer Review Request

Spawn a Reviewer agent to evaluate the assembled draft before presenting it to the user.

**Give the Reviewer:**
- The full evidence base (all extracted results from Phase 3)
- The abstract draft from Phase 5
- The chosen output format
- The citation flags from Phase 4

**The Reviewer checks:**

1. **Logical consistency** — Do the claims in the abstract match the data in `conference_results.tsv`? Are there contradictions between what the synthesis says and what the results show?

2. **Claim support** — Are all quantitative claims backed by numbers? Are there any places where the draft says "best" or "superior" without a comparison value?

3. **Format compliance** — Does the draft match the requirements of the chosen format? (e.g., is a research report properly structured? Is a blog post accessible enough?)

4. **Completeness** — Are any important findings from `synthesis.md` missing from the draft? Are the reviewer verdicts properly represented?

5. **Citation flag handling** — Are broken links and unsupported claims flagged clearly?

**The Reviewer produces** a `peer-review-ship.md` with:
- A list of specific issues found (with locations: "In abstract, paragraph 2...")
- A list of suggested improvements
- An overall readiness assessment: READY / NEEDS REVISION

---

## Phase 7: CONFIRM

**This is the ONLY pause point in the pipeline.**

Present to the user:
1. The complete draft output (all sections formatted for the chosen format)
2. The reviewer's feedback from Phase 6 (summarized, with the full `peer-review-ship.md` path noted)
3. The citation flags summary from Phase 4

Ask the user:

> "Draft complete. Reviewer assessment: [READY / NEEDS REVISION].
>
> Reviewer flagged {N} issues: [brief list of top issues]
>
> Ready to finalize and write the output files? Or would you like changes?
> - Type **yes** / **ship it** / **looks good** to finalize
> - Describe any changes you want and I'll revise"

**If the user approves:** proceed immediately to Phase 8.

**If the user requests changes:**
1. Apply all requested changes to the draft
2. Re-run Phase 6 (spawn Reviewer again on the revised draft)
3. Return to Phase 7 with the updated draft and new reviewer feedback
4. Repeat until the user approves

Do not finalize without explicit user approval.

---

## Phase 8: Publish

Write the final output files.

**8a. Write `ship-log.md`**

This is the master log of the shipping run. Write it to the conference directory with:

```markdown
# Ship Log

**Conference:** {path to conference.md}
**Shipped:** {date}
**Format:** {chosen format name}
**Reviewer assessment:** READY / NEEDS REVISION (resolved after N revision cycles)

## Citation Issues
{list of broken links and unsupported claim flags, or "None"}

## Peer Review Summary
{brief summary of reviewer feedback and how issues were addressed}

## Output Files
- {format-specific output file path}
```

**8b. Write the format-specific output file**

| Format | Filename | Structure |
|---|---|---|
| Research report | `report.md` | Abstract, Introduction, Methods, Results, Discussion, Conclusion |
| Blog post | `blog-post.md` | Hook, Background, Findings (narrative), Takeaways, Call to action |
| Paper sections | `paper-sections.md` | Methods section, Results section (paste-ready) |
| Executive summary | `executive-summary.md` | Recommendation, Key results, Method overview, Next steps |

Write the complete, finalized content to this file. The content must be self-contained — a reader with no other context should be able to read it and understand the conference findings.

**Research report structure** (if chosen):

```
# {Conference topic / research question}

## Abstract
{abstract from Phase 5, finalized}

## 1. Introduction
- Background and motivation
- Research question
- Why multi-agent conference approach was used

## 2. Methods
- Conference configuration (N researchers, N rounds, target metric)
- Partitioning strategy (how researchers were differentiated)
- Poster session and knowledge transfer mechanism
- Peer review process

## 3. Results
- Convergence curve (reference conference_progress.png if available)
- Metric progression by round (table or narrative)
- Best result achieved and by whom
- Key breakthroughs — what insights drove the biggest improvements?

## 4. Discussion
- What worked and why
- What failed or stalled and why
- Comparison to baseline (if any baseline was established)
- Limitations of the approach

## 5. Conclusion
- Answer to the research question
- Practical recommendation
- Suggested next steps

## References
{all verified citations}
```

**8c. Print completion message:**

```
=== PHASE 8: PUBLISHED ===
ship-log.md written to: {path}
Output file written to: {path}
Format: {format name}

Shipped.
```

---

## Output Files Summary

After a complete run, the following files are written to the conference directory:

| File | Contents |
|---|---|
| `ship-log.md` | Pipeline run log, citation issues, reviewer summary |
| `report.md` | Full research report (if research report format) |
| `blog-post.md` | Blog post (if blog post format) |
| `paper-sections.md` | Methods + Results sections (if paper sections format) |
| `executive-summary.md` | Executive summary (if executive summary format) |
| `peer-review-ship.md` | Reviewer's detailed feedback |

---

## Chaining

This skill is the final stage in the autoconference pipeline:

- **`autoconference` → `ship`**: Ship raw conference results directly as a report, blog post, or paper sections.
- **`autoconference` → `autoconference:analyze` → `ship`**: Run analysis first for deeper statistical breakdowns, then ship. The `analysis-report.md` output is automatically incorporated in Phase 1 and Phase 3.
- **`autoconference:survey` → `autoconference` → `ship`**: Full pipeline from literature survey through experimental conference to publication.

When chaining from `autoconference:analyze`, the ship skill automatically detects and incorporates `analysis-report.md` without requiring the user to specify it.
