#!/usr/bin/env node
// Negative gate matrix — replacement real-surface QA for the UI/UX and Visual QA lanes.
//
// Every row below is exercised by a real command against the real shipped runtime: the
// validators and CLIs under plugins/litclaude/skills/frontend-ui-ux and
// plugins/litclaude/skills/visual-qa, the shipped bin/litclaude-ai.js install and doctor, and
// the shipped pack payload guard. Nothing here reimplements a rule it is checking.
//
// Reporting contract:
//   - one line per row: row name, expected outcome, observed outcome, PASS/FAIL/BLOCKED
//   - PASS    the row produced its stated outcome
//   - FAIL    the row was exercised and produced something else
//   - BLOCKED the row could not be exercised at all; the exact reason is printed
//   - a row is never silently dropped and a BLOCKED row is never counted as a pass
//   - exit 0 only when every row is PASS
//
// Usage:
//   node scripts/qa-negative-gate-matrix.mjs [--json] [--negative-control[=<row-id>]]
//
// --negative-control feeds one row a deliberately wrong expectation. The probe must then report
// that row as FAIL and exit non-zero; if it does not, the probe cannot detect a real regression
// and its green results are worthless.
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import {
  boundedPng,
  cleanupAll,
  designContract,
  formatCleanupReceipt,
  isolatedInstall,
  repoRoot,
  runDesignContractValidator,
  runVisualQa,
  tempRoot,
  writeEvidenceBundle,
} from "./qa-real-surface-lib.mjs";

class RowBlocked extends Error {
  constructor(reason) {
    super(reason);
    this.name = "RowBlocked";
  }
}

// Reduces a validate-evidence run to a single comparable token. A PASS verdict always reduces
// to "PASS" and can never be recoloured as a code, so the reduction cannot manufacture the
// answer a row wants. A non-PASS verdict reduces to an accepted code only when the shipped
// runtime genuinely emitted that code; otherwise it reduces to the raw verdict and code list,
// which will not match any expectation.
function reduceEvidence(result, accept) {
  if (result.signal) throw new RowBlocked(`validate-evidence timed out (signal ${result.signal})`);
  const text = result.stdout.trim();
  if (text === "") {
    throw new RowBlocked(`validate-evidence emitted no machine-readable report; stderr: ${result.stderr.trim()}`);
  }
  let report;
  try {
    report = JSON.parse(text);
  } catch (error) {
    throw new RowBlocked(`validate-evidence report is not JSON: ${error.message}`);
  }
  const codes = [...new Set([
    ...(report.blocked_codes ?? []),
    ...(report.failure_codes ?? []),
    ...(report.codes ?? []),
  ])];
  const detail = `exit=${result.status} verdict=${report.verdict} codes=[${codes.join(" ")}]`;
  if (report.verdict === "PASS") return { observed: "PASS", detail };
  const matched = codes.find((code) => accept.includes(code));
  if (matched) return { observed: matched, detail };
  if (accept.includes(report.verdict)) return { observed: report.verdict, detail };
  return { observed: `${report.verdict}[${codes.join(" ")}]`, detail };
}

function validateBundle(label, accept, options) {
  const dir = tempRoot(`bundle-${label}`);
  const bundle = writeEvidenceBundle(dir, options);
  const result = runVisualQa([
    "validate-evidence",
    bundle.manifestPath,
    "--tier",
    bundle.manifest.tier,
    "--now",
    bundle.nowIso,
    "--current-source-hash",
    bundle.manifest.source_hash,
    "--current-source-revision",
    bundle.manifest.source_revision,
  ]);
  return reduceEvidence(result, accept);
}

// --- rows ------------------------------------------------------------------

function rowValidDesignContract() {
  const dir = tempRoot("contract-valid");
  const path = join(dir, "design-contract.json");
  writeFileSync(path, `${JSON.stringify(designContract(), null, 2)}\n`);
  const result = runDesignContractValidator([path]);
  const text = result.stdout.trim();
  if (result.status !== 0 || text === "") {
    return {
      observed: `FAIL[exit=${result.status}]`,
      detail: `exit=${result.status} stderr=${result.stderr.trim()} stdout=${text}`,
    };
  }
  const report = JSON.parse(text);
  return {
    observed: report.valid === true && report.evidence_eligible === true
      && report.schema === "litfamily.design-contract/v1beta2" && report.issues.length === 0
      ? "PASS" : "FAIL",
    detail: `exit=0 schema=${report.schema} valid=${report.valid} evidenceEligible=${report.evidence_eligible} issues=${report.issues.length}`,
  };
}

function rowMalformedContract() {
  const dir = tempRoot("contract-malformed");
  const body = JSON.stringify(designContract(), null, 2);
  // A duplicate root key is invisible to JSON.parse (last one wins) and is exactly the class of
  // input a lenient reader accepts silently. The bytes are written by hand for that reason.
  const duplicated = body.replace(
    '"contract_id": "contract:operations-dashboard",',
    '"contract_id": "contract:operations-dashboard",\n  "contract_id": "contract:smuggled",',
  );
  if (duplicated === body) throw new RowBlocked("could not inject a duplicate root key into the contract bytes");

  const cases = [
    ["duplicate-key", `${duplicated}\n`, /DESIGN_CONTRACT_DUPLICATE_JSON_KEY/u],
    ["malformed-json", `${body}\ntrailing garbage\n`, /DESIGN_CONTRACT_UNTRUSTED_JSON/u],
  ];
  const sub = cases.map(([name, bytes, expectedCode]) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, bytes);
    const result = runDesignContractValidator([path]);
    const stderr = result.stderr.trim();
    return {
      name,
      ok: result.status !== 0 && expectedCode.test(stderr),
      note: `exit=${result.status} ${stderr}`,
    };
  });
  const detail = sub.map(({ name, ok, note }) => `${name}=${ok ? "FAIL-as-required" : "UNEXPECTED"}(${note})`).join(" | ");
  if (sub.every(({ ok }) => ok)) return { observed: "FAIL", detail };
  if (sub.some(({ note }) => note.startsWith("exit=0"))) return { observed: "PASS", detail };
  return { observed: "FAIL[unexpected-code]", detail };
}

function rowBoundedMedia() {
  const dir = tempRoot("bounded-media");
  const reference = join(dir, "reference.png");
  const actual = join(dir, "actual.png");
  const png = boundedPng(32, 24);
  writeFileSync(reference, png);
  writeFileSync(actual, png);
  const asciiCapture = join(dir, "ascii.txt");
  writeFileSync(asciiCapture, "┌──────┐\n│ jobs │\n└──────┘\n");
  const cjkCapture = join(dir, "cjk.txt");
  // Four columns of content: two wide CJK glyphs occupy the same cells as four ASCII columns.
  writeFileSync(cjkCapture, "┌────┐\n│한글│\n│job │\n└────┘\n");

  const sub = [];
  const image = runVisualQa(["image-diff", reference, actual]);
  const imageReport = image.status === 0 && image.stdout.trim() ? JSON.parse(image.stdout) : null;
  sub.push({
    name: "png",
    ok: Boolean(imageReport)
      && imageReport.dimensionsMatch === true
      && imageReport.diffPixels === 0
      && imageReport.similarityScore === 100,
    note: imageReport
      ? `dimensionsMatch=${imageReport.dimensionsMatch} diffPixels=${imageReport.diffPixels} similarity=${imageReport.similarityScore}`
      : `exit=${image.status} stderr=${image.stderr.trim()}`,
  });

  for (const [name, path, columns] of [["tui", asciiCapture, 8], ["cjk", cjkCapture, 6]]) {
    const run = runVisualQa(["tui-check", path, "--cols", String(columns)]);
    const report = run.stdout.trim() ? JSON.parse(run.stdout) : null;
    sub.push({
      name,
      ok: run.status === 0 && report?.verdict === "PASS"
        && (name !== "cjk" || report.wideCharColumns.length > 0),
      note: report
        ? `verdict=${report.verdict} codes=[${report.codes.join(" ")}] maxWidth=${report.maxWidth}/${columns} wideCols=${report.wideCharColumns.length}`
        : `exit=${run.status} stderr=${run.stderr.trim()}`,
    });
  }
  const detail = sub.map(({ name, ok, note }) => `${name}=${ok ? "PASS" : "FAIL"}(${note})`).join(" ");
  return { observed: sub.every(({ ok }) => ok) ? "PASS" : "FAIL", detail };
}

function rowForbiddenPackagePaths() {
  const guard = spawnSync(process.execPath, [join(repoRoot, "tools", "check-pack-payload.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (guard.signal) throw new RowBlocked(`pack payload guard timed out (signal ${guard.signal})`);
  const stdout = (guard.stdout ?? "").trim();
  const stderr = (guard.stderr ?? "").trim();
  if (guard.status === 0) {
    const match = /(\d+) file\(s\) checked, none forbidden/u.exec(stdout);
    if (!match) throw new RowBlocked(`pack payload guard exited 0 without a countable receipt: ${stdout}`);
    return { observed: "0", detail: `exit=0 checked=${match[1]} forbidden=0` };
  }
  const offenders = /(\d+) forbidden file\(s\) found/u.exec(stderr);
  return {
    observed: offenders ? offenders[1] : `FAIL[exit=${guard.status}]`,
    detail: `exit=${guard.status} ${stderr}`,
  };
}

// The install-backed rows share one isolated install. Both roots are temp roots registered with
// the cleanup ledger; no live profile is read or written.
function installedRows() {
  const handle = isolatedInstall({ label: "matrix" });
  if (handle.install.status !== 0 || handle.pluginPath === "") {
    const reason = `isolated install failed (exit=${handle.install.status}): ${handle.install.stderr.trim() || handle.install.stdout.trim()}`;
    return {
      tampered: () => { throw new RowBlocked(reason); },
      restored: () => { throw new RowBlocked(reason); },
    };
  }
  const pinned = join(handle.pluginPath, "skills", "visual-qa", "scripts", "evidence.mjs");
  const backupDir = tempRoot("matrix-pinned-backup");
  const backup = join(backupDir, "evidence.mjs");

  const baseline = handle.doctor();
  if (baseline.status !== 0) {
    const reason = `installed doctor did not pass before tampering (exit=${baseline.status}): ${baseline.stderr.trim()}`;
    return {
      tampered: () => { throw new RowBlocked(reason); },
      restored: () => { throw new RowBlocked(reason); },
    };
  }
  copyFileSync(pinned, backup);

  return {
    tampered() {
      writeFileSync(pinned, `${readFileSync(pinned, "utf8")}\n// real-surface tamper probe\n`);
      const result = handle.doctor();
      const output = `${result.stdout}\n${result.stderr}`;
      const detail = `exit=${result.status} ${/(SKILL_RESOURCE_INTEGRITY_FAIL.*)/u.exec(output)?.[1]?.slice(0, 220) ?? output.trim().slice(-220)}`;
      if (result.status === 0) return { observed: "PASS", detail };
      if (!/SKILL_RESOURCE_INTEGRITY_FAIL/u.test(output) || !/RESOURCE_HASH_MISMATCH/u.test(output)) {
        return { observed: "FAIL[unexpected-code]", detail };
      }
      return { observed: "FAIL", detail };
    },
    restored() {
      copyFileSync(backup, pinned);
      const result = handle.doctor();
      const output = `${result.stdout}\n${result.stderr}`;
      return {
        observed: result.status === 0 && /DOCTOR_PASS/u.test(output) ? "PASS" : `FAIL[exit=${result.status}]`,
        detail: `exit=${result.status} ${/SKILL_RESOURCE_INTEGRITY_PASS: \d+ resources/u.exec(output)?.[0] ?? output.trim().slice(-200)}`,
      };
    },
  };
}

function buildRows() {
  const installed = installedRows();
  return [
    {
      id: "valid-design-contract",
      name: "valid design contract",
      expected: "PASS",
      accept: ["PASS"],
      run: rowValidDesignContract,
    },
    {
      id: "malformed-duplicate-key-contract",
      name: "malformed / duplicate-key contract",
      expected: "FAIL",
      accept: ["FAIL"],
      run: rowMalformedContract,
    },
    {
      id: "valid-evidence-bundle",
      name: "well-formed public evidence bundle",
      expected: "BLOCKED_EVIDENCE_FRESHNESS_UNPROVEN",
      accept: ["BLOCKED_EVIDENCE_FRESHNESS_UNPROVEN"],
      run: (accept) => validateBundle("valid", accept, {}),
    },
    {
      id: "missing-capture",
      name: "missing capture",
      expected: "EVIDENCE_ARTIFACT_MISSING",
      accept: ["EVIDENCE_ARTIFACT_MISSING"],
      run: (accept) => validateBundle("missing-capture", accept, {
        mutateFiles: (dir) => {
          renameSync(join(dir, "capture.png"), join(dir, "capture.removed"));
        },
      }),
    },
    {
      id: "stale-evidence",
      name: "stale evidence",
      expected: "BLOCKED_EVIDENCE_STALE",
      accept: ["BLOCKED_EVIDENCE_STALE"],
      run: (accept) => validateBundle("stale", accept, {
        mutateManifest: (manifest, { now }) => {
          manifest.created_at = new Date(now - (manifest.maximum_age + 600) * 1000).toISOString();
        },
      }),
    },
    {
      id: "future-dated-evidence",
      name: "future-dated evidence",
      expected: "BLOCKED_EVIDENCE_FUTURE",
      accept: ["BLOCKED_EVIDENCE_FUTURE"],
      run: (accept) => validateBundle("future", accept, {
        mutateManifest: (manifest, { now }) => {
          manifest.created_at = new Date(now + 3_600_000).toISOString();
        },
      }),
    },
    {
      id: "auth-unavailable",
      name: "auth unavailable",
      expected: "BLOCKED_AUTH_UNAVAILABLE",
      accept: ["BLOCKED_AUTH_UNAVAILABLE"],
      run: (accept) => validateBundle("auth", accept, {
        mutateManifest: (manifest) => { manifest.capabilities.auth = false; },
      }),
    },
    {
      id: "renderer-ownership-unverified",
      name: "renderer ownership unverified",
      expected: "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED",
      accept: ["BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED"],
      run: (accept) => validateBundle("ownership", accept, {
        mutateManifest: (manifest) => { manifest.capture_environment.renderer = "unknown"; },
      }),
    },
    {
      id: "capture-bytes-changed-after-manifest",
      name: "capture bytes changed after manifest",
      expected: "FAIL",
      accept: ["FAIL", "EVIDENCE_ARTIFACT_HASH_INVALID"],
      run: (accept) => {
        const result = validateBundle("capture-drift", accept, {
          mutateFiles: (dir) => {
            writeFileSync(join(dir, "capture.png"), boundedPng(320, 640, 1));
          },
        });
        // The row's stated outcome is FAIL; the specific code proves it failed for the right
        // reason rather than by accident.
        if (result.observed === "EVIDENCE_ARTIFACT_HASH_INVALID") return { ...result, observed: "FAIL" };
        if (result.observed === "FAIL") return { ...result, observed: "FAIL[missing EVIDENCE_ARTIFACT_HASH_INVALID]" };
        return result;
      },
    },
    {
      id: "incomplete-cleanup",
      name: "incomplete cleanup",
      expected: "BLOCKED_CLEANUP_INCOMPLETE",
      accept: ["BLOCKED_CLEANUP_INCOMPLETE"],
      run: (accept) => validateBundle("cleanup", accept, {
        mutateManifest: (manifest) => {
          manifest.cleanup = {
            status: "incomplete",
            resources: [{ id: "resource:test-server", state: "leaked", receipt: "port 4173 still bound" }],
          };
        },
      }),
    },
    {
      id: "same-context-self-review",
      name: "same-context self-review",
      expected: "FAIL",
      accept: ["FAIL", "REVIEW_RECEIPT_INDEPENDENCE_INVALID"],
      run: (accept) => {
        const result = validateBundle("self-review", accept, {
          tier: "full",
          legacy: true,
          mutateManifest: (manifest) => {
            for (const receipt of manifest.review_receipts) {
              receipt.fresh_context_id = "context:implementer";
              receipt.implementer_context = true;
            }
          },
        });
        if (result.observed === "REVIEW_RECEIPT_INDEPENDENCE_INVALID") return { ...result, observed: "FAIL" };
        if (result.observed === "FAIL") return { ...result, observed: "FAIL[missing REVIEW_RECEIPT_INDEPENDENCE_INVALID]" };
        return result;
      },
    },
    {
      id: "reviewer-unavailable",
      name: "reviewer unavailable",
      expected: "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
      accept: ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"],
      run: (accept) => validateBundle("reviewer", accept, {
        tier: "full",
        legacy: true,
        mutateManifest: (manifest) => { manifest.capabilities.independent_review = false; },
      }),
    },
    {
      id: "unsafe-test-account",
      name: "unsafe test account",
      expected: "BLOCKED_TEST_ACCOUNT_UNSAFE",
      accept: ["BLOCKED_TEST_ACCOUNT_UNSAFE"],
      run: (accept) => validateBundle("test-account", accept, {
        mutateManifest: (manifest) => { manifest.capabilities.test_account_safe = false; },
      }),
    },
    {
      id: "bounded-png-tui-cjk",
      name: "bounded PNG / TUI / CJK cases",
      expected: "PASS",
      accept: ["PASS"],
      run: rowBoundedMedia,
    },
    {
      id: "tampered-installed-resource",
      name: "tampered installed resource",
      expected: "FAIL",
      accept: ["FAIL"],
      run: () => installed.tampered(),
    },
    {
      id: "restored-installed-resource",
      name: "restored installed resource",
      expected: "PASS",
      accept: ["PASS"],
      run: () => installed.restored(),
    },
    {
      id: "forbidden-package-paths",
      name: "forbidden package paths",
      expected: "0",
      accept: ["0"],
      run: rowForbiddenPackagePaths,
    },
  ];
}

function parseArgs(argv) {
  const options = { json: false, negativeControl: null };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--negative-control") options.negativeControl = "valid-evidence-bundle";
    else if (arg.startsWith("--negative-control=")) options.negativeControl = arg.slice("--negative-control=".length);
    else {
      process.stderr.write(`unknown option: ${arg}\n`);
      process.exit(64);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = buildRows();

  if (options.negativeControl) {
    const target = rows.find(({ id }) => id === options.negativeControl);
    if (!target) {
      process.stderr.write(`unknown --negative-control row: ${options.negativeControl}\n`);
      process.exit(64);
    }
    // Deliberately wrong expectation: the row's real outcome is known-good, so a probe that
    // still reports PASS here is not actually comparing anything.
    target.expected = "BLOCKED_NEGATIVE_CONTROL_SENTINEL";
    target.accept = ["BLOCKED_NEGATIVE_CONTROL_SENTINEL"];
    target.negativeControl = true;
  }

  const results = [];
  for (const row of rows) {
    let entry;
    try {
      const outcome = row.run(row.accept);
      entry = {
        id: row.id,
        name: row.name,
        expected: row.expected,
        observed: outcome.observed,
        status: row.accept.includes(outcome.observed) ? "PASS" : "FAIL",
        detail: outcome.detail,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      entry = {
        id: row.id,
        name: row.name,
        expected: row.expected,
        observed: "NOT_EXERCISED",
        status: "BLOCKED",
        detail: `blocked reason: ${reason}`,
      };
    }
    if (row.negativeControl) entry.negative_control = true;
    results.push(entry);
  }

  const cleanup = cleanupAll();
  const failed = results.filter(({ status }) => status !== "PASS");
  const summary = {
    schema_version: "litfamily.negative-gate-matrix/v1",
    row_count: results.length,
    pass_count: results.filter(({ status }) => status === "PASS").length,
    fail_count: results.filter(({ status }) => status === "FAIL").length,
    blocked_count: results.filter(({ status }) => status === "BLOCKED").length,
    negative_control: options.negativeControl ?? null,
    rows: results,
    cleanup,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const nameWidth = Math.max(...results.map(({ name }) => name.length));
    const expectedWidth = Math.max(...results.map(({ expected }) => expected.length));
    process.stdout.write("NEGATIVE GATE MATRIX — real shipped runtime\n");
    process.stdout.write("legend: PASS row produced its stated outcome | FAIL it did not | BLOCKED row could not be exercised\n\n");
    for (const row of results) {
      process.stdout.write(
        `[${row.status.padEnd(7)}] ${row.name.padEnd(nameWidth)}  expected: ${row.expected.padEnd(expectedWidth)}  observed: ${row.observed}\n`
        + `            ${row.detail}\n`,
      );
    }
    process.stdout.write(`\nROWS: ${summary.row_count}  PASS: ${summary.pass_count}  FAIL: ${summary.fail_count}  BLOCKED: ${summary.blocked_count}\n`);
    if (options.negativeControl) {
      process.stdout.write(`NEGATIVE_CONTROL: ${options.negativeControl} was fed a deliberately wrong expectation\n`);
    }
    process.stdout.write(`${formatCleanupReceipt(cleanup)}\n`);
  }

  if (cleanup.status !== "complete") {
    process.stderr.write("NEGATIVE_GATE_MATRIX_FAIL: temp resources leaked\n");
    process.exitCode = 2;
    return;
  }
  if (failed.length > 0) {
    process.stderr.write(
      `NEGATIVE_GATE_MATRIX_FAIL: ${failed.length} row(s) did not match expectation: ${failed.map(({ id }) => id).join(", ")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write("NEGATIVE_GATE_MATRIX_PASS\n");
}

main();
