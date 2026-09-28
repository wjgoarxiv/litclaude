---
name: autoconference:plan
description: |
  8-step interactive wizard that produces a fully configured conference.md file.
  TRIGGER when: user wants to set up a new conference, plan a conference, create conference.md.
  DO NOT TRIGGER when: user wants to run an existing conference (use autoconference).
allowed-tools:
  - Agent
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# Autoconference Plan — 8-Step Setup Wizard

*An interactive wizard that produces a fully configured `conference.md` file. This skill does NOT run a conference — it only produces the configuration file.*

## Purpose

The `plan` wizard exists because launching a conference with a bad config wastes hours of compute. Each step probes the user's intent, validates feasibility, and encodes their decisions into a `conference.md` ready for `/autoconference` to execute.

**Output:** A single, fully populated `conference.md` file.
**Does NOT:** Run researchers, spawn agents, or begin any research.

---

## Wizard Protocol

Walk the user through all 8 steps in order. Do not skip steps. Do not assume answers — present options and wait for explicit confirmation.

After all 8 steps, write the file and print next steps.

---

## Step 1: Goal Clarification

**Objective:** Arrive at a specific, measurable goal.

Ask the user:
> "What do you want to achieve with this conference? Describe it in one or two sentences."

After the user answers, probe for specificity:
- "What would success look like at the end? Describe the ideal output."
- "How will you know the conference worked?"
- "What is the concrete deliverable — a number, a document, a piece of code, an insight?"

**Push back on vague goals.** If the user says something like "I want to improve my model" or "I want better results", stop and ask:
> "That's a direction, but not yet a goal. Can you be more specific? For example: 'Improve model accuracy on the CIFAR-10 test set from 85% to above 90%' or 'Generate a synthesis document comparing retrieval strategies for long-context summarization.'"

Do NOT proceed to Step 2 until the goal is specific enough that a researcher agent could know what to work on.

**Record:** `goal` — the final agreed goal statement.

---

## Step 2: Mode Selection

**Objective:** Choose `metric` or `qualitative` mode.

Explain the two modes clearly:

> **Metric mode** — there is a numeric score that directly measures success. Researchers are evaluated by whether the number goes up (or down). Examples: accuracy, latency, F1 score, BLEU, loss, LLM judge score 1-10.

> **Qualitative mode** — success is about the quality of reasoning, writing, or synthesis. There is no single number — the Reviewer (Opus) judges whether outputs satisfy the stated criteria. Examples: literature review synthesis, hypothesis generation, design exploration, writing quality improvement.

Help the user decide with this decision rule:
> "Can you measure success with a number that is reliably produced each iteration? → **metric**. Is success about the quality of reasoning, writing, or ideas — where 'good' requires a human (or LLM judge) to assess? → **qualitative**."

Warn about metric mode requirements:
> "Metric mode requires an evaluator script that can be run automatically. If you don't have a script that produces a number, start with qualitative mode — you can always switch."

**Record:** `mode` — `metric` or `qualitative`.

---

## Step 3: Metric + Evaluator Design

**Objective:** Define how success is measured and verify the evaluator works.

### For metric mode:

Ask:
1. "What is the metric name?" (e.g., "accuracy on test set", "p95 latency in ms", "LLM judge score 1-10")
2. "What is the target value?" (e.g., "> 95%", "< 50ms", "> 8.0")
3. "Is the direction maximize or minimize?"
4. "What is the baseline value right now — before any conference work?"
5. "What command or script produces the metric? I'll run it now to verify."

**DRY-RUN GATE:** Before proceeding, run the evaluator command on the baseline to verify it works.

```
[Running evaluator dry-run: {user's command}]
```

- If it runs and produces the expected numeric output → proceed.
- If it fails, errors, or produces unexpected output → STOP. Work with the user to fix the evaluator before continuing. Do NOT write a conference.md with a broken evaluator — this would cause the entire conference to fail at iteration 1.
- If it produces a number but the user is surprised by the baseline value → flag this: "Your baseline is X, but you expected Y. Do you want to investigate this before running a conference?"

The dry-run gate is non-negotiable. A conference with an unverified evaluator is a conference that will fail.

### For qualitative mode:

Ask:
> "Describe what 'good' looks like for this conference. The Reviewer (Opus) will use this as their rubric. Be specific — vague criteria produce vague judgments."

Prompt for specificity if needed:
- "What makes a result clearly better than the baseline?"
- "What are the top 2-3 criteria the Reviewer should weight most heavily?"
- "Are there any disqualifying failure modes — outputs that should be marked 'overturned' regardless of surface quality?"

**Record:**
- Metric mode: `metric_name`, `metric_target`, `metric_direction`, `baseline_value`, `evaluator_command`
- Qualitative mode: `success_criteria` (multi-line description)

---

## Step 4: Researcher Count + Role Assignment

**Objective:** Decide how many researchers and whether a Devil's Advocate is needed.

Ask: "How many researchers should participate in this conference?"

Present options:
- **2 researchers** — Minimal. Good for A/B comparison of exactly two approaches. Use when you have two specific strategies you want to compare directly.
- **3 researchers** (recommended) — Balanced. Enough diversity for cross-pollination without excessive overhead. Suitable for most problems.
- **4–5 researchers** — Large-scale. For broad search spaces with many distinct strategies. Expect longer wall-clock time and higher token cost.

If the user already specified `count` in a partial conference.md, confirm it: "You mentioned N researchers earlier. Proceed with this?"

Next, ask about the Devil's Advocate:
> "Should one of the N researchers be a Devil's Advocate — deliberately pursuing contrarian strategies?"

Explain:
> "A Devil's Advocate is assigned to challenge the mainstream approach. They try the opposite of what seems obvious, test assumptions others take for granted, and explore strategies the other researchers would dismiss. This catches blind spots and occasionally discovers breakthroughs. If you have 3 researchers and add a Devil's Advocate, one of the 3 fills that role (no additional agent)."

**Record:** `count`, `devil_advocate` (yes/no), and if yes, which researcher slot (typically the last one, e.g., Researcher C for count=3).

---

## Step 5: Search Space Partitioning

**Objective:** Decide how researchers divide the search space.

Ask: "How should researchers divide the search space?"

Present options:
- **Assigned** (recommended) — Each researcher gets a specific focus area. Less overlap, more coverage. Researchers are assigned to distinct regions of the search space and should not duplicate each other's work.
- **Free** — All researchers explore the full space. More competition, potential redundancy. Useful when you're unsure how to partition, or when the search space is small enough that overlap is acceptable.

If `assigned`:
For each researcher slot (A, B, C, ...), ask:
> "What should Researcher {X} focus on? Describe their specific area of exploration."

Example prompts to help the user think:
- "If this is about ML training: Researcher A → architecture changes, Researcher B → data augmentation, Researcher C → optimization hyperparameters"
- "If this is about writing quality: Researcher A → structure and flow, Researcher B → evidence and citations, Researcher C → tone and clarity"
- "If Devil's Advocate is enabled: Researcher C's focus is the contrarian role — they challenge the assumptions of A and B"

If `free`: no per-researcher focus needed. All researchers receive the full search space description.

Also ask (for both modes):
- "What are researchers ALLOWED to change? (e.g., 'any code in src/models/, any training hyperparameter')"
- "What are researchers FORBIDDEN from changing? (e.g., 'test data, eval scripts, the model architecture')"

**Record:** `partitioning_strategy`, per-researcher focus areas (if assigned), `allowed_changes`, `forbidden_changes`.

---

## Step 6: Devil's Advocate Configuration

**Objective:** Configure the contrarian researcher's behavior (only if enabled in Step 4).

If Devil's Advocate was NOT enabled in Step 4, skip this step entirely.

If Devil's Advocate was enabled, configure their focus:

> "The Devil's Advocate (Researcher {X}) will deliberately challenge the mainstream approach. Let's define their contrarian mandate."

Ask:
1. "What assumptions does the mainstream approach make that should be challenged? (e.g., 'that larger batch size is better', 'that more context always helps', 'that the current prompt structure is optimal')"
2. "Are there specific 'anti-strategies' the Devil's Advocate should pursue? (e.g., 'try the smallest possible model', 'try removing the retrieval step entirely', 'try the simplest possible baseline')"
3. "Should the Devil's Advocate be allowed to propose changes that break the current evaluation metric (to stress-test the metric itself)?" → yes/no

Explain the Devil's Advocate role one more time to confirm the user understands:
> "The Devil's Advocate is not trying to win — they're trying to surface what everyone else is missing. Their best contribution is a finding that invalidates a shared assumption, even if their own metric score is low."

**Record:** `devil_advocate_mandate` — the contrarian researcher's specific instructions.

---

## Step 7: Execution Preference

**Objective:** Configure how the conference will run.

Ask: "Do you want this conference to run overnight / unattended, or interactively with pauses for your review?"

### If overnight / unattended:

Recommend:
> "For overnight execution, use the autoconference loop script:
> `bash scripts/autoconference-loop.sh ./your-conference-dir/`
>
> This script handles foreground, nohup, and tmux execution modes. I'll set `pause_every: never` in your conference.md so the Conference Chair advances automatically.
>
> To check progress while it runs: `bash scripts/check_conference.sh ./your-conference-dir/`"

Ask:
- "What is your time budget? (e.g., '8h', '2h', '30m')"
- "What is the maximum number of rounds? (default: 4)"
- "What is the maximum total iterations across all researchers? (default: 60)"
- "What is the per-researcher timeout per round? (default: 30m)"

### If interactive:

Ask:
- "How often should I pause for your review?"
  - After every round (recommended for first run)
  - Every N rounds (ask for N)
  - Only on PIVOT events (when a researcher makes a radical strategy change)
  - Never — run to completion

Ask the same budget questions:
- "Time budget?"
- "Max rounds?"
- "Max total iterations?"
- "Per-researcher timeout?"

**Record:** `pause_every` (never / every_round / every_N_rounds / pivot_only), `time_budget`, `max_rounds`, `max_total_iterations`, `researcher_timeout`.

---

## Step 8: conference.md Generation

**Objective:** Write the fully populated `conference.md` file.

First, ask: "Where should I write the conference.md file?"
- Default: `./conference/conference.md`
- If the directory does not exist, offer to create it.

Then scaffold the file using `../../assets/conference_template.md` as the structural base. Fill in every field from Steps 1–7. Leave NO placeholders — every `{...}` in the template must be replaced with a real value.

### Field mapping:

| Template field | Source |
|---------------|--------|
| `{Title}` | Derive from goal (e.g., "Optimize CIFAR-10 Accuracy") |
| `Goal` | Step 1: goal statement |
| `Mode` | Step 2: metric / qualitative |
| `Success Metric` | Step 3 (metric mode only) |
| `Success Criteria` | Step 3 (qualitative mode only) |
| `Count` | Step 4 |
| `Iterations per round` | Step 7: default 5, or ask if not set |
| `Max rounds` | Step 7 |
| `Allowed changes` | Step 5 |
| `Forbidden changes` | Step 5 |
| `Search Space Partitioning → Strategy` | Step 5 |
| `Researcher A/B/C Focus` | Step 5 (if assigned) |
| `Max total iterations` | Step 7 |
| `Time budget` | Step 7 |
| `Researcher timeout` | Step 7 |
| `pause_every` | Step 7 |
| `Current Approach` | Step 1: baseline description |
| `Shared Knowledge` | Leave blank (auto-populated at runtime) |

If Devil's Advocate is enabled, add a comment in the Researcher A/B/C Focus section indicating which researcher is the Devil's Advocate and their mandate from Step 6.

Write the file. Then confirm to the user:

```
conference.md written to: {path}

Next steps:
1. Review the file: cat {path}
2. Run the conference: /autoconference (with {path} open or referenced)
   OR for overnight: bash scripts/autoconference-loop.sh {directory}/
3. Monitor progress: bash scripts/check_conference.sh {directory}/
   OR tail -f {directory}/conference_events.jsonl

Skill chain: plan → autoconference → ship
```

---

## Wizard Invariants

- Never write `conference.md` before all 8 steps are complete.
- Never skip the DRY-RUN GATE in Step 3 for metric mode.
- Never proceed past Step 1 without a specific, measurable goal.
- Never add features the user didn't ask for (no extra researchers, no extra rounds).
- The wizard produces exactly one file: `conference.md`.
- The wizard does NOT start a conference, spawn researchers, or run any research.
