import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { micro, standard } from "../plugins/litclaude/lib/lit-mark.mjs";
import { synthwaveRows } from "../plugins/litclaude/lib/synthwave-mark.mjs";
import { MONO_ROWS } from "../plugins/litclaude/lib/synthwave-rows.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hookPath = join(root, "plugins/litclaude/bin/litclaude-hook.js");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const scratch = mkdtempSync(join(tmpdir(), "hook-banner-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const ESC = "\x1b";
const strip = (text) => text.replace(/\x1b\[[\d;]*m/gu, "");
// The flame emoji takes two terminal cells.
const cells = (text) => [...strip(text)].reduce((sum, glyph) => sum + (glyph === "🔥" ? 2 : 1), 0);
const widest = (message) => Math.max(...message.split("\n").map(cells));

const env = (extra = {}) => {
  const base = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor", LITCLAUDE_NO_AUTO_UPDATE: "1" };
  delete base.NO_COLOR;
  delete base.CI;
  delete base.LC_CTYPE;
  return { ...base, ...extra };
};
const colour = () => env();
const mono = () => env({ NO_COLOR: "1" });
const noBlocks = () => env({ LANG: "C", LC_ALL: "C" });

let counter = 0;
const run = (event, input, environment) => {
  const cwd = mkdtempSync(join(scratch, "project-"));
  mkdirSync(join(cwd, ".git"));
  counter += 1;
  const result = spawnSync(process.execPath, [hookPath, event], {
    cwd, env: environment, encoding: "utf8", input: JSON.stringify({ cwd, session_id: `banner-${process.pid}-${counter}`, ...input }),
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const sessionStart = (environment) => run("session-start", { source: "startup" }, environment);
const activation = (environment, prompt = "lit plan the update") => run("user-prompt-submit", { prompt }, environment);

const versionRow = (width) => {
  const line = `litclaude v${version}`;
  return `${" ".repeat(Math.max(0, Math.floor((width - line.length) / 2)))}${line}`;
};
const label = "🔥 LIT IGNITED · lit-plan 🔥";
const count = (text, needle) => text.split(needle).length - 1;

describe("session-start banner draws the sunset mark", () => {
  it("in colour: the 24-wide mark, then the version row, and no Ignition row", () => {
    const { systemMessage } = sessionStart(colour());
    assert.equal(systemMessage, `\n${[...synthwaveRows({ cols: 24, mode: "truecolor" }), versionRow(24)].join("\n")}`);
    assert.ok(systemMessage.startsWith("\n"));
    assert.ok(systemMessage.includes(ESC));
    assert.ok(systemMessage.endsWith(`litclaude v${version}`));
    for (const row of standard) assert.ok(!strip(systemMessage).includes(row.trimEnd()) || row.trim() === "", `Ignition row ${row}`);
  });

  it("draws the 256-colour palette when the terminal has no truecolor", () => {
    const { systemMessage } = sessionStart(env({ COLORTERM: "" }));
    assert.equal(systemMessage, `\n${[...synthwaveRows({ cols: 24, mode: "256" }), versionRow(24)].join("\n")}`);
    assert.ok(!/[34]8;2;/u.test(systemMessage));
  });

  it("NO_COLOR draws the mono glyph scene with no escape byte", () => {
    const { systemMessage } = sessionStart(mono());
    assert.ok(!systemMessage.includes(ESC));
    assert.equal(systemMessage, `\n${[...synthwaveRows({ cols: 24, mode: "mono" }), versionRow(24)].join("\n")}`);
    for (const row of MONO_ROWS["B-S"]) assert.ok(systemMessage.includes(row), row);
  });

  it("blocks unsupported keeps the single word LIT, with or without colour and with an unset locale", () => {
    const unsetLocale = env({ LANG: "", LC_ALL: "", LC_CTYPE: "" });
    for (const environment of [noBlocks(), env({ ...noBlocks(), NO_COLOR: "1" }), unsetLocale, env({ TERM: "dumb" })]) {
      const { systemMessage } = sessionStart(environment);
      assert.equal(systemMessage, `\nLIT\nlitclaude v${version}`);
    }
  });

  it("the banner fills the 24-cell mark exactly and no row is wider, in any colour form", () => {
    for (const environment of [colour(), mono()]) {
      const message = sessionStart(environment).systemMessage;
      assert.equal(widest(message), 24);
      for (const row of message.split("\n")) assert.ok(cells(row) <= 24, row);
    }
  });
});

describe("activation banner draws a compact sunset mark", () => {
  it("in colour: letters and sun down to the horizon, then the label", () => {
    const { systemMessage } = activation(colour());
    const rows = systemMessage.split("\n");
    const art = synthwaveRows({ cols: 24, mode: "truecolor" });
    assert.equal(rows[0], "");
    assert.deepEqual(rows.slice(1, 7), art.slice(0, 6), "letters, sun and horizon");
    assert.equal(strip(rows[7]), label);
    assert.equal(rows.length, 8, "no grid row and no tagline");
    assert.ok(!systemMessage.includes(art[6]), "grid row absent");
    assert.ok(!strip(systemMessage).includes("claude code"), "tagline absent");
    assert.equal(count(strip(systemMessage), "LIT IGNITED · lit-plan"), 1);
    for (const row of micro) assert.ok(!systemMessage.includes(row.trimEnd()), `micro row ${row}`);
    assert.match(rows[7], /\x1b\[1m\x1b\[38;2;/u, "the label keeps its gradient paint");
  });

  it("under NO_COLOR: mono letters, sun and horizon, then the label", () => {
    const { systemMessage } = activation(mono());
    assert.ok(!systemMessage.includes(ESC));
    assert.equal(systemMessage, `\n${[...MONO_ROWS["B-S"].slice(0, 6), label].join("\n")}`);
    assert.ok(systemMessage.includes("━"));
    assert.ok(!/[┼╱╲]/u.test(systemMessage), "no grid");
  });

  it("blocks unsupported keeps the single word LIT above the label, with or without colour", () => {
    for (const environment of [noBlocks(), env({ ...noBlocks(), NO_COLOR: "1" }), env({ LANG: "", LC_ALL: "", LC_CTYPE: "" })]) {
      const { systemMessage } = activation(environment);
      assert.equal(systemMessage, `\nLIT\n${label}`);
    }
  });

  it("no art row is wider than the 24-cell mark and the label stays under 44", () => {
    for (const environment of [colour(), mono()]) assert.ok(widest(activation(environment).systemMessage) <= 44);
  });

  it("the loop-goal line and guide stay attached after the banner", () => {
    const { systemMessage } = activation(colour(), "lit loop fix the failing test, done when npm test passes");
    const rows = systemMessage.split("\n");
    assert.equal(rows[0], "");
    assert.deepEqual(rows.slice(1, 7), synthwaveRows({ cols: 24, mode: "truecolor" }).slice(0, 6));
    assert.match(strip(rows[7]), /^🔥 LIT IGNITED · lit-loop 🔥$/u);
  });
});

describe("model-visible text carries no art", () => {
  const probe = "Begin your reply with the exact probe line `🔥 **LIT IGNITED · lit-plan** 🔥` on its own line, exactly once before anything else. The harness status mark is a separate plain-text surface; do not draw ASCII art or repeat the probe. A bare `lit` in the prompt is the LitClaude activation word, not a request for the Lit web-components library or any other package named Lit; do not mention or explain the activation word in the reply. This context is written in English; reply in the language the user wrote the prompt in.";
  it("additionalContext has no escape code, no art row and the same probe instruction, in the run that draws the art", () => {
    const started = sessionStart(colour());
    const prompted = activation(colour());
    assert.ok(started.systemMessage.includes(synthwaveRows({ cols: 24, mode: "truecolor" })[0]), "the system message draws the sunset mark");
    assert.ok(prompted.systemMessage.includes(synthwaveRows({ cols: 24, mode: "truecolor" })[0]), "the system message draws the sunset mark");
    for (const context of [started.hookSpecificOutput.additionalContext, prompted.hookSpecificOutput.additionalContext]) {
      assert.ok(!context.includes(ESC));
      assert.doesNotMatch(context, /[▀▄█]/u);
      assert.ok(!context.includes("LIT · claude code"));
      for (const row of strip(started.systemMessage).split("\n").filter((line) => /[▀▄█]/u.test(line))) assert.ok(!context.includes(row), row);
    }
    assert.ok(prompted.hookSpecificOutput.additionalContext.includes(probe), "probe instruction unchanged");
  });
});
