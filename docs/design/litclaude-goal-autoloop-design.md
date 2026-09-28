# LitClaude Native-/goal-Equivalent via Stop Hook

**Design Document | Date: 2026-06-14 | Author: Claude Code Research & Adversarial Review**

---

## 1. VERDICT

**Feasibility: YES, confirmed-feasible with required fixes.**

**Confidence: High (85%) — subject to one blocking prerequisite.**

**Single Epoch-Making Idea:**
LitClaude ships a plugin-owned Stop hook that reads the durable litgoal ledger (.litclaude/litgoal/goals.json) and blocks Claude from stopping (returns decision: 'block') until all criteria are deterministically pass-marked, reproducing /goal's keep-running behavior without the user typing /goal — enabling autonomous completion loops driven entirely by plugin state and skill discipline.

**Blocking Prerequisite (Required Before Implementation):**
Official Claude Code documentation must explicitly define the shape and lifecycle of the Stop event input JSON, specifically:
- The exact presence, polarity, and triggering of the `stop_hook_active` field.
- Whether plugin hooks receive identical Stop event input as user-defined hooks.
- Clarification of GitHub issue #10412 (plugin Stop hook exit-2 divergence).

**Recommendation:**
File a GitHub issue or contact Claude Code maintainers (anthropics/claude-code) to confirm these semantics BEFORE implementation begins. The design is sound but depends on undocumented behavior.

---

## 2. MECHANISM

### 2.1 How It Works (Operational Flow)

1. **Binding Phase** (skill-driven, no /goal typed by user):
   - User or skill calls `litclaude litgoal create-goals --brief "objective" --autoloop`
   - CLI writes `.litclaude/litgoal/goals.json` with `status: 'active'`, `autoloop: true`, and ≥1 `criteria[]` with `status: 'pending'`
   - The Stop hook is now ARMED (plugin reads this file on each Stop event)

2. **Stop Event Loop** (recurring, on each turn completion):
   - Claude finishes responding
   - Claude Code fires the Stop lifecycle event
   - litclaude plugin's Stop hook (`bin/litclaude-hook.js stop`) receives JSON input on stdin
   - Hook applies 4 independent safety brakes (see §2.2)
   - If a non-empty criteria list is all-pass, the hook lock-rechecks and durably completes the goal before returning `{}`
   - If any criterion is not 'pass', hook returns `{ decision: 'block', reason: '<snapshot>' }`
   - Claude sees the reason at end of turn, reads goal status, and continues working

3. **Satisfaction Phase** (model-driven):
   - Model advances criteria by calling `litclaude litgoal record-evidence --criterion <id> --status pass --json '{...}'`
   - Criterion atomically marked pass, ledger appended
   - Next Stop event re-evaluates; criterion no longer blocks

4. **Completion Phase** (automatic or user-triggered):
   - When a non-empty criteria list is all-pass, the next Stop hook automatically completes and disarms the durable goal, then allows stop
   - Alternatively, user/model can call `litclaude litgoal checkpoint --status complete` or `checkpoint --status blocked` to exit the loop early

### Current durable completion contract

The current implementation uses `withLitgoalLock()` to re-read `goals.json` before
changing lifecycle state. Only an active autoloop with non-empty criteria that are all
`pass` can transition automatically. The lock-backed, idempotent transition writes
`status: "complete"`, `autoloop: false`, exactly one generated completion checkpoint,
and one completion ledger event named `goal.completed`. Repeated Stop invocations reuse
the checkpoint `completionId` and do not duplicate either receipt. If state was written
but the ledger append was interrupted, a later Stop invocation repairs the missing
ledger receipt.

`goals.json` and `ledger.jsonl` are separate files, so their writes cannot be
transactionally atomic. State is authoritative and is written first under the lock;
the completion ID makes the later ledger append idempotent. A process loss after the
state rename and before the append can leave the receipt absent until another Stop hook
invocation performs repair.

### 2.2 Stop Hook Implementation (Exact Code & Brakes)

#### Hook Registration in `plugins/litclaude/hooks/hooks.json`:

```json
{
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/litclaude-hook.js\" stop",
          "timeout": 10,
          "statusMessage": "checking LitClaude goal completion"
        }
      ]
    }
  ]
}
```

#### New Case in `bin/litclaude-hook.js`:

Add to `hookEventNames` map:
```javascript
"stop": "Stop",
```

Add to the switch statement (before the default case):
```javascript
case "stop": {
  // BRAKE 1: ENV ESCAPE HATCH (fail-open, checked first)
  if (process.env.LITCLAUDE_GOAL_OFF === "1") {
    process.exit(0); // allow stop immediately
  }

  // BRAKE 2: WORKSPACE SCOPING (read input.cwd, not process.cwd())
  let state;
  try {
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const { readLitgoalState } = await import("../lib/litgoal/state.mjs");
    const { litgoalGoalsPath } = await import("../lib/litgoal/paths.mjs");
    state = readLitgoalState(litgoalGoalsPath(cwd), null);
  } catch (err) {
    // FAIL-OPEN: corrupt goals.json or missing ledger
    console.error(
      `LitClaude Stop hook: failed to read goals.json: ${err.message}; allowing stop`
    );
    process.exit(0); // allow stop on I/O error
  }

  // GATE: no active goal = allow stop
  if (!state || state.status !== "active" || state.autoloop !== true) {
    process.exit(0);
  }

  // BRAKE 3: RE-ENTRY GUARD (native /goal coexistence)
  if (input.stop_hook_active === true) {
    // A block already occurred this cycle; defer to the first blocker
    process.exit(0); // allow stop, let prior block own this cycle
  }

  // BRAKE 4: ITERATION CAP (durable counter independent of runtime flag)
  let autoloopState;
  try {
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const { readAutoloopState, writeAutoloopState } = 
      await import("../lib/litgoal/autoloop.mjs");
    autoloopState = readAutoloopState(cwd) ?? {
      blockCount: 0,
      firstBlockAt: Date.now(),
    };
    
    // Check time cap (30 minutes default)
    const elapsedMs = Date.now() - (autoloopState.firstBlockAt ?? Date.now());
    const maxDurationMs = 30 * 60 * 1000; // 30 minutes
    
    // Check block cap (8 blocks matching Claude Code's override)
    const MAX_BLOCKS = 8;
    if (autoloopState.blockCount >= MAX_BLOCKS || elapsedMs > maxDurationMs) {
      // HARD STOP: output continue: false (takes precedence)
      console.log(
        JSON.stringify({
          continue: false,
          stopReason:
            `LitClaude autoloop hit safety cap (${autoloopState.blockCount} blocks / ${Math.round(elapsedMs / 1000)}s). ` +
            `Goal left active. Escape: set LITCLAUDE_GOAL_OFF=1, ` +
            `or run 'litclaude-ai litgoal checkpoint --status blocked'. ` +
            `Review .litclaude/litgoal/goals.json and .litclaude/litgoal/autoloop.json for details.`,
        })
      );
      process.exit(0);
    }
  } catch (err) {
    // Fail-open: preserve corrupt/invalid counter bytes for diagnosis.
    process.exit(0);
  }

  // DETERMINISTIC COMPLETION CHECK (no model judgment)
  const criteria = Array.isArray(state.criteria) ? state.criteria : [];
  const remaining = criteria.filter((c) => !c || c.status !== "pass");

  if (criteria.length > 0 && remaining.length === 0) {
    // completeAutoloopGoal() re-reads under the litgoal lock, writes complete state,
    // disarms autoloop, and records/reconciles the idempotent completion receipt.
    completeAutoloopGoal(cwd);
    process.exit(0);
  }

  // BLOCK: criteria not yet satisfied
  // Increment block counter
  if (autoloopState) {
    autoloopState.blockCount = (autoloopState.blockCount ?? 0) + 1;
    try {
      const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
      const { writeAutoloopState } = await import("../lib/litgoal/autoloop.mjs");
      writeAutoloopState(cwd, autoloopState);
    } catch (err) {
      console.error(`LitClaude Stop hook: failed to update iteration counter: ${err.message}`);
      // Non-fatal; continue with block
    }
  }

  // Format remaining criteria for Claude
  const remainingList = remaining
    .map((c) => `  • ${c.id} [${c.status}]: ${c.description}`)
    .join("\n");

  const reason =
    `LitClaude goal still active: "${state.objective}"\n` +
    `${remaining.length} criterion(s) not yet pass:\n${remainingList}\n` +
    `Progress: run 'litclaude-ai litgoal record-evidence --criterion <id> --status pass --json \'{"artifact":"..."}\'.\n` +
    `Block count: ${autoloopState?.blockCount ?? "unknown"}/8. ` +
    `Escape: checkpoint --status blocked, or LITCLAUDE_GOAL_OFF=1.`;

  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}
```

### 2.3 Algorithm Pseudocode (High Level)

```pseudocode
function onStopEvent(input: StopHookInput) {
  // 4 independent brakes: fail-open, workspace-scoped, re-entry-guarded, iteration-capped

  // Brake 1: user kill switch
  if ENV[LITCLAUDE_GOAL_OFF] == "1":
    return EXIT_0  // allow stop

  // Brake 2: workspace scoping + autoloop opt-in
  try:
    state ← readLitgoalState(litgoalGoalsPath(input.cwd))
  catch:
    return EXIT_0  // fail-open on corrupt ledger

  if state is null or state.status ≠ 'active' or state.autoloop ≠ true:
    return EXIT_0  // goal not active in this workspace; allow stop

  // Brake 3: native /goal coexistence
  if input.stop_hook_active == true:
    return EXIT_0  // defer to first blocker (native /goal or prior hook)

  // Brake 4: durable iteration counter
  if autoloop.json is missing:
    autoloopState ← {blockCount: 0, firstBlockAt: now()}
  else:
    autoloopState ← read and validate autoloop.json
    if corrupt or numeric fields are invalid:
      return EXIT_0  // fail-open; do not rewrite corruption as a fresh counter
  if autoloopState.blockCount ≥ 8 or (now() - autoloopState.firstBlockAt) > 30min:
    output JSON: { continue: false, stopReason: "... hard stop" }
    return EXIT_0

  // Deterministic completion (pure function of ledger state)
  criteria ← state.criteria ?? []
  remaining ← criteria.filter(c => c.status ≠ 'pass')

  if criteria is non-empty and remaining.length == 0:
    completeAutoloopGoalUnderLock(input.cwd)
    return EXIT_0  // state is complete and autoloop is disarmed

  // Block and guide
  autoloopState.blockCount += 1
  writeAutoloopState(input.cwd, autoloopState)
  
  reason ← format(objective, remaining criteria, next commands, block count, escape hatch)
  output JSON: { decision: "block", reason }
  return EXIT_0
}
```

---

## 3. BINDING

### How the Model Starts a Goal (Without Typing /goal)

**Primary Binding Mechanism: Skill-Driven Create**

The `/litclaude:litgoal` skill (or a parent skill like `/litclaude:lit-loop`) calls:

```bash
litclaude litgoal create-goals --brief "Objective" --autoloop --json
```

Output: `.litclaude/litgoal/goals.json` written with:
```json
{
  "version": "0.2.0",
  "objective": "Objective",
  "status": "active",
  "autoloop": true,
  "criteria": [
    {
      "id": "c1",
      "description": "Default criterion",
      "expectedEvidence": "criterion satisfied",
      "status": "pending",
      "evidence": []
    }
  ],
  "blockers": [],
  "checkpoints": [],
  "createdAt": "2026-06-14T...",
  "updatedAt": "2026-06-14T..."
}
```

From that moment, the Stop hook is armed. The model does NOT type `/goal`; the hook reads the ledger.

**Secondary Binding Mechanism (Optional, Hermes-Style): UserPromptSubmit Marker**

Alternatively, a `UserPromptSubmit` hook extension could detect a `<litclaude-bind-goal>objective here</litclaude-bind-goal>` marker in the prompt and auto-invoke `create-goals`. This is opt-in and not required for MVP; the primary mechanism (skill invocation) is clearer.

### Engagement in Workflow

1. User types `/litclaude:lit-loop` or skill recommends it
2. Skill runs `litclaude litgoal create-goals --autoloop --brief "..."` as first step
3. Goals.json written; Stop hook is armed
4. Claude continues; on first Stop event, hook checks the ledger
5. Model is NOT burdened with typing `/goal`; the hook enforces it

---

## 4. EVALUATION (Deterministic Criteria Check)

### Completion Predicate

```javascript
const allCriteriaMet = (state) => {
  if (state.status !== 'active') return true; // goal complete or blocked
  const criteria = state.criteria ?? [];
  return criteria.length > 0 && criteria.every((c) => c?.status === 'pass');
};
```

### Decision Logic

```javascript
const remainingCriteria = criteria.filter((c) => c.status !== 'pass');
if (remainingCriteria.length === 0) {
  // Only a non-empty all-pass list reaches this branch.
  return complete_and_disarm_under_lock();
} else {
  // At least one criterion is pending/fail/blocked
  return block_stop(reason_with_remaining_criteria_snapshot);
}
```

### Why Deterministic (No Model Eval)

- **Reliability**: No small-model evaluation of goal state; zero latency, zero flakiness.
- **Auditability**: Every Stop decision is purely a function of the recorded ledger (goals.json), which is human-readable and inspectable.
- **Incentive Alignment**: The model is incentivized to record REAL evidence (via `record-evidence`), not to guess or hallucinate about goal progress.
- **Tradeoff vs /goal**: Native `/goal` uses Haiku model evaluation each turn (more flexible but can hallucinate about condition); deterministic ledger is stricter but more trustworthy.

### Evidence Recording (Model Action)

The model advances criteria by calling:

```bash
litclaude litgoal record-evidence \
  --criterion "c1" \
  --status pass \
  --json '{"artifact":"path/to/test.log","exitCode":0,"summary":"All tests pass"}'
```

This atomically:
1. Marks `criteria[0].status = 'pass'`
2. Appends to `criteria[0].evidence[]`
3. Rewrites goals.json with fsync + mkdir-based lock (matching litgoal/state.mjs patterns)
4. Appends immutable record to `.litclaude/litgoal/ledger.jsonl`

Next Stop hook invocation reads the updated state and re-evaluates.

---

## 5. SAFETY (Gating, Escape, Loop Prevention)

### Four Independent Brakes

| Brake | Mechanism | Escape | Fail Mode |
|-------|-----------|--------|-----------|
| **Brake 1: Env Kill Switch** | `LITCLAUDE_GOAL_OFF=1` stops all blocking immediately | User/script sets env var or calls shell | Fail-open if env var not honored (low risk) |
| **Brake 2: Workspace + Autoloop Gate** | No `goals.json` in cwd or `autoloop ≠ true` = allow stop | User runs `litclaude litgoal clear` or `checkpoint --status blocked` | Fail-open if goals.json missing (by design) |
| **Brake 3: Re-entry Guard** | If `stop_hook_active === true`, allow stop (defer to first blocker) | First hook owns the cycle; second/third hooks exit cleanly | Undefined if stop_hook_active polarity changes (see prerequisite) |
| **Brake 4: Iteration Cap** | Hard stop after 8 blocks or 30 minutes; outputs `continue: false + stopReason` | Hard stop is mandatory; session ends with user-facing message | Missing counter starts fresh; corrupt or invalid counter fails open without rewrite |

### Escape Hatches (Three, Redundant)

1. **Env Var** (immediate, no state change):
   ```bash
   LITCLAUDE_GOAL_OFF=1 claude  # or export in shell
   ```
   Hook checks this first; no CLI invocation needed.

2. **CLI Status Flip** (atomic, persistent):
   ```bash
   litclaude litgoal checkpoint --status blocked --note "Manual escape"
   ```
   Flips `state.status` off 'active'; next Stop hook allows stop (Brake 2 gate).

3. **Full Ledger Clear**:
   ```bash
   litclaude litgoal clear  # removes .litclaude/litgoal/goals.json
   ```
   Goal is deleted; next Stop hook finds no goals.json (Brake 2 gate).

### Coexistence with Native /goal (Required Fixes)

**Problem**: If user types `/goal <condition>` in the same session where litclaude plugin Stop hook is active, both hooks fire on each Stop event, creating undefined behavior.

**Solution (Implemented in Brake 3)**:
- Hook checks `input.stop_hook_active === true` (set by Claude Code on re-entry/second block)
- If true, hook allows stop (returns `{}`), letting the first blocker (native /goal) own that cycle
- Documentation advises: use EITHER `/goal` OR `/litclaude:litgoal`, not both

**Residual Risk**:
- `stop_hook_active` polarity is not officially documented; if Claude Code changes its behavior, this guard fails
- **Mitigation**: File GitHub issue (Claude Code team) to confirm `stop_hook_active` semantics; ship plugin with explicit warning in SKILL.md

### Max-Iteration Cap

**Durable Counter** (new file: `.litclaude/litgoal/autoloop.json`):
```json
{
  "blockCount": 5,
  "firstBlockAt": 1718390000000,
  "resetOn": "completion"
}
```

- On each block, increment `blockCount`
- Check: if `blockCount ≥ 8` OR `(now - firstBlockAt) > 30 minutes`, output `continue: false` (hard stop)
- `continue: false` takes precedence over `decision: block` and ends the session with `stopReason` shown to the user
- Hard stop is unavoidable; user must either resolve the goal, mark it blocked, or restart

**Independent of Runtime Flag**:
- Claude Code also has a built-in 8-consecutive-blocks override; this counter is a second, durable brake
- If the durable counter is corrupt or has invalid numeric fields, allow Stop and preserve the file for diagnosis; only a missing file starts a fresh counter
- Default cap is 8 blocks (matches Claude Code); configurable via env: `LITCLAUDE_GOAL_MAX_BLOCKS`

---

## 6. WHAT REMAINS IMPOSSIBLE (Plugin Cannot Replicate)

Even with a plugin Stop hook, LitClaude CANNOT replicate these /goal-exclusive features:

1. **HUD Badge & Status Indicator**:
   - Native /goal shows a "◎ /goal active" icon in the Claude Code status line, displaying goal name and turn count
   - Plugins cannot modify the status line (reserved for Claude Code + LitClaude's own statusLine hook, if enabled)
   - **Workaround**: User must manually check `litclaude litgoal status` or `cat .litclaude/litgoal/goals.json`

2. **Model-Level Goal Inspection Tools**:
   - Native /goal exposes NO tools (get_goal, create_goal, update_goal do not exist; verified via ToolSearch)
   - Plugins cannot add model-facing tools (MCP tools are hook-infrastructure only, not Claude-visible)
   - **Workaround**: Model reads goals.json from the transcript context or skill instructions; CLI is the binding surface

3. **Durable Completion Instead of Native Auto-Clear**:
   - Native /goal auto-clears (removes from transcript HUD) when the condition first evaluates to true
   - LitClaude has no native HUD entry to clear, but its Stop hook automatically marks a non-empty all-pass goal complete, sets `autoloop: false`, and records durable completion receipts
   - Manual `checkpoint --status complete` remains an explicit operator path, not a requirement after automatic success

4. **Goal Resumption Across Sessions**:
   - Native /goal is session-scoped; ending the session clears the goal from Claude's view
   - Plugin ledger is durable (.litclaude/litgoal/goals.json persists); a new session sees the same active goal
   - **Tradeoff**: Persistence is good for active or blocked work; automatically completed goals are already disarmed, while abandoned active goals still require an explicit blocked checkpoint
   - **Workaround**: Document "goal hygiene" (always checkpoint/clear at end of work) and optional staleness cutoff (ignore goals older than N days)

5. **Native Model Evaluation of Completion**:
   - Native /goal sends the condition to Haiku and gets a structured yes/no decision each turn
   - Plugin hook evaluates only recorded ledger state (all-pass predicate); cannot re-evaluate complex conditions against the transcript
   - **Tradeoff**: Deterministic ledger is more reliable but less flexible
   - **Workaround**: Criteria must be simple and ledger-recordable; complex conditions require manual /goal

**Honest Scope**: A plugin-driven autonomous completion loop is viable for **deterministic, ledger-based criteria** (e.g., "all tests pass", "artifact files exist", "checklist marked done"). It is NOT a drop-in replacement for /goal's flexible, model-evaluated conditions. Ship it as an **alternative, opt-in mechanism**, not a /goal substitute.

---

## 7. MCP COMPLEMENT (Optional, Hermes-Style)

### Rationale
Claude Code plugins CANNOT expose model-facing tools. However, an MCP server (shipped with litclaude) COULD provide goal-binding tools that hook commands can invoke. This is a nice-to-have, not required for MVP.

### Proposed Tools (If MCP Server Extended)

```json
{
  "tools": [
    {
      "name": "litgoal_create",
      "description": "Create or update a LitClaude goal in the workspace ledger.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "objective": { "type": "string", "description": "Goal objective." },
          "criteria": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "description": { "type": "string" },
                "expectedEvidence": { "type": "string" }
              },
              "required": ["id", "description", "expectedEvidence"]
            }
          },
          "autoloop": { "type": "boolean", "default": false }
        },
        "required": ["objective"]
      }
    },
    {
      "name": "litgoal_record_evidence",
      "description": "Record evidence for a criterion (mark pass/fail/blocked).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "criterionId": { "type": "string" },
          "status": { "enum": ["pass", "fail", "blocked"] },
          "artifact": { "type": "string", "description": "Optional artifact path/summary." }
        },
        "required": ["criterionId", "status"]
      }
    },
    {
      "name": "litgoal_status",
      "description": "Read current goal state and remaining criteria.",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ]
}
```

### Hook Integration (Optional)

A `UserPromptSubmit` hook extension could detect `<litclaude-goal>...</litclaude-goal>` tags and invoke the MCP tools to bind goals programmatically. This is a "nice-to-have" for future versions; the CLI-driven binding is sufficient for MVP.

### Why Not for MVP

- MCP tools are hook-infrastructure only; Claude cannot see or call them from reasoning
- CLI binding (`litclaude litgoal create-goals`) is already sufficient
- MCP tools would provide NO functional benefit without model-facing tool exposure
- Skip for v0.3.5; revisit if Claude Code adds model-facing MCP tool support

---

## 8. IMPLEMENTATION PLAN

### Phase 1: Prerequisite (Blocker)

**Action**: File GitHub issue against [anthropics/claude-code](https://github.com/anthropics/claude-code) requesting clarification:

> **Title**: Clarify Stop hook input schema and plugin hook parity
> 
> **Body**:
> - What is the exact JSON shape of the Stop event input for plugin hooks? Is `stop_hook_active` present?
> - What does `stop_hook_active` signal? Is it true on re-entry or on initial block?
> - Do plugin hooks receive identical input as user hooks for the Stop event?
> - Has issue #10412 (plugin Stop hook exit-2 divergence) been resolved?
> - Can a plugin Stop hook return `continue: false` to hard-stop a session?

**Expected Response Time**: 2-5 business days

**Fallback**: If Claude Code team cannot clarify, ship the hook with explicit warnings about undocumented contract.

### Phase 2: Core Implementation (Files to Change)

#### 2.1 `plugins/litclaude/bin/litclaude-hook.js`

**Changes**:
- Add `"stop": "Stop"` to `hookEventNames` map
- Add async case 'stop' with 4-brake logic (see §2.2)
- Import `readLitgoalState`, `litgoalGoalsPath` from litgoal modules
- Import new `readAutoloopState`, `writeAutoloopState` from `../lib/litgoal/autoloop.mjs`
- Use `writeContext()` helper or direct JSON output for decision

**Lines of Code**: ~100-120 (case + helper logic)

#### 2.2 `plugins/litclaude/lib/litgoal/autoloop.mjs` (NEW)

**Purpose**: Manage durable iteration counter (blockCount, firstBlockAt)

**Exports**:
- `readAutoloopState(cwd: string): AutoloopState | null`
- `writeAutoloopState(cwd: string, state: AutoloopState): void`

**Implementation Pattern**: Match `state.mjs` exactly — fsync + mkdir-lock + atomicity

**File Format**: `.litclaude/litgoal/autoloop.json`

```typescript
interface AutoloopState {
  blockCount: number;
  firstBlockAt: number; // milliseconds since epoch
  resetOn?: string; // "completion" or "manual"
}
```

**Lines of Code**: ~50

#### 2.3 `plugins/litclaude/hooks/hooks.json`

**Add** (before closing brace, or as a sibling array):
```json
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/litclaude-hook.js\" stop",
        "timeout": 10,
        "statusMessage": "checking LitClaude goal completion"
      }
    ]
  }
]
```

**Lines of Code**: 12 (JSON)

#### 2.4 `plugins/litclaude/lib/litgoal/cli.mjs`

**Changes**:
- Add `--autoloop` flag to `create-goals` command
  - Seed `state.autoloop = flags.autoloop ?? false`
  - Document default is false (opt-in per goal)
- Add new command `autoloop <goal_id> <true|false>` to toggle flag after creation
- Both commands must atomically rewrite goals.json

**Lines of Code**: ~30-40 (new CLI arguments + setters)

#### 2.5 `plugins/litclaude/skills/litgoal/SKILL.md`

**Sections to Add/Revise**:
- "Autonomous Completion Loops" section explaining:
  - What `--autoloop` does (arms the Stop hook)
  - How to create: `litclaude litgoal create-goals --autoloop --brief "..."`
  - How the Stop hook enforces (reads ledger, blocks until all-pass)
  - The 8-block / 30-minute safety cap
  - Escape hatches: env var, checkpoint, clear
  - Interaction with native /goal (use one or the other, not both)
- Updated examples showing `--autoloop` in action
- Troubleshooting: common issues (stale goal, corruption, iteration cap reached)

**Lines of Code**: ~100-150 (documentation)

#### 2.6 `test/hooks.test.mjs` (tracked Stop-hook lifecycle coverage)

**Purpose**: Integration tests for Stop hook + autoloop ledger

**Test Cases**:
1. Create active goal with autoloop=true; verify Stop hook blocks
2. Record evidence for criterion; verify next Stop hook still blocks (other criteria remain)
3. Mark all criteria pass; verify next Stop hook completes, disarms, and allows stop
4. Iteration counter increments on each block; test blockCount
5. Iteration cap at 8 blocks: verify `continue: false` output
6. Time cap (simulate 30+ minutes): verify hard stop
7. autoloop=false (default): verify Stop hook does NOT block even if criteria unmet
8. stop_hook_active=true (re-entry): verify hook allows stop (defers to first blocker)
9. Corrupt/missing goals.json: verify fail-open (allow stop, log error)
10. Workspace scoping: create goal in dir A, simulate Stop in dir B, verify no block (different cwd)

**Test Structure**: Use existing `test/litgoal-runtime.test.mjs` patterns (t.test, assertions, cleanup)

**Lines of Code**: ~200-250

#### 2.7 `docs/design/litclaude-goal-autoloop.md` (NEW, or merge into decisions.md)

**Purpose**: Public design rationale, safety model, limitations

**Sections**:
- Problem statement (user fatigue from typing /goal; autonomous completion loops)
- Solution (plugin Stop hook + deterministic ledger)
- Comparison to native /goal (pros/cons)
- Safety model (4 brakes, iteration cap, fail-open)
- Limitations (no native HUD or model tools; durable completion replaces native auto-clear)
- Configuration (--autoloop flag, env vars)
- Troubleshooting

**Lines of Code**: ~200-300

### Phase 3: Testing & Validation

#### 3.1 Unit Tests
Run `node --test test/hooks.test.mjs test/litgoal-runtime.test.mjs` to verify the tracked lifecycle and CLI contracts.

#### 3.2 Integration Tests (Manual)
1. Create a workspace with a goal
2. Run a session with the litclaude plugin enabled
3. Verify Stop hook blocks on each turn
4. Call `litclaude litgoal record-evidence` to advance criterion
5. Verify next Stop hook re-evaluates and blocks fewer times
6. When all pass, verify the Stop hook completes and disarms the durable state before allowing stop

#### 3.3 Plugin Hook Parity Test
1. Create a user-defined Stop hook with `decision: 'block'` in `.claude/settings.json`
2. Create a plugin Stop hook via `hooks/hooks.json` with identical logic
3. Run side-by-side sessions and verify identical behavior
4. Check edge cases: exit code 2, timeout, JSON malformation

#### 3.4 Coexistence Test
1. Run a session with both `/goal <condition>` (user-typed) and litclaude plugin active
2. Verify only one block decision per Stop event (coexistence gate works)
3. Verify no stack overflow or infinite loops

### Phase 4: Rollout

#### 4.1 Default Configuration
Ship with:
- Stop hook REGISTERED in `hooks/hooks.json` (plugin code present)
- CLI `--autoloop` flag AVAILABLE but DEFAULT OFF (opt-in per goal)
- Env var `LITCLAUDE_GOAL_OFF` recognized (kill switch available)
- Documentation CLEAR that this is alternative to /goal, not replacement

#### 4.2 Changelog Entry
```markdown
## [0.3.5] - 2026-06-XX

### Added
- Autonomous completion loops via plugin-owned Stop hook (opt-in per goal).
  - New CLI flag: `litclaude litgoal create-goals --autoloop`
  - New command: `litclaude litgoal autoloop <goal_id> true|false`
  - Hook enforces goal criteria until all marked pass.
  - Hard stop after 8 blocks or 30 minutes; escape hatches: env var, status flip, ledger clear.

### Fixed
- (list any bugs fixed in testing)

### Known Limitations
- No HUD indicator (use `litclaude litgoal status`).
- No model-facing goal tools (use CLI or transcript context).
- Abandoned active goals still require an explicit blocked checkpoint; successful goals complete and disarm automatically.
- Do not combine with native /goal in same session (use one or the other).

### Migration
- Existing `/litclaude:litgoal` workflows are unaffected; `--autoloop` is opt-in.
```

#### 4.3 Release Timing
- Target: v0.3.5 (after GitHub prerequisite is clarified)
- Beta period: 1-2 weeks in a beta branch for user feedback
- Rollout: tagged release with documentation

---

## 9. REQUIRED FIXES (From Adversarial Review)

| Finding | Status | Fix | Priority |
|---------|--------|-----|----------|
| `stop_hook_active` semantics undocumented | BLOCKER | File GitHub issue (§8 Phase 1) | CRITICAL |
| Plugin hook exit-2 divergence (issue #10412) | BLOCKER | Request clarification from Claude Code team | CRITICAL |
| Multiple Stop hooks coordination undefined | DESIGN FIX | Add coexistence gate (Brake 3); document limitation | HIGH |
| Ledger atomicity race condition | DESIGN FIX | Rely on existing `state.mjs` fsync + lock; add read retry on ENOENT | MEDIUM |
| Fail-open error handling insufficient | IMPL FIX | Add stderr logging for corrupt state; document fail-open contract | MEDIUM |
| Iteration counter must be durable | IMPL FIX | Create `autoloop.mjs` with fsync + lock (match `state.mjs` patterns) | HIGH |
| `--autoloop` flag not in CLI | IMPL FIX | Extend `cli.mjs` create-goals and add new autoloop command | HIGH |
| No tracked test coverage for Stop hook | FIXED | Spawn the actual hook from `test/hooks.test.mjs`, including completion, repair, corruption, kill-switch, and cap cases | MEDIUM |
| Documentation incomplete | IMPL FIX | Expand SKILL.md + add `litclaude-goal-autoloop.md` design doc | MEDIUM |
| Stale-goal hijack possible | DESIGN FIX | Add optional age cutoff (goal updatedAt older than N days → auto-skip); default off, configurable | LOW |

---

## 10. DECISION MATRIX & TRADEOFFS

| Aspect | Plugin Stop Hook | Native /goal |
|--------|------------------|--------------|
| **User Types /goal?** | No (skill binds) | Yes (user-typed slash command) |
| **Completion Evaluation** | Deterministic (all-pass predicate on ledger) | Model-evaluated (Haiku each turn) |
| **HUD Indicator** | None (manual status check) | Yes (◎ /goal active badge) |
| **Model-Facing Tools** | None (CLI/transcript only) | None (no tools; /goal is native) |
| **Auto-Clear on Success** | No native HUD item; durable state completes and disarms automatically | Yes (auto-clears when condition true) |
| **Safety Cap** | 8 blocks / 30 minutes (durable counter) | 8 consecutive blocks (runtime) |
| **Coexistence** | Can coexist (with gate); messy | Exclusive per session |
| **Flexibility** | Limited (ledger-based criteria) | High (arbitrary conditions) |
| **Auditability** | High (ledger is readable) | Low (condition in transcript, model eval hidden) |
| **Latency** | Instant (no model call) | ~3-5s per turn (Haiku eval) |

**Recommendation**: Use plugin Stop hook for **deterministic, structured workflows** (multi-step development, QA automation, testing loops). Use native /goal for **flexible, nuanced conditions** (quality gates, semantic validations, model-judged completeness).

---

## 11. CITATIONS & EVIDENCE

### Official Claude Code Documentation
- https://code.claude.com/docs/en/goal.md — /goal command (user-typed, session-scoped, prompt-based Stop hook)
- https://code.claude.com/docs/en/hooks.md — Stop hook event schema, decision control, safety guardrails (dated 2026-02 or later)
- https://code.claude.com/docs/en/hooks-guide.md — Hook execution model, prompt/command/agent types, examples
- https://code.claude.com/docs/en/plugins.md — Plugin structure, hooks/hooks.json, plugin capabilities
- https://code.claude.com/docs/en/plugins-reference.md — Plugin hook event table (confirms Stop available to plugins)

### Codebase References
- `plugins/litclaude/bin/litclaude-hook.js` — Hook dispatcher (lines 19-24, 26-40, 76-110)
- `plugins/litclaude/hooks/hooks.json` — Current hook registration
- `plugins/litclaude/lib/litgoal/state.mjs` — Atomic file I/O + lock patterns
- `plugins/litclaude/lib/litgoal/cli.mjs` — Goal state management (create-goals, record-evidence, checkpoint)
- `plugins/litclaude/lib/litgoal/paths.mjs` — Path resolution (litgoalGoalsPath)
- `plugins/litclaude/skills/litgoal/SKILL.md` — Current documentation
- `test/litgoal-runtime.test.mjs` — Existing test patterns

### GitHub Issues & Discussions
- **anthropics/claude-code#10412** — Plugin Stop hook exit-2 divergence (unresolved, Oct 2025)

### Research Data
- **3-host source research** (conducted 2026-06-14): Confirmed /goal is user-typed, hooks cannot invoke slash commands, no model-facing goal tools in Claude Code
- **Adversarial review** (conducted 2026-06-14): Identified blocking prerequisites and required fixes; validated feasibility with fixes

---

## APPENDIX: Glossary

- **Autoloop**: Optional per-goal flag (`state.autoloop: boolean`); when true, the Stop hook is armed for that goal
- **Brake**: Independent loop-prevention mechanism (4 total: env kill switch, workspace gate, re-entry guard, iteration cap)
- **Criterion**: A unit of goal completion (id, description, expectedEvidence, status: pending|pass|fail|blocked, evidence[])
- **Decision**: Stop hook output field ('block' or omitted/empty)
- **Deterministic**: Evaluation driven purely by recorded ledger state, no model judgment
- **Escape Hatch**: User-callable mechanism to exit the loop without completing the goal (env var, status flip, clear)
- **Fail-Open**: On error, allow stop (do not trap the user)
- **Goal**: A durable objective with criteria and evidence (state.objective, state.status: active|complete|blocked)
- **Ledger**: The goals.json file + accompanying ledger.jsonl audit log (immutable record of changes)
- **Re-entry**: When a Stop hook is triggered again in the same Stop cycle (guard by `stop_hook_active`)
- **Stop Hook**: Claude Code's lifecycle hook that fires after Claude finishes responding; can block (decision: 'block') to force another turn
- **Workspace Scoping**: Goal is tied to a specific cwd; Stop hook reads input.cwd to ensure isolation

---

**End of Design Document**

---

## Summary

This design document establishes that **a plugin-controlled /goal-equivalent is feasible and safe**, with one blocking prerequisite: Claude Code team must clarify the Stop event input schema and plugin hook parity. The mechanism uses a deterministic, durable ledger-based completion predicate (all criteria pass) evaluated by a plugin Stop hook, guarded by four independent brakes against infinite loops and supported by three redundant escape hatches. Implementation is straightforward (new files autoloop.mjs, tests, CLI extensions) and rollout is opt-in per goal. The design honestly acknowledges what plugins cannot replicate (HUD, model tools, auto-clear) and positions the feature as a complementary alternative to native /goal, not a replacement.
