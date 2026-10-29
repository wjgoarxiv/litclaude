import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { generatorString } from "../plugins/litclaude/lib/mark.mjs";
import { findChrome } from "../plugins/litclaude/skills/lit-schematic/scripts/render.mjs";
import { startMaster, tagStaged } from "../plugins/litclaude/skills/lit-typographic-motion/engine/node/encode.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skills = join(root, "plugins", "litclaude", "skills");
const GEN = generatorString();
const chrome = findChrome();
const tool = (name) => spawnSync(name, ["-version"], { encoding: "utf8" }).status === 0;
const work = () => mkdtempSync(join(tmpdir(), "litclaude-mark-engines-"));
const envFor = (dir, mode) => ({ ...process.env, LITCLAUDE_HOME: join(dir, "lit-home"), LITCLAUDE_MARK: mode });
const node = (dir, mode, args) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: envFor(dir, mode), timeout: 600_000 });
const pngSoftware = (buf) => {
  const found = [];
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o);
    if (buf.toString("latin1", o + 4, o + 8) === "tEXt" && buf.toString("latin1", o + 8, o + 17) === "Software\0") found.push(buf.toString("latin1", o + 17, o + 8 + len));
    o += 12 + len;
  }
  return found;
};
const hex = Buffer.from(GEN, "utf16le").swap16().toString("hex").toUpperCase();
const ffprobeComment = (file) => spawnSync("ffprobe", ["-v", "error", "-show_entries", "format_tags=comment", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).stdout.trim();

describe("lit-schematic outputs carry the generator tag", { skip: chrome ? false : "Chrome not found" }, () => {
  it("SVG <metadata>, PNG Software chunk and PDF Info in on and meta; none in off", () => {
    const dir = work();
    try {
      for (const mode of ["on", "meta", "off"]) {
        const out = join(dir, mode);
        const built = node(dir, mode, [join(skills, "lit-schematic", "examples", "pid-dosing-skid", "build.mjs"), out]);
        assert.equal(built.status, 0, built.stderr);
        const svgFile = join(out, readdirSync(out).find((f) => f.endsWith(".svg")));
        const svg = readFileSync(svgFile, "utf8");
        const r = node(dir, mode, [join(skills, "lit-schematic", "scripts", "render.mjs"), svgFile, "--png", join(out, "a.png"), "--dpi", "96", "--pdf", join(out, "a.pdf")]);
        assert.equal(r.status, 0, r.stderr);
        const png = pngSoftware(readFileSync(join(out, "a.png")));
        const pdf = readFileSync(join(out, "a.pdf")).toString("latin1");
        if (mode === "off") {
          assert.ok(!svg.includes("litclaude-generator"), "svg off");
          assert.deepEqual(png, [], "png off");
          assert.ok(!pdf.includes(hex), "pdf off");
        } else {
          assert.equal((svg.match(/<metadata id="litclaude-generator">/gu) ?? []).length, 1, `svg ${mode}`);
          assert.ok(svg.includes(`<metadata id="litclaude-generator">${GEN}</metadata>`), `svg ${mode}`);
          assert.deepEqual(png, [GEN], `png ${mode}`);
          assert.ok(pdf.includes(`/Creator <FEFF${hex}>`), `pdf ${mode}: Chrome's PDF ends in a classic xref table and was updated`);
          assert.match(pdf, /\/Info (\d+) 0 R[^>]*\/Prev \d+>>\nstartxref\n\d+\n%%EOF\n$/u, `pdf ${mode}: trailer`);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("the loop's MP4 comment, GIF comment and WebP XMP in meta; none in off; working frames untagged", { skip: tool("ffmpeg") && tool("img2webp") ? false : "ffmpeg/img2webp not on PATH" }, () => {
    const dir = work();
    try {
      const scene = join(dir, "scene.mjs");
      writeFileSync(scene, `export const frame = (t) => \`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect width="40" height="20" fill="#fff"/><circle cx="\${5 + 30 * t}" cy="10" r="4" fill="#c33"/></svg>\`;\n`);
      for (const mode of ["meta", "off"]) {
        const out = join(dir, mode);
        const r = node(dir, mode, [join(skills, "lit-schematic", "scripts", "motion.mjs"), scene, "--out", out, "--seconds", "0.5", "--fps", "8", "--width", "160", "--small", "120"]);
        assert.equal(r.status, 0, r.stderr);
        const gif = readFileSync(join(out, "loop.gif"));
        const webp = readFileSync(join(out, "loop.webp"));
        if (mode === "off") {
          assert.equal(ffprobeComment(join(out, "loop.mp4")), "");
          assert.ok(!gif.includes(Buffer.from("LitClaude")) && !webp.includes(Buffer.from("LitClaude")));
        } else {
          assert.equal(ffprobeComment(join(out, "loop.mp4")), GEN);
          assert.ok(gif.includes(Buffer.from(GEN, "utf8")), "gif comment");
          assert.ok(webp.includes(Buffer.from(`<xmp:CreatorTool>${GEN}</xmp:CreatorTool>`, "utf8")), "webp xmp");
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("lit-diagram-drawer export carries the generator tag", () => {
  const probe = spawnSync(process.execPath, [join(skills, "lit-diagram-drawer", "scripts", "doctor.mjs")], { encoding: "utf8" });
  const ready = probe.status === 0 && !/"status":\s*"fail"/u.test(probe.stdout);
  it("office SVG <metadata> and PNG Software chunk in on; none in off", { skip: ready ? false : "diagram renderer not ready" }, () => {
    const dir = work();
    try {
      const source = join(skills, "lit-diagram-drawer", "examples", "01-service-architecture", "after.html");
      for (const mode of ["on", "off"]) {
        const out = join(dir, mode);
        const r = node(dir, mode, [join(skills, "lit-diagram-drawer", "scripts", "export.mjs"), "--input", source, "--out", out, "--scale", "1", "--office-safe"]);
        assert.equal(r.status, 0, r.stderr + r.stdout);
        const svg = readFileSync(join(out, "after-office.svg"), "utf8");
        const png = pngSoftware(readFileSync(join(out, "after-1x.png")));
        if (mode === "off") {
          assert.ok(!svg.includes("litclaude-generator"));
          assert.deepEqual(png, []);
        } else {
          assert.equal((svg.match(/<metadata id="litclaude-generator">/gu) ?? []).length, 1);
          assert.deepEqual(png, [GEN]);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("lit-typographic-motion master and staged deliverables", () => {
  it("the master encode names the generator in on and meta, nothing in off, with no clock or random value", async () => {
    for (const [mode, expected] of [["on", true], ["meta", true], ["off", false]]) {
      const saved = process.env.LITCLAUDE_MARK;
      process.env.LITCLAUDE_MARK = mode;
      try {
        const m = startMaster({ ffmpeg: "/usr/bin/true", width: 16, height: 16, fps: 24, out: join(tmpdir(), "never.mp4") });
        await m.finish();
        const i = m.args.indexOf("-metadata");
        assert.equal(i >= 0, expected, mode);
        if (expected) assert.equal(m.args[i + 1], `comment=${GEN}`);
        assert.equal(m.args.at(-1), join(tmpdir(), "never.mp4"));
      } finally {
        if (saved === undefined) delete process.env.LITCLAUDE_MARK;
        else process.env.LITCLAUDE_MARK = saved;
      }
    }
  });

  it("tagStaged tags poster, still and preview stills in the stage folder only when the mode asks", () => {
    const dir = work();
    try {
      const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108020000009077" + "53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082", "hex");
      for (const mode of ["meta", "off"]) {
        writeFileSync(join(dir, "poster.png"), png);
        tagStaged(dir, { LITCLAUDE_MARK: mode, LITCLAUDE_HOME: join(dir, "lit-home") });
        assert.deepEqual(pngSoftware(readFileSync(join(dir, "poster.png"))), mode === "off" ? [] : [GEN]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
