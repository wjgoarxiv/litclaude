---
name: autoconference:debate
description: |
  Adversarial 2-researcher debate mode. One researcher argues Position A (pro),
  the other argues Position B (con). Structured rounds with an Opus judge.
  TRIGGER when: user wants a debate, adversarial evaluation, pro/con analysis,
  wants to test opposing viewpoints.
  DO NOT TRIGGER when: user wants collaborative multi-researcher conference (use autoconference).
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

# autoconference:debate — Adversarial 2-Researcher Debate

Run a structured adversarial debate between two autonomous researchers, judged by an Opus-level moderator. Produces a full transcript, per-round scores, and a final verdict.

**Chaining position:** `debate → autoconference (informed by debate outcome)`

---

## Pre-Debate Setup (Mandatory — Do Not Skip)

Complete all setup steps before starting Round 1. Do not assume defaults — present each question and wait for the user's answer.

### Setup Question 1: Debate Topic

Ask: "What is the debate topic or question? Please state it as clearly and specifically as possible."

Accept free-form input. Once received, restate the topic in a single crisp sentence and confirm: "I'll frame the debate as: '[restated topic]'. Is this accurate?"

If the user corrects the framing, update and re-confirm before continuing.

### Setup Question 2: Position Assignment

Ask: "Should I assign the two positions, or do you have specific positions in mind?"

**If user wants auto-assignment:** Derive Position A (affirmative/pro) and Position B (negative/con) from the topic. For empirical or technical topics, Position A argues the claim is true/effective, Position B argues it is false/ineffective. For design or strategy topics, Position A argues for the stated approach, Position B argues for the alternative. Present both positions to the user for confirmation before proceeding.

**If user specifies positions:** Accept them verbatim. Assign Researcher A → Position A (pro/affirmative) and Researcher B → Position B (con/negative). Confirm the assignment explicitly: "Researcher A will argue: [Position A]. Researcher B will argue: [Position B]. Correct?"

Do not proceed until the user confirms position assignment.

### Setup Question 3: Number of Rounds

Ask: "How many debate rounds? (Default: 3)"

Valid range: 1–6. If the user requests more than 6, explain that longer debates tend to produce diminishing returns and suggest 4–5 as a cap. If the user insists, accept up to 8.

Store as `N_ROUNDS`.

### Setup Question 4: Judge Strictness

Ask: "How strict should the judge be?"

Present options:
- **Lenient** — The judge prioritizes argument quality, logical structure, and persuasive clarity. Claims without citations are acceptable if the reasoning is sound. Good for philosophical, strategic, or conceptual debates.
- **Strict** — The judge demands evidence for every empirical claim. Unsupported assertions are penalized. Claims that contradict known facts are immediately flagged. Good for technical, scientific, or empirical debates.

Store as `JUDGE_MODE` (either `lenient` or `strict`).

### Setup Question 5: Output Directory

Ask: "Where should I save the debate report?" (Default: current working directory as `debate-report.md`)

If the user specifies a directory, confirm it exists or create it.

### Setup Summary

Before starting, display a summary block:

```
DEBATE SETUP CONFIRMED
======================
Topic: [topic]
Researcher A (Pro): [Position A]
Researcher B (Con): [Position B]
Rounds: [N_ROUNDS]
Judge Strictness: [JUDGE_MODE]
Output: [output path]

Starting debate in 3... 2... 1...
```

---

## Researcher Agent Instructions

Both researchers are autonomous agents. They do not share reasoning — each reasons independently based only on what has been said in the debate transcript so far. The orchestrator (you) runs each researcher in sequence per phase, feeding them the relevant transcript context.

**Researcher A system prompt:**
> You are Researcher A in a structured academic debate. Your position is: "[Position A]". You must argue this position convincingly throughout the debate. You may acknowledge nuance, but you must never concede the core of your position unless the judge explicitly declares consensus. Cite evidence where possible. When challenging your opponent, identify the single weakest claim in their argument and attack it precisely — do not make vague disagreements. When rebutting, address every specific point raised against you.

**Researcher B system prompt:**
> You are Researcher B in a structured academic debate. Your position is: "[Position B]". You must argue this position convincingly throughout the debate. You may acknowledge nuance, but you must never concede the core of your position unless the judge explicitly declares consensus. Cite evidence where possible. When challenging your opponent, identify the single weakest claim in their argument and attack it precisely — do not make vague disagreements. When rebutting, address every specific point raised against you.

**Judge system prompt:**
> You are an impartial debate judge evaluating a structured academic debate. Topic: "[topic]". Judge mode: [JUDGE_MODE]. Your role is to score each researcher's performance per round, identify the strongest and weakest arguments from each side, declare a round winner (or tie), and give specific improvement feedback. You do NOT take sides — you evaluate quality of argumentation. If both researchers start converging or agreeing, you must intervene forcefully to maintain the adversarial structure. Be direct and demanding.

---

## Round Structure

Repeat the following structure for rounds 1 through N_ROUNDS.

At the start of each round, display: `--- ROUND [N] OF [N_ROUNDS] ---`

### Phase 1: Opening Statements (Round 1 Only)

Run this phase ONLY in Round 1. Skip in all subsequent rounds.

**Researcher A — Opening Statement:**
Prompt: "Present your opening statement for Position A: '[Position A]'. State your core thesis, your top 3 supporting arguments, and any key evidence or examples. Aim for depth and precision. Do not pre-emptively respond to Position B."

Record output verbatim in transcript as `[R1 - ROUND 1 - OPENING]`.

**Researcher B — Opening Statement:**
Prompt: "Present your opening statement for Position B: '[Position B]'. State your core thesis, your top 3 supporting arguments, and any key evidence or examples. You have now seen Researcher A's opening statement: [R1 opening]. You may reference it, but focus on presenting your own positive case."

Record output verbatim in transcript as `[R2 - ROUND 1 - OPENING]`.

### Phase 2: Constructive Arguments (Rounds 2+ Only)

Run this phase in all rounds EXCEPT Round 1 (which uses Opening Statements instead).

**Researcher A — Constructive:**
Prompt: "Round [N]. Advance your position: '[Position A]'. Build on your previous arguments, introduce new supporting evidence, and directly address any weaknesses that were exposed in the previous round's challenges and rebuttals. Previous round judge feedback for you: [judge feedback for A from round N-1]."

Record as `[R1 - ROUND N - CONSTRUCTIVE]`.

**Researcher B — Constructive:**
Prompt: "Round [N]. Advance your position: '[Position B]'. Build on your previous arguments, introduce new supporting evidence, and directly address any weaknesses that were exposed in the previous round's challenges and rebuttals. You have seen Researcher A's constructive: [R1 constructive]. Previous round judge feedback for you: [judge feedback for B from round N-1]."

Record as `[R2 - ROUND N - CONSTRUCTIVE]`.

### Phase 3: Challenge Phase

Each researcher challenges the opponent's argument from this round's constructive/opening phase.

**Researcher A — Challenge:**
Prompt: "Identify the single weakest claim or argument in Researcher B's statement this round: [R2 statement]. State the claim exactly as B made it, then explain precisely why it is weak, false, or unsupported. Be specific — do not make vague criticisms."

Record as `[R1 - ROUND N - CHALLENGE]`.

**Researcher B — Challenge:**
Prompt: "Identify the single weakest claim or argument in Researcher A's statement this round: [R1 statement]. State the claim exactly as A made it, then explain precisely why it is weak, false, or unsupported. Be specific — do not make vague criticisms."

Record as `[R2 - ROUND N - CHALLENGE]`.

### Phase 4: Rebuttal Phase

Each researcher responds to the specific challenge directed at them.

**Researcher A — Rebuttal:**
Prompt: "Researcher B has challenged you on this specific point: [R2 challenge against A]. Respond directly to this challenge. Address the specific claim B identified. You may defend your original position, clarify a misrepresentation, or concede the specific point while reinforcing your overall argument. You may introduce new evidence if it directly addresses the challenge."

Record as `[R1 - ROUND N - REBUTTAL]`.

**Researcher B — Rebuttal:**
Prompt: "Researcher A has challenged you on this specific point: [R1 challenge against B]. Respond directly to this challenge. Address the specific claim A identified. You may defend your original position, clarify a misrepresentation, or concede the specific point while reinforcing your overall argument. You may introduce new evidence if it directly addresses the challenge."

Record as `[R2 - ROUND N - REBUTTAL]`.

### Phase 5: Judge Verdict

**Judge — Round Verdict:**
Prompt: "Evaluate Round [N] of this debate. Topic: '[topic]'. Judge mode: [JUDGE_MODE].

Full round transcript:
- Researcher A [statement type]: [R1 statement]
- Researcher B [statement type]: [R2 statement]
- Researcher A challenge: [R1 challenge]
- Researcher B challenge: [R2 challenge]
- Researcher A rebuttal: [R1 rebuttal]
- Researcher B rebuttal: [R2 rebuttal]

Score each researcher 1–10 on: (a) argument quality, (b) use of evidence, (c) directness of rebuttals. Average these for their round score.

Identify: strongest argument from A this round, weakest argument from A this round, strongest argument from B this round, weakest argument from B this round.

Declare: round winner (A / B / tie) with a one-sentence justification.

Give specific feedback to each researcher for the next round (2-3 sentences each).

[If JUDGE_MODE is strict]: Additionally, flag any empirical claims made without evidence. Penalize unsupported claims in the score.

Finally, assess convergence: are the researchers starting to agree? If yes, trigger the Anti-Convergence Protocol."

Record full judge output as `[JUDGE - ROUND N - VERDICT]`.

Extract and store:
- `score_A_round_N` — Researcher A's round score (numeric)
- `score_B_round_N` — Researcher B's round score (numeric)
- `winner_round_N` — A, B, or tie
- `feedback_A_round_N` — Judge's feedback for A
- `feedback_B_round_N` — Judge's feedback for B
- `convergence_detected_round_N` — true/false

---

## Anti-Convergence Protocol

This protocol activates when the judge detects convergence (`convergence_detected = true`).

**Detection criteria (judge evaluates these):**
- Both researchers made the same claim in the same round
- One researcher explicitly agreed with the opponent's core thesis
- The challenge phase produced only minor quibbles rather than substantive disagreements
- Both researchers are circling the same solution space without meaningful contrast

**Intervention (orchestrator action, not researcher action):**

1. Display: `[ANTI-CONVERGENCE INTERVENTION - ROUND N]`

2. Issue a forced divergence prompt to the converging researcher (usually the one who moved toward the opponent):

> "Judge intervention: You and your opponent are converging. You MUST sharpen your position. Researcher [B/A], provide a stronger counter-argument to your opponent's central thesis. Do not hedge. Find the deepest flaw in [Position A/B] and argue it forcefully. If you cannot find a substantive objection, argue from a different framework entirely (economic vs. technical, short-term vs. long-term, empirical vs. theoretical, etc.)."

3. Re-run the rebuttal phase for that researcher using this forced divergence prompt.

4. Update the transcript with `[FORCED DIVERGENCE]` tag.

5. If convergence persists in the NEXT round despite intervention, do not intervene again. Instead, flag for the final verdict: "Both researchers maintained convergence despite intervention — consensus finding protocol applies."

---

## Final Verdict

After all N_ROUNDS complete, run the final verdict phase.

**Compute cumulative scores:**
- `total_score_A = sum(score_A_round_1 ... score_A_round_N)`
- `total_score_B = sum(score_B_round_1 ... score_B_round_N)`
- `rounds_won_A = count(winner_round_X == A)`
- `rounds_won_B = count(winner_round_X == B)`
- `rounds_tied = count(winner_round_X == tie)`

**Judge — Final Verdict:**
Prompt: "This debate is now complete. Topic: '[topic]'. Researcher A argued: '[Position A]'. Researcher B argued: '[Position B]'.

Score summary:
- Researcher A: [total_score_A] total points, [rounds_won_A] rounds won
- Researcher B: [total_score_B] total points, [rounds_won_B] rounds won
- Tied rounds: [rounds_tied]

[If consensus was reached]: Both researchers converged toward agreement. Note this in your verdict.

Provide:
1. Overall winner declaration: A, B, or consensus. If consensus, state what both researchers converged on.
2. Strength of verdict: one of `decisive` (score gap >20%), `narrow` (score gap ≤20%, same winner), or `consensus` (researchers converged).
3. Justification paragraph (3-5 sentences): What ultimately determined the winner? What were the debate's pivotal moments?
4. The strongest single argument made in the entire debate (by either side), and why it was decisive.
5. Key unresolved questions: What did this debate fail to settle? What would need to be tested or researched further to resolve the remaining disagreement?
6. Recommended follow-up: Given the debate outcome, what is the most productive next action? (Examples: 'Run an autoconference to empirically test Position A', 'Consult the literature on [topic]', 'Run a second debate focused specifically on [unresolved question]')."

Record as `[JUDGE - FINAL VERDICT]`.

---

## Dissent Record

After the final verdict, compile the dissent record: every point where both researchers maintained disagreement through the final round without resolution. Format as:

| # | Disputed Claim | A's Position | B's Position | Status |
|---|----------------|--------------|--------------|--------|
| 1 | ...            | ...          | ...          | Unresolved / Partially resolved / Resolved by consensus |

This record is separate from the winner declaration — even a "decisive" win may leave substantive questions open.

---

## Output: debate-report.md

Write the full report to `{OUTPUT_PATH}/debate-report.md`. Structure:

```
# Debate Report

**Topic:** [topic]
**Researcher A (Pro):** [Position A]
**Researcher B (Con):** [Position B]
**Rounds Completed:** [N] / [N_ROUNDS]
**Judge Strictness:** [JUDGE_MODE]
**Date:** [current date]

---

## Final Verdict

**Winner:** [A / B / Consensus]
**Strength:** [decisive / narrow / consensus]
**Overall Scores:** Researcher A: [total_score_A] | Researcher B: [total_score_B]

[Full judge final verdict text]

---

## Debate Transcript

### Round 1

#### Opening Statement — Researcher A
[R1 - ROUND 1 - OPENING]

#### Opening Statement — Researcher B
[R2 - ROUND 1 - OPENING]

#### Challenge — Researcher A
[R1 - ROUND 1 - CHALLENGE]

#### Challenge — Researcher B
[R2 - ROUND 1 - CHALLENGE]

#### Rebuttal — Researcher A
[R1 - ROUND 1 - REBUTTAL]

#### Rebuttal — Researcher B
[R2 - ROUND 1 - REBUTTAL]

#### Judge Verdict — Round 1
[JUDGE - ROUND 1 - VERDICT]
**Scores:** A: [score_A_round_1] | B: [score_B_round_1] | Winner: [winner_round_1]

[Repeat for all rounds, using CONSTRUCTIVE label instead of OPENING for rounds 2+]
[Insert [ANTI-CONVERGENCE INTERVENTION] blocks where they occurred]

---

## Per-Round Score Summary

| Round | Researcher A Score | Researcher B Score | Winner |
|-------|-------------------|-------------------|--------|
| 1     | ...               | ...               | ...    |
| ...   | ...               | ...               | ...    |
| **Total** | **[total_score_A]** | **[total_score_B]** | **[overall winner]** |

---

## Dissent Record
[Full dissent table]

---

## Key Unresolved Questions
[From final verdict]

## Recommended Follow-Up
[From final verdict]
```

After writing, confirm: "Debate complete. Report written to `{OUTPUT_PATH}/debate-report.md`. Winner: [winner] ([strength]). [N] rounds completed. Key unresolved question: [first item from unresolved questions]."

---

## Error Handling

**Researcher refuses to maintain position:** If a researcher explicitly concedes the debate (not just a point, but the entire position), treat this as a consensus finding and proceed to the final verdict immediately with `strength: consensus`.

**Judge declares same winner every round:** This is valid. Do not artificially rebalance. The debate transcript is the honest record.

**Topic is ambiguous or has no clear pro/con split:** Before setup, flag: "This topic may not have a clean pro/con split. I recommend framing it as: [suggested framing]. Alternatively, we can frame it as [alternative]. Which would you prefer?" Do not proceed until the user confirms a frameable debate topic.

**Only 1 round requested:** Skip the Challenge and Rebuttal phases. Run: Opening Statements → Judge Verdict → Final Verdict. This is a valid "quick verdict" format.
