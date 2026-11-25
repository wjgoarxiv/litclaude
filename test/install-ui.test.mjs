import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createInstallUi, richTerminal, wrap } from "../bin/install-ui.mjs";
import { textWidth } from "../plugins/litclaude/lib/mod/layout.mjs";

const strip = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/gu, "");
const UTF8 = { TERM: "xterm-256color", COLORTERM: "truecolor", LC_ALL: "en_US.UTF-8" };
const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });
const until = async (check, message) => {
  for (let i = 0; i < 400; i += 1) { if (check()) return; await tick(); }
  assert.fail(message);
};

// Just enough of a terminal: text, CR, LF, cursor up, erase line and erase below.
class Screen extends EventEmitter {
  constructor(columns, rows) { super(); Object.assign(this, { columns, rows, isTTY: true, raw: "", lines: [""], row: 0, col: 0 }); }
  write(chunk) {
    this.raw += chunk;
    for (const [, up, erase, sgr, ch] of chunk.matchAll(/\x1b\[(\d+)A|\x1b\[(K|J)|(\x1b\[[0-9;?]*[a-zA-Z])|([\s\S])/gu)) {
      if (up) { this.row -= Number(up); assert.ok(this.row >= 0, "never moves above its own first row"); }
      else if (erase) {
        this.lines[this.row] = [...this.lines[this.row]].slice(0, this.col).join("");
        if (erase === "J") this.lines.length = this.row + 1;
      } else if (ch === "\r") this.col = 0;
      else if (ch === "\n") { this.row += 1; this.lines[this.row] ??= ""; this.col = 0; }
      else if (ch !== undefined && !sgr) {
        const line = [...this.lines[this.row]];
        line[this.col] = ch;
        this.lines[this.row] = line.join("");
        this.col += 1;
      }
    }
    return true;
  }
  // A narrower window wraps the rows already there, as tmux and most terminals do.
  resize(columns) {
    this.columns = columns;
    const rewrapped = this.lines.map((line) => [...line].join("").match(new RegExp(`.{1,${columns}}`, "gu")) ?? [""]);
    this.row = rewrapped.slice(0, this.row).flat().length;
    this.lines = rewrapped.flat();
    this.emit("resize");
  }
  get text() { return this.lines.map((line) => line.trimEnd()).join("\n"); }
}

const make = ({ cols = 80, rows = 40, env = UTF8, ...rest } = {}) => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, modes: [], setRawMode(on) { this.modes.push(on); return this; } });
  const stdout = new Screen(cols, rows);
  const proc = Object.assign(new EventEmitter(), { pid: 1, platform: "darwin", kills: [], kill(pid, signal) { this.kills.push(signal); this.target = pid; } });
  const clock = { at: 0 };
  const ui = createInstallUi({ stdin, stdout, env, animate: false, settleMs: 5, now: () => clock.at, proc, ...rest });
  return { ui, stdin, stdout, proc, clock };
};
const COLOURS = ["cyan", "blue", "teal", "green", "lavender", "rose", "gold", "orange", "slate", "gray"].map((id, i) => ({
  id, label: id, key: String((i + 1) % 10), color: id, views: [`${"wide ".repeat(20)}`, "ctx [x]"],
}));
const LIST = { tag: "LIT 1/5", title: "Status-line colour", note: "Sets the accent colour of the status line; press Enter to keep cyan.", choices: COLOURS, initial: "cyan" };
const ASK = { tag: "LIT 3/5", title: "Icon font", note: "Downloads the symbols-only Nerd Font (MIT) into your user font folder so the status band can draw round pills and icons; No keeps plain shapes.", initial: false };
const opened = (t, title) => until(() => t.stdout.text.includes(title), `card ${title} never opened`);
// Opens a card, sends each key on its own, and gives back the answer.
const answer = async (t, kind, spec, keys) => {
  const result = t.ui[kind](spec);
  result.catch(() => {});
  await opened(t, spec.title);
  for (const key of keys) { t.stdin.write(key); await tick(); }
  return result;
};
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";

test("cards need a person at a terminal", () => {
  const tty = { isTTY: true, setRawMode() {} };
  const out = { isTTY: true, columns: 80, rows: 24 };
  const rich = (env = {}, stdin = tty, stdout = out) => richTerminal({ stdin, stdout, env: { ...UTF8, ...env } });
  assert.equal(rich(), true);
  assert.equal(rich({ NO_COLOR: "1" }), true, "NO_COLOR keeps the cards, without colour");
  assert.equal(rich({ LC_ALL: "C" }), true, "no UTF-8 keeps the cards, in ASCII");
  assert.equal(rich({}, tty, { isTTY: true }), true, "a terminal that reports no size counts as 80 by 24");
  for (const name of ["HUD_ACCENT", "OUTPUT_STYLE", "ICON_FONT", "ATTRIBUTION", "AGENT_FILE"]) assert.equal(rich({ [`LITCLAUDE_${name}_PROMPT`]: "1" }), false, name);
  assert.equal(rich({ CI: "" }), false);
  assert.equal(rich({ TERM: "dumb" }), false);
  assert.equal(rich({}, { isTTY: true }), false, "no raw mode");
  assert.equal(rich({}, { setRawMode() {} }), false, "piped stdin");
  assert.equal(rich({}, tty, { columns: 80, rows: 24 }), false, "piped stdout");
  assert.equal(rich({}, tty, { isTTY: true, columns: 39, rows: 24 }), false, "too narrow");
  assert.equal(rich({}, tty, { isTTY: true, columns: 80, rows: 11 }), false, "too short");
});

test("a list: Enter takes the default, arrows and j k move and wrap, digits jump", async () => {
  for (const [keys, expected] of [
    [["\r"], "cyan"], [["\n"], "cyan"], [[DOWN, DOWN, "\r"], "teal"], [[UP, "\r"], "gray"], [["j", "j", "k", "\r"], "blue"],
    [["7", "\r"], "gold"], [["0", DOWN, "\r"], "cyan"], [["\x1b[F", "\r"], "gray"], [["\x1b[F", "\x1b[H", "\r"], "cyan"],
  ]) assert.equal(await answer(make(), "choose", LIST, keys), expected, JSON.stringify(keys));
});

test("a list starts on its stored value and marks it", async () => {
  const t = make();
  const result = t.ui.choose({ ...LIST, initial: "gold", initialTag: "current" });
  await opened(t, "Status-line colour");
  assert.match(t.stdout.text, /❯ 7 ██ gold .*current/u);
  t.stdin.write("\r");
  assert.equal(await result, "gold");
});

test("Esc and keys that mean nothing here never answer", async () => {
  const t = make();
  const list = t.ui.choose(LIST);
  await opened(t, "Status-line colour");
  for (const key of ["\x1b", "x", "q", "y", "n", "\x1by", "\x01", "\t", " ", "\x1b[15~", "\x1b[200~"]) { t.stdin.write(key); await tick(); }
  await tick(600);
  assert.match(t.stdout.text, /❯ 1 ██ cyan/u, "still open, nothing moved");
  t.stdin.write("\r");
  assert.equal(await list, "cyan");
  const u = make();
  const ask = u.ui.confirm(ASK);
  await opened(u, "Icon font");
  for (const key of ["\x1b", "\x1by", "x", " ", "ㅛ"]) { u.stdin.write(key); await tick(600); }
  assert.match(u.stdout.text, /❯ No \(default\)/u);
  u.stdin.write("\r");
  assert.equal(await ask, false);
});

test("yes or no: letters answer at once, arrows and Tab switch, Enter takes the highlight", async () => {
  for (const [initial, keys, expected] of [
    [false, ["\r"], false], [true, ["\r"], true], [false, ["y"], true], [true, ["N"], false],
    [false, [LEFT, "\r"], true], [true, [RIGHT, "\r"], false], [true, ["\t", "\r"], false], [true, ["\t", "\t", "\r"], true],
  ]) assert.equal(await answer(make(), "confirm", { ...ASK, initial }, keys), expected, JSON.stringify([initial, keys]));
});

test("the default is named on its button, in the title and in the Enter hint", async () => {
  for (const env of [UTF8, { ...UTF8, NO_COLOR: "1" }, { ...UTF8, LC_ALL: "C" }]) {
    const t = make({ env });
    const result = t.ui.confirm({ ...ASK, initial: true });
    await opened(t, "Icon font");
    assert.match(t.stdout.text, /Icon font \[Y\/n\]/u);
    assert.match(t.stdout.text, /[❯>] Yes \(default\)/u);
    assert.match(t.stdout.text, /Enter = Yes/u);
    t.stdin.write(RIGHT);
    await until(() => /Enter = No/u.test(t.stdout.text), "the hint follows the highlight");
    assert.match(t.stdout.text, /[❯>] No\b/u);
    assert.match(t.stdout.text, /Yes \(default\)/u, "the default keeps its name when the highlight leaves it");
    t.stdin.write("y");
    assert.equal(await result, true);
  }
});

test("an answered card folds to one line and leaves nothing behind", async () => {
  const t = make();
  t.stdout.write("before\r\n");
  await answer(t, "choose", LIST, ["7", "\r"]);
  await answer(t, "confirm", ASK, ["n"]);
  assert.equal(t.stdout.text.trimEnd(), "before\n\n ✓ Status-line colour   gold\n ✓ Icon font            no");
});

test("the Enter after a letter answer, and keys typed before a card is up, reach no card", async () => {
  const t = make();
  assert.equal(await answer(t, "confirm", ASK, ["n\r"]), false);
  const next = t.ui.confirm({ ...ASK, title: "Second", initial: true });
  await opened(t, "Second");
  t.stdin.write("\r");
  await tick(20);
  assert.match(t.stdout.text, /Second \[Y\/n\]/u, "an Enter 0 ms after the letter belongs to the letter");
  t.clock.at = 1000;
  t.stdin.write("\r");
  assert.equal(await next, true);
  const u = make({ settleMs: 40 });
  const early = u.ui.confirm(ASK);
  u.stdin.write("y\r");
  await opened(u, "Icon font");
  u.stdin.write("\r");
  assert.equal(await early, false, "type-ahead was dropped");
});

test("Ctrl+C and Ctrl+D stop the card, before and after it is drawn, and give the terminal back", async () => {
  for (const [keys, message] of [["\x03", "Aborted with Ctrl+C"], ["\x04", "Aborted with Ctrl+D"]]) {
    for (const kind of ["choose", "confirm"]) {
      const t = make();
      await assert.rejects(answer(t, kind, kind === "choose" ? LIST : ASK, [keys]), { message });
      assert.deepEqual([t.stdin.modes.at(-1), t.stdout.raw.lastIndexOf("\x1b[?25h") > t.stdout.raw.lastIndexOf("\x1b[?25l")], [false, true]);
      assert.deepEqual(["exit", "SIGINT", "SIGTERM", "SIGHUP"].map((name) => t.proc.listenerCount(name)), [0, 0, 0, 0]);
      assert.deepEqual([t.stdin.listenerCount("keypress"), t.stdin.listenerCount("end"), t.stdout.listenerCount("resize")], [0, 0, 0]);
      assert.match(t.stdout.text, /✗ (?:Status-line colour|Icon font) +stopped/u);
    }
  }
  const early = make({ settleMs: 50 });
  const result = early.ui.confirm(ASK);
  result.catch(() => {});
  early.stdin.write("\x03");
  await assert.rejects(result, { message: "Aborted with Ctrl+C" });
  const gone = make();
  const open = gone.ui.confirm(ASK);
  await opened(gone, "Icon font");
  gone.stdin.end();
  await assert.rejects(open, { message: "Aborted: the terminal closed" });
});

test("a signal while a card is open gives the terminal back before it is passed on", async () => {
  const t = make();
  const open = t.ui.confirm(ASK);
  await opened(t, "Icon font");
  t.proc.emit("SIGTERM", "SIGTERM");
  assert.deepEqual([t.proc.kills, t.stdin.modes.at(-1), t.stdout.raw.endsWith("\x1b[?25h")], [["SIGTERM"], false, true]);
  t.stdin.resume();
  t.stdin.write("n");
  await open;
});

test("Ctrl+Z suspends with the terminal given back and draws the card again on return", async () => {
  const t = make();
  const open = t.ui.confirm(ASK);
  await opened(t, "Icon font");
  t.stdin.write("\x1a");
  await until(() => t.proc.kills.length === 1, "no suspend");
  assert.deepEqual([t.proc.kills, t.proc.target, t.stdin.modes.at(-1)], [["SIGTSTP"], 0, false], "the whole job stops, launcher included");
  assert.equal(t.stdin.isPaused(), false, "an open stdin keeps the process alive until it is resumed");
  t.proc.emit("SIGCONT");
  assert.equal(t.stdin.modes.at(-1), true);
  assert.equal(t.stdout.text.split("Icon font [y/N]").length - 1, 2);
  t.stdin.write("y");
  assert.equal(await open, true);
});

const STEPS = [["Plugin", "copy the packaged plugin payload"], ["Market", "write the local marketplace"], ["Verify", "confirm every installed surface"]].map(([name, text]) => ({ name, text }));
const PANEL = { tag: "LIT", title: "LitClaude 9.9.9 is installed", sections: [
  { head: "Installed", rows: [{ label: "Plugin path", value: `/${"very-long-folder/".repeat(12)}end` }, { mark: "warn", label: "Icon font", value: "a different file is already there — left alone" }] },
  { head: "Next", rows: [{ mark: "note", value: "launch with: claude · 한국어" }] },
] };
const ENVS = { round: UTF8, truecolor: UTF8, 256: { TERM: "xterm-256color", LC_ALL: "en_US.UTF-8" }, 16: { TERM: "xterm", LC_ALL: "en_US.UTF-8" }, plain: { ...UTF8, NO_COLOR: "1" }, ascii: { ...UTF8, LC_ALL: "C" }, plainAscii: { NO_COLOR: "1", TERM: "xterm", LC_ALL: "C" } };

test("every card fits every window at every colour depth", async () => {
  for (const [name, env] of Object.entries(ENVS)) {
    for (const cols of [40, 60, 80, 100, 120]) {
      for (const rows of [12, 16, 24, 60]) {
        const where = `${name} ${cols}x${rows}`;
        for (const [kind, spec, keys] of [["choose", LIST, [DOWN, UP, "6"]], ["confirm", ASK, [RIGHT, LEFT]], ["confirm", { ...ASK, title: "Co-Authored-By line", initial: true }, [RIGHT]]]) {
          const t = make({ cols, rows, env, round: name === "round" });
          const result = t.ui[kind](spec);
          await opened(t, spec.title);
          for (const key of keys) { t.stdin.write(key); await tick(1); }
          const shown = t.stdout.lines.slice(0, -1);
          assert.ok(shown.length <= rows - 1, `${where} ${spec.title}: ${shown.length} rows`);
          for (const line of shown) assert.ok(textWidth(line) < cols, `${where} ${spec.title}: ${line}`);
          assert.ok(t.stdout.text.includes(spec.title), `${where}: the title is on screen`);
          frameHolds(shown, where);
          const said = t.stdout.text.replace(/[│|]/gu, " ").replace(/\s+/gu, " ");
          assert.ok(said.includes(spec.note), `${where}: the whole sentence is on screen`);
          assert.match(said, /Ctrl\+C stop/u, where);
          if (kind === "choose") assert.match(t.stdout.text, /[❯>] 6 .*rose/u, `${where}: the highlight stays on screen`);
          t.stdin.write(kind === "choose" ? "\r" : "n");
          await result;
          checkColours(name, t.stdout.raw, where);
        }
        const t = make({ cols, rows, env, round: name === "round" });
        const card = t.ui.progress({ tag: "LIT", title: "Installing", steps: STEPS });
        await card.run(0, async () => {});
        assert.ok(t.stdout.lines.length - 1 <= rows - 1, `${where} progress`);
        for (const line of t.stdout.lines) assert.ok(textWidth(line) < cols, `${where} progress`);
        card.finish("Install steps", "done");
        t.ui.panel(PANEL);
        for (const line of t.stdout.lines) assert.ok(textWidth(line) < cols, `${where} panel: ${line}`);
        checkColours(name, t.stdout.raw, where);
      }
    }
  }
});

// Every row between a card's corners starts and ends on its border, in the same two columns.
const frameHolds = (lines, where) => {
  const top = lines.findIndex((line) => /^ [╭+][─-]/u.test(line));
  const last = lines.findLastIndex((line) => /^ [╰+][─-]+[╯+]$/u.test(line));
  assert.ok(top >= 0 && last > top, `${where}: a whole card`);
  const width = textWidth(lines[top]);
  for (const line of lines.slice(top, last + 1)) {
    assert.equal(textWidth(line), width, `${where}: ${line}`);
    assert.match(line, /^ [╭│╰+|].*[╮│╯+|]$/u, where);
  }
};

// Round caps come in pairs, and no texture stands in for a gauge; every other form has no cap at all.
const checkForm = (name, raw, where) => {
  if (name !== "round") { assert.doesNotMatch(raw, /[\ue0b4\ue0b6]/u, `${where}: no caps`); return; }
  assert.equal(raw.split("\ue0b6").length, raw.split("\ue0b4").length, `${where}: every fill has both caps`);
  assert.match(raw, /\ue0b6/u, where);
  assert.doesNotMatch(raw, /[░▒▓▯▄▀]|██|\[[▏▎▍▌▋▊▉█]/u, `${where}: no square fill or gauge`);
};

const checkColours = (name, raw, where) => {
  checkForm(name, raw, where);
  if (name.startsWith("plain")) assert.doesNotMatch(raw, /\x1b\[[0-9;]*m/u, `${where}: no colour`);
  if (name === "256") assert.doesNotMatch(raw, /[34]8;2;/u, where);
  if (name === "16") assert.doesNotMatch(raw, /[34]8;[25];/u, where);
  if (/ascii/iu.test(name)) assert.doesNotMatch(raw, /[^\x00-\x7f]/u, `${where}: ASCII only`);
};

const CAPS = { "\ue0b6": " ", "\ue0b4": " " };
const flat = (text) => text.replace(/[\ue0b4\ue0b6]/gu, (cap) => CAPS[cap]).replaceAll("██", "  ");
test("round and square say the same words in the same cells", async () => {
  for (const [kind, spec] of [["choose", LIST], ["confirm", ASK]]) {
    for (const cols of [40, 60, 80, 100, 120]) {
      const [round, square] = await Promise.all([true, false].map(async (form) => {
        const t = make({ cols, round: form });
        const result = t.ui[kind](spec);
        await opened(t, spec.title);
        t.stdin.write(DOWN);
        await tick(20);
        const shown = flat(t.stdout.text);
        t.stdin.write("\r");
        await result;
        t.ui.panel(PANEL);
        return [shown, flat(t.stdout.text)];
      }));
      assert.deepEqual(round, square, `${spec.title} ${cols}`);
    }
  }
});

test("the pill, the highlighted row, the lit button and the swatches end in caps of their own colour", async () => {
  const t = make({ round: true });
  const list = t.ui.choose(LIST);
  await opened(t, "Status-line colour");
  assert.match(t.stdout.text, /╭─ \ue0b6LIT 1\/5\ue0b4 · Status-line colour ─+╮/u);
  assert.match(t.stdout.text, /│ \ue0b6❯ 1 \ue0b6\ue0b4 cyan .*default *\ue0b4 │/u);
  assert.ok(t.stdout.raw.includes("\x1b[38;2;255;143;60m\ue0b6"), "orange opens the pill");
  assert.ok(t.stdout.raw.includes("\x1b[38;2;255;45;149m\ue0b4"), "pink closes it");
  assert.ok(t.stdout.raw.includes("\x1b[38;2;52;32;92m\ue0b6"), "the bar's own colour opens the bar");
  t.stdin.write("\r");
  await list;
  const ask = t.ui.confirm(ASK);
  await opened(t, "Icon font");
  assert.match(t.stdout.text, /│ ╭─+╮ {2}╭─+╮ +│\n │ │ +Yes +│ {2}│ \ue0b6❯ No \(default\) *\ue0b4 │ +│\n │ ╰─+╯ {2}╰─+╯ +│/u);
  t.stdin.write("\r");
  await ask;
});

test("one blank row between blocks, and every value in one column", async () => {
  for (const round of [true, false]) {
    const t = make({ cols: 100, round });
    t.stdout.write("intro\r\n");
    await answer(t, "choose", LIST, ["7", "\r"]);
    const card = t.ui.progress({ tag: "LIT", title: "Installing", steps: STEPS });
    assert.equal(t.stdout.lines.find((line) => line.includes("copy the packaged")).indexOf("copy"), 24);
    card.finish("Install steps", "3 of 3 checked");
    const open = t.ui.confirm(ASK);
    await opened(t, "Icon font");
    assert.doesNotMatch(t.stdout.text, /\n\n\n/u, "never two");
    assert.match(t.stdout.text, /^intro\n\n ✓ .*\n ✓ .*\n\n ╭/u);
    t.stdin.write("n");
    await open;
    t.ui.panel(PANEL);
    assert.match(t.stdout.text, /no\n\n ╭/u);
    assert.doesNotMatch(t.stdout.text.trimEnd(), /\n\n\n/u);
    for (const value of ["gold", "3 of 3", "a different file"]) assert.equal(t.stdout.lines.find((line) => line.includes(value)).indexOf(value), 24, value);
  }
});

test("a summary never shortens a value, and a warning keeps its mark", () => {
  for (const cols of [40, 80, 120]) {
    const t = make({ cols });
    t.ui.panel(PANEL);
    const joined = t.stdout.text.replace(/[│\s]/gu, "");
    assert.ok(joined.includes(PANEL.sections[0].rows[0].value), `${cols}`);
    assert.match(t.stdout.text, /! Icon font/u);
    assert.ok(joined.includes("adifferentfileisalreadythere—leftalone"));
  }
});

test("a resize redraws the card for the new window", async () => {
  const t = make({ cols: 120, rows: 40 });
  const result = t.ui.choose(LIST);
  await opened(t, "Status-line colour");
  t.stdout.resize(60);
  assert.ok(Math.max(...t.stdout.lines.map(textWidth)) < 60);
  assert.equal(t.stdout.text.split("Status-line colour").length - 1, 1, "no copy of the old card is left");
  t.stdout.resize(110);
  assert.equal(t.stdout.text.split("Status-line colour").length - 1, 1);
  assert.ok(Math.max(...t.stdout.lines.map(textWidth)) > 90, "a wider window gets a wider card");
  t.stdin.write("\r");
  assert.equal(await result, "cyan");
});

test("moving the highlight rewrites only the rows that changed", async () => {
  const t = make();
  const result = t.ui.choose(LIST);
  await opened(t, "Status-line colour");
  const before = t.stdout.raw.length;
  t.stdin.write(DOWN);
  await until(() => t.stdout.raw.length > before, "no redraw");
  const update = t.stdout.raw.slice(before);
  assert.doesNotMatch(update, /\x1b\[2?J/u, "no clear");
  assert.equal(update.split("\x1b[K").length - 1, 2);
  t.stdin.write("\r");
  await result;
});

test("progress: steps tick, stray keys are dropped, Ctrl+C ends the process, a failure is shown", async () => {
  const t = make();
  const card = t.ui.progress({ tag: "LIT", title: "Installing", steps: STEPS });
  assert.equal(await card.run(0, async () => 42), 42);
  assert.match(t.stdout.text, /✓ Plugin/u);
  t.stdin.write("y\r\r");
  await tick();
  assert.deepEqual(t.proc.kills, []);
  t.stdin.write("\x03");
  await until(() => t.proc.kills.length === 1, "Ctrl+C was swallowed");
  assert.deepEqual([t.proc.kills, t.stdin.modes.at(-1)], [["SIGINT"], false]);
  const bad = make();
  const failing = bad.ui.progress({ tag: "LIT", title: "Installing", steps: STEPS });
  await failing.run(0, async () => {});
  await assert.rejects(failing.run(1, async () => { throw new Error("disk full"); }), /disk full/u);
  assert.match(bad.stdout.text, /✗ Market/u);
  assert.equal(bad.stdin.modes.at(-1), false);
  assert.ok(bad.stdout.raw.lastIndexOf("\x1b[?25h") > bad.stdout.raw.lastIndexOf("\x1b[?25l"));
});

test("wrap keeps every character", () => {
  for (const width of [4, 10, 33]) {
    const text = "한국어 and a/very/long/path/that/has/no/spaces end";
    const lines = wrap(text, width);
    assert.equal(lines.join("").replace(/\s/gu, ""), text.replace(/\s/gu, ""));
    for (const line of lines) assert.ok(textWidth(line) <= width, strip(line));
  }
  assert.deepEqual(wrap("", 10), [""]);
});
