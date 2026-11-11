#!/usr/bin/env node
// Negative gate matrix — real-surface QA for the installed resource pins and the pack payload guard.
//
// Every row below is exercised by a real command against the real shipped runtime: the shipped
// bin/litclaude-ai.js install and doctor, and the shipped pack payload guard. Nothing here
// reimplements a rule it is checking. The design-contract, evidence and PNG/TUI rows left with
// frontend-ui-ux and visual-qa, which moved to the design plugin of the wjgoarxiv-skills marketplace.
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
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import {
  cleanupAll,
  formatCleanupReceipt,
  isolatedInstall,
  repoRoot,
  tempRoot,
} from "./qa-real-surface-lib.mjs";

class RowBlocked extends Error {
  constructor(reason) {
    super(reason);
    this.name = "RowBlocked";
  }
}

// --- rows ------------------------------------------------------------------

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
  const pinned = join(handle.pluginPath, "skills", "frontend-ui-ux", "scripts", "interface-probe-rules.mjs");
  const backupDir = tempRoot("matrix-pinned-backup");
  const backup = join(backupDir, "interface-probe-rules.mjs");

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
    else if (arg === "--negative-control") options.negativeControl = "restored-installed-resource";
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
