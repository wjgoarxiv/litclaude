---
name: autoconference-skill
description: |
  Multi-agent research conference that spawns parallel autoresearchers with
  symposium sharing, adversarial peer review, and insight synthesis.
  Reads a conference.md, orchestrates N researchers in structured rounds,
  and produces a synthesized result combining the best findings.
  TRIGGER when: user mentions "autoconference" or "conference" with research context;
  user wants multiple researchers competing or collaborating; user wants parallel
  autoresearch with peer review; user mentions "conference.md"; user wants
  research synthesis from multiple approaches; user wants adversarial evaluation
  of research results.
  DO NOT TRIGGER when: user wants a single autoresearch loop (use autoresearch-skill);
  user wants a simple one-shot answer; user wants to read a single paper.
allowed-tools:
  - Agent
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebFetch
  - WebSearch
---

# Autoconference — Multi-Agent Research Conference

*Spawn a conference of autonomous researchers that compete, collaborate, and synthesize breakthroughs.*

## Mandatory Start Gate

Before dispatching `/autoconference`, require a pre-flight confirmation gate:

1. If the user has exactly specified researcher count, iterations/budget, Success Metric or Success Criteria, and Critic/Devil's Advocate inclusion, calculate the run conditions and ask for final confirmation.
2. If any of those values are missing or vague, ask the user for exact values first; then calculate conditions and ask for final confirmation.
3. Do not begin the conference loop until the user explicitly confirms the calculated conditions.

The adversarial Reviewer is part of the protocol every round; the gate's Critic/Devil's Advocate choice controls whether an additional researcher is assigned a contrarian role.

## Conference Persistence Directive

**The Conference Chair is relentless.** Once the conference begins:

1. **NEVER STOP** a round prematurely. Each round runs all 4 phases to completion.
2. **NEVER ASK** "should I continue to the next round?" Advance automatically.
3. **Use the full budget.** If `max_rounds` is 5, run 5 rounds. Stopping at round 2 wastes 60% of the exploration budget.
4. **The conference runs until one of these conditions is met:**
   - Target metric achieved (convergence)
   - `max_rounds` or `max_total_iterations` exhausted (budget spent — this is normal, not failure)
   - All researchers simultaneously stalled at Level 2+ (early synthesis)
   - The user manually interrupts
5. **If none of these conditions are true, begin the next round immediately.**

Think of `max_rounds` as a budget to *spend*, not a limit to *fear*.

## Commands

| Command | Description | Skill Path |
|---------|-------------|------------|
| `/autoconference` | Core conference loop — N researchers, 4-phase rounds, synthesis | `skills/autoconference/SKILL.md` |
| `/autoconference:plan` | 8-step setup wizard — produces conference.md | `skills/plan/SKILL.md` |
| `/autoconference:resume` | Resume interrupted conference from checkpoint | `skills/resume/SKILL.md` |
| `/autoconference:analyze` | Post-conference insight analysis | `skills/analyze/SKILL.md` |
| `/autoconference:debate` | Adversarial 2-researcher debate mode | `skills/debate/SKILL.md` |
| `/autoconference:survey` | Systematic multi-database literature survey | `skills/survey/SKILL.md` |
| `/autoconference:ship` | Convert conference results to paper-ready output | `skills/ship/SKILL.md` |

## Dispatch Logic

- **No subcommand** (`/autoconference`) → load `skills/autoconference/SKILL.md`
- **With subcommand** (`/autoconference:<name>`) → load `skills/<name>/SKILL.md`
- If the target skill file does not exist yet, inform the user and fall back to the core conference protocol.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    CONFERENCE ROUND                       │
│                                                           │
│  Phase 1: INDEPENDENT RESEARCH (parallel)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │Researcher│ │Researcher│ │Researcher│  Each runs N     │
│  │    A     │ │    B     │ │    C     │  autoresearch    │
│  │ (iter×N) │ │ (iter×N) │ │ (iter×N) │  iterations     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                 │
│       │             │            │                        │
│  Phase 2: POSTER SESSION (Haiku summarizer)              │
│  Phase 3: PEER REVIEW (Opus adversarial critic)          │
│  Phase 4: KNOWLEDGE TRANSFER (validated → shared)        │
└─────────────────────────────────────────────────────────┘
          │
          ▼  Convergence check → next round or final synthesis
```

## Agent Roles

| Role | Model | Count | Responsibility |
|------|-------|-------|----------------|
| **Conference Chair** | Sonnet | 1 | Orchestrator — follows the protocol end-to-end |
| **Researcher** | Sonnet | N | Runs autoresearch 5-stage loop within assigned partition |
| **Session Chair** | Haiku | 1/round | Lightweight summarizer — poster session from logs |
| **Reviewer** | Opus | 1/round | Adversarial critic — challenges claims, assigns verdicts |
| **Synthesizer** | Opus | 1 | Combines validated findings into unified synthesis |

## Dependencies

- **Required:** Any LLM CLI with subagent support (Claude Code, Codex CLI, OpenCode, Gemini CLI)
- **Extends:** `autoresearch-skill` — each Researcher runs the autoresearch 5-stage loop
- **Optional:** `/worktree-dashboard`, `/compare-worktrees`
- **Python 3.8+** required only for `scripts/init_conference.py` (scaffolding helper)

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `autoresearch-skill` | Parent. Single-agent? Use autoresearch. Multi-agent with review? Use autoconference. |
| `worktree-dashboard` | Complementary. Monitor researcher worktrees in real-time. |
| `compare-worktrees` | Complementary. Cross-worktree analysis for the Reviewer. |

## Backward Compatibility

For manual install without the plugin system, this file works standalone — it dispatches to the `skills/` directory. If `skills/` is missing, the full protocol previously lived in this file. See `skills/autoconference/SKILL.md` for the complete conference orchestration protocol.
