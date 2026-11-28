import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CHROME_STOPS, HOST_LABEL, pickSize, synthwaveRows } from "../plugins/litclaude/lib/synthwave-mark.mjs";
import { MONO_ROWS, PIXEL_ROWS, SHARED_COLOURS, SPEC_DIGEST } from "../plugins/litclaude/lib/synthwave-rows.mjs";

const ESC = "\x1b";
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/gu, "");
// Every glyph the mark draws is one terminal cell wide; the tagline is ASCII plus "·".
const cells = (text) => [...strip(text)].length;

test("pixel rows match the LitFamily spec digest", () => {
  const digest = createHash("sha256")
    .update(Object.values(PIXEL_ROWS).map((rows) => rows.join("\n")).join("\n--\n"))
    .update(JSON.stringify(SHARED_COLOURS))
    .update(Object.values(MONO_ROWS).map((rows) => rows.join("\n")).join("\n--\n"))
    .digest("hex");
  assert.equal(digest, SPEC_DIGEST);
});

test("each size has the agreed grid", () => {
  const expected = { "B-L": [76, 46], "B-M": [44, 26], "B-S": [24, 14] };
  for (const [size, [width, height]] of Object.entries(expected)) {
    assert.equal(PIXEL_ROWS[size].length, height, size);
    for (const row of PIXEL_ROWS[size]) assert.equal([...row].length, width, size);
  }
  assert.equal(CHROME_STOPS.length, 6);
  assert.equal(HOST_LABEL, "claude code");
});

test("the size ladder follows the terminal width", () => {
  assert.equal(pickSize(200), "B-L");
  assert.equal(pickSize(80), "B-L");
  assert.equal(pickSize(76), "B-L");
  assert.equal(pickSize(75), "B-M");
  assert.equal(pickSize(44), "B-M");
  assert.equal(pickSize(43), "B-S");
  assert.equal(pickSize(24), "B-S");
  assert.equal(pickSize(20), null);
  assert.equal(pickSize(undefined), "B-L", "unknown width falls back to 80 columns");
});

test("no row is wider than the terminal at any width from 20 to 200", () => {
  for (let cols = 20; cols <= 200; cols += 1) {
    for (const mode of ["truecolor", "256", "mono"]) {
      for (const row of synthwaveRows({ cols, mode })) assert.ok(cells(row) <= cols, `${mode} ${cols}: ${cells(row)}`);
    }
  }
});

test("a terminal narrower than B-S gets the one plain line", () => {
  assert.deepEqual(synthwaveRows({ cols: 20, mode: "truecolor" }), ["LIT · claude code"]);
  assert.deepEqual(synthwaveRows({ cols: 200, mode: "plain" }), ["LIT · claude code"]);
});

test("mono and plain output carry no escape bytes", () => {
  for (const cols of [24, 44, 80]) {
    const rows = synthwaveRows({ cols, mode: "mono" });
    assert.ok(!rows.join("\n").includes(ESC), `mono ${cols}`);
    assert.match(rows.join("\n"), /[█▀▄]/u);
    assert.match(rows.at(-1), /LIT · claude code/u);
  }
});

test("mono keeps the scene in glyphs: letters, dotted sun, horizon and floor", () => {
  for (const [cols, size] of [[80, "B-L"], [44, "B-M"], [24, "B-S"]]) {
    const rows = synthwaveRows({ cols, mode: "mono" });
    assert.deepEqual(rows.slice(0, -1), [...MONO_ROWS[size]], size);
    const text = rows.join("\n");
    for (const glyph of ["█", "░", "━", "┼"]) assert.ok(text.includes(glyph), `${size} lacks ${glyph}`);
  }
});

test("colour modes paint the chrome with the LitClaude stops", () => {
  const truecolor = synthwaveRows({ cols: 80, mode: "truecolor" }).join("\n");
  // The top row of each letter is the white edge, so the base stop (#c2185b) is the one that always shows.
  assert.match(truecolor, /[34]8;2;194;24;91/u, "base chrome stop present");
  const indexed = synthwaveRows({ cols: 80, mode: "256" }).join("\n");
  assert.ok(!/[34]8;2;/u.test(indexed), "256 mode uses palette indexes only");
  assert.match(indexed, /[34]8;5;\d+/u);
});

test("the hook draws the mark only in the system message, never in model-visible context", () => {
  const cwd = mkdtempSync(join(tmpdir(), "synthwave-hook-"));
  mkdirSync(join(cwd, ".git"));
  try {
    const hook = fileURLToPath(new URL("../plugins/litclaude/bin/litclaude-hook.js", import.meta.url));
    const env = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor", LITCLAUDE_NO_AUTO_UPDATE: "1" };
    delete env.NO_COLOR;
    delete env.CI;
    for (const [event, input] of [["session-start", { source: "startup" }], ["user-prompt-submit", { prompt: "lit plan the update" }]]) {
      const result = spawnSync(process.execPath, [hook, event], { cwd, env, encoding: "utf8", input: JSON.stringify({ cwd, session_id: `synthwave-hook-${process.pid}`, ...input }) });
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.match(payload.systemMessage, /\x1b\[[\d;]*m[█▀▄]/u, `${event} draws the mark in truecolor`);
      assert.match(payload.systemMessage, /\x1b\[(?:1;)?38;2;/u, `${event} uses truecolor escapes`);
      assert.doesNotMatch(payload.hookSpecificOutput.additionalContext, /[█▀▄\x1b]/u, `${event} context stays text`);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
