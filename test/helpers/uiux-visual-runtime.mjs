import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const rootPath = fileURLToPath(new URL("../../", import.meta.url));
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);

export function snapshotTree(path, prefix = "") {
  if (!existsSync(path)) return [];
  const entries = [];
  const sorted = readdirSync(path, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name));
  for (const entry of sorted) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    entries.push(`${entry.isDirectory() ? "d" : "f"}:${relativePath}`);
    if (entry.isDirectory()) entries.push(...snapshotTree(join(path, entry.name), relativePath));
  }
  return entries;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

export function boundedFixturePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function corruptChunkCrc(png, chunkType) {
  const corrupted = Buffer.from(png);
  let offset = 8;
  while (offset + 12 <= corrupted.length) {
    const length = corrupted.readUInt32BE(offset);
    const type = corrupted.toString("ascii", offset + 4, offset + 8);
    const crcOffset = offset + 8 + length;
    if (type === chunkType) {
      corrupted[crcOffset + 3] ^= 0xff;
      return corrupted;
    }
    offset = crcOffset + 4;
  }
  throw new Error(`fixture is missing ${chunkType}`);
}

export function queryCliPath() {
  return join(
    rootPath,
    "plugins",
    "litclaude",
    "skills",
    "frontend-ui-ux",
    "scripts",
    "query-design-intelligence.mjs",
  );
}

export function runQuery(args, options = {}) {
  const queryCli = queryCliPath();
  assert.equal(existsSync(queryCli), true, "frontend-ui-ux is missing its packaged offline query runtime");
  return spawnSync(process.execPath, [queryCli, ...args], {
    cwd: rootPath,
    encoding: "utf8",
    timeout: 5000,
    ...options,
  });
}

export function runVisualCli(args, options = {}) {
  const scriptsRoot = join(rootPath, "plugins", "litclaude", "skills", "visual-qa", "scripts");
  const directRuntime = join(scriptsRoot, "cli.mjs");
  const fallbackRuntime = join(scriptsRoot, "cli.ts");
  const runtimeArgs = existsSync(directRuntime)
    ? [directRuntime, ...args]
    : ["--experimental-strip-types", fallbackRuntime, ...args];
  return spawnSync(process.execPath, runtimeArgs, {
    cwd: rootPath,
    encoding: "utf8",
    timeout: 5000,
    ...options,
  });
}

export function evidenceManifest(overrides = {}) {
  return {
    schema_id: "litfamily.evidence-manifest/v1alpha1",
    tier: "smoke",
    design_contract_hash: HASH_A,
    source_revision: "revision-under-test",
    source_hash: HASH_B,
    capture_id: "capture-under-test",
    capture_hash: HASH_C,
    created_at: "2026-07-24T11:30:00.000Z",
    maximum_age: 3600,
    capabilities: {
      capture: true,
      auth: true,
      test_account_safe: true,
      independent_review: true,
    },
    inventory: [
      { id: "route:primary", kind: "route", status: "captured", evidence_hash: HASH_A },
      { id: "interaction:critical", kind: "interaction", status: "captured", evidence_hash: HASH_B },
      { id: "viewport:smallest", kind: "viewport", status: "captured", evidence_hash: HASH_C },
      { id: "viewport:largest", kind: "viewport", status: "captured", evidence_hash: HASH_A },
    ],
    mechanical_results: [],
    review_receipt_hashes: [HASH_B, HASH_C],
    cleanup: { status: "complete" },
    verdict: "PASS",
    ...overrides,
  };
}

export function validateEvidence(dir, name, manifest, extraArgs = []) {
  const manifestPath = join(dir, `${name}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  return runVisualCli([
    "validate-evidence",
    manifestPath,
    "--tier",
    manifest.tier,
    "--now",
    "2026-07-24T12:00:00.000Z",
    "--json",
    ...extraArgs,
  ]);
}

export function nonPassReport(result, expectedCode) {
  assert.equal(result.signal, null, `evidence validation timed out for ${expectedCode}`);
  assert.notEqual(result.status, 0, `${expectedCode} must not exit as a successful PASS`);
  assert.notEqual(result.stdout.trim(), "", `${expectedCode} must emit a machine-readable non-PASS receipt`);
  const report = JSON.parse(result.stdout);
  assert.notEqual(report.verdict, "PASS");
  const codes = [...(report.blocked_codes ?? []), ...(report.failure_codes ?? []), ...(report.codes ?? [])];
  assert.ok(codes.includes(expectedCode), `non-PASS receipt must contain ${expectedCode}`);
  return report;
}
