#!/usr/bin/env node
// Regenerates plugins/litclaude/lib/canonical-skill-resources.mjs from the files on disk.
//
// The manifest pins a SHA-256 for every runtime resource the installer copies, the install-time
// integrity gate checks, and `doctor` verifies. It used to be maintained by hand, which made adding
// or editing a skill resource a silent-failure trap: the file lands, the manifest does not, and the
// break surfaces later as RESOURCE_HASH_MISMATCH or RESOURCE_MISSING.
//
//   node tools/gen-canonical-skill-resources.mjs            rewrite the manifest from disk
//   node tools/gen-canonical-skill-resources.mjs --check     verify only; exit 1 on drift
//
// --check is the CI-safe form. It never writes.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PLUGIN_ROOT = "plugins/litclaude";
const MANIFEST_PATH = `${PLUGIN_ROOT}/lib/canonical-skill-resources.mjs`;

// The pinned set: shared runtime boundaries plus skill trees that ship executable or
// contract-bearing resources beyond an ordinary catalog entrypoint. The parity slice also
// restores one large injected skill body, so litwork is pinned as an explicit file.
//
// Deliberate boundary: the root checkout wrapper at scripts/scaffold-plan.mjs and the pre-existing
// general hook/litgoal runtime stay outside this plugin-root skill-resource manifest. The installed
// scaffold implementation is plugin-local and pinned below. Focused tests and package payload
// guards remain authoritative for the root wrapper; widening this generator into a second
// package-wide manifest would duplicate those mechanisms.
const PINNED_FILES = [
  "lib/added-comment-lines.mjs",
  "lib/canonical-frontend-commitments.mjs",
  "lib/canonical-frontend-corpus.mjs",
  "lib/canonical-runtime-commitments.mjs",
  "lib/canonical-runtime-closures.mjs",
  "lib/deliverable-hedge-guard.mjs",
  "lib/durable-plan.mjs",
  "lib/immutable-expected-file-map.mjs",
  "lib/secure-path-read.mjs",
  "lib/office-runtime.mjs",
  "lib/office-runtime-lock/package.json",
  "lib/office-runtime-lock/package-lock.json",
  "lib/office-runtime-lock/requirements.lock",
  "lib/office_runtime_bootstrap.py",
  "lib/office_data.py",
  "lib/ooxml_integrity.py",
  "lib/render_pages.py",
  "lib/owner-lock.mjs",
  "lib/rename-aliases.mjs",
  "lib/lit-mark.mjs",
  "lib/secret-shapes.mjs",
  "lib/plan-task-rows.mjs",
  "lib/strict-json.mjs",
  "lib/wikify-knowledge-cli.mjs",
  "lib/wikify-knowledge.mjs",
  "scripts/scaffold-plan.mjs",
  "skills/browser-drive/scripts/capability-probe.mjs",
  "skills/litresearch/ATTRIBUTION.md",
  "skills/litwork/SKILL.md",
  "vendor/canonical-runtime-closures.json",
];
const PINNED_TREES = [
  "bundled-rules",
  "lib/rules",
  "skills/frontend-ui-ux",
  "skills/readme-studio",
  "skills/autoconference",
  "skills/autoresearch",
  "skills/lit-comprehend",
  "skills/lit-diagram-drawer",
  "skills/lit-docx",
  "skills/lit-pptx",
  "skills/lit-typographic-motion",
  "skills/lit-humanizer",
  "skills/lit-team",
  "skills/lit-code",
  "skills/debugging",
  "skills/visual-qa",
  "skills/wikify",
];

const SEPARATELY_MANIFESTED_PREFIXES = [
  "skills/frontend-ui-ux/references/_canonical-corpus/legal/",
  "skills/frontend-ui-ux/references/design/",
  "skills/frontend-ui-ux/references/designpowers/",
  "skills/frontend-ui-ux/references/perfection/",
  "skills/frontend-ui-ux/references/ui-ux-db/",
];

function walk(relDir) {
  const out = [];
  for (const entry of readdirSync(path.join(PLUGIN_ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function collect() {
  const paths = [...PINNED_FILES, ...PINNED_TREES.flatMap(walk)]
    .filter((rel) => !SEPARATELY_MANIFESTED_PREFIXES.some((prefix) => rel.startsWith(prefix)))
    .sort();
  return paths.map((rel) => [
    rel,
    createHash("sha256").update(readFileSync(path.join(PLUGIN_ROOT, rel))).digest("hex"),
  ]);
}

function render(entries) {
  const rows = entries.map(([rel, hash]) => `    [${JSON.stringify(rel)}, ${JSON.stringify(hash)}],`);
  return `export const canonicalSkillResourceManifest = Object.freeze(\n  new Map([\n${rows.join("\n")}\n  ]),\n);\n`;
}

const check = process.argv.includes("--check");
const entries = collect();
const next = render(entries);
const current = readFileSync(MANIFEST_PATH, "utf8");

if (next === current) {
  console.log(`canonical-skill-resources OK: ${entries.length} resource(s)`);
  process.exit(0);
}

if (check) {
  const currentMap = new Map(
    [...current.matchAll(/\["([^"]+)", "([0-9a-f]{64})"\]/g)].map((m) => [m[1], m[2]]),
  );
  const nextMap = new Map(entries);
  const drift = [];
  for (const [rel, hash] of nextMap) {
    const was = currentMap.get(rel);
    if (was === undefined) drift.push(`  unpinned  ${rel}`);
    else if (was !== hash) drift.push(`  changed   ${rel}`);
  }
  for (const rel of currentMap.keys()) if (!nextMap.has(rel)) drift.push(`  missing   ${rel}`);
  console.error(`canonical-skill-resources DRIFT: ${drift.length} path(s)`);
  console.error(drift.join("\n"));
  console.error("run: npm run gen:skill-resources");
  process.exit(1);
}

writeFileSync(MANIFEST_PATH, next);
console.log(`canonical-skill-resources WROTE: ${entries.length} resource(s) -> ${MANIFEST_PATH}`);
