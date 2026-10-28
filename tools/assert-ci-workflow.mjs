#!/usr/bin/env node
// tools/assert-ci-workflow.mjs — DEC-E CI-integrity assertion (LitClaude adaptation).
// Reads every .github/workflows/*.yml as raw text and fails (exit 1) if any contains
// a forbidden token. Self-immune: forbidden strings are assembled from fragments.
// One exception: publish.yml may request an OIDC token for npm trusted publishing, but only
// as a hand-run workflow that stages a version; the staged version stays private until the
// maintainer approves it on npmjs.com with two-factor authentication.
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
const OIDC = ['id', '-token'].join('');
const PUBLISH_FILE = 'publish.yml';
const STAGE = ['npm', ' stage', ' publish'].join('');
const AUTOMATIC_TRIGGERS = ['push:', 'pull_request', 'schedule:', 'workflow_run', 'repository_dispatch'];

// Returns the violations for one workflow file.
export function checkWorkflow(file, text) {
  const lower = text.toLowerCase();
  const violations = [];
  const isPublish = file === PUBLISH_FILE;
  for (const token of FORBIDDEN) {
    if (isPublish && token === OIDC) continue;
    if (lower.includes(token.toLowerCase())) violations.push(`forbidden token "${token}" found in ${file}`);
  }
  if (isPublish && lower.includes(OIDC)) {
    if (!lower.includes('workflow_dispatch')) violations.push(`${file} requests ${OIDC} but is not hand-run (workflow_dispatch)`);
    for (const trigger of AUTOMATIC_TRIGGERS) {
      if (lower.includes(trigger)) violations.push(`${file} requests ${OIDC} but has the automatic trigger "${trigger}"`);
    }
    if (!lower.includes(STAGE)) violations.push(`${file} requests ${OIDC} but does not stage with "${STAGE}"`);
  }
  return violations;
}

function main() {
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
    for (const violation of checkWorkflow(file, text)) {
      process.stderr.write(`[assert-ci-workflow] FAIL: ${violation}\n`);
      failures += 1;
    }
  }

  if (failures === 0) {
    process.stdout.write(`assert-ci-workflow OK: ${files.length} workflow(s) clean\n`);
    process.exit(0);
  } else {
    process.stderr.write(`[assert-ci-workflow] ${failures} violation(s) found\n`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
