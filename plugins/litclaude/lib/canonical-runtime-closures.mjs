import { createHash } from "node:crypto";
import { join, posix, relative } from "node:path";
import {
  CANONICAL_RUNTIME_ADAPTER_COMMITMENTS,
  CANONICAL_RUNTIME_COMMITMENTS,
  canonicalRuntimeTreeSha256,
} from "./canonical-runtime-commitments.mjs";
import { immutableExpectedFileMap } from "./immutable-expected-file-map.mjs";
import {
  MAX_BOUNDED_AGGREGATE_BYTES,
  MAX_BOUNDED_FILE_BYTES,
  readDirectoryStable,
  readRegularStable,
} from "./secure-path-read.mjs";

const MANIFEST_PATH = "vendor/canonical-runtime-closures.json";
const EXPECTED = CANONICAL_RUNTIME_COMMITMENTS;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safePath = (path) => typeof path === "string"
  && path.length > 0
  && !path.startsWith("/")
  && !path.includes("\\")
  && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

function listFiles(pluginRoot, root, ancestorSnapshots) {
  const files = [];
  const nonRegular = [];
  const ancestorFailures = [];
  const visit = (directory) => {
    const read = readDirectoryStable(pluginRoot, directory, { ancestors: [...ancestorSnapshots.values()] });
    if (read.failure) {
      const path = relative(root, directory).replaceAll("\\", "/") || ".";
      if (read.failure.includes("ANCESTOR")) ancestorFailures.push(path);
      else nonRegular.push(path);
      return;
    }
    for (const snapshot of read.ancestors) ancestorSnapshots.set(snapshot.absolutePath, snapshot);
    for (const entry of read.entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
      else nonRegular.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return { files: files.sort(), nonRegular: nonRegular.sort(), ancestorFailures: ancestorFailures.sort() };
}

function readManifest(pluginRoot) {
  const result = readRegularStable(pluginRoot, join(pluginRoot, MANIFEST_PATH), undefined, {
    maxBytes: MAX_BOUNDED_FILE_BYTES,
  });
  if (result.failure) {
    return {
      manifest: null,
      failure: result.failure === "FILE_TOO_LARGE"
        ? "RUNTIME_CLOSURE_MANIFEST_TOO_LARGE"
        : result.failure.includes("ANCESTOR") ? "RUNTIME_CLOSURE_ANCESTOR_INVALID" : "RUNTIME_CLOSURE_MANIFEST_INVALID",
    };
  }
  try {
    return {
      manifest: JSON.parse(result.bytes.toString("utf8")),
      manifestBytes: result.bytes.length,
      snapshot: result.snapshot,
    };
  } catch {
    return { manifest: null, failure: "RUNTIME_CLOSURE_MANIFEST_INVALID" };
  }
}

function validManifest(manifest) {
  if (manifest?.schema_version !== "litclaude.canonical-runtime-closures/v1"
    || !Array.isArray(manifest.families)
    || manifest.families.length !== EXPECTED.size
    || Object.keys(manifest).sort().join(",") !== "families,schema_version") return false;
  const seen = new Set();
  for (const family of manifest.families) {
    const expected = EXPECTED.get(family?.id);
    if (!expected
      || seen.has(family.id)
      || Object.keys(family).sort().join(",") !== "file_count,files,id,root,source_commit"
      || family.source_commit !== expected.commit
      || family.root !== expected.root
      || family.file_count !== expected.fileCount
      || !Array.isArray(family.files)
      || family.files.length !== expected.fileCount) return false;
    seen.add(family.id);
    const paths = new Set();
    for (const file of family.files) {
      if (Object.keys(file).sort().join(",") !== "mode,path,sha256,size"
        || !safePath(file.path)
        || paths.has(file.path)
        || !Number.isSafeInteger(file.size)
        || file.size < 0
        || !Number.isSafeInteger(file.mode)
        || file.mode < 0
        || file.mode > 0o777
        || (file.mode & 0o111) !== 0
        || !/^[0-9a-f]{64}$/u.test(file.sha256)) return false;
      paths.add(file.path);
    }
  }
  return seen.size === EXPECTED.size;
}

function runtimeBudgetFailure(manifest, manifestBytes) {
  const files = manifest.families.flatMap((family) => family.files.map((file) => ({
    ...file,
    family: family.id,
  })));
  const oversized = files.find(({ size }) => size > MAX_BOUNDED_FILE_BYTES);
  if (oversized) {
    return {
      code: "RUNTIME_CLOSURE_FILE_TOO_LARGE",
      family: oversized.family,
      path: oversized.path,
      maxBytes: MAX_BOUNDED_FILE_BYTES,
      declaredBytes: oversized.size,
    };
  }
  const declaredBytes = manifestBytes + files.reduce((total, file) => total + file.size, 0);
  if (declaredBytes > MAX_BOUNDED_AGGREGATE_BYTES) {
    return {
      code: "RUNTIME_CLOSURE_AGGREGATE_TOO_LARGE",
      path: MANIFEST_PATH,
      maxBytes: MAX_BOUNDED_AGGREGATE_BYTES,
      declaredBytes,
    };
  }
  return undefined;
}

export function verifyCanonicalRuntimeClosures(pluginRoot) {
  const manifestResult = readManifest(pluginRoot);
  const manifest = manifestResult.manifest;
  if (!validManifest(manifest)) {
    return {
      status: "FAIL",
      families: [],
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [{ code: manifestResult.failure ?? "RUNTIME_CLOSURE_MANIFEST_INVALID", path: MANIFEST_PATH }],
    };
  }
  if ((manifestResult.snapshot.file.mode & 0o111) !== 0) {
    return {
      status: "FAIL",
      families: [],
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [{ code: "RUNTIME_CLOSURE_MANIFEST_MODE_MISMATCH", path: MANIFEST_PATH }],
    };
  }
  const budgetFailure = runtimeBudgetFailure(manifest, manifestResult.manifestBytes);
  if (budgetFailure) {
    return {
      status: "FAIL",
      families: [],
      expectedPackageFiles: immutableExpectedFileMap(),
      failures: [budgetFailure],
    };
  }

  const failures = [];
  const families = [];
  const capturedTexts = new Map();
  let capturedBytes = manifestResult.manifestBytes;
  const ancestorSnapshots = new Map(manifestResult.snapshot.ancestors.map((snapshot) => [snapshot.absolutePath, snapshot]));
  for (const family of manifest.families) {
    const root = join(pluginRoot, family.root);
    const listed = listFiles(pluginRoot, root, ancestorSnapshots);
    const expected = new Map(family.files.map((entry) => [entry.path, entry]));
    const actual = new Set(listed.files);
    const actualTreeEntries = [];
    const familyTexts = new Map();
    capturedTexts.set(family.id, familyTexts);
    for (const path of listed.ancestorFailures) failures.push({ code: "RUNTIME_CLOSURE_ANCESTOR_INVALID", family: family.id, path });
    for (const path of listed.nonRegular) failures.push({ code: "RUNTIME_CLOSURE_NON_REGULAR", family: family.id, path });
    for (const path of listed.files) if (!expected.has(path)) failures.push({ code: "RUNTIME_CLOSURE_EXTRA", family: family.id, path });
    for (const path of expected.keys()) if (!actual.has(path)) failures.push({ code: "RUNTIME_CLOSURE_MISSING", family: family.id, path });
    let checked = 0;
    for (const [path, entry] of expected) {
      if (!actual.has(path)) continue;
      const remainingBytes = MAX_BOUNDED_AGGREGATE_BYTES - capturedBytes;
      const result = readRegularStable(
        pluginRoot,
        join(root, path),
        { ancestors: [...ancestorSnapshots.values()] },
        { maxBytes: Math.min(MAX_BOUNDED_FILE_BYTES, remainingBytes) },
      );
      if (result.failure) {
        const code = result.failure === "FILE_TOO_LARGE"
          ? remainingBytes < MAX_BOUNDED_FILE_BYTES
            ? "RUNTIME_CLOSURE_AGGREGATE_TOO_LARGE"
            : "RUNTIME_CLOSURE_FILE_TOO_LARGE"
          : result.failure.includes("ANCESTOR") ? "RUNTIME_CLOSURE_ANCESTOR_INVALID" : "RUNTIME_CLOSURE_UNREADABLE";
        failures.push({ code, family: family.id, path });
        continue;
      }
      capturedBytes += result.bytes.length;
      checked += 1;
      const mode = result.stat.mode & 0o777;
      const actualSha256 = sha256(result.bytes);
      actualTreeEntries.push({ path, size: result.bytes.length, mode, sha256: actualSha256 });
      if (path.endsWith(".md")) familyTexts.set(path, result.bytes.toString("utf8"));
      if ((mode & 0o111) !== 0) failures.push({ code: "RUNTIME_CLOSURE_MODE_MISMATCH", family: family.id, path, expected: "non-executable", actual: mode });
      if (result.bytes.length !== entry.size) failures.push({ code: "RUNTIME_CLOSURE_SIZE_MISMATCH", family: family.id, path });
      if (actualSha256 !== entry.sha256) failures.push({ code: "RUNTIME_CLOSURE_HASH_MISMATCH", family: family.id, path });
    }
    const treeSha256 = canonicalRuntimeTreeSha256(actualTreeEntries);
    const commitment = EXPECTED.get(family.id);
    if (treeSha256 !== commitment.treeSha256) {
      failures.push({
        code: "RUNTIME_CLOSURE_TREE_COMMITMENT_MISMATCH",
        family: family.id,
        expected: commitment.treeSha256,
        actual: treeSha256,
      });
    }
    families.push({ id: family.id, checked, expected: family.file_count, treeSha256 });
  }
  for (const adapter of CANONICAL_RUNTIME_ADAPTER_COMMITMENTS) {
    const remainingBytes = MAX_BOUNDED_AGGREGATE_BYTES - capturedBytes;
    const result = readRegularStable(
      pluginRoot,
      join(pluginRoot, adapter.path),
      { ancestors: [...ancestorSnapshots.values()] },
      { maxBytes: Math.min(MAX_BOUNDED_FILE_BYTES, remainingBytes) },
    );
    if (result.failure) {
      const code = result.failure === "FILE_TOO_LARGE"
        ? remainingBytes < MAX_BOUNDED_FILE_BYTES
          ? "RUNTIME_CLOSURE_AGGREGATE_TOO_LARGE"
          : "RUNTIME_ADAPTER_FILE_TOO_LARGE"
        : result.failure.includes("ANCESTOR") ? "RUNTIME_CLOSURE_ANCESTOR_INVALID" : "RUNTIME_ADAPTER_UNREADABLE";
      failures.push({ code, path: adapter.path });
      continue;
    }
    capturedBytes += result.bytes.length;
    const actualSha256 = sha256(result.bytes);
    if (result.bytes.length !== adapter.size) {
      failures.push({ code: "RUNTIME_ADAPTER_SIZE_MISMATCH", path: adapter.path, expected: adapter.size, actual: result.bytes.length });
    }
    if (actualSha256 !== adapter.sha256) {
      failures.push({ code: "RUNTIME_ADAPTER_HASH_MISMATCH", path: adapter.path, expected: adapter.sha256, actual: actualSha256 });
    }
    if (((result.stat.mode & 0o111) !== 0) !== adapter.executable) {
      failures.push({ code: "RUNTIME_ADAPTER_MODE_MISMATCH", path: adapter.path, expected: "non-executable", actual: result.stat.mode & 0o777 });
    }
  }
  failures.push(...findRuntimeClosureReferenceFailures(pluginRoot, manifest, capturedTexts));
  const expectedPackageFiles = immutableExpectedFileMap(
    failures.length === 0
      ? [
        [`plugins/litclaude/${MANIFEST_PATH}`, {
          size: manifestResult.manifestBytes,
          sha256: manifestResult.snapshot.sha256,
          executable: false,
        }],
        ...manifest.families.flatMap((family) => family.files.map(({ path, size, sha256, mode }) => [
          `plugins/litclaude/${family.root}/${path}`,
          { size, sha256, executable: (mode & 0o111) !== 0 },
        ])),
        ...CANONICAL_RUNTIME_ADAPTER_COMMITMENTS.map(({ path, size, sha256, executable }) => [
          `plugins/litclaude/${path}`,
          { size, sha256, executable },
        ]),
      ]
      : [],
  );
  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    families,
    failures,
    expectedPackageFiles,
    filePaths: manifest.families.flatMap((family) =>
      family.files.map((file) => `plugins/litclaude/${family.root}/${file.path}`)),
  };
}

const rootRelativePrefixes = ["assets/", "references/", "scripts/", "skills/", "src/", "templates/"];
const localReferencePattern = /`([^`\n]+)`|\]\(([^)\s#]+)(?:#[^)]*)?\)/gu;

function referencedPaths(text, sourcePath, knownPaths) {
  const references = new Set();
  for (const match of text.matchAll(localReferencePattern)) {
    const candidate = (match[1] ?? match[2] ?? "").trim();
    if (!/\.(?:json|md|py|sh|tsv)$/u.test(candidate)
      || candidate.includes("<")
      || candidate.includes("*")
      || /^[a-z]+:/iu.test(candidate)
      || candidate.startsWith("/")) continue;
    const rootRelative = rootRelativePrefixes.some((prefix) => candidate.startsWith(prefix));
    const markdownLink = match[2] !== undefined;
    const resolved = posix.normalize(rootRelative
      ? candidate
      : posix.join(posix.dirname(sourcePath), candidate));
    if (rootRelative || markdownLink || knownPaths.has(resolved)) references.add(resolved.replace(/^\.\//u, ""));
  }
  return references;
}

export function findRuntimeClosureReferenceFailures(pluginRoot, suppliedManifest, suppliedTexts) {
  let manifest = suppliedManifest;
  let manifestResult;
  if (manifest === undefined) {
    manifestResult = readManifest(pluginRoot);
    manifest = manifestResult.manifest;
  }
  if (!validManifest(manifest)) {
    return [{ code: manifestResult?.failure ?? "RUNTIME_CLOSURE_MANIFEST_INVALID", path: MANIFEST_PATH }];
  }
  if (suppliedTexts === undefined) {
    manifestResult ??= readManifest(pluginRoot);
    const budgetFailure = runtimeBudgetFailure(manifest, manifestResult.manifestBytes);
    if (budgetFailure) return [budgetFailure];
  }

  const failures = [];
  let capturedBytes = manifestResult?.manifestBytes ?? 0;
  for (const family of manifest.families) {
    const knownPaths = new Set(family.files.map(({ path }) => path));
    const familyRoot = join(pluginRoot, family.root);
    for (const entry of family.files) {
      if (!entry.path.endsWith(".md")) continue;
      let text = suppliedTexts?.get(family.id)?.get(entry.path);
      if (text === undefined) {
        const remainingBytes = MAX_BOUNDED_AGGREGATE_BYTES - capturedBytes;
        const result = readRegularStable(pluginRoot, join(familyRoot, entry.path), undefined, {
          maxBytes: Math.min(MAX_BOUNDED_FILE_BYTES, remainingBytes),
        });
        if (result.failure) {
          const code = result.failure === "FILE_TOO_LARGE"
            ? remainingBytes < MAX_BOUNDED_FILE_BYTES
              ? "RUNTIME_CLOSURE_AGGREGATE_TOO_LARGE"
              : "RUNTIME_CLOSURE_FILE_TOO_LARGE"
            : result.failure.includes("ANCESTOR") ? "RUNTIME_CLOSURE_ANCESTOR_INVALID" : "RUNTIME_CLOSURE_UNREADABLE";
          failures.push({ code, family: family.id, path: entry.path });
          continue;
        }
        capturedBytes += result.bytes.length;
        text = result.bytes.toString("utf8");
      }
      for (const referencedPath of referencedPaths(text, entry.path, knownPaths)) {
        if (!knownPaths.has(referencedPath)) {
          failures.push({
            code: "RUNTIME_CLOSURE_REFERENCE_MISSING",
            family: family.id,
            path: entry.path,
            reference: referencedPath,
          });
        }
      }
    }
  }
  return failures;
}
