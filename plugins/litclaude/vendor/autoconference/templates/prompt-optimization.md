# Conference: Prompt Optimization

> **Template: Prompt Optimization** — Optimize LLM prompts for accuracy and quality using parallel researchers with assigned search space partitions.

## Goal
Maximize accuracy of the target LLM prompt on a defined test set. Each researcher explores different aspects of the prompt to discover what drives performance.

## Mode
metric

## Success Metric
- **Metric:** accuracy_on_test_cases
- **Target:** > 0.90
- **Direction:** maximize

## Researchers
- **Count:** 3
- **Iterations per round:** 5
- **Max rounds:** 4

## Search Space
- **Allowed changes:** system prompt text, few-shot examples, output format instructions, persona, reasoning instructions
- **Forbidden changes:** test cases, model choice, temperature (unless you are Researcher C), evaluation script

## Search Space Partitioning
- **Strategy:** assigned

### Researcher A Focus
Structural changes: few-shot example selection and ordering, chain-of-thought formatting, output format specification, instruction sequencing.

### Researcher B Focus
Content changes: phrasing and wording of instructions, persona definition, example quality and diversity, clarity of task description.

### Researcher C Focus
Meta-optimization: temperature and sampling parameters, prompt length trade-offs, system vs. user message split, prompt compression without accuracy loss.

## Constraints
- **Max total iterations:** 45
- **Time budget:** 1h
- **Researcher timeout:** 20m

## Current Approach
{Describe the current prompt. What does it do? What accuracy does it achieve? Paste the baseline prompt here or reference the file path.}

## Shared Knowledge
<!-- Auto-populated after each round with validated findings -->

## Context & References
- Test set location: {path to test cases}
- Evaluation script: {path to eval script}
- Current baseline accuracy: {value}

---

## Conference Log
<!-- Auto-maintained by Conference Chair. Do not edit manually. -->
| Round | Researcher | Best Metric | Key Finding | Status |
|-------|-----------|-------------|-------------|--------|
