#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ContractError,
  PHASES,
  SCENARIO_ID,
  UNAVAILABLE,
  VALIDATION_SCHEMA,
  fail,
  isObject,
  parseJson,
  validateScenarioText,
} from "./harness-speed-scenario.mjs";

const SCHEMA = "litfamily.harness-speed/v1";
const ARMS = ["baseline", "candidate", "control"];
const REQUIRED = [
  "schema", "scenario_id", "product", "arm", "block", "order", "sequence", "phase",
  "prompt_bytes", "prompt_sha256", "response_bytes", "response_sha256", "sentinel_match",
  "route_observed", "output_policy_match", "correct", "failure_code", "timed_out",
  "start_offset_ms", "first_content_offset_ms", "final_receipt_offset_ms", "exit_offset_ms",
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens",
];
const FORBIDDEN = new Set([
  "prompt", "response", "transcript", "url", "requestid", "threadid", "sessionid",
  "credential", "authorization", "cookie", "apikey", "rawprompt", "prompttext",
  "rawresponse", "responsetext",
]);

const isSafeCounter = (value) => value === UNAVAILABLE || Number.isSafeInteger(value) && value >= 0;
const isTime = (value) => Number.isFinite(value) && value >= 0;
const phaseContract = (id) => PHASES.find(([phase]) => phase === id);

function assertPrivate(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertPrivate(item);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key.toLowerCase().replaceAll(/[^a-z0-9]/gu, ""))) fail("FORBIDDEN_FIELD");
    assertPrivate(child);
  }
}

function validateRecord(record, index) {
  if (!isObject(record)) fail("INVALID_RECORD");
  assertPrivate(record);
  if (Object.keys(record).length !== REQUIRED.length || REQUIRED.some((key) => !Object.hasOwn(record, key))) {
    fail("INVALID_RECORD_SHAPE");
  }
  const expected = phaseContract(record.phase);
  if (record.schema !== SCHEMA || record.scenario_id !== SCENARIO_ID || record.product !== "litclaude"
    || !ARMS.includes(record.arm) || !Number.isInteger(record.block) || record.block < 1 || record.block > 6
    || !Number.isInteger(record.order) || record.order < 1 || record.order > 3
    || record.sequence !== index + 1 || !expected
    || record.prompt_bytes !== expected[1] || record.prompt_sha256 !== expected[2]
    || !Number.isSafeInteger(record.response_bytes) || record.response_bytes < 0
    || !/^[a-f0-9]{64}$/u.test(record.response_sha256)) fail("INVALID_RECORD");
  for (const key of ["sentinel_match", "route_observed", "output_policy_match", "correct", "timed_out"]) {
    if (typeof record[key] !== "boolean") fail("INVALID_RECORD");
  }
  if (record.failure_code !== null && (typeof record.failure_code !== "string"
    || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(record.failure_code))) {
    fail("INVALID_FAILURE_CODE");
  }
  for (const key of ["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens"]) {
    if (!isSafeCounter(record[key])) fail("INVALID_COUNTER");
  }
  if (!isTime(record.start_offset_ms) || !isTime(record.final_receipt_offset_ms)
    || !isTime(record.exit_offset_ms) || record.start_offset_ms > record.final_receipt_offset_ms
    || record.final_receipt_offset_ms > record.exit_offset_ms) fail("INVALID_TIME");
  if (record.first_content_offset_ms !== UNAVAILABLE
    && (!isTime(record.first_content_offset_ms) || record.first_content_offset_ms < record.start_offset_ms
      || record.first_content_offset_ms > record.final_receipt_offset_ms)) fail("INVALID_TIME");
  if (record.sentinel_match
    && (record.response_bytes !== expected[3] || record.response_sha256 !== expected[4])) fail("INVALID_RESPONSE_HASH");
  const successObserved = record.sentinel_match && record.route_observed && record.output_policy_match
    && record.timed_out === false;
  if ((record.failure_code === null) !== successObserved) fail("INCONSISTENT_FAILURE_CODE");
  const derivedCorrect = successObserved && record.failure_code === null;
  if (record.correct !== derivedCorrect) fail("FALSE_CORRECTNESS_CLAIM");
}

function validateShape(records) {
  if (!Array.isArray(records) || records.length !== 54) fail("INVALID_COHORT_SIZE");
  records.forEach(validateRecord);
  const permutations = [];
  let cursor = 0;
  for (let block = 1; block <= 6; block += 1) {
    const arms = [];
    for (let order = 1; order <= 3; order += 1) {
      const session = records.slice(cursor, cursor + 3);
      const arm = session[0].arm;
      if (session.some((record, phaseIndex) => record.block !== block || record.order !== order
        || record.arm !== arm || record.phase !== PHASES[phaseIndex][0])) fail("INVALID_SESSION_ORDER");
      arms.push(arm);
      cursor += 3;
    }
    if (new Set(arms).size !== 3) fail("MISSING_ARM");
    permutations.push(arms.join(","));
  }
  if (new Set(permutations).size !== 6) fail("DUPLICATE_ARM_PERMUTATION");
  for (const arm of ARMS) {
    const armRecords = records.filter((record) => record.arm === arm);
    if (armRecords.filter((record) => record.phase === "B0").length !== 6
      || armRecords.filter((record) => record.phase !== "B0").length !== 12) fail("INVALID_ARM_COUNT");
  }
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function diagnostic(records) {
  const inputs = records.map(({ input_tokens: value }) => value);
  const cacheReads = records.map(({ cache_read_tokens: value }) => value);
  const numeric = inputs.every(Number.isSafeInteger) && cacheReads.every(Number.isSafeInteger);
  const inputSum = numeric ? inputs.reduce((sum, value) => sum + value, 0) : 0;
  const compatible = numeric && records.every((record) => record.input_tokens >= record.cache_read_tokens);
  const correctTurns = records.filter(({ correct }) => correct).length;
  return {
    cache_read_share: numeric && inputSum > 0
      ? cacheReads.reduce((sum, value) => sum + value, 0) / inputSum : UNAVAILABLE,
    uncached_input_per_correct_turn: compatible && correctTurns > 0
      ? records.reduce((sum, record) => sum + record.input_tokens - record.cache_read_tokens, 0) / correctTurns
      : UNAVAILABLE,
  };
}

export function validateCohort(value) {
  if (!isObject(value)) fail("INVALID_COHORT");
  assertPrivate(value);
  if (Object.keys(value).length !== 4 || value.schema !== SCHEMA || value.scenario_id !== SCENARIO_ID
    || value.product !== "litclaude") fail("INVALID_COHORT");
  validateShape(value.records);
  const measured = value.records.filter(({ phase }) => phase !== "B0");
  const byArm = Object.fromEntries(ARMS.map((arm) => [arm, measured.filter((record) => record.arm === arm)]));
  const latencies = Object.fromEntries(ARMS.map((arm) => [arm,
    byArm[arm].map((record) => record.exit_offset_ms - record.start_offset_ms)]));
  const latencyStats = Object.fromEntries(ARMS.map((arm) => [arm, {
    p50: nearestRank(latencies[arm], 0.5), p95: nearestRank(latencies[arm], 0.95),
  }]));
  const ratios = byArm.candidate.map((candidate) => {
    const baseline = byArm.baseline.find(({ block, phase }) => block === candidate.block && phase === candidate.phase);
    return (candidate.exit_offset_ms - candidate.start_offset_ms)
      / (baseline.exit_offset_ms - baseline.start_offset_ms);
  });
  const controlFirst = latencies.control.slice(0, 6);
  const controlLast = latencies.control.slice(6);
  const controlFirstP95 = nearestRank(controlFirst, 0.95);
  const controlLastP95 = nearestRank(controlLast, 0.95);
  const controlDrift = controlFirstP95 > 0
    ? Math.abs(controlLastP95 - controlFirstP95) / controlFirstP95 : UNAVAILABLE;
  const numericInputs = [...byArm.baseline, ...byArm.candidate]
    .every(({ input_tokens: value }) => Number.isSafeInteger(value));
  const inputTotals = numericInputs ? {
    baseline: byArm.baseline.reduce((sum, record) => sum + record.input_tokens, 0),
    candidate: byArm.candidate.reduce((sum, record) => sum + record.input_tokens, 0),
  } : { baseline: UNAVAILABLE, candidate: UNAVAILABLE };
  const pairedMedianRatio = nearestRank(ratios, 0.5);
  const gates = {
    correctness: ARMS.every((arm) => value.records.filter((record) => record.arm === arm)
      .every(({ correct, failure_code: failureCode, timed_out: timedOut }) => correct && failureCode === null && !timedOut)),
    candidate_p95: latencyStats.candidate.p95 <= latencyStats.baseline.p95 * 0.85,
    candidate_p50: latencyStats.candidate.p50 <= latencyStats.baseline.p50,
    paired_ratio: pairedMedianRatio <= 0.85,
    control_drift: controlDrift !== UNAVAILABLE && controlDrift <= 0.2,
    anti_padding: numericInputs && inputTotals.candidate <= inputTotals.baseline,
  };
  const candidateCache = byArm.candidate.map(({ cache_read_tokens: value }) => value);
  const compatibleCache = [...byArm.baseline, ...byArm.candidate]
    .every((record) => Number.isSafeInteger(record.input_tokens)
      && Number.isSafeInteger(record.cache_read_tokens) && record.input_tokens >= record.cache_read_tokens);
  const candidateCacheSum = candidateCache.every(Number.isSafeInteger)
    ? candidateCache.reduce((sum, value) => sum + value, 0) : 0;
  const latencySaved = compatibleCache && candidateCacheSum > 0
    ? (latencies.baseline.reduce((sum, value) => sum + value, 0)
      - latencies.candidate.reduce((sum, value) => sum + value, 0)) / (candidateCacheSum / 1000)
    : UNAVAILABLE;
  const verdict = !gates.control_drift ? "BLOCKED_ENVIRONMENT_DRIFT"
    : Object.values(gates).every(Boolean) ? "PASS" : "FAIL";
  return {
    schema: VALIDATION_SCHEMA,
    scenario_id: SCENARIO_ID,
    product: "litclaude",
    verdict,
    record_count: value.records.length,
    latency_ms: latencyStats,
    paired_median_ratio: pairedMedianRatio,
    control_drift_ratio: controlDrift,
    input_token_totals: inputTotals,
    gates,
    diagnostics: {
      baseline: diagnostic(byArm.baseline),
      candidate: diagnostic(byArm.candidate),
      control: diagnostic(byArm.control),
      latency_saved_ms_per_1k_cache_read_tokens: latencySaved,
    },
    provider_calls: 0,
  };
}

function main() {
  const [mode, inputPath] = process.argv.slice(2);
  if (!inputPath || !["scenario", "cohort"].includes(mode)) fail("USAGE");
  const text = readFileSync(inputPath, "utf8");
  const receipt = mode === "scenario" ? validateScenarioText(text) : validateCohort(parseJson(text));
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.verdict === "PASS" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const code = error instanceof ContractError ? error.code : "INPUT_READ_FAILED";
    process.stdout.write(`${JSON.stringify({ schema: VALIDATION_SCHEMA, verdict: "INVALID", error_code: code, provider_calls: 0 })}\n`);
    process.exitCode = code === "USAGE" ? 64 : 65;
  }
}
