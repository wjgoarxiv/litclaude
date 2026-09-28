#!/usr/bin/env node
// tools/assert-ci-workflow.mjs — DEC-E CI-integrity assertion (LitClaude adaptation).
// Reads every .github/workflows/*.yml as raw text and fails (exit 1) if any contains
// a forbidden token. Self-immune: forbidden strings are assembled from fragments.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS_DIR = resolve(ROOT, '.github', 'workflows');

// Forbidden tokens assembled from fragments — self-immunity: this file never
// contains the literal strings it guards.
const FORBIDDEN = [
  ['npm', ' ', 'publish'].join(''),
  ['NPM', '_TOKEN'].join(''),
  ['NODE', '_AUTH', '_TOKEN'].join(''),
  ['git', ' push'].join(''),
  ['git', ' tag'].join(''),
  ['--access', ' public'].join(''),
  ['id', '-token'].join(''),
];

let files;
try {
  files = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
} catch (err) {
  process.stderr.write(`[assert-ci-workflow] cannot read ${WORKFLOWS_DIR}: ${err.message}\n`);
  process.exit(1);
}

if (files.length === 0) {
  process.stderr.write(`[assert-ci-workflow] no workflow files found in ${WORKFLOWS_DIR}\n`);
  process.exit(1);
}

let failures = 0;

for (const file of files) {
  const filePath = join(WORKFLOWS_DIR, file);
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stderr.write(`[assert-ci-workflow] cannot read ${filePath}: ${err.message}\n`);
    failures += 1;
    continue;
  }
  const lower = text.toLowerCase();
  for (const token of FORBIDDEN) {
    if (lower.includes(token.toLowerCase())) {
      process.stderr.write(
        `[assert-ci-workflow] FAIL: forbidden token "${token}" found in ${file}\n`
      );
      failures += 1;
    }
  }
}

if (failures === 0) {
  process.stdout.write(`assert-ci-workflow OK: ${files.length} workflow(s) clean\n`);
  process.exit(0);
} else {
  process.stderr.write(`[assert-ci-workflow] ${failures} violation(s) found\n`);
  process.exit(1);
}
