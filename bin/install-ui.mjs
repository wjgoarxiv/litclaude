// The installer's cards for a person at a real terminal: choose one, yes or no, live progress and the
// closing summary. Nothing here runs unless richTerminal() says so; every other run keeps the plain
// prompts and machine lines in litclaude-ai.js. Cards are drawn in place, never wider than the window
// or taller than it, and fold to one line once answered.

import { emitKeypressEvents } from "node:readline";
import { ansi16CodeForAccent, hudColorDepth, themeForAccent } from "../plugins/litclaude/lib/hud-accent-palette.mjs";
import { textWidth } from "../plugins/litclaude/lib/mod/layout.mjs";

const MIN_COLS = 40;
const MIN_ROWS = 12;
const MAX_WIDTH = 100;
// `y` and then Enter is a habit: the letter already answered, so an Enter this soon after it belongs to it.
const LETTER_ENTER_MS = 400;
const SETTLE_MS = 30;
const CAP_LEFT = "\ue0b6";
const CAP_RIGHT = "\ue0b4";
// A folded answer, a step and a closing-card row all put their value in this column of the window.
const VALUE_COL = 24;

const asciiLocale = (env) => {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return locale !== "" && !/utf-?8/iu.test(locale);
};

/** Cards need a person at a terminal: two TTYs, raw mode, room to draw, no CI, no prompt hook in the environment. */
export const richTerminal = ({ stdin, stdout, env }) => Boolean(
  stdin.isTTY && stdout.isTTY && typeof stdin.setRawMode === "function"
  && !Object.hasOwn(env, "CI") && !/^dumb$/iu.test(env.TERM ?? "")
  && !Object.keys(env).some((name) => /^LITCLAUDE_\w+_PROMPT$/u.test(name))
  && (stdout.columns || 80) >= MIN_COLS && (stdout.rows || 24) >= MIN_ROWS,
);

// ---- colour ----------------------------------------------------------------------------------
const token = (hex, ansi16) => ({ hex, ansi16 });
const PINK = token("#ff2d95", 95);
const VIOLET = token("#b48cff", 94);
const ORANGE = token("#ff8f3c", 93);
const INK = token("#0b0e14", 30);
const IVORY = token("#f2efdf", 97);
const BAR = token("#34205c", 45);
const GREEN = token("#50e68c", 92);
const AMBER = token("#ffb02e", 93);
const RED = token("#ff5577", 91);
const CUBE = [0, 95, 135, 175, 215, 255];
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (parts) => `#${parts.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const accentToken = (name) => {
  const code = themeForAccent(name).code - 16;
  return token(toHex([Math.floor(code / 36), Math.floor(code / 6) % 6, code % 6].map((v) => CUBE[v])), ansi16CodeForAccent(name) + 60);
};
const mix = (stops, t) => {
  const at = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  const [a, b] = [rgb(stops[i].hex), rgb(stops[i + 1].hex)];
  return token(toHex(a.map((v, k) => v + (b[k] - v) * (at - i))), stops[Math.round(at)].ansi16);
};
const nearest = (v) => CUBE.reduce((best, level, i) => (Math.abs(level - v) < Math.abs(CUBE[best] - v) ? i : best), 0);
const sgr = ({ hex, ansi16 }, back, depth) => {
  if (depth === "16") return String(ansi16 + (back ? 10 : 0));
  if (depth === "truecolor") return `${back ? 48 : 38};2;${rgb(hex).join(";")}`;
  const [r, g, b] = rgb(hex).map(nearest);
  return `${back ? 48 : 38};5;${16 + 36 * r + 6 * g + b}`;
};

// ---- text ------------------------------------------------------------------------------------
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/gu, "");
const cells = (text) => textWidth(strip(text));
const pad = (text, width) => text + " ".repeat(Math.max(0, width - cells(text)));

/** Word wrap in terminal cells; a word longer than the line (a path) is cut across lines, never shortened. */
export const wrap = (text, width) => {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/u).filter(Boolean)) {
    if (line && cells(line) + 1 + cells(word) <= width) { line += ` ${word}`; continue; }
    if (line) lines.push(line);
    line = "";
    for (const ch of word) {
      if (cells(line + ch) > width) { lines.push(line); line = ""; }
      line += ch;
    }
  }
  return line || lines.length === 0 ? [...lines, line] : lines;
};

const UNICODE = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", pointer: "❯", done: "✓", fail: "✗", warn: "!", dot: "·",
  up: "↑", down: "↓", keys: "↑ ↓", sides: "← →", bar: "▌", spin: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  on: ["╔", "═", "╗", "║", "╚", "╝"], off: ["╭", "─", "╮", "│", "╰", "╯"],
};
const ASCII = {
  tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", pointer: ">", done: "ok", fail: "x", warn: "!", dot: "-",
  up: "^", down: "v", keys: "Up Down", sides: "Left Right", bar: "|", spin: ["-", "\\", "|", "/"],
  on: ["#", "=", "#", "#", "#", "#"], off: ["+", "-", "+", "|", "+", "+"],
};
const ASCII_TEXT = { "—": "-", "·": "-", "…": "...", "→": "->", "한국어": "Korean" };

// ---- the cards ---------------------------------------------------------------------------------
export const createInstallUi = ({ stdin, stdout, env, round: wantsRound = false, animate = true, settleMs = SETTLE_MS, now = Date.now, proc = process }) => {
  const depth = hudColorDepth(env);
  const ascii = asciiLocale(env);
  const glyph = ascii ? ASCII : UNICODE;
  // One form for the whole run: round needs truecolor, like the status line's own round gauges.
  const round = wantsRound && depth === "truecolor" && !ascii;
  let accent = "cyan";
  let letterAnsweredAt = -Infinity;

  const plainText = (text) => (ascii ? String(text).replace(/[—·…→]|한국어/gu, (found) => ASCII_TEXT[found]).replace(/[^\x1b\x20-\x7e]/gu, "?") : String(text));
  const paint = (text, { fg, bg, bold, dim } = {}) => {
    if (depth === "plain" || !text) return text;
    const codes = [bold && "1", dim && "2", fg && sgr(fg, false, depth), bg && sgr(bg, true, depth)].filter(Boolean);
    return codes.length > 0 ? `\x1b[${codes.join(";")}m${text}\x1b[0m` : text;
  };
  // Cells along a gradient; neighbours that round to the same step share one escape.
  const ramp = (text, stops, style, from = 0, span = [...text].length) => {
    if (depth === "plain") return text;
    const runs = [];
    [...text].forEach((ch, i) => {
      const step = Math.round(((from + i) / Math.max(1, span - 1)) * 24);
      if (runs.at(-1)?.step === step) runs.at(-1).text += ch;
      else runs.push({ step, text: ch });
    });
    return runs.map((run) => paint(run.text, style(mix(stops, run.step / 24)))).join("");
  };
  const size = () => ({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
  const cardWidth = () => Math.min(size().cols - 2, MAX_WIDTH);
  const heading = (text) => paint(plainText(text), { bold: true });
  const quiet = (text) => paint(plainText(text), { dim: true });

  // A filled chip: one padding cell at each end, which the round form gives to its caps.
  const chip = (text, stops) => {
    const fill = (part, from) => ramp(part, stops, (bg) => ({ fg: INK, bg, bold: true }), from, cells(text) + 2);
    return round ? paint(CAP_LEFT, { fg: stops[0] }) + fill(text, 1) + paint(CAP_RIGHT, { fg: stops.at(-1) }) : fill(` ${text} `, 0);
  };
  const pill = (text) => (depth === "plain" ? `[${text}]` : chip(text, [ORANGE, PINK]));
  const frame = ({ tag = "LIT", title, body, tone }) => {
    const width = cardWidth();
    const inner = width - 4;
    const stops = tone === "bad" ? [RED, RED] : [PINK, VIOLET, accentToken(accent)];
    const line = (text, from) => ramp(text, stops, (fg) => ({ fg }), from, width);
    const badge = pill(tag);
    const inEdge = cells(badge) + cells(plainText(title)) + 9 <= width;
    const used = 4 + cells(badge) + (inEdge ? cells(plainText(title)) + 3 : 0);
    const top = `${line(glyph.tl + glyph.h, 0)} ${badge}${inEdge ? ` ${quiet(glyph.dot)} ${heading(title)}` : ""} ` + line(glyph.h.repeat(width - used - 1) + glyph.tr, used);
    const rows = [...(inEdge ? [] : wrap(plainText(title), inner).map((text) => paint(text, { bold: true }))), ...body];
    return [
      top,
      ...rows.map((row) => `${line(glyph.v, 0)} ${pad(row, inner)} ${line(glyph.v, width - 1)}`),
      line(glyph.bl + glyph.h.repeat(width - 2) + glyph.br, 0),
    ].map((row) => ` ${row}`);
  };

  // ---- drawing in place ----
  let drawn = [];
  const lift = (count) => (count > 0 ? `\x1b[${count}A` : "");
  const draw = (rows) => {
    const shown = rows.slice(-Math.max(1, size().rows - 1));
    let out = lift(drawn.length);
    if (drawn.length !== shown.length) out += "\r\x1b[J";
    shown.forEach((row, i) => { out += drawn.length === shown.length && drawn[i] === row ? "\r\n" : `\r${row}\x1b[K\r\n`; });
    drawn = shown;
    stdout.write(out);
  };
  // After a resize the old rows may have wrapped: step over what they take up now, then draw afresh.
  const redraw = (rows) => {
    const { cols, rows: height } = size();
    const taken = drawn.reduce((sum, row) => sum + Math.max(1, Math.ceil(cells(row) / cols)), 0);
    stdout.write(`${lift(Math.min(taken, height - 1))}\r\x1b[J`);
    drawn = [];
    draw(rows);
  };
  let folded = false;
  const replaceWith = (row) => {
    stdout.write(`${lift(drawn.length)}\r\x1b[J${folded ? "" : "\r\n"}${row}\r\n`);
    folded = true;
    drawn = [];
  };

  // ---- the terminal's own state ----
  let active = false;
  const restore = () => {
    if (!active) return;
    active = false;
    stdout.write("\x1b[?25h");
    stdin.setRawMode(false);
    stdin.pause();
  };
  const onSignal = (signal) => { release(); proc.kill(proc.pid, signal); };
  const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
  const acquire = () => {
    active = true;
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1b[?25l");
    proc.on("exit", restore);
    for (const signal of SIGNALS) proc.on(signal, onSignal);
  };
  const release = () => {
    restore();
    proc.removeListener("exit", restore);
    for (const signal of SIGNALS) proc.removeListener(signal, onSignal);
  };
  const aborted = (key) => new Error(`Aborted with Ctrl+${key}`);

  // Keys typed before a card is on screen were never meant for it.
  const settle = () => new Promise((resolve, reject) => {
    const onData = (chunk) => { if (String(chunk).includes("\x03")) finish(aborted("C")); };
    const finish = (error) => {
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(finish, settleMs);
    stdin.on("data", onData);
  });

  // Draws `view()`, feeds it keys until `onKey` returns { value }, then folds it to `fold(value)`.
  const ask = async ({ view, onKey, fold, stopped }) => {
    acquire();
    let onKeypress;
    let onResize;
    let onEnd;
    try {
      await settle();
      draw(view());
      const value = await new Promise((resolve, reject) => {
        let finished = false;
        onKeypress = (text, key = {}) => {
          if (finished) return;
          if (key.ctrl && (key.name === "c" || key.name === "d")) { finished = true; reject(aborted(key.name.toUpperCase())); return; }
          if (key.ctrl && key.name === "z" && proc.platform !== "win32") {
            // stdin stays open: with nothing left to wait for, the process would end on its return.
            stdout.write("\x1b[?25h");
            stdin.setRawMode(false);
            proc.once("SIGCONT", () => {
              if (finished) return;
              stdin.setRawMode(true);
              stdout.write("\x1b[?25l");
              drawn = [];
              draw(view());
            });
            // The whole job, as the terminal would: a launcher such as npx left running would keep the shell waiting.
            proc.kill(0, "SIGTSTP");
            return;
          }
          if (key.ctrl || key.meta || key.name === "escape") return;
          const enter = key.name === "return" || key.name === "enter";
          if (enter && now() - letterAnsweredAt < LETTER_ENTER_MS) return;
          const answer = onKey({ text, name: key.name, enter });
          if (answer) { finished = true; resolve(answer.value); } else draw(view());
        };
        onResize = () => { if (!finished) redraw(view()); };
        onEnd = () => { if (!finished) { finished = true; reject(new Error("Aborted: the terminal closed")); } };
        emitKeypressEvents(stdin);
        stdin.on("keypress", onKeypress);
        stdout.on("resize", onResize);
        stdin.once("end", onEnd);
      });
      replaceWith(fold(value));
      return value;
    } catch (error) {
      replaceWith(stopped);
      throw error;
    } finally {
      if (onKeypress) stdin.removeListener("keypress", onKeypress);
      if (onResize) stdout.removeListener("resize", onResize);
      if (onEnd) stdin.removeListener("end", onEnd);
      release();
    }
  };

  const foldRow = (mark, color, title, value) => {
    const room = size().cols;
    const label = cells(title) + cells(value) + 8 + cells(mark) > room ? `${plainText(title)} ` : pad(plainText(title), Math.min(28, Math.max(VALUE_COL - 4, cells(title))));
    return ` ${paint(mark, { fg: color, bold: true })} ${label} ${value}`;
  };
  const answered = (title, value) => foldRow(glyph.done, GREEN, title, paint(plainText(value), { bold: true }));
  const stoppedRow = (title) => foldRow(glyph.fail, RED, title, "stopped");
  // Key hints, as many to a line as fit; a hint is never split.
  const hints = (parts, width) => parts.reduce((lines, part) => {
    const joined = `${lines.at(-1)}   ${part}`;
    return lines.length > 0 && cells(joined) <= width ? [...lines.slice(0, -1), joined] : [...lines, part];
  }, []).map(quiet);

  // A card that fits the window: roomy when it can be, then without its blank rows.
  const fit = (card, variants) => {
    const budget = size().rows - 1;
    for (const body of variants) {
      const rows = frame({ ...card, body: body.rows });
      const lead = body.tight ? rows : ["", ...rows];
      if (lead.length <= budget || body === variants.at(-1)) return { rows: lead, over: lead.length - budget };
    }
  };

  /**
   * One choice from a list. `choices` are { id, label, key, views?, detail?, color? }: `views` are the
   * same preview drawn at falling widths, of which the widest that fits every row is shown; `color` is
   * an accent name, shown as a swatch.
   */
  const choose = async ({ tag, title, note, choices, initial, initialTag = "default", onHighlight = () => {} }) => {
    const first = Math.max(0, choices.findIndex(({ id }) => id === initial));
    let at = first;
    const render = () => {
      const inner = cardWidth() - 4;
      const swatch = ({ color }) => (color && depth !== "plain" ? `${paint(ascii ? "##" : round ? CAP_LEFT + CAP_RIGHT : "██", { fg: accentToken(color) })} ` : "");
      const labels = choices.map((choice) => swatch(choice) + plainText(choice.label));
      const labelWidth = Math.max(...labels.map(cells));
      const tagText = [depth === "plain" ? `(${initialTag})` : initialTag, "*"].find((t, i) => i === 1 || 8 + labelWidth + cells(t) <= inner);
      const tagWidth = cells(tagText) + 2;
      const room = inner - 6 - labelWidth - 2 - tagWidth;
      const views = choices[0].views ?? [];
      const shown = views.findIndex((_, i) => choices.every((choice) => cells(choice.views[i]) <= room));
      const details = !views.length && choices.every(({ detail = "" }) => cells(plainText(detail)) <= room);
      const viewWidth = shown < 0 ? 0 : Math.max(...choices.map((choice) => cells(choice.views[shown])));
      const list = choices.map((choice, i) => {
        const on = i === at;
        const extra = shown >= 0 ? pad(choice.views[shown], viewWidth) : details ? (on ? plainText(choice.detail ?? "") : quiet(choice.detail ?? "")) : "";
        const mark = i === first ? paint(tagText, on ? { bold: true } : { fg: PINK, bold: true }) : "";
        const row = `${on ? glyph.pointer : " "} ${choice.key} ${pad(labels[i], labelWidth)}${extra ? `  ${extra}` : ""}${mark ? `  ${mark}` : ""}`;
        if (!on || depth === "plain") return ` ${row}`;
        const bar = `\x1b[${sgr(IVORY, false, depth)};${sgr(BAR, true, depth)}m`;
        const filled = (text) => `${bar}${text.replace(/\x1b\[(?:0|39)m/gu, (reset) => reset + bar)}\x1b[0m`;
        const body = pad(row, inner - 2);
        return round ? paint(CAP_LEFT, { fg: BAR }) + filled(body) + paint(CAP_RIGHT, { fg: BAR }) : filled(` ${body} `);
      });
      const noteRows = wrap(plainText(note), inner);
      const last = choices.at(-1).key;
      const hintRows = hints([`${glyph.keys} move`, `${choices[0].key}-${choices.length > 9 ? "9, 0" : last} jump`, "Enter choose", "Ctrl+C stop"], inner);
      const card = { tag, title };
      const roomy = fit(card, [{ rows: ["", ...noteRows, "", ...list, "", ...hintRows] }, { rows: [...noteRows, "", ...list, "", ...hintRows] }, { rows: [...noteRows, ...list, ...hintRows], tight: true }]);
      if (roomy.over <= 0) return roomy.rows;
      // Too short for the whole list: a window on it that follows the highlight, the arrows saying there is more.
      const shortHint = (more) => hints([more, "Enter choose", "Ctrl+C stop"], inner);
      const spare = size().rows - 1 - frame({ ...card, body: [...noteRows, ...shortHint(`${list.length}/${list.length} ${glyph.up} ${glyph.down}`)] }).length;
      const count = Math.max(1, Math.min(list.length, spare));
      const start = Math.max(0, Math.min(at - Math.floor(count / 2), list.length - count));
      const more = `${at + 1}/${list.length}${start > 0 ? ` ${glyph.up}` : ""}${start + count < list.length ? ` ${glyph.down}` : ""}`;
      return frame({ ...card, body: [...noteRows, ...list.slice(start, start + count), ...shortHint(more)] });
    };
    const move = (to) => { at = (to + choices.length) % choices.length; onHighlight(choices[at].id); };
    const id = await ask({
      view: render,
      stopped: stoppedRow(title),
      fold: (value) => answered(title, choices.find((choice) => choice.id === value).label),
      onKey: ({ text, name, enter }) => {
        if (enter) return { value: choices[at].id };
        if (name === "up" || name === "k") move(at - 1);
        else if (name === "down" || name === "j") move(at + 1);
        else if (name === "home") move(0);
        else if (name === "end") move(choices.length - 1);
        else {
          const jump = choices.findIndex(({ key }) => key === text);
          if (jump >= 0) move(jump);
        }
        return null;
      },
    });
    return id;
  };

  /** Yes or no, with the default highlighted and named on its button. */
  const confirm = async ({ tag, title, note, initial, foldYes = "yes", foldNo = "no" }) => {
    let yes = initial;
    const buttons = (small) => {
      const inner = cardWidth() - 4;
      const each = [[true, "Yes"], [false, "No"]].map(([value, word]) => {
        const on = value === yes;
        const label = `${on ? glyph.pointer : " "} ${word}${value === initial ? (inner >= 44 ? " (default)" : " default") : ""}`;
        const width = Math.max(...["Yes", "No"].map((w) => w.length)) + (inner >= 44 ? 10 : 8) + 2;
        const text = pad(label, width);
        const set = on ? glyph.on : glyph.off;
        const filled = on && depth !== "plain";
        if (small) return [filled ? chip(text, [PINK, VIOLET]) : on ? `[${text}]` : ` ${paint(text, { dim: true })} `];
        if (filled && !ascii) {
          // A neon outline with the filled chip inside it.
          const edge = (part, from = 0) => ramp(part, [PINK, VIOLET], (fg) => ({ fg }), from, width + 6);
          const rule = glyph.h.repeat(width + 4);
          return [edge(glyph.tl + rule + glyph.tr), `${edge(glyph.v)} ${chip(text, [PINK, VIOLET])} ${edge(glyph.v, width + 5)}`, edge(glyph.bl + rule + glyph.br)];
        }
        const style = on ? (t) => paint(t, { fg: PINK, bold: true }) : quiet;
        const rule = set[1].repeat(width + 4);
        return [style(set[0] + rule + set[2]), `${style(set[3])}  ${on ? paint(text, { bold: true }) : text}  ${style(set[3])}`, style(set[4] + rule + set[5])];
      });
      return each[0].map((left, i) => `${left}  ${each[1][i]}`).filter((row) => cells(row) <= inner || small);
    };
    const render = () => {
      const inner = cardWidth() - 4;
      const noteRows = wrap(plainText(note), inner);
      const hintRows = hints(["y / n answer", `${glyph.sides} switch`, `Enter = ${yes ? "Yes" : "No"}`, "Ctrl+C stop"], inner);
      const big = buttons(false);
      const small = buttons(true);
      const pair = big.length === 3 ? big : small;
      return fit({ tag, title: `${title} ${initial ? "[Y/n]" : "[y/N]"}` }, [
        { rows: ["", ...noteRows, "", ...pair, "", ...hintRows] },
        { rows: [...noteRows, "", ...pair, "", ...hintRows] },
        { rows: [...noteRows, ...pair, ...hintRows], tight: true },
        { rows: [...noteRows, ...small, ...hintRows], tight: true },
        { rows: [...noteRows, ...small, ...hints(["y / n", `Enter = ${yes ? "Yes" : "No"}`, "Ctrl+C stop"], inner)], tight: true },
      ]).rows;
    };
    return ask({
      view: render,
      stopped: stoppedRow(title),
      fold: (value) => answered(title, value ? foldYes : foldNo),
      onKey: ({ text, name, enter }) => {
        if (enter) return { value: yes };
        if (/^[yn]$/iu.test(text ?? "")) {
          letterAnsweredAt = now();
          return { value: /y/iu.test(text) };
        }
        if (["left", "right", "tab"].includes(name)) yes = !yes;
        return null;
      },
    });
  };

  // ---- work in progress ----
  // Keys pressed while work runs are dropped (echoed, they would push the card about); Ctrl+C still ends the process.
  const hold = () => {
    acquire();
    const onData = (chunk) => { if (String(chunk).includes("\x03")) onSignal("SIGINT"); };
    stdin.on("data", onData);
    return () => { stdin.removeListener("data", onData); release(); };
  };

  /** A card of named steps. `run(i, work)` spins on step i; `finish` folds the card to one line. */
  const progress = ({ tag, title, steps }) => {
    const state = steps.map(() => "wait");
    let spin = 0;
    const letGo = hold();
    const render = () => {
      const inner = cardWidth() - 4;
      const longest = Math.max(...steps.map(({ name }) => name.length));
      const column = VALUE_COL - 7;
      const nameWidth = steps.every(({ text }) => column + cells(text) + cells(glyph.done) + 3 <= inner) ? Math.max(column, longest) : longest;
      const body = steps.map(({ name, text }, i) => {
        const mark = { wait: quiet(glyph.dot), run: paint(glyph.spin[spin % glyph.spin.length], { fg: accentToken(accent), bold: true }), done: paint(glyph.done, { fg: GREEN, bold: true }), fail: paint(glyph.fail, { fg: RED, bold: true }) }[state[i]];
        const label = pad(name, nameWidth);
        const row = `${pad(mark, cells(glyph.done))} ${state[i] === "run" ? paint(label, { bold: true }) : state[i] === "wait" ? quiet(label) : label}`;
        return cells(row) + 2 + cells(text) <= inner ? `${row}  ${quiet(text)}` : row;
      });
      return ["", ...frame({ tag, title, body: ["", ...body], tone: state.includes("fail") ? "bad" : undefined })];
    };
    const onResize = () => redraw(render());
    stdout.on("resize", onResize);
    draw(render());
    const stop = () => { stdout.removeListener("resize", onResize); letGo(); };
    return {
      async run(i, work) {
        state[i] = "run";
        draw(render());
        const timer = animate ? setInterval(() => { spin += 1; draw(render()); }, 80) : undefined;
        try {
          const result = await work();
          state[i] = "done";
          return result;
        } catch (error) {
          state[i] = "fail";
          throw error;
        } finally {
          clearInterval(timer);
          draw(render());
          if (state[i] === "fail") { drawn = []; stop(); }
        }
      },
      finish(label, value, ok = true) { stop(); replaceWith(ok ? answered(label, value) : foldRow(glyph.warn, AMBER, label, plainText(value))); },
    };
  };

  /** A finished card: sections of marked rows. A value is wrapped, never cut short. */
  const panel = ({ tag, title, sections, tone }) => {
    const inner = cardWidth() - 4;
    const marks = { done: [glyph.done, GREEN], warn: [glyph.warn, AMBER], fail: [glyph.fail, RED], note: [glyph.dot, VIOLET] };
    const labelWidth = Math.max(VALUE_COL - 5, ...sections.flatMap(({ rows }) => rows.map(({ label = "" }) => cells(label) + 2)));
    const stacked = inner < 56;
    const markWidth = cells(glyph.done) + 1;
    const body = sections.flatMap(({ head, rows }) => [
      "",
      ...(head ? [paint(head, { fg: PINK, bold: true })] : []),
      ...rows.flatMap(({ mark = "done", label = "", value }) => {
        const [sign, color] = marks[mark];
        const lead = `${pad(paint(sign, { fg: color, bold: true }), markWidth)}`;
        const style = mark === "warn" || mark === "fail" ? (t) => paint(t, { bold: true }) : (t) => t;
        if (!label || stacked) {
          const lines = wrap(plainText(value), inner - markWidth);
          const rest = lines.map((text) => " ".repeat(markWidth) + style(text));
          return label ? [lead + heading(label), ...rest] : [lead + style(lines[0]), ...rest.slice(1)];
        }
        return wrap(plainText(value), inner - markWidth - labelWidth).map((text, i) => (i === 0
          ? lead + pad(heading(label), labelWidth) + style(text)
          : " ".repeat(markWidth + labelWidth) + style(text)));
      }),
    ]);
    stdout.write(`\n${frame({ tag, title, body, tone }).join("\n")}\n\n`);
  };

  return {
    depth, ascii, round, choose, confirm, progress, panel, paint, plainText, heading,
    setAccent: (name) => { accent = name; },
    cols: () => size().cols,
    cardWidth,
  };
};
