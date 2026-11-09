#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRules, scanNegationClusters, scanText } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
// The caller reads this output through a bounded pipe. A flood of repeated hits must not grow the
// output past that bound, because an overflow is read as a scanner failure and the write goes through.
const MAX_FINDINGS = 64;

// Keep every block finding ahead of warnings so a block can never be trimmed away, then restore scan order.
const boundFindings = (findings) => {
  if (findings.length <= MAX_FINDINGS) return findings;
  const indexed = findings.map((finding, index) => ({ finding, index }));
  const blocks = indexed.filter(({ finding }) => finding.severity === "block");
  const others = indexed.filter(({ finding }) => finding.severity !== "block");
  return [...blocks, ...others].slice(0, MAX_FINDINGS).sort((a, b) => a.index - b.index).map(({ finding }) => finding);
};

// An edit is scanned as the whole proposed file so fences, quotes and paragraph breaks keep their
// meaning; `changed` lists the edited 1-based line ranges, and only findings that touch one are kept.
// A document-scope finding lists the lines its occurrences sit on, so an edit between two old
// occurrences does not revive it. Filtering happens before the bound so findings on unchanged lines can
// never crowd out a new one.
const touchesChange = (finding, changed) => changed.some(([start, end]) => (Array.isArray(finding.lines)
  ? finding.lines.some((line) => line >= start && line <= end)
  : finding.line <= end && (finding.endLine ?? finding.line) >= start));

try {
  const raw = readFileSync(0);
  if (raw.length > MAX_INPUT_BYTES) throw new Error("input exceeds the bounded scan size");
  const request = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(request.artifacts) || request.artifacts.length > 16) throw new Error("invalid artifact list");
  let totalBytes = 0;
  const rules = parseRules(readFileSync(resolve(here, "../rules.json"), "utf8"));
  const findings = [];
  for (const artifact of request.artifacts) {
    if (typeof artifact?.text !== "string" || typeof artifact?.path !== "string") throw new Error("invalid artifact record");
    totalBytes += Buffer.byteLength(artifact.text, "utf8");
    if (totalBytes > MAX_INPUT_BYTES) throw new Error("aggregate content exceeds the bounded scan size");
    const changed = artifact.changed;
    if (changed !== undefined && (!Array.isArray(changed) || !changed.every((range) => Array.isArray(range)
      && range.length === 2 && range.every(Number.isInteger)))) throw new Error("invalid changed ranges");
    const hits = [...scanText(artifact.text, rules, artifact.path), ...scanNegationClusters(artifact.text, artifact.path)];
    findings.push(...(changed ? hits.filter((finding) => touchesChange(finding, changed)) : hits));
  }
  process.stdout.write(`${JSON.stringify({ findings: boundFindings(findings), total: findings.length })}\n`);
} catch {
  process.stderr.write("lit-humanizer scanner failed\n");
  process.exitCode = 1;
}
