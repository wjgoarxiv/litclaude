import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import zlib from "node:zlib";

import { ffmpegMetadataArgs, generatorString, svgWithMetadata, tagFile, tagGifBuffer, tagPdfBuffer, tagPngBuffer, tagWebpBuffer } from "../plugins/litclaude/lib/mark.mjs";
import { parseWebp } from "../plugins/litclaude/skills/lit-typographic-motion/engine/node/webp.mjs";

const GEN = generatorString();
const has = (tool) => spawnSync(tool, ["-version"], { encoding: "utf8" }).status === 0 || spawnSync(tool, ["-h"], { encoding: "utf8" }).status === 0;
const opts = (mode) => ({ env: { LITCLAUDE_MARK: mode }, litHome: join(tmpdir(), "litclaude-mark-none") });

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
};
const tinyPng = (rgb = [255, 0, 0]) => {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from([0, ...rgb]))), chunk("IEND", Buffer.alloc(0))]);
};
const pngChunks = (buf) => {
  const out = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("latin1", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    const crc = buf.readUInt32BE(o + 8 + len);
    out.push({ type, data, crcOk: (zlib.crc32(buf.subarray(o + 4, o + 8 + len)) >>> 0) === crc });
    o += 12 + len;
  }
  return out;
};
const pngSoftware = (buf) => pngChunks(buf).filter((c) => c.type === "tEXt" && c.data.toString("latin1").startsWith("Software\0")).map((c) => c.data.toString("latin1").slice(9));
// GIF89a 1x1, global colour table of 2, one image, trailer.
const tinyGif = () => Buffer.from("474946383961010001008000000000ffffff2c00000000010001000002024401003b", "hex");
const gifComments = (buf) => {
  const found = [];
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] !== 0x21 || buf[i + 1] !== 0xfe) continue;
    const parts = [];
    let o = i + 2;
    while (buf[o]) { parts.push(buf.subarray(o + 1, o + 1 + buf[o])); o += 1 + buf[o]; }
    found.push(Buffer.concat(parts).toString("utf8"));
  }
  return found;
};
const webpChunks = (buf) => {
  const out = [];
  for (let o = 12; o + 8 <= buf.length;) {
    const size = buf.readUInt32LE(o + 4);
    out.push({ type: buf.toString("latin1", o, o + 4), body: buf.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size & 1);
  }
  return out;
};

describe("generator tag in media outputs", () => {
  it("PNG: one tEXt Software chunk before IEND, valid CRC, idempotent", () => {
    const tagged = tagPngBuffer(tinyPng(), GEN);
    const chunks = pngChunks(tagged);
    assert.deepEqual(pngSoftware(tagged), [GEN]);
    assert.equal(chunks.at(-1).type, "IEND");
    assert.ok(chunks.every((c) => c.crcOk));
    assert.deepEqual(pngSoftware(tagPngBuffer(tagged, GEN)), [GEN]);
    assert.throws(() => tagPngBuffer(Buffer.from("not a png"), GEN), /not a PNG/u);
    const truncated = Buffer.from(tinyPng());
    truncated.writeUInt32BE(0x7fffffff, 8 + 13 + 12);
    assert.throws(() => tagPngBuffer(truncated, GEN), /runs past the end/u);
  });

  it("GIF: one comment extension after the colour table, idempotent", () => {
    const tagged = tagGifBuffer(tinyGif(), GEN);
    assert.deepEqual(gifComments(tagged), [GEN]);
    assert.equal(tagged.subarray(0, 13 + 6).toString("hex"), tinyGif().subarray(0, 19).toString("hex"));
    assert.equal(tagged.at(-1), 0x3b);
    assert.deepEqual(gifComments(tagGifBuffer(tagged, GEN)), [GEN]);
  });

  it("SVG: one <metadata> right after the root element, idempotent, body unchanged", () => {
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="1"/></svg>';
    const tagged = svgWithMetadata(svg, GEN);
    assert.equal(tagged, svg.replace('viewBox="0 0 10 10">', `viewBox="0 0 10 10"><metadata id="litclaude-generator">${GEN}</metadata>`));
    assert.equal(svgWithMetadata(tagged, GEN), tagged);
  });

  it("ffmpeg arguments name the generator in on and meta and nothing in off, with no time or random value", () => {
    assert.deepEqual(ffmpegMetadataArgs(opts("on")), ["-metadata", `comment=${GEN}`]);
    assert.deepEqual(ffmpegMetadataArgs(opts("meta")), ["-metadata", `comment=${GEN}`]);
    assert.deepEqual(ffmpegMetadataArgs(opts("off")), []);
  });

  it("tagFile rewrites png, gif and svg in on and meta and leaves them byte-identical in off", () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-mark-media-"));
    try {
      const samples = { "a.png": tinyPng(), "a.gif": tinyGif(), "a.svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') };
      for (const mode of ["on", "meta", "off"]) {
        for (const [name, bytes] of Object.entries(samples)) {
          const file = join(dir, name);
          writeFileSync(file, bytes);
          assert.equal(tagFile(file, opts(mode)), mode !== "off", `${mode} ${name}`);
          const after = readFileSync(file);
          if (mode === "off") assert.ok(after.equals(bytes), `${name} untouched in off`);
          else assert.ok(after.includes(Buffer.from("LitClaude")), `${name} tagged in ${mode}`);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("animated WebP: XMP chunk and VP8X flag set; the motion engine still parses every frame", { skip: has("img2webp") ? false : "img2webp not on PATH" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "litclaude-mark-webp-"));
    try {
      writeFileSync(join(dir, "1.png"), tinyPng());
      writeFileSync(join(dir, "2.png"), tinyPng([0, 0, 255]));
      const made = spawnSync("img2webp", ["-loop", "0", "-lossy", "-d", "100", join(dir, "1.png"), "-d", "100", join(dir, "2.png"), "-o", join(dir, "a.webp")], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
      const before = readFileSync(join(dir, "a.webp"));
      const tagged = tagWebpBuffer(before, GEN);
      const chunks = webpChunks(tagged);
      assert.equal(tagged.readUInt32LE(4), tagged.length - 8);
      assert.ok(chunks[0].type === "VP8X" && chunks[0].body[0] & 0x04, "XMP flag");
      const xmp = chunks.filter((c) => c.type === "XMP ");
      assert.equal(xmp.length, 1);
      assert.match(xmp[0].body.toString("utf8"), new RegExp(`<xmp:CreatorTool>${GEN.replace(/[.]/gu, "\\.")}</xmp:CreatorTool>`, "u"));
      const a = parseWebp(before), b = parseWebp(tagged);
      assert.equal(b.frames.length, a.frames.length);
      assert.deepEqual([b.width, b.height, b.loop], [a.width, a.height, a.loop]);
      assert.ok(tagWebpBuffer(tagged, GEN).equals(tagged), "idempotent");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("PDF: an incremental update whose trailer points Info at the generator; original bytes kept in front", () => {
    const objs = ["<</Type /Catalog /Pages 2 0 R>>", "<</Type /Pages /Kids [] /Count 0>>", "<</Producer (Skia/PDF)>>"];
    let body = "%PDF-1.4\n";
    const offsets = objs.map((o, i) => { const at = body.length; body += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
    const xrefAt = body.length;
    body += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<</Size 4 /Root 1 0 R /Info 3 0 R /ID [<AA><BB>]>>\nstartxref\n${xrefAt}\n%%EOF\n`;
    const pdf = Buffer.from(body, "latin1");
    const tagged = tagPdfBuffer(pdf, GEN);
    assert.ok(tagged.subarray(0, pdf.length).equals(pdf));
    const text = tagged.toString("latin1");
    const last = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/u)[1]);
    assert.equal(text.slice(last, last + 4), "xref");
    const trailer = text.slice(last).match(/trailer\n<<(.*)>>\nstartxref/u)[1];
    assert.match(trailer, /\/Size 5 \/Root 1 0 R \/Info 4 0 R \/ID \[<AA><BB>\] \/Prev \d+/u);
    const entry = Number(text.slice(last).match(/xref\n4 1\n(\d{10}) 00000 n /u)[1]);
    const hex = Buffer.from(GEN, "utf16le").swap16().toString("hex").toUpperCase();
    assert.ok(text.slice(entry).startsWith(`4 0 obj\n<</Creator <FEFF${hex}> /Producer <FEFF${hex}>>>`));
    assert.ok(tagPdfBuffer(tagged, GEN).equals(tagged), "idempotent");
    const stream = Buffer.from(`%PDF-1.5\n1 0 obj\n<</Type /XRef>>\nendobj\nstartxref\n9\n%%EOF\n`, "latin1");
    assert.ok(tagPdfBuffer(stream, GEN).equals(stream), "a cross-reference stream is left as it is");
  });

  it("a still (simple-format) WebP is left as it is", () => {
    const still = Buffer.concat([Buffer.from("RIFF"), Buffer.from([12, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.from([0, 0, 0, 0])]);
    assert.ok(tagWebpBuffer(still, GEN).equals(still));
  });
});
