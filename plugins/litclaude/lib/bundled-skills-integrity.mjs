import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const handoffHashes = new Map([
  ["SKILL.md", "e5bbd253dfa5b5baa9739dfaebc458003daab43cb27c4a407423da1e7a31dec6"],
  ["evals/evals.json", "0a70f0d149e59641100c7dcf8b9f2f1c0ceae57b98518e165f08088f2c2484da"],
  ["examples/HANDOFF-example-generic-auth-refactor.md", "43c767e573ac8c8900832d2b7a92ee1e83fd2d3d794fe2c82ecef87e5737f2a3"],
  ["templates/HANDOFF.md", "2a795a06e7bb81a57e6675ae70ed26db0dbfdb792c01f0a60f96f02cbef49fbd"],
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return files.sort();
};

const verifyFileSet = (root, expectedHashes, aggregatePrefix, expectedAggregate) => {
  const expectedFiles = [...expectedHashes.keys()];
  const actualFiles = listFiles(root);
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);
  const missing = expectedFiles.filter((path) => !actualSet.has(path));
  const extra = actualFiles.filter((path) => !expectedSet.has(path));
  const nonRegular = actualFiles.filter((path) => !lstatSync(join(root, path)).isFile());
  const hashMismatches = [];
  const actualHashes = new Map();

  for (const [path, expected] of expectedHashes) {
    if (!actualSet.has(path) || nonRegular.includes(path)) continue;
    const actual = sha256(readFileSync(join(root, path)));
    actualHashes.set(path, actual);
    if (actual !== expected) hashMismatches.push({ path, expected, actual });
  }

  const aggregate = missing.length === 0
    ? sha256(expectedFiles.map((path) => `${actualHashes.get(path)}  ${aggregatePrefix}/${path}\n`).join(""))
    : null;
  const aggregateMatches = expectedAggregate === undefined || aggregate === expectedAggregate;
  const status = missing.length === 0
    && extra.length === 0
    && nonRegular.length === 0
    && hashMismatches.length === 0
    && aggregateMatches
    ? "PASS"
    : "FAIL";

  return {
    status,
    root,
    expectedCount: expectedFiles.length,
    actualCount: actualFiles.length,
    missing,
    extra,
    nonRegular,
    hashMismatches,
    ...(expectedAggregate === undefined ? {} : { aggregate, expectedAggregate, aggregateMatches }),
  };
};

// The scientific-visualization snapshot left with the figures family (wjgoarxiv-skills); handoff is the one left.
export const verifyBundledSkillsIntegrity = (pluginRoot) => {
  const handoff = verifyFileSet(join(pluginRoot, "vendor", "handoff"), handoffHashes, "handoff");
  return { status: handoff.status, handoff };
};
