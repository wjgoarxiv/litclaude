#!/usr/bin/env node
// Installed-resource tamper and repair probe.
//
// Installs the shipped CLI into isolated temp roots, proves the installed doctor/integrity gate
// passes, corrupts one pinned resource, proves the gate fails with the specific integrity code,
// restores the resource, and proves the gate passes again. Then it removes the temp roots and
// prints a cleanup receipt that is measured, not asserted.
//
// No live profile is read or written: LITCLAUDE_HOME and CLAUDE_CONFIG_DIR are both redirected
// into temp roots for every child process.
//
// Usage:
//   node scripts/qa-installed-tamper-repair.mjs [--json]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { cleanupAll, formatCleanupReceipt, isolatedInstall } from "./qa-real-surface-lib.mjs";

// One executable or injected resource from each managed runtime lane, so a manifest that drifts
// for only one lane cannot hide behind the others.
const TARGETS = [
  "skills/visual-qa/scripts/evidence.mjs",
  "skills/frontend-ui-ux/scripts/design-contract-rules.mjs",
  "lib/added-comment-lines.mjs",
  "lib/rules/engine.mjs",
  "scripts/scaffold-plan.mjs",
  "skills/litresearch/ATTRIBUTION.md",
  "skills/litwork/SKILL.md",
  "skills/lit-team/scripts/team.mjs",
];

function doctorPhase(handle, label) {
  const result = handle.doctor();
  const output = `${result.stdout}\n${result.stderr}`;
  return {
    phase: label,
    exit_code: result.status,
    integrity_pass: /SKILL_RESOURCE_INTEGRITY_PASS/u.test(output),
    integrity_fail: /SKILL_RESOURCE_INTEGRITY_FAIL/u.test(output),
    catalog_missing: /DOCTOR_FAIL: LitClaude install is missing /u.test(output),
    codes: [...new Set([...output.matchAll(/RESOURCE_(?:HASH_MISMATCH|MISSING)/gu)].map(([code]) => code))],
    doctor_pass: /DOCTOR_PASS/u.test(output),
    excerpt: (/SKILL_RESOURCE_INTEGRITY_(?:PASS|FAIL)[^\n]*/u.exec(output)?.[0] ?? output.trim().split("\n").at(-1) ?? "").slice(0, 240),
  };
}

function main() {
  const json = process.argv.slice(2).includes("--json");
  const phases = [];
  let ok = true;
  const fail = (message) => {
    ok = false;
    phases.push({ phase: "error", exit_code: null, excerpt: message });
  };

  const handle = isolatedInstall({ label: "tamper" });
  phases.push({
    phase: "isolated install",
    exit_code: handle.install.status,
    excerpt: handle.install.status === 0
      ? `plugin path: ${handle.pluginPath}`
      : (handle.install.stderr.trim() || handle.install.stdout.trim()).slice(0, 240),
  });

  if (handle.install.status !== 0 || handle.pluginPath === "") {
    fail("isolated install did not complete; tamper and repair could not be exercised");
  } else {
    const baseline = doctorPhase(handle, "baseline doctor (pristine install)");
    phases.push(baseline);
    if (!(baseline.exit_code === 0 && baseline.integrity_pass && baseline.doctor_pass)) {
      fail("pristine installed doctor did not pass; nothing further can be trusted");
    } else {
      for (const target of TARGETS) {
        const path = join(handle.pluginPath, target);
        if (!existsSync(path)) {
          fail(`pinned resource is absent from the install: ${target}`);
          continue;
        }
        const original = readFileSync(path);

        writeFileSync(path, Buffer.concat([original, Buffer.from("\n// tamper-repair probe\n")]));
        const mutated = doctorPhase(handle, `tampered bytes: ${target}`);
        phases.push(mutated);
        if (!(mutated.exit_code !== 0 && mutated.integrity_fail && mutated.codes.includes("RESOURCE_HASH_MISMATCH"))) {
          fail(`byte tamper on ${target} did not produce RESOURCE_HASH_MISMATCH`);
        }

        rmSync(path);
        const removed = doctorPhase(handle, `removed resource: ${target}`);
        phases.push(removed);
        const missingDetected =
          (removed.integrity_fail && removed.codes.includes("RESOURCE_MISSING")) ||
          (removed.catalog_missing && removed.excerpt.includes(target));
        if (!(removed.exit_code !== 0 && missingDetected)) {
          fail(`removing ${target} did not produce RESOURCE_MISSING or a canonical catalog missing-file failure`);
        }

        writeFileSync(path, original);
        const restored = doctorPhase(handle, `restored resource: ${target}`);
        phases.push(restored);
        if (!(restored.exit_code === 0 && restored.integrity_pass && restored.doctor_pass)) {
          fail(`restoring ${target} did not return the installed doctor to PASS`);
        }
      }
    }
  }

  const cleanup = cleanupAll();
  if (cleanup.status !== "complete") ok = false;

  const summary = {
    schema_version: "litfamily.installed-tamper-repair/v1",
    verdict: ok ? "PASS" : "FAIL",
    targets: TARGETS,
    phases,
    cleanup,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write("INSTALLED TAMPER AND REPAIR — isolated temp roots, no live profile touched\n\n");
    for (const phase of phases) {
      const codes = phase.codes?.length ? ` codes=[${phase.codes.join(" ")}]` : "";
      process.stdout.write(`  ${phase.phase}\n    exit=${phase.exit_code}${codes}\n    ${phase.excerpt}\n`);
    }
    process.stdout.write(`\n${formatCleanupReceipt(cleanup)}\n`);
  }

  if (!ok) {
    process.stderr.write("INSTALLED_TAMPER_REPAIR_FAIL\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("INSTALLED_TAMPER_REPAIR_PASS\n");
}

main();
