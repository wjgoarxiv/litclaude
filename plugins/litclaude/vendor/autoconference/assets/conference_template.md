# Conference: {Title}

## Goal
{Describe what the conference should achieve. Be specific and measurable.}

## Mode
{metric | qualitative}

## Success Metric
- **Metric:** {e.g., "accuracy on test set", "p95 latency", "LLM judge score 1-10"}
- **Target:** {e.g., "> 95%", "< 50ms", "> 8/10"}
- **Direction:** {maximize | minimize}

## Success Criteria
{For qualitative mode: natural language description of what "good" looks like.}
{For metric mode: leave blank or delete this section.}

## Researchers
- **Count:** 3
- **Iterations per round:** 5
- **Max rounds:** 4

## Pre-Flight Gate
- **Researcher count:** 3
- **Iterations per round:** 5
- **Max rounds:** 4
- **Max total iterations:** 60
- **Success definition:** {metric + target + direction, or qualitative criteria}
- **Critic / Devil's Advocate:** {enabled | disabled | ask user before run}
- **Final confirmation:** pending — Conference Chair must summarize these conditions and get explicit user confirmation before execution.
- **Missing or vague values:** ask the user for exact values first, then recalculate this gate and request final confirmation. Do not start Phase 1 until confirmation is explicit.

## Search Space
- **Allowed changes:** {What researchers CAN modify}
- **Forbidden changes:** {What researchers CANNOT modify — e.g., test data, eval scripts}

## Search Space Partitioning
- **Strategy:** {assigned | free}

### Researcher A Focus
{For assigned strategy: describe this researcher's exploration area}

### Researcher B Focus
{For assigned strategy: describe this researcher's exploration area}

### Researcher C Focus
{For assigned strategy: describe this researcher's exploration area}

## Guard
{Optional safety constraint applied to ALL researchers. If any researcher violates this, their changes are reverted regardless of metric improvement. Examples: "Do not modify the test set", "SKILL.md must stay under 300 lines", "No external API calls". Leave blank to disable.}

## Noise Handling
- **Noise runs:** {Number of repeated evaluations to average for noise reduction. Default: 1 (no noise handling). Set 3-5 for noisy metrics.}
- **Min consensus delta:** {Minimum average improvement across kept researchers required to advance to next round. Default: 0 (any improvement counts). Set > 0 for noisy multi-researcher contexts.}

## Constraints
- **Max total iterations:** 60
- **Time budget:** 2h
- **Token budget:** {optional — omit or set a cap}
- **Researcher timeout:** 30m

## Current Approach
{Describe the baseline. What exists now?}

## Shared Knowledge
<!-- Auto-populated after each round with validated findings -->

## Context & References
{Background material — papers, docs, URLs, code files}

---

## Conference Log
<!-- Auto-maintained by Conference Chair. Do not edit manually. -->
| Round | Researcher | Best Metric | Key Finding | Status |
|-------|-----------|-------------|-------------|--------|
