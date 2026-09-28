import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { pngChunk, runVisualCli } from "./uiux-visual-runtime.mjs";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdr(width, height) {
  const value = Buffer.alloc(13);
  value.writeUInt32BE(width, 0);
  value.writeUInt32BE(height, 4);
  value[8] = 8;
  value[9] = 6;
  return value;
}

function rgbaPng(width, height, rgba) {
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(scanlines, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function malformedPng(chunks) {
  return Buffer.concat([signature, ...chunks, pngChunk("IEND", Buffer.alloc(0))]);
}

function expectPngFailure(path, code) {
  const result = runVisualCli(["image-diff", path, path]);
  assert.notEqual(result.status, 0, `${code} must fail closed`);
  assert.match(result.stderr, new RegExp(code, "u"));
}

export async function pngStructureAndMetrics(t) {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-png-structure-"));
  try {
    await t.test("rejects duplicate IHDR, split IDAT, and unknown critical chunks", () => {
      const compressed = deflateSync(Buffer.from([0, 0, 0, 0, 255]));
      const duplicate = join(dir, "duplicate.png");
      writeFileSync(duplicate, malformedPng([
        pngChunk("IHDR", ihdr(1, 1)),
        pngChunk("IHDR", ihdr(1, 1)),
        pngChunk("IDAT", compressed),
      ]));
      expectPngFailure(duplicate, "PNG_DUPLICATE_CRITICAL_CHUNK");

      const split = join(dir, "split-idat.png");
      writeFileSync(split, malformedPng([
        pngChunk("IHDR", ihdr(1, 1)),
        pngChunk("IDAT", compressed.subarray(0, 2)),
        pngChunk("tEXt", Buffer.from("x")),
        pngChunk("IDAT", compressed.subarray(2)),
      ]));
      expectPngFailure(split, "PNG_CHUNK_ORDER_INVALID");

      const unknown = join(dir, "unknown-critical.png");
      writeFileSync(unknown, malformedPng([
        pngChunk("IHDR", ihdr(1, 1)),
        pngChunk("ABCD", Buffer.alloc(0)),
        pngChunk("IDAT", compressed),
      ]));
      expectPngFailure(unknown, "PNG_UNKNOWN_CRITICAL_CHUNK");
    });

    await t.test("rejects 16,384x4,096 RGBA at the exact aggregate allocation boundary", () => {
      const peakBoundary = join(dir, "peak-boundary.png");
      writeFileSync(peakBoundary, malformedPng([
        pngChunk("IHDR", ihdr(16_384, 4_096)),
        pngChunk("IDAT", deflateSync(Buffer.from([0]))),
      ]));
      const result = runVisualCli(["image-diff", peakBoundary, peakBoundary]);
      assert.equal(result.signal, null, "peak-boundary preflight must not exhaust the subprocess");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_RESOURCE_LIMIT.*peak decode allocation.*256 MiB/iu);
    });

    await t.test("emits every promised pixel and alpha metric", () => {
      const reference = join(dir, "reference.png");
      const actual = join(dir, "actual.png");
      writeFileSync(reference, rgbaPng(1, 1, [0, 0, 0, 255]));
      writeFileSync(actual, rgbaPng(1, 1, [255, 0, 0, 128]));
      const result = runVisualCli(["image-diff", reference, actual]);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.diffPixels, 1);
      assert.equal(report.alphaDiffPixels, 1);
      assert.equal(report.alphaChannelIntact, false);
      assert.equal(report.exactMatchRatio, 0);
      assert.equal(report.meanAbsoluteRgbaDifference, 95.5);
      assert.equal(report.maxChannelDelta, 255);
      assert.equal(report.hotspots.length, 1);
    });

    await t.test("dimension mismatch emits explicit null metric inventory", () => {
      const one = join(dir, "one.png");
      const two = join(dir, "two.png");
      writeFileSync(one, rgbaPng(1, 1, [0, 0, 0, 255]));
      writeFileSync(two, rgbaPng(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]));
      const result = runVisualCli(["image-diff", one, two]);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.dimensionsMatch, false);
      for (const field of [
        "similarityScore",
        "exactMatchRatio",
        "meanAbsoluteRgbaDifference",
        "maxChannelDelta",
      ]) assert.equal(report[field], null, `${field} must be explicit null`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runTui(dir, name, text, columns) {
  const path = join(dir, `${name}.txt`);
  writeFileSync(path, text);
  return runVisualCli(["tui-check", path, "--cols", String(columns)]);
}

export async function tuiTopologyAndControls(t) {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-tui-topology-"));
  try {
    await t.test("accepts continuous topology with CJK, emoji, CSI, and bounded OSC", () => {
      const oscOpen = "\u001b]8;;https://example.invalid/\u0007";
      const oscClose = "\u001b]8;;\u0007";
      const result = runTui(
        dir,
        "valid",
        `┌────┐\n│\u001b[31m한${oscOpen}👩‍💻${oscClose}\u001b[0m│\n└────┘\n`,
        6,
      );
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "PASS");
      assert.equal(report.topologyValid, true);
      assert.equal(report.verticalContinuity, true);
      assert.equal(report.controlSequencesValid, true);
      assert.equal(report.unicodeWidthValid, true);
      assert.deepEqual(report.lineWidths, [6, 6, 6]);
    });

    await t.test("rejects broken vertical frame continuity", () => {
      const result = runTui(dir, "broken", "┌──┐\n│한 \n└──┘\n", 4);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.verdict, "FAIL");
      assert.equal(report.verticalContinuity, false);
      assert.ok(report.codes.includes("TUI_TOPOLOGY_INVALID"));
    });

    await t.test("rejects corner-only, mixed, and missing-junction border topology", () => {
      for (const [name, capture] of [
        ["corner-only", "┌abcd┐\n│abcd│\n└abcd┘\n"],
        ["mixed-border", "┌──┐\n│ab┃\n└──┘\n"],
        ["missing-junction", "┌─ ┐\n│ab│\n└──┘\n"],
      ]) {
        const result = runTui(dir, name, capture, capture.includes("abcd") ? 6 : 4);
        assert.notEqual(result.status, 0, `${name} must fail`);
        const report = JSON.parse(result.stdout);
        assert.equal(report.topologyValid, false);
        assert.ok(report.codes.includes("TUI_TOPOLOGY_INVALID"));
      }
    });

    await t.test("rejects unterminated OSC control payloads", () => {
      const result = runTui(dir, "osc", "┌──┐\n│\u001b]8;;bad한│\n└──┘\n", 4);
      assert.notEqual(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.controlSequencesValid, false);
      assert.ok(report.codes.includes("TUI_CONTROL_SEQUENCE_INVALID"));
    });

    await t.test("rejects captures above the byte and line bounds before emitting arrays", () => {
      for (const [name, capture] of [
        ["bytes", "x".repeat(1024 * 1024 + 1)],
        ["lines", "x\n".repeat(4097)],
      ]) {
        const result = runTui(dir, name, capture, 80);
        assert.notEqual(result.status, 0, `${name} must fail closed`);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /TUI_INPUT_TOO_LARGE/u);
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
