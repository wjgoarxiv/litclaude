// Phase 7 runtime drifts 6a / 6b / 6d / 6e for the litgoal runtime.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runLitgoalCli } from "../plugins/litclaude/lib/litgoal/cli.mjs";
import { litgoalGoalsPath, litgoalSessionArchivePath } from "../plugins/litclaude/lib/litgoal/paths.mjs";

const temps = [];
const makeCwd = () => {
  const dir = mkdtempSync(join(tmpdir(), "litgoal-"));
  temps.push(dir);
  return dir;
};

const run = (cwd, ...argv) => {
  const out = [];
  const err = [];
  const code = runLitgoalCli(argv, { stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) } }, cwd);
  return { code, stdout: out.join(""), stderr: err.join("") };
};

const state = (cwd) => JSON.parse(readFileSync(litgoalGoalsPath(cwd), "utf8"));

const seed = (cwd, { sessionId } = {}) => {
  const args = ["create-goals", "--brief", "ship the parser fix"];
  if (sessionId) args.push("--session-id", sessionId);
  const result = run(cwd, ...args);
  assert.equal(result.code, 0, result.stderr);
  return result;
};

const passOnlyCriterion = (cwd) => {
  const criterionId = state(cwd).criteria[0].id;
  const result = run(cwd, "record-evidence", "--criterion", criterionId, "--status", "pass", "--json", '{"artifact":"a.txt"}');
  assert.equal(result.code, 0, result.stderr);
  return criterionId;
};

afterEach(() => {
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
});

describe("6a — session scoping", () => {
  it("records the session id on the state it creates", () => {
    const cwd = makeCwd();
    seed(cwd, { sessionId: "sess-1" });
    assert.equal(state(cwd).sessionId, "sess-1");
  });

  it("a completed goal plus a FRESH session id opens new state and leaves the old intact", () => {
    const cwd = makeCwd();
    seed(cwd, { sessionId: "sess-1" });
    passOnlyCriterion(cwd);
    assert.equal(run(cwd, "checkpoint", "--status", "complete").code, 0);
    assert.equal(state(cwd).status, "complete");

    const second = run(cwd, "create-goals", "--brief", "a different objective", "--session-id", "sess-2");
    assert.equal(second.code, 0, second.stderr);

    const fresh = state(cwd);
    assert.equal(fresh.sessionId, "sess-2");
    assert.equal(fresh.objective, "a different objective");
    assert.equal(fresh.status, "active");

    const archived = litgoalSessionArchivePath(cwd, "sess-1");
    assert.equal(existsSync(archived), true, "the completed session must be preserved, not discarded");
    const old = JSON.parse(readFileSync(archived, "utf8"));
    assert.equal(old.objective, "ship the parser fix");
    assert.equal(old.status, "complete");
    assert.equal(old.criteria[0].evidence.length, 1, "the old session keeps its evidence");
  });

  it("a completed SAME objective rolls over when the session id is fresh", () => {
    const cwd = makeCwd();
    seed(cwd, { sessionId: "sess-1" });
    passOnlyCriterion(cwd);
    assert.equal(run(cwd, "checkpoint", "--status", "complete").code, 0);

    const second = run(cwd, "create-goals", "--brief", "ship the parser fix", "--session-id", "sess-2");
    assert.equal(second.code, 0, second.stderr);
    assert.equal(state(cwd).sessionId, "sess-2");
    assert.equal(state(cwd).objective, "ship the parser fix");
    assert.equal(state(cwd).status, "active");
    assert.equal(existsSync(litgoalSessionArchivePath(cwd, "sess-1")), true);
  });

  it("an ACTIVE goal is still protected — a fresh session id does not silently discard it", () => {
    const cwd = makeCwd();
    seed(cwd, { sessionId: "sess-1" });
    const second = run(cwd, "create-goals", "--brief", "something else", "--session-id", "sess-2");
    assert.notEqual(second.code, 0, "an active goal must not be replaced by a new session id alone");
    assert.equal(state(cwd).objective, "ship the parser fix");
  });

  it("the same session id keeps the existing behavior", () => {
    const cwd = makeCwd();
    seed(cwd, { sessionId: "sess-1" });
    const again = run(cwd, "create-goals", "--brief", "ship the parser fix", "--session-id", "sess-1");
    assert.equal(again.code, 0);
    assert.match(again.stdout, /already exists/u);
  });

  for (const status of ["active", "review_blocked", "blocked", "needs_user_decision"]) {
    it(`requires --replace before create-goals can replace ${status} state`, () => {
      const cwd = makeCwd();
      seed(cwd, { sessionId: "sess-1" });
      if (status === "review_blocked") {
        assert.equal(run(cwd, "record-review-blockers", "--blocker", "keep this blocker").code, 0);
      } else if (status !== "active") {
        assert.equal(run(cwd, "checkpoint", "--status", status, "--note", `keep ${status}`).code, 0);
      }

      const before = readFileSync(litgoalGoalsPath(cwd), "utf8");
      const brief = status === "active" ? "a different objective" : "ship the parser fix";
      const refused = run(cwd, "create-goals", "--brief", brief, "--session-id", "sess-1");
      assert.notEqual(refused.code, 0, `${status} must be treated as nonterminal`);
      assert.match(`${refused.stdout}${refused.stderr}`, /--replace/u);
      assert.equal(readFileSync(litgoalGoalsPath(cwd), "utf8"), before, "refusal must preserve state bytes");
      if (status === "review_blocked") assert.deepEqual(state(cwd).blockers.map(({ blocker }) => blocker), ["keep this blocker"]);

      const replaced = run(cwd, "create-goals", "--brief", brief, "--session-id", "sess-1", "--replace");
      assert.equal(replaced.code, 0, replaced.stderr);
      assert.equal(state(cwd).status, "active");
      assert.equal(state(cwd).objective, brief);
    });
  }
});

describe("6b — status enum", () => {
  it("record-review-blockers actually moves the goal to review_blocked", () => {
    const cwd = makeCwd();
    seed(cwd);
    assert.equal(state(cwd).status, "active");
    const result = run(cwd, "record-review-blockers", "--blocker", "reviewer found a scope gap");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(state(cwd).status, "review_blocked", "a recorded review blocker must be visible in the goal status");
  });

  it("a review-blocked goal is distinguishable from a plain blocked one", () => {
    const cwd = makeCwd();
    seed(cwd);
    run(cwd, "record-review-blockers", "--blocker", "x");
    const blocked = state(cwd);
    assert.equal(blocked.status, "review_blocked");
    assert.notEqual(blocked.status, "blocked");
  });

  it("needs_user_decision is representable through checkpoint", () => {
    const cwd = makeCwd();
    seed(cwd);
    const result = run(cwd, "checkpoint", "--status", "needs_user_decision", "--note", "two viable schemas");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(state(cwd).status, "needs_user_decision");
  });

  it("still rejects a status outside the enum", () => {
    const cwd = makeCwd();
    seed(cwd);
    assert.notEqual(run(cwd, "checkpoint", "--status", "vibes").code, 0);
  });

  it("completion still requires every criterion to pass", () => {
    const cwd = makeCwd();
    seed(cwd);
    assert.notEqual(run(cwd, "checkpoint", "--status", "complete").code, 0);
  });
});

describe("6d — structured steering", () => {
  it("requires --evidence and --rationale", () => {
    const cwd = makeCwd();
    seed(cwd);
    const noEvidence = run(cwd, "steer", "--kind", "scope", "--note", "narrow it");
    assert.notEqual(noEvidence.code, 0);
    assert.match(noEvidence.stderr, /evidence/u);

    const noRationale = run(cwd, "steer", "--kind", "scope", "--note", "narrow it", "--evidence", "test/x.test.mjs");
    assert.notEqual(noRationale.code, 0);
    assert.match(noRationale.stderr, /rationale/u);
  });

  it("records a fully structured steering decision", () => {
    const cwd = makeCwd();
    seed(cwd);
    const result = run(
      cwd,
      "steer", "--kind", "scope", "--note", "narrow to the parser",
      "--evidence", "test/parser.test.mjs::red",
      "--rationale", "the lexer path is out of the objective",
    );
    assert.equal(result.code, 0, result.stderr);
    const [record] = state(cwd).steering;
    assert.equal(record.kind, "scope");
    assert.equal(record.evidence, "test/parser.test.mjs::red");
    assert.equal(record.rationale, "the lexer path is out of the objective");
  });
});

describe("6e — attempt-scoped evidence", () => {
  it("a retry appends a new attempt and never overwrites the prior evidence", () => {
    const cwd = makeCwd();
    seed(cwd);
    const criterionId = state(cwd).criteria[0].id;

    run(cwd, "record-evidence", "--criterion", criterionId, "--status", "fail", "--json", '{"artifact":"attempt-1.log"}');
    run(cwd, "record-evidence", "--criterion", criterionId, "--status", "pass", "--json", '{"artifact":"attempt-2.log"}');

    const [criterion] = state(cwd).criteria;
    assert.equal(criterion.evidence.length, 2, "both attempts must survive");
    assert.deepEqual(criterion.evidence.map((e) => e.attempt), [1, 2]);
    assert.equal(criterion.evidence[0].artifact, "attempt-1.log", "the failed attempt is still readable");
    assert.equal(criterion.evidence[0].status, "fail");
    assert.equal(criterion.evidence[1].status, "pass");
    assert.equal(criterion.status, "pass", "the criterion reflects the latest attempt");
    assert.equal(criterion.attempts, 2);
  });

  it("rejects forced non-pass evidence against a completed goal without changing completion", () => {
    const cwd = makeCwd();
    seed(cwd);
    const criterionId = passOnlyCriterion(cwd);
    run(cwd, "checkpoint", "--status", "complete");

    const refused = run(cwd, "record-evidence", "--criterion", criterionId, "--status", "fail", "--json", "{}");
    assert.notEqual(refused.code, 0, "completed evidence must not be silently overwritten");
    // `--json` routes the error to stdout as a JSON envelope rather than to stderr.
    assert.match(`${refused.stdout}${refused.stderr}`, /--force/u);
    assert.equal(state(cwd).criteria[0].evidence.length, 1);

    const forced = run(cwd, "record-evidence", "--criterion", criterionId, "--status", "fail", "--force", "--json", "{}");
    assert.notEqual(forced.code, 0, "--force must not make complete state contradict non-pass criterion state");
    assert.match(`${forced.stdout}${forced.stderr}`, /complete.*non-pass|non-pass.*complete/iu);
    assert.equal(state(cwd).status, "complete");
    assert.equal(state(cwd).criteria[0].status, "pass");
    assert.equal(state(cwd).criteria[0].evidence.length, 1);
  });

  it("also rejects forced blocked evidence against a completed goal", () => {
    const cwd = makeCwd();
    seed(cwd);
    const criterionId = passOnlyCriterion(cwd);
    assert.equal(run(cwd, "checkpoint", "--status", "complete").code, 0);
    const before = readFileSync(litgoalGoalsPath(cwd), "utf8");

    const forced = run(cwd, "record-evidence", "--criterion", criterionId, "--status", "blocked", "--force", "--json", "{}");
    assert.notEqual(forced.code, 0);
    assert.match(`${forced.stdout}${forced.stderr}`, /complete.*non-pass|non-pass.*complete/iu);
    assert.equal(readFileSync(litgoalGoalsPath(cwd), "utf8"), before);
  });

  it("rejects every runtime-owned evidence field instead of allowing JSON to forge it", () => {
    const cwd = makeCwd();
    seed(cwd);
    const criterionId = state(cwd).criteria[0].id;

    for (const [key, value] of [
      ["attempt", 99],
      ["status", "pass"],
      ["recordedAt", "1900-01-01T00:00:00.000Z"],
      ["id", "forged-evidence-id"],
      ["criterionId", "criterion-forged"],
    ]) {
      const before = readFileSync(litgoalGoalsPath(cwd), "utf8");
      const result = run(
        cwd,
        "record-evidence", "--criterion", criterionId, "--status", "fail", "--json", JSON.stringify({ [key]: value }),
      );
      assert.notEqual(result.code, 0, `${key} must be runtime-owned`);
      assert.match(`${result.stdout}${result.stderr}`, new RegExp(`reserved evidence key.*${key}`, "iu"));
      assert.equal(readFileSync(litgoalGoalsPath(cwd), "utf8"), before, `${key} rejection must not mutate state`);
    }

    const [criterion] = state(cwd).criteria;
    assert.equal(criterion.status, "pending");
    assert.equal(criterion.attempts, undefined);
    assert.deepEqual(criterion.evidence, []);
  });

  it("keeps the criterion status and attempt count consistent with runtime-owned evidence", () => {
    const cwd = makeCwd();
    seed(cwd);
    const criterionId = state(cwd).criteria[0].id;
    const result = run(
      cwd,
      "record-evidence", "--criterion", criterionId, "--status", "blocked", "--json", '{"artifact":"blocked.log"}',
    );
    assert.equal(result.code, 0, result.stderr);

    const [criterion] = state(cwd).criteria;
    const [record] = criterion.evidence;
    assert.equal(record.attempt, 1);
    assert.equal(record.status, "blocked");
    assert.match(record.recordedAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(criterion.status, record.status);
    assert.equal(criterion.attempts, record.attempt);
  });
});
