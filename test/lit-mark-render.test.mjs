import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import * as mark from "../bin/litfamily-banner.mjs";

const fixtureBytes = readFileSync(new URL("./fixtures/litmark/ignition.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const shapes = [["standard", 22, 10], ["banner", 44, 20], ["micro", 16, 5]];
const palette = {
  truecolor: { "#FF6337": "38;2;255;99;55", "#D7F75B": "38;2;215;247;91", "#F2EFDF": "38;2;242;239;223" },
  "256": { "#FF6337": "38;5;203", "#D7F75B": "38;5;191", "#F2EFDF": "38;5;230" },
};
const stripAnsi = (row) => row.replace(/\x1b\[[0-9;]*m/gu, "");
const expectedColor = (record, mode) => [...record.text].map((glyph, index) => record.colors[index]
  ? `\x1b[${palette[mode][record.colors[index]]}m${glyph}\x1b[0m` : glyph).join("");

it("Ignition fixture pins the exact user-selected B rows and cell colors", () => {
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec");
});

for (const [name, width, height] of shapes) {
  it(`${name} preserves all canonical B cells within ${width}x${height}`, () => {
    const rows = mark[name];
    assert.deepEqual(rows, fixture[name].map((record) => record.text));
    assert.equal(rows.length, height);
    assert.ok(rows.every((row) => [...row].length === width));
    assert.ok(rows.every((row) => /^[█▀▄▌▐▖▗▘▝▙▛▜▟▚▞ ]*$/u.test(row)));
    assert.ok(Object.isFrozen(rows));
  });

  for (const mode of ["truecolor", "256"]) {
    it(`${name} ${mode} paints every selected cell without changing glyphs or background`, () => {
      const rows = mark.colorize(mark[name], { mode });
      assert.deepEqual(rows, fixture[name].map((record) => expectedColor(record, mode)));
      assert.deepEqual(rows.map(stripAnsi), mark[name]);
      assert.deepEqual(mark.colorize(mark[name], { mode, shadow: false }), rows);
      assert.doesNotMatch(rows.join("\n"), /\x1b\[(?:48;|4[0-7]m)|▓/u);
    });
  }
}

it("native lockups preserve arbitrary plain labels and cell colors after CLI trimming", () => {
  for (const [name, width, height] of shapes) {
    for (const label of ["claude", "claude v9.8.7", "custom product-42.7 label"]) {
      const lockup = mark.lockup(label, mark[name]);
      const labelRow = Math.floor(height / 2);
      assert.equal(lockup.length, height);
      assert.equal(lockup[labelRow].slice(width + 8), label);
      for (const mode of ["truecolor", "256"]) {
        for (const rows of [lockup, lockup.map((row) => row.trimEnd())]) {
          const painted = mark.colorize(rows, { mode });
          assert.deepEqual(painted.map(stripAnsi), rows);
          for (let index = 0; index < height; index += 1) {
            const expected = expectedColor(fixture[name][index], mode) + lockup[index].slice(width);
            assert.equal(painted[index], rows === lockup ? expected : expected.trimEnd());
          }
          assert.ok(painted[labelRow].endsWith(label), "the product label must stay plain");
        }
      }
    }
  }
  assert.throws(() => mark.lockup("claude\nspoof"), /plain product label/u);
});

it("none mode preserves every byte and generic block rows use flat ivory", () => {
  for (const rows of [mark.standard, mark.banner, mark.micro, mark.lockup("claude"), ["█▓ custom"]]) {
    assert.deepEqual(mark.colorize(rows, { mode: "none", shadow: false }), rows);
    assert.ok(mark.colorize(rows, { mode: "none" }).every((row) => !row.includes("\x1b")));
  }
  assert.deepEqual(mark.colorize(["█ label"], { mode: "truecolor" }), ["\x1b[38;2;242;239;223m█\x1b[0m label"]);
  assert.throws(() => mark.colorize(["█"], { mode: "rainbow" }), /unknown/u);
});

it("native terminal policy honors empty opt-outs, non-TTY, JSON, locale and TERM", () => {
  const utf8 = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
  assert.equal(mark.colorMode({ env: utf8, isTTY: true, args: [] }), "truecolor");
  assert.equal(mark.colorMode({ env: { LANG: "C.UTF-8" }, isTTY: true, args: [] }), "256");
  for (const options of [
    { env: { ...utf8, NO_COLOR: "" }, isTTY: true },
    { env: { ...utf8, CI: "" }, isTTY: true },
    { env: utf8, isTTY: false },
    { env: utf8, isTTY: true, args: ["--json"] },
    { env: utf8, isTTY: true, args: ["--json=true"] },
  ]) assert.deepEqual(mark.terminalRows(mark.standard, { ...options, mode: "truecolor" }), mark.standard);
  for (const environment of [{ LANG: "C" }, { ...utf8, LC_ALL: "C" }, { ...utf8, TERM: "dumb" }, {}]) {
    assert.deepEqual(mark.terminalRows(mark.banner, { env: environment, isTTY: true, args: [] }), ["LIT"]);
  }
  for (const mode of ["truecolor", "256"]) {
    assert.deepEqual(mark.terminalRows(mark.standard, { env: utf8, isTTY: true, args: [], mode }), mark.colorize(mark.standard, { mode }));
  }
});

it("both README heroes use the current banner lockup without a version", () => {
  const expected = mark.lockup("claude", mark.banner).map((row) => row.trimEnd()).join("\n");
  for (const name of ["README.md", "README_ko-KR.md"]) {
    const readme = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    const hero = /```text\n([\s\S]*?)\n```/u.exec(readme)[1];
    assert.equal(hero, expected, name);
    assert.doesNotMatch(hero, /v\d+\.\d+\.\d+/u);
  }
});
