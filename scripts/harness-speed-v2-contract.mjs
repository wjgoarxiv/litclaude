#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContractError, SCENARIO_ID, fail, isObject, parseJson } from "./harness-speed-scenario.mjs";

const SCHEMA = "litfamily.harness-speed-v2/v2";
const RECEIPT_SCHEMA = "litfamily.harness-speed-v2-validation/v2";
const FIXTURE_SHA = "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be";
const FROZEN_BASELINE = Object.freeze({
  role: "frozen_pre_v2",
  head: "85c205e3e4ae5f5c7820545a1f78eff78fac93c9",
  status_sha256: "c199ad8baf5d7d2b157a3279e0f17efe98758e5cdfacc0a1501650ae1490022f",
  source_artifact_sha256: "74980bdc66c40eab8b471d0d03af3759dee1b9624bfd47476bf8d0875d66e0af",
  artifact_sha256: "9cee3b98b0311bfae8a930a6d7ca18e0222f17943e80d469211545421bc01759",
  fixture_sha256: FIXTURE_SHA,
});
const PHASES = Object.freeze(["session_start", "s1_activation", "s2_continuation", "no_route_floor"]);
const ARMS = Object.freeze(["baseline", "candidate"]);
const BASELINE_IDENTITY_KEYS = Object.freeze(["role", "head", "status_sha256", "source_artifact_sha256", "artifact_sha256", "fixture_sha256"]);
const CANDIDATE_IDENTITY_KEYS = Object.freeze([...BASELINE_IDENTITY_KEYS, "base_source_artifact_sha256"]);
const RECORD_KEYS = Object.freeze([
  "block", "arm", "phase", "sample", "start_ns", "end_ns", "context_bytes", "correct",
  "route_match", "banner_match", "body_match", "payload_match", "explicit_guard_applicable",
  "explicit_guard_passed", "compaction_guard_applicable", "compaction_guard_passed",
]);
const FORBIDDEN = new Set(["body", "prompt", "rawprompt", "prompttext", "promise", "unknown", "verdict", "result", "response", "transcript"]);
const SHA = /^[a-f0-9]{64}$/u;
const NS = /^(0|[1-9][0-9]{0,23})$/u;

const sameKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const normalizeKey = (key) => key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");

function assertNoForbiddenFields(value) {
  if (Array.isArray(value)) return value.forEach(assertNoForbiddenFields);
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(normalizeKey(key))) fail("FORBIDDEN_FIELD");
    assertNoForbiddenFields(child);
  }
}

function validateIdentity(identity, expectedRole, keys) {
  if (!sameKeys(identity, keys) || identity.role !== expectedRole || !/^[a-f0-9]{40}$/u.test(identity.head)
    || !SHA.test(identity.status_sha256) || !SHA.test(identity.source_artifact_sha256) || !SHA.test(identity.artifact_sha256)
    || identity.fixture_sha256 !== FIXTURE_SHA) fail("FIXTURE_IDENTITY_MISMATCH");
}

function validateIdentities(value) {
  if (!sameKeys(value, ARMS)) fail("INVALID_IDENTITIES");
  validateIdentity(value.baseline, "frozen_pre_v2", BASELINE_IDENTITY_KEYS);
  if (!isObject(value.candidate) || value.candidate.base_source_artifact_sha256 !== FROZEN_BASELINE.source_artifact_sha256) {
    fail("BASE_SOURCE_IDENTITY_MISMATCH");
  }
  if (!SHA.test(value.candidate.artifact_sha256 ?? "") || /^0+$/u.test(value.candidate.artifact_sha256)
    || value.candidate.artifact_sha256 === FROZEN_BASELINE.artifact_sha256) fail("CANDIDATE_ARTIFACT_MISMATCH");
  validateIdentity(value.candidate, "v2_candidate", CANDIDATE_IDENTITY_KEYS);
  if (BASELINE_IDENTITY_KEYS.some((key) => value.baseline[key] !== FROZEN_BASELINE[key])) fail("BASELINE_IDENTITY_MISMATCH");
  if (value.candidate.head !== FROZEN_BASELINE.head || value.candidate.status_sha256 === FROZEN_BASELINE.status_sha256
    || value.candidate.source_artifact_sha256 === FROZEN_BASELINE.source_artifact_sha256
    || /^0+$/u.test(value.candidate.status_sha256) || /^0+$/u.test(value.candidate.source_artifact_sha256)) fail("CANDIDATE_IDENTITY_MISMATCH");
}

function validateSelection(value) {
  if (sameKeys(value, ["kind", "phase"]) && value.kind === "latency" && PHASES.includes(value.phase)) return value;
  if (sameKeys(value, ["kind"]) && value.kind === "context") return value;
  fail("INVALID_SELECTION");
}

function validateProvider(value) {
  const keys = ["mode", "calls", "completions", "diagnostics"];
  const diagnosticKeys = ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"];
  if (!sameKeys(value, keys) || value.mode !== "provider_free" || value.calls !== 0 || value.completions !== 0
    || !sameKeys(value.diagnostics, diagnosticKeys)) fail("INVALID_PROVIDER_PROOF");
  for (const diagnostic of Object.values(value.diagnostics)) {
    if (!sameKeys(diagnostic, ["status", "reason"]) || diagnostic.status !== "UNAVAILABLE"
      || diagnostic.reason !== "PROVIDER_FREE") fail("INVALID_PROVIDER_PROOF");
  }
}

function validateRecord(record, expected) {
  if (!sameKeys(record, RECORD_KEYS) || record.block !== expected.block || record.arm !== expected.arm
    || record.phase !== expected.phase || record.sample !== expected.sample || !NS.test(record.start_ns)
    || !NS.test(record.end_ns) || BigInt(record.end_ns) <= BigInt(record.start_ns)
    || !Number.isSafeInteger(record.context_bytes) || record.context_bytes <= 0) fail("INVALID_SAMPLE_MATRIX");
  for (const key of RECORD_KEYS.slice(7)) if (typeof record[key] !== "boolean") fail("INVALID_SAMPLE_MATRIX");
}

function validateRecords(records) {
  if (!Array.isArray(records) || records.length !== 240) fail("INVALID_SAMPLE_MATRIX");
  let cursor = 0;
  for (let block = 1; block <= 6; block += 1) {
    const arms = block % 2 === 1 ? ARMS : [...ARMS].reverse();
    for (const arm of arms) for (const phase of PHASES) for (let sample = 1; sample <= 5; sample += 1) {
      validateRecord(records[cursor], { block, arm, phase, sample });
      cursor += 1;
    }
  }
}

const duration = (record) => BigInt(record.end_ns) - BigInt(record.start_ns);
const nearestRank = (values, percentile) => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  [Math.max(0, Math.ceil(percentile * values.length) - 1)];
const stats = (records) => ({ p50: nearestRank(records.map(duration), 0.5), p95: nearestRank(records.map(duration), 0.95) });
const stringifyStats = ({ p50, p95 }) => ({ p50: String(p50), p95: String(p95) });

function validateContextProof(proof, required) {
  if (!required && proof === null) return;
  if (!sameKeys(proof, ["status", "host", "surface", "mechanism", "deterministic", "body_sha256", "loaded_sha256"])
    || proof.status !== "OBSERVED" || proof.host !== "claude-code" || proof.surface !== "PreRequestContextLoad"
    || proof.mechanism !== "host_native_pre_request" || proof.deterministic !== true
    || !SHA.test(proof.body_sha256) || /^0+$/u.test(proof.body_sha256)
    || !SHA.test(proof.loaded_sha256) || /^0+$/u.test(proof.loaded_sha256)) {
    fail("INVALID_CONTEXT_PROOF");
  }
  if (proof.body_sha256 !== proof.loaded_sha256) fail("CONTEXT_HASH_MISMATCH");
}

export function validateV2Cohort(value) {
  assertNoForbiddenFields(value);
  if (!isObject(value) || !Object.hasOwn(value, "selected")) fail("INVALID_SELECTION");
  const selected = validateSelection(value.selected);
  const keys = ["schema", "scenario_id", "product", "measurement", "clock", "identities", "provider", "selected", "context_loader_proof", "records"];
  if (!sameKeys(value, keys) || value.schema !== SCHEMA || value.scenario_id !== SCENARIO_ID || value.product !== "litclaude"
    || value.measurement !== "provider_free_installed_hook_comparison" || value.clock !== "process.hrtime.bigint") fail("INVALID_V2_COHORT");
  validateIdentities(value.identities);
  validateProvider(value.provider);
  validateRecords(value.records);
  const byArm = Object.fromEntries(ARMS.map((arm) => [arm, value.records.filter((record) => record.arm === arm)]));
  const aggregate = Object.fromEntries(ARMS.map((arm) => [arm, stats(byArm[arm])]));
  const phaseStats = Object.fromEntries(PHASES.map((phase) => [phase, Object.fromEntries(ARMS.map((arm) => [arm,
    stats(byArm[arm].filter((record) => record.phase === phase))]))]));
  const early = stats(byArm.baseline.filter(({ block }) => block <= 3)).p95;
  const late = stats(byArm.baseline.filter(({ block }) => block >= 4)).p95;
  const driftDelta = early > late ? early - late : late - early;
  const context = Object.fromEntries(ARMS.map((arm) => [arm, byArm[arm].reduce((sum, record) => sum + record.context_bytes, 0)]));
  const contextRemoved = context.candidate < context.baseline;
  validateContextProof(value.context_loader_proof, contextRemoved || selected.kind === "context");
  const guardCoverage = ["explicit_guard", "compaction_guard"].every((guard) => value.records.some((record) => record[`${guard}_applicable`]));
  const correctness = guardCoverage && value.records.every((record) => record.correct && record.route_match && record.banner_match
    && record.body_match && record.payload_match && (!record.explicit_guard_applicable || record.explicit_guard_passed)
    && (!record.compaction_guard_applicable || record.compaction_guard_passed));
  const gates = {
    baseline_drift: driftDelta * 100n <= early * 20n,
    candidate_p50: aggregate.candidate.p50 <= aggregate.baseline.p50,
    candidate_p95: aggregate.candidate.p95 <= aggregate.baseline.p95,
    phase_p95: PHASES.every((phase) => phaseStats[phase].candidate.p95 <= phaseStats[phase].baseline.p95),
    selected_improvement: selected.kind === "latency"
      ? phaseStats[selected.phase].candidate.p95 * 100n <= phaseStats[selected.phase].baseline.p95 * 85n
      : context.candidate * 100 <= context.baseline * 75,
    correctness,
  };
  const verdict = !gates.baseline_drift ? "BLOCKED_ENVIRONMENT_DRIFT" : Object.values(gates).every(Boolean) ? "PASS" : "FAIL";
  return {
    schema: RECEIPT_SCHEMA, verdict, scenario_id: SCENARIO_ID, product: "litclaude", record_count: value.records.length,
    identities: value.identities, selected, aggregate_latency_ns: Object.fromEntries(ARMS.map((arm) => [arm, stringifyStats(aggregate[arm])])),
    phase_latency_ns: Object.fromEntries(PHASES.map((phase) => [phase, Object.fromEntries(ARMS.map((arm) => [arm, stringifyStats(phaseStats[phase][arm])]))])),
    baseline_drift_ratio: Number(driftDelta) / Number(early), context_reduction_ratio: (context.baseline - context.candidate) / context.baseline,
    context_bytes: context, gates, provider: value.provider, provider_calls: 0, provider_completions: 0,
  };
}

function main() {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) fail("USAGE");
  const receipt = validateV2Cohort(parseJson(readFileSync(inputPath, "utf8")));
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.verdict === "PASS" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    const errorCode = error instanceof ContractError ? error.code : "INPUT_READ_FAILED";
    process.stdout.write(`${JSON.stringify({ schema: RECEIPT_SCHEMA, verdict: "INVALID", error_code: errorCode, provider_calls: 0, provider_completions: 0 })}\n`);
    process.exitCode = errorCode === "USAGE" ? 64 : 65;
  }
}
