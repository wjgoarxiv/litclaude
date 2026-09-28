#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_RUNTIME_COMMITMENTS,
  canonicalRuntimeTreeSha256,
} from "../plugins/litclaude/lib/canonical-runtime-commitments.mjs";
import {
  MAX_BOUNDED_AGGREGATE_BYTES,
  MAX_BOUNDED_FILE_BYTES,
  readRegularStable,
} from "../plugins/litclaude/lib/secure-path-read.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginRoot = join(root, "plugins", "litclaude");
const manifestPath = join(pluginRoot, "vendor", "canonical-runtime-closures.json");

function listRegularFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const stat = lstatSync(path);
        if (!stat.isFile()) throw new Error(`non-regular runtime closure entry: ${path}`);
        files.push(path);
      }
    }
  };
  visit(directory);
  return files.sort();
}

function buildManifest(budget) {
  return {
    schema_version: "litclaude.canonical-runtime-closures/v1",
    families: [...CANONICAL_RUNTIME_COMMITMENTS].map(([id, commitment]) => {
      const { root: familyRoot, commit: sourceCommit } = commitment;
      const absoluteRoot = join(pluginRoot, familyRoot);
      const files = listRegularFiles(absoluteRoot).map((path) => {
        const remainingBytes = MAX_BOUNDED_AGGREGATE_BYTES - budget.capturedBytes;
        const result = readRegularStable(pluginRoot, path, undefined, {
          maxBytes: Math.min(MAX_BOUNDED_FILE_BYTES, remainingBytes),
        });
        if (result.failure) {
          const code = result.failure === "FILE_TOO_LARGE"
            ? remainingBytes < MAX_BOUNDED_FILE_BYTES
              ? "RUNTIME_CLOSURE_AGGREGATE_TOO_LARGE"
              : "RUNTIME_CLOSURE_FILE_TOO_LARGE"
            : "RUNTIME_CLOSURE_FILE_READ_FAILED";
          throw new Error(`${code}: ${relative(pluginRoot, path).replaceAll("\\", "/")}`);
        }
        budget.capturedBytes += result.bytes.length;
        return {
          path: relative(absoluteRoot, path).replaceAll("\\", "/"),
          size: result.bytes.length,
          mode: result.stat.mode & 0o777,
          sha256: createHash("sha256").update(result.bytes).digest("hex"),
        };
      });
      return {
        id,
        source_commit: sourceCommit,
        root: familyRoot,
        file_count: files.length,
        files,
      };
    }),
  };
}

const currentManifest = readRegularStable(pluginRoot, manifestPath, undefined, {
  maxBytes: MAX_BOUNDED_FILE_BYTES,
});
if (currentManifest.failure) {
  const code = currentManifest.failure === "FILE_TOO_LARGE"
    ? "RUNTIME_CLOSURE_MANIFEST_TOO_LARGE"
    : "RUNTIME_CLOSURE_MANIFEST_READ_FAILED";
  process.stderr.write(`${code}: vendor/canonical-runtime-closures.json\n`);
  process.exit(1);
}

let manifest;
try {
  manifest = buildManifest({ capturedBytes: currentManifest.bytes.length });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
const commitmentFailures = manifest.families.filter((family) =>
  canonicalRuntimeTreeSha256(family.files) !== CANONICAL_RUNTIME_COMMITMENTS.get(family.id).treeSha256);
if (commitmentFailures.length > 0) {
  for (const family of commitmentFailures) {
    process.stderr.write(`RUNTIME_CLOSURE_TREE_COMMITMENT_MISMATCH: ${family.id} at ${family.source_commit}\n`);
  }
  process.exit(1);
}

const next = `${JSON.stringify(manifest, null, 2)}\n`;
const current = currentManifest.bytes.toString("utf8");
if (next === current) {
  process.stdout.write("canonical-runtime-closures OK\n");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  process.stderr.write("canonical-runtime-closures DRIFT: run npm run gen:runtime-closures\n");
  process.exit(1);
}
writeFileSync(manifestPath, next);
process.stdout.write("canonical-runtime-closures WROTE\n");
