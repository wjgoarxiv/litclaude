import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  boundedFixturePng,
  corruptChunkCrc,
  runVisualCli,
} from "./uiux-visual-runtime.mjs";

export async function pngResourceBounds(t) {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-visual-png-bounds-"));
  const oversizedDimensions = join(dir, "oversized-dimensions.png");
  const oversizedBytes = join(dir, "oversized-bytes.png");
  const corruptedCrc = join(dir, "corrupted-crc.png");
  const truncated = join(dir, "truncated.png");
  try {
    writeFileSync(oversizedDimensions, boundedFixturePng(16_385, 1));
    writeFileSync(oversizedBytes, Buffer.alloc(25 * 1024 * 1024 + 1, 0));
    const validSmallPng = boundedFixturePng(1, 1);
    writeFileSync(corruptedCrc, corruptChunkCrc(validSmallPng, "IDAT"));
    writeFileSync(truncated, validSmallPng.subarray(0, validSmallPng.length - 5));

    await t.test("rejects dimensions above 16,384 before allocation or inflate", () => {
      const result = runVisualCli(["image-diff", oversizedDimensions, oversizedDimensions]);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_RESOURCE_LIMIT.*16,?384/iu);
    });
    await t.test("rejects files above 25 MiB before decode", () => {
      const result = runVisualCli(["image-diff", oversizedBytes, oversizedBytes]);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_FILE_TOO_LARGE.*25 MiB/iu);
    });
    await t.test("rejects a corrupted chunk CRC instead of trusting its payload", () => {
      const result = runVisualCli(["image-diff", corruptedCrc, corruptedCrc]);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_CRC_MISMATCH.*IDAT/iu);
    });
    await t.test("rejects a truncated chunk stream with a stable code", () => {
      const result = runVisualCli(["image-diff", truncated, truncated]);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_TRUNCATED/iu);
    });
    await t.test("rejects a pathname identity swap during the CLI read", () => {
      const target = join(dir, "swap-target.png");
      const replacement = join(dir, "swap-replacement.png");
      const preload = join(dir, "swap-preload.mjs");
      writeFileSync(target, validSmallPng);
      writeFileSync(replacement, validSmallPng);
      writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.fstatSync;
let swapped = false;
fs.fstatSync = function(...args) {
  const stat = original.apply(this, args);
  if (!swapped) {
    swapped = true;
    fs.renameSync(process.env.LITCLAUDE_PNG_REPLACEMENT, process.env.LITCLAUDE_PNG_TARGET);
  }
  return stat;
};
syncBuiltinESMExports();
`);
      const result = runVisualCli(["image-diff", target, target], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          LITCLAUDE_PNG_TARGET: target,
          LITCLAUDE_PNG_REPLACEMENT: replacement,
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_FILE_INVALID/iu);
    });
    await t.test("rejects PNG growth during the CLI read", () => {
      const target = join(dir, "growth-target.png");
      const preload = join(dir, "growth-preload.mjs");
      writeFileSync(target, validSmallPng);
      writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.readSync;
const target = fs.statSync(process.env.LITCLAUDE_PNG_TARGET);
let grown = false;
fs.readSync = function(...args) {
  const opened = fs.fstatSync(args[0]);
  if (!grown && opened.dev === target.dev && opened.ino === target.ino) {
    grown = true;
    fs.appendFileSync(process.env.LITCLAUDE_PNG_TARGET, Buffer.from([0]));
  }
  return original.apply(this, args);
};
syncBuiltinESMExports();
`);
      const result = runVisualCli(["image-diff", target, target], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          LITCLAUDE_PNG_TARGET: target,
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_FILE_INVALID/iu);
    });
    await t.test("rejects a symlinked PNG ancestor on the public CLI", () => {
      const real = join(dir, "real-ancestor");
      const alias = join(dir, "linked-ancestor");
      mkdirSync(real);
      writeFileSync(join(real, "capture.png"), validSmallPng);
      symlinkSync(real, alias, "dir");
      const linked = join(alias, "capture.png");
      const result = runVisualCli(["image-diff", linked, linked]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PNG_FILE_INVALID/iu);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function tuiUnicodeOsc() {
  const dir = mkdtempSync(join(tmpdir(), "litclaude-visual-unicode-"));
  const capturePath = join(dir, "capture-ansi.txt");
  const oscOpen = "\u001b]8;;https://example.invalid/\u0007";
  const oscClose = "\u001b]8;;\u0007";
  const capture = `┌──┐\n│${oscOpen}👩‍💻${oscClose}│\n└──┘\n`;
  try {
    writeFileSync(capturePath, capture);
    const result = runVisualCli(["tui-check", capturePath, "--cols", "4"]);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.maxWidth, 4);
    assert.deepEqual(report.lineWidths, [4, 4, 4]);
    assert.deepEqual(report.overflowLines, []);
    assert.equal(report.borderMisaligned, false);
    assert.equal(report.hasAnsi, true);
    assert.equal(readFileSync(capturePath, "utf8"), capture);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
