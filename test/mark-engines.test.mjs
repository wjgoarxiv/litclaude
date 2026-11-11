import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { generatorString } from "../plugins/litclaude/lib/mark.mjs";
import { startMaster, tagStaged } from "../plugins/litclaude/skills/lit-typographic-motion/engine/node/encode.mjs";

const GEN = generatorString();
const work = () => mkdtempSync(join(tmpdir(), "litclaude-mark-engines-"));
const pngSoftware = (buf) => {
  const found = [];
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o);
    if (buf.toString("latin1", o + 4, o + 8) === "tEXt" && buf.toString("latin1", o + 8, o + 17) === "Software\0") found.push(buf.toString("latin1", o + 17, o + 8 + len));
    o += 12 + len;
  }
  return found;
};

// The lit-schematic and lit-diagram-drawer exporters moved to the figures extras plugin, with their generator-tag checks.
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
