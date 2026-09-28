import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PRODUCT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GUARD = join(PRODUCT_ROOT, "tools", "check-version-lockstep.mjs");
const REGISTRY_PATH = join(PRODUCT_ROOT, "tools", "version-manifests.json");
const VERSION = JSON.parse(readFileSync(join(PRODUCT_ROOT, "package.json"), "utf8")).version;

function runGuard() {
  return spawnSync(process.execPath, [GUARD], {
    cwd: PRODUCT_ROOT,
    encoding: "utf8",
    shell: false,
  });
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: PRODUCT_ROOT,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter(Boolean);
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function countVersion(haystack, version = VERSION) {
  const escaped = version.replace(/\./gu, "\\.");
  return countOccurrences(haystack, version) + countOccurrences(haystack, escaped);
}

function versionBearingFiles() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const versions = [VERSION, ...registry.manifests.filter((entry) => entry.kind === "compatibility").map((entry) => entry.version)];
  return trackedFiles()
    .filter((relativePath) => {
      let source;
      try {
        source = readFileSync(join(PRODUCT_ROOT, relativePath), "utf8");
      } catch {
        return false;
      }
      return versions.some((version) => source.includes(version) || source.includes(version.replace(/\./gu, "\\.")));
    })
    .sort();
}

test("the version lockstep guard accepts the committed repository", () => {
  const result = runGuard();
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
});

test("a drifted literal pin fails and names its file", () => {
  const target = join(PRODUCT_ROOT, "README.md");
  const original = readFileSync(target, "utf8");
  assert.ok(original.includes(VERSION), "fixture precondition: README.md pins the release");
  try {
    writeFileSync(target, original.replace(VERSION, "0.0.0"), "utf8");
    const result = runGuard();
    assert.notEqual(result.status, 0, "guard must reject a drifted literal pin");
    assert.match(result.stdout + "\n" + result.stderr, /README\.md/u);
  } finally {
    writeFileSync(target, original, "utf8");
  }
  assert.equal(runGuard().status, 0, "guard must pass after the literal pin is restored");
});

test("a drifted escaped-regex pin fails and names its file", () => {
  const target = join(PRODUCT_ROOT, "test", "release-checklist.test.mjs");
  const original = readFileSync(target, "utf8");
  const escaped = VERSION.replace(/\./gu, "\\.");
  assert.ok(original.includes(escaped), "fixture precondition: release-checklist.test.mjs pins an escaped release");
  try {
    writeFileSync(target, original.replace(escaped, "0\\.0\\.0"), "utf8");
    const result = runGuard();
    assert.notEqual(result.status, 0, "guard must reject a drifted escaped pin");
    assert.match(result.stdout + "\n" + result.stderr, /test[\\/]release-checklist\.test\.mjs/u);
  } finally {
    writeFileSync(target, original, "utf8");
  }
  assert.equal(runGuard().status, 0, "guard must pass after the escaped pin is restored");
});

test("every tracked file carrying either version spelling is registered", () => {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  assert.ok(registry && Array.isArray(registry.manifests), "registry must contain a manifests array");
  const registered = registry.manifests.map((entry) => entry.path).sort();
  assert.deepEqual(registered, [...new Set(registered)].sort(), "registry paths must be unique");
  assert.deepEqual(
    registered,
    versionBearingFiles(),
    "every tracked file carrying the literal or escaped release must be registered exactly once",
  );
});

test("registry counts cover both version spellings", () => {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  for (const entry of registry.manifests) {
    const source = readFileSync(join(PRODUCT_ROOT, entry.path), "utf8");
    const countedVersion = entry.kind === "compatibility" ? entry.version : VERSION;
    const incidental = (entry.incidental ?? []).reduce((total, anchor) => total + countVersion(anchor.text, countedVersion) * anchor.occurrences, 0);
    assert.equal(countVersion(source, countedVersion), entry.occurrences + incidental, entry.path + " occurrence count is stale");
  }
});

test("each registry entry declares a valid kind, count, and reason", () => {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  for (const entry of registry.manifests) {
    assert.ok(["pinned", "history", "derived", "compatibility"].includes(entry.kind), "bad kind for " + entry.path);
    assert.equal(Number.isInteger(entry.occurrences), true, "occurrences missing for " + entry.path);
    assert.ok(entry.occurrences > 0, "occurrences must be positive for " + entry.path);
    assert.equal(typeof entry.why, "string", "why missing for " + entry.path);
    assert.ok(entry.why.trim().length > 0, "why must be non-empty for " + entry.path);
  }
});

test("a compatibility baseline remains checked independently of the release version", () => {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const entry = registry.manifests.find((entry) => entry.kind === "compatibility" && entry.path !== "tools/version-manifests.json");
  assert.ok(entry, "a frozen migration baseline must be classified");
  const target = join(PRODUCT_ROOT, entry.path), original = readFileSync(target, "utf8");
  try {
    writeFileSync(target, original.replace(entry.version, "0.0.0"));
    const result = runGuard();
    assert.notEqual(result.status, 0, "legacy baseline drift must still fail");
    assert.ok((result.stdout + result.stderr).includes(entry.path));
  } finally { writeFileSync(target, original); }
  assert.equal(runGuard().status, 0);
});

test("incidental fixture anchors reject changed identity even when version counts match", () => {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const entry = registry.manifests.find((entry) => entry.incidental?.length);
  assert.ok(entry, "mixed release and third-party fixture pins must be classified");
  const target = join(PRODUCT_ROOT, entry.path), original = readFileSync(target, "utf8");
  const anchor = entry.incidental[0];
  try {
    writeFileSync(target, original.replace(anchor.text, anchor.text.replace("claude-plugins-official", "foreign-marketplace")));
    const result = runGuard();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incidental fixture drift/u);
  } finally { writeFileSync(target, original); }
  assert.equal(runGuard().status, 0);
});

test("omitted or duplicated incidental classifications cannot hide release drift", () => {
  const original = readFileSync(REGISTRY_PATH, "utf8");
  const target = join(PRODUCT_ROOT, JSON.parse(original).manifests.find((entry) => entry.incidental?.length).path);
  const source = readFileSync(target, "utf8");
  // An anchor only offsets the release count when its fixture text carries the release
  // version, so give the last anchor that overlap before omitting it.
  const withOverlap = (mutate) => {
    const registry = JSON.parse(original);
    const entry = registry.manifests.find((entry) => entry.incidental?.length);
    const anchor = entry.incidental.at(-1);
    const overlapping = anchor.text.replace(/\d+\.\d+\.\d+/gu, VERSION);
    writeFileSync(target, source.replace(anchor.text, overlapping));
    anchor.text = overlapping;
    mutate(entry);
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry));
  };
  try {
    withOverlap(() => {});
    assert.equal(runGuard().status, 0, "overlap control");
    for (const mutation of ["omit", "duplicate"]) {
      withOverlap((entry) => {
        if (mutation === "omit") entry.incidental.pop();
        else entry.incidental.push(entry.incidental[0]);
      });
      assert.notEqual(runGuard().status, 0, mutation);
    }
  } finally {
    writeFileSync(target, source);
    writeFileSync(REGISTRY_PATH, original);
  }
  assert.equal(runGuard().status, 0);
});
