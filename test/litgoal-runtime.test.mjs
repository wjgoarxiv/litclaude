import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "bin", "litclaude-ai.js");

const makeCwd = () => mkdtempSync(join(tmpdir(), "litclaude-litgoal-test-"));

const runCli = (cwd, args) =>
  spawnSync(process.execPath, [binPath, "litgoal", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });

const runCliAsync = (cwd, args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, "litgoal", ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readJsonl = (path) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe("litgoal runtime", () => {
  it("creates durable goal files from a brief and records a ledger entry", () => {
    const cwd = makeCwd();
    try {
      const result = runCli(cwd, ["create-goals", "--brief", "Ship v0.2.0 workflow parity", "--json"]);

      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "active");
      assert.equal(output.objective, "Ship v0.2.0 workflow parity");

      const stateDir = join(cwd, ".litclaude", "litgoal");
      assert.equal(readFileSync(join(stateDir, "brief.md"), "utf8"), "Ship v0.2.0 workflow parity\n");
      const state = readJson(join(stateDir, "goals.json"));
      assert.equal(state.objective, "Ship v0.2.0 workflow parity");
      assert.equal(state.criteria[0].id, "criterion-1");
      assert.equal(state.criteria[0].status, "pending");
      const [entry] = readJsonl(join(stateDir, "ledger.jsonl"));
      assert.equal(entry.event, "goal.created");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("treats the same objective as a byte-preserving no-op by default", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      const stateDir = join(cwd, ".litclaude", "litgoal");
      const paths = ["brief.md", "goals.json", "ledger.jsonl"].map((name) => join(stateDir, name));
      const before = paths.map((path) => readFileSync(path, "utf8"));

      const duplicate = runCli(cwd, ["create-goals", "--brief", "Ship parity", "--autoloop", "--json"]);

      assert.equal(duplicate.status, 0, duplicate.stderr);
      assert.match(JSON.parse(duplicate.stdout).message, /same objective already exists; no changes made/u);
      assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps a completed same objective as a byte-preserving no-op", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      runCli(cwd, ["record-evidence", "--criterion", "criterion-1", "--status", "pass", "--json", "{}"]);
      runCli(cwd, ["checkpoint", "--status", "complete", "--json"]);
      const stateDir = join(cwd, ".litclaude", "litgoal");
      const paths = ["brief.md", "goals.json", "ledger.jsonl"].map((name) => join(stateDir, name));
      const before = paths.map((path) => readFileSync(path, "utf8"));

      const duplicate = runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);

      assert.equal(duplicate.status, 0, duplicate.stderr);
      assert.match(JSON.parse(duplicate.stdout).message, /same objective already exists; no changes made/u);
      assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses a different active objective without --replace and preserves bytes", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "First objective", "--json"]);
      const stateDir = join(cwd, ".litclaude", "litgoal");
      const paths = ["brief.md", "goals.json", "ledger.jsonl"].map((name) => join(stateDir, name));
      const before = paths.map((path) => readFileSync(path, "utf8"));

      const refused = runCli(cwd, ["create-goals", "--brief", "Different objective", "--json"]);

      assert.equal(refused.status, 65);
      assert.match(JSON.parse(refused.stdout).error.message, /different active objective exists; use --replace/u);
      assert.deepEqual(paths.map((path) => readFileSync(path, "utf8")), before);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("--replace explicitly starts a fresh goal cycle", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "First objective", "--autoloop", "--json"]);
      const replaced = runCli(cwd, ["create-goals", "--brief", "Different objective", "--replace", "--json"]);

      assert.equal(replaced.status, 0, replaced.stderr);
      const output = JSON.parse(replaced.stdout);
      assert.equal(output.objective, "Different objective");
      assert.equal(output.status, "active");
      assert.equal(output.autoloop, false);
      assert.equal(output.criteria[0].status, "pending");
      const entries = readJsonl(join(cwd, ".litclaude", "litgoal", "ledger.jsonl"));
      assert.equal(entries.filter((entry) => entry.event === "goal.created").length, 2);
      assert.equal(entries.at(-1).replaced, true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("starts a different objective normally after an abandoned terminal goal", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "First objective", "--json"]);
      runCli(cwd, ["checkpoint", "--status", "abandoned", "--json"]);

      const next = runCli(cwd, ["create-goals", "--brief", "Different objective", "--json"]);

      assert.equal(next.status, 0, next.stderr);
      assert.equal(JSON.parse(next.stdout).objective, "Different objective");
      assert.equal(readJson(join(cwd, ".litclaude", "litgoal", "goals.json")).status, "active");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports status and lists criteria from current state", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);

      const status = runCli(cwd, ["status", "--json"]);
      assert.equal(status.status, 0, status.stderr);
      assert.equal(JSON.parse(status.stdout).objective, "Ship parity");

      const criteria = runCli(cwd, ["criteria", "--json"]);
      assert.equal(criteria.status, 0, criteria.stderr);
      assert.deepEqual(
        JSON.parse(criteria.stdout).criteria.map((criterion) => criterion.id),
        ["criterion-1"],
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("honors --json with a machine-readable missing-state error envelope", () => {
    const cwd = makeCwd();
    try {
      const status = runCli(cwd, ["status", "--json"]);

      assert.equal(status.status, 65);
      assert.equal(status.stderr, "");
      const report = JSON.parse(status.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.status, "error");
      assert.equal(report.command, "status");
      assert.equal(report.error.name, "LitgoalStateError");
      assert.equal(report.error.message, "litgoal state not found");
      assert.equal(report.error.exitCode, 65);
      assert.doesNotMatch(status.stdout, /at .*litclaude-ai|SyntaxError/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("appends evidence JSONL and updates criterion status", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      const result = runCli(cwd, [
        "record-evidence",
        "--criterion",
        "criterion-1",
        "--status",
        "pass",
        "--json",
        '{"artifact":".litclaude/evidence/pass.txt","command":"node --test"}',
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).criterion.status, "pass");
      const state = readJson(join(cwd, ".litclaude", "litgoal", "goals.json"));
      assert.equal(state.criteria[0].status, "pass");
      assert.equal(state.criteria[0].evidence[0].artifact, ".litclaude/evidence/pass.txt");
      const entries = readJsonl(join(cwd, ".litclaude", "litgoal", "ledger.jsonl"));
      assert.equal(entries.at(-1).event, "evidence.recorded");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("gates checkpoint completion on passing criteria", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);

      const blocked = runCli(cwd, ["checkpoint", "--status", "complete", "--json"]);
      assert.equal(blocked.status, 65);
      assert.equal(blocked.stderr, "");
      const blockedReport = JSON.parse(blocked.stdout);
      assert.equal(blockedReport.error.message, "criteria must pass before completion");

      runCli(cwd, [
        "record-evidence",
        "--criterion",
        "criterion-1",
        "--status",
        "pass",
        "--json",
        '{"artifact":".litclaude/evidence/pass.txt"}',
      ]);
      const completed = runCli(cwd, ["checkpoint", "--status", "complete", "--json"]);
      assert.equal(completed.status, 0, completed.stderr);
      assert.equal(JSON.parse(completed.stdout).status, "complete");
      assert.equal(readJson(join(cwd, ".litclaude", "litgoal", "goals.json")).status, "complete");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses checkpoint completion when criteria are empty", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      const goalsPath = join(cwd, ".litclaude", "litgoal", "goals.json");
      const state = readJson(goalsPath);
      state.criteria = [];
      writeFileSync(goalsPath, `${JSON.stringify(state, null, 2)}\n`);

      const blocked = runCli(cwd, ["checkpoint", "--status", "complete", "--json"]);

      assert.equal(blocked.status, 65);
      assert.match(JSON.parse(blocked.stdout).error.message, /non-empty criteria must pass before completion/u);
      assert.equal(readJson(goalsPath).status, "active");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("validates steering kind", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      const invalid = runCli(cwd, ["steer", "--kind", "surprise", "--note", "Nope"]);
      assert.equal(invalid.status, 64);
      assert.match(invalid.stderr, /invalid steering kind/i);
      assert.doesNotMatch(invalid.stderr, /at .*litclaude-ai/u);

      // Drift 6d: steering is structured again, so a valid steer now also carries
      // --evidence and --rationale. Kind validation still runs first and is unchanged.
      const valid = runCli(cwd, [
        "steer", "--kind", "scope", "--note", "Keep runtime local",
        "--evidence", "test/litgoal-runtime.test.mjs",
        "--rationale", "the remote path is out of scope for this objective",
        "--json",
      ]);
      assert.equal(valid.status, 0, valid.stderr);
      assert.equal(JSON.parse(valid.stdout).kind, "scope");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses controlled errors for corrupt state, missing criteria, and malformed evidence JSON", () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      const malformed = runCli(cwd, ["record-evidence", "--criterion", "criterion-1", "--json", "{bad"]);
      assert.equal(malformed.status, 64);
      assert.equal(malformed.stderr, "");
      const malformedReport = JSON.parse(malformed.stdout);
      assert.equal(malformedReport.error.message, "invalid litgoal JSON");
      assert.equal(malformedReport.error.exitCode, 64);
      assert.doesNotMatch(malformed.stdout, /at .*litclaude-ai|\{bad/u);

      const missing = runCli(cwd, ["record-evidence", "--criterion", "criterion-404", "--json", "{}"]);
      assert.equal(missing.status, 65);
      assert.equal(missing.stderr, "");
      const missingReport = JSON.parse(missing.stdout);
      assert.equal(missingReport.error.message, "unknown criterion");
      assert.doesNotMatch(missing.stdout, /at .*litclaude-ai/u);

      writeFileSync(join(cwd, ".litclaude", "litgoal", "goals.json"), "{bad");
      const corrupt = runCli(cwd, ["status", "--json"]);
      assert.equal(corrupt.status, 65);
      assert.equal(corrupt.stderr, "");
      const corruptReport = JSON.parse(corrupt.stdout);
      assert.equal(corruptReport.error.message, "corrupt litgoal state");
      assert.doesNotMatch(corrupt.stdout, /SyntaxError|at .*litclaude-ai/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps ledger JSONL parseable under parallel evidence appends", async () => {
    const cwd = makeCwd();
    try {
      runCli(cwd, ["create-goals", "--brief", "Ship parity", "--json"]);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          runCliAsync(cwd, [
            "record-evidence",
            "--criterion",
            "criterion-1",
            "--status",
            "pass",
            "--json",
            JSON.stringify({ artifact: `.litclaude/evidence/${index}.txt` }),
          ]),
        ),
      );

      for (const result of results) {
        assert.equal(result.status, 0, result.stderr);
      }
      const entries = readJsonl(join(cwd, ".litclaude", "litgoal", "ledger.jsonl"));
      assert.equal(entries.filter((entry) => entry.event === "evidence.recorded").length, 8);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
