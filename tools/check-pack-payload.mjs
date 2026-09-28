#!/usr/bin/env node
// tools/check-pack-payload.mjs — DEC-E pack payload guard.
// Packs into an isolated temp directory and fails if any packed file path matches
// a forbidden segment or exact canonical bytes drift. Exit 0 if clean; exit 1 otherwise.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, resolve, dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { verifyCanonicalFrontendCorpus } from '../plugins/litclaude/lib/canonical-frontend-corpus.mjs';
import { verifyCanonicalRuntimeClosures } from '../plugins/litclaude/lib/canonical-runtime-closures.mjs';
import { canonicalSkillIds } from '../plugins/litclaude/lib/canonical-skill-catalog.mjs';
import {
  MAX_BOUNDED_AGGREGATE_BYTES,
  MAX_BOUNDED_FILE_BYTES,
  readRegularStable,
} from '../plugins/litclaude/lib/secure-path-read.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The README skill table shows one snapshot per row. Each id maps to one exact path.
export const README_SKILL_IMAGE_PATHS = Object.freeze([
  'lit-loop', 'litwork', 'lit-plan', 'start-work', 'review-work', 'litgoal', 'lit-recap',
  'lit-handoff', 'deep-interview', 'litresearch', 'lit-crucible', 'lit-init', 'lit-comprehend',
  'lit-humanizer', 'lit-diagram-drawer', 'lit-pptx', 'lit-docx', 'frontend-ui-ux', 'readme-studio',
  'lit-typographic-motion', 'lit-scientific-visualization', 'visual-qa', 'browser-drive',
  'structural-search', 'lit-team', 'autoresearch', 'autoconference', 'wikify', 'debugging',
  'refactor', 'lit-burnoff', 'lit-burnoff-file', 'lit-code', 'lit-commit', 'lsp-setup',
  'automatic-checks',
].map((id) => `docs/assets/skills/${id}.webp`));

// Exact paths that are allowed to ship despite matching a forbidden pattern. Each entry
// is a deliberate exception, not a loophole: it is a full path, never a prefix or glob,
// so it cannot widen to cover a file nobody reviewed.
const APPROVED_PAYLOAD_PATHS = new Set([
  // Canonical vendored handoff assets — the skill's own template and example.
  'plugins/litclaude/vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md',
  'plugins/litclaude/vendor/handoff/templates/HANDOFF.md',
  // Vendored upstream test files that are part of the hash-pinned 045 payload. Dropping
  // them would break vendor integrity verification, so they ship by design.
  'plugins/litclaude/vendor/scientific-visualization/tests/test_figure_export.py',
  'plugins/litclaude/vendor/scientific-visualization/tests/test_style_presets.py',
  // npm README resources: every referenced file is served from jsDelivr at the
  // published version because the source repository is private.
  'docs/assets/cover.webp',
  'docs/assets/cover-motion.webp',
  'docs/assets/cover-motion-still.webp',
  'docs/assets/litclaude-wordmark.svg',
  'docs/assets/litclaude-clay-icon.png',
  'docs/assets/litclaude-ignition-1600.webp',
  'docs/assets/litclaude-continuity-1600.webp',
  'docs/assets/litfamily-machines.png',
  'docs/assets/readme/badge-version.svg',
  'docs/assets/readme/badge-license.svg',
  'docs/assets/readme/ascii-readme.svg',
  'docs/assets/readme/lucide-book-open.svg',
  'docs/assets/readme/lucide-play.svg',
  'docs/assets/readme/lucide-shield-check.svg',
  'docs/assets/readme/ignition-film.mp4',
  'docs/assets/readme/ignition-poster.png',
  'docs/assets/readme/ignition-readme.gif',
  'docs/assets/readme/Lucide-LICENSE.txt',
  'docs/assets/readme/JetBrainsMono-OFL.txt',
  ...README_SKILL_IMAGE_PATHS,
]);

// Forbidden path segments (regex patterns tested against each file path).
//
// These were SINGULAR-ONLY and let real leaks through while printing "none forbidden":
// `/test/` missed `scripts/tests/leak_helper.py`, `/fixtures/` missed `fixture/sample.json`,
// and nothing covered scratch files at all. Every pattern below was checked against the
// real 332-file payload for false positives before being added.
const FORBIDDEN_PATTERNS = [
  /^(?:cover\.png|generate_cover\.py|RELEASE_CHECKLIST\.md)$/,
  /^docs\/assets\//,      // only the exact npm README resources above may ship
  /\/tests?\//,           // was /test/ — also catches /tests/
  /^tests?\//,
  /__tests__/,
  /\/testing\//,
  /\.(test|spec)\./,      // was .test. — also catches .spec.
  /\/fixtures?\//,        // was /fixtures/ — also catches /fixture/
  /^fixtures?\//,
  /^docs\/spec\//,
  /\/spec\//,             // a spec/ directory anywhere, not just under docs/
  /(^|\/)scratch/,        // scratch-notes.txt, scratch/, .scratch
  /(^|\/)tmp\//,
  /(^|\/)\.DS_Store$/,
  /HANDOFF/,
  /\.tgz$/,
  /\.tsbuildinfo$/,
  /\.env$/,
  /^evidence\//,
  /^plans\//,
  /(^|\/)\.claude\/skills\//,
  /(^|\/)\.litclaude(?:\/|$)/,
  new RegExp(`^\\.${["o","m","o"].join("")}/`),
  /# REFERENCE/,
  /\.debug-journal/,
];

/**
 * Pure matcher, exported so the pattern set is unit-testable without a 30s `npm pack`.
 * An approved exact path is exempt from every pattern, not just the one it was
 * originally carved out for — the allowlist is the reviewed decision, and scoping it
 * per-pattern only made the rule harder to reason about.
 */
export function findOffenders(files) {
  const found = [];
  for (const filePath of files) {
    if (APPROVED_PAYLOAD_PATHS.has(filePath)) continue;
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(filePath)) {
        found.push({ filePath, pattern: pattern.toString() });
        break;
      }
    }
  }
  return found;
}

export { APPROVED_PAYLOAD_PATHS, FORBIDDEN_PATTERNS };

/**
 * Reject files beneath a shipped skill directory that is absent from the
 * canonical Claude skill catalog. The package exports the whole `skills/`
 * directory, so byte pins for known resources do not by themselves stop a new,
 * unreviewed top-level skill from entering the tarball.
 */
export function findUnpinnedSkillPaths(files, skillIds = canonicalSkillIds) {
  const expected = new Set(skillIds);
  return files.filter((filePath) => {
    const match = filePath.match(/^plugins\/litclaude\/skills\/([^/]+)\//u);
    return match !== null && !expected.has(match[1]);
  });
}

const tarString = (bytes, offset, length) =>
  bytes.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/su, '').trim();

function tarSize(bytes, offset) {
  const field = bytes.subarray(offset, offset + 12);
  if ((field[0] & 0x80) !== 0) throw new Error('PACK_TARBALL_INVALID: base-256 size is unsupported');
  const text = field.toString('ascii').replace(/\0.*$/su, '').trim();
  if (!/^[0-7]+$/u.test(text)) throw new Error('PACK_TARBALL_INVALID: malformed tar size');
  return Number.parseInt(text, 8);
}

function tarMode(bytes) {
  const field = bytes.subarray(100, 108);
  if ((field[0] & 0x80) !== 0) throw new Error('PACK_TARBALL_INVALID: base-256 mode is unsupported');
  const text = field.toString('ascii').replace(/\0.*$/su, '').trim();
  if (!/^[0-7]+$/u.test(text)) throw new Error('PACK_TARBALL_INVALID: malformed tar mode');
  return Number.parseInt(text, 8);
}

function parsePax(bytes) {
  const fields = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) throw new Error('PACK_TARBALL_INVALID: malformed pax record');
    const length = Number.parseInt(bytes.subarray(offset, space).toString('ascii'), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > bytes.length) {
      throw new Error('PACK_TARBALL_INVALID: malformed pax length');
    }
    const record = bytes.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) fields.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return fields;
}

function readPackedFiles(tgzBytes, wantedPaths) {
  const tar = gunzipSync(tgzBytes);
  const found = new Map();
  let offset = 0;
  let localPax = new Map();
  let globalPax = new Map();
  let longPath;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarSize(header, 124);
    const payloadStart = offset + 512;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > tar.length) throw new Error('PACK_TARBALL_INVALID: truncated tar entry');
    const payload = tar.subarray(payloadStart, payloadEnd);
    const type = String.fromCharCode(header[156] || 0);
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;

    if (type === 'x') localPax = parsePax(payload);
    else if (type === 'g') globalPax = new Map([...globalPax, ...parsePax(payload)]);
    else if (type === 'L') longPath = payload.toString('utf8').replace(/\0.*$/su, '').trim();
    else {
      const path = localPax.get('path') ?? globalPax.get('path') ?? longPath ?? headerPath;
      if ((type === '0' || type === '\0') && wantedPaths.has(path)) {
        found.set(path, { bytes: Buffer.from(payload), mode: tarMode(header) });
      }
      localPax = new Map();
      longPath = undefined;
    }
    offset = payloadStart + Math.ceil(size / 512) * 512;
  }
  return found;
}

function mergeExpectedPackageFiles(...maps) {
  const merged = new Map();
  for (const expectedFiles of maps) {
    for (const [path, expected] of expectedFiles) {
      if (merged.has(path)) throw new Error(`CANONICAL_EXPECTED_PATH_DUPLICATE: ${path}`);
      merged.set(path, expected);
    }
  }
  return merged;
}

function captureCanonicalFiles(expectedFiles) {
  const snapshot = new Map();
  let capturedBytes = 0;
  for (const [path, expected] of [...expectedFiles].sort(([left], [right]) => left.localeCompare(right))) {
    const remainingBytes = MAX_BOUNDED_AGGREGATE_BYTES - capturedBytes;
    const result = readRegularStable(ROOT, join(ROOT, path), undefined, {
      maxBytes: Math.min(MAX_BOUNDED_FILE_BYTES, remainingBytes),
    });
    if (result.failure) {
      throw new Error(`CANONICAL_PREPACK_SNAPSHOT_FAIL: ${path} (${result.failure})`);
    }
    capturedBytes += result.bytes.length;
    const actual = {
      size: result.bytes.length,
      sha256: createHash('sha256').update(result.bytes).digest('hex'),
      executable: (result.stat.mode & 0o111) !== 0,
    };
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`CANONICAL_PREPACK_SNAPSHOT_MISMATCH: ${path} (expected ${expected.size} bytes sha256 ${expected.sha256}, captured ${actual.size} bytes sha256 ${actual.sha256})`);
    }
    if (actual.executable !== expected.executable) {
      throw new Error(`CANONICAL_PREPACK_MODE_MISMATCH: ${path} (expected ${expected.executable ? 'executable' : 'non-executable'}, captured mode 0${(result.stat.mode & 0o777).toString(8)})`);
    }
    snapshot.set(path, expected);
  }
  return snapshot;
}

// Importing this module (from a test) must not shell out to `npm pack`.
//
// Compare REAL paths on both sides. Comparing import.meta.url to
// pathToFileURL(process.argv[1]) looks equivalent and is not: under a symlinked temp dir
// (macOS /var -> /private/var) argv[1] stays /var/... while import.meta.url resolves to
// /private/var/..., the guard never fires, and the script exits 0 having checked NOTHING.
// A guard that silently passes is worse than no guard.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) main();

function main() {

const pluginRoot = resolve(ROOT, 'plugins/litclaude');
const canonicalFrontend = verifyCanonicalFrontendCorpus(pluginRoot);
if (canonicalFrontend.status !== 'PASS') {
  process.stderr.write(`[check-pack-payload] CANONICAL_FRONTEND_CORPUS_FAIL ${JSON.stringify(canonicalFrontend.failures)}\n`);
  process.exit(1);
}
const runtimeClosures = verifyCanonicalRuntimeClosures(pluginRoot);
if (runtimeClosures.status !== 'PASS') {
  process.stderr.write(`[check-pack-payload] CANONICAL_RUNTIME_CLOSURES_FAIL ${JSON.stringify(runtimeClosures.failures)}\n`);
  process.exit(1);
}
const expectedCanonicalFiles = mergeExpectedPackageFiles(
  canonicalFrontend.expectedPackageFiles,
  runtimeClosures.expectedPackageFiles,
);
const requiredCanonicalPaths = new Set(expectedCanonicalFiles.keys());

let packData;
let canonicalPrepackSnapshot;
let packedCanonicalBytes;
let packFailure;
const packDirectory = mkdtempSync(join(tmpdir(), 'litclaude-pack-guard-'));
try {
  canonicalPrepackSnapshot = captureCanonicalFiles(expectedCanonicalFiles);
  const result = spawnSync('npm', ['pack', '--json', '--pack-destination', packDirectory], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack failed (exit ${result.status})\n${result.stderr}`);
  }
  packData = JSON.parse(result.stdout);
  const packed = Array.isArray(packData) ? packData[0] : packData;
  if (typeof packed?.filename !== 'string' || basename(packed.filename) !== packed.filename) {
    throw new Error('PACK_TARBALL_INVALID: unsafe npm pack filename');
  }
  const wantedPaths = new Set([...requiredCanonicalPaths].map((path) => `package/${path}`));
  packedCanonicalBytes = readPackedFiles(readFileSync(join(packDirectory, packed.filename)), wantedPaths);
} catch (error) {
  packFailure = error;
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}
if (packFailure) {
  process.stderr.write(`[check-pack-payload] ${packFailure.message}\n`);
  process.exit(1);
}

// npm pack --json returns an array; take the first entry.
const entry = Array.isArray(packData) ? packData[0] : packData;
const packedFileEntries = (entry && entry.files) ? entry.files : [];
const files = packedFileEntries.map(f => f.path);
const packedPaths = new Set(files);
const unpinnedSkillPaths = findUnpinnedSkillPaths(files);
if (unpinnedSkillPaths.length > 0) {
  for (const path of unpinnedSkillPaths) {
    process.stderr.write(`[check-pack-payload] UNPINNED_SKILL_PAYLOAD: ${path}\n`);
  }
  process.exit(1);
}
const missingCanonicalPaths = [...requiredCanonicalPaths].filter((path) => !packedPaths.has(path));
if (missingCanonicalPaths.length > 0) {
  for (const path of missingCanonicalPaths) process.stderr.write(`[check-pack-payload] FAIL: canonical package path missing: ${path}\n`);
  process.exit(1);
}
const canonicalByteFailures = [...canonicalPrepackSnapshot].flatMap(([path, expected]) => {
  const packed = packedCanonicalBytes.get(`package/${path}`);
  const actual = packed === undefined ? undefined : {
    size: packed.bytes.length,
    sha256: createHash('sha256').update(packed.bytes).digest('hex'),
  };
  return actual?.size === expected.size && actual.sha256 === expected.sha256
    ? []
    : [{ path, expected, actual }];
});
if (canonicalByteFailures.length > 0) {
  for (const { path, expected, actual } of canonicalByteFailures) {
    const code = canonicalFrontend.legalPaths.has(path)
      ? 'LEGAL_PACKAGE_HASH_MISMATCH'
      : 'CANONICAL_PACKAGE_BYTES_MISMATCH';
    process.stderr.write(`[check-pack-payload] ${code}: ${path} (expected ${expected.size} bytes sha256 ${expected.sha256}, packed ${actual?.size ?? 'missing'} bytes sha256 ${actual?.sha256 ?? 'missing'})\n`);
  }
  process.exit(1);
}
const canonicalModeFailures = [...canonicalPrepackSnapshot].flatMap(([path, expected]) => {
  const packed = packedCanonicalBytes.get(`package/${path}`);
  if (packed === undefined) return [];
  const actualExecutable = (packed.mode & 0o111) !== 0;
  return actualExecutable === expected.executable
    ? []
    : [{ path, expectedExecutable: expected.executable, actualMode: packed.mode & 0o777 }];
});
if (canonicalModeFailures.length > 0) {
  for (const { path, expectedExecutable, actualMode } of canonicalModeFailures) {
    process.stderr.write(`[check-pack-payload] CANONICAL_PACKAGE_MODE_MISMATCH: ${path} (expected ${expectedExecutable ? 'executable' : 'non-executable'}, packed mode 0${actualMode.toString(8)})\n`);
  }
  process.exit(1);
}

const offenders = findOffenders(files);

if (offenders.length === 0) {
  process.stdout.write(`pack-payload-guard OK: ${files.length} file(s) checked, none forbidden; ${requiredCanonicalPaths.size} canonical file(s) matched verifier-bound size/SHA-256 and non-executable regular-file semantics in pre-pack capture and produced tarball; ${canonicalFrontend.legalFiles.length} legal companion(s), ${canonicalFrontend.legalByteCount} bytes, sha256 ${canonicalFrontend.legalTreeSha256} exact\n`);
  process.exit(0);
} else {
  for (const { filePath, pattern } of offenders) {
    process.stderr.write(`[check-pack-payload] FAIL: "${filePath}" matches forbidden pattern ${pattern}\n`);
  }
  process.stderr.write(`[check-pack-payload] ${offenders.length} forbidden file(s) found in pack payload\n`);
  process.exit(1);
}

}
