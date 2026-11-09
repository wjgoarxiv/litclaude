import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  CANONICAL_FRONTEND_LEGAL_COMMITMENT,
  canonicalFrontendLegalTreeSha256,
} from "./canonical-frontend-commitments.mjs";
import {
  MAX_BOUNDED_AGGREGATE_BYTES,
  MAX_BOUNDED_FILE_BYTES,
  readDirectoryStable,
  readRegularStable,
} from "./secure-path-read.mjs";
import { immutableExpectedFileMap } from "./immutable-expected-file-map.mjs";

const REFERENCE_ROOT = "skills/frontend-ui-ux/references";
const MANIFEST_RELATIVE_PATH = `${REFERENCE_ROOT}/_canonical-corpus/manifest.json`;
const CORPUS_ROOTS = ["design", "designpowers", "perfection", "ui-ux-db"];
const MANIFEST_KEYS = [
  "aggregate_sha256",
  "byte_count",
  "file_count",
  "files",
  "independent_normalized_dataset",
  "legal",
  "schema_version",
  "source",
];
const SOURCE_KEYS = ["commit", "reference_subtree", "reference_tree"];
const FILE_KEYS = ["path", "sha256", "size"];
const LEGAL_KEYS = ["path", "sha256", "size", "source_path"];
const DATASET_KEYS = ["record_count", "sha256", "source_count"];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sameKeys = (value, keys) => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const safeRelativePath = (value) => typeof value === "string"
  && value.length > 0
  && !value.startsWith("/")
  && !value.includes("\\")
  && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

function listEntries(pluginRoot, root, rel = "", ancestorSnapshots = new Map()) {
  const directory = rel ? join(root, rel) : root;
  const entries = [];
  const failures = [];
  const read = readDirectoryStable(pluginRoot, directory, { ancestors: [...ancestorSnapshots.values()] });
  if (read.failure) {
    const code = read.failure.includes("ANCESTOR") ? "CORPUS_ANCESTOR_INVALID" : "CORPUS_UNREADABLE";
    return { entries, failures: [{ code, path: rel }] };
  }
  for (const snapshot of read.ancestors) ancestorSnapshots.set(snapshot.absolutePath, snapshot);
  const children = read.entries;
  for (const child of children) {
    const path = rel ? `${rel}/${child.name}` : child.name;
    if (child.isDirectory()) {
      entries.push({ path, kind: "directory" });
      const nested = listEntries(pluginRoot, root, path, ancestorSnapshots);
      entries.push(...nested.entries);
      failures.push(...nested.failures);
    } else if (child.isFile()) {
      entries.push({ path, kind: "file" });
    } else {
      entries.push({ path, kind: "non-regular" });
    }
  }
  return { entries, failures, ancestorSnapshots };
}

function validateManifest(manifest) {
  if (!sameKeys(manifest, MANIFEST_KEYS)
    || manifest.schema_version !== "litclaude.canonical-frontend-corpus/v1"
    || !sameKeys(manifest.source, SOURCE_KEYS)
    || manifest.source.commit !== "8ec16c5129df7b9778959e8367657d0e79c2c3bb"
    || manifest.source.reference_tree !== "9188410be0af35f2421ba300d91a0d7a7341caf0"
    || manifest.source.reference_subtree !== "frontend/references"
    || manifest.file_count !== 167
    || manifest.byte_count !== 2_596_349
    || manifest.aggregate_sha256 !== "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7"
    || !Array.isArray(manifest.files)
    || manifest.files.length !== manifest.file_count
    || !Array.isArray(manifest.legal)
    || manifest.legal.length !== 3
    || !sameKeys(manifest.independent_normalized_dataset, DATASET_KEYS)
    || manifest.independent_normalized_dataset.source_count !== 34
    || manifest.independent_normalized_dataset.record_count !== 2277
    || manifest.independent_normalized_dataset.sha256 !== "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8") {
    return false;
  }

  const seen = new Set();
  for (const entry of manifest.files) {
    if (!sameKeys(entry, FILE_KEYS)
      || !safeRelativePath(entry.path)
      || !CORPUS_ROOTS.some((root) => entry.path.startsWith(`${root}/`))
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || !/^[0-9a-f]{64}$/u.test(entry.sha256)
      || seen.has(entry.path)) return false;
    seen.add(entry.path);
  }
  for (const entry of manifest.legal) {
    if (!sameKeys(entry, LEGAL_KEYS)
      || !safeRelativePath(entry.path)
      || !entry.path.startsWith("_canonical-corpus/legal/")
      || !safeRelativePath(entry.source_path)
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || !/^[0-9a-f]{64}$/u.test(entry.sha256)
      || seen.has(entry.path)) return false;
    seen.add(entry.path);
  }
  return true;
}

function legalCommitmentFailure(manifest) {
  const entries = manifest.legal.map(({ path, source_path: sourcePath, size, sha256 }) => ({
    path,
    sourcePath,
    size,
    sha256,
  }));
  const byteCount = entries.reduce((total, entry) => total + entry.size, 0);
  const treeSha256 = canonicalFrontendLegalTreeSha256(entries);
  if (entries.length !== CANONICAL_FRONTEND_LEGAL_COMMITMENT.fileCount
    || byteCount !== CANONICAL_FRONTEND_LEGAL_COMMITMENT.byteCount
    || treeSha256 !== CANONICAL_FRONTEND_LEGAL_COMMITMENT.treeSha256) {
    return {
      code: "LEGAL_COMMITMENT_MISMATCH",
      path: MANIFEST_RELATIVE_PATH,
      expected: CANONICAL_FRONTEND_LEGAL_COMMITMENT.treeSha256,
      actual: treeSha256,
    };
  }
  return undefined;
}

function declaredBudgetFailure(manifest, manifestBytes) {
  const entries = [...manifest.files, ...manifest.legal];
  const oversized = entries.find(({ size }) => size > MAX_BOUNDED_FILE_BYTES);
  if (oversized) {
    return {
      code: "CANONICAL_FRONTEND_FILE_TOO_LARGE",
      path: oversized.path,
      maxBytes: MAX_BOUNDED_FILE_BYTES,
      declaredBytes: oversized.size,
    };
  }
  const declaredBytes = manifestBytes + entries.reduce((total, entry) => total + entry.size, 0);
  if (declaredBytes > MAX_BOUNDED_AGGREGATE_BYTES) {
    return {
      code: "CANONICAL_FRONTEND_AGGREGATE_TOO_LARGE",
      path: MANIFEST_RELATIVE_PATH,
      maxBytes: MAX_BOUNDED_AGGREGATE_BYTES,
      declaredBytes,
    };
  }
  return undefined;
}

function expectedDirectories(paths) {
  const directories = new Set([...CORPUS_ROOTS, "_canonical-corpus", "_canonical-corpus/legal"]);
  for (const path of paths) {
    let parent = dirname(path).replaceAll("\\", "/");
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent).replaceAll("\\", "/");
    }
  }
  return directories;
}

export function verifyCanonicalFrontendCorpus(pluginRoot) {
  const failures = [];
  const manifestAbsolutePath = join(pluginRoot, MANIFEST_RELATIVE_PATH);
  const manifestRead = readRegularStable(pluginRoot, manifestAbsolutePath, undefined, {
    maxBytes: MAX_BOUNDED_FILE_BYTES,
  });
  if (manifestRead.failure) {
    const code = manifestRead.failure === "FILE_TOO_LARGE"
      ? "CANONICAL_FRONTEND_MANIFEST_TOO_LARGE"
      : manifestRead.failure.includes("ANCESTOR")
      ? "MANIFEST_ANCESTOR_INVALID"
      : manifestRead.failure === "UNREADABLE" ? "MANIFEST_UNREADABLE" : "MANIFEST_NON_REGULAR";
    return {
      status: "FAIL",
      checkedFiles: 0,
      corpusBytes: 0,
      aggregateSha256: null,
      protectedPaths: new Set(),
      protectedSnapshots: new Map(),
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [{ code, path: MANIFEST_RELATIVE_PATH }],
    };
  }
  if ((manifestRead.stat.mode & 0o111) !== 0) {
    return {
      status: "FAIL",
      checkedFiles: 0,
      corpusBytes: 0,
      aggregateSha256: null,
      protectedPaths: new Set(),
      protectedSnapshots: new Map(),
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [{ code: "MANIFEST_MODE_MISMATCH", path: MANIFEST_RELATIVE_PATH }],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRead.bytes.toString("utf8"));
  } catch {
    manifest = null;
  }
  if (!validateManifest(manifest)) {
    return {
      status: "FAIL",
      checkedFiles: 0,
      corpusBytes: 0,
      aggregateSha256: null,
      protectedPaths: new Set(),
      protectedSnapshots: new Map(),
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [{ code: "MANIFEST_SCHEMA_INVALID", path: MANIFEST_RELATIVE_PATH }],
    };
  }

  const budgetFailure = declaredBudgetFailure(manifest, manifestRead.bytes.length);
  if (budgetFailure) {
    return {
      status: "FAIL",
      checkedFiles: 0,
      corpusBytes: 0,
      aggregateSha256: null,
      protectedPaths: new Set(),
      protectedSnapshots: new Map(),
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [budgetFailure],
    };
  }
  const commitmentFailure = legalCommitmentFailure(manifest);
  if (commitmentFailure) {
    return {
      status: "FAIL",
      checkedFiles: 0,
      corpusBytes: 0,
      aggregateSha256: null,
      protectedPaths: new Set(),
      protectedSnapshots: new Map(),
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [commitmentFailure],
    };
  }

  const referenceRoot = join(pluginRoot, REFERENCE_ROOT);
  const expected = [...manifest.files, ...manifest.legal];
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const expectedFiles = new Set([...expectedByPath.keys(), "_canonical-corpus/manifest.json"]);
  const expectedDirs = expectedDirectories(expectedFiles);
  const actualEntries = [];
  const ancestorSnapshots = new Map(manifestRead.snapshot.ancestors.map((snapshot) => [snapshot.absolutePath, snapshot]));
  for (const rel of [...CORPUS_ROOTS, "_canonical-corpus"]) {
    const listed = listEntries(pluginRoot, referenceRoot, rel, ancestorSnapshots);
    actualEntries.push(...listed.entries);
    failures.push(...listed.failures);
  }

  const actualFiles = new Set(actualEntries.filter(({ kind }) => kind === "file").map(({ path }) => path));
  for (const entry of actualEntries) {
    if (entry.kind === "directory" && !expectedDirs.has(entry.path)) failures.push({ code: "CORPUS_EXTRA", path: entry.path });
    if (entry.kind === "non-regular") failures.push({ code: "CORPUS_NON_REGULAR", path: entry.path });
    if (entry.kind === "file" && !expectedFiles.has(entry.path)) failures.push({ code: "CORPUS_EXTRA", path: entry.path });
  }
  for (const path of expectedFiles) {
    if (!actualFiles.has(path)) failures.push({ code: "CORPUS_MISSING", path });
  }

  const actualHashes = new Map();
  const actualSnapshots = new Map();
  let corpusBytes = 0;
  let checkedFiles = 0;
  let capturedBytes = manifestRead.bytes.length;
  for (const [path, entry] of expectedByPath) {
    if (!actualFiles.has(path)) continue;
    const remainingBytes = MAX_BOUNDED_AGGREGATE_BYTES - capturedBytes;
    const result = readRegularStable(
      pluginRoot,
      join(referenceRoot, path),
      { ancestors: [...ancestorSnapshots.values()] },
      { maxBytes: Math.min(MAX_BOUNDED_FILE_BYTES, remainingBytes) },
    );
    if (result.failure) {
      const code = result.failure === "FILE_TOO_LARGE"
        ? remainingBytes < MAX_BOUNDED_FILE_BYTES
          ? "CANONICAL_FRONTEND_AGGREGATE_TOO_LARGE"
          : "CANONICAL_FRONTEND_FILE_TOO_LARGE"
        : result.failure.includes("ANCESTOR")
        ? "CORPUS_ANCESTOR_INVALID"
        : result.failure === "UNREADABLE" ? "CORPUS_UNREADABLE" : "CORPUS_NON_REGULAR";
      failures.push({ code, path });
      continue;
    }
    capturedBytes += result.bytes.length;
    checkedFiles += 1;
    const actualHash = sha256(result.bytes);
    actualHashes.set(path, actualHash);
    actualSnapshots.set(path, {
      ...result.snapshot,
      sha256: actualHash,
      size: result.bytes.length,
    });
    if (result.bytes.length !== entry.size) failures.push({ code: "CORPUS_SIZE_MISMATCH", path, expected: entry.size, actual: result.bytes.length });
    if (actualHash !== entry.sha256) failures.push({ code: "CORPUS_HASH_MISMATCH", path, expected: entry.sha256, actual: actualHash });
    if ((result.stat.mode & 0o111) !== 0) failures.push({ code: "CORPUS_MODE_MISMATCH", path, expected: "non-executable", actual: result.stat.mode & 0o777 });
    if (CORPUS_ROOTS.some((root) => path.startsWith(`${root}/`))) corpusBytes += result.bytes.length;
  }

  const aggregateSha256 = manifest.files.every(({ path }) => actualHashes.has(path))
    ? sha256(manifest.files.map(({ path }) => `${actualHashes.get(path)}  ${path}\n`).join(""))
    : null;
  if (corpusBytes !== manifest.byte_count) failures.push({ code: "CORPUS_BYTE_COUNT_MISMATCH", expected: manifest.byte_count, actual: corpusBytes });
  if (aggregateSha256 !== manifest.aggregate_sha256) failures.push({ code: "CORPUS_AGGREGATE_MISMATCH", expected: manifest.aggregate_sha256, actual: aggregateSha256 });

  const protectedPaths = new Set(
    failures.length === 0
      ? manifest.files.map(({ path }) => `plugins/litclaude/${REFERENCE_ROOT}/${path}`)
      : [],
  );
  const protectedSnapshots = new Map(
    failures.length === 0
      ? manifest.files.map(({ path }) => [
        `plugins/litclaude/${REFERENCE_ROOT}/${path}`,
        actualSnapshots.get(path),
      ])
      : [],
  );
  const expectedPackageFiles = immutableExpectedFileMap(
    failures.length === 0
      ? [
        [`plugins/litclaude/${MANIFEST_RELATIVE_PATH}`, {
          size: manifestRead.bytes.length,
          sha256: sha256(manifestRead.bytes),
          executable: false,
        }],
        ...manifest.files.map(({ path, size, sha256 }) => [
          `plugins/litclaude/${REFERENCE_ROOT}/${path}`,
          { size, sha256, executable: false },
        ]),
        ...CANONICAL_FRONTEND_LEGAL_COMMITMENT.files.map(({ path, size, sha256 }) => [
          `plugins/litclaude/${REFERENCE_ROOT}/${path}`,
          { size, sha256, executable: false },
        ]),
      ]
      : [],
  );
  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    checkedFiles,
    corpusBytes,
    aggregateSha256,
    legalByteCount: CANONICAL_FRONTEND_LEGAL_COMMITMENT.byteCount,
    legalFiles: CANONICAL_FRONTEND_LEGAL_COMMITMENT.files.map((entry) => ({
      ...entry,
      path: `plugins/litclaude/${REFERENCE_ROOT}/${entry.path}`,
    })),
    legalPaths: new Set(CANONICAL_FRONTEND_LEGAL_COMMITMENT.files.map(({ path }) =>
      `plugins/litclaude/${REFERENCE_ROOT}/${path}`)),
    legalTreeSha256: CANONICAL_FRONTEND_LEGAL_COMMITMENT.treeSha256,
    protectedPaths,
    protectedSnapshots,
    expectedPackageFiles,
    failures,
  };
}

export const canonicalFrontendManifestPath = MANIFEST_RELATIVE_PATH;
