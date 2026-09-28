// Local-only measurements for provider cache usage and rule-body deduplication.
//
// Provider cache percentages are valid only when a Claude transcript contains
// provider usage fields. This module never returns transcript text, rule bodies,
// file contents, secrets, or network metadata.

import { dirname } from "node:path";
import { MAX_BOUNDED_FILE_BYTES, readRegularStable } from "./secure-path-read.mjs";
import { dedupeByBody } from "./rules/format.mjs";

const MAX_TRANSCRIPT_BYTES = MAX_BOUNDED_FILE_BYTES;

const emptyTotals = () => ({
  inputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  observedInputTokens: 0,
});

const emptyProviderMeasurement = (reason) => ({
  status: "UNPROVEN",
  reason,
  cacheHitRate: null,
  cacheReadRate: null,
  cacheReuseRate: null,
  totals: emptyTotals(),
  receipt: null,
});

const toToken = (value) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

const safeAdd = (left, right) => {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
};

const roundedPercent = (numerator, denominator) => {
  if (denominator <= 0) return null;
  return Math.round((numerator * 100 * 100) / denominator) / 100;
};

const parseUsageField = (usage, field) => {
  if (!Object.hasOwn(usage, field)) return { present: false, valid: true, value: 0 };
  const value = toToken(usage[field]);
  return { present: true, valid: value !== null, value: value ?? 0 };
};

const isCountableUsageEvent = (event) =>
  event?.isSidechain !== true
  && event?.isApiErrorMessage !== true
  && event?.message?.usage !== null
  && typeof event?.message?.usage === "object"
  && !Array.isArray(event.message.usage);

const forEachUsageEvent = (transcriptText, callback) => {
  if (typeof transcriptText !== "string") return;
  for (const line of transcriptText.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line);
      if (isCountableUsageEvent(event)) callback(event.message.usage);
    } catch {
      // A partial or unrelated JSONL line cannot establish a provider receipt.
    }
  }
};

const measureUsageText = (transcriptText) => {
  const totals = emptyTotals();
  let usageEvents = 0;
  let cacheUsageEvents = 0;
  let cacheFieldsSeen = false;
  let invalidFieldCount = 0;

  forEachUsageEvent(transcriptText, (usage) => {
    usageEvents += 1;
    const input = parseUsageField(usage, "input_tokens");
    const cacheRead = parseUsageField(usage, "cache_read_input_tokens");
    const cacheCreation = parseUsageField(usage, "cache_creation_input_tokens");
    const output = parseUsageField(usage, "output_tokens");
    const fields = [input, cacheRead, cacheCreation, output];

    if (cacheRead.present || cacheCreation.present) {
      cacheFieldsSeen = true;
      cacheUsageEvents += 1;
    }
    invalidFieldCount += fields.filter((field) => !field.valid).length;
    totals.inputTokens = safeAdd(totals.inputTokens, input.value);
    totals.cacheReadInputTokens = safeAdd(totals.cacheReadInputTokens, cacheRead.value);
    totals.cacheCreationInputTokens = safeAdd(totals.cacheCreationInputTokens, cacheCreation.value);
    totals.outputTokens = safeAdd(totals.outputTokens, output.value);
  });

  totals.observedInputTokens = safeAdd(
    safeAdd(totals.inputTokens, totals.cacheReadInputTokens),
    totals.cacheCreationInputTokens,
  );

  const receipt = usageEvents > 0
    ? { kind: "local-transcript-usage", usageEvents, cacheUsageEvents }
    : null;
  if (usageEvents === 0) return emptyProviderMeasurement("no-provider-usage-receipt");
  if (invalidFieldCount > 0) {
    return {
      ...emptyProviderMeasurement("invalid-provider-usage-fields"),
      totals,
      receipt,
    };
  }
  if (!cacheFieldsSeen) {
    return {
      ...emptyProviderMeasurement("cache-fields-not-exposed"),
      totals,
      receipt,
    };
  }
  if (totals.observedInputTokens <= 0) {
    return {
      ...emptyProviderMeasurement("zero-observed-input"),
      totals,
      receipt,
    };
  }

  // `cacheReadRate` is read tokens over all observed input tokens. The narrower
  // `cacheReuseRate` excludes uncached input and compares reads with cache writes.
  const cacheableInput = safeAdd(totals.cacheReadInputTokens, totals.cacheCreationInputTokens);
  return {
    status: "MEASURED",
    reason: null,
    cacheHitRate: roundedPercent(totals.cacheReadInputTokens, totals.observedInputTokens),
    cacheReadRate: roundedPercent(totals.cacheReadInputTokens, totals.observedInputTokens),
    cacheReuseRate: roundedPercent(totals.cacheReadInputTokens, cacheableInput),
    totals,
    receipt,
  };
};

/**
 * Measure cache reads from an in-memory transcript fixture.
 * The returned receipt contains counts only; no transcript fields are returned.
 */
export const measureProviderCacheFromText = (transcriptText) => measureUsageText(transcriptText);

/**
 * Read one regular, stable, bounded local transcript and measure its usage fields.
 * Symlinks, oversized files, and changing files are reported as UNPROVEN.
 */
export const measureProviderCache = (transcriptPath) => {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) {
    return emptyProviderMeasurement("transcript-path-not-provided");
  }
  try {
    const result = readRegularStable(dirname(transcriptPath), transcriptPath, undefined, { maxBytes: MAX_TRANSCRIPT_BYTES });
    if (result.failure) {
      return emptyProviderMeasurement(`transcript-${result.failure.toLowerCase().replaceAll("_", "-")}`);
    }
    return measureUsageText(result.bytes.toString("utf8"));
  } catch {
    return emptyProviderMeasurement("transcript-read-failed");
  }
};

/** Match HUD context sizing: latest non-sidechain provider usage event only. */
export const latestUsageTokensFromText = (transcriptText) => {
  let latest = null;
  forEachUsageEvent(transcriptText, (usage) => {
    const input = parseUsageField(usage, "input_tokens").value;
    const cacheRead = parseUsageField(usage, "cache_read_input_tokens").value;
    const cacheCreation = parseUsageField(usage, "cache_creation_input_tokens").value;
    latest = safeAdd(safeAdd(input, cacheRead), cacheCreation);
  });
  return latest ?? 0;
};

/** Match HUD context sizing while applying the same bounded local-file policy. */
export const latestUsageTokens = (transcriptPath) => {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) return 0;
  try {
    const result = readRegularStable(dirname(transcriptPath), transcriptPath, undefined, { maxBytes: MAX_TRANSCRIPT_BYTES });
    return result.failure ? 0 : latestUsageTokensFromText(result.bytes.toString("utf8"));
  } catch {
    return 0;
  }
};

const normalizeRuleBody = (body) => body.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").trim();

/**
 * Measure the existing rules-engine body deduplication without returning rule text.
 * The denominator is usable rule bodies; empty/malformed bodies stay outside it.
 */
export const measureRuleDedup = (rules) => {
  if (!Array.isArray(rules)) {
    return {
      status: "UNPROVEN",
      reason: "rules-not-provided",
      candidateRuleCount: 0,
      usableRuleCount: 0,
      uniqueRuleCount: 0,
      duplicateRuleCount: 0,
      dedupRate: null,
    };
  }

  const usableRules = rules.filter((rule) => typeof rule?.body === "string" && normalizeRuleBody(rule.body).length > 0);
  const uniqueRuleCount = dedupeByBody(usableRules).length;
  const duplicateRuleCount = usableRules.length - uniqueRuleCount;
  return {
    status: usableRules.length > 0 ? "MEASURED" : "UNPROVEN",
    reason: usableRules.length > 0 ? null : "no-usable-rules",
    candidateRuleCount: rules.length,
    usableRuleCount: usableRules.length,
    uniqueRuleCount,
    duplicateRuleCount,
    dedupRate: roundedPercent(duplicateRuleCount, usableRules.length),
  };
};
