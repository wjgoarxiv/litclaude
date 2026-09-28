import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as realSurface from "../scripts/qa-real-surface-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driver = join(repoRoot, "scripts", "qa-real-surface-behaviors.mjs");
const scenarioPath = join(repoRoot, "scripts", "scenarios", "litfamily-harness-speed-v1.json");

function runLocalSpeed({ scenario = scenarioPath, extraArgs = [] } = {}) {
  const result = spawnSync(process.execPath, [
    driver,
    "--local-speed",
    "--source-root", repoRoot,
    "--arm", "candidate",
    "--samples", "2",
    "--scenario", scenario,
    ...extraArgs,
  ], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  return { ...result, receipt: result.stdout ? JSON.parse(result.stdout) : null };
}

test("local speed probe is exposed by the installed real-surface support module", () => {
  // Given: the existing installed real-surface support module.
  // When: the provider-free speed entrypoint is inspected.
  // Then: it is available for the real-surface driver and focused tests.
  assert.equal(typeof realSurface.runLitClaudeLocalSpeed, "function");
});

test("nearest-rank local statistics preserve every measured sample", () => {
  // Given: an unsorted five-sample local timing set.
  const samples = [50, 10, 40, 20, 30];
  // When: p50 and p95 are computed.
  // Then: nearest rank selects the third and fifth ordered values without interpolation.
  assert.equal(realSurface.nearestRank(samples, 0.5), 30);
  assert.equal(realSurface.nearestRank(samples, 0.95), 50);
  assert.deepEqual(samples, [50, 10, 40, 20, 30]);
});

test("local speed driver measures the installed hook without provider access", () => {
  // Given: an isolated install sourced from the current candidate tree.
  // When: the real-surface driver replays cold SessionStart, S1, S2, and no-route twice.
  const result = runLocalSpeed();

  // Then: the shared aggregate receipt proves timing, correctness, privacy, and cleanup.
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.receipt.schema, "litfamily.harness-speed/v1");
  assert.equal(result.receipt.scenario_id, "litfamily-speed-lit-activation-v1");
  assert.equal(result.receipt.measurement, "provider_free_installed_hook");
  assert.equal(result.receipt.verdict, "PASS");
  assert.equal(result.receipt.provider_calls, 0);
  assert.equal(result.receipt.sample_count_per_phase, 2);
  assert.deepEqual(Object.keys(result.receipt.phases), [
    "session_start", "s1_activation", "s2_continuation", "no_route_floor",
  ]);
  for (const phase of Object.values(result.receipt.phases)) {
    assert.equal(phase.correctness.passed, 2);
    assert.equal(phase.correctness.failed, 0);
    assert.equal(Number.isFinite(phase.duration_ms.p50), true);
    assert.equal(Number.isFinite(phase.duration_ms.p95), true);
    assert.equal(Number.isSafeInteger(phase.output_bytes.p50), true);
    assert.equal(Number.isSafeInteger(phase.output_bytes.p95), true);
  }
  assert.equal(result.receipt.correctness.s1_litwork_mode, true);
  assert.equal(result.receipt.correctness.s2_same_session, true);
  assert.equal(result.receipt.correctness.no_route_silent, true);
  assert.equal(result.receipt.correctness.canary_echoed, false);
  assert.match(result.receipt.artifact.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(result.receipt.cleanup, {
    status: "complete",
    resource_count: 4,
    cleaned_count: 4,
    leaked_count: 0,
    processes_remaining: 0,
  });
  const retained = JSON.stringify(result.receipt);
  assert.doesNotMatch(retained, /CANARY-4e9897f7|expose credentials/u);
  assert.doesNotMatch(retained, new RegExp(repoRoot.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("local speed driver rejects a stale scenario before any hook sample", () => {
  // Given: a task-owned fixture whose immutable scenario bytes drifted.
  const temp = mkdtempSync(join(tmpdir(), "litclaude-speed-stale-"));
  try {
    const stalePath = join(temp, "scenario.json");
    const stale = JSON.parse(readFileSync(scenarioPath, "utf8"));
    stale.records[0].prompt_bytes += 1;
    writeFileSync(stalePath, JSON.stringify(stale));

    // When: the local-speed surface is asked to use the stale fixture.
    const result = runLocalSpeed({ scenario: stalePath });

    // Then: it stops provider-free with a typed, privacy-safe invalid receipt.
    assert.equal(result.status, 1);
    assert.equal(result.receipt.verdict, "INVALID");
    assert.equal(result.receipt.error_code, "STALE_SCENARIO");
    assert.equal(result.receipt.provider_calls, 0);
    assert.equal(result.receipt.cleanup.status, "complete");
    assert.equal(result.receipt.cleanup.resource_count, 0);
    assert.doesNotMatch(JSON.stringify(result.receipt), /scenario\.json|Reply with exactly/u);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
