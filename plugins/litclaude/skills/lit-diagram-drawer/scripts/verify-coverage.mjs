#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'references/type-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const refs = fs.existsSync(path.join(root, 'references')) ? fs.readdirSync(path.join(root, 'references')) : [];
const examplesDir = path.join(root, 'assets/examples');
const exampleFiles = fs.existsSync(examplesDir) ? fs.readdirSync(examplesDir).filter((name) => name.endsWith('.html')) : [];
const issues = [];

function audit(c, refNames, names) {
  const problems = [];
  const ids = c.entries.map((entry) => entry.id);
  if (c.source?.coreTypeCount !== 41 || c.source?.galleryEntryCount !== 61) problems.push('SOURCE_COUNTS');
  if (ids.length !== 61) problems.push('ENTRY_COUNT expected=61 actual=' + ids.length);
  if (new Set(ids).size !== ids.length) problems.push('DUPLICATE_ID');
  const expected = new Set();
  const refSet = new Set(refNames);
  for (const entry of c.entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) problems.push('INVALID_ID ' + entry.id);
    if (entry.reference !== 'type-' + entry.id + '.md') problems.push('BAD_REFERENCE ' + entry.id + ' ' + entry.reference);
    if (!refSet.has(entry.reference)) problems.push('MISSING_REFERENCE ' + entry.reference);
    if (JSON.stringify(entry.variants) !== JSON.stringify(['light', 'dark', 'full'])) problems.push('BAD_VARIANTS ' + entry.id);
    for (const variant of ['light', 'dark', 'full']) expected.add('type-' + entry.id + '-' + variant + '.html');
  }
  const actual = new Set(names);
  for (const name of expected) if (!actual.has(name)) problems.push('MISSING_EXAMPLE ' + name);
  for (const name of actual) if (!expected.has(name)) problems.push('ORPHAN_EXAMPLE ' + name);
  if (expected.size !== 183) problems.push('EXPECTED_VARIANT_COUNT ' + expected.size);
  return problems;
}
issues.push(...audit(catalog, refs, exampleFiles));
if (process.argv.includes('--self-test')) {
  const clone = JSON.parse(JSON.stringify(catalog));
  const good = audit(clone, refs, exampleFiles);
  const duplicate = JSON.parse(JSON.stringify(clone));
  duplicate.entries[1].id = duplicate.entries[0].id;
  const duplicateResult = audit(duplicate, refs, exampleFiles);
  const missing = audit(clone, refs, exampleFiles.filter((name) => name !== 'type-architecture-light.html'));
  const orphan = audit(clone, refs, [...exampleFiles, 'type-orphan-light.html']);
  if (good.length || !duplicateResult.some((x) => x.startsWith('DUPLICATE_ID')) || !missing.some((x) => x.startsWith('MISSING_EXAMPLE')) || !orphan.some((x) => x.startsWith('ORPHAN_EXAMPLE'))) {
    console.error('SELF_TEST_FAIL', { good, duplicateResult, missing, orphan });
    process.exit(1);
  }
  console.log('SELF_TEST_PASS duplicate, missing, and orphan cases fail as expected');
}
if (issues.length) {
  console.error('COVERAGE_FAIL');
  for (const issue of issues) console.error('- ' + issue);
  process.exitCode = 1;
} else {
  console.log('COVERAGE_PASS core=41 gallery=61 variants=183 references=61');
}
